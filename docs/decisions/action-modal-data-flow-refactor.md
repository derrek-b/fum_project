# Action Modal Data Flow Refactor

> **Status**: Complete
> **Date**: 2026-03-19 (design), 2026-03-20 (implementation)

## Summary

Refactored ClaimFeesModal, RemoveLiquidityModal, and ClosePositionModal to be platform-agnostic. Previously, modals received platform-specific data as props from the position detail page and made V3-specific adapter calls. Now each modal manages its own data via the `useModalData` hook and passes a uniform set of params to adapter `generate*Data` calls.

AddLiquidityModal was intentionally excluded — it requires a complete component-level redesign (see `addLiquidityModal-redesign-refactor.md`).

## Design Principle: Adapter Self-Sufficiency

All three adapters' `generate*Data` functions can resolve everything they need from `position` + `poolData` + `provider`. Callers can optionally pass extra data as performance hints (the automation service does this), but the functions work without them.

- **V3**: Resolves token addresses/decimals/native status internally via `nftManager.positions()` + `getTokenByAddress()` when not provided
- **V4**: Falls back to `position.poolKey` when `poolData.poolKey` is absent (poolId is a one-way hash, so `getPoolData` can't return poolKey)
- **TJ**: Already self-sufficient — fetches everything from LBPair contract

The automation service is unaffected — it keeps passing all data as before and fallback paths are never hit.

## `useModalData` Hook

**File**: `fum/src/hooks/useModalData.js`

```js
useModalData(adapter, position, provider, isVisible)
// Returns: { poolData, positionForAdapter, isLoading }
```

- **On modal open**: fetches fresh `poolData` via `adapter.getPoolData()`, checks position freshness (re-fetches via `adapter.refreshPositionForDisplay()` if > 30s old)
- **While open**: 30-second auto-refresh interval for both poolData and position display data
- **On close**: clears interval, resets state
- **Flatten**: spreads `position.platformData` onto root (`{ ...position, ...position.platformData, active: true }`) — returned as `positionForAdapter`
- **Display values** (`token0Amount`, `uncollectedFees0`, `fee`, `tokenPair`) live on `positionForAdapter` — token symbols via `tokenPair.split('/')`

## `refreshPositionForDisplay`

Added to all 3 adapters (V3, V4, TJ) and the `PlatformAdapter` base class. Returns the same per-position shape as `getPositionsForDisplay` for a single position, without re-fetching all positions for the owner.

```js
adapter.refreshPositionForDisplay(positionId, provider)
```

## What Changed

| Area | Change |
|------|--------|
| **TJ `getPositionsForDisplay`** | Added `liquidityMinted` to `platformData`. Fixed `fee` formula to return percentage value consistent with V3/V4 (`* 100`). |
| **V4 adapter** | `generateClaimFeesData` + `generateRemoveLiquidityData` fall back to `position.poolKey` when `poolData.poolKey` absent |
| **V3 adapter** | `generateClaimFeesData` + `generateRemoveLiquidityData` resolve token data internally when not provided |
| **All adapters** | New `refreshPositionForDisplay(positionId, provider)` method |
| **`useModalData` hook** | New shared hook for modal data management (30s refresh, flatten, loading state) |
| **Position detail page** | Removed premature `fetchPoolData` useEffect, removed `modalPoolData`/`modalToken0Data`/`modalToken1Data` state, simplified modal props to `{ show, onHide, position, tokenPrices }` |
| **3 action modals** | Use `useModalData` hook, flat display data, simplified adapter calls, fixed fee display (`position.fee` directly), token symbols from `tokenPair` |
