/**
 * @fileoverview Test emergency exit scenarios when price moves beyond trigger threshold
 *
 * Emergency exit triggers vault blacklisting WITHOUT closing positions.
 * Positions are preserved for manual review by the vault owner.
 *
 * Test scenarios:
 * 1. Swap Event Trigger - Price moves beyond threshold during normal swap event processing
 * 2. Retry Scenario Trigger - Price moves beyond threshold while vault is in retry queue,
 *    detected when retry attempts to re-initialize the vault
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import {
  setupSwapWallet,
  executeSwap,
  configureStrategyParameters,
  getTokenAddressForTest
} from '../../helpers/swap-utils.js';
import { waitForCondition } from '../../helpers/wait-utils.js';
import { ethers } from 'ethers';
import { UniswapV3Adapter } from 'fum_library/adapters';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// Mock getPoolTVLAverage to ensure 500 bps pool is always selected
vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    getPoolTVLAverage: vi.fn().mockImplementation((poolAddress) => {
      const address = poolAddress.toLowerCase();
      // WETH/USDC 500 bps pool on Arbitrum - highest TVL
      if (address === '0xc6962004f452be9203591991d15f6b388e09e8d0') {
        return Promise.resolve(100000000); // $100M
      }
      return Promise.resolve(10000000); // $10M
    })
  };
});

// ============================================================================
// Swap Event Trigger - Emergency exit during normal swap event processing
// ============================================================================
describe('Emergency Exit - Swap Event Trigger', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;
  let adapter;

  beforeAll(async () => {
    // Setup blockchain
    testEnv = await setupTestBlockchain();
    console.log('Test blockchain connected');

    // Setup swap wallet with massive capital for emergency trigger
    console.log('Setting up swap wallet with large reserves...');
    const swapSetup = await setupSwapWallet(testEnv, {
      ethAmount: '1000',
      wethAmount: '900',
      usdcAmount: '0'
    });
    swapWallet = swapSetup;

    // Create adapter for pool queries
    adapter = new UniswapV3Adapter(1337);

    // Create test vault with tight position
    console.log('Creating test vault...');
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Emergency Exit Test Vault',
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 90,
          tickRange: { type: 'centered', spacing: 5 }
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Test vault created: ${testVault.vaultAddress}`);

    // Configure strategy with very low emergency exit trigger
    await configureStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 25,        // 0.25% range
      targetRangeLower: 25,
      rebalanceThresholdUpper: 150, // 1.5%
      rebalanceThresholdLower: 150,
      emergencyExitTrigger: 50,    // 0.5% - very tight for testing
      reinvestmentTrigger: 1000,   // $10 (high to avoid interference)
      reinvestmentRatio: 5000
    });

    // Initialize and start automation service
    service = new AutomationService(testEnv.testConfig);
    await service.start();
    console.log('Automation service started');

    // Wait for vault discovery
    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      500
    );
    console.log('Vault discovered by service');
  }, 180000);

  afterAll(async () => {
    if (service?.isRunning) {
      await service.stop();
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should trigger emergency exit when price moves beyond threshold during swap event', async () => {
    // Track emergency exit events
    const vaultBlacklistedEvents = [];

    service.eventManager.subscribe('VaultBlacklisted', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        vaultBlacklistedEvents.push(data);
        console.log(`VaultBlacklisted: ${data.reason}`);
      }
    });

    // Get initial position data
    const initialVault = await service.vaultDataService.getVault(testVault.vaultAddress);
    const initialPositions = Object.values(initialVault.positions);
    expect(initialPositions.length).toBe(1);

    const initialPosition = initialPositions[0];
    console.log(`Initial position: ${initialPosition.id}`);
    console.log(`Initial position liquidity: ${initialPosition.liquidity}`);

    // Get initial pool state for baseline comparison
    const wethAddress = getTokenAddressForTest('WETH', 1337);
    const usdcAddress = getTokenAddressForTest('USDC', 1337);

    const initialPoolData = await adapter._fetchPoolData(
      usdcAddress,
      wethAddress,
      500,
      testEnv.hardhatServer.provider
    );
    console.log(`Initial pool tick: ${initialPoolData.tick}`);

    // Execute massive single swap to trigger emergency exit
    // 0.5% price movement = about 50 bps = ~50 ticks
    // Need a very large swap to move price that much in one block
    console.log('Executing massive swap to trigger emergency exit...');

    const massiveSwapAmount = ethers.utils.parseUnits('550', 18); // 550 WETH

    try {
      await executeSwap(testEnv, {
        tokenIn: wethAddress,
        tokenOut: usdcAddress,
        amountIn: massiveSwapAmount,
        fee: 500,
        wallet: swapWallet.wallet,
        slippage: 100 // 100% slippage tolerance for massive swap
      });
      console.log('Massive swap completed');
    } catch (error) {
      // Swap might fail due to price impact, but the event should still be detected
      console.log(`Swap result: ${error.message.slice(0, 100)}`);
    }

    // Get new pool state
    const newPoolData = await adapter._fetchPoolData(
      usdcAddress,
      wethAddress,
      500,
      testEnv.hardhatServer.provider
    );
    console.log(`New pool tick: ${newPoolData.tick}`);
    console.log(`Tick difference: ${Math.abs(newPoolData.tick - initialPoolData.tick)}`);

    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Wait for VaultBlacklisted event (emitted on emergency exit)
    await waitForCondition(
      () => vaultBlacklistedEvents.length > 0,
      60000,
      1000
    );

    // Verify VaultBlacklisted event with emergency reason
    expect(vaultBlacklistedEvents.length).toBeGreaterThan(0);
    const emergencyEvent = vaultBlacklistedEvents[0];

    expect(emergencyEvent.vaultAddress).toBe(testVault.vaultAddress);
    expect(emergencyEvent.reason).toContain('Emergency');
    console.log(`Emergency exit reason: ${emergencyEvent.reason}`);

    // Check if vault is blacklisted
    const isBlacklisted = service.isVaultBlacklisted(testVault.vaultAddress);
    expect(isBlacklisted).toBe(true);

    console.log('Emergency exit test passed - vault successfully blacklisted');
  }, 180000);
});

// ============================================================================
// Retry Scenario Trigger - Emergency exit when price moves while vault in retry queue
// ============================================================================
describe('Emergency Exit - Retry Scenario Trigger', () => {
  let testEnv;
  let testConfig;
  let tempDir;
  let service;
  let testVault;
  let swapWallet;
  let adapter;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Setup swap wallet
    swapWallet = await setupSwapWallet(testEnv, {
      ethAmount: '1000',
      wethAmount: '900',
      usdcAmount: '0'
    });

    // Create adapter for pool queries
    adapter = new UniswapV3Adapter(1337);

    // Create test vault with position
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Retry Emergency Exit Test Vault',
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '3' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 80,
          tickRange: { type: 'centered', spacing: 10 }
        }],
        tokenTransfers: { 'WETH': 50, 'USDC': 50 },
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );

    // Configure strategy with emergency exit trigger
    await configureStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 25,
      targetRangeLower: 25,
      rebalanceThresholdUpper: 150,
      rebalanceThresholdLower: 150,
      emergencyExitTrigger: 50,    // 0.5% - tight trigger for testing
      reinvestmentTrigger: 1000,
      reinvestmentRatio: 5000
    });

    console.log(`Retry test vault created at: ${testVault.vaultAddress}`);
  }, 180000);

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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'emergency-retry-test-'));
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
      retryIntervalMs: 999999999  // Disabled - we'll call manually
    });

    return { service, dir, blacklistPath: service.blacklistFilePath, trackingDir: service.trackingDataDir };
  };

  it('should blacklist vault if price moved beyond threshold while in retry queue', async () => {
    await createTestService(3400);

    // Track events
    const events = {
      vaultFailed: [],
      vaultRecovered: [],
      vaultBlacklisted: []
    };

    service.eventManager.subscribe('VaultFailed', (data) => {
      console.log(`  [EVENT] VaultFailed: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultFailed.push(data);
    });

    service.eventManager.subscribe('VaultRecovered', (data) => {
      console.log(`  [EVENT] VaultRecovered: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultRecovered.push(data);
    });

    service.eventManager.subscribe('VaultBlacklisted', (data) => {
      console.log(`  [EVENT] VaultBlacklisted: ${data.vaultAddress?.slice(0, 10)}... reason=${data.reason?.slice(0, 50)}`);
      events.vaultBlacklisted.push(data);
    });

    // Track strategy initializeVault calls
    let initializeVaultCallCount = 0;

    const originalInitialize = service.initialize.bind(service);
    service.initialize = async function() {
      await originalInitialize();

      // Get the bob strategy and spy on initializeVault
      const bobStrategy = service.strategies.get('bob');
      const realInitializeVault = bobStrategy.initializeVault.bind(bobStrategy);

      vi.spyOn(bobStrategy, 'initializeVault').mockImplementation(async (vault) => {
        initializeVaultCallCount++;
        console.log(`  [SPY] initializeVault call #${initializeVaultCallCount}`);

        // First call: fail with recoverable error AFTER baseline is captured
        // This simulates a failure partway through initialization
        if (initializeVaultCallCount === 1) {
          // Let the real method run far enough to set the emergency exit baseline
          // Then throw a recoverable error
          const strategy = service.strategies.get('bob');
          const vaultAddress = vault.address;

          // Manually set the baseline (simulating what happens before failure)
          // Get current pool tick for baseline
          const wethAddress = getTokenAddressForTest('WETH', 1337);
          const usdcAddress = getTokenAddressForTest('USDC', 1337);
          const poolData = await adapter._fetchPoolData(
            usdcAddress,
            wethAddress,
            500,
            testEnv.hardhatServer.provider
          );
          strategy.emergencyExitBaseline[vaultAddress] = poolData.tick;
          console.log(`  [SPY] Set emergency baseline: ${poolData.tick}`);

          throw new Error('NETWORK_ERROR: Connection lost during initialization');
        }

        // Subsequent calls: let real method run (will check baseline)
        return realInitializeVault(vault);
      });
    };

    // Step 1: Start service - vault will fail during initialization and enter retry queue
    console.log('Starting service (expecting initialization failure)...');
    await service.start();

    // Verify vault is in retry queue
    expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
    expect(events.vaultFailed.length).toBe(1);
    console.log(`Vault in retry queue: ${service.failedVaults.has(testVault.vaultAddress)}`);

    // Step 2: Move price significantly while vault is in retry queue
    console.log('Moving price while vault is in retry queue...');
    const wethAddress = getTokenAddressForTest('WETH', 1337);
    const usdcAddress = getTokenAddressForTest('USDC', 1337);

    const initialPoolData = await adapter._fetchPoolData(
      usdcAddress,
      wethAddress,
      500,
      testEnv.hardhatServer.provider
    );
    console.log(`Pool tick before swaps: ${initialPoolData.tick}`);

    // Execute multiple swaps to move price beyond emergency threshold (0.5%)
    const swapAmount = ethers.utils.parseUnits('100', 18);
    for (let i = 0; i < 5; i++) {
      try {
        await executeSwap(testEnv, {
          tokenIn: wethAddress,
          tokenOut: usdcAddress,
          amountIn: swapAmount,
          fee: 500,
          wallet: swapWallet.wallet,
          slippage: 50
        });
        console.log(`  Swap ${i + 1} completed`);
      } catch (error) {
        console.log(`  Swap ${i + 1} failed: ${error.message.slice(0, 50)}`);
        break;
      }
    }

    const newPoolData = await adapter._fetchPoolData(
      usdcAddress,
      wethAddress,
      500,
      testEnv.hardhatServer.provider
    );
    console.log(`Pool tick after swaps: ${newPoolData.tick}`);
    console.log(`Tick difference: ${Math.abs(newPoolData.tick - initialPoolData.tick)}`);

    // Step 3: Trigger retry - initializeVault will check baseline and detect emergency
    console.log('Triggering retry (expecting emergency exit detection)...');
    await service.retryFailedVaults();

    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 4: Verify vault was blacklisted (not recovered)
    expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
    expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
    console.log(`Vault blacklisted: ${service.isVaultBlacklisted(testVault.vaultAddress)}`);

    // Verify no recovery event (should have been blacklisted instead)
    expect(events.vaultRecovered.length).toBe(0);

    // Verify VaultBlacklisted event with emergency reason
    const blacklistEvent = events.vaultBlacklisted.find(
      e => e.vaultAddress === testVault.vaultAddress
    );
    expect(blacklistEvent).toBeDefined();
    expect(blacklistEvent.reason).toContain('Emergency');
    expect(blacklistEvent.reason).toContain('retry');
    console.log(`Blacklist reason: ${blacklistEvent.reason}`);

    console.log('Retry scenario emergency exit test passed');
  }, 240000);
});
