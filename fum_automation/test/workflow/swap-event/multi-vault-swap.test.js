/**
 * @fileoverview Test multi-vault swap event fan-out and isolation
 *
 * Two vaults share the same WETH/USDC 500bp pool but have different position ranges:
 * - Vault A: tight range (0.25%) — goes out of range with a few swaps, triggers rebalance
 * - Vault B: wide range (5%) — stays in range through the same swaps
 *
 * Tests:
 * 1. Both vaults receive swap events from the shared pool listener
 * 2. Vault A rebalances while vault B stays healthy (independent evaluation)
 * 3. After vault A's rebalance, the shared swap listener survives (vault B not orphaned)
 * 4. Vault B continues to receive and process subsequent swap events
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

describe('Multi-Vault Swap Event Fan-Out', () => {
  let testEnv;
  let service;
  let vaultA; // Tight range — will rebalance
  let vaultB; // Wide range — stays in range
  let swapWallet;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    console.log('Test blockchain connected');

    // Setup swap wallet
    console.log('Setting up swap wallet...');
    swapWallet = await setupSwapWallet(testEnv, {
      ethAmount: '1000',
      wethAmount: '800',
      usdcAmount: '0'
    });

    // Vault A: tight position range — will go out of range easily
    console.log('Creating vault A (tight range)...');
    vaultA = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Multi-Vault A (Tight)',
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 90,
          tickRange: { type: 'centered', spacing: 3 } // Tight — rebalances easily
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Vault A created: ${vaultA.vaultAddress}`);

    // Vault B: wide position range — stays in range through price movement
    console.log('Creating vault B (wide range)...');
    vaultB = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Multi-Vault B (Wide)',
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 90,
          tickRange: { type: 'centered', spacing: 50 } // Wide — stays in range
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Vault B created: ${vaultB.vaultAddress}`);

    // Configure strategy parameters
    // Vault A: tight range + tight rebalance threshold
    await configureStrategyParameters(testEnv, vaultA.vaultAddress, vaultA.vault, {
      targetRangeUpper: 25,         // 0.25% range
      targetRangeLower: 25,
      rebalanceThresholdUpper: 150, // 1.5% threshold
      rebalanceThresholdLower: 150,
      emergencyExitTrigger: 500,    // 5% (high to not trigger)
      reinvestmentTrigger: 500,     // $5.00 (high to avoid fee collection)
      reinvestmentRatio: 5000
    });

    // Vault B: wide range — won't rebalance
    await configureStrategyParameters(testEnv, vaultB.vaultAddress, vaultB.vault, {
      targetRangeUpper: 500,        // 5% range
      targetRangeLower: 500,
      rebalanceThresholdUpper: 150,
      rebalanceThresholdLower: 150,
      emergencyExitTrigger: 1000,   // 10%
      reinvestmentTrigger: 500,
      reinvestmentRatio: 5000
    });

    // Start service — discovers both vaults
    service = new AutomationService(testEnv.testConfig);
    await service.start();
    console.log('Automation service started');

    // Wait for both vaults to be discovered
    await waitForCondition(
      () => service.vaultDataService.hasVault(vaultA.vaultAddress) &&
            service.vaultDataService.hasVault(vaultB.vaultAddress),
      60000,
      500
    );
    console.log('Both vaults discovered by service');
  }, 300000);

  afterAll(async () => {
    if (service?.isRunning) {
      await service.stop();
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should share a single swap listener for both vaults in the same pool', async () => {
    // Both vaults should be tracked
    expect(service.vaultDataService.hasVault(vaultA.vaultAddress)).toBe(true);
    expect(service.vaultDataService.hasVault(vaultB.vaultAddress)).toBe(true);

    // Get pool address from vault A's position
    const vaultAData = await service.vaultDataService.getVault(vaultA.vaultAddress);
    const vaultAPositions = Object.values(vaultAData.positions);
    expect(vaultAPositions.length).toBe(1);
    const poolAddress = vaultAPositions[0].pool;

    // Single swap listener key for the shared pool
    const swapListenerKey = `${poolAddress.toLowerCase()}-swap-1337-uniswapV3`;
    expect(service.eventManager.listeners[swapListenerKey]).toBeDefined();

    // Both vaults mapped to the same pool
    const poolVaults = service.eventManager.poolToVaults[poolAddress];
    expect(poolVaults).toContain(vaultA.vaultAddress);
    expect(poolVaults).toContain(vaultB.vaultAddress);
    expect(poolVaults.length).toBe(2);

    console.log(`Shared pool listener: ${swapListenerKey}`);
    console.log(`Pool has ${poolVaults.length} vaults mapped`);
  });

  it('should rebalance vault A while vault B stays healthy', async () => {
    // Track events per vault
    const rebalanceEvents = [];
    const vaultBLockEvents = [];

    service.eventManager.subscribe('PositionRebalanced', (data) => {
      rebalanceEvents.push(data);
      console.log(`PositionRebalanced: vault ${data.vaultAddress.slice(0, 10)}...`);
    });

    // Track lock/unlock cycles for vault B — proves it received and processed swap events
    service.eventManager.subscribe('VaultUnlocked', (data) => {
      if (data.vaultAddress === ethers.utils.getAddress(vaultB.vaultAddress)) {
        vaultBLockEvents.push(data);
      }
    });

    // Get initial position IDs
    const vaultAInitial = await service.vaultDataService.getVault(vaultA.vaultAddress);
    const vaultBInitial = await service.vaultDataService.getVault(vaultB.vaultAddress);
    const vaultAInitialPositionId = Object.keys(vaultAInitial.positions)[0];
    const vaultBPositionId = Object.keys(vaultBInitial.positions)[0];

    // Execute swaps to push price down — vault A (tight) goes out of range, vault B (wide) stays
    const wethAddress = getTokenAddressForTest('WETH', 1337);
    const usdcAddress = getTokenAddressForTest('USDC', 1337);
    const swapAmount = ethers.utils.parseUnits('20', 18);

    console.log('Executing swaps to push vault A out of range...');

    for (let i = 0; i < 30; i++) {
      if (rebalanceEvents.length > 0) {
        console.log(`Rebalance triggered after ${i + 1} swaps`);
        break;
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
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log(`Swap ${i + 1} failed: ${error.message.slice(0, 50)}`);
        break;
      }
    }

    // Wait for vault A's rebalance
    await waitForCondition(
      () => rebalanceEvents.some(e => e.vaultAddress === vaultA.vaultAddress),
      60000,
      1000
    );

    // Vault A should have rebalanced
    const vaultARebalance = rebalanceEvents.find(e => e.vaultAddress === vaultA.vaultAddress);
    expect(vaultARebalance).toBeDefined();
    expect(vaultARebalance.oldPositionId).toBe(vaultAInitialPositionId);
    expect(vaultARebalance.newPositionId).toBeDefined();
    expect(vaultARebalance.newPositionId).not.toBe(vaultAInitialPositionId);

    // Vault B should NOT have rebalanced
    const vaultBRebalance = rebalanceEvents.find(e => e.vaultAddress === vaultB.vaultAddress);
    expect(vaultBRebalance).toBeUndefined();

    // Vault B should have received swap events (lock/unlock cycles prove processing)
    expect(vaultBLockEvents.length).toBeGreaterThan(0);

    // Vault B's position should be unchanged
    const vaultBAfter = await service.vaultDataService.getVault(vaultB.vaultAddress);
    expect(Object.keys(vaultBAfter.positions)[0]).toBe(vaultBPositionId);

    // Vault B should not be in any error state
    expect(service.failedVaults.has(vaultB.vaultAddress)).toBe(false);
    expect(service.isVaultBlacklisted(vaultB.vaultAddress)).toBe(false);

    console.log(`Vault A rebalanced: ${vaultAInitialPositionId} → ${vaultARebalance.newPositionId}`);
    console.log(`Vault B stayed healthy (${vaultBLockEvents.length} swap events processed)`);
  }, 180000);

  it('should maintain shared swap listener after vault A rebalance', async () => {
    // refreshSwapListeners fires async after PositionRebalanced — wait for it
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get pool address from vault B's position (vault A may have moved pools, though unlikely)
    const vaultBData = await service.vaultDataService.getVault(vaultB.vaultAddress);
    const vaultBPosition = Object.values(vaultBData.positions)[0];
    const poolAddress = vaultBPosition.pool;

    // Swap listener should still exist for this pool
    const swapListenerKey = `${poolAddress.toLowerCase()}-swap-1337-uniswapV3`;
    expect(service.eventManager.listeners[swapListenerKey]).toBeDefined();

    // Vault B should still be in poolToVaults
    expect(service.eventManager.poolToVaults[poolAddress]).toContain(vaultB.vaultAddress);

    // Vault A should also be in poolToVaults (refreshSwapListeners re-added it)
    expect(service.eventManager.poolToVaults[poolAddress]).toContain(vaultA.vaultAddress);

    console.log('Shared swap listener intact after rebalance');
  }, 30000);

  it('should continue delivering swap events to vault B after vault A rebalance', async () => {
    // Track swap events for vault B specifically
    const vaultBSwapEvents = [];
    service.eventManager.subscribe('SwapEventDetected', (data) => {
      if (data.vaultAddress === vaultB.vaultAddress) {
        vaultBSwapEvents.push(data);
      }
    });

    // Execute a small swap — should trigger events for both vaults
    const wethAddress = getTokenAddressForTest('WETH', 1337);
    const usdcAddress = getTokenAddressForTest('USDC', 1337);
    const smallSwap = ethers.utils.parseUnits('0.1', 18);

    await executeSwap(testEnv, {
      tokenIn: wethAddress,
      tokenOut: usdcAddress,
      amountIn: smallSwap,
      fee: 500,
      wallet: swapWallet.wallet
    });

    // Wait for vault B to receive the event
    await waitForCondition(
      () => vaultBSwapEvents.length > 0,
      30000,
      500
    );

    expect(vaultBSwapEvents.length).toBeGreaterThan(0);
    expect(vaultBSwapEvents[0].vaultAddress).toBe(vaultB.vaultAddress);

    // Vault B should still be healthy (not in failedVaults)
    expect(service.failedVaults.has(vaultB.vaultAddress)).toBe(false);
    expect(service.isVaultBlacklisted(vaultB.vaultAddress)).toBe(false);

    console.log('Vault B continues receiving swap events after vault A rebalance');
  }, 60000);
});
