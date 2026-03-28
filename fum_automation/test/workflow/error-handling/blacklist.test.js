/**
 * @fileoverview Integration tests for blacklist management
 * Tests entry and exit scenarios for the vault blacklist:
 *
 * Blacklist Entry (3 tests):
 *   1. UNRECOVERABLE ERROR → immediate blacklist (no retry)
 *   2. Yo-yo trigger (5 trips in 24h) → blacklist
 *   3. Retry timeout (max duration exceeded) → blacklist
 *
 * Blacklist Exit (2 tests):
 *   4. Re-authorization (VaultAuthGranted) → unblacklist
 *   5. Auth revocation (VaultAuthRevoked) → unblacklist
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../src/core/AutomationService.js';
import { UnrecoverableError } from '../../../src/utils/errors.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  expectTrackerAggregates,
  getTransactionsByType
} from '../../helpers/tracker-assertions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Blacklist Management', () => {
  let testEnv;
  let testConfig;
  let tempDir;
  let service;
  let testVault;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create a simple vault - no special position needed for blacklist tests
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Blacklist Test Vault',
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

    console.log(`Blacklist test vault created at: ${testVault.vaultAddress}`);
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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blacklist-test-'));
    return tempDir;
  };

  /**
   * Helper to create a service with standard test config
   */
  const createTestService = async (ssePort, overrides = {}) => {
    const dir = await createTempDir();

    service = new AutomationService({
      chainId: 1337,
      wsUrl: testConfig.wsUrl,
      dataDir: dir,
      ssePort,
      debug: true,
      retryIntervalMs: 999999999,  // Effectively disabled - we'll call manually
      ...overrides
    });

    return { service, dir, blacklistPath: service.blacklistFilePath, trackingDir: service.trackingDataDir };
  };

  /**
   * Helper to set up event tracking
   */
  const setupEventTracking = (svc) => {
    const events = {
      vaultFailed: [],
      vaultRecovered: [],
      vaultBlacklisted: [],
      vaultUnblacklisted: [],
      vaultRetryTrip: [],
      vaultOffboarded: [],
      vaultOnboarded: []
    };

    svc.eventManager.subscribe('VaultFailed', (data) => {
      console.log(`  [EVENT] VaultFailed: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultFailed.push(data);
    });

    svc.eventManager.subscribe('VaultRecovered', (data) => {
      console.log(`  [EVENT] VaultRecovered: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultRecovered.push(data);
    });

    svc.eventManager.subscribe('VaultBlacklisted', (data) => {
      console.log(`  [EVENT] VaultBlacklisted: ${data.vaultAddress?.slice(0, 10)}... reason=${data.reason?.slice(0, 30)}...`);
      events.vaultBlacklisted.push(data);
    });

    svc.eventManager.subscribe('VaultUnblacklisted', (data) => {
      console.log(`  [EVENT] VaultUnblacklisted: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultUnblacklisted.push(data);
    });

    svc.eventManager.subscribe('VaultRetryTrip', (data) => {
      console.log(`  [EVENT] VaultRetryTrip: ${data.vaultAddress?.slice(0, 10)}... trip #${data.tripCount}`);
      events.vaultRetryTrip.push(data);
    });

    svc.eventManager.subscribe('VaultOffboarded', (data) => {
      console.log(`  [EVENT] VaultOffboarded: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultOffboarded.push(data);
    });

    svc.eventManager.subscribe('VaultOnboarded', (data) => {
      console.log(`  [EVENT] VaultOnboarded: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultOnboarded.push(data);
    });

    return events;
  };

  // ==========================================================================
  // BLACKLIST ENTRY TESTS
  // ==========================================================================
  describe('Blacklist Entry', () => {

    // ------------------------------------------------------------------------
    // Test 1: UNRECOVERABLE ERROR → Immediate Blacklist
    // ------------------------------------------------------------------------
    it('should immediately blacklist vault on UNRECOVERABLE ERROR (no retry)', async () => {
      await createTestService(3300);
      const events = setupEventTracking(service);

      // Mock getVault to throw UNRECOVERABLE ERROR during setup
      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr) => {
        if (addr.toLowerCase() === testVault.vaultAddress.toLowerCase()) {
          throw new UnrecoverableError('Strategy bob not found');
        }
        return null;
      });

      // Start service - vault setup should fail with unrecoverable error
      console.log('Starting service with mocked UNRECOVERABLE ERROR...');
      await service.start();

      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify vault is blacklisted immediately
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
      console.log(`🔍 Vault blacklisted: ${service.isVaultBlacklisted(testVault.vaultAddress)}`);

      // Verify vault is NOT in retry queue (never entered)
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      console.log(`🔍 Vault in failedVaults: ${service.failedVaults.has(testVault.vaultAddress)}`);

      // Verify VaultBlacklisted event was emitted with correct reason
      const blacklistEvent = events.vaultBlacklisted.find(
        e => e.vaultAddress.toLowerCase() === testVault.vaultAddress.toLowerCase()
      );
      expect(blacklistEvent).toBeDefined();
      expect(blacklistEvent.reason).toContain('Strategy bob not found');
      console.log(`🔍 Blacklist reason: ${blacklistEvent.reason}`);

      // Verify no VaultFailed event (didn't enter retry queue)
      const failEvent = events.vaultFailed.find(
        e => e.vaultAddress.toLowerCase() === testVault.vaultAddress.toLowerCase()
      );
      expect(failEvent).toBeUndefined();

      // Verify trip history is clean (no trips recorded)
      expect(service.vaultTripHistory.has(testVault.vaultAddress)).toBe(false);

      // --- Tracker assertions ---
      // handleVaultBlacklisted creates metadata from scratch (vault never set up)
      const metadata = expectTrackerAggregates(service, testVault.vaultAddress, {
        blacklistCount: 1
      });
      expect(metadata.baseline).toBeNull();

      // Transaction log: only VaultBlacklisted (no retry)
      const blacklistTxs = await getTransactionsByType(service, testVault.vaultAddress, 'VaultBlacklisted');
      expect(blacklistTxs.length).toBe(1);
      expect(blacklistTxs[0].reason).toContain('Strategy bob not found');

      const retryTxs = await getTransactionsByType(service, testVault.vaultAddress, 'VaultRetryQueued');
      expect(retryTxs.length).toBe(0);
    }, 60000);

    // ------------------------------------------------------------------------
    // Test 2: Yo-yo Trigger (5 trips in 24h) → Blacklist
    // ------------------------------------------------------------------------
    it('should blacklist vault after 5 retry queue trips (yo-yo detection)', async () => {
      await createTestService(3301);
      const events = setupEventTracking(service);

      // Flag-based mock: initial start fails, retries succeed.
      // Swap events fail independently (log validation), so getVault parity doesn't matter.
      let getVaultShouldFail = true;
      const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);

      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
        if (addr.toLowerCase() === testVault.vaultAddress.toLowerCase()) {
          console.log(`  🔧 getVault for test vault, shouldFail=${getVaultShouldFail}`);
          if (getVaultShouldFail) {
            throw new Error('RPC_ERROR: Connection refused');
          }
        }
        return realGetVault(addr, forceRefresh);
      });

      // Step 1: Start service → getVault fails → trip 1, enters queue
      console.log('\n=== Step 1: service.start() - expect fail (trip 1) ===');
      await service.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(events.vaultRetryTrip.length).toBe(1);
      expect(events.vaultRetryTrip[0].tripCount).toBe(1);
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);

      // Step 2: Retry → getVault succeeds → VaultRecovered
      getVaultShouldFail = false;
      console.log('\n=== Step 2: retryFailedVaults() - expect success (recover) ===');
      await service.retryFailedVaults();
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(events.vaultRecovered.length).toBe(1);
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);

      // Steps 3-8: Swap events fail (log validation), retries succeed
      for (let trip = 2; trip <= 4; trip++) {
        // Emit SwapEventDetected → fails → enters queue → trip N
        console.log(`\n=== Step ${trip * 2 - 1}: Emit SwapEventDetected - expect fail (trip ${trip}) ===`);
        service.eventManager.emit('SwapEventDetected', {
          vaultAddress: testVault.vaultAddress,
          poolId: 'test-pool-id',
          platform: 'uniswapV3',
          log: {}
        });
        await new Promise(resolve => setTimeout(resolve, 500));

        expect(events.vaultRetryTrip.length).toBe(trip);
        expect(events.vaultRetryTrip[trip - 1].tripCount).toBe(trip);
        expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);

        // Retry → succeeds → VaultRecovered
        console.log(`\n=== Step ${trip * 2}: retryFailedVaults() - expect success (recover) ===`);
        await service.retryFailedVaults();
        await new Promise(resolve => setTimeout(resolve, 500));

        expect(events.vaultRecovered.length).toBe(trip);
        expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
      }

      // Step 9: Final swap event → fails → trip 5 → BLACKLIST
      console.log('\n=== Step 9: Emit SwapEventDetected - expect fail (trip 5) → BLACKLIST ===');
      service.eventManager.emit('SwapEventDetected', {
        vaultAddress: testVault.vaultAddress,
        poolId: 'test-pool-id',
        platform: 'uniswapV3',
        log: {}
      });
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify blacklisted
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
      console.log(`🔍 Vault blacklisted: ${service.isVaultBlacklisted(testVault.vaultAddress)}`);

      // Verify 5 trip events
      expect(events.vaultRetryTrip.length).toBe(5);
      expect(events.vaultRetryTrip[4].tripCount).toBe(5);

      // Verify 4 recovery events
      expect(events.vaultRecovered.length).toBe(4);

      // Verify VaultBlacklisted event with correct reason
      const blacklistEvent = events.vaultBlacklisted.find(
        e => e.vaultAddress.toLowerCase() === testVault.vaultAddress.toLowerCase()
      );
      expect(blacklistEvent).toBeDefined();
      expect(blacklistEvent.reason).toContain('retry trip limit');
      console.log(`🔍 Blacklist reason: ${blacklistEvent.reason}`);

      // Verify vault removed from failedVaults
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);

      // Verify trip history cleaned up
      expect(service.vaultTripHistory.has(testVault.vaultAddress)).toBe(false);

      // --- Tracker assertions ---
      // handleVaultRetryQueued ran 4 times (trips 1-4 emit VaultFailed),
      // trip 5 goes directly to VaultBlacklisted without VaultFailed
      expectTrackerAggregates(service, testVault.vaultAddress, {
        retryCount: 4,
        blacklistCount: 1
      });

      // Transaction log: 4 retries (trip 5 skips VaultFailed), 4 recoveries, 1 blacklist
      const retryQueuedTxs = await getTransactionsByType(service, testVault.vaultAddress, 'VaultRetryQueued');
      expect(retryQueuedTxs.length).toBe(4);

      // VaultRetryQueued transaction fields
      expect(retryQueuedTxs[0].error).toContain('RPC_ERROR');
      expect(retryQueuedTxs[0].source).toBeDefined();
      expect(typeof retryQueuedTxs[0].attempts).toBe('number');

      const retrySuccessTxs = await getTransactionsByType(service, testVault.vaultAddress, 'VaultRetrySuccess');
      expect(retrySuccessTxs.length).toBe(4);

      // VaultRetrySuccess transaction fields
      for (const tx of retrySuccessTxs) {
        expect(typeof tx.timestamp).toBe('number');
      }

      const blacklistTxs = await getTransactionsByType(service, testVault.vaultAddress, 'VaultBlacklisted');
      expect(blacklistTxs.length).toBe(1);
      expect(blacklistTxs[0].reason).toContain('retry trip limit');
    }, 60000);

    // ------------------------------------------------------------------------
    // Test 3: Retry Timeout (max duration exceeded) → Blacklist
    // ------------------------------------------------------------------------
    it('should blacklist vault after exceeding max failure duration', async () => {
      // Use very short timeout for testing (100ms)
      await createTestService(3302, { maxFailureDurationMs: 100 });
      const events = setupEventTracking(service);

      // Mock getVault to always fail with recoverable error
      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr) => {
        if (addr.toLowerCase() === testVault.vaultAddress.toLowerCase()) {
          throw new Error('RPC_ERROR: Connection refused');
        }
        return null;
      });

      // Start service → vault enters retry queue
      console.log('Starting service with mocked RPC error (short timeout)...');
      await service.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify vault is in retry queue
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      console.log(`🔍 Vault in failedVaults: ${service.failedVaults.has(testVault.vaultAddress)}`);

      // Wait for timeout to expire (150ms should be > 100ms threshold)
      console.log('Waiting for timeout to expire...');
      await new Promise(resolve => setTimeout(resolve, 150));

      // Call retryFailedVaults which checks timeout internally
      console.log('Calling retryFailedVaults (should trigger timeout check)...');
      await service.retryFailedVaults();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify vault is blacklisted
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
      console.log(`🔍 Vault blacklisted: ${service.isVaultBlacklisted(testVault.vaultAddress)}`);

      // Verify vault removed from retry queue
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);

      // Verify VaultBlacklisted event was emitted
      const blacklistEvent = events.vaultBlacklisted.find(
        e => e.vaultAddress.toLowerCase() === testVault.vaultAddress.toLowerCase()
      );
      expect(blacklistEvent).toBeDefined();
      console.log(`🔍 Blacklist reason: ${blacklistEvent.reason}`);

      // --- Tracker assertions ---
      // handleVaultRetryQueued ran at least once, then handleVaultBlacklisted on timeout
      const metadata = expectTrackerAggregates(service, testVault.vaultAddress, {
        blacklistCount: 1
      });
      expect(metadata.aggregates.retryCount).toBeGreaterThanOrEqual(1);

      const retryTxs = await getTransactionsByType(service, testVault.vaultAddress, 'VaultRetryQueued');
      expect(retryTxs.length).toBeGreaterThanOrEqual(1);

      const blacklistTxs = await getTransactionsByType(service, testVault.vaultAddress, 'VaultBlacklisted');
      expect(blacklistTxs.length).toBe(1);
    }, 60000);
  });

  // ==========================================================================
  // BLACKLIST EXIT TESTS
  // ==========================================================================
  describe('Blacklist Exit', () => {

    // ------------------------------------------------------------------------
    // Test 4: Re-authorization → Unblacklist
    // ------------------------------------------------------------------------
    it('should unblacklist vault on re-authorization (VaultAuthGranted)', async () => {
      await createTestService(3303);
      const events = setupEventTracking(service);

      // Track call count - fail first, succeed after
      let getVaultCallCount = 0;
      const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);

      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
        if (addr.toLowerCase() === testVault.vaultAddress.toLowerCase()) {
          getVaultCallCount++;
          console.log(`  🔧 getVault call #${getVaultCallCount}`);

          // First call fails with UNRECOVERABLE, subsequent calls succeed
          if (getVaultCallCount === 1) {
            throw new UnrecoverableError('Strategy bob not found');
          }
        }
        return realGetVault(addr, forceRefresh);
      });

      // Start service → vault blacklisted
      console.log('Starting service with mocked UNRECOVERABLE ERROR...');
      await service.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify vault is blacklisted
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
      console.log(`🔍 Vault blacklisted: ${service.isVaultBlacklisted(testVault.vaultAddress)}`);

      // Emit VaultAuthGranted to trigger re-authorization flow
      console.log('Emitting VaultAuthGranted for blacklisted vault...');
      service.eventManager.emit('VaultAuthGranted', {
        vaultAddress: testVault.vaultAddress
      });
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify vault is unblacklisted
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);
      console.log(`🔍 Vault blacklisted after re-auth: ${service.isVaultBlacklisted(testVault.vaultAddress)}`);

      // Verify VaultUnblacklisted event was emitted
      const unblacklistEvent = events.vaultUnblacklisted.find(
        e => e.vaultAddress.toLowerCase() === testVault.vaultAddress.toLowerCase()
      );
      expect(unblacklistEvent).toBeDefined();

      // Verify vault went through onboarding (since mock now succeeds)
      const onboardEvent = events.vaultOnboarded.find(
        e => e.vaultAddress.toLowerCase() === testVault.vaultAddress.toLowerCase()
      );
      expect(onboardEvent).toBeDefined();
      console.log(`🔍 Vault onboarded after re-auth: ${onboardEvent !== undefined}`);

      // --- Tracker assertions ---
      // Baseline capture is skipped on re-onboarding (vault already tracked from blacklist)
      expectTrackerAggregates(service, testVault.vaultAddress, {
        blacklistCount: 1
      });

      // VaultBlacklisted transaction recorded
      const blacklistTxs = await getTransactionsByType(service, testVault.vaultAddress, 'VaultBlacklisted');
      expect(blacklistTxs.length).toBe(1);
    }, 60000);

    // ------------------------------------------------------------------------
    // Test 5: Auth Revocation → Blacklist Preserved
    // ------------------------------------------------------------------------
    it('should preserve blacklist on auth revocation (VaultAuthRevoked)', async () => {
      await createTestService(3304);
      const events = setupEventTracking(service);

      // Mock getVault to fail with UNRECOVERABLE ERROR
      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr) => {
        if (addr.toLowerCase() === testVault.vaultAddress.toLowerCase()) {
          throw new UnrecoverableError('Strategy bob not found');
        }
        return null;
      });

      // Start service → vault blacklisted
      console.log('Starting service with mocked UNRECOVERABLE ERROR...');
      await service.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify vault is blacklisted
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
      console.log(`🔍 Vault blacklisted: ${service.isVaultBlacklisted(testVault.vaultAddress)}`);

      // Emit VaultAuthRevoked to trigger revocation flow
      console.log('Emitting VaultAuthRevoked for blacklisted vault...');
      service.eventManager.emit('VaultAuthRevoked', {
        vaultAddress: testVault.vaultAddress
      });
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify vault is still blacklisted (blacklist preserved on revoke for diagnostic visibility)
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
      console.log(`🔍 Vault blacklisted after revocation: ${service.isVaultBlacklisted(testVault.vaultAddress)}`);

      // Verify VaultOffboarded event was emitted
      const offboardEvent = events.vaultOffboarded.find(
        e => e.vaultAddress.toLowerCase() === testVault.vaultAddress.toLowerCase()
      );
      expect(offboardEvent).toBeDefined();
      console.log(`🔍 Vault offboarded after revocation: ${offboardEvent !== undefined}`);

      // --- Tracker assertions ---
      // Vault was blacklisted but never successfully set up
      const metadata = expectTrackerAggregates(service, testVault.vaultAddress, {
        blacklistCount: 1
      });
      expect(metadata.baseline).toBeNull();

      const blacklistTxs = await getTransactionsByType(service, testVault.vaultAddress, 'VaultBlacklisted');
      expect(blacklistTxs.length).toBe(1);
    }, 60000);
  });

  // ==========================================================================
  // BLACKLIST PERSISTENCE TESTS
  // ==========================================================================
  describe('Blacklist Persistence', () => {

    // ------------------------------------------------------------------------
    // Test 6: Blacklist persists across service restart
    // ------------------------------------------------------------------------
    it('should skip blacklisted vaults on service restart', async () => {
      const { service: svc1, blacklistPath } = await createTestService(3310);
      const events1 = setupEventTracking(svc1);
      service = svc1; // For afterEach cleanup

      // Mock getVault to fail with UNRECOVERABLE ERROR
      vi.spyOn(svc1.vaultDataService, 'getVault').mockImplementation(async (addr) => {
        if (addr.toLowerCase() === testVault.vaultAddress.toLowerCase()) {
          throw new UnrecoverableError('Strategy bob not found');
        }
        return null;
      });

      // Start first service → vault gets blacklisted
      console.log('=== First service: Blacklisting vault ===');
      await svc1.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify vault is blacklisted
      expect(svc1.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
      console.log(`🔍 Vault blacklisted in first service: ${svc1.isVaultBlacklisted(testVault.vaultAddress)}`);

      // Verify blacklist file was written
      const blacklistData = JSON.parse(await fs.readFile(blacklistPath, 'utf-8'));
      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);
      expect(blacklistData[normalizedAddress]).toBeDefined();
      console.log(`🔍 Blacklist file contains vault: ${blacklistData[normalizedAddress] !== undefined}`);

      // Record the blacklist reason for later comparison
      const originalReason = blacklistData[normalizedAddress].reason;
      const originalTimestamp = blacklistData[normalizedAddress].blacklistedAt;
      console.log(`🔍 Original reason: ${originalReason}`);

      // Stop first service
      console.log('Stopping first service...');
      await svc1.stop();
      vi.restoreAllMocks();

      // Create second service with SAME blacklist file path
      console.log('\n=== Second service: Verifying persistence ===');
      const svc2 = new AutomationService({
        chainId: 1337,
        wsUrl: testConfig.wsUrl,
        dataDir: tempDir,  // Same dir — blacklist persists!
        ssePort: 3311,
        debug: true,
        retryIntervalMs: 999999999
      });
      service = svc2; // Update for afterEach cleanup

      const events2 = setupEventTracking(svc2);

      // Start second service
      await svc2.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify vault is still blacklisted (loaded from file)
      expect(svc2.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
      console.log(`🔍 Vault blacklisted in second service: ${svc2.isVaultBlacklisted(testVault.vaultAddress)}`);

      // Verify vault was NOT loaded (not in vault cache)
      expect(svc2.vaultDataService.hasVault(testVault.vaultAddress)).toBe(false);
      console.log(`🔍 Vault in cache: ${svc2.vaultDataService.hasVault(testVault.vaultAddress)}`);

      // Verify reason was preserved
      const preservedInfo = svc2.blacklistedVaults.get(normalizedAddress);
      expect(preservedInfo).toBeDefined();
      expect(preservedInfo.reason).toBe(originalReason);
      expect(preservedInfo.blacklistedAt).toBe(originalTimestamp);
      console.log(`🔍 Reason preserved: ${preservedInfo.reason === originalReason}`);

      // No VaultBlacklisted event on second service (already in file)
      expect(events2.vaultBlacklisted.length).toBe(0);
      console.log(`🔍 No new VaultBlacklisted events: ${events2.vaultBlacklisted.length === 0}`);

      // --- Tracker assertions: data persisted across restart ---
      // Second service's Tracker loaded metadata from disk
      const metadata2 = expectTrackerAggregates(svc2, testVault.vaultAddress, {
        blacklistCount: 1
      });
      expect(metadata2.baseline).toBeNull();

      // Transaction log also persisted
      const blacklistTxs2 = await getTransactionsByType(svc2, testVault.vaultAddress, 'VaultBlacklisted');
      expect(blacklistTxs2.length).toBe(1);

      console.log('Blacklist persistence test passed');
    }, 90000);

    // ------------------------------------------------------------------------
    // Test 7: Blacklist file format verification
    // ------------------------------------------------------------------------
    it('should write blacklist file with correct format', async () => {
      const { blacklistPath } = await createTestService(3312);
      const events = setupEventTracking(service);

      // Mock getVault to fail with UNRECOVERABLE ERROR
      vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr) => {
        if (addr.toLowerCase() === testVault.vaultAddress.toLowerCase()) {
          throw new UnrecoverableError('Invalid vault configuration');
        }
        return null;
      });

      // Start service → vault gets blacklisted
      console.log('Starting service to trigger blacklist...');
      await service.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify vault is blacklisted
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);

      // Read and verify blacklist file format
      const fileContent = await fs.readFile(blacklistPath, 'utf-8');
      console.log('🔍 Blacklist file content:');
      console.log(fileContent);

      const blacklistData = JSON.parse(fileContent);
      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);
      const entry = blacklistData[normalizedAddress];

      // Verify required fields
      expect(entry).toBeDefined();
      expect(entry.vaultAddress).toBe(normalizedAddress);
      expect(typeof entry.blacklistedAt).toBe('number');
      expect(entry.blacklistedAt).toBeGreaterThan(0);
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(0);

      console.log('🔍 Entry fields:');
      console.log(`  - vaultAddress: ${entry.vaultAddress}`);
      console.log(`  - blacklistedAt: ${entry.blacklistedAt} (${new Date(entry.blacklistedAt).toISOString()})`);
      console.log(`  - reason: ${entry.reason}`);

      // --- Tracker assertions ---
      expectTrackerAggregates(service, testVault.vaultAddress, {
        blacklistCount: 1
      });

      const blacklistTxs = await getTransactionsByType(service, testVault.vaultAddress, 'VaultBlacklisted');
      expect(blacklistTxs.length).toBe(1);
      expect(blacklistTxs[0].reason).toContain('Invalid vault configuration');

      console.log('Blacklist file format test passed');
    }, 60000);
  });
});
