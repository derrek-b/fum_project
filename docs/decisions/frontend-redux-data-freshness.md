# Frontend Redux Data Freshness Strategy

## Problem

The frontend previously made excessive RPC calls because there was no freshness tracking. Every page mount triggered full re-fetches regardless of data age. Action modals called `triggerUpdate()` on success, which cascaded into full re-fetches of all positions across all platforms and all vaults — even though only one position was affected.

## Solution: Freshness-Gated Fetching + Targeted Updates

### Freshness Timestamps

Each data domain has its own freshness timestamp in Redux:

- `positionsLastFetched` (positionsSlice) — set after full wallet + vault position scan
- `vaultsLastFetched` (vaultsSlice) — set after full vault list load
- `vault.lastUpdated` (per-vault) — set after individual vault data load

Pages check freshness before fetching. If data is <30s old, skip the fetch and use Redux data. This prevents redundant RPC calls on page navigation within the same session.

### Targeted Updates (Not Full Re-fetches)

After successful transactions, modals and event handlers update only the affected data:

- **ClaimFeesModal / RemoveLiquidityModal** — `refreshPositionForDisplay` for the single position
- **ClosePositionModal** — `removePosition` from Redux (no RPC needed — position is gone)
- **PositionSelectionModal** — cross-slice `transferPositionToVault` / `transferPositionFromVault` (single dispatch updates both positionsSlice and vaultsSlice via `extraReducers`)
- **Token deposit/withdraw** — `loadVaultTokenBalances` for just the affected vault

### Targeted SSE Updates

SSE events from the automation service trigger targeted data fetches via `sseEventHandlers.js`, not freshness invalidation. Each event fetches only what changed:

| Event | Token Balances | Positions |
|---|---|---|
| `TokensSwapped` | `refreshTokenBalances` | — |
| `NativeWrapped` / `NativeUnwrapped` | `refreshTokenBalances` | — |
| `NewPositionCreated` | `refreshTokenBalances` | `refreshSinglePosition(isNew: true)` |
| `LiquidityAddedToPosition` | `refreshTokenBalances` | `refreshSinglePosition` |
| `FeesCollected` | `refreshTokenBalances` | `refreshSinglePosition` per positionId |
| `PositionsClosed` | `refreshTokenBalances` | `removePosition` per closed position |
| `PositionRebalanced` | — | — (covered by component events above) |

### Auto-Refresh and Manual Refresh

- **Auto-refresh** (30s interval, toggleable) — invalidates freshness timestamps, triggering re-fetch on next render
- **Manual refresh** — same: invalidates freshness timestamps
- Neither uses the old `triggerUpdate` / `lastUpdate` cascade

### Cross-Slice Position Transfers

Transferring positions to/from vaults uses shared actions (`vaultPositionActions.js`) that both slices listen for via `extraReducers`. One dispatch atomically updates the position's `inVault`/`vaultAddress` in positionsSlice and the vault's `positions` array in vaultsSlice.

### Vault Detail Page Hydration

When navigating from the vaults list to a vault detail page, the detail page checks if `vaultFromRedux` has fresh data (set by VaultsContainer). If fresh, it hydrates local state from Redux without making any RPC calls. Token balances and positions load in parallel via `Promise.all` when a fetch is needed.

## RPC Call Impact

### Positions

| Action | Before | After |
|--------|--------|-------|
| Navigate to positions page (fresh) | N calls (all adapters × wallet + all vaults) | Same (data is stale, must fetch) |
| Navigate to positions page (within 30s) | N calls | 0 calls |
| Navigate to position detail (fresh) | N calls (all positions for owner) | 1 call (`refreshPositionForDisplay`) |
| Navigate to position detail (within 30s) | N calls | 0 calls |
| Position detail via direct URL | N calls (all positions for owner) | 1 call |
| Collect fees | N calls (triggerUpdate cascade) | 1 call |
| Remove liquidity | N calls (triggerUpdate cascade) | 1 call |
| Close position | N calls (triggerUpdate cascade) | 0 calls |

### Vaults

| Action | Before | After |
|--------|--------|-------|
| Navigate to vaults page (fresh) | Full vault load (all vaults + positions + balances) | Same (data is stale, must fetch) |
| Navigate to vaults page (within 30s) | Full vault load | 0 calls |
| Navigate to vault detail (fresh) | `loadVaultData` (all vaults) + `getVaultData` (this vault) | `getVaultData` (this vault only) |
| Navigate to vault detail (within 30s) | Same full load | 0 calls |
| Vault detail via direct URL | Full vault load + this vault | This vault only |
| Vault action (deposit/withdraw/config) | Full re-fetch via triggerUpdate | Targeted vault refresh |

### SSE Events

| Event | Before | After |
|-------|--------|-------|
| NewPositionCreated | N calls (full re-fetch) | 1 call (single position) |
| PositionsClosed | N calls (full re-fetch) | 0 calls (remove from Redux) |
| FeesCollected | N calls (full re-fetch) | 1 call (single position) |
| LiquidityAddedToPosition | N calls (full re-fetch) | 1 call (single position) |
| TokensSwapped | N calls (full re-fetch) | 1 call (vault balances only) |
