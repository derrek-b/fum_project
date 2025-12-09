# UniswapV3Adapter

The Uniswap V3 protocol adapter for concentrated liquidity pool integration.

## Overview

This adapter provides comprehensive integration with Uniswap V3 concentrated liquidity pools including:
- Pool and position data fetching
- Price calculations and tick conversions
- Transaction data generation for swaps, liquidity management, and fee collection
- Optimal routing via AlphaRouter integration

The adapter is designed for single-chain operation and caches configuration data during construction for optimal performance.

## Constructor

```javascript
import { UniswapV3Adapter } from 'fum_library/adapters';

const adapter = new UniswapV3Adapter(chainId, provider);
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `chainId` | `number` | Chain ID for the adapter (e.g., 42161 for Arbitrum) |
| `provider` | `ethers.Provider` | Ethers provider instance |

### Cached Configuration

The constructor caches:
- Platform contract addresses (factory, position manager, router, quoter)
- Supported fee tiers (100, 500, 3000, 10000)
- Chain configuration
- Pre-compiled contract interfaces for transaction encoding
- AlphaRouter instance for optimal swap routing

---

## Pool Methods

### getPoolAddress

Get pool address from the factory contract.

```javascript
const poolAddress = await adapter.getPoolAddress(
  token0Address,
  token1Address,
  fee,
  provider
);
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `token0Address` | `string` | Address of first token |
| `token1Address` | `string` | Address of second token |
| `fee` | `number` | Fee tier (100, 500, 3000, or 10000) |
| `provider` | `ethers.Provider` | Ethers provider instance |

#### Returns

