# Frontend Redux Data Freshness Strategy

> **Status**: Ready for implementation
> **Date**: 2026-03-21

## Problem

The frontend makes excessive RPC calls because there's no freshness tracking. Every page mount triggers full re-fetches regardless of data age. Action modals (collect fees, remove liquidity, close position) call `triggerUpdate()` on success, which cascades into full re-fetches of all positions across all platforms and all vaults — even though only one position was affected.

Additionally, the position detail page's refresh path used `setPositions` with the full Redux array, which stripped `inVault`/`vaultAddress` from vault positions and caused duplicates.

## Current State

- **Positions landing page**: Two useEffects fire on every mount — wallet position scan (`getPositionsForDisplay` per adapter per wallet) + vault position scan (`getPositionsForDisplay` per adapter per vault). Every navigation to this page triggers all of these RPC calls.
- **Position detail page**: Was fetching all positions for an owner via `getPositionsForDisplay`, finding one, then dispatching `setPositions` with the entire Redux array. Fixed to use `refreshPositionForDisplay` + `updatePosition` reducer, but still fetches on every mount regardless of data age.
- **Action modals**: Call `dispatch(triggerUpdate())` on success, which changes `lastUpdate` in Redux. Any mounted component with `lastUpdate` in a useEffect dependency array re-fetches everything.
- **PositionSelectionModal**: Already correct — uses `setPositionVaultStatus` to update vault ownership in Redux without RPC calls.

## Position Design

### 1. Add `positionsLastFetched` timestamp to Redux

Add a timestamp to the positions slice that records when the full positions list (wallet + vault) was last fetched. Set it only when the positions landing page completes both its wallet and vault scans.

```js
// positionsSlice.js
initialState: {
  positions: [],
  positionsLastFetched: null   // timestamp set after full load completes
}

// New reducer:
setPositionsLastFetched: (state, action) => {
  state.positionsLastFetched = action.payload;
}
```

### 2. Gate positions landing page fetches with freshness check

PositionContainer checks `positionsLastFetched` before fetching. If data is less than 30 seconds old, skip the fetch — Redux already has current data.

```js
const { positionsLastFetched } = useSelector(state => state.positions);
const isFresh = positionsLastFetched && (Date.now() - positionsLastFetched < 30000);

useEffect(() => {
  if (isFresh) return;  // Skip fetch, Redux data is current
  // ... existing wallet + vault fetch logic
  // After both complete:
  dispatch(setPositionsLastFetched(Date.now()));
}, [isConnected, address, provider, chainId, dispatch]);
```

### 3. Gate position detail page refresh with freshness check

The position detail page already uses `refreshPositionForDisplay` + `updatePosition`. Gate it with the position's own `lastUpdated` timestamp:

```js
useEffect(() => {
  if (!adapter || !provider || !id) return;
  const isStale = !position?.lastUpdated || (Date.now() - position.lastUpdated > 30000);
  if (!isStale) return;

  adapter.refreshPositionForDisplay(id, provider).then(freshPosition => {
    dispatch(updatePosition(freshPosition));
  });
}, [adapter, provider, id, dispatch]);
```

### 4. Refactor action modals to targeted refresh

After successful transactions, replace `dispatch(triggerUpdate())` with a single-position refresh:

```js
// After successful transaction:
const freshPosition = await adapter.refreshPositionForDisplay(position.id, provider);
dispatch(updatePosition(freshPosition));
```

This applies to:
- **ClaimFeesModal** — refresh the position (fees are now zero, amounts unchanged)
- **RemoveLiquidityModal** — refresh the position (amounts changed)
- **ClosePositionModal** — no refresh needed, position is gone. Redirect to source page.

Remove `dispatch(triggerUpdate())` from all three modals.

### 5. Close position: remove from Redux

When a position is closed, it no longer exists on chain. Instead of refreshing (which would fail for a burned NFT), remove it from Redux:

```js
// New reducer:
removePosition: (state, action) => {
  state.positions = state.positions.filter(p => p.id !== action.payload);
}
```

ClosePositionModal dispatches `removePosition(position.id)` then redirects.

## RPC Call Impact

