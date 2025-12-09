# VaultDataService API Reference

## Overview

The `VaultDataService` class is a centralized service for loading, managing, and caching vault data in the FUM automation system. It provides enhanced position data with token metadata, intelligent caching, and real-time updates for automation workflows.

### Key Features

- **Centralized Data Management**: Single source of truth for all vault data
- **Enhanced Position Data**: Automatically enriches positions with complete token metadata
- **Intelligent Caching**: In-memory cache for fast vault data access
- **Real-time Updates**: Event-driven architecture for data changes
- **Automation Integration**: Seamlessly integrates with strategies and automation workflows
- **Platform Adapters**: Works with platform adapters for position discovery

## Class Definition

```javascript
class VaultDataService {
  constructor(eventManager)

  // Initialization
  initialize(provider, chainId): void
  setTokens(tokens): void
  setAdapters(adapters): void
  setPoolData(poolData): void

  // Data loading methods
  async getVault(vaultAddress, forceRefresh): Promise<Object>
  async loadVaultData(vaultAddress): Promise<Object>

  // Refresh methods
  async refreshPositionsAndTokens(vaultAddress): Promise<boolean>
  async fetchAssetValues(vault, cacheDuration): Promise<Object>

  // Vault updates
  async removePosition(vaultAddress, positionId): Promise<boolean>
  async updateTargetTokens(vaultAddress, newTokens): Promise<boolean>
  async updateTargetPlatforms(vaultAddress, newPlatforms): Promise<boolean>
  async updateVaultStrategy(vaultAddress, newStrategyAddress): Promise<boolean>

  // Data access methods
  getAllVaults(): Array
  getVaultPositions(vaultAddress): Array
  getPosition(positionId): Object|null
  getVaultStrategyId(vaultAddress): string|null
  getVaultsByFilter(filterFn): Array
  getVaultsByStrategy(strategyId): Array
  hasActiveStrategy(vaultAddress): boolean
  hasVault(vaultAddress): boolean

  // Cache management
  removeVault(vaultAddress): boolean
  clearCache(): void

  // Events and utilities
  getAvailableEvents(): Array<string>
  subscribe(eventType, handler): Function
  async computePoolAddress(token0, token1, fee, platform, chainId, adapter): Promise<string>
  async getDynamicVaultState(vaultAddress, position, currentTick, sqrtPriceX96, adapter): Promise<Object>
}
```

## Constructor

### VaultDataService(eventManager)

Creates a new VaultDataService instance.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| eventManager | `EventManager` | Yes | Event manager instance for emitting events |

**Properties Initialized:**
- `vaults` - Map of vault address to vault data
- `eventManager` - Reference to EventManager
- `provider` - Ethereum provider (set during initialization)
- `chainId` - Chain ID (set during initialization)
- `adapters` - Platform adapters (set by AutomationService)
- `poolData` - Pool data cache (set by AutomationService)
- `tokens` - Token configurations (set by AutomationService)

**Example:**

```javascript
import EventManager from './EventManager.js';
import VaultDataService from './VaultDataService.js';

const eventManager = new EventManager();
const vaultDataService = new VaultDataService(eventManager);
```

---

## Initialization

### initialize(provider, chainId)

Initialize the data service with provider and chain configuration.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| provider | `ethers.Provider` | Yes | Ethers provider instance |
| chainId | `number` | Yes | Chain ID for the network |

**Example:**

```javascript
import { ethers } from 'ethers';

const provider = new ethers.providers.WebSocketProvider('wss://arb-mainnet.g.alchemy.com/v2/YOUR_KEY');
const chainId = 42161; // Arbitrum

vaultDataService.initialize(provider, chainId);
```

**Events Emitted:**
- `initialized` - `{ chainId }`

---

### setTokens(tokens)

Set the tokens configuration reference from AutomationService.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| tokens | `Object` | Yes | Token configurations keyed by symbol |

---

### setAdapters(adapters)

Set the adapter cache reference from AutomationService.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| adapters | `Map` | Yes | Map of platform adapters from AutomationService |

---

### setPoolData(poolData)

Set the pool data cache reference from AutomationService.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| poolData | `Object` | Yes | Pool data object from AutomationService |

---

## Data Loading Methods

### getVault(vaultAddress, forceRefresh = false)

Get vault data with automatic loading if not cached.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| vaultAddress | `string` | Yes | - | Vault address to get |
| forceRefresh | `boolean` | No | `false` | Force refresh even if cached |

**Returns:**
`Promise<Object>` - The vault data object

**Behavior:**
- Returns cached data if available and `forceRefresh` is false
- Automatically calls `loadVaultData()` if data not cached
- Normalizes vault address using `ethers.utils.getAddress()`

**Example:**