`Promise<string>` - Pool contract address (or zero address if pool doesn't exist).

---

### checkPoolExists

Check if a pool exists for the given tokens and fee tier.

```javascript
const result = await adapter.checkPoolExists(token0, token1, fee, provider);

if (result.exists) {
  console.log('Pool address:', result.poolAddress);
  console.log('Current tick:', result.slot0.tick);
}
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `token0` | `Object` | Token object with `address` and `decimals` |
| `token1` | `Object` | Token object with `address` and `decimals` |
| `fee` | `number` | Fee tier |
| `provider` | `ethers.Provider` | Ethers provider instance |

#### Returns

`Promise<Object>`:
- `exists: boolean` - Whether pool exists
- `poolAddress: string|null` - Pool address if exists
- `slot0: Object|null` - Pool slot0 data if exists

---

### fetchPoolData

Fetch comprehensive pool state data by token addresses.

```javascript
const poolData = await adapter.fetchPoolData(
  token0Address,
  token1Address,
  fee,
  provider
);
```

#### Returns

`Promise<Object>` containing:
- `poolAddress: string`
- `token0: Object` - Token0 data with address, decimals, symbol
- `token1: Object` - Token1 data with address, decimals, symbol
- `sqrtPriceX96: string` - Current sqrt price
- `tick: number` - Current tick
- `liquidity: string` - Pool liquidity
- `feeGrowthGlobal0X128: string` - Global fee growth for token0
- `feeGrowthGlobal1X128: string` - Global fee growth for token1
- `fee: number` - Fee tier
- `tickSpacing: number` - Tick spacing for this pool
- `ticks: Object` - Tick data (populated by fetchTickData)

---

### getPoolData

Get pool data by address with optional tick data and token information.

```javascript
const poolData = await adapter.getPoolData(
  poolAddress,
  {
    includeTicks: [195000, 205000],  // Optional tick indices to fetch
    includeTokens: true               // Optional: include token addresses
  },
  provider
);
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `poolAddress` | `string` | Pool contract address |
| `options` | `Object` | Options object (required) |
| `options.includeTicks` | `number[]` | Optional array of tick indices to fetch |
| `options.includeTokens` | `boolean` | Whether to include token0/token1 addresses |
| `provider` | `ethers.Provider` | Ethers provider instance |

---

### fetchTickData

Fetch tick-specific data for fee calculations.

```javascript
const tickData = await adapter.fetchTickData(
  poolAddress,
  tickLower,
  tickUpper,
  provider
);
```

#### Returns

`Promise<Object>`:
- `tickLower: Object` - Lower tick data with fee growth values
- `tickUpper: Object` - Upper tick data with fee growth values

---

### getCurrentTick

Get the current tick for a pool.

```javascript
const currentTick = await adapter.getCurrentTick(poolAddress, provider);
```

---

### discoverAvailablePools

Discover available pools for a token pair across all fee tiers.

```javascript
const pools = await adapter.discoverAvailablePools(
  token0Address,
  token1Address,
  provider
);

// Returns array of pool objects with address, fee, liquidity, sqrtPriceX96, tick
```

---

### getPoolABI

Get the Uniswap V3 pool contract ABI.

```javascript
const poolABI = adapter.getPoolABI();
```

---

## Position Methods

### getPositions

Get all Uniswap V3 positions for a wallet address.

```javascript
const { positions, poolData } = await adapter.getPositions(address, provider);

// positions: Object keyed by position ID
// poolData: Object keyed by pool address with full pool state
```

---

### getPositionsForVDS

Get positions formatted for VaultDataService (pared down to essential fields).

```javascript
const { positions, poolData } = await adapter.getPositionsForVDS(
  vaultAddress,
  provider
);

// positions: Normalized position data (id, pool, tickLower, tickUpper, liquidity)
// poolData: Stable metadata only (no time-sensitive data)
```

---

### isPositionInRange

Check if a position is currently in range (active).

```javascript
const inRange = adapter.isPositionInRange(currentTick, tickLower, tickUpper);
```

Returns `true` if `tickLower <= currentTick <= tickUpper`.

---

## Price & Tick Calculations

### calculatePriceFromSqrtPrice

Calculate price from sqrtPriceX96 using the Uniswap V3 SDK.

```javascript
const price = adapter.calculatePriceFromSqrtPrice(
  sqrtPriceX96,
  baseToken,    // { address, decimals }
  quoteToken    // { address, decimals }
);

// Returns Uniswap SDK Price object
console.log(price.toFixed(6));      // Fixed decimal string
console.log(price.toSignificant(6)); // Significant figures
```

---

### tickToPrice

Convert a tick value to a price.

```javascript
const price = adapter.tickToPrice(tick, baseToken, quoteToken);
```

---

### priceToTick

Convert a human-readable price to the closest valid tick.

```javascript
const tick = adapter.priceToTick(price, baseToken, quoteToken);
```

---

### calculateTickRangeFromPercentages

Calculate tick range from percentage parameters.

```javascript
const { tickLower, tickUpper } = adapter.calculateTickRangeFromPercentages(
  currentTick,   // Current pool tick
  upperPercent,  // Upper range percentage (e.g., 10 for 10%)
  lowerPercent,  // Lower range percentage (e.g., 10 for 10%)
  fee            // Fee tier (for tick spacing alignment)
);
```

Ticks are aligned to the tick spacing boundaries for the fee tier.

---

### calculateOriginalTick

Reverse-engineer the tick where a position was created.

```javascript
const originalTick = adapter.calculateOriginalTick(
  position,           // { tickLower, tickUpper, fee }
  targetRangeUpper,   // Target range upper percentage (0-100)
  targetRangeLower    // Target range lower percentage (0-100)
);
```

---

## Fee & Amount Calculations

### calculateUncollectedFees

Calculate uncollected fees for a position.

```javascript
const [fees0, fees1] = adapter.calculateUncollectedFees(position, poolData);
// Returns [bigint, bigint] - raw token amounts
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

- `tick: number` - Current pool tick
- `feeGrowthGlobal0X128: string` - Global fee growth
- `feeGrowthGlobal1X128: string` - Global fee growth
- `ticks[tickLower]` - Lower tick data with feeGrowthOutside values
- `ticks[tickUpper]` - Upper tick data with feeGrowthOutside values

---

### calculateTokenAmounts

Calculate token amounts for a position (if it were to be closed).

```javascript
const [amount0, amount1] = await adapter.calculateTokenAmounts(
  position,   // { liquidity, tickLower, tickUpper }
  poolData,   // { fee, sqrtPriceX96, liquidity, tick }
  token0Data, // { address, decimals }
  token1Data  // { address, decimals }
);
// Returns [bigint, bigint] - raw token amounts
```

---

## Swap Methods

### getSwapQuote

Get expected output amount for a swap using the Quoter contract.

```javascript
const amountOut = await adapter.getSwapQuote({
  tokenInAddress: '0x...',
  tokenOutAddress: '0x...',
  fee: 500,
  amountIn: '1000000000000000000',  // 1 token in wei
  provider
});
// Returns string (wei amount)
```

---

### getBestSwapQuote

Get best swap quote using AlphaRouter for optimal routing.

```javascript
// For EXACT_INPUT (specify input, get output)
const quote = await adapter.getBestSwapQuote({
  tokenInAddress: '0x...',
  tokenOutAddress: '0x...',
  amount: '1000000000000000000',
  isAmountIn: true
});

// For EXACT_OUTPUT (specify output, get required input)
const quote = await adapter.getBestSwapQuote({
  tokenInAddress: '0x...',
  tokenOutAddress: '0x...',
  amount: '1000000',
  isAmountIn: false
});
```

#### Returns

```javascript
{
  amountIn: string,     // Input amount (wei)
  amountOut: string,    // Output amount (wei)
  route: SwapRoute,     // Full route object
  methodParameters?: MethodParameters
}
```

---

### getSwapRoute

Get swap route with execution-ready transaction data.

```javascript
const route = await adapter.getSwapRoute({
  tokenInAddress: '0x...',
  tokenOutAddress: '0x...',
  amount: '1000000000000000000',
  isAmountIn: true,
  recipient: '0x...',
  slippageTolerance: 0.5,    // 0.5%
  deadlineMinutes: 30
});
```

Returns route with `methodParameters` containing calldata for Universal Router.

---

### generateSwapData

Generate swap transaction data using SwapRouter.

```javascript
const txData = await adapter.generateSwapData({
  tokenIn: '0x...',
  tokenOut: '0x...',
  fee: 500,
  recipient: '0x...',
  amountIn: '1000000000000000000',
  slippageTolerance: 0.5,
  sqrtPriceLimitX96: '0',
  deadlineMinutes: 20,
  provider
});
```

#### Returns

```javascript
{
  to: string,    // Router address
  data: string,  // Encoded calldata
  value: string  // Transaction value (usually "0x00")
}
```

---

### generateAlphaSwapData

Generate swap transaction data using AlphaRouter route + Universal Router + Permit2.

```javascript
const txData = await adapter.generateAlphaSwapData({
  route,                    // Route from getSwapRoute()
  tokenInAddress: '0x...',
  amountIn: '1000000000000000000',
  recipient: '0x...',
  walletAddress: '0x...',
  permit2Signature: '0x...',
  permit2Nonce: 0,
  permit2Deadline: Math.floor(Date.now() / 1000) + 3600
});
```

---

## Liquidity Management

### generateClaimFeesData

Generate transaction data for claiming fees from a position.

```javascript
const txData = await adapter.generateClaimFeesData({
  positionId: '12345',
  provider,
  walletAddress: '0x...',
  token0Address: '0x...',
  token1Address: '0x...',
  token0Decimals: 18,
  token1Decimals: 6
});
```

---

### generateRemoveLiquidityData

Generate transaction data for removing liquidity.

```javascript
const txData = await adapter.generateRemoveLiquidityData({
  position: {
    id: '12345',
    tickLower: 195000,
    tickUpper: 205000
  },
  percentage: 50,          // 50% of liquidity
  provider,
  walletAddress: '0x...',
  poolData: {
    fee: 500,
    sqrtPriceX96: '...',
    liquidity: '...',
    tick: 200000
  },
  token0Data: { address: '0x...', decimals: 18 },
  token1Data: { address: '0x...', decimals: 6 },
  slippageTolerance: 0.5,
  deadlineMinutes: 20
});
```

---

### generateAddLiquidityData

Generate transaction data for adding liquidity to an existing position.

```javascript
const result = await adapter.generateAddLiquidityData({
  position: {
    id: '12345',
    tickLower: 195000,
    tickUpper: 205000
  },
  token0Amount: '1000000000000000000',  // wei string
  token1Amount: '1000000',               // wei string
  provider,
  poolData: { fee, sqrtPriceX96, liquidity, tick },
  token0Data: { address, decimals },
  token1Data: { address, decimals },
  slippageTolerance: 0.5,
  deadlineMinutes: 20
});

// Returns { to, data, value, quote }
```

---

### getAddLiquidityQuote

Get liquidity quote for adding liquidity without generating transaction data.

```javascript
const quote = await adapter.getAddLiquidityQuote({
  position: { tickLower: 195000, tickUpper: 205000 },
  token0Amount: '1000000000000000000',
  token1Amount: '1000000',
  provider,
  poolData,
  token0Data,
  token1Data
});

// Returns { position, tokensSwapped, sortedToken0, sortedToken1, pool }
```

---

### generateCreatePositionData

Generate transaction data for creating a new position.

```javascript
const result = await adapter.generateCreatePositionData({
  position: {
    tickLower: 195000,
    tickUpper: 205000
  },
  token0Amount: '1000000000000000000',
  token1Amount: '1000000',
  provider,
  walletAddress: '0x...',
  poolData: { fee, sqrtPriceX96, liquidity, tick },
  token0Data: { address, decimals },
  token1Data: { address, decimals },
  slippageTolerance: 0.5,
  deadlineMinutes: 20
});

// Returns { to, data, value, quote }
```

---

## Utility Methods

### sortTokens

Sort tokens according to Uniswap V3 rules (lower address first).

```javascript
const { sortedToken0, sortedToken1, tokensSwapped } = adapter.sortTokens(
  token0,  // { address }
  token1   // { address }
);
```

---

### getSwapEventSignature

Get the Uniswap V3 Swap event signature for event filtering.

```javascript
const signature = adapter.getSwapEventSignature();
// Returns: 'Swap(address,address,int256,int256,uint160,uint128,int24)'
```

---

## Error Handling

All methods validate their inputs and throw descriptive errors:

```javascript
try {
  const poolData = await adapter.fetchPoolData(token0, token1, fee, provider);
} catch (error) {
  // Possible errors:
  // - "Token0 address parameter is required"
  // - "Invalid token0 address: ..."
  // - "Unsupported token: ... on chain ..."
  // - "Provider chain X doesn't match adapter chain Y"
  // - "Failed to fetch pool data: ..."
}
```

## Dependencies

- `ethers` - Ethereum library
- `@uniswap/v3-sdk` - Uniswap V3 SDK for position/pool calculations
- `@uniswap/sdk-core` - Uniswap core SDK types
- `@uniswap/smart-order-router` - AlphaRouter for optimal swap routing
- `@uniswap/universal-router-sdk` - Universal Router integration
- `jsbi` - JavaScript BigInt library for SDK compatibility

## See Also

- [`AdapterFactory`](./adapter-factory.md) - Factory for creating adapters
- [`PlatformAdapter`](./platform-adapter.md) - Abstract base class
- [Uniswap V3 Documentation](https://docs.uniswap.org/contracts/v3/overview)
