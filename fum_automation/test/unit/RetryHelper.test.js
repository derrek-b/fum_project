/**
 * @fileoverview Unit tests for RetryHelper utility functions
 * Tests pure retry logic without external dependencies
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isRetryableError,
  retryWithBackoff,
  retryExternalService,
  retryRpcCall,
  retryBatchOperations
} from '../../src/utils/RetryHelper.js';
import { UnrecoverableError } from '../../src/utils/errors.js';

describe('RetryHelper', () => {
  // Mock timers for delay testing
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isRetryableError', () => {
    describe('Network error codes', () => {
      it('should return true for NETWORK_ERROR code', () => {
        const error = new Error('Network error');
        error.code = 'NETWORK_ERROR';
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for TIMEOUT code', () => {
        const error = new Error('Timeout');
        error.code = 'TIMEOUT';
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for ETIMEDOUT code', () => {
        const error = new Error('Connection timed out');
        error.code = 'ETIMEDOUT';
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for ECONNREFUSED code', () => {
        const error = new Error('Connection refused');
        error.code = 'ECONNREFUSED';
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for ECONNRESET code', () => {
        const error = new Error('Connection reset');
        error.code = 'ECONNRESET';
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for ENOTFOUND code', () => {
        const error = new Error('Host not found');
        error.code = 'ENOTFOUND';
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for EHOSTUNREACH code', () => {
        const error = new Error('Host unreachable');
        error.code = 'EHOSTUNREACH';
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for EAI_AGAIN code', () => {
        const error = new Error('DNS lookup failed');
        error.code = 'EAI_AGAIN';
        expect(isRetryableError(error)).toBe(true);
      });
    });

    describe('Error message patterns', () => {
      it('should return true for "network" in message', () => {
        const error = new Error('Network connection failed');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for "timeout" in message', () => {
        const error = new Error('Request timeout exceeded');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for "connection" in message', () => {
        const error = new Error('Connection was closed');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for "rate limit" in message', () => {
        const error = new Error('Rate limit exceeded');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for "too many requests" in message', () => {
        const error = new Error('Too many requests');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for "429" in message', () => {
        const error = new Error('HTTP 429 error');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for "502" in message', () => {
        const error = new Error('502 Bad Gateway');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for "503" in message', () => {
        const error = new Error('503 Service Unavailable');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for "504" in message', () => {
        const error = new Error('504 Gateway Timeout');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for "The Graph" in message', () => {
        const error = new Error('The Graph API is throttled');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for "gateway timeout" in message', () => {
        const error = new Error('Gateway timeout occurred');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for "bad gateway" in message', () => {
        const error = new Error('Bad gateway response');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should return true for "fetch failed" in message', () => {
        const error = new Error('fetch failed');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should be case insensitive', () => {
        const error = new Error('NETWORK ERROR OCCURRED');
        expect(isRetryableError(error)).toBe(true);
      });
    });

    describe('Non-retryable errors', () => {
      it('should return false for generic error', () => {
        const error = new Error('Something went wrong');
        expect(isRetryableError(error)).toBe(false);
      });

      it('should return false for validation error', () => {
        const error = new Error('Invalid input provided');
        expect(isRetryableError(error)).toBe(false);
      });

      it('should return false for authorization error', () => {
        const error = new Error('Unauthorized access');
        expect(isRetryableError(error)).toBe(false);
      });

      it('should return false for unknown error code', () => {
        const error = new Error('Unknown error');
        error.code = 'UNKNOWN_CODE';
        expect(isRetryableError(error)).toBe(false);
      });
    });

    describe('Nested error causes', () => {
      it('should check error.cause for retryable conditions', () => {
        const causeError = new Error('Connection refused');
        causeError.code = 'ECONNREFUSED';

        const mainError = new Error('Request failed');
        mainError.cause = causeError;

        expect(isRetryableError(mainError)).toBe(true);
      });

      it('should traverse multiple levels of error.cause', () => {
        const deepError = new Error('Timeout');
        deepError.code = 'ETIMEDOUT';

        const middleError = new Error('Wrapped error');
        middleError.cause = deepError;

        const topError = new Error('Top level error');
        topError.cause = middleError;

        expect(isRetryableError(topError)).toBe(true);
      });

      it('should return false if no cause is retryable', () => {
        const causeError = new Error('Invalid data');
        const mainError = new Error('Processing failed');
        mainError.cause = causeError;

        expect(isRetryableError(mainError)).toBe(false);
      });
    });

    describe('UnrecoverableError handling', () => {
      it('should return false for UnrecoverableError instance', () => {
        const error = new UnrecoverableError('fatal failure');
        expect(isRetryableError(error)).toBe(false);
      });

      it('should return false for error with isUnrecoverable flag', () => {
        const error = new Error('custom fatal');
        error.isUnrecoverable = true;
        expect(isRetryableError(error)).toBe(false);
      });

      it('should return false when UnrecoverableError is in cause chain', () => {
        const cause = new UnrecoverableError('deep fatal');
        const wrapper = new Error('wrapper');
        wrapper.cause = cause;
        expect(isRetryableError(wrapper)).toBe(false);
      });
    });
  });

  describe('retryWithBackoff', () => {
    describe('Successful execution', () => {
      it('should return result on first success', async () => {
        const fn = vi.fn().mockResolvedValue('success');
        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const result = await retryWithBackoff(fn, { logger: silentLogger });

        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(1);
      });

      it('should not wait on first success', async () => {
        const fn = vi.fn().mockResolvedValue('success');
        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryWithBackoff(fn, { logger: silentLogger });
        // No need to advance timers
        const result = await promise;

        expect(result).toBe('success');
      });
    });

    describe('Retry behavior', () => {
      it('should retry on retryable error', async () => {
        const networkError = new Error('Network error');
        networkError.code = 'NETWORK_ERROR';

        const fn = vi.fn()
          .mockRejectedValueOnce(networkError)
          .mockResolvedValueOnce('success');

        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryWithBackoff(fn, { logger: silentLogger, baseDelay: 100 });

        // Advance past the delay
        await vi.advanceTimersByTimeAsync(100);

        const result = await promise;

        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(2);
      });

      it('should use exponential backoff by default', async () => {
        const networkError = new Error('Network error');
        networkError.code = 'NETWORK_ERROR';

        const fn = vi.fn()
          .mockRejectedValueOnce(networkError)
          .mockRejectedValueOnce(networkError)
          .mockResolvedValueOnce('success');

        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryWithBackoff(fn, {
          logger: silentLogger,
          baseDelay: 100,
          maxRetries: 3
        });

        // First retry: 100ms (100 * 2^0)
        await vi.advanceTimersByTimeAsync(100);
        // Second retry: 200ms (100 * 2^1)
        await vi.advanceTimersByTimeAsync(200);

        const result = await promise;
        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(3);
      });

      it('should use linear backoff when exponential=false', async () => {
        const networkError = new Error('Network error');
        networkError.code = 'NETWORK_ERROR';

        const fn = vi.fn()
          .mockRejectedValueOnce(networkError)
          .mockRejectedValueOnce(networkError)
          .mockResolvedValueOnce('success');

        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryWithBackoff(fn, {
          logger: silentLogger,
          baseDelay: 100,
          maxRetries: 3,
          exponential: false
        });

        // First retry: 100ms (100 * 1)
        await vi.advanceTimersByTimeAsync(100);
        // Second retry: 200ms (100 * 2)
        await vi.advanceTimersByTimeAsync(200);

        const result = await promise;
        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(3);
      });
    });

    describe('Error handling', () => {
      it('should throw immediately on non-retryable error', async () => {
        const validationError = new Error('Invalid input');

        const fn = vi.fn().mockRejectedValue(validationError);
        const silentLogger = { log: vi.fn(), error: vi.fn() };

        await expect(retryWithBackoff(fn, { logger: silentLogger }))
          .rejects.toThrow('Invalid input');

        expect(fn).toHaveBeenCalledTimes(1);
      });

      it('should throw after maxRetries exhausted', async () => {
        const networkError = new Error('Network error');
        networkError.code = 'NETWORK_ERROR';

        const fn = vi.fn().mockRejectedValue(networkError);
        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryWithBackoff(fn, {
          logger: silentLogger,
          maxRetries: 2,
          baseDelay: 100
        });

        // Attach catch handler immediately to prevent unhandled rejection warning
        promise.catch(() => {});

        // Run all timers to completion - handles all retries and promise settling
        await vi.runAllTimersAsync();

        // Use try-catch to explicitly handle rejection
        let thrownError;
        try {
          await promise;
        } catch (e) {
          thrownError = e;
        }

        expect(thrownError).toBeDefined();
        expect(thrownError.message).toBe('Network error');
        expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
      });
    });

    describe('Callbacks and logging', () => {
      it('should call onRetry callback', async () => {
        const networkError = new Error('Network error');
        networkError.code = 'NETWORK_ERROR';

        const fn = vi.fn()
          .mockRejectedValueOnce(networkError)
          .mockResolvedValueOnce('success');

        const onRetry = vi.fn();
        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryWithBackoff(fn, {
          logger: silentLogger,
          baseDelay: 100,
          onRetry
        });

        await vi.advanceTimersByTimeAsync(100);
        await promise;

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledWith(1, networkError, 100);
      });

      it('should log with context', async () => {
        const networkError = new Error('Network error');
        networkError.code = 'NETWORK_ERROR';

        const fn = vi.fn()
          .mockRejectedValueOnce(networkError)
          .mockResolvedValueOnce('success');

        const mockLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryWithBackoff(fn, {
          logger: mockLogger,
          baseDelay: 100,
          context: 'TestContext'
        });

        await vi.advanceTimersByTimeAsync(100);
        await promise;

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('TestContext')
        );
      });

      it('should use default console logger', async () => {
        const fn = vi.fn().mockResolvedValue('success');

        // Should not throw
        const result = await retryWithBackoff(fn);

        expect(result).toBe('success');
      });
    });

    describe('Default options', () => {
      it('should use maxRetries=2 by default', async () => {
        const networkError = new Error('Network error');
        networkError.code = 'NETWORK_ERROR';

        const fn = vi.fn().mockRejectedValue(networkError);
        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryWithBackoff(fn, { logger: silentLogger, baseDelay: 100 });
        promise.catch(() => {}); // Prevent unhandled rejection warning

        await vi.runAllTimersAsync();

        let thrownError;
        try {
          await promise;
        } catch (e) {
          thrownError = e;
        }

        expect(thrownError).toBeDefined();
        expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
      });

      it('should use baseDelay=1000 by default', async () => {
        const networkError = new Error('Network error');
        networkError.code = 'NETWORK_ERROR';

        const fn = vi.fn()
          .mockRejectedValueOnce(networkError)
          .mockResolvedValueOnce('success');

        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryWithBackoff(fn, { logger: silentLogger });

        // Should need 1000ms delay
        await vi.advanceTimersByTimeAsync(999);
        expect(fn).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        await promise;

        expect(fn).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('retryExternalService', () => {
    it('should use maxRetries=2', async () => {
      const networkError = new Error('Network error');
      networkError.code = 'NETWORK_ERROR';

      const fn = vi.fn().mockRejectedValue(networkError);
      const silentLogger = { log: vi.fn(), error: vi.fn() };

      const promise = retryExternalService(fn, 'TestService', silentLogger);
      promise.catch(() => {}); // Prevent unhandled rejection warning

      await vi.runAllTimersAsync();

      let thrownError;
      try {
        await promise;
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should use baseDelay=1000', async () => {
      const networkError = new Error('Network error');
      networkError.code = 'NETWORK_ERROR';

      const fn = vi.fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');

      const silentLogger = { log: vi.fn(), error: vi.fn() };

      const promise = retryExternalService(fn, 'TestService', silentLogger);

      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should include serviceName in context', async () => {
      const networkError = new Error('Network error');
      networkError.code = 'NETWORK_ERROR';

      const fn = vi.fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');

      const mockLogger = { log: vi.fn(), error: vi.fn() };

      const promise = retryExternalService(fn, 'MyAPI', mockLogger);

      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('MyAPI')
      );
    });

    it('should return result on success', async () => {
      const fn = vi.fn().mockResolvedValue({ data: 'test' });
      const silentLogger = { log: vi.fn(), error: vi.fn() };

      const result = await retryExternalService(fn, 'TestService', silentLogger);

      expect(result).toEqual({ data: 'test' });
    });
  });

  describe('retryRpcCall', () => {
    it('should use maxRetries=3', async () => {
      const networkError = new Error('Network error');
      networkError.code = 'NETWORK_ERROR';

      const fn = vi.fn().mockRejectedValue(networkError);
      const silentLogger = { log: vi.fn(), error: vi.fn() };

      const promise = retryRpcCall(fn, 'eth_call', silentLogger);
      promise.catch(() => {}); // Prevent unhandled rejection warning

      await vi.runAllTimersAsync();

      let thrownError;
      try {
        await promise;
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(fn).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should use baseDelay=500', async () => {
      const networkError = new Error('Network error');
      networkError.code = 'NETWORK_ERROR';

      const fn = vi.fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');

      const silentLogger = { log: vi.fn(), error: vi.fn() };

      const promise = retryRpcCall(fn, 'eth_call', silentLogger);

      await vi.advanceTimersByTimeAsync(500);
      await promise;

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should include method in context', async () => {
      const networkError = new Error('Network error');
      networkError.code = 'NETWORK_ERROR';

      const fn = vi.fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');

      const mockLogger = { log: vi.fn(), error: vi.fn() };

      const promise = retryRpcCall(fn, 'eth_getBalance', mockLogger);

      await vi.advanceTimersByTimeAsync(500);
      await promise;

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('eth_getBalance')
      );
    });

    it('should return result on success', async () => {
      const fn = vi.fn().mockResolvedValue('0x1234');
      const silentLogger = { log: vi.fn(), error: vi.fn() };

      const result = await retryRpcCall(fn, 'eth_call', silentLogger);

      expect(result).toBe('0x1234');
    });
  });

  describe('retryBatchOperations', () => {
    describe('Successful operations', () => {
      it('should return all successes when all operations succeed', async () => {
        const operations = [
          { id: 'op1', data: 'data1' },
          { id: 'op2', data: 'data2' }
        ];

        const operationFn = vi.fn().mockResolvedValue('result');
        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const result = await retryBatchOperations(
          operations,
          operationFn,
          { logger: silentLogger }
        );

        expect(result.successes).toHaveLength(2);
        expect(result.finalFailures).toHaveLength(0);
      });

      it('should include result and attempt count in successes', async () => {
        const operations = [{ id: 'op1' }];

        const operationFn = vi.fn().mockResolvedValue('myResult');
        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const result = await retryBatchOperations(
          operations,
          operationFn,
          { logger: silentLogger }
        );

        expect(result.successes[0].result).toBe('myResult');
        expect(result.successes[0].attempt).toBe(1);
      });
    });

    describe('Failed operations', () => {
      it('should retry failed operations', async () => {
        const operations = [{ id: 'op1' }];

        const operationFn = vi.fn()
          .mockRejectedValueOnce(new Error('Fail 1'))
          .mockResolvedValueOnce('success');

        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryBatchOperations(
          operations,
          operationFn,
          { logger: silentLogger, baseDelay: 100 }
        );

        await vi.advanceTimersByTimeAsync(200); // Wait for retry delay
        const result = await promise;

        expect(result.successes).toHaveLength(1);
        expect(result.successes[0].attempt).toBe(2);
        expect(operationFn).toHaveBeenCalledTimes(2);
      });

      it('should track final failures after maxRetries', async () => {
        const operations = [{ id: 'op1' }];

        const operationFn = vi.fn().mockRejectedValue(new Error('Always fails'));
        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryBatchOperations(
          operations,
          operationFn,
          { logger: silentLogger, maxRetries: 2, baseDelay: 100 }
        );

        // maxRetries=2 means attempts 1 and 2. Delay before attempt 2 = 200ms
        await vi.advanceTimersByTimeAsync(200);
        const result = await promise;

        expect(result.successes).toHaveLength(0);
        expect(result.finalFailures).toHaveLength(1);
        expect(result.finalFailures[0].retriesAttempted).toBe(2);
        expect(result.finalFailures[0].lastError.message).toBe('Always fails');
      });
    });

    describe('Mixed results', () => {
      it('should handle mixed success and failure', async () => {
        const operations = [
          { id: 'op1' },
          { id: 'op2' }
        ];

        const operationFn = vi.fn()
          .mockResolvedValueOnce('success1')
          .mockRejectedValue(new Error('Always fails'));

        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryBatchOperations(
          operations,
          operationFn,
          { logger: silentLogger, maxRetries: 2, baseDelay: 100 }
        );

        await vi.advanceTimersByTimeAsync(100);
        await vi.advanceTimersByTimeAsync(200);
        const result = await promise;

        expect(result.successes).toHaveLength(1);
        expect(result.successes[0].id).toBe('op1');
        expect(result.finalFailures).toHaveLength(1);
        expect(result.finalFailures[0].id).toBe('op2');
      });
    });

    describe('Default options', () => {
      it('should use maxRetries=3 by default', async () => {
        const operations = [{ id: 'op1' }];

        const operationFn = vi.fn().mockRejectedValue(new Error('Fail'));
        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryBatchOperations(
          operations,
          operationFn,
          { logger: silentLogger, baseDelay: 100 }
        );

        // retryBatchOperations delays: attempt 2 = 200ms, attempt 3 = 400ms (no delay on attempt 1)
        await vi.advanceTimersByTimeAsync(200);
        await vi.advanceTimersByTimeAsync(400);
        const result = await promise;

        expect(operationFn).toHaveBeenCalledTimes(3);
        expect(result.finalFailures[0].retriesAttempted).toBe(3);
      });

      it('should use exponential backoff by default', async () => {
        const operations = [{ id: 'op1' }];

        const operationFn = vi.fn()
          .mockRejectedValueOnce(new Error('Fail'))
          .mockRejectedValueOnce(new Error('Fail'))
          .mockResolvedValueOnce('success');

        const silentLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryBatchOperations(
          operations,
          operationFn,
          { logger: silentLogger, baseDelay: 100 }
        );

        // retryBatchOperations delays: attempt 2 = 200ms, attempt 3 = 400ms
        await vi.advanceTimersByTimeAsync(200);
        await vi.advanceTimersByTimeAsync(400);
        const result = await promise;

        expect(operationFn).toHaveBeenCalledTimes(3);
        expect(result.successes).toHaveLength(1);
      });
    });

    describe('Logging', () => {
      it('should log retry attempts', async () => {
        const operations = [{ id: 'testOp' }];

        const operationFn = vi.fn()
          .mockRejectedValueOnce(new Error('Fail'))
          .mockResolvedValueOnce('success');

        const mockLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryBatchOperations(
          operations,
          operationFn,
          { logger: mockLogger, baseDelay: 100 }
        );

        await vi.advanceTimersByTimeAsync(200);
        await promise;

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('testOp')
        );
      });

      it('should log successful recovery', async () => {
        const operations = [{ id: 'recoveredOp' }];

        const operationFn = vi.fn()
          .mockRejectedValueOnce(new Error('Fail'))
          .mockResolvedValueOnce('success');

        const mockLogger = { log: vi.fn(), error: vi.fn() };

        const promise = retryBatchOperations(
          operations,
          operationFn,
          { logger: mockLogger, baseDelay: 100 }
        );

        await vi.advanceTimersByTimeAsync(200);
        await promise;

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('Successfully recovered')
        );
      });

      it('should return empty results for empty operations array', async () => {
        const operationFn = vi.fn();
        const result = await retryBatchOperations([], operationFn);

        expect(result.successes).toEqual([]);
        expect(result.finalFailures).toEqual([]);
        expect(operationFn).not.toHaveBeenCalled();
      });
    });

    describe('UnrecoverableError in retryWithBackoff', () => {
      it('should throw immediately without retrying for UnrecoverableError', async () => {
        const fn = vi.fn().mockRejectedValue(new UnrecoverableError('fatal'));
        const silentLogger = { log: vi.fn(), error: vi.fn() };

        await expect(
          retryWithBackoff(fn, { logger: silentLogger, maxRetries: 3, baseDelay: 100 })
        ).rejects.toThrow('fatal');

        expect(fn).toHaveBeenCalledTimes(1);
      });
    });

    describe('retryWithBackoff with maxRetries=0', () => {
      it('should attempt once and throw on failure', async () => {
        const error = new Error('network error');
        error.code = 'NETWORK_ERROR';
        const fn = vi.fn().mockRejectedValue(error);
        const silentLogger = { log: vi.fn(), error: vi.fn() };

        await expect(
          retryWithBackoff(fn, { logger: silentLogger, maxRetries: 0, baseDelay: 100 })
        ).rejects.toThrow('network error');

        expect(fn).toHaveBeenCalledTimes(1);
      });
    });
  });
});
