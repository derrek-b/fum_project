# EventManager API Reference

## Overview

The `EventManager` class provides a centralized event management system for the FUM Automation framework. It handles the lifecycle of blockchain event listeners, provider filters, and periodic intervals, ensuring proper cleanup and preventing memory leaks in long-running automation processes.

### Key Features

- **Centralized Lifecycle Management**: All event listeners are registered and tracked in a single location
- **Automatic Cleanup**: Provides methods to remove listeners by vault, chain, or all at once
- **Memory Leak Prevention**: Tracks listener references and ensures proper cleanup on removal
- **Multiple Listener Types**: Supports contract events, provider filters, and interval timers
- **Debug Capabilities**: Built-in logging for monitoring listener registration and removal
- **Enabled/Disabled States**: Can temporarily disable event processing without removing listeners

### Design Philosophy

The EventManager follows these principles:

1. **Single Source of Truth**: All listeners are tracked in one place
2. **Defensive Programming**: Prevents duplicate cleanup and handles edge cases
3. **Flexible Key Generation**: Supports vault-specific and custom identifiers
4. **Type-Safe Operations**: Different handling for contracts, filters, and intervals

## Class: EventManager

```typescript
class EventManager {
  constructor()
  
  // State Management
  setDebug(enabled: boolean): void
  setEnabled(enabled: boolean): boolean
  
  // Event Subscription
  subscribe(event: string, callback: Function): Function
  emit(event: string, ...args: any[]): void
  
  // Listener Registration
  registerContractListener(options: ContractListenerOptions): string
  registerFilterListener(options: FilterListenerOptions): string
  registerInterval(options: IntervalOptions): string
  
  // Listener Management
  generateListenerKey(options: KeyOptions): string
  removeListener(key: string): Promise<boolean>
  removeAllVaultListeners(vault: VaultObject): number
  removeChainListeners(chainId: number): number
  removeAllListeners(): Promise<number>
  
  // Utility Methods
  getVaultListenerKeys(vaultAddress: string): string[]
  hasListener(key: string): boolean
  getListenerCount(): number
  log(message: string): void
}
```

## Constructor

### `new EventManager()`

Creates a new EventManager instance with empty listener storage and default settings.

```javascript
const eventManager = new EventManager();
```

#### Initial State

- `listeners`: Empty object for storing registered listeners
- `eventHandlers`: Empty object for internal event subscriptions
- `debug`: `false` (debug logging disabled)
- `enabled`: `true` (event processing enabled)
- `isCleaningUp`: `false` (no cleanup in progress)

## State Management Methods

### `setDebug(enabled)`

Enable or disable debug logging for the EventManager.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `enabled` | `boolean` | Yes | Whether to enable debug logging |

#### Example

```javascript
// Enable debug logging
eventManager.setDebug(true);

// Now all operations will log detailed information
eventManager.registerContractListener({...});
// Output: [EventManager] Registered contract listener: 0x123...-strategy-1
```

### `setEnabled(enabled)`

Enable or disable event processing. When disabled, events are still registered but handlers are not executed.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `enabled` | `boolean` | Yes | Whether to enable event processing |

#### Returns

- **Type**: `boolean`
- **Description**: The current enabled state after the operation

#### Example

```javascript
// Temporarily disable event processing
eventManager.setEnabled(false);

// Events will be registered but not processed
eventManager.registerFilterListener({
  provider,
  filter,
  handler: () => console.log('This will not execute'),
  // ... other options
});

// Re-enable event processing
eventManager.setEnabled(true);
```

## Event Subscription Methods

### `subscribe(event, callback)`

Subscribe to internal EventManager events. Used for cross-component communication.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event` | `string` | Yes | Event name to subscribe to |
| `callback` | `Function` | Yes | Function to call when event is emitted |

#### Returns

- **Type**: `Function`
- **Description**: Unsubscribe function that removes the callback when called

#### Example

```javascript
// Subscribe to vault update events
const unsubscribe = eventManager.subscribe('vault:updated', (vaultData) => {
  console.log('Vault updated:', vaultData.address);
});

