/**
 * @module utils/errors
 * @description Custom error classes for structured error handling
 * @since 2.0.0
 */

/**
 * Base class for unrecoverable errors that should trigger immediate blacklisting.
 * These errors indicate permanent failures that cannot be resolved by retrying.
 *
 * Examples: missing strategy, missing adapter, invalid configuration
 *
 * @class UnrecoverableError
 * @extends Error
 */
export class UnrecoverableError extends Error {
  /**
   * @param {string} message - Error message describing the unrecoverable condition
   */
  constructor(message) {
    super(message);
    this.name = 'UnrecoverableError';
    this.isUnrecoverable = true;
  }
}
