# AutomationService API

The AutomationService is the core orchestrator of the FUM Automation system, providing event-driven monitoring and automation for DeFi vaults across multiple blockchain networks.

## Overview

The AutomationService implements an **event-driven monitoring architecture** that:
- **Real-time Monitoring**: Listens to blockchain events for position and fee changes
- **Strategy Execution**: Delegates vault-specific logic to pluggable strategy implementations
- **Vault Management**: Handles vault authorization, position tracking, and data synchronization
- **Risk Management**: Implements vault locking to prevent concurrent transaction conflicts

## Class Definition

```javascript
class AutomationService {
  constructor(config: AutomationConfig)
  
  // Core lifecycle methods
  async initialize(): Promise<boolean>
  async start(): Promise<boolean>
  async stop(): Promise<boolean>
  
  // Event handling
  async handlePriceEvent(vault, position, currentTick, sqrtPriceX96, strategyType, params): Promise<Object>
  async handleFeeEvent(vault, pool, amount0, amount1, strategyType, params): Promise<Object>
  async handleStrategyChange(vault, strategyAddress): Promise<void>
  
  // Vault monitoring
  async startMonitoringVault(vault): Promise<void>
  async setupStrategyMonitoring(vault, strategyType): Promise<void>
  stopMonitoringVault(vault): void
  
  // Vault management
  async addNewPosition(vault, tokenId, positionManager): Promise<void>
  async removePosition(vault, positionId): Promise<boolean>
  async refreshPositionData(vault, positionId, positionManager): Promise<void>
  
  // Strategy management
  identifyVaultStrategy(vault): string|null
  async loadStrategyParameters(vault): Promise<Object>
  
  // Authorization handling
  handleNewVaultAuthorization(vault): void
  handleVaultRevocation(vaultInfo): void
  async initializeVaultForStrategy(vault): Promise<boolean>
  
  // Configuration updates
  async handleTargetTokensUpdate(vault, newTokens): Promise<void>
  async handleTargetPlatformsUpdate(vault, newPlatforms): Promise<void>
  
  // Utilities
  lockVault(vaultAddress): boolean
  unlockVault(vaultAddress, positionId): void
  async sendTelegramMessage(message): Promise<boolean>
  log(message, data, actionType, actionResult): void
}
```

## Constructor

### AutomationService(config)

Creates a new AutomationService instance with the specified configuration.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| config | `AutomationConfig` | Yes | Service configuration object |

**Configuration Object:**

```typescript
interface AutomationConfig {
  // Required core configuration
  automationServiceAddress: string    // Executor contract address (0x-prefixed)
  chainId: number                     // Blockchain chain ID
  wsUrl: string                       // WebSocket RPC URL for event streaming
  debug: boolean                      // Debug logging flag
  envPath: string                     // Path to .env file to load

  // Required operational configuration
  blacklistFilePath: string           // Path to blacklist JSON file
  retryIntervalMs: number             // Interval between retry cycles (milliseconds)
  maxFailureDurationMs: number        // Max time before vault is blacklisted (milliseconds)
  ssePort: number                     // Port for SSE event streaming server

  // Optional configuration
  trackingDataDir?: string            // Directory for vault tracking data (default: './data/vaults')
}
```

**Example:**

```javascript
const automationService = new AutomationService({
  // Required
  automationServiceAddress: '0x1234567890123456789012345678901234567890',
  chainId: 42161,                     // Arbitrum
  wsUrl: 'wss://arb-mainnet.g.alchemy.com/v2/your-key',
  debug: true,
  envPath: './.env',

  // Operational
  blacklistFilePath: './data/.vault-blacklist.json',
  retryIntervalMs: 60000,             // Retry failed vaults every 1 minute
  maxFailureDurationMs: 3600000,      // Blacklist after 1 hour of failures
  ssePort: 3001,                      // SSE server on port 3001

  // Optional
  trackingDataDir: './data/vaults'    // Where to store vault tracking data
});
```

**Validation:**
- Throws `Error` if required configuration is missing
- Validates `automationServiceAddress` is a valid Ethereum address
- Validates `chainId` is a positive integer
- Validates `wsUrl` starts with `ws://` or `wss://`
- Validates `debug` is explicitly set to a boolean
- Validates `retryIntervalMs` and `maxFailureDurationMs` are positive integers
- Validates `ssePort` is a number

