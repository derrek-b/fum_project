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

## Do NOT Edit Contracts Here

Contracts in this project are **copies** synced from `fum/contracts/`. The source of truth is always `fum/contracts/`. To update contracts here:

```bash
cd ../fum && npm run contracts:sync
```

## Test Structure

```
test/unit/
├── PositionVault.test.js              # Core vault operations (deposits, swaps, positions)
├── VaultFactory.test.js               # Factory deployment and vault creation
├── StrategyBase.test.js               # Abstract strategy base tests
├── BabyStepsStrategy.test.js          # Conservative strategy logic
├── ParrisIslandStrategy.test.js       # Advanced adaptive strategy
├── TJPositionManager.test.js          # Trader Joe V2.2 bin position management
├── UniversalRouterValidator.test.js   # Swap calldata validation
├── UniswapV3PositionValidator.test.js # V3 mint/liquidity validation
├── UniswapV4PositionValidator.test.js # V4 position validation
├── TJPositionValidator.test.js        # TJ position validation
└── TJSwapValidator.test.js            # TJ swap validation
```

## Mock Contracts

Tests use mock contracts in `contracts/mocks/` to simulate external protocols:
- **MockERC20** / **MockWETH** — Token contracts with mint capabilities
- **MockPositionNFT** / **MockNonfungiblePositionManager** — Uniswap V3 position NFTs
- **MockUniversalRouter** — Uniswap swap router
- **MockLBPair** / **MockLBRouter** — Trader Joe V2.2 liquidity book
- **MockPermit2** — Permit2 gasless approvals

## Key Details

- **Solidity**: ^0.8.28
- **Hardhat config**: Forks Arbitrum mainnet via Alchemy (`NEXT_PUBLIC_ALCHEMY_API_KEY` in .env)
- **Dependencies**: OpenZeppelin v5, Uniswap V3 core/periphery, Hardhat Toolbox
- **No dependency on fum_library** — this project is fully standalone
- Tests use Hardhat's built-in Chai matchers (`expect(...).to.be.revertedWith(...)`, etc.)
