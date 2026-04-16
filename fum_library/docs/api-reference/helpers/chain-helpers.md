<!-- Source: src/helpers/chainHelpers.js, src/configs/chains.js -->
# Chain Helpers API

Chain configuration lookups for the FUM Library. All helpers use fail-fast validation — invalid chainIds and unsupported chains throw descriptive errors immediately. Only `isChainSupported` and `isLocalChain` return booleans.

## Overview

Chain configurations live in `src/configs/chains.js`. This module wraps those configurations with validation and platform-aware lookups. Currently-configured chains: `42161` (Arbitrum One), `43114` (Avalanche), `1337` (Hardhat Arbitrum fork), `1338` (Hardhat Avalanche fork).

## Exports

```javascript
import {
  configureChainHelpers,
  validateChainId,
  getChainConfig,
  getChainName,
  getChainRpcUrls,
  getExecutorXpub,
  getMinExecutorBalance,
  getMaxExecutorBalance,
  isChainSupported,
  isLocalChain,
  lookupSupportedChainIds,
  getPlatformAddresses,
  lookupChainPlatformIds,
  getMinDeploymentForGas,
  getMinSwapValue,
  getTransactionDeadlineMinutes,
  getMaxPriorityFeePerGas,
  getExpectedBlockMs
} from 'fum_library/helpers/chainHelpers';
```

## Configuration

### configureChainHelpers

Set module-level configuration consumed by `getChainRpcUrls`. The Alchemy API key is appended to RPC URLs for chains that use Alchemy endpoints (Arbitrum 42161, Avalanche 43114).

```javascript
configureChainHelpers({ alchemyApiKey: string }): void
```

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `alchemyApiKey` | `string` | No | Alchemy API key; if omitted, the previous value is preserved |

#### Example
```javascript
import { configureChainHelpers } from 'fum_library/helpers/chainHelpers';
configureChainHelpers({ alchemyApiKey: process.env.ALCHEMY_API_KEY });
```

---

## Validation

### validateChainId

Throws if the argument is not a positive integer. Used internally by every lookup function; also exported for use by other helpers.

```javascript
validateChainId(chainId: any): void
```

| Throws | Condition |
|---|---|
| `chainId parameter is required` | `null` or `undefined` |
| `chainId must be a number` | Non-number type |
| `chainId must be a finite number` | `NaN` or `Infinity` |
| `chainId must be an integer` | Non-integer |
| `chainId must be greater than 0` | `<= 0` |

---

## Chain Lookup

### getChainConfig

Get the complete chain configuration object.

```javascript
getChainConfig(chainId: number): ChainConfig
```

Returns the raw config object from `chains.js`:

```javascript
{
  name: string,                      // e.g. "Arbitrum One"
  nativeCurrency: { name, symbol, decimals },
  rpcUrls: string[],
  blockExplorerUrls: string[],
  executorXpub: string,
  minExecutorBalance: number,        // native token units
  maxExecutorBalance: number,        // native token units
  maxPriorityFeePerGas: string,      // wei per gas
  minDeploymentForGas: number,       // USD
  minSwapValue: number,              // USD
  transactionDeadlineMinutes: number,
  expectedBlockMs: number | null,
  platformAddresses: {
    [platformId]: { factoryAddress, positionManagerAddress, ... }
  },
  merklDistributorAddress?: string   // optional, present on V4-supporting chains
}
```

#### Throws

- `chainId` fails `validateChainId`
- `Chain X is not supported` if the chain is not in `chains.js`

#### Example
```javascript
const config = getChainConfig(42161);
console.log(config.name);                  // "Arbitrum One"
console.log(config.transactionDeadlineMinutes); // 5
```

---

### getChainName

```javascript
getChainName(chainId: number): string
```

Returns the human-readable chain name.

#### Throws
- `validateChainId` errors
- `Chain X is not supported`
- `Chain X name not configured` (if the config has no `name`)

#### Example
```javascript
getChainName(42161);   // "Arbitrum One"
getChainName(43114);   // "Avalanche"
getChainName(1337);    // "Forked Arbitrum"
```

---

### isChainSupported

```javascript
isChainSupported(chainId: number): boolean
```

Returns `true` if the chain is configured, `false` otherwise. Still validates that `chainId` itself is a positive integer (throws via `validateChainId`).

#### Example
```javascript
if (!isChainSupported(chainId)) {
  throw new Error(`Chain ${chainId} is not supported`);
}

// Filter supported chains
const supported = [1, 137, 42161, 10].filter(isChainSupported);
```

---

### isLocalChain

```javascript
isLocalChain(chainId: number): boolean
```

Returns `true` if `chainId` is `1337` (Hardhat Arbitrum fork) or `1338` (Hardhat Avalanche fork); otherwise `false`. Throws via `validateChainId` on invalid input.

