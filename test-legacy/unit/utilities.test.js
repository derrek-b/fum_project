/**
 * Unit tests for utility modules
 *
 * Tests for:
 * - RetryHelper (isRetryableError, retryWithBackoff)
 * - Tracker (calculateROI, getTransactions)
 * - Logger (getRecentLogs)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isRetryableError, retryWithBackoff } from '../../src-legacy/RetryHelper.js';
import Tracker from '../../src-legacy/Tracker.js';
import Logger from '../../src-legacy/Logger.js';

// Note: Permit2Helpers tests were removed as part of the refactoring to replace
// Permit2 with standard ERC20 approvals. The Permit2Helpers.js module was deleted
// and its functionality is no longer needed.

// ============================================================================
// RetryHelper Tests
// ============================================================================

describe('RetryHelper', () => {
  describe('isRetryableError', () => {
    describe('Network Error Codes', () => {
      const retryableCodes = [
        'NETWORK_ERROR',
        'TIMEOUT',
        'ETIMEDOUT',
        'ECONNREFUSED',
        'ECONNRESET',
        'ENOTFOUND',
        'EHOSTUNREACH',
        'EAI_AGAIN'
      ];

      retryableCodes.forEach(code => {
        it(`should return true for ${code} error code`, () => {
          const error = new Error('Test error');
          error.code = code;
          expect(isRetryableError(error)).toBe(true);
        });
      });
    });

    describe('Error Message Patterns', () => {
      const retryablePatterns = [
        { pattern: 'network error occurred', desc: 'network' },
        { pattern: 'request timeout', desc: 'timeout' },
        { pattern: 'connection failed', desc: 'connection' },
        { pattern: 'ECONNREFUSED in message', desc: 'ECONNREFUSED' },
        { pattern: 'rate limit exceeded', desc: 'rate limit' },
        { pattern: 'too many requests', desc: 'too many requests' },
        { pattern: 'HTTP 429 error', desc: '429' },
        { pattern: 'HTTP 502 bad gateway', desc: '502' },
        { pattern: 'HTTP 503 service unavailable', desc: '503' },
        { pattern: 'HTTP 504 gateway timeout', desc: '504' },
        { pattern: 'The Graph indexer error', desc: 'The Graph' },
        { pattern: 'gateway timeout occurred', desc: 'gateway timeout' },
        { pattern: 'bad gateway response', desc: 'bad gateway' },
        { pattern: 'fetch failed for resource', desc: 'fetch failed' }
      ];

      retryablePatterns.forEach(({ pattern, desc }) => {
        it(`should return true for message containing "${desc}"`, () => {
          const error = new Error(pattern);
          expect(isRetryableError(error)).toBe(true);
        });
      });
    });

    describe('Nested Error Cause Traversal', () => {
      it('should detect retryable error in error.cause', () => {
        const innerError = new Error('connection reset');
        const outerError = new Error('Request failed');
        outerError.cause = innerError;

        expect(isRetryableError(outerError)).toBe(true);
      });

      it('should detect retryable error code in nested cause', () => {
        const innerError = new Error('Network issue');
        innerError.code = 'ETIMEDOUT';
        const outerError = new Error('Request failed');
        outerError.cause = innerError;

        expect(isRetryableError(outerError)).toBe(true);
      });

      it('should traverse multiple levels of cause chain', () => {
        const deepError = new Error('rate limit hit');
        const middleError = new Error('Service error');
        middleError.cause = deepError;
        const outerError = new Error('Request failed');
        outerError.cause = middleError;

        expect(isRetryableError(outerError)).toBe(true);
      });
    });

    describe('Non-Retryable Errors', () => {
      it('should return false for generic error without retryable pattern', () => {
        const error = new Error('Invalid parameter');
        expect(isRetryableError(error)).toBe(false);
      });

      it('should return false for validation errors', () => {
        const error = new Error('Validation failed: missing required field');
        expect(isRetryableError(error)).toBe(false);
      });

      it('should return false for authentication errors', () => {
        const error = new Error('Authentication failed');
        expect(isRetryableError(error)).toBe(false);
      });

      it('should return false for unknown error codes', () => {
        const error = new Error('Some error');
        error.code = 'UNKNOWN_CODE';
        expect(isRetryableError(error)).toBe(false);
      });

      it('should return false for error with undefined message', () => {
        const error = new Error();
        expect(isRetryableError(error)).toBe(false);
      });
    });
  });

  describe('retryWithBackoff', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should succeed on first attempt without retrying', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const mockLogger = { log: vi.fn(), error: vi.fn() };

      const resultPromise = retryWithBackoff(fn, { logger: mockLogger });
      const result = await resultPromise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error and succeed', async () => {
      const networkError = new Error('network error');
      const fn = vi.fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');
      const mockLogger = { log: vi.fn(), error: vi.fn() };

      const resultPromise = retryWithBackoff(fn, {
        maxRetries: 2,
        baseDelay: 100,
        logger: mockLogger
      });

      // Advance timer for the retry delay
      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw immediately on non-retryable error', async () => {
      const validationError = new Error('Validation failed');
      const fn = vi.fn().mockRejectedValue(validationError);
      const mockLogger = { log: vi.fn(), error: vi.fn() };

      await expect(
        retryWithBackoff(fn, { maxRetries: 3, logger: mockLogger })
      ).rejects.toThrow('Validation failed');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should exhaust all retries and throw final error', async () => {
      const networkError = new Error('network error');
      const fn = vi.fn().mockRejectedValue(networkError);
      const mockLogger = { log: vi.fn(), error: vi.fn() };

      const resultPromise = retryWithBackoff(fn, {
        maxRetries: 2,
        baseDelay: 100,
        logger: mockLogger
      });

      // Run timers and await rejection concurrently to avoid unhandled rejection
      await Promise.all([
        vi.runAllTimersAsync(),
        expect(resultPromise).rejects.toThrow('network error')
      ]);

      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should use exponential backoff by default', async () => {
      const networkError = new Error('network error');
      const fn = vi.fn().mockRejectedValue(networkError);
      const mockLogger = { log: vi.fn(), error: vi.fn() };
      const delays = [];

      const resultPromise = retryWithBackoff(fn, {
        maxRetries: 3,
        baseDelay: 1000,
        exponential: true,
        logger: mockLogger,
        onRetry: (attempt, error, delay) => delays.push(delay)
      });

      // Run timers and await rejection concurrently to avoid unhandled rejection
      await Promise.all([
        vi.runAllTimersAsync(),
        expect(resultPromise).rejects.toThrow('network error')
      ]);

      // Verify exponential backoff: 1000 * 2^0 = 1000, 1000 * 2^1 = 2000, 1000 * 2^2 = 4000
      expect(delays).toEqual([1000, 2000, 4000]);
    });

    it('should use linear backoff when exponential is false', async () => {
      const networkError = new Error('network error');
      const fn = vi.fn().mockRejectedValue(networkError);
      const mockLogger = { log: vi.fn(), error: vi.fn() };
      const delays = [];

      const resultPromise = retryWithBackoff(fn, {
        maxRetries: 3,
        baseDelay: 1000,
        exponential: false,
        logger: mockLogger,
        onRetry: (attempt, error, delay) => delays.push(delay)
      });

      // Run timers and await rejection concurrently to avoid unhandled rejection
      await Promise.all([
        vi.runAllTimersAsync(),
        expect(resultPromise).rejects.toThrow('network error')
      ]);

      // Verify linear backoff: 1000 * 1 = 1000, 1000 * 2 = 2000, 1000 * 3 = 3000
      expect(delays).toEqual([1000, 2000, 3000]);
    });

    it('should call onRetry callback on each retry', async () => {
      const networkError = new Error('network error');
      const fn = vi.fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');
      const onRetry = vi.fn();
      const mockLogger = { log: vi.fn(), error: vi.fn() };

      const resultPromise = retryWithBackoff(fn, {
        maxRetries: 2,
        baseDelay: 100,
        onRetry,
        logger: mockLogger
      });

      await vi.advanceTimersByTimeAsync(100);
      await resultPromise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, networkError, 100);
    });
  });
});

// ============================================================================
// Tracker Tests
// ============================================================================

describe('Tracker', () => {
  describe('calculateROI', () => {
    let tracker;
    let mockEventManager;

    beforeEach(() => {
      mockEventManager = {
        subscribe: vi.fn(),
        emit: vi.fn()
      };

      tracker = new Tracker({
        dataDir: '/tmp/test-tracker',
        eventManager: mockEventManager,
        debug: false
      });
    });

    it('should return null when vault has no metadata', () => {
      const result = tracker.calculateROI('0x1234567890123456789012345678901234567890', 1000);
      expect(result).toBeNull();
    });

    it('should return null when metadata has no baseline', () => {
      const vaultAddress = '0x1234567890123456789012345678901234567890';
      tracker.vaultMetadata.set(vaultAddress, {
        aggregates: {
          cumulativeFeesUSD: 0,
          cumulativeGasUSD: 0
        }
      });

      const result = tracker.calculateROI(vaultAddress, 1000);
      expect(result).toBeNull();
    });

    it('should calculate correct ROI with fees and gas', () => {
      const vaultAddress = '0x1234567890123456789012345678901234567890';
      tracker.vaultMetadata.set(vaultAddress, {
        baseline: { value: 1000 },
        aggregates: {
          cumulativeFeesUSD: 50,
          cumulativeGasUSD: 10
        }
      });

      // currentValue = 1100
      // netValue = 1100 + 50 (fees) - 10 (gas) = 1140
      // ROI = (1140 - 1000) / 1000 * 100 = 14%
      const result = tracker.calculateROI(vaultAddress, 1100);

      expect(result).not.toBeNull();
      expect(result.baselineValue).toBe(1000);
      expect(result.currentValue).toBe(1100);
      expect(result.cumulativeFees).toBe(50);
      expect(result.cumulativeGas).toBe(10);
      expect(result.netValue).toBe(1140);
      expect(result.roi).toBeCloseTo(14, 5);
      expect(result.roiPercent).toBe('14.00');
    });

    it('should handle zero baseline gracefully', () => {
      const vaultAddress = '0x1234567890123456789012345678901234567890';
      tracker.vaultMetadata.set(vaultAddress, {
        baseline: { value: 0 },
        aggregates: {
          cumulativeFeesUSD: 50,
          cumulativeGasUSD: 10
        }
      });

      const result = tracker.calculateROI(vaultAddress, 1000);

      expect(result).not.toBeNull();
      expect(result.roi).toBe(0); // Avoid division by zero
    });

    it('should calculate negative ROI correctly', () => {
      const vaultAddress = '0x1234567890123456789012345678901234567890';
      tracker.vaultMetadata.set(vaultAddress, {
        baseline: { value: 1000 },
        aggregates: {
          cumulativeFeesUSD: 10,
          cumulativeGasUSD: 50
        }
      });

      // currentValue = 900
      // netValue = 900 + 10 (fees) - 50 (gas) = 860
      // ROI = (860 - 1000) / 1000 * 100 = -14%
      const result = tracker.calculateROI(vaultAddress, 900);

      expect(result.roi).toBeCloseTo(-14, 5);
      expect(result.roiPercent).toBe('-14.00');
    });
  });

  describe('getTransactions', () => {
    let tracker;
    let mockEventManager;

    beforeEach(() => {
      mockEventManager = {
        subscribe: vi.fn(),
        emit: vi.fn()
      };

      tracker = new Tracker({
        dataDir: '/tmp/nonexistent-test-dir-' + Date.now(),
        eventManager: mockEventManager,
        debug: false
      });
    });

    it('should return empty array when transactions file does not exist', async () => {
      const result = await tracker.getTransactions('0x1234567890123456789012345678901234567890');
      expect(result).toEqual([]);
    });
  });
});

// ============================================================================
// Logger Tests
// ============================================================================

describe('Logger', () => {
  describe('getRecentLogs', () => {
    let logger;

    beforeEach(() => {
      // Create a fresh logger instance for each test
      logger = new Logger.constructor();
      logger.buffer = [];
      logger.maxBufferSize = 1000;
    });

    it('should return empty array when buffer is empty', () => {
      const result = logger.getRecentLogs();
      expect(result).toEqual([]);
    });

    it('should return requested count of recent logs', () => {
      const entry1 = { timestamp: '2024-01-01T00:00:00Z', message: 'log 1' };
      const entry2 = { timestamp: '2024-01-01T00:00:01Z', message: 'log 2' };
      const entry3 = { timestamp: '2024-01-01T00:00:02Z', message: 'log 3' };

      logger.buffer = [entry1, entry2, entry3];

      const result = logger.getRecentLogs(2);
      expect(result).toEqual([entry2, entry3]);
    });

    it('should return all logs if count exceeds buffer size', () => {
      const entry1 = { timestamp: '2024-01-01T00:00:00Z', message: 'log 1' };
      const entry2 = { timestamp: '2024-01-01T00:00:01Z', message: 'log 2' };

      logger.buffer = [entry1, entry2];

      const result = logger.getRecentLogs(100);
      expect(result).toEqual([entry1, entry2]);
    });

    it('should use default count of 100 when not specified', () => {
      // Fill buffer with 150 entries
      for (let i = 0; i < 150; i++) {
        logger.buffer.push({ timestamp: `2024-01-01T00:00:${i}Z`, message: `log ${i}` });
      }

      const result = logger.getRecentLogs();
      expect(result.length).toBe(100);
      expect(result[0].message).toBe('log 50'); // Should get last 100
      expect(result[99].message).toBe('log 149');
    });
  });

  describe('buffer overflow management', () => {
    it('should enforce maxBufferSize limit', () => {
      // Use the singleton instance for this test
      const originalBuffer = Logger.buffer;
      const originalMaxSize = Logger.maxBufferSize;

      Logger.buffer = [];
      Logger.maxBufferSize = 5;

      // Add more logs than maxBufferSize
      for (let i = 0; i < 10; i++) {
        Logger.log('info', 'test', `message ${i}`);
      }

      expect(Logger.buffer.length).toBe(5);
      expect(Logger.buffer[0].message).toBe('message 5');
      expect(Logger.buffer[4].message).toBe('message 9');

      // Restore
      Logger.buffer = originalBuffer;
      Logger.maxBufferSize = originalMaxSize;
    });
  });
});
