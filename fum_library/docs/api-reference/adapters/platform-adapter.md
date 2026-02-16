# PlatformAdapter API Reference

Abstract base class that defines the interface all DeFi platform adapters must implement.

**Source:** `src/adapters/PlatformAdapter.js`

## Class Hierarchy

```
PlatformAdapter (abstract)
├── UniswapV3Adapter
├── UniswapV4Adapter
└── TraderJoeV2_2Adapter
```

## Constructor

```javascript
constructor(chainId, platformId, platformName)
```

| Param | Type | Description |
|---|---|---|
| `chainId` | `number` | Chain ID (e.g., 42161 for Arbitrum) |
| `platformId` | `string` | Platform identifier (e.g., `'uniswapV3'`) |
| `platformName` | `string` | Human-readable name (e.g., `'Uniswap V3'`) |

**Throws:**
- `Error` if instantiated directly (abstract class)
- `Error` if `chainId` is not a valid number
- `Error` if `platformId` or `platformName` is missing

Subclass constructors typically take `(chainId, provider)` and call `super()` with the platform identifiers:

```javascript
class MyAdapter extends PlatformAdapter {
  constructor(chainId, provider) {
    super(chainId, 'myPlatform', 'My Platform');
    this.provider = provider;
  }
}
```

## Instance Properties

| Property | Type | Set By |
|---|---|---|
| `this.chainId` | `number` | Constructor |
| `this.platformId` | `string` | Constructor |
| `this.platformName` | `string` | Constructor |

---

## Required Methods

All methods below throw `"must be implemented by subclasses"` if not overridden.

### Position Discovery & Data

#### getPositionsForVDS(address, provider)

Get all positions for an address, formatted for the automation service's VaultDataService cache.

```javascript
const { positions, poolData } = await adapter.getPositionsForVDS(vaultAddress, provider);
```

| Param | Type | Description |
|---|---|---|
| `address` | `string` | Vault/wallet address |
| `provider` | `ethers.Provider` | Ethers provider |

