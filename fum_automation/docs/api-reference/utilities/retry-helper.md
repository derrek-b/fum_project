<!-- Source: src/utils/RetryHelper.js -->
# RetryHelper API

**Source:** `src/utils/RetryHelper.js`

Retry logic with exponential backoff for network, RPC, and external service errors.

## Functions

### isRetryableError(error) → boolean

Checks error codes and messages recursively (follows `error.cause` chain). Never retries `UnrecoverableError`.

**Retryable codes:** NETWORK_ERROR, TIMEOUT, ETIMEDOUT, ECONNREFUSED, ECONNRESET, ENOTFOUND, EHOSTUNREACH, EAI_AGAIN

**Retryable message patterns:** network, timeout, connection, rate limit, too many requests, 429, 502, 503, 504, The Graph, gateway timeout, bad gateway, fetch failed

### retryWithBackoff(fn, options?) → Promise\<result\>

Generic retry wrapper. Calls `fn()`, retries on retryable errors.

| Option | Default | Description |
|---|---|---|
| `maxRetries` | 2 | Max retry attempts (total calls = maxRetries + 1) |
| `baseDelay` | 1000 | Base delay in ms |
| `exponential` | true | Exponential backoff (true) vs linear (false) |
| `context` | `''` | Label for log messages |
| `onRetry` | null | `(attempt, error, delay) => void` callback |
| `logger` | console | Object with `.log()` and `.error()` |

### retryExternalService(fn, serviceName, logger?) → Promise\<result\>

Wrapper for external API calls. 2 retries, 1000ms base, exponential backoff.

### retryRpcCall(fn, method, logger?) → Promise\<result\>

Wrapper for blockchain RPC calls. 3 retries, 500ms base, exponential backoff.

### retryBatchOperations(operations, operationFn, options?) → Promise\<{ successes, finalFailures }\>

Retry multiple operations independently. Each gets its own retry attempts.

| Option | Default | Description |
|---|---|---|
| `maxRetries` | 3 | Max retries per operation |
| `baseDelay` | 1000 | Base delay in ms |
| `exponential` | true | Backoff type |
| `logger` | console | Logger instance |

Returns `{ successes: [...], finalFailures: [...] }` — each entry includes the original operation plus result/error info.

## Related

- `UnrecoverableError` (`src/utils/errors.js`) — Custom error class with `isUnrecoverable = true`. Used to mark permanent failures that should not be retried.
