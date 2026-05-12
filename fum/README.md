# F.U.M. - DeFi Liquidity Position Management & Automation

A full-stack DeFi application for creating, managing, and automating concentrated liquidity positions across multiple DEX platforms. F.U.M. enables users to deploy personal vaults with configurable automation strategies for hands-off liquidity management.

> `fum` is one subproject in the [fum_project monorepo](../README.md). The root README has the big-picture architecture and sibling-project overview; this doc covers `fum` specifically.
>
> **Working directory.** All commands and paths in this doc assume you're at the monorepo root (`fum_project/`). When you see `cd fum && npm run dev`, that's interpreted from the root. See [Monorepo Conventions](../README.md#monorepo-conventions) for details.

## Overview

F.U.M. combines a Next.js frontend with Solidity smart contracts to provide:

- **Personal Vaults** — Non-custodial smart contract vaults that hold token (native & ERC20) & liquidity position assets
- **Multi-Platform Support** — Uniswap V3, Uniswap V4, and Trader Joe V2.2 Liquidity Book (ERC1155-based)
- **Multi-Chain Support** — Arbitrum, Avalanche, Hardhat local forks
- **Automated Strategies** — Configure rebalancing parameters and let the automation service manage your positions
- **Real-Time Tracking** — Live updates via Server-Sent Events (SSE) connection to the automation service
- **APY Analytics** — Track returns including fees earned and gas costs

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        F.U.M. Frontend                          │◄─── SSE ───┐
│                    (Next.js + React + Redux)                    │            │
└─────────────────────────────┬───────────────────────────────────┘            │
                              │                                                │
              ┌───────────────┴───────────────┐                                │
              │                               │                                │
┌─────────────▼───────────┐     ┌─────────────▼───────────────────┐            │
│   Read Provider (RPC)   │     │   Write Provider (Wallet)       │            │
│   - Position queries    │     │   - Transaction signing         │            │
│   - Balance checks      │     │   - Vault creation              │            │
│   - Strategy params     │     │   - Strategy configuration      │            │
└────────────▲───┬────────┘     └──────────────┬──────────────────┘            │
       reads │   │                             │ tx                            │
             │   │                             │                               │
┌────────────┴───▼─────────────────────────────▼──────────────────┐            │
│                      Smart Contracts                            │            │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │            │
│  │ VaultFactory │  │PositionVault │  │  Strategies + TJPM    │  │            │
│  │ + Validators │  │              │  │  (see tables below)   │  │            │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │            │
└─────────────────────────────▲─────┬─────────────────────────────┘            │
                           tx │     │ events                                   │
                              │     │                                          │
┌─────────────────────────────┴─────▼─────────────────────────────┐            │
│              Automation Service (fum_automation)                │────────────┘
│         - Position monitoring & rebalancing                     │
│         - SSE event streaming to frontend                       │
└─────────────────────────────────────────────────────────────────┘

   fum_library — shared adapters, ABIs, helpers; build-time dependency of both fum and fum_automation
```

## Smart Contracts

### Production Ready

| Contract | Version | Description |
|----------|---------|-------------|
| **PositionVault** | v2.0.0 | User-controlled vault holding ERC20 tokens, native ETH, and LP positions (V3/V4 ERC721 NFTs and Trader Joe LB positions via TJPositionManager). Executes validated swaps, mints, liquidity operations, and ETH↔WETH wrapping. Supports EIP-1271 signature validation, payable `setExecutor` for initial gas funding, and `fundExecutor` for automated top-ups. |
| **VaultFactory** | v2.0.0 | Factory for creating and tracking vaults. Maintains swap and liquidity validator registries (plus a reserved-for-future-use incentive registry) and an active-vault registry that tracks only vaults with an executor set. Assigns each vault a monotonic `executorIndex` for deterministic executor wallet derivation. |
| **BabyStepsStrategy** | v2.0.0 | Template-based automation strategy with parameters for range width, fee reinvestment, and risk management. |
| **TJPositionManager** | v2.0.0 | Manages Trader Joe V2.2 liquidity bin positions via per-position EIP-1167 proxies for per-position fee attribution (off-chain fee math via LiquidityHelperContract). |
| **TJPositionProxy** | v2.0.0 | Minimal EIP-1167 proxy cloned per Trader Joe position; holds ERC1155 LB tokens. |

All production contracts expose `string public constant VERSION` for on-chain version attestation.

### Validators

Central calldata-validation layer. Each validator enforces that operation recipients are the vault itself, blocking an attack path where a compromised executor could reroute funds. All validators are v2.0.0.

| Validator | Purpose |
|-----------|---------|
| UniversalRouterValidator | Uniswap Universal Router swap commands (V2/V3/V4, PERMIT2, WRAP/UNWRAP) |
| UniswapV3PositionValidator | Uniswap V3 NonfungiblePositionManager ops |
| UniswapV4PositionValidator | Uniswap V4 PositionManager ops |
| TJSwapValidator | Trader Joe LBRouter swaps |
| TJPositionValidator | TJPositionManager ops |
| MerklIncentiveValidator | Merkl Distributor `claim()` calls |

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

The current implementation provides **BabyStepsStrategy** with the parameters below. Additional strategies can be added by extending `StrategyBase`.

**BabyStepsStrategy:**
- Select from preset templates (Conservative, Moderate, Aggressive, Stablecoin)
- Customize individual parameters:
  - **Range Parameters** — Target range width
  - **Fee Settings** — Reinvestment triggers and ratios
  - **Risk Management** — Max slippage, emergency exit triggers

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

> **Note:** `fum` is the source for the frontend and smart contracts. To interact with live contracts on Arbitrum, visit the [hosted app](https://fum-one.vercel.app/). Running this subproject locally is recommended only for development work or full-stack integration testing — see [TESTING.md](TESTING.md) for the setup.

### fum_library Setup

fum_library is consumed as a local tarball (`file:../fum_library/fum_library-*.tgz`) rather than via `npm link`. After making changes in fum_library, rebuild and reinstall the tarball into sibling projects:

```bash
cd fum_library
npm run pack   # builds, packs, and installs into fum and fum_automation
```

> **Never use `npm link`** — it causes module initialization issues. Always use `npm run pack`.

### Running the Stack

For the full local environment (Hardhat fork + contracts + automation service + frontend), follow the 4-terminal walkthrough in [TESTING.md](TESTING.md). It covers prereqs, env-var setup, seeding test data, wallet configuration, and verification.

## Available Scripts

Core scripts:

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js development server |
| `npm run build` | Build production bundle |
| `npm run start` | Start production server |
| `npm run contracts:sync` | Sync contracts to fum_library, fum_automation, and fum_testing |
| `npm run contracts:test` | Sync contracts + run Hardhat contract tests in fum_testing |
| `npm run contracts:test:coverage` | Sync contracts + run Hardhat coverage in fum_testing |
| `npm run hardhat` | Auto-sync contracts + start Arbitrum fork (chain 1337, port 8545) + deploy contracts |
| `npm run hardhat:av` | Auto-sync contracts + start Avalanche fork (chain 1338, port 8546) + deploy contracts |

> **Note:** `contracts:test:coverage` produces a large share of false-negative gaps (viaIR + solidity-coverage 0.8.16 interaction). See [fum_testing/docs/architecture/coverage-quirks.md](../fum_testing/docs/architecture/coverage-quirks.md) before acting on the report.

Local test-data seeding, fee generation, and price manipulation scripts are documented in [TESTING.md](TESTING.md).

## Project Structure

```
fum/
├── contracts/                   # Solidity smart contracts
│   ├── PositionVault.sol
│   ├── VaultFactory.sol
│   ├── StrategyBase.sol
│   ├── BabyStepsStrategy.sol
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

## Deployment

Production runs on Vercel. The monorepo's local-tarball dependency on `fum_library` requires a custom install pipeline; everything else uses Vercel's Next.js defaults.

### Vercel project configuration

| Setting | Value |
|---|---|
| **Root Directory** | `fum` |
| **Framework Preset** | Next.js (auto-detected and locked when Root = `fum`) |
| **Install Command** | Override → `npm run install:vercel` |
| **Build Command** | default (don't override) |
| **Output Directory** | default (don't override) |
| **Node.js Version** | 22.x |

The `install:vercel` script (`fum/package.json`) packs `fum_library`, strips the now-stale integrity hash for `fum_library` from `fum/package-lock.json` (file mtimes diverge between local pack and Vercel pack), then runs `npm install`. The wrapper exists because Vercel's Install Command field has a 256-char limit, which the inline pipeline blows past. See `docs/decisions/deployment-architecture.md` for the shared `fum_library` tarball pattern used by both this and the `fum_automation` Dockerfile.

### Required env vars

Set in Vercel → Settings → Environment Variables (Production scope). Values come from your provider dashboards and the Railway-deployed automation service URL.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_COINGECKO_API_KEY` | Token price feeds |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | RPC endpoints (V3/V4 adapters, AlphaRouter) |
| `NEXT_PUBLIC_THEGRAPH_API_KEY` | Subgraph queries (V4 pool discovery, position lookup) |
| `NEXT_PUBLIC_DEMO_ADDRESS` | Wallet to feature on the demo page |
| `NEXT_PUBLIC_DEMO_CHAIN_ID` | `42161` for production, `1337` for local fork |
| `NEXT_PUBLIC_SSE_URL` | Public URL of the Railway automation service `/events` endpoint |

### Important: `NEXT_PUBLIC_*` env vars are publicly visible

Next.js bakes any env var prefixed `NEXT_PUBLIC_` directly into the client JavaScript bundle at build time. Anyone who loads the deployed frontend can read these values from DevTools. This is not a vulnerability — it's the only way client-side code can call third-party APIs — but it has implications:

- **Configure Allowed Origins / Referrer restrictions** on every NEXT_PUBLIC_ key in its provider dashboard (Alchemy, CoinGecko, The Graph). Restricts the key to requests from your Vercel domain (and any custom domain you add).
- **Set spending caps** on every key as a backstop in case the referrer restriction is bypassed.
- For genuinely sensitive backend operations, route them through `fum_automation` (which has unprefixed env vars that stay server-only), not directly from the frontend.

### Deploy lifecycle

Vercel auto-rebuilds on every push to `main`. To force a redeploy without code changes (e.g., after env var updates):

```bash
git commit --allow-empty -m "trigger vercel rebuild" && git push
```

Or use the Redeploy button on the latest deployment in the Vercel dashboard — make sure to choose "Redeploy with current Project Settings", not "Redeploy with existing Build Cache", when settings have changed.

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

## Version History

See [CHANGELOG.md](CHANGELOG.md) for the full history.

## License

Copyright (c) 2025 Derrek Brack. All rights reserved.

This software is proprietary and provided for portfolio demonstration purposes only. See [LICENSE.md](LICENSE.md) for details.

## Author

**Derrek Brack** & **Claude Code**

For licensing inquiries, please contact the copyright holder.
