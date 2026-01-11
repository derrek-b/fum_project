/**
 * @fileoverview Integration tests for config update failure handling
 *
 * Tests failure scenarios when vault/strategy config changes fail to process:
 *
 * 1. Vault Config Failures
 *    - TargetTokensUpdated event handler fails → ConfigUpdateFailed → vault tracked for retry
 *    - TargetPlatformsUpdated event handler fails → ConfigUpdateFailed → vault tracked for retry
 *
 * 2. Strategy Parameter Failures
 *    - ParameterUpdated event handler fails → StrategyParameterUpdateFailed → vault tracked for retry
 *
 * 3. Handler Cascade Failures
 *    - ConfigUpdateFailed handler itself fails → emergencyVaultCleanup → vault blacklisted
 *    - StrategyParameterUpdateFailed handler itself fails → emergencyVaultCleanup → vault blacklisted
 *
 * Note: Uses EVM snapshots to reset vault state between tests for isolation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { waitForCondition } from '../../helpers/wait-utils.js';
import { ethers } from 'ethers';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('Config Update Failures', () => {
  let testEnv;
  let testConfig;
  let tempDir;
  let service;
  let testVault;
  let vaultSnapshot;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create ONE vault for all tests
    console.log('Creating test vault...');
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Config Update Test Vault',
        automationServiceAddress: testConfig.automationServiceAddress,
        wrapEthAmount: '5',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '1' }
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 50,
            tickRange: {
              type: 'centered',
              spacing: 10
            }
          }
        ],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );
    console.log(`Test vault created at: ${testVault.vaultAddress}`);

    // Take snapshot AFTER vault creation - this is our clean state
    vaultSnapshot = await testEnv.hardhatServer.provider.send('evm_snapshot', []);
    console.log(`Vault snapshot taken: ${vaultSnapshot}`);
  }, 180000);

  afterAll(async () => {
    await cleanupTestBlockchain(testEnv);
  });

  beforeEach(async () => {
    // Revert to clean vault state before each test
    await testEnv.hardhatServer.provider.send('evm_revert', [vaultSnapshot]);
    // Re-take snapshot (evm_revert consumes it)
    vaultSnapshot = await testEnv.hardhatServer.provider.send('evm_snapshot', []);
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    if (service) {
      try {
        if (service.isRunning) {
          await service.stop();
        } else if (service.provider) {
          await service.stop(true);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
      service = null;
    }

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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
    return tempDir;
  };

  /**
   * Helper to create a service with standard test config
   */
  const createTestService = async (ssePort) => {
    const dir = await createTempDir();
    const blacklistPath = path.join(dir, 'blacklist.json');
    const trackingDir = path.join(dir, 'vaults');

    service = new AutomationService({
      automationServiceAddress: testConfig.automationServiceAddress,
      chainId: 1337,
      wsUrl: testConfig.wsUrl,
      blacklistFilePath: blacklistPath,
      trackingDataDir: trackingDir,
      ssePort,
      debug: true,
      retryIntervalMs: 999999999  // Effectively disabled
    });

    return { service, dir, blacklistPath, trackingDir };
  };

  /**
   * Helper to set up event tracking
   */
  const setupEventTracking = (service) => {
    const events = {
      configUpdateFailed: [],
      strategyParamUpdateFailed: [],
      vaultFailed: [],
      vaultBlacklisted: []
    };

    service.eventManager.subscribe('ConfigUpdateFailed', (data) => {
      console.log(`  [EVENT] ConfigUpdateFailed: ${data.vaultAddress?.slice(0, 10)}... - ${data.configType}`);
      events.configUpdateFailed.push(data);
    });

    service.eventManager.subscribe('StrategyParameterUpdateFailed', (data) => {
      console.log(`  [EVENT] StrategyParameterUpdateFailed: ${data.vaultAddress?.slice(0, 10)}...`);
      events.strategyParamUpdateFailed.push(data);
    });

    service.eventManager.subscribe('VaultFailed', (data) => {
      console.log(`  [EVENT] VaultFailed: ${data.vaultAddress?.slice(0, 10)}... - ${data.source}`);
      events.vaultFailed.push(data);
    });

    service.eventManager.subscribe('VaultBlacklisted', (data) => {
      console.log(`  [EVENT] VaultBlacklisted: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultBlacklisted.push(data);
    });

    return events;
  };

  // ============================================================================
  // Vault Config Failures
  // ============================================================================
  describe('Vault Config Failures', () => {
    it('should track vault for retry when TargetTokensUpdated handler fails', async () => {
      await createTestService(3401);
      const events = setupEventTracking(service);

      // Start service and wait for vault to load
      await service.start();
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress),
        30000,
        500
      );
      console.log('Service started and vault loaded');

      // Mock getVault to fail on forceRefresh (cache refresh after config event)
      const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
      let refreshCallCount = 0;
      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
        if (addr.toLowerCase() === testVault.vaultAddress.toLowerCase() && forceRefresh) {
          refreshCallCount++;
          console.log(`  [MOCK] getVault with forceRefresh=true, call #${refreshCallCount} - FAILING`);
          throw new Error('NETWORK_ERROR: RPC connection failed during cache refresh');
        }
        return realGetVault(addr, forceRefresh);
      });

      // Trigger real TargetTokensUpdated event by changing target tokens
      console.log('Triggering TargetTokensUpdated event...');
      const newTargetTokens = ['WETH']; // Change from ['USDC', 'WETH'] to just ['WETH']
      const setTokensTx = await testVault.vault.setTargetTokens(newTargetTokens);
      await setTokensTx.wait();
      console.log('setTargetTokens transaction confirmed');

      // Wait for ConfigUpdateFailed event
      await waitForCondition(
        () => events.configUpdateFailed.length > 0,
        15000,
        500
      );

      // Verify ConfigUpdateFailed was emitted
      expect(events.configUpdateFailed.length).toBe(1);
      expect(events.configUpdateFailed[0].vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(events.configUpdateFailed[0].configType).toBe('targetTokens');

      // Verify VaultFailed was emitted (from trackFailedVault)
      await waitForCondition(
        () => events.vaultFailed.length > 0,
        5000,
        500
      );
      expect(events.vaultFailed.length).toBe(1);
      expect(events.vaultFailed[0].source).toBe('config_update');

      // Verify vault is in failedVaults
      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);
      expect(service.failedVaults.has(normalizedAddress)).toBe(true);

      // Verify vault is NOT blacklisted (recoverable error)
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);

      console.log('TargetTokensUpdated failure test passed');
    }, 90000);

    it('should track vault for retry when TargetPlatformsUpdated handler fails', async () => {
      await createTestService(3402);
      const events = setupEventTracking(service);

      // Start service and wait for vault to load
      await service.start();
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress),
        30000,
        500
      );
      console.log('Service started and vault loaded');

      // Mock getVault to fail on forceRefresh
      const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
        if (addr.toLowerCase() === testVault.vaultAddress.toLowerCase() && forceRefresh) {
          console.log('  [MOCK] getVault with forceRefresh=true - FAILING');
          throw new Error('NETWORK_ERROR: Provider timeout during cache refresh');
        }
        return realGetVault(addr, forceRefresh);
      });

      // Trigger real TargetPlatformsUpdated event by changing to different platforms
      console.log('Triggering TargetPlatformsUpdated event...');
      const setTx = await testVault.vault.setTargetPlatforms([]);
      await setTx.wait();
      console.log('setTargetPlatforms transaction confirmed');

      // Wait for ConfigUpdateFailed event
      await waitForCondition(
        () => events.configUpdateFailed.length > 0,
        15000,
        500
      );

      // Verify ConfigUpdateFailed was emitted with correct configType
      expect(events.configUpdateFailed.length).toBe(1);
      expect(events.configUpdateFailed[0].configType).toBe('targetPlatforms');

      // Verify vault is in failedVaults
      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);
      expect(service.failedVaults.has(normalizedAddress)).toBe(true);

      console.log('TargetPlatformsUpdated failure test passed');
    }, 90000);
  });

  // ============================================================================
  // Strategy Parameter Failures
  // ============================================================================
  describe('Strategy Parameter Failures', () => {
    it('should track vault for retry when ParameterUpdated handler fails', async () => {
      await createTestService(3403);

      // Start service and wait for vault to be FULLY set up
      await service.start();

      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress) &&
              !service.failedVaults.has(normalizedAddress),
        45000,
        500
      );
      console.log('Service started and vault fully loaded');

      // Set up event tracking AFTER initial setup complete
      const events = setupEventTracking(service);

      // Mock getVault to fail on forceRefresh
      const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
        if (addr.toLowerCase() === testVault.vaultAddress.toLowerCase() && forceRefresh) {
          console.log('  [MOCK] getVault with forceRefresh=true - FAILING');
          throw new Error('NETWORK_ERROR: WebSocket disconnected during cache refresh');
        }
        return realGetVault(addr, forceRefresh);
      });

      // Authorize vault with strategy contract first (required for parameter updates)
      const babyStepsStrategyAddress = testEnv.deployedContracts.BabyStepsStrategy;
      const strategyContract = new ethers.Contract(
        babyStepsStrategyAddress,
        ['function authorizeVault(address vault) external'],
        testEnv.hardhatServer.signers[0]
      );
      const authTx = await strategyContract.authorizeVault(testVault.vaultAddress);
      await authTx.wait();
      console.log('Vault authorized with strategy contract');

      // Trigger real ParameterUpdated event by changing strategy parameters
      console.log('Triggering ParameterUpdated event...');

      const strategyInterface = new ethers.utils.Interface([
        'function setRangeParameters(uint16 upperRange, uint16 lowerRange) external'
      ]);

      // Change range parameters (this emits ParameterUpdated event)
      const setRangeData = strategyInterface.encodeFunctionData('setRangeParameters', [
        50,  // New upper range (0.5%)
        50   // New lower range (0.5%)
      ]);

      const executeTx = await testVault.vault.execute(
        [babyStepsStrategyAddress],
        [setRangeData]
      );
      await executeTx.wait();
      console.log('Strategy parameter update transaction confirmed');

      // Wait for StrategyParameterUpdateFailed event
      await waitForCondition(
        () => events.strategyParamUpdateFailed.length > 0,
        15000,
        500
      );

      // Verify StrategyParameterUpdateFailed was emitted
      expect(events.strategyParamUpdateFailed.length).toBeGreaterThan(0);
      expect(events.strategyParamUpdateFailed[0].vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());

      // Verify VaultFailed was emitted
      await waitForCondition(
        () => events.vaultFailed.length > 0,
        5000,
        500
      );
      expect(events.vaultFailed[0].source).toBe('strategy_param_update');

      expect(service.failedVaults.has(normalizedAddress)).toBe(true);

      console.log('ParameterUpdated failure test passed');
    }, 90000);
  });

  // ============================================================================
  // Handler Cascade Failures (handler itself fails)
  // ============================================================================
  describe('Handler Cascade Failures', () => {
    it('should emergency blacklist and release lock when ConfigUpdateFailed handler itself fails', async () => {
      await createTestService(3404);

      // Start service and wait for vault to be FULLY set up
      await service.start();

      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress) &&
              !service.failedVaults.has(normalizedAddress),
        45000,
        500
      );
      console.log('Service started and vault fully loaded');

      // Set up event tracking AFTER initial setup complete
      const events = setupEventTracking(service);

      // Manually lock the vault to simulate concurrent operation
      console.log('Locking vault to test lock release during emergency cleanup...');
      const lockAcquired = service.lockVault(normalizedAddress);
      expect(lockAcquired).toBe(true);
      expect(service.vaultLocks[normalizedAddress]).toBeDefined();

      // Mock trackFailedVault to throw (simulating handler failure)
      vi.spyOn(service, 'trackFailedVault').mockImplementation(async () => {
        console.log('  [MOCK] trackFailedVault - THROWING');
        throw new Error('Database write failed');
      });

      // Spy on emergencyVaultCleanup
      const emergencyCleanupSpy = vi.spyOn(service, 'emergencyVaultCleanup');

      // Emit ConfigUpdateFailed directly (simpler than triggering real event + cache failure)
      console.log('Emitting ConfigUpdateFailed event...');
      service.eventManager.emit('ConfigUpdateFailed', {
        vaultAddress: testVault.vaultAddress,
        configType: 'targetTokens',
        error: 'Simulated cache refresh failure'
      });

      // Wait for emergencyVaultCleanup to be called
      await waitForCondition(
        () => emergencyCleanupSpy.mock.calls.length > 0,
        10000,
        500
      );

      // Verify emergencyVaultCleanup was called
      expect(emergencyCleanupSpy).toHaveBeenCalledWith(
        testVault.vaultAddress,
        expect.stringContaining('ConfigUpdateFailed handler error')
      );

      // Wait for VaultBlacklisted event
      await waitForCondition(
        () => events.vaultBlacklisted.length > 0,
        5000,
        500
      );

      // Verify vault is blacklisted
      expect(events.vaultBlacklisted.length).toBe(1);
      expect(events.vaultBlacklisted[0].emergency).toBe(true);
      expect(events.vaultBlacklisted[0].cleanupResults.lockReleased).toBe(true);
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);

      // Verify lock was released
      expect(service.vaultLocks[normalizedAddress]).toBeUndefined();
      console.log('Lock was released during emergency cleanup');

      console.log('ConfigUpdateFailed cascade failure test passed');
    }, 90000);

    it('should emergency blacklist when StrategyParameterUpdateFailed handler itself fails', async () => {
      // Use a synthetic vault address for this test (doesn't need real vault)
      const syntheticVaultAddress = '0x1234567890123456789012345678901234567890';

      await createTestService(3405);
      const events = setupEventTracking(service);

      // Start service (don't need to wait for specific vault since we're using synthetic address)
      await service.start();
      console.log('Service started');

      // Mock trackFailedVault to throw
      vi.spyOn(service, 'trackFailedVault').mockImplementation(async () => {
        console.log('  [MOCK] trackFailedVault - THROWING');
        throw new Error('Filesystem error');
      });

      // Spy on emergencyVaultCleanup
      const emergencyCleanupSpy = vi.spyOn(service, 'emergencyVaultCleanup');

      // Emit StrategyParameterUpdateFailed directly
      console.log('Emitting StrategyParameterUpdateFailed event...');
      service.eventManager.emit('StrategyParameterUpdateFailed', {
        vaultAddress: syntheticVaultAddress,
        paramName: 'targetRangeUpper',
        error: 'Simulated cache refresh failure'
      });

      // Wait for emergencyVaultCleanup to be called
      await waitForCondition(
        () => emergencyCleanupSpy.mock.calls.length > 0,
        10000,
        500
      );

      // Verify emergencyVaultCleanup was called with correct reason
      expect(emergencyCleanupSpy).toHaveBeenCalledWith(
        syntheticVaultAddress,
        expect.stringContaining('StrategyParameterUpdateFailed handler error')
      );

      // Wait for VaultBlacklisted event
      await waitForCondition(
        () => events.vaultBlacklisted.length > 0,
        5000,
        500
      );

      // Verify vault is blacklisted with emergency flag
      expect(events.vaultBlacklisted.length).toBe(1);
      expect(events.vaultBlacklisted[0].emergency).toBe(true);

      console.log('StrategyParameterUpdateFailed cascade failure test passed');
    }, 60000);
  });
});
