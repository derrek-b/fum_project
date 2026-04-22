<!-- Source: src/blockchain/wallet.js -->
# Wallet API

Ethereum wallet and provider utilities for browser (MetaMask) and JSON-RPC contexts. Uses ethers.js **v5** (not v6) — providers live on `ethers.providers` (e.g., `ethers.providers.Web3Provider`).

## Overview

The Wallet module exposes two provider constructors (`createWeb3Provider`, `createJsonRpcProvider`), account/connection helpers for browser wallets, and chain-switching utilities. Functions fail loudly on invalid inputs — no silent fallbacks.

## Exports

```javascript
import {
  createWeb3Provider,
  createJsonRpcProvider,
  getConnectedAccounts,
  requestWalletConnection,
  getChainId,
  switchChain,
} from 'fum_library/blockchain/wallet';
```

---

## Provider Creation

### createWeb3Provider

Creates an ethers v5 `Web3Provider` from `window.ethereum` (MetaMask, Coinbase Wallet, etc.). Browser-only.

```javascript
async createWeb3Provider(): Promise<ethers.providers.Web3Provider>
```

**Throws** `No Ethereum provider found (e.g., MetaMask) in browser` when `window.ethereum` is unavailable (non-browser environment or no wallet installed).

```javascript
try {
  const provider = await createWeb3Provider();
} catch (error) {
  console.error('No browser wallet detected');
}
```

---

### createJsonRpcProvider

Creates an ethers v5 `JsonRpcProvider` for server-side or direct RPC use. Validates URL format (HTTP/HTTPS/WS/WSS) and tests connectivity with one automatic retry.

```javascript
async createJsonRpcProvider(rpcUrl: string): Promise<ethers.providers.JsonRpcProvider>
```

**Throws:**
- `RPC URL is required to create a provider` — missing URL
- `Invalid RPC URL format: <url>. Must be a valid HTTP/HTTPS/WS/WSS URL.` — fails regex validation
- `Provider connectivity test failed for <url>: <reason>` — `getNetwork()` fails after retry

```javascript
const provider = await createJsonRpcProvider('https://arb-mainnet.g.alchemy.com/v2/<key>');
```

---

## Wallet Operations

### getConnectedAccounts

Returns currently-connected accounts from a browser provider, via `provider.listAccounts()`. Does **not** trigger a connection popup.

```javascript
async getConnectedAccounts(
  provider: ethers.providers.Provider
): Promise<string[]>
```

**Throws** if the provider is missing or not an ethers provider, or if `listAccounts()` fails.

---

### requestWalletConnection

Triggers the wallet connection popup via `eth_requestAccounts`. Requires a browser (Web3) provider — explicitly rejects `JsonRpcProvider`.

```javascript
async requestWalletConnection(
  provider: ethers.providers.Web3Provider
): Promise<string[]>
```

**Throws:**
- `A browser provider is required to request wallet connection` — called with a `JsonRpcProvider`
- `Failed to connect to wallet: <reason>` — user rejection or wallet error

---

## Chain Operations

### getChainId

Reads the chain ID from the provider's network.

```javascript
async getChainId(provider: ethers.providers.Provider): Promise<number>
```

**Throws** if the provider is missing or invalid, or if `getNetwork()` fails.

---

### switchChain

Switches the connected browser wallet to the given chain. If the chain isn't added to the wallet (error code `4902`), attempts to add it using the library's chain config via `getChainConfig(chainId)`. Returns `true` on success, `false` on failure. Requires a browser provider.

```javascript
async switchChain(
  provider: ethers.providers.Web3Provider,
  chainId: number
): Promise<boolean>
```

**Throws:**
- `A browser provider is required to switch chains` — called with a `JsonRpcProvider`
- `Chain ID must be a number` — non-number `chainId`

On failure after retries the function returns `false` rather than throwing (so callers can distinguish "user refused/chain not in configs" from programming errors).

```javascript
const success = await switchChain(provider, 42161); // Arbitrum
if (!success) {
  console.warn('User rejected chain switch or chain not configured');
}
```

---

## Common Patterns

### Full Browser Connection Flow

```javascript
import {
  createWeb3Provider,
  requestWalletConnection,
  getChainId,
  switchChain,
} from 'fum_library/blockchain/wallet';

async function connectWallet(targetChainId = 42161) {
  const provider = await createWeb3Provider();
  const accounts = await requestWalletConnection(provider);
  if (accounts.length === 0) throw new Error('No accounts connected');

  const chainId = await getChainId(provider);
  if (chainId !== targetChainId) {
    const switched = await switchChain(provider, targetChainId);
    if (!switched) throw new Error(`Failed to switch to chain ${targetChainId}`);
  }

  const signer = provider.getSigner();
  return { provider, signer, address: accounts[0] };
}
```

### Server-Side RPC Provider

```javascript
import { createJsonRpcProvider } from 'fum_library/blockchain/wallet';
import { getChainRpcUrls } from 'fum_library/helpers/chainHelpers';

const [rpcUrl] = getChainRpcUrls(42161);
const provider = await createJsonRpcProvider(rpcUrl);
```

## See Also

- [`contracts`](./contracts.md) — Contract interaction utilities
- [`chainHelpers`](../helpers/chain-helpers.md) — Chain configuration (used by `switchChain`)
- [ethers.js v5 Docs](https://docs.ethers.org/v5/)
- [EIP-1193: Ethereum Provider JavaScript API](https://eips.ethereum.org/EIPS/eip-1193)
