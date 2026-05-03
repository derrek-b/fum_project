<!-- Source: package.json, hardhat.config.js, contracts/Mock*.sol, test/unit/*.test.js, docs/architecture/*.md -->
# CLAUDE.md — fum_testing (Contract Test Environment)

## What This Project Is

Isolated Hardhat environment for unit testing the FUM smart contracts. Forks Arbitrum mainnet locally so tests run against real protocol addresses (Uniswap, Permit2) with isolated state. Contracts are synced here from `fum/contracts/` via `npm run contracts:sync` in the fum project.

## Commands

```bash
npm test                       # Run all Hardhat tests
npx hardhat test               # Same thing
npx hardhat coverage           # Coverage report
npx hardhat node               # Start local Hardhat node
npx hardhat test --grep "pattern"  # Run specific tests
```

## From the fum Project

```bash
cd fum && npm run contracts:test           # Sync + run all Hardhat tests
cd fum && npm run contracts:test:coverage  # Sync + run coverage
```

Prefer these when you've just edited a contract in `fum/contracts/` — they guarantee the synced copy here matches the source of truth before running.

## Do NOT Edit Contracts Here

Contracts in this project are **copies** synced from `fum/contracts/`. The source of truth is always `fum/contracts/`. To update contracts here:

```bash
cd fum && npm run contracts:sync
```

## Test Structure

```
test/unit/
├── PositionVault.test.js              # Core vault operations (deposits, swaps, positions)
├── VaultFactory.test.js               # Factory deployment and vault creation
├── StrategyBase.test.js               # Abstract strategy base tests
├── BabyStepsStrategy.test.js          # Conservative strategy logic
├── TJPositionManager.test.js          # Trader Joe V2.2 bin position management
├── TJPositionProxy.test.js            # Proxy initialization, execution, and access control
└── validators/
    ├── UniversalRouterValidator.test.js   # Swap calldata validation
    ├── UniswapV3PositionValidator.test.js # V3 mint/liquidity validation
    ├── UniswapV4PositionValidator.test.js # V4 position validation
    ├── TJPositionValidator.test.js        # TJ position validation
    ├── TJSwapValidator.test.js            # TJ swap validation
    └── MerklIncentiveValidator.test.js    # Merkl claim calldata validation
```

## Mock Contracts

Tests use 8 mock contracts in `contracts/` (prefixed `Mock*`) to simulate external protocols: an ERC20 token, WETH, Uniswap V3 position NFTs, Universal Router, Trader Joe LB pair/router, and Permit2. Most mocks expose `setShouldFail()` for error path testing and `last*` variables for call verification. Plus one test actor (`MaliciousOwner.sol`) that rejects ETH to exercise vault ETH-transfer failure paths.

## Architecture

Detailed docs in `docs/architecture/`:
- **testing-patterns.md** — Mock contract APIs, deployment sequences, calldata encoding helpers, testing gotchas
- **coverage-quirks.md** — Why `npx hardhat coverage` reports false-negative branch gaps (viaIR + solidity-coverage 0.8.16 interaction). After 2026-04-20 round-2 closures, 100% line/function coverage with 48 remaining uncovered branches (~42 tool artifacts + 6 accepted NONREENTRANT_GUARD "locked" branches in TJPositionManager).

## Key Details

- **Solidity**: ^0.8.28
- **Hardhat config**: Local network only (chainId `1337`), no forking — external protocols are simulated via mocks
- **Setup**: `npm install` — no environment variables required
- **Interfaces**: `contracts/interfaces/` (6 files: `IIncentiveValidator`, `ILBPair`, `ILBRouter`, `ILiquidityValidator`, `ISwapValidator`, `IVaultFactory`) — also synced from `fum/contracts/`
- **Dependencies**: OpenZeppelin v5, Uniswap V3 core/periphery, Hardhat Toolbox
- **No dependency on fum_library** — this project is fully standalone
- Tests use Hardhat's built-in Chai matchers (`expect(...).to.be.revertedWith(...)`, etc.)
