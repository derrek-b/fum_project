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
  executeV4PoolSwap,
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
    // No USDC pre-funding needed - round-trip swaps use what they receive
    console.log('Setting up V4 swap wallet...');
    swapWallet = await setupV4SwapWallet(testEnv, {
      ethAmount: '1000',
      usdcAmount: '0'
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
    // - Wide range (5%) to accommodate aggressive price swaps and ensure different bounds after rebalance
    // - High emergency exit trigger (10%) to avoid triggering during test swaps
    // - Low fee trigger for testing
    await configureV4StrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 500,       // 5% range (wide for aggressive test swaps)
      targetRangeLower: 500,
      emergencyExitTrigger: 1000,  // 10% (avoid triggering during aggressive swaps)
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
          console.log(`🪙 FeesCollected: $${data.totalUSD?.toFixed(2) || 'N/A'}`);
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

      // Create USDC contract for balance queries
      const usdcContract = new ethers.Contract(
        usdcAddress,
        ['function balanceOf(address) view returns (uint256)'],
        testEnv.hardhatServer.provider
      );

      // Execute round-trip swaps to generate fees
      // V4 500 bps pool = 5 bps per swap
      // Strategy requires swapCount >= 50 before checking fees
      // Use smaller amounts to avoid pushing price out of range
      const ethSwapAmount = ethers.utils.parseEther('5');
      let usdcSwapAmount; // Will be set dynamically based on actual balance received
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

        // For USDC→ETH swaps, use the actual USDC balance from the previous swap
        if (!isEthToUsdc) {
          usdcSwapAmount = await usdcContract.balanceOf(swapWallet.wallet.address);
        }

        try {
          await executeV4PoolSwap(testEnv, {
            tokenIn: isEthToUsdc ? NATIVE_ETH : usdcAddress,
            tokenOut: isEthToUsdc ? usdcAddress : NATIVE_ETH,
            amountIn: isEthToUsdc ? ethSwapAmount : usdcSwapAmount,
            wallet: swapWallet.wallet,
            fee: 500,        // Target the 500bp pool where position lives
            tickSpacing: 10,
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
      expect(feeEvent.totalUSD).toBeDefined();
      expect(feeEvent.totalUSD).toBeGreaterThan(0);
      console.log(`Total V4 fees collected: $${feeEvent.totalUSD.toFixed(2)}`);

      // Verify fee distribution occurred
      await waitForCondition(
        () => feesDistributedEvents.length > 0,
        10000,
        500
      );

      expect(feesDistributedEvents.length).toBeGreaterThan(0);
      const distEvent = feesDistributedEvents[0];
      expect(distEvent.reinvestmentRatio).toBe(50); // 50% stored as percentage
      expect(distEvent.distributions).toBeDefined();
      expect(distEvent.distributions.length).toBe(2); // ETH + USDC
      expect(distEvent.failures).toBeDefined();
      expect(distEvent.failures.length).toBe(0); // All distributions should succeed
      expect(distEvent.totalTokensFailed).toBe(0);
      console.log(`V4 Fee distribution: ${distEvent.distributions.length} tokens distributed to owner, ${distEvent.failures.length} failed`);

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
          console.log(`❌ PositionsClosed: ${data.closedCount || 0} positions`);
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
      console.log(`\n🔍 [TEST] ========== INITIAL STATE ==========`);
      console.log(`   Position ID: ${initialPositionId}`);
      console.log(`   Tick Range: ${initialTickLower} to ${initialTickUpper}`);
      console.log(`   Current Tick: ${initialPosition.currentTick || 'N/A'}`);
      console.log(`==========================================\n`);

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
          await executeV4PoolSwap(testEnv, {
            tokenIn: NATIVE_ETH,
            tokenOut: usdcAddress,
            amountIn: swapAmount,
            wallet: swapWallet.wallet,
            fee: 500,        // Target the 500bp pool where position lives
            tickSpacing: 10,
            slippage: 100 // High slippage for aggressive price movement
          });

          // Get current tick
          const poolData = await getV4PoolData(testEnv, NATIVE_ETH, usdcAddress, 500, 10);
          const tickDelta = poolData.tick - (initialPosition.currentTick || poolData.tick);
          console.log(`  Swap ${i + 1}: current tick = ${poolData.tick} (delta from initial: ${tickDelta})`);

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
      expect(closedEvent.closedPositions).toBeDefined();
      expect(closedEvent.closedPositions.length).toBeGreaterThan(0);
      const closedPositionIds = closedEvent.closedPositions.map(p => p.positionId);
      expect(closedPositionIds).toContain(initialPosition.id);

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
      console.log(`\n🔍 [TEST] ========== FINAL STATE ==========`);
      console.log(`   Position ID: ${newPosition.id}`);
      console.log(`   Tick Range: ${newPosition.tickLower} to ${newPosition.tickUpper}`);
      console.log(`   Current Tick: ${newPosition.currentTick || 'N/A'}`);
      console.log(`==========================================`);
      console.log(`\n🔍 [TEST] ========== COMPARISON ==========`);
      console.log(`   OLD Position: ${initialPositionId} [${initialTickLower}, ${initialTickUpper}]`);
      console.log(`   NEW Position: ${newPosition.id} [${newPosition.tickLower}, ${newPosition.tickUpper}]`);
      console.log(`   TickLower changed: ${initialTickLower !== newPosition.tickLower} (${initialTickLower} → ${newPosition.tickLower})`);
      console.log(`   TickUpper changed: ${initialTickUpper !== newPosition.tickUpper} (${initialTickUpper} → ${newPosition.tickUpper})`);
      console.log(`==========================================\n`);

      // Verify the new position has different tick bounds (centered on new price)
      expect(newPosition.tickLower).not.toBe(initialTickLower);
      expect(newPosition.tickUpper).not.toBe(initialTickUpper);

      // Verify new position is in VDS cache with liquidity
      expect(BigInt(newPosition.liquidity)).toBeGreaterThan(0n);

      console.log('✅ V4 Rebalance test passed');
    }, 180000);
  });
});
