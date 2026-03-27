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

/**
 * Error thrown when a vault's executor has insufficient native gas for transaction execution.
 * This is NOT an unrecoverable error — the vault is healthy, it just needs a gas top-up.
 * Phase 6 VaultHealth handles automatic top-ups; until then, the vault is skipped.
 *
 * @class InsufficientGasError
 * @extends Error
 */
export class InsufficientGasError extends Error {
  /**
   * @param {string} message - Error message
   * @param {string} vaultAddress - Vault that triggered the error
   * @param {string} executorAddress - Executor address that needs gas
   */
  constructor(message, vaultAddress, executorAddress) {
    super(message);
    this.name = 'InsufficientGasError';
    this.vaultAddress = vaultAddress;
    this.executorAddress = executorAddress;
  }
}

/**
 * Check if an error indicates the sender has insufficient funds to pay gas.
 *
 * ethers.js v5's checkError() maps RPC errors to error.code INSUFFICIENT_FUNDS
 * when the message matches /insufficient funds/i (Geth's format). Hardhat uses
 * a different message ("Sender doesn't have enough funds to send tx") that
 * doesn't match, so ethers wraps it as SERVER_ERROR instead.
 *
 * This helper checks both the error code (production/Geth) and the message
 * (Hardhat) for defense in depth against non-standard RPC error messages.
 *
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error indicates insufficient gas funds
 */
export function isInsufficientFundsError(error) {
  if (error.code === 'INSUFFICIENT_FUNDS') return true;
  const message = (error.message || '').toLowerCase();
  return message.includes("doesn't have enough funds to send tx");
}

/**
 * Extract a human-readable error message from an ethers.js error or any Error.
 *
 * ethers.js errors dump the full transaction calldata, nested RPC responses,
 * and hex-encoded revert data into error.message. This function extracts only
 * the parts a user can understand.
 *
 * Priority:
 * 1. Solidity revert reason (e.g., "PositionVault: swap failed")
 * 2. ethers.js reason field (e.g., "transaction reverted")
 * 3. First line of message, capped at 200 chars
 *
 * Use this for any error message that leaves the service toward the user:
 * SSE events, blacklist reasons, tracker entries.
 *
 * @param {Error|string} error - The error to clean
 * @returns {string} Human-readable error message
 */
export function formatErrorForDisplay(error) {
  if (typeof error === 'string') {
    // Already a string — might be a pre-formatted message wrapping a raw error
    // Try to extract the revert reason if embedded
    const revertMatch = error.match(/reverted with reason string '([^']+)'/);
    if (revertMatch) return revertMatch[1];

    // Take first line, cap length
    const firstLine = error.split('\n')[0];
    return firstLine.length > 200 ? firstLine.slice(0, 200) + '...' : firstLine;
  }

  if (!error) return 'Unknown error';

  // ethers.js nests the Solidity revert reason in error.reason
  // Format: 'Error: VM Exception while processing transaction: reverted with reason string "X"'
  // or just the reason string directly
  if (error.reason) {
    const revertMatch = error.reason.match(/reverted with reason string '([^']+)'/);
    if (revertMatch) return revertMatch[1];
    return error.reason;
  }

  // Some nested ethers errors have the revert reason deeper
  if (error.error?.message) {
    const revertMatch = error.error.message.match(/reverted with reason string '([^']+)'/);
    if (revertMatch) return revertMatch[1];
  }

  // Fall back to message, but extract revert reason if embedded in the dump
  const message = error.message || String(error);
  const revertMatch = message.match(/reverted with reason string '([^']+)'/);
  if (revertMatch) return revertMatch[1];

  // Last resort: first line, capped
  const firstLine = message.split('\n')[0];
  return firstLine.length > 200 ? firstLine.slice(0, 200) + '...' : firstLine;
}