// Later: unsubscribe from the event
unsubscribe();
```

### `emit(event, ...args)`

Emit an internal event to all subscribed handlers.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event` | `string` | Yes | Event name to emit |
| `...args` | `any[]` | No | Arguments to pass to event handlers |

#### Behavior

- Skips emission if EventManager is disabled
- Catches and logs errors in individual handlers
- Continues execution even if a handler fails

#### Example

```javascript
// Emit a vault update event
eventManager.emit('vault:updated', {
  address: '0x123...',
  chainId: 1,
  newState: 'active'
});

// Emit with multiple arguments
eventManager.emit('strategy:executed', vaultAddress, strategyName, result);
```

## Listener Registration Methods

### `registerContractListener(options)`

Register an event listener for a smart contract event.

#### Parameters

```typescript
interface ContractListenerOptions {
  contract: ethers.Contract;     // Contract instance
  eventName: string;             // Event name to listen for
  handler: Function;             // Event handler function
  vaultAddress: string;          // Associated vault address
  eventType: string;             // Type of event (e.g., 'strategy', 'token')
  chainId: number;               // Chain ID
  additionalId?: string;         // Optional additional identifier
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.contract` | `ethers.Contract` | Yes | Ethers.js contract instance |
| `options.eventName` | `string` | Yes | Name of the contract event |
| `options.handler` | `Function` | Yes | Function to handle the event |
| `options.vaultAddress` | `string` | Yes | Address of associated vault |
| `options.eventType` | `string` | Yes | Type identifier (e.g., 'strategy', 'token') |
| `options.chainId` | `number` | Yes | Blockchain chain ID |
| `options.additionalId` | `string` | No | Additional identifier for uniqueness |

#### Returns

- **Type**: `string`
- **Description**: Unique listener key for future reference

#### Example

```javascript
// Register a Transfer event listener
const listenerKey = eventManager.registerContractListener({
  contract: tokenContract,
  eventName: 'Transfer',
  handler: (from, to, amount) => {
    console.log(`Transfer: ${from} -> ${to}: ${amount}`);
  },
  vaultAddress: '0x123...',
  eventType: 'token',
  chainId: 1,
  additionalId: 'USDC'
});

// Later: remove this specific listener
await eventManager.removeListener(listenerKey);
```

### `registerFilterListener(options)`

Register an event filter listener with a provider. Used for listening to multiple events or complex queries.

#### Parameters

```typescript
interface FilterListenerOptions {
  provider: ethers.Provider;     // Provider instance
  filter: ethers.EventFilter;    // Event filter
  handler: Function;             // Event handler function
  address: string;               // Associated address (vault, strategy, or 'global')
  eventType: string;             // Type of event
  chainId: number;               // Chain ID
  additionalId?: string;         // Optional additional identifier
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.provider` | `ethers.Provider` | Yes | Ethers.js provider instance |
| `options.filter` | `ethers.EventFilter` | Yes | Event filter object |
| `options.handler` | `Function` | Yes | Function to handle matching events |
| `options.address` | `string` | Yes | Associated address (vault address, strategy address, or 'global' for chain-wide listeners) |
| `options.eventType` | `string` | Yes | Type identifier for the filter |
| `options.chainId` | `number` | Yes | Blockchain chain ID |
| `options.additionalId` | `string` | No | Additional identifier for uniqueness |

#### Returns

- **Type**: `string`
- **Description**: Unique listener key for future reference

#### Behavior

- Wraps handler to check enabled state before execution
- Logs detailed filter information for debugging
- Returns key even if disabled (for consistency)

#### Example

```javascript
// Create a filter for all Transfer events to a specific address
const filter = {
  address: tokenAddress,
  topics: [
    ethers.utils.id("Transfer(address,address,uint256)"),
    null, // from any address
    ethers.utils.zeroPadValue(vaultAddress, 32) // to vault address
  ]
};

const listenerKey = eventManager.registerFilterListener({
  provider,
  filter,
  handler: (log) => {
    const parsed = tokenContract.interface.parseLog(log);
    console.log('Incoming transfer:', parsed.args);
  },
  vaultAddress: '0x123...',
  eventType: 'incoming-transfers',
  chainId: 1
});
```

