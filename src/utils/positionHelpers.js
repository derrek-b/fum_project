// utils/positionHelpers.js
import { TickMath } from "@uniswap/v3-sdk";
import JSBI from 'jsbi'; // Import JSBI separately

export function isInRange(currentTick, tickLower, tickUpper) {
  return currentTick >= tickLower && tickUpper >= currentTick;
}

export function calculatePrice(sqrtPriceX96, decimals0, decimals1) {
  // Original working implementation - DO NOT CHANGE THIS!
  const priceInt = (sqrtPriceX96 / 2 ** 96) ** 2; // Changed ^ to **
  const decimalsDiff = decimals1 - decimals0;
  const price = Number(priceInt) * Math.pow(10, decimalsDiff < 0 ? -decimalsDiff : 0);
  const formattedPrice = Number.isFinite(price) ? price.toFixed(6) : "N/A";
  return formattedPrice;
}

// Helper function to convert tick to price - only used in seed script
export function tickToPrice(baseToken, quoteToken, tick) {
  try {
    // Calculate price from tick using the formula: 1.0001^tick
    const price = Math.pow(1.0001, tick);

    // Apply decimal adjustment based on token decimals
    // For WETH (18 decimals) to USDC (6 decimals), adjustment is 10^(6-18) = 10^-12
    const decimalAdjustment = Math.pow(10, quoteToken.decimals - baseToken.decimals);
    return price * decimalAdjustment;
  } catch (error) {
    console.error("Error converting tick to price:", error);
    return 0;
  }
}
