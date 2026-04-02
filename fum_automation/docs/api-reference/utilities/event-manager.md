<!-- Source: src/core/EventManager.js -->
# EventManager API

**Source:** `src/core/EventManager.js`

Pub/sub event system and blockchain listener management. See [Event Management Architecture](../../architecture/event-management.md) for design details.

## Constructor

```javascript
new EventManager()
```

No arguments. Dependencies injected via `setPoolData()`, `setAdapters()`, `setVaultDataService()`.

## Pub/Sub

| Method | Description |
|---|---|
| `subscribe(event, callback)` | Subscribe to event. Returns unsubscribe function. |
| `emit(event, ...args)` | Emit event to all subscribers. Supports `data.log` for per-event console logging. Skipped when `enabled === false`. |

## Listener Registration

| Method | Description |
|---|---|
| `registerContractListener({contract, eventName, handler, vaultAddress, eventType, chainId, additionalId})` | Register handler on contract event. Returns listener key. |
| `registerFilterListener({provider, filter, handler, address, eventType, chainId, additionalId})` | Register handler on provider event filter. Returns listener key. |

## Listener Removal

| Method | Description |
|---|---|
| `removeListener(key)` | Remove specific listener. Tracks in failedRemovals on error. |
| `removeAllVaultListeners(vaultAddress)` | Remove all listeners for a vault + clean pool mappings. |
| `removeAllListeners()` | Remove everything (shutdown). Guards against concurrent calls. |

## Subscription Methods (high-level)

| Method | Description |
|---|---|
| `subscribeToSwapEvents(vault, provider, chainId)` | Monitor pool Swap events for vault's positions |
| `refreshSwapListeners(vaultAddress, provider, chainId)` | Update swap listeners after position changes |
| `subscribeToVaultConfigEvents(vault, provider, chainId)` | Monitor TargetTokensUpdated, TargetPlatformsUpdated |
| `subscribeToAuthorizationEvents(provider, address, chainId)` | Monitor ExecutorChanged on VaultFactory |
| `subscribeToStrategyParameterEvents(addresses, provider, chainId)` | Monitor ParameterUpdated on strategy contracts |

## Pool-to-Vault Mapping

| Method | Description |
|---|---|
| `addVaultToPool(poolId, vaultAddress)` | Add vault to pool's notification list |
| `getVaultsForPool(poolId)` | Get all vaults monitoring a pool |
| `getMonitoredPools()` | All monitored pool addresses |
| `isPoolMonitored(poolId)` | Check if pool has listeners |
| `getPoolListenerCount()` | Number of unique pool listeners |

## Failed Removal Tracking

| Method | Description |
|---|---|
| `trackFailedListenerRemoval(key, listener, error)` | Record failed removal |
| `clearFailedRemoval(key)` | Clear a failed removal record |
| `retryFailedRemovals()` | Retry all failed removals |
| `getFailedRemovals()` | Get failedRemovals Map |

## Control

| Method | Description |
|---|---|
| `setDebug(enabled)` | Toggle debug logging |
| `setEnabled(enabled)` | Enable/disable event processing |
| `generateListenerKey({id, eventType, chainId, additionalId})` | Generate unique listener key |
| `hasListener(key)` | Check if listener exists |
| `getListenerCount()` | Total registered listeners |

## See Also

- [Event Management Architecture](../../architecture/event-management.md) — Lifecycle, zombie prevention, shared listeners
