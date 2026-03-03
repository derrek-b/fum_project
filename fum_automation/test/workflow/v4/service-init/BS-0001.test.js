/**
 * @fileoverview V4 WETH Cross-Version Swap Workflow Test
 *
 * Scenario: Vault holds WETH (not native ETH), targets native ETH/USDC V4 pool
 * - Vault funded with WETH only (no native ETH, no USDC)
 * - Target tokens: ETH/USDC (V4 native ETH pool)
 * - Strategy must: unwrap WETH→ETH, swap WETH→USDC via AlphaRouter
 * - AlphaRouter routes WETH→USDC through V3 pools (V4 pools use native ETH)
 * - V4 adapter's parseSwapReceipt handles V3 Swap events → cross-version parsing
 * - Creates position on V4 native ETH/USDC pool
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../../src/core/AutomationService.js';
import { setupV4TestBlockchain, cleanupV4TestBlockchain } from '../../../helpers/v4-hardhat-setup.js';
import { setupV4TestVault } from '../../../helpers/v4-vault-setup.js';
describe('V4 WETH Cross-Version Swap Workflow', () => {
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
    // Setup V4 blockchain environment (uses V4 Hardhat instance on port 8547)
    testEnv = await setupV4TestBlockchain();
    testConfig = testEnv.testConfig;

    // Create V4 test vault with WETH only (no native ETH, no positions)
    // This triggers WETH→ETH unwrap + WETH→USDC cross-version swap
    testVault = await setupV4TestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'V4 WETH Cross-Version Test',
        wrapEthToVault: '5',        // Wraps 5 ETH→WETH, transfers to vault
        swapTokens: [],             // No token swaps during setup
        positions: [],              // NO positions - triggers createNewPosition
        tokenTransfers: {},         // No token transfers
        targetTokens: ['ETH', 'USDC'],  // Native ETH target (NOT WETH)
        targetPlatforms: ['uniswapV4'],
        strategy: 'bob'
      }
    );

    console.log('V4 WETH test vault created at:', testVault.vaultAddress);
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
    it('should discover and load authorized vault', async () => {
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

  describe('Vault Data Loading', () => {
    it('should have WETH balance (not native ETH) at initial load', () => {
      // Check initial token balances (first fetch, before strategy processing)
      const initialBalances = tokenBalancesFetchedEvents[0];
      expect(initialBalances).toBeDefined();

      // Vault should have WETH at initial load (from wrapEthToVault)
      const wethBalance = BigInt(initialBalances.balances.WETH || '0');
      expect(wethBalance).toBeGreaterThan(0n);

      // Vault should have 0 native ETH initially (we only sent WETH)
      const ethBalance = BigInt(initialBalances.balances.ETH || '0');
      expect(ethBalance).toBe(0n);
    });

    it('should have targetTokens [ETH, USDC]', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      expect(vault.targetTokens).toEqual(['ETH', 'USDC']);
      expect(vault.targetPlatforms).toEqual(['uniswapV4']);
    });
  });

  describe('Baseline Capture', () => {
    it('should capture total vault value from WETH', () => {
      expect(vaultBaselineCapturedEvents.length).toBe(1);

      const event = vaultBaselineCapturedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(typeof event.totalVaultValue).toBe('number');
      expect(event.totalVaultValue).toBeGreaterThan(0);

      // Token value from WETH, no position value
      expect(event.tokenValue).toBeGreaterThan(0);
      expect(event.positionValue).toBe(0);
    });
  });

  describe('Strategy Initialization', () => {
    describe('Pool Selection', () => {
      const COMMON_V4_FEE_TIERS = [100, 500, 3000, 10000];

      it('should emit BestPoolSelected event', () => {
        expect(bestPoolSelectedEvents.length).toBe(1);

        const event = bestPoolSelectedEvents[0];
        expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      });

      it('should select ETH/USDC V4 pool', () => {
        const event = bestPoolSelectedEvents[0];

        const tokenPair = [event.pool.token0.symbol, event.pool.token1.symbol].sort();
        expect(tokenPair).toEqual(['ETH', 'USDC']);
        expect(event.platformId).toBe('uniswapV4');
      });

      it('should select pool with valid fee tier and liquidity', () => {
        const event = bestPoolSelectedEvents[0];

        expect(COMMON_V4_FEE_TIERS).toContain(event.pool.fee);
        expect(BigInt(event.pool.liquidity)).toBeGreaterThan(0n);
      });
    });

    describe('Position Evaluation (0 aligned, 0 non-aligned)', () => {
      it('should identify 0 aligned and 0 non-aligned positions', () => {
        expect(initialPositionsEvaluatedEvents.length).toBe(1);

        const event = initialPositionsEvaluatedEvents[0];
        expect(event.success).toBe(true);
        expect(event.alignedCount).toBe(0);
        expect(event.nonAlignedCount).toBe(0);
      });
    });
  });

  describe('Token Preparation (WETH-specific)', () => {
    it('should emit TokenPreparationCompleted event', () => {
      expect(tokenPreparationCompletedEvents.length).toBeGreaterThan(0);
    });

    it('should unwrap WETH→ETH (phasesUsed.wrapUnwrap = true)', () => {
      const event = tokenPreparationCompletedEvents[0];

      expect(event.phasesUsed).toBeDefined();
      // Pre-phase: WETH detected as non-aligned, unwrapped to ETH for native side
      expect(event.phasesUsed.wrapUnwrap).toBe(true);
    });

    it('should swap non-aligned WETH for deficit USDC (phasesUsed.nonAlignedForDeficit = true)', () => {
      const event = tokenPreparationCompletedEvents[0];

      expect(event.phasesUsed).toBeDefined();
      // Phase 1: remaining WETH swapped to cover USDC deficit
      expect(event.phasesUsed.nonAlignedForDeficit).toBe(true);
    });

    it('should have USDC deficit > 0', () => {
      const event = tokenPreparationCompletedEvents[0];

      // Find which token is USDC
      const USDCToken = event.targetTokens.token0.symbol === 'USDC'
        ? event.targetTokens.token0
        : event.targetTokens.token1;

      // Vault starts with 0 USDC, so deficit is guaranteed
      const USDCDeficit = BigInt(USDCToken.deficit);
      expect(USDCDeficit).toBeGreaterThan(0n);
    });
  });

  describe('Cross-Version Swap Execution', () => {
    it('should emit TokensSwapped for WETH→USDC deficit', () => {
      // Find the deficit swap event (WETH→USDC)
      const deficitEvent = tokensSwappedEvents.find(e =>
        e.swaps?.some(s => s.tokenInSymbol === 'WETH' && s.tokenOutSymbol === 'USDC')
      );

      expect(deficitEvent).toBeDefined();
      expect(deficitEvent.success).toBe(true);
      expect(deficitEvent.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });

    it('should have WETH as tokenIn and USDC as tokenOut', () => {
      const deficitEvent = tokensSwappedEvents.find(e =>
        e.swaps?.some(s => s.tokenInSymbol === 'WETH' && s.tokenOutSymbol === 'USDC')
      );

      const wethToUsdcSwap = deficitEvent.swaps.find(
        s => s.tokenInSymbol === 'WETH' && s.tokenOutSymbol === 'USDC'
      );
      expect(wethToUsdcSwap).toBeDefined();
      expect(wethToUsdcSwap.tokenInSymbol).toBe('WETH');
      expect(wethToUsdcSwap.tokenOutSymbol).toBe('USDC');
    });

    it('should have actualAmountIn > 0 (cross-version receipt parsing)', () => {
      const deficitEvent = tokensSwappedEvents.find(e =>
        e.swaps?.some(s => s.tokenInSymbol === 'WETH' && s.tokenOutSymbol === 'USDC')
      );

      const wethToUsdcSwap = deficitEvent.swaps.find(
        s => s.tokenInSymbol === 'WETH' && s.tokenOutSymbol === 'USDC'
      );
      // This proves V3 swap events were parsed by the V4 adapter
      expect(BigInt(wethToUsdcSwap.actualAmountIn)).toBeGreaterThan(0n);
    });

    it('should have actualAmountOut > 0', () => {
      const deficitEvent = tokensSwappedEvents.find(e =>
        e.swaps?.some(s => s.tokenInSymbol === 'WETH' && s.tokenOutSymbol === 'USDC')
      );

      const wethToUsdcSwap = deficitEvent.swaps.find(
        s => s.tokenInSymbol === 'WETH' && s.tokenOutSymbol === 'USDC'
      );
      expect(BigInt(wethToUsdcSwap.actualAmountOut)).toBeGreaterThan(0n);
    });
  });

  describe('NewPositionCreated (V4 native ETH/USDC)', () => {
    it('should create position on uniswapV4', () => {
      expect(newPositionCreatedEvents.length).toBe(1);

      const event = newPositionCreatedEvents[0];
      expect(event.platform).toBe('uniswapV4');
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });

    it('should have ETH/USDC token pair', () => {
      const event = newPositionCreatedEvents[0];

      expect(event.tokenSymbols).toBeDefined();
      expect(event.tokenSymbols).toHaveLength(2);
      expect(event.tokenSymbols).toContain('ETH');
      expect(event.tokenSymbols).toContain('USDC');
    });

    it('should have valid amounts and range', () => {
      const event = newPositionCreatedEvents[0];

      // Both token amounts should be > 0
      expect(BigInt(event.actualToken0)).toBeGreaterThan(0n);
      expect(BigInt(event.actualToken1)).toBeGreaterThan(0n);

      // Valid position range
      expect(event.position).toBeDefined();
      const adapter = service.adapters.get(event.platform);
      const { lower, upper } = adapter.extractPositionBounds(event.position);
      expect(lower).toBeLessThan(upper);

      // Valid transaction
      expect(event.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(event.blockNumber).toBeGreaterThan(0);
    });
  });

  describe('Setup Completion', () => {
    it('should emit MonitoringStarted event', () => {
      expect(monitoringStartedEvents.length).toBe(1);

      const event = monitoringStartedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
      expect(event.positionCount).toBe(1);
    });

    it('should emit VaultSetupComplete event', () => {
      expect(vaultSetupCompleteEvents.length).toBe(1);

      const event = vaultSetupCompleteEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
      expect(event.strategyId).toBe('bob');
      expect(event.positionCount).toBe(1);
      expect(event.tokenCount).toBeGreaterThan(0);
      expect(event.baselineCaptured).toBe(true);
    });
  });
});
