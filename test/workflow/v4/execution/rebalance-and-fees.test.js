/**
 * @fileoverview V4 Rebalance and Fee Collection Test
 *
 * Combined test that validates both critical V4 adapter execution flows:
 * 1. Fee Collection - Validates getAccruedFees() and generateCollectFeesData()
 * 2. Rebalance - Validates generateClosePositionData() and generateCreatePositionData()
 *
 * Test Flow:
 * - Setup vault with one V4 position (tight range)
 * - Phase 1: Execute swaps to generate fees, verify FeesCollected event
 * - Phase 2: Continue swaps to push price out of range, verify rebalance
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../../src/core/AutomationService.js';
import { setupV4TestBlockchain, cleanupV4TestBlockchain } from '../../../helpers/v4-hardhat-setup.js';
import { setupV4TestVault } from '../../../helpers/v4-vault-setup.js';
import {
  setupV4SwapWallet,
  executeV4Swap,
  getV4PoolData,
  configureV4StrategyParameters,
  getV4TokenAddress
} from '../../../helpers/v4-swap-utils.js';
import { waitForCondition } from '../../../helpers/wait-utils.js';

const NATIVE_ETH = ethers.constants.AddressZero;

describe('V4 Rebalance and Fee Collection', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;

  beforeAll(async () => {
    // Setup V4 blockchain
    testEnv = await setupV4TestBlockchain();
    console.log('V4 Test blockchain connected');

    // Setup swap wallet with capital for market manipulation
    console.log('Setting up V4 swap wallet...');
    swapWallet = await setupV4SwapWallet(testEnv, {
      ethAmount: '1000',
      usdcAmount: '300' // Build USDC reserves for reverse swaps
    });

    // Create test vault with NO positions - service will create one during setup
    // This avoids Graph indexing delay issues (same pattern as BS-0010-v4)
    console.log('Creating V4 test vault (no initial positions)...');
    testVault = await setupV4TestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'V4 Rebalance & Fee Test Vault',
        automationServiceAddress: testEnv.testConfig.automationServiceAddress,
        nativeEthAmount: '10',
        nativeEthToVault: '20', // V4 needs significant ETH: deficit swap + position msg.value
        swapTokens: [], // No pre-swaps
        positions: [], // NO positions - service will create during setupVault
        tokenTransfers: {},
        targetTokens: ['ETH', 'USDC'],
        targetPlatforms: ['uniswapV4'],
        strategy: 'bob'
      }
    );
    console.log(`V4 Test vault created: ${testVault.vaultAddress}`);

    // Configure strategy with parameters for testing:
    // - Wide range to stay in-range during fee collection swaps
    // - Moderate rebalance thresholds
    // - Low fee trigger for testing
    await configureV4StrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 100,       // 1% range (wider so position stays in-range during fee swaps)
      targetRangeLower: 100,
      rebalanceThresholdUpper: 200, // 2% threshold for rebalance
      rebalanceThresholdLower: 200,
      emergencyExitTrigger: 500,   // 5% (high to avoid triggering)
      reinvestmentTrigger: 100,    // $1.00 fee trigger (low for testing)
      reinvestmentRatio: 5000      // 50% to owner
    });

    // Initialize and start automation service
    service = new AutomationService(testEnv.testConfig);
    await service.start();
    console.log('V4 Automation service started');

    // Wait for vault discovery and position creation
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
  }, 240000);

  afterAll(async () => {
    if (service?.isRunning) {
      await service.stop();
    }
    await cleanupV4TestBlockchain(testEnv);
  });

  describe('Phase 1: Fee Collection', () => {
    it('should trigger fee collection when accumulated fees exceed threshold', async () => {
      // Track fee events
      const feesCollectedEvents = [];
      const feesDistributedEvents = [];

      service.eventManager.subscribe('FeesCollected', (data) => {
        if (data.vaultAddress === testVault.vaultAddress) {
          feesCollectedEvents.push(data);
          console.log(`🪙 FeesCollected: $${data.totalUsdValue?.toFixed(2) || 'N/A'}`);
        }
      });

      service.eventManager.subscribe('FeesDistributed', (data) => {
        if (data.vaultAddress === testVault.vaultAddress) {
          feesDistributedEvents.push(data);
          console.log(`💸 FeesDistributed: ${data.distributions?.length || 0} distributions`);
        }
      });

      // Get token addresses
      const usdcAddress = getV4TokenAddress('USDC', 1337);

      // Execute round-trip swaps to generate fees
      // V4 500 bps pool = 5 bps per swap
      // Strategy requires swapCount >= 50 before checking fees
      // Use smaller amounts to avoid pushing price out of range
      const ethSwapAmount = ethers.utils.parseEther('5');
      const usdcSwapAmount = ethers.utils.parseUnits('12500', 6); // ~5 ETH worth
      const maxSwaps = 60;

      console.log(`Executing up to ${maxSwaps} round-trip V4 swaps to generate fees...`);

      for (let i = 0; i < maxSwaps; i++) {
        // Check if fees were collected
        if (feesCollectedEvents.length > 0) {
          console.log(`Fees collected after ${i} swaps`);
          break;
        }

        // Alternate swap direction
        const isEthToUsdc = i % 2 === 0;

        try {
          await executeV4Swap(testEnv, {
            tokenIn: isEthToUsdc ? NATIVE_ETH : usdcAddress,
            tokenOut: isEthToUsdc ? usdcAddress : NATIVE_ETH,
            amountIn: isEthToUsdc ? ethSwapAmount : usdcSwapAmount,
            wallet: swapWallet.wallet,
            slippage: 10
          });

          if (i % 10 === 0) {
            console.log(`  Swap ${i + 1}/${maxSwaps} (${isEthToUsdc ? 'ETH→USDC' : 'USDC→ETH'}) completed`);
          }

          // Wait for event processing
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          console.log(`  Swap ${i + 1} failed: ${error.message.slice(0, 50)}`);
          // Continue trying
        }
      }

      // Wait for FeesCollected event
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
        console.log(`Total V4 fees collected: $${feeEvent.totalUsdValue.toFixed(2)}`);
      }

      // Verify fee distribution occurred
      await waitForCondition(
        () => feesDistributedEvents.length > 0,
        10000,
        500
      );

      if (feesDistributedEvents.length > 0) {
        const distEvent = feesDistributedEvents[0];
        expect(distEvent.reinvestmentRatio).toBe(50); // 50% stored as percentage
        console.log(`V4 Fee distribution: ${distEvent.distributions?.length || 0} tokens distributed`);
      }

      console.log('✅ V4 Fee collection test passed');
    }, 180000);
  });

  describe('Phase 2: Rebalance', () => {
    it('should trigger rebalance when tick crosses threshold', async () => {
      // Track rebalance events
      const rebalanceEvents = [];
      const positionsClosedEvents = [];
      const newPositionEvents = [];

      service.eventManager.subscribe('PositionRebalanced', (data) => {
        if (data.vaultAddress === testVault.vaultAddress) {
          rebalanceEvents.push(data);
          console.log(`🔄 PositionRebalanced: old position ${data.oldPositionId}`);
        }
      });

      service.eventManager.subscribe('PositionsClosed', (data) => {
        if (data.vaultAddress === testVault.vaultAddress) {
          positionsClosedEvents.push(data);
          console.log(`❌ PositionsClosed: ${data.positionIds?.length || 0} positions`);
        }
      });

      service.eventManager.subscribe('NewPositionCreated', (data) => {
        if (data.vaultAddress === testVault.vaultAddress) {
          newPositionEvents.push(data);
          console.log(`✨ NewPositionCreated: position ${data.positionId}`);
        }
      });

      // Get initial position data - position should exist from Phase 1 or beforeAll
      const initialVault = await service.vaultDataService.getVault(testVault.vaultAddress);
      const initialPositions = Object.values(initialVault.positions);
      expect(initialPositions.length).toBeGreaterThanOrEqual(1);

      // Get the most recent position (may have changed during Phase 1 fee collection)
      const initialPosition = initialPositions[initialPositions.length - 1];
      const initialTickLower = initialPosition.tickLower;
      const initialTickUpper = initialPosition.tickUpper;
      const initialPositionId = initialPosition.id;
      console.log(`Initial V4 position: ${initialPositionId}`);
      console.log(`Initial V4 position range: ${initialTickLower} to ${initialTickUpper}`);

      // Get token addresses
      const usdcAddress = getV4TokenAddress('USDC', 1337);

      // Execute LARGE swaps to push price DOWN (ETH -> USDC decreases tick)
      // Need bigger swaps to push price beyond 2% threshold
      const swapAmount = ethers.utils.parseEther('50');
      const maxSwaps = 20;

      console.log(`Executing V4 swaps to push price down (lower tick)...`);

      for (let i = 0; i < maxSwaps; i++) {
        // Check if rebalance occurred
        if (rebalanceEvents.length > 0) {
          console.log(`Rebalance triggered after ${i + 1} swaps`);
          break;
        }

        try {
          await executeV4Swap(testEnv, {
            tokenIn: NATIVE_ETH,
            tokenOut: usdcAddress,
            amountIn: swapAmount,
            wallet: swapWallet.wallet,
            slippage: 100 // High slippage for aggressive price movement
          });

          // Get current tick
          const poolData = await getV4PoolData(testEnv, NATIVE_ETH, usdcAddress, 500, 10);
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

      // Verify position was closed
      expect(positionsClosedEvents.length).toBeGreaterThan(0);
      const closedEvent = positionsClosedEvents[0];
      expect(closedEvent.vaultAddress).toBe(testVault.vaultAddress);
      expect(closedEvent.positionIds).toContain(initialPosition.id);

      // Verify new position was created
      await waitForCondition(
        () => newPositionEvents.length > 0,
        30000,
        500
      );

      expect(newPositionEvents.length).toBeGreaterThan(0);
      const newPosEvent = newPositionEvents[0];
      expect(newPosEvent.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(newPosEvent.platform).toBe('uniswapV4');

      // Get updated vault data
      const updatedVault = await service.vaultDataService.getVault(testVault.vaultAddress);
      const updatedPositions = Object.values(updatedVault.positions);
      expect(updatedPositions.length).toBe(1);

      const newPosition = updatedPositions[0];
      console.log(`New V4 position range: ${newPosition.tickLower} to ${newPosition.tickUpper}`);

      // Verify the new position has different tick bounds (centered on new price)
      expect(newPosition.tickLower).not.toBe(initialTickLower);
      expect(newPosition.tickUpper).not.toBe(initialTickUpper);

      // Verify new position is in VDS cache with liquidity
      expect(BigInt(newPosition.liquidity)).toBeGreaterThan(0n);

      console.log('✅ V4 Rebalance test passed');
    }, 180000);
  });
});