```javascript
// Get vault data (uses cache if available)
const vault = await vaultDataService.getVault('0x123...abc');

// Force fresh data from blockchain
const freshVault = await vaultDataService.getVault('0x123...abc', true);
```

---

### loadVaultData(vaultAddress)

Load comprehensive data for a specific vault from blockchain with retry logic.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| vaultAddress | `string` | Yes | Vault address to load |

**Returns:**
`Promise<Object>` - The vault data object

**Vault Data Structure:**
```javascript
{
  address: '0x...',                    // Normalized vault address
  owner: '0x...',                      // Vault owner address
  chainId: 42161,                      // Chain ID
  strategyAddress: '0x...',            // Strategy contract address
  strategy: {
    strategyId: 'bob',                 // Strategy identifier
    strategyAddress: '0x...',          // Strategy contract address
    parameters: {                      // Mapped strategy parameters
      tickSpread: 100,
      feeThreshold: 50,
      // ... other strategy-specific params
    }
  },
  tokens: {                            // Token balances keyed by symbol
    'USDC': '1000000000',              // Balance in wei
    'WETH': '500000000000000000',
    'ARB': '0'
  },
  positions: {                         // Positions keyed by position ID
    '12345': {
      id: '12345',
      pool: '0xPoolAddress',
      tickLower: -887220,
      tickUpper: 887220,
      liquidity: '1000000000',
      // ... other position data
    }
  },
  targetTokens: ['USDC', 'WETH'],      // Configured target tokens
  targetPlatforms: ['uniswapv3'],      // Configured target platforms
  lastUpdated: 1700000000000           // Timestamp
}
```

**Events Emitted:**
- `vaultLoading` - `vaultAddress`
- `vaultLoadRetrying` - `{ vaultAddress, attempt, error }` (on retry)
- `vaultLoaded` - `{ vaultAddress, positionCount, positionIds, tokenCount, strategyId, targetTokens, targetPlatforms, owner }`
- `vaultLoadError` - `vaultAddress, errorMessage`
- `TokenBalancesFetched` - `{ vaultAddress, balances, tokenCount, timestamp }`
- `PoolDataFetched` - `{ poolData, source, vaultAddress }`

**Throws:**
- `Error` - If service not initialized
- `Error` - If vault has no strategy configured
- `Error` - If vault loading fails after retries

**Example:**

```javascript
try {
  const vaultData = await vaultDataService.loadVaultData('0x123...abc');
  console.log(`Loaded ${Object.keys(vaultData.positions).length} positions`);
} catch (error) {
  console.error('Failed to load vault:', error.message);
}
```

---

## Refresh Methods

### refreshPositionsAndTokens(vaultAddress)

Refresh both positions and token balances for a vault.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| vaultAddress | `string` | Yes | Vault address to refresh |

**Returns:**
`Promise<boolean>` - True if refresh successful

**Events Emitted:**
- `positionsRefreshing` - `vaultAddress`
- `positionsRefreshed` - `vaultAddress, positions`
- `positionsRefreshError` - `vaultAddress, errorMessage`

**Example:**

```javascript
const success = await vaultDataService.refreshPositionsAndTokens('0x123...abc');
if (success) {
  console.log('Vault data refreshed');
}
```

---

### fetchAssetValues(vault, cacheDuration)

Fetch USD values for all vault assets (positions + token balances).

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| vault | `Object` | Yes | - | Vault object with positions and tokens |
| cacheDuration | `number` | No | 5000ms | Cache duration for price fetching |

**Returns:**
`Promise<Object>` - Asset values with tokens and positions data

**Return Structure:**
```javascript
{
  tokens: {
    'USDC': { price: 1.0, usdValue: 1000.00 },
    'WETH': { price: 2000.00, usdValue: 5000.00 }
  },
  positions: {
    '12345': {
      token0Amount: '1000000',
      token1Amount: '500000000000000000',
      token0UsdValue: 1000.00,
      token1UsdValue: 1000.00,
      token0Price: 1.0,
      token1Price: 2000.00
    }
  },
  poolData: {
    '0xPoolAddress': { /* fresh pool data */ }
  },
  totalTokenValue: 6000.00,
  totalPositionValue: 2000.00,
  totalVaultValue: 8000.00
}
```

**Events Emitted:**
- `AssetValuesFetched` - `{ vaultAddress, tokenCount, positionCount, totalTokenValue, totalPositionValue, totalVaultValue, assetData, timestamp }`

**Example:**

```javascript
const vault = await vaultDataService.getVault('0x123...abc');
const assetValues = await vaultDataService.fetchAssetValues(vault);
console.log(`Total vault value: $${assetValues.totalVaultValue.toFixed(2)}`);
```

---

## Vault Update Methods

### removePosition(vaultAddress, positionId)

Remove a position from vault data and clean up associated caches.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| vaultAddress | `string` | Yes | Vault address containing the position |
| positionId | `string` | Yes | Position ID to remove |

