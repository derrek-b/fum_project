# Token Helpers API

Token management utilities for querying, filtering, and managing token configurations across multiple chains.

## Overview

The Token Helpers module provides comprehensive utilities for working with ERC-20 tokens in the FUM Library. It manages token metadata, chain-specific addresses, and token classifications (stablecoins vs. volatile tokens).

## Functions

---

## getAllTokens

Get all configured tokens.

### Signature
```javascript
getAllTokens(): Object
```

### Parameters

None

### Returns

`Object` - Token object with token symbols as keys, each containing name, symbol, decimals, addresses, and metadata

### Return Object Structure
```javascript
{
  [symbol]: {
    symbol: string,           // Token symbol (e.g., "USDC")
    name: string,            // Full token name
    decimals: number,        // Token decimals
    addresses: {             // Chain-specific addresses
      [chainId]: string      // Contract address on specific chain
    },
    isStablecoin: boolean,   // Token classification
    logoURI?: string         // Optional logo URL
  }
}
```

### Examples

```javascript
// Get all configured tokens
const tokens = getAllTokens();
// Returns: { 
//   ETH: { symbol: "ETH", name: "Ethereum", decimals: 18, addresses: {...} },
//   USDC: { symbol: "USDC", name: "USD Coin", decimals: 6, addresses: {...} },
//   ...
// }

// Iterate through all tokens
Object.values(getAllTokens()).forEach(token => {
  console.log(`${token.name} (${token.symbol})`);
});
```

### Side Effects
None - Pure function

---

## getTokenBySymbol

Get token information by its symbol.

### Signature
```javascript
getTokenBySymbol(symbol: string): Object | null
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| symbol | `string` | Yes | - | Token symbol (case-sensitive) |

### Returns

`Object | null` - Token object containing all token metadata - null if not found

### Examples

```javascript
// Get USDC token information
const usdc = getTokenBySymbol('USDC');
// Returns: { 
//   symbol: "USDC", 
//   name: "USD Coin", 
//   decimals: 6,
//   isStablecoin: true,
//   addresses: { 1: "0xA0b8...", 137: "0x2791..." }
// }

// Handle unknown token
const token = getTokenBySymbol('UNKNOWN');
if (!token) {
  console.error('Token not found');
}
```

### Important Notes

⚠️ **WARNING**: Token symbols are case-sensitive. Always use the exact casing (e.g., "USDC" not "usdc").

### Side Effects
None - Pure function

---

## getTokenAddress

Get token contract address for a specific chain.

### Signature
```javascript
getTokenAddress(symbol: string, chainId: number): string | null
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| symbol | `string` | Yes | - | Token symbol (case-sensitive) |
| chainId | `number` | Yes | - | Chain ID where the token address is needed |

### Returns

`string | null` - Token contract address (0x-prefixed) - null if not available on the chain

### Examples

```javascript
// Get USDC address on Ethereum mainnet
const usdcAddress = getTokenAddress('USDC', 1);
// Returns: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"

// Check if token exists on chain before using
const tokenAddress = getTokenAddress('DAI', chainId);
if (tokenAddress) {
  const contract = new ethers.Contract(tokenAddress, ERC20ABI, provider);
}
```

### Side Effects
None - Pure function

---

## getStablecoins

Get all tokens classified as stablecoins.

### Signature
```javascript
getStablecoins(): Array<Object>
```

### Parameters

None

### Returns

`Array<Object>` - Array of token objects that are classified as stablecoins

### Examples

```javascript
// Get all stablecoin tokens
const stablecoins = getStablecoins();
// Returns: [
//   { symbol: "USDC", name: "USD Coin", isStablecoin: true, ... },
//   { symbol: "USDT", name: "Tether", isStablecoin: true, ... },
//   { symbol: "DAI", name: "Dai", isStablecoin: true, ... }
// ]

// Get stablecoin symbols for a selector
const stablecoinOptions = getStablecoins().map(token => ({
  value: token.symbol,
  label: `${token.name} (${token.symbol})`
}));
```

### Side Effects
None - Pure function

---

## areTokensSupportedOnChain

Check if all specified tokens are available on a chain.

### Signature
```javascript
areTokensSupportedOnChain(symbols: string[], chainId: number): boolean
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| symbols | `string[]` | Yes | - | Array of token symbols to check |
| chainId | `number` | Yes | - | Chain ID to check against |

### Returns

`boolean` - True if ALL tokens are supported on the chain, false if any are missing

### Examples

```javascript
// Check if token pair is available on Polygon
const tokensAvailable = areTokensSupportedOnChain(['USDC', 'ETH'], 137);
if (!tokensAvailable) {
  console.error('Not all tokens available on this chain');
}

// Validate token selection for a specific chain
const selectedTokens = ['DAI', 'USDC', 'WBTC'];
if (areTokensSupportedOnChain(selectedTokens, chainId)) {
  proceedWithStrategy(selectedTokens);
}
```

### Side Effects
None - Pure function

---

## getTokenByAddress

Look up token information by its contract address.

### Signature
```javascript
getTokenByAddress(address: string, chainId: number): Object | null
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| address | `string` | Yes | - | Token contract address (0x-prefixed) |
| chainId | `number` | Yes | - | Chain ID where the address exists |

### Returns

`Object | null` - Token object with all metadata - null if not found

### Examples

```javascript
// Look up token by its contract address
const token = getTokenByAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 1);
// Returns: { symbol: "USDC", name: "USD Coin", ... }

// Identify unknown token from transaction
const unknownToken = getTokenByAddress(event.args.token, chainId);
if (unknownToken) {
  console.log(`Received ${unknownToken.symbol}`);
} else {
  console.log('Unknown token');
}
```

