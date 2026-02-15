# FUM Testing

Unit tests for the FUM (Funds Under Management) smart contracts. This project provides comprehensive test coverage for the vault system, strategies, and supporting contracts.

## Overview

This testing suite validates the core smart contracts used in the FUM platform:

| Contract | Description |
|----------|-------------|
| `PositionVault` | User-controlled vault for managing DeFi positions across platforms |
| `VaultFactory` | Factory contract for deploying new vaults |
| `BabyStepsStrategy` | Liquidity management strategy with conservative rebalancing |
| `ParrisIslandStrategy` | Advanced liquidity management strategy with aggressive rebalancing |

## Prerequisites

- Node.js 18+
- npm or yarn
- An Alchemy API key (free tier works)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create environment file:
   ```bash
   cp .env.example .env
   ```

3. Add your Alchemy API key to `.env`:
   ```
   NEXT_PUBLIC_ALCHEMY_API_KEY=your_key_here
   ```

## Running Tests

Run all tests:
```bash
npx hardhat test
```

Run tests with gas reporting:
```bash
REPORT_GAS=true npx hardhat test
```

Run a specific test file:
```bash
npx hardhat test test/unit/PositionVault.test.js
```

## Test Structure

```
test/
└── unit/
    ├── PositionVault.test.js        # Vault functionality tests
    ├── VaultFactory.test.js         # Factory deployment tests
    ├── BabyStepsStrategy.test.js    # BabySteps strategy tests
    └── ParrisIslandStrategy.test.js # ParrisIsland strategy tests
```

## Mock Contracts

The tests use mock contracts to simulate external dependencies:

- `MockERC20` - ERC20 token for testing transfers and approvals
- `MockPositionNFT` - NFT contract for testing position management
- `MockNonfungiblePositionManager` - Simulates Uniswap V3 position manager
- `MockUniversalRouter` - Simulates Uniswap Universal Router
- `MockWETH` - Wrapped ETH contract for testing ETH/WETH conversions

## Network Configuration

Tests run on a local Hardhat network that forks Arbitrum mainnet. This allows testing against real protocol addresses (Uniswap, Permit2) while maintaining isolated test state.

## Related Projects

- [fum](https://github.com/yourusername/fum) - Frontend and main contracts
- [fum_automation](https://github.com/yourusername/fum_automation) - Automation service
- [fum_library](https://github.com/yourusername/fum_library) - Shared utilities

## License

Proprietary - All Rights Reserved. See [LICENSE](LICENSE) for details.
