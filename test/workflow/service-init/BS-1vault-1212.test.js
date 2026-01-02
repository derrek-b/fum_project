/**
 * @fileoverview Integration tests for AutomationService initialization with 1 vault
 * Tests Phase 3 of start() (vault discovery) and setupVault() steps 1-2 (data loading + baseline capture)
 * Based on legacy BS-1vault-1111.test.js but scoped to new architecture implementation
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

describe('AutomationService Initialization - 1 Vault (New Architecture)', () => {
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
  let feesCollectedEvents = [];
  let feesDistributedEvents = [];
  let utilizationEvents = [];
  let tokenPreparationCompletedEvents = [];
  let tokensSwappedEvents = [];

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

    // Create test vault with 1AP/1NP/1AT/2NT configuration
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '1AP/2NP/1AT/2NT Test Vault',
        automationServiceAddress: testConfig.automationServiceAddress,
        wrapEthAmount: '20',  // Increased to fund larger fee-generating swaps
        nativeEthAmount: '2',  // Send 2 ETH directly to vault (non-aligned, will need wrapping)
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '2' },
          { from: 'WETH', to: 'WBTC', amount: '2' }
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 15,
            tickRange: { type: 'centered', spacing: 10 }
          },
          {
            token0: 'WBTC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 30,
            tickRange: { type: 'centered', spacing: 5 }
          },
          {
            // Same tokens as aligned, but wrong pool (3000bp vs 500bp targetPool)
            token0: 'USDC',
            token1: 'WETH',
            fee: 3000,
            percentOfAssets: 15,
            tickRange: { type: 'centered', spacing: 10 }
          }
        ],
        feeGeneratingSwaps: [
          {
            pool: { token0: 'WBTC', token1: 'WETH', fee: 500 },
            swaps: [
              // Larger swaps to generate enough WBTC fees (>1 satoshi)
              // so 50% reinvestment doesn't round to 0
              { from: 'WETH', to: 'WBTC', amount: '5.0' },
              { from: 'WBTC', to: 'WETH', amount: '0.15' },
              { from: 'WETH', to: 'WBTC', amount: '5.0' },
              { from: 'WBTC', to: 'WETH', amount: '0.15' }
            ]
          }
        ],
        tokenTransfers: {
          'USDC': 60,
          'WBTC': 40
        },
        targetTokens: ['USDC', 'ETH'],
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

      service.eventManager.subscribe('FeesCollected', (data) => {
        feesCollectedEvents.push(data);
      });

      service.eventManager.subscribe('FeesDistributed', (data) => {
        feesDistributedEvents.push(data);
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
      expect(vaultsLoadedEvents[0].skippedBlacklisted).toBe(0);
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
      expect(vault.strategyAddress).toBeDefined();
      expect(vault.strategy).toBeDefined();
      expect(vault.strategy.strategyId).toBe('bob');
      expect(vault.targetTokens).toEqual(['USDC', 'ETH']);
      expect(vault.targetPlatforms).toEqual(['uniswapV3']);
      expect(vault.lastUpdated).toBeDefined();
      expect(vault.lastUpdated).toBeGreaterThan(Date.now() - 60000);
    });

    it('should cache positions correctly', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      // Verify positions - after initialization, only aligned position remains
      // (non-aligned positions are closed during strategy initialization)
      expect(vault.positions).toBeDefined();
      expect(Object.keys(vault.positions).length).toBe(1);

      // Verify each position has required fields
      for (const [positionId, position] of Object.entries(vault.positions)) {
        expect(position.id).toBe(positionId);
        expect(position.pool).toBeDefined();
        expect(position.pool).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(typeof position.tickLower).toBe('number');
        expect(typeof position.tickUpper).toBe('number');
        expect(position.tickLower).toBeLessThan(position.tickUpper);
        expect(position.liquidity).toBeDefined();
        expect(typeof position.liquidity).toBe('string');
        expect(position.lastUpdated).toBeDefined();
      }
    });

    it('should cache token balances correctly', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      // Verify vault.tokens exists and has valid structure
      expect(vault.tokens).toBeDefined();
      expect(typeof vault.tokens).toBe('object');
      expect(vault.tokens.USDC).toBeDefined();
      expect(vault.tokens.WBTC).toBeDefined();
      expect(typeof vault.tokens.USDC).toBe('string');
      expect(typeof vault.tokens.WBTC).toBe('string');

      // Use TokenBalancesFetched events to verify initial load was correct
      // First event is from initial vault load (Step 1)
      expect(tokenBalancesFetchedEvents.length).toBeGreaterThan(0);
      const initialBalances = tokenBalancesFetchedEvents[0].balances;

      // Initial balances should match what was transferred to vault
      expect(initialBalances.USDC).toBe(testVault.tokenBalances.USDC);
      expect(initialBalances.WBTC).toBe(testVault.tokenBalances.WBTC);
    });

    it('should emit vaultLoaded event with correct data', () => {
      expect(vaultLoadedEvents.length).toBe(1);

      const event = vaultLoadedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
      expect(event.positionCount).toBe(3);
      expect(event.positionIds).toHaveLength(3);
      expect(event.targetTokens).toEqual(['USDC', 'ETH']);
      expect(event.targetPlatforms).toEqual(['uniswapV3']);
    });

    it('should emit PoolDataFetched events for position pools', () => {
      // Should have pool data for both positions
      expect(poolDataFetchedEvents.length).toBeGreaterThanOrEqual(1);

      // Verify pool data structure
      for (const event of poolDataFetchedEvents) {
        expect(event.poolData).toBeDefined();
        expect(event.source).toBe('Uniswap V3');
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      }

      // Verify pool data was cached in service
      expect(Object.keys(service.poolData).length).toBeGreaterThanOrEqual(2);
    });

    it('should load strategy parameters from contract', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      expect(vault.strategy).toBeDefined();
      expect(vault.strategy.strategyId).toBe('bob');
      expect(vault.strategy.parameters).toBeDefined();

      // Verify key BabySteps parameters exist and have correct default values
      // Contract defaults to MODERATE template when no template is set
      const params = vault.strategy.parameters;
      expect(params.targetRangeUpper).toBe(5.0);   // 500 basis points → 5.0%
      expect(params.targetRangeLower).toBe(5.0);   // 500 basis points → 5.0%
      expect(params.maxUtilization).toBe(90);      // 9000 basis points → 90%
      expect(params.feeReinvestment).toBe(true);   // Default enabled
    });
  });

  describe('setupVault() Step 2: Baseline Capture', () => {
    it('should emit VaultBaselineCaptured event', () => {
      expect(vaultBaselineCapturedEvents.length).toBe(1);

      const event = vaultBaselineCapturedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });

    it('should capture total vault value in USD', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(typeof event.totalVaultValue).toBe('number');
      expect(event.totalVaultValue).toBeGreaterThan(0);
    });

    it('should capture token and position values separately', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(typeof event.tokenValue).toBe('number');
      expect(typeof event.positionValue).toBe('number');

      // Token + position = total
      expect(event.tokenValue + event.positionValue).toBeCloseTo(event.totalVaultValue, 2);
    });

    it('should include token breakdown in baseline', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(event.tokens).toBeDefined();
      expect(typeof event.tokens).toBe('object');

      // Should have entries for tokens with balances
      const tokenSymbols = Object.keys(event.tokens);
      expect(tokenSymbols.length).toBeGreaterThan(0);

      // Each token should have price and USD value
      for (const tokenData of Object.values(event.tokens)) {
        expect(tokenData.price).toBeDefined();
        expect(tokenData.usdValue).toBeDefined();
        expect(typeof tokenData.usdValue).toBe('number');
      }
    });

    it('should include position breakdown in baseline', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(event.positions).toBeDefined();
      expect(typeof event.positions).toBe('object');
      expect(Object.keys(event.positions).length).toBe(3);

      // Each position should have USD values for both tokens
      for (const positionData of Object.values(event.positions)) {
        expect(positionData.token0UsdValue).toBeDefined();
        expect(positionData.token1UsdValue).toBeDefined();
        expect(typeof positionData.token0UsdValue).toBe('number');
        expect(typeof positionData.token1UsdValue).toBe('number');
      }
    });

    it('should set correct capture point and metadata', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(event.capturePoint).toBe('pre_initialization');
      expect(event.strategyId).toBe('bob');
      expect(typeof event.timestamp).toBe('number');
      expect(event.timestamp).toBeGreaterThan(Date.now() - 60000);
    });
  });

  describe('setupVault() Step 3: Strategy Initialization', () => {
    describe('Pool Selection', () => {
      // Uniswap V3 constants for validation
      const VALID_V3_FEE_TIERS = [100, 500, 3000, 10000];
      const V3_MIN_TICK = -887272;
      const V3_MAX_TICK = 887272;

      it('should emit BestPoolSelected event', () => {
        expect(bestPoolSelectedEvents.length).toBe(1);

        const event = bestPoolSelectedEvents[0];
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
        expect(typeof event.timestamp).toBe('number');
      });

      it('should have correct event structure', () => {
        const event = bestPoolSelectedEvents[0];

        // Required fields
        expect(event).toHaveProperty('vaultAddress');
        expect(event).toHaveProperty('token0Symbol');
        expect(event).toHaveProperty('token1Symbol');
        expect(event).toHaveProperty('platformId');
        expect(event).toHaveProperty('poolAddress');
        expect(event).toHaveProperty('poolFee');
        expect(event).toHaveProperty('poolLiquidity');
        expect(event).toHaveProperty('poolTick');
        expect(event).toHaveProperty('poolsDiscovered');
        expect(event).toHaveProperty('poolsActive');
        expect(event).toHaveProperty('timestamp');
      });

      it('should select pool for correct token pair (sorted order)', () => {
        const event = bestPoolSelectedEvents[0];

        // Tokens should be sorted by address - verify both target tokens present
        const tokenPair = [event.token0Symbol, event.token1Symbol].sort();
        expect(tokenPair).toEqual(['USDC', 'WETH']);
      });

      it('should select pool on correct platform', () => {
        const event = bestPoolSelectedEvents[0];

        expect(event.platformId).toBe('uniswapV3');
      });

      it('should select pool with valid address', () => {
        const event = bestPoolSelectedEvents[0];

        expect(event.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });

      it('should select pool with valid V3 fee tier', () => {
        const event = bestPoolSelectedEvents[0];

        expect(VALID_V3_FEE_TIERS).toContain(event.poolFee);
      });

      it('should select pool with liquidity > 0 (not dead)', () => {
        const event = bestPoolSelectedEvents[0];

        // Liquidity is returned as string from BigInt
        expect(BigInt(event.poolLiquidity)).toBeGreaterThan(0n);
      });

      it('should select pool with tick in valid V3 range', () => {
        const event = bestPoolSelectedEvents[0];

        expect(event.poolTick).toBeGreaterThanOrEqual(V3_MIN_TICK);
        expect(event.poolTick).toBeLessThanOrEqual(V3_MAX_TICK);
      });

      it('should have poolsActive <= poolsDiscovered', () => {
        const event = bestPoolSelectedEvents[0];

        expect(event.poolsDiscovered).toBeGreaterThanOrEqual(1);
        expect(event.poolsActive).toBeGreaterThanOrEqual(1);
        expect(event.poolsActive).toBeLessThanOrEqual(event.poolsDiscovered);
      });
    });

    describe('Position Evaluation', () => {
      it('should emit InitialPositionsEvaluated event', () => {
        expect(initialPositionsEvaluatedEvents.length).toBe(1);

        const event = initialPositionsEvaluatedEvents[0];
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
        expect(event.success).toBe(true);
        expect(typeof event.timestamp).toBe('number');
      });

      it('should identify 1 aligned and 2 non-aligned positions', () => {
        const event = initialPositionsEvaluatedEvents[0];

        expect(event.alignedCount).toBe(1);
        expect(event.nonAlignedCount).toBe(2);
      });

      it('should return correct position IDs in aligned/non-aligned arrays', () => {
        const event = initialPositionsEvaluatedEvents[0];
        const vault = service.vaultDataService.getAllVaults()[0];

        // Should have 1 aligned, 2 non-aligned
        expect(event.alignedPositionIds).toHaveLength(1);
        expect(event.nonAlignedPositionIds).toHaveLength(2);

        // Aligned position should still exist in vault.positions (not closed)
        const remainingPositionIds = Object.keys(vault.positions);
        expect(remainingPositionIds).toContain(event.alignedPositionIds[0]);

        // Non-aligned positions should have been closed and removed
        for (const nonAlignedId of event.nonAlignedPositionIds) {
          expect(remainingPositionIds).not.toContain(nonAlignedId);
        }
      });

      it('should classify USDC/WETH position as aligned (correct tokens, platform, in range)', () => {
        const event = initialPositionsEvaluatedEvents[0];
        const vault = service.vaultDataService.getAllVaults()[0];

        // Find the USDC/WETH position by checking pool metadata
        const alignedPositionId = event.alignedPositionIds[0];
        const alignedPosition = vault.positions[alignedPositionId];
        const poolMetadata = service.poolData[alignedPosition.pool];

        // Verify it's the USDC/WETH position
        const tokens = [poolMetadata.token0Symbol, poolMetadata.token1Symbol].sort();
        expect(tokens).toEqual(['USDC', 'WETH']);
      });

      it('should classify WBTC/WETH position as non-aligned (WBTC not in target tokens)', () => {
        const event = initialPositionsEvaluatedEvents[0];
        const vault = service.vaultDataService.getAllVaults()[0];

        // Verify WBTC is not in target tokens (reason for non-alignment)
        expect(vault.targetTokens).not.toContain('WBTC');

        // All non-aligned positions should have been closed and removed
        for (const nonAlignedPositionId of event.nonAlignedPositionIds) {
          expect(vault.positions[nonAlignedPositionId]).toBeUndefined();
        }

        // Verify via PositionsClosed event that a WBTC/WETH position was closed
        if (positionsClosedEvents.length > 0) {
          const closedTokenPairs = positionsClosedEvents[0].closedPositions.map(p =>
            [p.token0Symbol, p.token1Symbol].sort().join('/')
          );
          expect(closedTokenPairs).toContain('WBTC/WETH');
        }
      });

      it('should classify USDC/WETH 3000bp position as non-aligned (wrong pool)', () => {
        // The 3000bp USDC/WETH position has correct tokens but wrong pool
        // (targetPool is 500bp based on liquidity)
        const event = initialPositionsEvaluatedEvents[0];

        // We should have 2 non-aligned positions
        expect(event.nonAlignedPositionIds).toHaveLength(2);

        // Verify via PositionsClosed event that a USDC/WETH position was also closed
        if (positionsClosedEvents.length > 0) {
          const closedTokenPairs = positionsClosedEvents[0].closedPositions.map(p =>
            [p.token0Symbol, p.token1Symbol].sort().join('/')
          );
          // Both WBTC/WETH (wrong tokens) and USDC/WETH (wrong pool) should be closed
          expect(closedTokenPairs).toContain('USDC/WETH');
          expect(closedTokenPairs).toContain('WBTC/WETH');
        }
      });

      it('should have exactly 2 non-aligned positions (not mark all as aligned)', () => {
        const event = initialPositionsEvaluatedEvents[0];

        // Scenario has 3 positions - verify counts add up correctly
        const totalEvaluated = event.alignedCount + event.nonAlignedCount;
        expect(totalEvaluated).toBe(3);

        // Explicitly verify we have exactly 2 non-aligned (not 0 or 1)
        expect(event.nonAlignedCount).toBe(2);
        expect(event.nonAlignedPositionIds).toHaveLength(2);

        // And exactly 1 aligned (not 2 or 3)
        expect(event.alignedCount).toBe(1);
        expect(event.alignedPositionIds).toHaveLength(1);

        // No overlap between aligned and non-aligned
        for (const nonAlignedId of event.nonAlignedPositionIds) {
          expect(event.alignedPositionIds).not.toContain(nonAlignedId);
        }
      });
    });

    describe('Position Closing', () => {
      // Uniswap V3 constants for validation
      const V3_MIN_TICK = -887272;
      const V3_MAX_TICK = 887272;

      it('should emit PositionsClosed event', () => {
        expect(positionsClosedEvents.length).toBe(1);
      });

      it('should have correct event structure', () => {
        const event = positionsClosedEvents[0];

        expect(event).toHaveProperty('vaultAddress');
        expect(event).toHaveProperty('closedCount');
        expect(event).toHaveProperty('closedPositions');
        expect(event).toHaveProperty('gasUsed');
        expect(event).toHaveProperty('gasEstimated');
        expect(event).toHaveProperty('effectiveGasPrice');
        expect(event).toHaveProperty('transactionHash');
        expect(event).toHaveProperty('success');
        expect(event).toHaveProperty('timestamp');
        expect(event).toHaveProperty('log');
      });

      it('should close exactly 2 positions (the non-aligned ones)', () => {
        const event = positionsClosedEvents[0];

        expect(event.closedCount).toBe(2);
        expect(event.closedPositions).toHaveLength(2);
      });

      it('should close the WBTC/WETH position (non-aligned - wrong tokens)', () => {
        const event = positionsClosedEvents[0];

        const closedTokenPairs = event.closedPositions.map(p =>
          [p.token0Symbol, p.token1Symbol].sort().join('/')
        );
        expect(closedTokenPairs).toContain('WBTC/WETH');
      });

      it('should close the USDC/WETH 3000bp position (non-aligned - wrong pool)', () => {
        const event = positionsClosedEvents[0];

        // One of the closed positions should be USDC/WETH (the one in wrong pool)
        const closedTokenPairs = event.closedPositions.map(p =>
          [p.token0Symbol, p.token1Symbol].sort().join('/')
        );
        expect(closedTokenPairs).toContain('USDC/WETH');
      });

      it('should NOT close the aligned USDC/WETH 500bp position', () => {
        // The aligned position (USDC/WETH in 500bp pool) should still exist
        const vault = service.vaultDataService.getAllVaults()[0];
        const event = initialPositionsEvaluatedEvents[0];

        // The aligned position should still be in vault.positions
        const alignedPositionId = event.alignedPositionIds[0];
        expect(vault.positions[alignedPositionId]).toBeDefined();

        // Verify it's the USDC/WETH position in the correct pool
        const poolMetadata = service.poolData[vault.positions[alignedPositionId].pool];
        const tokens = [poolMetadata.token0Symbol, poolMetadata.token1Symbol].sort();
        expect(tokens).toEqual(['USDC', 'WETH']);
      });

      it('should have correct token symbols in closed position', () => {
        const event = positionsClosedEvents[0];
        const closedPosition = event.closedPositions[0];

        expect(closedPosition).toHaveProperty('token0Symbol');
        expect(closedPosition).toHaveProperty('token1Symbol');
        expect(typeof closedPosition.token0Symbol).toBe('string');
        expect(typeof closedPosition.token1Symbol).toBe('string');
        expect(closedPosition.token0Symbol.length).toBeGreaterThan(0);
        expect(closedPosition.token1Symbol.length).toBeGreaterThan(0);
      });

      it('should have correct platform in closed position', () => {
        const event = positionsClosedEvents[0];
        const closedPosition = event.closedPositions[0];

        expect(closedPosition.platform).toBe('uniswapV3');
      });

      it('should have valid tick range in closed position', () => {
        const event = positionsClosedEvents[0];
        const closedPosition = event.closedPositions[0];

        expect(closedPosition).toHaveProperty('tickLower');
        expect(closedPosition).toHaveProperty('tickUpper');
        expect(typeof closedPosition.tickLower).toBe('number');
        expect(typeof closedPosition.tickUpper).toBe('number');
        expect(closedPosition.tickLower).toBeLessThan(closedPosition.tickUpper);
        expect(closedPosition.tickLower).toBeGreaterThanOrEqual(V3_MIN_TICK);
        expect(closedPosition.tickUpper).toBeLessThanOrEqual(V3_MAX_TICK);
      });

      it('should have principal amounts as numeric strings', () => {
        const event = positionsClosedEvents[0];
        const closedPosition = event.closedPositions[0];

        expect(closedPosition).toHaveProperty('principalAmount0');
        expect(closedPosition).toHaveProperty('principalAmount1');
        expect(typeof closedPosition.principalAmount0).toBe('string');
        expect(typeof closedPosition.principalAmount1).toBe('string');
        // Should be parseable as numbers
        expect(() => BigInt(closedPosition.principalAmount0)).not.toThrow();
        expect(() => BigInt(closedPosition.principalAmount1)).not.toThrow();
      });

      it('should have valid transaction hash', () => {
        const event = positionsClosedEvents[0];

        expect(event.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      });

      it('should have gas used > 0', () => {
        const event = positionsClosedEvents[0];

        expect(typeof event.gasUsed).toBe('string');
        expect(BigInt(event.gasUsed)).toBeGreaterThan(0n);
      });

      it('should have gas estimated > 0', () => {
        const event = positionsClosedEvents[0];

        expect(typeof event.gasEstimated).toBe('string');
        expect(BigInt(event.gasEstimated)).toBeGreaterThan(0n);
      });

      it('should have effective gas price > 0', () => {
        const event = positionsClosedEvents[0];

        expect(typeof event.effectiveGasPrice).toBe('string');
        expect(BigInt(event.effectiveGasPrice)).toBeGreaterThan(0n);
      });

      it('should remove closed position from vault.positions', () => {
        const vault = service.vaultDataService.getAllVaults()[0];
        const remainingPositions = Object.keys(vault.positions);

        // Should have only 1 position remaining (the aligned one)
        expect(remainingPositions.length).toBe(1);
      });

      it('should keep aligned position in vault.positions', () => {
        const vault = service.vaultDataService.getAllVaults()[0];

        // The remaining position should be USDC/WETH (aligned)
        const remainingPosition = Object.values(vault.positions)[0];
        const poolMetadata = service.poolData[remainingPosition.pool];
        const remainingSymbols = [poolMetadata.token0Symbol, poolMetadata.token1Symbol].sort();

        expect(remainingSymbols).toEqual(['USDC', 'WETH']);
      });

      it('should emit BatchTransactionExecuted for position closes', () => {
        // Find BatchTransactionExecuted events for this vault
        const closeEvents = batchTransactionExecutedEvents.filter(
          e => e.vaultAddress.toLowerCase() === testVault.vaultAddress.toLowerCase() &&
               e.operationType.toLowerCase().includes('close')
        );

        expect(closeEvents.length).toBeGreaterThanOrEqual(1);

        // Verify structure of the batch transaction event
        const closeEvent = closeEvents[0];
        expect(closeEvent).toHaveProperty('transactionCount');
        expect(closeEvent).toHaveProperty('transactionHash');
        expect(closeEvent).toHaveProperty('gasUsed');
        expect(closeEvent).toHaveProperty('gasEstimated');
        expect(closeEvent.transactionCount).toBeGreaterThanOrEqual(1);
      });

      it('should have success flag true on PositionsClosed event', () => {
        const event = positionsClosedEvents[0];

        expect(event.success).toBe(true);
      });

      it('should have positionId matching a non-aligned position from evaluation', () => {
        const positionsClosedEvent = positionsClosedEvents[0];
        const evaluationEvent = initialPositionsEvaluatedEvents[0];

        const closedPositionId = positionsClosedEvent.closedPositions[0].positionId;

        // The closed position ID should match one from non-aligned evaluation
        expect(evaluationEvent.nonAlignedPositionIds).toContain(closedPositionId);
      });
    });

    describe('Fee Collection', () => {
      it('should emit FeesCollected event with new multi-token structure', () => {
        expect(feesCollectedEvents.length).toBe(1);

        const event = feesCollectedEvents[0];
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
        expect(event.source).toBe('initialization');
        expect(Array.isArray(event.positionIds)).toBe(true);
        expect(event.positionIds.length).toBe(2); // Two non-aligned positions closed
        expect(Array.isArray(event.fees)).toBe(true);
        expect(event.totalUSD).toBeGreaterThan(0);
        expect(event.reinvestmentRatio).toBe(50);
        expect(event.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(typeof event.timestamp).toBe('number');
      });

      it('should have correct fee structure for each token', () => {
        const event = feesCollectedEvents[0];

        for (const fee of event.fees) {
          expect(fee).toHaveProperty('token');
          expect(fee).toHaveProperty('address');
          expect(fee).toHaveProperty('amount');
          expect(fee).toHaveProperty('amountFormatted');
          expect(fee).toHaveProperty('decimals');
          expect(fee).toHaveProperty('usd');
          expect(fee).toHaveProperty('toOwner');
          expect(fee).toHaveProperty('reinvested');
          expect(fee.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        }
      });

      it('should have WBTC fees collected from non-aligned position', () => {
        const event = feesCollectedEvents[0];

        const wbtcFee = event.fees.find(f => f.token === 'WBTC');
        expect(wbtcFee).toBeDefined();
        expect(wbtcFee.amountFormatted).toBeGreaterThan(0);
        expect(wbtcFee.toOwner).toBeGreaterThan(0);
      });

      it('should have WETH fees collected from non-aligned position', () => {
        const event = feesCollectedEvents[0];

        const wethFee = event.fees.find(f => f.token === 'WETH');
        expect(wethFee).toBeDefined();
        expect(wethFee.amountFormatted).toBeGreaterThan(0);
        expect(wethFee.toOwner).toBeGreaterThan(0);
      });

      it('should correctly calculate owner vs reinvested amounts', () => {
        const event = feesCollectedEvents[0];

        // With 50% reinvestment ratio, toOwner + reinvested should equal total
        // Note: Integer division with small amounts causes rounding - that's expected
        for (const fee of event.fees) {
          const total = fee.toOwner + fee.reinvested;
          // Total should be close to amountFormatted (slight float precision differences allowed)
          expect(total).toBeCloseTo(fee.amountFormatted, 5);
          // Both should be non-negative
          expect(fee.toOwner).toBeGreaterThanOrEqual(0);
          expect(fee.reinvested).toBeGreaterThanOrEqual(0);
        }
      });
    });

    describe('Fee Distribution', () => {
      it('should emit FeesDistributed event after closing positions with fees', () => {
        expect(feesDistributedEvents.length).toBe(1);

        const event = feesDistributedEvents[0];
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
        expect(typeof event.timestamp).toBe('number');
      });

      it('should have correct event structure', () => {
        const event = feesDistributedEvents[0];

        expect(event).toHaveProperty('vaultAddress');
        expect(event).toHaveProperty('owner');
        expect(event).toHaveProperty('reinvestmentRatio');
        expect(event).toHaveProperty('distributions');
        expect(event).toHaveProperty('failures');
        expect(event).toHaveProperty('totalTokensDistributed');
        expect(event).toHaveProperty('totalTokensFailed');
        expect(event).toHaveProperty('timestamp');
      });

      it('should distribute WBTC fees (non-WETH token via withdrawTokens)', () => {
        const event = feesDistributedEvents[0];

        const wbtcDistribution = event.distributions.find(d => d.token === 'WBTC');
        expect(wbtcDistribution).toBeDefined();
        expect(BigInt(wbtcDistribution.amount)).toBeGreaterThan(0n);
        expect(wbtcDistribution.asNativeEth).toBe(false);
        expect(wbtcDistribution.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      });

      it('should distribute WETH fees as native ETH (unwrapped via unwrapAndWithdrawETH)', () => {
        const event = feesDistributedEvents[0];

        const wethDistribution = event.distributions.find(d => d.token === 'WETH');
        expect(wethDistribution).toBeDefined();
        expect(BigInt(wethDistribution.amount)).toBeGreaterThan(0n);
        expect(wethDistribution.asNativeEth).toBe(true);
        expect(wethDistribution.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      });

      it('should have correct distribution fields for each token', () => {
        const event = feesDistributedEvents[0];

        for (const dist of event.distributions) {
          expect(dist).toHaveProperty('token');
          expect(dist).toHaveProperty('address');
          expect(dist).toHaveProperty('amount');
          expect(dist).toHaveProperty('amountFormatted');
          expect(dist).toHaveProperty('asNativeEth');
          expect(dist).toHaveProperty('transactionHash');
          expect(dist.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        }
      });

      it('should have no failures in fee distribution', () => {
        const event = feesDistributedEvents[0];

        expect(event.failures).toHaveLength(0);
        expect(event.totalTokensFailed).toBe(0);
      });

      it('should distribute fees for tokens from closed positions', () => {
        const event = feesDistributedEvents[0];

        // With 2 non-aligned positions closed (WBTC/WETH and USDC/WETH 3000bp),
        // we should have distributions for WBTC and WETH (WETH from both positions)
        expect(event.distributions.length).toBeGreaterThanOrEqual(2);
        expect(event.totalTokensDistributed).toBeGreaterThanOrEqual(2);

        // Should have WBTC and WETH distributions at minimum
        const tokenSymbols = event.distributions.map(d => d.token);
        expect(tokenSymbols).toContain('WBTC');
        expect(tokenSymbols).toContain('WETH');
      });

      it('should use correct reinvestment ratio from strategy parameters', () => {
        const event = feesDistributedEvents[0];
        const vault = service.vaultDataService.getAllVaults()[0];

        // Default reinvestmentRatio from strategy is stored in parameters
        const expectedRatio = vault.strategy.parameters.reinvestmentRatio || 0;
        expect(event.reinvestmentRatio).toBe(expectedRatio);
      });
    });
  });

  describe('setupVault() Step 4: Token Balance Refresh', () => {
    it('should emit TokenBalancesFetched event after position closures', () => {
      // Should have at least 2 events: initial load (Step 1) + post-closure refresh (Step 4)
      expect(tokenBalancesFetchedEvents.length).toBeGreaterThanOrEqual(2);

      const postClosureEvent = tokenBalancesFetchedEvents[1];
      expect(postClosureEvent.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(postClosureEvent.balances).toBeDefined();
    });

    it('should have increased WBTC balance after closing WBTC/WETH position', () => {
      const initialBalances = tokenBalancesFetchedEvents[0].balances;
      const postClosureBalances = tokenBalancesFetchedEvents[1].balances;

      // WBTC balance should be greater than initial because:
      // - Position principal was returned
      // - 50% of fees were kept (reinvested)
      // - Only 50% of fees were distributed to owner
      expect(BigInt(postClosureBalances.WBTC)).toBeGreaterThan(BigInt(initialBalances.WBTC));
    });

    it('should have increased WETH balance after closing WBTC/WETH position', () => {
      const initialBalances = tokenBalancesFetchedEvents[0].balances;
      const postClosureBalances = tokenBalancesFetchedEvents[1].balances;

      // WETH balance should be greater than initial because:
      // - Position principal was returned
      // - 50% of fees were kept (reinvested)
      // - Owner's 50% was unwrapped and sent as native ETH
      expect(BigInt(postClosureBalances.WETH)).toBeGreaterThan(BigInt(initialBalances.WETH));
    });

    it('should have increased USDC balance after closing USDC/WETH 3000bp position', () => {
      const initialBalances = tokenBalancesFetchedEvents[0].balances;
      const postClosureBalances = tokenBalancesFetchedEvents[1].balances;

      // USDC balance should increase because the USDC/WETH 3000bp position was closed
      // and its principal was returned to the vault
      expect(BigInt(postClosureBalances.USDC)).toBeGreaterThan(BigInt(initialBalances.USDC));
    });
  });

  describe('setupVault() Step 5: Calculate Available Deployment', () => {
    it('should emit UtilizationCalculated event', () => {
      expect(utilizationEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should have correct event structure', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.totalVaultValue).toBeDefined();
      expect(event.positionValue).toBeDefined();
      expect(event.tokenValue).toBeDefined();
      expect(event.currentUtilization).toBeDefined();
      expect(event.maxUtilization).toBeDefined();
      expect(event.availableDeployment).toBeDefined();
    });

    it('should calculate utilization correctly', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];

      // Verify maxUtilization matches strategy param (90% = 0.9)
      expect(event.maxUtilization).toBe(0.9);

      // Verify currentUtilization formula: positionValue / totalVaultValue
      const expectedCurrentUtil = event.totalVaultValue > 0
        ? event.positionValue / event.totalVaultValue
        : 0;
      expect(event.currentUtilization).toBeCloseTo(expectedCurrentUtil, 10);
    });

    it('should calculate availableDeployment correctly', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];

      // Formula: (totalValue * maxUtilization) - positionValue
      const rawExpected = event.totalVaultValue * event.maxUtilization - event.positionValue;

      // availableDeployment is either rawExpected or 0 (if below threshold)
      expect(event.availableDeployment).toBeGreaterThanOrEqual(0);
      expect(event.rawAvailableDeployment).toBeCloseTo(rawExpected, 2);
    });

    it('should have position value (1111 scenario has aligned position)', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];
      expect(event.positionValue).toBeGreaterThan(0);
    });

    it('should have token value (1111 scenario has token balances)', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];
      expect(event.tokenValue).toBeGreaterThan(0);
    });

    it('should include minimum deployment threshold details', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];
      // minDeployment = max(chainMinimum, vaultRelativeMinimum)
      expect(event.minDeployment).toBeDefined();
      expect(event.minDeployment).toBeGreaterThan(0);
      expect(event.chainMinimum).toBeDefined();
      expect(event.vaultRelativeMinimum).toBeDefined();
      expect(event.minDeployment).toBe(Math.max(event.chainMinimum, event.vaultRelativeMinimum));
    });

    it('should include utilization gap', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];
      expect(event.utilizationGap).toBeDefined();
      expect(event.utilizationGapPercent).toBeDefined();
      // gap = maxUtil - currentUtil
      expect(event.utilizationGap).toBeCloseTo(event.maxUtilization - event.currentUtilization, 10);
      expect(event.utilizationGapPercent).toBeCloseTo(event.utilizationGap * 100, 10);
    });
  });

  describe('Token Preparation (prepareTokensForPosition)', () => {
    // Token preparation happens during addToPosition which runs as part of initializeVault
    // The TokenPreparationCompleted event is captured by the subscription set up in Phase 3

    it('should emit TokenPreparationCompleted event during initialization', () => {
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

    it('should have ETH wrap amount > 0 - native ETH is used for WETH deficit', () => {
      const event = tokenPreparationCompletedEvents[0];

      // This test has nativeEthAmount: '2' and target tokens are USDC/WETH
      // ETH should be wrapped to cover WETH deficit
      expect(event.wrapUnwrap).toBeDefined();
      expect(event.wrapUnwrap.wrapAmount).toBeDefined();
      expect(event.wrapUnwrap.unwrapAmount).toBeDefined();

      // wrapAmount should be > 0 (ETH → WETH to cover WETH deficit)
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

    it('should calculate deficits correctly using verified balances', () => {
      const event = tokenPreparationCompletedEvents[0];

      // Get independently verified balances from post-closure TokenBalancesFetched event
      const postClosureBalances = tokenBalancesFetchedEvents[1].balances;

      for (const tokenData of Object.values(event.targetTokens)) {
        const symbol = tokenData.symbol;
        const eventRequired = BigInt(tokenData.required);
        const eventAvailable = BigInt(tokenData.available);
        const eventDeficit = BigInt(tokenData.deficit);

        // Verify available matches independently verified balance
        const verifiedAvailable = BigInt(postClosureBalances[symbol]);
        expect(eventAvailable).toBe(verifiedAvailable);

        // Verify deficit = max(0, required - available)
        const expectedDeficit = eventRequired > verifiedAvailable ? eventRequired - verifiedAvailable : 0n;
        expect(eventDeficit).toBe(expectedDeficit);
      }
    });

    it('should route swap transactions to correct UniversalRouter', () => {
      const event = tokenPreparationCompletedEvents[0];

      if (event.swapTransactions.length > 0) {
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

    it('should use WBTC as non-aligned token for deficit coverage (1212 scenario)', () => {
      const event = tokenPreparationCompletedEvents[0];

      // 1212 scenario has WBTC as non-aligned token (not in targetTokens: ['USDC', 'WETH'])
      if (event.preparationResult === 'swaps_generated') {
        expect(event.nonAlignedTokensUsed).toContain('WBTC');
        expect(event.swapTransactions.length).toBeGreaterThan(0);
      } else if (event.preparationResult === 'sufficient_tokens') {
        expect(event.swapTransactions).toHaveLength(0);
      }
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

    it('should have correct phasesUsed for 1212 scenario with native ETH', () => {
      const event = tokenPreparationCompletedEvents[0];

      // 1212 scenario: native ETH + WBTC non-aligned, target USDC/WETH
      // - wrapUnwrap: true (ETH wraps to WETH)
      // - nonAlignedForDeficit: true (ETH and WBTC used for deficits)
      // - bufferSwaps: true (remaining non-aligned tokens split to both targets)
      // - excessTargetTokens: false (no excess, we have deficits)
      expect(event.phasesUsed.wrapUnwrap).toBe(true);
      expect(event.phasesUsed.nonAlignedForDeficit).toBe(true);
      expect(event.phasesUsed.bufferSwaps).toBe(true);
      expect(event.phasesUsed.excessTargetTokens).toBe(false);
    });
  });

  describe('Token Swap Execution (TokensSwapped event)', () => {
    it('should emit TokensSwapped event for deficit swaps', () => {
      // TokensSwapped events are emitted after successful swap execution
      const deficitEvent = tokensSwappedEvents.find(e => e.swapType === 'deficit_coverage');

      // Only expect deficit event if swaps were generated
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

      // Only expect buffer event if buffer swaps were generated
      const tokenPrepEvent = tokenPreparationCompletedEvents[0];
      if (tokenPrepEvent.preparationResult === 'swaps_generated' && tokenPrepEvent.bufferSwapCount > 0) {
        expect(bufferEvent).toBeDefined();
        expect(bufferEvent.success).toBe(true);
        expect(bufferEvent.swapCount).toBeGreaterThan(0);
      }
    });

    it('should have actual amounts in swap details', () => {
      // Get any TokensSwapped event
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

    it('should have slippage within tolerance', () => {
      // Check that actual amounts are within slippage tolerance of quoted amounts
      if (tokensSwappedEvents.length > 0) {
        const event = tokensSwappedEvents[0];
        const maxSlippageBps = 50; // 0.5% default

        for (const swap of event.swaps) {
          const quoted = BigInt(swap.quotedAmountOut);
          const actual = BigInt(swap.actualAmountOut);

          if (quoted > 0n) {
            // Calculate slippage in basis points: (quoted - actual) * 10000 / quoted
            const slippageBps = (quoted - actual) * 10000n / quoted;

            // Slippage should be less than max tolerance
            // Note: negative slippage (got more than quoted) is fine
            expect(slippageBps).toBeLessThanOrEqual(BigInt(maxSlippageBps));
          }
        }
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

    it('should have actualAmountIn > 0 (validates receipt parsing)', () => {
      // If actualAmountIn is 0, our extractSwapAmountsFromReceipt parsing is broken
      if (tokensSwappedEvents.length > 0) {
        for (const event of tokensSwappedEvents) {
          for (const swap of event.swaps) {
            expect(BigInt(swap.actualAmountIn)).toBeGreaterThan(0n);
          }
        }
      }
    });

    it('should use WBTC as input token for deficit swaps (1212 scenario)', () => {
      // Validates our token selection logic in prepareTokensForPosition
      // 1212 scenario: WBTC is non-aligned, should be used for deficit coverage
      const deficitEvent = tokensSwappedEvents.find(e => e.swapType === 'deficit_coverage');

      if (deficitEvent) {
        // At least one deficit swap should have WBTC as input
        const wbtcSwaps = deficitEvent.swaps.filter(s => s.tokenInSymbol === 'WBTC');
        expect(wbtcSwaps.length).toBeGreaterThan(0);

        // Output should be target tokens (USDC or WETH)
        for (const swap of deficitEvent.swaps) {
          expect(['USDC', 'WETH']).toContain(swap.tokenOutSymbol);
        }
      }
    });

    it('should reflect balance changes after swap execution', () => {
      // End-to-end verification: swaps actually moved tokens on-chain
      const tokenPrepEvent = tokenPreparationCompletedEvents[0];

      if (tokenPrepEvent.preparationResult === 'swaps_generated' && tokensSwappedEvents.length > 0) {
        // Get balances: post-closure (before swaps) vs final (after swaps)
        // tokenBalancesFetchedEvents[1] = after position closure, before swaps
        // tokenBalancesFetchedEvents[2] = after swaps (final refresh)
        const preSwapBalances = tokenBalancesFetchedEvents[1]?.balances;
        const postSwapBalances = tokenBalancesFetchedEvents[2]?.balances;

        if (preSwapBalances && postSwapBalances) {
          // WBTC (non-aligned, used as swap input) should decrease
          const wbtcBefore = BigInt(preSwapBalances.WBTC || '0');
          const wbtcAfter = BigInt(postSwapBalances.WBTC || '0');
          expect(wbtcAfter).toBeLessThan(wbtcBefore);

          // At least one target token should increase from swaps
          // (USDC or WETH depending on which had deficit)
          const usdcBefore = BigInt(preSwapBalances.USDC || '0');
          const usdcAfter = BigInt(postSwapBalances.USDC || '0');
          const wethBefore = BigInt(preSwapBalances.WETH || '0');
          const wethAfter = BigInt(postSwapBalances.WETH || '0');

          // Either USDC or WETH (or both) should have increased
          const usdcIncreased = usdcAfter > usdcBefore;
          const wethIncreased = wethAfter > wethBefore;
          expect(usdcIncreased || wethIncreased).toBe(true);
        }
      }
    });
  });

  describe('Setup Completion', () => {
    it('should emit VaultSetupComplete event', () => {
      expect(vaultSetupCompleteEvents.length).toBe(1);

      const event = vaultSetupCompleteEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
      // After closing non-aligned position, only 1 position remains
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
