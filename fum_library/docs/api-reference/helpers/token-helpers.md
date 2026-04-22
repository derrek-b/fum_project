<!-- Source: src/helpers/tokenHelpers.js -->
# Token Helpers API

Token management utilities for querying token configurations and addresses across multiple chains.

## Overview

The Token Helpers module provides utilities for working with ERC-20 tokens in the FUM Library. It manages token metadata, chain-specific addresses, and token classifications (native vs wrapped, stablecoin vs volatile). All lookup functions use fail-fast validation — invalid inputs and missing tokens throw descriptive errors.

## Exports

```javascript
import {
  // Native / wrapped native utilities
  isWrappedNativeToken,
  getWrappedNativeAddress,
  getWrappedNativeSymbol,
  getNativeSymbol,
  getNativeTokenForChain,
  isNativeToken,
  // Symbol / address lookups
  getAllTokenSymbols,
  getAllTokens,
  getTokenBySymbol,
  getTokensBySymbol,
  getTokenByAddress,
  getTokenAddress,
  getTokenAddresses,
  // Chain-based filters
  getTokensByChain,
  areTokensSupportedOnChain,
  // Stablecoin helpers
  getStablecoins,
  isStablecoin,
  detectStablePair,
  // Filtering / validation
  getTokensByType,
  validateTokensExist,
  // External service mapping
  getCoingeckoId,
} from 'fum_library/helpers/tokenHelpers';
```

## Functions

### getAllTokens

Return all configured tokens (including dynamically-generated wrapped-native entries).

```javascript
getAllTokens(): Object
```

Returns an object keyed by symbol:

```javascript
{
  ETH: { symbol: "ETH", name: "Ether", decimals: 18, isNative: true, wrappedAddresses: {...} },
  WETH: { symbol: "WETH", name: "Wrapped Ether", decimals: 18, isNative: false, addresses: {...} },
  USDC: { symbol: "USDC", name: "USD Coin", decimals: 6, isStablecoin: true, addresses: {...} },
  // ...
}
```

Pure function — no side effects.

---

### getAllTokenSymbols

All configured token symbols (including wrapped natives).

```javascript
getAllTokenSymbols(): string[]
```

Returns e.g. `['ETH', 'WETH', 'USDC', 'USDT', 'DAI', 'WBTC', 'AVAX', 'WAVAX', ...]`.

---

### getTokenBySymbol

Look up a token by symbol.

```javascript
getTokenBySymbol(symbol: string): Object
```

Returns the full token object. Also resolves `wrappedSymbol` lookups — e.g. `getTokenBySymbol('WETH')` returns the ETH token config with `symbol: 'WETH'`, `isNative: false`, and `addresses` populated from `wrappedAddresses`.

**Throws** if the symbol is missing, not a string, or not found.

---

### getTokensBySymbol

Batch lookup. Returns `{ [symbol]: tokenObject }`.

```javascript
getTokensBySymbol(symbols: string[]): Object
```

**Throws** if any symbol is not found (fails fast — no partial results).

---

### getTokenByAddress

Reverse lookup: address → token config.

```javascript
getTokenByAddress(address: string, chainId: number): Object
```

Address comparison is case-insensitive. Returns a modified copy for wrapped-native addresses (`isNative: false`, `symbol: wrappedSymbol`).

**Throws** if no token is found at that address on the given chain.

---

### getTokenAddress

Get a token's contract address on a specific chain.

```javascript
getTokenAddress(symbol: string, chainId: number): string
```

For native tokens (ETH, AVAX), returns the `AddressZero` sentinel stored in config (used by V4 native pools). Chain support is verified against `wrappedAddresses[chainId]` for native tokens.

**Throws** if the symbol is unknown or the token has no address on the chain.

---

### getTokenAddresses

Batch variant of `getTokenAddress`.

```javascript
getTokenAddresses(symbols: string[], chainId: number): Object
```

