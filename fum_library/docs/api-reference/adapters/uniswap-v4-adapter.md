<!-- Source: src/adapters/UniswapV4Adapter.js -->
# UniswapV4Adapter

The Uniswap V4 protocol adapter for concentrated liquidity pool integration on the V4 singleton architecture.

## Overview

Uniswap V4 differs architecturally from V3:

- **Singleton `PoolManager`** holds all pool state — no per-pool contracts.
- **Pools identified by `PoolId`** (`keccak256` of the `PoolKey` struct) instead of a contract address.
- **`PoolKey` struct**: `{ currency0, currency1, fee, tickSpacing, hooks }`.
- **Hooks system**: Optional contracts attach at pool lifecycle points. This adapter operates on vanilla pools only (`hooks = AddressZero`).
- **Native ETH support**: `currency0` can be `address(0)` for ETH pools (no wrapping). Reflected in `this.supportsNativePools = true`.
- **`PositionManager`** is an ERC-721 NFT contract analogous to V3's `NonfungiblePositionManager`.
- **`StateView`** is the read-only state accessor for pools and positions (fee growth, liquidity).
- **`V4Quoter`** provides swap quoting; **`UniversalRouter`** executes swaps with Permit2 authorization.

This adapter implements all 29 required `PlatformAdapter` methods (27 automation + 2 frontend display) and overrides 2 of the 4 optional incentive methods (Merkl-based).

> For the full interface, see [PlatformAdapter API Reference](./platform-adapter.md). This doc focuses on V4-specific behavior and additions.

## Constructor

```javascript
import { UniswapV4Adapter } from 'fum_library/adapters';

const adapter = new UniswapV4Adapter(chainId);
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `chainId` | `number` | Chain ID (e.g., `42161` for Arbitrum, `1337` for Hardhat Arbitrum fork) |

> The constructor takes only `chainId`. Providers are passed per-method call so the adapter can be reused across multiple provider instances.

### Cached Configuration

The constructor caches:
- Platform contract addresses: `poolManagerAddress`, `positionManagerAddress`, `stateViewAddress`, `quoterAddress`, `universalRouterAddress`
- Platform tick bounds from `platformHelpers`
- Chain configuration from `chainHelpers`
- ABIs: `PoolManager`, `PositionManager`, `StateView`, `V4Quoter`, `UniversalRouter`, `ERC20`
- Pre-compiled `ethers.utils.Interface` instances for each ABI
- `poolKeyCache: Map<poolId, PoolKey>` — since PoolId is a hash, the original PoolKey is cached for later operations
- An `AlphaRouter` instance for swap routing (with fork-specific overrides when `chainId === 1337`)

### Instance Properties

| Property | Type | Value |
|---|---|---|
| `chainId` | `number` | From constructor |
| `platformId` | `string` | `'uniswapV4'` |
| `platformName` | `string` | `'Uniswap V4'` |
| `supportsNativePools` | `boolean` | `true` (V4 supports native ETH pools) |

### Hardhat Fork Handling

When `chainId === 1337`, the constructor configures `AlphaRouter` with:
- `localRpcUrl = http://localhost:8545` (from `getChainRpcUrls(1337)`)
- `alphaRouterChainId = 42161` so Uniswap contract addresses resolve correctly
- `StaticV3SubgraphProvider` for on-chain pool discovery (no mainnet subgraph dependency)
- `StaticGasPriceProvider` with a fixed 0.1 gwei price (avoids calling `ArbGasInfo` precompile)
- Stubbed `arbitrumGasDataProvider` returning non-zero sentinel values (avoids division-by-zero in the AlphaRouter gas model)

On local fork, the adapter also applies a constrained `routingConfig` limiting route exploration (`maxSplits: 1`, `topN: 1`) to avoid 60–370s `EXACT_OUTPUT` quotes.

## Key Data Shapes

### PoolKey

```javascript
{
  currency0: string,   // Lower-address token, or AddressZero for native ETH
  currency1: string,   // Higher-address token
  fee: number,         // Fee tier in hundredths of a bip (e.g., 500 = 0.05%)
  tickSpacing: number, // Pool tick spacing
  hooks: string        // Hooks contract address (AddressZero for vanilla pools)
}
```

### PoolId

`bytes32` hex string computed as `keccak256(abi.encode(PoolKey))`. Stored as a hex string throughout the adapter.

