<!-- Source: src/adapters/UniswapV3Adapter.js -->
# UniswapV3Adapter

The Uniswap V3 protocol adapter for concentrated-liquidity pool integration.

## Overview

This adapter implements all 29 required `PlatformAdapter` methods (27 automation + 2 frontend display) for Uniswap V3. It handles pool/position data fetching, tick and price math, transaction encoding for swaps and liquidity operations, and optimal routing via `AlphaRouter`. Most internal helpers are underscore-prefixed (`_getPoolAddress`, `_fetchPoolData`, `_getSwapRoute`, etc.); only the methods listed below are part of the public surface.

The adapter is single-chain: construct one per chain. All configuration (platform addresses, fee tiers, tick bounds, ABIs, AlphaRouter) is cached during construction.

> For the full `PlatformAdapter` interface, see [PlatformAdapter API Reference](./platform-adapter.md). This doc covers V3-specific behavior, V3-only public methods, and tick/price conventions.

## Constructor

```javascript
import { UniswapV3Adapter } from 'fum_library/adapters';

const adapter = new UniswapV3Adapter(chainId);
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `chainId` | `number` | Chain ID for the adapter (e.g., `42161` for Arbitrum, `1337` for Hardhat Arbitrum fork) |

> The constructor takes only `chainId`. Providers are passed per-method call.

### Cached Configuration

The constructor caches:
- Platform contract addresses (`factoryAddress`, `positionManagerAddress`, `routerAddress`, `universalRouterAddress`, `quoterAddress`) from chain config
- Supported fee tiers (`100`, `500`, `3000`, `10000`) with tick spacings
- Platform tick bounds (`minTick`/`maxTick`)
- Pre-compiled `ethers.utils.Interface` instances for each contract ABI
- An `AlphaRouter` instance for optimal swap routing (with fork-specific overrides when `chainId === 1337`)

### Instance Properties

| Property | Type | Value |
|---|---|---|
| `chainId` | `number` | From constructor |
| `platformId` | `string` | `'uniswapV3'` |
| `platformName` | `string` | `'Uniswap V3'` |
| `supportsNativePools` | `boolean` | `true` (inherited override — V3 pools can use native ETH flows via the Universal Router) |

### Hardhat Fork Handling

When `chainId === 1337`, the constructor configures `AlphaRouter` with:
- `localRpcUrl = http://localhost:8545` (from `getChainRpcUrls(1337)`)
- `alphaRouterChainId = 42161` so Uniswap contract addresses resolve correctly
- `StaticV3SubgraphProvider` for on-chain pool discovery (no mainnet subgraph dependency)
- `StaticGasPriceProvider` with a fixed gas price (avoids calling `ArbGasInfo`)
- Stubbed `arbitrumGasDataProvider` to avoid division-by-zero in the AlphaRouter gas model

## Required Methods

All 29 required `PlatformAdapter` methods are implemented. See [PlatformAdapter API Reference](./platform-adapter.md) for signatures, parameters, and return shapes. V3-specific notes:

### Position Discovery & Data

| Method | V3 Notes |
|---|---|
| `getPositionsForVDS(address, provider)` | Enumerates positions via `NonfungiblePositionManager.balanceOf` + `tokenOfOwnerByIndex`, filters out positions with zero liquidity, and groups by pool for efficient tick data fetches. |
| `getPositionsForDisplay(ownerAddress, provider)` | Returns display-ready shape (prices, formatted amounts, in-range booleans) for the frontend. |
| `refreshPositionForDisplay(positionId, provider)` | Single-position refresh. Throws if position has zero liquidity or has been burned. |
| `getPositionById(tokenId, provider)` | Queries `NonfungiblePositionManager.positions(tokenId)` directly (no subgraph). Returns position + pool metadata. |
| `getPoolData(poolAddress, provider)` | Queries the pool's `slot0()`, `liquidity()`, `feeGrowthGlobal0X128()`, `feeGrowthGlobal1X128()`, plus the full `slot0` tuple (observation index/cardinality, feeProtocol, unlocked). |
| `calculateTokenAmounts(position, poolData, token0Data, token1Data, provider)` | Uses the V3 SDK's `Position` class with `SqrtPriceMath`/`TickMath` to compute amounts at current price. |

### Position Evaluation

