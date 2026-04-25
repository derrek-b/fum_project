# F.U.M. Automation

Automated liquidity management service for the FUM application, handling position monitoring and lifecycle operations.

> `fum_automation` is one subproject in the [fum_project monorepo](../README.md). The root README has the big-picture architecture and sibling-project overview; this doc covers `fum_automation` specifically.

## Overview

The F.U.M. Automation service provides 24/7 automated management of liquidity positions across DeFi platforms. It monitors on-chain events, evaluates positions against strategy parameters, and executes rebalances, fee collection, and other optimization tasks.

## Features

- **Event-Driven Architecture**: Real-time monitoring of price movements and fee accrual
- **Strategy Support**: Baby Steps Strategy for simplified liquidity management
- **SSE Broadcasting**: Real-time event streaming to connected clients
- **Flexible Notification System**: Supports Telegram alerts for key events and actions

## Architecture

The service is organized into three layers under `src/`:

**Core (`src/core/`)** — long-lived components that orchestrate the service:

- **AutomationService**: Vault discovery, strategy allocation, and the main processing loop
- **VaultDataService**: Caching and data management layer for vault state, positions, and token balances
- **EventManager**: Centralized pub/sub for contract events and internal events
- **Tracker**: Transaction history and performance tracking
- **SSEBroadcaster**: Server-Sent Events stream for real-time client updates
- **VaultHealth**: Executor gas monitoring and automated top-ups (holdback + funding-required state)
- **ServiceHealth**: WebSocket subscription canary with ping/pong keepalive

**Strategies (`src/strategies/`)** — strategy implementations extending `StrategyBase`. Currently: BabyStepsStrategy. Strategies are platform-agnostic; platform-specific behavior is delegated to fum_library adapters.

**Utils (`src/utils/`)** — cross-cutting helpers: `RetryHelper` (RPC retry with exponential backoff), `errors` (UnrecoverableError, InsufficientGasError), `patchProviderFeeData` (chain-specific gas fee overrides).

See [docs/architecture/overview.md](./docs/architecture/overview.md) for the full module breakdown and per-subsystem deep dives (cache structures, strategy system, automation flow, event management, executor gas management).

## Prerequisites

