<!-- Source: src/redux/*, src/hooks/*, src/contexts/*, src/context/*, src/pages/_app.js, src/utils/vaultsHelpers.js, src/components/* -->
# Frontend Architecture

Redux state shapes, data flow patterns, SSE integration, and component organization for the Next.js 15 frontend. Reference this before modifying Redux slices, data loading logic, or automation event handling.

## Application Composition

Provider nesting order from `src/pages/_app.js`:

```
Redux Provider (store)
  └── ProviderProvider (ProviderContext — ethers providers)
        └── ErrorBoundary (react-error-boundary)
              └── ToastProvider (ToastContext)
                    ├── AutoRefreshHandler (30s polling via setInterval)
                    ├── AutomationEventsHandler (SSE connection)
                    └── Component (page content)
```

**Module-level initialization** (outside React tree):
```javascript
initFumLibrary({
  coingeckoApiKey: process.env.NEXT_PUBLIC_COINGECKO_API_KEY,
  alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
});
```

---

## Provider Architecture

**Source:** `src/contexts/ProviderContext.js`

Two providers serve different purposes:

| Provider | Source | Purpose | Access Hook |
|---|---|---|---|
| Write provider | Wallet (Web3Modal) | Transaction signing, state mutations | `useProviders().writeProvider` |
| Read provider | Dedicated RPC (chain config URLs) | Contract reads, balance queries | `useProviders().readProvider` |

**Why two providers:** The wallet provider rate-limits RPC calls and adds latency through the browser extension. A dedicated RPC provider (Alchemy) handles high-frequency reads without impacting the wallet connection.

**Why providers live in Context, not Redux:** ethers.js Provider objects contain prototype chains and internal state that Redux's serialization checks reject. Context holds the live objects; Redux holds serializable data derived from them.

**Hooks:**
- `useProviders()` — Returns `{ readProvider, writeProvider, getSigner, chainId, isReadReady, isWriteReady }`
- `useReadProvider()` — Shortcut for read-only contexts
- `useWriteProvider()` — Shortcut for write contexts

**Lifecycle:** On wallet connect, creates dedicated read provider. On chain change, reloads page (MetaMask recommendation). On disconnect, clears both providers.

---

## Redux State Shape

**Store:** `src/redux/store.js` — 9 slices

### state.wallet

**Source:** `src/redux/walletSlice.js`

```javascript
{
  address: string | null,        // "0x..." wallet address
  chainId: number | null,        // 42161 (Arbitrum), 1337 (localhost)
  isConnected: boolean,          // true after successful connection
  isReconnecting: boolean        // true during auto-reconnect
}
```

Persisted to `localStorage["fum_wallet_connection"]`. Reducers: `setWallet`, `disconnectWallet`, `setReconnecting`.

### state.vaults

**Source:** `src/redux/vaultsSlice.js` — The most complex slice (15 reducers)

```javascript
{
  userVaults: [VaultObject],     // Array of full vault objects
  isLoadingVaults: boolean,
  vaultError: string | null
}
```

**VaultObject shape:**
```javascript
{
  address: string,
  owner: string,
  positions: [string],               // Position IDs in this vault
  metrics: {
    tvl: number,                     // Total value locked (USD)
    positionCount: number,
    tokenTVL: number,                // Value of token balances only
    hasPartialData: boolean,         // Some position prices unavailable
    tokenHasPartialData: boolean,    // Some token prices unavailable
    lastTVLUpdate: number            // Timestamp
  },
  tokenBalances: {
    [symbol]: {
      symbol: string,
      name: string,
      balance: string,               // Formatted (e.g., "1.5")
      numericalBalance: number,
      valueUsd: number,
      decimals: number,
      logoURI: string,
      isNativeEntry: boolean,        // Native ETH entry
      isWeth: boolean,               // Flag for withdraw modal
      address: string | null         // Token contract address
    }
  },
  strategy: {
    strategyId: string,              // "bob", "parris", "fed"
    strategyAddress: string,
    isActive: boolean,
    selectedTokens: [string],        // Target token addresses
    selectedPlatforms: [string],     // Target platform IDs
    parameters: {...},               // Strategy parameters
    activeTemplate: string,          // Selected template ID
    lastUpdated: number
  } | null,
  isBlacklisted: boolean,
  blacklistReason: string | null,
  isRetrying: boolean,
  retryError: {
    message: string,
    attempts: number,
    lastAttempt: number
  } | null,
  trackerMetadata: {
    baseline: { timestamp: number, value: number },
    lastSnapshot: { timestamp: number, value: number },
    aggregates: {
      cumulativeFeesWithdrawnUSD: number,
      cumulativeFeesReinvestedUSD: number,
      cumulativeFeesUSD: number,
      cumulativeGasUSD: number
    }
  } | null,
  transactionHistory: [{
    txHash: string,
    type: string,
    timestamp: number,
    status: string,                  // pending, confirmed, failed
    ...metadata
  }],
  trackerDataLoaded: boolean
}
```

**Key reducers:** `setVaults`, `addVault`, `updateVault` (merges), `setVaultPositions`, `addPositionToVault`, `removePositionFromVault`, `updateVaultPositions` (add/remove/replace), `updateVaultTokenBalances`, `updateVaultMetrics`, `updateVaultStrategy`, `updateVaultTrackerData`, `appendVaultTransaction` (prepends — most recent first)

### state.positions

**Source:** `src/redux/positionsSlice.js`

```javascript
{
  positions: [PositionObject]    // Mixed array of wallet + vault positions
}
```

**PositionObject shape:**
```javascript
{
  id: string,                    // Position ID
  platform: string,             // "uniswap-v3", "uniswap-v4", "trader-joe"
  pool: string,                 // Pool address
  tickLower: number,
  tickUpper: number,
  liquidity: string,            // BigInt as string
  inVault: boolean,             // true = vault position, false = wallet position
  vaultAddress: string | null,  // Set when inVault=true
  ...platformSpecificFields
}
```

The `inVault` flag is the key discriminator. `setPositions` marks all incoming as `inVault: false` (wallet positions). `addVaultPositions` marks as `inVault: true`.

### state.pools

**Source:** `src/redux/poolSlice.js`

```javascript
{
  [poolAddress]: {
    address: string,
    token0: { address, symbol, name, decimals, logoURI },
    token1: { address, symbol, name, decimals, logoURI },
    fee: number,                 // Fee tier (3000 = 0.3%)
    price: number,               // Current spot price
    ticks: {                     // For V3 fee calculation
      [tickIndex]: { liquidityGross, liquidityNet, ...tickData }
    }
  }
}
```

Object keyed by pool address. Token data is **embedded** in pool objects (not referenced by ID). `setPools` merges, preserving tick data from both sources.

### state.tokens

**Source:** `src/redux/tokensSlice.js`

```javascript
{
  [symbol]: {
    symbol: string,
    name: string,
    decimals: number,
    logoURI: string,
    coingeckoId: string,
    addresses: { [chainId]: string },
    isNative: boolean,
    wethAddresses: { [chainId]: string }
  }
}
```

Simple key-value store. `setTokens` assigns directly.

### state.strategies

**Source:** `src/redux/strategiesSlice.js`

```javascript
{
  availableStrategies: [{
    id: string,                      // "bob", "parris", "fed", "none"
    name: string,
    subtitle: string,
    description: string,
    contractKey: string,             // Key in contract artifacts
    addresses: { [chainId]: string },
    supportsTemplates: boolean,
    templateEnumMap: { [templateId]: enumValue } | null,
    hasGetAllParameters: boolean,
    parameters: [{ id, name, type, ...parameterSpec }],
    contractParametersGroups: [{
      id: string,
      setterMethod: string,          // Contract method name
      parameters: [string]           // Parameter IDs in group
    }],
    comingSoon: boolean              // Only "bob" and "none" are ready
  }]
}
```

### state.platforms

**Source:** `src/redux/platformsSlice.js`

```javascript
{
  supportedPlatforms: [{ id, name, chain }],  // Available on current chain
  activePlatforms: [{ id, name, chain }],     // Have active positions
  platformFilter: string | null               // Active filter (platformId)
}
```

### state.updates

**Source:** `src/redux/updateSlice.js`

```javascript
{
  lastUpdate: number,            // Date.now() — the central refresh signal
  isUpdating: boolean,
  autoRefresh: {
    enabled: boolean,            // Toggle
    interval: 30000,             // Milliseconds
    lastAutoRefresh: number | null
  },
  resourcesUpdating: {
    positions: boolean,
    pools: boolean,
    tokens: boolean
  }
}
```

**`lastUpdate` is the universal refresh mechanism.** All refresh sources (SSE events, auto-refresh timer, manual refresh) converge on `dispatch(triggerUpdate())` which sets `lastUpdate = Date.now()`. Components watch `lastUpdate` in useEffect to re-fetch.

### state.automation

**Source:** `src/redux/automationSlice.js`

```javascript
{
  connected: boolean,                // SSE connection status
  lastEvent: {
    event: string,
    data: object,
    timestamp: number,
    receivedAt: number
  } | null,
  recentEvents: [],                  // Rolling window of 50 most recent
  connectionError: string | null,
  stats: {
    eventsReceived: number,
    lastConnectedAt: number | null,
    reconnectCount: number
  }
}
```

---

## Data Flow

### The Refresh Cycle

```
triggerUpdate()
  └── lastUpdate = Date.now()
        └── useEffect watchers fire
              └── re-fetch data (positions, pools, balances)
                    └── dispatch to slices
                          └── components re-render
```

**Three refresh triggers:**
1. **SSE events** — REFRESH_TRIGGER_EVENTS dispatch `triggerUpdate()`
2. **Auto-refresh** — AutoRefreshHandler calls `triggerUpdate()` every 30s (if enabled)
3. **Manual** — RefreshControls button dispatches `triggerUpdate()`

### Vault Data Loading Pipeline

**Source:** `src/utils/vaultsHelpers.js` — Async functions that accept `dispatch` (NOT hooks)

`loadVaultData(userAddress, provider, chainId, dispatch)` orchestrates the full loading sequence:

1. `loadVaultStrategies()` → `dispatch(setAvailableStrategies(...))`
2. Get user vault addresses from VaultFactory
3. **First pass:** `loadVaultBasicInfo()` for each vault (skip metrics)
4. Get non-vault positions from adapters
5. Merge pool data from all sources
6. `dispatch(setPools(...))`, `dispatch(setPositions(...))`
7. **Prefetch all token prices** at once (batch CoinGecko call)
8. **Second pass:** Calculate TVL for each vault
9. `loadVaultTokenBalances()` for each vault
10. Fetch blacklist data from automation service
11. Fetch tracker data for all vaults (parallel)
12. `dispatch(setVaults(completeVaultsData))`

**Single vault refresh:** `getVaultData(vaultAddress, ...)` runs steps 1–6 for one vault.

---

## SSE Integration

**Source:** `src/hooks/useAutomationEvents.js`

Connects to `process.env.NEXT_PUBLIC_SSE_URL` (e.g., `http://localhost:3001/events`).

### Event Types

| Event | Triggers Refresh | Vault State Update |
|---|---|---|
| `ServiceStarted` | No | — |
| `ServiceStartFailed` | No | — |
| `NewPositionCreated` | **Yes** | — |
| `PositionsClosed` | **Yes** | — |
| `PositionRebalanced` | No | — |
| `LiquidityAddedToPosition` | **Yes** | — |
| `FeesCollected` | **Yes** | — |
| `TokensSwapped` | **Yes** | — |
| `VaultBaselineCaptured` | No | — |
| `MonitoringStarted` | No | — |
| `VaultLoadFailed` | No | `isRetrying=true`, `retryError={message, attempts, lastAttempt}` |
| `VaultLoadRecovered` | No | Clears `isRetrying`, `retryError`, `isBlacklisted` |
| `VaultUnrecoverable` | **Yes** | `isBlacklisted=true`, `blacklistReason` |
| `VaultBlacklisted` | No | `isBlacklisted=true`, `blacklistReason` |
| `VaultUnblacklisted` | No | `isBlacklisted=false`, `blacklistReason=null` |
| `FeeCollectionFailed` | No | — |
| `TransactionLogged` | No | Prepends to `transactionHistory` |

**REFRESH_TRIGGER_EVENTS:** `NewPositionCreated`, `PositionsClosed`, `LiquidityAddedToPosition`, `FeesCollected`, `TokensSwapped`, `VaultUnrecoverable`

### Automation Service REST Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /blacklist` | Returns `{ [vaultAddress]: { reason, ...metadata } }` |
| `GET /vault/:address/metadata` | Tracker metadata (baseline, snapshot, aggregates) |
| `GET /vault/:address/transactions` | Transaction history array |

---

## Page Structure

| Route | File | Primary Content |
|---|---|---|
| `/` | `pages/index.js` | Landing page with links to Vaults, Positions, Demo |
| `/vaults` | `pages/vaults.js` | Vault management dashboard |
| `/positions` | `pages/positions.js` | Position management dashboard |
| `/demo` | `pages/demo.js` | Demo/test page |

---

## Component Organization

```
src/components/
├── common/
│   ├── Navbar.js                       # Top navigation
│   ├── WalletConnectEVM.js             # Web3Modal wallet connection
│   ├── PriceRangeChart.js              # Price range visualization
│   ├── AutomationStatus.js             # SSE connection status display
│   ├── TransactionProgressModal.js     # Transaction tracking modal
│   └── RefreshControls.js              # Manual refresh + auto-refresh toggle
├── vaults/
│   ├── VaultsContainer.js              # Main vaults list
│   ├── VaultCard.js                    # Individual vault display
│   ├── StrategyConfigPanel.js          # Strategy configuration UI
│   ├── StrategyDetailsSection.js       # Strategy details display
│   ├── StrategyValidationModal.js      # Pre-deploy validation
│   ├── StrategyDeactivationModal.js    # Remove strategy
│   ├── AutomationModal.js             # Enable/disable automation
│   ├── CreateVaultModal.js             # Create new vault
│   ├── TokenDepositModal.js            # Deposit tokens
│   ├── TokenWithdrawModal.js           # Withdraw tokens
│   └── PositionSelectionModal.js       # Select positions to move
├── positions/
│   ├── PositionContainer.js            # Main positions list
│   ├── PositionCard.js                 # Individual position display
│   ├── PlatformFilter.js              # Filter by platform
│   ├── AddLiquidityModal.js            # Add liquidity
│   ├── RemoveLiquidityModal.js         # Remove liquidity
│   ├── ClaimFeesModal.js              # Claim fees
│   └── ClosePositionModal.js           # Close position
└── transactions/
    ├── TransactionList.js              # Transaction history
    └── TransactionItem.js              # Single transaction row
```

---

## Toast System

**Source:** `src/context/ToastContext.js` (note: singular `context/`, not `contexts/`)

**API:** `useToast()` returns `{ showSuccess(message, txHash), showError(error), toasts, removeToast(id) }`

**Error processing:**
- Code 4001 → "Transaction was cancelled" (user rejected in MetaMask)
- `.reason` field → Show reason directly
- `.message` field → Truncate to 100 chars
- String error → Use as-is

**Explorer URLs:** Chain 1 → etherscan.io, Chain 42161 → arbiscan.io

**Auto-remove:** 5000ms timeout

---

## Key Patterns and Gotchas

1. **Providers in Context / data in Redux** — Provider objects can't be serialized; everything else goes in Redux
2. **readProvider for reads / wallet provider for writes** — Never use the wallet provider for batch reads
3. **`lastUpdate` as universal refresh signal** — SSE, auto-refresh, and manual refresh all converge here
4. **Token data embedded in pool objects** — Pool state includes full token metadata, not just addresses
5. **Mixed positions array** — `state.positions` contains both wallet and vault positions, distinguished by `inVault` flag
6. **Two context directories** — `context/` (singular, contains ToastContext) and `contexts/` (plural, contains ProviderContext)
7. **vaultsHelpers.js is the data loading engine** — Async functions that accept `dispatch`, NOT hooks. Called from components and event handlers
8. **CoinGecko cache durations** — 30s for token list, 2min for price details
9. **`initFumLibrary()` at module level** — Called outside React tree in _app.js, runs once on import

---

## See Also

- [Contract System](./contract-system.md) — Smart contract architecture the frontend interacts with
- [Scripts Pipeline](./scripts-pipeline.md) — Local dev scripts for seeding test data
- fum_automation `docs/architecture/event-management.md` — SSE event emission (server side)