#### Example
```javascript
if (isLocalChain(chainId)) {
  // Skip real-chain infrastructure like WebSocket canary or Merkl API calls
}
```

---

### lookupSupportedChainIds

```javascript
lookupSupportedChainIds(): number[]
```

Returns all configured chain IDs as integers (e.g. `[42161, 1337, 43114, 1338]`).

#### Example
```javascript
const chains = lookupSupportedChainIds().map(id => ({
  id,
  name: getChainName(id)
}));
```

---

## RPC

### getChainRpcUrls

Returns the RPC URL list for a chain. For Arbitrum (`42161`) and Avalanche (`43114`), the Alchemy API key set via `configureChainHelpers` is appended to each base URL.

```javascript
getChainRpcUrls(chainId: number): string[]
```

#### Throws
- `validateChainId` errors
- `Chain X is not supported`
- `No RPC URL configured for chain X` (config missing `rpcUrls`)
- `Chain X RPC URLs not configured` (empty or non-array)
- `Alchemy API key not configured. Call configureChainHelpers({ alchemyApiKey }) or initFumLibrary({ alchemyApiKey }) first.` (Arbitrum/Avalanche when key is absent)

#### Example
```javascript
import { ethers } from 'ethers';

configureChainHelpers({ alchemyApiKey: process.env.ALCHEMY_API_KEY });
const urls = getChainRpcUrls(42161);
// ["https://arb-mainnet.g.alchemy.com/v2/<your-key>"]
const provider = new ethers.providers.JsonRpcProvider(urls[0]);

// Hardhat forks have no API key requirement
getChainRpcUrls(1337); // ["http://localhost:8545"]
```

---

## Executor

### getExecutorXpub

Returns the BIP-32 extended public key for the automation executor wallet on the given chain. Used by wallet derivation utilities to generate per-vault executor addresses.

```javascript
getExecutorXpub(chainId: number): string
```

#### Throws
- `validateChainId` errors
- `Chain X is not supported`
- `No executor xpub configured for chain X` (empty string)

---

### getMinExecutorBalance

Minimum executor wallet balance in native token units (ETH, AVAX). Executor balance monitoring uses this to trigger top-up.

```javascript
getMinExecutorBalance(chainId: number): number
```

#### Throws
- `validateChainId` errors
- `Chain X is not supported`
- `No minimum executor balance configured for chain X` (non-positive or missing)

#### Example
```javascript
getMinExecutorBalance(42161);  // 0.002 (ETH)
getMinExecutorBalance(43114);  // 0.04  (AVAX)
```

---

### getMaxExecutorBalance

Top-up target: the balance to which the executor wallet is refilled when its balance drops below `minExecutorBalance`. Native token units.

```javascript
getMaxExecutorBalance(chainId: number): number
```

#### Throws
- `validateChainId` errors
- `Chain X is not supported`
- `No maximum executor balance configured for chain X` (non-positive or missing)

#### Example
```javascript
getMaxExecutorBalance(42161);  // 0.004 (ETH)
getMaxExecutorBalance(43114);  // 0.08  (AVAX)
```

---

## Platform Lookup

### getPlatformAddresses

Contract addresses for a specific platform on a specific chain.

```javascript
getPlatformAddresses(chainId: number, platformId: string): PlatformAddresses
```

Returns the platform-specific address object from `chains.js`, e.g. for `uniswapV3` on Arbitrum:

```javascript
{
  factoryAddress: "0x1F98...",
  positionManagerAddress: "0xC364...",
  routerAddress: "0xE592...",
  universalRouterAddress: "0xa51a...",
  quoterAddress: "0x61fF..."
}
```

Shape varies by platform (V4: `poolManagerAddress`, `stateViewAddress`, etc.; TJ: `lbFactoryAddress`, `lbRouterAddress`, etc.).

#### Throws
- `validateChainId` errors
- `platformId parameter is required` / `platformId must be a string` / `platformId cannot be empty`
- `Chain X is not supported`
- `No platform addresses configured for chain X`
- `Platform Y not configured for chain X`

---

### lookupChainPlatformIds

Returns all platform IDs available on a chain.

```javascript
lookupChainPlatformIds(chainId: number): string[]
```

#### Throws
- `validateChainId` errors
- `Chain X is not supported`
- `No platform addresses configured for chain X`

#### Example
```javascript
lookupChainPlatformIds(42161);  // ['uniswapV3', 'uniswapV4']
lookupChainPlatformIds(43114);  // ['traderjoeV2_2']
```

---

## Gas & Thresholds

### getMinDeploymentForGas

Minimum deployment value (USD) for gas-efficient position creation. Strategies skip deployments below this threshold.

