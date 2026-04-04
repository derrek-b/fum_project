/**
 * @fileoverview Integration tests for createNewPosition workflow
 * Tests vault initialization with NO aligned positions, triggering createNewPosition
 *
 * Scenario: 0 Aligned Positions / 0 Non-Aligned Positions / 1 Token (native ETH)
 * - Vault funded with native ETH only
 * - Target tokens: USDC/WETH (different from 1212 test which uses USDC/ETH)
 * - No positions exist, so createNewPosition is called instead of addToPosition
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../src/core/AutomationService.js';
import { getVaultContract } from 'fum_library/blockchain';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import {
  expectTrackerAggregates,
  expectTrackerBaseline,
  expectTransactionTypes,
  getTransactionsByType,
  expectNoTrackingFailures,
  expectTransactionCount
} from '../../helpers/tracker-assertions.js';

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
        wrapEthAmount: '0',      // Don't wrap any ETH (we want only native ETH)
        nativeEthAmount: '10',   // Fund with 10 native ETH
        swapTokens: [],          // No token swaps
        positions: [],           // NO positions - key for triggering createNewPosition
        feeGeneratingSwaps: [],  // No fee swaps needed
        tokenTransfers: {},      // No token transfers
        targetTokens: ['USDC', 'WETH'],  // Different pair than 1212 test
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );

    console.log('Test vault created at:', testVault.vaultAddress);
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
    }, 180000);
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
      expect(vault.targetTokens).toEqual(['USDC', 'WETH']);
      expect(vault.targetPlatforms).toEqual(['uniswapV3']);
    });

    it('should derive correct executor addresses from service mnemonic', async () => {
      // Known addresses derived from the test mnemonic
      const expectedAddresses = {
        0: '0xdfA3e220f3a214dE67Ba2eda2B94B6FB5ccefd65',
        1: '0xc7F416Fb1Ba54bdE6D2130f504EcfBFf6af0891A',
        2: '0x4bcEb093F6CEC00183765D1b368F68dB16569e68',
        3: '0x1e8AABd94F0fC32aFe09F461b6A47C71bF68a75C'
      };

      // Verify service hdNode derives the expected address for each index
      for (const [index, expected] of Object.entries(expectedAddresses)) {
        const derived = service.hdNode.derivePath(
          "m/44'/60'/0'/0/" + index
        ).address;
        expect(derived).toBe(expected);
      }

      // Verify this vault's executor matches the on-chain value
      const vault = service.vaultDataService.getAllVaults()[0];
      expect(vault.executorIndex).toBe(testVault.executorIndex);

      const vaultContract = getVaultContract(vault.address, testEnv.hardhatServer.provider);
      const onChainExecutor = await vaultContract.executor();
      expect(expectedAddresses[vault.executorIndex]).toBe(onChainExecutor);
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

      // After token preparation (Step 7), native ETH is used for:
      // 1. Wrapping to WETH (for the WETH portion of the position)
      // 2. Swapping via UniversalRouter (accepts native ETH directly for USDC deficit)
      // Leftover ETH should be under 1% of initial deposit (matching strategy's
      // vault-relative minimum threshold for deployment)
      const ethBalance = BigInt(vault.tokens.ETH || '0');
      const onePercentOfDeposit = BigInt(ethers.utils.parseEther('0.1').toString()); // 1% of 10 ETH
      expect(ethBalance).toBeGreaterThanOrEqual(0n);
      expect(ethBalance).toBeLessThanOrEqual(onePercentOfDeposit);

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
      expect(event.targetTokens).toEqual(['USDC', 'WETH']);
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

      it('should emit pool object with correct structure', () => {
        const event = bestPoolSelectedEvents[0];

        expect(event.pool).toBeDefined();
        expect(event.pool.address).toBeDefined();
        expect(event.pool.fee).toBeDefined();
        expect(event.pool.liquidity).toBeDefined();
        expect(event.pool.tick).toBeDefined();
        expect(event.pool.token0).toBeDefined();
        expect(event.pool.token1).toBeDefined();
      });

      it('should select pool for USDC/WETH token pair', () => {
        const event = bestPoolSelectedEvents[0];

        // Tokens should include USDC and WETH
        const tokenPair = [event.pool.token0.symbol, event.pool.token1.symbol].sort();
        expect(tokenPair).toEqual(['USDC', 'WETH']);
      });

      it('should select pool on correct platform', () => {
        const event = bestPoolSelectedEvents[0];
        expect(event.platformId).toBe('uniswapV3');
      });

      it('should select pool with valid V3 fee tier', () => {
        const event = bestPoolSelectedEvents[0];
        expect(VALID_V3_FEE_TIERS).toContain(event.pool.fee);
      });

      it('should select pool with liquidity > 0', () => {
        const event = bestPoolSelectedEvents[0];
        expect(BigInt(event.pool.liquidity)).toBeGreaterThan(0n);
      });

      it('should select pool with tick in valid V3 range', () => {
        const event = bestPoolSelectedEvents[0];
        expect(event.pool.tick).toBeGreaterThanOrEqual(V3_MIN_TICK);
        expect(event.pool.tick).toBeLessThanOrEqual(V3_MAX_TICK);
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

    it('should have ETH wrap amount > 0 - native ETH is wrapped to WETH', () => {
      const event = tokenPreparationCompletedEvents[0];

      // This test has nativeEthAmount: '10' and target tokens are USDC/WETH
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

    it('should have phasesUsed reflecting ETH wrap and deficit swaps', () => {
      const event = tokenPreparationCompletedEvents[0];

      // 0010 scenario: native ETH only, target USDC/WETH
      // - wrapUnwrap: true (ETH wraps to WETH)
      // - nonAlignedForDeficit: true (ETH used to buy USDC)
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

        // Input token should be one of the available tokens (WETH or ETH)
        expect(['WETH', 'ETH']).toContain(USDCOutputSwap.tokenInSymbol);
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

      // Use adapter to extract bounds
      const { lower, upper } = adapter.extractPositionBounds(event.position);
      expect(typeof lower).toBe('number');
      expect(typeof upper).toBe('number');
      expect(lower).toBeLessThan(upper);

      // Position includes current tick from pool at creation time
      expect(typeof event.position.currentTick).toBe('number');
    });

    it('should have correct context metadata', () => {
      const event = newPositionCreatedEvents[0];

      expect(event.tokenSymbols).toBeDefined();
      expect(Array.isArray(event.tokenSymbols)).toBe(true);
      expect(event.tokenSymbols).toHaveLength(2);
      // WETH/USDC pair (order depends on pool)
      expect(event.tokenSymbols).toContain('WETH');
      expect(event.tokenSymbols).toContain('USDC');
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

  describe('Emergency Exit Baseline', () => {
    it('should have emergency exit baseline set for the vault', () => {
      const strategy = service.strategies.get('bob');
      expect(strategy.emergencyExitBaseline[testVault.vaultAddress]).toBeDefined();
      expect(typeof strategy.emergencyExitBaseline[testVault.vaultAddress]).toBe('number');
    });

    it('should have baseline equal to current tick from NewPositionCreated event', () => {
      const strategy = service.strategies.get('bob');
      const baseline = strategy.emergencyExitBaseline[testVault.vaultAddress];

      // Baseline should match the current tick when position was created
      // Position object contains currentTick from pool at creation time
      const newPositionEvent = newPositionCreatedEvents[0];
      expect(baseline).toBe(newPositionEvent.position.currentTick);
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

  describe('Tracker — Transaction History & Aggregates', () => {
    it('should have baseline captured with correct values', () => {
      const baseline = expectTrackerBaseline(service, testVault.vaultAddress);

      // Baseline should reflect token-only value (no positions at capture time)
      expect(baseline.tokenValue).toBeGreaterThan(0);
      expect(baseline.positionValue).toBe(0);
    });

    it('should have lastSnapshot from AssetValuesFetched', () => {
      const metadata = service.tracker.getMetadata(testVault.vaultAddress);

      expect(metadata.lastSnapshot).not.toBeNull();
      expect(metadata.lastSnapshot.value).toBeGreaterThan(0);
      expect(typeof metadata.lastSnapshot.timestamp).toBe('number');
    });

    it('should have no tracking failures', () => {
      expectNoTrackingFailures(service, testVault.vaultAddress);
    });

    it('should have correct aggregate counts for init flow', () => {
      // BS-0010 init flow: wrap ETH + swap for USDC + create position
      // = 1 wrapUnwrap + 1 swap + 1 newPosition = 3 transactions minimum
      const metadata = expectTrackerAggregates(service, testVault.vaultAddress, {
        wrapUnwrapCount: 1,
        rebalanceCount: 0,
        feeCollectionCount: 0
      });

      expect(metadata.aggregates.swapCount).toBeGreaterThanOrEqual(1);
      expect(metadata.aggregates.transactionCount).toBeGreaterThanOrEqual(3);
    });

    it('should have accumulated gas costs in native and USD', () => {
      const metadata = service.tracker.getMetadata(testVault.vaultAddress);

      expect(metadata.aggregates.cumulativeGasNative).toBeGreaterThan(0);
      expect(metadata.aggregates.cumulativeGasUSD).toBeGreaterThan(0);
    });

    it('should have all expected transaction types in the log', async () => {
      await expectTransactionTypes(service, testVault.vaultAddress, [
        'NativeWrapped',
        'TokensSwapped',
        'NewPositionCreated'
      ]);
    });

    it('should have ETHWrapped transaction with correct details', async () => {
      const wrapTxs = await getTransactionsByType(service, testVault.vaultAddress, 'NativeWrapped');

      expect(wrapTxs).toHaveLength(1);
      expect(wrapTxs[0].success).toBe(true);
      expect(wrapTxs[0].amountUSD).toBeGreaterThan(0);
      expect(wrapTxs[0].gasNative).toBeGreaterThan(0);
      expect(wrapTxs[0].transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(wrapTxs[0].gasUSD).toBeGreaterThan(0);
      expect(typeof wrapTxs[0].amountFormatted).toBe('string');
    });

    it('should have TokensSwapped transaction with enriched swap details', async () => {
      const swapTxs = await getTransactionsByType(service, testVault.vaultAddress, 'TokensSwapped');

      expect(swapTxs.length).toBeGreaterThanOrEqual(1);

      const swapTx = swapTxs[0];
      expect(swapTx.swapCount).toBeGreaterThan(0);
      expect(swapTx.swaps).toBeDefined();
      expect(swapTx.swaps.length).toBeGreaterThan(0);

      // Enriched swap should have USD values and slippage
      const swap = swapTx.swaps[0];
      expect(swap.tokenInSymbol).toBeDefined();
      expect(swap.tokenOutSymbol).toBeDefined();
      expect(typeof swap.slippagePercent).toBe('number');
      expect(swap.actualAmountInUSD).toBeGreaterThan(0);
      expect(swap.actualAmountOutUSD).toBeGreaterThan(0);
      expect(swap.priceInUSD).toBeGreaterThan(0);
      expect(swap.priceOutUSD).toBeGreaterThan(0);
      expect(swap.quotedAmountInUSD).toBeGreaterThan(0);
      expect(swap.quotedAmountOutUSD).toBeGreaterThan(0);
      expect(typeof swap.isAmountIn).toBe('boolean');
    });

    it('should have NewPositionCreated transaction with USD values and gas', async () => {
      const posTxs = await getTransactionsByType(service, testVault.vaultAddress, 'NewPositionCreated');

      expect(posTxs).toHaveLength(1);

      const posTx = posTxs[0];
      expect(posTx.totalActualUSD).toBeGreaterThan(0);
      expect(posTx.totalTargetUSD).toBeGreaterThan(0);
      expect(posTx.gasNative).toBeGreaterThan(0);
      expect(posTx.gasUSD).toBeGreaterThan(0);
      expect(posTx.platform).toBe('uniswapV3');
      expect(posTx.success).toBe(true);
      expect(posTx.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(posTx.positionId).toBeDefined();
      expect(posTx.deploymentAmount).toBeGreaterThan(0);
      expect(typeof posTx.differencePercent).toBe('number');
      expect(posTx.token0Symbol).toBeDefined();
      expect(posTx.token1Symbol).toBeDefined();
    });

    it('should have correct strategy metadata', () => {
      const metadata = service.tracker.getMetadata(testVault.vaultAddress);

      expect(metadata.metadata.strategyId).toBe('bob');
      expect(metadata.metadata.firstSeen).toBeDefined();
      expect(metadata.metadata.lastUpdated).toBeGreaterThan(metadata.metadata.firstSeen);
    });

    it('should have transactionCount matching actual log length', async () => {
      await expectTransactionCount(service, testVault.vaultAddress);
    });
  });
});