### `registerInterval(options)`

Register a periodic interval for repeated execution.

#### Parameters

```typescript
interface IntervalOptions {
  callback: Function;            // Function to execute
  intervalMs: number;            // Interval in milliseconds
  vaultAddress: string;          // Associated vault address
  eventType: string;             // Type of interval
  chainId: number;               // Chain ID
  additionalId?: string;         // Optional additional identifier
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.callback` | `Function` | Yes | Function to execute on each interval |
| `options.intervalMs` | `number` | Yes | Interval duration in milliseconds |
| `options.vaultAddress` | `string` | Yes | Address of associated vault |
| `options.eventType` | `string` | Yes | Type identifier for the interval |
| `options.chainId` | `number` | Yes | Blockchain chain ID |
| `options.additionalId` | `string` | No | Additional identifier for uniqueness |

#### Returns

- **Type**: `string`
- **Description**: Unique interval key for future reference

#### Example

```javascript
// Register a price check every 5 minutes
const intervalKey = eventManager.registerInterval({
  callback: async () => {
    const price = await priceOracle.getPrice(tokenAddress);
    console.log('Current price:', price);
  },
  intervalMs: 5 * 60 * 1000, // 5 minutes
  vaultAddress: '0x123...',
  eventType: 'price-check',
  chainId: 1,
  additionalId: 'ETH-USD'
});

// Later: stop the interval
await eventManager.removeListener(intervalKey);
```

## Key Generation

### `generateListenerKey(options)`

Generate a consistent, unique key for storing and retrieving listeners.

#### Parameters

```typescript
interface KeyOptions {
  vaultAddress: string;          // Vault address
  eventType: string;             // Type of event
  chainId: number;               // Chain ID
  additionalId?: string;         // Optional additional identifier
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.vaultAddress` | `string` | Yes | Vault address (will be lowercased) |
| `options.eventType` | `string` | Yes | Type identifier for the listener |
| `options.chainId` | `number` | Yes | Blockchain chain ID |
| `options.additionalId` | `string` | No | Additional identifier for uniqueness |

#### Returns

- **Type**: `string`
- **Description**: Formatted key string: `{vaultAddress}-{eventType}-{chainId}[-{additionalId}]`

#### Key Format

The key format ensures uniqueness and follows this pattern:
- Base: `{lowercased_vault_address}-{event_type}-{chain_id}`
- With additional ID: `{lowercased_vault_address}-{event_type}-{chain_id}-{additional_id}`

#### Example

```javascript
// Generate a key for a strategy event
const key = eventManager.generateListenerKey({
  vaultAddress: '0xAbC123...',
  eventType: 'strategy',
  chainId: 1,
  additionalId: 'rebalance'
});
// Result: "0xabc123...-strategy-1-rebalance"

// Generate a key without additional ID
const simpleKey = eventManager.generateListenerKey({
  vaultAddress: '0xDeF456...',
  eventType: 'token',
  chainId: 137
});
// Result: "0xdef456...-token-137"
```

## Listener Management Methods

### `removeListener(key)`

Remove a specific listener by its key.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | `string` | Yes | Listener key returned from registration |

#### Returns

- **Type**: `Promise<boolean>`
- **Description**: `true` if removal was successful, `false` if listener not found or already removed

#### Behavior

- Checks if listener exists and hasn't been removed already
- Marks listener as removed to prevent duplicate cleanup
- Handles different listener types appropriately:
  - **Contract**: Calls `contract.off(eventName, handler)`
  - **Filter**: Calls `provider.off(filter, handler)` with small delay
  - **Interval**: Calls `clearInterval(intervalId)`
- Removes listener from storage even if cleanup fails

#### Example

```javascript
// Remove a specific listener
const success = await eventManager.removeListener(listenerKey);
if (success) {
  console.log('Listener removed successfully');
} else {
  console.log('Listener was already removed or not found');
}

// Safe to call multiple times
await eventManager.removeListener(listenerKey); // Returns false
```

### `removeAllVaultListeners(vault)`

