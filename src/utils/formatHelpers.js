// utils/formatHelpers.js
// Generic formatting utilities that can be used across platforms

/**
 * Format a price value with appropriate precision
 * @param {number} price - The price to format
 * @returns {string} The formatted price
 */
export function formatPrice(price) {
  if (!Number.isFinite(price)) return "N/A";
  if (price === 0) return "0";

  // Handle very small numbers
  if (price < 0.0001) return "<0.0001";

  // Dynamic precision based on price magnitude
  if (price < 0.001) return price.toFixed(6);
  if (price < 0.1) return price.toFixed(5);
  if (price < 1) return price.toFixed(4);
  if (price < 100) return price.toFixed(2);
  if (price > 1000000) return price.toExponential(2);

  return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Helper function to format BigInt values with decimals
 * @param {BigInt} value - The raw token amount as BigInt
 * @param {number} decimals - Number of decimals for the token
 * @returns {string} Formatted string with proper decimal places
 */
export function formatUnits(value, decimals) {
  if (!value) return '0';

  const divisor = BigInt(10 ** decimals);
  const integerPart = (value / divisor).toString();

  let fractionalPart = (value % divisor).toString();
  // Pad with leading zeros if needed
  fractionalPart = fractionalPart.padStart(decimals, '0');

  // Remove trailing zeros
  while (fractionalPart.endsWith('0') && fractionalPart.length > 1) {
    fractionalPart = fractionalPart.substring(0, fractionalPart.length - 1);
  }

  if (fractionalPart === '0') {
    return integerPart;
  }

  return `${integerPart}.${fractionalPart}`;
}

/**
 * Format a fee display value with max 4 decimal places
 * @param {string|number} value - The value to format
 * @returns {string} - Formatted fee display
 */
export function formatFeeDisplay(value) {
  const numValue = parseFloat(value);
  if (numValue === 0) return "0";
  if (numValue < 0.0001) return "< 0.0001";
  return numValue.toFixed(4).replace(/\.?0+$/, "");
}
