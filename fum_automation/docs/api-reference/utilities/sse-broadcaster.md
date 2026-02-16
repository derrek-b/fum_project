<!-- Source: src/core/SSEBroadcaster.js -->
# SSEBroadcaster API

**Source:** `src/core/SSEBroadcaster.js`

Server-Sent Events streaming for real-time event delivery to frontend clients. Creates an HTTP server with SSE and REST endpoints.

## Constructor

```javascript
new SSEBroadcaster(eventManager, {
  port,                   // number, required — HTTP server port
  debug,                  // boolean, default false
  getBlacklist,           // () => Object — callback for blacklist data
  getFailedVaults,        // () => Object — callback for failed vaults data
  getFailedRemovals,      // () => Map — callback for failed listener removals
  getTrackingFailures,    // () => Object — callback for tracking failures
  getVaultMetadata,       // (addr) => Object — callback for vault metadata
  getVaultTransactions,   // (addr, start, end) => Promise<Array> — callback for vault transactions
  onCrash                 // (error) => void — callback for fatal errors
})
```

## Lifecycle

| Method | Description |
|---|---|
| `start()` | Start HTTP server, subscribe to broadcast events |
| `stop()` | Shutdown server, disconnect clients, unsubscribe from events |
| `getStatus()` | Get broadcaster status (running, clients connected, port) |

## HTTP Endpoints

| Endpoint | Handler | Description |
|---|---|---|
| `GET /events` | `handleSSEConnection` | SSE stream — keeps connection open, sends events |
| `GET /health` | `handleHealthCheck` | Health check |
| `GET /blacklist` | `handleBlacklistRequest` | Current blacklist data |
| `GET /tracking-failures` | `handleTrackingFailuresRequest` | Current tracking failures |
| `GET /failed-vaults` | `handleFailedVaultsRequest` | Current failed vaults (retry queue) |
| `GET /vault/:address/metadata` | `handleVaultRequest` | Vault metadata from Tracker |
| `GET /vault/:address/transactions?start=&end=` | `handleVaultRequest` | Vault transaction history |

## Broadcast Events

Events streamed to connected SSE clients (19 total):

**Service:** ServiceStarted, ServiceStartFailed
**Positions:** NewPositionCreated, PositionsClosed, PositionRebalanced, LiquidityAddedToPosition
**Fees:** FeesCollected
**Swaps:** TokensSwapped
**Native:** ETHWrapped, ETHUnwrapped
**Vaults:** VaultBaselineCaptured, MonitoringStarted, VaultFailed, VaultRecovered, VaultBlacklisted, VaultUnblacklisted
**Errors:** FeeCollectionFailed, VaultAuthEventFailed
**Tracking:** TransactionLogged, TrackerFailure, TrackerFailureCleared

## Data Sanitization

`sanitizePayload(data)` removes sensitive fields before broadcasting (e.g., internal state that shouldn't reach the frontend).
