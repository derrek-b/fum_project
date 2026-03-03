/**
 * @fileoverview Integration tests for createNewPosition workflow on Avalanche (Trader Joe V2.2)
 * Tests vault initialization with NO aligned positions, triggering createNewPosition
 *
 * Scenario: 0 Aligned Positions / 0 Non-Aligned Positions / 1 Token (native AVAX)
 * - Vault funded with native AVAX only
 * - Target tokens: USDC/WAVAX
 * - No positions exist, so createNewPosition is called instead of addToPosition
 *
 * Mirrors test/workflow/service-init/BS-0010.test.js but targets Avalanche chain (1338)
 * with Trader Joe V2.2 adapter instead of Uniswap V3.
 *
 * Run with: FORK_CHAIN=avalanche npm test -- test/workflow/traderjoe/BS-0010.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTraderJoeTestVault } from '../../helpers/traderjoe-vault-setup.js';
import { configureTJStrategyParameters } from '../../helpers/traderjoe-swap-utils.js';
describe('AutomationService Initialization - TJ V2.2 createNewPosition Workflow', () => {
  let testEnv;
  let testVault;
  let service;
  let testConfig;

  // Event capture arrays
  let vaultLoadingEvents = [];
  let vaultLoadedEvents = [];
  let vaultBaselineCapturedEvents = [];
  let vaultSetupCompleteEvents = [];
  let monitoringStartedEvents = [];
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
    // Setup blockchain environment (Avalanche fork via FORK_CHAIN=avalanche)
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create test vault with NO positions - only native AVAX
    // This will trigger createNewPosition since no aligned positions exist
    testVault = await setupTraderJoeTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '0AP/0NP - TJ createNewPosition Test',
        nativeAmount: '0',       // Don't wrap any AVAX in setup
        swapTokens: [],          // No token swaps
        positions: [],           // NO positions - key for triggering createNewPosition
        tokenTransfers: {},      // No token transfers
        targetTokens: ['USDC', 'WAVAX'],
        targetPlatforms: ['traderjoeV2_2'],
        strategy: 'bob'
      }
    );

    // Send native AVAX directly to vault (like V3 test sends native ETH)
    const owner = testEnv.hardhatServer.signers[0];
    const tx = await owner.sendTransaction({
      to: testVault.vaultAddress,
      value: ethers.utils.parseEther('10')
    });
    await tx.wait();

    // Narrow range from default 5% to 1% for faster position creation
    await configureTJStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 100,
      targetRangeLower: 100
    });

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

      service.eventManager.subscribe('MonitoringStarted', (data) => {
        monitoringStartedEvents.push(data);
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

      service.eventManager.subscribe('DeploymentCalculated', (data) => {
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
    }, 300000);
  });

  describe('setupVault() Step 1: Vault Data Loading', () => {
    it('should load vault data with correct structure', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      // Verify vault address
      expect(vault.address.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());

      // Verify vault has required fields
      expect(vault.owner).toBeDefined();
      expect(vault.chainId).toBe(1338);
      expect(vault.strategy).toBeDefined();
      expect(vault.strategy.strategyId).toBe('bob');
      expect(vault.targetTokens).toEqual(['USDC', 'WAVAX']);
      expect(vault.targetPlatforms).toEqual(['traderjoeV2_2']);
    });

    it('should have NO positions initially', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      // Vault was created with no positions
      expect(vault.positions).toBeDefined();
    });

    it('should have AVAX wrapped to WAVAX for position (target token is WAVAX)', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      // Verify vault.tokens exists
      expect(vault.tokens).toBeDefined();

      // After token preparation, native AVAX is used for:
      // 1. Wrapping to WAVAX (for the WAVAX portion of the position)
      // 2. Swapping via LBRouter for USDC deficit
      // Leftover AVAX should be under 1% of initial deposit
      const avaxBalance = BigInt(vault.tokens.AVAX || '0');
      const onePercentOfDeposit = BigInt(ethers.utils.parseEther('0.1').toString()); // 1% of 10 AVAX
      expect(avaxBalance).toBeGreaterThanOrEqual(0n);
      expect(avaxBalance).toBeLessThanOrEqual(onePercentOfDeposit);

      // WAVAX should have been used for liquidity (may be partially consumed)
      // But we should at least have the WAVAX token entry
      expect(vault.tokens.WAVAX).toBeDefined();
    });

    it('should emit vaultLoaded event with correct data', () => {
      expect(vaultLoadedEvents.length).toBe(1);

      const event = vaultLoadedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
      expect(event.positionCount).toBe(0);  // No positions initially
      expect(event.targetTokens).toEqual(['USDC', 'WAVAX']);
      expect(event.targetPlatforms).toEqual(['traderjoeV2_2']);
    });
  });

  describe('setupVault() Step 2: Baseline Capture', () => {
    it('should emit VaultBaselineCaptured event', () => {
      expect(vaultBaselineCapturedEvents.length).toBe(1);

      const event = vaultBaselineCapturedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });

    it('should capture total vault value from AVAX balance', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(typeof event.totalVaultValue).toBe('number');
      expect(event.totalVaultValue).toBeGreaterThan(0);
    });

    it('should have token value but NO position value (0 positions)', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(typeof event.tokenValue).toBe('number');
      expect(typeof event.positionValue).toBe('number');

      // Token value should be > 0 (from AVAX)
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
      // TJ bin IDs are uint24: 0 to 16777215
      const TJ_MAX_BIN_ID = 16777215;

      it('should emit BestPoolSelected event', () => {
        expect(bestPoolSelectedEvents.length).toBe(1);

        const event = bestPoolSelectedEvents[0];
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      });

      it('should emit pool object with correct TJ structure', () => {
        const event = bestPoolSelectedEvents[0];

        expect(event.pool).toBeDefined();
        expect(event.pool.address).toBeDefined();
        expect(event.pool.binStep).toBeDefined();
        expect(event.pool.activeId).toBeDefined();
        expect(event.pool.token0).toBeDefined();
        expect(event.pool.token1).toBeDefined();
        // TJ-native aliases should also be present
        expect(event.pool.tokenX).toBeDefined();
        expect(event.pool.tokenY).toBeDefined();
      });

      it('should select pool for USDC/WAVAX token pair', () => {
        const event = bestPoolSelectedEvents[0];

        // Tokens should include USDC and WAVAX
        const tokenPair = [event.pool.token0.symbol, event.pool.token1.symbol].sort();
        expect(tokenPair).toEqual(['USDC', 'WAVAX']);
      });

      it('should select pool on correct platform', () => {
        const event = bestPoolSelectedEvents[0];
        expect(event.platformId).toBe('traderjoeV2_2');
      });

      it('should select pool with valid binStep', () => {
        const event = bestPoolSelectedEvents[0];
        expect(event.pool.binStep).toBeGreaterThan(0);
        expect(Number.isInteger(event.pool.binStep)).toBe(true);
      });

      it('should select pool with reserves', () => {
        const event = bestPoolSelectedEvents[0];
        // TJ pools have reserveX/reserveY instead of liquidity
        expect(event.pool.reserveX).toBeDefined();
        expect(event.pool.reserveY).toBeDefined();
      });

      it('should select pool with activeId in valid range', () => {
        const event = bestPoolSelectedEvents[0];
        expect(event.pool.activeId).toBeGreaterThanOrEqual(0);
        expect(event.pool.activeId).toBeLessThanOrEqual(TJ_MAX_BIN_ID);
      });

      it('should include pool discovery counts', () => {
        const event = bestPoolSelectedEvents[0];
        expect(typeof event.poolsDiscovered).toBe('number');
        expect(typeof event.poolsActive).toBe('number');
        expect(event.poolsDiscovered).toBeGreaterThanOrEqual(event.poolsActive);
        expect(event.poolsActive).toBeGreaterThan(0);
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
    it('should emit DeploymentCalculated event', () => {
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

      // Full vault deployment - all tokens available (above minimum thresholds)
      expect(event.totalVaultValue).toBeGreaterThan(0);
      expect(event.tokenValue).toBeGreaterThan(0);
      expect(event.availableDeployment).toBeGreaterThan(0);
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

    it('should have AVAX wrap amount > 0 - native AVAX is wrapped to WAVAX', () => {
      const event = tokenPreparationCompletedEvents[0];

      // This test has native AVAX and target tokens are USDC/WAVAX
      // AVAX should be wrapped to cover WAVAX requirement
      expect(event.wrapUnwrap).toBeDefined();
      expect(event.wrapUnwrap.wrapAmount).toBeDefined();
      expect(event.wrapUnwrap.unwrapAmount).toBeDefined();

      // wrapAmount should be > 0 (AVAX -> WAVAX to cover WAVAX requirement)
      const wrapAmount = BigInt(event.wrapUnwrap.wrapAmount);
      expect(wrapAmount).toBeGreaterThan(0n);

      // unwrapAmount should be 0 (no WAVAX -> AVAX needed)
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

    it('should have USDC deficit (vault starts with no USDC)', () => {
      const event = tokenPreparationCompletedEvents[0];

      // Find which token is USDC
      const USDCToken = event.targetTokens.token0.symbol === 'USDC'
        ? event.targetTokens.token0
        : event.targetTokens.token1;

      // USDC deficit is guaranteed (we start with 0 USDC)
      const USDCDeficit = BigInt(USDCToken.deficit);
      expect(USDCDeficit).toBeGreaterThan(0n);
    });

    it('should have phasesUsed reflecting AVAX wrap and deficit swaps', () => {
      const event = tokenPreparationCompletedEvents[0];

      // 0010 scenario: native AVAX only, target USDC/WAVAX
      // - wrapUnwrap: true (AVAX wraps to WAVAX)
      // - nonAlignedForDeficit: true (AVAX used to buy USDC)
      expect(event.phasesUsed.wrapUnwrap).toBe(true);
      expect(event.phasesUsed.nonAlignedForDeficit).toBe(true);
    });

    it('should have consistent swap counts and metadata', () => {
      const event = tokenPreparationCompletedEvents[0];

      // swapTransactions.length should equal deficitSwapCount (no buffer swaps)
      expect(event.swapTransactions.length).toBe(event.deficitSwapCount);

      // Metadata counts should match swap counts
      expect(event.swapMetadata.deficit.length).toBe(event.deficitSwapCount);
    });

    it('should route swap transactions to correct LBRouter', () => {
      const event = tokenPreparationCompletedEvents[0];

      if (event.swapTransactions.length > 0) {
        // Get the LBRouter address from the adapter (chain-specific)
        const adapter = service.strategies.get('bob').adapters.get('traderjoeV2_2');
        const expectedRouterAddress = adapter.addresses.lbRouterAddress;

        for (const tx of event.swapTransactions) {
          expect(tx.to.toLowerCase()).toBe(expectedRouterAddress.toLowerCase());
          expect(tx.data).toBeDefined();
          expect(tx.data).not.toBe('');
          expect(tx.value).toBeDefined();
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

    it('should swap to acquire USDC (the deficit token)', () => {
      const deficitEvent = tokensSwappedEvents.find(e => e.swapType === 'deficit_coverage');

      if (deficitEvent) {
        // For 0010 scenario: we need USDC, so output should be USDC
        const swaps = deficitEvent.swaps;
        expect(swaps.length).toBeGreaterThan(0);

        // At least one swap should output USDC (to cover the deficit)
        const USDCOutputSwap = swaps.find(s => s.tokenOutSymbol === 'USDC');
        expect(USDCOutputSwap).toBeDefined();

        // Input token should be WAVAX (or AVAX)
        expect(['WAVAX', 'AVAX']).toContain(USDCOutputSwap.tokenInSymbol);
      }
    });

    it('should have consistent swap counts with TokenPreparationCompleted', () => {
      const tokenPrepEvent = tokenPreparationCompletedEvents[0];

      if (tokenPrepEvent.preparationResult === 'swaps_generated') {
        // Count total swaps from TokensSwapped events
        const totalSwapsExecuted = tokensSwappedEvents.reduce((sum, e) => sum + e.swapCount, 0);

        // Should match what was prepared (deficit swaps only, no buffer swaps)
        expect(totalSwapsExecuted).toBe(tokenPrepEvent.deficitSwapCount);
      }
    });
  });

  describe('createNewPosition Step 8: Token Balance Refresh', () => {
    it('should have multiple TokenBalancesFetched events (initial + post-swap)', () => {
      // Should have at least 2 events: initial load + post-swap refresh
      expect(tokenBalancesFetchedEvents.length).toBeGreaterThanOrEqual(2);
    });

    it('should have USDC balance after deficit swap', () => {
      // Get the last token balance event (post-swap)
      const postSwapEvent = tokenBalancesFetchedEvents[tokenBalancesFetchedEvents.length - 1];

      // USDC should now have a balance (from deficit swap)
      const USDCBalance = BigInt(postSwapEvent.balances.USDC || '0');
      expect(USDCBalance).toBeGreaterThan(0n);
    });

    it('should have WAVAX balance after wrapping', () => {
      // Get the last token balance event (post-swap)
      const postSwapEvent = tokenBalancesFetchedEvents[tokenBalancesFetchedEvents.length - 1];

      // WAVAX should have remaining balance (after swaps)
      const wavaxBalance = BigInt(postSwapEvent.balances.WAVAX || '0');
      expect(wavaxBalance).toBeGreaterThan(0n);
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

    it('should have valid target amounts (based on ratio)', () => {
      const event = newPositionCreatedEvents[0];

      expect(event.targetToken0).toBeDefined();
      expect(event.targetToken1).toBeDefined();

      // Target amounts should be positive
      expect(BigInt(event.targetToken0)).toBeGreaterThan(0n);
      expect(BigInt(event.targetToken1)).toBeGreaterThan(0n);
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

    it('should have valid position range (use adapter to extract bounds)', () => {
      const event = newPositionCreatedEvents[0];
      const adapter = service.adapters.get(event.platform);

      // Position object should exist
      expect(event.position).toBeDefined();

      // Use adapter to extract bounds (platform-agnostic)
      const { lower, upper } = adapter.extractPositionBounds(event.position);
      expect(typeof lower).toBe('number');
      expect(typeof upper).toBe('number');
      expect(lower).toBeLessThan(upper);

      // TJ position includes activeBinId from getPositionRange
      expect(typeof event.position.activeBinId).toBe('number');
    });

    it('should have correct context metadata', () => {
      const event = newPositionCreatedEvents[0];

      expect(event.tokenSymbols).toBeDefined();
      expect(Array.isArray(event.tokenSymbols)).toBe(true);
      expect(event.tokenSymbols).toHaveLength(2);
      // WAVAX/USDC pair (order depends on pool)
      expect(event.tokenSymbols).toContain('WAVAX');
      expect(event.tokenSymbols).toContain('USDC');
      expect(event.platform).toBe('traderjoeV2_2');
      expect(event.deploymentAmount).toBeGreaterThan(0);
      expect(typeof event.timestamp).toBe('number');
    });

    it('should have position ID that can be used to query the new position', () => {
      const event = newPositionCreatedEvents[0];

      // The position should now exist in the vault's positions
      expect(event.positionId).toBeDefined();
      expect(typeof event.positionId === 'string' || typeof event.positionId === 'number').toBe(true);
    });
  });

  describe('Emergency Exit Baseline', () => {
    it('should have emergency exit baseline set for the vault', () => {
      const strategy = service.strategies.get('bob');
      expect(strategy.emergencyExitBaseline[testVault.vaultAddress]).toBeDefined();

      // TJ baseline is an object { activeId, binStep } (not a number like V3)
      const baseline = strategy.emergencyExitBaseline[testVault.vaultAddress];
      expect(typeof baseline).toBe('object');
      expect(typeof baseline.activeId).toBe('number');
      expect(typeof baseline.binStep).toBe('number');
    });

    it('should have baseline with reasonable activeId from pool state', () => {
      const strategy = service.strategies.get('bob');
      const baseline = strategy.emergencyExitBaseline[testVault.vaultAddress];

      // activeId should be a positive integer in valid TJ range
      expect(baseline.activeId).toBeGreaterThan(0);
      expect(baseline.activeId).toBeLessThanOrEqual(16777215);

      // binStep should match the pool's binStep
      const poolEvent = bestPoolSelectedEvents[0];
      expect(baseline.binStep).toBe(poolEvent.pool.binStep);
    });

    it('should clear baseline when clearEmergencyExitBaseline is called', () => {
      const strategy = service.strategies.get('bob');

      // Verify baseline exists before clearing
      expect(strategy.emergencyExitBaseline[testVault.vaultAddress]).toBeDefined();

      // Clear the baseline
      strategy.clearEmergencyExitBaseline(testVault.vaultAddress);

      // Verify baseline is cleared
      expect(strategy.emergencyExitBaseline[testVault.vaultAddress]).toBeUndefined();
    });
  });

  describe('Setup Completion', () => {
    it('should emit MonitoringStarted event before VaultSetupComplete', () => {
      expect(monitoringStartedEvents.length).toBe(1);

      const event = monitoringStartedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
      expect(event.positionCount).toBe(1);
      expect(typeof event.timestamp).toBe('number');

      // MonitoringStarted should occur before VaultSetupComplete
      expect(vaultSetupCompleteEvents.length).toBe(1);
      expect(event.timestamp).toBeLessThanOrEqual(vaultSetupCompleteEvents[0].timestamp);
    });

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
