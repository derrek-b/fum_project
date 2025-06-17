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
| config.apiKey | `string` | No | null | Direct API key for CoinGecko |
| config.useFreeTier | `boolean` | No | true | Whether to use free tier if no API key |

#### Example

```javascript
import { configureCoingecko } from './services/coingecko.js';

// Configure with API key
configureCoingecko({
  apiKey: 'your-api-key',
  useFreeTier: false
});

// Configure for free tier
configureCoingecko({
  useFreeTier: true
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

`string` - CoinGecko ID for the token

#### Throws

| Error | Condition |
|-------|-----------|
| `Error` | Token symbol is required and cannot be empty |
| `Error` | Unknown token symbol (not in symbolToIdMap) |

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

// Now throws instead of returning fallback
try {
  getCoingeckoId('UNKNOWN'); // Throws Error
} catch (error) {
  console.error(error.message); // "Unknown token symbol: UNKNOWN. Add mapping to symbolToIdMap..."
}

// Empty symbol also throws
try {
  getCoingeckoId(''); // Throws Error
} catch (error) {
  console.error(error.message); // "Token symbol is required and cannot be empty"
}
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

Fetches current token prices from CoinGecko with explicit cache strategy.

#### Signature
```javascript
async fetchTokenPrices(tokenSymbols: string[], cacheStrategy: string, currency?: string): Promise<Object>
```

#### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| tokenSymbols | `string[]` | Yes | - | Array of token symbols |
| cacheStrategy | `string` | Yes | - | Required cache strategy: '0-SECONDS', '5-SECONDS', '30-SECONDS', '2-MINUTES', '1-MINUTE', '10-MINUTES' |
| currency | `string` | No | 'usd' | Currency to get prices in |

#### Cache Strategies

| Strategy | Use Case | Cache Duration |
|----------|----------|----------------|
| '0-SECONDS' | Critical transactions | No cache - always fresh |
| '5-SECONDS' | Active liquidity management | 5 seconds |
| '30-SECONDS' | Trading decisions | 30 seconds |
| '1-MINUTE' | Background automation | 1 minute |
| '2-MINUTES' | Dashboard/portfolio view | 2 minutes |
| '10-MINUTES' | Error fallback only | 10 minutes |

#### Returns

`Promise<Object>` - Token prices keyed by uppercase symbol

#### Throws

| Error | Condition |
|-------|-----------|
| `Error` | cacheStrategy not provided or invalid |
| `Error` | API key not configured and free tier disabled |
| `Error` | Unknown token symbol (via getCoingeckoId) |
| `Error` | API request fails |

#### Example

```javascript
// For critical transactions - always fresh
const prices = await fetchTokenPrices(['ETH', 'USDC'], '0-SECONDS');
// { ETH: 2345.67, USDC: 1.00 }

// For liquidity management - 5 second tolerance
const lpPrices = await fetchTokenPrices(['ETH', 'DAI'], '5-SECONDS');
// { ETH: 2345.67, DAI: 0.999 }

// For dashboard display - 2 minute tolerance
const dashboardPrices = await fetchTokenPrices(['ETH', 'USDC', 'DAI'], '2-MINUTES');

// Fetch with different currency
const eurPrices = await fetchTokenPrices(['ETH'], '30-SECONDS', 'eur');
// { ETH: 2150.34 }

// Missing cacheStrategy causes error
try {
  const prices = await fetchTokenPrices(['ETH']); // Error!
} catch (error) {
  console.error(error.message); // "cacheStrategy is required..."
}

// Unknown tokens cause errors
try {
  const prices = await fetchTokenPrices(['ETH', 'UNKNOWN_TOKEN'], '1-MINUTE');
  // Will throw: "Unknown token symbol: UNKNOWN_TOKEN"
} catch (error) {
  console.error('Failed to fetch prices:', error.message);
}
```

### prefetchTokenPrices

Prefetches and caches prices for a list of tokens without returning them.

**⚠️ Note**: This function is currently broken in the codebase as it calls `fetchTokenPrices` without the required `cacheStrategy` parameter.

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
// prefetchTokenPrices is broken - use fetchTokenPrices instead
await fetchTokenPrices(['ETH', 'USDC', 'DAI', 'WBTC'], '2-MINUTES');

// Prices are now cached for fast access
const usdcValue = calculateUsdValueSync(100, 'USDC'); // Uses cached price
```

## Value Calculations

### calculateUsdValue

Calculates USD value of a token amount (async, fetches price if needed).

**⚠️ Note**: This function is currently broken in the codebase as it calls `fetchTokenPrices` without the required `cacheStrategy` parameter.

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
await fetchTokenPrices(['ETH', 'USDC'], '1-MINUTE');

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
  const prices = await fetchTokenPrices(['ETH', 'INVALID'], '1-MINUTE');
} catch (error) {
  if (error.message.includes('cacheStrategy is required')) {
    console.error('Must provide cache strategy');
  } else if (error.message.includes('Invalid cacheStrategy')) {
    console.error('Invalid cache strategy provided');
  } else if (error.message.includes('API key not configured')) {
    // Configure for free tier
    configureCoingecko({ useFreeTier: true });
  } else if (error.message.includes('Unknown token symbol')) {
    console.error('Token not mapped:', error);
  } else if (error.message.includes('CoinGecko API returned')) {
    console.error('API request failed:', error);
    // No cached data returned - must handle failure
  } else {
    console.error('Price fetch failed:', error);
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
  apiKey: process.env.COINGECKO_API_KEY
});

// Note: prefetchTokenPrices is currently broken in the codebase
// It calls fetchTokenPrices without the required cacheStrategy parameter
// Use fetchTokenPrices directly instead:
await fetchTokenPrices(['ETH', 'USDC', 'DAI', 'WBTC'], '2-MINUTES');
```

### Portfolio Value Calculation
```javascript
async function calculatePortfolioValue(holdings) {
  const symbols = Object.keys(holdings);
  // Use appropriate cache strategy based on your needs
  const prices = await fetchTokenPrices(symbols, '30-SECONDS');
  
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
  // Use 0-SECONDS to always get fresh data for display
  const prices = await fetchTokenPrices(['ETH', 'USDC'], '0-SECONDS');
  updatePriceDisplay(prices);
}, 5 * 60 * 1000);
```

## See Also

- [Token Helpers](../helpers/token-helpers.md) - Token utility functions
- [Format Helpers](../helpers/format-helpers.md) - Price formatting utilities
- [CoinGecko API Documentation](https://www.coingecko.com/en/api/documentation)