/**
 * @fileoverview Test position rebalancing when price moves beyond thresholds
 *
 * Tests:
 * 1. Lower threshold rebalance (price moves down, tick crosses lower bound)
 * 2. Upper threshold rebalance (price moves up, tick crosses upper bound)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import {
  setupSwapWallet,
  executeSwap,
  configureStrategyParameters,
  getTokenAddressForTest,
  getTokenDataForTest
} from '../../helpers/swap-utils.js';
import { waitForCondition } from '../../helpers/wait-utils.js';
import { ethers } from 'ethers';
import { UniswapV3Adapter } from 'fum_library/adapters';

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

describe('Position Rebalancing', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;
  let adapter;

  beforeAll(async () => {
    // Setup blockchain
    testEnv = await setupTestBlockchain();
    console.log('Test blockchain connected');

    // Setup swap wallet with significant capital for market manipulation
    console.log('Setting up swap wallet with large reserves...');
    const swapSetup = await setupSwapWallet(testEnv, {
      ethAmount: '1000',
      wethAmount: '800',
      usdcAmount: '300' // Build USDC reserves for reverse direction
    });
    swapWallet = swapSetup;

    // Create adapter for pool queries
    adapter = new UniswapV3Adapter(1337);

    // Create test vault with tight position range for easier rebalancing
    console.log('Creating test vault with tight position range...');
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Rebalance Test Vault',
        automationServiceAddress: testEnv.testConfig.automationServiceAddress,
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 90,
          tickRange: { type: 'centered', spacing: 3 } // Tight range for easier rebalancing
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Test vault created: ${testVault.vaultAddress}`);

    // Configure strategy with tight parameters for rebalancing
    await configureStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 25,        // 0.25% range
      targetRangeLower: 25,
      rebalanceThresholdUpper: 150, // 1.5% threshold
      rebalanceThresholdLower: 150,
      emergencyExitTrigger: 500,   // 5% (high enough to not trigger during rebalance tests)
      reinvestmentTrigger: 500,    // $5.00 (high to avoid fee collection during test)
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

  it('should trigger rebalance when tick crosses lower threshold', async () => {
    // Track rebalance events
    const rebalanceEvents = [];
    const positionsClosedEvents = [];
    const newPositionEvents = [];

    service.eventManager.subscribe('PositionRebalanced', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        rebalanceEvents.push(data);
        console.log(`PositionRebalanced: old position ${data.oldPositionId}`);
      }
    });

    service.eventManager.subscribe('PositionsClosed', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        positionsClosedEvents.push(data);
        console.log(`PositionsClosed: ${data.closedCount || 0} positions`);
      }
    });

    service.eventManager.subscribe('NewPositionCreated', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        newPositionEvents.push(data);
        console.log(`NewPositionCreated: position ${data.positionId}`);
      }
    });

    // Get initial position data
    const initialVault = await service.vaultDataService.getVault(testVault.vaultAddress);
    const initialPositions = Object.values(initialVault.positions);
    expect(initialPositions.length).toBe(1);

    const initialPosition = initialPositions[0];
    const initialTickLower = initialPosition.tickLower;
    const initialTickUpper = initialPosition.tickUpper;
    console.log(`Initial position range: ${initialTickLower} to ${initialTickUpper}`);

    // Get token addresses
    const wethAddress = getTokenAddressForTest('WETH', 1337);
    const usdcAddress = getTokenAddressForTest('USDC', 1337);

    // Execute large swaps to push price down (WETH -> USDC)
    // This decreases the tick value
    const swapAmount = ethers.utils.parseUnits('20', 18);
    const maxSwaps = 30;

    console.log(`Executing swaps to push price down (lower tick)...`);

    for (let i = 0; i < maxSwaps; i++) {
      // Check if rebalance occurred
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
          slippage: 100 // High slippage for aggressive price movement
        });

        // Get current tick
        const poolData = await adapter._fetchPoolData(
          usdcAddress,
          wethAddress,
          500,
          testEnv.hardhatServer.provider
        );
        console.log(`  Swap ${i + 1}: current tick = ${poolData.tick}`);

        // Wait for event processing
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log(`  Swap ${i + 1} failed: ${error.message.slice(0, 50)}`);
        break;
      }
    }

    // Wait for PositionRebalanced event
    await waitForCondition(
      () => rebalanceEvents.length > 0,
      60000,
      1000
    );

    // Verify rebalance occurred
    expect(rebalanceEvents.length).toBeGreaterThan(0);
    const rebalanceEvent = rebalanceEvents[0];

    expect(rebalanceEvent.vaultAddress).toBe(testVault.vaultAddress);
    expect(rebalanceEvent.oldPositionId).toBeDefined();

    // Verify new position was created
    await waitForCondition(
      () => newPositionEvents.length > 0,
      30000,
      500
    );

    // Get updated vault data
    const updatedVault = await service.vaultDataService.getVault(testVault.vaultAddress);
    const updatedPositions = Object.values(updatedVault.positions);
    expect(updatedPositions.length).toBe(1);

    const newPosition = updatedPositions[0];
    console.log(`New position range: ${newPosition.tickLower} to ${newPosition.tickUpper}`);

    // Verify the new position has different tick bounds
    // (it should be centered around the new price)
    expect(newPosition.tickLower).not.toBe(initialTickLower);
    expect(newPosition.tickUpper).not.toBe(initialTickUpper);

    console.log('Lower threshold rebalance test passed');
  }, 180000);

  it('should trigger rebalance in reverse direction when tick crosses upper threshold', async () => {
    // Clear previous events
    const rebalanceEvents = [];
    const newPositionEvents = [];

    service.eventManager.subscribe('PositionRebalanced', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        rebalanceEvents.push(data);
        console.log(`PositionRebalanced (reverse): old position ${data.oldPositionId}`);
      }
    });

    service.eventManager.subscribe('NewPositionCreated', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        newPositionEvents.push(data);
        console.log(`NewPositionCreated (reverse): position ${data.positionId}`);
      }
    });

    // Get current position data (from previous test's rebalance)
    const currentVault = await service.vaultDataService.getVault(testVault.vaultAddress);
    const currentPositions = Object.values(currentVault.positions);
    expect(currentPositions.length).toBe(1);

    const currentPosition = currentPositions[0];
    console.log(`Current position range: ${currentPosition.tickLower} to ${currentPosition.tickUpper}`);

    // Get token addresses
    const wethAddress = getTokenAddressForTest('WETH', 1337);
    const usdcAddress = getTokenAddressForTest('USDC', 1337);

    // Execute large swaps in reverse direction (USDC -> WETH)
    // This increases the tick value
    const swapAmount = ethers.utils.parseUnits('80000', 6); // 80k USDC
    const maxSwaps = 20;

    console.log(`Executing swaps to push price up (higher tick)...`);

    // Need to approve USDC for swaps
    const ERC20_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];
    const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, swapWallet.wallet);

    for (let i = 0; i < maxSwaps; i++) {
      // Check if rebalance occurred
      if (rebalanceEvents.length > 0) {
        console.log(`Reverse rebalance triggered after ${i + 1} swaps`);
        break;
      }

      try {
        await executeSwap(testEnv, {
          tokenIn: usdcAddress,
          tokenOut: wethAddress,
          amountIn: swapAmount,
          fee: 500,
          wallet: swapWallet.wallet,
          slippage: 100
        });

        // Get current tick
        const poolData = await adapter._fetchPoolData(
          usdcAddress,
          wethAddress,
          500,
          testEnv.hardhatServer.provider
        );
        console.log(`  Swap ${i + 1}: current tick = ${poolData.tick}`);

        // Wait for event processing
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log(`  Swap ${i + 1} failed: ${error.message.slice(0, 50)}`);
        break;
      }
    }

    // Wait for PositionRebalanced event
    await waitForCondition(
      () => rebalanceEvents.length > 0,
      60000,
      1000
    );

    // Verify rebalance occurred
    expect(rebalanceEvents.length).toBeGreaterThan(0);
    const rebalanceEvent = rebalanceEvents[0];

    expect(rebalanceEvent.vaultAddress).toBe(testVault.vaultAddress);
    expect(rebalanceEvent.oldPositionId).toBeDefined();

    // Verify new position was created
    await waitForCondition(
      () => newPositionEvents.length > 0,
      30000,
      500
    );

    // Get updated vault data
    const updatedVault = await service.vaultDataService.getVault(testVault.vaultAddress);
    const updatedPositions = Object.values(updatedVault.positions);
    expect(updatedPositions.length).toBe(1);

    const newPosition = updatedPositions[0];
    console.log(`New position range (after reverse): ${newPosition.tickLower} to ${newPosition.tickUpper}`);

    // Verify the position changed from the one created in the first test
    expect(newPosition.tickLower).not.toBe(currentPosition.tickLower);
    expect(newPosition.tickUpper).not.toBe(currentPosition.tickUpper);

    console.log('Upper threshold rebalance (reverse direction) test passed');
  }, 180000);
});
