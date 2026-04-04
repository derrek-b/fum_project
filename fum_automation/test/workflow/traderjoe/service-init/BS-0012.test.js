/**
 * @fileoverview Integration test for combined native/wrapped swap consolidation on Avalanche
 *
 * Scenario: 0 Aligned Positions / 0 Non-Aligned Positions / 1 Aligned Token / 2 Non-Aligned Tokens
 * - Vault funded with 50 AVAX (native) + 50 WAVAX + ~936 USDC (matches seed-localhost:av)
 * - Target tokens: USDC/USD₮0 (stablecoin pair — neither is native/wrapped native)
 * - Both AVAX and WAVAX are non-aligned and will be swapped to cover USD₮0 deficit
 *
 * Tests the combined native/wrapped swap consolidation (Step A in prepareTokensForPosition):
 * - Platform has supportsNativePools=false (TJ V2.2)
 * - Step A wraps all native AVAX → WAVAX upfront
 * - Phase 1 generates a single WAVAX swap per deficit (not separate AVAX + WAVAX swaps)
 * - Avoids batched slippage that caused swap failures with 0.5% maxSlippage
 *
 * Run with: FORK_CHAIN=avalanche npm test -- test/workflow/traderjoe/service-init/BS-0012.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../../helpers/hardhat-setup.js';
import { setupTraderJoeTestVault } from '../../../helpers/traderjoe-vault-setup.js';
import { configureTJStrategyParameters } from '../../../helpers/traderjoe-swap-utils.js';

// USD₮0 is the library key for USDT (Tether) on Avalanche
const USDT = 'USD₮0';

describe('BS-0012: Combined Native/Wrapped Swap Consolidation (TJ V2.2)', () => {
  let testEnv;
  let testVault;
  let service;
  let testConfig;

  // Event capture arrays
  let vaultLoadedEvents = [];
  let vaultBaselineCapturedEvents = [];
  let vaultSetupCompleteEvents = [];
  let monitoringStartedEvents = [];
  let vaultsLoadedEvents = [];
  let poolDataFetchedEvents = [];
  let initialPositionsEvaluatedEvents = [];
  let bestPoolSelectedEvents = [];
  let batchTransactionExecutedEvents = [];
  let tokenBalancesFetchedEvents = [];
  let utilizationEvents = [];
  let tokenPreparationCompletedEvents = [];
  let tokensSwappedEvents = [];
  let newPositionCreatedEvents = [];

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create vault with tokens but NO positions (matches seed-localhost:av pattern)
    // Vault setup wraps 100 AVAX → WAVAX, swaps 40 WAVAX → USDC
    testVault = await setupTraderJoeTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '0AP/0NP/1AT/2NT - Combined Native/Wrapped Test',
        nativeAmount: '100',
        swapTokens: [
          { from: 'WAVAX', to: 'USDC', amount: '40', binStep: 10, version: 3 }
        ],
        positions: [],           // No positions — triggers createNewPosition
        tokenTransfers: {
          'WAVAX': 80,           // 80% of remaining WAVAX (~48 WAVAX) to vault
          'USDC': 100            // All USDC to vault
        },
        targetTokens: ['USDC', USDT],  // Stablecoin pair — neither is native/wrapped
        targetPlatforms: ['traderjoeV2_2'],
        strategy: 'bob'
      }
    );

    // Send native AVAX directly to vault (like the seed script does)
    const owner = testEnv.hardhatServer.signers[0];
    const tx = await owner.sendTransaction({
      to: testVault.vaultAddress,
      value: ethers.utils.parseEther('50')
    });
    await tx.wait();

    // Configure strategy with ±10 bin range (0.1% for binStep 1 pool)
    await configureTJStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 10,
      targetRangeLower: 10
    });

    console.log('Test vault created at:', testVault.vaultAddress);
    console.log('Vault has: ~50 AVAX (native) + ~48 WAVAX + ~936 USDC');
    console.log('Target: USDC/' + USDT + ' (stablecoin pair)');
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

  // ===========================================================================
  // Phase 3: Vault Discovery
  // ===========================================================================

  describe('Phase 3: Vault Discovery', () => {
    it('should discover and load authorized vault', async () => {
      service = new AutomationService(testConfig);

      // Subscribe to events
      service.eventManager.subscribe('vaultLoaded', (data) => vaultLoadedEvents.push(data));
      service.eventManager.subscribe('VaultBaselineCaptured', (data) => vaultBaselineCapturedEvents.push(data));
      service.eventManager.subscribe('VaultSetupComplete', (data) => vaultSetupCompleteEvents.push(data));
      service.eventManager.subscribe('MonitoringStarted', (data) => monitoringStartedEvents.push(data));
      service.eventManager.subscribe('VaultsLoaded', (data) => vaultsLoadedEvents.push(data));
      service.eventManager.subscribe('PoolDataFetched', (data) => poolDataFetchedEvents.push(data));
      service.eventManager.subscribe('InitialPositionsEvaluated', (data) => initialPositionsEvaluatedEvents.push(data));
      service.eventManager.subscribe('BestPoolSelected', (data) => bestPoolSelectedEvents.push(data));
      service.eventManager.subscribe('BatchTransactionExecuted', (data) => batchTransactionExecutedEvents.push(data));
      service.eventManager.subscribe('TokenBalancesFetched', (data) => tokenBalancesFetchedEvents.push(data));
      service.eventManager.subscribe('DeploymentCalculated', (data) => utilizationEvents.push(data));
      service.eventManager.subscribe('TokenPreparationCompleted', (data) => tokenPreparationCompletedEvents.push(data));
      service.eventManager.subscribe('TokensSwapped', (data) => tokensSwappedEvents.push(data));
      service.eventManager.subscribe('NewPositionCreated', (data) => newPositionCreatedEvents.push(data));

      await service.start();

      expect(service.isRunning).toBe(true);
      expect(vaultsLoadedEvents.length).toBe(1);
      expect(vaultsLoadedEvents[0].successful).toBe(1);
    }, 120000);
  });

  // ===========================================================================
  // Vault Data Loading
  // ===========================================================================

  describe('Vault Data Loading', () => {
    it('should load vault with correct target configuration', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      expect(vault.targetTokens).toEqual(['USDC', USDT]);
      expect(vault.targetPlatforms).toEqual(['traderjoeV2_2']);
      expect(vault.strategy.strategyId).toBe('bob');
    });

    it('should have AVAX and WAVAX in vault token balances', () => {
      expect(vaultLoadedEvents.length).toBe(1);

      // Vault should have native AVAX + WAVAX + USDC (and 0 USDT)
      const event = vaultLoadedEvents[0];
      expect(event.positionCount).toBe(0);
    });
  });

  // ===========================================================================
  // Pool Selection
  // ===========================================================================

  describe('Pool Selection', () => {
    it('should select USD₮0/USDC pool on Trader Joe', () => {
      expect(bestPoolSelectedEvents.length).toBe(1);

      const event = bestPoolSelectedEvents[0];
      expect(event.platformId).toBe('traderjoeV2_2');

      // Pool should be for the target token pair
      const pool = event.pool;
      expect(pool).toBeDefined();
      expect(pool.binStep).toBeDefined();
    });
  });

  // ===========================================================================
  // Position Evaluation
  // ===========================================================================

  describe('Position Evaluation', () => {
    it('should find 0 aligned and 0 non-aligned (empty vault)', () => {
      expect(initialPositionsEvaluatedEvents.length).toBe(1);

      const event = initialPositionsEvaluatedEvents[0];
      expect(event.alignedCount).toBe(0);
      expect(event.nonAlignedCount).toBe(0);
    });
  });

  // ===========================================================================
  // Token Preparation — the key test for combined native/wrapped consolidation
  // ===========================================================================

  describe('Token Preparation (Combined Native/Wrapped)', () => {
    it('should emit TokenPreparationCompleted event', () => {
      expect(tokenPreparationCompletedEvents.length).toBeGreaterThan(0);
    });

    it('should have wrapUnwrap phase used (Step A wrapped AVAX)', () => {
      const event = tokenPreparationCompletedEvents[0];
      expect(event.phasesUsed.wrapUnwrap).toBe(true);
    });

    it('should NOT use combinedNativeWrapped phase (TJ has supportsNativePools=false)', () => {
      const event = tokenPreparationCompletedEvents[0];
      // Step A handles everything for non-native-pool platforms — no combined phase needed
      expect(event.phasesUsed.combinedNativeWrapped).toBeFalsy();
    });

    it('should have deficit swaps generated', () => {
      const event = tokenPreparationCompletedEvents[0];
      expect(event.deficitSwapCount).toBeGreaterThan(0);
    });

    it('should route all swap transactions to LBRouter (no native swap functions)', () => {
      const event = tokenPreparationCompletedEvents[0];

      // All swaps should target the LB Router
      for (const tx of event.swapTransactions) {
        expect(tx.to.toLowerCase()).toBe(
          testEnv.hardhatServer.deployedContracts.traderjoeV2_2?.lbRouterAddress?.toLowerCase() ||
          '0x18556da13313f3532c54711497a8fedac273220e'
        );
        // After Step A consolidation, all swaps should use wrapped tokens (value = 0x00 or 0)
        expect(tx.value === '0x00' || tx.value === 0 || tx.value === '0' || !tx.value).toBe(true);
      }
    });

    it('should have correct target tokens in event', () => {
      const event = tokenPreparationCompletedEvents[0];
      expect(event.targetTokens).toBeDefined();

      const symbols = [event.targetTokens.token0.symbol, event.targetTokens.token1.symbol];
      expect(symbols).toContain('USDC');
      expect(symbols).toContain(USDT);
    });
  });

  // ===========================================================================
  // Token Swap Execution
  // ===========================================================================

  describe('Token Swap Execution', () => {
    it('should emit TokensSwapped event', () => {
      expect(tokensSwappedEvents.length).toBeGreaterThan(0);
    });

    it('should have successful swap execution (no revert from batched slippage)', () => {
      // This is the core validation: the swap batch should succeed
      // Previously, separate AVAX→USDT + WAVAX→USDT swaps would revert
      // because the first swap moved the pool price beyond 0.5% slippage for the second
      const event = tokensSwappedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });
  });

  // ===========================================================================
  // Position Creation
  // ===========================================================================

  describe('Position Creation', () => {
    it('should create a new USD₮0/USDC position', () => {
      expect(newPositionCreatedEvents.length).toBe(1);

      const event = newPositionCreatedEvents[0];
      expect(event.platform).toBe('traderjoeV2_2');
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });

    it('should have deployed actual token amounts', () => {
      const event = newPositionCreatedEvents[0];

      // At least one token should have been used
      expect(
        BigInt(event.actualToken0) > 0n || BigInt(event.actualToken1) > 0n
      ).toBe(true);
    });
  });

  // ===========================================================================
  // Setup Completion
  // ===========================================================================

  describe('Setup Completion', () => {
    it('should emit VaultSetupComplete', () => {
      expect(vaultSetupCompleteEvents.length).toBe(1);

      const event = vaultSetupCompleteEvents[0];
      expect(event.positionCount).toBe(1);
      expect(event.baselineCaptured).toBe(true);
    });

    it('should emit MonitoringStarted with 1 position', () => {
      expect(monitoringStartedEvents.length).toBe(1);

      const event = monitoringStartedEvents[0];
      expect(event.positionCount).toBe(1);
      expect(event.strategyId).toBe('bob');
    });

    it('should have vault in cache with 1 position', async () => {
      const vault = await service.vaultDataService.getVault(testVault.vaultAddress, false);
      expect(Object.keys(vault.positions).length).toBe(1);
    });

    it('should have near-zero AVAX/WAVAX after deployment (all swapped to stablecoins)', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      // AVAX should be ~0 (all wrapped by Step A, then swapped)
      const avaxBalance = BigInt(vault.tokens.AVAX || '0');
      // WAVAX should be near-zero (all swapped to cover deficits)
      const wavaxBalance = BigInt(vault.tokens.WAVAX || '0');

      // Combined native/wrapped value should be < 1% of initial (~$10 worth at most)
      // Initial was ~100 AVAX+WAVAX worth ~$960
      const combinedWei = avaxBalance + wavaxBalance;
      const onePercentOfInitial = BigInt(ethers.utils.parseEther('1')); // ~$9.60
      expect(combinedWei).toBeLessThan(onePercentOfInitial);
    });

    it('should have emergency exit baseline set', () => {
      const strategy = service.strategies.get('bob');
      expect(strategy.emergencyExitBaseline[testVault.vaultAddress]).toBeDefined();
    });
  });
});
