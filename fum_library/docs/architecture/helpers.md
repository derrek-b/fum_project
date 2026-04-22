<!-- Source: src/helpers/chainHelpers.js, src/helpers/formatHelpers.js, src/helpers/platformHelpers.js, src/helpers/strategyHelpers.js, src/helpers/tokenHelpers.js, src/helpers/Permit2Helper.js -->
# Helpers Architecture

## Overview

The helpers module contains stateless utility functions organized by domain. Six helper files cover chain configuration, token data, platform metadata, strategy parameters, formatting, and Permit2 authorization.

```
src/helpers/
├── index.js             # Re-exports all helpers
├── chainHelpers.js      # Chain config lookups, RPC URLs, platform addresses
├── tokenHelpers.js      # Token lookups by symbol/address, type checks
├── platformHelpers.js   # Platform metadata, fee tiers, tick bounds
├── strategyHelpers.js   # Strategy templates, parameter validation
├── formatHelpers.js     # formatPrice, formatFeeDisplay, formatTimestamp
└── Permit2Helper.js     # Permit2 nonce, signature, calldata wrapping
```

All helpers use fail-fast validation — invalid inputs throw descriptive errors immediately.

---

## chainHelpers.js

**Source:** `src/helpers/chainHelpers.js`

Chain configuration lookups against `configs/chains.js`. Has a `configureChainHelpers({ alchemyApiKey })` function for RPC URL construction.

### Key Exports

| Function | Signature | Description |
|---|---|---|
| `configureChainHelpers` | `({ alchemyApiKey })` | Set Alchemy API key for RPC URLs |
| `validateChainId` | `(chainId)` | Validates chainId is a positive integer (also exported for use by other helpers) |
| `getChainConfig` | `(chainId) → Object` | Full chain config (name, rpcUrls, executorXpub, balances, gas, platformAddresses) |
| `getChainName` | `(chainId) → string` | Human-readable chain name |
| `getChainRpcUrls` | `(chainId) → string[]` | RPC URLs (appends Alchemy key for Arbitrum/Avalanche) |
| `getExecutorXpub` | `(chainId) → string` | Executor BIP-32 extended public key for the chain |
| `getMinExecutorBalance` | `(chainId) → number` | Minimum executor wallet balance in native token units |
| `getMaxExecutorBalance` | `(chainId) → number` | Maximum (top-up target) executor wallet balance in native token units |
| `isChainSupported` | `(chainId) → boolean` | Check if chain is configured |
| `isLocalChain` | `(chainId) → boolean` | Check if chain is a Hardhat fork (1337 or 1338) |
| `lookupSupportedChainIds` | `() → number[]` | All configured chain IDs |
| `getPlatformAddresses` | `(chainId, platformId) → Object` | Contract addresses for a platform on a chain |
| `lookupChainPlatformIds` | `(chainId) → string[]` | Platform IDs available on a chain |
| `getMinDeploymentForGas` | `(chainId) → number` | Minimum USD value for gas-efficient deployment |
| `getMinSwapValue` | `(chainId) → number` | Minimum USD value below which swaps are skipped |
| `getTransactionDeadlineMinutes` | `(chainId) → number` | TX deadline for liquidity/swap operations |
| `getMaxPriorityFeePerGas` | `(chainId) → string` | Max priority fee in wei/gas as a string (pass to `ethers.BigNumber.from`) |
| `getExpectedBlockMs` | `(chainId) → number\|null` | Expected ms between blocks for WebSocket subscription canary (`null` disables the canary for Hardhat forks) |

### Error Handling

All lookup functions throw descriptive errors when the chainId is invalid, the chain is not supported, or the requested property is missing from the chain config. `isChainSupported` and `isLocalChain` are the only functions that return a boolean instead of throwing on unknown chains (they still throw if `chainId` itself fails `validateChainId`).

### RPC URL Construction

