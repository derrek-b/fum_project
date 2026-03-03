/**
 * @fileoverview Integration test for vault setup retry and recovery
 * Tests the error handling flow: initial setup failure → retry queue → successful recovery
 *
 * Tests failure at each setup step:
 * - Step 1: vault_loading (vaultDataService.getVault)
 * - Step 2: baseline_capture (vaultDataService.fetchAssetValues)
 * - Step 3: strategy_initialization (strategy.initializeVault)
 *   - Sub-failures: selectBestPool, evaluateInitialPositions, addToPosition
 *   - addToPosition test also validates VaultAuthGranted event handler path (auth_event source)
 * - Step 4: monitoring_setup (eventManager.subscribeToSwapEvents)
 *
 * Entry points tested:
 * - loadAuthorizedVaults (initial_setup source) - most tests
 * - VaultAuthGranted event handler (auth_event source) - addToPosition test
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { UnrecoverableError } from '../../../src/utils/errors.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Error Handling - Setup Retry Recovery', () => {
  let testEnv;
  let testConfig;
  let tempDir;
  let service;
  let testVault;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create vault with aligned position AND loose tokens for addToPosition testing
    // Position uses 30% of assets, remaining 70% * 80% = 56% transferred as loose tokens
    // This ensures availableDeployment > 0 so addToPosition code path is exercised
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Retry Test Vault',
        wrapEthAmount: '5',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '1' }
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 30,  // Smaller position leaves room for addToPosition
            tickRange: {
              type: 'centered',  // Aligned position - current tick is within range
              spacing: 10
            }
          }
        ],
        tokenTransfers: {
          'WETH': 80,
          'USDC': 80
        },
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );

    console.log(`Test vault created at: ${testVault.vaultAddress}`);
  }, 120000);

  afterAll(async () => {
    await cleanupTestBlockchain(testEnv);
  });

  afterEach(async () => {
    // Restore all mocks
    vi.restoreAllMocks();

    // Clean up service
    if (service) {
      try {
        // Always force stop to clean up all resources
        await service.stop(true);
      } catch (e) {
        // Ignore cleanup errors
      }
      service = null;
    }

    // Clean up temp directory
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
      tempDir = null;
    }
  });

  /**
   * Helper to create temp directory for test isolation
   */
  const createTempDir = async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retry-test-'));
    return tempDir;
  };

  /**
   * Helper to create a service with standard test config
   */
  const createTestService = async (ssePort) => {
    const dir = await createTempDir();

    service = new AutomationService({
      chainId: 1337,
      wsUrl: testConfig.wsUrl,
      dataDir: dir,
      ssePort,
      debug: true,
      retryIntervalMs: 999999999  // Effectively disabled - we'll call manually
    });

    return { service, dir, blacklistPath: service.blacklistFilePath, trackingDir: service.trackingDataDir };
  };

  /**
   * Helper to set up event tracking
   */
  const setupEventTracking = (service) => {
    const events = {
      vaultFailed: [],
      vaultRecovered: [],
      vaultSetupComplete: [],
      vaultSetupFailed: []
    };

    service.eventManager.subscribe('VaultFailed', (data) => {
      console.log(`  [EVENT] VaultFailed: ${data.vaultAddress?.slice(0, 10)}... - ${data.error?.slice(0, 50)}`);
      events.vaultFailed.push(data);
    });

    service.eventManager.subscribe('VaultRecovered', (data) => {
      console.log(`  [EVENT] VaultRecovered: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultRecovered.push(data);
    });

    service.eventManager.subscribe('VaultSetupComplete', (data) => {
      console.log(`  [EVENT] VaultSetupComplete: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultSetupComplete.push(data);
    });

    service.eventManager.subscribe('VaultSetupFailed', (data) => {
      console.log(`  [EVENT] VaultSetupFailed: ${data.vaultAddress?.slice(0, 10)}... step=${data.step}`);
      events.vaultSetupFailed.push(data);
    });

    return events;
  };

  // ============================================================================
  // Step 1: vault_loading - vaultDataService.getVault() failure
  // ============================================================================
  describe('Step 1: vault_loading failure', () => {
    it('should recover after getVault() fails on initial setup', async () => {
      await createTestService(3110);
      const events = setupEventTracking(service);

      let getVaultCallCount = 0;

      // Inject spy after initialize but before loadAuthorizedVaults
      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
        vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
          getVaultCallCount++;
          console.log(`  [SPY] getVault call #${getVaultCallCount}`);

          if (getVaultCallCount === 1) {
            throw new Error('NETWORK_ERROR: Connection refused');
          }
          return realGetVault(addr, forceRefresh);
        });
      };

      // Start service - vault should fail
      console.log('Starting service (expecting vault_loading failure)...');
      await service.start();

      // Verify failure state
      expect(service.failedVaults.size).toBe(1);
      expect(events.vaultFailed.length).toBe(1);
      expect(events.vaultFailed[0].source).toBe('initial_setup');
      expect(events.vaultSetupFailed[0].step).toBe('vault_loading');

      // Trigger retry
      console.log('Triggering retry...');
      await service.retryFailedVaults();

      // Verify recovery
      expect(service.failedVaults.size).toBe(0);
      expect(events.vaultRecovered.length).toBe(1);
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
      expect(getVaultCallCount).toBe(2);
    }, 60000);
  });

  // ============================================================================
  // Step 2: baseline_capture - vaultDataService.fetchAssetValues() failure
  // ============================================================================
  describe('Step 2: baseline_capture failure', () => {
    it('should recover after fetchAssetValues() fails on initial setup', async () => {
      await createTestService(3111);
      const events = setupEventTracking(service);

      let fetchAssetValuesCallCount = 0;

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const realFetchAssetValues = service.vaultDataService.fetchAssetValues.bind(service.vaultDataService);
        vi.spyOn(service.vaultDataService, 'fetchAssetValues').mockImplementation(async (vault) => {
          fetchAssetValuesCallCount++;
          console.log(`  [SPY] fetchAssetValues call #${fetchAssetValuesCallCount}`);

          if (fetchAssetValuesCallCount === 1) {
            throw new Error('TIMEOUT: Price feed unavailable');
          }
          return realFetchAssetValues(vault);
        });
      };

      console.log('Starting service (expecting baseline_capture failure)...');
      await service.start();

      // Verify failure state
      expect(service.failedVaults.size).toBe(1);
      expect(events.vaultFailed.length).toBe(1);
      expect(events.vaultFailed[0].source).toBe('initial_setup');
      expect(events.vaultSetupFailed[0].step).toBe('baseline_capture');

      // Trigger retry
      console.log('Triggering retry...');
      await service.retryFailedVaults();

      // Verify recovery
      expect(service.failedVaults.size).toBe(0);
      expect(events.vaultRecovered.length).toBe(1);
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
      expect(fetchAssetValuesCallCount).toBe(2);
    }, 60000);
  });

  // ============================================================================
  // Step 3: strategy_initialization - strategy.initializeVault() failure
  // ============================================================================
  describe('Step 3: strategy_initialization failure', () => {
    it('should recover after initializeVault() fails on initial setup', async () => {
      await createTestService(3112);
      const events = setupEventTracking(service);

      let initializeVaultCallCount = 0;

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        // Get the bob strategy and spy on its initializeVault method
        const bobStrategy = service.strategies.get('bob');
        const realInitializeVault = bobStrategy.initializeVault.bind(bobStrategy);
        vi.spyOn(bobStrategy, 'initializeVault').mockImplementation(async (vault) => {
          initializeVaultCallCount++;
          console.log(`  [SPY] initializeVault call #${initializeVaultCallCount}`);

          if (initializeVaultCallCount === 1) {
            throw new Error('ECONNRESET: RPC connection lost during approval');
          }
          return realInitializeVault(vault);
        });
      };

      console.log('Starting service (expecting strategy_initialization failure)...');
      await service.start();

      // Verify failure state
      expect(service.failedVaults.size).toBe(1);
      expect(events.vaultFailed.length).toBe(1);
      expect(events.vaultFailed[0].source).toBe('initial_setup');
      expect(events.vaultSetupFailed[0].step).toBe('strategy_initialization');

      // Trigger retry
      console.log('Triggering retry...');
      await service.retryFailedVaults();

      // Verify recovery
      expect(service.failedVaults.size).toBe(0);
      expect(events.vaultRecovered.length).toBe(1);
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
      expect(initializeVaultCallCount).toBe(2);
    }, 60000);

    // ------------------------------------------------------------------------
    // Sub-failure: selectBestPool (wrapped in retryRpcCall with 3 retries)
    // ------------------------------------------------------------------------
    it('should recover after selectBestPool() fails on initial setup', async () => {
      await createTestService(3116);
      const events = setupEventTracking(service);

      let selectBestPoolCallCount = 0;

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        // Get the bob strategy and its uniswapV3 adapter
        const bobStrategy = service.strategies.get('bob');
        const adapter = bobStrategy.adapters.get('uniswapV3');
        const realSelectBestPool = adapter.selectBestPool.bind(adapter);

        vi.spyOn(adapter, 'selectBestPool').mockImplementation(async (...args) => {
          selectBestPoolCallCount++;
          console.log(`  [SPY] selectBestPool call #${selectBestPoolCallCount}`);

          // Fail first 4 calls to exhaust retryRpcCall (1 initial + 3 retries)
          // Then succeed on call #5+ (during retry from failedVaults)
          if (selectBestPoolCallCount <= 4) {
            throw new Error('Connection timeout: RPC node unavailable');
          }
          return realSelectBestPool(...args);
        });
      };

      console.log('Starting service (expecting selectBestPool failure)...');
      await service.start();

      // Verify failure state
      expect(service.failedVaults.size).toBe(1);
      expect(events.vaultFailed.length).toBe(1);
      expect(events.vaultFailed[0].source).toBe('initial_setup');
      expect(events.vaultSetupFailed[0].step).toBe('strategy_initialization');

      // Trigger retry
      console.log('Triggering retry...');
      await service.retryFailedVaults();

      // Verify recovery
      expect(service.failedVaults.size).toBe(0);
      expect(events.vaultRecovered.length).toBe(1);
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
      // 4 failed calls during initial setup + 1 successful call during retry = 5 total
      expect(selectBestPoolCallCount).toBe(5);
    }, 60000);

    // ------------------------------------------------------------------------
    // Sub-failure: evaluateInitialPositions (no retry wrapper)
    // ------------------------------------------------------------------------
    it('should recover after evaluateInitialPositions() fails on initial setup', async () => {
      await createTestService(3117);
      const events = setupEventTracking(service);

      let evaluateCallCount = 0;

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const bobStrategy = service.strategies.get('bob');
        const realEvaluate = bobStrategy.evaluateInitialPositions.bind(bobStrategy);

        vi.spyOn(bobStrategy, 'evaluateInitialPositions').mockImplementation(async (...args) => {
          evaluateCallCount++;
          console.log(`  [SPY] evaluateInitialPositions call #${evaluateCallCount}`);

          if (evaluateCallCount === 1) {
            throw new Error('NETWORK_ERROR: Failed to fetch position data');
          }
          return realEvaluate(...args);
        });
      };

      console.log('Starting service (expecting evaluateInitialPositions failure)...');
      await service.start();

      // Verify failure state
      expect(service.failedVaults.size).toBe(1);
      expect(events.vaultFailed.length).toBe(1);
      expect(events.vaultFailed[0].source).toBe('initial_setup');
      expect(events.vaultSetupFailed[0].step).toBe('strategy_initialization');

      // Trigger retry
      console.log('Triggering retry...');
      await service.retryFailedVaults();

      // Verify recovery
      expect(service.failedVaults.size).toBe(0);
      expect(events.vaultRecovered.length).toBe(1);
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
      expect(evaluateCallCount).toBe(2);
    }, 60000);

    // ------------------------------------------------------------------------
    // Sub-failure: addToPosition (no retry wrapper)
    // Creates a fresh vault AFTER service starts to ensure loose tokens exist
    // Also tests the VaultAuthGranted event handler path (auth_event source)
    // ------------------------------------------------------------------------
    it('should recover after addToPosition() fails via auth event', async () => {
      await createTestService(3118);
      const events = setupEventTracking(service);

      let addToPositionCallCount = 0;

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const bobStrategy = service.strategies.get('bob');
        const realAddToPosition = bobStrategy.addToPosition.bind(bobStrategy);

        vi.spyOn(bobStrategy, 'addToPosition').mockImplementation(async (...args) => {
          addToPositionCallCount++;
          console.log(`  [SPY] addToPosition call #${addToPositionCallCount}`);

          if (addToPositionCallCount === 1) {
            throw new Error('ECONNRESET: Transaction submission failed');
          }
          return realAddToPosition(...args);
        });
      };

      // Start service first - no vaults authorized yet (testVault is already used by prior tests)
      // The spy is now active for when the auth event triggers setup
      console.log('Starting service (no vaults to load initially)...');
      await service.start();

      // Create a fresh vault with loose tokens available for addToPosition
      // Setting the executor will trigger VaultAuthGranted event
      console.log('Creating fresh vault with loose tokens...');
      const freshVault = await setupTestVault(
        testEnv.hardhatServer,
        testEnv.contracts,
        testEnv.deployedContracts,
        {
          vaultName: 'AddToPosition Test Vault',
          wrapEthAmount: '5',
          swapTokens: [
            { from: 'WETH', to: 'USDC', amount: '1' }
          ],
          positions: [
            {
              token0: 'USDC',
              token1: 'WETH',
              fee: 500,
              percentOfAssets: 20,  // Small position = more loose tokens
              tickRange: {
                type: 'centered',
                spacing: 10
              }
            }
          ],
          tokenTransfers: {
            'WETH': 90,  // Transfer most remaining tokens to vault
            'USDC': 90
          },
          targetTokens: ['USDC', 'WETH'],
          targetPlatforms: ['uniswapV3'],
          strategy: 'bob'
        }
      );

      console.log(`Fresh vault created at: ${freshVault.vaultAddress}`);

      // Wait for auth event to be processed and setup to fail
      // The executor was set during setupTestVault, which emits ExecutorChanged
      // Give time for event processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify failure state - source should be 'auth_event' not 'initial_setup'
      expect(service.failedVaults.size).toBe(1);
      expect(service.failedVaults.has(freshVault.vaultAddress)).toBe(true);
      expect(events.vaultFailed.length).toBeGreaterThanOrEqual(1);

      // Find the failure event for our fresh vault
      const freshVaultFailure = events.vaultFailed.find(e => e.vaultAddress === freshVault.vaultAddress);
      expect(freshVaultFailure).toBeDefined();
      expect(freshVaultFailure.source).toBe('auth_event');
      expect(events.vaultSetupFailed.some(e =>
        e.vaultAddress === freshVault.vaultAddress && e.step === 'strategy_initialization'
      )).toBe(true);
      expect(addToPositionCallCount).toBe(1);

      // Trigger retry
      console.log('Triggering retry...');
      await service.retryFailedVaults();

      // Verify recovery
      expect(service.failedVaults.has(freshVault.vaultAddress)).toBe(false);
      expect(events.vaultRecovered.some(e => e.vaultAddress === freshVault.vaultAddress)).toBe(true);
      expect(service.vaultDataService.hasVault(freshVault.vaultAddress)).toBe(true);
      expect(addToPositionCallCount).toBe(2);
    }, 120000);  // Longer timeout for vault creation
  });

  // ============================================================================
  // Step 4: monitoring_setup - eventManager.subscribeToSwapEvents() failure
  // ============================================================================
  describe('Step 4: monitoring_setup failure', () => {
    it('should recover after subscribeToSwapEvents() fails on initial setup', async () => {
      await createTestService(3113);
      const events = setupEventTracking(service);

      // Track calls specifically for testVault (other vaults may exist from prior tests)
      let testVaultSubscribeCallCount = 0;

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const realSubscribeToSwapEvents = service.eventManager.subscribeToSwapEvents.bind(service.eventManager);
        vi.spyOn(service.eventManager, 'subscribeToSwapEvents').mockImplementation(async (vault, provider, chainId) => {
          // Only track/fail calls for testVault (vault uses .address, testVault uses .vaultAddress)
          if (vault.address === testVault.vaultAddress) {
            testVaultSubscribeCallCount++;
            console.log(`  [SPY] subscribeToSwapEvents for testVault call #${testVaultSubscribeCallCount}`);

            // Fail first 3 calls to exhaust retryWithBackoff (1 initial + 2 retries)
            // Then succeed on call #4+ (during retry from failedVaults)
            if (testVaultSubscribeCallCount <= 3) {
              throw new Error('Connection timeout: Filter registration failed');
            }
          }
          return realSubscribeToSwapEvents(vault, provider, chainId);
        });
      };

      console.log('Starting service (expecting monitoring_setup failure)...');
      await service.start();

      // Verify failure state - check testVault specifically
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      const testVaultFailure = events.vaultFailed.find(e => e.vaultAddress === testVault.vaultAddress);
      expect(testVaultFailure).toBeDefined();
      expect(testVaultFailure.source).toBe('initial_setup');
      const testVaultSetupFailed = events.vaultSetupFailed.find(e => e.vaultAddress === testVault.vaultAddress);
      expect(testVaultSetupFailed.step).toBe('monitoring_setup');

      // Trigger retry
      console.log('Triggering retry...');
      await service.retryFailedVaults();

      // Verify recovery
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      expect(events.vaultRecovered.some(e => e.vaultAddress === testVault.vaultAddress)).toBe(true);
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
      // 3 failed calls during initial setup + 1 successful call during retry = 4 total
      expect(testVaultSubscribeCallCount).toBe(4);
    }, 60000);
  });

  // ============================================================================
  // Multiple Retry Cycles - Recovery on 2nd or 3rd retry attempt
  // ============================================================================
  describe('Multiple Retry Cycles', () => {
    it('should recover on 2nd retry after initial setup and 1st retry both fail', async () => {
      await createTestService(3119);
      const events = setupEventTracking(service);

      // Track calls specifically for testVault
      let testVaultGetVaultCallCount = 0;

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
        vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
          // Only track/fail calls for testVault
          if (addr === testVault.vaultAddress) {
            testVaultGetVaultCallCount++;
            console.log(`  [SPY] getVault for testVault call #${testVaultGetVaultCallCount}`);

            // Fail calls 1 and 2, succeed on call 3
            if (testVaultGetVaultCallCount <= 2) {
              throw new Error('ETIMEDOUT: RPC node temporarily unavailable');
            }
          }
          return realGetVault(addr, forceRefresh);
        });
      };

      // Initial setup - should fail
      console.log('Starting service (expecting initial setup failure)...');
      await service.start();

      // Verify initial failure state - check testVault specifically
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      const testVaultFailures = events.vaultFailed.filter(e => e.vaultAddress === testVault.vaultAddress);
      expect(testVaultFailures.length).toBe(1);
      expect(testVaultFailures[0].source).toBe('initial_setup');
      expect(testVaultGetVaultCallCount).toBe(1);

      // Retry #1 - should fail again
      console.log('Triggering retry #1 (expecting failure)...');
      await service.retryFailedVaults();

      // Verify still in failed state after retry #1
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      const testVaultFailures2 = events.vaultFailed.filter(e => e.vaultAddress === testVault.vaultAddress);
      expect(testVaultFailures2.length).toBe(2);
      expect(testVaultFailures2[1].source).toBe('retry_attempt');
      expect(events.vaultRecovered.filter(e => e.vaultAddress === testVault.vaultAddress).length).toBe(0);
      expect(testVaultGetVaultCallCount).toBe(2);

      // Retry #2 - should succeed
      console.log('Triggering retry #2 (expecting success)...');
      await service.retryFailedVaults();

      // Verify recovery
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      expect(events.vaultRecovered.filter(e => e.vaultAddress === testVault.vaultAddress).length).toBe(1);
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
      expect(testVaultGetVaultCallCount).toBe(3);
    }, 60000);

    it('should recover on 3rd retry after initial setup and retries 1-2 all fail', async () => {
      await createTestService(3120);
      const events = setupEventTracking(service);

      // Track calls specifically for testVault
      let testVaultGetVaultCallCount = 0;

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
        vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
          // Only track/fail calls for testVault
          if (addr === testVault.vaultAddress) {
            testVaultGetVaultCallCount++;
            console.log(`  [SPY] getVault for testVault call #${testVaultGetVaultCallCount}`);

            // Fail calls 1, 2, and 3, succeed on call 4
            if (testVaultGetVaultCallCount <= 3) {
              throw new Error('ECONNREFUSED: Connection refused');
            }
          }
          return realGetVault(addr, forceRefresh);
        });
      };

      // Initial setup - should fail
      console.log('Starting service (expecting initial setup failure)...');
      await service.start();

      // Verify initial failure state - check testVault specifically
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      const testVaultFailures1 = events.vaultFailed.filter(e => e.vaultAddress === testVault.vaultAddress);
      expect(testVaultFailures1.length).toBe(1);
      expect(testVaultFailures1[0].source).toBe('initial_setup');

      // Retry #1 - should fail
      console.log('Triggering retry #1 (expecting failure)...');
      await service.retryFailedVaults();

      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      const testVaultFailures2 = events.vaultFailed.filter(e => e.vaultAddress === testVault.vaultAddress);
      expect(testVaultFailures2.length).toBe(2);
      expect(testVaultFailures2[1].source).toBe('retry_attempt');

      // Retry #2 - should fail
      console.log('Triggering retry #2 (expecting failure)...');
      await service.retryFailedVaults();

      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      const testVaultFailures3 = events.vaultFailed.filter(e => e.vaultAddress === testVault.vaultAddress);
      expect(testVaultFailures3.length).toBe(3);
      expect(testVaultFailures3[2].source).toBe('retry_attempt');
      expect(events.vaultRecovered.filter(e => e.vaultAddress === testVault.vaultAddress).length).toBe(0);

      // Retry #3 - should succeed
      console.log('Triggering retry #3 (expecting success)...');
      await service.retryFailedVaults();

      // Verify recovery
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      expect(events.vaultRecovered.filter(e => e.vaultAddress === testVault.vaultAddress).length).toBe(1);
      expect(testVaultGetVaultCallCount).toBe(4);
    }, 60000);
  });

  // ============================================================================
  // Retryable vs Non-Retryable Error Classification
  // ============================================================================
  describe('Error Classification', () => {
    it('should retry on network errors (retryable)', async () => {
      await createTestService(3114);
      const events = setupEventTracking(service);

      // Track calls specifically for testVault
      let testVaultCallCount = 0;

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
        vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
          // Only track/fail calls for testVault
          if (addr === testVault.vaultAddress) {
            testVaultCallCount++;
            if (testVaultCallCount === 1) {
              throw new Error('ETIMEDOUT: Connection timed out');
            }
          }
          return realGetVault(addr, forceRefresh);
        });
      };

      await service.start();

      // Should be in retry queue, not blacklisted
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);

      // Retry should succeed
      await service.retryFailedVaults();
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      expect(events.vaultRecovered.filter(e => e.vaultAddress === testVault.vaultAddress).length).toBe(1);
    }, 60000);

    it('should blacklist immediately on unrecoverable errors', async () => {
      await createTestService(3115);
      const events = setupEventTracking(service);

      let blacklistEvents = [];
      service.eventManager.subscribe('VaultBlacklisted', (data) => {
        console.log(`  [EVENT] VaultBlacklisted: ${data.vaultAddress?.slice(0, 10)}...`);
        blacklistEvents.push(data);
      });

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
        vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
          // Only fail testVault with unrecoverable error
          if (addr === testVault.vaultAddress) {
            throw new UnrecoverableError('Vault has invalid strategy configuration');
          }
          return realGetVault(addr, forceRefresh);
        });
      };

      await service.start();

      // Should be blacklisted, not in retry queue
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
      expect(blacklistEvents.filter(e => e.vaultAddress === testVault.vaultAddress).length).toBe(1);
    }, 60000);
  });

  // ============================================================================
  // Multiple Vault Concurrent Failures
  // ============================================================================
  describe('Multiple Vault Concurrent Failures', () => {
    let multiVaultSnapshot;
    let vault1, vault2, vault3;

    beforeAll(async () => {
      // Take snapshot before creating additional vaults
      multiVaultSnapshot = await testEnv.hardhatServer.provider.send('evm_snapshot', []);

      // Create 3 vaults for concurrent failure testing
      const vaultConfig = {
        wrapEthAmount: '5',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '1' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 50,
          tickRange: { type: 'centered', spacing: 10 }
        }],
        tokenTransfers: { 'WETH': 50, 'USDC': 50 },
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      };

      vault1 = await setupTestVault(
        testEnv.hardhatServer,
        testEnv.contracts,
        testEnv.deployedContracts,
        { ...vaultConfig, vaultName: 'Concurrent Test Vault 1' }
      );
      console.log(`Vault 1 created: ${vault1.vaultAddress}`);

      vault2 = await setupTestVault(
        testEnv.hardhatServer,
        testEnv.contracts,
        testEnv.deployedContracts,
        { ...vaultConfig, vaultName: 'Concurrent Test Vault 2' }
      );
      console.log(`Vault 2 created: ${vault2.vaultAddress}`);

      vault3 = await setupTestVault(
        testEnv.hardhatServer,
        testEnv.contracts,
        testEnv.deployedContracts,
        { ...vaultConfig, vaultName: 'Concurrent Test Vault 3' }
      );
      console.log(`Vault 3 created: ${vault3.vaultAddress}`);
    }, 180000);

    afterAll(async () => {
      // Revert to snapshot to clean up the 3 vaults
      if (multiVaultSnapshot) {
        await testEnv.hardhatServer.provider.send('evm_revert', [multiVaultSnapshot]);
      }
    });

    it('should track all vaults independently when multiple fail during startup', async () => {
      await createTestService(3121);

      const events = {
        vaultFailed: [],
        vaultRecovered: []
      };

      service.eventManager.subscribe('VaultFailed', (data) => {
        console.log(`  [EVENT] VaultFailed: ${data.vaultAddress?.slice(0, 10)}...`);
        events.vaultFailed.push(data);
      });

      service.eventManager.subscribe('VaultRecovered', (data) => {
        console.log(`  [EVENT] VaultRecovered: ${data.vaultAddress?.slice(0, 10)}...`);
        events.vaultRecovered.push(data);
      });

      // Track call counts per vault address
      const callCounts = new Map();
      const vaultAddresses = [vault1.vaultAddress, vault2.vaultAddress, vault3.vaultAddress];

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
        vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
          // Only track our 3 test vaults
          if (vaultAddresses.includes(addr)) {
            const count = (callCounts.get(addr) || 0) + 1;
            callCounts.set(addr, count);
            console.log(`  🔧 getVault for ${addr.slice(0, 10)}... call #${count}`);

            // Fail first call for each vault, succeed on retry
            if (count === 1) {
              throw new Error('RPC_ERROR: Connection refused');
            }
          }
          return realGetVault(addr, forceRefresh);
        });
      };

      // Start service - all 3 vaults should fail
      console.log('Starting service (expecting 3 concurrent failures)...');
      await service.start();

      // Verify all 3 are in failedVaults
      expect(service.failedVaults.has(vault1.vaultAddress)).toBe(true);
      expect(service.failedVaults.has(vault2.vaultAddress)).toBe(true);
      expect(service.failedVaults.has(vault3.vaultAddress)).toBe(true);
      expect(service.failedVaults.size).toBe(3);
      console.log(`🔍 All 3 vaults in failedVaults: ${service.failedVaults.size === 3}`);

      // Verify VaultFailed events for all 3
      expect(events.vaultFailed.length).toBe(3);
      expect(events.vaultFailed.some(e => e.vaultAddress === vault1.vaultAddress)).toBe(true);
      expect(events.vaultFailed.some(e => e.vaultAddress === vault2.vaultAddress)).toBe(true);
      expect(events.vaultFailed.some(e => e.vaultAddress === vault3.vaultAddress)).toBe(true);
      console.log(`🔍 VaultFailed events: ${events.vaultFailed.length}`);

      // Retry - all 3 should recover
      console.log('Triggering retry (expecting 3 recoveries)...');
      await service.retryFailedVaults();

      // Verify all 3 recovered
      expect(service.failedVaults.has(vault1.vaultAddress)).toBe(false);
      expect(service.failedVaults.has(vault2.vaultAddress)).toBe(false);
      expect(service.failedVaults.has(vault3.vaultAddress)).toBe(false);
      expect(service.failedVaults.size).toBe(0);
      console.log(`🔍 All 3 vaults recovered: ${service.failedVaults.size === 0}`);

      // Verify VaultRecovered events for all 3
      expect(events.vaultRecovered.length).toBe(3);
      expect(events.vaultRecovered.some(e => e.vaultAddress === vault1.vaultAddress)).toBe(true);
      expect(events.vaultRecovered.some(e => e.vaultAddress === vault2.vaultAddress)).toBe(true);
      expect(events.vaultRecovered.some(e => e.vaultAddress === vault3.vaultAddress)).toBe(true);
      console.log(`🔍 VaultRecovered events: ${events.vaultRecovered.length}`);

      // Verify all 3 are now tracked
      expect(service.vaultDataService.hasVault(vault1.vaultAddress)).toBe(true);
      expect(service.vaultDataService.hasVault(vault2.vaultAddress)).toBe(true);
      expect(service.vaultDataService.hasVault(vault3.vaultAddress)).toBe(true);
      console.log('🔍 All 3 vaults now tracked in vaultDataService');

      console.log('Multiple vault concurrent failures test passed');
    }, 120000);

    it('should handle mixed recovery outcomes independently', async () => {
      await createTestService(3122);

      const events = {
        vaultFailed: [],
        vaultRecovered: [],
        vaultBlacklisted: []
      };

      service.eventManager.subscribe('VaultFailed', (data) => {
        events.vaultFailed.push(data);
      });

      service.eventManager.subscribe('VaultRecovered', (data) => {
        events.vaultRecovered.push(data);
      });

      service.eventManager.subscribe('VaultBlacklisted', (data) => {
        console.log(`  [EVENT] VaultBlacklisted: ${data.vaultAddress?.slice(0, 10)}...`);
        events.vaultBlacklisted.push(data);
      });

      // Track call counts per vault
      const callCounts = new Map();
      const vaultAddresses = [vault1.vaultAddress, vault2.vaultAddress, vault3.vaultAddress];

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
        vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
          if (vaultAddresses.includes(addr)) {
            const count = (callCounts.get(addr) || 0) + 1;
            callCounts.set(addr, count);
            console.log(`  🔧 getVault for ${addr.slice(0, 10)}... call #${count}`);

            // Vault 1: fails first, recovers on retry
            if (addr === vault1.vaultAddress && count === 1) {
              throw new Error('RPC_ERROR: Connection refused');
            }

            // Vault 2: fails with unrecoverable error (immediate blacklist)
            if (addr === vault2.vaultAddress) {
              throw new UnrecoverableError('Invalid configuration');
            }

            // Vault 3: fails twice, recovers on 3rd attempt
            if (addr === vault3.vaultAddress && count <= 2) {
              throw new Error('TIMEOUT: Request timed out');
            }
          }
          return realGetVault(addr, forceRefresh);
        });
      };

      // Start service
      console.log('Starting service (mixed failure scenarios)...');
      await service.start();

      // Vault 1: in failedVaults (recoverable)
      // Vault 2: blacklisted (unrecoverable)
      // Vault 3: in failedVaults (recoverable)
      expect(service.failedVaults.has(vault1.vaultAddress)).toBe(true);
      expect(service.isVaultBlacklisted(vault2.vaultAddress)).toBe(true);
      expect(service.failedVaults.has(vault2.vaultAddress)).toBe(false);
      expect(service.failedVaults.has(vault3.vaultAddress)).toBe(true);
      console.log(`🔍 Vault 1 in failedVaults: ${service.failedVaults.has(vault1.vaultAddress)}`);
      console.log(`🔍 Vault 2 blacklisted: ${service.isVaultBlacklisted(vault2.vaultAddress)}`);
      console.log(`🔍 Vault 3 in failedVaults: ${service.failedVaults.has(vault3.vaultAddress)}`);

      // First retry - vault 1 recovers, vault 3 still fails
      console.log('Retry #1...');
      await service.retryFailedVaults();

      expect(service.failedVaults.has(vault1.vaultAddress)).toBe(false);
      expect(service.failedVaults.has(vault3.vaultAddress)).toBe(true);
      expect(events.vaultRecovered.some(e => e.vaultAddress === vault1.vaultAddress)).toBe(true);
      console.log(`🔍 Vault 1 recovered: ${!service.failedVaults.has(vault1.vaultAddress)}`);
      console.log(`🔍 Vault 3 still failing: ${service.failedVaults.has(vault3.vaultAddress)}`);

      // Second retry - vault 3 recovers
      console.log('Retry #2...');
      await service.retryFailedVaults();

      expect(service.failedVaults.has(vault3.vaultAddress)).toBe(false);
      expect(events.vaultRecovered.some(e => e.vaultAddress === vault3.vaultAddress)).toBe(true);
      console.log(`🔍 Vault 3 recovered: ${!service.failedVaults.has(vault3.vaultAddress)}`);

      // Final state
      expect(service.failedVaults.size).toBe(0);
      expect(service.vaultDataService.hasVault(vault1.vaultAddress)).toBe(true);
      expect(service.vaultDataService.hasVault(vault3.vaultAddress)).toBe(true);
      expect(service.isVaultBlacklisted(vault2.vaultAddress)).toBe(true);

      console.log('Mixed recovery outcomes test passed');
    }, 120000);
  });
});
