# Frontend Adapter Abstraction

> **Status**: Analysis complete — implementation pending
> **Date**: 2026-03-19 (analysis), 2026-04-16 (re-verified; AddLiquidityModal still uses V3-hardcoded `Pool.getAddress`, `slot0`, `calculatePriceFromSqrtPrice`, `tickToPrice`, `priceToTick`, `getPlatformTickSpacing`)

## Context

The frontend was built when Uniswap V3 was the only supported platform. Now with V4 and Trader Joe V2.2, several adapter methods and properties used in the frontend are V3-specific concepts that don't map cleanly to all platforms. This doc analyzes each call site to determine what needs to be abstracted.

## Inventory of Adapter Calls in Frontend

### Already cross-platform

| Method | Status |
|--------|--------|
| `getPositionsForDisplay()` | Done — implemented on all 3 adapters |
| `getPoolData()` | Done — implemented on all 3 adapters |
| `generateRemoveLiquidityData()` | Done — implemented on all 3 adapters |
| `generateClaimFeesData()` | Done — implemented on all 3 adapters |
| `generateAddLiquidityData()` | Done — implemented on all 3 adapters |
| `generateCreatePositionData()` | Done — implemented on all 3 adapters |

### Needs analysis — methods

| Method | Call Sites | Platform-specific? |
|--------|-----------|-------------------|
| `calculatePriceFromSqrtPrice()` | AddLiquidityModal (2x) | Yes — see below |
| `tickToPrice()` | AddLiquidityModal (3x) | Yes — see below |
| `priceToTick()` | AddLiquidityModal (2x) | Yes — see below |

### Needs analysis — properties

| Property | Call Sites | Platform-specific? |
|----------|-----------|-------------------|
| `adapter.feeTiers` | AddLiquidityModal (validation) | Yes — see below |
| `adapter.addresses.positionManagerAddress` | AddLiquidityModal (2x, approval target) | Yes — see below |

### Needs analysis — raw contract calls in frontend

| Call | Location | Platform-specific? |
|------|----------|-------------------|
| `Pool.getAddress()` (Uniswap V3 SDK) | AddLiquidityModal:636 | V3-only SDK call |
| `poolContract.slot0()` | AddLiquidityModal:672 | V3/V4 pool shape — TJ has no slot0 |
| `poolContract.liquidity()` | AddLiquidityModal:673 | V3/V4 pool shape — TJ different |
| `getPlatformTickSpacing()` | AddLiquidityModal (3x) | Tick concept doesn't exist on TJ |

---

## Detailed Analysis

### 1. `calculatePriceFromSqrtPrice(sqrtPriceX96, baseToken, quoteToken)`

**Where**: AddLiquidityModal lines 342, 682

**Purpose**: Convert the pool's current `sqrtPriceX96` value into a human-readable price for display.

**Why it's platform-specific**: `sqrtPriceX96` is a Uniswap V3/V4 concept. Trader Joe V2.2 uses a `binId` + `binStep` model — the "active bin" determines the current price, and the price formula is `(1 + binStep/10000) ^ (binId - 8388608)`.

**What callers actually need**: The current pool price as a human-readable number. They don't care about sqrtPriceX96 vs binId — they want "ETH is $3,200".

**Abstraction candidate**: `adapter.getCurrentPrice(poolAddress, baseToken, quoteToken, provider)` — returns a price number/object. Each adapter fetches whatever on-chain state it needs internally.

---

### 2. `tickToPrice(tick, baseToken, quoteToken)`

**Where**: AddLiquidityModal lines 849, 850, 1749

**Purpose**:
- Lines 849-850: Verify price range after user sets min/max ticks (debug logging only — "prices calculated for verification only - not currently used")
- Line 1749: Convert a tick to display price for the price range chart / range display

**Why it's platform-specific**: "Ticks" are a Uniswap V3/V4 concept for discrete price points. Trader Joe uses "bins" — similar idea (discrete price buckets) but different math and indexing. The position detail display needs to convert whatever the position's range boundaries are into display prices.

**What callers actually need**: Convert a position's range boundary into a display price. Whether the boundary is stored as a tick or a binId is an internal detail.

**Abstraction candidate**: `adapter.boundaryToPrice(boundary, baseToken, quoteToken)` — accepts a tick (V3/V4) or binId (TJ) and returns a display price. Each adapter knows its own boundary type.

**Note**: The line 849-850 usage is dead debug code and can be removed.

---

### 3. `priceToTick(price, baseToken, quoteToken)`

**Where**: AddLiquidityModal lines 928, 992

**Purpose**: When user types a custom price in the "set range" input, convert it to the nearest valid tick for position creation.

**Why it's platform-specific**: Same tick vs bin issue. User enters a price, and the system needs to find the nearest valid discrete position boundary.

**What callers actually need**: Convert a user-entered price into the nearest valid position boundary. The caller then stores this boundary and passes it to `generateCreatePositionData()`.

**Abstraction candidate**: `adapter.priceToBoundary(price, baseToken, quoteToken)` — returns the nearest valid boundary (tick or binId). The caller also needs aligned boundaries:

```
// Current code after priceToTick:
const poolTickSpacing = getPlatformTickSpacing(selectedPlatform, selectedFeeTier);
const alignedTick = Math.floor(rawTick / poolTickSpacing) * poolTickSpacing;
```

This tick-spacing alignment should move inside the adapter too, since TJ has bin alignment and V3/V4 have tick spacing. So the adapter method returns an already-aligned boundary.

**Abstraction candidate (refined)**: `adapter.priceToBoundary(price, baseToken, quoteToken, poolConfig)` — returns an already-aligned boundary. Removes need for `getPlatformTickSpacing()` in the frontend entirely.

---

### 4. `adapter.feeTiers`

