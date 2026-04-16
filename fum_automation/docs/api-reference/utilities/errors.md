<!-- Source: src/utils/errors.js -->
# Error Utilities API

**Source:** `src/utils/errors.js`

Custom error classes and helpers for structured error handling.

## Classes

### UnrecoverableError

Extends `Error`. Signals permanent failures that should trigger immediate vault blacklisting — retrying will not help.

```javascript
const err = new UnrecoverableError('Missing strategy for vault');
err.isUnrecoverable  // true
err.name             // 'UnrecoverableError'
```

**Examples**: missing strategy, missing adapter, invalid configuration, empty vault during initialization.

Used by: `AutomationService.isRecoverableError()`, `RetryHelper.isRetryableError()` (never retries these).

### InsufficientGasError

Extends `Error`. Thrown when a vault's executor has insufficient native gas for transaction execution. This is NOT unrecoverable — the vault needs a gas top-up, not blacklisting.

```javascript
const err = new InsufficientGasError('Executor underfunded', vaultAddress, executorAddress);
err.vaultAddress      // string
err.executorAddress   // string
err.name              // 'InsufficientGasError'
```

Used by: VaultHealth to enter funding-required state.

## Functions

### isInsufficientFundsError(error) → boolean

Checks if an error indicates the sender has insufficient funds to pay gas. Handles both:
- ethers.js v5 `INSUFFICIENT_FUNDS` error code (Geth/production)
- Hardhat's non-standard message: `"Sender doesn't have enough funds to send tx"`

### formatErrorForDisplay(error) → string

Extracts a human-readable message from ethers.js errors (which dump full calldata and nested RPC responses into `error.message`).

**Priority**:
1. Solidity revert reason (e.g., `"PositionVault: swap failed"`)
2. ethers.js `error.reason` field
3. First line of message, capped at 200 characters

Use for any error message sent to users: SSE events, blacklist reasons, tracker entries.

## See Also

- [RetryHelper](./retry-helper.md) — Never retries `UnrecoverableError`
- [VaultHealth](../core/vault-health.md) — Handles `InsufficientGasError`
