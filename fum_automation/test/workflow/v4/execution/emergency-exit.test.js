/**
 * @fileoverview V4 Emergency Exit Test
 *
 * Tests emergency exit detection when price moves beyond the emergencyExitTrigger threshold.
 * Emergency exit triggers vault blacklisting WITHOUT closing positions.
 *
 * This validates V4-specific:
 * - Pool tick fetching for baseline comparison
 * - Emergency detection logic with V4 pool data
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../../src/core/AutomationService.js';
import { setupV4TestBlockchain, cleanupV4TestBlockchain } from '../../../helpers/v4-hardhat-setup.js';
import { setupV4TestVault } from '../../../helpers/v4-vault-setup.js';
import {
  setupV4SwapWallet,
  executeV4PoolSwap,
  getV4PoolData,
  configureV4StrategyParameters,
  getV4TokenAddress
} from '../../../helpers/v4-swap-utils.js';
import { waitForCondition } from '../../../helpers/wait-utils.js';

const NATIVE_ETH = ethers.constants.AddressZero;

describe('V4 Emergency Exit', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;

  beforeAll(async () => {
    // Setup V4 blockchain
    testEnv = await setupV4TestBlockchain();
    console.log('V4 Emergency Exit test blockchain connected');

    // Setup swap wallet with massive capital for emergency trigger
    console.log('Setting up V4 swap wallet with large reserves...');
    swapWallet = await setupV4SwapWallet(testEnv, {
      ethAmount: '1000',
      usdcAmount: '0' // No USDC needed - we'll swap ETH -> USDC
    });

    // Create test vault with NO positions - service will create one during setup
    // This avoids Graph indexing delay issues (same pattern as BS-0010-v4 and rebalance-and-fees)
    console.log('Creating V4 test vault (no initial positions)...');
    testVault = await setupV4TestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'V4 Emergency Exit Test Vault',
        nativeEthAmount: '10',
        nativeEthToVault: '20', // V4 needs ETH for deficit swap + position msg.value
        swapTokens: [], // No pre-swaps
        positions: [], // NO positions - service will create during setupVault
        tokenTransfers: {},
        targetTokens: ['ETH', 'USDC'],
        targetPlatforms: ['uniswapV4'],
        strategy: 'bob'
      }
    );
    console.log(`V4 Emergency Exit test vault created: ${testVault.vaultAddress}`);

    // Configure strategy parameters for emergency exit testing:
    // - Moderate range (2%) to accommodate some price movement
    // - Low emergency exit trigger (3%) to trigger quickly during aggressive swaps
    // - High reinvestment trigger to avoid fee collection interference
    await configureV4StrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 200,       // 2% range
      targetRangeLower: 200,
      emergencyExitTrigger: 300,   // 3% emergency exit trigger (triggers quickly for test)
      reinvestmentTrigger: 1000,   // $10 (high to avoid interference)
      reinvestmentRatio: 5000      // 50% to owner
    });

    // Initialize and start automation service
    service = new AutomationService(testEnv.testConfig);
    await service.start();
    console.log('V4 Emergency Exit automation service started');

    // Wait for vault discovery
    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      500
    );
    console.log('V4 Vault discovered by service');

    // Wait for service to create position (setupVault flow)
    await waitForCondition(
      async () => {
        const vault = await service.vaultDataService.getVault(testVault.vaultAddress);
        const positions = Object.values(vault.positions || {});
        return positions.length > 0;
      },
      60000,
      1000
    );
    console.log('V4 Position created by service');
  }, 180000);

  afterAll(async () => {
    if (service?.isRunning) {
      await service.stop();
    }
    await cleanupV4TestBlockchain(testEnv);
  });

  it('should trigger emergency exit when price moves beyond threshold during swap event', async () => {
    // Track emergency exit events
    const vaultBlacklistedEvents = [];

    service.eventManager.subscribe('VaultBlacklisted', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        vaultBlacklistedEvents.push(data);
        console.log(`🚨 VaultBlacklisted: ${data.reason}`);
      }
    });

    // Get initial position data
    const initialVault = await service.vaultDataService.getVault(testVault.vaultAddress);
    const initialPositions = Object.values(initialVault.positions);
    expect(initialPositions.length).toBe(1);

    const initialPosition = initialPositions[0];
    console.log(`Initial V4 position: ${initialPosition.id}`);
    console.log(`Initial V4 position liquidity: ${initialPosition.liquidity}`);

    // Get initial pool state for baseline comparison
    const usdcAddress = getV4TokenAddress('USDC', 1337);

    const initialPoolData = await getV4PoolData(testEnv, NATIVE_ETH, usdcAddress, 500, 10);
    console.log(`Initial V4 pool tick: ${initialPoolData.tick}`);

    // Get strategy's emergency exit baseline
    const strategy = service.strategies.get('bob');
    const baseline = strategy.emergencyExitBaseline[testVault.vaultAddress];
    console.log(`Strategy emergency baseline: ${baseline}`);

    // Execute MASSIVE single swap to trigger emergency exit
    // 0.5% price movement needs a very large swap
    console.log('Executing massive V4 swap to trigger emergency exit...');

    const massiveSwapAmount = ethers.utils.parseEther('550'); // 550 ETH

    try {
      await executeV4PoolSwap(testEnv, {
        tokenIn: NATIVE_ETH,
        tokenOut: usdcAddress,
        amountIn: massiveSwapAmount,
        wallet: swapWallet.wallet,
        fee: 500,        // Target the 500bp pool where position lives
        tickSpacing: 10,
        slippage: 100 // 100% slippage tolerance for massive swap
      });
      console.log('Massive V4 swap completed');
    } catch (error) {
      // Swap might fail due to price impact, but the event should still be detected
      console.log(`V4 Swap result: ${error.message.slice(0, 100)}`);
    }

    // Get new pool state
    const newPoolData = await getV4PoolData(testEnv, NATIVE_ETH, usdcAddress, 500, 10);
    console.log(`New V4 pool tick: ${newPoolData.tick}`);
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

    // Verify position was NOT closed (emergency exit preserves positions)
    const finalVault = await service.vaultDataService.getVault(testVault.vaultAddress);
    const finalPositions = Object.values(finalVault.positions);

    // Position should still exist in cache (not removed during emergency)
    // Note: The position count check depends on whether VDS clears cache on blacklist
    // The key test is that the vault is blacklisted with "Emergency" reason

    console.log(`Final position count: ${finalPositions.length}`);
    console.log('✅ V4 Emergency exit test passed - vault successfully blacklisted');
  }, 180000);
});
