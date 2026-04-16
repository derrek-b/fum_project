# FUM Testing

Unit tests for the FUM smart contracts. FUM is a DeFi liquidity management platform; this project provides Hardhat-based test coverage for the vault system, strategies, validators, and supporting contracts.

## Overview

This testing suite validates all contracts synced from `fum/contracts/`:

**Core**

| Contract | Description |
|----------|-------------|
| `PositionVault` | User-controlled vault for ERC20s, native ETH, and LP positions across platforms |
| `VaultFactory` | Factory that deploys vaults and manages validator registries |

**Strategies**

| Contract | Description |
|----------|-------------|
| `StrategyBase` | Abstract base contract for strategy implementations |
| `BabyStepsStrategy` | Conservative range-based automation strategy |
| `ParrisIslandStrategy` | Advanced adaptive strategy with dynamic range adjustments |

**Trader Joe**

| Contract | Description |
|----------|-------------|
| `TJPositionManager` | Manages Trader Joe V2.2 bin positions via per-position proxies |
| `TJPositionProxy` | EIP-1167 minimal proxy holding ERC1155 LB tokens per position |

**Validators**

| Contract | Description |
|----------|-------------|
| `UniversalRouterValidator` | Validates Uniswap Universal Router swap calldata |
| `UniswapV3PositionValidator` | Validates Uniswap V3 mint/liquidity calldata |
| `UniswapV4PositionValidator` | Validates Uniswap V4 position calldata |
| `TJPositionValidator` | Validates Trader Joe position calldata |
| `TJSwapValidator` | Validates Trader Joe LB Router swap calldata |
| `MerklIncentiveValidator` | Validates Merkl Distributor `claim()` calldata |

## Prerequisites

- Node.js 22+
- npm
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

## Contracts Are Synced — Do Not Edit Here

The Solidity files in `contracts/` are copies synced from `fum/contracts/`, which is the source of truth. To propagate contract changes into this project:

```bash
cd ../fum && npm run contracts:sync
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

### From the Monorepo Root

```bash
cd ../fum && npm run contracts:test           # Sync contracts then run all tests
cd ../fum && npm run contracts:test:coverage  # Sync contracts then run coverage
```

Prefer these when you've edited contracts in `../fum/contracts/` — they avoid a stale-sync gotcha.

## Coverage

```bash
npx hardhat coverage
```

## Test Structure

```
test/unit/
├── PositionVault.test.js              # Core vault operations
├── VaultFactory.test.js               # Factory deployment and vault creation
├── StrategyBase.test.js               # Abstract strategy base tests
├── BabyStepsStrategy.test.js          # Conservative strategy logic
├── ParrisIslandStrategy.test.js       # Advanced adaptive strategy
├── TJPositionManager.test.js          # Trader Joe V2.2 bin position management
├── TJPositionProxy.test.js            # Proxy initialization, execution, access control
└── validators/
    ├── UniversalRouterValidator.test.js    # Swap calldata validation
    ├── UniswapV3PositionValidator.test.js  # V3 mint/liquidity validation
    ├── UniswapV4PositionValidator.test.js  # V4 position validation
    ├── TJPositionValidator.test.js         # TJ position validation
    ├── TJSwapValidator.test.js             # TJ swap validation
    └── MerklIncentiveValidator.test.js     # Merkl claim calldata validation
```

## Mock Contracts

Eight mock contracts in `contracts/` simulate external protocols. See `docs/architecture/testing-patterns.md` for full mock APIs.

- `MockERC20` — ERC20 token with owner-only `mint` and caller `burn`
- `MockWETH` — WETH-like wrapper with `deposit`/`withdraw`
- `MockPositionNFT` — Generic ERC721 for NFT transfer tests
- `MockNonfungiblePositionManager` — Uniswap V3 position manager (mint, increase/decrease liquidity, collect, burn, multicall)
- `MockUniversalRouter` — Uniswap Universal Router `execute`
- `MockLBPair` — Trader Joe V2.2 LB Pair (ERC1155-style bin balances)
- `MockLBRouter` — Trader Joe V2.2 LB Router (add/remove liquidity)
- `MockPermit2` — Permit2 `approve` selector for validation tests

## Network Configuration

Tests run on a local Hardhat network (chainId `1337`) that forks Arbitrum mainnet. This allows testing against real protocol addresses (Uniswap, Permit2) while maintaining isolated test state.

## Related Projects

This project is part of the FUM monorepo. Sibling projects:

- `../fum` — Frontend and source-of-truth contracts
- `../fum_automation` — Automation service
- `../fum_library` — Shared utilities (adapters, helpers, configs, ABIs)

## License

Proprietary - All Rights Reserved. See [LICENSE](LICENSE) for details.
