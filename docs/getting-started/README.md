# Getting Started with FUM Library

## Installation

```bash
npm install fum_library
```

## Quick Start

```javascript
import { createProvider, getAllUserVaultData } from 'fum_library';

// Create a provider
const provider = await createProvider();

// Get all vault data for a user
const vaultData = await getAllUserVaultData(
  userAddress,
  provider,
  chainId
);

console.log('Total TVL:', vaultData.totalTVL);
console.log('Vaults:', vaultData.vaults);
```

## Core Concepts

### 1. Providers
The library uses ethers.js providers for blockchain interaction. You can create providers for browser wallets or JSON-RPC endpoints.

### 2. Adapters
Protocol adapters provide a unified interface for interacting with different DeFi protocols. Currently supported:
- Uniswap V3

### 3. Vaults
Vaults are smart contracts that hold user positions. The library can fetch and aggregate data from multiple vaults.

### 4. Positions
Positions represent liquidity provided to DeFi protocols. Each position includes:
- Token amounts
- Current value
- Uncollected fees
- Pool information

## Basic Usage

### Connecting to a Wallet

```javascript
import { createProvider, requestWalletConnection } from 'fum_library/blockchain';

// Create browser provider
const provider = await createProvider({ preferBrowser: true });

// Request wallet connection
const accounts = await requestWalletConnection(provider);
const userAddress = accounts[0];
```

### Fetching Vault Data

```javascript
import { getVaultData } from 'fum_library/helpers';

const vaultInfo = await getVaultData(
  vaultAddress,
  provider,
  chainId
);

console.log('Vault TVL:', vaultInfo.tvl);
console.log('Positions:', vaultInfo.positions);
```

### Working with Tokens

```javascript
import { getTokenBySymbol, fetchTokenPrices } from 'fum_library';

// Get token information
const usdc = getTokenBySymbol('USDC');
console.log('USDC address on Arbitrum:', usdc.addresses[42161]);

// Fetch current prices (cacheStrategy is required)
const prices = await fetchTokenPrices(['USDC', 'ETH'], '30-SECONDS');
console.log('ETH price:', prices.ETH);
```

## Next Steps

- See [Architecture](../ARCHITECTURE.md) for detailed system design
- Check [API Reference](../api-reference/modules.md) for complete function documentation
- View [Examples](https://github.com/your-repo/examples) for real-world usage