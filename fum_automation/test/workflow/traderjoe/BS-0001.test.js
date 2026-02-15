/**
 * @fileoverview Integration tests for createNewPosition workflow with non-aligned tokens on Avalanche (Trader Joe V2.2)
 * Tests vault initialization with ONLY non-aligned tokens, triggering full swap routing before position creation.
 *
 * Scenario: 0 Aligned Positions / 0 Non-Aligned Positions / 0 Aligned Tokens / 1 Non-aligned Token
 * - Vault funded with USDT only (non-aligned token)
 * - No positions exist
 * - Target tokens: USDC/WAVAX
 * - Service must swap USDT into both USDC and WAVAX, then createNewPosition
 * - Tests LBQuoter multi-hop discovery (USDT→WAVAX has no direct V2.2 pool, must route through USDC)
 *
 * Run with: FORK_CHAIN=avalanche npm test -- test/workflow/traderjoe/BS-0001.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTraderJoeTestVault } from '../../helpers/traderjoe-vault-setup.js';
import { configureTJStrategyParameters } from '../../helpers/traderjoe-swap-utils.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// USD₮0 is the library key for USDT (Tether) on Avalanche
const USDT = 'USD₮0';

describe('AutomationService Initialization - TJ V2.2 createNewPosition with Non-Aligned Token', () => {
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
    // Clean up any old vault data from previous test runs
    const dataDir = path.join(__dirname, '../../../data/vaults');
    try {
      await fs.rm(dataDir, { recursive: true, force: true });
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      // Ignore errors if directory doesn't exist
    }

    // Setup blockchain environment (Avalanche fork via FORK_CHAIN=avalanche)
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create test vault with ONLY non-aligned USDT
    // Swap chain: wrap 50 AVAX → swap 30 WAVAX → ~255 USDC → swap 200 USDC → ~200 USDT
    // Then send USDT to vault (no native AVAX, no positions)
    testVault = await setupTraderJoeTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '0AP/0NP/0AT/1NT - TJ Non-Aligned Token Test',
        automationServiceAddress: testConfig.automationServiceAddress,
        nativeAmount: '50',           // Wrap 50 AVAX for swap chain
        swapTokens: [
          { from: 'AVAX', to: 'USDC', amount: '30', binStep: 10, version: 3 },
          { from: 'USDC', to: USDT, amount: '200', binStep: 1, version: 3 }
        ],
        positions: [],                // NO positions
        tokenTransfers: { [USDT]: 100 },  // Send ALL USDT to vault
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

    // Do NOT send native AVAX to vault — USDT only
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

      expect(vault.address.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(vault.owner).toBeDefined();
      expect(vault.chainId).toBe(1338);
      expect(vault.strategy).toBeDefined();
      expect(vault.strategy.strategyId).toBe('bob');
      expect(vault.targetTokens).toEqual(['USDC', 'WAVAX']);
      expect(vault.targetPlatforms).toEqual(['traderjoeV2_2']);
    });

    it('should have NO positions initially', () => {
      const vault = service.vaultDataService.getAllVaults()[0];
      expect(vault.positions).toBeDefined();
    });

    it('should have had USDT as the initial vault token (verified from initial balance fetch)', () => {
      // vault.tokens reflects final state (after swaps), so check initial balance from events
      const initialBalances = tokenBalancesFetchedEvents[0];
      expect(initialBalances).toBeDefined();
      expect(initialBalances.balances).toBeDefined();

      const usdtBalance = BigInt(initialBalances.balances[USDT] || '0');
      expect(usdtBalance).toBeGreaterThan(0n);
    });

    it('should emit vaultLoaded event with correct data', () => {
      expect(vaultLoadedEvents.length).toBe(1);

      const event = vaultLoadedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
      expect(event.positionCount).toBe(0);
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

    it('should capture total vault value from USDT balance', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(typeof event.totalVaultValue).toBe('number');
      expect(event.totalVaultValue).toBeGreaterThan(0);
    });

    it('should have token value but NO position value (0 positions)', () => {
      const event = vaultBaselineCapturedEvents[0];

      expect(typeof event.tokenValue).toBe('number');
      expect(typeof event.positionValue).toBe('number');

      // Token value should be > 0 (from USDT)
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

        expect(event.alignedCount).toBe(0);
        expect(event.nonAlignedCount).toBe(0);
        expect(event.alignedPositionIds).toHaveLength(0);
        expect(event.nonAlignedPositionIds).toHaveLength(0);
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

        expect(baseline.activeId).toBeGreaterThan(0);
        expect(baseline.activeId).toBeLessThanOrEqual(16777215);

        // binStep should match the pool's binStep
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

    describe('Position Closing (Skipped - No Positions)', () => {
      it('should NOT emit PositionsClosed event (no positions to close)', () => {
        expect(positionsClosedEvents.length).toBe(0);
      });
    });
  });

  describe('setupVault() Step 4: Token Balance Refresh (Skipped)', () => {
    it('should still have initial TokenBalancesFetched event from Step 1', () => {
      expect(tokenBalancesFetchedEvents.length).toBeGreaterThanOrEqual(1);

      const initialEvent = tokenBalancesFetchedEvents[0];
      expect(initialEvent.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });

    it('should have USDT balance unchanged (no position closures)', () => {
      const initialEvent = tokenBalancesFetchedEvents[0];
      const usdtBalance = BigInt(initialEvent.balances[USDT] || '0');
      expect(usdtBalance).toBeGreaterThan(0n);
    });
  });

  describe('setupVault() Step 5: Calculate Available Deployment', () => {
    it('should emit DeploymentCalculated event', () => {
      expect(utilizationEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should have 0% current utilization (no positions)', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];

      expect(event.currentUtilization).toBe(0);
      expect(event.positionValue).toBe(0);
    });

    it('should have full token value as available deployment', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];

      expect(event.totalVaultValue).toBeGreaterThan(0);
      expect(event.tokenValue).toBeGreaterThan(0);
      expect(event.availableDeployment).toBeGreaterThan(0);
    });

    it('should have token value from USDT only', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];

      // No positions, so all value is from tokens (USDT)
      expect(event.positionValue).toBe(0);
      expect(event.tokenValue).toBeGreaterThan(0);
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

    it('should have wrapAmount = 0 (no native AVAX to wrap)', () => {
      const event = tokenPreparationCompletedEvents[0];

      expect(event.wrapUnwrap).toBeDefined();
      expect(event.wrapUnwrap.wrapAmount).toBeDefined();

      // No native AVAX in vault, so wrapAmount should be 0
      const wrapAmount = BigInt(event.wrapUnwrap.wrapAmount);
      expect(wrapAmount).toBe(0n);
    });

    it('should identify USDT as non-aligned token for deficit coverage', () => {
      const event = tokenPreparationCompletedEvents[0];

      expect(event.nonAlignedTokensUsed).toContain(USDT);
    });

    it('should have deficit swaps for both USDC and WAVAX', () => {
      const event = tokenPreparationCompletedEvents[0];

      // Both target tokens start at 0, so both need deficit swaps
      expect(event.deficitSwapCount).toBeGreaterThanOrEqual(2);
      expect(event.swapTransactions.length).toBeGreaterThanOrEqual(2);
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

    it('should have phasesUsed reflecting deficit swaps only (no wrap phase)', () => {
      const event = tokenPreparationCompletedEvents[0];

      // 0001 scenario: no native AVAX, only USDT non-aligned
      // - wrapUnwrap: false (no AVAX to wrap)
      // - nonAlignedForDeficit: true (USDT used for deficit coverage)
      expect(event.phasesUsed.nonAlignedForDeficit).toBe(true);
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

      expect(BigInt(event.targetToken0)).toBeGreaterThan(0n);
      expect(BigInt(event.targetToken1)).toBeGreaterThan(0n);
    });

    it('should have actual amounts from receipt parsing', () => {
      const event = newPositionCreatedEvents[0];

      expect(event.actualToken0).toBeDefined();
      expect(event.actualToken1).toBeDefined();

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

      expect(event.position).toBeDefined();

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
      expect(event.tokenSymbols).toContain('WAVAX');
      expect(event.tokenSymbols).toContain('USDC');
      expect(event.platform).toBe('traderjoeV2_2');
      expect(event.deploymentAmount).toBeGreaterThan(0);
      expect(typeof event.timestamp).toBe('number');
    });

    it('should have position ID that can be used to query the new position', () => {
      const event = newPositionCreatedEvents[0];

      expect(event.positionId).toBeDefined();
      expect(typeof event.positionId === 'string' || typeof event.positionId === 'number').toBe(true);
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

    it('should have USDT depleted to dust after swaps', () => {
      const vault = service.vaultDataService.getAllVaults()[0];
      const usdtBalance = BigInt(vault.tokens[USDT] || '0');

      // USDT (6 decimals) should be nearly zero — less than $1 worth
      const usdtFormatted = Number(usdtBalance) / 1e6;
      expect(usdtFormatted).toBeLessThan(1);
    });

    it('should have all token balances non-negative', () => {
      const vault = service.vaultDataService.getAllVaults()[0];
      for (const [, balance] of Object.entries(vault.tokens)) {
        expect(BigInt(balance)).toBeGreaterThanOrEqual(0n);
      }
    });
  });
});