**Initialized Components:**
- `EventManager` - Centralized event handling
- `VaultDataService` - Vault data management
- `Tracker` - Performance monitoring and transaction logging
- `SSEBroadcaster` - Real-time event streaming to frontend
- `BabyStepsStrategy` - Strategy implementation

---

## Core Lifecycle Methods

### initialize()

Initializes the automation service and its dependencies.

**Signature:**
```javascript
async initialize(): Promise<boolean>
```

**Process Flow:**
1. Validates required configuration parameters
2. Sets up blockchain provider (WebSocket preferred, HTTP fallback)
3. Initializes VaultDataService with provider and chain configuration
4. Sets up factory contract instance
5. Validates strategy contract addresses
6. Configures event subscriptions for vault data updates

**Returns:**
`true` if initialization successful

**Example:**

```javascript
try {
  const success = await automationService.initialize();
  if (success) {
    console.log('AutomationService initialized successfully');
  }
} catch (error) {
  console.error('Initialization failed:', error.message);
}
```

**Throws:**
- `Error` - Missing required configuration
- `Error` - Provider connection failures
- `Error` - Contract initialization errors

---

### start()

Starts the automation service and begins monitoring authorized vaults.

**Signature:**
```javascript
async start(): Promise<boolean>
```

**Process Flow:**
1. Calls `initialize()` if not already initialized
2. Loads all currently authorized vaults from registry
3. Subscribes to vault authorization change events
4. Starts monitoring each authorized vault
5. Sets up strategy-specific monitoring for each vault

**Returns:**
`true` if service started successfully

**Example:**

```javascript
try {
  await automationService.start();
  console.log('Automation service is now running');
} catch (error) {
  console.error('Failed to start service:', error.message);
}
```

**Throws:**
- `Error` - Service initialization failures
- `Error` - Vault monitoring setup failures

---

### stop()

Gracefully shuts down the automation service.

**Signature:**
```javascript
async stop(): Promise<boolean>
```

**Process Flow:**
1. Sets shutdown flag to prevent new event processing
2. Waits for pending vault operations to complete (max 5 seconds)
3. Force-unlocks any remaining vault locks
4. Stops monitoring all vaults
5. Cleans up registry listeners
6. Removes all event listeners via EventManager
7. Clears VaultDataService cache
8. Properly closes WebSocket connections

**Returns:**
`true` if service stopped successfully

**Example:**

```javascript
// Graceful shutdown on SIGINT
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await automationService.stop();
  process.exit(0);
});
```

---

## Event Handling Methods

### handlePriceEvent(vault, position, currentTick, sqrtPriceX96, strategyType, params)

Processes price change events for vault positions.

**Signature:**
```javascript
async handlePriceEvent(vault, position, currentTick, sqrtPriceX96, strategyType, params): Promise<Object>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault containing the position |
| position | `Object` | Yes | Position affected by price change |
| currentTick | `number` | Yes | Current price tick |
| sqrtPriceX96 | `BigInt` | Yes | Square root price in Q96 format |
| strategyType | `string` | Yes | Strategy type identifier ('bob', 'parris') |
| params | `Object` | Yes | Strategy parameters |

**Process Flow:**
1. Attempts to acquire vault lock (returns early if already locked)
2. Gets fresh vault data from VaultDataService
3. Calculates dynamic state for current position
4. Delegates to strategy-specific evaluation
5. Releases vault lock in finally block

**Returns:**
```typescript
{
  success: boolean,
  position: string  // Position ID
}
```

**Example:**

```javascript
// Called automatically by strategy monitoring
await automationService.handlePriceEvent(
  vault,
  position, 
  123456,
  BigInt('1234567890123456789'),
  'bob',
  strategyParams
);
```

**Throws:**
- `Error` - Missing required parameters
- `Error` - Vault data loading failures
- `Error` - Strategy evaluation errors

---

### handleFeeEvent(vault, pool, amount0, amount1, strategyType, params)

Processes fee collection events for vault positions.

**Signature:**
```javascript
async handleFeeEvent(vault, pool, amount0, amount1, strategyType, params): Promise<Object>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault receiving fees |
| pool | `Object` | Yes | Pool contract where fees were collected |
| amount0 | `BigInt` | Yes | Amount of token0 collected |
| amount1 | `BigInt` | Yes | Amount of token1 collected |
| strategyType | `string` | Yes | Strategy type identifier |
| params | `Object` | Yes | Strategy parameters |

**Process Flow:**
1. Attempts to acquire vault lock
2. Gets fresh vault data
3. Delegates to strategy-specific fee handling
4. Releases vault lock

