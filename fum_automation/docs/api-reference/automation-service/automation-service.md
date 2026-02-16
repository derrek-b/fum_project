# AutomationService API

**Source:** `src/core/AutomationService.js`

Main orchestrator for vault automation. Creates and coordinates all other components.

## Constructor

```javascript
new AutomationService({
  automationServiceAddress,  // string, required — automation executor wallet address
  chainId,                   // number, required — network chain ID
  wsUrl,                     // string, required — WebSocket RPC URL
  debug,                     // boolean, default false
  retryIntervalMs,           // number, default 300000 (5 min) — failed vault retry interval
  maxFailureDurationMs,      // number, default 3600000 (1 hr) — max time in retry queue before blacklist
  ssePort,                   // number, default 3001
  blacklistFilePath,         // string, default './data/blacklist.json'
  trackingDataDir            // string, default './data/vaults'
})
```

Creates: EventManager, VaultDataService, Tracker, SSEBroadcaster, BabyStepsStrategy (`'bob'`).

## Lifecycle

| Method | Description |
|---|---|
| `start()` | Initialize provider, load adapters/tokens/contracts, discover vaults, begin monitoring |
| `stop(force?)` | Graceful shutdown: cleanup vaults, remove listeners, stop SSE/Tracker, close provider |
| `initialize()` | (called by start) Setup provider, adapters, tokens, contracts, inject dependencies |
| `initializeProvider()` | Create WebSocket provider, attach event handlers |

## Vault Discovery & Setup

| Method | Description |
|---|---|
| `loadAuthorizedVaults()` | Get authorized vaults from VaultFactory with retry |
| `setupVault(vaultAddress, options?)` | Load vault data, initialize strategy, start monitoring |
| `startMonitoringVault(vault)` | Subscribe to swap/config events, setup strategy monitoring |

## Event Handling

| Method | Description |
|---|---|
| `handleSwapEvent(data)` | Lock vault, delegate to strategy.handleSwapEvent(), process pending config updates |
| `handleConfigUpdate(vaultAddress, type, data)` | Route config update (tokens/platforms/params) — queues if vault is locked |
| `queueConfigUpdate(vaultAddress, type, data)` | Add to pendingConfigUpdates Map |
| `processPendingConfigUpdates(vaultAddress)` | Apply all queued updates for a vault |

## Vault Cleanup & Failure

| Method | Description |
|---|---|
| `cleanupVault(vaultAddress, strategyId)` | Strategy cleanup + remove listeners + remove from VaultDataService |
| `offboardVault(vaultAddress)` | Full cleanup for deauthorized vault |
| `trackFailedVault(vaultAddress, error, source)` | Add to failedVaults Map, record retry trip |
| `retryFailedVaults()` | Retry all failed vaults (runs on timer) |
| `recordRetryTrip(vaultAddress, source)` | Track trip; blacklist if ≥5 trips in 24 hours |
| `emergencyVaultCleanup(vaultAddress, reason)` | Force cleanup for unrecoverable errors |

## Blacklist Management

| Method | Description |
|---|---|
| `blacklistVault(vaultAddress, reason)` | Permanently exclude vault, persist to disk |
| `unblacklistVault(vaultAddress)` | Remove from blacklist |
| `isVaultBlacklisted(vaultAddress)` | Check blacklist status |
| `getBlacklistData()` | Get full blacklist Map |
| `loadBlacklist()` / `saveBlacklist()` | Disk persistence |

## Vault Locking

| Method | Description |
|---|---|
| `lockVault(vaultAddress)` | Acquire lock (timestamp-based). Returns false if already locked. |
| `unlockVault(vaultAddress)` | Release lock |

## Provider Reconnection

| Method | Description |
|---|---|
| `attemptReconnection()` | Reconnect WebSocket provider with backoff |
| `reestablishEventListeners()` | Re-register all blockchain listeners after reconnect |
| `handleProviderDisconnect(code, reason)` | Handle WebSocket disconnect event |
| `startHeartbeat()` / `stopHeartbeat()` | Periodic provider health check (30s interval) |

## Utilities

| Method | Description |
|---|---|
| `sendTelegramMessage(message)` | Send notification via Telegram |
| `getStatus()` | Service status summary |
| `isRecoverableError(error)` | Check if error is transient |
| `log(message)` | Debug logging |

## See Also

- [Architecture Overview](../../architecture/overview.md) — Component relationships
- [Automation Flow](../../architecture/automation-flow.md) — Detailed processing flows
- [Cache Structures](../../architecture/cache-structures.md) — All cached data shapes
