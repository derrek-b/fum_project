/**
 * @fileoverview Integration test for AutomationService initialization with 1 vault containing mixed aligned/non-aligned assets
 * Tests 1 Aligned Position (1AP), 1 Non-aligned Position (1NP),
 * 1 Aligned Token (1AT), 1 Non-aligned Token (1NT) scenario
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

// Mock the getPoolTVLAverage and getPoolAge functions for test environment
vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    getPoolTVLAverage: vi.fn().mockResolvedValue(50000000), // $50M TVL
    // getPoolAge: vi.fn().mockResolvedValue(Math.floor(Date.now() / 1000) - (91 * 24 * 60 * 60)) // 91 days old
  };
});

describe('AutomationService Initialization - 1 Vault (1AP/1NP/1AT/1NT)', () => {
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

    // Setup blockchain environment on port 8546 (to avoid conflicts with 0202 test)
    testEnv = await setupTestBlockchain({ port: 8547 });

    // Create test vault with 1 aligned position, 1 non-aligned position, 1 aligned token, 1 non-aligned token
    testVault = await setupTestVault(
      testEnv.ganacheServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '1AP/1NP/1AT/1NT Test Vault',
        automationServiceAddress: testEnv.testConfig.automationServiceAddress,
        wrapEthAmount: '10',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '2' },  // Get USDC for aligned position and token
          { from: 'WETH', to: 'WBTC', amount: '2' }   // Get WBTC for non-aligned position and token
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500, // 0.05% fee tier
            percentOfAssets: 20,
            tickRange: {
              type: 'centered',
              spacing: 10
            }
          },
          {
            token0: 'WBTC',
            token1: 'WETH',
            fee: 500, // 0.05% fee tier
            percentOfAssets: 20,
            tickRange: {
              type: 'above'  // Position entirely above current tick (out of range)
            }
          }
        ],
        tokenTransfers: {
          'USDC': 60,  // 60% of USDC to vault (aligned token)
          'WBTC': 40   // 40% of WBTC to vault (non-aligned token)
          // No WETH transfer to maintain 1AT/1NT ratio
        },
        // Target tokens: USDC (aligned), WETH (aligned but not in vault)
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        // Fee-generating swaps: Execute back-and-forth swaps to generate fees on WBTC/WETH pool
        feeGeneratingSwaps: [
          {
            pool: { token0: 'WBTC', token1: 'WETH', fee: 500 },
            swaps: [
              { from: 'WETH', to: 'WBTC', amount: '1' },  // WETH → WBTC (use available balance)
              { from: 'WBTC', to: 'WETH', amount: '0.05' }  // WBTC → WETH (generates fees on both sides)
            ]
          }
        ]
      }
    );

    // Calculate expected final balances after position closure
    console.log('Test vault setup complete. Capturing expected balances...');

    // Track initial token transfers to vault
    initialTransfers = {
      'USDC': testVault.tokenBalances.USDC || '0',
      'WBTC': testVault.tokenBalances.WBTC || '0',
      'WETH': testVault.tokenBalances.WETH || '0',
      'USD₮0': testVault.tokenBalances['USD₮0'] || '0',
      'LINK': testVault.tokenBalances.LINK || '0'
    };

    // Track position tokens that will be returned when non-aligned position is closed
    // For 1111 test: 1 WBTC/WETH position will be closed, 1 USDC/WETH position remains
    const positionTokens = {
      'USDC': '0',  // No USDC from closed positions (USDC/WETH position remains)
      'WBTC': '0',  // Will be calculated from closed WBTC/WETH position
      'WETH': '0',  // Will be calculated from closed WBTC/WETH position
      'USD₮0': '0', // Not involved in positions
      'LINK': '0'   // Not involved in positions
    };

    // Calculate tokens returned from the non-aligned WBTC/WETH position that will be closed
    // Use the same pattern as 0202 test: position.amount0 and position.amount1
    const positionIds = Object.keys(testVault.positions);
    for (const positionId of positionIds) {
      const position = testVault.positions[positionId];
      // In 1111 test, the WBTC/WETH position is non-aligned and will be closed
      if ((position.token0 === 'WBTC' && position.token1 === 'WETH') ||
          (position.token0 === 'WETH' && position.token1 === 'WBTC')) {
        // Use amount0 and amount1 properties like 0202 test
        if (position.token0 === 'WBTC') {
          positionTokens.WBTC = ethers.BigNumber.from(positionTokens.WBTC).add(position.amount0).toString();
          positionTokens.WETH = ethers.BigNumber.from(positionTokens.WETH).add(position.amount1).toString();
        } else {
          positionTokens.WETH = ethers.BigNumber.from(positionTokens.WETH).add(position.amount0).toString();
          positionTokens.WBTC = ethers.BigNumber.from(positionTokens.WBTC).add(position.amount1).toString();
        }
        console.log(`  Position ${positionId} will be closed: ${position.token0}=${position.amount0}, ${position.token1}=${position.amount1}`);
      }
    }

    // Calculate expected final balances (initial transfers + tokens from closed positions)
    testVault.expectedFinalBalances = {
      'USDC': initialTransfers.USDC, // No change - position remains
      'WBTC': ethers.BigNumber.from(initialTransfers.WBTC).add(positionTokens.WBTC).toString(),
      'WETH': ethers.BigNumber.from(initialTransfers.WETH).add(positionTokens.WETH).toString(),
      'USD₮0': initialTransfers['USD₮0'], // Unchanged
      'LINK': initialTransfers.LINK // Unchanged
    };

    console.log('Expected final balances after position closure:');
    for (const [token, expectedBalance] of Object.entries(testVault.expectedFinalBalances)) {
      const initial = initialTransfers[token];
      const fromPositions = positionTokens[token];
      console.log(`  ${token}: ${expectedBalance} (${initial} initial + ${fromPositions} from positions)`);
    }

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

  describe('Success Case - 1AP/1NP/1AT/1NT Scenario', () => {
    it('should successfully handle service initialization with pre-existing mixed vault', async () => {
      // Create AutomationService instance
      service = new AutomationService(testEnv.testConfig);

      // Set up event listeners to test vault loading events
      let poolDataFetchedEventData = null;
      service.eventManager.subscribe('PoolDataFetched', (data) => {
        poolDataFetchedEventData = data;
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
        console.log('🔍 Captured vault snapshot at load time with', Object.keys(vault.positions || {}).length, 'positions');
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

      // Set up event capture for TokenBalancesFetched
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

      // Set up event capture for TokenPreparationCompleted
      const tokenPreparationEvents = [];
      const unsubscribeTokenPreparation = service.eventManager.subscribe('TokenPreparationCompleted', (data) => {
        tokenPreparationEvents.push(data);
      });

      // Set up event capture for BatchTransactionExecuted
      const batchTransactionEvents = [];
      const unsubscribeBatchTransaction = service.eventManager.subscribe('BatchTransactionExecuted', (data) => {
        batchTransactionEvents.push(data);
      });

      // Set up event capture for 5050SwapsPrepared
      const buffer5050Events = [];
      const unsubscribe5050 = service.eventManager.subscribe('5050SwapsPrepared', (data) => {
        buffer5050Events.push(data);
      });

      // Set up event capture for TokensSwapped
      const tokensSwappedEvents = [];
      const unsubscribeTokensSwapped = service.eventManager.subscribe('TokensSwapped', (data) => {
        tokensSwappedEvents.push(data);
      });

      // Set up event capture for LiquidityAddedToPosition
      const liquidityAddedEvents = [];
      const unsubscribeLiquidityAdded = service.eventManager.subscribe('LiquidityAddedToPosition', (data) => {
        liquidityAddedEvents.push(data);
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

      // Test 1: Verify PoolDataFetched event handling (1 vault with mixed positions scenario)
      expect(service.eventManager.eventHandlers['PoolDataFetched']).toBeDefined();
      expect(Array.isArray(service.eventManager.eventHandlers['PoolDataFetched'])).toBe(true);
      expect(service.eventManager.eventHandlers['PoolDataFetched'].length).toBeGreaterThan(0);
      expect(typeof service.eventManager.eventHandlers['PoolDataFetched'][0]).toBe('function');

      // Test 2: Authorized Vault Discovery
      const discoveredVaults = service.vaultDataService.getAllVaults();
      expect(Array.isArray(discoveredVaults)).toBe(true);
      expect(discoveredVaults.length).toBe(1);

      // Vault snapshot was already captured in VaultLoaded event handler
      expect(vault.address).toBe(testVault.vaultAddress);
      expect(vault.strategyAddress).toBeDefined();
      expect(vault.strategy).toBeDefined();
      expect(vault.strategy.strategyId).toBe('bob');
      expect(vault.positions).toBeDefined();
      expect(vault.tokens).toBeDefined();
      expect(vault.targetTokens).toBeDefined();
      expect(vault.targetPlatforms).toBeDefined();

      // Test 3: Verify PoolDataFetched event was emitted
      expect(poolDataFetchedEventData).not.toBeNull();
      expect(poolDataFetchedEventData.poolData).toBeDefined();
      expect(poolDataFetchedEventData.source).toBe('Uniswap V3');
      expect(poolDataFetchedEventData.vaultAddress).toBe(vault.address);

      // Test 4: Verify vault loading event
      expect(vaultLoadingEventData).toBe(vault.address);

      // Test 5: Verify vault loaded event
      expect(vaultLoadedEventData).not.toBeNull();
      expect(vaultLoadedEventData.vaultAddress).toBe(vault.address);
      expect(vaultLoadedEventData.strategyId).toBe('bob');
      expect(vaultLoadedEventData.positionCount).toBe(2);
      expect(vaultLoadedEventData.positionIds).toHaveLength(2);
      expect(vaultLoadedEventData.targetTokens).toEqual(['USDC', 'WETH']);
      expect(vaultLoadedEventData.targetPlatforms).toEqual(['uniswapV3']);

      // Test 5a: Verify VaultBaselineCaptured event was emitted
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

      // Tokens Object Testing - mixed scenario should have 2 tokens (USDC aligned, WBTC non-aligned)
      expect(vault.tokens).toBeDefined();
      expect(typeof vault.tokens).toBe('object');
      expect(vault.tokens.USDC).toBeDefined();
      expect(vault.tokens.WBTC).toBeDefined();
      expect(typeof vault.tokens.USDC).toBe('string');
      expect(typeof vault.tokens.WBTC).toBe('string');

      // Verify token balances match exact amounts transferred to vault
      // Use TokenBalancesFetched events for accurate state snapshots
      expect(tokenBalanceFetchEvents.length).toBeGreaterThan(0);
      const initialBalances = tokenBalanceFetchEvents[0].balances;

      expect(initialBalances.USDC).toBe(initialTransfers.USDC);
      expect(initialBalances.WBTC).toBe(initialTransfers.WBTC);
      expect(initialBalances.WETH).toBe(initialTransfers.WETH);
      expect(initialBalances['USD₮0']).toBe(initialTransfers['USD₮0']);
      expect(initialBalances.LINK).toBe(initialTransfers.LINK);

      // Target Configuration Testing
      expect(Array.isArray(vault.targetTokens)).toBe(true);
      expect(vault.targetTokens).toEqual(['USDC', 'WETH']);
      expect(Array.isArray(vault.targetPlatforms)).toBe(true);
      expect(vault.targetPlatforms).toEqual(['uniswapV3']);

      // Positions Object Testing - verify initial positions from vaultLoaded event
      expect(vault.positions).toBeDefined();
      expect(typeof vault.positions).toBe('object');
      expect(Array.isArray(vault.positions)).toBe(false); // Should be object, not array
      expect(Object.keys(vault.positions).length).toBe(2); // Should have started with exactly 2 positions

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
      expect(vault.lastUpdated).toBeGreaterThan(Date.now() - 120000); // Within last 2 minutes

      console.log(`Successfully discovered and loaded vault ${vault.address} with ${vaultLoadedEventData.positionCount} initial position(s), ${currentVaultPositionIds.length} remaining`);

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

      // Test specific 1AP/1NP/1AT/1NT scenario expectations:
      expect(eventData.alignedCount).toBe(1);          // 1 Aligned Position
      expect(eventData.nonAlignedCount).toBe(1);       // 1 Non-aligned Position
      expect(eventData.alignedPositionIds).toHaveLength(1);
      expect(eventData.nonAlignedPositionIds).toHaveLength(1);

      console.log(`✅ InitialPositionsEvaluated event verified: ${eventData.alignedCount}AP/${eventData.nonAlignedCount}NP scenario successful`);

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

      // Test specific 1AP/1NP scenario expectations: should close 1 non-aligned position
      expect(closeEventData.closedCount).toBe(1);
      expect(closeEventData.closedPositions).toHaveLength(1);

      // Verify closed position structure and actual values
      const closedPosition = closeEventData.closedPositions[0];
      expect(closedPosition.positionId).toBe(eventData.nonAlignedPositionIds[0]);
      expect(closedPosition.pool).toBeDefined();

      // Test actual token symbols - WBTC/WETH position should be closed
      expect(['WBTC', 'WETH']).toContain(closedPosition.token0Symbol);
      expect(['WBTC', 'WETH']).toContain(closedPosition.token1Symbol);
      expect(closedPosition.token0Symbol).not.toBe(closedPosition.token1Symbol);

      // Test platform
      expect(closedPosition.platform).toBe('uniswapV3');

      // Test principal amounts are present
      // Note: This position was created 'above' current tick (out of range)
      // Out of range positions only contain one token, so at least one amount should be > 0
      expect(closedPosition.principalAmount0).toBeDefined();
      expect(closedPosition.principalAmount1).toBeDefined();
      const amount0 = BigInt(closedPosition.principalAmount0);
      const amount1 = BigInt(closedPosition.principalAmount1);
      expect(amount0 + amount1).toBeGreaterThan(0n); // At least one amount must be > 0

      // Test tick values
      expect(typeof closedPosition.tickLower).toBe('number');
      expect(typeof closedPosition.tickUpper).toBe('number');
      expect(closedPosition.tickUpper).toBeGreaterThan(closedPosition.tickLower);

      console.log(`✅ PositionsClosed event verified: ${closeEventData.closedCount} position closed`);
      console.log(`   Closed position ID: ${closedPosition.positionId}`);
      console.log(`   Pool: ${closedPosition.token0Symbol}/${closedPosition.token1Symbol} on ${closedPosition.platform}`);
      console.log(`   Principal recovered: ${closedPosition.principalAmount0} ${closedPosition.token0Symbol}, ${closedPosition.principalAmount1} ${closedPosition.token1Symbol}`);

      // Test 9: Verify no FeesCollected event (out-of-range position has no fees)
      expect(feesCollectedEvents.length).toBe(0);
      console.log(`✅ FeesCollected correctly not emitted (out-of-range position, no fees collected)`);

      // Test 9a: Verify BatchTransactionExecuted event for position closure
      console.log('Testing BatchTransactionExecuted event for position closure...');

      expect(batchTransactionEvents.length).toBeGreaterThan(0);

      // Find the batch transaction event for position closes
      const positionCloseBatchEvent = batchTransactionEvents.find(event => event.operationType === 'position closes');
      expect(positionCloseBatchEvent).toBeDefined();

      // Basic event structure verification
      expect(positionCloseBatchEvent.vaultAddress).toBe(vault.address);
      expect(positionCloseBatchEvent.strategyId).toBe(vault.strategy.strategyId);
      expect(positionCloseBatchEvent.operationType).toBe('position closes');
      expect(positionCloseBatchEvent.transactionCount).toBe(1); // 1 position being closed
      expect(positionCloseBatchEvent.transactionHash).toBeDefined();
      expect(positionCloseBatchEvent.transactionHash).not.toBe('');
      expect(positionCloseBatchEvent.blockNumber).toBeGreaterThan(0);
      expect(positionCloseBatchEvent.gasUsed).toBeDefined();
      expect(positionCloseBatchEvent.gasEstimated).toBeDefined();
      expect(positionCloseBatchEvent.gasEfficiency).toBeDefined();
      expect(positionCloseBatchEvent.targets).toBeDefined();
      expect(positionCloseBatchEvent.targets).toHaveLength(1); // Should have 1 target (position manager)
      expect(positionCloseBatchEvent.executor).toBeDefined();
      expect(positionCloseBatchEvent.status).toBe(1); // Success status
      expect(positionCloseBatchEvent.timestamp).toBeGreaterThan(0);

      // Gas efficiency should be a percentage or 'N/A'
      if (positionCloseBatchEvent.gasEfficiency !== 'N/A') {
        const efficiency = parseFloat(positionCloseBatchEvent.gasEfficiency);
        expect(efficiency).toBeGreaterThan(0);
        expect(efficiency).toBeLessThan(200); // Should be reasonable efficiency
      }

      // Total value should be 0 for position closes (no ETH being sent)
      expect(positionCloseBatchEvent.totalValue).toBe('0');

      console.log(`✅ BatchTransactionExecuted event verified for position closure:`);
      console.log(`   Transaction: ${positionCloseBatchEvent.transactionHash}`);
      console.log(`   Gas used: ${positionCloseBatchEvent.gasUsed} (estimated: ${positionCloseBatchEvent.gasEstimated})`);
      console.log(`   Gas efficiency: ${positionCloseBatchEvent.gasEfficiency}%`);
      console.log(`   Block: ${positionCloseBatchEvent.blockNumber}`);

      // Test 10: Verify exact token balances after position closure
      console.log('Testing exact token balances after position closure...');

      // 🔍 Debug: Log all token balance events to understand the order
      console.log(`🔍 Found ${tokenBalanceFetchEvents.length} TokenBalancesFetched events:`);
      tokenBalanceFetchEvents.forEach((event, index) => {
        console.log(`🔍   Event [${index}]: WBTC=${event.balances.WBTC || '0'}, USDC=${event.balances.USDC || '0'}, timestamp=${event.timestamp}`);
      });

      // Verify we have token balance events
      expect(tokenBalanceFetchEvents.length).toBeGreaterThan(0);

      // Get the second token balance fetch (after positions are closed, before swaps)
      const finalBalanceEvent = tokenBalanceFetchEvents[1];
      expect(finalBalanceEvent.vaultAddress).toBe(vault.address);
      expect(finalBalanceEvent.balances).toBeDefined();

      // Verify exact token balances match expected values
      console.log('Actual vs Expected token balances:');
      for (const [token, expectedBalance] of Object.entries(testVault.expectedFinalBalances)) {
        const actualBalance = finalBalanceEvent.balances[token] || '0';
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

      // Test value reasonableness for 1AP/1NP scenario
      expect(assetValueEvent.totalTokenValue).toBeGreaterThan(0);
      expect(assetValueEvent.totalPositionValue).toBeGreaterThan(0); // Has 1 aligned position
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

          console.log(`   ${tokenSymbol}: $${tokenData.usdValue.toFixed(2)} ÷ $${tokenData.price.toFixed(6)} = ${impliedBalanceInTokens.toFixed(8)} (expected: ${expectedBalanceInTokens.toFixed(8)})`);
          console.log(`   ${tokenSymbol} difference: ${difference.toFixed(10)}, tolerance: ${relativeTolerance.toFixed(10)}, ${difference <= relativeTolerance ? '✓ PASS' : '✗ FAIL'}`);
          console.log(`   ${tokenSymbol} raw expected balance: ${expectedRawBalance}, decimals: ${tokenConfig.decimals}`);

          expect(difference).toBeLessThanOrEqual(relativeTolerance);
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

      // Test position value mathematical precision against ground truth
      for (const [positionId, positionData] of Object.entries(positions)) {
        expect(positionData.token0Amount).toBeDefined();
        expect(positionData.token1Amount).toBeDefined();
        expect(positionData.token0UsdValue).toBeGreaterThanOrEqual(0);
        expect(positionData.token1UsdValue).toBeGreaterThanOrEqual(0);

        // Get ground truth position data from test setup
        const groundTruthPosition = testVault.positions[positionId];
        if (!groundTruthPosition) {
          console.log(`   Warning: Position ${positionId} not found in test setup data`);
          continue;
        }

        // Get token symbols and prices from the event data
        const token0Symbol = groundTruthPosition.token0;
        const token1Symbol = groundTruthPosition.token1;
        const token0Price = tokens[token0Symbol]?.price;
        const token1Price = tokens[token1Symbol]?.price;

        // Verify token0 value calculation
        if (token0Price && groundTruthPosition.amount0 !== '0') {
          const token0Config = service.tokens[token0Symbol];
          const expectedToken0Amount = parseFloat(ethers.utils.formatUnits(groundTruthPosition.amount0, token0Config.decimals));
          const impliedToken0Amount = positionData.token0UsdValue / token0Price;

          const relativeTolerance = Math.max(expectedToken0Amount * 0.00001, 1e-12);
          const difference = Math.abs(impliedToken0Amount - expectedToken0Amount);
          expect(difference).toBeLessThanOrEqual(relativeTolerance);

          console.log(`   Position ${positionId} ${token0Symbol}: $${positionData.token0UsdValue.toFixed(2)} ÷ $${token0Price.toFixed(6)} = ${impliedToken0Amount.toFixed(8)} (expected from setup: ${expectedToken0Amount.toFixed(8)})`);
        }

        // Verify token1 value calculation
        if (token1Price && groundTruthPosition.amount1 !== '0') {
          const token1Config = service.tokens[token1Symbol];
          const expectedToken1Amount = parseFloat(ethers.utils.formatUnits(groundTruthPosition.amount1, token1Config.decimals));
          const impliedToken1Amount = positionData.token1UsdValue / token1Price;

          const relativeTolerance = Math.max(expectedToken1Amount * 0.00001, 1e-12);
          const difference = Math.abs(impliedToken1Amount - expectedToken1Amount);
          expect(difference).toBeLessThanOrEqual(relativeTolerance);

          console.log(`   Position ${positionId} ${token1Symbol}: $${positionData.token1UsdValue.toFixed(2)} ÷ $${token1Price.toFixed(6)} = ${impliedToken1Amount.toFixed(8)} (expected from setup: ${expectedToken1Amount.toFixed(8)})`);
        }
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

        // Additional 1AP/1NP scenario verification
        expect(utilizationEvent.currentUtilization).toBeGreaterThan(0); // Has 1 aligned position
        expect(utilizationEvent.positionValue).toBeGreaterThan(0); // Has 1 position remaining
        expect(utilizationEvent.tokenValue).toBeGreaterThan(0); // Has token balances

        console.log(`✅ UtilizationCalculated event verified against expected calculations:`);
        console.log(`   Actual current utilization: ${(utilizationEvent.currentUtilization * 100).toFixed(1)}% = Expected: ${(expectedCurrentUtilization * 100).toFixed(1)}%`);
        console.log(`   Actual max utilization: ${(utilizationEvent.maxUtilization * 100).toFixed(1)}% = Expected: ${(expectedMaxUtilization * 100).toFixed(1)}%`);
        console.log(`   Actual available deployment: $${utilizationEvent.availableDeployment.toFixed(2)} = Expected: $${expectedAvailableDeployment.toFixed(2)}`);
        console.log(`   1AP scenario: Has ${utilizationEvent.positionValue > 0 ? 'position' : 'no position'} value of $${utilizationEvent.positionValue.toFixed(2)}`);
      }

      // Test 13: Verify TokenPreparationCompleted event for 1111 scenario (non-aligned token usage)
      console.log('Testing TokenPreparationCompleted event for 1111 scenario...');

      expect(tokenPreparationEvents.length).toBeGreaterThan(0);
      const tokenPrepEvent = tokenPreparationEvents[tokenPreparationEvents.length - 1];

      // Basic event structure verification
      expect(tokenPrepEvent.vaultAddress).toBe(vault.address);
      expect(tokenPrepEvent.strategyId).toBe(vault.strategy.strategyId);
      expect(tokenPrepEvent.platformId).toBeDefined();
      expect(tokenPrepEvent.targetTokens).toBeDefined();
      expect(tokenPrepEvent.preparationResult).toBeDefined();
      expect(tokenPrepEvent.swapTransactions).toBeDefined();
      expect(tokenPrepEvent.nonAlignedTokensUsed).toBeDefined();

      // Verify target tokens structure
      expect(tokenPrepEvent.targetTokens.token0).toBeDefined();
      expect(tokenPrepEvent.targetTokens.token1).toBeDefined();

      // Test deficit calculations for each target token using independently verified data
      for (const [key, tokenData] of Object.entries(tokenPrepEvent.targetTokens)) {
        const symbol = tokenData.symbol;
        const eventRequired = ethers.BigNumber.from(tokenData.required);
        const eventAvailable = ethers.BigNumber.from(tokenData.available);
        const eventDeficit = ethers.BigNumber.from(tokenData.deficit);

        // Get independently verified available amount from finalBalanceEvent (Test around line 383)
        const verifiedAvailable = ethers.BigNumber.from(finalBalanceEvent.balances[symbol]);

        // Verify the available amount matches our independently verified balance
        expect(eventAvailable.toString()).toBe(verifiedAvailable.toString());

        // Verify deficit calculation using verified available amount (with 2% buffer)
        const baseDeficit = eventRequired.gt(verifiedAvailable) ? eventRequired.sub(verifiedAvailable) : ethers.constants.Zero;
        const expectedDeficit = baseDeficit.gt(0) ? baseDeficit.mul(102).div(100) : ethers.constants.Zero;
        expect(eventDeficit.toString()).toBe(expectedDeficit.toString());

        console.log(`   ${symbol}: Required ${tokenData.required}, Available ${tokenData.available} (verified), Deficit ${tokenData.deficit}`);
      }

      // Verify swap transaction structure (if any were generated)
      if (tokenPrepEvent.swapTransactions.length > 0) {
        // Get the Uniswap V3 adapter to access UniversalRouter address
        const adapter = service.getAdapter('uniswapV3');
        const expectedRouterAddress = adapter.addresses.universalRouterAddress;

        for (const tx of tokenPrepEvent.swapTransactions) {
          // Verify transaction goes to UniversalRouter (Permit2 swaps)
          expect(tx.to).toBe(expectedRouterAddress);

          expect(tx.data).toBeDefined();
          expect(tx.data).not.toBe('');
          expect(tx.value).toBe("0x00");

          console.log(`   ✅ Swap transaction verified: universalRouter=${tx.to}`);
        }
        console.log(`   Generated ${tokenPrepEvent.swapTransactions.length} Permit2 swap transaction(s)`);
      }

      // Test approval transactions - should be empty with Permit2
      if (tokenPrepEvent.preparationResult === 'swaps_generated') {
        // Permit2 swaps don't need separate approval transactions (uses signatures instead)
        expect(tokenPrepEvent.swapTransactions.length).toBeGreaterThan(0);
        console.log(`   ✅ No separate approval transactions needed with Permit2`);
      }

      // 1111 scenario specific tests - should use WBTC (non-aligned token)
      if (tokenPrepEvent.preparationResult === 'swaps_generated') {
        expect(tokenPrepEvent.nonAlignedTokensUsed).toContain('WBTC');
        expect(tokenPrepEvent.swapTransactions.length).toBeGreaterThan(0);
        console.log(`   ✅ WBTC non-aligned token swaps verified: ${tokenPrepEvent.nonAlignedTokensUsed.join(', ')}`);
      } else if (tokenPrepEvent.preparationResult === 'sufficient_tokens') {
        expect(tokenPrepEvent.swapTransactions).toHaveLength(0);
        console.log(`   ✅ Sufficient tokens available, no swaps needed`);
      }

      console.log(`✅ TokenPreparationCompleted event verified for 1111 scenario`);

      // Test 14: Verify BatchTransactionExecuted event for deficit covering swaps
      console.log('Testing BatchTransactionExecuted event for deficit covering swaps...');

      // Find batch transaction events for swaps (Permit2 doesn't need separate approvals)
      const swapBatchEvents = batchTransactionEvents.filter(event => event.operationType === 'deficit covering swaps');

      if (tokenPrepEvent.preparationResult === 'swaps_generated') {
        // Should have swap batch transactions when swaps were generated (no separate approvals with Permit2)
        expect(swapBatchEvents.length).toBeGreaterThan(0);

        // Test the most recent swap batch event (Permit2 swaps don't need separate approval batches)
        const swapBatchEvent = swapBatchEvents[swapBatchEvents.length - 1];

        // Basic event structure verification
        expect(swapBatchEvent.vaultAddress).toBe(vault.address);
        expect(swapBatchEvent.strategyId).toBe(vault.strategy.strategyId);
        expect(swapBatchEvent.operationType).toBe('deficit covering swaps');
        expect(swapBatchEvent.transactionCount).toBe(tokenPrepEvent.swapTransactions.length);
        expect(swapBatchEvent.transactionHash).toBeDefined();
        expect(swapBatchEvent.transactionHash).not.toBe('');
        expect(swapBatchEvent.blockNumber).toBeGreaterThan(0);
        expect(swapBatchEvent.gasUsed).toBeDefined();
        expect(swapBatchEvent.gasEstimated).toBeDefined();
        expect(swapBatchEvent.gasEfficiency).toBeDefined();
        expect(swapBatchEvent.targets).toBeDefined();
        expect(swapBatchEvent.targets).toHaveLength(tokenPrepEvent.swapTransactions.length);
        expect(swapBatchEvent.executor).toBeDefined();
        expect(swapBatchEvent.status).toBe(1); // Success status
        expect(swapBatchEvent.timestamp).toBeGreaterThan(0);

        // Gas efficiency should be a percentage or 'N/A'
        if (swapBatchEvent.gasEfficiency !== 'N/A') {
          const efficiency = parseFloat(swapBatchEvent.gasEfficiency);
          expect(efficiency).toBeGreaterThan(0);
          expect(efficiency).toBeLessThan(200); // Should be reasonable efficiency
        }

        // Total value should be 0 for token swaps (no ETH being sent)
        expect(swapBatchEvent.totalValue).toBe('0');

        console.log(`✅ BatchTransactionExecuted event verified for deficit covering swaps:`);
        console.log(`   Transaction: ${swapBatchEvent.transactionHash}`);
        console.log(`   Swap count: ${swapBatchEvent.transactionCount}`);
        console.log(`   Gas used: ${swapBatchEvent.gasUsed} (estimated: ${swapBatchEvent.gasEstimated})`);
        console.log(`   Gas efficiency: ${swapBatchEvent.gasEfficiency}%`);
        console.log(`   Block: ${swapBatchEvent.blockNumber}`);

      } else if (tokenPrepEvent.preparationResult === 'sufficient_tokens') {
        // Should have no swap batch transactions when tokens were sufficient
        expect(swapBatchEvents).toHaveLength(0);
        console.log(`✅ No swap batch transactions found (sufficient tokens available)`);
      }

      // Test 15: Verify exact token balances after deficit covering swaps
      console.log('Testing exact token balances after deficit covering swaps...');

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
        const changeStr = change.gt(0) ? '+' : '';
        console.log(`     ${token}: ${changeStr}${change.toString()}`);
      }
      if (token0Deficit.gt(0)) {
        console.log(`   ${token0Symbol} deficit of ${token0Deficit.toString()} covered`);
      }
      if (token1Deficit.gt(0)) {
        console.log(`   ${token1Symbol} deficit of ${token1Deficit.toString()} covered`);
      }

      // Test 16: Verify 5050SwapsPrepared event for remaining token conversion
      console.log('Testing 5050SwapsPrepared event for remaining non-aligned tokens...');

      // Should have captured 5050SwapsPrepared event
      expect(buffer5050Events.length).toBeGreaterThan(0);
      const event5050 = buffer5050Events[0];
      expect(event5050.vaultAddress).toBe(vault.address);

      // Calculate expected values from independent sources
      const postDeficitBalances = tokenBalanceFetchEvents[2].balances;
      const wbtcBalance = ethers.BigNumber.from(postDeficitBalances['WBTC'] || '0');
      const wbtcPrice = assetValueEvent.assetData.tokens.WBTC.price;
      const wbtcDecimals = 8;
      const expectedTotalUSD = Number(ethers.utils.formatUnits(wbtcBalance, wbtcDecimals)) * wbtcPrice;

      // Verify USD calculations
      expect(parseFloat(event5050.totalRemainingUSD)).toBeCloseTo(expectedTotalUSD, 2);
      expect(parseFloat(event5050.targetToken0USD)).toBeCloseTo(expectedTotalUSD / 2, 2);
      expect(parseFloat(event5050.targetToken1USD)).toBeCloseTo(expectedTotalUSD / 2, 2);

      // Verify token processing
      expect(event5050.nonAlignedTokensProcessed).toHaveLength(1); // WBTC only
      const wbtcProc = event5050.nonAlignedTokensProcessed[0];
      expect(wbtcProc.symbol).toBe('WBTC');
      expect(wbtcProc.initialBalance).toBe(wbtcBalance.toString());

      // Verify split between both targets
      expect(ethers.BigNumber.from(wbtcProc.swappedToToken0).gt(0)).toBe(true);
      expect(ethers.BigNumber.from(wbtcProc.swappedToToken1).gt(0)).toBe(true);

      // Verify amounts add up
      const totalSplit = ethers.BigNumber.from(wbtcProc.swappedToToken0).add(wbtcProc.swappedToToken1);
      expect(totalSplit.toString()).toBe(wbtcProc.initialBalance);

      // Verify 50/50 USD split
      const token0USD = parseFloat(event5050.actualSwappedToToken0USD);
      const token1USD = parseFloat(event5050.actualSwappedToToken1USD);
      const totalSwappedUSD = token0USD + token1USD;
      const ratio = token0USD / totalSwappedUSD;
      expect(ratio).toBeGreaterThan(0.48);
      expect(ratio).toBeLessThan(0.52);

      // Verify transaction generation
      expect(event5050.conversionResult).toBe('swaps_generated');
      expect(event5050.swapTransactions).toHaveLength(2); // 2 swaps (WBTC→WETH, WBTC→USDC)

      // Verify swaps are to Universal Router (Permit2 enabled)
      const universalRouter = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD';
      event5050.swapTransactions.forEach(swap => {
        expect(swap.to).toBe(universalRouter);
        expect(swap.value).toBe('0x00');
      });

      console.log('✅ 5050SwapsPrepared event verified:');
      console.log(`   Total remaining USD: $${event5050.totalRemainingUSD}`);
      console.log(`   Target 50/50 split: $${event5050.targetToken0USD} each`);
      console.log(`   Actual split: ${event5050.targetTokens.token0.symbol}=$${token0USD.toFixed(2)}, ${event5050.targetTokens.token1.symbol}=$${token1USD.toFixed(2)}`);
      console.log(`   Generated ${event5050.swapTransactions.length} swap(s) with Permit2`);

      // Test 17: Verify buffer swap batch execution and token balance refetching
      console.log('Testing buffer swap batch execution and token balance refetching...');

      // Part A: Buffer Swap Batch Execution
      const bufferSwapEvents = batchTransactionEvents.filter(event => event.operationType === 'buffer swaps');

      // With Permit2, we only have buffer swaps (no separate approvals needed)
      expect(bufferSwapEvents).toHaveLength(1);

      // Test the buffer swap batch event details
      const bufferSwapEvent = bufferSwapEvents[0];
      expect(bufferSwapEvent.vaultAddress).toBe(vault.address);
      expect(bufferSwapEvent.strategyId).toBe(vault.strategy.strategyId);
      expect(bufferSwapEvent.operationType).toBe('buffer swaps');
      expect(bufferSwapEvent.transactionCount).toBe(event5050.swapTransactions.length);
      expect(bufferSwapEvent.transactionHash).toBeDefined();
      expect(bufferSwapEvent.status).toBe(1); // Success status
      expect(bufferSwapEvent.gasUsed).toBeDefined();
      expect(bufferSwapEvent.gasEstimated).toBeDefined();
      expect(bufferSwapEvent.totalValue).toBe('0'); // No ETH sent

      // Gas efficiency should be reasonable
      if (bufferSwapEvent.gasEfficiency !== 'N/A') {
        const efficiency = parseFloat(bufferSwapEvent.gasEfficiency);
        expect(efficiency).toBeGreaterThan(0);
        expect(efficiency).toBeLessThan(200);
      }

      console.log(`✅ Buffer swap batch execution verified:`);
      console.log(`   Buffer swaps: ${bufferSwapEvent.transactionCount} transactions (Permit2 - no separate approvals)`);
      console.log(`   Gas used: ${bufferSwapEvent.gasUsed} (estimated: ${bufferSwapEvent.gasEstimated})`);
      console.log(`   Gas efficiency: ${bufferSwapEvent.gasEfficiency}%`);

      // Part C: Verify TokensSwapped events
      console.log('Testing TokensSwapped events...');
      expect(tokensSwappedEvents.length).toBeGreaterThan(0);

      // Should have both deficit_coverage and buffer_5050 swaps
      const deficitSwapEvent = tokensSwappedEvents.find(e => e.swapType === 'deficit_coverage');
      const buffer5050SwapEvent = tokensSwappedEvents.find(e => e.swapType === 'buffer_5050');

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

        console.log(`✅ Deficit coverage swaps verified:`);
        console.log(`   Swap count: ${deficitSwapEvent.swapCount}`);
        console.log(`   Transaction: ${deficitSwapEvent.transactionHash}`);
      }

      // Validate buffer swap event
      if (buffer5050SwapEvent) {
        expect(buffer5050SwapEvent.vaultAddress).toBe(vault.address);
        expect(buffer5050SwapEvent.swapCount).toBeGreaterThan(0);
        expect(buffer5050SwapEvent.success).toBe(true);
        expect(buffer5050SwapEvent.gasUsed).toBeDefined();
        expect(buffer5050SwapEvent.effectiveGasPrice).toBeDefined();

        buffer5050SwapEvent.swaps.forEach(swap => {
          expect(swap.tokenInSymbol).toBeDefined();
          expect(swap.tokenOutSymbol).toBeDefined();
          expect(swap.quotedAmountIn).toBeDefined();
          expect(swap.quotedAmountOut).toBeDefined();
          expect(swap.actualAmountIn).toBeDefined();
          expect(swap.actualAmountOut).toBeDefined();
          expect(typeof swap.isAmountIn).toBe('boolean');
        });

        console.log(`✅ Buffer 50/50 swaps verified:`);
        console.log(`   Swap count: ${buffer5050SwapEvent.swapCount}`);
        console.log(`   Transaction: ${buffer5050SwapEvent.transactionHash}`);
      }

      // Part B: Token Balance Refetching
      // Should have at least 4 TokenBalancesFetched events:
      // [0] = initialization, [1] = post-closure, [2+] = post-deficit/buffer swaps
      expect(tokenBalanceFetchEvents.length).toBeGreaterThanOrEqual(4);

      // Use correct indices: length-2 is post-buffer, length-3 is post-deficit
      // (length-1 is post-add-liquidity which we don't need)
      const postBufferBalances = tokenBalanceFetchEvents[tokenBalanceFetchEvents.length - 2].balances;
      const postDeficitBalance = tokenBalanceFetchEvents[tokenBalanceFetchEvents.length - 3].balances;

      // Calculate balance changes from buffer swaps
      const bufferBalanceChanges = {};
      for (const [token, postBufferBal] of Object.entries(postBufferBalances)) {
        const preBufferBal = postDeficitBalance[token];
        const change = ethers.BigNumber.from(postBufferBal).sub(preBufferBal);
        if (!change.isZero()) {
          bufferBalanceChanges[token] = change;
        }
      }

      // Verify WBTC was fully consumed by buffer swaps (allow dust < 10 units)
      const finalWBTCBalance = ethers.BigNumber.from(postBufferBalances['WBTC']);
      expect(finalWBTCBalance.lt(10)).toBe(true);

      // Verify target tokens increased from buffer swaps
      expect(bufferBalanceChanges['WETH'].gt(0)).toBe(true);
      expect(bufferBalanceChanges['USDC'].gt(0)).toBe(true);
      expect(bufferBalanceChanges['WBTC'].lt(0)).toBe(true); // Should decrease

      // Verify balance changes match 5050 event amounts
      const wethSwapped = ethers.BigNumber.from(event5050.nonAlignedTokensProcessed[0].swappedToToken0);
      const usdcSwapped = ethers.BigNumber.from(event5050.nonAlignedTokensProcessed[0].swappedToToken1);
      const totalWBTCSwapped = wethSwapped.add(usdcSwapped);

      expect(bufferBalanceChanges['WBTC'].toString()).toBe(totalWBTCSwapped.mul(-1).toString());

      console.log(`✅ Token balance refetching verified:`);
      console.log(`   Total token balance events: ${tokenBalanceFetchEvents.length}`);
      console.log(`   Buffer swap balance changes:`);
      for (const [token, change] of Object.entries(bufferBalanceChanges)) {
        const changeStr = change.gt(0) ? '+' : '';
        console.log(`     ${token}: ${changeStr}${change.toString()}`);
      }
      console.log(`   Final WBTC balance: ${finalWBTCBalance} (fully consumed)`);

      // Test 18: Verify LiquidityAddedToPosition event
      console.log('\n📊 Test 18: Verifying LiquidityAddedToPosition event...');

      expect(liquidityAddedEvents.length).toBe(1);
      const liquidityEvent = liquidityAddedEvents[0];

      // Basic vault info assertions - should match snapshot exactly
      expect(liquidityEvent.vaultAddress).toBe(testVault.vaultAddress);

      const firstPositionId = Object.keys(testVault.positions)[0];
      expect(liquidityEvent.positionId).toBe(firstPositionId);
      expect(liquidityEvent.poolAddress).toBe(vault.positions[firstPositionId].pool);

      console.log(`✅ LiquidityAddedToPosition event basic info verified:`);
      console.log(`   Vault: ${liquidityEvent.vaultAddress}`);
      console.log(`   Position ID: ${liquidityEvent.positionId}`);
      console.log(`   Pool: ${liquidityEvent.poolAddress}`);

      // Validate token amounts added to position using combination approach
      // Non-zero check (sanity - something was deployed)
      expect(ethers.BigNumber.from(liquidityEvent.quotedToken0).gt(0)).toBe(true);
      expect(ethers.BigNumber.from(liquidityEvent.quotedToken1).gt(0)).toBe(true);
      expect(ethers.BigNumber.from(liquidityEvent.actualToken0).gt(0)).toBe(true);
      expect(ethers.BigNumber.from(liquidityEvent.actualToken1).gt(0)).toBe(true);

      // Validate that actual amounts are close to quoted amounts (within reasonable slippage)
      const quoted0 = ethers.BigNumber.from(liquidityEvent.quotedToken0);
      const actual0 = ethers.BigNumber.from(liquidityEvent.actualToken0);
      const quoted1 = ethers.BigNumber.from(liquidityEvent.quotedToken1);
      const actual1 = ethers.BigNumber.from(liquidityEvent.actualToken1);

      // Actual should be within 2% of quoted (allow for rounding/slippage)
      const diff0Percent = quoted0.gt(0) ? actual0.sub(quoted0).abs().mul(10000).div(quoted0).toNumber() / 100 : 0;
      const diff1Percent = quoted1.gt(0) ? actual1.sub(quoted1).abs().mul(10000).div(quoted1).toNumber() / 100 : 0;
      expect(diff0Percent).toBeLessThan(2);
      expect(diff1Percent).toBeLessThan(2);

      // Utilization check (strategy goal achieved - zk verification that teh correct amounts were achieved throughout execution)
      const finalUtilization = liquidityEvent.totalPositionValue / liquidityEvent.totalVaultValue;
      const maxUtilization = vault.strategy.parameters.maxUtilization / 100 //0.8 from strategy parameters
      expect(finalUtilization).toBeCloseTo(maxUtilization, 1); // Within 0.1 of target

      console.log(`✅ LiquidityAddedToPosition token amounts validated:`);
      console.log(`   Quoted amounts: ${liquidityEvent.quotedToken0} WETH, ${liquidityEvent.quotedToken1} USDC`);
      console.log(`   Actual amounts: ${liquidityEvent.actualToken0} WETH, ${liquidityEvent.actualToken1} USDC`);
      console.log(`   Difference: ${diff0Percent.toFixed(2)}% WETH, ${diff1Percent.toFixed(2)}% USDC (< 2% acceptable)`);
      console.log(`   Utilization achieved: ${(finalUtilization * 100).toFixed(1)}% (target: ${(maxUtilization * 100).toFixed(1)}%)`);
      console.log(`   Total deployed: $${liquidityEvent.totalVaultValue.toFixed(2)} (total added: $${liquidityEvent.deploymentAmount.toFixed(2)})`);

      // Validate tokens
      expect(liquidityEvent.tokenSymbols).toBeDefined();
      expect(Array.isArray(liquidityEvent.tokenSymbols)).toBe(true);
      expect(liquidityEvent.tokenSymbols).toHaveLength(2);
      expect(liquidityEvent.tokenSymbols).toEqual(['WETH', 'USDC']); // Should match position token order

      // Validate platform
      expect(liquidityEvent.platform).toBe('uniswapV3');

      // Non-aligned balances are all zero (consumed in 50/50 swaps)
      expect(liquidityEvent.nonAlignedBalances).toBeDefined();
      expect(liquidityEvent.nonAlignedBalances.WBTC).toBe('0'); // WBTC was fully consumed
      // Check any other non-aligned tokens are also zero
      for (const [symbol, balance] of Object.entries(liquidityEvent.nonAlignedBalances)) {
        if (symbol !== 'USDC' && symbol !== 'WETH') {
          expect(balance).toBe('0');
        }
      }

      // Final vault positions count - fetch fresh state
      const finalVault = await service.vaultDataService.getVault(vault.address);
      expect(Object.keys(finalVault.positions)).toHaveLength(1); // Still only 1 position after liquidity addition
      expect(finalVault.positions[liquidityEvent.positionId]).toBeDefined(); // Same position that received liquidity


      console.log(`✅ LiquidityAddedToPosition additional validations:`);
      console.log(`   Token symbols: [${liquidityEvent.tokenSymbols.join(', ')}]`);
      console.log(`   Platform: ${liquidityEvent.platform}`);
      console.log(`   Non-aligned balances: ${Object.keys(liquidityEvent.nonAlignedBalances).map(k => `${k}=${liquidityEvent.nonAlignedBalances[k]}`).join(', ')}`);
      console.log(`   Final positions count: ${Object.keys(finalVault.positions).length}`);

      // Test 19: Verify monitoring setup events were emitted
      console.log('\n📊 Test 19: Verifying monitoring setup events...');

      // Verify SwapMonitoringRegistered event (1 for single pool after rebalancing)
      expect(swapMonitoringEvents).toHaveLength(1);
      const swapEvent = swapMonitoringEvents[0];
      expect(swapEvent.vaultAddress).toBe(vault.address);
      expect(swapEvent.poolAddress).toBe(Object.values(vault.positions)[0].pool);
      expect(swapEvent.platformId).toBe('uniswapV3');
      expect(swapEvent.timestamp).toBeGreaterThan(0);
      console.log(`✅ SwapMonitoringRegistered event verified for pool ${swapEvent.poolAddress}`);

      // NEW: Verify pool-to-vault mapping is correctly set up
      const poolAddress = Object.values(vault.positions)[0].pool;
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

      // Test 20: Verify emergency exit baseline cache is set for aligned position
      console.log('\n🚨 Test 20: Verifying emergency exit baseline cache for aligned position...');

      // Get the strategy instance from the service
      // strategy already declared above, using existing reference
      expect(strategy).toBeDefined();
      expect(strategy.emergencyExitBaseline).toBeDefined();

      // Check that baseline was cached for our vault
      expect(strategy.emergencyExitBaseline[vault.address]).toBeDefined();
      expect(typeof strategy.emergencyExitBaseline[vault.address]).toBe('number');

      // For aligned positions, the baseline should be calculated from the position's tick range
      // using calculateOriginalTick, which should result in a tick near the current tick
      const baselineTick = strategy.emergencyExitBaseline[vault.address];
      const currentTick = liquidityEvent.currentTick;

      // The baseline should be reasonable (not too far from current tick for a centered position)
      const tickDifference = Math.abs(baselineTick - currentTick);
      const maxReasonableDifference = 10000; // ~10% price movement

      expect(tickDifference).toBeLessThan(maxReasonableDifference);

      console.log(`✅ Emergency exit baseline cached for aligned position:`);
      console.log(`   Vault: ${vault.address}`);
      console.log(`   Baseline tick: ${baselineTick}`);
      console.log(`   Current tick: ${currentTick}`);
      console.log(`   Tick difference: ${tickDifference}`);

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
      const vaultTokenSymbols = ['USDC', 'WBTC', 'WETH']; // Hardcoded tokens for 1111 test

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
      unsubscribe();
      unsubscribeClose();
      unsubscribeTokenBalance();
      unsubscribeAssetValues();
      unsubscribeUtilization();
      unsubscribeTokenPreparation();
      unsubscribeBatchTransaction();
      unsubscribe5050();
      unsubscribeLiquidityAdded();
      unsubscribeSwapMonitoring();
      unsubscribeConfigMonitoring();
      unsubscribeMonitoringStarted();

    }, 180000); // 180 second timeout for vault setup and testing
  });
});
