<!-- Source: package.json, src/pages/*, src/redux/*, src/hooks/*, src/components/*, contracts/*.sol, contracts/validators/*, contracts/interfaces/*, scripts/*.js, test/scripts/*.js, docs/architecture/*.md -->
# CLAUDE.md — fum (Frontend + Smart Contracts)

## What This Project Is

Next.js frontend for the FUM DeFi platform plus the Solidity smart contracts that power it. Users connect wallets, deploy personal vaults, manage liquidity positions, and configure automation strategies.

## Commands

```bash
npm run dev                    # Next.js dev server
npm run build                  # Production build
npm run contracts:sync         # Sync contracts → fum_testing, fum_automation, fum_library
npm run contracts:test         # Sync + run Hardhat tests in fum_testing
npm run contracts:test:coverage # Sync + run Hardhat coverage in fum_testing
npm run hardhat                # Start local node + deploy contracts + update fum_library addresses
npm run seed-localhost         # Create test vault + seed data on local node
npm run manipulate-price:up    # Push test token prices up (for testing rebalances)
npm run manipulate-price:down  # Push test token prices down
npm run generate-fees          # Generate trading fees on test positions
```

**Local frontend dev flow**: `npm run hardhat` → (new terminal) `npm run seed-localhost` → `npm run dev`

## Project Structure

```
src/
├── components/
│   ├── common/          # Navbar, WalletConnect, PriceRangeChart, AutomationStatus
│   ├── positions/       # Position cards, add/remove liquidity, claim fees modals
│   ├── transactions/    # Transaction history list
│   └── vaults/          # Vault cards, strategy config, deposit/withdraw modals
├── hooks/               # useProviders, useReadProvider, useWriteProvider, useAutomationEvents
├── pages/               # Next.js Pages Router (index, demo, vaults, positions)
├── redux/               # Redux Toolkit slices (vaults, positions, pools, tokens, strategies, etc.)
├── context/             # ProviderContext, ToastContext
├── styles/              # Global CSS + modules
└── utils/               # Strategy icons, vault helpers

contracts/
├── PositionVault.sol         # Core vault — holds tokens, ETH, LP positions
├── VaultFactory.sol          # Deploys and tracks vaults
├── StrategyBase.sol          # Abstract base for strategies
├── BabyStepsStrategy.sol     # Conservative range-based automation
├── ParrisIslandStrategy.sol  # Advanced adaptive strategy (in development)
├── TJPositionManager.sol     # Trader Joe V2.2 bin position management (proxy-per-position)
├── TJPositionProxy.sol       # EIP-1167 minimal proxy — holds ERC1155 LB tokens per position
├── interfaces/               # IVaultFactory, ILBPair, ILBRouter, ISwapValidator, ILiquidityValidator, IIncentiveValidator
└── validators/               # UniversalRouterValidator, UniswapV3/V4PositionValidator, TJPositionValidator, TJSwapValidator, MerklIncentiveValidator

scripts/
├── sync-contracts-to-ecosystem.js  # Master contract distribution (source of truth)
├── extract-abis.js                 # Extract ABIs → fum_library
├── extract-bytecode.js             # Extract bytecode from fum_testing artifacts
└── deploy.js                       # Chain-agnostic deployment + address tracking

deployments/                  # Deployment address records (1337-latest.json, 42161-latest.json)
test/scripts/                 # Local dev helpers (start-hardhat, seed, generate-fees, manipulate-price)
```

## Key Conventions

- **Framework**: Next.js 15, Pages Router, React 19, Redux Toolkit
- **Blockchain**: ethers.js v5 (not v6)
- **Styling**: React-Bootstrap + Bootstrap 5, global CSS
- **State**: Redux slices for all domain data (vaults, positions, pools, tokens, strategies)
- **Wallet**: Web3Modal for connection, custom hooks for read/write providers
- **Contracts**: Solidity ^0.8.0, OpenZeppelin v5

## Architecture

Detailed docs in `docs/architecture/`:
- **contract-system.md** — Contract relationships, execution flow, factory registry, strategy system
- **validator-pattern.md** — Calldata validation deep-dive, security invariants, adding new validators
- **frontend.md** — Redux state shapes, data flow, SSE integration, component organization
- **scripts-pipeline.md** — Contract sync, ABI/bytecode extraction, deployment, cross-project effects

## Smart Contract Workflow

Edit contracts in `contracts/`, run `npm run contracts:sync` to distribute, `npm run contracts:test` to test. See [scripts-pipeline.md](docs/architecture/scripts-pipeline.md) for the full 6-step pipeline and cross-project effects.

## Validator Pattern

Every swap/liquidity operation passes through a validator that parses calldata and enforces recipient restrictions. Validators are registered in VaultFactory and called automatically. See [validator-pattern.md](docs/architecture/validator-pattern.md) for calldata offset calculations, selector hex values, and security invariants.
