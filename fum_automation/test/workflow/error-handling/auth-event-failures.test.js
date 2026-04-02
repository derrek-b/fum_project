/**
 * @fileoverview Test VaultAuthEventFailed handling
 *
 * VaultAuthEventFailed fires when the ExecutorChanged grant event's RPC call to
 * fetch the executor index fails. The vault is unmanaged (new authorization) and
 * gets tracked for retry so the service can attempt setup on the next retry cycle.
 *
 * Tests:
 * 1. RPC failure during executor index lookup → vault tracked for retry
 * 2. Recovery on retry → vault successfully onboarded
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { waitForCondition } from '../../helpers/wait-utils.js';

// Flag to control getVaultExecutorIndex failure — toggled by the test
let shouldFailExecutorIndex = false;

vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    getVaultExecutorIndex: vi.fn().mockImplementation(async (...args) => {
      if (shouldFailExecutorIndex) {
        throw new Error('NETWORK_ERROR: RPC timeout during executor index lookup');
      }
      return actual.getVaultExecutorIndex(...args);
    }),
    // selectBestPool calls getPoolTVLAverage which hits the Graph API — not available on fork
    getPoolTVLAverage: vi.fn().mockImplementation((poolAddress) => {
      const address = poolAddress.toLowerCase();
      if (address === '0xc6962004f452be9203591991d15f6b388e09e8d0') {
        return Promise.resolve(100000000); // WETH/USDC 500bp
      }
      return Promise.resolve(10000000);
    })
  };
});

describe('VaultAuthEventFailed - Grant Processing Failure', () => {
  let testEnv;
  let service;
  let testVault;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    console.log('Test blockchain connected');
  }, 120000);

  afterAll(async () => {
    shouldFailExecutorIndex = false;
    await cleanupTestBlockchain(testEnv);
  });

  afterEach(async () => {
    shouldFailExecutorIndex = false;
    if (service?.isRunning) {
      await service.stop(true);
    }
    service = null;
  });

  it('should track vault for retry when executor index lookup fails during grant event', async () => {
    // Track events
    const events = {
      vaultAuthEventFailed: [],
      vaultAuthGranted: [],
      vaultFailed: [],
      vaultRecovered: [],
      vaultOnboarded: []
    };

    service = new AutomationService({
      ...testEnv.testConfig,
      retryIntervalMs: 999999999  // Disable automatic retries — we'll call manually
    });

    service.eventManager.subscribe('VaultAuthEventFailed', (data) => {
      console.log(`  [EVENT] VaultAuthEventFailed: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultAuthEventFailed.push(data);
    });

    service.eventManager.subscribe('VaultAuthGranted', (data) => {
      console.log(`  [EVENT] VaultAuthGranted: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultAuthGranted.push(data);
    });

    service.eventManager.subscribe('VaultFailed', (data) => {
      console.log(`  [EVENT] VaultFailed: ${data.vaultAddress?.slice(0, 10)}... source=${data.source}`);
      events.vaultFailed.push(data);
    });

    service.eventManager.subscribe('VaultRecovered', (data) => {
      console.log(`  [EVENT] VaultRecovered: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultRecovered.push(data);
    });

    service.eventManager.subscribe('VaultOnboarded', (data) => {
      console.log(`  [EVENT] VaultOnboarded: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultOnboarded.push(data);
    });

    // Start service with no vaults
    await service.start();
    expect(service.vaultDataService.getAllVaults().length).toBe(0);

    // Enable failure — the ExecutorChanged grant handler will fail
    // when it tries to fetch the executor index for ownership verification
    shouldFailExecutorIndex = true;

    // Create vault on-chain — triggers ExecutorChanged event
    console.log('Creating test vault (will trigger ExecutorChanged → VaultAuthEventFailed)...');
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Auth Event Failure Test',
        wrapEthAmount: '5',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '2' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 50,
          tickRange: { type: 'centered', spacing: 10 }
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Test vault created: ${testVault.vaultAddress}`);

    // Wait for VaultFailed with source='auth_event'
    // (VaultAuthEventFailed handler calls trackFailedVault which emits VaultFailed)
    await waitForCondition(
      () => events.vaultFailed.some(
        e => e.vaultAddress === testVault.vaultAddress && e.source === 'auth_event'
      ),
      30000,
      500
    );

    // VaultAuthGranted should NOT have fired (grant processing failed before emitting it)
    expect(events.vaultAuthGranted.length).toBe(0);

    // VaultAuthEventFailed should have fired
    expect(events.vaultAuthEventFailed.length).toBeGreaterThan(0);
    expect(events.vaultAuthEventFailed[0].vaultAddress).toBe(testVault.vaultAddress);

    // Vault should be in retry queue (not blacklisted)
    expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
    expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);

    const failEvent = events.vaultFailed.find(e => e.vaultAddress === testVault.vaultAddress);
    expect(failEvent.source).toBe('auth_event');

    // Disable failure and trigger recovery
    shouldFailExecutorIndex = false;
    console.log('Triggering retry for recovery...');
    await service.retryFailedVaults();

    // Wait for recovery — retryFailedVaults calls setupVault which does full init
    await waitForCondition(
      () => !service.failedVaults.has(testVault.vaultAddress),
      60000,
      1000
    );

    // Vault should have recovered and be fully set up
    expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
    expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);
    expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);

    const recoveredEvent = events.vaultRecovered.find(e => e.vaultAddress === testVault.vaultAddress);
    expect(recoveredEvent).toBeDefined();

    console.log('Auth event failure + recovery test passed');
  }, 240000);
});
