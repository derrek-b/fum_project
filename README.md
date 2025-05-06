# F.U.M. Library

A comprehensive JavaScript library for DeFi liquidity management, focusing on Uniswap V3 positions and automated strategy execution.

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

// Get positions for a user/vault
const positions = await adapter.getPositions(address, chainId);
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

## License

See LICENSE file for details.

## Version History

See CHANGELOG.md for version history and release notes.