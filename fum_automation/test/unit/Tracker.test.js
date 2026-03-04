/**
 * @fileoverview Unit tests for Tracker.
 *
 * Part 1: Error-path event handlers — the 4 handlers hard to trigger in
 *         integration tests, plus trackFailure/clearTrackingFailure and
 *         the untracked vault guard.
 * Part 2: calculateROI — pure math, no mocking.
 * Part 3: calculateGasUSD — requires mocked fum_library price fetches.
 *
 * No Hardhat, no blockchain — just Tracker + EventManager + temp directory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ethers } from 'ethers';

// Mock fum_library before importing Tracker (which imports from it at top level).
// Existing error-handler tests don't trigger code paths that use these, so they're unaffected.
vi.mock('fum_library', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchTokenPrices: vi.fn(),
    getTokenBySymbol: vi.fn(),
    CACHE_DURATIONS: { '2-MINUTES': 120000 }
  };
});

vi.mock('fum_library/helpers/tokenHelpers', () => ({
  getWrappedNativeSymbol: vi.fn()
}));

import Tracker from '../../src/core/Tracker.js';
import EventManager from '../../src/core/EventManager.js';
import { fetchTokenPrices } from 'fum_library';
import { getWrappedNativeSymbol } from 'fum_library/helpers/tokenHelpers';

const VAULT_ADDRESS = ethers.utils.getAddress('0x1234567890abcdef1234567890abcdef12345678');

/**
 * Create seed metadata matching handleBaselineCapture's structure (Tracker.js:238-278).
 * All 19 aggregate fields initialized to 0 unless overridden.
 */
