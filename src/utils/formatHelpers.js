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
 * NOTE - DO NOT USE FOR CALCULATIONS
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

/**
 * Format a timestamp in a human-readable format
 * @param {number} timestamp - Unix timestamp in milliseconds or seconds
 * @returns {string} - Formatted date and time string
 */
export function formatTimestamp(timestamp) {
  if (!timestamp) return "N/A";

  // Convert to milliseconds if in seconds
  const timestampMs = timestamp < 10000000000 ? timestamp * 1000 : timestamp;

  try {
    const date = new Date(timestampMs);

    // Check if the date is valid
    if (isNaN(date.getTime())) {
      return "Invalid Date";
    }

    // Format: "Mar 25, 2023, 14:30"
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    console.error("Error formatting timestamp:", error);
    return "Error";
  }
}
