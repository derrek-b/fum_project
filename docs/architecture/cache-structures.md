# Cache Data Structures Reference

This document provides a comprehensive reference of all cached object structures used throughout the FUM Automation system. Understanding these structures is essential for working with the codebase and debugging data flow issues.

## Overview

The FUM Automation system uses several centralized caches to optimize performance and ensure data consistency:

- **AutomationService**: Manages adapters, token configurations, pool data, vault locks, and failure tracking
- **VaultDataService**: Manages vault data and positions for authorized vaults only
- **EventManager**: Manages blockchain event listeners and pool-to-vault mappings

---

## AutomationService Cache Structures

### `this.adapters` - Platform Adapters Cache
**Type**: `Map<string, Object>`
**Key**: Platform identifier (e.g., 'uniswapV3')
**Purpose**: One adapter instance per platform per chain, cached at startup

```javascript
this.adapters = Map {
  'uniswapV3' => UniswapV3Adapter {
    chainId: 1,
    provider: ethers.Provider,
    platformConfig: {
      factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
      quoterV2Address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      swapRouterAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564'
    }
  }
}
```

### `this.tokens` - Token Configurations Cache
**Type**: `Object`
**Key**: Token symbol (e.g., 'USDC', 'WETH')
**Purpose**: Single source of truth for all token data, prevents duplication

```javascript
this.tokens = {
  'USDC': {
    symbol: 'USDC',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
    name: 'USD Coin',
    isNative: false  // optional, true for native tokens like ETH
  },
  'WETH': {
    symbol: 'WETH',
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    decimals: 18,
    name: 'Wrapped Ether',
    isNative: false
  }
}
```

### `this.vaultLocks` - Vault Processing Locks
**Type**: `Object`
**Key**: Vault address (normalized to lowercase)
**Purpose**: Prevent race conditions during vault processing. Uses timestamps to track lock acquisition time.

```javascript
this.vaultLocks = {
  '0x1234567890123456789012345678901234567890': 1703123456789, // locked at timestamp
  // Unlocked vaults are deleted from the object, not set to false
}
```

**Lock Operations**:
- Lock: `this.vaultLocks[normalized] = Date.now()`
- Unlock: `delete this.vaultLocks[normalized]`
- Check: `if (this.vaultLocks[normalized]) { ... }`

### `this.poolData` - Pool Data Cache
**Type**: `Object`
**Key**: Normalized pool address (checksummed)
**Purpose**: Centralized pool metadata cache - only stable, non-time-sensitive data

```javascript
this.poolData = {
  '0xPoolAddress123456789012345678901234567890': {
    // Pool metadata only (stable data - populated via PoolDataFetched events)
    token0Symbol: 'USDC',
    token1Symbol: 'WETH',
    fee: 3000,
    platform: 'uniswapV3'
  }
}
```

**Important Notes**:
- **Only metadata is cached** - no time-sensitive data (tick, liquidity, sqrtPriceX96, fee growth values)
- **Time-sensitive data is always fetched fresh** when needed for calculations
- **Pool metadata is populated via PoolDataFetched events** during vault loading, not during service initialization

### `this.strategies` - Strategy Class Instances
**Type**: `Map<string, Object>`
**Key**: Strategy identifier (e.g., 'bob')
**Purpose**: Strategy implementation instances for processing vault operations

```javascript
this.strategies = Map {
  'bob' => BabyStepsStrategy {
    // Strategy instance with methods like initializeVaultStrategy(), handleSwapEvent(), etc.
  }
  // Additional strategy instances added here
}
```

**Important Notes**:
- These are **strategy class instances**, not strategy parameter data
- Strategy **parameters** are stored in `vault.strategy.parameters` (no separate parameter cache)
- Strategy instances are cached for performance and method access
- Access via `this.strategies.get(strategyId)`

### `this.failedVaults` - Failed Vault Retry Queue
**Type**: `Map<string, Object>`
**Key**: Vault address (normalized to lowercase)
**Purpose**: Track vaults that failed during setup/processing for retry attempts

```javascript
this.failedVaults = Map {
  '0x1234567890123456789012345678901234567890' => {
    vaultAddress: '0x1234...',
    firstFailedAt: 1703123456789,    // timestamp of first failure
    lastAttemptAt: 1703123556789,    // timestamp of last retry attempt
    lastError: 'RPC timeout',        // error message from last failure
    attempts: 3,                      // number of retry attempts
    source: 'setupVault'             // where the failure originated
  }
}
```

### `this.blacklistedVaults` - Permanently Failed Vaults
**Type**: `Map<string, Object>`
**Key**: Vault address (normalized, checksummed)
**Purpose**: Track vaults that exceeded retry limits and are permanently excluded. Persisted to disk.

