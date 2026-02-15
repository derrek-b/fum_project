# CoinGecko Service API

Token price data service providing real-time cryptocurrency prices with intelligent caching.

## Overview

The CoinGecko service integrates with the CoinGecko API to provide token price data for the FUM Library. It includes intelligent per-token caching with configurable durations and fail-fast error handling for financial operations.

## Exports

```javascript
import {
  fetchTokenPrices,
  clearPriceCache,
  buildApiUrl,
  ENDPOINTS,
  CACHE_DURATIONS,
  priceCache
} from 'fum_library/services/coingecko';
```

## Configuration

The service uses environment variables for configuration:

| Environment Variable | Required | Description |
|---------------------|----------|-------------|
| `COINGECKO_API_KEY` | No | API key for CoinGecko (uses free tier if not provided) |

## Constants

### CACHE_DURATIONS

Pre-defined cache duration values in milliseconds for common use cases.

```javascript
export const CACHE_DURATIONS = {
  '0-SECONDS': 0,           // No cache - always fresh (critical transactions)
  '1-SECOND': 1000,         // 1 second (high-frequency trading)
  '2-SECONDS': 2000,        // 2 seconds (ultra-fast execution)
  '5-SECONDS': 5000,        // 5 seconds (active liquidity management)
  '10-SECONDS': 10000,      // 10 seconds (rapid decision making)
  '15-SECONDS': 15000,      // 15 seconds (quick updates)
  '30-SECONDS': 30000,      // 30 seconds (trading decisions)
  '1-MINUTE': 60000,        // 1 minute (background automation)
  '2-MINUTES': 120000,      // 2 minutes (dashboard/portfolio view)
  '5-MINUTES': 300000,      // 5 minutes (periodic monitoring)
  '10-MINUTES': 600000      // 10 minutes (error fallback only)
};
```

**Usage:**
```javascript
import { CACHE_DURATIONS, fetchTokenPrices } from 'fum_library/services/coingecko';

// Use predefined durations
const prices = await fetchTokenPrices(['WETH', 'USDC'], CACHE_DURATIONS['5-SECONDS']);

// Or use custom milliseconds
const prices = await fetchTokenPrices(['WETH', 'USDC'], 1500);
```

### ENDPOINTS

CoinGecko API endpoint constants.

```javascript
export const ENDPOINTS = {
  SIMPLE_PRICE: '/simple/price',
  COIN_DETAILS: '/coins/{id}',
  COIN_HISTORY: '/coins/{id}/history',
  EXCHANGES: '/exchanges',
  EXCHANGE_RATES: '/exchange_rates',
  GLOBAL_DATA: '/global'
};
```

## Functions

### fetchTokenPrices

Fetches current token prices from CoinGecko with explicit cache duration.

#### Signature
```javascript
async fetchTokenPrices(tokenSymbols: string[], cacheDurationMs: number): Promise<Object>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| tokenSymbols | `string[]` | Yes | Array of token symbols (e.g., ['WETH', 'USDC']) |
| cacheDurationMs | `number` | Yes | Cache duration in milliseconds (0 = no cache) |

#### Returns

`Promise<Object>` - Token prices keyed by uppercase symbol

```javascript
{
  WETH: 2345.67,
  USDC: 1.00
}
```

#### Throws

| Error | Condition |
|-------|-----------|
| `Error` | tokenSymbols is null, undefined, or not an array |
| `Error` | Any token symbol is null, undefined, empty, or not a string |
| `Error` | cacheDurationMs is null, undefined, not a number, or negative |
| `Error` | Unknown token symbol (not in tokenHelpers mapping) |
| `Error` | API request fails |
| `Error` | No price data returned for a token |

#### Examples

```javascript
import { fetchTokenPrices, CACHE_DURATIONS } from 'fum_library/services/coingecko';

// For critical transactions - always fresh
const prices = await fetchTokenPrices(['WETH', 'USDC'], CACHE_DURATIONS['0-SECONDS']);
// { WETH: 2345.67, USDC: 1.00 }

// For liquidity management - 5 second tolerance
const lpPrices = await fetchTokenPrices(['WETH', 'DAI'], CACHE_DURATIONS['5-SECONDS']);

// For dashboard display - 2 minute tolerance
const dashboardPrices = await fetchTokenPrices(['WETH', 'USDC', 'DAI'], CACHE_DURATIONS['2-MINUTES']);

// Custom cache duration (1.5 seconds)
const prices = await fetchTokenPrices(['WETH', 'USDC'], 1500);

// Missing parameters cause errors
try {
  await fetchTokenPrices(['WETH']); // Error - missing cacheDurationMs!
} catch (error) {
  console.error(error.message); // "cacheDurationMs parameter is required"
}

// Unknown tokens cause errors
try {
  await fetchTokenPrices(['WETH', 'UNKNOWN_TOKEN'], 5000);
} catch (error) {
  console.error('Failed:', error.message);
}
```

#### Caching Behavior

- Uses per-token caching with individual timestamps
- Returns cached data only if ALL requested tokens are fresh
- If any token is stale or missing, fetches all tokens fresh
- Cache is updated atomically after successful fetch

---

### clearPriceCache

Clears all cached price data.

#### Signature
```javascript
clearPriceCache(): void
```

#### Example

```javascript
import { clearPriceCache, fetchTokenPrices } from 'fum_library/services/coingecko';

