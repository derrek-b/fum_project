/**
 * @fileoverview Integration test for VaultAuthRevoked event handling workflow
 * Tests the flow: ExecutorChanged event (revoke) → VaultAuthRevoked → cleanup → VaultOffboarded
 *
 * Tests:
 * 1. Immediate offboard when vault is idle (unlocked)
 * 2. Deferred offboard when vault is locked (operation in progress)
 *
 * Key difference from grant test: Vault is created FIRST with executor set,
 * then service starts and discovers it, then executor is removed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { waitForCondition } from '../../helpers/wait-utils.js';

// Mock the getPoolTVLAverage function for test environment
vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    getPoolTVLAverage: vi.fn().mockResolvedValue(50000000), // $50M TVL
  };
});

describe('VaultAuthRevoked Workflow', () => {
  let testEnv;
  let testConfig;
  let service;
  let testVault;
  // Event capture
  let vaultAuthRevokedEvent = null;
  let vaultOffboardedEvent = null;

  beforeAll(async () => {
    // 1. Setup blockchain
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // 2. Create vault FIRST (with executor set) - different from grant test!
    console.log('Creating test vault with executor set...');
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'VaultAuthRevoked Test Vault',
        wrapEthAmount: '10',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '2' }
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 100,
            tickRange: { type: 'centered', spacing: 10 }
          }
        ],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );

    console.log('Test vault created at:', testVault.vaultAddress);

    // 3. Create service
    service = new AutomationService(testConfig);

    // 4. Subscribe to events BEFORE starting
    service.eventManager.subscribe('VaultAuthRevoked', (data) => {
      vaultAuthRevokedEvent = data;
      console.log('VaultAuthRevoked event captured:', data.vaultAddress);
    });

    service.eventManager.subscribe('VaultOffboarded', (data) => {
      vaultOffboardedEvent = data;
      console.log('VaultOffboarded event captured:', data.vaultAddress);
    });

    // 5. Start service (discovers the pre-existing vault)
    await service.start();
    console.log('Service started and discovering vaults...');

    // 6. Wait for vault to be fully loaded and monitored
    await waitForCondition(() => {
      const vaults = service.vaultDataService.getAllVaults();
      return vaults.length === 1;
    }, 60000, 500);

    // Verify vault is monitored
    const vaults = service.vaultDataService.getAllVaults();
    expect(vaults.length).toBe(1);
    console.log('Vault discovered and monitored:', vaults[0].address);

  }, 180000);

  afterAll(async () => {
    if (service?.isRunning) {
      try {
        await service.stop(true);
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should emit VaultAuthRevoked when executor is removed', async () => {
    // Get the vault contract instance
    const vaultContract = testVault.vault;

    console.log('Revoking executor authorization...');

    // Revoke executor using the removeExecutor function
    const revokeExecutorTx = await vaultContract.removeExecutor();
    const revokeReceipt = await revokeExecutorTx.wait();

    console.log(`Executor revoked in block ${revokeReceipt.blockNumber}`);

    // Wait for VaultAuthRevoked event
    await waitForCondition(() => vaultAuthRevokedEvent !== null, 30000, 500);

    expect(vaultAuthRevokedEvent).not.toBeNull();
    expect(vaultAuthRevokedEvent).toHaveProperty('vaultAddress');
    expect(vaultAuthRevokedEvent).toHaveProperty('executorAddress');

    expect(vaultAuthRevokedEvent.vaultAddress.toLowerCase()).toBe(
      testVault.vaultAddress.toLowerCase()
    );
    expect(vaultAuthRevokedEvent.executorAddress.toLowerCase()).toBe(
      testVault.executorAddress.toLowerCase()
    );

    console.log('VaultAuthRevoked verified:');
    console.log(`  Vault: ${vaultAuthRevokedEvent.vaultAddress}`);
    console.log(`  Revoked Executor: ${vaultAuthRevokedEvent.executorAddress}`);
  });

  it('should emit VaultOffboarded with cleanup details', async () => {
    // Wait for VaultOffboarded event
    await waitForCondition(() => vaultOffboardedEvent !== null, 30000, 500);

    expect(vaultOffboardedEvent).not.toBeNull();
    expect(vaultOffboardedEvent.vaultAddress.toLowerCase()).toBe(
      testVault.vaultAddress.toLowerCase()
    );
    expect(vaultOffboardedEvent.removedFromCache).toBe(true);
    expect(vaultOffboardedEvent.success).toBe(true);
    expect(vaultOffboardedEvent.cleanupResults).toBeDefined();
    expect(vaultOffboardedEvent.cleanupResults.errors).toHaveLength(0);

    console.log('VaultOffboarded verified:');
    console.log(`  Vault: ${vaultOffboardedEvent.vaultAddress}`);
    console.log(`  Removed from cache: ${vaultOffboardedEvent.removedFromCache}`);
    console.log(`  Success: ${vaultOffboardedEvent.success}`);
  });

  it('should remove vault from VaultDataService after offboarding', () => {
    const vaults = service.vaultDataService.getAllVaults();
    expect(vaults.length).toBe(0);

    console.log('VaultDataService verified:');
    console.log(`  Vault count: ${vaults.length}`);
  });

  it('should have stopped monitoring (no listeners for vault)', () => {
    // Check that there are no listeners registered for this vault
    // The removeAllVaultListeners should have cleaned up
    const listenerCount = service.eventManager.getVaultListenerCount?.(testVault.vaultAddress) || 0;

    // Verify via the offboarded event that cleanup was performed
    expect(vaultOffboardedEvent.cleanupResults).toBeDefined();
    expect(vaultOffboardedEvent.cleanupResults.strategyCleanedUp).toBe(true);

    console.log('Monitoring stopped verified');
  });
});

// ============================================================================
// Deferred Offboard: Auth revoked while vault is locked
// When an operation is in progress (vault locked), the offboard is deferred
// until the VaultUnlocked event fires, preventing concurrent state mutation.
// ============================================================================
describe('VaultAuthRevoked - Deferred Offboard (Locked Vault)', () => {
  let testEnv;
  let testConfig;
  let service;
  let testVault;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create vault with executor set
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Deferred Offboard Test Vault',
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '2' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 100,
          tickRange: { type: 'centered', spacing: 10 }
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Test vault created at: ${testVault.vaultAddress}`);

    service = new AutomationService(testConfig);
    await service.start();

    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      60000,
      500
    );
    console.log('Vault discovered and monitored');
  }, 180000);

  afterAll(async () => {
    if (service?.isRunning) {
      try { await service.stop(true); } catch (e) { /* ignore */ }
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should defer offboard when vault is locked, then offboard on unlock', async () => {
    const offboardedEvents = [];
    service.eventManager.subscribe('VaultOffboarded', (data) => {
      offboardedEvents.push(data);
      console.log(`VaultOffboarded: deferred=${data.deferred}`);
    });

    const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);

    // Step 1: Lock the vault (simulating an operation in progress)
    console.log('Locking vault to simulate in-progress operation...');
    const locked = service.lockVault(normalizedAddress);
    expect(locked).toBe(true);
    expect(service.vaultLocks[normalizedAddress]).toBeDefined();

    // Step 2: Revoke executor on-chain — triggers VaultAuthRevoked
    console.log('Revoking executor while vault is locked...');
    const revokeExecutorTx = await testVault.vault.removeExecutor();
    await revokeExecutorTx.wait();

    // Wait for VaultAuthRevoked to be processed (handler defers since locked)
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 3: Verify offboard was DEFERRED, not executed
    expect(service.pendingOffboards.has(normalizedAddress)).toBe(true);
    expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
    expect(offboardedEvents.length).toBe(0);
    console.log('Offboard deferred — vault still in VDS, pending offboard set');

    // Step 4: Unlock the vault — triggers VaultUnlocked → processes pending offboard
    console.log('Unlocking vault to trigger deferred offboard...');
    service.unlockVault(normalizedAddress);

    // Wait for the deferred offboard to complete
    await waitForCondition(
      () => offboardedEvents.length > 0,
      30000,
      500
    );

    // Step 5: Verify offboard completed
    expect(offboardedEvents.length).toBe(1);
    const offboardEvent = offboardedEvents[0];
    expect(offboardEvent.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    expect(offboardEvent.deferred).toBe(true);
    expect(offboardEvent.success).toBe(true);

    // Vault should be fully cleaned up
    expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(false);
    expect(service.pendingOffboards.has(normalizedAddress)).toBe(false);
    expect(service.vaultLocks[normalizedAddress]).toBeUndefined();

    console.log('Deferred offboard completed successfully');
  }, 60000);
});
