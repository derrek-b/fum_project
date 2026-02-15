# Tracker

The Tracker module provides vault performance monitoring, ROI calculation, and transaction history tracking. It manages per-vault metadata and transaction logs using a hybrid file structure with JSON metadata and JSONL transaction logs.

## Overview

The Tracker automatically subscribes to key events from the EventManager and records:
- Vault baselines (initial value snapshots)
- Fee collections
- Position rebalances
- Token swaps
- New position creations
- Liquidity additions
- Gas costs in ETH and USD

## Constructor

```javascript
import Tracker from './Tracker.js';

const tracker = new Tracker({
  dataDir: './data/vaults',
  eventManager: eventManagerInstance,
  debug: false
});
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dataDir` | string | Yes | Base directory for vault data storage |
| `eventManager` | EventManager | Yes | EventManager instance for subscribing to events |
| `debug` | boolean | No | Enable debug logging (default: false) |

## Methods

### initialize()

Initialize the tracker - loads all existing vault metadata and sets up event listeners.

```javascript
await tracker.initialize();
```

**Returns:** `Promise<void>`

### getMetadata(vaultAddress)

Get metadata for a specific vault.

```javascript
const metadata = tracker.getMetadata('0x1234...');
```

**Parameters:**
- `vaultAddress` (string) - The vault address

**Returns:** `Object|null` - Metadata object or null if not found

**Metadata Structure:**
```javascript
{
  vaultAddress: '0x...',
  baseline: {
    value: 10000.00,           // USD value at baseline capture
    tokenValue: 5000.00,       // Token balance value
    positionValue: 5000.00,    // Position value
    timestamp: 1699999999999,
    block: 12345678,
    capturePoint: 'vault_setup'
  },
  aggregates: {
    cumulativeFeesUSD: 150.00,
    cumulativeFeesReinvestedUSD: 120.00,
    cumulativeFeesWithdrawnUSD: 30.00,
    cumulativeGasETH: 0.05,
    cumulativeGasUSD: 100.00,
    swapCount: 5,
    rebalanceCount: 2,
    feeCollectionCount: 3,
    transactionCount: 10
  },
  lastSnapshot: {
    value: 10500.00,
    timestamp: 1700000000000
  },
  metadata: {
    strategyId: 'bob',
    firstSeen: 1699999999999,
    lastUpdated: 1700000000000
  }
}
```

### getTransactions(vaultAddress, startTime?, endTime?)

Get transactions for a vault within a time range.

```javascript
// Get all transactions
const allTxs = await tracker.getTransactions('0x1234...');

// Get transactions in a time range
const recentTxs = await tracker.getTransactions(
  '0x1234...',
  Date.now() - 86400000,  // Last 24 hours
  Date.now()
);
```

**Parameters:**
- `vaultAddress` (string) - The vault address
- `startTime` (number, optional) - Start timestamp in ms (default: 0)
- `endTime` (number, optional) - End timestamp in ms (default: Date.now())

**Returns:** `Promise<Array>` - Array of transaction objects

### calculateROI(vaultAddress, currentValue)

Calculate ROI metrics for a vault.

```javascript
const roi = tracker.calculateROI('0x1234...', 10500.00);
```

**Parameters:**
- `vaultAddress` (string) - The vault address
- `currentValue` (number) - Current vault value in USD

**Returns:** `Object|null` - ROI metrics or null if no baseline exists

**ROI Structure:**
```javascript
{
  baselineValue: 10000.00,
  currentValue: 10500.00,
  cumulativeFees: 150.00,
  cumulativeGas: 100.00,
  netValue: 10550.00,        // currentValue + fees - gas
  roi: 5.5,                  // Percentage
  roiPercent: '5.50'         // Formatted string
}
```

### updateSnapshot(vaultAddress, currentValue, timestamp?)

Manually update the snapshot value for a vault.

```javascript
await tracker.updateSnapshot('0x1234...', 10500.00);
```

**Parameters:**
- `vaultAddress` (string) - The vault address
- `currentValue` (number) - Current vault value in USD
- `timestamp` (number, optional) - Timestamp (default: Date.now())

**Returns:** `Promise<void>`

### shutdown()

Gracefully shutdown the tracker, persisting all pending data.

```javascript
await tracker.shutdown();
```

**Returns:** `Promise<void>`

## Events Subscribed

The Tracker automatically subscribes to these events from the EventManager:

| Event | Description |
|-------|-------------|
| `VaultBaselineCaptured` | Initial vault value snapshot |
| `FeesCollected` | Fee collection from positions |
| `PositionRebalanced` | Position rebalance operations |
| `PositionsClosed` | Position close operations |
| `TokensSwapped` | Token swap transactions |
| `NewPositionCreated` | New position creation |
| `LiquidityAddedToPosition` | Liquidity addition to existing positions |
| `AssetValuesFetched` | Periodic value updates for snapshots |

## Events Emitted

| Event | Description |
|-------|-------------|
| `TransactionLogged` | Emitted when a transaction is logged (for SSE broadcast) |

## File Structure

The Tracker stores data in the following structure:

```
{dataDir}/
  {vaultAddress}/
    metadata.json       # Vault metadata (JSON)
    transactions.jsonl  # Transaction log (JSONL - one JSON per line)
```

### Transaction Types

Each transaction in the JSONL log has a `type` field:

- `FeesCollected` - Fee collection with token amounts and USD values
- `PositionRebalanced` - Rebalance with reason and tick info
- `PositionsClosed` - Position closure with gas costs
- `TokensSwapped` - Token swaps with slippage analysis
- `NewPositionCreated` - Position creation with liquidity details
- `LiquidityAddedToPosition` - Liquidity addition with quoted vs actual amounts

## Example Usage

```javascript
import Tracker from './Tracker.js';
import EventManager from './EventManager.js';

// Create instances
const eventManager = new EventManager({ debug: true });
const tracker = new Tracker({
  dataDir: './data/vaults',
  eventManager,
  debug: true
});

// Initialize
await tracker.initialize();

// Later, query vault data
const metadata = tracker.getMetadata('0x1234...');
if (metadata) {
  console.log(`Vault has earned $${metadata.aggregates.cumulativeFeesUSD} in fees`);
}

// Calculate ROI
const currentValue = 10500.00; // From VaultDataService
const roi = tracker.calculateROI('0x1234...', currentValue);
if (roi) {
  console.log(`ROI: ${roi.roiPercent}%`);
}

// Get recent transactions
const transactions = await tracker.getTransactions(
  '0x1234...',
  Date.now() - 7 * 24 * 60 * 60 * 1000 // Last 7 days
);
console.log(`${transactions.length} transactions in the last week`);

// Shutdown gracefully
await tracker.shutdown();
```

## Integration with AutomationService

The Tracker is automatically initialized by the AutomationService:

```javascript
const automationService = new AutomationService({
  // ... other config
  trackingDataDir: './data/vaults'  // Passed to Tracker
});

// Access tracker instance
const metadata = automationService.tracker.getMetadata(vaultAddress);
```

## Notes

- All vault addresses are normalized using `ethers.utils.getAddress()` for consistent storage
- Metadata is persisted atomically using temp file + rename pattern
- Transaction logs are append-only JSONL for efficient streaming reads
- Gas costs are converted to USD using live WETH prices from CoinGecko
- The Tracker gracefully handles missing vaults (returns null/empty arrays)
