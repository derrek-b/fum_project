# CoinGecko Service API

Token price data service providing real-time cryptocurrency prices, caching, and value calculations.

## Overview

The CoinGecko service integrates with the CoinGecko API to provide token price data for the FUM Library. It includes intelligent caching, automatic token symbol mapping, and both synchronous and asynchronous price calculation methods.

## Configuration

### configureCoingecko

Configures the CoinGecko service with custom settings.

#### Signature
```javascript
configureCoingecko(config: Object): void
```

#### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| config | `Object` | No | {} | Configuration options |
| config.apiBaseUrl | `string` | No | 'https://api.coingecko.com/api/v3' | Base URL for CoinGecko API |
| config.cacheExpiryTime | `number` | No | 300000 (5 min) | Cache expiry time in milliseconds |
| config.apiKey | `string` | No | null | Direct API key for CoinGecko |
| config.useFreeTier | `boolean` | No | true | Whether to use free tier if no API key |

#### Example

```javascript
import { configureCoingecko } from './services/coingecko.js';

// Configure with API key
configureCoingecko({
  apiKey: 'your-api-key',
  cacheExpiryTime: 10 * 60 * 1000, // 10 minutes
  useFreeTier: false
});

// Configure for free tier
configureCoingecko({
  useFreeTier: true,
  cacheExpiryTime: 5 * 60 * 1000 // 5 minutes
});
```

### setApiKey

Sets the API key directly without full reconfiguration.

#### Signature
```javascript
setApiKey(apiKey: string): void
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| apiKey | `string` | Yes | The CoinGecko API key |

#### Example

```javascript
setApiKey('your-coingecko-api-key');
```

## Token Mapping

### getCoingeckoId

Maps a token symbol to its CoinGecko ID.

#### Signature
```javascript
getCoingeckoId(symbol: string): string
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| symbol | `string` | Yes | Token symbol (e.g., "USDC") |

#### Returns

`string` - CoinGecko ID or lowercase symbol as fallback

#### Built-in Mappings

| Symbol | CoinGecko ID |
|--------|--------------|
| ETH/WETH | ethereum |
| USDC | usd-coin |
| USDT | tether |
| DAI | dai |
| WBTC | wrapped-bitcoin |
| ... | ... |

#### Example

```javascript
getCoingeckoId('USDC'); // "usd-coin"
getCoingeckoId('ETH'); // "ethereum"
getCoingeckoId('UNKNOWN'); // "unknown" (fallback)
```

### registerTokenMapping

Registers a custom token symbol to CoinGecko ID mapping.

#### Signature
```javascript
registerTokenMapping(symbol: string, coingeckoId: string): void
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| symbol | `string` | Yes | Token symbol |
| coingeckoId | `string` | Yes | CoinGecko ID |

#### Example

```javascript
// Register custom token
registerTokenMapping('MYTOKEN', 'my-custom-token');

// Now getCoingeckoId will use this mapping
getCoingeckoId('MYTOKEN'); // "my-custom-token"
```

## Price Fetching

### fetchTokenPrices

Fetches current token prices from CoinGecko with caching.

#### Signature
```javascript
async fetchTokenPrices(tokenSymbols: string[], currency?: string, bypassCache?: boolean): Promise<Object>
```

#### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| tokenSymbols | `string[]` | Yes | - | Array of token symbols |
| currency | `string` | No | 'usd' | Currency to get prices in |
| bypassCache | `boolean` | No | false | Whether to bypass the cache |

#### Returns

`Promise<Object>` - Token prices keyed by uppercase symbol

#### Throws

| Error | Condition |
|-------|-----------|
| `Error` | API key not configured and free tier disabled |
| `Error` | API request fails (returns cached data if available) |

#### Example

```javascript
// Fetch multiple token prices
const prices = await fetchTokenPrices(['ETH', 'USDC', 'DAI']);
// { ETH: 2345.67, USDC: 1.00, DAI: 0.999 }

// Fetch with different currency
const eurPrices = await fetchTokenPrices(['ETH'], 'eur');
// { ETH: 2150.34 }

// Force fresh data
const freshPrices = await fetchTokenPrices(['ETH'], 'usd', true);
```

### prefetchTokenPrices

Prefetches and caches prices for a list of tokens without returning them.

#### Signature
```javascript
async prefetchTokenPrices(symbols: string[]): Promise<void>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| symbols | `string[]` | Yes | Array of token symbols to prefetch |

#### Example