| Action | Before | After |
|--------|--------|-------|
| Navigate to positions page (fresh) | N calls (all adapters × wallet + all vaults) | Same (data is stale, must fetch) |
| Navigate to positions page (within 30s) | N calls | 0 calls |
| Navigate to position detail (fresh) | N calls (all positions for owner) | 1 call (`refreshPositionForDisplay`) |
| Navigate to position detail (within 30s) | N calls | 0 calls |
| Collect fees | N calls (triggerUpdate cascade) | 1 call |
| Remove liquidity | N calls (triggerUpdate cascade) | 1 call |
| Close position | N calls (triggerUpdate cascade) | 0 calls |

---

## Vault Side Design

Same pattern as positions. The vault side has the same excessive RPC problem.

### Current State

- **Vaults landing page** (`VaultsContainer`): Calls `loadVaultData(address, provider, chainId, dispatch)` on every mount. `lastUpdate` in dependency array means every `triggerUpdate()` also re-fetches all vaults.
- **Vault detail page** (`vault/[address].js`): On first load, calls `loadVaultData` (all vaults) + `getVaultData` (this vault). On subsequent mounts/updates, calls `getVaultData` for this specific vault. `lastUpdate` in dependency array triggers re-fetches.
- **Vault data is layered**: metadata, token balances, positions, tracker/automation data — all fetched together on every load.

### Design

### 6. Add `vaultsLastFetched` timestamp to vaults Redux slice

Same pattern as positions — record when the full vault list was last loaded.

```js
// vaultsSlice.js
initialState: {
  userVaults: [],
  vaultsLastFetched: null,  // timestamp set after full load completes
  // ... existing fields
}

// New reducer:
setVaultsLastFetched: (state, action) => {
  state.vaultsLastFetched = action.payload;
}
```

### 7. Gate vaults landing page fetches with freshness check

VaultsContainer checks `vaultsLastFetched` before calling `loadVaultData`. If data is less than 30 seconds old, skip.

```js
const { vaultsLastFetched } = useSelector(state => state.vaults);
const isFresh = vaultsLastFetched && (Date.now() - vaultsLastFetched < 30000);

useEffect(() => {
  if (isFresh) return;
  // ... existing loadVaultData logic
  // After complete:
  dispatch(setVaultsLastFetched(Date.now()));
}, [isConnected, address, isReadReady, chainId]);
```

### 8. Gate vault detail page with per-vault freshness

The vault detail page should only re-fetch this specific vault's data if it's stale. The vaults slice already has granular reducers (`updateVault`, `updateVaultPositions`, `updateVaultTokenBalances`). Each vault object should carry a `lastUpdated` timestamp.

On mount, check the vault's `lastUpdated`:
- If fresh (< 30s): use Redux data, skip fetch
- If stale: call `getVaultData` for just this vault, update Redux with granular reducers

The vault detail page currently calls `loadVaultData` (all vaults) on first load when the vault isn't in Redux yet (line 129-140). This should be replaced — if the vault isn't in Redux, fetch just this vault via `getVaultData`, not all vaults.

### 8b. Parallelize token balance and position loading in `getVaultData`

`getVaultData` currently loads token balances (step 3) and positions (step 4) sequentially. They're independent of each other — both only depend on the basic vault info from steps 1-2. Run them in parallel with `Promise.all` for faster load time. Both results are needed before the metrics calculation, so await both before dispatching metrics.

```js
// Before: sequential
const tokenResult = await loadVaultTokenBalances(...);
const positionsResult = await loadVaultPositions(...);

// After: parallel
const [tokenResult, positionsResult] = await Promise.all([
  loadVaultTokenBalances(...),
  loadVaultPositions(...)
]);
```

Each dispatches its own Redux update independently (`updateVaultTokenBalances`, `addVaultPositions`), so the UI updates incrementally as each completes. The metrics dispatch happens after both resolve.

### 9. Vault action modals — targeted updates

Vault-side actions should update the specific vault in Redux rather than triggering full re-fetches. The vaults slice already has granular reducers. Each modal/component needs specific changes:

**TokenDepositModal / TokenWithdrawModal**: Currently call `onTokensUpdated()` → `loadVaultTokenBalances(..., silent: true)` which does NOT dispatch to Redux. After a deposit/withdrawal, token balances in Redux are stale. Fix: dispatch `updateVaultTokenBalances` after success.

