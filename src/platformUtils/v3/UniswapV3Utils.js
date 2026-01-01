/**
 * @fileoverview Uniswap V3 specific utility functions
 *
 * These utilities bridge the strategy layer and the adapter layer,
 * providing strategy-specific calculations using platform-specific data.
 */

import { ethers } from 'ethers';
import PlatformUtilsBase from '../PlatformUtilsBase.js';
import { getPermit2Nonce, generatePermit2Signature } from 'fum_library/helpers/Permit2Helper';
import { getPlatformAddresses } from 'fum_library/helpers/chainHelpers';

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

  /**
   * Generate a single swap transaction using AlphaRouter + Permit2
   *
   * Internal method - called by batchSwapTransactions.
   * Handles all Uniswap V3-specific details:
   * - AlphaRouter route finding
   * - Permit2 nonce management
   * - Permit2 signature generation
   * - Universal Router calldata wrapping
   *
   * @param {Object} params - Swap parameters
   * @param {Map} [params._nonceTracker] - Internal: nonce tracker for batched swaps
   * @returns {Promise<Object>} Swap result with transaction and metadata
   * @private
   */
  static async _generateSwapTransaction(params) {
    const {
      tokenIn,
      tokenOut,
      amount,
      isAmountIn,
      recipient,
      slippageTolerance,
      adapter,
      provider,
      chainId,
      _nonceTracker // Internal: passed by batchSwapTransactions
    } = params;

    // 1. Get route from adapter using AlphaRouter
    // For native ETH, address is not required - adapter uses Ether.onChain() internally
    const routeResult = await adapter.getSwapRoute({
      tokenInAddress: tokenIn.isNative ? undefined : tokenIn.address,
      tokenOutAddress: tokenOut.isNative ? undefined : tokenOut.address,
      amount,
      isAmountIn,
      recipient,
      slippageTolerance,
      deadlineMinutes: 30,
      tokenInIsNative: tokenIn.isNative || false,
      tokenOutIsNative: tokenOut.isNative || false
    });

    // 2. Branch: native ETH input skips Permit2
    if (tokenIn.isNative) {
      // Native ETH - use route directly, no Permit2 needed
      const swapData = await adapter.generateAlphaSwapData({
        route: routeResult.route,
        recipient,
        tokenInAddress: undefined,
        amountIn: routeResult.amountIn,
        tokenInIsNative: true
      });

      return {
        transaction: swapData,
        quotedAmountIn: routeResult.amountIn,
        quotedAmountOut: routeResult.amountOut,
        isAmountIn
      };
    }

    // ERC20 flow - get signer for Permit2 signature generation
    const signer = new ethers.Wallet(process.env.AUTOMATION_PRIVATE_KEY, provider);

    // 3. Get/track Permit2 nonce (Uniswap-specific detail)
    const addresses = getPlatformAddresses(chainId, 'uniswapV3');
    let nonce;

    if (_nonceTracker?.has(tokenIn.address)) {
      // Use tracked nonce for batched swaps
      nonce = _nonceTracker.get(tokenIn.address);
    } else {
      // Fetch current nonce from Permit2 contract
      nonce = await getPermit2Nonce(
        provider,
        recipient,
        tokenIn.address,
        addresses.universalRouterAddress
      );
    }

    // Update tracker for next swap with same token
    _nonceTracker?.set(tokenIn.address, nonce + 1);

    // 4. Generate Permit2 signature
    const deadline = Math.floor(Date.now() / 1000) + 1800; // 30 minutes
    const { signature } = await generatePermit2Signature(
      signer,
      chainId,
      tokenIn.address,
      routeResult.amountIn,
      addresses.universalRouterAddress,
      nonce,
      deadline
    );

    // 5. Generate wrapped swap calldata via adapter
    const swapData = await adapter.generateAlphaSwapData({
      route: routeResult.route,
      recipient,
      tokenInAddress: tokenIn.address,
      amountIn: routeResult.amountIn,
      permit2Signature: signature,
      permit2Nonce: nonce,
      permit2Deadline: deadline
    });

    return {
      transaction: swapData,
      quotedAmountIn: routeResult.amountIn,
      quotedAmountOut: routeResult.amountOut,
      isAmountIn
    };
  }

  /**
   * Generate multiple swap transactions with Permit2 nonce tracking
   *
   * Creates an internal nonce tracker to handle batched swaps that
   * use the same input token (would otherwise have nonce collisions).
   *
   * @param {Array<Object>} swapInstructions - Array of swap instructions
   * @param {Object} options - Common options for all swaps
   * @returns {Promise<Object>} { transactions: [], metadata: [] }
   */
  static async batchSwapTransactions(swapInstructions, options) {
    const transactions = [];
    const metadata = [];

    // Create internal nonce tracker for this batch
    // This handles the Permit2-specific requirement that nonces increment
    const _nonceTracker = new Map();

    for (const instruction of swapInstructions) {
      const result = await this._generateSwapTransaction({
        ...instruction,
        ...options,
        _nonceTracker
      });

      transactions.push(result.transaction);
      metadata.push({
        tokenInSymbol: instruction.tokenIn.symbol,
        tokenOutSymbol: instruction.tokenOut.symbol,
        quotedAmountIn: result.quotedAmountIn,
        quotedAmountOut: result.quotedAmountOut,
        isAmountIn: result.isAmountIn
      });
    }

    return { transactions, metadata };
  }
}