### Important Notes

The address comparison is case-insensitive to handle different address formats.

### Side Effects
None - Pure function

---

## registerToken

Register a new token or update an existing one.

### Signature
```javascript
registerToken(token: Object): boolean
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| token | `Object` | Yes | - | Token configuration object |
| token.symbol | `string` | Yes | - | Token symbol (will be used as key) |
| token.name | `string` | No | - | Human-readable token name |
| token.decimals | `number` | No | - | Number of decimals for the token |
| token.addresses | `Object` | No | - | Chain ID to address mapping |
| token.isStablecoin | `boolean` | No | false | Whether the token is a stablecoin |
| token.logoURI | `string` | No | - | URL to token logo image |

### Returns

`boolean` - True if registration successful, false if invalid input

### Examples

```javascript
// Register a new token
registerToken({
  symbol: 'NEWTOKEN',
  name: 'New Token',
  decimals: 18,
  addresses: {
    1: '0x1234...5678',
    137: '0x8765...4321'
  },
  isStablecoin: false,
  logoURI: 'https://example.com/logo.png'
});

// Update existing token with new chain
const weth = getTokenBySymbol('WETH');
registerToken({
  ...weth,
  addresses: {
    ...weth.addresses,
    42161: '0xNewArbitrumAddress'
  }
});
```

### Side Effects
Modifies the internal tokens configuration object

---

## getTokensForChain

Get all tokens available on a specific chain.

### Signature
```javascript
getTokensForChain(chainId: number): Array<Object>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| chainId | `number` | Yes | - | Chain ID to filter tokens by |

### Returns

`Array<Object>` - Array of token objects that have addresses on the specified chain

### Examples

```javascript
// Get all tokens on Polygon
const polygonTokens = getTokensForChain(137);
// Returns array of tokens with Polygon addresses

// Build token selector for current chain
const availableTokens = getTokensForChain(chainId).map(token => ({
  value: token.symbol,
  label: token.name,
  address: token.addresses[chainId],
  decimals: token.decimals
}));
```

### Side Effects
None - Pure function

---

## getAllTokenSymbols

Get all configured token symbols.

### Signature
```javascript
getAllTokenSymbols(): Array<string>
```

### Parameters

None

### Returns

`Array<string>` - Array of all configured token symbols

### Examples

```javascript
// Get all token symbols
const symbols = getAllTokenSymbols();
// Returns: ['ETH', 'USDC', 'USDT', 'DAI', 'WBTC', ...]

// Check if a symbol exists
const supportedSymbols = getAllTokenSymbols();
if (supportedSymbols.includes(userInput.toUpperCase())) {
  processToken(userInput);
}
```

### Side Effects
None - Pure function

---

## getTokensByType

Filter tokens by their type classification.

### Signature
```javascript
getTokensByType(isStablecoin: boolean): Array<Object>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| isStablecoin | `boolean` | Yes | - | True to get stablecoins, false to get non-stablecoins |

### Returns

`Array<Object>` - Array of token objects matching the type criteria

### Examples

```javascript
// Get all non-stablecoin tokens
const volatileTokens = getTokensByType(false);
// Returns tokens like ETH, WBTC, etc.

// Separate tokens by type for different strategies
const stables = getTokensByType(true);
const volatile = getTokensByType(false);

console.log(`${stables.length} stablecoins available`);
console.log(`${volatile.length} volatile tokens available`);
```

### Side Effects
None - Pure function

---

## Type Definitions

```typescript
// For TypeScript users
interface TokenConfig {
  symbol: string;
  name: string;
  decimals: number;
  addresses: Record<number, string>;
  isStablecoin?: boolean;
  logoURI?: string;
}

interface TokenAddresses {
  [chainId: number]: string;
}

type TokenSymbol = string;
type TokenAddress = string;
```

## Common Patterns

### Token Validation for Strategies
```javascript
// Validate tokens for a specific strategy on a chain
function validateStrategyTokens(tokens, chainId, requireStablecoin = false) {
  // Check if all tokens exist
  const allExist = tokens.every(symbol => getTokenBySymbol(symbol));
  if (!allExist) return { valid: false, error: 'Unknown token' };
  
  // Check if all tokens are on the chain
  if (!areTokensSupportedOnChain(tokens, chainId)) {
    return { valid: false, error: 'Not all tokens available on chain' };
  }
  
  // Check stablecoin requirement
  if (requireStablecoin) {
    const hasStable = tokens.some(symbol => {
      const token = getTokenBySymbol(symbol);
      return token && token.isStablecoin;
    });
    if (!hasStable) {
      return { valid: false, error: 'At least one stablecoin required' };
    }
  }
  
  return { valid: true };
}
```

### Multi-Chain Token Discovery
```javascript
// Find which chains support a specific token
function getTokenAvailability(symbol) {
  const token = getTokenBySymbol(symbol);
  if (!token) return [];
  
  return Object.entries(token.addresses).map(([chainId, address]) => ({
    chainId: parseInt(chainId),
    chainName: getChainName(parseInt(chainId)),
    address
  }));
}
```

## See Also

- [`chainHelpers`](./chain-helpers.md) - Chain configuration utilities
- [`formatHelpers`](./format-helpers.md) - Token amount formatting
- [ERC-20 Token Standard](https://eips.ethereum.org/EIPS/eip-20)
- [Token Lists](https://tokenlists.org/) - Standard for token metadata