```javascript
this.blacklistedVaults = Map {
  '0x1234567890123456789012345678901234567890' => {
    vaultAddress: '0x1234...',
    blacklistedAt: 1703123456789,    // timestamp when blacklisted
    reason: 'Exceeded retry trip limit: 5 trips in 24 hours'
  }
}
```

**Persistence**: Saved to `./data/blacklist.json` via `saveBlacklist()` and loaded on startup via `loadBlacklist()`.

### `this.vaultTripHistory` - Retry Trip Tracking
**Type**: `Map<string, Object>`
**Key**: Vault address
**Purpose**: Track retry "trips" (failed -> retry queue -> failed again cycles) to detect chronic failures

```javascript
this.vaultTripHistory = Map {
  '0x1234567890123456789012345678901234567890' => {
    trips: [
      { timestamp: 1703123456789, source: 'setupVault' },
      { timestamp: 1703123556789, source: 'handleSwapEvent' }
    ],
    firstTripAt: 1703123456789
  }
}
```

**Blacklist Logic**: If a vault accumulates `MAX_TRIPS_IN_WINDOW` (5) trips within `TRIP_WINDOW_MS` (24 hours), it gets blacklisted.

---

## VaultDataService Cache Structures

### `#vaults` - Authorized Vault Data Cache
**Type**: `Map<string, Object>` (private field)
**Key**: Normalized vault address (checksummed)
**Purpose**: Complete vault state for authorized vaults only, including tokens, positions, and metadata. This is the single source of truth for authorized vaults - only vaults that have authorized the automation service as their executor are stored here.

```javascript
#vaults = Map {
  '0x1234567890123456789012345678901234567890' => {
    // Core vault properties
    address: '0x1234567890123456789012345678901234567890',
    owner: '0xOwnerAddress...',
    chainId: 1,
    strategyAddress: '0xStrategyAddress...',

    // Strategy configuration (null if no strategy)
    strategy: {
      strategyId: 'bob',
      strategyAddress: '0xStrategyContractAddress...',
      parameters: {
        targetRangeUpper: 500,           // basis points
        targetRangeLower: 500,           // basis points
        rebalanceThresholdUpper: 150,    // basis points
        rebalanceThresholdLower: 150,    // basis points
        feeReinvestment: true,           // boolean
        reinvestmentTrigger: '50000000000000000000', // wei
        reinvestmentRatio: 8000,         // basis points
        maxSlippage: 50,                 // basis points
        emergencyExitTrigger: 1500,      // basis points
        maxUtilization: 8000             // basis points
      }
    },

    // Token balances (symbol-keyed) - simplified structure
    tokens: {
      'USDC': '1000000000',           // balance in wei/smallest unit as string
      'WETH': '500000000000000000'    // balance in wei/smallest unit as string
    },

    // Target configuration
    targetTokens: ['USDC', 'WETH'],
    targetPlatforms: ['uniswapV3'],

    // Positions (object-keyed by position ID)
    positions: {
      '12345': {
        id: '12345',
        pool: '0xPoolAddress123...',           // pool contract address
        tickLower: -887220,                    // lower tick boundary
        tickUpper: 887220,                     // upper tick boundary
        liquidity: '1000000000000000000',      // position liquidity as string
        // Fee tracking fields (stable - only change on position interaction)
        feeGrowthInside0LastX128: '123456789...', // fee growth snapshot for token0
        feeGrowthInside1LastX128: '987654321...', // fee growth snapshot for token1
        tokensOwed0: '0',                      // uncollected fees for token0
        tokensOwed1: '0',                      // uncollected fees for token1
        lastUpdated: 1703123456789             // timestamp when position was last updated
      },
      '67890': {
        id: '67890',
        pool: '0xPoolAddress456...',
        tickLower: -60000,
        tickUpper: 60000,
        liquidity: '500000000000000000',
        feeGrowthInside0LastX128: '...',
        feeGrowthInside1LastX128: '...',
        tokensOwed0: '0',
        tokensOwed1: '0',
        lastUpdated: 1703123456789
      }
    },

    // Metadata
    lastUpdated: 1703123456789
  }
}
```

**Access Methods** (since `#vaults` is private):
- `getVault(address, forceRefresh)` - Get vault, loading if needed
- `hasVault(address)` - Check if vault is cached
- `removeVault(address)` - Remove vault from cache
- `getAllVaults()` - Get array of all cached vaults
- `clearCache()` - Clear all cached vaults

---

## EventManager Cache Structures

### `this.listeners` - Blockchain Event Listeners
**Type**: `Object`
**Key**: Generated listener key (format: `{address}:{event}:{identifier}`)
**Purpose**: Track all registered blockchain event listeners for cleanup and management

