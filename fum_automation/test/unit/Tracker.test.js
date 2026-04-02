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
import { fetchTokenPrices, getTokenBySymbol } from 'fum_library';
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

  it('should return null when price is 0 (unavailable)', async () => {
    vi.mocked(getWrappedNativeSymbol).mockReturnValue('WETH');
    vi.mocked(fetchTokenPrices).mockResolvedValue({ WETH: 0 });

    const result = await tracker.calculateGasUSD(0.01);

    expect(result).toBeNull();
  });

  it('should return null when fetchTokenPrices throws', async () => {
    vi.mocked(getWrappedNativeSymbol).mockReturnValue('WETH');
    vi.mocked(fetchTokenPrices).mockRejectedValue(new Error('CoinGecko rate limit'));

    const result = await tracker.calculateGasUSD(0.01);

    expect(result).toBeNull();
  });

  it('should call getWrappedNativeSymbol with the tracker chainId', async () => {
    vi.mocked(getWrappedNativeSymbol).mockReturnValue('WAVAX');
    vi.mocked(fetchTokenPrices).mockResolvedValue({ WAVAX: 25 });

    await tracker.calculateGasUSD(0.5);

    expect(getWrappedNativeSymbol).toHaveBeenCalledWith(1337);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 4: Constructor validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tracker constructor validation', () => {
  it('should throw when vaultDataDir is missing', () => {
    expect(() => new Tracker({ eventManager: new EventManager(), chainId: 1337, trackingFailuresFilePath: '/tmp/tf.json' }))
      .toThrow('vaultDataDir is required');
  });

  it('should throw when eventManager is missing', () => {
    expect(() => new Tracker({ vaultDataDir: '/tmp/v', chainId: 1337, trackingFailuresFilePath: '/tmp/tf.json' }))
      .toThrow('eventManager is required');
  });

  it('should throw when chainId is missing', () => {
    expect(() => new Tracker({ vaultDataDir: '/tmp/v', eventManager: new EventManager(), trackingFailuresFilePath: '/tmp/tf.json' }))
      .toThrow('chainId is required');
  });

  it('should throw when trackingFailuresFilePath is missing', () => {
    expect(() => new Tracker({ vaultDataDir: '/tmp/v', eventManager: new EventManager(), chainId: 1337 }))
      .toThrow('trackingFailuresFilePath is required');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 5: getTrackingFailuresData, updateSnapshot, shutdown, getTransactions
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tracker utility methods', () => {
  let tempDir;
  let tracker;
  let eventManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-util-test-'));
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
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedVault(address = VAULT_ADDRESS, aggregateOverrides = {}) {
    const metadata = createSeedMetadata(address, Date.now(), aggregateOverrides);
    tracker.vaultMetadata.set(address, metadata);
    const vaultDir = path.join(tracker.vaultDataDir, address);
    await fs.mkdir(vaultDir, { recursive: true });
    return metadata;
  }

  describe('getTrackingFailuresData', () => {
    it('should return empty object when no failures', () => {
      expect(tracker.getTrackingFailuresData()).toEqual({});
    });

    it('should return correct shape after trackFailure', async () => {
      await tracker.trackFailure(VAULT_ADDRESS, 'FeesCollected', 'network error');

      const data = tracker.getTrackingFailuresData();
      expect(data[VAULT_ADDRESS]).toBeDefined();
      expect(data[VAULT_ADDRESS].vaultAddress).toBe(VAULT_ADDRESS);
      expect(data[VAULT_ADDRESS].eventType).toBe('FeesCollected');
      expect(data[VAULT_ADDRESS].error).toBe('network error');
      expect(data[VAULT_ADDRESS].attempts).toBe(1);
    });
  });

  describe('updateSnapshot', () => {
    it('should update lastSnapshot and lastUpdated', async () => {
      await seedVault();
      const ts = Date.now();

      await tracker.updateSnapshot(VAULT_ADDRESS, 2500, ts);

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.lastSnapshot.value).toBe(2500);
      expect(metadata.lastSnapshot.timestamp).toBe(ts);
      expect(metadata.metadata.lastUpdated).toBe(ts);
    });

    it('should do nothing for untracked vault', async () => {
      const unknownAddr = ethers.utils.getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      await tracker.updateSnapshot(unknownAddr, 1000, Date.now());
      expect(tracker.getMetadata(unknownAddr)).toBeNull();
    });
  });

  describe('getTransactions with time filtering', () => {
    it('should filter transactions by time range', async () => {
      await seedVault();

      const t1 = 1000;
      const t2 = 2000;
      const t3 = 3000;

      eventManager.emit('PositionRebalanced', { vaultAddress: VAULT_ADDRESS, oldPositionId: '1', newPositionId: '2', reason: 'out_of_range', timestamp: t1 });
      await new Promise(r => setTimeout(r, 50));

      eventManager.emit('PositionRebalanced', { vaultAddress: VAULT_ADDRESS, oldPositionId: '2', newPositionId: '3', reason: 'out_of_range', timestamp: t2 });
      await new Promise(r => setTimeout(r, 50));

      eventManager.emit('PositionRebalanced', { vaultAddress: VAULT_ADDRESS, oldPositionId: '3', newPositionId: '4', reason: 'out_of_range', timestamp: t3 });
      await new Promise(r => setTimeout(r, 50));

      const filtered = await tracker.getTransactions(VAULT_ADDRESS, 1500, 2500);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].timestamp).toBe(t2);
    });
  });

  describe('shutdown', () => {
    it('should persist all metadata and tracking failures to disk', async () => {
      await seedVault();
      await tracker.trackFailure(VAULT_ADDRESS, 'FeesCollected', 'test error');

      await tracker.shutdown();

      // Verify metadata was written
      const metadataPath = path.join(tracker.vaultDataDir, VAULT_ADDRESS, 'metadata.json');
      const metadataRaw = await fs.readFile(metadataPath, 'utf-8');
      const savedMetadata = JSON.parse(metadataRaw);
      expect(savedMetadata.vaultAddress).toBe(VAULT_ADDRESS);

      // Verify tracking failures were written
      const failuresRaw = await fs.readFile(tracker.trackingFailuresFilePath, 'utf-8');
      const savedFailures = JSON.parse(failuresRaw);
      expect(savedFailures[VAULT_ADDRESS]).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 6: Event handler coverage
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tracker event handlers', () => {
  let tempDir;
  let tracker;
  let eventManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-handler-test-'));
    eventManager = new EventManager();
    tracker = new Tracker({
      vaultDataDir: path.join(tempDir, 'vaults'),
      eventManager,
      chainId: 1337,
      debug: false,
      trackingFailuresFilePath: path.join(tempDir, 'tracking-failures', 'tracking-failures.json')
    });
    await tracker.initialize();

    // Default mocks for handlers that call calculateGasUSD / fetchTokenPrices
    vi.mocked(getWrappedNativeSymbol).mockReturnValue('WETH');
    vi.mocked(fetchTokenPrices).mockResolvedValue({ WETH: 3000, USDC: 1, WBTC: 60000 });
    vi.mocked(getTokenBySymbol).mockImplementation((symbol) => {
      const map = { WETH: { decimals: 18 }, USDC: { decimals: 6 }, WBTC: { decimals: 8 } };
      if (map[symbol]) return map[symbol];
      return { decimals: 18 };
    });
  });

  afterEach(async () => {
    vi.mocked(getWrappedNativeSymbol).mockReset();
    vi.mocked(fetchTokenPrices).mockReset();
    vi.mocked(getTokenBySymbol).mockReset();
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedVault(address = VAULT_ADDRESS, aggregateOverrides = {}) {
    const metadata = createSeedMetadata(address, Date.now(), aggregateOverrides);
    tracker.vaultMetadata.set(address, metadata);
    const vaultDir = path.join(tracker.vaultDataDir, address);
    await fs.mkdir(vaultDir, { recursive: true });
    return metadata;
  }

  // Standard gas fields for handlers that need them
  const GAS_USED = ethers.BigNumber.from(200000).toString();
  const GAS_PRICE = ethers.utils.parseUnits('0.1', 'gwei').toString();

  // ─── handleBaselineCapture ─────────────────────────────────────────

  describe('handleBaselineCapture (VaultBaselineCaptured)', () => {
    it('should create metadata with correct aggregate structure', async () => {
      const ts = Date.now();
      eventManager.emit('VaultBaselineCaptured', {
        vaultAddress: VAULT_ADDRESS,
        totalVaultValue: 5000,
        tokenValue: 2000,
        positionValue: 3000,
        timestamp: ts,
        capturePoint: 'initialization',
        strategyId: 'babysteps-1'
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata).not.toBeNull();
      expect(metadata.baseline.value).toBe(5000);
      expect(metadata.baseline.tokenValue).toBe(2000);
      expect(metadata.baseline.positionValue).toBe(3000);
      expect(metadata.baseline.capturePoint).toBe('initialization');
      expect(metadata.aggregates.rebalanceCount).toBe(0);
      expect(metadata.aggregates.cumulativeFeesUSD).toBe(0);
      expect(metadata.metadata.strategyId).toBe('babysteps-1');
    });

    it('should preserve blacklistCount and retryCount from prior metadata', async () => {
      // Pre-seed metadata with prior counts
      await seedVault(VAULT_ADDRESS, { blacklistCount: 2, retryCount: 3 });

      eventManager.emit('VaultBaselineCaptured', {
        vaultAddress: VAULT_ADDRESS,
        totalVaultValue: 5000,
        tokenValue: 2000,
        positionValue: 3000,
        timestamp: Date.now(),
        capturePoint: 'retry_recovery'
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.blacklistCount).toBe(2);
      expect(metadata.aggregates.retryCount).toBe(3);
      // Other aggregates should be reset to 0
      expect(metadata.aggregates.rebalanceCount).toBe(0);
    });
  });

  // ─── handleFeesCollected ───────────────────────────────────────────

  describe('handleFeesCollected (FeesCollected)', () => {
    it('should update fee and gas aggregates when gas fields are present', async () => {
      await seedVault();

      eventManager.emit('FeesCollected', {
        vaultAddress: VAULT_ADDRESS,
        transactionHash: '0xabc',
        timestamp: Date.now(),
        totalUSD: 25.50,
        positionIds: ['pos1'],
        source: 'rebalance',
        fees: { WETH: '0.01' },
        reinvestmentRatio: 80,
        gasUsed: GAS_USED,
        effectiveGasPrice: GAS_PRICE
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.cumulativeFeesUSD).toBe(25.50);
      expect(metadata.aggregates.cumulativeFeesReinvestedUSD).toBeCloseTo(25.50 * 0.80);
      expect(metadata.aggregates.transactionCount).toBe(1);
      expect(metadata.aggregates.cumulativeGasNative).toBeGreaterThan(0);
    });

    it('should not update gas aggregates when gas fields are absent', async () => {
      await seedVault();

      eventManager.emit('FeesCollected', {
        vaultAddress: VAULT_ADDRESS,
        transactionHash: '0xabc',
        timestamp: Date.now(),
        totalUSD: 10,
        positionIds: ['pos1'],
        source: 'rebalance',
        fees: { WETH: '0.005' },
        reinvestmentRatio: 50
        // no gasUsed, no effectiveGasPrice
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.cumulativeFeesUSD).toBe(10);
      expect(metadata.aggregates.cumulativeGasNative).toBe(0);
      expect(metadata.aggregates.cumulativeGasUSD).toBe(0);
    });

    it('should increment feeCollectionCount when source is swap_threshold', async () => {
      await seedVault();

      eventManager.emit('FeesCollected', {
        vaultAddress: VAULT_ADDRESS,
        transactionHash: '0xdef',
        timestamp: Date.now(),
        totalUSD: 5,
        positionIds: ['pos1'],
        source: 'swap_threshold',
        fees: { USDC: '5' },
        reinvestmentRatio: 100
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.feeCollectionCount).toBe(1);
    });
  });

  // ─── handleFeesDistributed ─────────────────────────────────────────

  describe('handleFeesDistributed (FeesDistributed)', () => {
    it('should update distribution aggregates', async () => {
      await seedVault();

      eventManager.emit('FeesDistributed', {
        vaultAddress: VAULT_ADDRESS,
        timestamp: Date.now(),
        distributions: [
          { tokenSymbol: 'WETH', amount: '0.01', gasUsed: GAS_USED, effectiveGasPrice: GAS_PRICE },
          { tokenSymbol: 'USDC', amount: '50', gasUsed: GAS_USED, effectiveGasPrice: GAS_PRICE }
        ],
        reinvestmentRatio: 80,
        totalDistributedUSD: 75.50
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.cumulativeFeesWithdrawnUSD).toBe(75.50);
      expect(metadata.aggregates.transactionCount).toBe(1);
      expect(metadata.aggregates.cumulativeGasNative).toBeGreaterThan(0);
    });
  });

  // ─── handlePositionRebalanced ──────────────────────────────────────

  describe('handlePositionRebalanced (PositionRebalanced)', () => {
    it('should increment rebalanceCount and append transaction', async () => {
      await seedVault();

      eventManager.emit('PositionRebalanced', {
        vaultAddress: VAULT_ADDRESS,
        oldPositionId: '100',
        newPositionId: '101',
        reason: 'out_of_range',
        timestamp: Date.now()
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.rebalanceCount).toBe(1);

      const txs = await tracker.getTransactions(VAULT_ADDRESS);
      const tx = txs.find(t => t.type === 'PositionRebalanced');
      expect(tx.oldPositionId).toBe('100');
      expect(tx.newPositionId).toBe('101');
      expect(tx.reason).toBe('out_of_range');
    });
  });

  // ─── handlePositionsClosed ─────────────────────────────────────────

  describe('handlePositionsClosed (PositionsClosed)', () => {
    it('should calculate gas and record closed positions', async () => {
      await seedVault();

      eventManager.emit('PositionsClosed', {
        vaultAddress: VAULT_ADDRESS,
        transactionHash: '0x111',
        timestamp: Date.now(),
        closedCount: 2,
        closedPositions: [{ id: 'p1' }, { id: 'p2' }],
        gasUsed: GAS_USED,
        effectiveGasPrice: GAS_PRICE,
        success: true
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.transactionCount).toBe(1);
      expect(metadata.aggregates.cumulativeGasNative).toBeGreaterThan(0);

      const txs = await tracker.getTransactions(VAULT_ADDRESS);
      const tx = txs.find(t => t.type === 'PositionsClosed');
      expect(tx.closedCount).toBe(2);
    });
  });

  // ─── handleTokensSwapped ───────────────────────────────────────────

  describe('handleTokensSwapped (TokensSwapped)', () => {
    it('should enrich swaps with USD values and slippage (isAmountIn=true)', async () => {
      await seedVault();

      const amountIn = ethers.utils.parseEther('1').toString();
      const amountOut = ethers.utils.parseUnits('3000', 6).toString(); // 3000 USDC

      eventManager.emit('TokensSwapped', {
        vaultAddress: VAULT_ADDRESS,
        transactionHash: '0x222',
        timestamp: Date.now(),
        swapCount: 1,
        swapType: 'deficit',
        swaps: [{
          tokenInSymbol: 'WETH',
          tokenOutSymbol: 'USDC',
          quotedAmountIn: amountIn,
          quotedAmountOut: amountOut,
          actualAmountIn: amountIn,
          actualAmountOut: ethers.utils.parseUnits('2970', 6).toString(), // 1% slippage
          isAmountIn: true
        }],
        gasUsed: GAS_USED,
        effectiveGasPrice: GAS_PRICE,
        success: true
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.swapCount).toBe(1);
      expect(metadata.aggregates.transactionCount).toBe(1);

      const txs = await tracker.getTransactions(VAULT_ADDRESS);
      const tx = txs.find(t => t.type === 'TokensSwapped');
      expect(tx.swaps[0].slippagePercent).toBeCloseTo(1.0, 0);
      expect(tx.swaps[0].priceInUSD).toBe(3000);
      expect(tx.swaps[0].priceOutUSD).toBe(1);
    });
  });

  // ─── handleNewPositionCreated ──────────────────────────────────────

  describe('handleNewPositionCreated (NewPositionCreated)', () => {
    it('should enrich with USD values and calculate difference', async () => {
      await seedVault();

      const target0 = ethers.utils.parseEther('0.5').toString();
      const target1 = ethers.utils.parseUnits('1500', 6).toString();

      eventManager.emit('NewPositionCreated', {
        vaultAddress: VAULT_ADDRESS,
        transactionHash: '0x333',
        timestamp: Date.now(),
        positionId: '200',
        poolAddress: '0xpool',
        targetToken0: target0,
        targetToken1: target1,
        actualToken0: target0,
        actualToken1: target1,
        tokenSymbols: ['WETH', 'USDC'],
        gasUsed: GAS_USED,
        effectiveGasPrice: GAS_PRICE,
        position: { tickLower: -100, tickUpper: 100 },
        current: { sqrtPrice: '1234' },
        platform: 'uniswapV3'
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.transactionCount).toBe(1);
      expect(metadata.aggregates.cumulativeGasNative).toBeGreaterThan(0);

      const txs = await tracker.getTransactions(VAULT_ADDRESS);
      const tx = txs.find(t => t.type === 'NewPositionCreated');
      expect(tx.totalTargetUSD).toBeGreaterThan(0);
      expect(tx.differencePercent).toBe(0); // target === actual
    });
  });

  // ─── handleLiquidityAddedToPosition ────────────────────────────────

  describe('handleLiquidityAddedToPosition (LiquidityAddedToPosition)', () => {
    it('should update aggregates and append transaction', async () => {
      await seedVault();

      const target0 = ethers.utils.parseEther('0.5').toString();
      const target1 = ethers.utils.parseUnits('1500', 6).toString();

      eventManager.emit('LiquidityAddedToPosition', {
        vaultAddress: VAULT_ADDRESS,
        transactionHash: '0x444',
        timestamp: Date.now(),
        positionId: '200',
        poolAddress: '0xpool',
        targetToken0: target0,
        targetToken1: target1,
        actualToken0: target0,
        actualToken1: target1,
        tokenSymbols: ['WETH', 'USDC'],
        gasUsed: GAS_USED,
        effectiveGasPrice: GAS_PRICE,
        position: { tickLower: -100, tickUpper: 100 },
        current: { sqrtPrice: '1234' },
        platform: 'uniswapV3'
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.transactionCount).toBe(1);

      const txs = await tracker.getTransactions(VAULT_ADDRESS);
      expect(txs.find(t => t.type === 'LiquidityAddedToPosition')).toBeDefined();
    });
  });

  // ─── handleAssetValuesFetched ──────────────────────────────────────

  describe('handleAssetValuesFetched (AssetValuesFetched)', () => {
    it('should update lastSnapshot via updateSnapshot', async () => {
      await seedVault();

      const ts = Date.now();
      eventManager.emit('AssetValuesFetched', {
        vaultAddress: VAULT_ADDRESS,
        totalVaultValue: 7500,
        timestamp: ts
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.lastSnapshot.value).toBe(7500);
      expect(metadata.lastSnapshot.timestamp).toBe(ts);
    });
  });

  // ─── handleWrapUnwrap ──────────────────────────────────────────────

  describe('handleWrapUnwrap (NativeWrapped/NativeUnwrapped)', () => {
    it('should track wrap event with gas and amount USD', async () => {
      await seedVault();

      eventManager.emit('NativeWrapped', {
        vaultAddress: VAULT_ADDRESS,
        transactionHash: '0x555',
        timestamp: Date.now(),
        amount: ethers.utils.parseEther('0.5').toString(),
        amountFormatted: '0.5',
        gasUsed: GAS_USED,
        gasEstimated: '250000',
        effectiveGasPrice: GAS_PRICE,
        success: true
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.wrapUnwrapCount).toBe(1);
      expect(metadata.aggregates.transactionCount).toBe(1);
      expect(metadata.aggregates.cumulativeGasNative).toBeGreaterThan(0);

      const txs = await tracker.getTransactions(VAULT_ADDRESS);
      const tx = txs.find(t => t.type === 'NativeWrapped');
      expect(tx).toBeDefined();
      expect(tx.amountUSD).toBeGreaterThan(0); // 0.5 * 3000 = 1500
    });
  });

  // ─── handleVaultBlacklisted ────────────────────────────────────────

  describe('handleVaultBlacklisted (VaultBlacklisted)', () => {
    it('should create metadata for never-seen vault with blacklistCount=1', async () => {
      const newVault = ethers.utils.getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      // Ensure vault dir exists for append
      const vaultDir = path.join(tracker.vaultDataDir, newVault);
      await fs.mkdir(vaultDir, { recursive: true });

      eventManager.emit('VaultBlacklisted', {
        vaultAddress: newVault,
        reason: 'unrecoverable error',
        timestamp: Date.now()
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(newVault);
      expect(metadata).not.toBeNull();
      expect(metadata.baseline).toBeNull();
      expect(metadata.aggregates.blacklistCount).toBe(1);
    });

    it('should increment blacklistCount for existing vault', async () => {
      await seedVault(VAULT_ADDRESS, { blacklistCount: 1 });

      eventManager.emit('VaultBlacklisted', {
        vaultAddress: VAULT_ADDRESS,
        reason: 'yo-yo detection',
        timestamp: Date.now()
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.blacklistCount).toBe(2);
    });
  });

  // ─── handleVaultRetryQueued ────────────────────────────────────────

  describe('handleVaultRetryQueued (VaultFailed)', () => {
    it('should create metadata for never-seen vault with retryCount=1', async () => {
      const newVault = ethers.utils.getAddress('0xcccccccccccccccccccccccccccccccccccccccc');
      const vaultDir = path.join(tracker.vaultDataDir, newVault);
      await fs.mkdir(vaultDir, { recursive: true });

      eventManager.emit('VaultFailed', {
        vaultAddress: newVault,
        error: 'setup failed',
        attempts: 1,
        source: 'initial_setup',
        timestamp: Date.now()
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(newVault);
      expect(metadata).not.toBeNull();
      expect(metadata.baseline).toBeNull();
      expect(metadata.aggregates.retryCount).toBe(1);
    });

    it('should increment retryCount for existing vault', async () => {
      await seedVault(VAULT_ADDRESS, { retryCount: 2 });

      eventManager.emit('VaultFailed', {
        vaultAddress: VAULT_ADDRESS,
        error: 'strategy error',
        attempts: 3,
        source: 'retry_attempt',
        timestamp: Date.now()
      });
      await new Promise(r => setTimeout(r, 50));

      const metadata = tracker.getMetadata(VAULT_ADDRESS);
      expect(metadata.aggregates.retryCount).toBe(3);
    });
  });
});