```javascript
// Prefetch common tokens on app startup
await prefetchTokenPrices(['ETH', 'USDC', 'DAI', 'WBTC']);

// Prices are now cached for fast access
const usdcValue = calculateUsdValueSync(100, 'USDC'); // Uses cached price
```

## Value Calculations

### calculateUsdValue

Calculates USD value of a token amount (async, fetches price if needed).

#### Signature
```javascript
async calculateUsdValue(amount: string | number, symbol: string): Promise<number | null>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| amount | `string \| number` | Yes | Token amount |
| symbol | `string` | Yes | Token symbol |

#### Returns

`Promise<number | null>` - USD value or null if price not available

#### Example

```javascript
// Calculate value of 10 ETH
const ethValue = await calculateUsdValue(10, 'ETH');
// 23456.7 (10 * 2345.67)

// Calculate value with string amount
const usdcValue = await calculateUsdValue('1000.50', 'USDC');
// 1000.5

// Unknown token
const unknownValue = await calculateUsdValue(100, 'UNKNOWN');
// null
```

### calculateUsdValueSync

Calculates USD value synchronously using only cached prices.

#### Signature
```javascript
calculateUsdValueSync(amount: string | number, symbol: string): number | null
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| amount | `string \| number` | Yes | Token amount |
| symbol | `string` | Yes | Token symbol |

#### Returns

`number | null` - USD value or null if price not in cache

#### Example

```javascript
// Ensure prices are cached first
await fetchTokenPrices(['ETH', 'USDC']);

// Calculate synchronously
const ethValue = calculateUsdValueSync(5, 'ETH');
// 11728.35 (5 * 2345.67)

// Not in cache
const btcValue = calculateUsdValueSync(1, 'BTC');
// null (unless BTC was previously fetched)
```

## Cache Management

### getPriceCache

Returns the current price cache with metadata.

#### Signature
```javascript
getPriceCache(): Object
```

#### Returns

`Object` - Current cached prices with `_cacheAge` in seconds

#### Example

```javascript
const cache = getPriceCache();
// {
//   ETH: 2345.67,
//   USDC: 1.00,
//   DAI: 0.999,
//   _cacheAge: 120 // seconds since last update
// }
```

### clearPriceCache

Clears all cached price data.

#### Signature
```javascript
clearPriceCache(): void
```

#### Example

```javascript
// Clear cache to force fresh data
clearPriceCache();

// Next fetch will retrieve new prices
const prices = await fetchTokenPrices(['ETH']);
```

## Service Status

### isConfigured

Checks if the service is properly configured and ready to use.

#### Signature
```javascript
isConfigured(): boolean
```

#### Returns

`boolean` - Whether the service is ready (has API key or free tier enabled)

#### Example

```javascript
if (!isConfigured()) {
  console.warn('CoinGecko service not configured');
  configureCoingecko({ useFreeTier: true });
}
```

## Error Handling

```javascript
try {
  const prices = await fetchTokenPrices(['ETH', 'INVALID']);
} catch (error) {
  if (error.message.includes('API key not configured')) {
    // Configure for free tier
    configureCoingecko({ useFreeTier: true });
  } else {
    console.error('Price fetch failed:', error);
    // May still get cached prices in the response
  }
}
```

## Best Practices

1. **Configuration**: Configure the service on app initialization
2. **Prefetching**: Prefetch common token prices for better UX
3. **Caching**: Use sync methods when prices are pre-cached
4. **Error Handling**: Always handle price fetch failures gracefully
5. **Rate Limiting**: Respect API rate limits, especially on free tier

## Usage Patterns

### Application Initialization
```javascript
// On app start
configureCoingecko({
  apiKey: process.env.COINGECKO_API_KEY,
  cacheExpiryTime: 10 * 60 * 1000 // 10 minutes
});

// Prefetch common tokens
await prefetchTokenPrices(['ETH', 'USDC', 'DAI', 'WBTC']);
```

### Portfolio Value Calculation
```javascript
async function calculatePortfolioValue(holdings) {
  const symbols = Object.keys(holdings);
  const prices = await fetchTokenPrices(symbols);
  
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

### Real-time Price Display
```javascript
// Update prices every 5 minutes
setInterval(async () => {
  const prices = await fetchTokenPrices(['ETH', 'USDC'], 'usd', true);
  updatePriceDisplay(prices);
}, 5 * 60 * 1000);
```

## See Also

- [Token Helpers](../helpers/token-helpers.md) - Token utility functions
- [Format Helpers](../helpers/format-helpers.md) - Price formatting utilities
- [CoinGecko API Documentation](https://www.coingecko.com/en/api/documentation)