**Returns:**
`Promise<boolean>` - Whether position was successfully removed

**Events Emitted:**
- `positionRemoved` - `vaultAddress, positionId`
- `positionRemoveError` - `vaultAddress, positionId, errorMessage`

---

### updateTargetTokens(vaultAddress, newTokens)

Update the target tokens for a vault in cache.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| vaultAddress | `string` | Yes | Vault address to update |
| newTokens | `string[]` | Yes | New target token symbols |

**Returns:**
`Promise<boolean>` - Success status

**Events Emitted:**
- `targetTokensUpdated` - `vaultAddress, newTokens`
- `targetTokensUpdateError` - `vaultAddress, errorMessage`

---

### updateTargetPlatforms(vaultAddress, newPlatforms)

Update the target platforms for a vault in cache.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| vaultAddress | `string` | Yes | Vault address to update |
| newPlatforms | `string[]` | Yes | New target platform IDs |

**Returns:**
`Promise<boolean>` - Success status

**Events Emitted:**
- `targetPlatformsUpdated` - `vaultAddress, newPlatforms`
- `targetPlatformsUpdateError` - `vaultAddress, errorMessage`

---

### updateVaultStrategy(vaultAddress, newStrategyAddress)

Update the strategy address for a vault in cache.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| vaultAddress | `string` | Yes | Vault address to update |
| newStrategyAddress | `string` | Yes | New strategy contract address |

**Returns:**
`Promise<boolean>` - Success status

**Events Emitted:**
- `strategyChanged` - `vaultAddress, newStrategyAddress`
- `strategyChangeError` - `vaultAddress, errorMessage`

---

## Data Access Methods

### getAllVaults()

Get all cached vault data.

**Returns:**
`Array` - Array of all vault objects

---

### getVaultPositions(vaultAddress)

Get positions for a specific vault as an array.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| vaultAddress | `string` | Yes | Vault address |

**Returns:**
`Array` - Array of position objects (empty array if vault not found)

---

### getPosition(positionId)

Get a specific position by ID by searching all cached vaults.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| positionId | `string` | Yes | Position ID |

**Returns:**
`Object|null` - Position object or null if not found

---

### getVaultStrategyId(vaultAddress)

Get the strategy ID for a vault from cache.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| vaultAddress | `string` | Yes | Vault address |

**Returns:**
`string|null` - Strategy ID or null if vault not found

---

### getVaultsByFilter(filterFn)

Get vaults matching a filter function.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| filterFn | `Function` | Yes | Filter function that takes a vault and returns boolean |

**Returns:**
`Array` - Array of filtered vault objects

**Example:**

```javascript
// Get vaults with active strategies
const activeVaults = vaultDataService.getVaultsByFilter(
  vault => !!vault.strategy
);

// Get vaults with positions
const vaultsWithPositions = vaultDataService.getVaultsByFilter(
  vault => Object.keys(vault.positions).length > 0
);
```

---

### getVaultsByStrategy(strategyId)

Get vaults using a specific strategy.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| strategyId | `string` | Yes | Strategy identifier (case-insensitive) |

**Returns:**
`Array` - Array of vault objects using the strategy

---

### hasActiveStrategy(vaultAddress)

Check if a vault has an active strategy.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| vaultAddress | `string` | Yes | Vault address to check |

**Returns:**
`boolean` - True if vault has active strategy

---

### hasVault(vaultAddress)

Check if a vault exists in the cache.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| vaultAddress | `string` | Yes | Address of the vault to check |

**Returns:**
`boolean` - True if vault exists in cache

---

## Cache Management

### removeVault(vaultAddress)

Remove a specific vault from the cache.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| vaultAddress | `string` | Yes | Address of the vault to remove |

**Returns:**
`boolean` - True if vault was removed, false if it didn't exist

**Events Emitted:**
- `vaultRemoved` - `vaultAddress`

---

### clearCache()

Clear all cached data.

**Events Emitted:**
- `cacheCleared`

---

## Events and Utilities

### getAvailableEvents()

Get list of all events that can be emitted by this service.

**Returns:**
`Array<string>` - Array of event names

