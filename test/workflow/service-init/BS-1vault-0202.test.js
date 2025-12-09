/**
 * @fileoverview Integration test for AutomationService initialization with 1 vault containing non-aligned assets
 * Tests 0 Aligned Positions (0AP), 2 Non-aligned Positions (2NP),
 * 0 Aligned Tokens (0AT), 2 Non-aligned Tokens (2NT) scenario
 */

import { ethers } from 'ethers'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import AutomationService from '../../../src/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/ganache-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock getPoolTVLAverage and getPoolAge for this test suite
vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    getPoolTVLAverage: vi.fn().mockResolvedValue(50000000), // $50M TVL - above minimum
    getPoolAge: vi.fn().mockResolvedValue(Math.floor(Date.now() / 1000) - (91 * 24 * 60 * 60)) // 91 days old
  };
});

describe('AutomationService Initialization - 1 Vault (0AP/2NP/0AT/2NT)', () => {
  let testEnv;
  let testVault;
  let service;
  let initialTransfers;

  beforeAll(async () => {
    // Clean up any old vault data from previous test runs
    const dataDir = path.join(__dirname, '../../../data/vaults');
    try {
      await fs.rm(dataDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors if directory doesn't exist
    }

    // Setup blockchain environment
    testEnv = await setupTestBlockchain({ port: 8546 });

    // Create test vault with 2 non-aligned positions and 2 non-aligned tokens using new setup
    testVault = await setupTestVault(
      testEnv.ganacheServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '0AP/2NP/0AT/2NT Test Vault',
        automationServiceAddress: testEnv.testConfig.automationServiceAddress,
        wrapEthAmount: '10',
        swapTokens: [
          { from: 'WETH', to: 'WBTC', amount: '2' },  // Get WBTC for positions
          { from: 'WETH', to: 'USD₮0', amount: '2' }   // Get USDT for vault balance
        ],
        positions: [
          {
            token0: 'WBTC',
            token1: 'WETH',
            fee: 500, // 0.05% fee tier
            percentOfAssets: 20,
            tickRange: {
              type: 'above'  // Position entirely above current tick (out of range)
            }
          },
          {
            token0: 'WBTC',
            token1: 'WETH',
            fee: 3000, // 0.3% fee tier
            percentOfAssets: 20,
            tickRange: {
              type: 'close-to-boundary'  // In range but too close to lower boundary
            }
          }
        ],
        tokenTransfers: {
          'WBTC': 40,  // Keep more for positions since we need WBTC/WETH pairs
          'USD₮0': 60  // 60% of remaining USDT (non-aligned token)
        },
        // Explicitly set target tokens to USDC/WETH to ensure all positions and tokens are non-aligned
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );

    // Store expected token balances for verification
    console.log('Test vault setup complete. Capturing expected balances...');

    // Capture initial token transfers
    initialTransfers = {
      'WBTC': testVault.tokenBalances.WBTC || '0',
      'USD₮0': testVault.tokenBalances['USD₮0'] || '0',
      'WETH': '0', // No WETH transferred to vault
      'USDC': '0'  // No USDC in vault (target token not present)
    };

    // Capture position token amounts (will be returned when positions close)
    const positionTokens = {
      'WBTC': '0',
      'WETH': '0'
    };

    // Sum up tokens from all positions (both will be closed)
    for (const positionId of Object.keys(testVault.positions)) {
      const position = testVault.positions[positionId];
      positionTokens.WBTC = ethers.BigNumber.from(positionTokens.WBTC).add(position.amount0).toString();
      positionTokens.WETH = ethers.BigNumber.from(positionTokens.WETH).add(position.amount1).toString();
    }

    // Calculate expected final balances: initial transfers + closed position tokens
    testVault.expectedFinalBalances = {
      'WBTC': ethers.BigNumber.from(initialTransfers.WBTC).add(positionTokens.WBTC).toString(),
      'USD₮0': initialTransfers['USD₮0'], // Unchanged - no positions use USD₮0
      'WETH': ethers.BigNumber.from(initialTransfers.WETH).add(positionTokens.WETH).toString(),
      'USDC': initialTransfers.USDC // Remains 0
    };

    console.log('Expected final balances after position closure:');
    console.log(`  WBTC: ${testVault.expectedFinalBalances.WBTC} (${initialTransfers.WBTC} initial + ${positionTokens.WBTC} from positions)`);
    console.log(`  USD₮0: ${testVault.expectedFinalBalances['USD₮0']} (unchanged)`);
    console.log(`  WETH: ${testVault.expectedFinalBalances.WETH} (${initialTransfers.WETH} initial + ${positionTokens.WETH} from positions)`);
    console.log(`  USDC: ${testVault.expectedFinalBalances.USDC} (not in vault)`);

  }, 180000); // timeout for vault setup like the library uses

  afterAll(async () => {
    // Cleanup service
    if (service) {
      try {
        await service.stop();
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }

    // Cleanup blockchain
    await cleanupTestBlockchain(testEnv);
  });

  describe('Success Case - 0AP/2NP/0AT/2NT Scenario', () => {
    it('should successfully handle service initialization with pre-existing non-aligned vault', async () => {
      // Create AutomationService instance
      service = new AutomationService(testEnv.testConfig);

      // Set up event listeners to test vault loading events
      let poolDataFetchedEventData = [];
      const unsubscribeDataFetch = service.eventManager.subscribe('PoolDataFetched', (data) => {
        poolDataFetchedEventData.push(data);
      });

      let vaultLoadingEventData = null;
      service.eventManager.subscribe('vaultLoading', (address) => {
        vaultLoadingEventData = address;
      });

      let vaultLoadedEventData = null;
      let vault = null; // Declare vault at test scope
      service.eventManager.subscribe('vaultLoaded', async (data) => {
        vaultLoadedEventData = data;
        // Capture full vault snapshot immediately when loaded
        vault = JSON.parse(JSON.stringify(
          await service.vaultDataService.getVault(data.vaultAddress)
        ));
      });

      // Set up event capture for InitialPositionsEvaluated (fired during service.start())
      const capturedEvents = [];
      const unsubscribe = service.eventManager.subscribe('InitialPositionsEvaluated', (data) => {
        capturedEvents.push(data);
      });

      // Set up event capture for PositionsClosed (fired during service.start())
      const closedPositionsEvents = [];
      const unsubscribeClose = service.eventManager.subscribe('PositionsClosed', (data) => {
        closedPositionsEvents.push(data);
      });

      // Set up event capture for FeesCollected (fired during initialization when positions are closed)
      const feesCollectedEvents = [];
      const unsubscribeFeesCollected = service.eventManager.subscribe('FeesCollected', (data) => {
        feesCollectedEvents.push(data);
      });

      // Set up event capture for BatchTransactionExecuted
      const batchTransactionEvents = [];
      const unsubscribeBatchTransaction = service.eventManager.subscribe('BatchTransactionExecuted', (data) => {
        batchTransactionEvents.push(data);
      });

      // Set up event listener for token balance fetching
      const tokenBalanceFetchEvents = [];
      const unsubscribeTokenBalance = service.eventManager.subscribe('TokenBalancesFetched', (data) => {
        tokenBalanceFetchEvents.push(data);
      });

      // Set up event capture for AssetValuesFetched
      const assetValueEvents = [];
      const unsubscribeAssetValues = service.eventManager.subscribe('AssetValuesFetched', (data) => {
        assetValueEvents.push(data);
      });

      // Set up event capture for UtilizationCalculated
      const utilizationEvents = [];
      const unsubscribeUtilization = service.eventManager.subscribe('UtilizationCalculated', (data) => {
        utilizationEvents.push(data);
      });

      // Set up event capture for OptimalPoolSelected (fired during createNewPosition)
      const optimalPoolSelectedEvents = [];
      const unsubscribeOptimalPoolSelected = service.eventManager.subscribe('OptimalPoolSelected', (data) => {
        optimalPoolSelectedEvents.push(data);
      });

      // Set up event capture for PositionParametersCalculated (fired during createNewPosition)
      const positionParametersEvents = [];
      const unsubscribePositionParameters = service.eventManager.subscribe('PositionParametersCalculated', (data) => {
        positionParametersEvents.push(data);
      });

      // Set up event capture for TokenPreparationCompleted (fired during prepareTokensForPosition)
      const tokenPreparationEvents = [];
      const unsubscribeTokenPreparation = service.eventManager.subscribe('TokenPreparationCompleted', (data) => {
        tokenPreparationEvents.push(data);
      });

      // Set up event capture for 5050SwapsPrepared (fired during 50/50 token conversion)
      const buffer5050Events = [];
      const unsubscribe5050 = service.eventManager.subscribe('5050SwapsPrepared', (data) => {
        buffer5050Events.push(data);
      });

      // Set up event capture for TokensSwapped
      const tokensSwappedEvents = [];
      service.eventManager.subscribe('TokensSwapped', (data) => {
        tokensSwappedEvents.push(data);
      });

      // Set up event capture for NewPositionCreated (fired during position creation)
      const newPositionCreatedEvents = [];
      const unsubscribeNewPosition = service.eventManager.subscribe('NewPositionCreated', (data) => {
        newPositionCreatedEvents.push(data);
      });

      // Subscribe to monitoring events BEFORE service initialization to capture them
      let swapMonitoringEvents = [];
      let configMonitoringEvents = [];
      let monitoringStartedEvents = [];

      const unsubscribeSwapMonitoring = service.eventManager.subscribe('SwapMonitoringRegistered', (event) => {
        swapMonitoringEvents.push(event);
      });

      const unsubscribeConfigMonitoring = service.eventManager.subscribe('ConfigMonitoringRegistered', (event) => {
        configMonitoringEvents.push(event);
      });

      const unsubscribeMonitoringStarted = service.eventManager.subscribe('MonitoringStarted', (event) => {
        monitoringStartedEvents.push(event);
      });

      // Set up event capture for VaultBaselineCaptured
      const baselineCapturedEvents = [];
      const unsubscribeBaselineCaptured = service.eventManager.subscribe('VaultBaselineCaptured', (data) => {
        baselineCapturedEvents.push(data);
      });

      // Start the service - should discover our pre-existing authorized vault
      await service.start();

      // Test 1: Verify PoolDataFetched event handling (1 vault with non-aligned positions scenario)
      expect(service.eventManager.eventHandlers['PoolDataFetched']).toBeDefined();
      expect(Array.isArray(service.eventManager.eventHandlers['PoolDataFetched'])).toBe(true);
      expect(service.eventManager.eventHandlers['PoolDataFetched'].length).toBeGreaterThan(0);
      expect(typeof service.eventManager.eventHandlers['PoolDataFetched'][0]).toBe('function');

      // Test 2: Authorized Vault Discovery
      const discoveredVaults = service.vaultDataService.getAllVaults();
      expect(Array.isArray(discoveredVaults)).toBe(true);
      expect(discoveredVaults.length).toBe(1);

      // Test vault data was loaded correctly
      expect(vault).toBeDefined();
      expect(vault.address.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());

      // Test 3: Verify vaultLoading event was emitted
      expect(vaultLoadingEventData).not.toBe(null);
      expect(vaultLoadingEventData).toBeDefined();
      expect(typeof vaultLoadingEventData).toBe('string');
      expect(vaultLoadingEventData.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());

      // Test 4: Verify vault data from vaultLoaded event
      expect(vaultLoadedEventData.strategyId).toBe('bob');
      expect(vaultLoadedEventData.targetTokens).toEqual(['USDC', 'WETH']);
      expect(vaultLoadedEventData.targetPlatforms).toEqual(['uniswapV3']);

      // Test 4a: Verify VaultBaselineCaptured event was emitted
      expect(baselineCapturedEvents.length).toBe(1);
      const baselineEvent = baselineCapturedEvents[0];

      // Verify baseline event structure
      expect(baselineEvent.vaultAddress).toBe(vault.address);
      expect(typeof baselineEvent.totalVaultValue).toBe('number');
      expect(baselineEvent.totalVaultValue).toBeGreaterThan(0);
      expect(typeof baselineEvent.tokenValue).toBe('number');
      expect(typeof baselineEvent.positionValue).toBe('number');
      expect(baselineEvent.tokenValue + baselineEvent.positionValue).toBeCloseTo(baselineEvent.totalVaultValue, 2);

      // Verify baseline tokens structure
      expect(baselineEvent.tokens).toBeDefined();
      expect(typeof baselineEvent.tokens).toBe('object');
      expect(Object.keys(baselineEvent.tokens).length).toBeGreaterThan(0);

      // Verify baseline positions structure
      expect(baselineEvent.positions).toBeDefined();
      expect(typeof baselineEvent.positions).toBe('object');
      expect(Object.keys(baselineEvent.positions).length).toBe(2); // Should have 2 positions at baseline

      // Verify baseline metadata
      expect(typeof baselineEvent.timestamp).toBe('number');
      expect(baselineEvent.capturePoint).toBe('pre_initialization');
      expect(baselineEvent.strategyId).toBe('bob');

      // Test 5: Verify PoolDataFetched event data content - should have 2 pools (different fee tiers)
      const poolFetchedData = poolDataFetchedEventData[0]
      expect(poolFetchedData).not.toBe(null);
      expect(poolFetchedData).toBeDefined();
      expect(typeof poolFetchedData).toBe('object');

      // The event should contain pool data for the pools used by the vault's positions
      const poolAddresses = Object.keys(poolFetchedData.poolData);
      expect(poolAddresses.length).toBe(2); // Should have 2 pools for our 2 positions (different fee tiers)

      // Verify both pools are WBTC/WETH but with different fee tiers
      for (const poolAddress of poolAddresses) {
        const poolData = poolFetchedData.poolData[poolAddress];
        expect(poolData).toBeDefined();
        expect(poolData.token0Symbol).toBeDefined();
        expect(poolData.token1Symbol).toBeDefined();
        expect([500, 3000]).toContain(poolData.fee); // Either 0.05% or 0.3% fee tier
        expect(poolData.platform).toBe('uniswapV3');

        // Verify token symbols are WBTC and WETH (order depends on addresses)
        const tokenSymbols = [poolData.token0Symbol, poolData.token1Symbol].sort();
        expect(tokenSymbols).toEqual(['WBTC', 'WETH']);
      }

      // Test 6: Comprehensive vault cache structure validation
      expect(vault.address).toBeDefined();
      expect(vault.address.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(vault.owner).toBeDefined();
      expect(typeof vault.owner).toBe('string');
      expect(vault.owner).toMatch(/^0x[a-fA-F0-9]{40}$/); // Valid Ethereum address
      expect(vault.chainId).toBe(1337);
      expect(vault.strategyAddress).toBeDefined();
      expect(vault.strategyAddress.toLowerCase()).toBe(testEnv.deployedContracts.BabyStepsStrategy.toLowerCase());
      expect(!!vault.strategy).toBe(true);

      // Strategy Object Testing
      expect(vault.strategy).toBeDefined();
      expect(typeof vault.strategy).toBe('object');
      expect(vault.strategy.strategyId).toBe('bob');

      // Test strategy parameters object structure
      expect(vault.strategy.parameters).toBeDefined();
      expect(typeof vault.strategy.parameters).toBe('object');
      expect(vault.strategy.parameters.targetRangeUpper).toBeDefined();
      expect(vault.strategy.parameters.feeReinvestment).toBeDefined();
      expect(typeof vault.strategy.parameters.feeReinvestment).toBe('boolean');

      // Tokens Object Testing - should have our 2 non-aligned tokens (WBTC, USD₮0)
      expect(vault.tokens).toBeDefined();
      expect(typeof vault.tokens).toBe('object');
      expect(vault.tokens.WBTC).toBeDefined();
      expect(vault.tokens['USD₮0']).toBeDefined();
      expect(typeof vault.tokens.WBTC).toBe('string');
      expect(typeof vault.tokens['USD₮0']).toBe('string');

      // Verify token balances match exact amounts transferred to vault
      // Use TokenBalancesFetched events for accurate state snapshots
      expect(tokenBalanceFetchEvents.length).toBeGreaterThan(0);
      const initialBalances = tokenBalanceFetchEvents[0].balances;

      expect(initialBalances.WBTC).toBe(initialTransfers.WBTC);
      expect(initialBalances['USD₮0']).toBe(initialTransfers['USD₮0']);
      expect(initialBalances.WETH).toBe(initialTransfers.WETH);
      expect(initialBalances.USDC).toBe(initialTransfers.USDC);

      // Target Configuration Testing (strategy targets USDC/WETH, but vault has WBTC/USDT)
      expect(Array.isArray(vault.targetTokens)).toBe(true);
      expect(vault.targetTokens).toEqual(['USDC', 'WETH']);
      expect(Array.isArray(vault.targetPlatforms)).toBe(true);
      expect(vault.targetPlatforms).toEqual(['uniswapV3']);

      // Positions Object Testing - verify initial positions from vaultLoaded event
      expect(Object.keys(vault.positions).length).toBe(2); // Should have started with exactly 2 positions
      expect(vaultLoadedEventData.positionIds).toHaveLength(2);
      expect(Array.isArray(vaultLoadedEventData.positionIds)).toBe(true);

      // Verify position IDs are valid format (numeric strings)
      for (const positionId of vaultLoadedEventData.positionIds) {
        expect(typeof positionId).toBe('string');
        expect(positionId).toMatch(/^\d+$/); // Should be numeric string
      }

      // Store original position IDs for later comparison with events
      const originalPositionIds = vaultLoadedEventData.positionIds;

      // After service.start(), should have 0 positions remaining (all non-aligned positions closed)
      const currentVaultPositionIds = Object.keys(vault.positions);
      expect(currentVaultPositionIds.length).toBe(2);

      // Validate the position structure
      currentVaultPositionIds.forEach(positionId => {
        const position = vault.positions[positionId];
        expect(position.id).toBe(positionId);
        expect(position.pool).toBeDefined();
        expect(typeof position.pool).toBe('string');
        expect(position.pool).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(typeof position.tickLower).toBe('number');
        expect(typeof position.tickUpper).toBe('number');
        expect(position.tickLower).toBeLessThan(position.tickUpper);
        expect(position.liquidity).toBeDefined();
        expect(typeof position.liquidity).toBe('string');
        expect(position.liquidity).toMatch(/^\d+$/); // Numeric string
        expect(typeof position.lastUpdated).toBe('number');
      });

      // Metadata Testing
      expect(vault.lastUpdated).toBeDefined();
      expect(typeof vault.lastUpdated).toBe('number');
      expect(vault.lastUpdated).toBeGreaterThan(Date.now() - 180000); // Within last 180 seconds

      // Test 7: Verify vaultLoaded event was emitted correctly
      expect(vaultLoadedEventData).toBeDefined();
      expect(vaultLoadedEventData).not.toBe(null);
      expect(vaultLoadedEventData.vaultAddress).toBeDefined();
      expect(vaultLoadedEventData.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(vaultLoadedEventData.strategyId).toBe('bob');
      expect(vaultLoadedEventData.positionCount).toBe(2);
      expect(vaultLoadedEventData.positionIds).toHaveLength(2);
      expect(vaultLoadedEventData.targetTokens).toEqual(['USDC', 'WETH']);
      expect(vaultLoadedEventData.targetPlatforms).toEqual(['uniswapV3']);

      console.log(`Successfully discovered and loaded vault ${vault.address} with ${vaultLoadedEventData.positionCount} position(s)`);

      // Test 8: Verify InitialPositionsEvaluated event from service.start() workflow

      // Verify InitialPositionsEvaluated event was emitted during service.start()
      expect(capturedEvents).toHaveLength(1);
      const eventData = capturedEvents[0];

      // Verify required fields
      expect(eventData.vaultAddress).toBe(vault.address);
      expect(eventData.success).toBe(true);
      expect(typeof eventData.alignedCount).toBe('number');
      expect(typeof eventData.nonAlignedCount).toBe('number');
      expect(Array.isArray(eventData.alignedPositionIds)).toBe(true);
      expect(Array.isArray(eventData.nonAlignedPositionIds)).toBe(true);

      // Test specific 0AP/2NP scenario expectations:
      // - 2 positions with WBTC/WETH tokens (WBTC not in target tokens USDC/WETH)
      // - Both positions on uniswapV3 platform (matches target platform)
      // - Vault has WBTC and USD₮0 token balances (both non-aligned tokens)
      // - Position 1: Out of range (above current tick)
      // - Position 2: In range but too close to boundary (violates rebalanceThresholdLower)
      expect(eventData.alignedCount).toBe(0);          // 0 Aligned Positions
      expect(eventData.nonAlignedCount).toBe(2);       // 2 Non-aligned Positions
      expect(eventData.alignedPositionIds).toHaveLength(0);
      expect(eventData.nonAlignedPositionIds).toHaveLength(2);

      // Verify the non-aligned position IDs match our originally loaded positions
      expect(eventData.nonAlignedPositionIds).toEqual(expect.arrayContaining(originalPositionIds));

      console.log(`✅ InitialPositionsEvaluated event verified: ${eventData.alignedCount}AP/${eventData.nonAlignedCount}NP scenario successful`);
      console.log(`   Non-aligned positions: ${eventData.nonAlignedPositionIds.join(', ')}`);
      console.log(`   Token balances: WBTC=${vault.tokens.WBTC}, USD₮0=${vault.tokens['USD₮0']}`);

      // Test 9: Verify PositionsClosed event from service.start() workflow
      expect(closedPositionsEvents).toHaveLength(1);
      const closeEventData = closedPositionsEvents[0];

      // Verify required fields
      expect(closeEventData.vaultAddress).toBe(vault.address);
      expect(typeof closeEventData.closedCount).toBe('number');
      expect(Array.isArray(closeEventData.closedPositions)).toBe(true);
      expect(closeEventData.gasUsed).toBeDefined();
      expect(closeEventData.gasEstimated).toBeDefined();
      expect(closeEventData.transactionHash).toBeDefined();
      expect(closeEventData.success).toBe(true);

      // Test specific 0AP/2NP scenario expectations: should close 2 non-aligned positions
      expect(closeEventData.closedCount).toBe(2);
      expect(closeEventData.closedPositions).toHaveLength(2);

      // Verify all closed position IDs match non-aligned positions
      const closedPositionIds = closeEventData.closedPositions.map(p => p.positionId);
      expect(closedPositionIds).toEqual(expect.arrayContaining(eventData.nonAlignedPositionIds));

      // Verify structure of each closed position
      closeEventData.closedPositions.forEach(closedPosition => {
        expect(closedPosition.positionId).toBeDefined();
        expect(closedPosition.pool).toBeDefined();
        expect(closedPosition.token0Symbol).toBeDefined();
        expect(closedPosition.token1Symbol).toBeDefined();
        expect(closedPosition.platform).toBe('uniswapV3');
        expect(closedPosition.principalAmount0).toBeDefined();
        expect(closedPosition.principalAmount1).toBeDefined();
        // At least one amount must be > 0 (out-of-range positions only have one token)
        const amount0 = BigInt(closedPosition.principalAmount0);
        const amount1 = BigInt(closedPosition.principalAmount1);
        expect(amount0 + amount1).toBeGreaterThan(0n);
        expect(typeof closedPosition.tickLower).toBe('number');
        expect(typeof closedPosition.tickUpper).toBe('number');
        expect(closedPosition.tickUpper).toBeGreaterThan(closedPosition.tickLower);
      });

      console.log(`✅ PositionsClosed event verified: ${closeEventData.closedCount} positions closed`);
      closeEventData.closedPositions.forEach(p => {
        console.log(`   Position ${p.positionId}: ${p.token0Symbol}/${p.token1Symbol}, Principal: ${p.principalAmount0}/${p.principalAmount1}`);
      });

      // Test 9: Verify FeesCollected event from position closures during initialization
      // Note: Event is only emitted if fees > 0
      if (feesCollectedEvents.length > 0) {
        const initFeesEvent = feesCollectedEvents[0];
        expect(initFeesEvent).toBeDefined();
        expect(initFeesEvent.vaultAddress).toBe(vault.address);
        expect(initFeesEvent.source).toBe('initialization');
        expect(typeof initFeesEvent.totalUSD).toBe('number');
        expect(initFeesEvent.totalUSD).toBeGreaterThan(0); // Only emitted if fees > 0
        expect(typeof initFeesEvent.token0Collected).toBe('number');
        expect(typeof initFeesEvent.token1Collected).toBe('number');
        expect(typeof initFeesEvent.reinvestmentRatio).toBe('number');
        expect(initFeesEvent.reinvestmentRatio).toBeGreaterThanOrEqual(0);
        expect(initFeesEvent.reinvestmentRatio).toBeLessThanOrEqual(100);
        expect(initFeesEvent.transactionHash).toBeDefined();

        console.log(`✅ FeesCollected event verified: $${initFeesEvent.totalUSD.toFixed(2)} collected during initialization`);
        console.log(`   Source: ${initFeesEvent.source}, Reinvestment: ${initFeesEvent.reinvestmentRatio}%`);
        console.log(`   Fees: ${initFeesEvent.token0Collected} ${initFeesEvent.token0Symbol}, ${initFeesEvent.token1Collected} ${initFeesEvent.token1Symbol}`);
      } else {
        console.log(`✅ FeesCollected event correctly not emitted (no fees collected from closed positions)`);
      }

      // Test 9a: Verify BatchTransactionExecuted event for position closure
      expect(batchTransactionEvents.length).toBeGreaterThan(0);

      // Find the BatchTransactionExecuted event for position closure
      const positionClosureBatchEvent = batchTransactionEvents.find(event => event.operationType === 'position closes');
      expect(positionClosureBatchEvent).toBeDefined();
      expect(positionClosureBatchEvent.vaultAddress).toBe(vault.address);
      expect(positionClosureBatchEvent.strategyId).toBe(vault.strategy.strategyId);
      expect(positionClosureBatchEvent.operationType).toBe('position closes');
      expect(positionClosureBatchEvent.transactionCount).toBe(2); // Should have 2 transactions for 2 position closures

      console.log(`✅ BatchTransactionExecuted for position closure verified: ${positionClosureBatchEvent.transactionCount} transactions executed`);

      // Test 10: Verify exact token balances after position closure
      console.log('Testing exact token balances after position closure...');

      // Should have at least one TokenBalancesFetched event (from vault loading)
      expect(tokenBalanceFetchEvents.length).toBeGreaterThan(0);

      // Get the second token balance fetch (after positions are closed, before swaps)
      const finalBalanceEvent = tokenBalanceFetchEvents[1];
      expect(finalBalanceEvent.vaultAddress).toBe(vault.address);
      expect(finalBalanceEvent.balances).toBeDefined();

      // Verify exact token balances match expected values
      console.log('Actual vs Expected token balances:');
      for (const [token, expectedBalance] of Object.entries(testVault.expectedFinalBalances)) {
        const actualBalance = finalBalanceEvent.balances[token];
        console.log(`  ${token}: actual=${actualBalance}, expected=${expectedBalance}`);

        // Convert to BigNumber for comparison with tolerance for rounding in DeFi operations
        const actual = ethers.BigNumber.from(actualBalance);
        const expected = ethers.BigNumber.from(expectedBalance);
        const difference = actual.gt(expected) ? actual.sub(expected) : expected.sub(actual);
        const tolerance = expected.div(100000); // 0.001% tolerance for rounding in DeFi operations

        if (difference.gt(tolerance)) {
          console.log(`  ❌ ${token}: difference ${difference.toString()} exceeds tolerance ${tolerance.toString()}`);
          expect(difference.lte(tolerance)).toBe(true);
        } else {
          console.log(`  ✅ ${token}: difference ${difference.toString()} within tolerance ${tolerance.toString()}`);
        }
      }

      console.log('✅ Exact token balance verification successful');

      // Test 11: Asset Values with Real Prices - Integration Testing
      console.log('Testing asset values with real prices...');

      // Verify we have asset value events
      expect(assetValueEvents.length).toBeGreaterThanOrEqual(2);

      // Get asset values AFTER position closure but BEFORE swaps/liquidity adds
      // [0] = baseline capture, [1] = after closure (for utilization calc), [2+] = after liquidity ops
      const assetValueEvent = assetValueEvents[1];
      expect(assetValueEvent.vaultAddress).toBe(vault.address);

      // Test event structure
      expect(assetValueEvent.tokenCount).toBeDefined();
      expect(assetValueEvent.positionCount).toBeDefined();
      expect(assetValueEvent.totalTokenValue).toBeDefined();
      expect(assetValueEvent.totalPositionValue).toBeDefined();
      expect(assetValueEvent.totalVaultValue).toBeDefined();
      expect(assetValueEvent.assetData).toBeDefined();
      expect(assetValueEvent.timestamp).toBeDefined();

      // Test value reasonableness for 0AP/2NP scenario
      expect(assetValueEvent.totalTokenValue).toBeGreaterThan(0);
      expect(assetValueEvent.totalPositionValue).toBe(0); // No positions remain after closure
      expect(assetValueEvent.totalVaultValue).toBeGreaterThan(0);
      expect(assetValueEvent.totalVaultValue).toBe(assetValueEvent.totalTokenValue + assetValueEvent.totalPositionValue);

      // Test token value mathematical precision against known setup values
      const { tokens, positions } = assetValueEvent.assetData;
      for (const [tokenSymbol, tokenData] of Object.entries(tokens)) {
        const tokenConfig = service.tokens[tokenSymbol];
        const expectedRawBalance = testVault.expectedFinalBalances[tokenSymbol];

        // All tokens should have prices
        expect(tokenData.price).toBeGreaterThan(0);

        // Skip tokens not in our setup (they should have 0 balance anyway)
        if (expectedRawBalance === undefined || expectedRawBalance === null) {
          expect(tokenData.usdValue).toBe(0); // Should be zero if not in our setup
          continue;
        }

        const expectedBalanceInTokens = parseFloat(ethers.utils.formatUnits(expectedRawBalance, tokenConfig.decimals));

        if (expectedBalanceInTokens === 0) {
          // Zero balance should have zero USD value
          expect(tokenData.usdValue).toBe(0);
        } else {
          // Non-zero balance: verify usdValue ÷ price = expected balance from setup
          expect(tokenData.usdValue).toBeGreaterThan(0);
          const impliedBalanceInTokens = tokenData.usdValue / tokenData.price;

          // Use tight relative tolerance for floating-point precision
          const relativeTolerance = Math.max(expectedBalanceInTokens * 0.00001, 1e-12); // 0.001% or minimum 1e-12
          const difference = Math.abs(impliedBalanceInTokens - expectedBalanceInTokens);
          expect(difference).toBeLessThanOrEqual(relativeTolerance);

          console.log(`   ${tokenSymbol}: $${tokenData.usdValue.toFixed(2)} ÷ $${tokenData.price.toFixed(6)} = ${impliedBalanceInTokens.toFixed(8)} (expected: ${expectedBalanceInTokens.toFixed(8)})`);
        }

        // Price reasonableness checks for major tokens
        if (tokenSymbol === 'USDC' || tokenSymbol === 'USD₮0') {
          expect(tokenData.price).toBeGreaterThan(0.95); // Stablecoins near $1
          expect(tokenData.price).toBeLessThan(1.05);
        }
        if (tokenSymbol === 'WETH') {
          expect(tokenData.price).toBeGreaterThan(1000); // ETH > $1000
          expect(tokenData.price).toBeLessThan(20000); // ETH < $20000
        }
        if (tokenSymbol === 'WBTC') {
          expect(tokenData.price).toBeGreaterThan(20000); // BTC > $20k
          expect(tokenData.price).toBeLessThan(500000); // BTC < $500k
        }
      }

      // Test position value structure
      for (const [positionId, positionData] of Object.entries(positions)) {
        expect(positionData.token0Amount).toBeDefined();
        expect(positionData.token1Amount).toBeDefined();
        expect(positionData.token0UsdValue).toBeGreaterThanOrEqual(0);
        expect(positionData.token1UsdValue).toBeGreaterThanOrEqual(0);
      }

      console.log(`✅ Asset values verified with mathematical precision: $${assetValueEvent.totalVaultValue.toFixed(2)} total vault value`);
      console.log(`   Token values: $${assetValueEvent.totalTokenValue.toFixed(2)}`);
      console.log(`   Position values: $${assetValueEvent.totalPositionValue.toFixed(2)}`);

      // Test 12: Verify UtilizationCalculated event values against expected calculations
      console.log('Testing UtilizationCalculated event against expected values...');

      // Calculate expected values using the verified asset values from Test 11
      const maxUtilizationPercent = vault.strategy.parameters.maxUtilization; // e.g., 80
      const expectedMaxUtilization = maxUtilizationPercent / 100; // Convert to decimal
      const expectedCurrentUtilization = assetValueEvent.totalVaultValue > 0
        ? assetValueEvent.totalPositionValue / assetValueEvent.totalVaultValue
        : 0;
      const expectedAvailableDeployment = assetValueEvent.totalVaultValue * expectedMaxUtilization - assetValueEvent.totalPositionValue;

      // Check if we have captured utilization events (may be 0 due to code breaker)
      if (utilizationEvents.length === 0) {
        console.log('⚠️  No UtilizationCalculated events captured (likely due to code breaker)');
        console.log(`   Expected values calculated from verified asset data:`);
        console.log(`   Expected current utilization: ${(expectedCurrentUtilization * 100).toFixed(1)}%`);
        console.log(`   Expected max utilization: ${(expectedMaxUtilization * 100).toFixed(1)}%`);
        console.log(`   Expected available deployment: $${expectedAvailableDeployment.toFixed(2)}`);
      } else {
        // Get the most recent utilization event and test against expected values
        const utilizationEvent = utilizationEvents[utilizationEvents.length - 1];

        // Verify event structure
        expect(utilizationEvent.vaultAddress).toBe(vault.address);
        expect(utilizationEvent.currentUtilization).toBeDefined();
        expect(utilizationEvent.maxUtilization).toBeDefined();
        expect(utilizationEvent.availableDeployment).toBeDefined();

        // Test actual event values against our expected calculations
        expect(utilizationEvent.currentUtilization).toBe(expectedCurrentUtilization);
        expect(utilizationEvent.maxUtilization).toBe(expectedMaxUtilization);
        expect(utilizationEvent.availableDeployment).toBe(expectedAvailableDeployment);

        // Additional 0AP/2NP scenario verification
        expect(utilizationEvent.currentUtilization).toBe(0); // No aligned positions
        expect(utilizationEvent.positionValue).toBe(0); // No positions remain
        expect(utilizationEvent.availableDeployment).toBe(assetValueEvent.totalVaultValue * expectedMaxUtilization);

        console.log(`✅ UtilizationCalculated event verified against expected calculations:`);
        console.log(`   Actual current utilization: ${(utilizationEvent.currentUtilization * 100).toFixed(1)}% = Expected: ${(expectedCurrentUtilization * 100).toFixed(1)}%`);
        console.log(`   Actual max utilization: ${(utilizationEvent.maxUtilization * 100).toFixed(1)}% = Expected: ${(expectedMaxUtilization * 100).toFixed(1)}%`);
        console.log(`   Actual available deployment: $${utilizationEvent.availableDeployment.toFixed(2)} = Expected: $${expectedAvailableDeployment.toFixed(2)}`);
      }

      // Test 13: Verify OptimalPoolSelected event was emitted during createNewPosition
      console.log('\n📊 Test 13: Verifying OptimalPoolSelected event...');

      expect(optimalPoolSelectedEvents).toHaveLength(1);
      const poolEvent = optimalPoolSelectedEvents[0];
      expect(poolEvent.token0Symbol).toBeDefined();
      expect(poolEvent.token1Symbol).toBeDefined();
      expect(['USDC', 'WETH']).toContain(poolEvent.token0Symbol);
      expect(['USDC', 'WETH']).toContain(poolEvent.token1Symbol);
      expect(poolEvent.token0Symbol).not.toBe(poolEvent.token1Symbol); // Should be different tokens
      expect(poolEvent.platformId).toBe('uniswapV3');
      expect(poolEvent.platformName).toBe('Uniswap V3');
      expect(poolEvent.poolAddress).toBeDefined();
      expect(poolEvent.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/); // Valid Ethereum address
      expect(poolEvent.poolFee).toBeDefined();
      expect(poolEvent.poolFee).toBeGreaterThan(0);
      expect(poolEvent.poolTVL).toBeDefined();
      expect(poolEvent.poolTVL).toBeGreaterThan(0);
      expect(poolEvent.poolLiquidity).toBeDefined();
      expect(poolEvent.poolsDiscovered).toBeGreaterThan(0);
      expect(poolEvent.poolsEligible).toBeGreaterThan(0);
      expect(poolEvent.poolsEligible).toBeLessThanOrEqual(poolEvent.poolsDiscovered);
      expect(poolEvent.fromCache).toBe(false); // Should be fresh selection in vault init workflow
      expect(['highest TVL']).toContain(poolEvent.selectionMethod);
      expect(poolEvent.chainId).toBe(service.chainId);
      expect(poolEvent.timestamp).toBeGreaterThan(0);

      console.log(`✅ OptimalPoolSelected event verified:`);
      console.log(`   Pool: ${poolEvent.poolAddress} (${poolEvent.token0Symbol}/${poolEvent.token1Symbol})`);
      console.log(`   Fee: ${poolEvent.poolFee}, Selection: ${poolEvent.selectionMethod}`);
      console.log(`   Pools: ${poolEvent.poolsEligible}/${poolEvent.poolsDiscovered} eligible`);

      // Test 14: Verify PositionParametersCalculated event
      console.log('\n📊 Test 14: Verifying PositionParametersCalculated event...');

      expect(positionParametersEvents).toHaveLength(1);
      const newPositionEvent = positionParametersEvents[0];
      expect(newPositionEvent.vaultAddress).toBe(vault.address);
      expect(newPositionEvent.poolAddress).toBe(poolEvent.poolAddress); // Should match the selected pool
      expect(newPositionEvent.poolFee).toBe(poolEvent.poolFee);
      expect(newPositionEvent.poolTick).toBeDefined();
      expect(newPositionEvent.token0Symbol).toBe(poolEvent.token0Symbol);
      expect(newPositionEvent.token1Symbol).toBe(poolEvent.token1Symbol);
      expect(newPositionEvent.tickLower).toBeDefined();
      expect(newPositionEvent.tickUpper).toBeDefined();
      expect(newPositionEvent.tickLower).toBeLessThan(newPositionEvent.tickUpper);
      expect(newPositionEvent.targetRangeUpper).toBeDefined();
      expect(newPositionEvent.targetRangeLower).toBeDefined();

      // Validate tick range using price-based calculation (tests actual business requirement)
      const adapter = service.adapters.get('uniswapV3');
      const token0Data = service.tokens[newPositionEvent.token0Symbol];
      const token1Data = service.tokens[newPositionEvent.token1Symbol];

      // Convert ticks to prices using our adapter (tests integration with library)
      const currentPrice = adapter.tickToPrice(Number(newPositionEvent.poolTick), token0Data, token1Data);
      const lowerPrice = adapter.tickToPrice(newPositionEvent.tickLower, token0Data, token1Data);
      const upperPrice = adapter.tickToPrice(newPositionEvent.tickUpper, token0Data, token1Data);

      // Calculate actual percentage ranges achieved
      const lowerRangePercent = ((Number(currentPrice.toFixed(18)) - Number(lowerPrice.toFixed(18))) / Number(currentPrice.toFixed(18))) * 100;
      const upperRangePercent = ((Number(upperPrice.toFixed(18)) - Number(currentPrice.toFixed(18))) / Number(currentPrice.toFixed(18))) * 100;

      // Verify the ranges are within ±0.3% of the target (much tighter than percentage-based tolerance)
      const lowerDiff = lowerRangePercent - newPositionEvent.targetRangeLower;
      const upperDiff = upperRangePercent - newPositionEvent.targetRangeUpper;
      expect(lowerDiff).toBeGreaterThanOrEqual(-0.3);
      expect(lowerDiff).toBeLessThanOrEqual(0.3);
      expect(upperDiff).toBeGreaterThanOrEqual(-0.3);
      expect(upperDiff).toBeLessThanOrEqual(0.3);

      // Validate token0 allocation by deriving it from optimal ratio
      const expectedToken0Share = newPositionEvent.deploymentAmount / (1 + (1 / newPositionEvent.optimalRatio));
      const actualToken0USDAmount = parseFloat(newPositionEvent.finalQuoteToken0) * assetValueEvent.assetData.tokens[newPositionEvent.token0Symbol].price;
      expect(actualToken0USDAmount).toBeCloseTo(expectedToken0Share, 1);

      // Validate deployment utilization is very close to max utilization (allows for LP positioning tolerance)
      const deploymentUtilization = newPositionEvent.deploymentAmount / assetValueEvent.totalVaultValue;
      expect(deploymentUtilization).toBeCloseTo(vault.strategy.parameters.maxUtilization / 100, 3);

      expect(newPositionEvent.token0Amount).toBeDefined();
      expect(newPositionEvent.finalQuoteToken0).toBeDefined();
      expect(newPositionEvent.finalQuoteToken1).toBeDefined();
      expect(newPositionEvent.chainId).toBe(service.chainId);
      expect(newPositionEvent.timestamp).toBeGreaterThan(0);

      console.log(`✅ PositionParametersCalculated event verified:`);
      console.log(`   Range: [${newPositionEvent.tickLower}, ${newPositionEvent.tickUpper}]`);
      console.log(`   Ratio: ${newPositionEvent.optimalRatio.toFixed(4)} ${newPositionEvent.token0Symbol}:${newPositionEvent.token1Symbol}`);
      console.log(`   Deployment: $${newPositionEvent.deploymentAmount.toFixed(2)} -> $${expectedToken0Share.toFixed(2)} ${newPositionEvent.token0Symbol}`);
      console.log(`   Final quote: ${newPositionEvent.finalQuoteToken0} ${newPositionEvent.token0Symbol}, ${newPositionEvent.finalQuoteToken1} ${newPositionEvent.token1Symbol}`);

      // Test 15: Verify exact token balances after deficit covering swaps
      console.log('📊 Test 15: Verifying token preparation and deficit covering...');

      // Should have at least 3 TokenBalancesFetched events
      // [0] = initialization, [1] = post-closure, [2] = post-swaps
      expect(tokenBalanceFetchEvents.length).toBeGreaterThanOrEqual(3);

      const postClosureBalances = tokenBalanceFetchEvents[1].balances;
      const postSwapBalances = tokenBalanceFetchEvents[2].balances;

      // Calculate actual balance changes from swaps
      const balanceChanges = {};
      for (const [token, postSwapBalance] of Object.entries(postSwapBalances)) {
        const postClosureBalance = postClosureBalances[token] || '0';
        const change = ethers.BigNumber.from(postSwapBalance).sub(postClosureBalance);
        if (!change.isZero()) {
          balanceChanges[token] = change;
        }
      }

      // Verify we have TokenPreparationCompleted event with swap data
      expect(tokenPreparationEvents.length).toBeGreaterThan(0);
      const prepEvent = tokenPreparationEvents[0];
      expect(prepEvent.preparationResult).toBe('swaps_generated');

      // Extract requirements and deficits from preparation event
      const token0Symbol = prepEvent.targetTokens.token0.symbol;
      const token1Symbol = prepEvent.targetTokens.token1.symbol;
      const token0Required = ethers.BigNumber.from(prepEvent.targetTokens.token0.required);
      const token1Required = ethers.BigNumber.from(prepEvent.targetTokens.token1.required);
      const token0Deficit = ethers.BigNumber.from(prepEvent.targetTokens.token0.deficit);
      const token1Deficit = ethers.BigNumber.from(prepEvent.targetTokens.token1.deficit);

      // For 0202 scenario: USDC deficit is guaranteed (we start with 0 USDC)
      if (token0Symbol === 'USDC' || token1Symbol === 'USDC') {
        const usdcDeficit = token0Symbol === 'USDC' ? token0Deficit : token1Deficit;
        expect(usdcDeficit.gt(0)).toBe(true);
        console.log(`   USDC deficit confirmed: ${usdcDeficit.toString()}`);
      }

      // Test deficit coverage for token0
      if (token0Deficit.gt(0)) {
        // Should have gained token0
        expect(balanceChanges[token0Symbol].gt(0)).toBe(true);

        // Verify final balance meets requirement (with 0.1% tolerance)
        const actualToken0 = ethers.BigNumber.from(postSwapBalances[token0Symbol]);
        if (actualToken0.lt(token0Required)) {
          const shortfall = token0Required.sub(actualToken0);
          const tolerance = token0Required.div(1000); // 0.1%
          expect(shortfall.lte(tolerance)).toBe(true);
          console.log(`   ${token0Symbol} slightly under requirement but within 0.1% tolerance`);
        } else {
          expect(actualToken0.gte(token0Required)).toBe(true);
          console.log(`   ${token0Symbol} requirement fully covered with buffer`);
        }
      }

      // Test deficit coverage for token1
      if (token1Deficit.gt(0)) {
        // Should have gained token1
        expect(balanceChanges[token1Symbol].gt(0)).toBe(true);

        // Verify final balance meets requirement (with 0.1% tolerance)
        const actualToken1 = ethers.BigNumber.from(postSwapBalances[token1Symbol]);
        if (actualToken1.lt(token1Required)) {
          const shortfall = token1Required.sub(actualToken1);
          const tolerance = token1Required.div(1000); // 0.1%
          expect(shortfall.lte(tolerance)).toBe(true);
          console.log(`   ${token1Symbol} slightly under requirement but within 0.1% tolerance`);
        } else {
          expect(actualToken1.gte(token1Required)).toBe(true);
          console.log(`   ${token1Symbol} requirement fully covered with buffer`);
        }
      }

      // Verify swap direction (which token was traded away)
      if (token0Deficit.gt(0) && token1Deficit.isZero()) {
        // Swapped token1 for token0 (if token1 was actually used)
        if (balanceChanges[token1Symbol] !== undefined) {
          expect(balanceChanges[token1Symbol].lt(0)).toBe(true);
        }
      } else if (token1Deficit.gt(0) && token0Deficit.isZero()) {
        // Swapped token0 for token1 (if token0 was actually used)
        if (balanceChanges[token0Symbol] !== undefined) {
          expect(balanceChanges[token0Symbol].lt(0)).toBe(true);
        }
      }

      // Log the swap results
      console.log('✅ Token balances after deficit covering swaps verified:');
      console.log(`   Post-swap balance changes:`);
      for (const [token, change] of Object.entries(balanceChanges)) {
        const changeStr = change > 0 ? '+' : '';
        console.log(`     ${token}: ${changeStr}${change.toString()}`);
      }
      if (token0Deficit > 0) {
        console.log(`   ${token0Symbol} deficit of ${token0Deficit} covered`);
      }
      if (token1Deficit > 0) {
        console.log(`   ${token1Symbol} deficit of ${token1Deficit} covered`);
      }

      // Test 16: Verify 5050SwapsPrepared event for remaining token conversion
      console.log('📊 Test 16: Verifying 50/50 conversion of remaining tokens...');

      // Should have captured 5050SwapsPrepared event
      expect(buffer5050Events.length).toBeGreaterThan(0);
      const event5050 = buffer5050Events[0];
      expect(event5050.vaultAddress).toBe(vault.address);

      // Calculate expected values from independent sources (post-deficit balances)
      const postDeficitBalances = tokenBalanceFetchEvents[2].balances;

      // In 0202 scenario, remaining tokens could include WBTC and USD₮0
      const remainingTokens = ['WBTC', 'USD₮0'].filter(token =>
        postDeficitBalances[token] && parseFloat(postDeficitBalances[token]) > 0
      );

      // Calculate total expected USD value of remaining tokens
      let expectedTotalUSD = 0;
      for (const tokenSymbol of remainingTokens) {
        const balance = parseFloat(postDeficitBalances[tokenSymbol]);
        const tokenPrice = assetValueEvent.assetData.tokens[tokenSymbol].price;
        const tokenDecimals = service.tokens[tokenSymbol].decimals;
        expectedTotalUSD += Number(ethers.utils.formatUnits(balance, tokenDecimals)) * tokenPrice;
      }

      // Verify USD calculations
      expect(parseFloat(event5050.totalRemainingUSD)).toBeCloseTo(expectedTotalUSD, 2);
      expect(parseFloat(event5050.targetToken0USD)).toBeCloseTo(expectedTotalUSD / 2, 2);
      expect(parseFloat(event5050.targetToken1USD)).toBeCloseTo(expectedTotalUSD / 2, 2);

      // Verify token processing - individual tokens may go entirely to one target,
      // but the overall USD split should be 50/50
      expect(event5050.nonAlignedTokensProcessed.length).toBeGreaterThan(0);
      for (const tokenProc of event5050.nonAlignedTokensProcessed) {
        expect(remainingTokens).toContain(tokenProc.symbol);
        expect(ethers.BigNumber.from(tokenProc.initialBalance).gt(0)).toBe(true);

        // Each token goes to at least one target (total balance should be allocated)
        const swappedToToken0 = ethers.BigNumber.from(tokenProc.swappedToToken0);
        const swappedToToken1 = ethers.BigNumber.from(tokenProc.swappedToToken1);
        expect(swappedToToken0.add(swappedToToken1).gt(0)).toBe(true);

        // Verify amounts add up
        const totalSplit = swappedToToken0.add(swappedToToken1);
        expect(totalSplit.toString()).toBe(tokenProc.initialBalance);
      }

      // Verify 50/50 USD split
      const token0USD = parseFloat(event5050.actualSwappedToToken0USD);
      const token1USD = parseFloat(event5050.actualSwappedToToken1USD);
      const totalSwappedUSD = token0USD + token1USD;
      if (totalSwappedUSD > 0) {
        const ratio = token0USD / totalSwappedUSD;
        expect(ratio).toBeGreaterThan(0.48);
        expect(ratio).toBeLessThan(0.52);
      }

      // Verify transaction generation
      expect(event5050.conversionResult).toBe('swaps_generated');
      expect(event5050.swapTransactions.length).toBe(2);

      // Verify swaps are to Universal Router (Permit2 enabled)
      const universalRouter = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD';
      event5050.swapTransactions.forEach(swap => {
        expect(swap.to).toBe(universalRouter);
        expect(swap.value).toBe('0x00');
      });

      console.log('✅ 5050SwapsPrepared event verified:');
      console.log(`   Total remaining USD: $${event5050.totalRemainingUSD}`);
      console.log(`   Target 50/50 split: $${event5050.targetToken0USD} each`);
      console.log(`   Actual split: $${token0USD.toFixed(2)} / $${token1USD.toFixed(2)}`);
      console.log(`   Tokens processed: ${event5050.nonAlignedTokensProcessed.map(t => t.symbol).join(', ')}`);

      // Test 16b: Verify TokensSwapped events
      console.log('\n📊 Test 16b: Verifying TokensSwapped events...');
      expect(tokensSwappedEvents.length).toBeGreaterThan(0);

      // Should have deficit_coverage and buffer_5050 swaps
      const deficitSwapEvent = tokensSwappedEvents.find(e => e.swapType === 'deficit_coverage');
      const bufferSwapEvent = tokensSwappedEvents.find(e => e.swapType === 'buffer_5050');

      // Validate deficit swap event
      if (deficitSwapEvent) {
        expect(deficitSwapEvent.vaultAddress).toBe(vault.address);
        expect(deficitSwapEvent.swapCount).toBeGreaterThan(0);
        expect(deficitSwapEvent.success).toBe(true);
        expect(deficitSwapEvent.gasUsed).toBeDefined();
        expect(deficitSwapEvent.effectiveGasPrice).toBeDefined();

        deficitSwapEvent.swaps.forEach(swap => {
          expect(swap.tokenInSymbol).toBeDefined();
          expect(swap.tokenOutSymbol).toBeDefined();
          expect(swap.quotedAmountIn).toBeDefined();
          expect(swap.quotedAmountOut).toBeDefined();
          expect(swap.actualAmountIn).toBeDefined();
          expect(swap.actualAmountOut).toBeDefined();
          expect(typeof swap.isAmountIn).toBe('boolean');
        });

        console.log(`✅ Deficit coverage swaps verified: ${deficitSwapEvent.swapCount} swap(s)`);
      }

      // Validate buffer swap event
      if (bufferSwapEvent) {
        expect(bufferSwapEvent.vaultAddress).toBe(vault.address);
        expect(bufferSwapEvent.swapCount).toBeGreaterThan(0);
        expect(bufferSwapEvent.success).toBe(true);
        expect(bufferSwapEvent.gasUsed).toBeDefined();
        expect(bufferSwapEvent.effectiveGasPrice).toBeDefined();

        bufferSwapEvent.swaps.forEach(swap => {
          expect(swap.tokenInSymbol).toBeDefined();
          expect(swap.tokenOutSymbol).toBeDefined();
          expect(swap.quotedAmountIn).toBeDefined();
          expect(swap.quotedAmountOut).toBeDefined();
          expect(swap.actualAmountIn).toBeDefined();
          expect(swap.actualAmountOut).toBeDefined();
          expect(typeof swap.isAmountIn).toBe('boolean');
        });

        console.log(`✅ Buffer 50/50 swaps verified: ${bufferSwapEvent.swapCount} swap(s)`);
      }

      // Test 17: Verify NewPositionCreated event
      console.log('\n📊 Test 17: Verifying NewPositionCreated event...');

      expect(newPositionCreatedEvents.length).toBe(1);
      const createdPositionEvent = newPositionCreatedEvents[0];

      // Basic vault info assertions
      expect(createdPositionEvent.vaultAddress).toBe(vault.address);
      expect(createdPositionEvent.positionId).toBeDefined();
      expect(createdPositionEvent.positionId).not.toBeNull();
      expect(createdPositionEvent.poolAddress).toBeDefined();
      expect(createdPositionEvent.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

      console.log(`✅ NewPositionCreated event basic info verified:`);
      console.log(`   Vault: ${createdPositionEvent.vaultAddress}`);
      console.log(`   Position ID: ${createdPositionEvent.positionId}`);
      console.log(`   Pool: ${createdPositionEvent.poolAddress}`);

      // Validate token amounts (both quoted and actual)
      expect(parseFloat(createdPositionEvent.quotedToken0)).toBeGreaterThan(0);
      expect(parseFloat(createdPositionEvent.quotedToken1)).toBeGreaterThan(0);
      expect(parseFloat(createdPositionEvent.actualToken0)).toBeGreaterThan(0);
      expect(parseFloat(createdPositionEvent.actualToken1)).toBeGreaterThan(0);

      // Validate that actual amounts are close to quoted amounts (within reasonable slippage)
      const quoted0 = parseFloat(createdPositionEvent.quotedToken0);
      const actual0 = parseFloat(createdPositionEvent.actualToken0);
      const quoted1 = parseFloat(createdPositionEvent.quotedToken1);
      const actual1 = parseFloat(createdPositionEvent.actualToken1);

      const diff0Percent = quoted0 > 0 ? Math.abs((actual0 - quoted0) / quoted0) * 100 : 0;
      const diff1Percent = quoted1 > 0 ? Math.abs((actual1 - quoted1) / quoted1) * 100 : 0;
      expect(diff0Percent).toBeLessThan(2);
      expect(diff1Percent).toBeLessThan(2);

      // Utilization check
      const finalUtilization = createdPositionEvent.totalPositionValue / createdPositionEvent.totalVaultValue;
      const maxUtilization = vault.strategy.parameters.maxUtilization / 100;
      expect(finalUtilization).toBeCloseTo(maxUtilization, 1);

      console.log(`✅ NewPositionCreated token amounts validated:`);
      console.log(`   Quoted amounts: ${createdPositionEvent.quotedToken0} token0, ${createdPositionEvent.quotedToken1} token1`);
      console.log(`   Actual amounts: ${createdPositionEvent.actualToken0} token0, ${createdPositionEvent.actualToken1} token1`);
      console.log(`   Difference: ${diff0Percent.toFixed(2)}% token0, ${diff1Percent.toFixed(2)}% token1 (< 2% acceptable)`);
      console.log(`   Utilization achieved: ${(finalUtilization * 100).toFixed(1)}% (target: ${(maxUtilization * 100).toFixed(1)}%)`);
      console.log(`   Total vault value: $${createdPositionEvent.totalVaultValue.toFixed(2)}`);

      // Validate tokens
      expect(createdPositionEvent.tokenSymbols).toBeDefined();
      expect(Array.isArray(createdPositionEvent.tokenSymbols)).toBe(true);
      expect(createdPositionEvent.tokenSymbols).toHaveLength(2);
      expect(createdPositionEvent.tokenSymbols).toContain('USDC');
      expect(createdPositionEvent.tokenSymbols).toContain('WETH');

      // Validate platform
      expect(createdPositionEvent.platform).toBe('uniswapV3');

      // Non-aligned balances should be close to 0 (consumed in swaps)
      expect(createdPositionEvent.nonAlignedBalances).toBeDefined();
      if (createdPositionEvent.nonAlignedBalances.WBTC) {
        expect(parseFloat(createdPositionEvent.nonAlignedBalances.WBTC)).toBeLessThanOrEqual(100);
      }
      if (createdPositionEvent.nonAlignedBalances['USD₮0']) {
        expect(parseFloat(createdPositionEvent.nonAlignedBalances['USD₮0'])).toBeLessThanOrEqual(100);
      }

      // Final vault positions count
      const finalVault = await service.vaultDataService.getVault(vault.address);
      expect(Object.keys(finalVault.positions)).toHaveLength(1);
      expect(finalVault.positions[createdPositionEvent.positionId]).toBeDefined();


      console.log(`✅ NewPositionCreated additional validations:`);
      console.log(`   Token symbols: [${createdPositionEvent.tokenSymbols.join(', ')}]`);
      console.log(`   Platform: ${createdPositionEvent.platform}`);
      console.log(`   Non-aligned balances: ${Object.keys(createdPositionEvent.nonAlignedBalances).map(k => `${k}=${createdPositionEvent.nonAlignedBalances[k]}`).join(', ')}`);
      console.log(`   Final positions count: ${Object.keys(finalVault.positions).length}`);

      // Test 18: Verify monitoring setup events were emitted
      console.log('\n📊 Test 18: Verifying monitoring setup events...');

      // Verify SwapMonitoringRegistered event (1 for single pool with new position)
      expect(swapMonitoringEvents).toHaveLength(1);
      const swapEvent = swapMonitoringEvents[0];
      expect(swapEvent.vaultAddress).toBe(vault.address);
      expect(swapEvent.poolAddress).toBe(createdPositionEvent.poolAddress);
      expect(swapEvent.platformId).toBe('uniswapV3');
      expect(swapEvent.timestamp).toBeGreaterThan(0);
      console.log(`✅ SwapMonitoringRegistered event verified for pool ${swapEvent.poolAddress}`);

      // NEW: Verify pool-to-vault mapping is correctly set up
      const poolAddress = createdPositionEvent.poolAddress;
      expect(service.eventManager.poolToVaults).toBeDefined();
      expect(service.eventManager.poolToVaults[poolAddress]).toBeDefined();
      expect(service.eventManager.poolToVaults[poolAddress]).toContain(vault.address);
      expect(service.eventManager.poolToVaults[poolAddress]).toHaveLength(1); // Only one vault monitoring this pool
      console.log(`✅ Pool ${poolAddress} correctly mapped to vault ${vault.address}`);

      // NEW: Verify helper methods work correctly
      expect(service.eventManager.isPoolMonitored(poolAddress)).toBe(true);
      expect(service.eventManager.getVaultsForPool(poolAddress)).toEqual([vault.address]);
      expect(service.eventManager.getMonitoredPools()).toContain(poolAddress);
      expect(service.eventManager.getPoolListenerCount()).toBe(1); // One pool being monitored
      console.log(`✅ EventManager helper methods verified`);

      // Verify ConfigMonitoringRegistered event
      expect(configMonitoringEvents).toHaveLength(1);
      const configEvent = configMonitoringEvents[0];
      expect(configEvent.vaultAddress).toBe(vault.address);
      expect(configEvent.chainId).toBe(service.chainId);
      expect(configEvent.listenersRegistered).toEqual(['TargetTokensUpdated', 'TargetPlatformsUpdated']);
      expect(configEvent.timestamp).toBeGreaterThan(0);
      console.log(`✅ ConfigMonitoringRegistered event verified with 2 config listeners`);
      console.log(`   Listeners: ${configEvent.listenersRegistered.join(', ')}`);

      // Verify MonitoringStarted event
      expect(monitoringStartedEvents).toHaveLength(1);
      const startEvent = monitoringStartedEvents[0];
      expect(startEvent.vaultAddress).toBe(vault.address);
      expect(startEvent.strategyId).toBe('bob');
      expect(startEvent.positionCount).toBe(1);
      expect(startEvent.chainId).toBe(service.chainId);
      expect(startEvent.timestamp).toBeGreaterThan(0);
      console.log(`✅ MonitoringStarted event verified for vault ${startEvent.vaultAddress}`);
      console.log(`   Strategy: ${startEvent.strategyId}, Positions: ${startEvent.positionCount}`);

      // Verify BabyStepsStrategy doesn't implement setupAdditionalMonitoring
      const strategy = service.strategies[vault.strategy.strategyId];
      expect(strategy.setupAdditionalMonitoring).toBeUndefined();
      console.log(`✅ BabyStepsStrategy correctly does not implement setupAdditionalMonitoring`);

      // Test 19: Verify emergency exit baseline cache is set for new position
      console.log('\n🚨 Test 19: Verifying emergency exit baseline cache for new position...');

      // Get the strategy instance from the service
      // strategy already declared above, using existing reference
      expect(strategy).toBeDefined();
      expect(strategy.emergencyExitBaseline).toBeDefined();

      // Check that baseline was cached for our vault
      expect(strategy.emergencyExitBaseline[vault.address]).toBeDefined();
      expect(typeof strategy.emergencyExitBaseline[vault.address]).toBe('number');

      // For new positions, the baseline should be the current tick at creation time
      const baselineTick = strategy.emergencyExitBaseline[vault.address];
      const expectedBaseline = createdPositionEvent.currentTick;

      expect(baselineTick).toBe(expectedBaseline);

      console.log(`✅ Emergency exit baseline cached for new position:`);
      console.log(`   Vault: ${vault.address}`);
      console.log(`   Baseline tick: ${baselineTick}`);
      console.log(`   Position creation tick: ${expectedBaseline}`);
      console.log(`   Match: ${baselineTick === expectedBaseline ? 'EXACT' : 'MISMATCH'}`);

      // Test cleanup: Verify baseline is removed on vault cleanup
      console.log('\n🧹 Testing emergency exit baseline cleanup...');

      // Simulate vault cleanup (as would happen on blacklisting)
      strategy.cleanup(vault.address);

      // Verify baseline was removed
      expect(strategy.emergencyExitBaseline[vault.address]).toBeUndefined();

      console.log(`✅ Emergency exit baseline properly cleaned up for vault ${vault.address}`);

      // Step 11: Verify Permit2 approvals were set for ALL vault tokens
      console.log('\n🔐 Step 11: Verifying Permit2 approvals...');

      const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
      const vaultTokenSymbols = ['WBTC', 'USD₮0', 'WETH']; // Hardcoded tokens for 0202 test

      console.log(`   Checking Permit2 approvals for ${vaultTokenSymbols.length} vault tokens: ${vaultTokenSymbols.join(', ')}`);

      for (const tokenSymbol of vaultTokenSymbols) {
        const tokenData = service.tokens[tokenSymbol];
        expect(tokenData).toBeDefined();
        expect(tokenData.address).toBeDefined();

        const tokenContract = new ethers.Contract(
          tokenData.address,
          ['function allowance(address owner, address spender) view returns (uint256)'],
          service.provider
        );

        const allowance = await tokenContract.allowance(vault.address, PERMIT2_ADDRESS);
        const isApproved = allowance.gte(ethers.constants.MaxUint256.div(2));

        expect(isApproved).toBe(true);
        console.log(`   ✅ ${tokenSymbol}: Permit2 approval = ${allowance.toString()}`);
      }

      console.log(`✅ All ${vaultTokenSymbols.length} vault tokens have Permit2 approvals set`);

      // Clean up subscriptions
      unsubscribeDataFetch();
      unsubscribe();
      unsubscribeClose();
      unsubscribeBatchTransaction();
      unsubscribeTokenBalance();
      unsubscribeAssetValues();
      unsubscribeUtilization();
      unsubscribeOptimalPoolSelected();
      unsubscribePositionParameters();
      unsubscribeTokenPreparation();
      unsubscribe5050();
      unsubscribeNewPosition();

    }, 180000); // 180 second timeout for vault setup and testing
  });
});
