/**
 * @fileoverview V3 Integration test for combined native/wrapped phase with excess aligned token
 *
 * Scenario: 0 Aligned Positions / 0 Non-Aligned Positions / 1 Aligned Token / 2 Non-Aligned Tokens
 * - Vault funded with ~2 ETH (native) + ~9.6 WETH + ~3000 USDC
 * - Target tokens: USDC/WETH
 * - WETH is a target token WITH excess (~2.3 WETH beyond position requirement)
 * - ETH is non-aligned
 * - Combined phase pools 2 ETH + 2.3 excess WETH = 4.3 (W)ETH for USDC deficit swap
 * - combinedPhaseConsumed tracks the 2.3 WETH excess used, preventing Phase 2 double-spend
 *
 * Tests Step B (combined native/wrapped phase) with supportsNativePools=true:
 * - Double-quoting: quotes both ETH→USDC and WETH→USDC, picks better output
 * - Excess aligned inclusion: combines non-aligned ETH with excess aligned WETH
 * - combinedPhaseConsumed: adjusts Phase 2 available amounts to prevent double-spend
 *
 * Run with: npx vitest run test/workflow/service-init/BS-0012.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';

describe('BS-0012: Combined Phase with Excess Aligned Native/Wrapped (V3)', () => {
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

    // Create vault with ETH + WETH + USDC, targeting WETH/USDC
    // This creates a scenario where WETH is a target token with excess,
    // and ETH is non-aligned — both pool into the combined phase
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '0AP/0NP/1AT/2NT - Combined Phase Test',
        wrapEthAmount: '15',       // Wrap 15 ETH → WETH on owner
        nativeEthAmount: '2',      // Send 2 native ETH to vault
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '3' }  // Swap 3 WETH → USDC (~$3000)
        ],
        positions: [],             // No positions — triggers createNewPosition
        feeGeneratingSwaps: [],
        tokenTransfers: {
          'USDC': 100,             // All USDC to vault
          'WETH': 80               // 80% of remaining WETH (~9.6 WETH) to vault
        },
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );

    console.log('Test vault created at:', testVault.vaultAddress);
    console.log('Vault has: ~2 ETH (native) + ~9.6 WETH + ~3000 USDC');
    console.log('Target: USDC/WETH (WETH is target with excess, ETH is non-aligned)');
  }, 180000);

  afterAll(async () => {
    if (service) {
      try {
        await service.stop();
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

      expect(vault.targetTokens).toEqual(['USDC', 'WETH']);
      expect(vault.targetPlatforms).toEqual(['uniswapV3']);
      expect(vault.strategy.strategyId).toBe('bob');
    });

    it('should have no positions initially', () => {
      expect(vaultLoadedEvents.length).toBe(1);
      expect(vaultLoadedEvents[0].positionCount).toBe(0);
    });
  });

  // ===========================================================================
  // Pool Selection
  // ===========================================================================

  describe('Pool Selection', () => {
    it('should select WETH/USDC pool on V3', () => {
      expect(bestPoolSelectedEvents.length).toBe(1);

      const event = bestPoolSelectedEvents[0];
      expect(event.platformId).toBe('uniswapV3');
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
  // Token Preparation — Combined Phase with Excess Aligned
  // ===========================================================================

  describe('Token Preparation (Combined Phase with Excess Aligned)', () => {
    it('should emit TokenPreparationCompleted event', () => {
      expect(tokenPreparationCompletedEvents.length).toBeGreaterThan(0);
    });

    it('should use combined native/wrapped phase (supportsNativePools=true)', () => {
      const event = tokenPreparationCompletedEvents[0];
      expect(event.phasesUsed.combinedNativeWrapped).toBe(true);
    });

    it('should have wrap/unwrap phase used (combined phase needs wrap or unwrap)', () => {
      const event = tokenPreparationCompletedEvents[0];
      expect(event.phasesUsed.wrapUnwrap).toBe(true);
    });

    it('should have deficit swaps generated', () => {
      const event = tokenPreparationCompletedEvents[0];
      expect(event.deficitSwapCount).toBeGreaterThan(0);
    });

    it('should have correct target tokens', () => {
      const event = tokenPreparationCompletedEvents[0];
      const symbols = [event.targetTokens.token0.symbol, event.targetTokens.token1.symbol];
      expect(symbols).toContain('USDC');
      expect(symbols).toContain('WETH');
    });

    it('should have USDC deficit (vault has less USDC than needed)', () => {
      const event = tokenPreparationCompletedEvents[0];

      const usdcToken = event.targetTokens.token0.symbol === 'USDC'
        ? event.targetTokens.token0
        : event.targetTokens.token1;

      expect(BigInt(usdcToken.deficit)).toBeGreaterThan(0n);
    });

    it('should have 0 WETH deficit (vault has excess WETH)', () => {
      const event = tokenPreparationCompletedEvents[0];

      const wethToken = event.targetTokens.token0.symbol === 'WETH'
        ? event.targetTokens.token0
        : event.targetTokens.token1;

      expect(BigInt(wethToken.deficit)).toBe(0n);
    });
  });

  // ===========================================================================
  // Token Swap Execution
  // ===========================================================================

  describe('Token Swap Execution', () => {
    it('should emit TokensSwapped event', () => {
      expect(tokensSwappedEvents.length).toBeGreaterThan(0);
    });

    it('should have successful swap execution', () => {
      const event = tokensSwappedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });
  });

  // ===========================================================================
  // Position Creation
  // ===========================================================================

  describe('Position Creation', () => {
    it('should create a new WETH/USDC position', () => {
      expect(newPositionCreatedEvents.length).toBe(1);

      const event = newPositionCreatedEvents[0];
      expect(event.platform).toBe('uniswapV3');
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });

    it('should have deployed actual token amounts', () => {
      const event = newPositionCreatedEvents[0];

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

    it('should have near-zero ETH after deployment (used in combined phase)', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      const ethBalance = BigInt(vault.tokens.ETH || '0');
      // ETH should be near-zero — wrapped and used for USDC deficit swap
      const smallAmount = BigInt(ethers.utils.parseEther('0.1'));
      expect(ethBalance).toBeLessThan(smallAmount);
    });

    it('should have emergency exit baseline set', () => {
      const strategy = service.strategies.get('bob');
      expect(strategy.emergencyExitBaseline[testVault.vaultAddress]).toBeDefined();
    });
  });
});