`getChainRpcUrls` requires the Alchemy API key for Arbitrum (42161) and Avalanche (43114) — these chains use Alchemy endpoints with the key appended at runtime. Other chains (including Hardhat forks) return URLs as-is.

---

## tokenHelpers.js

**Source:** `src/helpers/tokenHelpers.js`

Token data lookups against `configs/tokens.js`. The `registerToken()` function was removed — token config is immutable.

### Key Exports

| Function | Signature | Description |
|---|---|---|
| `getTokenBySymbol` | `(symbol) → Object` | Token config by symbol |
| `getTokensBySymbol` | `(symbols[]) → Object` | Batch lookup by symbols |
| `getTokenByAddress` | `(address, chainId) → Object` | Reverse lookup by contract address |
| `getTokenAddress` | `(symbol, chainId) → string` | Token contract address on a chain |
| `getTokenAddresses` | `(symbols[], chainId) → Object` | Batch address lookup |
| `getTokensByChain` | `(chainId) → Object[]` | All tokens available on a chain |
| `getTokensByType` | `(isStablecoin) → Object[]` | Filter tokens by stablecoin flag |
| `getAllTokenSymbols` | `() → string[]` | All token symbols (including wrapped natives) |
| `getAllTokens` | `() → Object` | All tokens (includes dynamically-generated wrapped entries) |
| `getStablecoins` | `() → Object` | Stablecoin tokens only |
| `isStablecoin` | `(symbol) → boolean` | Check if token is a stablecoin |
| `isNativeToken` | `(symbol) → boolean` | Check if token is native (ETH, AVAX) |
| `isWrappedNativeToken` | `(symbol) → boolean` | Check if token is a wrapped native (WETH, WAVAX) |
| `getNativeSymbol` | `(chainId) → string` | Native token symbol for a chain |
| `getNativeTokenForChain` | `(chainId) → Object` | Full native token config for a chain |
| `getWrappedNativeAddress` | `(chainId) → string` | Wrapped native contract address |
| `getWrappedNativeSymbol` | `(chainId) → string` | Wrapped native symbol (WETH, WAVAX) |
| `detectStablePair` | `(addrA, addrB, chainId) → boolean` | Check if both tokens in a pair are stablecoins |
| `areTokensSupportedOnChain` | `(symbols[], chainId) → boolean` | Check all tokens available on chain |
| `validateTokensExist` | `(symbols[]) → boolean` | Check all symbols exist in config |
| `getCoingeckoId` | `(symbol) → string` | CoinGecko ID for price fetching |

### Native vs Wrapped Token Handling

Token config distinguishes native tokens (ETH, AVAX) from their wrapped counterparts (WETH, WAVAX). Native tokens have `isNative: true` and `wrappedAddresses` instead of `addresses`. When `getTokenByAddress` matches a wrapped address, it returns a modified copy with the wrapped symbol and `isNative: false`.

`getAllTokens()` dynamically generates wrapped token entries so wrapped natives appear alongside regular ERC20 tokens.

---

## platformHelpers.js

**Source:** `src/helpers/platformHelpers.js`

Platform metadata lookups against `configs/platforms.js`.

### Key Exports

| Function | Signature | Description |
|---|---|---|
| `getPlatformMetadata` | `(platformId) → Object` | Full platform metadata |
| `getPlatformName` | `(platformId) → string` | Human-readable name |
| `getPlatformColor` | `(platformId) → string` | Brand color hex code |
| `getPlatformLogo` | `(platformId) → string` | Logo URL |
| `getPlatformFeeTiers` | `(platformId) → number[]` | Fee tiers in basis points |
| `getPlatformTickSpacing` | `(platformId, fee) → number` | Tick spacing for a fee tier |
| `getPlatformTickBounds` | `(platformId) → { minTick, maxTick }` | Platform tick range limits |
| `lookupSupportedPlatformIds` | `() → string[]` | All configured platform IDs |
| `getAvailablePlatforms` | `(chainId) → Object[]` | All platforms with addresses for a chain |
| `lookupPlatformById` | `(platformId, chainId) → Object\|null` | Combined metadata + addresses for a platform on a chain |
| `validatePlatformId` | `(platformId)` | Validates platformId is a non-empty string |

