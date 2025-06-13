# API Reference

This directory contains detailed API documentation for the FUM Library.

## Documentation

- [Module Reference](./modules.md) - Complete list of all modules, files, imports, and exports
- [Type Definitions](./types.md) - TypeScript/JSDoc type definitions (coming soon)

## Quick Links

### Core Modules

- **[Adapters](./modules.md#adapters-module)** - Protocol integration adapters
- **[Blockchain](./modules.md#blockchain-module)** - Web3 and wallet utilities  
- **[Helpers](./modules.md#helpers-module)** - Business logic and calculations
- **[Services](./modules.md#services-module)** - External API integrations
- **[Configs](./modules.md#configs-module)** - Static configuration data

### Key Functions

#### Vault Management
- `getAllUserVaultData()` - Get all vaults for a user
- `getVaultData()` - Get detailed data for a single vault
- `calculatePositionsTVL()` - Calculate total value locked

#### Token Operations  
- `fetchTokenPrices()` - Get current token prices
- `getTokenBySymbol()` - Get token configuration
- `calculateUsdValue()` - Convert token amounts to USD

#### Position Management
- `getPositions()` - Fetch user positions from protocols
- `calculateFees()` - Calculate uncollected fees
- `generateSwapData()` - Prepare swap transactions

## Generated Documentation

The module reference is automatically generated from the source code. To regenerate:

```bash
npm run docs
```

This will scan all source files and update the documentation with current imports, exports, and file descriptions.