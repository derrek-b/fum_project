<!-- Source: fum/package.json, fum_library/package.json, fum_automation/package.json, fum_testing/package.json, docs/decisions/*, docs/platform-knowledge/*, fum/CLAUDE.md, fum_library/CLAUDE.md, fum_automation/CLAUDE.md, fum_testing/CLAUDE.md -->
# CLAUDE.md — FUM Project

## What is FUM?

FUM is a DeFi liquidity management platform. Users deploy personal non-custodial vaults that hold tokens and concentrated liquidity positions across multiple DEX platforms. An automation service monitors these vaults 24/7, executing rebalances, fee collection, and position management based on configurable strategies.

**Supported platforms**: Uniswap V3, Uniswap V4, Trader Joe V2.2
**Primary chain**: Arbitrum (chainId 42161), with Avalanche support for Trader Joe
**Local dev chain**: Hardhat (chainId 1337)

## Monorepo Structure

```
fum_project/
├── fum/                 # Next.js frontend + Solidity smart contracts
├── fum_library/         # Shared library (adapters, helpers, configs, ABIs)
├── fum_automation/      # Node.js automation service
└── fum_testing/         # Hardhat contract test environment
```

### Dependency Flow

```
fum_library ──(tarball install)──> fum
fum_library ──(tarball install)──> fum_automation
fum ──(contract sync scripts)──> fum_testing, fum_automation, fum_library
```

- `fum` and `fum_automation` consume `fum_library` via `file:../fum_library/fum_library-2.0.0.tgz`
- After changing fum_library: `cd fum_library && npm run pack` (builds, packs, and installs into siblings)
- **Never use npm link** to share fum_library — it causes initialization issues. Always use `npm run pack`.
- Contract changes in `fum/contracts/` are synced with: `cd fum && npm run contracts:sync`

## Quick Reference — Commands

### fum (frontend)
```bash
cd fum && npm run dev              # Next.js dev server
cd fum && npm run contracts:sync   # Sync contracts to all projects
cd fum && npm run contracts:test   # Sync + run Hardhat tests
cd fum && npm run hardhat          # Start Arbitrum fork (chain 1337, port 8545) + deploy + update fum_library
cd fum && npm run hardhat:av       # Start Avalanche fork (chain 1338, port 8546) + deploy + update fum_library
cd fum && npm run seed-localhost   # Create test vault + seed data
```

### fum_library
```bash
cd fum_library && npm run build    # Build dist/
cd fum_library && npm run pack     # Build + pack + install into fum & fum_automation
cd fum_library && npm test         # Vitest unit tests
```

### fum_automation
```bash
cd fum_automation && npm run start           # Start automation service (defaults to .env.local, Arbitrum)
cd fum_automation && npm run start:av        # Start automation against Avalanche fork (uses .env.local.av)
cd fum_automation && npm test                # Unit tests only (single-fork constraint)
cd fum_automation && npm run test:v3         # Uniswap V3 workflow tests
cd fum_automation && npm run test:v4         # Uniswap V4 workflow tests
cd fum_automation && npm run test:arb        # Run specific V3 or V4 test (vitest run <path>)
cd fum_automation && npm run test:tj         # All Trader Joe workflow tests
cd fum_automation && npm run test:av         # Run specific TJ test (FORK_CHAIN=avalanche vitest run <path>)
```

### fum_testing
```bash
cd fum_testing && npx hardhat test       # Run all contract tests
cd fum_testing && npx hardhat coverage   # Coverage report
cd fum_testing && npx hardhat node       # Start local node
```

## Architecture Overview

### Smart Contracts (fum/contracts/)
- **PositionVault** — User-controlled vault for ERC20s, native ETH, and LP positions. Supports swaps via UniversalRouter, minting, liquidity operations, ETH wrapping.
- **VaultFactory** — Deploys and tracks PositionVault instances. Manages three validator registries (swap, liquidity, incentive).
- **BabyStepsStrategy** — Conservative range-based automation strategy with configurable parameters.
- **TJPositionManager** — Manages Trader Joe V2.2 liquidity bin positions via per-position EIP-1167 proxies. Off-chain fee math via LiquidityHelperContract.
- **TJPositionProxy** — Minimal proxy (EIP-1167) cloned per Trader Joe position. Holds ERC1155 LB tokens for per-position fee attribution.
- **MerklIncentiveValidator** — Validates Merkl Distributor `claim()` calls (selector + user == vault).
- **StrategyBase** — Abstract base contract for strategy implementations.

### fum_library Modules
- `fum_library/adapters` — Platform adapters (UniswapV3Adapter, UniswapV4Adapter, TraderJoeV2_2Adapter). Each adapter implements the PlatformAdapter interface for position management, swaps, fee calculation, pool data.
- `fum_library/helpers` — Utilities: formatHelpers, chainHelpers, tokenHelpers, platformHelpers, strategyHelpers, Permit2Helper
- `fum_library/blockchain` — Web3 provider creation, wallet connection, contract instantiation
- `fum_library/services` — External APIs (CoinGecko price feeds, Merkl incentive campaigns, The Graph, block explorers)
- `fum_library/configs` — Chain configs, token lists, platform metadata
- `fum_library/artifacts` — Contract ABIs and deployment addresses

### Automation Service (fum_automation/src/)
Event-driven architecture. Modules in `src/core/`:
1. **AutomationService** — Orchestration: vault discovery, strategy allocation, processing loop
2. **VaultDataService** — Data layer: vault state, position tracking, token balances
3. **Strategies** — StrategyBase → BabyStepsStrategy. Each strategy handles evaluation (is position in range?), rebalancing, fee collection, and position creation. Lives under `src/strategies/`.
4. **EventManager** — Centralized pub/sub for system events (PositionRebalanced, FeesCollected, NewPositionCreated, etc.)
5. **Tracker** — Transaction history and performance tracking
6. **VaultHealth** — Executor gas monitoring and automated top-ups (holdback + funding-required state)
7. **ServiceHealth** — WebSocket subscription canary with ping/pong keepalive
8. **SSEBroadcaster** — Real-time update stream to frontend clients (Server-Sent Events)

Detailed architecture docs: `fum_automation/docs/architecture/`

### Frontend (fum/src/)
Next.js 15 (Pages Router), React 19, Redux Toolkit. Connects to vaults via ethers.js v5. Real-time updates from automation service via SSE.

## Code Conventions

- **Language**: JavaScript ES modules throughout (import/export). No TypeScript.
- **Indentation**: 2 spaces
- **Naming**: camelCase for variables/functions, PascalCase for classes, UPPER_CASE for constants
- **Async**: Always use async/await, never raw promise chains
- **Imports**: Group by: built-in modules → external deps → local modules
- **Error handling**: try/catch with specific messages. Use `console.error()` for errors.
- **Smart contracts**: Solidity ^0.8.0, OpenZeppelin v5
- **Blockchain lib**: ethers.js v5 (not v6)
- **Testing**: Vitest for JS (fum_library, fum_automation), Hardhat+Chai for Solidity (fum_testing)
- **Node version**: >=22.0.0

## Key Patterns

### Adapter Pattern
All DEX interactions go through platform adapters that implement a common interface (PlatformAdapter base class). When adding support for a new platform, create a new adapter extending PlatformAdapter. See existing adapters in `fum_library/src/adapters/`.

### Strategy Pattern
Automation strategies extend StrategyBase. Key lifecycle methods: `setupVault()`, `evaluatePositions()`, `handleRebalance()`, `handleFeeCollection()`. See `fum_automation/src/strategies/`.

### Contract Sync Pipeline
Contracts live in `fum/contracts/` as the source of truth. Scripts in `fum/scripts/` handle:
- `sync-contracts-to-ecosystem.js` — Copies .sol files to fum_testing, fum_automation, fum_library
- `extract-abis.js` — Extracts ABIs into fum_library
- `extract-bytecode.js` — Extracts compiled bytecode from fum_testing artifacts
- `deploy.js` — Deploys contracts and updates fum_library with addresses

## Domain Knowledge

Cross-cutting docs that don't belong to a single subproject live in `docs/`:
- `docs/decisions/` — Architecture decisions and the "why" behind them
- `docs/platform-knowledge/` — DEX-specific quirks and gotchas (Uniswap V3/V4, Trader Joe V2.2). V2 swap event shape is documented there for AlphaRouter cross-version routing, but V2 is not a first-class supported platform.

Per-project docs:
- `fum/docs/architecture/` — Contract system, validator pattern, frontend architecture, scripts pipeline
- `fum_automation/docs/architecture/` — Cache structures, strategy system, automation flow, event management
- `fum_library/docs/` — API reference, diagrams, adapter documentation
- `fum_testing/docs/architecture/` — Mock contract APIs, deployment sequences, testing patterns

## Important Rules

- **Do NOT assume** what is or is not part of a data structure, contract interface, or library module. Always look up the code before using it.
- **Always run `npm run pack`** in fum_library after making changes there — fum and fum_automation won't see changes until the tarball is rebuilt and installed.
- **Mark debugging logs** with a special emoji so they are easy to find and remove later.
- Automation service cache structures are documented in `fum_automation/docs/architecture/cache-structures.md` — reference this before modifying cached data.

### Fail Loud, Don't Mask Errors

Do not use fallback values or defensive coding that allows execution to continue with incorrect data. Silent failures lead to decisions based on bad information — in a live automation system, this can mean missed claims, wrong rebalances, or lost funds.

- **No silent fallbacks**: Don't use `value || default` or `value ?? default` to paper over data that should exist. If `campaign.rewardToken` is an object, access it directly — don't write `campaign.rewardToken?.address || ''`.
- **No optional chaining on expected paths**: Use `?.` only when a property is genuinely optional by design, not as a safety net against bugs.
- **Validate at boundaries, trust internally**: Validate shape/presence of external data (API responses, user input) where it enters the system. Once validated, access fields directly.
- **Let errors propagate to callers**: Functions should throw on failure so the call chain above can retry or handle explicitly. Don't catch-and-return-defaults — that hides failures from every caller up the stack. Error handling belongs at the level that has enough context to make an informed decision (e.g., the strategy deciding whether to skip a vault vs. abort a cycle), not buried inside the function that failed.
