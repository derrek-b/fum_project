/**
 * @fileoverview Integration tests for retry queue cleanup
 * Tests the 3 exit paths from the retry queue (failedVaults):
 * 1. Recovery - successful retry removes vault from queue
 * 2. Blacklist - unrecoverable error removes vault from queue and blacklists
 * 3. Auth revoked - offboarding removes vault from queue
 *
 * Also tests listener removal failure handling:
 * 4. Listener removal failure - tracked in failedRemovals, retried successfully
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { UnrecoverableError } from '../../../src/utils/errors.js';
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
        // Always force stop to clean up all resources
        await service.stop(true);
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
      trackingFailuresFilePath: path.join(dir, 'trackingFailures.json'),
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
      vaultOffboarded: [],
      vaultRetryTrip: []
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

    service.eventManager.subscribe('VaultRetryTrip', (data) => {
      console.log(`  [EVENT] VaultRetryTrip: ${data.vaultAddress?.slice(0, 10)}... trip #${data.tripCount}`);
      events.vaultRetryTrip.push(data);
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
              throw new UnrecoverableError('Vault configuration is invalid');
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

  // ============================================================================
  // Listener Removal Failure - tracked for retry
  // ============================================================================
  describe('Listener Removal Failure', () => {
    it('should track failed listener removal and succeed on retry', async () => {
      await createTestService(3305);

      // Start service - vault should load successfully
      await service.start();

      // Verify vault is tracked and has listeners
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
      console.log(`Vault tracked: ${testVault.vaultAddress}`);

      // Check that vault has swap event listeners registered
      const allListeners = Object.keys(service.eventManager.listeners);
      const vaultListenerKeys = allListeners.filter(key =>
        key.toLowerCase().includes(testVault.vaultAddress.toLowerCase())
      );
      const initialListenerCount = vaultListenerKeys.length;
      console.log(`Initial listeners for vault: ${initialListenerCount}`);
      console.log(`  Keys: ${vaultListenerKeys.join(', ')}`);
      expect(initialListenerCount).toBeGreaterThan(0);

      // Mock removeListener to fail for vault's listeners
      let removeListenerCallCount = 0;
      const realRemoveListener = service.eventManager.removeListener.bind(service.eventManager);
      vi.spyOn(service.eventManager, 'removeListener').mockImplementation(async (key) => {
        // Only fail for the test vault's listeners
        if (key.includes(testVault.vaultAddress.toLowerCase())) {
          removeListenerCallCount++;
          console.log(`  [MOCK] removeListener call #${removeListenerCallCount} for ${key} - FAILING`);

          // Simulate the tracking that happens in the real implementation
          const listener = service.eventManager.listeners[key];
          if (listener) {
            service.eventManager.trackFailedListenerRemoval(key, listener, new Error('RPC_ERROR: Provider disconnected'));
          }
          return false;  // Return false to indicate failure
        }
        return realRemoveListener(key);
      });

      // Trigger cleanup via blacklisting (which calls offboardVault -> removeAllVaultListeners)
      console.log('Triggering blacklist to initiate listener cleanup...');
      await service.blacklistVault(testVault.vaultAddress, 'Test blacklist for listener removal');

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify failures were tracked
      const failedRemovals = service.eventManager.getFailedRemovals();
      console.log(`Failed removals tracked: ${failedRemovals.size}`);
      expect(failedRemovals.size).toBeGreaterThan(0);

      // Verify the tracked failures are for our vault
      for (const [key, data] of failedRemovals.entries()) {
        expect(key.toLowerCase()).toContain(testVault.vaultAddress.toLowerCase());
        expect(data.lastError).toContain('Provider disconnected');
        console.log(`  Tracked failure: ${key} - ${data.lastError}`);
      }

      // Restore the real removeListener for retry
      vi.spyOn(service.eventManager, 'removeListener').mockImplementation(realRemoveListener);

      // Retry failed removals
      console.log('Retrying failed listener removals...');
      const retryResults = await service.eventManager.retryFailedRemovals();
      console.log(`Retry results: ${retryResults.succeeded} succeeded, ${retryResults.stillFailing} still failing`);

      // Verify retries succeeded
      expect(retryResults.succeeded).toBeGreaterThan(0);
      expect(retryResults.stillFailing).toBe(0);

      // Verify failed removals map is now empty
      const remainingFailures = service.eventManager.getFailedRemovals();
      expect(remainingFailures.size).toBe(0);
      console.log('All listener removals succeeded on retry');
    }, 60000);
  });

  // ============================================================================
  // Trip History Decay - lazy pruning when vault fails again after 24+ hours
  // ============================================================================
  describe('Trip History Decay', () => {
    it('should reset trip count when vault fails again after 24+ hours of stability', async () => {
      await createTestService(3306);
      const events = setupEventTracking(service);

      // Track call count - fail on calls 1 and 3, succeed on call 2
      let getVaultCallCount = 0;
      const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
          if (addr.toLowerCase() === testVault.vaultAddress.toLowerCase()) {
            getVaultCallCount++;
            console.log(`  🔧 getVault call #${getVaultCallCount}`);

            // Fail on call 1 (initial) and call 3 (after recovery)
            if (getVaultCallCount === 1 || getVaultCallCount === 3) {
              throw new Error('RPC_ERROR: Connection refused');
            }
          }
          return realGetVault(addr, forceRefresh);
        });
      };

      // Start service → vault fails → enters retry queue (trip #1)
      console.log('=== Step 1: Start service, vault fails (trip #1) ===');
      await service.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      const normalizedAddress = testVault.vaultAddress;

      // Verify vault is in retry queue with trip recorded
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      expect(service.vaultTripHistory.has(normalizedAddress)).toBe(true);
      const historyAfterFirstFail = service.vaultTripHistory.get(normalizedAddress);
      expect(historyAfterFirstFail.trips.length).toBe(1);
      console.log(`🔍 Trip count after first failure: ${historyAfterFirstFail.trips.length}`);

      // Retry → vault recovers (call #2 succeeds)
      console.log('\n=== Step 2: Retry succeeds, vault recovers ===');
      await service.retryFailedVaults();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify vault recovered
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      expect(events.vaultRecovered.length).toBe(1);
      console.log(`🔍 Vault recovered: ${events.vaultRecovered.length === 1}`);

      // Trip history still exists (hasn't decayed yet - lazy pruning)
      expect(service.vaultTripHistory.has(normalizedAddress)).toBe(true);
      console.log(`🔍 Trip history still exists (waiting for decay): ${service.vaultTripHistory.has(normalizedAddress)}`);

      // Simulate 25 hours passing by backdating the trip timestamp
      console.log('\n=== Step 3: Simulate 25 hours passing ===');
      const history = service.vaultTripHistory.get(normalizedAddress);
      const twentyFiveHoursAgo = Date.now() - (25 * 60 * 60 * 1000);
      history.trips[0].timestamp = twentyFiveHoursAgo;
      console.log(`🔍 Backdated trip to: ${new Date(twentyFiveHoursAgo).toISOString()}`);

      // Trigger another failure via swap event (call #3 fails)
      console.log('\n=== Step 4: Vault fails again - should start fresh ===');
      service.eventManager.emit('SwapEventDetected', {
        vaultAddress: testVault.vaultAddress,
        poolId: 'test-pool-id',
        platform: 'uniswapV3',
        log: {}
      });
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify vault is back in retry queue
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      console.log(`🔍 Vault back in failedVaults: ${service.failedVaults.has(testVault.vaultAddress)}`);

      // KEY CHECK: Trip count should be 1 (old trip was pruned, this is a fresh start)
      const historyAfterDecay = service.vaultTripHistory.get(normalizedAddress);
      expect(historyAfterDecay.trips.length).toBe(1);
      console.log(`🔍 Trip count after decay + new failure: ${historyAfterDecay.trips.length}`);

      // Verify VaultRetryTrip event shows trip #1 (not #2)
      const lastTripEvent = events.vaultRetryTrip.filter(
        e => e.vaultAddress.toLowerCase() === testVault.vaultAddress.toLowerCase()
      ).pop();
      expect(lastTripEvent).toBeDefined();
      expect(lastTripEvent.tripCount).toBe(1);
      console.log(`🔍 VaultRetryTrip shows trip #${lastTripEvent.tripCount}`);

      console.log('Trip history lazy decay test passed');
    }, 60000);

    it('should accumulate trips when failures happen within 24 hours', async () => {
      await createTestService(3307);
      const events = setupEventTracking(service);

      // Mock to alternate: fail, succeed, fail, succeed...
      let getVaultCallCount = 0;
      const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);

      const originalInitialize = service.initialize.bind(service);
      service.initialize = async function() {
        await originalInitialize();

        vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
          if (addr.toLowerCase() === testVault.vaultAddress.toLowerCase()) {
            getVaultCallCount++;
            console.log(`  🔧 getVault call #${getVaultCallCount}`);

            // Odd calls fail, even calls succeed
            if (getVaultCallCount % 2 === 1) {
              throw new Error('RPC_ERROR: Connection refused');
            }
          }
          return realGetVault(addr, forceRefresh);
        });
      };

      // Trip 1: Initial failure
      console.log('=== Trip 1: Initial failure ===');
      await service.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(events.vaultRetryTrip.length).toBe(1);
      expect(events.vaultRetryTrip[0].tripCount).toBe(1);

      // Recovery
      console.log('=== Recovery 1 ===');
      await service.retryFailedVaults();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Trip 2: Fail again (within 24h - trips accumulate)
      console.log('=== Trip 2: Fail again (within 24h) ===');
      service.eventManager.emit('SwapEventDetected', {
        vaultAddress: testVault.vaultAddress,
        poolId: 'test-pool-id',
        platform: 'uniswapV3',
        log: {}
      });
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(events.vaultRetryTrip.length).toBe(2);
      expect(events.vaultRetryTrip[1].tripCount).toBe(2);
      console.log(`🔍 Trip count: ${events.vaultRetryTrip[1].tripCount} (should be 2)`);

      // Recovery
      console.log('=== Recovery 2 ===');
      await service.retryFailedVaults();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Trip 3: Fail again (still within 24h)
      console.log('=== Trip 3: Fail again (still within 24h) ===');
      service.eventManager.emit('SwapEventDetected', {
        vaultAddress: testVault.vaultAddress,
        poolId: 'test-pool-id',
        platform: 'uniswapV3',
        log: {}
      });
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(events.vaultRetryTrip.length).toBe(3);
      expect(events.vaultRetryTrip[2].tripCount).toBe(3);
      console.log(`🔍 Trip count: ${events.vaultRetryTrip[2].tripCount} (should be 3)`);

      console.log('Trip accumulation test passed');
    }, 90000);
  });
});