**Available Events:**
- `initialized` - Service initialized
- `vaultLoading` - Vault loading started
- `vaultLoaded` - Vault loading completed
- `vaultLoadError` - Vault loading failed
- `userVaultsLoading` - User vaults loading started
- `userVaultsLoaded` - User vaults loading completed
- `userVaultsLoadError` - User vaults loading failed
- `positionsRefreshing` - Position refresh started
- `positionsRefreshed` - Position refresh completed
- `positionsRefreshError` - Position refresh failed
- `refreshIntervalChanged` - Refresh interval changed
- `cacheCleared` - Cache cleared
- `dynamicDataFetched` - Dynamic vault state fetched
- `dynamicDataError` - Dynamic data fetch failed
- `vaultRebalanceUpdating` - Vault rebalance update started
- `vaultRebalanceUpdated` - Vault rebalance update completed
- `vaultRebalanceError` - Vault rebalance update failed
- `targetTokensUpdated` - Target tokens updated
- `targetTokensUpdateError` - Target tokens update failed
- `targetPlatformsUpdated` - Target platforms updated
- `targetPlatformsUpdateError` - Target platforms update failed
- `positionRemoved` - Position removed from cache
- `positionRemoveError` - Position removal failed
- `adaptersCreated` - Adapters created
- `adaptersCreateError` - Adapter creation failed
- `poolAddressCalculated` - Pool address calculated

---

### subscribe(eventType, handler)

Subscribe to VaultDataService events.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| eventType | `string` | Yes | Event type to subscribe to |
| handler | `Function` | Yes | Event handler function |

**Returns:**
`Function` - Unsubscribe function

**Example:**

```javascript
// Subscribe to vault loading events
const unsubscribe = vaultDataService.subscribe('vaultLoaded', (data) => {
  console.log(`Vault ${data.vaultAddress} loaded with ${data.positionCount} positions`);
});

// Later: unsubscribe();
```

---

### computePoolAddress(token0, token1, fee, platform, chainId, adapter)

Calculate pool address deterministically.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| token0 | `string` | Yes | - | Token0 address |
| token1 | `string` | Yes | - | Token1 address |
| fee | `number` | Yes | - | Fee tier (e.g., 500, 3000, 10000) |
| platform | `string` | Yes | - | Platform identifier (e.g., 'uniswapv3') |
| chainId | `number` | No | current | Chain ID |
| adapter | `Object` | No | null | Platform adapter instance |

**Returns:**
`Promise<string>` - Computed pool address

---

### getDynamicVaultState(vaultAddress, position, currentTick, sqrtPriceX96, adapter)

Calculate dynamic state for a vault position at current market conditions.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| vaultAddress | `string` | Yes | Vault address |
| position | `Object` | Yes | Position object with pool information |
| currentTick | `number` | Yes | Current pool tick |
| sqrtPriceX96 | `string` | Yes | Current sqrt price in X96 format |
| adapter | `Object` | Yes | Platform adapter instance for fee calculations |

**Returns:**
`Promise<Object>` - Dynamic state object

**Dynamic State Structure:**
```javascript
{
  positions: {
    '12345': {
      inRange: true,     // Whether position is currently in range
      fees: {
        token0: '1.234', // Formatted uncollected fees
        token1: '0.567'
      }
    }
  }
}
```

**Events Emitted:**
- `dynamicDataFetched` - `vaultAddress, dynamicData`
- `dynamicDataError` - `vaultAddress, positionId, errorMessage`

---

## Integration with AutomationService

The VaultDataService is automatically initialized by the AutomationService:

```javascript
// AutomationService sets up the VaultDataService
this.vaultDataService = new VaultDataService(this.eventManager);
this.vaultDataService.initialize(this.provider, this.chainId);
this.vaultDataService.setTokens(this.tokens);
this.vaultDataService.setAdapters(this.adapters);
this.vaultDataService.setPoolData(this.poolData);

// Access through AutomationService
const vault = await automationService.vaultDataService.getVault(vaultAddress);
```

---

## Error Handling

### Common Errors

```javascript
// Service not initialized
try {
  await vaultDataService.loadVaultData('0x123...abc');
} catch (error) {
  if (error.message.includes('not initialized')) {
    console.error('Must call initialize() first');
  }
}

// No strategy configured
try {
  await vaultDataService.loadVaultData('0x123...abc');
} catch (error) {
  if (error.message.includes('no strategy set')) {
    console.error('Vault must have a strategy configured');
  }
}

// Adapters not set
try {
  await vaultDataService.loadVaultData('0x123...abc');
} catch (error) {
  if (error.message.includes('Adapters not initialized')) {
    console.error('AutomationService must call setAdapters() first');
  }
}
```

### Best Practices

1. **Always Initialize**: Call `initialize()` then setter methods before data operations
2. **Handle Cache Misses**: Be prepared for null returns from getter methods
3. **Monitor Events**: Subscribe to error events for robust error handling
4. **Use getVault()**: Prefer `getVault()` over `loadVaultData()` for cache efficiency
5. **Validate Addresses**: Addresses are normalized internally, but validate input

---

For related documentation:
- [AutomationService API](../automation-service/automation-service.md) - Main automation service
- [VaultRegistry API](./vault-registry.md) - Vault authorization management
- [EventManager API](../utilities/event-manager.md) - Event management system
- [Strategy System](../strategies/strategy-base.md) - Strategy implementations
