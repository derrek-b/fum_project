/**
 * @fileoverview Integration test for vault with all capital in an aligned position
 * Tests vault initialization when there is nothing to deploy — just monitor.
 *
 * Scenario: 1 Aligned Position / 0 Non-Aligned / 0 Loose Tokens
 * - Vault has a single in-range V3 position with ~100% of assets
 * - No loose tokens to deploy (below minimum deployment threshold)
 * - Strategy skips deployment and sets emergency exit baseline
 * - Vault setup completes successfully and monitoring starts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';

describe('BS-1000: All Capital in Position (No Deployment)', () => {
  let testEnv;
  let testVault;
  let service;
  let testConfig;

  // Event capture
  let deploymentCalculatedEvents = [];
  let vaultSetupCompleteEvents = [];
  let monitoringStartedEvents = [];
  let initialPositionsEvaluatedEvents = [];
  let newPositionCreatedEvents = [];
  let liquidityAddedEvents = [];

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create vault with nearly all assets in a single aligned position.
    // percentOfAssets: 99 puts ~99% in the position. tokenTransfers: {} means
    // no loose tokens are sent to the vault — only the position NFT.
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'BS-1000: All Capital in Position',
        wrapEthAmount: '5',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '2.5' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 99,
          tickRange: { type: 'centered', spacing: 10 }
        }],
        tokenTransfers: {},
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );

    console.log(`Test vault created at: ${testVault.vaultAddress}`);
  }, 180000);

  afterAll(async () => {
    if (service?.isRunning) {
      try { await service.stop(); } catch (e) { /* ignore */ }
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should discover vault and complete setup without deploying capital', async () => {
    service = new AutomationService(testConfig);

    service.eventManager.subscribe('DeploymentCalculated', (data) => {
      deploymentCalculatedEvents.push(data);
    });

    service.eventManager.subscribe('VaultSetupComplete', (data) => {
      vaultSetupCompleteEvents.push(data);
    });

    service.eventManager.subscribe('MonitoringStarted', (data) => {
      monitoringStartedEvents.push(data);
    });

    service.eventManager.subscribe('InitialPositionsEvaluated', (data) => {
      initialPositionsEvaluatedEvents.push(data);
    });

    service.eventManager.subscribe('NewPositionCreated', (data) => {
      newPositionCreatedEvents.push(data);
    });

    service.eventManager.subscribe('LiquidityAddedToPosition', (data) => {
      liquidityAddedEvents.push(data);
    });

    await service.start();

    // Vault should be tracked and healthy
    expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
    expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
    expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);
  }, 120000);

  it('should evaluate 1 aligned position, 0 non-aligned', () => {
    const evalEvent = initialPositionsEvaluatedEvents.find(
      e => e.vaultAddress === testVault.vaultAddress
    );
    expect(evalEvent).toBeDefined();
    expect(evalEvent.alignedCount).toBe(1);
    expect(evalEvent.nonAlignedCount).toBe(0);
  });

  it('should calculate available deployment as 0 (all capital in position)', () => {
    const deployEvent = deploymentCalculatedEvents.find(
      e => e.vaultAddress === testVault.vaultAddress
    );
    expect(deployEvent).toBeDefined();
    expect(deployEvent.availableDeployment).toBe(0);
    expect(deployEvent.totalVaultValue).toBeGreaterThan(0);

    // Utilization should be very high (nearly 100%)
    const utilization = deployEvent.positionValue / deployEvent.totalVaultValue;
    expect(utilization).toBeGreaterThan(0.9);

    console.log(`Utilization: ${(utilization * 100).toFixed(1)}%, Available: $${deployEvent.availableDeployment}`);
  });

  it('should NOT create a new position or add liquidity', () => {
    // No capital to deploy means no position operations
    const myNewPositions = newPositionCreatedEvents.filter(
      e => e.vaultAddress === testVault.vaultAddress
    );
    const myLiquidityAdds = liquidityAddedEvents.filter(
      e => e.vaultAddress === testVault.vaultAddress
    );
    expect(myNewPositions.length).toBe(0);
    expect(myLiquidityAdds.length).toBe(0);
  });

  it('should set emergency exit baseline from aligned position', () => {
    const strategy = service.strategies.get('bob');
    const baseline = strategy.emergencyExitBaseline[testVault.vaultAddress];
    expect(baseline).toBeDefined();
    console.log(`Emergency exit baseline: ${JSON.stringify(baseline)}`);
  });

  it('should complete setup and start monitoring', () => {
    const setupEvent = vaultSetupCompleteEvents.find(
      e => e.vaultAddress === testVault.vaultAddress
    );
    expect(setupEvent).toBeDefined();

    const monitorEvent = monitoringStartedEvents.find(
      e => e.vaultAddress === testVault.vaultAddress
    );
    expect(monitorEvent).toBeDefined();
  });
});