### getAvailablePlatforms vs lookupPlatformById

`getAvailablePlatforms(chainId)` returns all platforms on a chain — used for building UI selectors. `lookupPlatformById(platformId, chainId)` returns a single platform's full config — returns `null` if not enabled on the chain instead of throwing.

---

## strategyHelpers.js

**Source:** `src/helpers/strategyHelpers.js`

Strategy template lookups and parameter validation against `configs/strategies.js`.

### Key Exports

| Function | Description |
|---|---|
| `lookupAllStrategyIds()` | All strategy IDs including 'none' |
| `lookupAvailableStrategies()` | Strategy configs excluding 'none' |
| `lookupStrategyById(strategyId)` | Single strategy config |
| `lookupStrategyParameters(strategyId)` | Parameter definitions for a strategy |
| `validateStrategyParams(strategyId, params)` | Validate params against strategy rules |
| `getDefaultStrategyParams(strategyId)` | Default parameter values |
| `shouldShowParameter(paramConfig, currentParams)` | Conditional parameter visibility |
| `resolveTokenOptions(paramConfig, chainId)` | Resolve token options for selector params |

### Parameter Validation

`validateStrategyParams` checks each parameter against its configured rules (type, min/max range, custom validators). Returns `{ isValid, errors }`. Parameters can be conditionally shown based on other parameter values via `shouldShowParameter`.

---

## formatHelpers.js

**Source:** `src/helpers/formatHelpers.js`

Three pure formatting functions. No state, no imports.

### Exports

#### formatPrice(price)

Formats a price with dynamic precision based on magnitude. Returns abbreviated format for large values.

```javascript
formatPrice(0.00003);      // "<0.0001"
formatPrice(1234.5678);    // "1234.5678" (4 decimal places)
formatPrice(5000000);      // "5.00M"
formatPrice(1500000000);   // "1.50B"
```

#### formatFeeDisplay(fee)

Formats fees with up to 4 decimal places, trailing zeros removed.

```javascript
formatFeeDisplay(0);        // "0"
formatFeeDisplay(0.00005);  // "< 0.0001"
formatFeeDisplay(0.0300);   // "0.03"
```

#### formatTimestamp(timestamp)

Converts Unix timestamps (seconds or milliseconds) to locale-formatted date strings.

```javascript
formatTimestamp(1679750400);     // "Mar 25, 2023, 14:30"
formatTimestamp(1679750400000);  // "Mar 25, 2023, 14:30"
```

Auto-detects seconds vs milliseconds (threshold: 10 billion).

---

## Permit2Helper.js

**Source:** `src/helpers/Permit2Helper.js`

Utilities for Uniswap's Permit2 token approval system, used by adapters when generating swap transactions through the Universal Router.

### Key Exports

| Export | Description |
|---|---|
| `PERMIT2_ADDRESS` | Canonical Permit2 address (same on all EVM chains) |
| `getPermit2Nonce(provider, owner, token, spender)` | Read current nonce from Permit2 contract |
| `generatePermit2Signature(signer, chainId, token, amount, spender, nonce, deadline)` | Generate EIP-712 typed signature |
| `wrapWithPermit2(routerInterface, calldata, permitData, signature)` | Wrap router calldata with permit |

### Usage Flow

Adapters call these when building swap transactions:

1. `getPermit2Nonce` — read current nonce for the token/owner/spender
2. `generatePermit2Signature` — sign EIP-712 permit message with vault's signer
3. `wrapWithPermit2` — wrap the router calldata to include the permit

---

## See Also

- [Architecture Overview](./overview.md) — Module structure and module summaries
- [Services Architecture](./services.md) — External APIs that helpers interact with
- [API Reference Overview](../api-reference/overview.md) — Per-module function documentation