**Returns:**
```typescript
{
  success: boolean
}
```

---

### handleStrategyChange(vault, strategyAddress)

Handles vault strategy change events.

**Signature:**
```javascript
async handleStrategyChange(vault, strategyAddress): Promise<void>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault with updated strategy |
| strategyAddress | `string` | Yes | New strategy contract address |

**Process Flow:**
1. Updates vault's strategy address in authorized vaults list
2. Restarts monitoring with the new strategy

---

## Vault Monitoring Methods

### startMonitoringVault(vault)

Sets up monitoring for a specific vault.

**Signature:**
```javascript
async startMonitoringVault(vault): Promise<void>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault object to monitor |

**Vault Object:**
```typescript
interface Vault {
  address: string          // Vault contract address
  strategyAddress?: string // Strategy contract address
  name?: string           // Vault name
  chainId: number         // Chain ID
}
```

**Process Flow:**
1. Identifies strategy type for the vault
2. Sets up strategy-specific monitoring if strategy found
3. Sets up monitoring for strategy changes if no strategy
4. Subscribes to vault configuration events

**Example:**

```javascript
const vault = {
  address: '0xVaultAddress',
  strategyAddress: '0xStrategyAddress',
  name: 'My Vault',
  chainId: 42161
};

await automationService.startMonitoringVault(vault);
```

---

### setupStrategyMonitoring(vault, strategyType)

Sets up strategy-specific monitoring for a vault.

**Signature:**
```javascript
async setupStrategyMonitoring(vault, strategyType = null): Promise<void>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault to monitor |
| strategyType | `string` | No | Strategy type (auto-detected if not provided) |

**Process Flow:**
1. Auto-detects strategy type if not provided
2. Loads strategy parameters if not cached
3. Delegates to strategy-specific monitoring setup

---

### stopMonitoringVault(vault)

Stops monitoring a specific vault and cleans up resources.

**Signature:**
```javascript
stopMonitoringVault(vault): void
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault to stop monitoring |

**Process Flow:**
1. Calls cleanup on all strategy instances
2. Removes vault-specific event listeners
3. Logs cleanup results

---

## Vault Management Methods

### addNewPosition(vault, tokenId, positionManager)

Adds a new position to a vault and sets up monitoring.

**Signature:**
```javascript
async addNewPosition(vault, tokenId, positionManager?): Promise<void>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault to add position to |
| tokenId | `string` | Yes | NFT token ID of the position |
| positionManager | `Object` | No | Position manager contract instance |

**Process Flow:**
1. Validates vault has target platforms configured
2. Creates/gets position manager contract
3. Fetches position details from blockchain
4. Calculates pool address using platform adapter
5. Fetches and caches pool data
6. Creates position object and adds to VaultDataService

---

### removePosition(vault, positionId)

Removes a position and cleans up associated listeners.

**Signature:**
```javascript
async removePosition(vault, positionId): Promise<boolean>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault containing the position |
| positionId | `string` | Yes | ID of position to remove |

**Returns:**
`true` if position was successfully removed

**Process Flow:**
1. Gets fresh vault data
2. Finds position in VaultDataService
3. Removes pool-specific event listeners
4. Removes position from data storage

---

### refreshPositionData(vault, positionId, positionManager)

Refreshes position data from the blockchain.

**Signature:**
```javascript
async refreshPositionData(vault, positionId, positionManager?): Promise<void>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault containing the position |
| positionId | `string` | Yes | Position ID to refresh |
| positionManager | `Object` | No | Position manager contract instance |

**Process Flow:**
1. Finds position in VaultDataService
2. Gets updated position data from position manager
3. Updates position with new data
4. Refreshes pool data if available

---

## Strategy Management Methods

### identifyVaultStrategy(vault)

Identifies the strategy type for a given vault.

**Signature:**
```javascript
identifyVaultStrategy(vault): string|null
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault object |

**Returns:**
Strategy type identifier ('bob', 'parris') or `null` if unknown

**Strategy Detection Logic:**
1. Checks if vault has a strategy address
2. Compares with configured strategy addresses
3. Returns corresponding strategy type or null

**Example:**

```javascript
const strategyType = automationService.identifyVaultStrategy(vault);
if (strategyType) {
  console.log(`Vault uses ${strategyType} strategy`);
} else {
  console.log('Unknown or no strategy configured');
}
```

---

### loadStrategyParameters(vault)

Loads and caches strategy parameters for a vault.

