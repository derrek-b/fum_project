/**
 * @fileoverview Test FeeTrackingFailed event for V4 native ETH positions
 *
 * V4 positions use native ETH which doesn't emit Transfer events on closure.
 * closePositions pre-calculates fees via getAccruedFeesUSD() before closing.
 * If that pre-calc fails, fees are recorded as 0 and FeeTrackingFailed is emitted.
 * The closure itself still succeeds — only fee attribution accuracy is affected.
 *
 * Tests:
 * 1. Pre-calc failure → FeeTrackingFailed emitted, position still closes
 * 2. Rebalance completes (new position created) despite tracking failure
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../../src/core/AutomationService.js';
import { setupV4TestBlockchain, cleanupV4TestBlockchain } from '../../../helpers/v4-hardhat-setup.js';
import { setupV4TestVault } from '../../../helpers/v4-vault-setup.js';
import {
  setupV4SwapWallet,
  executeV4PoolSwap,
  configureV4StrategyParameters,
  getV4TokenAddress
} from '../../../helpers/v4-swap-utils.js';
import { waitForCondition } from '../../../helpers/wait-utils.js';

const NATIVE_ETH = ethers.constants.AddressZero;

describe('V4 Fee Tracking Failure', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;

  beforeAll(async () => {
    testEnv = await setupV4TestBlockchain();
    console.log('V4 Test blockchain connected');

    swapWallet = await setupV4SwapWallet(testEnv, {
      ethAmount: '1000',
      usdcAmount: '0'
    });

    // Create vault with position pre-created during setup (percentOfAssets: 100)
    // This eliminates slow AlphaRouter deficit swaps during service initialization
    console.log('Creating V4 test vault...');
    testVault = await setupV4TestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'V4 Fee Tracking Failure Test',
        nativeEthAmount: '10',
        wrapEthAmount: '10',
        swapTokens: [{ from: 'ETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'ETH',
          token1: 'USDC',
          fee: 500,
          percentOfAssets: 100,
          tickRange: { type: 'centered', spacing: 10 }
        }],
        targetTokens: ['ETH', 'USDC'],
        targetPlatforms: ['uniswapV4'],
        strategy: 'bob'
      }
    );
    console.log(`V4 Test vault created: ${testVault.vaultAddress}`);

    // Tight range so position goes out of range quickly
    await configureV4StrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 25,          // 0.25% range (tight)
      targetRangeLower: 25,
      rebalanceThresholdUpper: 150,  // 1.5%
      rebalanceThresholdLower: 150,
      emergencyExitTrigger: 1000,    // 10% (high to avoid triggering)
      reinvestmentTrigger: 500,      // $5 (high to avoid fee collection during test)
      reinvestmentRatio: 5000
    });

    // Start service — discovers vault, creates position
    service = new AutomationService(testEnv.testConfig);
    await service.start();
    console.log('V4 Automation service started');

    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      500
    );

    // Wait for position creation
    await waitForCondition(
      async () => {
        const vault = await service.vaultDataService.getVault(testVault.vaultAddress);
        return Object.values(vault.positions || {}).length > 0;
      },
      60000,
      1000
    );
    console.log('V4 Position created by service');
  }, 300000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (service) {
      try {
        await service.stop(true);
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }
    await cleanupV4TestBlockchain(testEnv);
  });

  it('should emit FeeTrackingFailed when pre-calc fails for native ETH position', async () => {
    const events = {
      positionRebalanced: [],
      positionsClosed: [],
      feeTrackingFailed: [],
      newPositionCreated: []
    };

    service.eventManager.subscribe('PositionRebalanced', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        console.log(`  [EVENT] PositionRebalanced`);
        events.positionRebalanced.push(data);
      }
    });

    service.eventManager.subscribe('PositionsClosed', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        console.log(`  [EVENT] PositionsClosed: ${data.closedCount} position(s)`);
        events.positionsClosed.push(data);
      }
    });

    service.eventManager.subscribe('FeeTrackingFailed', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        console.log(`  [EVENT] FeeTrackingFailed: ${data.failures?.length} failure(s)`);
        events.feeTrackingFailed.push(data);
      }
    });

    service.eventManager.subscribe('NewPositionCreated', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        console.log(`  [EVENT] NewPositionCreated`);
        events.newPositionCreated.push(data);
      }
    });

    // Mock getAccruedFeesUSD on the V4 adapter to fail — simulates RPC failure
    // during fee pre-calculation for native ETH positions
    const strategy = service.strategies.get('bob');
    const v4Adapter = strategy.adapters.get('uniswapV4');
    vi.spyOn(v4Adapter, 'getAccruedFeesUSD').mockImplementation(async () => {
      throw new Error('NETWORK_ERROR: Failed to fetch accrued fees');
    });

    // Execute swaps to push position out of range
    const usdcAddress = getV4TokenAddress('USDC', 1337);
    console.log('Executing V4 swaps to trigger rebalance...');

    for (let i = 0; i < 30; i++) {
      if (events.positionRebalanced.length > 0) {
        console.log(`Rebalance triggered after ${i + 1} swaps`);
        break;
      }

      try {
        // Swap ETH → USDC to push price down
        await executeV4PoolSwap(testEnv, {
          tokenIn: NATIVE_ETH,
          tokenOut: usdcAddress,
          amountIn: ethers.utils.parseEther('20'),
          wallet: swapWallet.wallet,
          fee: 500,
          tickSpacing: 10
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log(`Swap ${i + 1} failed: ${error.message.slice(0, 50)}`);
        break;
      }
    }

    // Wait for rebalance to complete
    await waitForCondition(
      () => events.positionRebalanced.length > 0,
      60000,
      1000
    );

    // Position was closed successfully despite fee tracking failure
    expect(events.positionsClosed.length).toBeGreaterThan(0);
    expect(events.positionsClosed[0].closedCount).toBe(1);

    // FeeTrackingFailed should have been emitted
    expect(events.feeTrackingFailed.length).toBeGreaterThan(0);
    const trackingEvent = events.feeTrackingFailed[0];
    expect(trackingEvent.vaultAddress).toBe(testVault.vaultAddress);
    expect(trackingEvent.reason).toBe('pre_calculation_failed_for_native_eth');
    expect(trackingEvent.failures.length).toBeGreaterThan(0);

    // At least one token should be flagged as failed tracking
    const failure = trackingEvent.failures[0];
    expect(failure.token0Failed || failure.token1Failed).toBe(true);

    // Rebalance completed — new position created
    expect(events.positionRebalanced.length).toBe(1);
    expect(events.newPositionCreated.length).toBeGreaterThan(0);

    // Vault should NOT be in error state — rebalance succeeded
    expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
    expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);

    console.log('V4 Fee tracking failure test passed');
  }, 180000);
});
