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
            percentOfAssets: 20,
            tickRange: { type: 'above' }
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

      // Verify positions
      expect(vault.positions).toBeDefined();
      expect(Object.keys(vault.positions).length).toBe(2);

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

      // All position IDs should be valid (exist in vault.positions)
      const allPositionIds = Object.keys(vault.positions);
      expect(allPositionIds).toContain(event.alignedPositionIds[0]);
      expect(allPositionIds).toContain(event.nonAlignedPositionIds[0]);
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

      // Find the WBTC/WETH position by checking pool metadata
      const nonAlignedPositionId = event.nonAlignedPositionIds[0];
      const nonAlignedPosition = vault.positions[nonAlignedPositionId];
      const poolMetadata = service.poolData[nonAlignedPosition.pool];

      // Verify it's the WBTC/WETH position
      const tokens = [poolMetadata.token0Symbol, poolMetadata.token1Symbol].sort();
      expect(tokens).toEqual(['WBTC', 'WETH']);

      // Confirm WBTC is not in target tokens
      expect(vault.targetTokens).not.toContain('WBTC');
    });
  });

  describe('Setup Completion', () => {
    it('should emit VaultSetupComplete event', () => {
      expect(vaultSetupCompleteEvents.length).toBe(1);

      const event = vaultSetupCompleteEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
      expect(event.positionCount).toBe(2);
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
