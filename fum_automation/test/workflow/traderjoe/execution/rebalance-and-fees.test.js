/**
 * @fileoverview TJ V2.2 Rebalance and Fee Collection Test
 *
 * Combined test that validates both critical TJ V2.2 adapter execution flows:
 * 1. Fee Collection - Validates getAccruedFeesUSD() and generateClaimFeesData()
 * 2. Rebalance - Validates generateRemoveLiquidityData() and generateCreatePositionData()
 *
 * Test Flow:
 * - Setup vault with one TJ V2.2 position (wide range for aggressive swaps)
 * - Phase 1: Execute round-trip swaps to generate fees, verify FeesCollected event
 * - Phase 2: Execute large directional swaps to push activeId out of range, verify rebalance
 *
 * Run with: FORK_CHAIN=avalanche npm test -- test/workflow/traderjoe/execution/rebalance-and-fees.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../../helpers/hardhat-setup.js';
import { setupTraderJoeTestVault } from '../../../helpers/traderjoe-vault-setup.js';
import {
  setupTJSwapWallet,
  executeTraderJoeSwap,
  configureTJStrategyParameters,
  computeBinDrainAmount,
  calculateSwapsToOutOfRange
} from '../../../helpers/traderjoe-swap-utils.js';
import { waitForCondition } from '../../../helpers/wait-utils.js';
import { getTokenAddress } from 'fum_library';
import { getWrappedNativeAddress } from 'fum_library/helpers/tokenHelpers';
describe('TJ V2.2 Rebalance and Fee Collection', () => {
  let testEnv;
  let testConfig;
  let service;
  let testVault;
  let swapWallet;
  let wavaxAddress;
  let usdcAddress;

  beforeAll(async () => {
    // Setup blockchain environment (Avalanche fork via FORK_CHAIN=avalanche)
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Sync chain timestamp with real time — when run after other TJ tests,
    // hundreds of rapidly mined blocks drift the chain timestamp ahead of
    // wall-clock, causing Date.now()-based deadlines to expire on-chain.
    const provider = testEnv.hardhatServer.provider;
    const currentBlock = await provider.getBlock('latest');
    const nextTimestamp = Math.max(Math.floor(Date.now() / 1000), currentBlock.timestamp) + 1;
    await provider.send('evm_setNextBlockTimestamp', [nextTimestamp]);
    await provider.send('evm_mine', []);

    const network = await provider.getNetwork();
    const chainId = network.chainId;
    wavaxAddress = getWrappedNativeAddress(chainId);
    usdcAddress = getTokenAddress('USDC', chainId);

    // Give deployer extra balance for large swap wallet funding (deep pool needs heavy capital)
    await testEnv.hardhatServer.provider.send('hardhat_setBalance', [
      testEnv.deployer.address,
      ethers.utils.hexValue(ethers.utils.parseEther('200000'))
    ]);

    // Setup swap wallet with heavy capital for market manipulation
    // binStep=10 pool has deep liquidity — need ~$500k+ to push price 10 bins
    console.log('Setting up TJ swap wallet...');
    swapWallet = await setupTJSwapWallet(testEnv, {
      avaxAmount: '100000',
      wavaxAmount: '95000',
      usdcAmount: '0'
    });

    // Create test vault with NO positions - service will create one during setup
    console.log('Creating TJ V2.2 test vault (no initial positions)...');
    testVault = await setupTraderJoeTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'TJ V2.2 Rebalance & Fee Test',
        nativeAmount: '0',
        swapTokens: [],
        positions: [],
        tokenTransfers: {},
        targetTokens: ['USDC', 'WAVAX'],
        targetPlatforms: ['traderjoeV2_2'],
        strategy: 'bob'
      }
    );
    console.log(`TJ V2.2 Test vault created: ${testVault.vaultAddress}`);

    // Send native AVAX directly to vault (same pattern as BS-0010.test.js)
    const owner = testEnv.hardhatServer.signers[0];
    const tx = await owner.sendTransaction({
      to: testVault.vaultAddress,
      value: ethers.utils.parseEther('1290')
    });
    await tx.wait();
    console.log('  Sent 1290 AVAX to vault (~$12000 at $9.38/AVAX)');

    // Configure strategy parameters for testing
    await configureTJStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 100,       // 1% range (tight for faster creation + more concentrated fee capture)
      targetRangeLower: 100,
      emergencyExitTrigger: 1000,  // 10% (avoid triggering during aggressive swaps)
      reinvestmentTrigger: 100,    // $1.00 fee trigger (low for testing)
      reinvestmentRatio: 5000      // 50% to owner
    });

    // Initialize and start automation service
    service = new AutomationService(testConfig);
    await service.start();
    console.log('TJ V2.2 Automation service started');

    // Wait for vault discovery
    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      500
    );
    console.log('TJ V2.2 Vault discovered by service');

    // Wait for service to create position (setupVault flow)
    await waitForCondition(
      async () => {
        const vault = await service.vaultDataService.getVault(testVault.vaultAddress);
        const positions = Object.values(vault.positions || {});
        return positions.length > 0;
      },
      120000,
      1000
    );
    console.log('TJ V2.2 Position created by service');
  });

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

      // Create USDC contract for balance queries
      const usdcContract = new ethers.Contract(
        usdcAddress,
        ['function balanceOf(address) view returns (uint256)'],
        testEnv.hardhatServer.provider
      );

      // Execute round-trip swaps on binStep=10 V2.2 pool to generate fees
      // binStep=10 = 0.10% fee per swap, need large amounts to move price and generate meaningful fees
      const wavaxSwapAmount = ethers.utils.parseEther('600');
      let usdcSwapAmount;
      const maxSwaps = 60;

      console.log(`Executing up to ${maxSwaps} round-trip TJ V2.2 swaps to generate fees...`);

      for (let i = 0; i < maxSwaps; i++) {
        // Check if fees were collected
        if (feesCollectedEvents.length > 0) {
          console.log(`Fees collected after ${i} swaps`);
          break;
        }

        // Alternate swap direction
        const isWavaxToUsdc = i % 2 === 0;

        // For USDC→WAVAX legs, query actual USDC balance
        if (!isWavaxToUsdc) {
          usdcSwapAmount = await usdcContract.balanceOf(swapWallet.wallet.address);
        }

        try {
          await executeTraderJoeSwap(testEnv, {
            tokenIn: isWavaxToUsdc ? wavaxAddress : usdcAddress,
            tokenOut: isWavaxToUsdc ? usdcAddress : wavaxAddress,
            amountIn: isWavaxToUsdc ? wavaxSwapAmount : usdcSwapAmount,
            binStep: 10,
            version: 3, // V2.2
            wallet: swapWallet.wallet
          });

          if (i % 10 === 0) {
            console.log(`  Swap ${i + 1}/${maxSwaps} (${isWavaxToUsdc ? 'WAVAX→USDC' : 'USDC→WAVAX'}) completed`);
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
        180000,
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
      console.log(`Total TJ V2.2 fees collected: $${feeEvent.totalUSD.toFixed(2)}`);

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
      expect(distEvent.distributions.length).toBe(2); // Both WAVAX + USDC (burning LB tokens from active bin returns both tokens)
      expect(distEvent.failures).toBeDefined();
      expect(distEvent.failures.length).toBe(0);
      expect(distEvent.totalTokensFailed).toBe(0);
      console.log(`TJ V2.2 Fee distribution: ${distEvent.distributions.length} tokens distributed to owner, ${distEvent.failures.length} failed`);

      console.log('✅ TJ V2.2 Fee collection test passed');
    });
  });

  describe('Phase 2: Rebalance', () => {
    it('should trigger rebalance when activeId crosses threshold', async () => {
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

      // Get initial position data
      const initialVault = await service.vaultDataService.getVault(testVault.vaultAddress);
      const initialPositions = Object.values(initialVault.positions);
      expect(initialPositions.length).toBeGreaterThanOrEqual(1);

      // Get the most recent position (may have changed during Phase 1 fee collection)
      const initialPosition = initialPositions[initialPositions.length - 1];
      const initialLowerBinId = initialPosition.lowerBinId;
      const initialUpperBinId = initialPosition.upperBinId;
      const initialPositionId = initialPosition.id;
      const lbPairAddress = initialPosition.pool;

      // Calculate swap count from position width
      // Position is centered, so half-width = bins from center to edge
      const positionHalfWidth = Math.floor((initialUpperBinId - initialLowerBinId) / 2);
      const binsPerSwap = 2;
      const maxSwaps = calculateSwapsToOutOfRange(positionHalfWidth, binsPerSwap);

      console.log(`\n🔍 [TEST] ========== INITIAL STATE ==========`);
      console.log(`   Position ID: ${initialPositionId}`);
      console.log(`   Bin Range: ${initialLowerBinId} to ${initialUpperBinId}`);
      console.log(`   Half-width: ${positionHalfWidth} bins, ${maxSwaps} swaps planned (${binsPerSwap} bins/swap)`);
      console.log(`==========================================\n`);

      // Execute bin-precise swaps to push activeId out of range
      // Each swap drains exactly 2 bins + 5% overshoot into the landing bin
      console.log(`Executing TJ V2.2 swaps to push activeId out of range...`);

      for (let i = 0; i < maxSwaps; i++) {
        // Check if rebalance occurred
        if (rebalanceEvents.length > 0) {
          console.log(`Rebalance triggered after ${i + 1} swaps`);
          break;
        }

        // Wait if vault is locked (rebalance in progress — don't move the pool)
        if (service.vaultLocks[ethers.utils.getAddress(testVault.vaultAddress)]) {
          await waitForCondition(
            () => !service.vaultLocks[ethers.utils.getAddress(testVault.vaultAddress)],
            420000,
            500
          );
        }

        try {
          // Compute exact amount to drain 2 bins at current pool state
          const { amount: swapAmount, activeId, landingBinId } = await computeBinDrainAmount(
            testEnv.hardhatServer.provider,
            lbPairAddress,
            { binStep: 10, numBins: binsPerSwap, direction: 'down', tokenXDecimals: 18, tokenYDecimals: 6 }
          );

          await executeTraderJoeSwap(testEnv, {
            tokenIn: wavaxAddress,
            tokenOut: usdcAddress,
            amountIn: swapAmount,
            binStep: 10,
            version: 3, // V2.2
            wallet: swapWallet.wallet,
            slippage: 100
          });

          console.log(`  Swap ${i + 1}/${maxSwaps}: drained bins ${activeId}→${landingBinId} (${ethers.utils.formatEther(swapAmount)} WAVAX)`);

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
        180000,
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
      expect(newPosEvent.platform).toBe('traderjoeV2_2');

      // Get updated vault data
      const updatedVault = await service.vaultDataService.getVault(testVault.vaultAddress);
      const updatedPositions = Object.values(updatedVault.positions);
      expect(updatedPositions.length).toBe(1);

      const newPosition = updatedPositions[0];
      console.log(`\n🔍 [TEST] ========== FINAL STATE ==========`);
      console.log(`   Position ID: ${newPosition.id}`);
      console.log(`   Bin Range: ${newPosition.lowerBinId} to ${newPosition.upperBinId}`);
      console.log(`==========================================`);
      console.log(`\n🔍 [TEST] ========== COMPARISON ==========`);
      console.log(`   OLD Position: ${initialPositionId} [${initialLowerBinId}, ${initialUpperBinId}]`);
      console.log(`   NEW Position: ${newPosition.id} [${newPosition.lowerBinId}, ${newPosition.upperBinId}]`);
      console.log(`   LowerBinId changed: ${initialLowerBinId !== newPosition.lowerBinId} (${initialLowerBinId} → ${newPosition.lowerBinId})`);
      console.log(`   UpperBinId changed: ${initialUpperBinId !== newPosition.upperBinId} (${initialUpperBinId} → ${newPosition.upperBinId})`);
      console.log(`==========================================\n`);

      // Verify the new position has different bin bounds (centered on new price)
      expect(newPosition.lowerBinId).not.toBe(initialLowerBinId);
      expect(newPosition.upperBinId).not.toBe(initialUpperBinId);

      // Verify new position has liquidity in VDS cache (TJ uses per-bin liquidityMinted array)
      expect(newPosition.liquidityMinted).toBeDefined();
      expect(newPosition.liquidityMinted.length).toBeGreaterThan(0);
      const totalLiquidity = newPosition.liquidityMinted.reduce((sum, lm) => sum + BigInt(lm), 0n);
      expect(totalLiquidity).toBeGreaterThan(0n);

      // Verify VDS has exactly 1 position after rebalance
      expect(updatedPositions.length).toBe(1);

      console.log('✅ TJ V2.2 Rebalance test passed');
    });
  });
});
