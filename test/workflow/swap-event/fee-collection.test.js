/**
 * @fileoverview Test fee collection trigger when accumulated fees exceed threshold
 *
 * Tests:
 * 1. Fees collected when accumulated fees exceed reinvestmentTrigger threshold
 * 2. Fee distribution follows reinvestmentRatio
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { setupSwapWallet, executeSwap, configureStrategyParameters } from '../../helpers/swap-utils.js';
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

describe('Fee Collection Trigger', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;

  beforeAll(async () => {
    // Setup blockchain
    testEnv = await setupTestBlockchain();
    console.log('Test blockchain connected');

    // Setup swap wallet with significant capital for generating fees
    console.log('Setting up swap wallet...');
    const swapSetup = await setupSwapWallet(testEnv, {
      ethAmount: '500',
      wethAmount: '400',
      usdcAmount: '0'
    });
    swapWallet = swapSetup;

    // Create test vault with position that will accumulate fees
    console.log('Creating test vault...');
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Fee Collection Test Vault',
        automationServiceAddress: testEnv.testConfig.automationServiceAddress,
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 90,
          tickRange: { type: 'centered', spacing: 10 } // Wide range to stay in range
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Test vault created: ${testVault.vaultAddress}`);

    // Configure strategy with low fee trigger for easier testing
    await configureStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 200,       // 2% range (wide to avoid rebalance)
      targetRangeLower: 200,
      rebalanceThresholdUpper: 300, // 3% threshold
      rebalanceThresholdLower: 300,
      emergencyExitTrigger: 500,   // 5% (high to avoid triggering)
      reinvestmentTrigger: 100,    // $1.00 trigger (low for testing)
      reinvestmentRatio: 5000      // 50% to owner
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

  it('should trigger fee collection when accumulated fees exceed threshold', async () => {
    // Track fee collection events
    const feesCollectedEvents = [];
    const feesDistributedEvents = [];

    service.eventManager.subscribe('FeesCollected', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        feesCollectedEvents.push(data);
        console.log(`FeesCollected event: $${data.totalUsdValue?.toFixed(2) || 'N/A'}`);
      }
    });

    service.eventManager.subscribe('FeesDistributed', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        feesDistributedEvents.push(data);
        console.log(`FeesDistributed event: ${data.distributions?.length || 0} distributions`);
      }
    });

    // Get token addresses
    const wethData = service.tokens['WETH'];
    const usdcData = service.tokens['USDC'];

    // Execute round-trip swaps to generate fees without depleting capital
    // Each swap generates 0.05% fee (500 bps pool = 5 bps per swap)
    // Strategy requires 50 swaps before checking fees, so we need at least 55
    const wethSwapAmount = ethers.utils.parseUnits('10', wethData.decimals);
    const usdcSwapAmount = ethers.utils.parseUnits('25000', usdcData.decimals); // ~10 WETH worth
    const maxSwaps = 55;

    console.log(`Executing up to ${maxSwaps} round-trip swaps to generate fees...`);

    for (let i = 0; i < maxSwaps; i++) {
      // Check if fees were collected
      if (feesCollectedEvents.length > 0) {
        console.log(`Fees collected after ${i} swaps`);
        break;
      }

      // Alternate swap direction for round-trips
      const isEvenSwap = i % 2 === 0;

      await executeSwap(testEnv, {
        tokenIn: isEvenSwap ? wethData.address : usdcData.address,
        tokenOut: isEvenSwap ? usdcData.address : wethData.address,
        amountIn: isEvenSwap ? wethSwapAmount : usdcSwapAmount,
        fee: 500,
        wallet: swapWallet.wallet,
        slippage: 10 // Higher slippage for round-trips due to price impact
      });

      console.log(`  Swap ${i + 1}/${maxSwaps} (${isEvenSwap ? 'WETH→USDC' : 'USDC→WETH'}) completed`);

      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Wait for FeesCollected event (with extended timeout)
    await waitForCondition(
      () => feesCollectedEvents.length > 0,
      60000,
      1000
    );

    // Verify FeesCollected event
    expect(feesCollectedEvents.length).toBeGreaterThan(0);
    const feeEvent = feesCollectedEvents[0];

    expect(feeEvent.vaultAddress).toBe(testVault.vaultAddress);
    expect(feeEvent.source).toBe('swap_threshold');
    expect(feeEvent.positionIds).toBeDefined();
    expect(feeEvent.positionIds.length).toBeGreaterThan(0);

    // Verify fees were actually collected
    if (feeEvent.totalUsdValue !== undefined) {
      expect(feeEvent.totalUsdValue).toBeGreaterThan(0);
      console.log(`Total fees collected: $${feeEvent.totalUsdValue.toFixed(2)}`);
    }

    // Verify fee distribution occurred (since reinvestmentRatio is 50%)
    await waitForCondition(
      () => feesDistributedEvents.length > 0,
      10000,
      500
    );

    if (feesDistributedEvents.length > 0) {
      const distEvent = feesDistributedEvents[0];
      expect(distEvent.reinvestmentRatio).toBe(50); // 50% stored as percentage
      console.log(`Fee distribution: ${distEvent.distributions?.length || 0} tokens distributed to owner`);
    }

    console.log('Fee collection test passed');
  }, 180000);
});
