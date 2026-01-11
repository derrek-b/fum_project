/**
 * @fileoverview Integration tests for retry queue cleanup
 * Tests the 3 exit paths from the retry queue (failedVaults):
 * 1. Recovery - successful retry removes vault from queue
 * 2. Blacklist - unrecoverable error removes vault from queue and blacklists
 * 3. Auth revoked - offboarding removes vault from queue
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Retry Queue Cleanup', () => {
  let testEnv;
  let testConfig;
  let tempDir;
  let service;
  let testVault;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Cleanup Test Vault',
        automationServiceAddress: testConfig.automationServiceAddress,
        wrapEthAmount: '5',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '1' }
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 50,
            tickRange: {
              type: 'centered',
              spacing: 10
            }
          }
        ],
        tokenTransfers: {
          'WETH': 50,
          'USDC': 50
        },
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );

    console.log(`Test vault created at: ${testVault.vaultAddress}`);
  }, 120000);

  afterAll(async () => {
    await cleanupTestBlockchain(testEnv);
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    if (service) {
      try {
        if (service.isRunning) {
          await service.stop();
        } else if (service.provider) {
          await service.stop(true);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
      service = null;
    }

    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
      tempDir = null;
    }
  });

  /**
   * Helper to create temp directory for test isolation
   */
  const createTempDir = async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanup-test-'));
    return tempDir;
  };

  /**
   * Helper to create a service with standard test config
   */
  const createTestService = async (ssePort) => {
    const dir = await createTempDir();
    const blacklistPath = path.join(dir, 'blacklist.json');
    const trackingDir = path.join(dir, 'vaults');

    service = new AutomationService({
      automationServiceAddress: testConfig.automationServiceAddress,
      chainId: 1337,
      wsUrl: testConfig.wsUrl,
      blacklistFilePath: blacklistPath,
      trackingDataDir: trackingDir,
      ssePort,
      debug: true,
      retryIntervalMs: 999999999  // Effectively disabled - we'll call manually
    });

    return { service, dir, blacklistPath, trackingDir };
  };

  /**
   * Helper to set up event tracking
   */
  const setupEventTracking = (service) => {
    const events = {
      vaultFailed: [],
      vaultRecovered: [],
      vaultBlacklisted: [],
      vaultOffboarded: []
    };

    service.eventManager.subscribe('VaultFailed', (data) => {
      console.log(`  [EVENT] VaultFailed: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultFailed.push(data);
    });

    service.eventManager.subscribe('VaultRecovered', (data) => {
      console.log(`  [EVENT] VaultRecovered: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultRecovered.push(data);
    });

    service.eventManager.subscribe('VaultBlacklisted', (data) => {
      console.log(`  [EVENT] VaultBlacklisted: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultBlacklisted.push(data);
    });

    service.eventManager.subscribe('VaultOffboarded', (data) => {
      console.log(`  [EVENT] VaultOffboarded: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultOffboarded.push(data);
    });

    return events;
  };

  // ============================================================================
  // Exit Path 1: Recovery - successful retry cleans up retry queue
  // ============================================================================
  describe('Recovery Cleanup', () => {
    it('should remove vault from failedVaults after successful retry', async () => {
      await createTestService(3130);
      const events = setupEventTracking(service);

      let getVaultCallCount = 0;

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
        vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
          if (addr === testVault.vaultAddress) {
            getVaultCallCount++;
            console.log(`  [SPY] getVault for testVault call #${getVaultCallCount}`);

            // Fail first call, succeed on second
            if (getVaultCallCount === 1) {
              throw new Error('NETWORK_ERROR: Connection refused');
            }
          }
          return realGetVault(addr, forceRefresh);
        });
      };

      // Start service - vault should fail and enter retry queue
      console.log('Starting service (expecting initial failure)...');
      await service.start();

      // Verify vault IS in failedVaults
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      console.log(`Vault in failedVaults: ${service.failedVaults.has(testVault.vaultAddress)}`);

      // Trigger retry - should succeed
      console.log('Triggering retry (expecting success)...');
      await service.retryFailedVaults();

      // Verify vault is NO LONGER in failedVaults
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      console.log(`Vault in failedVaults after recovery: ${service.failedVaults.has(testVault.vaultAddress)}`);

      // Verify VaultRecovered event was emitted
      const recoveredEvent = events.vaultRecovered.find(e => e.vaultAddress === testVault.vaultAddress);
      expect(recoveredEvent).toBeDefined();

      // Verify vault is NOT blacklisted
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);
    }, 60000);
  });

  // ============================================================================
  // Exit Path 2: Blacklist - unrecoverable error cleans up retry queue
  // ============================================================================
  describe('Blacklist Cleanup', () => {
    it('should remove vault from failedVaults when blacklisted via unrecoverable error', async () => {
      await createTestService(3131);
      const events = setupEventTracking(service);

      let getVaultCallCount = 0;

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
        vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
          if (addr === testVault.vaultAddress) {
            getVaultCallCount++;
            console.log(`  [SPY] getVault for testVault call #${getVaultCallCount}`);

            // First call: recoverable error -> enters retry queue
            if (getVaultCallCount === 1) {
              throw new Error('NETWORK_ERROR: Connection refused');
            }
            // Second call (retry): unrecoverable error -> blacklist
            if (getVaultCallCount === 2) {
              throw new Error('UNRECOVERABLE ERROR: Vault configuration is invalid');
            }
          }
          return realGetVault(addr, forceRefresh);
        });
      };

      // Start service - vault should fail with recoverable error
      console.log('Starting service (expecting recoverable failure)...');
      await service.start();

      // Verify vault IS in failedVaults
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);
      console.log(`Vault in failedVaults: ${service.failedVaults.has(testVault.vaultAddress)}`);
      console.log(`Vault blacklisted: ${service.isVaultBlacklisted(testVault.vaultAddress)}`);

      // Trigger retry - should hit unrecoverable error and blacklist
      console.log('Triggering retry (expecting unrecoverable error -> blacklist)...');
      await service.retryFailedVaults();

      // Verify vault is NO LONGER in failedVaults
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      console.log(`Vault in failedVaults after blacklist: ${service.failedVaults.has(testVault.vaultAddress)}`);

      // Verify vault IS blacklisted
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
      console.log(`Vault blacklisted: ${service.isVaultBlacklisted(testVault.vaultAddress)}`);

      // Verify VaultBlacklisted event was emitted
      const blacklistEvent = events.vaultBlacklisted.find(e => e.vaultAddress === testVault.vaultAddress);
      expect(blacklistEvent).toBeDefined();

      // Verify vaultTripHistory is cleaned up
      expect(service.vaultTripHistory.has(testVault.vaultAddress)).toBe(false);
    }, 60000);
  });

  // ============================================================================
  // Exit Path 3: Auth Revoked - offboarding cleans up retry queue
  // ============================================================================
  describe('Auth Revoked Cleanup', () => {
    it('should remove vault from failedVaults when auth is revoked', async () => {
      await createTestService(3132);
      const events = setupEventTracking(service);

      let getVaultCallCount = 0;

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
        vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
          if (addr === testVault.vaultAddress) {
            getVaultCallCount++;
            console.log(`  [SPY] getVault for testVault call #${getVaultCallCount}`);

            // Always fail with recoverable error to keep vault in retry queue
            throw new Error('NETWORK_ERROR: Connection refused');
          }
          return realGetVault(addr, forceRefresh);
        });
      };

      // Start service - vault should fail and enter retry queue
      console.log('Starting service (expecting failure)...');
      await service.start();

      // Verify vault IS in failedVaults
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);
      console.log(`Vault in failedVaults: ${service.failedVaults.has(testVault.vaultAddress)}`);

      // Simulate auth revocation by calling the VaultAuthRevoked handler
      // This happens when the vault owner revokes automation service as executor
      console.log('Simulating auth revocation...');

      // Set up promise to wait for VaultOffboarded event (end of handler)
      const offboardedPromise = new Promise(resolve => {
        let unsubscribe;
        const handler = (data) => {
          if (data.vaultAddress === testVault.vaultAddress) {
            unsubscribe();  // subscribe() returns an unsubscribe function
            resolve(data);
          }
        };
        unsubscribe = service.eventManager.subscribe('VaultOffboarded', handler);
      });

      // Emit the revocation event
      service.eventManager.emit('VaultAuthRevoked', {
        vaultAddress: testVault.vaultAddress
      });

      // Wait for the handler to complete
      const offboardData = await offboardedPromise;

      // Verify vault is NO LONGER in failedVaults
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      console.log(`Vault in failedVaults after revoke: ${service.failedVaults.has(testVault.vaultAddress)}`);

      // Verify vault is NOT blacklisted (revocation is not a failure)
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);
      console.log(`Vault blacklisted: ${service.isVaultBlacklisted(testVault.vaultAddress)}`);

      // Verify VaultOffboarded event was emitted with removedFromRetryQueue flag
      expect(offboardData).toBeDefined();
      expect(offboardData.removedFromRetryQueue).toBe(true);
    }, 60000);
  });
});