Node.js 22+ and the `fum_library` tarball installed via `npm run pack` — see the [root README](../README.md#monorepo-conventions) for the tarball convention and the `npm link` ban.

## Installation

```bash
# Install dependencies (requires fum_library tarball to exist in fum_library sibling-project)
npm install

# Copy environment template — one file per chain
cp .env.example .env.local      # Arbitrum (consumed by `npm run start`)
cp .env.example .env.local.av   # Avalanche (consumed by `npm run start:av`)

# Edit each .env file with chain-appropriate values (CHAIN_ID, WS_URL, etc.)
```

## Configuration

Copy `.env.example` to `.env.local` and configure:

### Required Variables

| Variable | Description |
|----------|-------------|
| `CHAIN_ID` | Network ID (1337=Hardhat local, 42161=Arbitrum One) |
| `WS_URL` | WebSocket RPC endpoint for real-time events |
| `AUTOMATION_MNEMONIC` | BIP-39 mnemonic for executor HD wallet (derives per-vault signing keys) |
| `SSE_PORT` | Port for Server-Sent Events HTTP server |
| `RETRY_INTERVAL_MS` | Interval between retry cycles for failed vaults |
| `MAX_FAILURE_DURATION_MS` | Time before a failing vault is blacklisted |
| `COINGECKO_API_KEY` | CoinGecko API key for token prices — public tier rate-limits silently degrade strategy evaluation, VaultHealth, and Tracker accounting |
| `THEGRAPH_API_KEY` | The Graph API key for subgraph queries |
| `ALCHEMY_API_KEY` | Alchemy API key for Arbitrum RPC (see note below) |
| `BLOCK_EXPLORER_API_KEY` | Block explorer API key (Arbiscan/Snowtrace) for contract verification |

> **Note on ALCHEMY_API_KEY**: Required for both production AND local testing. In production (chainId 42161), it's the Arbitrum RPC URL the service connects to. In local testing (chainId 1337), it's the upstream URL the Hardhat fork node forks from (see `hardhat.config.cjs`) — the AlphaRouter itself routes against the local fork's on-chain state, not Alchemy.

`start-automation.js` validates all of the above at startup and exits with a clear "Missing required environment variables" error if any are blank.

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG` | `false` | Enable verbose logging |
| `BLACKLIST_PATH` | `./data/.vault-blacklist.json` | Path to vault blacklist file |
| `TRACKING_DATA_DIR` | `./data/vaults` | Directory for vault tracking data |
| `TELEGRAM_BOT_API_KEY` | - | Telegram bot API key for notifications |
| `TELEGRAM_CHAT_ID` | - | Telegram chat ID for notifications |
| `FORK_CHAIN` | `arbitrum` | Chain to fork for tests (`arbitrum` or `avalanche`) |
| `DATA_DIR` | `./data` | Base directory for all data files (blacklist, vault tracking) |

## Usage

```bash
# Run automation service against Arbitrum (uses .env.local)
npm run start

# Run automation service against Avalanche (uses .env.local.av)
npm run start:av

# Run with debug logging
DEBUG=true npm run start
```

The service will:
1. Connect to the blockchain via WebSocket
2. Initialize platform adapters (Uniswap V3, V4 on Arbitrum, or Trader Joe V2.2 on Avalanche)
3. Load authorized vaults from the VaultFactory
4. Start monitoring positions and events
5. Expose SSE endpoint at `http://localhost:{SSE_PORT}/events`

## Strategies

### Baby Steps Strategy

A simplified strategy for liquidity management:

- Configurable position range parameters
- Fee reinvestment capabilities
- Automatic rebalancing when price moves out of range
- Token swap & position close handling for non-aligned assets during initialization
- Designed for beginners and straightforward use cases

Additional strategies can be added by extending `StrategyBase` (see [docs/architecture/strategy-system.md](./docs/architecture/strategy-system.md)). Strategies are platform-agnostic — platform-specific behavior is encapsulated behind the `fum_library` PlatformAdapter interface.

## Testing

See [TESTING.md](TESTING.md) for comprehensive testing documentation including unit tests, workflow tests with real blockchain interactions, and test naming conventions.

Tests are **chain-scoped**: each `vitest run` invocation hosts a single Hardhat fork, so V3/V4 (Arbitrum) and Trader Joe (Avalanche) workflow tests cannot share a run. Use the per-chain scripts below.

| Command | Scope | Fork |
|---|---|---|
| `npm test` | Unit tests | none |
| `npm run test:v3:run-all` | Uniswap V3 workflows | Arbitrum |
| `npm run test:v4:run-all` | Uniswap V4 workflows | Arbitrum |
| `npm run test:arb <path>` | A specific V3 or V4 workflow file | Arbitrum |
| `npm run test:tj:run-all` | Trader Joe V2.2 workflows | Avalanche |
| `npm run test:tj <path>` | A specific TJ workflow file | Avalanche |

> **`test:arb` and `test:tj` require a path argument.** Without one, vitest will run every matching file under the wrong fork (e.g. `npm run test:tj` with no path tries to run the V3/V4 suite on Avalanche and fails). Always pass a specific test file: `npm run test:tj test/workflow/traderjoe/service-init/basic-init.test.js`.

To run the full suite locally, run the three `*:run-all` scripts in sequence — there is intentionally no single `npm test` that runs everything, because no single Hardhat fork can serve both chains.

## Backtesting

> **Status: in development — not part of the supported automation runtime.**

A historical replay engine for evaluating strategies against collected on-chain data lives in [`backtest/`](backtest/README.md). It is being built out separately from the production service.

## Full Ecosystem Testing

For integration testing with the complete F.U.M. stack (frontend + automation + blockchain), see [fum/TESTING.md](../fum/TESTING.md).

## License

See [LICENSE.md](LICENSE.md) for details.

## Version History

See CHANGELOG.md for version history and release notes.
