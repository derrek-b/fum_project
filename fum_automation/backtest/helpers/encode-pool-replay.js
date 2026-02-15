/**
 * Calldata encoding helpers for the PoolReplay contract
 * Converts raw event data into ready-to-execute calldata
 */

import { ethers } from 'ethers';

// Uniswap V3 sqrt price limits (no price limit for replayed swaps)
const MIN_SQRT_RATIO = BigInt('4295128739');
const MAX_SQRT_RATIO = BigInt('1461446703485210103287273052203988822378723970342');

// PoolReplay contract ABI (execute functions only)
export const POOL_REPLAY_ABI = [
  'function executeSwap(address pool, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96)',
  'function executeMint(address pool, int24 tickLower, int24 tickUpper, uint128 amount)',
  'function executeBurn(address pool, int24 tickLower, int24 tickUpper, uint128 amount)'
];

const poolReplayInterface = new ethers.utils.Interface(POOL_REPLAY_ABI);

/**
 * Encode a swap event into PoolReplay.executeSwap calldata
 *
 * @param {string} poolAddress - Pool contract address
 * @param {Object} event - Swap event from events.json
 * @param {number} token0Decimals - Decimals for token0
 * @param {number} token1Decimals - Decimals for token1
 * @returns {string} ABI-encoded calldata
 */
export function encodeSwap(poolAddress, event, token0Decimals, token1Decimals) {
  const amount0 = parseFloat(event.amount0);
  const amount1 = parseFloat(event.amount1);

  // Positive amount = token went into the pool
  const zeroForOne = amount0 > 0;

  // Use the positive (input) amount, converted to wei
  const amountSpecified = zeroForOne
    ? ethers.utils.parseUnits(event.amount0, token0Decimals)
    : ethers.utils.parseUnits(event.amount1, token1Decimals);

  // No price limit — let the swap execute fully
  const sqrtPriceLimitX96 = zeroForOne
    ? (MIN_SQRT_RATIO + 1n).toString()
    : (MAX_SQRT_RATIO - 1n).toString();

  return poolReplayInterface.encodeFunctionData('executeSwap', [
    poolAddress,
    zeroForOne,
    amountSpecified,
    sqrtPriceLimitX96
  ]);
}

/**
 * Encode a mint event into PoolReplay.executeMint calldata
 *
 * @param {string} poolAddress - Pool contract address
 * @param {Object} event - Mint event from events.json
 * @returns {string} ABI-encoded calldata
 */
export function encodeMint(poolAddress, event) {
  return poolReplayInterface.encodeFunctionData('executeMint', [
    poolAddress,
    event.tickLower,
    event.tickUpper,
    event.amount
  ]);
}

/**
 * Encode a burn event into PoolReplay.executeBurn calldata
 * Used for positions owned by the PoolReplay contract (minted during replay)
 *
 * @param {string} poolAddress - Pool contract address
 * @param {Object} event - Burn event from events.json
 * @param {string} [amountOverride] - Optional amount to burn (for split burns)
 * @returns {string} ABI-encoded calldata
 */
export function encodeBurn(poolAddress, event, amountOverride) {
  return poolReplayInterface.encodeFunctionData('executeBurn', [
    poolAddress,
    event.tickLower,
    event.tickUpper,
    amountOverride || event.amount
  ]);
}

// Uniswap V3 pool burn function (called directly when impersonating position owner)
const POOL_BURN_ABI = [
  'function burn(int24 tickLower, int24 tickUpper, uint128 amount) returns (uint256 amount0, uint256 amount1)'
];

const poolBurnInterface = new ethers.utils.Interface(POOL_BURN_ABI);

/**
 * Encode a burn as a direct pool.burn() call for impersonated execution
 * Used for positions NOT owned by PoolReplay (pre-fork or mixed ownership)
 *
 * @param {Object} event - Burn event from events.json
 * @param {string} [amountOverride] - Optional amount to burn (for split burns)
 * @returns {string} ABI-encoded calldata for pool.burn()
 */
export function encodeDirectBurn(event, amountOverride) {
  return poolBurnInterface.encodeFunctionData('burn', [
    event.tickLower,
    event.tickUpper,
    amountOverride || event.amount
  ]);
}
