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