Returns `{ [symbol]: address }` — includes native tokens with their zero-address sentinel. **Throws** if any symbol isn't available on the chain.

---

### areTokensSupportedOnChain

```javascript
areTokensSupportedOnChain(symbols: string[], chainId: number): boolean
```

Returns `true` only if every symbol has an address on the chain. Does not throw for unknown symbols — those simply cause `false`.

---

### validateTokensExist

```javascript
validateTokensExist(symbols: string[]): boolean
```

Returns `true` if every symbol is configured in `tokens.js`. **Throws** for validation errors (non-array, non-string entries, etc.).

---

### getTokensByChain

All tokens that have an address on a given chain.

```javascript
getTokensByChain(chainId: number): Object[]
```

---

### getTokensByType

Filter by stablecoin flag.

```javascript
getTokensByType(isStablecoin: boolean): Object[]
```

Returns stablecoin or non-stablecoin tokens depending on the flag.

---

### getStablecoins

Shorthand for `getTokensByType(true)` returned as an object keyed by symbol.

```javascript
getStablecoins(): Object
```

---

### isStablecoin

```javascript
isStablecoin(symbol: string): boolean
```

Returns `true` for stablecoin symbols (USDC, USDT, DAI, etc.). **Throws** if the symbol is not found.

---

### detectStablePair

Given two token addresses and a chainId, check whether both are stablecoins.

```javascript
detectStablePair(tokenAddressA: string, tokenAddressB: string, chainId: number): boolean
```

---

### isNativeToken / isWrappedNativeToken

```javascript
isNativeToken(symbol: string): boolean         // true for ETH, AVAX
isWrappedNativeToken(symbol: string): boolean  // true for WETH, WAVAX
```

Both throw if the symbol is not configured.

---

### getNativeSymbol / getWrappedNativeSymbol

```javascript
getNativeSymbol(chainId: number): string           // 'ETH', 'AVAX'
getWrappedNativeSymbol(chainId: number): string    // 'WETH', 'WAVAX'
```

---

### getNativeTokenForChain

Full native token config for the chain.

```javascript
getNativeTokenForChain(chainId: number): Object
```

Returns the token object for the chain's native currency (ETH on Arbitrum, AVAX on Avalanche).

---

### getWrappedNativeAddress

Wrapped native contract address on the chain.

```javascript
getWrappedNativeAddress(chainId: number): string
```

---

### getCoingeckoId

Map a token symbol to its CoinGecko ID for price lookups.

```javascript
getCoingeckoId(symbol: string): string
```

Used internally by `fum_library/services/coingecko`'s `fetchTokenPrices`. **Throws** if the symbol has no CoinGecko mapping.

---

## Common Patterns

### Token Validation for Strategies

```javascript
function validateStrategyTokens(tokens, chainId, requireStablecoin = false) {
  // Verify all tokens exist in config
  try {
    validateTokensExist(tokens);
  } catch (error) {
    return { valid: false, error: error.message };
  }

  // Verify chain support
  if (!areTokensSupportedOnChain(tokens, chainId)) {
    return { valid: false, error: 'Not all tokens available on chain' };
  }

  if (requireStablecoin) {
    const hasStable = tokens.some(symbol => isStablecoin(symbol));
    if (!hasStable) {
      return { valid: false, error: 'At least one stablecoin required' };
    }
  }

  return { valid: true };
}
```

### Multi-Chain Token Discovery

```javascript
function getTokenAvailability(symbol) {
  const token = getTokenBySymbol(symbol);
  return Object.entries(token.addresses || token.wrappedAddresses).map(([chainId, address]) => ({
    chainId: parseInt(chainId),
    address
  }));
}
```

## See Also

- [`chainHelpers`](./chain-helpers.md) — Chain configuration utilities
- [`formatHelpers`](./format-helpers.md) — Value formatting
- [`services/coingecko`](../services/coingecko.md) — Uses `getCoingeckoId` internally
- [ERC-20 Token Standard](https://eips.ethereum.org/EIPS/eip-20)