```javascript
this.listeners = {
  '0xpool123:swap:vault456': {
    type: 'filter',              // 'contract', 'filter', or 'interval'
    handler: Function,           // wrapped handler with zombie check
    originalHandler: Function,   // original handler for reference
    vaultAddress: '0x456...',    // associated vault (if applicable)
    isRemoved: false             // marked true during removal to prevent zombie execution
  },
  '0xstrategy789:ParameterUpdated:vault456': {
    type: 'contract',
    handler: Function,
    originalHandler: Function,
    vaultAddress: '0x456...',
    isRemoved: false
  }
}
```

### `this.poolToVaults` - Pool-to-Vault Mappings
**Type**: `Object<string, Array<string>>`
**Key**: Pool address
**Purpose**: Track which vaults are monitoring each pool for efficient swap event distribution

```javascript
this.poolToVaults = {
  '0xPoolAddress123...': ['0xVault1...', '0xVault2...'],
  '0xPoolAddress456...': ['0xVault3...']
}
```

**Usage**: When a swap event fires on a pool, all vaults in the array are notified. When a vault is removed, it's cleaned from all pool arrays. When a pool array becomes empty, the pool listener is removed.

### `this.failedRemovals` - Failed Listener Removal Tracking
**Type**: `Map<string, Object>`
**Key**: Listener key
**Purpose**: Track listeners that failed to remove properly for retry

```javascript
this.failedRemovals = Map {
  '0xpool123:swap:vault456' => {
    listener: { ... },           // the listener object
    failedAt: 1703123456789,     // timestamp of failure
    attempts: 2,                 // retry attempts
    lastError: 'Provider disconnected'
  }
}
```

---

## Service Dependencies & Utilities

These are class properties that hold instances, configurations, or utilities - not cached data structures:

### AutomationService Dependencies
- `this.automationServiceAddress` - Automation service executor address (string)
- `this.chainId` - Network configuration (number)
- `this.wsUrl` - WebSocket provider URL (string)
- `this.debug` - Debug logging flag (boolean)
- `this.isRunning` - Service running state flag (boolean)
- `this.provider` - Ethereum WebSocket provider instance
- `this.contracts` - Pre-initialized contract instances cache (Object)
- `this.eventManager` - EventManager instance for managing blockchain events
- `this.vaultDataService` - VaultDataService instance reference
- `this.tracker` - Tracker instance for vault transaction logging
- `this.sseBroadcaster` - SSEBroadcaster instance for real-time updates

### VaultDataService Dependencies
- `this.eventManager` - EventManager instance reference
- `this.provider` - Ethereum provider instance (set by AutomationService)
- `this.chainId` - Network configuration (set by AutomationService)
- `this.lastRefreshTime` - Timestamp of last vault data refresh
- `this.adapters` - Platform adapters reference (set by AutomationService)
- `this.poolData` - Pool data cache reference (set by AutomationService)
- `this.tokens` - Token configurations reference (set by AutomationService)

### EventManager Dependencies
- `this.debug` - Debug logging flag (boolean)
- `this.provider` - Ethereum provider instance
- `this.chainId` - Network chain ID
- `this.adapters` - Platform adapters reference
- `this.poolData` - Pool data cache reference
- `this.isCleaningUp` - Flag to prevent new registrations during cleanup

---

## Configuration Constants

### Retry & Blacklist Configuration
```javascript
// AutomationService constructor defaults
this.retryIntervalMs = config.retryIntervalMs || 300000;        // 5 minutes between retry cycles
this.maxFailureDurationMs = config.maxFailureDurationMs || 3600000; // 1 hour max in retry queue

// Trip tracking constants (in retryFailedVaults)
const TRIP_WINDOW_MS = 24 * 60 * 60 * 1000;  // 24 hours
const MAX_TRIPS_IN_WINDOW = 5;               // Blacklist after 5 trips in window

// Decay window for trip history cleanup
const DECAY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours - clear history if no trips
```

### Service Configuration
```javascript
this.ssePort = config.ssePort || 3001;
this.blacklistFilePath = config.blacklistFilePath || './data/blacklist.json';
this.trackingDataDir = config.trackingDataDir || './data/vaults';
this.heartbeatIntervalMs = 30000; // 30 seconds
```

---

## Access Patterns

### Getting Token Information
```javascript
// From AutomationService
const tokenConfig = automationService._getTokenBySymbol('USDC');
const tokenConfig = automationService._lookupTokenByAddress('0xA0b8699...');

// From vault tokens (balances) - simplified structure
const balance = vault.tokens['USDC']; // balance string directly
```