function createSeedMetadata(vaultAddress, timestamp = Date.now(), overrides = {}) {
  return {
    vaultAddress,
    baseline: {
      value: 1000,
      tokenValue: 500,
      positionValue: 500,
      timestamp,
      block: null,
      capturePoint: 'test'
    },
    aggregates: {
      cumulativeFeesUSD: 0,
      cumulativeFeesReinvestedUSD: 0,
      cumulativeFeesWithdrawnUSD: 0,
      cumulativeFeesWithdrawFailedUSD: 0,
      cumulativeGasNative: 0,
      cumulativeGasUSD: 0,
      swapCount: 0,
      rebalanceCount: 0,
      feeCollectionCount: 0,
      transactionCount: 0,
      wrapUnwrapCount: 0,
      trackingErrorCount: 0,
      feeTrackingFailureCount: 0,
      blacklistCount: 0,
      retryCount: 0,
      executorFundingCount: 0,
      cumulativeExecutorFundingNative: 0,
      cumulativeExecutorFundingUSD: 0,
      executorTopUpFailureCount: 0,
      ...overrides
    },
    failedDistributions: [],
    lastSnapshot: {
      value: 1000,
      timestamp
    },
    metadata: {
      strategyId: 'test-strategy',
      firstSeen: timestamp,
      lastUpdated: timestamp
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Part 1: Error-path handlers
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tracker error-path handlers', () => {
  let tempDir;
  let tracker;
  let eventManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-error-test-'));

    eventManager = new EventManager();

    tracker = new Tracker({
      vaultDataDir: path.join(tempDir, 'vaults'),
      eventManager,
      chainId: 1337,
      debug: false,
      trackingFailuresFilePath: path.join(tempDir, 'tracking-failures', 'tracking-failures.json')
    });

    await tracker.initialize();
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * Seed vault metadata into tracker so handlers don't bail on the untracked guard.
   * Also creates the vault directory so appendTransaction can write to disk.
   */
  async function seedVault(address = VAULT_ADDRESS, aggregateOverrides = {}) {
    const metadata = createSeedMetadata(address, Date.now(), aggregateOverrides);
    tracker.vaultMetadata.set(address, metadata);
    const vaultDir = path.join(tracker.vaultDataDir, address);
    await fs.mkdir(vaultDir, { recursive: true });
    return metadata;
  }

  // ─── 1. handleFeeDistributionFailed ─────────────────────────────────

  describe('handleFeeDistributionFailed', () => {
    it('should record failed distribution in metadata and transaction log', async () => {
      await seedVault();

      const timestamp = Date.now();
      const eventData = {
        vaultAddress: VAULT_ADDRESS,
        fees: { token0: '1.5', token1: '2.3' },
        source: 'fee-collection',
        error: 'transfer failed',
        totalFailedUSD: 42.50,
        timestamp
      };

      eventManager.emit('FeeDistributionFailed', eventData);

      // Let async handler complete
      await new Promise(r => setTimeout(r, 50));

      // Assert metadata aggregates
      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.cumulativeFeesWithdrawFailedUSD).toBe(42.50);
      expect(metadata.failedDistributions).toHaveLength(1);

      const failed = metadata.failedDistributions[0];
      expect(failed.fees).toEqual({ token0: '1.5', token1: '2.3' });
      expect(failed.source).toBe('fee-collection');
      expect(failed.error).toBe('transfer failed');
      expect(failed.totalFailedUSD).toBe(42.50);
      expect(failed.timestamp).toBe(timestamp);

      // Assert transaction log
      const txs = await tracker.getTransactions(VAULT_ADDRESS);
      const fdfTx = txs.find(t => t.type === 'FeeDistributionFailed');
      expect(fdfTx).toBeDefined();
      expect(fdfTx.fees).toEqual({ token0: '1.5', token1: '2.3' });
      expect(fdfTx.error).toBe('transfer failed');
      expect(fdfTx.totalFailedUSD).toBe(42.50);
    });

    it('should accumulate across multiple failures', async () => {
      await seedVault();

      eventManager.emit('FeeDistributionFailed', {
        vaultAddress: VAULT_ADDRESS,
        fees: { token0: '1' },
        source: 'fees',
        error: 'fail 1',
        totalFailedUSD: 10,
        timestamp: Date.now()
      });

      // Wait for first handler's disk I/O before emitting second
      await new Promise(r => setTimeout(r, 50));

      eventManager.emit('FeeDistributionFailed', {
        vaultAddress: VAULT_ADDRESS,
        fees: { token0: '2' },
        source: 'fees',
        error: 'fail 2',
        totalFailedUSD: 20,
        timestamp: Date.now()
      });

      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.cumulativeFeesWithdrawFailedUSD).toBe(30);
      expect(metadata.failedDistributions).toHaveLength(2);
    });
  });

  // ─── 2. handleFeeTrackingFailed ─────────────────────────────────────

  describe('handleFeeTrackingFailed', () => {
    it('should increment feeTrackingFailureCount by failures.length', async () => {
      await seedVault();

      const failures = [
        { positionId: '1', reason: 'native ETH fee unknown' },
        { positionId: '2', reason: 'native ETH fee unknown' },
        { positionId: '3', reason: 'native ETH fee unknown' }
      ];

      eventManager.emit('FeeTrackingFailed', {
        vaultAddress: VAULT_ADDRESS,
        transactionHash: '0xabc123',
        failures,
        reason: 'native ETH fees',
        timestamp: Date.now()
      });

      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.feeTrackingFailureCount).toBe(3);

      const txs = await tracker.getTransactions(VAULT_ADDRESS);
      const ftfTx = txs.find(t => t.type === 'FeeTrackingFailed');
      expect(ftfTx).toBeDefined();
      expect(ftfTx.failures).toHaveLength(3);
      expect(ftfTx.transactionHash).toBe('0xabc123');
      expect(ftfTx.reason).toBe('native ETH fees');
    });
  });

  // ─── 3. handleExecutorTopUpFailed ───────────────────────────────────

  describe('handleExecutorTopUpFailed', () => {
    it('should increment executorTopUpFailureCount and log transaction', async () => {
      await seedVault();

      const timestamp = Date.now();

      eventManager.emit('ExecutorTopUpFailed', {
        vaultAddress: VAULT_ADDRESS,
        error: 'insufficient vault balance for top-up',
        timestamp
      });

      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.executorTopUpFailureCount).toBe(1);

      const txs = await tracker.getTransactions(VAULT_ADDRESS);
      const topUpTx = txs.find(t => t.type === 'ExecutorTopUpFailed');
      expect(topUpTx).toBeDefined();
      expect(topUpTx.error).toBe('insufficient vault balance for top-up');
      expect(topUpTx.timestamp).toBe(timestamp);
    });

    it('should increment on repeated failures', async () => {
      await seedVault();

      eventManager.emit('ExecutorTopUpFailed', {
        vaultAddress: VAULT_ADDRESS,
        error: 'fail 1',
        timestamp: Date.now()
      });

      // Wait for first handler's disk I/O before emitting second
      await new Promise(r => setTimeout(r, 50));

      eventManager.emit('ExecutorTopUpFailed', {
        vaultAddress: VAULT_ADDRESS,
        error: 'fail 2',
        timestamp: Date.now()
      });

      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.executorTopUpFailureCount).toBe(2);
    });
  });

  // ─── 4. logTrackingError ────────────────────────────────────────────

  describe('logTrackingError', () => {
    it('should increment trackingErrorCount and append TrackingError transaction', async () => {
      await seedVault();

      const timestamp = Date.now();

      await tracker.logTrackingError(VAULT_ADDRESS, {
        eventType: 'FeesDistributed',
        timestamp,
        error: 'unexpected null value'
      });

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.trackingErrorCount).toBe(1);

      const txs = await tracker.getTransactions(VAULT_ADDRESS);
      const errorTx = txs.find(t => t.type === 'TrackingError');
      expect(errorTx).toBeDefined();
      expect(errorTx.eventType).toBe('FeesDistributed');
      expect(errorTx.error).toBe('unexpected null value');
      expect(errorTx.transactionHash).toBeNull();
    });

    it('should include transactionHash when provided', async () => {
      await seedVault();

      await tracker.logTrackingError(VAULT_ADDRESS, {
        eventType: 'PositionRebalanced',
        transactionHash: '0xdeadbeef',
        timestamp: Date.now(),
        error: 'parsing error'
      });

      const txs = await tracker.getTransactions(VAULT_ADDRESS);
      const errorTx = txs.find(t => t.type === 'TrackingError');
      expect(errorTx.transactionHash).toBe('0xdeadbeef');
    });

    it('should not crash when vault has no metadata', async () => {
      // No seedVault — but create the directory so appendTransaction doesn't fail
      const vaultDir = path.join(tracker.vaultDataDir, VAULT_ADDRESS);
      await fs.mkdir(vaultDir, { recursive: true });

      // Should not throw — logs the transaction but skips metadata update
      await tracker.logTrackingError(VAULT_ADDRESS, {
        eventType: 'FeesCollected',
        timestamp: Date.now(),
        error: 'some error'
      });

      // No metadata should have been created
      expect(tracker.getMetadata(VAULT_ADDRESS)).toBeNull();

      // But transaction should still be logged
      const txs = await tracker.getTransactions(VAULT_ADDRESS);
      expect(txs.find(t => t.type === 'TrackingError')).toBeDefined();
    });
  });

  // ─── 5. trackFailure / clearTrackingFailure ─────────────────────────

  describe('trackFailure / clearTrackingFailure', () => {
    it('should add vault to trackingFailures map', async () => {
      await tracker.trackFailure(VAULT_ADDRESS, 'VaultBaselineCaptured', 'fetch failed');

      expect(tracker.trackingFailures.has(VAULT_ADDRESS)).toBe(true);
      const failure = tracker.trackingFailures.get(VAULT_ADDRESS);
      expect(failure.vaultAddress).toBe(VAULT_ADDRESS);
      expect(failure.eventType).toBe('VaultBaselineCaptured');
      expect(failure.error).toBe('fetch failed');
      expect(failure.attempts).toBe(1);
    });

    it('should emit TrackerFailure event', async () => {
      let emitted = null;
      eventManager.subscribe('TrackerFailure', (data) => {
        emitted = data;
      });

      await tracker.trackFailure(VAULT_ADDRESS, 'VaultBaselineCaptured', 'network error');

      expect(emitted).not.toBeNull();
      expect(emitted.vaultAddress).toBe(VAULT_ADDRESS);
      expect(emitted.eventType).toBe('VaultBaselineCaptured');
      expect(emitted.error).toBe('network error');
      expect(emitted.attempts).toBe(1);
    });

    it('should persist tracking failures to disk', async () => {
      await tracker.trackFailure(VAULT_ADDRESS, 'VaultBaselineCaptured', 'rpc timeout');

      const data = await fs.readFile(tracker.trackingFailuresFilePath, 'utf-8');
      const parsed = JSON.parse(data);
      expect(parsed[VAULT_ADDRESS]).toBeDefined();
      expect(parsed[VAULT_ADDRESS].error).toBe('rpc timeout');
    });

    it('should increment attempts on repeated failures', async () => {
      await tracker.trackFailure(VAULT_ADDRESS, 'VaultBaselineCaptured', 'fail 1');
      await tracker.trackFailure(VAULT_ADDRESS, 'VaultBaselineCaptured', 'fail 2');

      const failure = tracker.trackingFailures.get(VAULT_ADDRESS);
      expect(failure.attempts).toBe(2);
      expect(failure.error).toBe('fail 2');
    });

    it('should clear tracking failure and emit TrackerFailureCleared', async () => {
      await tracker.trackFailure(VAULT_ADDRESS, 'VaultBaselineCaptured', 'error');

      let cleared = null;
      eventManager.subscribe('TrackerFailureCleared', (data) => {
        cleared = data;
      });

      await tracker.clearTrackingFailure(VAULT_ADDRESS);

      expect(tracker.trackingFailures.has(VAULT_ADDRESS)).toBe(false);
      expect(cleared).not.toBeNull();
      expect(cleared.vaultAddress).toBe(VAULT_ADDRESS);
    });

    it('should not emit TrackerFailureCleared when vault has no failure', async () => {
      let cleared = false;
      eventManager.subscribe('TrackerFailureCleared', () => {
        cleared = true;
      });

      await tracker.clearTrackingFailure(VAULT_ADDRESS);

      expect(cleared).toBe(false);
    });
  });

  // ─── 6. Untracked vault guard ──────────────────────────────────────

  describe('untracked vault guard', () => {
    it('should skip FeeDistributionFailed for untracked vault', async () => {
      eventManager.emit('FeeDistributionFailed', {
        vaultAddress: VAULT_ADDRESS,
        fees: {},
        source: 'test',
        error: 'err',
        totalFailedUSD: 10,
        timestamp: Date.now()
      });

      await new Promise(r => setTimeout(r, 50));

      // No metadata should exist
      expect(tracker.getMetadata(VAULT_ADDRESS)).toBeNull();
    });

    it('should skip FeeTrackingFailed for untracked vault', async () => {
      eventManager.emit('FeeTrackingFailed', {
        vaultAddress: VAULT_ADDRESS,
        transactionHash: '0x123',
        failures: [{ positionId: '1' }],
        reason: 'test',
        timestamp: Date.now()
      });

      await new Promise(r => setTimeout(r, 50));

      expect(tracker.getMetadata(VAULT_ADDRESS)).toBeNull();
    });

    it('should skip ExecutorTopUpFailed for untracked vault', async () => {
      eventManager.emit('ExecutorTopUpFailed', {
        vaultAddress: VAULT_ADDRESS,
        error: 'err',
        timestamp: Date.now()
      });

      await new Promise(r => setTimeout(r, 50));

      expect(tracker.getMetadata(VAULT_ADDRESS)).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 2: calculateROI
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tracker.calculateROI', () => {
  let tempDir;
  let tracker;
  let eventManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-roi-test-'));
    eventManager = new EventManager();
    tracker = new Tracker({
      vaultDataDir: path.join(tempDir, 'vaults'),
      eventManager,
      chainId: 1337,
      debug: false,
      trackingFailuresFilePath: path.join(tempDir, 'tracking-failures', 'tracking-failures.json')
    });
    await tracker.initialize();
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should return null when vault has no metadata', () => {
    const result = tracker.calculateROI(VAULT_ADDRESS, 1000);
    expect(result).toBeNull();
  });

  it('should return null when metadata has no baseline', () => {
    const metadata = createSeedMetadata(VAULT_ADDRESS);
    metadata.baseline = null;
    tracker.vaultMetadata.set(VAULT_ADDRESS, metadata);

    const result = tracker.calculateROI(VAULT_ADDRESS, 1000);
    expect(result).toBeNull();
  });

  it('should calculate positive ROI correctly', () => {
    // baseline=1000, current=1100, fees=50, gas=10
    // netValue = 1100 + 50 - 10 = 1140
    // roi = (1140 - 1000) / 1000 * 100 = 14%
    const metadata = createSeedMetadata(VAULT_ADDRESS, Date.now(), {
      cumulativeFeesUSD: 50,
      cumulativeGasUSD: 10
    });
    tracker.vaultMetadata.set(VAULT_ADDRESS, metadata);

    const result = tracker.calculateROI(VAULT_ADDRESS, 1100);

    expect(result.baselineValue).toBe(1000);
    expect(result.currentValue).toBe(1100);
    expect(result.cumulativeFees).toBe(50);
    expect(result.cumulativeGas).toBe(10);
    expect(result.netValue).toBe(1140);
    expect(result.roi).toBeCloseTo(14, 10);
    expect(result.roiPercent).toBe('14.00');
  });

  it('should calculate negative ROI correctly', () => {
    // baseline=1000, current=800, fees=0, gas=20
    // netValue = 800 + 0 - 20 = 780
    // roi = (780 - 1000) / 1000 * 100 = -22%
    const metadata = createSeedMetadata(VAULT_ADDRESS, Date.now(), {
      cumulativeFeesUSD: 0,
      cumulativeGasUSD: 20
    });
    tracker.vaultMetadata.set(VAULT_ADDRESS, metadata);

    const result = tracker.calculateROI(VAULT_ADDRESS, 800);

    expect(result.netValue).toBe(780);
    expect(result.roi).toBe(-22);
    expect(result.roiPercent).toBe('-22.00');
  });

  it('should return roi of 0 when baseline value is 0', () => {
    const metadata = createSeedMetadata(VAULT_ADDRESS);
    metadata.baseline.value = 0;
    tracker.vaultMetadata.set(VAULT_ADDRESS, metadata);

    const result = tracker.calculateROI(VAULT_ADDRESS, 500);

    expect(result.roi).toBe(0);
    expect(result.roiPercent).toBe('0.00');
  });

  it('should format roiPercent as string with 2 decimal places', () => {
    // baseline=1000, current=1033.33, fees=0, gas=0
    // roi = (1033.33 - 1000) / 1000 * 100 = 3.333
    const metadata = createSeedMetadata(VAULT_ADDRESS);
    tracker.vaultMetadata.set(VAULT_ADDRESS, metadata);

    const result = tracker.calculateROI(VAULT_ADDRESS, 1033.33);

    expect(typeof result.roiPercent).toBe('string');
    expect(result.roiPercent).toBe('3.33');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 3: calculateGasUSD
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tracker.calculateGasUSD', () => {
  let tempDir;
  let tracker;
  let eventManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-gas-test-'));
    eventManager = new EventManager();
    tracker = new Tracker({
      vaultDataDir: path.join(tempDir, 'vaults'),
      eventManager,
      chainId: 1337,
      debug: false,
      trackingFailuresFilePath: path.join(tempDir, 'tracking-failures', 'tracking-failures.json')
    });
    await tracker.initialize();

    // Reset mocks before each test
    vi.mocked(getWrappedNativeSymbol).mockReset();
    vi.mocked(fetchTokenPrices).mockReset();
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should return gasNative * price when price is available', async () => {
    vi.mocked(getWrappedNativeSymbol).mockReturnValue('WETH');
    vi.mocked(fetchTokenPrices).mockResolvedValue({ WETH: 3000 });

    const result = await tracker.calculateGasUSD(0.01);

    expect(result).toBe(30); // 0.01 * 3000
  });

  it('should return 0 when price is 0 (unavailable)', async () => {
    vi.mocked(getWrappedNativeSymbol).mockReturnValue('WETH');
    vi.mocked(fetchTokenPrices).mockResolvedValue({ WETH: 0 });

    const result = await tracker.calculateGasUSD(0.01);

    expect(result).toBe(0);
  });

  it('should return 0 when fetchTokenPrices throws', async () => {
    vi.mocked(getWrappedNativeSymbol).mockReturnValue('WETH');
    vi.mocked(fetchTokenPrices).mockRejectedValue(new Error('CoinGecko rate limit'));

    const result = await tracker.calculateGasUSD(0.01);

    expect(result).toBe(0);
  });

  it('should call getWrappedNativeSymbol with the tracker chainId', async () => {
    vi.mocked(getWrappedNativeSymbol).mockReturnValue('WAVAX');
    vi.mocked(fetchTokenPrices).mockResolvedValue({ WAVAX: 25 });

    await tracker.calculateGasUSD(0.5);

    expect(getWrappedNativeSymbol).toHaveBeenCalledWith(1337);
  });
});