| Method | V3 Notes |
|---|---|
| `evaluatePositionRange(position, provider, options?)` | Tick-based range check. Fast path via `options.swapData.tick` bypasses RPC. |
| `getAccruedFeesUSD(position, tokenPrices, provider)` | Fetches per-tick `feeGrowthOutside` values and computes fees using standard V3 formula. |
| `extractPositionBounds(position)` | Returns `{ lower: tickLower, upper: tickUpper }`. |

### Pool Operations

| Method | V3 Notes |
|---|---|
| `selectBestPool(tokenASymbol, tokenBSymbol, provider, chainId)` | Probes all configured fee tiers (100, 500, 3000, 10000) via the factory, filters pools with zero liquidity, and returns the deepest pool. |
| `describePool(pool)` | Format: `"WETH/USDC 0.05% (tick: -276250, liquidity: 1.2M)"`. |
| `getPositionRange(poolData, upperPercent, lowerPercent)` | Returns `{ tickLower, tickUpper, currentTick }` aligned to the fee tier's tick spacing. |
| `getPoolCurrent(poolData)` | Returns `poolData.tick` (for baseline tracking). |
| `sortTokens(token0, token1)` | Lower-address-first (Uniswap canonical ordering). |
| `getOptimalTokenRatio(params)` | Tick-range math via the V3 SDK `Position` class. |

### Transaction Generation

| Method | V3 Notes |
|---|---|
| `generateClaimFeesData(params)` | Calls `NonfungiblePositionManager.collect`. |
| `generateRemoveLiquidityData(params)` | Calls `NonfungiblePositionManager.decreaseLiquidity` + `collect`. Accepts an optional `burnToken` flag to also call `burn` when removing 100%. |
| `generateAddLiquidityData(params)` | Calls `NonfungiblePositionManager.increaseLiquidity`. Returns `{ to, data, value, quote }`. |
| `generateCreatePositionData(params)` | Calls `NonfungiblePositionManager.mint`. Returns `{ to, data, value, quote }`. |
| `batchSwapTransactions(swapInstructions, options)` | Uses AlphaRouter + Universal Router with Permit2. Handles per-swap Permit2 nonce tracking. |
| `getBestSwapQuote(params)` | Uses AlphaRouter for optimal routing across V2/V3 pools. Supports `EXACT_INPUT` and `EXACT_OUTPUT`. |
| `getRequiredApprovals(operationType, vaultAddress, tokenAddresses, provider)` | For `'liquidity'`: ERC20 approvals to `NonfungiblePositionManager`. For `'swap'`: ERC20 approvals to Permit2 (Universal Router pulls via Permit2). |

### Receipt Parsing

| Method | V3 Notes |
|---|---|
| `parseClosureReceipt(receipt, positionMetadata, options?)` | Parses `DecreaseLiquidity` + `Collect` events, subtracts principal from collect amounts to isolate fees. |
| `parseCollectReceipt(receipt, positionMetadata, options?)` | Parses `Collect` events directly — amounts ARE the fees (no principal to subtract). |
| `parseSwapReceipt(receipt, swapMetadata)` | Parses `Swap` events from V2/V3 pools emitted during Universal Router execution. |
| `parseIncreaseLiquidityReceipt(receipt, { position, poolData })` | Parses `IncreaseLiquidity` event for existing positions or `IncreaseLiquidity` + pool info for new positions. |

### Swap Event Monitoring

| Method | V3 Notes |
|---|---|
| `getSwapEventFilter(poolId)` | V3 `Swap` events emit from each pool. Filter is `{ address: poolAddress, topics: [SwapTopic] }`. |
| `parseSwapEvent(log)` | V3 `Swap(address sender, address recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)`. |
| `evaluatePriceMovement(swapData, baseline, token0Data, token1Data)` | Converts ticks to prices via the V3 SDK, computes percent movement. |

## V3-Specific Public Methods

These methods are on the adapter instance but are V3-only (not part of the platform-agnostic interface). They are genuinely public — some tests and other callers use them directly.

### isPositionInRange(currentTick, tickLower, tickUpper)

> **V3-specific utility.** For the platform-agnostic interface method with distance metrics, use `evaluatePositionRange()` from the base class.

