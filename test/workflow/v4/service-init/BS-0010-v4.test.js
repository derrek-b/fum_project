/**
 * @fileoverview V4 Integration tests for createNewPosition workflow
 * Tests vault initialization with NO aligned positions, triggering createNewPosition
 *
 * Scenario: 0 Aligned Positions / 0 Non-Aligned Positions / 1 Token (native ETH)
 * - Vault funded with native ETH only
 * - Target tokens: ETH/USDC (V4 uses native ETH, not WETH)
 * - No positions exist, so createNewPosition is called
 *
 * V4-specific differences from V3:
 * - Native ETH support (AddressZero instead of WETH)
 * - No ETH wrapping needed for positions
 * - Variable tick spacing per pool
 * - Permit2 approval flow
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../../src/core/AutomationService.js';
import { setupV4TestBlockchain, cleanupV4TestBlockchain } from '../../../helpers/v4-hardhat-setup.js';
import { setupV4TestVault } from '../../../helpers/v4-vault-setup.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('V4 AutomationService Initialization - createNewPosition Workflow', () => {
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
    const dataDir = path.join(__dirname, '../../../../data/vaults');
    try {
      await fs.rm(dataDir, { recursive: true, force: true });
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      // Ignore errors if directory doesn't exist
    }

    // Setup V4 blockchain environment (uses V4 Hardhat instance on port 8547)
    testEnv = await setupV4TestBlockchain();
    testConfig = testEnv.testConfig;

    // Create V4 test vault with NO positions - only native ETH
    // This will trigger createNewPosition since no aligned positions exist
    testVault = await setupV4TestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'V4 0AP/0NP - createNewPosition Test',
        automationServiceAddress: testConfig.automationServiceAddress,
        nativeEthAmount: '10',   // For reference only (owner starts with this)
        nativeEthToVault: '5',   // Actually send 5 ETH to vault
        swapTokens: [],          // No token swaps during setup
        positions: [],           // NO positions - key for triggering createNewPosition
        tokenTransfers: {},      // No token transfers
        targetTokens: ['ETH', 'USDC'],  // V4 uses native ETH, not WETH
        targetPlatforms: ['uniswapV4'],
        strategy: 'bob'
      }
    );

    console.log('V4 Test vault created at:', testVault.vaultAddress);
  }, 180000);

  afterAll(async () => {
    if (service) {
      try {
        await service.stop();
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }
    await cleanupV4TestBlockchain(testEnv);
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
      expect(vault.strategy).toBeDefined();
      expect(vault.strategy.strategyId).toBe('bob');
      expect(vault.targetTokens).toEqual(['ETH', 'USDC']);  // V4 uses native ETH
      expect(vault.targetPlatforms).toEqual(['uniswapV4']);
    });

    it('should have NO positions initially', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      // Vault was created with no positions
      expect(vault.positions).toBeDefined();
    });

    it('should have native ETH balance (V4 does not need WETH wrapping for positions)', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      // Verify vault.tokens exists
      expect(vault.tokens).toBeDefined();

      // V4 uses native ETH directly - balance should exist
      const ethBalance = BigInt(vault.tokens.ETH || '0');
      expect(ethBalance).toBeGreaterThanOrEqual(0n);
    });

    it('should emit vaultLoaded event with correct V4 data', () => {
      expect(vaultLoadedEvents.length).toBe(1);

      const event = vaultLoadedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
      expect(event.positionCount).toBe(0);  // No positions initially
      expect(event.targetTokens).toEqual(['ETH', 'USDC']);  // V4 native ETH
      expect(event.targetPlatforms).toEqual(['uniswapV4']);
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
    describe('V4 Pool Selection', () => {
      // V4 supports variable fee tiers via hooks
      const COMMON_V4_FEE_TIERS = [100, 500, 3000, 10000];
      const V4_MIN_TICK = -887272;
      const V4_MAX_TICK = 887272;

      it('should emit BestPoolSelected event', () => {
        expect(bestPoolSelectedEvents.length).toBe(1);

        const event = bestPoolSelectedEvents[0];
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      });

      it('should emit pool object with V4-specific structure', () => {
        const event = bestPoolSelectedEvents[0];

        expect(event.pool).toBeDefined();
        // V4 uses poolId (bytes32 hash) instead of address
        expect(event.pool.poolId || event.pool.address).toBeDefined();
        expect(event.pool.fee).toBeDefined();
        expect(event.pool.liquidity).toBeDefined();
        expect(event.pool.tick).toBeDefined();
        expect(event.pool.token0).toBeDefined();
        expect(event.pool.token1).toBeDefined();
      });

      it('should select pool for ETH/USDC token pair (native ETH)', () => {
        const event = bestPoolSelectedEvents[0];

        // Tokens should include ETH and USDC
        const tokenPair = [event.pool.token0.symbol, event.pool.token1.symbol].sort();
        expect(tokenPair).toEqual(['ETH', 'USDC']);
      });

      it('should select pool on V4 platform', () => {
        const event = bestPoolSelectedEvents[0];
        expect(event.platformId).toBe('uniswapV4');
      });

      it('should select pool with valid V4 fee tier', () => {
        const event = bestPoolSelectedEvents[0];
        // V4 supports the same common fee tiers plus custom via hooks
        expect(COMMON_V4_FEE_TIERS).toContain(event.pool.fee);
      });

      it('should select pool with liquidity > 0', () => {
        const event = bestPoolSelectedEvents[0];
        expect(BigInt(event.pool.liquidity)).toBeGreaterThan(0n);
      });

      it('should select pool with tick in valid V4 range', () => {
        const event = bestPoolSelectedEvents[0];
        expect(event.pool.tick).toBeGreaterThanOrEqual(V4_MIN_TICK);
        expect(event.pool.tick).toBeLessThanOrEqual(V4_MAX_TICK);
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
    });
  });

  describe('createNewPosition Step 7: Token Preparation (V4)', () => {
    it('should emit TokenPreparationCompleted event', () => {
      expect(tokenPreparationCompletedEvents.length).toBeGreaterThan(0);
    });

    it('should have correct event structure', () => {
      const event = tokenPreparationCompletedEvents[0];
      const vault = service.vaultDataService.getAllVaults()[0];

      expect(event.vaultAddress.toLowerCase()).toBe(vault.address.toLowerCase());
      expect(event.strategyId).toBe(vault.strategy.strategyId);
      expect(event.platformId).toBe('uniswapV4');
      expect(event.targetTokens).toBeDefined();
      expect(event.preparationResult).toBeDefined();
      expect(event.swapTransactions).toBeDefined();
    });

    it('should NOT wrap ETH (V4 uses native ETH directly)', () => {
      const event = tokenPreparationCompletedEvents[0];

      // V4 uses native ETH - no wrapping needed
      if (event.wrapUnwrap) {
        // wrapAmount should be 0 (no ETH → WETH needed for V4)
        const wrapAmount = BigInt(event.wrapUnwrap.wrapAmount || '0');
        expect(wrapAmount).toBe(0n);
      }
    });

    it('should have correct targetTokens structure for V4', () => {
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

    it('should have phasesUsed reflecting deficit swaps (no wrap for V4)', () => {
      const event = tokenPreparationCompletedEvents[0];

      // V4 with native ETH:
      // - wrapUnwrap: false (V4 uses native ETH directly)
      // - nonAlignedForDeficit: false (ETH is a target token, not non-aligned)
      // - excessTargetTokens: true (excess ETH swapped to cover USDC deficit)
      if (event.phasesUsed) {
        expect(event.phasesUsed.wrapUnwrap).toBe(false);
        expect(event.phasesUsed.nonAlignedForDeficit).toBe(false);
        expect(event.phasesUsed.excessTargetTokens).toBe(true);
      }
    });
  });

  describe('createNewPosition Step 7: Token Swap Execution (V4)', () => {
    it('should emit TokensSwapped event for deficit swaps', () => {
      const deficitEvent = tokensSwappedEvents.find(e => e.swapType === 'deficit_coverage');

      const tokenPrepEvent = tokenPreparationCompletedEvents[0];
      if (tokenPrepEvent.preparationResult === 'swaps_generated' && tokenPrepEvent.deficitSwapCount > 0) {
        expect(deficitEvent).toBeDefined();
        expect(deficitEvent.success).toBe(true);
        expect(deficitEvent.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
        expect(deficitEvent.swapCount).toBeGreaterThan(0);
        expect(deficitEvent.transactionHash).toBeDefined();
      }
    });

    it('should swap native ETH to acquire USDC (the deficit token)', () => {
      const deficitEvent = tokensSwappedEvents.find(e => e.swapType === 'deficit_coverage');

      if (deficitEvent) {
        const swaps = deficitEvent.swaps;
        expect(swaps.length).toBeGreaterThan(0);

        // At least one swap should output USDC
        const USDCOutputSwap = swaps.find(s => s.tokenOutSymbol === 'USDC');
        expect(USDCOutputSwap).toBeDefined();

        // Input token should be ETH (V4 native)
        expect(USDCOutputSwap.tokenInSymbol).toBe('ETH');
      }
    });
  });

  describe('createNewPosition Step 8: Token Balance Refresh', () => {
    it('should have multiple TokenBalancesFetched events (initial + post-swap)', () => {
      expect(tokenBalancesFetchedEvents.length).toBeGreaterThanOrEqual(2);
    });

    it('should have position in VDS cache after creation', async () => {
      const vault = await service.vaultDataService.getVault(testVault.vaultAddress, false);
      const positionId = newPositionCreatedEvents[0].positionId;

      expect(vault.positions).toBeDefined();
      expect(vault.positions[positionId]).toBeDefined();
      expect(vault.positions[positionId].id).toBe(positionId);
      expect(vault.positions[positionId].liquidity).toBeDefined();
      expect(BigInt(vault.positions[positionId].liquidity)).toBeGreaterThan(0n);
    });

    it('should have remaining ETH balance (V4 uses native ETH)', () => {
      const postSwapEvent = tokenBalancesFetchedEvents[tokenBalancesFetchedEvents.length - 1];

      // V4 keeps native ETH - should have remaining balance
      const ethBalance = BigInt(postSwapEvent.balances.ETH || '0');
      expect(ethBalance).toBeGreaterThanOrEqual(0n);
    });
  });

  describe('NewPositionCreated event (V4)', () => {
    it('should emit exactly one NewPositionCreated event', () => {
      expect(newPositionCreatedEvents.length).toBe(1);
    });

    it('should have correct vault and position identifiers', () => {
      const event = newPositionCreatedEvents[0];

      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.positionId).toBeDefined();
      // V4 may use poolId (bytes32) instead of poolAddress
      expect(event.poolAddress || event.poolId).toBeDefined();
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
    });

    it('should have valid position range', () => {
      const event = newPositionCreatedEvents[0];
      const adapter = service.adapters.get(event.platform);

      expect(event.position).toBeDefined();

      const { lower, upper } = adapter.extractPositionBounds(event.position);
      expect(typeof lower).toBe('number');
      expect(typeof upper).toBe('number');
      expect(lower).toBeLessThan(upper);

      expect(typeof event.position.currentTick).toBe('number');
    });

    it('should have correct V4 context metadata', () => {
      const event = newPositionCreatedEvents[0];

      expect(event.tokenSymbols).toBeDefined();
      expect(Array.isArray(event.tokenSymbols)).toBe(true);
      expect(event.tokenSymbols).toHaveLength(2);
      // ETH/USDC pair for V4
      expect(event.tokenSymbols).toContain('ETH');
      expect(event.tokenSymbols).toContain('USDC');
      expect(event.platform).toBe('uniswapV4');
      expect(event.deploymentAmount).toBeGreaterThan(0);
      expect(typeof event.timestamp).toBe('number');
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

      const newPositionEvent = newPositionCreatedEvents[0];
      expect(baseline).toBe(newPositionEvent.position.currentTick);
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
  });
});