// Clear cache to force fresh data
clearPriceCache();

// Next fetch will retrieve new prices from API
const prices = await fetchTokenPrices(['WETH'], 5000);
```

---

### buildApiUrl

Builds a CoinGecko API URL with authentication and query parameters.

#### Signature
```javascript
buildApiUrl(endpoint: string, params?: Object): string
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| endpoint | `string` | Yes | API endpoint (must be from ENDPOINTS) |
| params | `Object` | No | Query parameters as key-value pairs |

#### Returns

`string` - Full API URL with authentication and parameters

#### Throws

| Error | Condition |
|-------|-----------|
| `Error` | Endpoint is not provided |
| `Error` | Endpoint is not in approved ENDPOINTS list |
| `Error` | Parameter value is null, undefined, or an object |

#### Example

```javascript
import { buildApiUrl, ENDPOINTS } from 'fum_library/services/coingecko';

const url = buildApiUrl(ENDPOINTS.SIMPLE_PRICE, {
  ids: 'ethereum,usd-coin',
  vs_currencies: 'usd'
});
// "https://api.coingecko.com/api/v3/simple/price?x_cg_demo_api_key=...&ids=ethereum,usd-coin&vs_currencies=usd"

// Template endpoints with ID substitution
const coinUrl = buildApiUrl('/coins/ethereum', {});
// "https://api.coingecko.com/api/v3/coins/ethereum?x_cg_demo_api_key=..."
```

---

### priceCache

Direct access to the price cache object. Contains cached prices with timestamps.

#### Structure
```javascript
{
  'WETH': { price: 2345.67, timestamp: 1700000000000 },
  'USDC': { price: 1.00, timestamp: 1700000000000 }
}
```

---

## Token Symbol Mapping

Token symbols are mapped to CoinGecko IDs using the `getCoingeckoId()` function from `tokenHelpers.js`. See [Token Helpers](../helpers/token-helpers.md) for supported tokens and how to add new mappings.

## Error Handling

The service uses fail-fast error handling - it never returns stale cached data on API failures. This is intentional for financial applications where stale prices could lead to incorrect trading decisions.

```javascript
import { fetchTokenPrices, CACHE_DURATIONS } from 'fum_library/services/coingecko';

try {
  const prices = await fetchTokenPrices(['WETH', 'INVALID'], CACHE_DURATIONS['1-MINUTE']);
} catch (error) {
  if (error.message.includes('cacheDurationMs parameter is required')) {
    console.error('Must provide cache duration');
  } else if (error.message.includes('must be a valid number')) {
    console.error('Invalid cache duration value');
  } else if (error.message.includes('Unsupported token')) {
    console.error('Token not mapped to CoinGecko ID');
  } else if (error.message.includes('CoinGecko API returned')) {
    console.error('API request failed');
  } else if (error.message.includes('Failed to fetch current token prices')) {
    console.error('Price fetch failed - cannot use stale data');
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Best Practices

1. **Use Appropriate Cache Durations**:
   - Critical transactions: `CACHE_DURATIONS['0-SECONDS']`
   - Active trading: `CACHE_DURATIONS['5-SECONDS']`
   - Background operations: `CACHE_DURATIONS['1-MINUTE']`
   - Dashboard display: `CACHE_DURATIONS['2-MINUTES']`

2. **Always Handle Errors**: Never assume price fetching will succeed

3. **Respect Rate Limits**: Use longer cache durations when possible, especially on free tier

4. **Batch Token Requests**: Fetch multiple tokens in one call rather than individual calls

## Usage Patterns

### Application Initialization
```javascript
import { fetchTokenPrices, CACHE_DURATIONS } from 'fum_library/services/coingecko';

// Pre-warm cache on app start
await fetchTokenPrices(['WETH', 'USDC', 'DAI', 'WBTC', 'ARB'], CACHE_DURATIONS['2-MINUTES']);
```

### Portfolio Value Calculation
```javascript
async function calculatePortfolioValue(holdings) {
  const symbols = Object.keys(holdings);
  const prices = await fetchTokenPrices(symbols, CACHE_DURATIONS['30-SECONDS']);

  let totalValue = 0;
  for (const [symbol, amount] of Object.entries(holdings)) {
    const price = prices[symbol.toUpperCase()];
    if (price) {
      totalValue += amount * price;
    }
  }

  return totalValue;
}
```

### Automation Service Integration
```javascript
import { fetchTokenPrices, CACHE_DURATIONS } from 'fum_library/services/coingecko';

// For vault asset valuation (needs fresh data for decisions)
const prices = await fetchTokenPrices(tokenSymbols, CACHE_DURATIONS['5-SECONDS']);

// For tracking/logging (can use longer cache)
const prices = await fetchTokenPrices(tokenSymbols, CACHE_DURATIONS['2-MINUTES']);
```

## See Also

- [Token Helpers](../helpers/token-helpers.md) - Token configuration and symbol mapping
- [Format Helpers](../helpers/format-helpers.md) - Price formatting utilities
- [CoinGecko API Documentation](https://www.coingecko.com/en/api/documentation)
