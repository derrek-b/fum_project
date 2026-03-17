<!-- Source: fum_library/src/adapters/PlatformAdapter.js, fum_library/src/adapters/UniswapV3Adapter.js, fum_library/src/adapters/UniswapV4Adapter.js, fum_library/src/adapters/TraderJoeV2_2Adapter.js -->
# Adapter Display Interface — getPositionsForDisplay

## Problem

The frontend fetches position data through adapters but has no consistent interface across platforms:

1. **V3's `getPositions` is the only option** — V4 and TJ don't implement it. The frontend calls `adapter.getPositions()` and crashes on non-V3 adapters with "getPositions is not a function."

2. **`getPositionsForVDS` is too lean for the frontend's needs** — Missing `platform`, `platformName`, `tokenPair`, `fee`, and pre-computed display values (prices, amounts, range status) needed for the frontend.

3. **Platform-specific pool state leaks into the frontend** — PositionCard and the position detail page call adapter methods with cached poolData containing V3-specific fields (`sqrtPriceX96`, `tick`, `ticks`, `feeGrowthGlobal0X128`). TJ uses `activeId`/`binStep` with entirely different fee math. Trying to normalize this into a single Redux shape fights the adapter pattern.

## Design

### `getPositionsForDisplay` on PlatformAdapter base class

Required method on the adapter interface. Signature: `async getPositionsForDisplay(ownerAddress, provider)`. Each adapter fetches positions and computes display-ready values internally, returning a universal shape. The frontend never interprets platform-specific pool state.

**Return shape:**

```javascript
{
  positions: {
    [id]: {
      // Identity (universal)
      id,                   // string — position identifier
      platform,             // string — "uniswapV3", "uniswapV4", "traderjoeV2_2"
      platformName,         // string — "Uniswap V3", "Uniswap V4", "Trader Joe V2.2"
      tokenPair,            // string — "WETH/USDC", "WAVAX/USDC"
      pool,                 // string — canonical pool key (V3: address, V4: poolId, TJ: LBPair address)

      // Computed by adapter from live pool state — numbers, frontend handles formatting
      inRange,              // boolean
      currentPrice,         // number — e.g. 3245.12 (token0/token1 canonical direction)
      priceLower,           // number — lower bound price
      priceUpper,           // number — upper bound price
      token0Amount,         // number — decimal-adjusted, e.g. 1.234567
      token1Amount,         // number — decimal-adjusted
      uncollectedFees0,     // number — decimal-adjusted
      uncollectedFees1,     // number — decimal-adjusted
      fee,                  // number — base fee as percentage, e.g. 0.3, 0.05

      // Platform-specific raw data (opaque to frontend, passed back to adapter for actions)
      platformData: { ... }
    }
  }
}
```

**No poolData in the return shape.** The frontend does not cache pool data. Token metadata is available via `getTokenBySymbol()` from `position.tokenPair`. When an action modal needs live pool state, the parent page fetches it fresh via `adapter.getPoolData(pool, provider)`.

**`platformData` contents (per platform):**

| Platform | Fields |
|---|---|
| V3 | `tickLower`, `tickUpper`, `liquidity`, `feeGrowthInside0LastX128`, `feeGrowthInside1LastX128`, `tokensOwed0`, `tokensOwed1` |
| V4 | `tickLower`, `tickUpper`, `poolKey`, `poolId`, `feeGrowthInside0LastX128`, `feeGrowthInside1LastX128` |
| TJ | `lowerBinId`, `upperBinId`, `binStep`, `depositIds`, `activeId`, `proxyAddress` |

The frontend stores `platformData` in Redux but never reads individual fields from it. It passes the whole object back to the adapter when the user triggers actions (add/remove liquidity, claim fees, close position).

**Key principle:** The adapter does all platform-specific math (price conversion, fee calculation, range check) and returns numbers/booleans the frontend can render directly. The frontend is a pure display layer for position data.

## What This Does NOT Change

- **Automation service** — Continues using `getPositionsForVDS`. No changes to VaultDataService, strategies, or cache structures.
- **Adapter action methods** — `generateAddLiquidityData`, `generateRemoveLiquidityData`, `generateClaimFeesData`, `generateCreatePositionData` are unchanged.
- **Pool discovery** — `getPoolData` and pool selection logic remain unchanged.