**Signature:**
```javascript
async loadStrategyParameters(vault): Promise<Object>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault object with strategy address |

**Returns:**
Parsed strategy parameters object

**Process Flow:**
1. Identifies strategy type
2. Uses VaultDataService to get vault data with strategy parameters
3. Caches parameters for future use
4. Returns parsed parameters

**Example:**

```javascript
try {
  const params = await automationService.loadStrategyParameters(vault);
  console.log('Strategy parameters:', params);
} catch (error) {
  console.error('Failed to load parameters:', error.message);
}
```

---

## Authorization Handling Methods

### handleNewVaultAuthorization(vault)

Handles new vault authorization events.

**Signature:**
```javascript
handleNewVaultAuthorization(vault): void
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Newly authorized vault |

**Process Flow:**
1. Adds vault to authorized vaults list
2. Initializes vault for its strategy
3. Starts monitoring the vault
4. Sends notification if configured

---

### handleVaultRevocation(vaultInfo)

Handles vault authorization revocation events.

**Signature:**
```javascript
handleVaultRevocation(vaultInfo): void
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vaultInfo | `Object` | Yes | Basic info about revoked vault |

**VaultInfo Object:**
```typescript
interface VaultInfo {
  address: string   // Vault contract address
  chainId: number   // Chain ID
}
```

**Process Flow:**
1. Finds vault in authorized list
2. Stops monitoring the vault
3. Clears strategy cache and vault locks
4. Removes from authorized vaults list
5. Sends notification if configured

---

### initializeVaultForStrategy(vault)

Initializes a vault's assets according to its strategy.

**Signature:**
```javascript
async initializeVaultForStrategy(vault): Promise<boolean>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault to initialize |

**Returns:**
`true` if initialization successful

**Process Flow:**
1. Identifies strategy type
2. Loads strategy parameters
3. Gets fresh vault data
4. Calls strategy-specific initialization
5. Updates strategy cache timestamp
6. Sends notification

---

## Configuration Update Methods

### handleTargetTokensUpdate(vault, newTokens)

Handles target tokens update events.

**Signature:**
```javascript
async handleTargetTokensUpdate(vault, newTokens): Promise<void>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault with updated tokens |
| newTokens | `string[]` | Yes | New target token symbols |

**Process Flow:**
1. Gets fresh vault data
2. Cleans up existing monitoring
3. Updates target tokens in VaultDataService
4. Restarts monitoring with new configuration
5. Sends notification

---

### handleTargetPlatformsUpdate(vault, newPlatforms)

Handles target platforms update events.

**Signature:**
```javascript
async handleTargetPlatformsUpdate(vault, newPlatforms): Promise<void>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vault | `Object` | Yes | Vault with updated platforms |
| newPlatforms | `string[]` | Yes | New target platform IDs |

**Process Flow:**
1. Gets fresh vault data
2. Cleans up existing monitoring
3. Updates target platforms in VaultDataService
4. Restarts monitoring with new configuration
5. Sends notification

---

## Utility Methods

### lockVault(vaultAddress)

Attempts to lock a vault for exclusive processing.

**Signature:**
```javascript
lockVault(vaultAddress): boolean
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vaultAddress | `string` | Yes | Address of vault to lock |

**Returns:**
`true` if vault was successfully locked, `false` if already locked

**Example:**

```javascript
if (automationService.lockVault(vault.address)) {
  try {
    // Perform exclusive operations
    await performVaultOperation(vault);
  } finally {
    automationService.unlockVault(vault.address);
  }
} else {
  console.log('Vault is busy, skipping operation');
}
```

---

### unlockVault(vaultAddress, positionId)

Releases the lock on a vault.

**Signature:**
```javascript
unlockVault(vaultAddress, positionId?): void
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vaultAddress | `string` | Yes | Address of vault to unlock |
| positionId | `string` | No | Position ID for better logging |

---

### sendTelegramMessage(message)

Sends a message to the configured Telegram chat.

**Signature:**
```javascript
async sendTelegramMessage(message): Promise<boolean>
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| message | `string` | Yes | Message to send |

**Returns:**
`true` if message sent successfully

**Configuration:**
Requires environment variables:
- `TELEGRAM_BOT_API_KEY` - Telegram bot API key
- `TELEGRAM_CHAT_ID` - Target chat ID

**Example:**

```javascript
await automationService.sendTelegramMessage(
  '🔄 Vault rebalanced successfully'
);
```

---

### log(message, data, actionType, actionResult)

Logs a message with optional structured data.

**Signature:**
```javascript
log(message, data?, actionType?, actionResult?): void
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| message | `string` | Yes | Log message |
| data | `Object` | No | Additional data to log |
| actionType | `string` | No | Type of action being logged |
| actionResult | `string` | No | Result of the action |