Simple boolean check: `tickLower <= currentTick < tickUpper` (upper bound exclusive, per Uniswap V3's `[tickLower, tickUpper)` fee-accumulator semantics — see `Tick.getFeeGrowthInside` in `Uniswap/v3-core`).

```javascript
const inRange = adapter.isPositionInRange(currentTick, tickLower, tickUpper);
```

**Returns:** `boolean`

---

### calculatePriceFromSqrtPrice(sqrtPriceX96, baseToken, quoteToken)

Calculate a price from a `sqrtPriceX96` using the Uniswap V3 SDK.

```javascript
const price = adapter.calculatePriceFromSqrtPrice(
  sqrtPriceX96,
  baseToken,    // { address, decimals }
  quoteToken    // { address, decimals }
);

console.log(price.toFixed(6));       // Fixed decimal string
console.log(price.toSignificant(6)); // Significant figures
```

**Returns:** Uniswap SDK `Price` object.

---

### tickToPrice(tick, baseToken, quoteToken)

Convert a tick value to a price.

```javascript
const price = adapter.tickToPrice(tick, baseToken, quoteToken);
```

**Returns:** Uniswap SDK `Price` object.

---

### priceToTick(price, baseToken, quoteToken)

Convert a human-readable price to the closest valid tick.

```javascript
const tick = adapter.priceToTick(price, baseToken, quoteToken);
```

**Returns:** `number`

---

### calculateUncollectedFees(position, poolData)

Calculate uncollected fees for a position as raw token amounts.

```javascript
const [fees0, fees1] = adapter.calculateUncollectedFees(position, poolData);
// Returns [bigint, bigint]
```

#### Position Object

| Property | Type | Description |
|----------|------|-------------|
| `liquidity` | `string` | Position liquidity |
| `feeGrowthInside0LastX128` | `string` | Fee growth inside at last action |
| `feeGrowthInside1LastX128` | `string` | Fee growth inside at last action |
| `tickLower` | `number` | Lower tick |
| `tickUpper` | `number` | Upper tick |
| `tokensOwed0` | `string` | Already accumulated fees for token0 |
| `tokensOwed1` | `string` | Already accumulated fees for token1 |

#### Pool Data Requirements

- `tick: number` — Current pool tick
- `feeGrowthGlobal0X128: string` — Global fee growth
- `feeGrowthGlobal1X128: string` — Global fee growth
- `ticks[tickLower]` — Lower tick data with `feeGrowthOutside` values
- `ticks[tickUpper]` — Upper tick data with `feeGrowthOutside` values

> `poolData.ticks` is populated by the internal `_fetchTickData(poolAddress, tickLower, tickUpper, provider)` helper — callers don't normally construct this by hand; it is built during `getPositionsForVDS` / `getAccruedFeesUSD`.

## Error Handling

All methods validate their inputs and throw descriptive errors:

```javascript
try {
  const poolData = await adapter.getPoolData(poolAddress, provider);
} catch (error) {
  // Possible errors:
  // - "Pool address parameter is required"
  // - "Valid provider parameter is required"
  // - "Provider chain X doesn't match adapter chain Y"
  // - "Failed to fetch pool data: ..."
}
```

## Dependencies

- `ethers` v5 — Ethereum library
- `@uniswap/v3-sdk` — Uniswap V3 SDK for position/pool calculations
- `@uniswap/sdk-core` — Uniswap core SDK types
- `@uniswap/smart-order-router` — AlphaRouter for optimal swap routing
- `@uniswap/universal-router-sdk` + `@uniswap/universal-router` — Universal Router integration
- `@uniswap/router-sdk` — Multi-protocol routing
- `@uniswap/v3-core` + `@uniswap/v3-periphery` — Pool and NonfungiblePositionManager ABIs
- `jsbi` — JavaScript BigInt library for SDK compatibility

## See Also

- [PlatformAdapter](./platform-adapter.md) — Base class with all required + optional method signatures
- [UniswapV4Adapter](./uniswap-v4-adapter.md) — V4 implementation (shared tick math, different pool architecture)
- [TraderJoeV2_2Adapter](./traderJoe-v2-2-adapter.md) — Bin-based AMM for comparison
- [AdapterFactory](./adapter-factory.md) — Factory for creating adapters
- [Adapters Architecture](../../architecture/adapters.md) — Design decisions, data shapes, automation flows
