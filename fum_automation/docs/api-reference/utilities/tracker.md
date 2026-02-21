<!-- Source: src/core/Tracker.js -->
# Tracker API

**Source:** `src/core/Tracker.js`

Vault performance monitoring, ROI calculation, and transaction history tracking. Uses per-vault directory structure: JSON metadata file + JSONL transaction log.

## Constructor

```javascript
new Tracker({
  dataDir,                    // string, required — base directory for vault data
  eventManager,               // EventManager, required — for event subscriptions
  chainId,                    // number, required
  debug,                      // boolean, default false
  trackingFailuresFilePath    // string, required — path to tracking failures JSON file
})
```

## Lifecycle

| Method | Description |
|---|---|
| `initialize()` | Load existing vault metadata, load tracking failures, setup event listeners |
| `shutdown()` | Persist all data and cleanup |

## Event Handlers (auto-subscribed)

Called automatically via EventManager subscriptions:

| Handler | Triggered By |
|---|---|
| `handleBaselineCapture(data)` | `VaultBaselineCaptured` — initial vault value |
| `handleAssetValuesFetched(data)` | `AssetValuesFetched` — periodic value snapshots |
| `handleFeesCollected(data)` | `FeesCollected` |
| `handleFeesDistributed(data)` | `FeesDistributed` |
| `handleFeeDistributionFailed(data)` | `FeeDistributionFailed` |
| `handleFeeTrackingFailed(data)` | `FeeTrackingFailed` |
| `handlePositionRebalanced(data)` | `PositionRebalanced` |
| `handlePositionsClosed(data)` | `PositionsClosed` |
| `handleTokensSwapped(data)` | `TokensSwapped` |
| `handleNewPositionCreated(data)` | `NewPositionCreated` |
| `handleLiquidityAddedToPosition(data)` | `LiquidityAddedToPosition` |
| `handleWrapUnwrap(data, type)` | `ETHWrapped` / `ETHUnwrapped` |
| `handleVaultBlacklisted(data)` | `VaultBlacklisted` |
| `handleVaultRetryQueued(data)` | `VaultFailed` |
| `handleVaultRetrySuccess(data)` | `VaultRecovered` |

## Data Access

| Method | Description |
|---|---|
| `getMetadata(vaultAddress)` | Get cached vault metadata |
| `getTransactions(vaultAddress, startTime?, endTime?)` | Query transactions in time range (reads JSONL) |
| `calculateROI(vaultAddress, currentValue)` | Calculate return on investment from baseline |

## Data Storage

| Method | Description |
|---|---|
| `saveMetadata(vaultAddress, metadata)` | Write metadata JSON to disk |
| `appendTransaction(vaultAddress, transaction)` | Append to JSONL transaction log |
| `updateSnapshot(vaultAddress, currentValue, timestamp?)` | Update vault value snapshot |

## Tracking Failures

| Method | Description |
|---|---|
| `trackFailure(vaultAddress, eventType, error)` | Record a tracking failure |
| `clearTrackingFailure(vaultAddress)` | Clear failure for vault |
| `getTrackingFailuresData()` | Get all tracking failures |
| `loadTrackingFailures()` / `saveTrackingFailures()` | Disk persistence |

## Utilities

| Method | Description |
|---|---|
| `calculateGasUSD(gasNative)` | Convert gas cost (ETH) to USD via CoinGecko |

## Events Emitted

`TransactionLogged`, `TrackerFailure`, `TrackerFailureCleared`
