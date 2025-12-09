# RetryHelper

The RetryHelper module provides utility functions for retry logic with exponential backoff. It's used throughout the automation service to handle transient network failures, RPC timeouts, and external service errors.

## Overview

The module provides several functions:
- `isRetryableError()` - Determines if an error should trigger a retry
- `retryWithBackoff()` - Generic retry with configurable backoff
- `retryExternalService()` - Wrapper for external API calls
- `retryRpcCall()` - Wrapper for blockchain RPC calls
- `retryBatchOperations()` - Retry multiple operations with individual tracking

## Functions

### isRetryableError(error)

Determines if an error is retryable based on error codes and messages. Recursively checks nested error causes.

```javascript
import { isRetryableError } from './RetryHelper.js';

try {
  await someNetworkCall();
} catch (error) {
  if (isRetryableError(error)) {
    // Safe to retry
  } else {
    // Fatal error, don't retry
    throw error;
  }
}
```

**Parameters:**
- `error` (Error) - The error to check

**Returns:** `boolean` - True if the error should trigger a retry

**Retryable Error Codes:**
- `NETWORK_ERROR`
- `TIMEOUT`
- `ETIMEDOUT`
- `ECONNREFUSED`
- `ECONNRESET`
- `ENOTFOUND`
- `EHOSTUNREACH`
- `EAI_AGAIN`

**Retryable Error Messages (case-insensitive):**
- network, timeout, connection
- rate limit, too many requests
- 429, 502, 503, 504
- gateway timeout, bad gateway
- fetch failed, The Graph

### retryWithBackoff(fn, options)

Execute an async function with retry logic and exponential backoff.

```javascript
import { retryWithBackoff } from './RetryHelper.js';

const result = await retryWithBackoff(
  async () => {
    return await fetchData();
  },
  {
    maxRetries: 3,
    baseDelay: 1000,
    exponential: true,
    context: 'Fetching vault data',
    onRetry: (attempt, error, delay) => {
      console.log(`Retry ${attempt} after ${delay}ms`);
    }
  }
);
```

**Parameters:**
- `fn` (Function) - Async function to execute
- `options` (Object) - Configuration options:
  - `maxRetries` (number, default: 2) - Maximum retry attempts
  - `baseDelay` (number, default: 1000) - Base delay in milliseconds
  - `exponential` (boolean, default: true) - Use exponential vs linear backoff
  - `context` (string, default: '') - Context string for logging
  - `onRetry` (Function, optional) - Callback `(attempt, error, delay) => void`
  - `logger` (Object, default: console) - Logger with `log` and `error` methods

**Returns:** `Promise<any>` - Result from the function

**Throws:** Error if all retries fail or a non-retryable error occurs

**Backoff Calculation:**
- Exponential: `baseDelay * 2^(attempt-1)` → 1000, 2000, 4000ms
- Linear: `baseDelay * attempt` → 1000, 2000, 3000ms

### retryExternalService(fn, serviceName, logger?)

Wrapper for external service calls with appropriate defaults (2 retries, 1s base delay).

```javascript
import { retryExternalService } from './RetryHelper.js';

const prices = await retryExternalService(
  () => fetchTokenPrices(['WETH', 'USDC']),
  'CoinGecko'
);
```

**Parameters:**
- `fn` (Function) - Async function to execute
- `serviceName` (string) - Name of the service for logging
- `logger` (Object, optional) - Logger instance

**Returns:** `Promise<any>` - Result from the function

### retryRpcCall(fn, method, logger?)

Wrapper for blockchain RPC calls with appropriate defaults (3 retries, 500ms base delay).

```javascript
import { retryRpcCall } from './RetryHelper.js';

const balance = await retryRpcCall(
  () => provider.getBalance(address),
  'getBalance'
);
```

**Parameters:**
- `fn` (Function) - Async function to execute
- `method` (string) - RPC method name for logging
- `logger` (Object, optional) - Logger instance

**Returns:** `Promise<any>` - Result from the function

### retryBatchOperations(operations, operationFn, options)

Execute multiple operations with individual retry logic, tracking successes and failures.

```javascript
import { retryBatchOperations } from './RetryHelper.js';

const failedVaults = [
  { id: '0x123...', error: new Error('Network timeout') },
  { id: '0x456...', error: new Error('RPC error') }
];

const results = await retryBatchOperations(
  failedVaults,
  async (operation) => {
    return await loadVault(operation.id);
  },
  {
    maxRetries: 3,
    baseDelay: 2000,
    exponential: true
  }
);

console.log(`Recovered: ${results.successes.length}`);
console.log(`Still failing: ${results.finalFailures.length}`);
```

**Parameters:**
- `operations` (Array) - Array of operation objects to retry
- `operationFn` (Function) - Async function to execute for each operation
- `options` (Object) - Configuration options:
  - `maxRetries` (number, default: 3) - Max retries per operation
  - `baseDelay` (number, default: 1000) - Base delay in milliseconds
  - `exponential` (boolean, default: true) - Use exponential backoff
  - `logger` (Object, default: console) - Logger instance

**Returns:** `Promise<Object>` with structure:
```javascript
{
  successes: [
    { ...originalOperation, result: any, attempt: number }
  ],
  finalFailures: [
    { ...originalOperation, retriesAttempted: number, lastError: Error }
  ]
}
```

## Default Export

The module also provides a default export with all functions:

```javascript
import RetryHelper from './RetryHelper.js';

RetryHelper.isRetryableError(error);
RetryHelper.retryWithBackoff(fn, options);
RetryHelper.retryExternalService(fn, serviceName);
RetryHelper.retryRpcCall(fn, method);
RetryHelper.retryBatchOperations(operations, operationFn, options);
```

## Usage in AutomationService

The RetryHelper is used throughout the automation service:

```javascript
// Loading vault data with retry
const vaultData = await retryRpcCall(
  () => vaultDataService.loadVaultData(vaultAddress, provider),
  'loadVaultData',
  logger
);

// Fetching prices from CoinGecko
const prices = await retryExternalService(
  () => fetchTokenPrices(symbols),
  'CoinGecko',
  logger
);

// Recovering failed vault loads
const results = await retryBatchOperations(
  failedVaults,
  (vault) => loadVault(vault.address),
  { maxRetries: 3, baseDelay: 5000 }
);
```

## Best Practices

1. **Use appropriate wrappers**: `retryRpcCall` for blockchain calls, `retryExternalService` for APIs
2. **Set context for debugging**: Always provide a `context` string in production
3. **Handle non-retryable errors**: Check error type before deciding to retry
4. **Consider batch operations**: Use `retryBatchOperations` when recovering multiple failures
5. **Tune delays**: Shorter delays for RPC (500ms), longer for rate-limited APIs (1-2s)
