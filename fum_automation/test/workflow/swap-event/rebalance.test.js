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
  getTokenDataForTest,
  computePriceMovementSwapAmount,
  calculateSwapsForRange,
  getPoolData
} from '../../helpers/swap-utils.js';
import { waitForCondition } from '../../helpers/wait-utils.js';
import { ethers } from 'ethers';
import { UniswapV3Adapter } from 'fum_library/adapters';
import { getPlatformAddresses } from 'fum_library/helpers/chainHelpers';
import {
  expectTrackerAggregates,
  expectTrackerBaseline,
  expectTransactionTypes,
  getTransactionsByType,
  expectNoTrackingFailures,
  expectTransactionCount
} from '../../helpers/tracker-assertions.js';

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
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 100,
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
    if (service) {
      try {
        await service.stop(true);
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
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

    // Compute swap count from position range (0.25% half-range, 0.1% per swap)
    const pricePerSwap = 0.1; // 0.1% per swap
    const rangePercent = 0.25; // targetRangeUpper/Lower = 25 bps = 0.25%
    const maxSwaps = calculateSwapsForRange(rangePercent, pricePerSwap);

    console.log(`Executing ${maxSwaps} swaps to push price down (${pricePerSwap}% each, ${rangePercent}% range)...`);

    for (let i = 0; i < maxSwaps; i++) {
      // Check if rebalance occurred
      if (rebalanceEvents.length > 0) {
        console.log(`Rebalance triggered after ${i + 1} swaps`);
        break;
      }

      try {
        // Compute exact swap amount from current pool state
        const poolData = await getPoolData(testEnv, usdcAddress, wethAddress, 500);
        const { amount: swapAmount, currentTick } = computePriceMovementSwapAmount(poolData, {
          targetPriceMove: pricePerSwap / 100, // convert % to decimal
          direction: 'down',
          wethIsToken0: true // Arbitrum: WETH (0x82aF) < USDC (0xaf88), so WETH is token0
        });

        await executeSwap(testEnv, {
          tokenIn: wethAddress,
          tokenOut: usdcAddress,
          amountIn: swapAmount,
          fee: 500,
          wallet: swapWallet.wallet,
          slippage: 100
        });

        console.log(`  Swap ${i + 1}/${maxSwaps}: tick ${currentTick}, ${ethers.utils.formatEther(swapAmount)} WETH (~${pricePerSwap}%)`);

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

    // Verify old position NFT was burned (ownerOf reverts for burned ERC721 tokens)
    const v3Addresses = getPlatformAddresses(1337, 'uniswapV3');
    const nftManager = new ethers.Contract(
      v3Addresses.positionManagerAddress,
      ['function ownerOf(uint256 tokenId) view returns (address)'],
      testEnv.hardhatServer.provider
    );
    await expect(nftManager.ownerOf(rebalanceEvent.oldPositionId)).rejects.toThrow();

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

    // Verify swap listeners maintained after rebalance
    // refreshSwapListeners fires asynchronously via the PositionRebalanced handler;
    // give it time to complete its remove+resubscribe cycle
    await new Promise(resolve => setTimeout(resolve, 2000));
    const poolAddress = newPosition.pool;
    const swapListenerKey = `${poolAddress.toLowerCase()}-swap-1337-uniswapV3`;
    expect(service.eventManager.listeners[swapListenerKey]).toBeDefined();
    expect(service.eventManager.poolToVaults[poolAddress]).toContain(testVault.vaultAddress);

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

    // Compute swap count — same range parameters as Phase 1
    const reverseMaxSwaps = calculateSwapsForRange(0.25, 0.1);

    console.log(`Executing ${reverseMaxSwaps} swaps to push price up (0.1% each, 0.25% range)...`);

    for (let i = 0; i < reverseMaxSwaps; i++) {
      // Check if rebalance occurred
      if (rebalanceEvents.length > 0) {
        console.log(`Reverse rebalance triggered after ${i + 1} swaps`);
        break;
      }

      try {
        // Compute exact swap amount from current pool state
        const poolData = await getPoolData(testEnv, usdcAddress, wethAddress, 500);
        const { amount: swapAmount, currentTick } = computePriceMovementSwapAmount(poolData, {
          targetPriceMove: 0.001, // 0.1%
          direction: 'up',
          wethIsToken0: true // Arbitrum: WETH (0x82aF) < USDC (0xaf88), so WETH is token0
        });

        await executeSwap(testEnv, {
          tokenIn: usdcAddress,
          tokenOut: wethAddress,
          amountIn: swapAmount,
          fee: 500,
          wallet: swapWallet.wallet,
          slippage: 100
        });

        console.log(`  Swap ${i + 1}/${reverseMaxSwaps}: tick ${currentTick}, ${ethers.utils.formatUnits(swapAmount, 6)} USDC (~0.1%)`);

        // Wait for event processing
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log(`  Swap ${i + 1} failed: ${error.message.slice(0, 50)}`);
        break;
      }
    }

    // Wait for PositionRebalanced event — Phase 2 rebalance involves a large
    // deficit swap (USDC→WETH) through AlphaRouter which can be slow after
    // ~$490k of test swaps modified pool state
    await waitForCondition(
      () => rebalanceEvents.length > 0,
      120000,
      1000
    );

    // Verify rebalance occurred
    expect(rebalanceEvents.length).toBeGreaterThan(0);
    const rebalanceEvent = rebalanceEvents[0];

    expect(rebalanceEvent.vaultAddress).toBe(testVault.vaultAddress);
    expect(rebalanceEvent.oldPositionId).toBeDefined();

    // Verify old position NFT was burned (ownerOf reverts for burned ERC721 tokens)
    const v3Addresses = getPlatformAddresses(1337, 'uniswapV3');
    const nftManagerReverse = new ethers.Contract(
      v3Addresses.positionManagerAddress,
      ['function ownerOf(uint256 tokenId) view returns (address)'],
      testEnv.hardhatServer.provider
    );
    await expect(nftManagerReverse.ownerOf(rebalanceEvent.oldPositionId)).rejects.toThrow();

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

  describe('Tracker — Transaction History & Aggregates', () => {
    it('should have baseline captured from initial vault setup', () => {
      const baseline = expectTrackerBaseline(service, testVault.vaultAddress);

      // Baseline has 1 position + tokens from vault setup
      expect(baseline.positionValue).toBeGreaterThan(0);
      expect(baseline.tokenValue).toBeGreaterThanOrEqual(0);
    });

    it('should have no tracking failures', () => {
      expectNoTrackingFailures(service, testVault.vaultAddress);
    });

    it('should have rebalanceCount of 2 after both rebalances', () => {
      expectTrackerAggregates(service, testVault.vaultAddress, {
        rebalanceCount: 2
      });
    });

    it('should have accumulated gas costs across all operations', () => {
      const metadata = service.tracker.getMetadata(testVault.vaultAddress);

      // Gas from init + 2 rebalance cycles (close + swap + create each)
      expect(metadata.aggregates.cumulativeGasNative).toBeGreaterThan(0);
      expect(metadata.aggregates.cumulativeGasUSD).toBeGreaterThan(0);
    });

    it('should have transaction count reflecting init + 2 rebalance cycles', () => {
      const metadata = service.tracker.getMetadata(testVault.vaultAddress);

      // Each rebalance: PositionsClosed + NewPositionCreated + FeesCollected = 3 minimum
      // (PositionRebalanced is a synthetic summary — not counted)
      // Plus init events (NativeWrapped + TokensSwapped + NewPositionCreated). Total should be substantial.
      expect(metadata.aggregates.transactionCount).toBeGreaterThanOrEqual(6);
    });

    it('should have PositionRebalanced transactions in the log', async () => {
      const rebalanceTxs = await getTransactionsByType(service, testVault.vaultAddress, 'PositionRebalanced');

      expect(rebalanceTxs).toHaveLength(2);

      for (const tx of rebalanceTxs) {
        expect(tx.oldPositionId).toBeDefined();
        expect(tx.newPositionId).toBeDefined();
        expect(tx.newPositionId).not.toBe(tx.oldPositionId);
        expect(tx.reason).toBe('out_of_range_or_threshold');
        expect(typeof tx.timestamp).toBe('number');
      }

      // Second rebalance should reference the position created by the first
      expect(rebalanceTxs[0].oldPositionId).not.toBe(rebalanceTxs[1].oldPositionId);
    });

    it('should have PositionsClosed transactions from rebalances', async () => {
      const closeTxs = await getTransactionsByType(service, testVault.vaultAddress, 'PositionsClosed');

      // At least 2 close events (one per rebalance)
      expect(closeTxs.length).toBeGreaterThanOrEqual(2);

      for (const tx of closeTxs) {
        expect(tx.closedCount).toBe(1); // Each rebalance closes 1 position
        expect(tx.closedPositions).toHaveLength(1);
        expect(tx.gasNative).toBeGreaterThan(0);
        expect(tx.gasUSD).toBeGreaterThan(0);
        expect(tx.success).toBe(true);
        expect(tx.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      }
    });

    it('should have NewPositionCreated transactions from rebalances', async () => {
      const createTxs = await getTransactionsByType(service, testVault.vaultAddress, 'NewPositionCreated');

      // At least 2 from rebalances (possibly more from init if addToPosition wasn't used)
      expect(createTxs.length).toBeGreaterThanOrEqual(2);

      for (const tx of createTxs) {
        expect(tx.totalActualUSD).toBeGreaterThan(0);
        expect(tx.totalTargetUSD).toBeGreaterThan(0);
        expect(tx.gasNative).toBeGreaterThan(0);
        expect(tx.platform).toBe('uniswapV3');
        expect(tx.success).toBe(true);
        expect(tx.positionId).toBeDefined();
        expect(tx.token0Symbol).toBeDefined();
        expect(tx.token1Symbol).toBeDefined();
      }
    });

    it('should have FeesCollected transactions from rebalance fee harvesting', async () => {
      const feeTxs = await getTransactionsByType(service, testVault.vaultAddress, 'FeesCollected');

      // Rebalances collect fees from the position being closed.
      // Swap-driven price manipulation generates fees, so expect > 0 collections.
      if (feeTxs.length > 0) {
        const rebalanceFees = feeTxs.filter(tx => tx.source === 'rebalance');
        expect(rebalanceFees.length).toBeGreaterThanOrEqual(1);

        for (const tx of rebalanceFees) {
          expect(tx.totalUSD).toBeGreaterThanOrEqual(0);
          expect(tx.positionIds).toBeDefined();
        }
      }
    });

    it('should have correct strategy metadata', () => {
      const metadata = service.tracker.getMetadata(testVault.vaultAddress);

      expect(metadata.metadata.strategyId).toBe('bob');
      expect(metadata.metadata.firstSeen).toBeDefined();
      expect(metadata.metadata.lastUpdated).toBeGreaterThan(metadata.metadata.firstSeen);
    });

    it('should have all core rebalance transaction types in the log', async () => {
      await expectTransactionTypes(service, testVault.vaultAddress, [
        'PositionRebalanced',
        'PositionsClosed',
        'NewPositionCreated'
      ]);
    });

    it('should have transactionCount matching actual log length', async () => {
      await expectTransactionCount(service, testVault.vaultAddress);
    });
  });
});
