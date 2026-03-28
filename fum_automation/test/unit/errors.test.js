/**
 * @fileoverview Unit tests for InsufficientGasError custom error class
 */

import { describe, it, expect } from 'vitest';
import { InsufficientGasError, UnrecoverableError, isInsufficientFundsError, formatErrorForDisplay } from '../../src/utils/errors.js';

describe('InsufficientGasError', () => {
  const message = 'Executor balance 0.0001 ETH below minimum 0.002 ETH';
  const vaultAddress = '0x1234567890123456789012345678901234567890';
  const executorAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

  it('should construct with message, vaultAddress, and executorAddress', () => {
    const error = new InsufficientGasError(message, vaultAddress, executorAddress);

    expect(error.message).toBe(message);
    expect(error.vaultAddress).toBe(vaultAddress);
    expect(error.executorAddress).toBe(executorAddress);
    expect(error.name).toBe('InsufficientGasError');
  });

  it('should be an instanceof Error', () => {
    const error = new InsufficientGasError(message, vaultAddress, executorAddress);

    expect(error).toBeInstanceOf(Error);
  });

  it('should be detectable by name property', () => {
    const error = new InsufficientGasError(message, vaultAddress, executorAddress);

    // This is the pattern used in AutomationService catch blocks
    expect(error.name === 'InsufficientGasError').toBe(true);
  });

  it('should have a stack trace that includes InsufficientGasError', () => {
    const error = new InsufficientGasError(message, vaultAddress, executorAddress);

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('InsufficientGasError');
  });

  it('should be distinguishable from UnrecoverableError', () => {
    const gasError = new InsufficientGasError(message, vaultAddress, executorAddress);
    const unrecoverableError = new UnrecoverableError('Missing strategy');

    expect(gasError.name).toBe('InsufficientGasError');
    expect(unrecoverableError.name).toBe('UnrecoverableError');
    expect(gasError.name).not.toBe(unrecoverableError.name);

    // InsufficientGasError should NOT have isUnrecoverable flag
    expect(gasError.isUnrecoverable).toBeUndefined();
    expect(unrecoverableError.isUnrecoverable).toBe(true);
  });
});

describe('isInsufficientFundsError', () => {
  it('should match ethers.js INSUFFICIENT_FUNDS error code (Geth/production)', () => {
    const error = new Error('insufficient funds for intrinsic transaction cost');
    error.code = 'INSUFFICIENT_FUNDS';
    expect(isInsufficientFundsError(error)).toBe(true);
  });

  it('should match Hardhat error message format', () => {
    const error = new Error(
      "Sender doesn't have enough funds to send tx. The max upfront cost is: 14009566176 and the sender's balance is: 0"
    );
    error.code = 'SERVER_ERROR';
    expect(isInsufficientFundsError(error)).toBe(true);
  });

  it('should not match unrelated errors', () => {
    const error = new Error('execution reverted: INSUFFICIENT_OUTPUT_AMOUNT');
    error.code = 'CALL_EXCEPTION';
    expect(isInsufficientFundsError(error)).toBe(false);
  });

  it('should not match errors with no message', () => {
    const error = new Error();
    expect(isInsufficientFundsError(error)).toBe(false);
  });
});

describe('formatErrorForDisplay', () => {
  describe('Null/Undefined Input', () => {
    it('should return "Unknown error" for null', () => {
      expect(formatErrorForDisplay(null)).toBe('Unknown error');
    });

    it('should return "Unknown error" for undefined', () => {
      expect(formatErrorForDisplay(undefined)).toBe('Unknown error');
    });
  });

  describe('String Input', () => {
    it('should extract revert reason from string with embedded revert', () => {
      const input = "Error: processing failed: reverted with reason string 'PositionVault: swap failed'";
      expect(formatErrorForDisplay(input)).toBe('PositionVault: swap failed');
    });

    it('should return first line of plain string without revert', () => {
      const input = 'Something went wrong\nwith extra details\non multiple lines';
      expect(formatErrorForDisplay(input)).toBe('Something went wrong');
    });

    it('should truncate long strings to 200 characters', () => {
      const longString = 'A'.repeat(300);
      const result = formatErrorForDisplay(longString);
      expect(result.length).toBe(203); // 200 + '...'
      expect(result.endsWith('...')).toBe(true);
    });

    it('should return empty string for empty string input', () => {
      expect(formatErrorForDisplay('')).toBe('');
    });
  });

  describe('Error Object Input', () => {
    it('should extract revert reason from error.reason with revert pattern', () => {
      const error = new Error('transaction failed');
      error.reason = "reverted with reason string 'Insufficient balance'";
      expect(formatErrorForDisplay(error)).toBe('Insufficient balance');
    });

    it('should return error.reason directly when no revert pattern', () => {
      const error = new Error('transaction failed');
      error.reason = 'transaction reverted without a reason';
      expect(formatErrorForDisplay(error)).toBe('transaction reverted without a reason');
    });

    it('should extract revert reason from nested error.error.message', () => {
      const error = new Error('call revert exception');
      error.error = { message: "reverted with reason string 'Only vault owner'" };
      expect(formatErrorForDisplay(error)).toBe('Only vault owner');
    });

    it('should extract revert reason from error.message when no reason or nested error', () => {
      const error = new Error("reverted with reason string 'Not authorized'");
      expect(formatErrorForDisplay(error)).toBe('Not authorized');
    });

    it('should fall back to first line of error.message', () => {
      const error = new Error('simple error message\nwith stack trace details');
      expect(formatErrorForDisplay(error)).toBe('simple error message');
    });

    it('should truncate long error.message to 200 characters', () => {
      const error = new Error('B'.repeat(300));
      const result = formatErrorForDisplay(error);
      expect(result.length).toBe(203);
      expect(result.endsWith('...')).toBe(true);
    });
  });
});
