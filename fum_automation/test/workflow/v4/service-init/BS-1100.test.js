/**
 * @fileoverview V4 Integration test for 1 Aligned / 1 Non-Aligned position workflow
 *
 * Scenario: 1 Aligned Position / 1 Non-Aligned Position / 0 extra tokens
 * - Vault has two V4 ETH/USDC positions on the same pool:
 *   1. Centered (in-range) — aligned, will receive addToPosition
 *   2. Above current tick (out-of-range) — non-aligned, will be closed
 * - Service should: close non-aligned, add liquidity to aligned
 *
 * This test exercises V4 position discovery via Transfer event scanning
 * (The Graph is unavailable on local forks).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../../src/core/AutomationService.js';
import { setupV4TestBlockchain, cleanupV4TestBlockchain } from '../../../helpers/v4-hardhat-setup.js';
import { setupV4TestVault } from '../../../helpers/v4-vault-setup.js';

describe('V4 AutomationService Initialization - 1AP/1NP addToPosition Workflow', () => {
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
  let liquidityAddedEvents = [];

  beforeAll(async () => {
    testEnv = await setupV4TestBlockchain();
    testConfig = testEnv.testConfig;

    // Create V4 test vault with 2 positions:
    // 1. Centered (aligned) — current tick within range
    // 2. Above (non-aligned) — current tick below position range
    testVault = await setupV4TestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'V4 1AP/1NP - addToPosition Test',
        nativeEthAmount: '10',
        nativeEthToVault: '5',
        swapTokens: [
          { from: 'ETH', to: 'USDC', amount: '3' }
        ],
        positions: [
          {
            token0: 'ETH',
            token1: 'USDC',
            fee: 500,
            tickSpacing: 10,
            percentOfAssets: 20,
            tickRange: { type: 'centered', spacing: 10 } // Aligned: in-range
          },
          {
            token0: 'ETH',
            token1: 'USDC',
            fee: 500,
            tickSpacing: 10,
            percentOfAssets: 15,
            tickRange: { type: 'above' } // Non-aligned: out-of-range
          }
        ],
        tokenTransfers: {},
        targetTokens: ['ETH', 'USDC'],
        targetPlatforms: ['uniswapV4'],
        strategy: 'bob'
      }
    );

    console.log('V4 1AP/1NP test vault created at:', testVault.vaultAddress);
  }, 180000);

  afterAll(async () => {
    if (service) {
      try {
        await service.stop(true);
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }
    await cleanupV4TestBlockchain(testEnv);
  });

  describe('Phase 3: Vault Discovery', () => {
    it('should discover and load authorized vault', async () => {
      service = new AutomationService(testConfig);

      // Subscribe to events before starting
      service.eventManager.subscribe('vaultLoading', (data) => vaultLoadingEvents.push(data));
      service.eventManager.subscribe('vaultLoaded', (data) => vaultLoadedEvents.push(data));
      service.eventManager.subscribe('VaultBaselineCaptured', (data) => vaultBaselineCapturedEvents.push(data));
      service.eventManager.subscribe('VaultSetupComplete', (data) => vaultSetupCompleteEvents.push(data));
      service.eventManager.subscribe('MonitoringStarted', (data) => monitoringStartedEvents.push(data));
      service.eventManager.subscribe('VaultsLoaded', (data) => vaultsLoadedEvents.push(data));
      service.eventManager.subscribe('PoolDataFetched', (data) => poolDataFetchedEvents.push(data));
      service.eventManager.subscribe('InitialPositionsEvaluated', (data) => initialPositionsEvaluatedEvents.push(data));
      service.eventManager.subscribe('BestPoolSelected', (data) => bestPoolSelectedEvents.push(data));
      service.eventManager.subscribe('PositionsClosed', (data) => positionsClosedEvents.push(data));
      service.eventManager.subscribe('BatchTransactionExecuted', (data) => batchTransactionExecutedEvents.push(data));
      service.eventManager.subscribe('TokenBalancesFetched', (data) => tokenBalancesFetchedEvents.push(data));
      service.eventManager.subscribe('DeploymentCalculated', (data) => utilizationEvents.push(data));
      service.eventManager.subscribe('TokenPreparationCompleted', (data) => tokenPreparationCompletedEvents.push(data));
      service.eventManager.subscribe('TokensSwapped', (data) => tokensSwappedEvents.push(data));
      service.eventManager.subscribe('NewPositionCreated', (data) => newPositionCreatedEvents.push(data));
      service.eventManager.subscribe('LiquidityAddedToPosition', (data) => liquidityAddedEvents.push(data));

      await service.start();

      expect(service.isRunning).toBe(true);

      const discoveredVaults = service.vaultDataService.getAllVaults();
      expect(discoveredVaults.length).toBe(1);

      expect(vaultsLoadedEvents.length).toBe(1);
      expect(vaultsLoadedEvents[0].successful).toBe(1);
    }, 180000);
  });

  describe('Vault Data Loading', () => {
    it('should discover 2 positions via Transfer event scanning', () => {
      expect(vaultLoadedEvents.length).toBe(1);

      const event = vaultLoadedEvents[0];
      expect(event.positionCount).toBe(2);
    });

    it('should have correct vault configuration', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      expect(vault.targetTokens).toEqual(['ETH', 'USDC']);
      expect(vault.targetPlatforms).toEqual(['uniswapV4']);
      expect(vault.strategy.strategyId).toBe('bob');
    });
  });

  describe('Baseline Capture', () => {
    it('should capture baseline with both token and position value', () => {
      expect(vaultBaselineCapturedEvents.length).toBe(1);

      const event = vaultBaselineCapturedEvents[0];
      expect(event.totalVaultValue).toBeGreaterThan(0);
      expect(event.positionValue).toBeGreaterThan(0);
      expect(event.tokenValue).toBeGreaterThanOrEqual(0);
    });

    it('should have 2 positions in baseline', () => {
      const event = vaultBaselineCapturedEvents[0];
      expect(Object.keys(event.positions).length).toBe(2);
    });
  });

  describe('Position Evaluation', () => {
    it('should emit InitialPositionsEvaluated event', () => {
      expect(initialPositionsEvaluatedEvents.length).toBe(1);

      const event = initialPositionsEvaluatedEvents[0];
      expect(event.success).toBe(true);
    });

    it('should identify 1 aligned and 1 non-aligned position', () => {
      const event = initialPositionsEvaluatedEvents[0];

      expect(event.alignedCount).toBe(1);
      expect(event.nonAlignedCount).toBe(1);
      expect(event.alignedPositionIds).toHaveLength(1);
      expect(event.nonAlignedPositionIds).toHaveLength(1);
    });
  });

  describe('Non-Aligned Position Closing', () => {
    it('should emit PositionsClosed event', () => {
      expect(positionsClosedEvents.length).toBe(1);
    });

    it('should close exactly 1 non-aligned position', () => {
      const event = positionsClosedEvents[0];

      expect(event.closedCount).toBe(1);
      expect(event.closedPositions).toHaveLength(1);
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });

    it('should have valid transaction details for closure', () => {
      const event = positionsClosedEvents[0];

      expect(event.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(BigInt(event.gasUsed)).toBeGreaterThan(0n);
    });

    it('should close the out-of-range position (not the aligned one)', () => {
      const evalEvent = initialPositionsEvaluatedEvents[0];
      const closeEvent = positionsClosedEvents[0];

      // The closed position should be the non-aligned one
      expect(closeEvent.closedPositions[0].positionId).toBe(evalEvent.nonAlignedPositionIds[0]);
    });
  });

  describe('Capital Deployment - addToPosition Path', () => {
    it('should have available deployment after closing non-aligned position', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];
      expect(event.availableDeployment).toBeGreaterThan(0);
    });

    it('should NOT create a new position (aligned position already exists)', () => {
      expect(newPositionCreatedEvents.length).toBe(0);
    });

    it('should emit LiquidityAddedToPosition event', () => {
      expect(liquidityAddedEvents.length).toBe(1);
    });

    it('should add liquidity to the aligned position', () => {
      const evalEvent = initialPositionsEvaluatedEvents[0];
      const addEvent = liquidityAddedEvents[0];

      expect(addEvent.positionId).toBe(evalEvent.alignedPositionIds[0]);
      expect(addEvent.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });

    it('should have valid transaction details for addToPosition', () => {
      const event = liquidityAddedEvents[0];

      expect(event.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(event.blockNumber).toBeGreaterThan(0);
      expect(BigInt(event.gasUsed)).toBeGreaterThan(0n);
    });

    it('should have actual token amounts from receipt parsing', () => {
      const event = liquidityAddedEvents[0];

      expect(event.actualToken0).toBeDefined();
      expect(event.actualToken1).toBeDefined();
      // At least one token should have been added
      expect(
        BigInt(event.actualToken0) > 0n || BigInt(event.actualToken1) > 0n
      ).toBe(true);
    });
  });

  describe('Emergency Exit Baseline', () => {
    it('should have emergency exit baseline set', () => {
      const strategy = service.strategies.get('bob');
      expect(strategy.emergencyExitBaseline[testVault.vaultAddress]).toBeDefined();
      expect(typeof strategy.emergencyExitBaseline[testVault.vaultAddress]).toBe('number');
    });
  });

  describe('Setup Completion', () => {
    it('should emit MonitoringStarted with 1 position (aligned only)', () => {
      expect(monitoringStartedEvents.length).toBe(1);

      const event = monitoringStartedEvents[0];
      expect(event.positionCount).toBe(1);
      expect(event.strategyId).toBe('bob');
    });

    it('should emit VaultSetupComplete', () => {
      expect(vaultSetupCompleteEvents.length).toBe(1);

      const event = vaultSetupCompleteEvents[0];
      expect(event.positionCount).toBe(1);
      expect(event.baselineCaptured).toBe(true);
    });

    it('should have vault in cache with 1 position after setup', async () => {
      const vault = await service.vaultDataService.getVault(testVault.vaultAddress, false);
      const positionIds = Object.keys(vault.positions);

      // Only the aligned position should remain
      expect(positionIds.length).toBe(1);
      expect(BigInt(vault.positions[positionIds[0]].liquidity)).toBeGreaterThan(0n);
    });
  });
});