### Getting Pool Information
```javascript
// Get pool metadata (from AutomationService cache)
const poolMetadata = automationService.poolData[poolAddress];
const token0Symbol = poolMetadata.token0Symbol;
const token1Symbol = poolMetadata.token1Symbol;
const feeTier = poolMetadata.fee;

// Get fresh time-sensitive data (always fetch fresh when needed)
const adapter = automationService.adapters.get(poolMetadata.platform);
const freshPoolData = await adapter.getPoolData(poolAddress, {}, provider);
const currentTick = freshPoolData.tick;
const currentLiquidity = freshPoolData.liquidity;

// Get fresh tick data for fee calculations
const tickData = await adapter.fetchTickData(poolAddress, tickLower, tickUpper, provider);
const feeGrowthOutside = tickData.tickLower.feeGrowthOutside0X128;
```

### Getting Position Information
```javascript
// Get vault with positions
const vault = await vaultDataService.getVault(vaultAddress);
const positions = vault.positions;

// Access specific position
const position = vault.positions['12345'];
const poolAddress = position.pool;
const isInRange = currentTick >= position.tickLower && currentTick <= position.tickUpper;
```

### Getting Strategy Information
```javascript
// Get strategy instance
const strategy = automationService.strategies.get('bob');

// Get vault's strategy parameters
const vault = await vaultDataService.getVault(vaultAddress);
const params = vault.strategy.parameters;
const targetRange = params.targetRangeUpper;
```

---

## Data Flow and Relationships

```
┌─────────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  AutomationService  │    │ VaultDataService │    │  EventManager   │
│                     │    │                  │    │                 │
│ • adapters (Map)    │───▶│ • #vaults (Map)  │◀───│ • listeners     │
│ • tokens            │    │   (private,      │    │ • poolToVaults  │
│ • poolData          │    │    authorized    │    │ • failedRemovals│
│ • vaultLocks        │    │    vaults only)  │    │                 │
│ • strategies (Map)  │    │                  │    │ Listener Types: │
│ • failedVaults (Map)│    │                  │    │ • Swap events   │
│ • blacklistedVaults │    │                  │    │ • Parameter     │
│ • vaultTripHistory  │    │                  │    │   updates       │
└─────────────────────┘    └──────────────────┘    └─────────────────┘
        │                          │                        │
        │                          │                        │
        ▼                          ▼                        ▼
┌─────────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│     Strategies      │    │    Positions     │    │   Real-time     │
│                     │    │                  │    │   Event Sync    │
│ Use vault.strategy. │    │ Reference pool   │    │                 │
│ parameters from     │    │ via pool address │    │ • VaultAuth     │
│ VaultDataService    │    │                  │    │   Granted       │
│                     │    │ Include fee      │    │ • VaultAuth     │
│ Instances cached    │    │ tracking fields  │    │   Revoked       │
│ in strategies Map   │    │ for calculations │    │ • Parameter     │
└─────────────────────┘    └──────────────────┘    │   Updated       │
                                                   └─────────────────┘
```

## Key Design Principles

1. **Single Source of Truth**: Each data type has one authoritative cache location
2. **Authorization-Based Filtering**: VaultDataService only contains vaults that have authorized the automation service as their executor
3. **Reference by ID**: Objects reference each other by ID/address rather than embedding
4. **Normalized Keys**: All addresses are checksummed for consistent lookup
5. **Symbol-Based Tokens**: Token data keyed by symbol for better UX and consistency
6. **Object-Keyed Collections**: Use objects instead of arrays for O(1) access patterns
7. **Minimal Metadata**: Pool data only caches stable metadata without timestamps
8. **Private Fields**: VaultDataService uses private `#vaults` field to enforce access through public methods
9. **Timestamp Locks**: Vault locks use timestamps (not booleans) to enable stale lock detection
10. **Failure Tracking**: Multi-tier failure handling with retry queue, trip tracking, and blacklisting

This structure eliminates data duplication, ensures consistency, and provides efficient access patterns for the automation system.

## Key Architectural Notes

1. **No Strategy Parameter Cache**: Strategy parameters are accessed directly from `vault.strategy.parameters` in VaultDataService, eliminating redundant parameter caching. Strategy class instances are cached in `this.strategies` Map for performance.

2. **Real-time Parameter Sync**: The system listens for `ParameterUpdated` events from strategy contracts and automatically refreshes vault data when parameters change on-chain.

3. **Strategy Identification**: Uses `vault.strategy.strategyId` directly instead of address comparison, making strategy detection more reliable.

4. **Single Vault Cache**: VaultDataService.#vaults serves as both the vault data cache AND the list of authorized vaults, eliminating the need for a separate `authorizedVaults` array.

5. **Graceful Failure Handling**: Failed vaults go through retry queue -> trip tracking -> blacklist progression, with persistence to survive service restarts.

6. **Shared References**: VaultDataService and EventManager receive references to AutomationService caches (adapters, poolData, tokens) to ensure consistency without duplication.

This architecture ensures all strategy data is always current, provides robust failure recovery, and eliminates the possibility of stale cached parameters.
