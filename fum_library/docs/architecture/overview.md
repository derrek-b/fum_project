<!-- Source: src/index.js, src/init.js, src/adapters/*, src/blockchain/*, src/configs/*, src/helpers/*, src/services/*, src/artifacts/* -->
# FUM Library Architecture

## Overview

Shared library consumed by `fum` (Next.js frontend) and `fum_automation` (automation service). Provides platform adapters for DEX interactions, blockchain utilities, token/chain configs, contract ABIs, and helper functions.

Installed by consumers via local tarball (`npm run pack`), not npm link.

## Directory Layout

```
src/
├── index.js                          # Main entry point, re-exports all modules
├── init.js                           # initFumLibrary() — unified config initialization
├── adapters/
│   ├── index.js                      # Re-exports adapter classes + convenience wrappers (getAdapter, getAdaptersForChain, getSupportedPlatforms)
│   ├── AdapterFactory.js             # Static registry, creates adapters by platformId
│   ├── PlatformAdapter.js            # Abstract base class (27 automation + 2 display + 4 optional methods)
│   ├── UniswapV3Adapter.js           # Uniswap V3 concentrated liquidity
│   ├── UniswapV4Adapter.js           # Uniswap V4 (singleton PoolManager)
│   └── TraderJoeV2_2Adapter.js       # Trader Joe V2.2 Liquidity Book
├── artifacts/
│   └── contracts.js                  # Contract ABIs and deployment addresses (auto-generated)
├── blockchain/
│   ├── index.js                      # Re-exports wallet + contracts
│   ├── wallet.js                     # Provider creation, wallet connection (ethers v5)
│   └── contracts.js                  # Contract instantiation, vault operations (ethers v5)
├── configs/
│   ├── index.js                      # Re-exports all configs
│   ├── chains.js                     # Chain configs, RPC URLs, platform addresses per chain
│   ├── platforms.js                  # Platform metadata (name, color, logo, subgraphs, fee tiers)
│   ├── strategies.js                 # Strategy templates and parameter definitions
│   └── tokens.js                     # Token lists with addresses on each chain
├── helpers/
│   ├── index.js                      # Re-exports all helpers
│   ├── chainHelpers.js               # Chain lookups, RPC URL construction, platform IDs per chain
│   ├── formatHelpers.js              # formatPrice, formatFeeDisplay, formatTimestamp
│   ├── platformHelpers.js            # Platform metadata lookups
│   ├── strategyHelpers.js            # Strategy validation and parameter management
│   ├── tokenHelpers.js               # Token lookups, address resolution
│   └── Permit2Helper.js              # Uniswap Permit2 signature and nonce utilities
└── services/
    ├── index.js                      # Re-exports all services
    ├── coingecko.js                  # Token price fetching with in-memory cache
    ├── theGraph.js                   # Subgraph queries (pool TVL, age, V4 pool discovery)
    ├── blockExplorer.js              # Internal transaction queries via Arbiscan (Arbitrum) and Snowtrace (Avalanche)
    └── merkl.js                      # Merkl incentive campaigns + claim data (V4)
```

## Initialization

The library requires API keys for external services. Call `initFumLibrary()` at startup:

```javascript
import { initFumLibrary } from 'fum_library';

initFumLibrary({
  coingeckoApiKey: process.env.COINGECKO_API_KEY,
  alchemyApiKey: process.env.ALCHEMY_API_KEY,
  blockExplorerApiKey: process.env.BLOCK_EXPLORER_API_KEY,
  theGraphApiKey: process.env.THE_GRAPH_API_KEY,
});
```

This delegates to per-service configure functions (`configureCoingecko`, `configureChainHelpers`, `configureBlockExplorer`, `configureTheGraph`). Services can also be configured individually if preferred.

Key requirements:
- **`alchemyApiKey`** — required for production chains (Arbitrum, Avalanche). `getChainRpcUrls(42161)` and `getChainRpcUrls(43114)` throw without it. Not required when only operating against a Hardhat fork (1337/1338).
- **`theGraphApiKey`** — required for any subgraph query (the gateway URL embeds the key in the path; without it the subgraph functions throw).
- **`coingeckoApiKey`** — technically optional (free tier works without an authenticated request), but unauthenticated rate limits will cause production failures.
- **`blockExplorerApiKey`** — technically optional, but unauthenticated Arbiscan/Snowtrace rate limits will cause production failures.

## Module Summaries

### Adapters

Platform-specific implementations for DEX interactions. All adapters extend `PlatformAdapter` and are created via `AdapterFactory.getAdapter(platformId, chainId)`. Providers are passed per-method call, not stored on the adapter instance.

The base class defines 29 required methods (27 automation methods — position discovery, pool operations, transaction generation, receipt parsing, swap event monitoring — plus 2 frontend display methods) and 4 optional incentive-related methods.

See [Adapters Architecture](./adapters.md) for the full interface, data shapes, and automation usage flows.

### Blockchain

Provider creation and contract interaction using **ethers.js v5**.

- **wallet.js** — `createWeb3Provider()`, `createJsonRpcProvider()`, `getConnectedAccounts()`, `requestWalletConnection()`, `getChainId()`, `switchChain()`
- **contracts.js** — `getContract()`, `getVaultFactory()`, `getVaultFactoryAddress()`, `createVault()`, `getVaultContract()`, `getUserVaults()`, `getActiveVaults()`, `getVaultInfo()`, `getVaultExecutorIndex()`, `executeVaultTransactions()`, `getContractInfoByAddress()`

See [Blockchain Architecture](./blockchain.md) for details.

### Configs

Static configuration data. These are the source of truth for supported chains, tokens, and platforms.

- **chains.js** — Chain definitions including RPC URLs, contract addresses, and `platformAddresses` per chain
- **platforms.js** — Platform metadata (display name, color, logo, subgraph URLs, fee tiers)
- **strategies.js** — Strategy template definitions and parameter schemas
- **tokens.js** — Token lists with per-chain addresses, decimals, symbols

### Helpers

Stateless utility functions used throughout the codebase.

- **chainHelpers.js** — `getChainConfig()`, `lookupChainPlatformIds()`, RPC URL construction (uses Alchemy API key if configured)
- **formatHelpers.js** — `formatPrice()`, `formatFeeDisplay()`, `formatTimestamp()`
- **platformHelpers.js** — Platform metadata lookups by ID
- **strategyHelpers.js** — Strategy parameter validation and defaults
- **tokenHelpers.js** — Token lookups by symbol/address, address resolution across chains
- **Permit2Helper.js** — Uniswap Permit2 signature generation, nonce management, and `encodePermit2Input` for wrapping permits into Universal Router calldata

See [Helpers Architecture](./helpers.md) for details.

### Services

External API integrations. Each service has a `configure*()` function called by `initFumLibrary()`.

- **coingecko.js** — `fetchTokenPrices(tokenSymbols, cacheDurationMs)` with in-memory price cache. Cache duration is a number in milliseconds.
- **theGraph.js** — `getPoolTVLAverage()`, `getPoolAge()`, `discoverV4Pools()`, `getV4PositionsByOwner()` via subgraph queries
- **blockExplorer.js** — `getBlockExplorerService(chainId)` returns a service with `getInternalTransactions(txHash)` and `getEthTransfersForWallet(txHash, walletAddress)` for parsing Arbiscan (Arbitrum) and Snowtrace (Avalanche) data
- **merkl.js** — `fetchPoolIncentives(chainId, poolId)`, `fetchClaimData(chainId, userAddress)`, `clearIncentiveCache()` — used by V4 adapter's incentive methods

See [Services Architecture](./services.md) for details.

### Artifacts

Auto-generated contract ABIs and deployment addresses. Source of truth is `fum/contracts/` — run `npm run contracts:sync` in fum to regenerate.

`bytecode/` contains compiled contract bytecodes synced from fum_testing.

## Build System

The build is a simple file copy (`cp -r src/* dist/`), not a bundler. The `dist/` directory gets packed into a tarball consumed by sibling projects.

## Module Dependencies

```
index.js
├── init.js     → calls configure* functions in services/ and helpers/chainHelpers
├── adapters/   → uses helpers/, configs/, artifacts/, services/ (V4 uses theGraph + merkl)
├── blockchain/ → uses helpers/, configs/, artifacts/
├── helpers/    → uses configs/
└── services/   → uses helpers/ (e.g. coingecko uses tokenHelpers.getCoingeckoId)
```

Adapters do **not** route through the `blockchain/` module — they use ethers directly with the per-method-call provider. The `blockchain/` module is a sibling consumer-facing module used by the frontend and automation service to talk to FUM's own contracts (VaultFactory, PositionVault), not by adapters.

Consumers import via subpath exports (`fum_library/adapters`, `fum_library/helpers/chainHelpers`, etc.) or from the main entry point.

## Detailed Documentation

- [Adapters Architecture](./adapters.md) — PlatformAdapter interface, data shapes, automation flows
- [Helpers Architecture](./helpers.md) — Utility function details
- [Services Architecture](./services.md) — External API integrations and caching
- [Blockchain Architecture](./blockchain.md) — Provider management, contract interactions
- [API Reference](../api-reference/overview.md) — Per-module function documentation
