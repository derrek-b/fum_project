<!-- Source: src/redux/*, src/hooks/*, src/contexts/*, src/context/*, src/pages/_app.js, src/utils/vaultsHelpers.js, src/utils/sseEventHandlers.js, src/components/* -->
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
- `useModalData(adapter, position, provider, isVisible)` — Returns `{ poolData, positionForAdapter, isLoading }`. Auto-refreshes pool data and position display data every 30s while modal is open. Flattens `platformData` onto position for adapter calls.

**Lifecycle:** On wallet connect, creates dedicated read provider. On chain change, reloads page (MetaMask recommendation). On disconnect, clears both providers.

---

## Redux State Shape

**Store:** `src/redux/store.js` — 7 slices: `wallet`, `positions`, `vaults`, `strategies`, `platforms`, `automation`, `updates`. Pool and token data live embedded inside position objects and vault `tokenBalances` — there is no separate pools or tokens slice.

### state.wallet

**Source:** `src/redux/walletSlice.js`

```javascript
{
  address: string | null,        // "0x..." wallet address
  chainId: number | null,        // 42161 (Arbitrum), 43114 (Avalanche), 1337 (Arbitrum localhost), 1338 (Avalanche localhost)
  isConnected: boolean,          // true after successful connection
  isReconnecting: boolean        // true during auto-reconnect
}
```

Persisted to `localStorage["fum_wallet_connection"]`. Reducers: `setWallet`, `disconnectWallet`, `setReconnecting`.

### state.vaults

**Source:** `src/redux/vaultsSlice.js` — The most complex slice (13 in-slice reducers + 2 cross-slice extraReducers)

```javascript
{
  userVaults: [VaultObject],     // Array of full vault objects
  isLoadingVaults: boolean,
  vaultError: string | null,
  vaultsLastFetched: number | null  // Timestamp for freshness gating
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
      isNativeEntry: boolean,        // Native token entry (ETH, AVAX, etc.)
      isWrappedNative: boolean,      // Wrapped native — withdraw modal offers unwrap option
      nativeSymbol: string | null,   // e.g., 'ETH' for WETH, 'AVAX' for WAVAX
      address: string | null         // Token contract address
    }
  },
  strategy: {
    strategyId: string,              // "bob"
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
  isFundingRequired: boolean,          // Executor needs manual funding
  fundingRequiredAt: number | null,    // Timestamp when funding became required
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

**Key reducers:** `setVaults`, `addVault`, `updateVault` (merges), `setVaultPositions`, `updateVaultPositions` (add/remove/replace), `updateVaultTokenBalances`, `updateVaultMetrics`, `updateVaultStrategy`, `updateVaultTrackerData`, `appendVaultTransaction` (prepends — most recent first), `setVaultsLastFetched`

**Cross-slice actions** (`src/redux/vaultPositionActions.js`): `transferPositionToVault({ positionId, vaultAddress })` and `transferPositionFromVault({ positionId, vaultAddress })` — both slices listen via `extraReducers`. positionsSlice flips `inVault`/`vaultAddress` on the position. vaultsSlice adds/removes the position ID from the vault's `positions` array. Single dispatch updates both slices atomically.

### state.positions

**Source:** `src/redux/positionsSlice.js`

```javascript
{
  positions: [PositionObject],    // Mixed array of wallet + vault positions
  positionsLastFetched: number | null  // Timestamp for freshness gating
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

**Key reducers:** `setPositions`, `addVaultPositions`, `updatePosition` (preserves vault status), `addPosition`, `removePosition`, `setPositionsLastFetched`. Also listens to cross-slice `transferPositionToVault`/`transferPositionFromVault` via `extraReducers`.

### state.strategies

**Source:** `src/redux/strategiesSlice.js`

```javascript
{
  availableStrategies: [{
    id: string,                      // "bob", "none"
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
  autoRefresh: {
    enabled: boolean,            // Toggle
    interval: 30000,             // Milliseconds
    lastAutoRefresh: number | null
  },
  resourcesUpdating: {
    positions: boolean
  }
}
```

**Freshness-gated fetching** replaces the old `triggerUpdate`/`lastUpdate` cascade. Each data domain has its own freshness timestamp (`positionsLastFetched`, `vaultsLastFetched`, `vaultFromRedux.lastUpdated`). Pages check freshness before fetching — if data is <30s old, skip the fetch. SSE events trigger targeted fetches directly (not freshness invalidation).

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

### Freshness-Gated Fetching

Pages check freshness timestamps before making RPC calls. If data was fetched within 30s, skip the fetch:

```
Page mounts / navigates
  └── Check freshness (positionsLastFetched, vaultFromRedux.lastUpdated)
        ├── Fresh (<30s) → use Redux data, skip RPC
        └── Stale (>30s or null) → fetch from chain → dispatch to Redux → re-render
```

The vault detail page also hydrates from Redux when VaultsContainer has already loaded the vault (avoids duplicate fetches on navigation).

**Three refresh mechanisms:**
1. **SSE events** — Targeted fetches via `sseEventHandlers.js` (see SSE Integration below)
2. **Auto-refresh** — On list pages, AutoRefreshHandler invalidates freshness timestamps every 30s (if enabled). Detail pages (`position/[id]`, `vault/[address]`) run their own `setInterval` that calls their refresh function directly, since they don't watch the global timestamps.
3. **Manual** — RefreshControls accepts an optional `onRefresh` callback. On detail pages, this calls the page's own refresh function (`refreshData` for positions, `loadData({ force: true })` for vaults). The global timestamp invalidation is also dispatched so list pages re-fetch on next navigation.

### Vault Data Loading Pipeline

**Source:** `src/utils/vaultsHelpers.js` — Async functions that accept `dispatch` (NOT hooks)

`loadVaultData(userAddress, provider, chainId, dispatch)` orchestrates the full loading sequence:

1. `loadVaultStrategies()` → `dispatch(setAvailableStrategies(...))` + per-strategy `setStrategyAddress`
2. Get user vault addresses from VaultFactory
3. **First pass:** `getVaultData()` for each vault with `skipMetricsUpdate: true` — dispatches `updateVault`, `addVaultPositions`, `updateVaultTokenBalances`, `updateVaultStrategy`, `updateVaultTrackerData`
4. Get non-vault positions from adapters, filter out any already held in vaults
5. `dispatch(setPositions(walletPositions))` — wallet-only positions, marked `inVault: false`
6. **Prefetch all token prices** at once (batch CoinGecko call, 30s cache)
7. **Second pass:** Calculate TVL for each vault using fetched prices
8. Fetch blacklist + funding-required data from automation service REST endpoints
9. Fetch tracker data for all vaults (parallel)
10. `dispatch(setVaults(completeVaultsData))` — final vault array with finalized metrics

**Single vault refresh:** `getVaultData(vaultAddress, ...)` loads one vault's basic info, token balances, positions, and (optionally) tracker data — used on vault detail navigation and as the per-vault unit inside `loadVaultData`.

---

## SSE Integration

**Source:** `src/hooks/useAutomationEvents.js` (SSE connection + event routing), `src/utils/sseEventHandlers.js` (targeted data fetches)

Connects to `process.env.NEXT_PUBLIC_SSE_URL` (e.g., `http://localhost:3001/events`). Mounted globally via `AutomationEventsHandler` in `_app.js`.

### Targeted SSE Updates

Instead of invalidating freshness timestamps, SSE events trigger **targeted data fetches** that dispatch directly to Redux. No freshness gate — when we know data changed, we fetch only what changed.

| Event | Token Balances | Positions |
|---|---|---|
| `TokensSwapped` | `refreshTokenBalances` | — |
| `NativeWrapped` | `refreshTokenBalances` | — |
| `NativeUnwrapped` | `refreshTokenBalances` | — |
| `NewPositionCreated` | `refreshTokenBalances` | `refreshSinglePosition(isNew: true)` |
| `LiquidityAddedToPosition` | `refreshTokenBalances` | `refreshSinglePosition` |
| `FeesCollected` | `refreshTokenBalances` | `refreshSinglePosition` per positionId |
| `PositionsClosed` | `refreshTokenBalances` | `removePosition` + `updateVaultPositions(remove)` |
| `FeesDistributed` | `refreshTokenBalances` | — |
| `ExecutorFunded` | `refreshTokenBalances` | — |
| `PositionRebalanced` | — | — (covered by PositionsClosed + TokensSwapped + NewPositionCreated) |

**Helpers in `sseEventHandlers.js`:**
- `refreshTokenBalances(vaultAddress, provider, chainId, dispatch)` — calls `loadVaultTokenBalances` from vaultsHelpers
- `refreshSinglePosition(positionId, platform, vaultAddress, provider, chainId, dispatch, isNew)` — calls `adapter.refreshPositionForDisplay`, dispatches `addVaultPositions` (new) or `updatePosition` (existing)
- `processSSEEvent(eventName, data, { provider, chainId, dispatch, getPositions })` — orchestrator that routes events to handlers

**Closure handling:** `useAutomationEvents` uses refs (`providerRef`, `chainIdRef`, `positionsRef`) for stable closure access inside SSE event listeners that are created once in `connect()`.

### Vault State Events (unchanged)

| Event | Vault State Update |
|---|---|
| `VaultFailed` | `isRetrying=true`, `retryError={message, attempts, lastAttempt}` |
| `VaultRecovered` | Clears `isRetrying`, `retryError`, `isBlacklisted` |
| `VaultBlacklisted` | `isBlacklisted=true`, `blacklistReason` |
| `VaultUnblacklisted` | `isBlacklisted=false`, `blacklistReason=null` |
| `ExecutorFundingRequired` | `isFundingRequired=true`, `fundingRequiredAt` |
| `ExecutorFundingCleared` | `isFundingRequired=false`, `fundingRequiredAt=null` |
| `TransactionLogged` | Prepends to `transactionHistory` |

### Automation Service REST Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /blacklist` | Returns `{ [vaultAddress]: { reason, ...metadata } }`. Optional `?vaults=addr1,addr2` filter. |
| `GET /funding-required` | Returns `{ [vaultAddress]: { enteredAt, ...metadata } }`. Optional `?vaults=addr1,addr2` filter. |
| `GET /vault/:address/metadata` | Tracker metadata (baseline, snapshot, aggregates) |
| `GET /vault/:address/transactions` | Transaction history array |

---

## Page Structure

| Route | File | Primary Content |
|---|---|---|
| `/` | `pages/index.js` | Landing page with links to Vaults, Positions, Demo |
| `/vaults` | `pages/vaults.js` | Vault management dashboard |
| `/vault/[address]` | `pages/vault/[address].js` | Vault detail page (positions, token balances, strategy, tracker) |
| `/positions` | `pages/positions.js` | Position management dashboard |
| `/position/[id]` | `pages/position/[id].js` | Position detail page |
| `/demo` | `pages/demo.js` | Showcase page with configurable demo vault address |
| *404 / 500* | `pages/_error.js` | Custom error page with retry button |

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
│   ├── AutomationModal.js              # Enable/disable automation
│   ├── CreateVaultModal.js             # Create new vault
│   ├── TokenDepositModal.js            # Deposit tokens
│   ├── TokenWithdrawModal.js           # Withdraw tokens
│   ├── FundExecutorModal.js            # Top up executor gas (shown when isFundingRequired=true)
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

**Explorer URLs:** Per-chain block-explorer URLs resolved via `getChainConfig()` from fum_library — covers Arbitrum (arbiscan.io), Avalanche (snowtrace.io), Ethereum mainnet (etherscan.io), and local forks.

**Auto-remove:** 5000ms timeout

---

## Key Patterns and Gotchas

1. **Providers in Context / data in Redux** — Provider objects can't be serialized; everything else goes in Redux
2. **readProvider for reads / wallet provider for writes** — Never use the wallet provider for batch reads
3. **Freshness-gated fetching + targeted SSE updates** — Pages check freshness timestamps before fetching. SSE events trigger targeted fetches via `sseEventHandlers.js` that dispatch directly to Redux (no freshness gate for known changes).
4. **Pool/token data embedded in position objects and vault `tokenBalances`** — No separate pools or tokens slice; adapters return position objects with pool state and token metadata already attached, and vault token balances carry full token info (symbol, decimals, logoURI, native flags)
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
