/**
 * @fileoverview Shared Tracker assertion helpers for workflow tests.
 *
 * Provides reusable assertions for Tracker metadata (aggregates, baseline)
 * and transaction log entries across all platform-specific workflow tests.
 */

import { expect } from 'vitest';

/**
 * Assert that Tracker metadata exists for a vault and specific aggregate
 * counters match expected values.
 *
 * @param {Object} service - AutomationService instance
 * @param {string} vaultAddress - Vault address to check
 * @param {Object} expectedAggregates - Key/value pairs to assert on metadata.aggregates
 * @returns {Object} The full metadata object for further assertions
 */
export function expectTrackerAggregates(service, vaultAddress, expectedAggregates) {
  const metadata = service.tracker.getMetadata(vaultAddress);
  expect(metadata).not.toBeNull();
  expect(metadata.aggregates).toBeDefined();

  for (const [key, value] of Object.entries(expectedAggregates)) {
    expect(metadata.aggregates[key], `aggregates.${key}`).toBe(value);
  }

  return metadata;
}

/**
 * Assert that Tracker has a baseline captured for a vault.
 *
 * @param {Object} service - AutomationService instance
 * @param {string} vaultAddress - Vault address to check
 * @returns {Object} The baseline object for further assertions
 */
export function expectTrackerBaseline(service, vaultAddress) {
  const metadata = service.tracker.getMetadata(vaultAddress);
  expect(metadata).not.toBeNull();
  expect(metadata.baseline).toBeDefined();
  expect(metadata.baseline.value).toBeGreaterThan(0);
  expect(typeof metadata.baseline.timestamp).toBe('number');
  expect(metadata.baseline.capturePoint).toBeDefined();

  return metadata.baseline;
}

/**
 * Get transactions from Tracker and assert expected types are present.
 *
 * @param {Object} service - AutomationService instance
 * @param {string} vaultAddress - Vault address to check
 * @param {string[]} expectedTypes - Transaction types that must be present
 * @returns {Promise<Array>} The full transactions array for further assertions
 */
export async function expectTransactionTypes(service, vaultAddress, expectedTypes) {
  const txs = await service.tracker.getTransactions(vaultAddress);
  const types = txs.map(t => t.type);

  for (const type of expectedTypes) {
    expect(types, `expected transaction type '${type}'`).toContain(type);
  }

  return txs;
}

/**
 * Get transactions of a specific type from Tracker.
 *
 * @param {Object} service - AutomationService instance
 * @param {string} vaultAddress - Vault address to check
 * @param {string} type - Transaction type to filter by
 * @returns {Promise<Array>} Filtered transactions array
 */
export async function getTransactionsByType(service, vaultAddress, type) {
  const txs = await service.tracker.getTransactions(vaultAddress);
  return txs.filter(t => t.type === type);
}

/**
 * Assert that Tracker has no tracking failures for a vault.
 *
 * @param {Object} service - AutomationService instance
 * @param {string} vaultAddress - Vault address to check (optional — checks all if omitted)
 */
/**
 * Assert that Tracker's transactionCount aggregate matches the number of
 * on-chain transaction entries in the log. Internal bookkeeping entries
 * (PositionRebalanced, VaultBlacklisted, VaultRetryQueued, VaultRetrySuccess,
 * FeeDistributionFailed, FeeTrackingFailed, ExecutorTopUpFailed, TrackingError)
 * are logged but not counted — they represent synthetic events or error records,
 * not distinct on-chain operations.
 *
 * @param {Object} service - AutomationService instance
 * @param {string} vaultAddress - Vault address to check
 */
const NON_COUNTED_TYPES = new Set([
  'PositionRebalanced', 'VaultBlacklisted', 'VaultRetryQueued', 'VaultRetrySuccess',
  'FeeDistributionFailed', 'FeeTrackingFailed', 'ExecutorTopUpFailed', 'TrackingError'
]);

export async function expectTransactionCount(service, vaultAddress) {
  const metadata = service.tracker.getMetadata(vaultAddress);
  const txs = await service.tracker.getTransactions(vaultAddress);
  const onChainCount = txs.filter(t => !NON_COUNTED_TYPES.has(t.type)).length;
  expect(onChainCount, 'transactionCount matches on-chain log entries').toBe(
    metadata.aggregates.transactionCount
  );
}

/**
 * Assert that Tracker has no tracking failures for a vault.
 *
 * @param {Object} service - AutomationService instance
 * @param {string} vaultAddress - Vault address to check (optional — checks all if omitted)
 */
export function expectNoTrackingFailures(service, vaultAddress) {
  const failures = service.tracker.getTrackingFailuresData();
  if (vaultAddress) {
    const normalized = vaultAddress.toLowerCase();
    const vaultFailures = Object.entries(failures).filter(
      ([addr]) => addr.toLowerCase() === normalized
    );
    expect(vaultFailures.length, `tracking failures for ${vaultAddress}`).toBe(0);
  } else {
    expect(Object.keys(failures).length, 'total tracking failures').toBe(0);
  }
}