**Returns:** `Promise<{ positions: Object, poolData: Object }>` — See [data shapes](../../../docs/architecture/adapters.md#key-data-shapes) for structure.

---

#### getPositionById(tokenId, provider)

Fetch a single position by NFT tokenId directly from chain. Used after position creation when The Graph hasn't indexed it yet.

```javascript
const { position, poolData } = await adapter.getPositionById(tokenId, provider);
```

| Param | Type | Description |
|---|---|---|
| `tokenId` | `string\|number` | Position NFT token ID |
| `provider` | `ethers.Provider` | Ethers provider |

**Returns:** `Promise<{ position: Object, poolData: Object }>` — Position in same format as `getPositionsForVDS`, poolData keyed by pool identifier.

**Throws:** If tokenId is invalid, position not found, or position has been burned.

---

#### getPoolData(poolId, provider)

Get current pool state data by pool identifier.

```javascript
const poolData = await adapter.getPoolData(poolAddress, provider);
```

| Param | Type | Description |
|---|---|---|
| `poolId` | `string` | Pool address (V3) or bytes32 PoolId (V4) |
| `provider` | `ethers.Provider` | Ethers provider |

**Returns:** `Promise<Object>` — Pool state including `address`, `sqrtPriceX96`, `tick`, `liquidity`, `fee`, `feeGrowthGlobal0X128`, `feeGrowthGlobal1X128`, `lastUpdated`.

---

#### calculateTokenAmounts(position, poolData, token0Data, token1Data, provider)

Calculate token amounts for a position if it were to be closed at current prices.

```javascript
const [amount0, amount1] = await adapter.calculateTokenAmounts(
  position, poolData, token0Data, token1Data, provider
);
```

**Returns:** `Promise<[BigInt, BigInt]>` — Raw token amounts `[amount0, amount1]`.

---

### Position Evaluation

#### evaluatePositionRange(position, provider, options?)

Evaluate a position's range status relative to current pool state.

Can operate in two modes:
1. Without `options.swapData`: Fetches current state from blockchain (async RPC call)
2. With `options.swapData`: Extracts state from parsed swap event (no RPC call)

```javascript
// From blockchain
const eval = await adapter.evaluatePositionRange(position, provider);

// From swap event (fast path)
const eval = await adapter.evaluatePositionRange(position, null, { swapData });
```

| Param | Type | Description |
|---|---|---|
| `position` | `Object` | Position with `tickLower`, `tickUpper`, `pool` |
| `provider` | `ethers.Provider\|null` | Provider (can be null if swapData provided) |
| `options.swapData` | `Object` | Parsed swap event data (optional, skips RPC) |

**Returns:** `Promise<{ inRange, centeredness, distanceToUpper, distanceToLower, currentTick }>`

---

#### getAccruedFeesUSD(position, tokenPrices, provider)

Calculate accrued (uncollected) fees for a position in USD. Handles all platform-specific data fetching internally.

```javascript
const fees = await adapter.getAccruedFeesUSD(position, { token0: 1850.0, token1: 1.0 }, provider);
```

| Param | Type | Description |
|---|---|---|
| `position` | `Object` | Position with fee growth fields from cache |
| `tokenPrices` | `Object` | `{ token0: number, token1: number }` USD prices |
| `provider` | `ethers.Provider` | Ethers provider |

**Returns:** `Promise<{ totalUSD, token0Fees, token1Fees, token0USD, token1USD }>`

---

#### extractPositionBounds(position)

Extract position bounds in a platform-agnostic format for event emission.

```javascript
const { lower, upper } = adapter.extractPositionBounds(position);
```

**Returns:** `{ lower: number, upper: number }`

---

### Pool Operations

#### selectBestPool(tokenASymbol, tokenBSymbol, provider, chainId)

Discover pools for a token pair, filter inactive ones, sort by depth, return the best.

```javascript
const { bestPool, poolsDiscovered, poolsActive } = await adapter.selectBestPool(
  'WETH', 'USDC', provider, 42161
);
```

**Returns:** `Promise<{ bestPool: Object, poolsDiscovered: number, poolsActive: number }>`

**Throws:** If no pools found or no active pools.

---

#### describePool(pool)

Format a human-readable summary of a pool for logging. Each platform uses its native terminology.

```javascript
const desc = adapter.describePool(pool);
// V3: "WETH/USDC 0.05% (tick: -276250, liquidity: 1.2M)"
// TJ: "WETH/USDC binStep=15 (activeId: 8388608)"
```

**Returns:** `string`

---

#### getPositionRange(poolData, upperPercent, lowerPercent)

Calculate position range bounds from percentage parameters.

```javascript
const range = adapter.getPositionRange(poolData, 5, 5); // ±5%
// V3: { tickLower, tickUpper, currentTick }
// TJ: { lowerBinId, upperBinId, activeBinId }
```

**Returns:** Platform-specific range object usable by `generateCreatePositionData` and `getOptimalTokenRatio`.

---

#### getPoolCurrent(poolData)

Get the current pool state value for baseline tracking (emergency exit evaluation).

```javascript
const baseline = adapter.getPoolCurrent(poolData);
// V3/V4: returns tick (number)
// TJ: returns activeId or price
```

**Returns:** `number`

---

#### sortTokens(token0, token1)

Sort tokens into the platform's canonical ordering.

```javascript
const { sortedToken0, sortedToken1, tokensSwapped } = adapter.sortTokens(tokenA, tokenB);
```

| Param | Type | Description |
|---|---|---|
| `token0` | `Object` | Token with `address` and `symbol` |
| `token1` | `Object` | Token with `address` and `symbol` |

**Returns:** `{ sortedToken0: Object, sortedToken1: Object, tokensSwapped: boolean }`

---

#### getOptimalTokenRatio(params)

Calculate the optimal token value ratio for a position's range at current pool state.

```javascript
const { token0Share, token1Share } = await adapter.getOptimalTokenRatio({
  position: { tickLower, tickUpper },
  poolData, token0Data, token1Data,
  token0Price: 1850, token1Price: 1.0,
  provider
});
// token0Share + token1Share === 1.0
```

Returns value shares (not amount ratios). A result of `{ token0Share: 0.6, token1Share: 0.4 }` means 60% of total USD value should be token0.

**Returns:** `Promise<{ token0Share: number, token1Share: number }>`

---

### Transaction Generation

All `generate*` methods return transaction data objects `{ to, data, value }` suitable for `executeVaultTransactions()`.

#### generateClaimFeesData(params)

Generate transaction data for claiming fees from a position.

**Returns:** `Promise<{ to, data, value }>`

---

#### generateRemoveLiquidityData(params)

Generate transaction data for removing liquidity from a position.

**Returns:** `Promise<{ to, data, value }>`

---

#### generateAddLiquidityData(params)

Generate transaction data for adding liquidity to an existing position.

**Returns:** `Promise<{ to, data, value }>`

---

#### generateCreatePositionData(params)

Generate transaction data for creating a new position.

**Returns:** `Promise<{ to, data, value }>`

---

#### batchSwapTransactions(swapInstructions, options)

Generate batched swap transactions with platform-specific auth handling (Permit2 nonce tracking, etc.).

```javascript
const { transactions, metadata } = await adapter.batchSwapTransactions(
  [
    {
      tokenIn: { address, symbol, decimals, isNative: false },
      tokenOut: { address, symbol, decimals },
      amount: '1000000000000000000',  // raw wei string
      isAmountIn: true
    }
  ],
  {
    signer,               // ethers.Wallet (for Permit2 signatures)
    provider,
    chainId: 42161,
    recipient: vaultAddress,
    slippageTolerance: 0.5
  }
);
```

**Returns:** `Promise<{ transactions: Array<{ to, data, value }>, metadata: Array<Object> }>`

---

#### getBestSwapQuote(params)

Get best swap quote using the platform's routing mechanism.

```javascript
const quote = await adapter.getBestSwapQuote({
  tokenInAddress: '0x...',
  tokenOutAddress: '0x...',
  amount: '1000000000000000000',
  isAmountIn: true,
  tokenInIsNative: false,   // optional, default false
  tokenOutIsNative: false   // optional, default false
});
```

**Returns:** `Promise<{ amountIn: string, amountOut: string, route: Object, methodParameters?: Object }>`

**Throws:** If no valid route can be found.

---

#### getRequiredApprovals(operationType, vaultAddress, tokenAddresses, provider)

Get approval transactions needed for an operation. Checks current allowances and only returns transactions for approvals actually needed.

```javascript
const approvalTxs = await adapter.getRequiredApprovals(
  'liquidity',                      // 'swap' or 'liquidity'
  vaultAddress,
  [token0.address, token1.address],
  provider
);
// Returns Array<{ to, data, value }>
```

---

### Receipt Parsing

#### parseClosureReceipt(receipt, positionMetadata, options?)

Parse position closure receipt to extract principal and fees separately.

| Param | Type | Description |
|---|---|---|
| `receipt` | `Object` | Transaction receipt |
| `positionMetadata` | `Object` | `{ [tokenId]: { position, poolMetadata, token0Data, token1Data, adapter } }` |
| `options.chainId` | `number` | For block explorer (V4 native ETH tracking) |
| `options.walletAddress` | `string` | For ETH tracking |

**Returns:** `Promise<{ principalByPosition, feesByPosition }>`

---

#### parseCollectReceipt(receipt, positionMetadata, options?)

Parse standalone fee collection receipt. Unlike closure, Collect amounts ARE the fees directly.

**Returns:** `Promise<{ feesByPosition }>`

---

#### parseSwapReceipt(receipt, swapMetadata)

Parse swap receipt to extract actual amounts per swap.

| Param | Type | Description |
|---|---|---|
| `receipt` | `Object` | Transaction receipt |
| `swapMetadata` | `Array` | `[{ tokenInAddress, tokenOutAddress, expectedSwapEvents?, routes? }]` |

**Returns:** `Array<{ actualAmountIn: string, actualAmountOut: string }>`

---

#### parseIncreaseLiquidityReceipt(receipt, context)

Parse increase-liquidity receipt to extract actual amounts consumed.

| Param | Type | Description |
|---|---|---|
| `receipt` | `Object` | Transaction receipt |
| `context.position` | `Object` | Position with tick bounds |
| `context.poolData` | `Object` | Pool data with current price |

**Returns:** `{ tokenId, liquidity, amount0, amount1, tickLower?, tickUpper?, poolAddress? }`

---

### Swap Event Monitoring

#### getSwapEventFilter(poolId)

Get an ethers-compatible event filter for monitoring swap events on a pool.

```javascript
const filter = adapter.getSwapEventFilter(poolAddress);
provider.on(filter, (log) => { /* handle swap */ });
```

**Returns:** `{ address: string, topics: string[] }`

---

#### parseSwapEvent(log)

Parse a raw swap event log into normalized data.

**Returns:** `{ tick: number, sqrtPriceX96: string, liquidity: string, amount0: string, amount1: string }`

---

#### evaluatePriceMovement(swapData, baseline, token0Data, token1Data)

Calculate percentage price movement between current swap state and a stored baseline.

| Param | Type | Description |
|---|---|---|
| `swapData` | `Object` | From `parseSwapEvent()` |
| `baseline` | `number\|string` | Baseline state (tick for V3, price for others) |
| `token0Data` | `Object` | `{ address, symbol, decimals }` |
| `token1Data` | `Object` | `{ address, symbol, decimals }` |

**Returns:** `{ priceMovementPercent, baselinePrice, currentPrice, direction }`

---

## Optional Methods — Incentive Rewards

These have safe default no-op implementations. Override to enable incentive support.

#### getPoolIncentives(poolAddress, provider)

**Default:** `{ active: false, programs: [] }`

**Returns:** `Promise<{ active: boolean, programs: Array<{ rewardToken, rewardTokenSymbol?, endTime }> }>`

---

#### getIncentivePreCloseTransactions(position, incentives, provider)

**Default:** `[]`

**Returns:** `Promise<Array<{ to, data, value }>>`

---

#### getIncentivePostCreateTransactions(positionId, incentives, provider)

**Default:** `[]`

**Returns:** `Promise<Array<{ to, data, value }>>`

---

#### getIncentiveClaimTransactions(vaultAddress, poolAddress, provider)

**Default:** `[]`

**Returns:** `Promise<Array<{ to, data, value }>>`

---

## See Also

- [Adapters Architecture](../../architecture/adapters.md) — Design decisions, data shapes, automation flows
- [AdapterFactory](./adapter-factory.md) — Factory for creating adapters
- [UniswapV3Adapter](./uniswap-v3-adapter.md) — V3 implementation details