**FundExecutorModal**: Calls `triggerUpdate()` on success. Only executor balance changed. Fix: dispatch `updateVault` with updated executor state, remove `triggerUpdate()`.

**StrategyConfigPanel**: Has 4 `triggerUpdate()` calls across activation/deactivation paths. Already does targeted `updateVault()` and `updateVaultStrategy()` dispatches — the `triggerUpdate()` after those is redundant. Fix: remove all `triggerUpdate()` calls.

**PositionSelectionModal**: Currently dispatches 3 separate actions across 2 slices (`setPositionVaultStatus` on positionsSlice, `addPositionToVault`/`removePositionFromVault` on vaultsSlice) plus `triggerUpdate()` at 3 locations. Fix: see step 10 below for cross-slice action consolidation. Token balances don't change when a position NFT is transferred — only the vault's position list changes. Remove `triggerUpdate()`.

**AutomationModal** (enable/disable automation): Already dispatches `updateVault()` with executor address. No `triggerUpdate()` — already correct.

### 10. Consolidate cross-slice vault/position transfer actions

Currently, transferring a position to/from a vault requires 3 separate dispatches:
- `setPositionVaultStatus({ positionId, inVault, vaultAddress })` — positionsSlice
- `addPositionToVault({ vaultAddress, positionId })` — vaultsSlice
- `removePositionFromVault({ vaultAddress, positionId })` — vaultsSlice

These should be consolidated into two shared actions using Redux Toolkit's `extraReducers` pattern — both slices listen for the same action and each handles its part:

```js
// Shared actions (defined outside both slices)
const transferPositionToVault = createAction('positions/transferToVault');
const transferPositionFromVault = createAction('positions/transferFromVault');

// Payload: { positionId, vaultAddress }
```

**positionsSlice** `extraReducers`:
- `transferPositionToVault`: set `inVault: true, vaultAddress` on the position
- `transferPositionFromVault`: set `inVault: false, vaultAddress: null` on the position

**vaultsSlice** `extraReducers`:
- `transferPositionToVault`: add positionId to vault's positions array
- `transferPositionFromVault`: remove positionId from vault's positions array

One dispatch, two slices updated atomically. Eliminates the risk of dispatching one action but forgetting the other, and simplifies the PositionSelectionModal from 3 dispatches to 1.

Remove `setPositionVaultStatus`, `addPositionToVault`, and `removePositionFromVault` after migration.

---

## RPC Call Impact (Combined)

### Positions

| Action | Before | After |
|--------|--------|-------|
| Navigate to positions page (fresh) | N calls (all adapters × wallet + all vaults) | Same (data is stale, must fetch) |
| Navigate to positions page (within 30s) | N calls | 0 calls |
| Navigate to position detail (fresh) | N calls (all positions for owner) | 1 call (`refreshPositionForDisplay`) |
| Navigate to position detail (within 30s) | N calls | 0 calls |
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
| Vault action (deposit/withdraw/config) | Full re-fetch via triggerUpdate | Targeted vault refresh |

---

## SSE Event Handling

`useAutomationEvents.js` listens for automation service events via SSE. Currently, 6 event types trigger `dispatch(triggerUpdate())`, cascading into full re-fetches of everything. Each event carries enough data to do a targeted update instead.

### 12. Replace SSE `triggerUpdate()` with targeted dispatches

| SSE Event | Current | After |
|-----------|---------|-------|
| `NewPositionCreated` | `triggerUpdate()` → full re-fetch | `refreshPositionForDisplay` for new position + `updatePosition` (or add to Redux if not present) |
| `PositionsClosed` | `triggerUpdate()` → full re-fetch | `removePosition` for each closed position ID |
| `LiquidityAddedToPosition` | `triggerUpdate()` → full re-fetch | `refreshPositionForDisplay` for affected position + `updatePosition` |
| `FeesCollected` | `triggerUpdate()` → full re-fetch | `refreshPositionForDisplay` for affected position + `updatePosition` |
| `TokensSwapped` | `triggerUpdate()` → full re-fetch | Refresh affected vault's token balances only |
| `VaultUnrecoverable` | `triggerUpdate()` → full re-fetch | Update vault status only — no position refresh needed |
| `ExecutorFundingRequired` | `triggerUpdate()` → full re-fetch | Update vault funding status only — no position refresh needed |

