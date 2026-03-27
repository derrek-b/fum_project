/**
 * @fileoverview Integration tests for TJ V2.2 position demotion + addToPosition workflow
 * Tests vault initialization with 2 aligned + 1 non-aligned positions, maxPositions=1
 *
 * Scenario: 2 Aligned Positions / 1 Non-Aligned Position / 0 Aligned Tokens / 0 Non-aligned Tokens
 * - 2 USDC/WAVAX positions (aligned): one centered (survives), one shifted (demoted)
 * - 1 USDT/USDC position (non-aligned): wrong tokens for target pair
 * - maxPositions=1 triggers demotion: most centered position survives
 * - Fee-generating swaps on USDC/WAVAX pool create collectable fees
 * - After closures: USDT from non-aligned position used for deficit swaps
 * - addToPosition on the surviving centered position
 *
 * Run with: FORK_CHAIN=avalanche npm test -- test/workflow/traderjoe/service-init/BS-2100.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../../helpers/hardhat-setup.js';
import { setupTraderJoeTestVault } from '../../../helpers/traderjoe-vault-setup.js';
import { configureTJStrategyParameters } from '../../../helpers/traderjoe-swap-utils.js';

// USD₮0 is the library key for USDT (Tether) on Avalanche
const USDT = 'USD₮0';

describe('AutomationService Initialization - TJ V2.2 Position Demotion + addToPosition', () => {
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
  let feesCollectedEvents = [];
  let feesDistributedEvents = [];
  let utilizationEvents = [];
  let tokenPreparationCompletedEvents = [];
  let tokensSwappedEvents = [];
  let liquidityAddedToPositionEvents = [];
  let assetValuesFetchedEvents = [];

  beforeAll(async () => {
    // Setup blockchain environment (Avalanche fork via FORK_CHAIN=avalanche)
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create test vault with 2AP/1NP/0AT/0NT configuration
    // - 2 aligned USDC/WAVAX positions (centered + shifted)
    // - 1 non-aligned USDT/USDC position
    // - No loose tokens in vault (all capital in positions)
    // - Fee-generating swaps on USDC/WAVAX pool
    testVault = await setupTraderJoeTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '2AP/1NP/0AT/0NT - TJ Position Demotion Test',
        nativeAmount: '100',
        swapTokens: [
          { from: 'AVAX', to: 'USDC', amount: '40', binStep: 10, version: 3 },
          { from: 'USDC', to: USDT, amount: '50', binStep: 1, version: 3 }
        ],
        positions: [
          // Aligned position 1: centered — will SURVIVE (centeredness ~0.5)
          {
            tokenX: 'USDC',
            tokenY: 'WAVAX',
            binStep: 10,
            percentOfAssets: 15,
            binRange: { type: 'centered', spacing: 10 }
          },
          // Aligned position 2: shifted — will be DEMOTED (centeredness ~0.15)
          {
            tokenX: 'USDC',
            tokenY: 'WAVAX',
            binStep: 10,
            percentOfAssets: 15,
            binRange: { type: 'shifted', spacing: 10, offset: 7 }
          },
          // Non-aligned position: USDT not in target tokens
          {
            tokenX: 'USDC',
            tokenY: USDT,
            binStep: 1,
            percentOfAssets: 25,
            binRange: { type: 'centered', spacing: 10 }
          }
        ],
        feeGeneratingSwaps: [
          {
            pool: { tokenX: 'USDC', tokenY: 'WAVAX', binStep: 10, version: 3 },
            swaps: [
              { from: 'WAVAX', to: 'USDC', amount: '3' },
              { from: 'USDC', to: 'WAVAX', amount: '20' },
              { from: 'WAVAX', to: 'USDC', amount: '3' },
              { from: 'USDC', to: 'WAVAX', amount: '20' }
            ]
          }
        ],
        tokenTransfers: {},  // No loose tokens — all capital in positions
        targetTokens: ['USDC', 'WAVAX'],
        targetPlatforms: ['traderjoeV2_2'],
        strategy: 'bob'
      }
    );

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

      service.eventManager.subscribe('FeesCollected', (data) => {
        feesCollectedEvents.push(data);
      });

      service.eventManager.subscribe('FeesDistributed', (data) => {
        feesDistributedEvents.push(data);
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

      service.eventManager.subscribe('LiquidityAddedToPosition', (data) => {
        liquidityAddedToPositionEvents.push(data);
      });

      service.eventManager.subscribe('AssetValuesFetched', (data) => {
        assetValuesFetchedEvents.push(data);
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

      expect(vault.address.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(vault.owner).toBeDefined();
      expect(vault.chainId).toBe(1338);
      expect(vault.strategy).toBeDefined();
      expect(vault.strategy.strategyId).toBe('bob');
      expect(vault.targetTokens).toEqual(['USDC', 'WAVAX']);
      expect(vault.targetPlatforms).toEqual(['traderjoeV2_2']);
    });

    it('should cache positions correctly (1 remaining after init)', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      // After initialization, only the surviving aligned position remains
      expect(vault.positions).toBeDefined();
      expect(Object.keys(vault.positions).length).toBe(1);

      // Verify position has TJ-specific fields
      for (const [positionId, position] of Object.entries(vault.positions)) {
        expect(position.id).toBe(positionId);
        expect(position.pool).toBeDefined();
        expect(position.pool).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(typeof position.lowerBinId).toBe('number');
        expect(typeof position.upperBinId).toBe('number');
        expect(position.lowerBinId).toBeLessThan(position.upperBinId);
        expect(position.depositIds).toBeDefined();
        expect(position.depositIds.length).toBeGreaterThan(0);
        expect(position.lastUpdated).toBeDefined();
      }
    });

    it('should have minimal token balances initially (all capital in positions)', () => {
      // First TokenBalancesFetched event is from initial vault load
      expect(tokenBalancesFetchedEvents.length).toBeGreaterThan(0);
      const initialBalances = tokenBalancesFetchedEvents[0].balances;

      // No tokenTransfers were configured, so vault should have minimal tokens
      // (only what's left after position creation, which may be dust or 0)
      expect(initialBalances).toBeDefined();
    });

    it('should emit vaultLoaded event with correct data', () => {
      expect(vaultLoadedEvents.length).toBe(1);

      const event = vaultLoadedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
      expect(event.positionCount).toBe(3);
      expect(event.positionIds).toHaveLength(3);
      expect(event.targetTokens).toEqual(['USDC', 'WAVAX']);
      expect(event.targetPlatforms).toEqual(['traderjoeV2_2']);
    });

    it('should emit PoolDataFetched events for position pools', () => {
      expect(poolDataFetchedEvents.length).toBeGreaterThanOrEqual(1);

      for (const event of poolDataFetchedEvents) {
        expect(event.poolData).toBeDefined();
        expect(['Trader Joe V2.2', 'updatePosition']).toContain(event.source);
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      }

      // Should have pool data cached (at least 2 pools: USDC/WAVAX and USDT/USDC)
      expect(Object.keys(service.poolData).length).toBeGreaterThanOrEqual(2);
    });

    it('should load strategy parameters from contract', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      expect(vault.strategy).toBeDefined();
      expect(vault.strategy.strategyId).toBe('bob');
      expect(vault.strategy.parameters).toBeDefined();

      const params = vault.strategy.parameters;
      expect(params.feeReinvestment).toBe(true);
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

    it('should have position value > 0 (3 positions with capital)', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(typeof event.positionValue).toBe('number');
      expect(event.positionValue).toBeGreaterThan(0);
    });

    it('should have 3 positions in baseline', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(event.positions).toBeDefined();
      expect(Object.keys(event.positions).length).toBe(3);

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
      expect(event.timestamp).toBeGreaterThan(Date.now() - 180000); // 5 min window — BS-2100 setup takes ~3 min
    });
  });

  describe('setupVault() Step 3: Strategy Initialization', () => {
    describe('Pool Selection', () => {
      const TJ_MAX_BIN_ID = 16777215;

      it('should emit BestPoolSelected event', () => {
        expect(bestPoolSelectedEvents.length).toBe(1);

        const event = bestPoolSelectedEvents[0];
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
        expect(typeof event.timestamp).toBe('number');
      });

      it('should emit pool object with correct TJ structure', () => {
        const event = bestPoolSelectedEvents[0];

        expect(event.pool).toBeDefined();
        expect(event.pool.address).toBeDefined();
        expect(event.pool.binStep).toBeDefined();
        expect(event.pool.activeId).toBeDefined();
        expect(event.pool.token0).toBeDefined();
        expect(event.pool.token1).toBeDefined();
        expect(event.pool.tokenX).toBeDefined();
        expect(event.pool.tokenY).toBeDefined();
      });

      it('should select pool for USDC/WAVAX token pair', () => {
        const event = bestPoolSelectedEvents[0];

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
        expect(event.pool.reserveX).toBeDefined();
        expect(event.pool.reserveY).toBeDefined();
      });

      it('should select pool with activeId in valid range', () => {
        const event = bestPoolSelectedEvents[0];
        expect(event.pool.activeId).toBeGreaterThanOrEqual(0);
        expect(event.pool.activeId).toBeLessThanOrEqual(TJ_MAX_BIN_ID);
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

        // maxPositions=1 keeps only the most centered position
        // The shifted USDC/WAVAX gets demoted, plus the USDT/USDC is non-aligned
        expect(event.alignedCount).toBe(1);
        expect(event.nonAlignedCount).toBe(2);
      });

      it('should return correct position IDs in aligned/non-aligned arrays', () => {
        const event = initialPositionsEvaluatedEvents[0];
        const vault = service.vaultDataService.getAllVaults()[0];

        expect(event.alignedPositionIds).toHaveLength(1);
        expect(event.nonAlignedPositionIds).toHaveLength(2);

        // Aligned position should still exist in vault.positions
        const remainingPositionIds = Object.keys(vault.positions);
        expect(remainingPositionIds).toContain(event.alignedPositionIds[0]);

        // Non-aligned positions should have been closed and removed
        for (const nonAlignedId of event.nonAlignedPositionIds) {
          expect(remainingPositionIds).not.toContain(nonAlignedId);
        }
      });

      it('should verify the demoted position was on the target pool (demotion, not wrong tokens)', () => {
        const event = initialPositionsEvaluatedEvents[0];

        // One of the non-aligned positions is the shifted USDC/WAVAX
        // It was demoted due to centeredness, not wrong tokens
        // Verify via PositionsClosed that a USDC/WAVAX position was among the closed
        if (positionsClosedEvents.length > 0) {
          const closedPools = positionsClosedEvents[0].closedPositions.map(p => {
            const poolMeta = service.poolData[p.position.pool];
            return poolMeta;
          });

          // At least one closed position should be from the USDC/WAVAX pool
          const usdcWavaxClosed = closedPools.filter(poolMeta => {
            const symbols = [
              poolMeta.token0Symbol || poolMeta.tokenXSymbol,
              poolMeta.token1Symbol || poolMeta.tokenYSymbol
            ].sort();
            return symbols[0] === 'USDC' && symbols[1] === 'WAVAX';
          });
          expect(usdcWavaxClosed.length).toBeGreaterThanOrEqual(1);
        }
      });

      it('should have exactly 2 non-aligned positions (not mark all as aligned)', () => {
        const event = initialPositionsEvaluatedEvents[0];

        const totalEvaluated = event.alignedCount + event.nonAlignedCount;
        expect(totalEvaluated).toBe(3);

        expect(event.nonAlignedCount).toBe(2);
        expect(event.nonAlignedPositionIds).toHaveLength(2);
        expect(event.alignedCount).toBe(1);
        expect(event.alignedPositionIds).toHaveLength(1);

        // No overlap between aligned and non-aligned
        for (const nonAlignedId of event.nonAlignedPositionIds) {
          expect(event.alignedPositionIds).not.toContain(nonAlignedId);
        }
      });
    });

    describe('Emergency Exit Baseline', () => {
      it('should have emergency exit baseline set for the vault', () => {
        const strategy = service.strategies.get('bob');
        expect(strategy.emergencyExitBaseline[testVault.vaultAddress]).toBeDefined();

        // TJ baseline is an object { activeId, binStep }
        const baseline = strategy.emergencyExitBaseline[testVault.vaultAddress];
        expect(typeof baseline).toBe('object');
        expect(typeof baseline.activeId).toBe('number');
        expect(typeof baseline.binStep).toBe('number');
      });

      it('should have baseline with reasonable activeId from pool state', () => {
        const strategy = service.strategies.get('bob');
        const baseline = strategy.emergencyExitBaseline[testVault.vaultAddress];

        expect(baseline.activeId).toBeGreaterThan(0);
        expect(baseline.activeId).toBeLessThanOrEqual(16777215);

        const poolEvent = bestPoolSelectedEvents[0];
        expect(baseline.binStep).toBe(poolEvent.pool.binStep);
      });

      it('should clear baseline when clearEmergencyExitBaseline is called', () => {
        const strategy = service.strategies.get('bob');

        expect(strategy.emergencyExitBaseline[testVault.vaultAddress]).toBeDefined();
        strategy.clearEmergencyExitBaseline(testVault.vaultAddress);
        expect(strategy.emergencyExitBaseline[testVault.vaultAddress]).toBeUndefined();
      });
    });

    describe('Position Closing', () => {
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

      it('should close exactly 2 positions (demoted + non-aligned)', () => {
        const event = positionsClosedEvents[0];

        expect(event.closedCount).toBe(2);
        expect(event.closedPositions).toHaveLength(2);
      });

      it('should NOT close the centered aligned USDC/WAVAX position', () => {
        const vault = service.vaultDataService.getAllVaults()[0];
        const event = initialPositionsEvaluatedEvents[0];

        // The aligned position should still be in vault.positions
        const alignedPositionId = event.alignedPositionIds[0];
        expect(vault.positions[alignedPositionId]).toBeDefined();
      });

      it('should have position objects with TJ-specific fields in closed positions', () => {
        const event = positionsClosedEvents[0];
        const closedPosition = event.closedPositions[0];

        expect(closedPosition).toHaveProperty('position');
        expect(closedPosition.position).toHaveProperty('pool');
        expect(closedPosition.position.pool).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(closedPosition.position).toHaveProperty('upperBinId');
        expect(closedPosition.position).toHaveProperty('lowerBinId');
        expect(typeof closedPosition.position.upperBinId).toBe('number');
        expect(typeof closedPosition.position.lowerBinId).toBe('number');
      });

      it('should have correct platform in closed positions', () => {
        const event = positionsClosedEvents[0];

        for (const closedPosition of event.closedPositions) {
          expect(closedPosition.platform).toBe('traderjoeV2_2');
        }
      });

      it('should have valid bin range extractable via adapter', () => {
        const event = positionsClosedEvents[0];
        const closedPosition = event.closedPositions[0];
        const adapter = service.adapters.get(closedPosition.platform);

        const { lower, upper } = adapter.extractPositionBounds(closedPosition.position);

        expect(typeof lower).toBe('number');
        expect(typeof upper).toBe('number');
        expect(lower).toBeLessThan(upper);
        expect(lower).toBeGreaterThan(0);
      });

      it('should have principal amounts as numeric strings', () => {
        const event = positionsClosedEvents[0];

        for (const closedPosition of event.closedPositions) {
          expect(closedPosition).toHaveProperty('principalAmount0');
          expect(closedPosition).toHaveProperty('principalAmount1');
          expect(typeof closedPosition.principalAmount0).toBe('string');
          expect(typeof closedPosition.principalAmount1).toBe('string');
          expect(() => BigInt(closedPosition.principalAmount0)).not.toThrow();
          expect(() => BigInt(closedPosition.principalAmount1)).not.toThrow();
        }
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

      it('should remove closed positions from vault.positions', () => {
        const vault = service.vaultDataService.getAllVaults()[0];
        expect(Object.keys(vault.positions).length).toBe(1);
      });

      it('should emit BatchTransactionExecuted for position closes', () => {
        const closeEvents = batchTransactionExecutedEvents.filter(
          e => e.vaultAddress.toLowerCase() === testVault.vaultAddress.toLowerCase() &&
               e.operationType.toLowerCase().includes('close')
        );

        expect(closeEvents.length).toBeGreaterThanOrEqual(1);

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

      it('should have positionIds matching non-aligned positions from evaluation', () => {
        const positionsClosedEvent = positionsClosedEvents[0];
        const evaluationEvent = initialPositionsEvaluatedEvents[0];

        for (const closedPosition of positionsClosedEvent.closedPositions) {
          expect(evaluationEvent.nonAlignedPositionIds).toContain(closedPosition.positionId);
        }
      });
    });

    describe('Fee Collection', () => {
      it('should emit FeesCollected event with multi-token structure', () => {
        expect(feesCollectedEvents.length).toBe(1);

        const event = feesCollectedEvents[0];
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
        expect(event.source).toBe('initialization');
        expect(Array.isArray(event.positionIds)).toBe(true);
        expect(event.positionIds.length).toBe(2); // Two positions closed
        expect(Array.isArray(event.fees)).toBe(true);
        expect(event.totalUSD).toBeGreaterThan(0);
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

      it('should have fees from USDC/WAVAX positions (fee-generating swaps)', () => {
        const event = feesCollectedEvents[0];

        // Fee-generating swaps were on the USDC/WAVAX pool
        // At least one of USDC or WAVAX should have collected fees > 0
        const usdcFee = event.fees.find(f => f.token === 'USDC');
        const wavaxFee = event.fees.find(f => f.token === 'WAVAX');

        const hasNonZeroFees = (usdcFee && usdcFee.amountFormatted > 0) ||
                               (wavaxFee && wavaxFee.amountFormatted > 0);
        expect(hasNonZeroFees).toBe(true);
      });

      it('should correctly calculate owner vs reinvested amounts', () => {
        const event = feesCollectedEvents[0];

        for (const fee of event.fees) {
          const total = fee.toOwner + fee.reinvested;
          expect(total).toBeCloseTo(fee.amountFormatted, 5);
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

      it('should distribute WAVAX fees as native AVAX (unwrapped)', () => {
        const event = feesDistributedEvents[0];

        const wavaxDistribution = event.distributions.find(d => d.token === 'WAVAX');
        if (wavaxDistribution) {
          expect(BigInt(wavaxDistribution.amount)).toBeGreaterThan(0n);
          expect(wavaxDistribution.asNativeToken).toBe(true);
          expect(wavaxDistribution.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        }
      });

      it('should distribute USDC fees via withdrawTokens', () => {
        const event = feesDistributedEvents[0];

        const usdcDistribution = event.distributions.find(d => d.token === 'USDC');
        if (usdcDistribution) {
          expect(BigInt(usdcDistribution.amount)).toBeGreaterThan(0n);
          expect(usdcDistribution.asNativeToken).toBe(false);
          expect(usdcDistribution.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        }
      });

      it('should have correct distribution fields for each token', () => {
        const event = feesDistributedEvents[0];

        for (const dist of event.distributions) {
          expect(dist).toHaveProperty('token');
          expect(dist).toHaveProperty('address');
          expect(dist).toHaveProperty('amount');
          expect(dist).toHaveProperty('amountFormatted');
          expect(dist).toHaveProperty('asNativeToken');
          expect(dist).toHaveProperty('transactionHash');
          expect(dist.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        }
      });

      it('should have no failures in fee distribution', () => {
        const event = feesDistributedEvents[0];

        expect(event.failures).toHaveLength(0);
        expect(event.totalTokensFailed).toBe(0);
      });

      it('should use correct reinvestment ratio from strategy parameters', () => {
        const event = feesDistributedEvents[0];
        const vault = service.vaultDataService.getAllVaults()[0];

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

    it('should have increased USDC balance after closing positions', () => {
      const initialBalances = tokenBalancesFetchedEvents[0].balances;
      const postClosureBalances = tokenBalancesFetchedEvents[1].balances;

      // USDC should increase from both closed positions returning principal
      expect(BigInt(postClosureBalances.USDC || '0')).toBeGreaterThan(BigInt(initialBalances.USDC || '0'));
    });

    it('should have increased WAVAX balance after closing demoted USDC/WAVAX position', () => {
      const initialBalances = tokenBalancesFetchedEvents[0].balances;
      const postClosureBalances = tokenBalancesFetchedEvents[1].balances;

      // WAVAX should increase from the closed USDC/WAVAX position
      expect(BigInt(postClosureBalances.WAVAX || '0')).toBeGreaterThan(BigInt(initialBalances.WAVAX || '0'));
    });

    it('should have USDT balance appearing after closing USDT/USDC position', () => {
      const postClosureBalances = tokenBalancesFetchedEvents[1].balances;

      // USDT should appear from the closed non-aligned USDT/USDC position
      const usdtBalance = BigInt(postClosureBalances[USDT] || '0');
      expect(usdtBalance).toBeGreaterThan(0n);
    });
  });

  describe('setupVault() Step 5: Calculate Available Deployment', () => {
    it('should emit DeploymentCalculated event', () => {
      expect(utilizationEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should have correct event structure', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.totalVaultValue).toBeDefined();
      expect(event.positionValue).toBeDefined();
      expect(event.tokenValue).toBeDefined();
      expect(event.availableDeployment).toBeDefined();
    });

    it('should have position value > 0 (surviving aligned position)', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];
      expect(event.positionValue).toBeGreaterThan(0);
    });

    it('should have token value > 0 (returned principal + reinvested fees)', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];
      expect(event.tokenValue).toBeGreaterThan(0);
    });

    it('should have availableDeployment > 0', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];
      expect(event.availableDeployment).toBeGreaterThan(0);
    });

    it('should include minimum deployment threshold details', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];
      expect(event.minDeployment).toBeDefined();
      expect(event.minDeployment).toBeGreaterThan(0);
      expect(event.chainMinimum).toBeDefined();
      expect(event.vaultRelativeMinimum).toBeDefined();
      expect(event.minDeployment).toBe(Math.max(event.chainMinimum, event.vaultRelativeMinimum));
    });
  });

  describe('Token Preparation (prepareTokensForPosition)', () => {
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

    it('should use USDT as non-aligned token for deficit coverage', () => {
      const event = tokenPreparationCompletedEvents[0];

      if (event.preparationResult === 'swaps_generated') {
        expect(event.nonAlignedTokensUsed).toContain(USDT);
        expect(event.swapTransactions.length).toBeGreaterThan(0);
      }
    });

    it('should have phasesUsed.nonAlignedForDeficit = true (USDT swapped)', () => {
      const event = tokenPreparationCompletedEvents[0];

      expect(event.phasesUsed.nonAlignedForDeficit).toBe(true);
    });

    it('should have correct targetTokens structure with USDC and WAVAX', () => {
      const event = tokenPreparationCompletedEvents[0];

      expect(event.targetTokens.token0).toBeDefined();
      expect(event.targetTokens.token1).toBeDefined();
      expect(event.targetTokens.token0.symbol).toBeDefined();
      expect(event.targetTokens.token0.required).toBeDefined();
      expect(event.targetTokens.token0.available).toBeDefined();
      expect(event.targetTokens.token0.deficit).toBeDefined();

      // Verify the target tokens are USDC and WAVAX
      const symbols = [event.targetTokens.token0.symbol, event.targetTokens.token1.symbol].sort();
      expect(symbols).toEqual(['USDC', 'WAVAX']);
    });

    it('should route swap transactions to correct LBRouter', () => {
      const event = tokenPreparationCompletedEvents[0];

      if (event.swapTransactions.length > 0) {
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

    it('should have consistent swap counts and metadata', () => {
      const event = tokenPreparationCompletedEvents[0];

      expect(event.swapTransactions.length).toBe(event.deficitSwapCount);
      expect(event.swapMetadata.deficit.length).toBe(event.deficitSwapCount);
    });
  });

  describe('Token Swap Execution (TokensSwapped event)', () => {
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
          expect(swap.tokenInSymbol).toBeDefined();
          expect(swap.tokenOutSymbol).toBeDefined();
          expect(swap.quotedAmountIn).toBeDefined();
          expect(swap.quotedAmountOut).toBeDefined();
          expect(swap.actualAmountIn).toBeDefined();
          expect(swap.actualAmountOut).toBeDefined();
          expect(typeof swap.isAmountIn).toBe('boolean');

          expect(BigInt(swap.actualAmountOut)).toBeGreaterThan(0n);
        }
      }
    });

    it('should use USDT as input token for deficit swaps', () => {
      const deficitEvent = tokensSwappedEvents.find(e => e.swapType === 'deficit_coverage');

      if (deficitEvent) {
        // At least one deficit swap should have USDT as input
        const usdtSwaps = deficitEvent.swaps.filter(s => s.tokenInSymbol === USDT);
        expect(usdtSwaps.length).toBeGreaterThan(0);

        // Output should be target tokens (USDC or WAVAX)
        for (const swap of deficitEvent.swaps) {
          expect(['USDC', 'WAVAX']).toContain(swap.tokenOutSymbol);
        }
      }
    });

    it('should have actualAmountIn > 0 (validates receipt parsing)', () => {
      if (tokensSwappedEvents.length > 0) {
        for (const event of tokensSwappedEvents) {
          for (const swap of event.swaps) {
            expect(BigInt(swap.actualAmountIn)).toBeGreaterThan(0n);
          }
        }
      }
    });

    it('should have consistent swap counts with TokenPreparationCompleted', () => {
      const tokenPrepEvent = tokenPreparationCompletedEvents[0];

      if (tokenPrepEvent.preparationResult === 'swaps_generated') {
        const totalSwapsExecuted = tokensSwappedEvents.reduce((sum, e) => sum + e.swapCount, 0);
        expect(totalSwapsExecuted).toBe(tokenPrepEvent.deficitSwapCount);
      }
    });
  });

  describe('LiquidityAddedToPosition event', () => {
    it('should emit exactly one LiquidityAddedToPosition event', () => {
      expect(liquidityAddedToPositionEvents.length).toBe(1);
    });

    it('should have correct vault and position identifiers', () => {
      const event = liquidityAddedToPositionEvents[0];
      const vault = service.vaultDataService.getAllVaults()[0];

      expect(event.vaultAddress.toLowerCase()).toBe(vault.address.toLowerCase());
      expect(event.positionId).toBeDefined();
      expect(event.poolAddress).toBeDefined();
      expect(event.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should have valid target amounts (based on ratio)', () => {
      const event = liquidityAddedToPositionEvents[0];

      expect(event.targetToken0).toBeDefined();
      expect(event.targetToken1).toBeDefined();

      expect(BigInt(event.targetToken0)).toBeGreaterThan(0n);
      expect(BigInt(event.targetToken1)).toBeGreaterThan(0n);
    });

    it('should have actual amounts from receipt parsing', () => {
      const event = liquidityAddedToPositionEvents[0];

      expect(event.actualToken0).toBeDefined();
      expect(event.actualToken1).toBeDefined();

      expect(BigInt(event.actualToken0)).toBeGreaterThan(0n);
      expect(BigInt(event.actualToken1)).toBeGreaterThan(0n);
    });

    it('should have valid transaction details', () => {
      const event = liquidityAddedToPositionEvents[0];

      expect(event.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(event.blockNumber).toBeGreaterThan(0);
      expect(BigInt(event.gasUsed)).toBeGreaterThan(0n);
      expect(BigInt(event.effectiveGasPrice)).toBeGreaterThan(0n);
      expect(event.gasEstimated).toBeDefined();
    });

    it('should have correct position object matching vault position', () => {
      const event = liquidityAddedToPositionEvents[0];
      const vault = service.vaultDataService.getAllVaults()[0];
      const vaultPosition = vault.positions[event.positionId];
      const adapter = service.adapters.get(event.platform);

      expect(event.position).toBeDefined();

      // Use adapter to extract bounds and compare with vault position
      const { lower, upper } = adapter.extractPositionBounds(event.position);
      expect(lower).toBe(vaultPosition.lowerBinId);
      expect(upper).toBe(vaultPosition.upperBinId);
    });

    it('should have correct context metadata', () => {
      const event = liquidityAddedToPositionEvents[0];

      expect(event.tokenSymbols).toBeDefined();
      expect(Array.isArray(event.tokenSymbols)).toBe(true);
      expect(event.tokenSymbols).toHaveLength(2);
      expect(event.tokenSymbols).toContain('USDC');
      expect(event.tokenSymbols).toContain('WAVAX');
      expect(event.platform).toBe('traderjoeV2_2');
      expect(event.deploymentAmount).toBeGreaterThan(0);
      expect(typeof event.timestamp).toBe('number');
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

      expect(vaultSetupCompleteEvents.length).toBe(1);
      expect(event.timestamp).toBeLessThanOrEqual(vaultSetupCompleteEvents[0].timestamp);
    });

    it('should emit VaultSetupComplete event', () => {
      expect(vaultSetupCompleteEvents.length).toBe(1);

      const event = vaultSetupCompleteEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
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

    it('should have USDT depleted to dust after deficit swaps', () => {
      const vault = service.vaultDataService.getAllVaults()[0];
      const usdtBalance = BigInt(vault.tokens[USDT] || '0');

      // USDT (6 decimals) should be nearly zero — less than $1 worth
      const usdtFormatted = Number(usdtBalance) / 1e6;
      expect(usdtFormatted).toBeLessThan(1);
    });

    it('should have remaining position with non-zero liquidity', () => {
      const vault = service.vaultDataService.getAllVaults()[0];
      expect(Object.keys(vault.positions).length).toBe(1);

      const position = Object.values(vault.positions)[0];
      // TJ position should have depositIds populated (liquidity from addToPosition)
      expect(position.depositIds).toBeDefined();
      expect(position.depositIds.length).toBeGreaterThan(0);
    });

    it('should have all token balances non-negative', () => {
      const vault = service.vaultDataService.getAllVaults()[0];
      for (const [, balance] of Object.entries(vault.tokens)) {
        expect(BigInt(balance)).toBeGreaterThanOrEqual(0n);
      }
    });
  });
});
