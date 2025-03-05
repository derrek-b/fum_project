// utils/positionHelpers.js
import { TickMath } from "@uniswap/v3-sdk";
import JSBI from 'jsbi'; // Import JSBI separately

export function isInRange(currentTick, tickLower, tickUpper) {
  return currentTick >= tickLower && tickUpper >= currentTick;
}

export function calculatePrice(sqrtPriceX96, decimals0, decimals1) {
  const priceInt = (sqrtPriceX96 / 2 ** 96) ** 2; // Changed ^ to **
  const decimalsDiff = decimals1 - decimals0;
  const price = Number(priceInt) * Math.pow(10, decimalsDiff < 0 ? -decimalsDiff : 0);
  const formattedPrice = Number.isFinite(price) ? price.toFixed(6) : "N/A";
  return formattedPrice;
}
