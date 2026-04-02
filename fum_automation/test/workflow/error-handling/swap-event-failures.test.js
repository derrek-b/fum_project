/**
 * @fileoverview Integration tests for swap event handling failures
 * Tests error handling at each stage of swap event processing:
 *
 * 1. Handler Phase - handleSwapEvent top-level failures
 *    - Vault retrieval failure (RPC error) → retry queue
 *    - Vault not found (unrecoverable) → blacklist
 *    - Strategy not found (unrecoverable) → blacklist
 *
 * 2. Evaluation Phase - strategy.handleSwapEvent failures before rebalance decision
 *    - Pool data cache miss → retry queue
 *    - evaluatePositionRange failure → retry queue
 *    - 0 positions / >1 positions / pool mismatch guards → retry queue
 *
 * 2b. Fee Collection Phase - receipt parsing fallback
 *    - parseCollectReceipt failure → falls back to pre-calculated fees, operation succeeds
 *
 * 3. Rebalance Execution Phase - failures during actual rebalance
 *    Uses close-to-boundary position + real swaps to trigger rebalance
 *    - closePositions failure → retry queue
 *    - createNewPosition sub-failures → retry queue
 *    - Recovery after rebalance failure
 *
 * 4. Fee Distribution Failure - graceful degradation
 *    - distributeFees failure → operation continues, fees stay in vault
 *    - FeeDistributionFailed event emitted
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { setupSwapWallet, executeSwap, configureStrategyParameters } from '../../helpers/swap-utils.js';
import { waitForCondition } from '../../helpers/wait-utils.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Handler and Evaluation Phase Tests
// Uses a simple centered position - just needs valid vault for swap events
// ============================================================================
describe('Swap Event Failures - Handler and Evaluation Phase', () => {
  let testEnv;
  let testConfig;
  let tempDir;
  let service;
  let testVault;
  let swapWallet;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create vault with centered position (aligned, no rebalance needed)
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Swap Handler Test Vault',
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
        tokenTransfers: {
          'WETH': 50,
          'USDC': 50
        },
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );

    console.log(`Handler test vault created at: ${testVault.vaultAddress}`);

    // Set up swap wallet for generating swap events
    swapWallet = await setupSwapWallet(testEnv, {
      ethAmount: '100',
      wethAmount: '50',
      usdcAmount: '20'
    });
  }, 120000);

  afterAll(async () => {
    await cleanupTestBlockchain(testEnv);
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    if (service) {
      try {
        // Always force stop to clean up all resources
        await service.stop(true);
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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'swap-fail-test-'));
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
      swapEventFailed: [],
      swapEventDetected: [],
      vaultFailed: [],
      vaultRecovered: [],
      vaultBlacklisted: []
    };

    service.eventManager.subscribe('SwapEventFailed', (data) => {
      console.log(`  [EVENT] SwapEventFailed: ${data.vaultAddress?.slice(0, 10)}... recoverable=${data.recoverable}`);
      events.swapEventFailed.push(data);
    });

    service.eventManager.subscribe('SwapEventDetected', (data) => {
      console.log(`  [EVENT] SwapEventDetected: pool=${data.poolId?.slice(0, 10)}...`);
      events.swapEventDetected.push(data);
    });

    service.eventManager.subscribe('VaultFailed', (data) => {
      console.log(`  [EVENT] VaultFailed: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultFailed.push(data);
    });

    service.eventManager.subscribe('VaultRecovered', (data) => {
      console.log(`  [EVENT] VaultRecovered: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultRecovered.push(data);
    });

    service.eventManager.subscribe('VaultBlacklisted', (data) => {
      console.log(`  [EVENT] VaultBlacklisted: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultBlacklisted.push(data);
    });

    return events;
  };

  /**
   * Helper to execute a swap and wait for event processing
   */
  const executeSwapAndWait = async (direction = 'wethToUsdc', waitMs = 2000) => {
    const wethAddress = swapWallet.wrappedNativeAddress;
    const usdcAddress = swapWallet.usdcAddress;
    const swapAmount = direction === 'wethToUsdc'
      ? ethers.utils.parseUnits('1', 18)  // 1 WETH
      : ethers.utils.parseUnits('1000', 6); // 1000 USDC

    await executeSwap(testEnv, {
      tokenIn: direction === 'wethToUsdc' ? wethAddress : usdcAddress,
      tokenOut: direction === 'wethToUsdc' ? usdcAddress : wethAddress,
      amountIn: swapAmount,
      fee: 500,
      wallet: swapWallet.wallet,
      slippage: 50
    });

    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, waitMs));
  };

  // ------------------------------------------------------------------------
  // Handler Phase: Vault Retrieval Failures
  // ------------------------------------------------------------------------
  describe('Handler Phase - Vault Retrieval', () => {
    it('should add vault to retry queue on RPC failure during vault retrieval', async () => {
      await createTestService(3200);
      const events = setupEventTracking(service);

      // Start service normally
      await service.start();

      // Verify vault is tracked (setup succeeded)
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);

      // Mock getVault to fail with network error AFTER service is running
      const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
        if (addr === testVault.vaultAddress) {
          throw new Error('NETWORK_ERROR: Connection refused');
        }
        return realGetVault(addr, forceRefresh);
      });

      // Execute swap to trigger handleSwapEvent
      console.log('Executing swap to trigger handleSwapEvent...');
      await executeSwapAndWait();

      // Verify vault was added to retry queue
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      console.log(`Vault in failedVaults: ${service.failedVaults.has(testVault.vaultAddress)}`);

      // Verify SwapEventFailed was emitted with recoverable=true
      const failEvent = events.swapEventFailed.find(e => e.vaultAddress === testVault.vaultAddress);
      expect(failEvent).toBeDefined();
      expect(failEvent.recoverable).toBe(true);
    }, 120000);

    it('should blacklist vault when vault not found (unrecoverable)', async () => {
      await createTestService(3201);
      const events = setupEventTracking(service);

      // Start service normally
      await service.start();

      // Mock getVault to return null (vault not found)
      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr) => {
        if (addr === testVault.vaultAddress) {
          return null;
        }
        return null;
      });

      // Execute swap
      console.log('Executing swap to trigger handleSwapEvent...');
      await executeSwapAndWait();

      // Verify vault was blacklisted (not in retry queue)
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
      console.log(`Vault blacklisted: ${service.isVaultBlacklisted(testVault.vaultAddress)}`);

      // Verify SwapEventFailed was emitted with recoverable=false
      const failEvent = events.swapEventFailed.find(e => e.vaultAddress === testVault.vaultAddress);
      expect(failEvent).toBeDefined();
      expect(failEvent.recoverable).toBe(false);
    }, 60000);
  });

  // ------------------------------------------------------------------------
  // Handler Phase: Strategy Lookup Failures
  // ------------------------------------------------------------------------
  describe('Handler Phase - Strategy Lookup', () => {
    it('should blacklist vault when strategy not found (unrecoverable)', async () => {
      await createTestService(3202);
      const events = setupEventTracking(service);

      // Start service normally
      await service.start();

      // Mock getVault to return vault with invalid strategy ID
      const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
        if (addr === testVault.vaultAddress) {
          const vault = await realGetVault(addr, forceRefresh);
          if (vault) {
            // Return vault with non-existent strategy
            return {
              ...vault,
              strategy: { ...vault.strategy, strategyId: 'nonexistent_strategy_xyz' }
            };
          }
        }
        return realGetVault(addr, forceRefresh);
      });

      // Execute swap
      console.log('Executing swap to trigger handleSwapEvent...');
      await executeSwapAndWait();

      // Verify vault was blacklisted
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);

      // Verify SwapEventFailed was emitted with recoverable=false
      const failEvent = events.swapEventFailed.find(e => e.vaultAddress === testVault.vaultAddress);
      expect(failEvent).toBeDefined();
      expect(failEvent.recoverable).toBe(false);
    }, 60000);
  });

  // ------------------------------------------------------------------------
  // Evaluation Phase: Strategy Internal Failures
  // ------------------------------------------------------------------------
  describe('Evaluation Phase - Strategy Internals', () => {
    it('should add vault to retry queue on pool data fetch failure', async () => {
      await createTestService(3203);
      const events = setupEventTracking(service);

      // Start service normally
      await service.start();

      // Get the strategy and mock evaluatePositionRange to throw network error
      const strategy = service.strategies.get('bob');
      const adapter = strategy.adapters.get('uniswapV3');

      vi.spyOn(adapter, 'evaluatePositionRange').mockImplementation(() => {
        throw new Error('NETWORK_ERROR: Failed to fetch pool data');
      });

      // Execute swap
      console.log('Executing swap to trigger handleSwapEvent...');
      await executeSwapAndWait();

      // Verify vault was added to retry queue (recoverable error)
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);

      // Verify SwapEventFailed was emitted with recoverable=true
      const failEvent = events.swapEventFailed.find(e => e.vaultAddress === testVault.vaultAddress);
      expect(failEvent).toBeDefined();
      expect(failEvent.recoverable).toBe(true);
    }, 60000);

    it('should add vault to retry queue when vault has 0 positions', async () => {
      await createTestService(3204);
      const events = setupEventTracking(service);

      await service.start();
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);

      // Mock getVault to return vault with no positions
      const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
        const vault = await realGetVault(addr, forceRefresh);
        if (vault && addr === testVault.vaultAddress) {
          return { ...vault, positions: {} };
        }
        return vault;
      });

      console.log('Executing swap to trigger handleSwapEvent (0 positions)...');
      await executeSwapAndWait();

      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);

      const failEvent = events.swapEventFailed.find(e => e.vaultAddress === testVault.vaultAddress);
      expect(failEvent).toBeDefined();
      expect(failEvent.recoverable).toBe(true);
    }, 60000);

    it('should add vault to retry queue when vault has more than 1 position', async () => {
      await createTestService(3205);
      const events = setupEventTracking(service);

      await service.start();
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);

      // Mock getVault to return vault with 2 positions
      const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
        const vault = await realGetVault(addr, forceRefresh);
        if (vault && addr === testVault.vaultAddress) {
          const existingPositions = { ...vault.positions };
          const existingId = Object.keys(existingPositions)[0];
          // Add a fake second position with the same pool
          existingPositions['fake-position-99'] = {
            ...existingPositions[existingId],
            id: 'fake-position-99'
          };
          return { ...vault, positions: existingPositions };
        }
        return vault;
      });

      console.log('Executing swap to trigger handleSwapEvent (2 positions)...');
      await executeSwapAndWait();

      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);

      const failEvent = events.swapEventFailed.find(e => e.vaultAddress === testVault.vaultAddress);
      expect(failEvent).toBeDefined();
      expect(failEvent.recoverable).toBe(true);
    }, 60000);

    it('should add vault to retry queue on pool mismatch between swap event and position', async () => {
      await createTestService(3206);
      const events = setupEventTracking(service);

      await service.start();
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);

      // Mock getVault to return vault with position pointing to a different pool
      const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
        const vault = await realGetVault(addr, forceRefresh);
        if (vault && addr === testVault.vaultAddress) {
          const positions = {};
          for (const [id, pos] of Object.entries(vault.positions)) {
            // Point position to a different pool address (simulates stale cache after pool change)
            positions[id] = { ...pos, pool: '0x0000000000000000000000000000000000000001' };
          }
          return { ...vault, positions };
        }
        return vault;
      });

      console.log('Executing swap to trigger handleSwapEvent (pool mismatch)...');
      await executeSwapAndWait();

      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);

      const failEvent = events.swapEventFailed.find(e => e.vaultAddress === testVault.vaultAddress);
      expect(failEvent).toBeDefined();
      expect(failEvent.recoverable).toBe(true);
    }, 60000);
  });

  // ------------------------------------------------------------------------
  // Fee Collection Phase: Receipt Parsing Fallback
  // When parseCollectReceipt fails, collectFees falls back to pre-calculated
  // fee amounts from getAccruedFeesUSD. The operation succeeds — no vault failure.
  // ------------------------------------------------------------------------
  describe('Fee Collection Phase - Receipt Parsing Fallback', () => {
    it('should collect fees using pre-calculated fallback when receipt parsing fails', async () => {
      // Configure strategy with low fee trigger so accrued fees exceed it
      await configureStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
        targetRangeUpper: 200,        // 2% range (wide to avoid rebalance)
        targetRangeLower: 200,
        emergencyExitTrigger: 500,    // 5%
        reinvestmentTrigger: 1,       // $0.01 (very low — any fees will trigger)
        reinvestmentRatio: 5000,      // 50%
        feeReinvestment: true
      });

      await createTestService(3207);

      // Track fee events
      const feesCollectedEvents = [];
      const vaultFailedEvents = [];

      service.eventManager.subscribe('FeesCollected', (data) => {
        if (data.vaultAddress === testVault.vaultAddress) {
          console.log(`  [EVENT] FeesCollected: $${data.totalUSD?.toFixed(4)}`);
          feesCollectedEvents.push(data);
        }
      });

      service.eventManager.subscribe('VaultFailed', (data) => {
        if (data.vaultAddress === testVault.vaultAddress) {
          vaultFailedEvents.push(data);
        }
      });

      await service.start();
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);

      // Mock parseCollectReceipt to fail — forces fallback to pre-calculated fees
      const strategy = service.strategies.get('bob');
      const adapter = strategy.adapters.get('uniswapV3');
      vi.spyOn(adapter, 'parseCollectReceipt').mockImplementation(() => {
        throw new Error('PARSE_ERROR: Unexpected log format in collect receipt');
      });

      // Set swap counter to 49 so the next swap triggers the fee check
      const normalizedAddress = service.vaultDataService.getAllVaults()
        .find(v => v.address === testVault.vaultAddress)?.address;
      strategy.swapCountSinceLastFeeCheck[normalizedAddress] = 49;

      // Execute one swap — pushes counter to 50, triggers fee check + collection
      console.log('Executing swap to trigger fee collection with parser fallback...');
      await executeSwapAndWait();

      // Wait for FeesCollected (the operation should succeed despite parse failure)
      await waitForCondition(
        () => feesCollectedEvents.length > 0,
        30000,
        500
      );

      // Fees should have been collected using pre-calculated fallback
      expect(feesCollectedEvents.length).toBe(1);
      const feeEvent = feesCollectedEvents[0];
      expect(feeEvent.source).toBe('swap_threshold');
      expect(feeEvent.totalUSD).toBeGreaterThan(0);
      expect(feeEvent.positionIds).toBeDefined();

      // Vault should NOT be in any error state — the fallback handled it gracefully
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);
      expect(vaultFailedEvents.length).toBe(0);

      console.log(`Fees collected via fallback: $${feeEvent.totalUSD.toFixed(4)}`);
    }, 120000);
  });
});

