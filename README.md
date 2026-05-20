# FUM

> Your liquidity. Your keys. A service that doesn't sleep.

FUM is a DeFi liquidity management platform. Users deploy non-custodial vaults that hold tokens and concentrated-liquidity positions across multiple DEXes. An automation service watches those vaults around the clock and executes rebalances, fee collection, and position management based on the strategy each user picks.

> **Note:** To interact with live contracts on Arbitrum, visit the [hosted app](https://fum-one.vercel.app/). This repository is the source code — running it locally is for development and full-stack integration testing (see [fum/TESTING.md](fum/TESTING.md)).

**Supported platforms:** Uniswap V3 · Uniswap V4 · Trader Joe V2.2
**Chains:** Arbitrum (primary) · Avalanche (Trader Joe) · Hardhat fork (local dev)

## Architecture

```
                       ┌────────────────────┐
                       │        User        │
                       └─────────┬──────────┘
                                 │ wallet (MetaMask, etc.)
                       ┌─────────▼──────────┐
                       │   fum (frontend)   │◄──── SSE updates ────┐
                       │  Next.js + React   │                      │
                       └───────┬─────▲──────┘                      │
                            tx │     │ reads                       │
            ┌──────────────────▼─────┴─────────────────────┐       │
            │             Smart Contracts                  │       │
            │  PositionVault · VaultFactory · Strategies   │       │
            │  Validators · TJPositionManager              │       │
            └──────────────────▲─────┬─────────────────────┘       │
                            tx │     │ events                      │
                       ┌───────┴─────▼──────┐                      │
                       │   fum_automation   │──────────────────────┘
                       │  Node.js service   │
                       └────────────────────┘

   fum_library — shared adapters, ABIs, helpers; consumed by fum and fum_automation
   fum_testing — isolated Hardhat environment for contract unit tests
```

## Subprojects

| Subproject | What it is | Read more |
|------------|-----------|-----------|
| **fum** | Next.js frontend + Solidity smart contracts. The contracts here are the source of truth — other subprojects sync from them. | [fum/README.md](fum/README.md) |
| **fum_library** | Shared JavaScript library: platform adapters, ABIs, chain configs, blockchain helpers, price feeds. Installed into siblings as a local tarball. | [fum_library/README.md](fum_library/README.md) |
| **fum_automation** | 24/7 Node.js service that monitors authorized vaults and executes rebalances, fee collection, and position lifecycle operations. | [fum_automation/README.md](fum_automation/README.md) |
| **fum_testing** | Standalone Hardhat environment for contract unit tests. Fully self-contained — external protocols (Uniswap, Trader Joe, Permit2, WETH) are simulated via mock contracts. | [fum_testing/README.md](fum_testing/README.md) |

## Repo Layout

```
fum_project/
├── fum/                # Frontend + smart contracts (source of truth)
├── fum_library/        # Shared adapters, helpers, ABIs, configs
├── fum_automation/     # 24/7 automation service
└── fum_testing/           # Hardhat unit-test environment
```

## Getting Started

This is a **single Git repository** — clone it once and all four subprojects come with it (they are not separate repos):

```bash
git clone https://github.com/derrek-b/fum_project.git
cd fum_project
```

### First-time install

`fum` and `fum_automation` consume `fum_library` as a local tarball (a `file:` dependency), and that tarball is **gitignored** — a fresh clone doesn't include it. Build and install it *before* the consumers, or their `npm install` fails on the missing file:

```bash
cd fum_library && npm install && npm run pack   # build + pack the tarball, install it into fum & fum_automation
cd ../fum && npm install
cd ../fum_automation && npm install
cd ../fum_testing && npm install                # standalone — not a tarball consumer
```

Re-run `npm run pack` after any `fum_library` change so the consumers pick it up. For the full local stack integration testing (Hardhat fork + automation + frontend), continue to [fum/TESTING.md](fum/TESTING.md).

All commands in this repo's docs run from this root — see [Monorepo Conventions](#monorepo-conventions).

## Where to Start

This README is orientation. Each subproject has its own README and TESTING guide with full setup details — pick your destination below.

| If you want to... | Go to |
|-------------------|-------|
| Use FUM on Arbitrum | [hosted app](https://fum-one.vercel.app/) |
| Run the full stack locally | [fum/TESTING.md](fum/TESTING.md) — 4-terminal walkthrough with env config, seeding, and troubleshooting |
| Read or modify the smart contracts | [fum/](fum/) — contracts live in `fum/contracts/` |
| Extend the automation service | [fum_automation/](fum_automation/) |
| Add a new DEX adapter | [fum_library/](fum_library/) — see `fum_library/docs/architecture/adapters.md` |
| Run contract unit tests | [fum/TESTING.md](fum/TESTING.md#contract-unit-tests) — run `npm run contracts:test` from [fum/](fum/) |

## Monorepo Conventions

- **Working directory.** All commands and paths in this repo's docs (root + every subproject's README/TESTING/CLAUDE) assume you're at the monorepo root (`fum_project/`). When a doc shows `cd fum_library && npm run pack` or `cd fum_automation`, that's interpreted from the root. Run `cd <path-to-your-clone>/fum_project` first.
- **Node 22+** — required for ES module JSON import syntax.
- **ethers.js v5** — the whole codebase uses v5, not v6.
- **fum_library is consumed via tarball, not `npm link`.** After making changes there, run `cd fum_library && npm run pack` to rebuild and reinstall into the sibling projects. `npm link` causes module-initialization issues in this codebase — always use `npm run pack`.
- **Contracts live in `fum/contracts/`.** Other subprojects receive copies via `cd fum && npm run contracts:sync`. Never edit the synced copies directly.

## License

Copyright (c) 2025 Derrek Brack. All rights reserved.

Proprietary — provided for portfolio demonstration purposes only. See [LICENSE.md](LICENSE.md) for details.

## Author

**Derrek Brack** & **Claude Code**

For licensing inquiries, please contact the copyright holder.