Each SSE event payload includes the affected vault address and/or position ID — the data needed for targeted updates is already available.

---

## Auto-Refresh and Manual Refresh

### 11. Auto-refresh (`_app.js`) — page-contextual

Auto-refresh currently fires `triggerUpdate()` every 30 seconds regardless of which page is active. After refactor, auto-refresh should only refresh data relevant to the current page:

| Active Page | Auto-refresh action |
|-------------|-------------------|
| Position detail | `refreshPositionForDisplay(id)` + `updatePosition` |
| Positions landing | Full wallet + vault position scan |
| Vault detail | `getVaultData(address)` + granular vault update |
| Vaults landing | Full `loadVaultData` |

Each page registers what "refresh" means for its context. The auto-refresh interval calls whatever the current page needs — no wasted RPC calls on data the user isn't looking at.

Navigating away from a page where auto-refresh only updated one item (e.g., position detail) to a landing page is handled by the freshness timestamps — `positionsLastFetched` will be stale, triggering a full fetch on the landing page.

**Behavior:**
- **Enabling auto-refresh**: triggers an immediate contextual refresh (bypasses freshness timestamps). The user explicitly wants fresh data — honor that even if data was just fetched moments ago.
- **Subsequent ticks**: 30-second cadence. Each tick updates the relevant freshness timestamps.
- **Disabling auto-refresh**: stops the interval. No timestamp reset — data naturally ages until the next page mount or manual refresh.

### 12. Manual refresh button (`RefreshControls.js`)

Manual refresh invalidates freshness timestamps (`positionsLastFetched` and `vaultsLastFetched` set to `null`) and triggers the current page's contextual refresh. No `triggerUpdate()` needed.

### Eliminating `lastUpdate` / `triggerUpdate`

With freshness gating in place, `lastUpdate` in `updateSlice` is no longer needed as a dependency in useEffect arrays. All re-fetch triggers are replaced by either:
- Freshness timestamps (page mounts check staleness)
- Direct refresh calls (modals call `refreshPositionForDisplay`, auto-refresh calls page-contextual refresh)
- Timestamp invalidation (manual refresh sets timestamps to `null`)

`triggerUpdate()` and `lastUpdate` should be removed from `updateSlice` once all consumers are migrated. The `updateSlice` can retain `resourcesUpdating` and `autoRefresh` state.

---

## Direct URL Navigation

### 13. Position detail page via direct URL

If a user navigates directly to `/position/123` (bookmark, shared link), the position may not exist in Redux. The position detail page should:

1. Check if position exists in Redux
2. If yes + fresh: use it
3. If yes + stale: `refreshPositionForDisplay` + `updatePosition`
4. If no: `refreshPositionForDisplay` + add to Redux via a new `addPosition` reducer

This single-position fetch does NOT set `positionsLastFetched` — it doesn't represent a full list load. Navigating to the positions landing page after this will still trigger a full fetch (since `positionsLastFetched` is null or stale).

Same pattern applies to vault detail pages via direct URL — fetch just that vault, don't set `vaultsLastFetched`.

---

## RPC Call Impact (Combined)

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
| VaultUnrecoverable | N calls (full re-fetch) | 0 calls (status update) |
| ExecutorFundingRequired | N calls (full re-fetch) | 0 calls (status update) |

## Implementation Order

### Positions (steps 1-6)
1. Add `positionsLastFetched`, `removePosition`, and `addPosition` to positionsSlice
2. Gate PositionContainer fetches with freshness check, set timestamp after load
3. Gate position detail page refresh with freshness check; handle direct URL navigation
4. Refactor ClaimFeesModal — `refreshPositionForDisplay` + `updatePosition`, remove `triggerUpdate`
5. Refactor RemoveLiquidityModal — same pattern
6. Refactor ClosePositionModal — `removePosition` + redirect, remove `triggerUpdate`

