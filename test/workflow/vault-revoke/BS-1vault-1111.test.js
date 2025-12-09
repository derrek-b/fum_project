/**
 * @fileoverview Integration test for Vault Authorization Revocation workflow
 * Tests vault setup, service initialization, and then ExecutorChanged event for revocation
 * with 1 Aligned Position, 1 Non-aligned Position, 1 Aligned Token, 1 Non-aligned Token
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import AutomationService from '../../../src/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/ganache-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';

// Mock the getPoolTVLAverage function for test environment
vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    getPoolTVLAverage: vi.fn().mockResolvedValue(50000000), // $50M TVL
  };
});

describe('Vault Authorization Revocation Workflow - 1111 Configuration', () => {
  let testEnv;
  let testVault;
  let service;
  let vaultAuthRevokedEvent = null;
  let vaultOffboardedEvent = null;
  let vaultMonitoringStoppedEvent = null;
  let vaultPositionChecksClearedEvent = null;

  beforeAll(async () => {
    // 1. Setup blockchain on port 8548 (different from other tests)
    testEnv = await setupTestBlockchain({ port: 8553 });

    // 2. Create test vault with 1111 configuration and set executor
    testVault = await setupTestVault(
      testEnv.ganacheServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '1AP/1NP/1AT/1NT Revocation Test Vault',
        automationServiceAddress: testEnv.testConfig.automationServiceAddress,
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
        targetPlatforms: ['uniswapV3']
      }
    );

    console.log('💰 Test vault setup complete with executor set to automation service');

    // 3. Initialize and start the automation service to discover the pre-existing vault
    service = new AutomationService(testEnv.testConfig);

    // Add event listeners to capture revocation events
    service.eventManager.subscribe('VaultAuthRevoked', (eventData) => {
      vaultAuthRevokedEvent = eventData;
      console.log('🎯 VaultAuthRevoked event captured:', eventData);
    });

    service.eventManager.subscribe('VaultOffboarded', (eventData) => {
      vaultOffboardedEvent = eventData;
      console.log('🎯 VaultOffboarded event captured:', eventData);
    });

    service.eventManager.subscribe('VaultMonitoringStopped', (eventData) => {
      vaultMonitoringStoppedEvent = eventData;
      console.log('🎯 VaultMonitoringStopped event captured:', eventData);
    });

    service.eventManager.subscribe('VaultPositionChecksCleared', (eventData) => {
      vaultPositionChecksClearedEvent = eventData;
      console.log('🎯 VaultPositionChecksCleared event captured:', eventData);
    });

    await service.start();
    console.log('✅ Service started and discovered pre-existing vault');

    // 4. Wait for service initialization to complete
    await new Promise(resolve => setTimeout(resolve, 10000));

    // 5. Verify vault is being monitored before revocation
    const vaultData = await service.vaultDataService.getVault(testVault.vaultAddress);
    expect(vaultData).not.toBeNull();
    console.log('✅ Vault is being monitored by automation service');

  }, 210000);

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

  it('should emit VaultAuthRevoked event when executor is removed from vault', async () => {
    // Get the vault contract instance from setupTestVault return
    const vaultContract = testVault.vault;

    console.log('🔄 Revoking executor authorization...');

    // Revoke executor using the proper removeExecutor function
    const revokeExecutorTx = await vaultContract.removeExecutor();
    const revokeReceipt = await revokeExecutorTx.wait();

    console.log(`✅ Executor revoked in block ${revokeReceipt.blockNumber} with status: ${revokeReceipt.status === 1 ? 'SUCCESS' : 'FAILED'}`);

    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify VaultAuthRevoked event was emitted
    expect(vaultAuthRevokedEvent).not.toBeNull();
    expect(vaultAuthRevokedEvent).toHaveProperty('vaultAddress');
    expect(vaultAuthRevokedEvent).toHaveProperty('executorAddress');

    // Verify addresses are correct
    expect(vaultAuthRevokedEvent.vaultAddress.toLowerCase()).toBe(
      testVault.vaultAddress.toLowerCase()
    );
    expect(vaultAuthRevokedEvent.executorAddress.toLowerCase()).toBe(
      testEnv.testConfig.automationServiceAddress.toLowerCase()
    );

    console.log('✅ VaultAuthRevoked event emitted correctly:');
    console.log(`   Vault: ${vaultAuthRevokedEvent.vaultAddress}`);
    console.log(`   Revoked Executor: ${vaultAuthRevokedEvent.executorAddress}`);
  });

  it('should emit VaultOffboarded event with cleanup details', async () => {
    // Verify VaultOffboarded event was emitted
    expect(vaultOffboardedEvent).not.toBeNull();
    expect(vaultOffboardedEvent).toHaveProperty('vaultAddress');
    expect(vaultOffboardedEvent).toHaveProperty('strategyId');
    expect(vaultOffboardedEvent).toHaveProperty('vaultRemoved');

    // Verify vault address matches
    expect(vaultOffboardedEvent.vaultAddress.toLowerCase()).toBe(
      testVault.vaultAddress.toLowerCase()
    );

    // Verify strategy was 'bob' (BabyStepsStrategy)
    expect(vaultOffboardedEvent.strategyId).toBe('bob');

    // Verify vault was removed from cache
    expect(vaultOffboardedEvent.vaultRemoved).toBe(true);

    console.log('✅ VaultOffboarded event emitted correctly:');
    console.log(`   Vault: ${vaultOffboardedEvent.vaultAddress}`);
    console.log(`   Strategy: ${vaultOffboardedEvent.strategyId}`);
    console.log(`   Vault Removed: ${vaultOffboardedEvent.vaultRemoved}`);
  });

  it('should emit VaultMonitoringStopped event with cleanup details', async () => {
    // Verify VaultMonitoringStopped event was emitted
    expect(vaultMonitoringStoppedEvent).not.toBeNull();
    expect(vaultMonitoringStoppedEvent).toHaveProperty('vaultAddress');
    expect(vaultMonitoringStoppedEvent).toHaveProperty('strategyId');
    expect(vaultMonitoringStoppedEvent).toHaveProperty('listenersRemoved');

    // Verify vault address matches
    expect(vaultMonitoringStoppedEvent.vaultAddress.toLowerCase()).toBe(
      testVault.vaultAddress.toLowerCase()
    );

    // Verify strategy was 'bob' (BabyStepsStrategy)
    expect(vaultMonitoringStoppedEvent.strategyId).toBe('bob');

    // Verify listeners were removed (should be 3: swap, config-tokens, config-platforms)
    expect(vaultMonitoringStoppedEvent.listenersRemoved).toBe(3);

    console.log('✅ VaultMonitoringStopped event emitted correctly:');
    console.log(`   Vault: ${vaultMonitoringStoppedEvent.vaultAddress}`);
    console.log(`   Strategy: ${vaultMonitoringStoppedEvent.strategyId}`);
    console.log(`   Listeners Removed: ${vaultMonitoringStoppedEvent.listenersRemoved}`);
  });

  it('should emit VaultPositionChecksCleared event from strategy cleanup', async () => {
    // Verify VaultPositionChecksCleared event was emitted
    expect(vaultPositionChecksClearedEvent).not.toBeNull();
    expect(vaultPositionChecksClearedEvent).toHaveProperty('vaultAddress');
    expect(vaultPositionChecksClearedEvent).toHaveProperty('removedCheckCount');

    // Verify vault address matches
    expect(vaultPositionChecksClearedEvent.vaultAddress.toLowerCase()).toBe(
      testVault.vaultAddress.toLowerCase()
    );

    // For a fresh vault, there might be 0 position checks to clear
    // (depends on whether any position checks were performed before revocation)
    expect(vaultPositionChecksClearedEvent.removedCheckCount).toBeGreaterThanOrEqual(0);

    console.log('✅ VaultPositionChecksCleared event emitted correctly:');
    console.log(`   Vault: ${vaultPositionChecksClearedEvent.vaultAddress}`);
    console.log(`   Removed Check Count: ${vaultPositionChecksClearedEvent.removedCheckCount}`);
  });

  it('should clean up pool listeners when the last vault is revoked', async () => {
    // Get the pool address from the vault's position (should be USDC/WETH pool)
    const poolAddress = Object.values(testVault.positions)[0].pool;
    
    // Verify pool-to-vault mapping is cleaned up
    expect(service.eventManager.poolToVaults[poolAddress]).toBeUndefined();
    
    // Verify helper methods return correct values after cleanup
    expect(service.eventManager.isPoolMonitored(poolAddress)).toBe(false);
    expect(service.eventManager.getVaultsForPool(poolAddress)).toEqual([]);
    expect(service.eventManager.getMonitoredPools()).not.toContain(poolAddress);
    expect(service.eventManager.getPoolListenerCount()).toBe(0); // No pools monitored after cleanup
    
    console.log('✅ Pool listener cleanup verified:');
    console.log(`   Pool ${poolAddress} no longer monitored`);
    console.log(`   Pool-to-vault mapping cleaned up`);
    console.log(`   Total monitored pools: ${service.eventManager.getPoolListenerCount()}`);
  });

  it('should clean up emergency exit baseline when vault is revoked', async () => {
    // Get the strategy instance
    const strategy = service.strategies['bob']; // BabyStepsStrategy
    
    // Verify emergency exit baseline was removed
    expect(strategy.emergencyExitBaseline[testVault.vaultAddress]).toBeUndefined();
    
    console.log('✅ Emergency exit baseline cleanup verified:');
    console.log(`   Baseline removed for vault ${testVault.vaultAddress}`);
  });

  it('should remove vault from service monitoring after revocation', async () => {
    // Verify vault is no longer in VaultDataService cache
    const hasVault = service.vaultDataService.hasVault(testVault.vaultAddress);
    expect(hasVault).toBe(false);

    // Verify vault locks are cleared
    expect(service.vaultLocks[testVault.vaultAddress.toLowerCase()]).toBeUndefined();

    // Verify BabyStepsStrategy's lastPositionCheck cache is cleaned up
    const bobStrategy = service.strategies.bob;
    expect(bobStrategy).toBeDefined();
    
    // Check that no lastPositionCheck entries exist for this vault
    const vaultPrefix = testVault.vaultAddress.toLowerCase() + '-';
    const vaultCheckEntries = Object.keys(bobStrategy.lastPositionCheck).filter(key => 
      key.toLowerCase().startsWith(vaultPrefix)
    );
    expect(vaultCheckEntries).toHaveLength(0);

    console.log('✅ Vault successfully removed from service monitoring');
    console.log('✅ Strategy cache cleaned up - no position check entries remain');
  });
});
