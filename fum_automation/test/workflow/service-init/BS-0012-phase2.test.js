/**
 * @fileoverview V3 Integration test for combined phase + Phase 2 active execution
 *
 * Scenario: 0 Aligned Positions / 0 Non-Aligned Positions / 1 Aligned Token / 2 Non-Aligned Tokens
 * - Vault funded with ~1 ETH (native) + ~5 WETH + ~30000 USDC
 * - Target tokens: USDC/USDT (neither is native/wrapped native)
 * - Both ETH and WETH are non-aligned
 * - Combined phase: pools 1 ETH + 3 WETH = 4 (W)ETH → USDT (partial deficit coverage)
 * - Phase 2: excess USDC swaps to cover remaining USDT deficit
 *
 * Tests the combined phase flowing into active Phase 2 execution:
 * - Combined phase partially covers USDT deficit using consolidated ETH+WETH
 * - Phase 2 actively executes a swap with excess USDC to cover remaining deficit
 * - Validates end-to-end flow: combined phase → Phase 1 (skipped, no non-aligned left) → Phase 2
 *
 * Run with: npx vitest run test/workflow/service-init/BS-0012-phase2.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';

describe('BS-0012-phase2: Combined Phase + Phase 2 Active Execution (V3)', () => {
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
  let initialPositionsEvaluatedEvents = [];
  let bestPoolSelectedEvents = [];
  let tokenPreparationCompletedEvents = [];
  let tokensSwappedEvents = [];
  let newPositionCreatedEvents = [];

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create vault with ETH + WETH + lots of USDC, targeting USDC/USDT
    // Neither target is native/wrapped — combined phase handles ETH+WETH,
    // then Phase 2 handles excess USDC for remaining USDT deficit
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '0AP/0NP/1AT/2NT - Combined + Phase2 Test',
        wrapEthAmount: '10',       // Wrap 10 ETH → WETH on owner
        nativeEthAmount: '1',      // Send 1 native ETH to vault
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '7' }  // Swap 7 WETH → USDC (~$14000)
        ],
        positions: [],
        feeGeneratingSwaps: [],
        tokenTransfers: {
          'USDC': 100,             // All USDC to vault (~$14000)
          'WETH': 100              // All remaining WETH (~3 WETH) to vault
        },
        targetTokens: ['USDC', 'USD₮0'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );

    console.log('Test vault created at:', testVault.vaultAddress);
    console.log('Vault has: ~1 ETH (native) + ~3 WETH + USDC');
    console.log('Target: USDC/USDT (neither is native/wrapped)');
    console.log('Expected: combined phase covers partial USDT deficit, Phase 2 covers rest with excess USDC');
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

      service.eventManager.subscribe('vaultLoaded', (data) => vaultLoadedEvents.push(data));
      service.eventManager.subscribe('VaultBaselineCaptured', (data) => vaultBaselineCapturedEvents.push(data));
      service.eventManager.subscribe('VaultSetupComplete', (data) => vaultSetupCompleteEvents.push(data));
      service.eventManager.subscribe('MonitoringStarted', (data) => monitoringStartedEvents.push(data));
      service.eventManager.subscribe('VaultsLoaded', (data) => vaultsLoadedEvents.push(data));
      service.eventManager.subscribe('InitialPositionsEvaluated', (data) => initialPositionsEvaluatedEvents.push(data));
      service.eventManager.subscribe('BestPoolSelected', (data) => bestPoolSelectedEvents.push(data));
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

      expect(vault.targetTokens).toEqual(['USDC', 'USD₮0']);
      expect(vault.targetPlatforms).toEqual(['uniswapV3']);
      expect(vault.strategy.strategyId).toBe('bob');
    });

    it('should have no positions initially', () => {
      expect(vaultLoadedEvents[0].positionCount).toBe(0);
    });
  });

  // ===========================================================================
  // Token Preparation — Combined Phase + Phase 2
  // ===========================================================================

  describe('Token Preparation (Combined Phase + Phase 2)', () => {
    it('should emit TokenPreparationCompleted event', () => {
      expect(tokenPreparationCompletedEvents.length).toBeGreaterThan(0);
    });

    it('should use combined native/wrapped phase', () => {
      const event = tokenPreparationCompletedEvents[0];
      expect(event.phasesUsed.combinedNativeWrapped).toBe(true);
    });

    it('should use excess target tokens phase (Phase 2)', () => {
      const event = tokenPreparationCompletedEvents[0];
      expect(event.phasesUsed.excessTargetTokens).toBe(true);
    });

    it('should have multiple deficit swaps (combined + Phase 2)', () => {
      const event = tokenPreparationCompletedEvents[0];
      // At least 2: one from combined phase (ETH/WETH → USDT) and one from Phase 2 (USDC → USDT)
      expect(event.deficitSwapCount).toBeGreaterThanOrEqual(2);
    });

    it('should have correct target tokens', () => {
      const event = tokenPreparationCompletedEvents[0];
      const symbols = [event.targetTokens.token0.symbol, event.targetTokens.token1.symbol];
      expect(symbols).toContain('USDC');
      expect(symbols).toContain('USD₮0');
    });

    it('should have USDT deficit (no USDT in vault initially)', () => {
      const event = tokenPreparationCompletedEvents[0];

      const usdtToken = event.targetTokens.token0.symbol === 'USD₮0'
        ? event.targetTokens.token0
        : event.targetTokens.token1;

      expect(BigInt(usdtToken.deficit)).toBeGreaterThan(0n);
    });

    it('should have USDC excess (vault has more USDC than needed)', () => {
      const event = tokenPreparationCompletedEvents[0];

      const usdcToken = event.targetTokens.token0.symbol === 'USDC'
        ? event.targetTokens.token0
        : event.targetTokens.token1;

      // USDC available > required means excess exists for Phase 2
      expect(BigInt(usdcToken.available)).toBeGreaterThan(BigInt(usdcToken.required));
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
    it('should create a new USDC/USDT position on V3', () => {
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
    });

    it('should have vault in cache with 1 position', async () => {
      const vault = await service.vaultDataService.getVault(testVault.vaultAddress, false);
      expect(Object.keys(vault.positions).length).toBe(1);
    });

    it('should have near-zero ETH/WETH after deployment', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      const ethBalance = BigInt(vault.tokens.ETH || '0');
      const wethBalance = BigInt(vault.tokens.WETH || '0');
      const combined = ethBalance + wethBalance;

      // All ETH/WETH should have been swapped to USDT via combined phase
      const smallAmount = BigInt(ethers.utils.parseEther('0.1'));
      expect(combined).toBeLessThan(smallAmount);
    });

    it('should have emergency exit baseline set', () => {
      const strategy = service.strategies.get('bob');
      expect(strategy.emergencyExitBaseline[testVault.vaultAddress]).toBeDefined();
    });
  });
});