Remove all listeners associated with a specific vault.

#### Parameters

```typescript
interface VaultObject {
  address: string;               // Vault address
  chainId?: number;              // Optional chain ID
  // ... other vault properties
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `vault` | `VaultObject` | Yes | Vault object with at least an address property |

#### Returns

- **Type**: `number`
- **Description**: Number of listeners successfully removed

#### Example

```javascript
// Remove all listeners for a vault
const vault = {
  address: '0x123...',
  chainId: 1
};

const removedCount = eventManager.removeAllVaultListeners(vault);
console.log(`Removed ${removedCount} listeners for vault`);
```

### `removeChainListeners(chainId)`

Remove all listeners for a specific blockchain.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chainId` | `number` | Yes | Chain ID to remove listeners for |

#### Returns

- **Type**: `number`
- **Description**: Number of listeners successfully removed

#### Example

```javascript
// Remove all listeners for Polygon
const removedCount = eventManager.removeChainListeners(137);
console.log(`Removed ${removedCount} Polygon listeners`);
```

### `removeAllListeners()`

Remove all registered listeners across all vaults and chains.

#### Returns

- **Type**: `Promise<number>`
- **Description**: Total number of listeners removed

#### Behavior

- Prevents concurrent cleanup with `isCleaningUp` flag
- Waits for each listener removal to complete
- Resets cleanup flag even if errors occur

#### Example

```javascript
// Clean up everything (e.g., on shutdown)
const totalRemoved = await eventManager.removeAllListeners();
console.log(`Cleanup complete: removed ${totalRemoved} listeners`);
```

## Utility Methods

### `getVaultListenerKeys(vaultAddress)`

Get all listener keys associated with a vault address.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `vaultAddress` | `string` | Yes | Vault address to query |

#### Returns

- **Type**: `string[]`
- **Description**: Array of listener keys for the vault

#### Example

```javascript
// Get all listeners for a vault
const keys = eventManager.getVaultListenerKeys('0x123...');
console.log(`Vault has ${keys.length} listeners:`, keys);

// Selectively remove certain listeners
keys.forEach(key => {
  if (key.includes('-price-')) {
    eventManager.removeListener(key);
  }
});
```

### `hasListener(key)`

Check if a listener with the given key exists.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | `string` | Yes | Listener key to check |

#### Returns

- **Type**: `boolean`
- **Description**: `true` if listener exists, `false` otherwise

#### Example

```javascript
// Check before registering to avoid duplicates
const key = eventManager.generateListenerKey({
  vaultAddress: '0x123...',
  eventType: 'strategy',
  chainId: 1
});

if (!eventManager.hasListener(key)) {
  eventManager.registerContractListener({...});
}
```

### `getListenerCount()`

Get the total number of registered listeners.

#### Returns

- **Type**: `number`
- **Description**: Total count of all registered listeners

#### Example

```javascript
// Monitor listener count
console.log('Active listeners:', eventManager.getListenerCount());

// Check for memory leaks
setInterval(() => {
  const count = eventManager.getListenerCount();
  if (count > 1000) {
    console.warn('High listener count:', count);
  }
}, 60000);
```

### `log(message)`

Internal logging method that respects the debug setting.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | `string` | Yes | Message to log |

#### Example

```javascript
// Enable debug mode to see internal logs
eventManager.setDebug(true);

// Now internal operations will be logged
eventManager.registerContractListener({...});
// Output: [EventManager] Registered contract listener: ...
```

## Listener Types

### Contract Listeners

Contract listeners attach to specific smart contract events:

```javascript
const listener = {
  type: 'contract',
  contract: Contract,           // ethers.Contract instance
  eventName: string,            // Event name
  handler: Function,            // Wrapped handler
  originalHandler: Function,    // Original handler
  vaultAddress: string,         // Associated vault
  chainId: number              // Chain ID
};
```

### Filter Listeners

Filter listeners use provider-level event filters for complex queries:

```javascript
const listener = {
  type: 'filter',
  provider: Provider,           // ethers.Provider instance
  filter: EventFilter,          // Event filter object
  handler: Function,            // Wrapped handler
  originalHandler: Function,    // Original handler
  vaultAddress: string,         // Associated vault
  chainId: number              // Chain ID
};
```

