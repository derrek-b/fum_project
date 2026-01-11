/**
 * @module utils/RetryHelper
 * @description Utility module for retry logic with exponential backoff
 */

/**
 * Check a single error object for retryable conditions
 * @param {Error} error - The error to check
 * @returns {boolean} True if this specific error is retryable
 */
function checkSingleError(error) {
  // Never retry errors explicitly marked as unrecoverable
  const errorMessage = error.message || '';
  if (errorMessage.startsWith('UNRECOVERABLE ERROR:')) {
    return false;
  }

  // Network and timeout errors
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

  // Error message patterns that indicate retryable conditions
  const retryableMessages = [
    'network',
    'timeout',
    'connection',
    'ECONNREFUSED',
    'rate limit',
    'too many requests',
    '429',
    '502',
    '503',
    '504',
    'The Graph',
    'gateway timeout',
    'bad gateway',
    'fetch failed'
  ];

  // Check error code first
  if (error.code && retryableCodes.includes(error.code)) {
    return true;
  }

  // Check error message patterns
  const lowerMessage = errorMessage.toLowerCase();
  return retryableMessages.some(pattern => lowerMessage.includes(pattern.toLowerCase()));
}

/**
 * Determines if an error is retryable based on error codes and messages
 * Checks the main error and recursively checks nested error causes
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error should trigger a retry
 */
export function isRetryableError(error) {
  // Check the main error first
  if (checkSingleError(error)) {
    return true;
  }

  // Check nested error causes recursively
  let currentError = error;
  while (currentError.cause) {
    currentError = currentError.cause;
    if (checkSingleError(currentError)) {
      return true;
    }
  }

  return false;
}

/**
 * Execute a function with retry logic and exponential backoff
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry configuration options
 * @param {number} [options.maxRetries=2] - Maximum number of retry attempts
 * @param {number} [options.baseDelay=1000] - Base delay in milliseconds
 * @param {boolean} [options.exponential=true] - Use exponential backoff vs linear
 * @param {string} [options.context=''] - Context for logging
 * @param {Function} [options.onRetry] - Callback for retry attempts
 * @param {Object} [options.logger] - Logger instance with log method
 * @returns {Promise<any>} Result from the function
 * @throws {Error} Final error if all retries fail
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 2,
    baseDelay = 1000,
    exponential = true,
    context = '',
    onRetry = null,
    logger = console
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      // Attempt the function
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if this is the last attempt
      if (attempt > maxRetries) {
        const message = context
          ? `${context}: All retry attempts exhausted (${maxRetries} retries)`
          : `All retry attempts exhausted (${maxRetries} retries)`;

        if (logger && logger.error) {
          logger.error(message, error.message);
        }
        throw error;
      }

      // Check if error is retryable
      if (!isRetryableError(error)) {
        const message = context
          ? `${context}: Non-retryable error encountered`
          : 'Non-retryable error encountered';

        if (logger && logger.log) {
          logger.log(`${message}: ${error.message}`);
        }
        throw error;
      }

      // Calculate delay
      const delay = exponential
        ? baseDelay * Math.pow(2, attempt - 1)
        : baseDelay * attempt;

      const message = context
        ? `${context}: Retry attempt ${attempt}/${maxRetries} after ${delay}ms`
        : `Retry attempt ${attempt}/${maxRetries} after ${delay}ms`;

      if (logger && logger.log) {
        logger.log(`${message} - Error: ${error.message}`);
      }

      // Call retry callback if provided
      if (onRetry) {
        await onRetry(attempt, error, delay);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but for safety
  throw lastError;
}

/**
 * Wrapper specifically for external service calls with appropriate defaults
 * @param {Function} fn - Async function to execute
 * @param {string} serviceName - Name of the external service (for logging)
 * @param {Object} [logger] - Logger instance
 * @returns {Promise<any>} Result from the function
 */
export async function retryExternalService(fn, serviceName, logger = console) {
  return retryWithBackoff(fn, {
    maxRetries: 2,
    baseDelay: 1000,
    exponential: true,
    context: `External service (${serviceName})`,
    logger
  });
}

/**
 * Wrapper specifically for blockchain RPC calls with appropriate defaults
 * @param {Function} fn - Async function to execute
 * @param {string} method - RPC method name (for logging)
 * @param {Object} [logger] - Logger instance
 * @returns {Promise<any>} Result from the function
 */
export async function retryRpcCall(fn, method, logger = console) {
  return retryWithBackoff(fn, {
    maxRetries: 3,
    baseDelay: 500,
    exponential: true,
    context: `RPC call (${method})`,
    logger
  });
}

/**
 * Execute multiple operations with individual retry logic for failures
 * @param {Array<Object>} operations - Array of operation objects to retry
 * @param {Function} operationFn - Function to execute for each operation
 * @param {Object} options - Retry configuration options
 * @param {number} [options.maxRetries=3] - Maximum retry attempts per operation
 * @param {number} [options.baseDelay=1000] - Base delay in milliseconds
 * @param {boolean} [options.exponential=true] - Use exponential backoff vs linear
 * @param {Object} [options.logger] - Logger instance with log method
 * @returns {Promise<Object>} Object with successes and finalFailures arrays
 */
export async function retryBatchOperations(operations, operationFn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    exponential = true,
    logger = console
  } = options;

  const results = {
    successes: [],
    finalFailures: []
  };

  for (const operation of operations) {
    let success = false;
    let lastError = operation.errorDetails || operation.error || new Error('Unknown error');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Exponential or linear backoff
        const delay = exponential
          ? baseDelay * Math.pow(2, attempt - 1)
          : baseDelay * attempt;

        // Wait before retrying (except on first attempt)
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        if (logger && logger.log) {
          logger.log(`Retry attempt ${attempt}/${maxRetries} for ${operation.id || operation.platformId || 'operation'} (delay: ${delay}ms)`);
        }

        // Execute the operation function
        const result = await operationFn(operation);

        if (logger && logger.log) {
          logger.log(`Successfully recovered ${operation.id || operation.platformId || 'operation'} on attempt ${attempt}`);
        }

        results.successes.push({
          ...operation,
          result,
          attempt
        });

        success = true;
        break;
      } catch (error) {
        lastError = error;

        if (logger && logger.log) {
          logger.log(`Retry attempt ${attempt} failed for ${operation.id || operation.platformId || 'operation'}: ${error.message}`);
        }
      }
    }

    if (!success) {
      results.finalFailures.push({
        ...operation,
        retriesAttempted: maxRetries,
        lastError
      });
    }
  }

  return results;
}

export default {
  isRetryableError,
  retryWithBackoff,
  retryExternalService,
  retryRpcCall,
  retryBatchOperations
};
