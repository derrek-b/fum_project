/**
 * @module platformUtils/v3/UniswapV3Utils
 * @description Uniswap V3 specific utility functions for position management
 */

/**
 * Convert tick to price
 * @param {number} tick - The tick value
 * @param {number} token0Decimals - Decimals of token0
 * @param {number} token1Decimals - Decimals of token1
 * @returns {number} The price
 */
export function tickToPrice(tick, token0Decimals, token1Decimals) {
  const price = Math.pow(1.0001, tick);
  const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
  return price * decimalAdjustment;
}

/**
 * Convert price to tick
 * @param {number} price - The price
 * @param {number} token0Decimals - Decimals of token0
 * @param {number} token1Decimals - Decimals of token1
 * @returns {number} The tick value
 */
export function priceToTick(price, token0Decimals, token1Decimals) {
  const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
  const adjustedPrice = price / decimalAdjustment;
  return Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));
}

/**
 * Calculate tick range for a position
 * @param {number} currentTick - Current pool tick
 * @param {number} rangePercent - Range as percentage (e.g., 10 for 10%)
 * @param {number} tickSpacing - Pool tick spacing
 * @returns {{tickLower: number, tickUpper: number}} The tick range
 */
export function calculateTickRange(currentTick, rangePercent, tickSpacing) {
  // Calculate range in ticks based on percentage
  const tickRange = Math.floor(Math.log(1 + rangePercent / 100) / Math.log(1.0001));

  // Round to tick spacing
  const tickLower = Math.floor((currentTick - tickRange) / tickSpacing) * tickSpacing;
  const tickUpper = Math.ceil((currentTick + tickRange) / tickSpacing) * tickSpacing;

  return { tickLower, tickUpper };
}

/**
 * Parse a V3 swap event from log data
 * @param {Object} log - The event log
 * @param {Object} poolInterface - The pool contract interface for decoding
 * @returns {Object} Parsed swap event data
 */
export function parseSwapEvent(log, poolInterface) {
  const parsed = poolInterface.parseLog(log);
  return {
    sender: parsed.args.sender,
    recipient: parsed.args.recipient,
    amount0: parsed.args.amount0,
    amount1: parsed.args.amount1,
    sqrtPriceX96: parsed.args.sqrtPriceX96,
    liquidity: parsed.args.liquidity,
    tick: parsed.args.tick
  };
}

/**
 * Calculate price movement percentage from tick change
 * @param {number} originalTick - The original tick
 * @param {number} currentTick - The current tick
 * @returns {number} Price movement as percentage
 */
export function calculatePriceMovementPercent(originalTick, currentTick) {
  const originalPrice = Math.pow(1.0001, originalTick);
  const currentPrice = Math.pow(1.0001, currentTick);
  return Math.abs((currentPrice - originalPrice) / originalPrice) * 100;
}

/**
 * Check if current tick is within position range
 * @param {number} currentTick - Current pool tick
 * @param {number} tickLower - Position lower tick
 * @param {number} tickUpper - Position upper tick
 * @returns {boolean} True if in range
 */
export function isInRange(currentTick, tickLower, tickUpper) {
  return currentTick >= tickLower && currentTick < tickUpper;
}

/**
 * Calculate distance to range boundaries as percentage
 * @param {number} currentTick - Current pool tick
 * @param {number} tickLower - Position lower tick
 * @param {number} tickUpper - Position upper tick
 * @returns {{toLower: number, toUpper: number}} Distance percentages
 */
export function calculateRangeDistances(currentTick, tickLower, tickUpper) {
  const totalRange = tickUpper - tickLower;
  const toLower = ((currentTick - tickLower) / totalRange) * 100;
  const toUpper = ((tickUpper - currentTick) / totalRange) * 100;
  return { toLower, toUpper };
}

/**
 * Platform identifier
 */
export const PLATFORM_ID = 'uniswapV3';
