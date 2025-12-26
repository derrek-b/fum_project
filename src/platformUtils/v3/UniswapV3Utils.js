/**
 * @fileoverview Uniswap V3 specific utility functions
 *
 * These utilities bridge the strategy layer and the adapter layer,
 * providing strategy-specific calculations using platform-specific data.
 */

import PlatformUtilsBase from '../PlatformUtilsBase.js';

/**
 * Uniswap V3 platform utilities
 * @extends PlatformUtilsBase
 */
export default class UniswapV3Utils extends PlatformUtilsBase {
  /**
   * Platform identifier
   */
  static PLATFORM_ID = 'uniswapV3';

  /**
   * Evaluate a position's range status for concentrated liquidity strategies
   *
   * Determines if a position is in range and calculates distance metrics
   * for logging and debugging purposes.
   *
   * @param {Object} position - Position object with tickLower, tickUpper, pool
   * @param {Object} options - Evaluation options
   * @param {Object} options.adapter - UniswapV3Adapter instance
   * @param {Object} options.provider - Ethers provider
   * @returns {Promise<Object>} Range evaluation result
   * @returns {boolean} result.inRange - Is current tick within position bounds
   * @returns {number} result.centeredness - How centered the position is (0-1, 0.5 = centered)
   * @returns {number} result.distanceToUpper - Distance to upper bound as percentage of range
   * @returns {number} result.distanceToLower - Distance to lower bound as percentage of range
   * @returns {number} result.currentTick - Current tick value from pool
   */
  static async evaluatePositionRange(position, options) {
    const { adapter, provider } = options;

    // Validate required position data
    if (position.tickLower === undefined || position.tickUpper === undefined) {
      throw new Error(`Position missing tick range data: tickLower=${position.tickLower}, tickUpper=${position.tickUpper}`);
    }
    if (!position.pool) {
      throw new Error('Position missing pool address');
    }

    // Get current tick from adapter (reuse existing code)
    const currentTick = await adapter.getCurrentTick(position.pool, provider);

    // Calculate range metrics
    const rangeSize = position.tickUpper - position.tickLower;
    if (rangeSize <= 0) {
      throw new Error(`Invalid tick range: ${position.tickLower} to ${position.tickUpper}`);
    }

    const inRange = currentTick >= position.tickLower && currentTick <= position.tickUpper;
    const distanceToUpper = (position.tickUpper - currentTick) / rangeSize;
    const distanceToLower = (currentTick - position.tickLower) / rangeSize;
    const centeredness = distanceToLower; // 0 = at lower, 0.5 = centered, 1 = at upper

    return {
      inRange,
      centeredness: Math.max(0, Math.min(1, centeredness)),
      distanceToUpper: Math.max(0, Math.min(1, distanceToUpper)),
      distanceToLower: Math.max(0, Math.min(1, distanceToLower)),
      currentTick
    };
  }
}