### Position (from `getPositionById`, `getPositionsForVDS`)

```javascript
{
  id: "12345",                                   // NFT tokenId (string)
  pool: "0xabc...def",                          // PoolId bytes32
  tickLower: -276324,
  tickUpper: -276200,
  liquidity: "1234567890",
  feeGrowthInside0LastX128: "...",
  feeGrowthInside1LastX128: "...",
  tokensOwed0: "0",                              // V4 doesn't track in position struct
  tokensOwed1: "0",
  lastUpdated: 1708000000000
}
```

### Pool Data (from `getPositionById`, keyed by PoolId)

```javascript
{
  [poolId]: {
    token0Symbol: "WETH",
    token1Symbol: "USDC",
    fee: 500,
    tickSpacing: 10,
    hooks: "0x0000000000000000000000000000000000000000",
    platform: "uniswapV4",
    poolKey: PoolKey
  }
}
```

### Pool Data (from `getPoolData`)

```javascript
{
  address: poolId,
  sqrtPriceX96: string,
  tick: number,
  liquidity: string,                            // Active in-range liquidity (StateView)
  fee: number,
  feeGrowthGlobal0X128: string,
  feeGrowthGlobal1X128: string,
  lastUpdated: 1708000000000
}
```

## Required Methods

All 27 automation + 2 display methods from `PlatformAdapter` are implemented. The table below highlights V4-specific notes. For full parameter/return shapes, see [PlatformAdapter API Reference](./platform-adapter.md).

### Position Discovery & Data

| Method | V4 Notes |
|---|---|
| `getPositionsForVDS(address, provider)` | Uses `getV4PositionsByOwner` (The Graph) on real chains; on Hardhat forks (`isLocalChain`), falls back to scanning `Transfer` events on `PositionManager` from the fork block (see `_discoverTokenIdsByTransferEvents`). |
| `getPositionsForDisplay(ownerAddress, provider)` | Returns display-ready shape (prices, formatted amounts, in-range booleans). |
| `refreshPositionForDisplay(positionId, provider)` | Single-position version for modal refresh. Throws if position has zero liquidity. |
| `getPositionById(tokenId, provider)` | Queries `PositionManager.getPoolAndPositionInfo(tokenId)` for PoolKey + packed position info, decodes tick bounds, then calls `StateView.getPositionInfo(poolId, positionManager, tickLower, tickUpper, salt)` with `salt = bytes32(tokenId)`. Throws if position is burned (PoolKey is all zeros) or has zero liquidity. |
| `getPoolData(poolId, provider)` | Queries `StateView.getSlot0(poolId)` and `StateView.getLiquidity(poolId)`. Fee/tickSpacing are recovered from the cached `PoolKey`. |
| `calculateTokenAmounts(position, poolData, token0Data, token1Data, provider)` | Uses V4 SDK's `Pool` and `Position` with `TickMath`/`SqrtPriceMath`; same math as V3 since both use concentrated liquidity. |

### Position Evaluation

| Method | V4 Notes |
|---|---|
| `evaluatePositionRange(position, provider, options?)` | Tick-based range check identical to V3. Fast path via `options.swapData.tick` bypasses RPC. |
| `getAccruedFeesUSD(position, tokenPrices, provider)` | Uses `StateView.getFeeGrowthInside` instead of manual tick arithmetic. Lookup is keyed by `(poolId, positionManager, tickLower, tickUpper, salt)` where `salt = bytes32(tokenId)`. Returns V3-compatible shape plus raw `fees0`/`fees1` (used for native ETH handling in closure parsing). |
| `extractPositionBounds(position)` | Returns `{ lower: tickLower, upper: tickUpper }`. |

### Pool Operations

| Method | V4 Notes |
|---|---|
| `selectBestPool(tokenASymbol, tokenBSymbol, provider, chainId)` | Uses `discoverV4Pools` (The Graph) for pool discovery on real chains. Filters to vanilla pools (hooks = AddressZero). |
| `describePool(pool)` | Format: `"WETH/USDC 0.05% tickSpacing=10"`. |
| `getPositionRange(poolData, upperPercent, lowerPercent)` | Returns `{ tickLower, tickUpper, currentTick }` aligned to pool `tickSpacing`. |
| `getPoolCurrent(poolData)` | Returns `poolData.tick` (for baseline tracking). |
| `sortTokens(token0, token1)` | Lower-address-first (same as V3). |
| `getOptimalTokenRatio(params)` | Uses tick-range math via V4 SDK `Position` (identical model to V3). |