**Where**: AddLiquidityModal line 1557 (validation)

**Purpose**: Validate that the user's selected fee tier is supported before creating a position.

**Why it's platform-specific**: V3 has fixed fee tiers (500, 3000, 10000). V4 has configurable fees per pool (not a fixed set). Trader Joe uses `binStep` instead of fee tiers — the bin step determines both the price granularity and the effective swap fee.

**What callers actually need**: Two things:
1. A list of valid options to present in the fee tier dropdown
2. Validation that the selected option is valid

**Abstraction candidates**:
- For the dropdown: `adapter.getPoolConfigs()` — returns the available pool configurations for position creation. V3 returns fee tiers, TJ returns bin steps, V4 returns whatever it uses.
- For validation: moves into the adapter's `generateCreatePositionData()` — the adapter validates its own config before building the transaction.

**Open question**: Should the UI present these differently per platform? "Fee tier: 0.3%" vs "Bin step: 25" vs something else? Or can we normalize to a single concept like "pool type" with a display label?

---

### 5. `adapter.addresses.positionManagerAddress`

**Where**: AddLiquidityModal lines 1014, 1244

**Purpose**: The ERC20 approval target — tokens must be approved for spending by the position manager before adding liquidity or creating a position.

**Why it's platform-specific**: Each platform has a different contract that needs token approval:
- V3: NonfungiblePositionManager
- V4: PositionManager (different contract)
- TJ: TJPositionManager (our custom contract) or LBRouter

**What callers actually need**: "What address do I approve tokens to?" before calling `generateAddLiquidityData` or `generateCreatePositionData`.

**Abstraction candidate**: `adapter.getApprovalTarget()` — returns the address that needs ERC20 approval. Simple, clear, works for all platforms.

---

### 6. Raw contract calls: `Pool.getAddress()`, `slot0()`, `liquidity()`

**Where**: AddLiquidityModal lines 592-701 (the `fetchPoolPrice` function)

**Purpose**: When user selects two tokens + fee tier for a NEW position, this code:
1. Computes the pool address using `@uniswap/v3-sdk Pool.getAddress()`
2. Reads `slot0()` and `liquidity()` from the pool contract
3. Extracts sqrtPriceX96 and tick from slot0
4. Calls `adapter.calculatePriceFromSqrtPrice()` to get display price
5. Stores `localPoolData` = `{ fee, sqrtPriceX96, liquidity, tick }` for later use in position creation

**Why it's platform-specific**: This entire block is hardcoded V3. The SDK import, the contract ABI, the slot0 shape, the data stored — all V3.

**What callers actually need**: "For these two tokens and this pool config, give me the current pool state and price." The `localPoolData` gets passed to `generateCreatePositionData()` later, so the adapter already knows how to consume it.

**Abstraction candidate**: This whole block should be replaced by something like:
```js
const { price, poolData } = await adapter.getPoolState(token0, token1, poolConfig, provider);
setCurrentPoolPrice(price);
setLocalPoolData(poolData);  // opaque to frontend, passed back to adapter
```

The `poolData` becomes an opaque blob — the frontend stores it and passes it back to `generateCreatePositionData()`. Only the adapter needs to understand its shape.

---

### 7. `getPlatformTickSpacing(selectedPlatform, selectedFeeTier)`

**Where**: AddLiquidityModal lines 827, 931, 995

**Purpose**: After converting price→tick, align the tick to the pool's tick spacing (mandatory for V3/V4).

**Why it's platform-specific**: TJ doesn't have tick spacing. It has bin alignment, but the math is different.

**Abstraction**: Absorbed into `priceToBoundary()` — see item 3 above.

---

## Summary: Proposed Adapter Interface Additions

| New Method | Replaces | Purpose |
|-----------|----------|---------|
| `getCurrentPrice(pool, baseToken, quoteToken, provider)` | `calculatePriceFromSqrtPrice()` on existing positions | Human-readable current price |
| `getPoolState(token0, token1, poolConfig, provider)` | `Pool.getAddress()` + `slot0()` + `liquidity()` + `calculatePriceFromSqrtPrice()` on new positions | Pool lookup + state for position creation |
| `boundaryToPrice(boundary, baseToken, quoteToken)` | `tickToPrice()` | Convert position range boundary to display price |
| `priceToBoundary(price, baseToken, quoteToken, poolConfig)` | `priceToTick()` + `getPlatformTickSpacing()` | Convert user price input to aligned boundary |
| `getApprovalTarget()` | `adapter.addresses.positionManagerAddress` | ERC20 approval address |
| `getPoolConfigs()` | `adapter.feeTiers` | Available pool options for UI dropdown |

### Frontend code to remove after refactor
- `import { Pool } from '@uniswap/v3-sdk'` — no longer needed
- `import { Token } from '@uniswap/sdk-core'` — no longer needed
- `import { getPlatformTickSpacing } from 'fum_library/helpers/platformHelpers'` — absorbed into adapter
- `slot0()` / `liquidity()` raw contract calls — moved into adapter
- `Pool.getAddress()` call — moved into adapter
- Dead debug code at lines 849-854 (`tickToPrice` "verification only" block)

## Open Questions

1. **Pool config UI**: How should the dropdown for pool selection differ per platform? V3 shows fee tiers as percentages; TJ would show bin steps. Should we normalize to a label + value pair returned by `getPoolConfigs()`?

2. **Opaque vs structured poolData**: If `getPoolState()` returns opaque `poolData`, the frontend can't inspect it (e.g., to show "current tick" or "active bin"). Do any frontend components need to read pool state fields directly, or is the price sufficient?

3. **Boundary display**: The price range chart currently works with ticks. Does it need to work with arbitrary boundaries, or can it work purely with prices (converting via `boundaryToPrice` for display)?