// ============================================================================
// Rebalance Execution Phase Tests
// Uses close-to-boundary position + real swaps to trigger rebalance
// Each test creates its own vault for proper isolation
// ============================================================================
describe('Swap Event Failures - Rebalance Execution Phase', () => {
  let testEnv;
  let testConfig;
  let tempDir;
  let service;
  let currentVault;  // Each test creates its own vault
  let swapWallet;
  let poolSnapshotId;  // Snapshot after swap wallet setup (clean pool state)

  beforeAll(async () => {
    // Create fresh blockchain instance for rebalance tests
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Set up swap wallet with funds for all tests
    // Use minimal USDC swap to avoid moving the pool too much
    console.log('Setting up swap wallet for rebalance tests...');
    swapWallet = await setupSwapWallet(testEnv, {
      ethAmount: '1000',
      wethAmount: '800',
      usdcAmount: '20'  // Minimal USDC swap
    });

    // Take snapshot after swap wallet setup - each test will revert to this
    // This ensures each test starts with a clean pool state
    poolSnapshotId = await testEnv.hardhatServer.takeSnapshot();
    console.log(`Pool snapshot taken: ${poolSnapshotId}`);
  }, 120000);

  afterAll(async () => {
    await cleanupTestBlockchain(testEnv);
  });

  beforeEach(async () => {
    // Revert to clean pool state before each test
    // This prevents pool degradation from accumulated swaps across tests
    if (poolSnapshotId) {
      await testEnv.hardhatServer.revertToSnapshot(poolSnapshotId);
      // Re-take snapshot (evm_revert consumes it)
      poolSnapshotId = await testEnv.hardhatServer.takeSnapshot();
      console.log(`Pool state reset, new snapshot: ${poolSnapshotId}`);
    }

    // Sync chain timestamp with real time — tests mine blocks rapidly (each +1s),
    // advancing chain time past wall-clock. Swap deadlines use Date.now() and
    // expire if the chain timestamp drifts too far ahead.
    const provider = testEnv.hardhatServer.provider;
    const currentBlock = await provider.getBlock('latest');
    const nextTimestamp = Math.max(Math.floor(Date.now() / 1000), currentBlock.timestamp) + 1;
    await provider.send('evm_setNextBlockTimestamp', [nextTimestamp]);
    await provider.send('evm_mine', []);
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    if (service) {
      try {
        // Always force stop to clean up all resources
        await service.stop(true);
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

    currentVault = null;
  });

  /**
   * Helper to create a fresh vault for each test
   * This ensures each test starts with a position at ~9% centeredness
   */
  const createFreshVault = async (vaultName) => {
    const vault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName,
        wrapEthAmount: '10',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '2' }
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 60,
            tickRange: {
              type: 'close-to-boundary',
              spacing: 10
            }
          }
        ],
        tokenTransfers: {
          'WETH': 50,
          'USDC': 50
        },
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );
    console.log(`Created fresh vault: ${vault.vaultAddress}`);
    return vault;
  };

  /**
   * Helper to create temp directory for test isolation
   */
  const createTempDir = async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rebalance-fail-test-'));
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
      retryIntervalMs: 999999999
    });

    return { service, dir, blacklistPath: service.blacklistFilePath, trackingDir: service.trackingDataDir };
  };

  /**
   * Helper to set up event tracking for rebalance tests
   */
  const setupRebalanceEventTracking = (service) => {
    const events = {
      swapEventFailed: [],
      positionRebalanced: [],
      rebalanceFailed: [],
      vaultFailed: [],
      vaultRecovered: []
    };

    service.eventManager.subscribe('SwapEventFailed', (data) => {
      console.log(`  [EVENT] SwapEventFailed: ${data.vaultAddress?.slice(0, 10)}...`);
      events.swapEventFailed.push(data);
    });

    service.eventManager.subscribe('PositionRebalanced', (data) => {
      console.log(`  [EVENT] PositionRebalanced: ${data.vaultAddress?.slice(0, 10)}...`);
      events.positionRebalanced.push(data);
    });

    service.eventManager.subscribe('RebalanceFailed', (data) => {
      console.log(`  [EVENT] RebalanceFailed: ${data.vaultAddress?.slice(0, 10)}...`);
      events.rebalanceFailed.push(data);
    });

    service.eventManager.subscribe('VaultFailed', (data) => {
      console.log(`  [EVENT] VaultFailed: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultFailed.push(data);
    });

    service.eventManager.subscribe('VaultRecovered', (data) => {
      console.log(`  [EVENT] VaultRecovered: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultRecovered.push(data);
    });

    return events;
  };

  /**
   * Execute swaps until rebalance is triggered or max swaps reached
   * Swaps WETH -> USDC to push tick down (toward lower boundary)
   * @param {Object} events - Event tracking object
   * @param {Object} vault - The vault to watch for events
   * @param {number} maxSwaps - Maximum number of swaps to attempt
   * @returns {Promise<{swapCount: number, rebalanceTriggered: boolean}>}
   */
  const executeSwapsUntilRebalance = async (events, vault, maxSwaps = 20) => {
    const wethAddress = swapWallet.wrappedNativeAddress;
    const usdcAddress = swapWallet.usdcAddress;
    const swapAmount = ethers.utils.parseUnits('15', 18); // 15 WETH per swap

    console.log(`Executing swaps to push position out of range for vault ${vault.vaultAddress.slice(0, 10)}...`);

    for (let i = 0; i < maxSwaps; i++) {
      // Check if we got a rebalance or failure event for THIS vault
      const hasRebalanceEvent = events.positionRebalanced.some(e => e.vaultAddress === vault.vaultAddress);
      const hasFailEvent = events.swapEventFailed.some(e => e.vaultAddress === vault.vaultAddress);
      const hasRebalanceFailEvent = events.rebalanceFailed.some(e => e.vaultAddress === vault.vaultAddress);

      if (hasRebalanceEvent || hasFailEvent || hasRebalanceFailEvent) {
        console.log(`  🎯 Event triggered after ${i + 1} swaps`);
        return { swapCount: i + 1, rebalanceTriggered: true };
      }

      try {
        await executeSwap(testEnv, {
          tokenIn: wethAddress,
          tokenOut: usdcAddress,
          amountIn: swapAmount,
          fee: 500,
          wallet: swapWallet.wallet,
          slippage: 100
        });
        console.log(`  Swap ${i + 1} executed`);

        // Wait for event processing
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log(`  Swap ${i + 1} failed: ${error.message.slice(0, 50)}`);
        // May have run out of tokens, check if rebalance triggered for this vault
        const hasFailEventAfter = events.swapEventFailed.some(e => e.vaultAddress === vault.vaultAddress);
        if (hasFailEventAfter) {
          return { swapCount: i + 1, rebalanceTriggered: true };
        }
        break;
      }
    }

    // Final check
    const hasRebalanceEvent = events.positionRebalanced.some(e => e.vaultAddress === vault.vaultAddress);
    const hasFailEvent = events.swapEventFailed.some(e => e.vaultAddress === vault.vaultAddress);

    return {
      swapCount: maxSwaps,
      rebalanceTriggered: hasRebalanceEvent || hasFailEvent
    };
  };

  // ------------------------------------------------------------------------
  // Rebalance Execution: closePositions Failure
  // ------------------------------------------------------------------------
  describe('Rebalance Execution - closePositions Failure', () => {
    it('should add vault to retry queue when closePositions fails during rebalance', async () => {
      // Create fresh vault for this test
      currentVault = await createFreshVault('ClosePositions Failure Test');

      await createTestService(3210);
      const events = setupRebalanceEventTracking(service);

      // Start service
      await service.start();

      // Verify vault is tracked (setup succeeded)
      expect(service.vaultDataService.hasVault(currentVault.vaultAddress)).toBe(true);

      // Get the strategy and mock closePositions to fail
      const strategy = service.strategies.get('bob');
      vi.spyOn(strategy, 'closePositions').mockImplementation(async () => {
        throw new Error('NETWORK_ERROR: Transaction failed - nonce too low');
      });

      // Execute swaps until rebalance is triggered
      const result = await executeSwapsUntilRebalance(events, currentVault);
      console.log(`Swaps executed: ${result.swapCount}, triggered: ${result.rebalanceTriggered}`);

      // Wait a bit more for event processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify vault was added to retry queue (recoverable error)
      expect(service.failedVaults.has(currentVault.vaultAddress)).toBe(true);
      expect(service.isVaultBlacklisted(currentVault.vaultAddress)).toBe(false);

      // Verify failure event was emitted
      const failEvent = events.swapEventFailed.find(e => e.vaultAddress === currentVault.vaultAddress);
      expect(failEvent).toBeDefined();
      expect(failEvent.recoverable).toBe(true);
    }, 180000);
  });

  // ------------------------------------------------------------------------
  // Rebalance Execution: createNewPosition Failure
  // ------------------------------------------------------------------------
  describe('Rebalance Execution - createNewPosition Failure', () => {
    it('should add vault to retry queue when createNewPosition fails during rebalance', async () => {
      // Create fresh vault for this test
      currentVault = await createFreshVault('CreateNewPosition Failure Test');

      await createTestService(3211);
      const events = setupRebalanceEventTracking(service);

      // Start service
      await service.start();

      // Verify vault is tracked (setup succeeded)
      expect(service.vaultDataService.hasVault(currentVault.vaultAddress)).toBe(true);

      // Get the strategy and mock createNewPosition to fail
      // closePositions will succeed, but createNewPosition will fail
      const strategy = service.strategies.get('bob');
      vi.spyOn(strategy, 'createNewPosition').mockImplementation(async () => {
        throw new Error('NETWORK_ERROR: getAddLiquidityAmounts failed - RPC timeout');
      });

      // Execute swaps until rebalance is triggered
      const result = await executeSwapsUntilRebalance(events, currentVault);
      console.log(`Swaps executed: ${result.swapCount}, triggered: ${result.rebalanceTriggered}`);

      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify vault was added to retry queue
      expect(service.failedVaults.has(currentVault.vaultAddress)).toBe(true);
      expect(service.isVaultBlacklisted(currentVault.vaultAddress)).toBe(false);

      // Verify failure event
      const failEvent = events.swapEventFailed.find(e => e.vaultAddress === currentVault.vaultAddress);
      expect(failEvent).toBeDefined();
      expect(failEvent.recoverable).toBe(true);
    }, 180000);
  });

  // ------------------------------------------------------------------------
  // Rebalance Execution: Recovery after failure
  // ------------------------------------------------------------------------
  describe('Rebalance Execution - Recovery', () => {
    it('should recover vault after rebalance failure is fixed', async () => {
      // Create fresh vault for this test
      currentVault = await createFreshVault('Recovery Test');

      await createTestService(3212);
      const events = setupRebalanceEventTracking(service);

      let closePositionsCallCount = 0;

      // Start service
      await service.start();

      // Verify vault is tracked (setup succeeded)
      expect(service.vaultDataService.hasVault(currentVault.vaultAddress)).toBe(true);

      // Get the strategy and mock closePositions to fail once, then succeed
      const strategy = service.strategies.get('bob');
      const realClosePositions = strategy.closePositions.bind(strategy);
      vi.spyOn(strategy, 'closePositions').mockImplementation(async (...args) => {
        closePositionsCallCount++;
        if (closePositionsCallCount === 1) {
          console.log(`  [MOCK] closePositions call #${closePositionsCallCount} - FAILING`);
          throw new Error('NETWORK_ERROR: Transaction failed');
        }
        console.log(`  [MOCK] closePositions call #${closePositionsCallCount} - succeeding`);
        return realClosePositions(...args);
      });

      // Execute swaps until rebalance is triggered (and fails)
      const result = await executeSwapsUntilRebalance(events, currentVault);
      console.log(`Swaps executed: ${result.swapCount}`);

      // Wait for failure processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify vault is in retry queue
      expect(service.failedVaults.has(currentVault.vaultAddress)).toBe(true);
      console.log(`Vault in failedVaults after failure: ${service.failedVaults.has(currentVault.vaultAddress)}`);

      // Trigger retry - should recover (re-setup the vault)
      console.log('Triggering retry for recovery...');
      await service.retryFailedVaults();

      // Wait for recovery processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify vault recovered
      expect(service.failedVaults.has(currentVault.vaultAddress)).toBe(false);
      expect(service.isVaultBlacklisted(currentVault.vaultAddress)).toBe(false);

      // Verify VaultRecovered event
      const recoveredEvent = events.vaultRecovered.find(e => e.vaultAddress === currentVault.vaultAddress);
      expect(recoveredEvent).toBeDefined();
    }, 240000);
  });

  // ------------------------------------------------------------------------
  // Fee Distribution Failure - operation continues, fees stay in vault
  // ------------------------------------------------------------------------
  describe('Fee Distribution Failure', () => {
    it('should continue rebalance operation when fee distribution fails', async () => {
      // Create fresh vault for this test
      currentVault = await createFreshVault('Fee Distribution Failure Test');

      await createTestService(3213);

      // Use standard event tracking helper
      const events = setupRebalanceEventTracking(service);

      // Add fee-specific event tracking
      const feeEvents = {
        feesCollected: [],
        feesDistributed: [],
        feeDistributionFailed: []
      };

      service.eventManager.subscribe('FeesCollected', (data) => {
        if (data.vaultAddress === currentVault.vaultAddress) {
          console.log(`  [EVENT] FeesCollected: $${data.totalUSD?.toFixed(2)}`);
          feeEvents.feesCollected.push(data);
        }
      });

      service.eventManager.subscribe('FeesDistributed', (data) => {
        if (data.vaultAddress === currentVault.vaultAddress) {
          console.log(`  [EVENT] FeesDistributed: $${data.totalDistributedUSD?.toFixed(2)}`);
          feeEvents.feesDistributed.push(data);
        }
      });

      service.eventManager.subscribe('FeeDistributionFailed', (data) => {
        if (data.vaultAddress === currentVault.vaultAddress) {
          console.log(`  [EVENT] FeeDistributionFailed: ${data.error}`);
          feeEvents.feeDistributionFailed.push(data);
        }
      });

      // Start service
      await service.start();

      // Verify vault is tracked
      expect(service.vaultDataService.hasVault(currentVault.vaultAddress)).toBe(true);

      // Mock distributeFees to fail
      const strategy = service.strategies.get('bob');
      vi.spyOn(strategy, 'distributeFees').mockImplementation(async () => {
        throw new Error('NETWORK_ERROR: Failed to send tokens to owner');
      });

      // Execute swaps until rebalance is triggered
      const result = await executeSwapsUntilRebalance(events, currentVault);
      console.log(`Swaps executed: ${result.swapCount}`);

      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // If rebalance was triggered, verify fee distribution failure was handled gracefully
      if (events.positionRebalanced.length > 0) {
        // Rebalance completed despite fee distribution failure
        console.log('Rebalance completed successfully despite fee distribution failure');

        // Vault should NOT be in retry queue (operation succeeded)
        expect(service.failedVaults.has(currentVault.vaultAddress)).toBe(false);
        expect(service.isVaultBlacklisted(currentVault.vaultAddress)).toBe(false);

        // If fees were collected, we should see the failure event
        if (feeEvents.feesCollected.length > 0) {
          expect(feeEvents.feeDistributionFailed.length).toBeGreaterThan(0);
          expect(feeEvents.feesDistributed.length).toBe(0); // No successful distribution
        }
      } else {
        // No rebalance triggered - verify vault is still healthy
        expect(service.failedVaults.has(currentVault.vaultAddress)).toBe(false);
        console.log('No rebalance triggered during test - vault remains healthy');
      }

      console.log('Fee distribution failure test passed');
    }, 180000);

  });

  // ------------------------------------------------------------------------
  // Rebalance Execution: Listener Refresh Failure
  // The rebalance itself succeeds (position closed + new one created) but
  // the post-rebalance refreshSwapListeners call fails, leaving the vault
  // unable to receive future swap events. Vault goes to retry queue.
  // ------------------------------------------------------------------------
  describe('Rebalance Execution - Listener Refresh Failure', () => {
    it('should add vault to retry queue when refreshSwapListeners fails after rebalance', async () => {
      currentVault = await createFreshVault('Listener Refresh Failure Test');

      await createTestService(3214);
      const events = setupRebalanceEventTracking(service);

      await service.start();
      expect(service.vaultDataService.hasVault(currentVault.vaultAddress)).toBe(true);

      // Mock refreshSwapListeners to fail — simulates RPC failure during re-subscription
      vi.spyOn(service.eventManager, 'refreshSwapListeners').mockImplementation(async () => {
        throw new Error('NETWORK_ERROR: eth_subscribe failed');
      });

      // Execute swaps to trigger rebalance
      const result = await executeSwapsUntilRebalance(events, currentVault);
      console.log(`Swaps executed: ${result.swapCount}`);

      // Rebalance should have completed (the on-chain operations succeeded)
      await waitForCondition(
        () => events.positionRebalanced.some(e => e.vaultAddress === currentVault.vaultAddress),
        60000,
        1000
      );
      expect(events.positionRebalanced.length).toBeGreaterThan(0);

      // The PositionRebalanced handler runs async (emit doesn't await).
      // retryWithBackoff does 2 retries with exponential backoff (1s, 2s) before
      // calling trackFailedVault. Wait for the VaultFailed event directly —
      // failedVaults.set() happens before removeAllVaultListeners() completes
      // and VaultFailed is emitted, so waiting on failedVaults.has() is too early.
      await waitForCondition(
        () => events.vaultFailed.some(
          e => e.vaultAddress === currentVault.vaultAddress && e.source === 'listener_refresh'
        ),
        30000,
        500
      );

      // Vault should be in retry queue (not blacklisted — this is a recoverable error)
      expect(service.failedVaults.has(currentVault.vaultAddress)).toBe(true);
      expect(service.isVaultBlacklisted(currentVault.vaultAddress)).toBe(false);

      // Restore real method and trigger recovery
      vi.restoreAllMocks();
      await service.retryFailedVaults();

      // Wait for recovery
      await waitForCondition(
        () => !service.failedVaults.has(currentVault.vaultAddress),
        60000,
        1000
      );

      // Vault should have recovered
      expect(service.failedVaults.has(currentVault.vaultAddress)).toBe(false);
      expect(service.isVaultBlacklisted(currentVault.vaultAddress)).toBe(false);

      const recoveredEvent = events.vaultRecovered.find(e => e.vaultAddress === currentVault.vaultAddress);
      expect(recoveredEvent).toBeDefined();

      // Swap listeners should be re-established after recovery
      const vault = await service.vaultDataService.getVault(currentVault.vaultAddress);
      const position = Object.values(vault.positions)[0];
      const poolAddress = position.pool;
      const swapListenerKey = `${poolAddress.toLowerCase()}-swap-1337-uniswapV3`;
      expect(service.eventManager.listeners[swapListenerKey]).toBeDefined();
      expect(service.eventManager.poolToVaults[poolAddress]).toContain(currentVault.vaultAddress);

      console.log('Listener refresh failure test passed');
    }, 240000);
  });
});