### Transaction Generation

| Method | V4 Notes |
|---|---|
| `generateClaimFeesData(params)` | Uses `PositionManager` `modifyLiquidities` with a V4 planner to encode decrease(0 liquidity) + take-all. |
| `generateRemoveLiquidityData(params)` | Uses `V4PositionManager.removeCallParameters` from the V4 SDK. |
| `generateAddLiquidityData(params)` | Uses `V4PositionManager.addCallParameters`. |
| `generateCreatePositionData(params)` | Uses `V4PositionManager.addCallParameters` with mint flag. PoolKey must be provided via `params.poolData.poolKey`. Returns `{ to, data, value, quote }`. |
| `batchSwapTransactions(swapInstructions, options)` | Uses AlphaRouter + UniversalRouter with Permit2. Generates per-swap Permit2 signatures with nonce tracking across multiple swaps of the same token. |
| `getBestSwapQuote(params)` | Uses AlphaRouter across V3+V4 protocols. Honors `tokenInIsNative`/`tokenOutIsNative` for ETH pools. |
| `getRequiredApprovals(operationType, vaultAddress, tokenAddresses, provider)` | For `'liquidity'`: ERC20 approve to Permit2 + Permit2 allowance to PositionManager (two-step). For `'swap'`: ERC20 approve to Permit2. |

### Receipt Parsing

| Method | V4 Notes |
|---|---|
| `parseClosureReceipt(receipt, positionMetadata, options?)` | Parses V4 `ModifyLiquidity` events to extract principal. Uses `blockExplorer.getEthTransfersForWallet` when pool has native ETH (`currency0 = AddressZero`) — requires `options.chainId` and `options.walletAddress`. |
| `parseCollectReceipt(receipt, positionMetadata, options?)` | Similar native ETH handling via `blockExplorer`. |
| `parseSwapReceipt(receipt, swapMetadata)` | Parses V2, V3, and V4 Swap events from UniversalRouter receipts (multi-protocol routes are common). Sign conventions differ: V4 uses positive=output, V3 uses positive=input. |
| `parseIncreaseLiquidityReceipt(receipt, { position, poolData })` | Extracts `tokenId`, `liquidity`, `amount0`, `amount1` from `ModifyLiquidity` events. For new positions, also includes `tickLower`, `tickUpper`, `poolAddress` (= poolId). |

### Swap Event Monitoring

| Method | V4 Notes |
|---|---|
| `getSwapEventFilter(poolId)` | All V4 swaps emit from the singleton `PoolManager`. Filter is `{ address: poolManagerAddress, topics: [SwapTopic, poolId] }` — pool is in `topics[1]` (indexed). |
| `parseSwapEvent(log)` | V4 Swap event: `Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)`. Amounts are signed with opposite convention from V3. |
| `evaluatePriceMovement(swapData, baseline, token0Data, token1Data)` | Same tick-to-price math as V3. |

## Optional Methods (Incentives)

V4 overrides 2 of the 4 optional incentive methods. The other 2 (`getIncentivePreCloseTransactions`, `getIncentivePostCreateTransactions`) inherit the no-op default — V4 uses Merkl's **auto-tracking model**, so no staking/unstaking is needed around position creation or closure.

### getPoolIncentives

Queries Merkl's `opportunities` endpoint for active V4 campaigns on the pool.

```javascript
async getPoolIncentives(poolAddress, poolData, provider): Promise<{
  active: boolean,
  programs: Array<{
    rewardToken: string,
    rewardTokenSymbol: string,
    endTimestamp: number
  }>
}>
```

