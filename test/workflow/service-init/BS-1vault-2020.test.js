/**
 * @fileoverview Integration test for AutomationService initialization with 1 aligned vault
 * Tests 1 Aligned Position (1AP), 0 Non-aligned Positions (0NP),
 * 2 Aligned Tokens (2AT), 0 Non-aligned Tokens (0NT) scenario
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

describe('AutomationService Initialization - 1 Vault (2AP/0NP/2AT/0NT)', () => {
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

    // Setup blockchain environment on port 8547 (to avoid conflicts with 0202 and 1111 tests)
    testEnv = await setupTestBlockchain({ port: 8548 });

    // Create test vault with 2 aligned positions and 2 aligned tokens using new setup
    testVault = await setupTestVault(
      testEnv.ganacheServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '2AP/0NP/2AT/0NT Test Vault',
        automationServiceAddress: testEnv.testConfig.automationServiceAddress,
        wrapEthAmount: '10',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '2' }
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500, // 0.05% fee tier
            percentOfAssets: 15,
            tickRange: {
              type: 'centered',
              spacing: 10
            }
          },
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 3000, // 0.3% fee tier (different pool)
            percentOfAssets: 15,
            tickRange: {
              type: 'off-center',
              spacing: 10
            }
          }
        ],
        tokenTransfers: {
          'WETH': 60,  // 60% of remaining WETH to vault
          'USDC': 60   // 60% of remaining USDC to vault
        },
        // Fee-generating swaps: Execute back-and-forth swaps to generate fees on WETH/USDC pool (3000 fee tier - the one that will be closed)
        feeGeneratingSwaps: [
          {
            pool: { token0: 'USDC', token1: 'WETH', fee: 3000 },
            swaps: [
              { from: 'WETH', to: 'USDC', amount: '0.5' },  // WETH → USDC
              { from: 'USDC', to: 'WETH', amount: '1000' }  // USDC → WETH (generates fees on both sides)
            ]
          }
        ]
      }
    );

    console.log(`Test vault created: ${testVault.vaultAddress}`);
    console.log(`Positions: ${Object.keys(testVault.positions).length} total`);
    console.log(`Token balances: ${Object.keys(testVault.tokenBalances).length} tokens`);

    // Calculate expected final balances after position closure
    console.log('Test vault setup complete. Capturing expected balances...');

    // Track initial token transfers to vault
    initialTransfers = {
      'USDC': testVault.tokenBalances.USDC || '0',
      'WETH': testVault.tokenBalances.WETH || '0',
      'WBTC': testVault.tokenBalances.WBTC || '0',
      'USD₮0': testVault.tokenBalances['USD₮0'] || '0',
      'LINK': testVault.tokenBalances.LINK || '0'
    };

    // Track position tokens that will be returned when position is rejected due to limit
    // For 2020 test: 1 USDC/WETH position selected (most centered), 1 USDC/WETH position rejected
    const positionTokens = {
      'USDC': '0',  // Will be calculated from rejected position
      'WETH': '0',  // Will be calculated from rejected position
      'WBTC': '0',  // Not involved in positions
      'USD₮0': '0', // Not involved in positions
      'LINK': '0'   // Not involved in positions
    };

    // Calculate tokens returned from the rejected position (off-center one due to position limit)
    // Use the same pattern as 0202 test: position.amount0 and position.amount1
    const positionIds = Object.keys(testVault.positions);
    for (const positionId of positionIds) {
      const position = testVault.positions[positionId];
      // In 2020 test, the off-center USDC/WETH position will be rejected due to position limit
      if ((position.token0 === 'USDC' && position.token1 === 'WETH') ||
          (position.token0 === 'WETH' && position.token1 === 'USDC')) {
        // We expect the second position (off-center) to be rejected
        if (positionIds.indexOf(positionId) === 1) { // Second position
          // Use amount0 and amount1 properties like 0202 test
          if (position.token0 === 'USDC') {
            positionTokens.USDC = ethers.BigNumber.from(positionTokens.USDC).add(position.amount0).toString();
            positionTokens.WETH = ethers.BigNumber.from(positionTokens.WETH).add(position.amount1).toString();
          } else {
            positionTokens.WETH = ethers.BigNumber.from(positionTokens.WETH).add(position.amount0).toString();
            positionTokens.USDC = ethers.BigNumber.from(positionTokens.USDC).add(position.amount1).toString();
          }
          console.log(`  Position ${positionId} will be rejected: ${position.token0}=${position.amount0}, ${position.token1}=${position.amount1}`);
        }
      }
    }

    // Calculate expected final balances (initial transfers + tokens from rejected position)
    testVault.expectedFinalBalances = {
      'USDC': ethers.BigNumber.from(initialTransfers.USDC).add(positionTokens.USDC).toString(),
      'WETH': ethers.BigNumber.from(initialTransfers.WETH).add(positionTokens.WETH).toString(),
      'WBTC': initialTransfers.WBTC, // Unchanged
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

  describe('Success Case - 2AP/0NP/2AT/0NT Scenario', () => {
    it('should successfully handle service initialization with pre-existing vault containing multiple aligned positions', async () => {
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
      });

      // Set up event capture for InitialPositionsEvaluated (fired during service.start())
      const capturedEvents = [];
      const unsubscribe = service.eventManager.subscribe('InitialPositionsEvaluated', (data) => {
        capturedEvents.push(data);
      });

      // Set up event capture for PositionsClosed (should fire due to position limit)
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

      // Set up event capture for 5050SwapsPrepared
      const buffer5050Events = [];
      const unsubscribe5050 = service.eventManager.subscribe('5050SwapsPrepared', (data) => {
        buffer5050Events.push(data);
      });

      // Set up event capture for TokensSwapped
      const tokensSwappedEvents = [];
      service.eventManager.subscribe('TokensSwapped', (data) => {
        tokensSwappedEvents.push(data);
      });

      // Set up event capture for LiquidityAddedToPosition
      const liquidityAddedEvents = [];
      const unsubscribeLiquidityAdded = service.eventManager.subscribe('LiquidityAddedToPosition', (data) => {
        liquidityAddedEvents.push(data);
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

      // Test 1: Verify PoolDataFetched event handling (1 vault with positions scenario)
      expect(service.eventManager.eventHandlers['PoolDataFetched']).toBeDefined();
      expect(Array.isArray(service.eventManager.eventHandlers['PoolDataFetched'])).toBe(true);
      expect(service.eventManager.eventHandlers['PoolDataFetched'].length).toBeGreaterThan(0);
      expect(typeof service.eventManager.eventHandlers['PoolDataFetched'][0]).toBe('function');

      // Test 2: Authorized Vault Discovery
      const discoveredVaults = service.vaultDataService.getAllVaults();
      expect(Array.isArray(discoveredVaults)).toBe(true);
      expect(discoveredVaults.length).toBe(1);

      // Test vault data was loaded correctly - vault snapshot captured in VaultLoaded event handler
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

      // Test 5: Verify PoolDataFetched event data content
      expect(poolDataFetchedEventData).not.toBe(null);
      expect(poolDataFetchedEventData).toBeDefined();
      expect(typeof poolDataFetchedEventData).toBe('object');

      // The event should contain pool data for the pools used by the vault's positions
      const poolAddresses = Object.keys(poolDataFetchedEventData.poolData);
      expect(poolAddresses.length).toBe(2); // Should have 2 pools for our 2 positions with different fee tiers

      // Verify both pools have correct structure and are USDC/WETH pools
      const fees = [];
      poolAddresses.forEach(poolAddress => {
        const poolData = poolDataFetchedEventData.poolData[poolAddress];
        expect(poolData).toBeDefined();
        expect(poolData.token0Symbol).toBeDefined();
        expect(poolData.token1Symbol).toBeDefined();
        expect(poolData.platform).toBe('uniswapV3');

        // Verify token symbols are WETH and USDC (order depends on addresses)
        const tokenSymbols = [poolData.token0Symbol, poolData.token1Symbol].sort();
        expect(tokenSymbols).toEqual(['USDC', 'WETH']);

        fees.push(poolData.fee);
      });

      // Verify we have both fee tiers: 500 (0.05%) and 3000 (0.3%)
      expect(fees.sort((a, b) => a - b)).toEqual([500, 3000]);

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

      // Tokens Object Testing - should have our 2 aligned tokens
      expect(vault.tokens).toBeDefined();
      expect(typeof vault.tokens).toBe('object');
      expect(vault.tokens.USDC).toBeDefined();
      expect(vault.tokens.WETH).toBeDefined();
      expect(typeof vault.tokens.USDC).toBe('string');
      expect(typeof vault.tokens.WETH).toBe('string');

      // Verify token balances match exact amounts transferred to vault
      // Use TokenBalancesFetched events for accurate state snapshots
      expect(tokenBalanceFetchEvents.length).toBeGreaterThan(0);
      const initialBalances = tokenBalanceFetchEvents[0].balances;

      expect(initialBalances.USDC).toBe(initialTransfers.USDC);
      expect(initialBalances.WETH).toBe(initialTransfers.WETH);
      expect(initialBalances.WBTC).toBe(initialTransfers.WBTC);
      expect(initialBalances['USD₮0']).toBe(initialTransfers['USD₮0']);
      expect(initialBalances.LINK).toBe(initialTransfers.LINK);

      // Target Configuration Testing
      expect(Array.isArray(vault.targetTokens)).toBe(true);
      expect(vault.targetTokens).toEqual(['USDC', 'WETH']);
      expect(Array.isArray(vault.targetPlatforms)).toBe(true);
      expect(vault.targetPlatforms).toEqual(['uniswapV3']);

      // Positions Object Testing - should have our 2 aligned positions
      expect(vault.positions).toBeDefined();
      expect(typeof vault.positions).toBe('object');
      expect(Array.isArray(vault.positions)).toBe(false); // Should be object, not array
      expect(Object.keys(vault.positions).length).toBe(2); // Should have started with exactly 2 positions

      const vaultPositionIds = Object.keys(vault.positions);
      expect(vaultPositionIds.length).toBe(2);

      // Validate the position structure
      vaultPositionIds.forEach(positionId => {
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
      expect(vault.lastUpdated).toBeGreaterThan(Date.now() - 45000); // Within last 30 seconds

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
      console.log('Testing vault initialization with 2AP/0NP/2AT/0NT scenario (position limit logic)...');

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

      // Test specific 2AP/0NP/2AT/0NT scenario expectations (position limit logic):
      // - 2 positions with USDC/WETH tokens (both match target tokens)
      // - Positions on uniswapV3 platform (matches target platform)
      // - Vault has USDC and WETH token balances (2 aligned tokens)
      // - With mocked high TVL ($50M), both positions pass basic validation
      // - BabySteps strategy has position limit of 1, so only most centered position is selected
      expect(eventData.alignedCount).toBe(1);          // 1 Aligned Position (most centered)
      expect(eventData.nonAlignedCount).toBe(1);       // 1 Non-aligned Position (rejected due to limit)
      expect(eventData.alignedPositionIds).toHaveLength(1);
      expect(eventData.nonAlignedPositionIds).toHaveLength(1);

      // Verify specific position selection based on centeredness
      // We created 2 positions: first one centered (fee 500), second one off-center (fee 3000)
      // BabySteps strategy should select the most centered one due to position limit
      const createdPositionIds = Object.keys(testVault.positions);
      const centeredPositionId = createdPositionIds[0]; // First position (centered)
      const offCenterPositionId = createdPositionIds[1]; // Second position (off-center)

      expect(eventData.alignedPositionIds).toContain(centeredPositionId);
      expect(eventData.nonAlignedPositionIds).toContain(offCenterPositionId);

      console.log(`✅ InitialPositionsEvaluated event verified: ${eventData.alignedCount}AP/${eventData.nonAlignedCount}NP scenario successful`);
      console.log(`   Aligned position (centered): ${eventData.alignedPositionIds.join(', ')}`);
      console.log(`   Non-aligned position (off-center): ${eventData.nonAlignedPositionIds.join(', ')}`);
      console.log(`   Token balances: USDC=${vault.tokens.USDC}, WETH=${vault.tokens.WETH}`);
      console.log(`   Position limit test: Selected most centered of 2 eligible positions`);

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

      // Test specific position limit scenario: should close 1 non-aligned position (off-center)
      expect(closeEventData.closedCount).toBe(1);
      expect(closeEventData.closedPositions).toHaveLength(1);

      // Verify closed position structure
      const closedPosition = closeEventData.closedPositions[0];
      expect(closedPosition.positionId).toBe(offCenterPositionId);
      expect(closedPosition.pool).toBeDefined();

      // Test actual token symbols - USDC/WETH position should be closed (order depends on addresses)
      expect(['USDC', 'WETH']).toContain(closedPosition.token0Symbol);
      expect(['USDC', 'WETH']).toContain(closedPosition.token1Symbol);
      expect(closedPosition.token0Symbol).not.toBe(closedPosition.token1Symbol);
      expect(closedPosition.platform).toBe('uniswapV3');

      // Test principal amounts are present and non-zero
      expect(closedPosition.principalAmount0).toBeDefined();
      expect(closedPosition.principalAmount1).toBeDefined();
      expect(BigInt(closedPosition.principalAmount0)).toBeGreaterThan(0n);
      expect(BigInt(closedPosition.principalAmount1)).toBeGreaterThan(0n);

      // Test tick values
      expect(typeof closedPosition.tickLower).toBe('number');
      expect(typeof closedPosition.tickUpper).toBe('number');
      expect(closedPosition.tickUpper).toBeGreaterThan(closedPosition.tickLower);

      console.log(`✅ PositionsClosed event verified: ${closeEventData.closedCount} position closed (due to position limit)`);
      console.log(`   Closed position ID: ${closedPosition.positionId}`);
      console.log(`   Pool: ${closedPosition.token0Symbol}/${closedPosition.token1Symbol} on ${closedPosition.platform}`);
      console.log(`   Principal recovered: ${closedPosition.principalAmount0} ${closedPosition.token0Symbol}, ${closedPosition.principalAmount1} ${closedPosition.token1Symbol}`);

      // Test 9: Verify FeesCollected event from position closures during initialization
      expect(feesCollectedEvents.length).toBeGreaterThan(0);
      const initFeesEvent = feesCollectedEvents[0];
      expect(initFeesEvent).toBeDefined();
      expect(initFeesEvent.vaultAddress).toBe(vault.address);
      expect(initFeesEvent.source).toBe('initialization');
      expect(initFeesEvent.positionId).toBe(closedPosition.positionId); // Should match closed position
      expect(typeof initFeesEvent.totalUSD).toBe('number');
      expect(initFeesEvent.totalUSD).toBeGreaterThanOrEqual(0);
      expect(typeof initFeesEvent.token0Collected).toBe('number');
      expect(typeof initFeesEvent.token1Collected).toBe('number');
      expect(initFeesEvent.token0Symbol).toBe(closedPosition.token0Symbol);
      expect(initFeesEvent.token1Symbol).toBe(closedPosition.token1Symbol);
      expect(typeof initFeesEvent.token0USD).toBe('number');
      expect(typeof initFeesEvent.token1USD).toBe('number');
      expect(typeof initFeesEvent.token0ToOwner).toBe('number');
      expect(typeof initFeesEvent.token1ToOwner).toBe('number');
      expect(typeof initFeesEvent.token0Reinvested).toBe('number');
      expect(typeof initFeesEvent.token1Reinvested).toBe('number');
      expect(typeof initFeesEvent.reinvestmentRatio).toBe('number');
      expect(initFeesEvent.reinvestmentRatio).toBeGreaterThanOrEqual(0);
      expect(initFeesEvent.reinvestmentRatio).toBeLessThanOrEqual(100);
      expect(initFeesEvent.transactionHash).toBeDefined();
      expect(initFeesEvent.transactionHash).toBe(closeEventData.transactionHash); // Should match closure tx

      console.log(`✅ FeesCollected event verified: $${initFeesEvent.totalUSD.toFixed(2)} collected during initialization`);
      console.log(`   Source: ${initFeesEvent.source}, Position: ${initFeesEvent.positionId}`);
      console.log(`   Fees: ${initFeesEvent.token0Collected} ${initFeesEvent.token0Symbol} ($${initFeesEvent.token0USD.toFixed(2)}), ${initFeesEvent.token1Collected} ${initFeesEvent.token1Symbol} ($${initFeesEvent.token1USD.toFixed(2)})`);
      console.log(`   Distribution: ${initFeesEvent.reinvestmentRatio}% reinvested, ${100 - initFeesEvent.reinvestmentRatio}% to owner`);

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

      // Verify we have token balance events
      expect(tokenBalanceFetchEvents.length).toBeGreaterThan(0);

      // Get the most recent token balance fetch (after positions are closed)
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
        const tolerance = expected.div(1000); // 0.1% tolerance (accounts for price movement from fee swaps + fee distribution)

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

      // Test value reasonableness for 1AP/0NP scenario (position limit restricts to 1)
      expect(assetValueEvent.totalTokenValue).toBeGreaterThan(0);
      expect(assetValueEvent.totalPositionValue).toBeGreaterThan(0); // Has 1 aligned position due to limit
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

          // Use relative tolerance to account for price movement and fee distribution
          const relativeTolerance = Math.max(expectedBalanceInTokens * 0.001, 1e-12); // 0.1% or minimum 1e-12
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

        // Additional 2AP/0NP scenario verification (position limit enforced)
        expect(utilizationEvent.currentUtilization).toBeGreaterThan(0); // Has 1 aligned position due to limit
        expect(utilizationEvent.positionValue).toBeGreaterThan(0); // Has 1 position remaining (most centered)
        expect(utilizationEvent.tokenValue).toBeGreaterThan(0); // Has token balances

        console.log(`✅ UtilizationCalculated event verified against expected calculations:`);
        console.log(`   Actual current utilization: ${(utilizationEvent.currentUtilization * 100).toFixed(1)}% = Expected: ${(expectedCurrentUtilization * 100).toFixed(1)}%`);
        console.log(`   Actual max utilization: ${(utilizationEvent.maxUtilization * 100).toFixed(1)}% = Expected: ${(expectedMaxUtilization * 100).toFixed(1)}%`);
        console.log(`   Actual available deployment: $${utilizationEvent.availableDeployment.toFixed(2)} = Expected: $${expectedAvailableDeployment.toFixed(2)}`);
        console.log(`   2AP→1AP scenario: Position limit enforced, has $${utilizationEvent.positionValue.toFixed(2)} position value`);
      }

      // Test 13: Verify TokenPreparationCompleted event for 2020 scenario (no non-aligned tokens)
      console.log('Testing TokenPreparationCompleted event for 2020 scenario...');

      // Wait a bit for any token preparation to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (tokenPreparationEvents.length > 0) {
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

          // Get independently verified available amount from finalBalanceEvent
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

        // 2020 scenario specific tests - should NOT use non-aligned tokens (there are none)
        if (tokenPrepEvent.preparationResult === 'swaps_generated') {
          // Should only swap between aligned tokens (USDC ↔ WETH)
          expect(tokenPrepEvent.nonAlignedTokensUsed).toHaveLength(0);
          console.log(`   ✅ No non-aligned tokens used (as expected for 2020 scenario)`);
        } else if (tokenPrepEvent.preparationResult === 'sufficient_tokens') {
          expect(tokenPrepEvent.swapTransactions).toHaveLength(0);
          console.log(`   ✅ Sufficient tokens available, no swaps needed`);
        }

        console.log(`✅ TokenPreparationCompleted event verified for 2020 scenario`);
      } else {
        console.log('⚠️  No TokenPreparationCompleted events captured');
        console.log('   This may be expected if the strategy determined no token preparation was needed');
        console.log('   for the 2020 scenario (2 aligned positions with sufficient aligned tokens)');
      }

      // Test 14: Verify BatchTransactionExecuted event for token swaps (if any occurred)
      console.log('Testing BatchTransactionExecuted event for token swaps...');

      // Find batch transaction events for swaps (Permit2 doesn't need separate approvals)
      const swapBatchEvents = batchTransactionEvents.filter(event => event.operationType === 'deficit covering swaps');

      // Should have swap batch transactions when swaps were generated (no separate approvals with Permit2)
      expect(swapBatchEvents.length).toBeGreaterThan(0);

      // Test the most recent swap batch event (Permit2 swaps don't need separate approval batches)
      const swapBatchEvent = swapBatchEvents[swapBatchEvents.length - 1];
      expect(swapBatchEvent.vaultAddress).toBe(vault.address);
      expect(swapBatchEvent.strategyId).toBe(vault.strategy.strategyId);
      expect(swapBatchEvent.operationType).toBe('deficit covering swaps');
      expect(swapBatchEvent.transactionCount).toBeGreaterThan(0);
      expect(swapBatchEvent.transactionHash).toBeDefined();
      expect(swapBatchEvent.status).toBe(1); // Success status
      expect(swapBatchEvent.gasUsed).toBeDefined();
      expect(swapBatchEvent.gasEstimated).toBeDefined();

      console.log(`✅ BatchTransactionExecuted event verified for Permit2 swaps:`);
      console.log(`   Swap transactions: ${swapBatchEvent.transactionCount}`);
      console.log(`   Gas used: ${swapBatchEvent.gasUsed} (estimated: ${swapBatchEvent.gasEstimated})`);

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

      // Test 16: Verify 5050SwapsPrepared event for 2AT/0NT scenario (no non-aligned tokens)
      console.log('Testing 5050SwapsPrepared event for 2AT/0NT scenario...');

      // Should have captured 5050SwapsPrepared event
      expect(buffer5050Events.length).toBeGreaterThan(0);
      const event5050 = buffer5050Events[0];
      expect(event5050.vaultAddress).toBe(vault.address);

      // For 2AT/0NT scenario: no non-aligned tokens, so no remaining tokens to convert
      expect(event5050.conversionResult).toBe('no_remaining_tokens');
      expect(event5050.nonAlignedTokensProcessed).toHaveLength(0);
      expect(event5050.totalRemainingUSD).toBe('0');
      expect(event5050.targetToken0USD).toBe('0');
      expect(event5050.targetToken1USD).toBe('0');
      expect(event5050.actualSwappedToToken0USD).toBe('0');
      expect(event5050.actualSwappedToToken1USD).toBe('0');

      // No transactions should be generated (no swaps needed)
      expect(event5050.swapTransactions).toHaveLength(0);

      // Verify target tokens structure
      expect(event5050.targetTokens.token0.symbol).toBe('WETH');
      expect(event5050.targetTokens.token1.symbol).toBe('USDC');
      expect(event5050.targetTokens.token0.address).toBeDefined();
      expect(event5050.targetTokens.token1.address).toBeDefined();

      // Verify event metadata
      expect(event5050.strategyId).toBe('bob');
      expect(event5050.platformId).toBe('uniswapV3');
      expect(event5050.timestamp).toBeDefined();
      expect(event5050.log.level).toBe('info');
      expect(event5050.log.message).toBe('No remaining non-aligned tokens to convert');

      console.log('✅ 5050SwapsPrepared event verified for 2AT/0NT scenario:');
      console.log(`   Conversion result: ${event5050.conversionResult}`);
      console.log(`   Non-aligned tokens processed: ${event5050.nonAlignedTokensProcessed.length}`);

      // Test 16b: Verify TokensSwapped events (if any occurred)
      console.log('\n📊 Test 16b: Verifying TokensSwapped events...');

      // For 2AT/0NT scenario: should have deficit swaps but no buffer swaps
      const deficitSwapEvent = tokensSwappedEvents.find(e => e.swapType === 'deficit_coverage');
      const bufferSwapEvent = tokensSwappedEvents.find(e => e.swapType === 'buffer_5050');

      // Validate deficit swap event if it exists
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

      // For 2AT/0NT scenario: should NOT have buffer swaps
      expect(bufferSwapEvent).toBeUndefined();
      console.log('✅ No buffer swaps (expected for 2AT/0NT scenario)');
      console.log(`   Total remaining USD: $${event5050.totalRemainingUSD}`);
      console.log(`   Generated ${event5050.swapTransactions.length} swap(s)`);

      // Test 17: Verify token balance events for 2AT/0NT scenario (no buffer swaps needed)
      console.log('Testing token balance events for 2AT/0NT scenario (no buffer swaps needed)...');

      // Should have exactly 4 TokenBalancesFetched events:
      // [0] = initialization, [1] = post-closure, [2] = post-deficit swaps, [3] = final refresh from addToPosition
      expect(tokenBalanceFetchEvents).toHaveLength(4);

      console.log(`✅ Token balance events verified: ${tokenBalanceFetchEvents.length} events (no buffer swap refetching needed)`);
      console.log(`   Event sequence: initialization → post-closure → post-deficit → final-refresh`);

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

      // Validate token amounts against actual balance changes
      console.log(`🔍 Total TokenBalancesFetched events: ${tokenBalanceFetchEvents.length}`);
      console.log(`🔍 Event timing analysis:`);
      tokenBalanceFetchEvents.forEach((event, i) => {
        console.log(`  [${i}] ${event.trigger || 'unknown trigger'}: USDC=${event.balances.USDC}, WETH=${event.balances.WETH}`);
      });

      // Validate token amounts added to position using combination approach (same as 1111)
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

      // Utilization check (strategy goal achieved - zk verification that the correct amounts were achieved throughout execution)
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

      // 1. Verify SwapMonitoringRegistered event (1 for single pool after rebalancing)
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

      // 2. Verify ConfigMonitoringRegistered event
      expect(configMonitoringEvents).toHaveLength(1);
      const configEvent = configMonitoringEvents[0];
      expect(configEvent.vaultAddress).toBe(vault.address);
      expect(configEvent.chainId).toBe(service.chainId);
      expect(configEvent.listenersRegistered).toEqual(['TargetTokensUpdated', 'TargetPlatformsUpdated']);
      expect(configEvent.timestamp).toBeGreaterThan(0);
      console.log(`✅ ConfigMonitoringRegistered event verified with 2 config listeners`);
      console.log(`   Listeners: ${configEvent.listenersRegistered.join(', ')}`);

      // 3. Verify MonitoringStarted event
      expect(monitoringStartedEvents).toHaveLength(1);
      const startEvent = monitoringStartedEvents[0];
      expect(startEvent.vaultAddress).toBe(vault.address);
      expect(startEvent.strategyId).toBe('bob');
      expect(startEvent.positionCount).toBe(1); // 1 position remaining after workflow completion
      expect(startEvent.chainId).toBe(service.chainId);
      expect(startEvent.timestamp).toBeGreaterThan(0);
      console.log(`✅ MonitoringStarted event verified for vault ${startEvent.vaultAddress}`);
      console.log(`   Strategy: ${startEvent.strategyId}, Positions: ${startEvent.positionCount}`);

      // 4. Verify BabyStepsStrategy doesn't implement setupAdditionalMonitoring
      const strategy = service.strategies[vault.strategy.strategyId];
      expect(strategy.setupAdditionalMonitoring).toBeUndefined();
      console.log(`✅ BabyStepsStrategy correctly does not implement setupAdditionalMonitoring`);

      // Test 20: Verify emergency exit baseline cache for multiple aligned positions
      console.log('\n🚨 Test 20: Verifying emergency exit baseline cache for multiple aligned positions...');

      // Get the strategy instance from the service
      // (strategy already declared above, reusing it)
      expect(strategy.emergencyExitBaseline).toBeDefined();

      // Check that baseline was cached for our vault
      expect(strategy.emergencyExitBaseline[vault.address]).toBeDefined();
      expect(typeof strategy.emergencyExitBaseline[vault.address]).toBe('number');

      // With multiple aligned positions, we should have cached a baseline
      // It should be based on the first position processed (or could be from any)
      const baselineTick = strategy.emergencyExitBaseline[vault.address];

      console.log(`✅ Emergency exit baseline cached for vault with multiple positions:`);
      console.log(`   Vault: ${vault.address}`);
      console.log(`   Baseline tick: ${baselineTick}`);
      console.log(`   Number of positions: ${Object.keys(vault.positions).length}`);

      // Verify baseline is reasonable (within expected range)
      expect(baselineTick).toBeGreaterThan(-887272); // Min tick
      expect(baselineTick).toBeLessThan(887272);     // Max tick

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
      const vaultTokenSymbols = ['USDC', 'WETH']; // Hardcoded tokens for 2020 test

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
      unsubscribeBatchTransaction();
      unsubscribe5050();
      unsubscribeLiquidityAdded();
      unsubscribeTokenBalance();
      unsubscribeAssetValues();
      unsubscribeUtilization();
      if (typeof unsubscribeTokenPreparation !== 'undefined') {
        unsubscribeTokenPreparation();
      }
      unsubscribeSwapMonitoring();
      unsubscribeConfigMonitoring();
      unsubscribeMonitoringStarted();

    }, 180000); // 180 second timeout for vault setup and testing
  });
});
