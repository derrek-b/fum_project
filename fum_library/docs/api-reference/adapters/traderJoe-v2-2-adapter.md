<!-- Source: src/adapters/TraderJoeV2_2Adapter.js -->
# TraderJoeV2_2Adapter

The Trader Joe V2.2 Liquidity Book adapter for bin-based concentrated liquidity on Avalanche.

## Overview

Trader Joe V2.2 uses the Liquidity Book (LB) model — a bin-based concentrated-liquidity AMM that is structurally different from Uniswap V3/V4's tick-based model:

- **Bins, not ticks.** Liquidity is distributed across discrete price bins. The currently-trading bin is `activeId`. Price at bin `id` is `(1 + binStep/10000)^(id - 2^23)`.
- **No tick spacing — `binStep`.** Pool granularity is a single `binStep` value (basis points).
- **Token ordering: `tokenX` / `tokenY`.** `tokenX` is the lower-address token (equivalent to Uniswap's `token0`). This adapter exposes `token0`/`token1` in pool metadata for strategy compatibility, but on-chain/SDK calls use `tokenX`/`tokenY`.
- **Per-position `TJPositionProxy`.** FUM's `TJPositionManager` contract clones a minimal proxy (EIP-1167) per position. The proxy holds that position's LBToken balances, giving per-position fee attribution. Positions are **not** ERC-721 NFTs — the tokenId is an internal counter managed by `TJPositionManager`.
- **Off-chain fee math.** LBPair does not expose `unclaimedFees` state; fees are computed off-chain via `LiquidityHelperContract` by comparing cached `lastFeeGrowth` baselines against current pool state.
- **No native pools.** TJ V2.2 uses wrapped native tokens (WAVAX, WETH); the router wraps internally. `supportsNativePools = false` (inherited).

This adapter implements all 29 required `PlatformAdapter` methods. Optional incentive methods inherit the no-op defaults — Trader Joe V2.2 incentive support is not wired in this adapter.

> For the full interface, see [PlatformAdapter API Reference](./platform-adapter.md). This doc focuses on TJ-specific behavior.

## Constructor

```javascript
import { TraderJoeV2_2Adapter } from 'fum_library/adapters';

const adapter = new TraderJoeV2_2Adapter(chainId);
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `chainId` | `number` | Chain ID (`43114` for Avalanche C-Chain, `1338` for Hardhat Avalanche fork) |

> The constructor takes only `chainId`. Providers are passed per-method call.

### Cached Configuration

The constructor caches:
- Platform addresses: `lbFactoryAddress`, `lbRouterAddress`, `lbQuoterAddress`, `positionManagerAddress` (FUM's `TJPositionManager`), `liquidityHelperAddress`
- Chain config from `chainHelpers`
- ABIs from `@traderjoe-xyz/sdk-v2`: `LBPairV21ABI`, `LBRouterV21ABI`, `LBQuoterV21ABI`, `LBFactoryV21ABI`, `LiquidityHelperV2ABI`
- `TJPositionManager` ABI from `fum_library/artifacts`
- ERC20 ABI + interface for approval checks

### Instance Properties

| Property | Type | Value |
|---|---|---|
| `chainId` | `number` | From constructor |
| `platformId` | `string` | `'traderjoeV2_2'` |
| `platformName` | `string` | `'Trader Joe V2.2'` |
| `supportsNativePools` | `boolean` | `false` (inherited — router wraps native internally) |

## Key Data Shapes

### Position (from `getPositionById`, `getPositionsForVDS`)

```javascript
{
  id: "1",                                  // TJPositionManager tokenId (string)
  pool: "0xabc...",                         // LBPair contract address (lowercased)
  proxy: "0xdef...",                        // Per-position EIP-1167 TJPositionProxy
  lowerBinId: 8388600,                      // Lowest bin (min of depositIds)
  upperBinId: 8388616,                      // Highest bin (max of depositIds)
  depositIds: [8388600, 8388601, ...],      // Array of bin IDs the position is deposited in
  liquidityMinted: ["...", "..."],          // LBToken liquidity per depositId (wei strings)
  active: true,                             // TJPositionManager active flag
  createdAt: 1708000000,                    // Unix seconds
  lastUpdated: 1708000000000                // ms
}
```

### Pool Metadata (keyed by LBPair address)

```javascript
{
  [poolAddress]: {
    token0Symbol: "WAVAX",
    token1Symbol: "USDC",
    binStep: 20,                            // Basis points (e.g., 20 = 0.20%)
    platform: "traderjoeV2_2"
  }
}
```

### Pool Data (from `getPoolData`)

```javascript
{
  address: "0xabc...",                      // LBPair address
  activeId: 8388608,                        // Current active bin
  binStep: 20,
  reserveX: "1234567890",                   // Raw wei string
  reserveY: "9876543210",
  tokenX: "0x...",                          // Lowercased (lower-address token)
  tokenY: "0x...",                          // Lowercased (higher-address token)
  feeParameters: {
    baseFactor, filterPeriod, decayPeriod,
    reductionFactor, variableFeeControl,
    protocolShare, maxVolatilityAccumulator
  },
  lastUpdated: 1708000000000
}
```

> `getPoolData` does **not** return `tick`/`sqrtPriceX96` — there is no tick concept in LB. Strategies use `activeId` (+ `binStep` for context) for position evaluation.

### Position Range (from `getPositionRange`)

```javascript
{
  lowerBinId: number,     // activeId - lowerBinOffset
  upperBinId: number,     // activeId + upperBinOffset
  activeBinId: number     // current activeId
}
```

Bin offsets are computed from percentage inputs using `n_bins = ceil(log(1 + p/100) / log(1 + binStep/10000))`.

## Required Methods

All 27 automation + 2 display methods are implemented. The table highlights TJ-specific behavior.

### Position Discovery & Data

| Method | TJ Notes |
|---|---|
| `getPositionsForVDS(address, provider)` | Queries `TJPositionManager.getPositionsByOwner(address)` then `getPosition(tokenId)` per-position. No Graph dependency. |
| `getPositionsForDisplay(ownerAddress, provider)` | Returns display-ready positions with computed prices (derived from `activeId`, `binStep`), bin-range bounds, in-range status, formatted token amounts, and accrued fees in USD. |
| `refreshPositionForDisplay(positionId, provider)` | Single-position refresh. Throws if position not found or has no deposit bins. |
| `getPositionById(tokenId, provider)` | Queries `TJPositionManager.getPosition(tokenId)` → returns position + pool metadata. Throws if the position's `lbPair === AddressZero` (burned/non-existent) or `depositIds.length === 0`. |
| `getPoolData(poolId, provider)` | Queries LBPair for `getActiveId`, `getReserves`, `getBinStep`, `getStaticFeeParameters`, `getTokenX`, `getTokenY` in parallel. |
| `calculateTokenAmounts(position, poolData, token0Data, token1Data, provider)` | Queries per-bin reserves from LBPair using `position.depositIds` and `position.liquidityMinted`. |

### Position Evaluation

| Method | TJ Notes |
|---|---|
| `evaluatePositionRange(position, provider, options?)` | Bin-based: `inRange` = `lowerBinId <= currentBinId <= upperBinId`. Supports `options.swapData.activeId` for the fast path. |
| `getAccruedFeesUSD(position, tokenPrices, provider)` | Uses `LiquidityHelperContract` (off-chain math): fetches position on-chain baselines (`_getPositionOnChainData`), computes `feeShares` and per-bin `feesX`/`feesY` via `_computeFeeShares`. Returns standard shape plus `fees0`/`fees1` (raw totals) and `feeShares` (per-bin, used by `generateClaimFeesData` to avoid refetching). |
| `extractPositionBounds(position)` | Returns `{ lower: position.lowerBinId, upper: position.upperBinId }`. |

### Pool Operations

| Method | TJ Notes |
|---|---|
| `selectBestPool(tokenASymbol, tokenBSymbol, provider, chainId)` | Uses `LBFactory.getAllLBPairs(tokenA, tokenB)` to discover pools (no subgraph). Filters by non-zero liquidity and returns the pool with the highest reserves by USD value. |
| `describePool(pool)` | Format: `"WAVAX/USDC at 0xabc... (binStep: 20, activeId: 8388608)"`. |
| `getPositionRange(poolData, upperPercent, lowerPercent)` | Returns `{ lowerBinId, upperBinId, activeBinId }` using the `binStep`-based bin offset formula. Validates bins stay in the uint24 range (`0..16777215`). |
| `getPoolCurrent(poolData)` | Returns `{ activeId, binStep }` (not a plain number) — the strategy needs `binStep` to convert bin IDs to prices later. Stored as opaque platform-specific state. |
| `sortTokens(token0, token1)` | Lower-address-first (`tokenX` = lower), matching Uniswap conventions. |
| `getOptimalTokenRatio(params)` | Uses `getUniformDistributionFromBinRange(activeId, [lowerBinId, upperBinId])` from `@traderjoe-xyz/sdk-v2`. Ratios derive from bin count distribution, not tick math. |

### Transaction Generation

All `generate*` methods return `{ to, data, value }` objects suitable for `executeVaultTransactions()`.

| Method | TJ Notes |
|---|---|
| `generateClaimFeesData(params)` | Calls `TJPositionManager.claimFees(tokenId, feeShares, …)`. Accepts optional `params.feeData` threaded from strategy to avoid recomputing `feeShares` on-chain. |
| `generateRemoveLiquidityData(params)` | Calls `TJPositionManager.withdraw(tokenId, percentage, …)`. Percentage is a basis-point value (e.g., 10000 = 100%). |
| `generateAddLiquidityData(params)` | Calls `TJPositionManager.addToPosition(tokenId, …)` with uniform bin distribution. |
| `generateCreatePositionData(params)` | Calls `TJPositionManager.createPosition(tokenX, tokenY, binStep, lowerBinId, upperBinId, amountX, amountY, …)` with `getUniformDistributionFromBinRange` output. Slippage and deadline applied at the call. |
| `batchSwapTransactions(swapInstructions, options)` | Uses `LBQuoter` for routing and `LBRouter.swapExactTokensForTokens` / `swapTokensForExactTokens`. No Permit2 — TJ uses direct ERC20 approvals to the LBRouter. |
| `getBestSwapQuote(params)` | Calls `LBQuoter.findBestPathFromAmountIn` / `findBestPathFromAmountOut`. Returns `{ amountIn, amountOut, route, methodParameters? }`. |
| `getRequiredApprovals(operationType, vaultAddress, tokenAddresses, provider)` | For `'swap'`: ERC20 approvals to `LBRouter`. For `'liquidity'`: ERC20 approvals to `TJPositionManager`. |

### Receipt Parsing

| Method | TJ Notes |
|---|---|
| `parseClosureReceipt(receipt, positionMetadata, options?)` | Parses `TJPositionManager.Withdrawn` events to extract principal. Accrued fees (from the same receipt) are parsed via `parseCollectReceipt` or threaded-in metadata. |
| `parseCollectReceipt(receipt, positionMetadata, options?)` | Parses `TJPositionManager.FeesClaimed` events. Collect amounts ARE the fees (no principal to subtract). |
| `parseSwapReceipt(receipt, swapMetadata)` | Parses LBPair `Swap` events (`amountsIn`/`amountsOut` are bytes32 packed [uint128 X, uint128 Y]). |
| `parseIncreaseLiquidityReceipt(receipt, { position, poolData })` | Parses `TJPositionManager.DepositedToBins` / `PositionCreated` events to extract `tokenId`, `liquidity` (summed across bins), `amount0`, `amount1`. For new positions, also includes `tickLower`/`tickUpper` mapped from `lowerBinId`/`upperBinId` and `poolAddress`. |

### Swap Event Monitoring

| Method | TJ Notes |
|---|---|
| `getSwapEventFilter(poolId)` | `poolId` is the LBPair address. Filter is `{ address: lbPairAddress, topics: [SwapTopic] }`. Swaps emit directly from each LBPair (same pattern as V3). |
| `parseSwapEvent(log)` | V2.2 Swap event: `Swap(address sender, address to, uint24 id, bytes32 amountsIn, bytes32 amountsOut, uint24 volatilityAccumulator, bytes32 totalFees, bytes32 protocolFees)`. Returns `{ activeId: number, amountXIn, amountXOut, amountYIn, amountYOut, fees }`. |
| `evaluatePriceMovement(swapData, baseline, token0Data, token1Data)` | Converts bin IDs to prices using `binStep` (stored in `baseline`), then computes percent movement. Handles token0/token1 decimals. |

## Optional Methods (Incentives)

This adapter **inherits the no-op defaults** for all four optional incentive methods. Trader Joe V2.2 supports incentives via LBPair hooks rewarders, but the integration is not wired in this adapter yet. Callers of `getPoolIncentives` will get `{ active: false, programs: [] }`; the three transaction methods return `[]`.

## Error Handling

All methods validate inputs and throw. Typical TJ-specific error messages:

```javascript
try {
  const { position } = await adapter.getPositionById(tokenId, provider);
} catch (error) {
  // Possible errors:
  // - "TokenId parameter is required"
  // - "Valid provider parameter is required"
  // - "No position manager address configured for chainId: X"
  // - "Position 1 not found"
  // - "Position 1 has no deposit bins"
  // - "Failed to fetch position 1: <underlying>"
}

try {
  const range = adapter.getPositionRange(poolData, 5, 5);
} catch (error) {
  // - "poolData.activeId is required"
  // - "poolData.binStep must be a positive finite number"
  // - "upperPercent must be greater than 0 and at most 100"
  // - "Calculated upperBinId (16777216) exceeds maximum (16777215)"
  // - "Invalid bin range: lowerBinId (X) must be less than upperBinId (Y)"
}
```

## Dependencies

- `ethers` v5 — Ethereum library
- `@traderjoe-xyz/sdk-v2` — LB ABIs, `getUniformDistributionFromBinRange`, `Bin` utilities
- `@openzeppelin/contracts` — ERC20 ABI
- `fum_library/artifacts` — `TJPositionManager` ABI

## See Also

- [PlatformAdapter](./platform-adapter.md) — Base class interface (27 automation + 2 display + 4 optional methods)
- [UniswapV3Adapter](./uniswap-v3-adapter.md) — Tick-based concentrated liquidity for comparison
- [UniswapV4Adapter](./uniswap-v4-adapter.md) — V4 singleton architecture
- [AdapterFactory](./adapter-factory.md) — Factory for creating adapters
- [Adapters Architecture](../../architecture/adapters.md) — Data shapes and automation flows
- [Trader Joe V2.2 platform knowledge](../../../../docs/platform-knowledge/) — Protocol quirks and gotchas