### Vaults (steps 7-11)
7. Add `vaultsLastFetched` and `setVaultsLastFetched` to vaultsSlice
8. Gate VaultsContainer fetches with freshness check, set timestamp after load
9. Gate vault detail page with per-vault freshness; handle direct URL navigation; remove `loadVaultData` (all vaults) call on detail page
10. Consolidate cross-slice actions — create `transferPositionToVault` / `transferPositionFromVault` shared actions, add `extraReducers` to both slices, remove old `setPositionVaultStatus` / `addPositionToVault` / `removePositionFromVault`
11. Refactor vault action modals — TokenDeposit/Withdraw: dispatch `updateVaultTokenBalances`; FundExecutor: targeted `updateVault`, remove `triggerUpdate`; StrategyConfigPanel: remove 4 `triggerUpdate` calls; PositionSelectionModal: use new consolidated transfer actions, remove 3 `triggerUpdate` calls

### SSE & Refresh (steps 12-15)
12. Refactor `useAutomationEvents.js` — replace `triggerUpdate` with targeted dispatches per event type
13. Refactor auto-refresh — page-contextual, immediate on enable, respect freshness on subsequent ticks
14. Refactor manual refresh — invalidate freshness timestamps, call page-contextual refresh
15. Remove `triggerUpdate` and `lastUpdate` from `updateSlice`; remove `lastUpdate` from all useEffect dependency arrays

## Files to Modify

### Positions
| File | Change |
|------|--------|
| `fum/src/redux/positionsSlice.js` | Add `positionsLastFetched`, `setPositionsLastFetched`, `removePosition`, `addPosition` |
| `fum/src/components/positions/PositionContainer.js` | Gate fetches with freshness check, set timestamp after load |
| `fum/src/pages/position/[id].js` | Gate refresh with position `lastUpdated` check; handle direct URL (position not in Redux) |
| `fum/src/components/positions/ClaimFeesModal.js` | Replace `triggerUpdate` with `refreshPositionForDisplay` + `updatePosition` |
| `fum/src/components/positions/RemoveLiquidityModal.js` | Same |
| `fum/src/components/positions/ClosePositionModal.js` | Replace `triggerUpdate` with `removePosition` + redirect |

### Vaults
| File | Change |
|------|--------|
| `fum/src/redux/vaultsSlice.js` | Add `vaultsLastFetched`, `setVaultsLastFetched`; add `extraReducers` for `transferPositionToVault`/`transferPositionFromVault`; remove `addPositionToVault`, `removePositionFromVault` |
| `fum/src/redux/positionsSlice.js` | Add `extraReducers` for `transferPositionToVault`/`transferPositionFromVault`; remove `setPositionVaultStatus` |
| `fum/src/redux/vaultPositionActions.js` (new) | Shared `createAction` definitions for `transferPositionToVault`, `transferPositionFromVault` |
| `fum/src/utils/vaultsHelpers.js` | Parallelize token balance + position loading in `getVaultData` |
| `fum/src/components/vaults/VaultsContainer.js` | Gate fetches with freshness check, set timestamp after load |
| `fum/src/pages/vault/[address].js` | Gate with per-vault freshness; handle direct URL; remove full `loadVaultData` on detail page |
| `fum/src/components/vaults/TokenDepositModal.js` | Dispatch `updateVaultTokenBalances` after success (currently silent) |
| `fum/src/components/vaults/TokenWithdrawModal.js` | Same |
| `fum/src/components/vaults/FundExecutorModal.js` | Targeted `updateVault`, remove `triggerUpdate` |
| `fum/src/components/vaults/StrategyConfigPanel.js` | Remove 4 `triggerUpdate` calls (targeted dispatches already in place) |
| `fum/src/components/vaults/PositionSelectionModal.js` | Use `transferPositionToVault`/`transferPositionFromVault` (replaces 3 dispatches with 1); remove 3 `triggerUpdate` calls |

### SSE & Refresh
| File | Change |
|------|--------|
| `fum/src/hooks/useAutomationEvents.js` | Replace `triggerUpdate` with targeted dispatches per SSE event type |
| `fum/src/pages/_app.js` | Auto-refresh: page-contextual, remove `triggerUpdate` |
| `fum/src/components/common/RefreshControls.js` | Manual refresh: invalidate freshness timestamps, call page-contextual refresh |
| `fum/src/redux/updateSlice.js` | Remove `triggerUpdate` and `lastUpdate`; retain `resourcesUpdating`, `autoRefresh` |