Delegates to [`merkl.fetchPoolIncentives(chainId, poolAddress)`](../services/merkl.md#fetchpoolincentives). The `poolData` and `provider` parameters are unused (retained for base-class compatibility).

### getIncentiveClaimTransactions

Builds claim calldata for the Merkl `Distributor` contract. Claims ALL unclaimed Merkl rewards for the vault across all pools/tokens — Merkl uses a cumulative claim model, so per-pool claims aren't needed.

```javascript
async getIncentiveClaimTransactions(
  vaultAddress, poolAddress, poolData, provider
): Promise<Array<{ to, data, value }>>
```

- Calls [`merkl.fetchClaimData(chainId, vaultAddress)`](../services/merkl.md#fetchclaimdata).
- If no rewards are pending, returns `[]`.
- Otherwise returns one transaction calling `Distributor.claim(user, tokens, amounts, proofs)` on `chainConfig.merklDistributorAddress`. If the distributor address is missing from chain config, logs an error and returns `[]`.

The `poolAddress`, `poolData`, and `provider` parameters are unused.

## V4-Specific Helpers

### fetchPoolDataForTesting

> **⚠️ Test-only.** Not called from production source.

Fetches pool data by explicit token addresses + fee tier + tickSpacing + hooks. Useful in tests where you know the `PoolKey` components but don't yet have the `poolId`.

```javascript
async fetchPoolDataForTesting(
  token0Address: string,
  token1Address: string,
  fee: number,
  tickSpacing: number,
  hooks: string,
  provider: ethers.Provider
): Promise<Object>
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `token0Address` | `string` | First token (can be `AddressZero` for native ETH) |
| `token1Address` | `string` | Second token |
| `fee` | `number` | Fee tier |
| `tickSpacing` | `number` | Pool tick spacing |
| `hooks` | `string` | Hooks address (`ethers.constants.AddressZero` for vanilla pools) |
| `provider` | `ethers.Provider` | Ethers provider |

#### Returns

Enriched pool data:

```javascript
{
  ...poolData,            // from getPoolData(poolId, provider)
  poolId: string,
  poolKey: PoolKey,
  token0: { address, decimals, symbol },
  token1: { address, decimals, symbol },
  tokensSwapped: boolean  // true if input addresses were reordered for currency0 < currency1
}
```

#### Example

```javascript
// Test setup: fetch pool data for a WETH/USDC 0.05% pool
const pool = await v4Adapter.fetchPoolDataForTesting(
  wethAddress,
  usdcAddress,
  500,
  10,
  ethers.constants.AddressZero,
  provider
);
```

## Error Handling

All methods validate inputs and throw descriptive errors. Typical V4-specific error messages:

```javascript
try {
  const { position } = await adapter.getPositionById(tokenId, provider);
} catch (error) {
  // Possible errors:
  // - "TokenId parameter is required"
  // - "Valid provider parameter is required"
  // - "Position 12345 not found or has been burned"
  // - "Position 12345 has zero liquidity"
  // - "Failed to fetch V4 position 12345: <underlying>"
}
```

## Dependencies

- `ethers` v5 — Ethereum library
- `@uniswap/v4-core` — PoolManager ABI
- `@uniswap/v4-periphery` — PositionManager, StateView, V4Quoter ABIs
- `@uniswap/v4-sdk` — `Pool`, `Position`, `V4PositionManager`, `V4PositionPlanner`
- `@uniswap/v3-sdk` — Shared tick math (`SqrtPriceMath`, `TickMath`, `tickToPrice`)
- `@uniswap/smart-order-router` — AlphaRouter
- `@uniswap/universal-router-sdk` + `@uniswap/universal-router` — UniversalRouter integration
- `@uniswap/router-sdk` — Multi-protocol routing (V2/V3/V4)
- `@uniswap/sdk-core` — `Token`, `Percent`, `CurrencyAmount`, `TradeType`, `Ether`
- `jsbi` — JavaScript BigInt for SDK compatibility

## See Also

- [PlatformAdapter](./platform-adapter.md) — Base class interface (27 automation + 2 display + 4 optional methods)
- [UniswapV3Adapter](./uniswap-v3-adapter.md) — V3 implementation (shared tick math, different pool architecture)
- [TraderJoeV2_2Adapter](./traderJoe-v2-2-adapter.md) — Bin-based AMM for comparison
- [AdapterFactory](./adapter-factory.md) — Factory for creating adapters
- [Adapters Architecture](../../architecture/adapters.md) — Design decisions, data shapes, automation flows
- [`merkl` service](../services/merkl.md) — V4 incentive source
- [`theGraph` service](../services/theGraph.md) — V4 pool/position discovery
- [`blockExplorer` service](../services/blockExplorer.md) — Native ETH tracking during receipt parsing
