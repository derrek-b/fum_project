<!-- Source: src/services/theGraph.js -->
# TheGraph Service

The Graph Protocol service for querying pool data and Uniswap V4 position discovery from decentralized subgraphs.

## Overview

This module provides functions to query historical pool data (TVL, age) and Uniswap V4-specific data (pool discovery, position enumeration) from The Graph. It supports both Uniswap-native subgraphs and Messari standardized subgraphs, automatically selecting the appropriate query format based on platform configuration.

## Exports

```javascript
import {
  configureTheGraph,
  getPoolTVLAverage,
  getPoolAge,
  discoverV4Pools,
  getV4PositionsByOwner
} from 'fum_library/services/theGraph';
```

## Configuration

The Graph gateway requires an API key. Set it once at application startup via `configureTheGraph()` — all query functions read from module-level state, not per-call parameters.

### configureTheGraph

```javascript
configureTheGraph({ apiKey: string }): void
```

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `apiKey` | `string` | Yes | The Graph API key from [The Graph Studio](https://thegraph.com/studio/) |

If `apiKey` is `undefined`, the previous value is preserved. Calling any query function without a configured key throws:

```
Error: The Graph API key not configured. Call configureTheGraph({ apiKey }) or initFumLibrary({ theGraphApiKey }) first.
```

#### Example

```javascript
import { configureTheGraph } from 'fum_library/services/theGraph';

// Typically called once at app startup (or via initFumLibrary)
configureTheGraph({ apiKey: process.env.THEGRAPH_API_KEY });
```

---

## Functions

### getPoolTVLAverage

Get time-averaged Total Value Locked (TVL) for a liquidity pool over a number of past days.

#### Signature
```javascript
async getPoolTVLAverage(
  poolAddress: string,
  chainId: number,
  platformId: string,
  days: number
): Promise<number>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `poolAddress` | `string` | Yes | Pool contract address (lowercased internally) |
| `chainId` | `number` | Yes | Chain ID (e.g., `42161` for Arbitrum) |
| `platformId` | `string` | Yes | Platform identifier (e.g., `'uniswapV3'`) |
| `days` | `number` | Yes | Number of days to include in the average (positive integer) |

#### Returns

`Promise<number>` — Average TVL in USD over the specified period.

#### Throws

| Error | Condition |
|-------|-----------|
| `poolAddress must be a non-empty string` | Invalid or missing pool address |
| `chainId must be a positive integer` | Invalid chain ID |
| `platformId must be a non-empty string` | Invalid or missing platform ID |
| `days must be a positive integer` | Invalid days parameter |
| `No subgraph configured for platform X on chain Y` | Platform/chain combination not supported |
| `No historical data available for pool X` | Pool not found in subgraph |
| `Incomplete data: requested X days, got Y valid days for pool Z` | Fewer than `days` daily snapshots with `totalValueLockedUSD`/`tvlUSD > 0` |
| `The Graph API key not configured...` | `configureTheGraph` was never called |

#### Example

```javascript
import { configureTheGraph, getPoolTVLAverage } from 'fum_library/services/theGraph';

configureTheGraph({ apiKey: process.env.THEGRAPH_API_KEY });

// Get 30-day average TVL for a pool on Arbitrum
const averageTVL = await getPoolTVLAverage(
  '0xc31e54c7a869b9fcbecc14363cf510d1c41fa443',
  42161,
  'uniswapV3',
  30
);
console.log(`30-day average TVL: $${averageTVL.toLocaleString()}`);
```

---

### getPoolAge

Get the creation timestamp of a liquidity pool.

#### Signature
```javascript
async getPoolAge(
  poolAddress: string,
  chainId: number,
  platformId: string
): Promise<number>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `poolAddress` | `string` | Yes | Pool contract address (lowercased internally) |
| `chainId` | `number` | Yes | Chain ID |
| `platformId` | `string` | Yes | Platform identifier |

#### Returns

`Promise<number>` — Pool creation timestamp in seconds (Unix timestamp).

#### Throws

| Error | Condition |
|-------|-----------|
| `poolAddress must be a non-empty string` | Invalid or missing pool address |
| `chainId must be a positive integer` | Invalid chain ID |
| `platformId must be a non-empty string` | Invalid or missing platform ID |
| `No subgraph configured for platform X on chain Y` | Platform/chain combination not supported |
| `Pool X not found` | Pool doesn't exist in subgraph |
| `No creation timestamp available for pool X` | Timestamp data missing |
| `The Graph API key not configured...` | `configureTheGraph` was never called |

#### Example

```javascript
const createdTimestamp = await getPoolAge(
  '0xc31e54c7a869b9fcbecc14363cf510d1c41fa443',
  42161,
  'uniswapV3'
);

const createdDate = new Date(createdTimestamp * 1000);
const ageInDays = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
console.log(`Pool age: ${ageInDays} days`);
```

---

### discoverV4Pools

Discover Uniswap V4 pools for a token pair. Filters to vanilla pools only (hooks = `AddressZero`) with non-zero liquidity. Results are sorted by liquidity descending.

#### Signature
```javascript
async discoverV4Pools(
  token0Address: string,
  token1Address: string,
  chainId: number,
  options?: { limit?: number }
): Promise<Array<V4Pool>>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `token0Address` | `string` | Yes | First token address (must be the lower-address-sorted token0) |
| `token1Address` | `string` | Yes | Second token address (must be the higher-address-sorted token1) |
| `chainId` | `number` | Yes | Chain ID |
| `options.limit` | `number` | No (default `10`) | Maximum number of pools to return |

Addresses are lowercased internally for the subgraph query.

#### Returns

`Promise<Array<V4Pool>>` — Pool objects sorted by liquidity (highest first). Each pool object:

```javascript
{
  id: string,                   // Pool bytes32 PoolId
  token0: { id, symbol, decimals },
  token1: { id, symbol, decimals },
  feeTier: string,              // Fee tier in basis points
  tickSpacing: string,
  liquidity: string,            // Active in-range liquidity
  sqrtPrice: string,            // Current sqrt price (Q64.96)
  tick: string,                 // Current tick
  hooks: string,                // Always AddressZero (filter)
  totalValueLockedUSD: string
}
```

Returns `[]` if no pools match.

#### Throws

| Error | Condition |
|-------|-----------|
| `token0Address must be a non-empty string` | Missing/invalid token0 |
| `token1Address must be a non-empty string` | Missing/invalid token1 |
| `chainId must be a positive integer` | Invalid chain ID |
| `No V4 subgraph configured for chain X` | V4 subgraph unavailable on the chain |

#### Example

```javascript
import { discoverV4Pools } from 'fum_library/services/theGraph';

// Token order matters — ensure sorted low-to-high by address
const weth = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const usdc = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const [t0, t1] = weth.toLowerCase() < usdc.toLowerCase() ? [weth, usdc] : [usdc, weth];

const pools = await discoverV4Pools(t0, t1, 42161, { limit: 5 });
console.log(`Found ${pools.length} vanilla V4 pools`);
```

---

### getV4PositionsByOwner

Get V4 position tokenIds owned by an address.

V4 `PositionManager` does not implement `ERC721Enumerable`, so on-chain enumeration via `tokenOfOwnerByIndex` is unavailable. This function uses The Graph to discover tokenIds.

#### Signature
```javascript
async getV4PositionsByOwner(
  ownerAddress: string,
  chainId: number,
  options?: { limit?: number }
): Promise<Array<string>>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `ownerAddress` | `string` | Yes | Owner wallet/vault address (lowercased internally) |
| `chainId` | `number` | Yes | Chain ID |
| `options.limit` | `number` | No (default `100`) | Maximum number of positions to return |

#### Returns

`Promise<Array<string>>` — Array of tokenId strings, sorted by tokenId descending. Returns `[]` if none.

#### Throws

| Error | Condition |
|-------|-----------|
| `ownerAddress must be a non-empty string` | Missing/invalid owner |
| `chainId must be a positive integer` | Invalid chain ID |
| `No V4 subgraph configured for chain X` | V4 subgraph unavailable on the chain |

#### Example

```javascript
const tokenIds = await getV4PositionsByOwner(
  vaultAddress,
  42161
);
console.log(`Vault owns ${tokenIds.length} V4 positions`);

// Use with adapter to fetch full position data
for (const tokenId of tokenIds) {
  const { position, poolData } = await v4Adapter.getPositionById(tokenId, provider);
}
```

---

## Subgraph Types

The service automatically detects and uses the appropriate query format based on subgraph configuration.

### Messari Subgraphs

Standardized subgraphs following Messari's schema. Uses:
- `liquidityPoolDailySnapshots` for TVL history
- `liquidityPool.createdTimestamp` for pool age
- Field: `totalValueLockedUSD`

### Uniswap Native Subgraphs

Official Uniswap subgraphs. Uses:
- `poolDayDatas` for TVL history
- `pool.createdAtTimestamp` for pool age
- Field: `tvlUSD`

### V4 Subgraph Queries

`discoverV4Pools` and `getV4PositionsByOwner` target Uniswap's V4 subgraph with schemas specific to V4 (`pools` with `hooks`/`tickSpacing`/`feeTier`, `positions` with `tokenId`/`owner`). Only enabled when a V4 subgraph is configured for the target chain.

## Configuration Source

Subgraph IDs and query types are defined in `configs/platforms.js` under each platform's `subgraphs` property:

```javascript
{
  uniswapV3: {
    subgraphs: {
      42161: {
        id: 'subgraph-id-here',
        queryType: 'uniswap'  // or 'messari'
      }
    }
  }
}
```

## API Endpoint

All queries are sent to The Graph's gateway:

```
https://gateway-arbitrum.network.thegraph.com/api/{apiKey}/subgraphs/id/{subgraphId}
```

The API key is taken from module-level state (see [Configuration](#configuration)).

## See Also

- [`coingecko`](./coingecko.md) — Token price service
- [`merkl`](./merkl.md) — Merkl incentive campaign detection for V4
- [TheGraph Documentation](https://thegraph.com/docs/)