```javascript
getMinDeploymentForGas(chainId: number): number
```

#### Throws
- `validateChainId` errors
- `Chain X is not supported`
- `No minimum deployment amount configured for chain X` (non-positive or missing)

#### Example
```javascript
getMinDeploymentForGas(42161);  // 50 (USD)
getMinDeploymentForGas(43114);  // 10 (USD)
```

---

### getMinSwapValue

Minimum swap value (USD). Swaps below this threshold are skipped — the value wouldn't cover gas economically.

```javascript
getMinSwapValue(chainId: number): number
```

#### Throws
- `validateChainId` errors
- `Chain X is not supported`
- `No minimum swap value configured for chain X` (negative or missing)

#### Example
```javascript
getMinSwapValue(42161);  // 10  (USD)
getMinSwapValue(43114);  // 0.10 (USD)
```

---

### getTransactionDeadlineMinutes

Deadline in minutes passed to liquidity/swap operations that accept a deadline (Uniswap V3/V4, TJ V2.2).

```javascript
getTransactionDeadlineMinutes(chainId: number): number
```

#### Throws
- `validateChainId` errors
- `Chain X is not supported`
- `No transaction deadline configured for chain X` (non-positive or missing)

#### Example
```javascript
const deadlineMinutes = getTransactionDeadlineMinutes(42161); // 5

const txData = await adapter.generateRemoveLiquidityData({
  ...params,
  deadlineMinutes
});
```

---

### getMaxPriorityFeePerGas

Max priority fee in wei per gas, returned as a string (pass to `ethers.BigNumber.from`).

```javascript
getMaxPriorityFeePerGas(chainId: number): string
```

#### Throws
- `validateChainId` errors
- `Chain X is not supported`
- `No maxPriorityFeePerGas configured for chain X` (undefined or null in config)

#### Example
```javascript
// Arbitrum sequencer is FCFS — ignores tips entirely
getMaxPriorityFeePerGas(42161); // "0"

// Avalanche uses near-zero tip
getMaxPriorityFeePerGas(43114); // "1000"   (1000 wei/gas)

// Apply to a transaction
const maxPriorityFeePerGas = ethers.BigNumber.from(getMaxPriorityFeePerGas(chainId));
```

---

### getExpectedBlockMs

Expected milliseconds between blocks for the WebSocket subscription canary. Returns `null` when the canary should be disabled (Hardhat forks mine only on transaction arrival).

The `SubscriptionCanary` uses this to compute its deadline threshold (`2 × expectedBlockMs + 500ms` buffer). `null` skips the canary entirely.

```javascript
getExpectedBlockMs(chainId: number): number | null
```

#### Throws
- `validateChainId` errors
- `Chain X is not supported`
- `No expectedBlockMs configured for chain X` (property missing from config)
- `expectedBlockMs for chain X must be null or a positive finite number, got: <value>`

#### Example
```javascript
getExpectedBlockMs(42161);  // 250   (Arbitrum — ~4 blocks/second)
getExpectedBlockMs(43114);  // 2000  (Avalanche — ~2s blocks)
getExpectedBlockMs(1337);   // null  (Hardhat Arbitrum fork — canary disabled)
getExpectedBlockMs(1338);   // null  (Hardhat Avalanche fork — canary disabled)
```

---

## Common Patterns

### Multi-Chain Provider Initialization
```javascript
import { ethers } from 'ethers';
import {
  configureChainHelpers,
  lookupSupportedChainIds,
  getChainRpcUrls
} from 'fum_library/helpers/chainHelpers';

configureChainHelpers({ alchemyApiKey: process.env.ALCHEMY_API_KEY });

const providers = {};
for (const chainId of lookupSupportedChainIds()) {
  const urls = getChainRpcUrls(chainId);
  providers[chainId] = new ethers.providers.JsonRpcProvider(urls[0]);
}
```

### Platform Availability Check
```javascript
import {
  lookupSupportedChainIds,
  lookupChainPlatformIds,
  getPlatformAddresses
} from 'fum_library/helpers/chainHelpers';

function findChainsWithPlatform(platformId) {
  return lookupSupportedChainIds().filter(chainId => {
    return lookupChainPlatformIds(chainId).includes(platformId);
  });
}

findChainsWithPlatform('uniswapV4');      // [42161, 1337]
findChainsWithPlatform('traderjoeV2_2');  // [43114, 1338]
```

## See Also

- [`platformHelpers`](./platform-helpers.md) — Platform metadata utilities
- [`tokenHelpers`](./token-helpers.md) — Token lookups
- [Helpers Architecture](../../architecture/helpers.md) — Per-module helper overview
- [Ethereum Chain List](https://chainlist.org/) — Comprehensive chain ID reference
