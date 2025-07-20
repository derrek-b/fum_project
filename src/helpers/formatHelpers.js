/**
 * @module helpers/formatHelpers
 * @description Generic formatting utilities for consistent data presentation across the FUM Library
 */

// src/helpers/formatHelpers.js
// Generic formatting utilities that can be used across platforms

/**
 * Formats a price value with appropriate precision based on its magnitude
 * 
 * @function formatPrice
 * @memberof module:helpers/formatHelpers
 * 
 * @param {number} price - The price value to format
 * 
 * @returns {string} The formatted price with appropriate precision:
 * - "N/A" for non-finite values
 * - "<0.0001" for very small values
 * - Variable decimal places based on magnitude
 * - Exponential notation for values > 1,000,000
 * 
 * @example
 * // Very small price
 * formatPrice(0.00003); // "<0.0001"
 * 
 * @example
 * // Standard price
 * formatPrice(42.5); // "42.50"
 * 
 * @example
 * // Large price
 * formatPrice(5000000); // "5.00e+6"
 * 
 * @since 1.0.0
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
 * Converts BigInt token amounts to human-readable strings with proper decimal placement
 * 
 * @function formatUnits
 * @memberof module:helpers/formatHelpers
 * 
 * @param {BigInt} value - The raw token amount as BigInt
 * @param {number} decimals - Number of decimal places for the token
 * 
 * @returns {string} Formatted string representation with proper decimal placement
 * 
 * @example
 * // 1 ETH (18 decimals)
 * formatUnits(1000000000000000000n, 18); // "1"
 * 
 * @example
 * // 1.5 USDC (6 decimals)
 * formatUnits(1500000n, 6); // "1.5"
 * 
 * @example
 * // Removes trailing zeros
 * formatUnits(1230000n, 6); // "1.23"
 * 
 * @warning DO NOT USE FOR CALCULATIONS - This function returns a string representation
 * that loses precision. Use only for display purposes.
 * 
 * @since 1.0.0
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
 * Formats fee values for display with a maximum of 4 decimal places
 * 
 * @function formatFeeDisplay
 * @memberof module:helpers/formatHelpers
 * 
 * @param {string|number} value - The fee value to format
 * 
 * @returns {string} Formatted fee display with trailing zeros removed:
 * - "0" for zero values
 * - "< 0.0001" for very small values
 * - Up to 4 decimal places with trailing zeros removed
 * 
 * @example
 * // Zero fee
 * formatFeeDisplay(0); // "0"
 * 
 * @example
 * // Very small fee
 * formatFeeDisplay(0.00005); // "< 0.0001"
 * 
 * @example
 * // Standard fee with trailing zeros removed
 * formatFeeDisplay("0.0300"); // "0.03"
 * 
 * @since 1.0.0
 */
export function formatFeeDisplay(value) {
  const numValue = parseFloat(value);
  if (numValue === 0) return "0";
  if (numValue < 0.0001) return "< 0.0001";
  return numValue.toFixed(4).replace(/\.?0+$/, "");
}

/**
 * Converts Unix timestamps to human-readable date and time strings
 * 
 * @function formatTimestamp
 * @memberof module:helpers/formatHelpers
 * 
 * @param {number} timestamp - Unix timestamp in milliseconds or seconds
 * 
 * @returns {string} Formatted date and time string in locale format:
 * - "N/A" for falsy values
 * - "Invalid Date" for invalid timestamps
 * - "Error" if formatting fails
 * - Locale-formatted date string (e.g., "Mar 25, 2023, 14:30")
 * 
 * @example
 * // Timestamp in seconds (auto-converted)
 * formatTimestamp(1679750400); // "Mar 25, 2023, 14:30"
 * 
 * @example
 * // Timestamp in milliseconds
 * formatTimestamp(1679750400000); // "Mar 25, 2023, 14:30"
 * 
 * @example
 * // Invalid input
 * formatTimestamp(null); // "N/A"
 * 
 * @sideeffect Logs errors to console when formatting fails
 * 
 * @since 1.0.0
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

/**
 * Calculate the value of a token amount at a given price
 * 
 * @function calculateTokenValue
 * @memberof module:helpers/formatHelpers
 * 
 * @param {string|number} amount - Token amount to calculate value for
 * @param {number} pricePerToken - Price per token in the target currency
 * 
 * @returns {number|null} The calculated value, or null if inputs are invalid
 * 
 * @example
 * // Calculate USD value of 10 ETH at $2000 per ETH
 * const value = calculateTokenValue(10, 2000);
 * // Returns: 20000
 * 
 * @example
 * // Handle string amounts
 * const value = calculateTokenValue("5.5", 100);
 * // Returns: 550
 * 
 * @example
 * // Handle invalid inputs
 * const value = calculateTokenValue("invalid", 100);
 * // Returns: null
 * 
 * @since 1.0.0
 */
export function calculateTokenValue(amount, pricePerToken) {
  if (!amount || pricePerToken == null) return null;

  // Convert amount to number if it's a string
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(numAmount) || isNaN(pricePerToken)) return null;

  return numAmount * pricePerToken;
}
