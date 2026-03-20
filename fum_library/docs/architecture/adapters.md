<!-- Source: src/adapters/PlatformAdapter.js, src/adapters/AdapterFactory.js, src/adapters/UniswapV3Adapter.js, src/adapters/UniswapV4Adapter.js, src/adapters/TraderJoeV2_2Adapter.js -->
# Adapters Architecture

## Overview

The adapter module provides a unified interface for interacting with different DeFi protocols. Each supported platform has its own adapter that translates the common `PlatformAdapter` interface into protocol-specific contract calls, data formats, and transaction encoding.

**Current adapters:**

| Platform ID | Adapter Class | Protocols |
|---|---|---|
| `uniswapV3` | `UniswapV3Adapter` | Uniswap V3 (Arbitrum) |
| `uniswapV4` | `UniswapV4Adapter` | Uniswap V4 (Arbitrum) |
| `traderjoeV2_2` | `TraderJoeV2_2Adapter` | Trader Joe V2.2 Liquidity Book (Arbitrum, Avalanche) |

## AdapterFactory

The factory creates adapter instances from platform IDs. Adapters are constructed with a `chainId` and `provider`, and they load platform-specific contract addresses, ABIs, and configuration from `configs/chains.js` and `configs/platforms.js` internally.

```javascript
import { AdapterFactory } from 'fum_library/adapters';

// Get a specific adapter
const adapter = AdapterFactory.getAdapter('uniswapV3', 42161, provider);

// Get all adapters for a chain
const { adapters, failures } = AdapterFactory.getAdaptersForChain(42161, provider);

// Check available platforms
AdapterFactory.getSupportedPlatforms();  // ['uniswapV3', 'uniswapV4', 'traderjoeV2_2']
AdapterFactory.hasAdapter('uniswapV3'); // true
```

### Factory Methods

| Method | Signature | Description |
|---|---|---|
| `getAdapter` | `(platformId, chainId, provider) → Adapter` | Create a specific adapter. Throws if platform unknown or creation fails. |
| `getAdaptersForChain` | `(chainId, provider) → { adapters[], failures[] }` | Create all adapters for a chain. Returns failures array instead of throwing. |
| `getSupportedPlatforms` | `() → string[]` | List all registered platform IDs. |
| `hasAdapter` | `(platformId) → boolean` | Check if a platform ID is registered. |

> **Note:** The convenience wrappers in `adapters/index.js` (`getAdaptersForChain`, `getAdapter`, `registerAdapter`) have stale signatures that pass an extra `config` parameter. Use `AdapterFactory` directly until these are fixed.

## PlatformAdapter Interface

`PlatformAdapter` is the abstract base class. All adapters extend it and implement 27 required methods + optionally override 4 incentive methods.

### Constructor

```javascript
constructor(chainId, platformId, platformName)
```

- `chainId` — number, required
- `platformId` — string (e.g., `'uniswapV3'`)
- `platformName` — string (e.g., `'Uniswap V3'`)

Cannot be instantiated directly. Subclass constructors typically take `(chainId, provider)` and call `super(chainId, 'platformId', 'Platform Name')`.

### Required Methods — Grouped by Purpose

#### Position Discovery & Data

| Method | Signature | Used By | Description |
|---|---|---|---|
| `getPositionsForDisplay` | `(address, provider) → Promise<{positions}>` | Frontend (all pages) | Get positions with pre-computed display values (prices, amounts, fees, in-range). See `docs/decisions/adapter-display-interface.md` |
| `refreshPositionForDisplay` | `(positionId, provider) → Promise<position>` | Frontend (modal refresh) | Single-position refresh returning same shape as `getPositionsForDisplay`. Used by `useModalData` hook for 30s auto-refresh while modals are open. |
| `getPositionsForVDS` | `(address, provider) → Promise<{positions, poolData}>` | VDS.fetchPositions | Get positions formatted for VaultDataService cache |
| `getPositionById` | `(tokenId, provider) → Promise<{position, poolData}>` | Strategy.createNewPosition | Fetch single position by NFT tokenId (no Graph dependency) |
| `getPoolData` | `(poolId, provider) → Promise<Object>` | VDS.fetchAssetValues | Get pool state data by pool identifier |
| `calculateTokenAmounts` | `(position, poolData, token0Data, token1Data, provider) → Promise<[BigInt, BigInt]>` | VDS.fetchAssetValues | Calculate token amounts if position were closed |

#### Position Evaluation

