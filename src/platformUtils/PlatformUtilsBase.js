/**
 * @fileoverview Base class for platform-specific utilities.
 * All platform utils must extend this class and implement required methods.
 */

/**
 * Abstract base class for platform utilities.
 * Provides interface enforcement - subclasses must implement all static methods.
 */
export default class PlatformUtilsBase {
  /**
   * Platform identifier - must be overridden by subclass
   * @returns {string} Platform ID (e.g., 'uniswapV3', 'uniswapV4')
   */
  static get PLATFORM_ID() {
    throw new Error('PLATFORM_ID must be defined by subclass');
  }

  /**
   * Evaluate position range status relative to current price
   * @param {Object} position - Position object
   * @param {number} position.tickLower - Lower tick bound
   * @param {number} position.tickUpper - Upper tick bound
   * @param {string} position.pool - Pool address
   * @param {Object} options - Configuration options
   * @param {Object} options.adapter - Platform adapter instance
   * @param {Object} options.provider - Ethers provider
   * @returns {Promise<Object>} Range evaluation result
   * @returns {boolean} result.inRange - Whether current tick is within position bounds
   * @returns {number} result.centeredness - Position in range (0-1, 0.5 = centered)
   * @returns {number} result.distanceToUpper - Distance to upper bound as fraction of range
   * @returns {number} result.distanceToLower - Distance to lower bound as fraction of range
   * @returns {number} result.currentTick - Current tick value from pool
   */
  static async evaluatePositionRange(position, options) {
    throw new Error(`evaluatePositionRange must be implemented by ${this.name}`);
  }

  /**
   * Generate multiple swap transactions with proper state management
   *
   * Implementations should handle any platform-specific batching requirements
   * (e.g., nonce tracking for Permit2). Platform-specific auth is handled
   * internally - callers do not need to provide signers.
   *
   * @param {Array<Object>} swapInstructions - Array of swap instructions
   * @param {Object} swapInstructions[].tokenIn - Input token { address, symbol, decimals }
   * @param {Object} swapInstructions[].tokenOut - Output token { address, symbol, decimals }
   * @param {string} swapInstructions[].amount - Raw amount to swap
   * @param {boolean} swapInstructions[].isAmountIn - true=EXACT_INPUT, false=EXACT_OUTPUT
   * @param {Object} options - Common options for all swaps
   * @param {string} options.recipient - Address to receive outputs
   * @param {number} options.slippageTolerance - Slippage tolerance percentage
   * @param {Object} options.adapter - Platform adapter instance
   * @param {Object} options.provider - Ethers provider
   * @param {number} options.chainId - Chain ID
   * @returns {Promise<Object>} Batch result
   * @returns {Array<Object>} result.transactions - Array of { to, data, value }
   * @returns {Array<Object>} result.metadata - Array of swap metadata
   */
  static async batchSwapTransactions(swapInstructions, options) {
    throw new Error(`batchSwapTransactions must be implemented by ${this.name}`);
  }
}
