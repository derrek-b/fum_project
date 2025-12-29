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
  let feesCollectedEvents = [];
  let feesDistributedEvents = [];

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

    // Create test vault with 1AP/1NP/1AT/1NT configuration (same as legacy test)
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '1AP/1NP/1AT/1NT Test Vault',
        automationServiceAddress: testConfig.automationServiceAddress,
        wrapEthAmount: '10',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '2' },
          { from: 'WETH', to: 'WBTC', amount: '2' }
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 20,
            tickRange: { type: 'centered', spacing: 10 }
          },
          {
            token0: 'WBTC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 30,
            tickRange: { type: 'centered', spacing: 5 }
          }
        ],
        feeGeneratingSwaps: [
          {
            pool: { token0: 'WBTC', token1: 'WETH', fee: 500 },
            swaps: [
              // Multiple back-and-forth swaps to generate fees in both tokens
              // WBTC needs more fee volume because integer division with 50% reinvestment
              // rounds small amounts to zero (1 satoshi * 5000 / 10000 = 0)
              { from: 'WETH', to: 'WBTC', amount: '0.3' },
              { from: 'WBTC', to: 'WETH', amount: '0.01' },
              { from: 'WETH', to: 'WBTC', amount: '0.3' },
              { from: 'WBTC', to: 'WETH', amount: '0.01' },
              { from: 'WETH', to: 'WBTC', amount: '0.3' },
              { from: 'WBTC', to: 'WETH', amount: '0.01' },
              { from: 'WETH', to: 'WBTC', amount: '0.3' },
              { from: 'WBTC', to: 'WETH', amount: '0.01' }
            ]
          }
        ],
        tokenTransfers: {
          'USDC': 60,
          'WBTC': 40
        },
        targetTokens: ['USDC', 'WETH'],
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

      service.eventManager.subscribe('FeesCollected', (data) => {
        feesCollectedEvents.push(data);
      });

      service.eventManager.subscribe('FeesDistributed', (data) => {
        feesDistributedEvents.push(data);
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
      expect(vault.targetTokens).toEqual(['USDC', 'WETH']);
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

      // Verify tokens
      expect(vault.tokens).toBeDefined();
      expect(vault.tokens.USDC).toBeDefined();
      expect(vault.tokens.WBTC).toBeDefined();

      // Verify token balances match what was transferred
      expect(vault.tokens.USDC).toBe(testVault.tokenBalances.USDC);
      expect(vault.tokens.WBTC).toBe(testVault.tokenBalances.WBTC);
    });

    it('should emit vaultLoaded event with correct data', () => {
      expect(vaultLoadedEvents.length).toBe(1);

      const event = vaultLoadedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
      expect(event.positionCount).toBe(2);
      expect(event.positionIds).toHaveLength(2);
      expect(event.targetTokens).toEqual(['USDC', 'WETH']);
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
      expect(Object.keys(event.positions).length).toBe(2);

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
    describe('Position Evaluation', () => {
      it('should emit InitialPositionsEvaluated event', () => {
        expect(initialPositionsEvaluatedEvents.length).toBe(1);

        const event = initialPositionsEvaluatedEvents[0];
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
        expect(event.success).toBe(true);
        expect(typeof event.timestamp).toBe('number');
      });

      it('should identify 1 aligned and 1 non-aligned position', () => {
        const event = initialPositionsEvaluatedEvents[0];

        expect(event.alignedCount).toBe(1);
        expect(event.nonAlignedCount).toBe(1);
      });

      it('should return correct position IDs in aligned/non-aligned arrays', () => {
        const event = initialPositionsEvaluatedEvents[0];
        const vault = service.vaultDataService.getAllVaults()[0];

        // Should have exactly 1 position in each array
        expect(event.alignedPositionIds).toHaveLength(1);
        expect(event.nonAlignedPositionIds).toHaveLength(1);

        // Aligned position should still exist in vault.positions (not closed)
        const remainingPositionIds = Object.keys(vault.positions);
        expect(remainingPositionIds).toContain(event.alignedPositionIds[0]);

        // Non-aligned position should have been closed and removed
        expect(remainingPositionIds).not.toContain(event.nonAlignedPositionIds[0]);
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

        // The non-aligned position was closed and removed
        const nonAlignedPositionId = event.nonAlignedPositionIds[0];
        expect(vault.positions[nonAlignedPositionId]).toBeUndefined();

        // Verify via PositionsClosed event that a WBTC/WETH position was closed
        // (if event was emitted - event emission is tested separately)
        if (positionsClosedEvents.length > 0) {
          const closedPosition = positionsClosedEvents[0].closedPositions[0];
          const closedTokens = [closedPosition.token0Symbol, closedPosition.token1Symbol].sort();
          expect(closedTokens).toEqual(['WBTC', 'WETH']);
        }
      });
    });

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

      it('should close exactly 1 position (the non-aligned one)', () => {
        const event = positionsClosedEvents[0];

        expect(event.closedCount).toBe(1);
        expect(event.closedPositions).toHaveLength(1);
      });

      it('should close the WBTC/WETH position (non-aligned)', () => {
        const event = positionsClosedEvents[0];
        const closedPosition = event.closedPositions[0];

        // Token order depends on address sorting, but one should be WBTC, one WETH
        const symbols = [closedPosition.token0Symbol, closedPosition.token1Symbol].sort();
        expect(symbols).toEqual(['WBTC', 'WETH']);
      });

      it('should NOT close the USDC/WETH position (aligned)', () => {
        const event = positionsClosedEvents[0];

        // Verify no USDC position was closed
        for (const closedPosition of event.closedPositions) {
          const symbols = [closedPosition.token0Symbol, closedPosition.token1Symbol];
          expect(symbols).not.toContain('USDC');
        }
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
        expect(event.positionIds.length).toBe(1); // One non-aligned position closed
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

      it('should distribute 2 tokens total (WBTC and WETH)', () => {
        const event = feesDistributedEvents[0];

        expect(event.distributions).toHaveLength(2);
        expect(event.totalTokensDistributed).toBe(2);
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