| Method | Signature | Used By | Description |
|---|---|---|---|
| `evaluatePositionRange` | `(position, provider, options?) → Promise<Object>` | Strategy.evaluatePositions | Check if position is in range + distance metrics |
| `getAccruedFeesUSD` | `(position, tokenPrices, provider) → Promise<Object>` | Strategy.handleSwapEvent | Calculate uncollected fees in USD |
| `extractPositionBounds` | `(position) → { lower, upper }` | Strategy event emission | Extract position bounds in platform-agnostic format |

#### Pool Operations

| Method | Signature | Used By | Description |
|---|---|---|---|
| `selectBestPool` | `(tokenASymbol, tokenBSymbol, provider, chainId) → Promise<Object>` | Strategy.initializeVault | Discover pools, filter inactive, return best |
| `describePool` | `(pool) → string` | Strategy logging | Human-readable pool description |
| `getPositionRange` | `(poolData, upperPercent, lowerPercent) → Object` | Strategy.createNewPosition | Calculate position bounds from % parameters |
| `getPoolCurrent` | `(poolData) → number` | Strategy.initializeVault | Get current pool state for baseline tracking |
| `sortTokens` | `(token0, token1) → { sortedToken0, sortedToken1, tokensSwapped }` | Strategy pool operations | Sort tokens into platform's canonical order |
| `getOptimalTokenRatio` | `(params) → Promise<{ token0Share, token1Share }>` | Strategy.createNewPosition | Calculate optimal token value ratio for range |

#### Transaction Generation

| Method | Signature | Used By | Description |
|---|---|---|---|
| `generateClaimFeesData` | `(params) → Promise<{ to, data, value }>` | Strategy.collectFees | Generate fee claim transaction data |
| `generateRemoveLiquidityData` | `(params) → Promise<{ to, data, value }>` | Strategy.closePositions | Generate liquidity removal transaction data |
| `generateAddLiquidityData` | `(params) → Promise<{ to, data, value }>` | Strategy.addToPosition | Generate add-liquidity transaction data |
| `generateCreatePositionData` | `(params) → Promise<{ to, data, value }>` | Strategy.createNewPosition | Generate new position transaction data |
| `batchSwapTransactions` | `(swapInstructions, options) → Promise<{ transactions[], metadata[] }>` | Strategy.prepareTokens | Generate batched swap transactions with Permit2 |
| `getBestSwapQuote` | `(params) → Promise<{ amountIn, amountOut, route }>` | Strategy.prepareTokens | Get optimal swap quote via router |
| `getRequiredApprovals` | `(operationType, vaultAddress, tokenAddresses, provider) → Promise<Array>` | Strategy.ensureApprovals | Get approval transactions needed for an operation |

#### Receipt Parsing

| Method | Signature | Used By | Description |
|---|---|---|---|
| `parseClosureReceipt` | `(receipt, positionMetadata, options?) → Promise<Object>` | Strategy.closePositions | Extract principal and fees from close receipt |
| `parseCollectReceipt` | `(receipt, positionMetadata, options?) → Promise<Object>` | Strategy.collectFees | Extract fee amounts from collect receipt |
| `parseSwapReceipt` | `(receipt, swapMetadata) → Array<{ actualAmountIn, actualAmountOut }>` | Strategy.prepareTokens | Extract actual swap amounts from receipt |
| `parseIncreaseLiquidityReceipt` | `(receipt, { position, poolData }) → Object` | Strategy.addToPosition | Extract amounts consumed from liquidity receipt |

#### Swap Event Monitoring

| Method | Signature | Used By | Description |
|---|---|---|---|
| `getSwapEventFilter` | `(poolId) → { address, topics[] }` | EventManager | Get ethers-compatible event filter for pool swap events |
| `parseSwapEvent` | `(log) → { tick, sqrtPriceX96, liquidity, amount0, amount1 }` | Strategy.handleSwapEvent | Parse raw swap log into normalized data |
| `evaluatePriceMovement` | `(swapData, baseline, token0Data, token1Data) → Object` | Strategy.handleSwapEvent | Calculate price movement % from baseline |

### Optional Methods — Incentive Rewards

These have safe default implementations (return `{ active: false }` or `[]`). Override to enable platform-specific incentive support.

| Method | Default | Description |
|---|---|---|
| `getPoolIncentives(poolAddress, poolData, provider)` | `{ active: false, programs: [] }` | Check for active reward programs |
| `getIncentivePreCloseTransactions(position, incentives, provider)` | `[]` | Transactions needed before closing (e.g., unstake NFT) |
| `getIncentivePostCreateTransactions(positionId, incentives, provider)` | `[]` | Transactions needed after creating (e.g., stake NFT) |
| `getIncentiveClaimTransactions(vaultAddress, poolAddress, poolData, provider)` | `[]` | Transactions to claim accrued rewards |

