/**
 * @module helpers/formatHelpers
 * @description Generic formatting utilities for consistent data presentation across the FUM Library
 */

// src/helpers/formatHelpers.js
// Generic formatting utilities that can be used across platforms

/**
 * Formats a price value with appropriate precision and thousands separators for financial display
 *
 * @function formatPrice
 * @memberof module:helpers/formatHelpers
 *
 * @param {number} price - The price value to format (must be >= 0)
 *
 * @returns {string} The formatted price with appropriate precision:
 * @throws {Error} If price is not a finite number
 * @throws {Error} If price is negative
 * - "<0.0001" for very small values
 * - Variable decimal places based on magnitude with thousands separators
 * - Abbreviated format for very large values (e.g., "5.00M", "1.23B")
 *
 * @example
 * // Very small price
 * formatPrice(0.00003); // "<0.0001"
 *
 * @example
 * // Standard price with thousands separator
 * formatPrice(1234.56); // "1,234.56"
 *
 * @example
 * // Large price with abbreviation
 * formatPrice(5000000); // "5.00M"
 *
 * @example
 * // Very large price
 * formatPrice(1500000000); // "1.50B"
 *
 * @since 1.0.0
 */
export function formatPrice(price) {
  if (!Number.isFinite(price)) throw new Error('Price must be a finite number');
  if (price < 0) throw new Error('Price cannot be negative');
  if (price === 0) return "0";

  // Handle very small numbers
  if (price < 0.0001) return "<0.0001";

  // Handle very large numbers with abbreviations
  if (price >= 1000000000) {
    return (price / 1000000000).toFixed(2) + "B";
  }

  if (price >= 1000000) {
    return (price / 1000000).toFixed(2) + "M";
  }

  // Dynamic precision based on price magnitude - more precision for smaller prices
  if (price < 0.001) return price.toFixed(6);
  if (price < 0.1) return price.toFixed(5);
  if (price < 1000) return price.toFixed(4);

  // For prices >= 1000, use 2 decimal places
  return price.toFixed(2);
}

/**
 * Formats fee values for display with a maximum of 4 decimal places
 *
 * @function formatFeeDisplay
 * @memberof module:helpers/formatHelpers
 *
 * @param {number} fee - The fee to format (must be >= 0)
 *
 * @returns {string} Formatted fee display with trailing zeros removed:
 * @throws {Error} If fee is not a finite number
 * @throws {Error} If fee is negative
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
 * formatFeeDisplay(0.0300); // "0.03"
 *
 * @since 1.0.0
 */
export function formatFeeDisplay(fee) {
  if (!Number.isFinite(fee)) throw new Error('Fee must be a finite number');
  if (fee < 0) throw new Error('Fee cannot be negative');
  if (fee === 0) return "0";

  if (fee < 0.0001) return "< 0.0001";
  return fee.toFixed(4).replace(/\.?0+$/, ""); //remove trailing 0s
}

/**
 * Converts Unix timestamps to human-readable date and time strings
 *
 * @function formatTimestamp
 * @memberof module:helpers/formatHelpers
 *
 * @param {number} timestamp - Unix timestamp in milliseconds or seconds (must be > 0)
 *
 * @returns {string} Formatted date and time string in locale format (e.g., "Mar 25, 2023, 14:30")
 * @throws {Error} If timestamp is not a finite number
 * @throws {Error} If timestamp is not greater than 0
 * @throws {Error} If timestamp creates an invalid date
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
 * formatTimestamp(null); // Throws: "Timestamp must be a finite number"
 *
 * @since 1.0.0
 */
export function formatTimestamp(timestamp) {s
  if (!Number.isFinite(timestamp)) throw new Error('Timestamp must be a finite number');
  if (timestamp <= 0) throw new Error('Timestamp must be greater than 0');

  // Convert to milliseconds if in seconds (threshold: 10 billion)
  const timestampMs = timestamp < 10000000000 ? timestamp * 1000 : timestamp;

  const date = new Date(timestampMs);

  // Check if the date is valid
  if (isNaN(date.getTime())) {
    throw new Error('Timestamp creates an invalid date');
  }

  // Format: "Mar 25, 2023, 14:30"
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