### Interval Listeners

Interval listeners execute periodic tasks:

```javascript
const listener = {
  type: 'interval',
  intervalId: number,           // setInterval ID
  vaultAddress: string,         // Associated vault
  chainId: number              // Chain ID
};
```

## Blockchain Event Subscription Methods

These methods set up blockchain event listeners for specific contract events.

### `subscribeToAuthorizationEvents(chainId, automationServiceAddress, provider)`

Subscribe to vault authorization/revocation events for the automation service.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chainId` | `number` | Yes | Chain ID for the network |
| `automationServiceAddress` | `string` | Yes | Executor address to monitor |
| `provider` | `ethers.Provider` | Yes | Ethereum provider |

#### Events Emitted

- `VaultAuthGranted` - When a vault authorizes the automation service
- `VaultAuthRevoked` - When a vault revokes authorization

#### Example

```javascript
eventManager.subscribeToAuthorizationEvents(42161, '0xExecutor...', provider);
// Now listens for ExecutorChanged events and emits VaultAuthGranted/VaultAuthRevoked
```

---

### `subscribeToVaultConfigEvents(vault, provider)`

Subscribe to configuration change events for a specific vault.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `vault` | `Object` | Yes | Vault object with `address` and `chainId` |
| `provider` | `ethers.Provider` | Yes | Ethereum provider |

#### Events Emitted

- `TargetTokensUpdated` - When vault target tokens change
- `TargetPlatformsUpdated` - When vault target platforms change

---

### `subscribeToStrategyParameterEvents(chainId, strategyAddresses, provider)`

Subscribe to strategy parameter update events.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chainId` | `number` | Yes | Chain ID |
| `strategyAddresses` | `string[]` | Yes | Array of strategy contract addresses |
| `provider` | `ethers.Provider` | Yes | Ethereum provider |

#### Events Emitted

- `StrategyParameterUpdated` - When strategy parameters are updated on-chain

---

### `subscribeToSwapEvents(vault, provider)`

Subscribe to swap events for all pools associated with vault positions.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `vault` | `Object` | Yes | Vault object with positions |
| `provider` | `ethers.Provider` | Yes | Ethereum provider |

#### Events Emitted

- `SwapEventDetected` - When a swap occurs in a monitored pool

---

### `refreshSwapListeners(vaultAddress, provider)`

Refresh swap listeners after position changes (e.g., after rebalance).

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `vaultAddress` | `string` | Yes | Vault address |
| `provider` | `ethers.Provider` | Yes | Ethereum provider |

---

## Pool Monitoring Methods

### `getMonitoredPools()`

Get array of all pool addresses currently being monitored for swap events.

**Returns:** `string[]` - Array of pool addresses

### `getVaultsForPool(poolAddress)`

Get array of vault addresses monitoring a specific pool.

**Parameters:**
- `poolAddress` (string) - Pool address to query

**Returns:** `string[]` - Array of vault addresses

### `isPoolMonitored(poolAddress)`

Check if a pool is currently being monitored.

**Parameters:**
- `poolAddress` (string) - Pool address to check

**Returns:** `boolean` - True if pool is monitored

### `getPoolListenerCount()`

Get the count of active pool listeners.

**Returns:** `number` - Number of pool listeners

---

## Failed Removal Tracking

### `getFailedRemovals()`

Get map of listener removals that failed.

**Returns:** `Map` - Failed removal attempts with error details

### `retryFailedRemovals()`

Retry any failed listener removals.

**Returns:** `Promise<Object>` - Results with success/failure counts

---

## Integration Patterns

### With Strategy Classes

Strategies should register their listeners through EventManager:

```javascript
class MyStrategy extends StrategyBase {
  async setupEventListeners() {
    // Register contract event
    this.listenerKeys.push(
      this.eventManager.registerContractListener({
        contract: this.vaultContract,
        eventName: 'Deposit',
        handler: this.handleDeposit.bind(this),
        vaultAddress: this.vault.address,
        eventType: 'strategy',
        chainId: this.vault.chainId
      })
    );

    // Register periodic check
    this.listenerKeys.push(
      this.eventManager.registerInterval({
        callback: this.checkPositions.bind(this),
        intervalMs: 300000, // 5 minutes
        vaultAddress: this.vault.address,
        eventType: 'position-check',
        chainId: this.vault.chainId
      })
    );
  }

  async cleanup() {
    // Remove all strategy listeners
    for (const key of this.listenerKeys) {
      await this.eventManager.removeListener(key);
    }
    this.listenerKeys = [];
  }
}
```

### With AutomationService

The AutomationService uses EventManager for vault lifecycle:

```javascript
class AutomationService {
  async processVault(vault) {
    try {
      // Process vault...
      
      // Emit success event
      this.eventManager.emit('vault:processed', {
        address: vault.address,
        chainId: vault.chainId,
        success: true
      });
    } catch (error) {
      // Clean up vault listeners on error
      this.eventManager.removeAllVaultListeners(vault);
      
      // Emit error event
      this.eventManager.emit('vault:error', {
        address: vault.address,
        error: error.message
      });
    }
  }

  async shutdown() {
    // Clean up all listeners on shutdown
    await this.eventManager.removeAllListeners();
  }
}
```

### Preventing Memory Leaks

Always clean up listeners when they're no longer needed:

```javascript
// Bad: Listener never cleaned up
provider.on(filter, handler);

// Good: Register through EventManager
const key = eventManager.registerFilterListener({
  provider,
  filter,
  handler,
  vaultAddress,
  eventType: 'monitoring',
  chainId
});

// Clean up when done
await eventManager.removeListener(key);
```

## Error Handling

### Registration Errors

```javascript
try {
  const key = eventManager.registerFilterListener({
    provider,
    filter,
    handler,
    vaultAddress: vault.address,
    eventType: 'swap-monitor',
    chainId: vault.chainId
  });
} catch (error) {
  console.error('Failed to register listener:', error);
  // Handle registration failure
}
```

### Cleanup Errors

```javascript
// removeListener handles errors internally
const success = await eventManager.removeListener(key);
if (!success) {
  console.warn('Listener removal failed or already removed');
}

// Safe to proceed - listener is removed from storage
```

### Event Handler Errors

```javascript
// EventManager catches handler errors automatically
eventManager.subscribe('vault:update', (data) => {
  throw new Error('Handler error'); // Won't crash the system
});

eventManager.emit('vault:update', data); // Continues execution
```

## Performance Considerations

### Listener Count Management

Monitor and limit the number of active listeners:

```javascript
class ListenerMonitor {
  constructor(eventManager, maxListeners = 1000) {
    this.eventManager = eventManager;
    this.maxListeners = maxListeners;
  }

  checkListenerCount() {
    const count = this.eventManager.getListenerCount();
    if (count > this.maxListeners) {
      console.error(`Listener leak detected: ${count} listeners`);
      // Take corrective action
    }
    return count;
  }
}
```

### Batch Operations

When removing multiple listeners, use specific methods:

```javascript
// Inefficient: Individual removals
for (const key of keys) {
  await eventManager.removeListener(key);
}

// Efficient: Bulk removal
const removedCount = eventManager.removeAllVaultListeners(vault);
```

### Memory Usage

The EventManager stores minimal data per listener:

```javascript
// Each listener stores only essential data
{
  type: 'contract',        // 8 bytes
  contract: reference,     // 8 bytes (reference)
  eventName: string,       // Variable
  handler: reference,      // 8 bytes (reference)
  originalHandler: ref,    // 8 bytes (reference)
  vaultAddress: string,    // ~42 bytes
  chainId: number,         // 8 bytes
  isRemoved?: boolean      // 1 byte (when set)
}
// Total: ~83 bytes + eventName length per listener
```

## Best Practices

### 1. Always Clean Up

