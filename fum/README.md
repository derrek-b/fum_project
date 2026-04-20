# F.U.M. - DeFi Liquidity Position Management & Automation

A full-stack DeFi application for creating, managing, and automating concentrated liquidity positions across multiple DEX platforms. F.U.M. enables users to deploy personal vaults with configurable automation strategies for hands-off liquidity management.

## Overview

F.U.M. combines a Next.js frontend with Solidity smart contracts to provide:

- **Personal Vaults** — Non-custodial smart contract vaults that hold ERC20 tokens, native ETH/AVAX, and LP positions
- **Multi-Platform Support** — Uniswap V3, Uniswap V4, and Trader Joe V2.2 Liquidity Book (ERC1155-based)
- **Multi-Chain Support** — Arbitrum (production), Avalanche (Trader Joe), Hardhat local forks
- **Automated Strategies** — Configure rebalancing parameters and let the automation service manage your positions
- **Incentive Claiming** — Validated Merkl Distributor claims to the vault
- **Real-Time Tracking** — Live updates via Server-Sent Events (SSE) connection to the automation service
- **APY Analytics** — Track returns including fees earned and gas costs

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        F.U.M. Frontend                          │
│                    (Next.js + React + Redux)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────────────┐
│   Read Provider (RPC)   │     │   Write Provider (Wallet)       │
│   - Position queries    │     │   - Transaction signing         │
│   - Balance checks      │     │   - Vault creation              │
│   - Strategy params     │     │   - Strategy configuration      │
└─────────────────────────┘     └─────────────────────────────────┘
              │                               │
              └───────────────┬───────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Smart Contracts                            │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ VaultFactory │  │PositionVault │  │  Strategies + TJPM    │  │
│  │ + Validators │  │              │  │  (see tables below)   │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Automation Service (fum_automation)                │
│         - Position monitoring & rebalancing                     │
│         - SSE event streaming to frontend                       │
└─────────────────────────────────────────────────────────────────┘
```

## Smart Contracts

### Production Ready

| Contract | Version | Description |
|----------|---------|-------------|
| **PositionVault** | v1.3.0 | User-controlled vault holding ERC20 tokens, native ETH, and LP positions (V3/V4 ERC721 NFTs and Trader Joe LB positions via TJPositionManager). Executes validated swaps, mints, liquidity operations, incentive claims, and ETH↔WETH wrapping. Supports EIP-1271 signature validation, payable `setExecutor` for initial gas funding, and `fundExecutor` for automated top-ups. |
| **VaultFactory** | v2.0.0 | Factory for creating and tracking vaults. Maintains three validator registries (swap, liquidity, incentive) and an active-vault registry that tracks only vaults with an executor set. Assigns each vault a monotonic `executorIndex` for deterministic executor wallet derivation. |
| **BabyStepsStrategy** | v2.0.0 | Template-based automation strategy with parameters for range width, fee reinvestment, and risk management. |
| **TJPositionManager** | — | Manages Trader Joe V2.2 liquidity bin positions via per-position EIP-1167 proxies for per-position fee attribution (off-chain fee math via LiquidityHelperContract). |
| **TJPositionProxy** | — | Minimal EIP-1167 proxy cloned per Trader Joe position; holds ERC1155 LB tokens. |

### Validators

Central calldata-validation layer. Each validator enforces that operation recipients are the vault itself, blocking an attack path where a compromised executor could reroute funds.

| Validator | Purpose |
|-----------|---------|
| UniversalRouterValidator | Uniswap Universal Router swap commands (V2/V3/V4, PERMIT2, WRAP/UNWRAP) |
| UniswapV3PositionValidator | Uniswap V3 NonfungiblePositionManager ops |
| UniswapV4PositionValidator | Uniswap V4 PositionManager ops |
| TJSwapValidator | Trader Joe LBRouter swaps |
| TJPositionValidator | TJPositionManager ops |
| MerklIncentiveValidator | Merkl Distributor `claim()` calls |

### In Development

| Contract | Version | Description |
|----------|---------|-------------|
| **ParrisIslandStrategy** | v0.4.0 | Advanced adaptive strategy with 26 parameters covering position sizing, pool liquidity requirements, oracle selection, and dynamic range adjustments. |

## Features

### Vault Management
- Create multiple vaults with unique names
- Configure target tokens per vault
- Deposit/withdraw ERC20 tokens
- Assign/unassign LP positions to vaults

### Position Management
- View positions across all supported platforms (V3, V4, Trader Joe) for both wallet and vaults
- Add/remove liquidity from positions
- Collect accumulated fees
- Close positions completely

### Strategy Configuration
- Select from preset templates (Conservative, Moderate, Aggressive, Stablecoin)
- Customize individual parameters:
  - **Range Parameters** - Target range width, rebalance thresholds
  - **Fee Settings** - Reinvestment triggers and ratios
  - **Risk Management** - Max slippage, emergency exit triggers

### Real-Time Updates
- SSE connection to automation service
- Live notifications for:
  - Position rebalances
  - Fee collections
  - New position mints
  - Token swaps
  - Vault status changes

### Demo Mode
- View live vault automation without connecting wallet
- Showcase of system capabilities

## Getting Started

### Prerequisites

- Node.js 22+ (required for ES module JSON import syntax)
- npm or yarn
- MetaMask or compatible EVM wallet

### Monorepo Layout

`fum` is one subproject in the `fum_project` monorepo. Sibling subprojects:

```
fum_project/
├── fum/              # This subproject (Frontend + Smart Contracts)
├── fum_library/      # Shared utilities (adapters, ABIs, helpers)
├── fum_automation/   # Automation service (position monitoring & rebalancing)
└── fum_testing/      # Hardhat contract test environment
```

### fum_library Setup

fum_library is consumed as a local tarball (`file:../fum_library/fum_library-*.tgz`) rather than via `npm link`. After making changes in fum_library, rebuild and reinstall the tarball into sibling projects:

```bash
cd fum_library
npm run pack   # builds, packs, and installs into fum and fum_automation
```

> **Never use `npm link`** — it causes module initialization issues. Always use `npm run pack`.

### Installation

```bash
# Install dependencies (requires fum_library to be built first)
npm install

