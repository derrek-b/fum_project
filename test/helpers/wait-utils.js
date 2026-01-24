/**
 * @fileoverview Utility functions for waiting on conditions in tests
 */

/**
 * Wait for a condition to become true, polling at regular intervals
 * @param {Function} conditionFn - Function that returns true when condition is met
 * @param {number} timeoutMs - Maximum time to wait in milliseconds
 * @param {number} pollMs - Interval between condition checks
 * @returns {Promise<boolean>} - Resolves true when condition is met
 * @throws {Error} - If timeout is reached before condition is met
 */
export async function waitForCondition(conditionFn, timeoutMs = 30000, pollMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await conditionFn()) return true;
    await new Promise(r => setTimeout(r, pollMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

/**
 * Wait for a specified duration
 * @param {number} ms - Duration in milliseconds
 * @returns {Promise<void>}
 */
export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