```javascript
class Component {
  constructor(eventManager) {
    this.eventManager = eventManager;
    this.listenerKeys = [];
  }

  async initialize() {
    // Register listeners and track keys
    this.listenerKeys.push(
      this.eventManager.registerContractListener({...})
    );
  }

  async destroy() {
    // Always clean up on destroy
    for (const key of this.listenerKeys) {
      await this.eventManager.removeListener(key);
    }
    this.listenerKeys = [];
  }
}
```

### 2. Use Descriptive Event Types

```javascript
// Bad: Generic event types
eventType: 'event'

// Good: Descriptive event types
eventType: 'uniswap-v3-swap'
eventType: 'aave-position-health'
eventType: 'price-oracle-update'
```

### 3. Handle Disabled State

```javascript
// Check if event processing is enabled
if (eventManager.enabled) {
  // Perform expensive operations
  const data = await fetchComplexData();
  eventManager.emit('data:ready', data);
}
```

### 4. Use Additional IDs for Uniqueness

```javascript
// When multiple listeners of same type exist
eventManager.registerContractListener({
  contract: tokenA,
  eventName: 'Transfer',
  handler: handleTransferA,
  vaultAddress: vault.address,
  eventType: 'token-transfer',
  chainId: 1,
  additionalId: 'token-a' // Distinguish from token-b listener
});
```

### 5. Monitor Listener Health

```javascript
// Periodic health check
setInterval(() => {
  const count = eventManager.getListenerCount();
  const vaultListeners = eventManager.getVaultListenerKeys(vaultAddress);
  
  console.log(`Total listeners: ${count}`);
  console.log(`Vault listeners: ${vaultListeners.length}`);
  
  // Alert if counts are unexpected
  if (vaultListeners.length > 50) {
    console.warn('Excessive listeners for single vault');
  }
}, 300000); // Every 5 minutes
```

## Migration Guide

### From Direct Event Registration

```javascript
// Before: Direct registration
contract.on('Transfer', handleTransfer);
provider.on(filter, handleLogs);
const intervalId = setInterval(checkPrice, 60000);

// After: EventManager registration
const contractKey = eventManager.registerContractListener({
  contract,
  eventName: 'Transfer',
  handler: handleTransfer,
  vaultAddress,
  eventType: 'transfer',
  chainId
});

const filterKey = eventManager.registerFilterListener({
  provider,
  filter,
  handler: handleLogs,
  vaultAddress,
  eventType: 'logs',
  chainId
});

const intervalKey = eventManager.registerInterval({
  callback: checkPrice,
  intervalMs: 60000,
  vaultAddress,
  eventType: 'price-check',
  chainId
});

// Cleanup is now centralized
await eventManager.removeAllVaultListeners(vault);
```

## Troubleshooting

### Common Issues

#### 1. Listeners Not Firing

```javascript
// Check if EventManager is enabled
console.log('EventManager enabled:', eventManager.enabled);

// Enable debug logging
eventManager.setDebug(true);

// Verify listener exists
const exists = eventManager.hasListener(listenerKey);
console.log('Listener registered:', exists);
```

#### 2. Memory Leaks

```javascript
// Monitor listener count over time
const baseline = eventManager.getListenerCount();

// After operations...
const current = eventManager.getListenerCount();
if (current > baseline) {
  console.warn(`Potential leak: ${current - baseline} listeners not cleaned`);
}
```

#### 3. Duplicate Listeners

```javascript
// Generate key first to check existence
const key = eventManager.generateListenerKey({
  vaultAddress,
  eventType: 'my-event',
  chainId
});

if (!eventManager.hasListener(key)) {
  // Safe to register
  eventManager.registerContractListener({...});
}
```

#### 4. Cleanup Failures

```javascript
// Force cleanup with error handling
try {
  await eventManager.removeAllListeners();
} catch (error) {
  console.error('Cleanup failed:', error);
  // Listeners are still removed from storage
}
```

## Summary

The EventManager provides a robust, centralized solution for managing event listeners in the FUM Automation framework. By tracking all listeners in one place and providing comprehensive cleanup methods, it prevents memory leaks and simplifies resource management in long-running automation processes. Its support for multiple listener types, debug capabilities, and flexible key generation makes it suitable for complex multi-chain, multi-vault scenarios while maintaining clean separation of concerns.