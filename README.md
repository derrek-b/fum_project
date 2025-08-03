# F.U.M. Library

![Version](https://img.shields.io/badge/version-0.1.9-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Status](https://img.shields.io/badge/status-beta-yellow.svg)

A comprehensive JavaScript library for DeFi liquidity management, focusing on Uniswap V3 positions and automated strategy execution.

## 📚 Documentation

- **[Architecture Overview](./ARCHITECTURE.md)** - System design and module structure
- **[Getting Started Guide](./docs/getting-started/README.md)** - Quick start tutorial
- **[API Reference](./docs/api-reference/README.md)** - Complete API documentation
- **[Module Reference](./docs/api-reference/modules.md)** - Detailed module documentation
- **[Changelog](./CHANGELOG.md)** - Version history and updates

## Overview

F.U.M. Library provides a modular toolkit for managing decentralized finance liquidity positions. It offers a standardized interface for interacting with various DeFi platforms, starting with Uniswap V3, and implements strategy execution for optimal liquidity management.

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

```javascript
import { VaultFactory, adapters, helpers } from 'fum_library';

// Initialize adapter for Uniswap V3
const uniswapAdapter = adapters.getAdapter('uniswap_v3', provider);

// Get vault information
const vaultData = await helpers.vaultHelpers.getVaultData(vaultAddress, provider, chainId);

// Get all user positions
const userPositions = await helpers.vaultHelpers.getAllUserVaultData(userAddress, provider, chainId);
```

## Main Components

### Adapters

Platform-specific adapters that conform to a standard interface:

```javascript
import { AdapterFactory } from 'fum_library/adapters';

// Get an adapter for a specific platform
const adapter = AdapterFactory.getAdapter('uniswap_v3', provider);

// Get all adapters for a chain
const chainAdapters = AdapterFactory.getAdaptersForChain(chainId, provider);

// Get positions for a user/vault (returns object keyed by position ID)
const positions = await adapter.getPositions(address, provider);
console.log(Object.keys(positions.positions)); // position IDs
```

### Helpers

Utility functions for working with various DeFi components:

```javascript
import { 
  formatHelpers, 
  chainHelpers, 
  tokenHelpers,
  platformHelpers,
  strategyHelpers,
  vaultHelpers 
} from 'fum_library/helpers';

// Format numbers with appropriate precision
const formattedAmount = formatHelpers.formatTokenAmount(amount, decimals);

// Get token information
const tokens = tokenHelpers.getAllTokens();

// Validate strategy parameters
const isValid = strategyHelpers.validateStrategyParameters(strategyId, parameters);

// Get complete vault data
const vaultData = await vaultHelpers.getVaultData(vaultAddress, provider, chainId);
```

### Blockchain Utilities

Tools for interacting with smart contracts:

```javascript
import { contracts, wallet } from 'fum_library/blockchain';

// Connect to provider/signer
const connection = await wallet.connect(provider);

// Get a vault instance
const vaultContract = contracts.getVaultContract(vaultAddress, signer);
```

### Services

External services like token price APIs:

```javascript
import { coingecko } from 'fum_library/services';

// Get token prices
const prices = await coingecko.fetchTokenPrices(['ETH', 'USDC']);

// Calculate USD value
const usdValue = await coingecko.calculateUsdValue(amount, tokenSymbol);
```

## Strategy Support

The library includes implementations and parameter validation for multiple liquidity provision strategies:

- **Parris Island Strategy**: Adaptive range management with dynamic thresholds
- **Baby Steps Strategy**: Simplified parameter set for beginner users
- **Fed Strategy**: Coming soon

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

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system design and [interactive diagrams](./docs/diagrams/).

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

See LICENSE file for details.

## Version History

See CHANGELOG.md for version history and release notes.