<!-- Source: src/core/EventManager.js, src/core/AutomationService.js -->
# Event Management

## Overview

EventManager (`src/core/EventManager.js`) provides two functions:

1. **Pub/sub** — Internal event emission and subscription (`subscribe`/`emit`)
2. **Blockchain listener management** — Registration, lifecycle, and cleanup of on-chain event listeners

## Constructor State

```javascript
this.eventHandlers = {};    // Pub/sub: { eventName: [callback, ...] }
this.listeners = {};        // Blockchain listeners: { key: listenerObj }
this.poolToVaults = {};     // Pool-to-vault mapping: { poolAddr: [vaultAddr, ...] }
this.failedRemovals = Map;  // Failed removals for retry
this.isCleaningUp = false;  // Guard against concurrent cleanup
this.debug = false;
this.enabled = true;        // Set false during shutdown to suppress events
```

Dependencies injected after construction via setters:
- `setPoolData(poolData)` — pool data cache reference
- `setAdapters(adapters)` — platform adapters Map
- `setVaultDataService(vaultDataService)` — VaultDataService reference

## Pub/Sub System

### subscribe(event, callback) → unsubscribeFn

Registers a callback for an event. Returns an unsubscribe function.

```javascript
const unsub = eventManager.subscribe('VaultOnboarded', (data) => { ... });
unsub(); // Remove subscription
```

### emit(event, ...args)

Emits an event to all subscribers. Skipped if `enabled === false`. Supports per-event logging via `data.log` property:

```javascript
eventManager.emit('PositionRebalanced', {
  vaultAddress: '0x...',
  log: { level: 'info', message: 'Rebalanced position', includeData: false }
});
```

If `data.log.message` exists, it's printed to console with the specified level.

## Blockchain Listener Types

### registerContractListener({ contract, eventName, handler, vaultAddress, eventType, chainId, additionalId })

Registers a handler on a contract event (`contract.on(eventName, handler)`). Used for:
- Strategy parameter updates (`ParameterUpdated` on strategy contracts)
- Vault config events (`TargetTokensUpdated`, `TargetPlatformsUpdated` on vault contracts)

### registerFilterListener({ provider, filter, handler, address, eventType, chainId, additionalId })

Registers a handler on a provider event filter (`provider.on(filter, handler)`). Used for:
- Swap event monitoring on pool contracts
- Authorization events (`ExecutorChanged` on VaultFactory)

### Listener Key Generation

All registration methods generate a unique key via `generateListenerKey({ id, eventType, chainId, additionalId })`. Format: `{id}:{eventType}:{chainId}:{additionalId}`.

## Listener Lifecycle

### Registration
1. Generate key
2. Check for existing zombie listener (reactivate if found)
3. Wrap handler with `isRemoved` check (prevents zombie execution)
4. Attach to contract/provider/setInterval
5. Store in `this.listeners[key]`

### Removal
- `removeListener(key)` — Mark `isRemoved = true`, detach from contract/provider/clearInterval, delete from `this.listeners`. Tracks failed removals in `failedRemovals` Map.
- `removeAllVaultListeners(vaultAddress)` — Removes all listeners keyed to a vault. Also cleans pool-to-vault mappings: if a vault was the last one monitoring a pool, the pool's swap listener is removed too.
- `removeAllListeners()` — Removes everything during shutdown. Sets `isCleaningUp = true` to prevent concurrent cleanup.

### Zombie Prevention
Wrapped handlers check `listener.isRemoved` before executing. This handles the race condition where a blockchain event fires after `removeListener` is called but before the provider actually detaches the handler.

## Pool-to-Vault Shared Listeners

Swap events use a shared listener model. When multiple vaults monitor the same pool, only one provider filter is registered per pool. The `poolToVaults` mapping tracks which vaults to notify:

```
Pool 0xABC → [Vault1, Vault2]  // One filter listener, two notifications
Pool 0xDEF → [Vault3]          // One filter listener, one notification
```

Key methods:
- `addVaultToPool(poolId, vaultAddress)` — Add vault to pool's notification list
- `getVaultsForPool(poolId)` — Get all vaults for a pool
- `subscribeToSwapEvents(vault, provider, chainId)` — Sets up swap listeners for all of a vault's positions, reusing existing pool listeners when possible
- `refreshSwapListeners(vaultAddress, provider, chainId)` — Called after position changes to update monitored pools

## Subscription Methods

EventManager provides high-level subscription methods that handle event decoding and routing:

| Method | Monitors | Handler Logic |
|---|---|---|
| `subscribeToSwapEvents(vault, provider, chainId)` | Pool Swap events via filter | Decode swap log, emit `SwapEventDetected` for each affected vault |
| `subscribeToVaultConfigEvents(vault, provider, chainId)` | TargetTokensUpdated, TargetPlatformsUpdated on vault contract | Emit `TargetTokensUpdated` / `TargetPlatformsUpdated` |
| `subscribeToAuthorizationEvents(provider, address, chainId)` | ExecutorChanged on VaultFactory | Emit `VaultAuthGranted` / `VaultAuthRevoked` |
| `subscribeToStrategyParameterEvents(addresses, provider, chainId)` | ParameterUpdated on strategy contracts | Emit `StrategyParameterUpdated` |

## Failed Removal Tracking

When listener removal fails (e.g., provider disconnected), the failure is tracked in `failedRemovals` Map:

```javascript
this.failedRemovals = Map {
  'key' => { listener, failedAt, attempts, lastError }
}
```

Methods: `trackFailedListenerRemoval(key, listener, error)`, `clearFailedRemoval(key)`, `retryFailedRemovals()`, `getFailedRemovals()`.

## Control Methods

- `setDebug(enabled)` — Toggle debug logging
- `setEnabled(enabled)` — Enable/disable event processing (false during shutdown)
- `hasListener(key)` — Check if listener exists
- `getListenerCount()` — Total registered listeners
- `getMonitoredPools()` — Array of monitored pool addresses
- `isPoolMonitored(poolId)` — Check if pool has listeners
- `getPoolListenerCount()` — Number of unique pool listeners

## See Also

- [Cache Structures](./cache-structures.md) — Listener and poolToVaults data shapes
- [Automation Flow](./automation-flow.md) — How events trigger processing flows
