# TheGraph Service

The Graph Protocol service for querying pool data from decentralized subgraphs.

## Overview

This module provides functions to query historical pool data from TheGraph Protocol. It supports both Uniswap-native subgraphs and Messari standardized subgraphs, automatically selecting the appropriate query format based on platform configuration.

## Functions

### getPoolTVLAverage

Get time-averaged Total Value Locked (TVL) for a liquidity pool.

```javascript
import { getPoolTVLAverage } from 'fum_library/services';

const averageTVL = await getPoolTVLAverage(
  poolAddress,  // Pool contract address
  chainId,      // Chain ID (e.g., 42161 for Arbitrum)
  platformId,   // Platform ID (e.g., 'uniswapV3')
  days,         // Number of days to average
  apiKey        // TheGraph API key
);
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `poolAddress` | `string` | Pool contract address (will be lowercased) |
| `chainId` | `number` | Chain ID (1 for Ethereum, 42161 for Arbitrum, etc.) |
| `platformId` | `string` | Platform identifier (e.g., `'uniswapV3'`) |
| `days` | `number` | Number of days to include in the average (positive integer) |
| `apiKey` | `string` | TheGraph API key from [The Graph Studio](https://thegraph.com/studio/) |

#### Returns

`Promise<number>` - Average TVL in USD over the specified period.

#### Errors

| Error | Condition |
|-------|-----------|
| `poolAddress must be a non-empty string` | Invalid or missing pool address |
| `chainId must be a positive integer` | Invalid chain ID |
| `platformId must be a non-empty string` | Invalid or missing platform ID |
| `days must be a positive integer` | Invalid days parameter |
| `apiKey must be a non-empty string` | Missing API key |
| `No subgraph configured for platform X on chain Y` | Platform/chain combination not supported |
| `No historical data available for pool X` | Pool not found in subgraph |
| `Incomplete data: requested X days, got Y valid days` | Insufficient historical data |

#### Example

```javascript
import { getPoolTVLAverage } from 'fum_library/services';

// Get 30-day average TVL for WETH/USDC pool on Arbitrum
const poolAddress = '0xc31e54c7a869b9fcbecc14363cf510d1c41fa443';
const averageTVL = await getPoolTVLAverage(
  poolAddress,
  42161,           // Arbitrum
  'uniswapV3',
  30,              // 30 days
  process.env.THEGRAPH_API_KEY
);

console.log(`30-day average TVL: $${averageTVL.toLocaleString()}`);
```

---

### getPoolAge

Get the creation timestamp of a liquidity pool.

```javascript
import { getPoolAge } from 'fum_library/services';

const createdTimestamp = await getPoolAge(
  poolAddress,  // Pool contract address
  chainId,      // Chain ID
  platformId,   // Platform ID
  apiKey        // TheGraph API key
);
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `poolAddress` | `string` | Pool contract address (will be lowercased) |
| `chainId` | `number` | Chain ID (1 for Ethereum, 42161 for Arbitrum, etc.) |
| `platformId` | `string` | Platform identifier (e.g., `'uniswapV3'`) |
| `apiKey` | `string` | TheGraph API key |

#### Returns

`Promise<number>` - Pool creation timestamp in seconds (Unix timestamp).

#### Errors

| Error | Condition |
|-------|-----------|
| `poolAddress must be a non-empty string` | Invalid or missing pool address |
| `chainId must be a positive integer` | Invalid chain ID |
| `platformId must be a non-empty string` | Invalid or missing platform ID |
| `apiKey must be a non-empty string` | Missing API key |
| `No subgraph configured for platform X on chain Y` | Platform/chain combination not supported |
| `Pool X not found` | Pool doesn't exist in subgraph |
| `No creation timestamp available for pool X` | Timestamp data missing |

#### Example

```javascript
import { getPoolAge } from 'fum_library/services';

const poolAddress = '0xc31e54c7a869b9fcbecc14363cf510d1c41fa443';
const createdTimestamp = await getPoolAge(
  poolAddress,
  42161,
  'uniswapV3',
  process.env.THEGRAPH_API_KEY
);

const createdDate = new Date(createdTimestamp * 1000);
const ageInDays = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));

console.log(`Pool created: ${createdDate.toISOString()}`);
console.log(`Pool age: ${ageInDays} days`);
```

## Subgraph Types

The service automatically detects and uses the appropriate query format based on subgraph configuration:

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

## Configuration

Subgraph IDs and query types are configured in `configs/platforms.js` under each platform's `subgraphs` property:

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

All queries are sent to TheGraph's gateway:
```
https://gateway-arbitrum.network.thegraph.com/api/{apiKey}/subgraphs/id/{subgraphId}
```

## See Also

- [`coingecko`](./coingecko.md) - Token price service
- [TheGraph Documentation](https://thegraph.com/docs/)