**Behavior:**
- Only logs when `debug` flag is enabled
- Uses dynamic import of Logger for enhanced logging
- Falls back to console.log if Logger unavailable

---

## Architecture Patterns

### Event-Driven Design

The AutomationService follows an event-driven architecture:

```javascript
// Service listens to blockchain events
eventManager.subscribe('price_change', handlePriceEvent);
eventManager.subscribe('fee_collected', handleFeeEvent);

// Strategy changes trigger monitoring updates
eventManager.subscribe('strategy_changed', handleStrategyChange);

// Vault authorization changes
eventManager.subscribe('vault_authorized', handleNewVaultAuthorization);
eventManager.subscribe('vault_revoked', handleVaultRevocation);
```

### Vault Locking System

Prevents race conditions during concurrent operations:

```javascript
// Automatic locking in event handlers
async handlePriceEvent(vault, position, ...) {
  if (!this.lockVault(vault.address)) {
    return; // Skip if already processing
  }
  
  try {
    // Process event safely
  } finally {
    this.unlockVault(vault.address, position.id);
  }
}
```

### Strategy Delegation

Delegates vault-specific logic to strategy implementations:

```javascript
// Identify strategy for vault
const strategyType = this.identifyVaultStrategy(vault);
const strategy = this.strategies[strategyType];

// Delegate to strategy-specific implementation
await strategy.setupMonitoring(vault, params);
await strategy.evaluateState(vaultData, dynamicState, ...);
```

---

## Error Handling

### Common Error Scenarios

```javascript
// Configuration validation
if (!config.automationServiceAddress) {
  throw new Error("Automation service address is required");
}

// Provider connection failures
try {
  this.provider = new ethers.providers.WebSocketProvider(config.wsUrl);
} catch (error) {
  console.error('Provider connection failed:', error);
  throw error;
}

// Strategy evaluation errors
try {
  await strategy.evaluateState(...);
} catch (error) {
  console.error(`Strategy evaluation failed: ${error.message}`);
  throw error;
}
```

### Graceful Degradation

```javascript
// Skip processing if vault is locked
if (!this.lockVault(vault.address)) {
  return; // Silently skip to prevent blocking
}

// Continue shutdown despite cleanup errors
try {
  await this.stopMonitoringVault(vault);
} catch (error) {
  this.log(`Error stopping vault monitoring: ${error.message}`);
  // Continue with shutdown
}
```

---

## Integration Examples

### Basic Setup

```javascript
import AutomationService from './src/AutomationService.js';

const config = {
  // Required
  automationServiceAddress: '0x...',
  chainId: 42161,
  wsUrl: 'wss://arb-mainnet.g.alchemy.com/v2/your-key',
  debug: true,
  envPath: './.env',

  // Operational
  blacklistFilePath: './data/.vault-blacklist.json',
  retryIntervalMs: 60000,
  maxFailureDurationMs: 3600000,
  ssePort: 3001
};

const service = new AutomationService(config);

// Start the service
await service.start();
console.log('Automation service is running');
```

### Event Monitoring

```javascript
// Monitor service events
const eventManager = service.eventManager;

eventManager.subscribe('vaultLoaded', (vaultAddress, vaultData) => {
  console.log(`Vault loaded: ${vaultAddress}`);
});

eventManager.subscribe('vaultLoadError', (vaultAddress, error) => {
  console.error(`Vault load failed: ${vaultAddress} - ${error}`);
});

eventManager.subscribe('positionsRefreshed', (vaultAddress, positions) => {
  console.log(`Refreshed ${positions.length} positions for ${vaultAddress}`);
});
```

### Manual Vault Operations

```javascript
// Add a vault manually (usually done via authorization events)
const vault = {
  address: '0xVaultAddress',
  strategyAddress: '0xStrategyAddress',
  chainId: 42161
};

await service.startMonitoringVault(vault);

// Stop monitoring when done
service.stopMonitoringVault(vault);
```

---

For related documentation:
- [VaultRegistry API](../vault-management/vault-registry.md)
- [VaultDataService API](../vault-management/vault-data-service.md)
- [Strategy System](../strategies/strategy-base.md)
- [EventManager API](../utilities/event-manager.md)