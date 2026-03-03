/**
 * @fileoverview Unit tests for InsufficientGasError custom error class
 */

import { describe, it, expect } from 'vitest';
import { InsufficientGasError, UnrecoverableError, isInsufficientFundsError } from '../../src/utils/errors.js';

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