Incentive lifecycle varies by platform:
- **Custody-transfer** (V3, PancakeSwap): NFT must be staked/unstaked — use pre-close and post-create methods
- **Auto-tracking** (V4, TJ, Sushi, Camelot): Rewards accrue automatically — pre-close and post-create return `[]`

## Key Data Shapes

### Position (from `getPositionsForVDS`)

```javascript
{
  id: "12345",                              // Position NFT token ID (string)
  pool: "0xABC...",                         // Pool address (V3) or poolId bytes32 (V4)
  tickLower: -276324,                       // Lower tick bound
  tickUpper: -276200,                       // Upper tick bound
  liquidity: "1234567890",                  // Position liquidity (wei string)
  feeGrowthInside0LastX128: "0",            // Fee growth tracker (string)
  feeGrowthInside1LastX128: "0",            // Fee growth tracker (string)
  tokensOwed0: "0",                         // Uncollected token0 fees (string)
  tokensOwed1: "0",                         // Uncollected token1 fees (string)
  lastUpdated: 1708000000000                // Timestamp of fetch (ms)
}
```

### Pool Metadata (from `getPositionsForVDS`)

Returned alongside positions — stable metadata only, no time-sensitive data:

```javascript
{
  "0xABC...": {                             // Keyed by pool address
    token0Symbol: "WETH",
    token1Symbol: "USDC",
    fee: 500,                               // Fee tier in basis points
    platform: "uniswapV3"
  }
}
```

### Pool Data (from `getPoolData`)

Full pool state for calculations and transaction generation:

```javascript
{
  address: "0xABC...",                      // Pool identifier
  sqrtPriceX96: "1234567890123456789",      // Current sqrt price (Q64.96 string)
  tick: -276250,                            // Current tick
  liquidity: "9876543210",                  // Active liquidity in range (string)
  fee: 500,                                 // Fee tier (basis points)
  feeGrowthGlobal0X128: "...",              // Global fee accumulator token0
  feeGrowthGlobal1X128: "...",              // Global fee accumulator token1
  lastUpdated: 1708000000000                // Timestamp of fetch (ms)
  // V3 also includes: observationIndex, observationCardinality, feeProtocol, unlocked
}
```

### Accrued Fees (from `getAccruedFeesUSD`)

```javascript
{
  totalUSD: 12.50,                          // Total fees in USD
  token0Fees: 0.005,                        // Token0 fees (formatted, not raw)
  token1Fees: 10.0,                         // Token1 fees (formatted, not raw)
  token0USD: 9.50,                          // Token0 fees in USD
  token1USD: 3.00                           // Token1 fees in USD
}
```

### Range Evaluation (from `evaluatePositionRange`)

```javascript
{
  inRange: true,                            // Is position earning fees
  centeredness: 0.65,                       // 0-1, 0.5 = perfectly centered
  distanceToUpper: 0.35,                    // Fraction to upper bound
  distanceToLower: 0.65,                    // Fraction to lower bound
  currentTick: -276250                      // Current pool tick
}
```

### Price Movement (from `evaluatePriceMovement`)

```javascript
{
  priceMovementPercent: 2.5,                // Absolute % movement
  baselinePrice: "1850.00",                 // Baseline as human-readable string
  currentPrice: "1803.75",                  // Current as human-readable string
  direction: "down"                         // 'up' or 'down'
}
```

### Closure Receipt (from `parseClosureReceipt`)

```javascript
{
  principalByPosition: {
    "12345": { amount0: BigNumber, amount1: BigNumber }
  },
  feesByPosition: {
    "12345": {
      token0: BigNumber,
      token1: BigNumber,
      metadata: { /* platform-specific */ }
    }
  }
}
```

### Swap Receipt (from `parseSwapReceipt`)

```javascript
[
  { actualAmountIn: "1000000000000000000", actualAmountOut: "1850000000" },
  // one entry per swap in the batch
]
```

### Increase Liquidity Receipt (from `parseIncreaseLiquidityReceipt`)

```javascript
{
  tokenId: "12345",                         // Position NFT ID
  liquidity: "9876543210",                  // Liquidity added
  amount0: "500000000000000000",            // Actual token0 consumed
  amount1: "925000000",                     // Actual token1 consumed
  tickLower: -276324,                       // Only for new positions (null otherwise)
  tickUpper: -276200,                       // Only for new positions (null otherwise)
  poolAddress: "0xABC..."                   // Only for new positions (null otherwise)
}
```

## Automation Service Usage Flow

This is how adapters are consumed by the strategy system in `fum_automation`:

