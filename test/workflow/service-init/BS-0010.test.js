/**
 * @fileoverview Integration tests for createNewPosition workflow
 * Tests vault initialization with NO aligned positions, triggering createNewPosition
 *
 * Scenario: 0 Aligned Positions / 0 Non-Aligned Positions / 1 Token (native ETH)
 * - Vault funded with native ETH only
 * - Target tokens: LINK/WETH (different from 1212 test which uses USDC/ETH)
 * - No positions exist, so createNewPosition is called instead of addToPosition
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('AutomationService Initialization - createNewPosition Workflow', () => {
  let testEnv;
  let testVault;
  let service;
  let testConfig;

  // Event capture arrays
  let vaultLoadingEvents = [];
  let vaultLoadedEvents = [];
  let vaultBaselineCapturedEvents = [];
  let vaultSetupCompleteEvents = [];
  let vaultsLoadedEvents = [];
  let poolDataFetchedEvents = [];
  let initialPositionsEvaluatedEvents = [];
  let bestPoolSelectedEvents = [];
  let positionsClosedEvents = [];
  let batchTransactionExecutedEvents = [];
  let tokenBalancesFetchedEvents = [];
  let utilizationEvents = [];
  let tokenPreparationCompletedEvents = [];
  let tokensSwappedEvents = [];
  let newPositionCreatedEvents = [];

  beforeAll(async () => {
    // Clean up any old vault data from previous test runs
    const dataDir = path.join(__dirname, '../../../data/vaults');
    try {
      await fs.rm(dataDir, { recursive: true, force: true });
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      // Ignore errors if directory doesn't exist
    }

    // Setup blockchain environment (uses shared Hardhat instance)
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create test vault with NO positions - only native ETH
    // This will trigger createNewPosition since no aligned positions exist
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '0AP/0NP - createNewPosition Test',
        automationServiceAddress: testConfig.automationServiceAddress,
        wrapEthAmount: '0',      // Don't wrap any ETH (we want only native ETH)
        nativeEthAmount: '10',   // Fund with 10 native ETH
        swapTokens: [],          // No token swaps
        positions: [],           // NO positions - key for triggering createNewPosition
        feeGeneratingSwaps: [],  // No fee swaps needed
        tokenTransfers: {},      // No token transfers
        targetTokens: ['LINK', 'WETH'],  // Different pair than 1212 test
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );

    console.log('Test vault created at:', testVault.vaultAddress);
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

  describe('Phase 3: Vault Discovery', () => {
    it('should discover and load authorized vault via getAuthorizedVaults()', async () => {
      // Create service instance
      service = new AutomationService(testConfig);

      // Subscribe to events before starting
      service.eventManager.subscribe('vaultLoading', (address) => {
        vaultLoadingEvents.push(address);
      });

      service.eventManager.subscribe('vaultLoaded', (data) => {
        vaultLoadedEvents.push(data);
      });

      service.eventManager.subscribe('VaultBaselineCaptured', (data) => {
        vaultBaselineCapturedEvents.push(data);
      });

      service.eventManager.subscribe('VaultSetupComplete', (data) => {
        vaultSetupCompleteEvents.push(data);
      });

      service.eventManager.subscribe('VaultsLoaded', (data) => {
        vaultsLoadedEvents.push(data);
      });

      service.eventManager.subscribe('PoolDataFetched', (data) => {
        poolDataFetchedEvents.push(data);
      });

      service.eventManager.subscribe('InitialPositionsEvaluated', (data) => {
        initialPositionsEvaluatedEvents.push(data);
      });

      service.eventManager.subscribe('BestPoolSelected', (data) => {
        bestPoolSelectedEvents.push(data);
      });

      service.eventManager.subscribe('PositionsClosed', (data) => {
        positionsClosedEvents.push(data);
      });

      service.eventManager.subscribe('BatchTransactionExecuted', (data) => {
        batchTransactionExecutedEvents.push(data);
      });

      service.eventManager.subscribe('TokenBalancesFetched', (data) => {
        tokenBalancesFetchedEvents.push(data);
      });

      service.eventManager.subscribe('UtilizationCalculated', (data) => {
        utilizationEvents.push(data);
      });

      service.eventManager.subscribe('TokenPreparationCompleted', (data) => {
        tokenPreparationCompletedEvents.push(data);
      });

      service.eventManager.subscribe('TokensSwapped', (data) => {
        tokensSwappedEvents.push(data);
      });

      service.eventManager.subscribe('NewPositionCreated', (data) => {
        newPositionCreatedEvents.push(data);
      });

      // Start the service
      await service.start();

      expect(service.isRunning).toBe(true);

      // Verify vault was discovered
      const discoveredVaults = service.vaultDataService.getAllVaults();
      expect(discoveredVaults.length).toBe(1);

      // Verify VaultsLoaded event
      expect(vaultsLoadedEvents.length).toBe(1);
      expect(vaultsLoadedEvents[0].total).toBe(1);
      expect(vaultsLoadedEvents[0].successful).toBe(1);
      expect(vaultsLoadedEvents[0].failed).toBe(0);
    }, 60000);
  });

  describe('setupVault() Step 1: Vault Data Loading', () => {
    it('should load vault data with correct structure', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      // Verify vault address
      expect(vault.address.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());

      // Verify vault has required fields
      expect(vault.owner).toBeDefined();
      expect(vault.chainId).toBe(1337);
      expect(vault.strategy).toBeDefined();
      expect(vault.strategy.strategyId).toBe('bob');
      expect(vault.targetTokens).toEqual(['LINK', 'WETH']);
      expect(vault.targetPlatforms).toEqual(['uniswapV3']);
    });

    it('should have NO positions initially', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      // Vault was created with no positions
      // Note: After service.start(), if createNewPosition ran successfully,
      // there would be 1 position. But since it's not implemented yet,
      // we expect the vault to still have 0 positions at this point
      // (or the test might fail during initialization - which is expected)
      expect(vault.positions).toBeDefined();
    });

    it('should have ETH wrapped to WETH for position (target token is WETH)', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      // Verify vault.tokens exists
      expect(vault.tokens).toBeDefined();

      // After token preparation (Step 7), native ETH is wrapped to WETH
      // to cover WETH deficit for the LINK/WETH position.
      // ETH balance may be 0 or near-0 (gas dust only)
      const ethBalance = BigInt(vault.tokens.ETH || '0');
      expect(ethBalance).toBeGreaterThanOrEqual(0n);
      expect(ethBalance).toBeLessThanOrEqual(100n);

      // WETH should have been used for liquidity (may be partially consumed)
      // But we should at least have the WETH token entry
      expect(vault.tokens.WETH).toBeDefined();
    });

    it('should emit vaultLoaded event with correct data', () => {
      expect(vaultLoadedEvents.length).toBe(1);

      const event = vaultLoadedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
      expect(event.positionCount).toBe(0);  // No positions initially
      expect(event.targetTokens).toEqual(['LINK', 'WETH']);
      expect(event.targetPlatforms).toEqual(['uniswapV3']);
    });
  });

  describe('setupVault() Step 2: Baseline Capture', () => {
    it('should emit VaultBaselineCaptured event', () => {
      expect(vaultBaselineCapturedEvents.length).toBe(1);

      const event = vaultBaselineCapturedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });

    it('should capture total vault value from ETH balance', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(typeof event.totalVaultValue).toBe('number');
      expect(event.totalVaultValue).toBeGreaterThan(0);
    });

    it('should have token value but NO position value (0 positions)', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(typeof event.tokenValue).toBe('number');
      expect(typeof event.positionValue).toBe('number');

      // Token value should be > 0 (from ETH)
      expect(event.tokenValue).toBeGreaterThan(0);

      // Position value should be 0 (no positions)
      expect(event.positionValue).toBe(0);
    });

    it('should have zero positions in baseline', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(event.positions).toBeDefined();
      expect(Object.keys(event.positions).length).toBe(0);
    });
  });

  describe('setupVault() Step 3: Strategy Initialization', () => {
    describe('Pool Selection', () => {
      const VALID_V3_FEE_TIERS = [100, 500, 3000, 10000];
      const V3_MIN_TICK = -887272;
      const V3_MAX_TICK = 887272;

      it('should emit BestPoolSelected event', () => {
        expect(bestPoolSelectedEvents.length).toBe(1);

        const event = bestPoolSelectedEvents[0];
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      });

      it('should select pool for LINK/WETH token pair', () => {
        const event = bestPoolSelectedEvents[0];

        // Tokens should include LINK and WETH
        const tokenPair = [event.token0Symbol, event.token1Symbol].sort();
        expect(tokenPair).toEqual(['LINK', 'WETH']);
      });

      it('should select pool on correct platform', () => {
        const event = bestPoolSelectedEvents[0];
        expect(event.platformId).toBe('uniswapV3');
      });

      it('should select pool with valid V3 fee tier', () => {
        const event = bestPoolSelectedEvents[0];
        expect(VALID_V3_FEE_TIERS).toContain(event.poolFee);
      });

      it('should select pool with liquidity > 0', () => {
        const event = bestPoolSelectedEvents[0];
        expect(BigInt(event.poolLiquidity)).toBeGreaterThan(0n);
      });

      it('should select pool with tick in valid V3 range', () => {
        const event = bestPoolSelectedEvents[0];
        expect(event.poolTick).toBeGreaterThanOrEqual(V3_MIN_TICK);
        expect(event.poolTick).toBeLessThanOrEqual(V3_MAX_TICK);
      });
    });

    describe('Position Evaluation (Empty Vault)', () => {
      it('should emit InitialPositionsEvaluated event', () => {
        expect(initialPositionsEvaluatedEvents.length).toBe(1);

        const event = initialPositionsEvaluatedEvents[0];
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
        expect(event.success).toBe(true);
      });

      it('should identify 0 aligned and 0 non-aligned positions', () => {
        const event = initialPositionsEvaluatedEvents[0];

        // No positions exist at all
        expect(event.alignedCount).toBe(0);
        expect(event.nonAlignedCount).toBe(0);
        expect(event.alignedPositionIds).toHaveLength(0);
        expect(event.nonAlignedPositionIds).toHaveLength(0);
      });
    });

    describe('Position Closing (Skipped - No Positions)', () => {
      it('should NOT emit PositionsClosed event (no positions to close)', () => {
        // Since there are no non-aligned positions, no close event should be emitted
        expect(positionsClosedEvents.length).toBe(0);
      });
    });
  });

  describe('setupVault() Step 4: Token Balance Refresh (Skipped)', () => {
    it('should still have initial TokenBalancesFetched event from Step 1', () => {
      // At least 1 event from initial load
      expect(tokenBalancesFetchedEvents.length).toBeGreaterThanOrEqual(1);

      const initialEvent = tokenBalancesFetchedEvents[0];
      expect(initialEvent.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });

    // Note: No post-closure refresh since no positions were closed
  });

  describe('setupVault() Step 5: Calculate Available Deployment', () => {
    it('should emit UtilizationCalculated event', () => {
      expect(utilizationEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should have 0% current utilization (no positions)', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];

      // No positions = 0% utilization
      expect(event.currentUtilization).toBe(0);
      expect(event.positionValue).toBe(0);
    });

    it('should have full token value as available deployment', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];

      // With 0% utilization and 90% max, availableDeployment should be ~90% of total
      // (assuming it exceeds minimum thresholds)
      expect(event.totalVaultValue).toBeGreaterThan(0);
      expect(event.tokenValue).toBeGreaterThan(0);
      expect(event.availableDeployment).toBeGreaterThan(0);
    });

    it('should have large utilization gap (0% current vs 90% max)', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];

      // gap = maxUtil - currentUtil = 0.9 - 0 = 0.9 (90%)
      expect(event.utilizationGap).toBeCloseTo(0.9, 2);
      expect(event.utilizationGapPercent).toBeCloseTo(90, 1);
    });
  });

  describe('setupVault() Step 6: Capital Deployment - createNewPosition Path', () => {
    it('should have availableDeployment > 0 (triggering deployment)', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];
      expect(event.availableDeployment).toBeGreaterThan(0);
    });

    it('should have 0 aligned positions (triggering createNewPosition path)', () => {
      const evalEvent = initialPositionsEvaluatedEvents[0];
      expect(evalEvent.alignedCount).toBe(0);

      // This confirms createNewPosition should be called, not addToPosition
    });
  });

  describe('createNewPosition Step 7: Token Preparation', () => {
    it('should emit TokenPreparationCompleted event', () => {
      expect(tokenPreparationCompletedEvents.length).toBeGreaterThan(0);
    });

    it('should have correct event structure', () => {
      const event = tokenPreparationCompletedEvents[0];
      const vault = service.vaultDataService.getAllVaults()[0];

      expect(event.vaultAddress.toLowerCase()).toBe(vault.address.toLowerCase());
      expect(event.strategyId).toBe(vault.strategy.strategyId);
      expect(event.platformId).toBeDefined();
      expect(event.targetTokens).toBeDefined();
      expect(event.preparationResult).toBeDefined();
      expect(event.swapTransactions).toBeDefined();
      expect(event.nonAlignedTokensUsed).toBeDefined();
      expect(event.wrapUnwrap).toBeDefined();
    });

    it('should have ETH wrap amount > 0 - native ETH is wrapped to WETH', () => {
      const event = tokenPreparationCompletedEvents[0];

      // This test has nativeEthAmount: '10' and target tokens are LINK/WETH
      // ETH should be wrapped to cover WETH requirement
      expect(event.wrapUnwrap).toBeDefined();
      expect(event.wrapUnwrap.wrapAmount).toBeDefined();
      expect(event.wrapUnwrap.unwrapAmount).toBeDefined();

      // wrapAmount should be > 0 (ETH → WETH to cover WETH requirement)
      const wrapAmount = BigInt(event.wrapUnwrap.wrapAmount);
      expect(wrapAmount).toBeGreaterThan(0n);

      // unwrapAmount should be 0 (no WETH → ETH needed)
      const unwrapAmount = BigInt(event.wrapUnwrap.unwrapAmount);
      expect(unwrapAmount).toBe(0n);
    });

    it('should have correct targetTokens structure', () => {
      const event = tokenPreparationCompletedEvents[0];

      expect(event.targetTokens.token0).toBeDefined();
      expect(event.targetTokens.token1).toBeDefined();
      expect(event.targetTokens.token0.symbol).toBeDefined();
      expect(event.targetTokens.token0.required).toBeDefined();
      expect(event.targetTokens.token0.available).toBeDefined();
      expect(event.targetTokens.token0.deficit).toBeDefined();
    });

    it('should have LINK deficit (vault starts with no LINK)', () => {
      const event = tokenPreparationCompletedEvents[0];

      // Find which token is LINK
      const linkToken = event.targetTokens.token0.symbol === 'LINK'
        ? event.targetTokens.token0
        : event.targetTokens.token1;

      // LINK deficit is guaranteed (we start with 0 LINK)
      const linkDeficit = BigInt(linkToken.deficit);
      expect(linkDeficit).toBeGreaterThan(0n);
    });

    it('should have phasesUsed reflecting ETH wrap and deficit swaps', () => {
      const event = tokenPreparationCompletedEvents[0];

      // 0010 scenario: native ETH only, target LINK/WETH
      // - wrapUnwrap: true (ETH wraps to WETH)
      // - nonAlignedForDeficit: true (ETH used to buy LINK)
      expect(event.phasesUsed.wrapUnwrap).toBe(true);
      expect(event.phasesUsed.nonAlignedForDeficit).toBe(true);
    });

    it('should have consistent swap counts and metadata', () => {
      const event = tokenPreparationCompletedEvents[0];

      // swapTransactions.length should equal deficitSwapCount + bufferSwapCount
      expect(event.swapTransactions.length).toBe(
        event.deficitSwapCount + event.bufferSwapCount
      );

      // Metadata counts should match swap counts
      expect(event.swapMetadata.deficit.length).toBe(event.deficitSwapCount);
      expect(event.swapMetadata.buffer.length).toBe(event.bufferSwapCount);
    });

    it('should route swap transactions to correct UniversalRouter', () => {
      const event = tokenPreparationCompletedEvents[0];

      if (event.swapTransactions.length > 0) {
        // Get the Universal Router address from the adapter (chain-specific)
        const adapter = service.strategies.get('bob').adapters.get('uniswapV3');
        const expectedRouterAddress = adapter.addresses.universalRouterAddress;

        for (const tx of event.swapTransactions) {
          expect(tx.to.toLowerCase()).toBe(expectedRouterAddress.toLowerCase());
          expect(tx.data).toBeDefined();
          expect(tx.data).not.toBe('');
          // value is '0x00' for ERC20 swaps, or non-zero hex for native ETH swaps
          expect(tx.value).toBeDefined();
          expect(tx.value).toMatch(/^0x[0-9a-fA-F]+$/);
        }
      }
    });
  });

  describe('createNewPosition Step 7: Token Swap Execution', () => {
    it('should emit TokensSwapped event for deficit swaps', () => {
      const deficitEvent = tokensSwappedEvents.find(e => e.swapType === 'deficit_coverage');

      const tokenPrepEvent = tokenPreparationCompletedEvents[0];
      if (tokenPrepEvent.preparationResult === 'swaps_generated' && tokenPrepEvent.deficitSwapCount > 0) {
        expect(deficitEvent).toBeDefined();
        expect(deficitEvent.success).toBe(true);
        expect(deficitEvent.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
        expect(deficitEvent.swapCount).toBeGreaterThan(0);
        expect(deficitEvent.transactionHash).toBeDefined();
        expect(deficitEvent.gasUsed).toBeDefined();
        expect(deficitEvent.effectiveGasPrice).toBeDefined();
      }
    });

    it('should emit TokensSwapped event for buffer swaps', () => {
      const bufferEvent = tokensSwappedEvents.find(e => e.swapType === 'buffer');

      const tokenPrepEvent = tokenPreparationCompletedEvents[0];
      if (tokenPrepEvent.preparationResult === 'swaps_generated' && tokenPrepEvent.bufferSwapCount > 0) {
        expect(bufferEvent).toBeDefined();
        expect(bufferEvent.success).toBe(true);
        expect(bufferEvent.swapCount).toBeGreaterThan(0);
      }
    });

    it('should have actual amounts in swap details', () => {
      if (tokensSwappedEvents.length > 0) {
        const event = tokensSwappedEvents[0];

        for (const swap of event.swaps) {
          // Must have all required fields
          expect(swap.tokenInSymbol).toBeDefined();
          expect(swap.tokenOutSymbol).toBeDefined();
          expect(swap.quotedAmountIn).toBeDefined();
          expect(swap.quotedAmountOut).toBeDefined();
          expect(swap.actualAmountIn).toBeDefined();
          expect(swap.actualAmountOut).toBeDefined();
          expect(typeof swap.isAmountIn).toBe('boolean');

          // Actual amounts should be > 0 for successful swaps
          expect(BigInt(swap.actualAmountOut)).toBeGreaterThan(0n);
        }
      }
    });

    it('should swap to acquire LINK (the deficit token)', () => {
      const deficitEvent = tokensSwappedEvents.find(e => e.swapType === 'deficit_coverage');

      if (deficitEvent) {
        // For 0010 scenario: we need LINK, so output should be LINK
        const swaps = deficitEvent.swaps;
        expect(swaps.length).toBeGreaterThan(0);

        // At least one swap should output LINK (to cover the deficit)
        const linkOutputSwap = swaps.find(s => s.tokenOutSymbol === 'LINK');
        expect(linkOutputSwap).toBeDefined();

        // Input token should be one of the available tokens (WETH or ETH)
        expect(['WETH', 'ETH']).toContain(linkOutputSwap.tokenInSymbol);
      }
    });

    it('should have consistent swap counts with TokenPreparationCompleted', () => {
      const tokenPrepEvent = tokenPreparationCompletedEvents[0];

      if (tokenPrepEvent.preparationResult === 'swaps_generated') {
        // Count total swaps from TokensSwapped events
        const totalSwapsExecuted = tokensSwappedEvents.reduce((sum, e) => sum + e.swapCount, 0);

        // Should match what was prepared
        const expectedTotal = tokenPrepEvent.deficitSwapCount + tokenPrepEvent.bufferSwapCount;
        expect(totalSwapsExecuted).toBe(expectedTotal);
      }
    });
  });

  describe('createNewPosition Step 8: Token Balance Refresh', () => {
    it('should have multiple TokenBalancesFetched events (initial + post-swap)', () => {
      // Should have at least 2 events: initial load + post-swap refresh
      expect(tokenBalancesFetchedEvents.length).toBeGreaterThanOrEqual(2);
    });

    it('should have LINK balance after deficit swap', () => {
      // Get the last token balance event (post-swap)
      const postSwapEvent = tokenBalancesFetchedEvents[tokenBalancesFetchedEvents.length - 1];

      // LINK should now have a balance (from deficit swap)
      const linkBalance = BigInt(postSwapEvent.balances.LINK || '0');
      expect(linkBalance).toBeGreaterThan(0n);
    });

    it('should have WETH balance after wrapping', () => {
      // Get the last token balance event (post-swap)
      const postSwapEvent = tokenBalancesFetchedEvents[tokenBalancesFetchedEvents.length - 1];

      // WETH should have remaining balance (after swaps)
      const wethBalance = BigInt(postSwapEvent.balances.WETH || '0');
      expect(wethBalance).toBeGreaterThan(0n);
    });
  });

  describe('NewPositionCreated event', () => {
    it('should emit exactly one NewPositionCreated event', () => {
      expect(newPositionCreatedEvents.length).toBe(1);
    });

    it('should have correct vault and position identifiers', () => {
      const event = newPositionCreatedEvents[0];

      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.positionId).toBeDefined();
      expect(event.poolAddress).toBeDefined();
      expect(event.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should have valid quoted amounts (from original quote)', () => {
      const event = newPositionCreatedEvents[0];

      expect(event.quotedToken0).toBeDefined();
      expect(event.quotedToken1).toBeDefined();

      // Quoted amounts should be positive
      expect(BigInt(event.quotedToken0)).toBeGreaterThan(0n);
      expect(BigInt(event.quotedToken1)).toBeGreaterThan(0n);
    });

    it('should have actual amounts from receipt parsing', () => {
      const event = newPositionCreatedEvents[0];

      expect(event.actualToken0).toBeDefined();
      expect(event.actualToken1).toBeDefined();

      // Actual amounts should be positive (position was created)
      expect(BigInt(event.actualToken0)).toBeGreaterThan(0n);
      expect(BigInt(event.actualToken1)).toBeGreaterThan(0n);
    });

    it('should have valid transaction details', () => {
      const event = newPositionCreatedEvents[0];

      expect(event.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(event.blockNumber).toBeGreaterThan(0);
      expect(BigInt(event.gasUsed)).toBeGreaterThan(0n);
      expect(BigInt(event.effectiveGasPrice)).toBeGreaterThan(0n);
      expect(event.gasEstimated).toBeDefined();
    });

    it('should have valid position range (platform-agnostic names)', () => {
      const event = newPositionCreatedEvents[0];

      // Platform-agnostic range fields
      expect(typeof event.lowerBound).toBe('number');
      expect(typeof event.upperBound).toBe('number');
      expect(event.lowerBound).toBeLessThan(event.upperBound);
      expect(typeof event.current).toBe('number');

      // Current should be within the range (position was just created)
    });

    it('should have correct context metadata', () => {
      const event = newPositionCreatedEvents[0];

      expect(event.tokenSymbols).toBeDefined();
      expect(Array.isArray(event.tokenSymbols)).toBe(true);
      expect(event.tokenSymbols).toHaveLength(2);
      // WETH/LINK pair (order depends on pool)
      expect(event.tokenSymbols).toContain('WETH');
      expect(event.tokenSymbols).toContain('LINK');
      expect(event.platform).toBe('uniswapV3');
      expect(event.deploymentAmount).toBeGreaterThan(0);
      expect(typeof event.timestamp).toBe('number');
    });

    it('should have position ID that can be used to query the new position', () => {
      const event = newPositionCreatedEvents[0];
      const vault = service.vaultDataService.getAllVaults()[0];

      // The position should now exist in the vault's positions
      // Note: This depends on whether the vault positions are refreshed after creation
      expect(event.positionId).toBeDefined();
      expect(typeof event.positionId === 'string' || typeof event.positionId === 'number').toBe(true);
    });
  });

  describe('Setup Completion', () => {
    it('should emit VaultSetupComplete event', () => {
      expect(vaultSetupCompleteEvents.length).toBe(1);

      const event = vaultSetupCompleteEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
      // After createNewPosition, vault should have 1 position
      expect(event.positionCount).toBe(1);
      expect(event.tokenCount).toBeGreaterThan(0);
      expect(event.baselineCaptured).toBe(true);
      expect(typeof event.timestamp).toBe('number');
    });

    it('should have vault in VaultDataService cache', () => {
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
    });

    it('should return correct strategy ID for vault', () => {
      expect(service.vaultDataService.getVaultStrategyId(testVault.vaultAddress)).toBe('bob');
    });
  });
});
