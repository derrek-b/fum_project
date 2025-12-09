# F.U.M. Library

![Version](https://img.shields.io/badge/version-0.24.0-blue.svg)
![License](https://img.shields.io/badge/license-Proprietary-red.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Status](https://img.shields.io/badge/status-beta-yellow.svg)

A comprehensive JavaScript library for DeFi liquidity management, focusing on Uniswap V3 positions and automated strategy execution.

## 📚 Documentation

- **[Architecture Overview](./docs/architecture/overview.md)** - System design and module structure
- **[API Reference](./docs/api-reference/overview.md)** - Complete API documentation
- **[Module Reference](./docs/api-reference/modules.md)** - Detailed module documentation
- **[Changelog](./CHANGELOG.md)** - Version history and updates

## Overview

F.U.M. Library provides a modular toolkit for managing decentralized finance liquidity positions. It offers a standardized interface for interacting with various DeFi platforms, starting with Uniswap V3, and implements strategy execution for optimal liquidity management.

## Core Concepts

### Providers
The library uses ethers.js providers for blockchain interaction. You can create providers for browser wallets or JSON-RPC endpoints.

### Adapters
Protocol adapters provide a unified interface for interacting with different DeFi protocols. Currently supported:
- Uniswap V3

### Vaults
Vaults are smart contracts that hold user positions. The library can fetch and aggregate data from multiple vaults.

### Positions
Positions represent liquidity provided to DeFi protocols. Each position includes:
- Token amounts
- Current value
- Uncollected fees
- Pool information

## Features

- **Platform Adapters**: Standardized interfaces for DeFi platforms (currently Uniswap V3)
- **Strategy Management**: Tools for implementing and executing liquidity provisioning strategies
- **Vault Management**: Utilities for full lifecycle vault operations
- **Token Helpers**: Functions for token listing, pricing, and conversions
- **Blockchain Utilities**: Contract interaction and wallet connection helpers
- **Price Oracles**: Integration with CoinGecko for token pricing

## Installation

```bash
npm install fum_library
```

## Usage

### Initialization

Before using API-dependent features, initialize the library with your API keys:

```javascript
import { initFumLibrary } from 'fum_library';

// Initialize with API keys (call once at app startup)
initFumLibrary({
  coingeckoApiKey: process.env.COINGECKO_API_KEY,
  alchemyApiKey: process.env.ALCHEMY_API_KEY,
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
const adapter = AdapterFactory.getAdapter(platformConfig, 'uniswap_v3', provider);

// Get positions for an address
const result = await adapter.getPositions(address, provider);
console.log(result.positions); // Map of positions keyed by ID
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
  validateStrategyParams
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

The library includes implementations and parameter validation for multiple liquidity provision strategies:

- **Baby Steps Strategy** (`bob`): Simplified parameter set for beginner users
- **Parris Island Strategy** (`parris`): Coming soon - Advanced adaptive range management with dynamic thresholds
- **The Fed Strategy** (`fed`): Coming soon - Specialized stablecoin optimization

## Development

```bash
# Install dependencies
npm install

# Build distribution package
npm run build
```

## 🏗️ Architecture

The library follows a modular architecture with clear separation of concerns:

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│   Adapters      │────▶│  Blockchain  │────▶│  Contracts  │
└─────────────────┘     └──────────────┘     └─────────────┘
        │                                              │
        ▼                                              ▼
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│    Helpers      │────▶│   Services   │────▶│   External  │
└─────────────────┘     └──────────────┘     │     APIs    │
                                              └─────────────┘
```

See [Architecture Overview](./docs/architecture/overview.md) for detailed system design and [interactive diagrams](./docs/diagrams/).

## 📖 Documentation

### Architecture Diagrams

The library includes comprehensive architecture documentation in multiple formats:

- **[Mermaid Diagrams](./docs/diagrams/mermaid/)** - Interactive diagrams (GitHub renders automatically)
  - Module Dependencies
  - Data Flow
  - Component Interactions
  - Sequence Diagrams
- **[ASCII Diagrams](./docs/diagrams/ascii/)** - Text-based architecture views
- **[PlantUML Diagrams](./docs/diagrams/plantuml/)** - Detailed UML diagrams
- **[Draw.io Diagrams](./docs/diagrams/drawio/)** - Editable visual diagrams

### Generating Documentation

Documentation is automatically generated during the build process:

```bash
npm run build  # Builds code and generates docs
npm run docs   # Generate documentation only
```

## License

See [LICENSE.md](./LICENSE.md) for details.

## Version History

See CHANGELOG.md for version history and release notes.