### Vault Initialization
```
Strategy.initializeVault()
  → adapter.selectBestPool(tokenA, tokenB, provider, chainId)
  → adapter.getPoolCurrent(poolData)           // capture baseline
  → adapter.getPositionRange(poolData, upper%, lower%)
```

### Position Evaluation (on each swap event)
```
EventManager receives swap log
  → adapter.parseSwapEvent(log)
  → adapter.evaluatePriceMovement(swapData, baseline, token0Data, token1Data)
  → adapter.evaluatePositionRange(position, provider, { swapData })
  → adapter.getAccruedFeesUSD(position, tokenPrices, provider)
```

### Rebalance: Close → Swap → Create
```
Strategy.closePositions()
  → adapter.generateRemoveLiquidityData(params)    // generate tx
  → executeVaultTransactions(...)                    // execute via vault
  → adapter.parseClosureReceipt(receipt, metadata)  // extract principal + fees

Strategy.prepareTokens()
  → adapter.getOptimalTokenRatio(params)
  → adapter.getBestSwapQuote(params)
  → adapter.batchSwapTransactions(instructions, options)
  → executeVaultTransactions(...)
  → adapter.parseSwapReceipt(receipt, metadata)

Strategy.createNewPosition()
  → adapter.getRequiredApprovals('liquidity', vaultAddress, tokens, provider)
  → adapter.getPositionRange(poolData, upper%, lower%)
  → adapter.generateCreatePositionData(params)
  → executeVaultTransactions(...)
  → adapter.parseIncreaseLiquidityReceipt(receipt, context)
  → adapter.getPositionById(tokenId, provider)     // fetch for cache update
```

### Fee Collection
```
Strategy.collectFees()
  → adapter.generateClaimFeesData(params)
  → executeVaultTransactions(...)
  → adapter.parseCollectReceipt(receipt, metadata)
```

## Adding a New Adapter

### 1. Create the adapter class

```javascript
// src/adapters/NewPlatformAdapter.js
import PlatformAdapter from './PlatformAdapter.js';

export default class NewPlatformAdapter extends PlatformAdapter {
  constructor(chainId, provider) {
    super(chainId, 'newPlatform', 'New Platform');
    // Load platform addresses from chain config
    // Cache ABIs and contract interfaces
  }

  // Implement all 27 required methods...
  // Override optional incentive methods if needed...
}
```

### 2. Register with AdapterFactory

```javascript
// src/adapters/AdapterFactory.js
import NewPlatformAdapter from './NewPlatformAdapter.js';

static #PLATFORM_ADAPTERS = {
  uniswapV3: UniswapV3Adapter,
  uniswapV4: UniswapV4Adapter,
  traderjoeV2_2: TraderJoeV2_2Adapter,
  newPlatform: NewPlatformAdapter,         // Add here
};
```

### 3. Add platform configuration

In `configs/platforms.js` — add platform metadata (name, color, logo, subgraphs, fee tiers).

In `configs/chains.js` — add contract addresses under `platformAddresses.newPlatform` for each supported chain.

### 4. Export from index.js

```javascript
// src/adapters/index.js
export { default as NewPlatformAdapter } from './NewPlatformAdapter.js';
```

## Key Decisions

### Why two position methods (`getPositionsForDisplay` vs `getPositionsForVDS`)?

Each serves a different consumer with different needs. `getPositionsForDisplay` returns pre-computed display values (prices, amounts, fees, in-range status as numbers/booleans) so the frontend never interprets platform-specific pool state. `getPositionsForVDS` returns raw position data (liquidity, feeGrowthInside, tokensOwed as strings) plus minimal pool metadata for the automation cache. The VDS format excludes time-sensitive data (current tick, sqrtPriceX96) because that data is fetched fresh when needed via `getPoolData` or from swap events.

### Why separate `parseClosureReceipt` from `parseCollectReceipt`?

When closing a position (decreaseLiquidity + collect), the Collect event amounts include both principal and fees. The adapter must subtract the DecreaseLiquidity amounts to isolate fees. For standalone fee collection (collect only), the Collect amounts ARE the fees. These are fundamentally different parsing operations.

### Why `evaluatePositionRange` instead of `isPositionInRange`?

Simple in/out boolean is insufficient for strategy decisions. The strategy needs to know how centered the position is, how far it is from the bounds, and it needs to work both from fresh blockchain data and from swap event data (avoiding an extra RPC call). The `options.swapData` parameter enables the fast path.

### Why `getOptimalTokenRatio` takes value shares, not amount ratios?

Different tokens have different USD prices. A position centered at the current tick might need 50/50 by value but drastically different amounts. Returning `token0Share` and `token1Share` as fractions of total value (summing to 1.0) lets the strategy calculate amounts using current token prices.
