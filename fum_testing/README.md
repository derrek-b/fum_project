# FUM Testing

Unit tests for the FUM smart contracts. FUM is a DeFi liquidity management platform; this project provides Hardhat-based test coverage for the vault system, strategies, validators, and supporting contracts.

> `fum_testing` is one subproject in the [fum_project monorepo](../README.md). The root README has the big-picture architecture and sibling-project overview; this doc covers `fum_testing` specifically.
>
> **Working directory.** All commands and paths in this doc assume you're at the monorepo root (`fum_project/`). See [Monorepo Conventions](../README.md#monorepo-conventions) for details.

## Overview

This testing suite validates all contracts synced from `fum/contracts/`:

**Core**

| Contract | Description |
|----------|-------------|
| `PositionVault` | User-controlled vault for tokens (ERC20 & native), and LP positions across platforms |
| `VaultFactory` | Factory that deploys vaults and manages validator registries |

**Strategies**

| Contract | Description |
|----------|-------------|
| `StrategyBase` | Abstract base contract for strategy implementations |
| `BabyStepsStrategy` | Conservative range-based automation strategy |

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

## Setup

```bash
npm install
```

No environment variables required for tests — they are fully self-contained.

The Arbiscan verification script (`scripts/verify-arbitrum.js`) needs `BLOCK_EXPLORER_API_KEY` in a `.env` file at the project root (gitignored). Use an Etherscan V2 unified key — one key works for all supported chains including Arbiscan.

## Contracts Are Synced — Do Not Edit Here

The Solidity files in `contracts/` are copies synced from `fum/contracts/`, which is the source of truth. To propagate contract changes into this project:

```bash
cd fum && npm run contracts:sync
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
cd fum && npm run contracts:test           # Sync contracts then run all tests
cd fum && npm run contracts:test:coverage  # Sync contracts then run coverage
```

Prefer these when you've edited contracts in `../fum/contracts/` — they avoid a stale-sync gotcha.

## Coverage

```bash
npx hardhat coverage
```

## Contract Verification (Arbiscan)

Submits the deployed Arbitrum contracts to Arbiscan so the source code, function names, and revert strings are readable in the explorer.

```bash
npx hardhat run scripts/verify-arbitrum.js --network arbitrumOne
```

Reads `../fum/deployments/42161-latest.json` to determine which addresses to verify and which deployer to pass to VaultFactory's `initialOwner` constructor arg. Override with `DEPLOYMENT_RECORD=<path>` when running from a `git worktree` at an older commit (the worktree's deployment record may be stale or unrelated).

**Requirements:**
- `.env` file at the project root containing `BLOCK_EXPLORER_API_KEY=<Etherscan V2 unified key>`
- Local compilation must reproduce the deployed bytecode exactly — hardhat-verify pre-flight checks this and fails fast if there's a mismatch. If the on-chain contracts were deployed from older source than HEAD, set up a `git worktree` at the deploying commit, recompile, and run verify from there.

## Test Structure

```
test/unit/
├── PositionVault.test.js              # Core vault operations
├── VaultFactory.test.js               # Factory deployment and vault creation
├── StrategyBase.test.js               # Abstract strategy base tests
├── BabyStepsStrategy.test.js          # Conservative strategy logic
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

Tests run on a local Hardhat network (chainId `1337`), fully self-contained. External protocols (Uniswap, Trader Joe, Permit2, WETH) are simulated by the mock contracts above rather than accessed via a mainnet fork — tests do not interact with any real protocol state.

## License

Proprietary - All Rights Reserved. See [LICENSE](LICENSE) for details.