# Copy environment template
cp .env.example .env.local
```

### Environment Configuration

Copy `.env.example` to `.env.local` and configure:

```bash
# Demo page showcase address (required for demo page)
NEXT_PUBLIC_DEMO_ADDRESS=0x...

# Demo page chain ID (1337 for local, 42161 for Arbitrum)
NEXT_PUBLIC_DEMO_CHAIN_ID=1337

# Automation service SSE endpoint
NEXT_PUBLIC_SSE_URL=http://your-automation-service:port/events

# CoinGecko API key for token price feeds (optional but strongly recommended)
NEXT_PUBLIC_COINGECKO_API_KEY=your_coingecko_api_key

# Alchemy API key for dedicated RPC provider and AlphaRouter swap routing
# Needed for both production (read provider) and local testing (forked Arbitrum state)
NEXT_PUBLIC_ALCHEMY_API_KEY=your_alchemy_api_key
```

### Development

```bash
# Start development server
npm run dev

# Open http://localhost:3000
```

### Local Blockchain Development

For full application testing setup, see [TESTING.md](TESTING.md).

## Available Scripts

Core scripts:

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js development server |
| `npm run build` | Build production bundle |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run contracts:sync` | Sync contracts to fum_library, fum_automation, and fum_testing |
| `npm run contracts:test` | Sync contracts + run Hardhat contract tests in fum_testing |
| `npm run contracts:test:coverage` | Sync contracts + run Hardhat coverage in fum_testing |
| `npm run hardhat` | Start Arbitrum fork (chain 1337, port 8545) + deploy contracts |
| `npm run hardhat:av` | Start Avalanche fork (chain 1338, port 8546) + deploy contracts |

Local test-data seeding, fee generation, and price manipulation scripts are documented in [TESTING.md](TESTING.md).

## Project Structure

```
fum/
├── contracts/                   # Solidity smart contracts
│   ├── PositionVault.sol
│   ├── VaultFactory.sol
│   ├── StrategyBase.sol
│   ├── BabyStepsStrategy.sol
│   ├── ParrisIslandStrategy.sol
│   ├── TJPositionManager.sol
│   ├── TJPositionProxy.sol
│   ├── interfaces/              # ISwapValidator, ILiquidityValidator, IIncentiveValidator, ...
│   └── validators/              # UniversalRouter, V3/V4, TJ, Merkl validators
├── src/
│   ├── pages/                   # Next.js Pages Router
│   ├── components/              # common / vaults / positions / transactions
│   ├── redux/                   # Store + slices (wallet, vaults, positions, strategies, platforms, automation, updates)
│   ├── context/                 # ToastContext
│   ├── contexts/                # ProviderContext (ethers providers)
│   ├── hooks/                   # useProviders, useAutomationEvents, useModalData, ...
│   ├── utils/                   # vaultsHelpers, sseEventHandlers, strategyIcons
│   └── styles/                  # Global CSS + modules
├── scripts/                     # Contract sync + deployment scripts
├── test/scripts/                # Local dev helpers (hardhat, seed, generate-fees, manipulate-price)
├── bytecode/                    # Extracted contract bytecode (populated by sync)
├── deployments/                 # Deployment address records (`{chainId}-latest.json`)
└── public/                      # Static assets
```

See `docs/architecture/` for per-subsystem deep dives (contract system, validator pattern, frontend, scripts pipeline).

## Tech Stack

### Frontend
- **Next.js 15** - React framework with Pages Router
- **React 19** - UI library
- **Redux Toolkit** - State management
- **React Bootstrap** - UI components
- **ethers.js v5** - Blockchain interaction

### Smart Contracts
- **Solidity ^0.8.0** - Contract language
- **OpenZeppelin Contracts v5** - Security standards
- **Hardhat** - Development framework, testing, and local blockchain

### External Dependencies
- **fum_library** — Shared adapters (V3/V4/TJ), ABIs, blockchain utilities, price feeds
- **Uniswap V3 SDK / V4 SDK** — Position calculations
- **CoinGecko API** — Token pricing (via fum_library)

## Sibling Subprojects

| Subproject | Description |
|------------|-------------|
| `fum_library` | Shared library with V3/V4/TJ adapters, ABIs, price helpers, chain configs |
| `fum_automation` | Automation service for position monitoring, rebalancing, and fee collection |
| `fum_testing` | Isolated Hardhat environment for contract unit tests |

## Version History

See [CHANGELOG.md](CHANGELOG.md) for the full history.

## License

Copyright (c) 2025 Derrek Brack. All rights reserved.

This software is proprietary and provided for portfolio demonstration purposes only. See [LICENSE.md](LICENSE.md) for details.

## Author

**Derrek Brack** & **Claude Code**

For licensing inquiries, please contact the copyright holder.
