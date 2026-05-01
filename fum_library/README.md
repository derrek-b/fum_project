# FUM Library

A comprehensive JavaScript library for DeFi liquidity management across multiple concentrated-liquidity protocols (Uniswap V3, Uniswap V4, Trader Joe V2.2) and automated strategy execution.

> `fum_library` is one subproject in the [fum_project monorepo](../README.md). The root README has the big-picture architecture and sibling-project overview; this doc covers `fum_library` specifically.

## Documentation

- **[Architecture Overview](./docs/architecture/overview.md)** - System design and module structure
- **[API Reference](./docs/api-reference/overview.md)** - Complete API documentation
- **[Changelog](./CHANGELOG.md)** - Version history and updates

## Overview

FUM Library provides a modular toolkit for managing decentralized finance liquidity positions. It offers a standardized interface for interacting with multiple DeFi platforms and implements strategy execution for optimal liquidity management.

## Features

- **Platform Adapters**: Standardized interfaces for DeFi platforms (Uniswap V3, Uniswap V4, Trader Joe V2.2)
- **Strategy Management**: Tools for implementing and executing liquidity provisioning strategies
- **Vault Management**: Utilities for full lifecycle vault operations
- **Token Helpers**: Functions for token listing, pricing, and conversions
- **Blockchain Utilities**: Contract interaction and wallet connection helpers
- **External Service Integration**: CoinGecko (token prices), The Graph (subgraph queries), Merkl (V4 incentives), Arbiscan/Snowtrace (internal-tx tracking)

## Supported Platforms

| Adapter | Protocol | Chains |
|---------|----------|--------|
| `UniswapV3Adapter` | Uniswap V3 | Arbitrum |
| `UniswapV4Adapter` | Uniswap V4 | Arbitrum |
| `TraderJoeV2_2Adapter` | Trader Joe V2.2 Liquidity Book | Avalanche |

## Installation

`fum_library` is a private monorepo package (`"private": true` in package.json) — it is **not published to npm** and cannot be installed with `npm install fum_library`. It is consumed only by sibling subprojects in the FUM monorepo (`fum`, `fum_automation`) via local tarball:

```json
// fum/package.json
"dependencies": {
  "fum_library": "file:../fum_library/fum_library-2.0.0.tgz"
}
```

To work on the library locally:

```bash
cd fum_library
npm install      # one-time: install dev dependencies
npm run pack     # rebuild tarball + reinstall into fum and fum_automation (run after edits)
```

> **Never use `npm link`** — see [root README](../README.md) for the full monorepo convention and rationale.

## Usage

### Initialization

Before using API-dependent features, initialize the library with your API keys:

```javascript
import { initFumLibrary } from 'fum_library';

// Initialize with API keys (call once at app startup).
// Required (service throws if missing):
//   - coingeckoApiKey: price fetches (throws without)
//   - theGraphApiKey:  subgraph queries (throws without)
//   - alchemyApiKey:   required for production chains (Arbitrum, Avalanche). Not required for testing.
// Optional:
//   - blockExplorerApiKey: only consumed by V4 native-ETH fee-tracking paths in parseClosureReceipt/parseCollectReceipt.
//     Without it, ETH fees in those receipts degrade to null (graceful); all other code paths work unaffected.
initFumLibrary({
  coingeckoApiKey: process.env.COINGECKO_API_KEY,
  alchemyApiKey: process.env.ALCHEMY_API_KEY,
  blockExplorerApiKey: process.env.BLOCK_EXPLORER_API_KEY,
  theGraphApiKey: process.env.THEGRAPH_API_KEY,
});
```

### Quick Example

```javascript
import { UniswapV3Adapter, fetchTokenPrices, CACHE_DURATIONS } from 'fum_library';

// Create adapter for Uniswap V3
const adapter = new UniswapV3Adapter(chainId);

// Get positions for an address
const positions = await adapter.getPositions(address, provider);

// Fetch token prices (cache duration required)
const prices = await fetchTokenPrices(['WETH', 'USDC'], CACHE_DURATIONS['30-SECONDS']);
```

## Main Components

### Adapters

Platform-specific adapters that conform to a standard interface:

```javascript
import { UniswapV3Adapter, AdapterFactory } from 'fum_library/adapters';

// Direct instantiation (recommended)
const adapter = new UniswapV3Adapter(chainId);

// Or use the factory pattern
const adapter = AdapterFactory.getAdapter('uniswapV3', chainId);

// Get positions for an address (automation use — for frontend, use getPositionsForDisplay)
const result = await adapter.getPositionsForVDS(address, provider);
console.log(result.positions); // Positions formatted for VaultDataService
```

### Helpers

Utility functions for working with various DeFi components:

```javascript
import {
  formatPrice,
  getChainConfig,
  getTokenBySymbol,
  getAllTokens,
  getStrategyDetails,
  validateStrategyParams,
  // Permit2 helpers for token approvals
  PERMIT2_ADDRESS,
  getPermit2Nonce,
  generatePermit2Signature,
  wrapWithPermit2
} from 'fum_library/helpers';

// Format price with appropriate precision
const formattedPrice = formatPrice(price);

// Get chain configuration
const chainConfig = getChainConfig(42161); // Arbitrum

// Get token information
const weth = getTokenBySymbol('WETH');
const allTokens = getAllTokens();

// Get strategy details
const strategy = getStrategyDetails('bob');

// Validate strategy parameters
const validation = validateStrategyParams('bob', parameters);

// Permit2 signature generation (for Universal Router swaps)
const nonce = await getPermit2Nonce(provider, vaultAddress, tokenAddress, routerAddress);
const { signature, permitData } = await generatePermit2Signature(
  signer, chainId, tokenAddress, amount, routerAddress, nonce, deadline
);
```

### Blockchain Utilities

Tools for wallet connection and contract interaction:

```javascript
import {
  createWeb3Provider,
  createJsonRpcProvider,
  requestWalletConnection,
  getChainId,
  getContract
} from 'fum_library/blockchain';

// Create browser provider (MetaMask, etc.)
const provider = await createWeb3Provider();

// Or create JSON-RPC provider
const rpcProvider = await createJsonRpcProvider('https://arb1.arbitrum.io/rpc');

// Request wallet connection (triggers popup)
const accounts = await requestWalletConnection(provider);
const userAddress = accounts[0];

// Get current chain ID
const chainId = await getChainId(provider);
```

### Services

External services like token price APIs:

```javascript
import { fetchTokenPrices, CACHE_DURATIONS } from 'fum_library/services';

// Get token prices (cache duration is required)
const prices = await fetchTokenPrices(['WETH', 'USDC'], CACHE_DURATIONS['30-SECONDS']);
console.log(prices.WETH); // Price in USD

// Available cache durations:
// '0-SECONDS' - No cache (critical transactions)
// '5-SECONDS' - Active liquidity management
// '30-SECONDS' - Trading decisions
// '2-MINUTES' - Dashboard display
```

## Strategy Support

The library currently includes one production strategy:

- **Baby Steps Strategy** (`bob`): Conservative range-based automation with templates for common risk profiles (Conservative, Moderate, Aggressive, Stablecoin)

Additional strategies can be added by extending `StrategyBase`.

## Testing

Tests fork Arbitrum or Avalanche mainnet via Hardhat to exercise real contracts. Default fork is Arbitrum; set `FORK_CHAIN=avalanche` to fork Avalanche on chain 1338.

```bash
# One-time setup: copy the test env template and fill in API keys
cp test/.env.test.example test/.env.test
# Required: ALCHEMY_API_KEY (fork URL), COINGECKO_API_KEY, THEGRAPH_API_KEY,
#           BLOCK_EXPLORER_API_KEY (V4 native-ETH integration hits real Arbiscan)

npm test                            # Run all tests
npm run test:watch                  # Watch mode
npm run test:coverage               # Coverage report
npm test UniswapV3Adapter.test.js   # Run a specific file
```

> **First-run address mismatch is expected.** On the first run (or after contract changes), tests will fail with `💥 DETERMINISTIC ADDRESS VALIDATION FAILED!`, save the new addresses, and exit. Re-run the same command — it'll pass. The fail-fast behavior is intentional, to prevent running a full suite against stale addresses.

## Architecture

See [Architecture Overview](./docs/architecture/overview.md) for the full module breakdown, directory layout, and dependency graph.

## License

See [LICENSE.md](./LICENSE.md) for details.

## Version History

See CHANGELOG.md for version history and release notes.
