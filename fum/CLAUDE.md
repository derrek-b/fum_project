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
npm run hardhat                # Start Arbitrum fork (chain 1337, port 8545) + deploy + update fum_library
npm run hardhat:av             # Start Avalanche fork (chain 1338, port 8546) + deploy + update fum_library
npm run seed-localhost         # Create V3 vault + seed tokens (see variants below)
npm run manipulate-price:up    # Push WETH/USDC price up (V3, supports --platform=v4 --token=SYMBOL)
npm run manipulate-price:down  # Push WETH/USDC price down
npm run manipulate-price:av:up # Push WAVAX/USDC price up (TJ V2.2, supports --token=USDT|AUSD)
npm run generate-fees          # Generate fees on WETH/USDC (V3, supports --platform=v4 --token=SYMBOL)
npm run generate-fees:av       # Generate fees on WAVAX/USDC (TJ V2.2, supports --token=USDT|AUSD)
```

**Seed script variants** — each platform has a base script plus opt-in flags via `ENABLE_STRATEGY` and `ENABLE_AUTOMATION`:

| Script | What it does |
|---|---|
| `seed-localhost` | V3: vault + tokens + position on wallet + generated fees |
| `seed-localhost:strategy` | + strategy + targets |
| `seed-localhost:automation` | + strategy + position moved into vault + executor (triggers automation) |
| `seed-localhost:v4` / `:v4:strategy` / `:v4:automation` | Same pattern for Uniswap V4 |
| `seed-localhost:av` | Avalanche TJ: vault + tokens (position only with `ENABLE_POSITION=1`) |
| `seed-localhost:av:strategy` | + strategy + targets |
| `seed-localhost:av:automation` | + strategy + position minted in vault + executor (triggers automation) |

**Local frontend dev flow**: `npm run hardhat` → (new terminal) `npm run seed-localhost` → `npm run dev`

## Project Structure

```
src/
├── components/
│   ├── common/          # Navbar, WalletConnect, PriceRangeChart, AutomationStatus, RefreshControls
│   ├── positions/       # Position cards, add/remove liquidity, claim fees, close position modals
│   ├── transactions/    # Transaction history list
│   └── vaults/          # Vault cards, strategy config, deposit/withdraw/fund-executor modals
├── hooks/               # useProviders, useReadProvider, useWriteProvider, useAutomationEvents, useModalData
├── pages/               # Next.js Pages Router (index, demo, vaults, positions, vault/[address], position/[id], _error)
├── redux/               # Redux Toolkit slices (wallet, vaults, positions, strategies, platforms, automation, updates)
├── context/             # ToastContext (singular dir)
├── contexts/            # ProviderContext — ethers providers (plural dir)
├── styles/              # Global CSS + modules
└── utils/               # vaultsHelpers, sseEventHandlers, strategyIcons

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

deployments/                  # Deployment address records (1337-latest.json, 1338-latest.json, 42161-latest.json)
test/scripts/                 # Local dev helpers (start-hardhat, seed, generate-fees, manipulate-price)
```

## Key Conventions

- **Framework**: Next.js 15, Pages Router, React 19, Redux Toolkit
- **Blockchain**: ethers.js v5 (not v6)
- **Styling**: React-Bootstrap + Bootstrap 5, global CSS
- **State**: Redux slices for all domain data (wallet, vaults, positions, strategies, platforms, automation, updates) — pool/token data embedded in position objects and vault `tokenBalances`, no separate pools/tokens slices
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
