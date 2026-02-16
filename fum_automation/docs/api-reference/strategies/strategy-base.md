# StrategyBase API

**Source:** `src/strategies/base/StrategyBase.js` (431 lines)

Abstract base class for all vault management strategies.

## Constructor

```javascript
new StrategyBase({
  vaultDataService,    // VaultDataService instance
  eventManager,        // EventManager instance
  provider,            // ethers provider (null until initialize)
  adapters,            // Map of platform adapters (null until initialize)
  chainId,             // number
  debug,               // boolean
  vaultLocks,          // shared object reference
  poolData,            // shared object reference
  sendTelegramMessage, // notification callback
  automationService,   // AutomationService reference
  tokens,              // token configurations (null until initialize)
  serviceConfig        // service config (null until initialize)
})
```

Also initializes `this.registeredListenerKeys = {}` for per-vault listener tracking.

## Required Methods (must implement in subclass)

| Method | Signature | Called By |
|---|---|---|
| `initializeVault` | `(vault) → Promise<boolean>` | `AutomationService.setupVault` |
| `handleSwapEvent` | `(vault, poolId, platform, log)` | `AutomationService.handleSwapEvent` |
| `cleanup` | `(vaultAddress)` | `AutomationService.cleanupVault` |
| `setupAdditionalMonitoring` | `(vault)` | `AutomationService.startMonitoringVault` |

## Provided Methods

| Method | Signature | Returns |
|---|---|---|
| `executeBatchTransactions` | `(vault, transactions, operationType, type)` | `{ receipt, gasEstimated }` |
| `isWrapUnwrapPair` | `(tokenIn, tokenOut)` | `{ isWrap, isUnwrap, isWrapOrUnwrap }` |
| `executeWrap` | `(vault, amount)` | `receipt` |
| `executeUnwrap` | `(vault, amount)` | `receipt` |
| `buildSwapDetails` | `(swapMetadata, actualSwaps)` | `swapDetails[]` |
| `log` | `(message, ...args)` | void |

### executeBatchTransactions

Transaction `type` determines which vault contract function is called:

| Type | Vault Function | Payable |
|---|---|---|
| `swap` | `swap(targets, data, values)` | No (uses vault ETH) |
| `approval` | `approve(targets, data)` | No |
| `mint` | `mint(targets, data, values)` | No |
| `addliq` | `increaseLiquidity(targets, data, values)` | No |
| `subliq` | `decreaseLiquidity(targets, data)` | No |
| `collect` | `collect(targets, data)` | No |
| `burn` | `burn(targets, data)` | No |

Each transaction in the array must have `{ to, data, value? }`. Creates signer from `AUTOMATION_PRIVATE_KEY` env var.

## Events Emitted

- `BatchTransactionExecuted` — after successful batch execution
- `NativeWrapped` — after executeWrap
- `NativeUnwrapped` — after executeUnwrap

## See Also

- [Strategy System](../../architecture/strategy-system.md) — Architecture and how to add strategies
