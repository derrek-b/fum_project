# F.U.M. Automation

Automated liquidity management service for the F.U.M. (Friendly Uniswap Manager) protocol, handling position monitoring and lifecycle operations.

> `fum_automation` is one subproject in the [fum_project monorepo](../README.md). The root README has the big-picture architecture and sibling-project overview; this doc covers `fum_automation` specifically.

## Overview

The F.U.M. Automation service provides 24/7 automated management of liquidity positions across DeFi platforms. It monitors on-chain events, evaluates positions against strategy parameters, and executes rebalances, fee collection, and other optimization tasks.

## Features

- **Event-Driven Architecture**: Real-time monitoring of price movements and fee accrual
- **Strategy Support**: Baby Steps Strategy for simplified liquidity management
- **Multi-Platform Support**: Adaptable to different DEXes through platform-specific implementations
- **Secure Vault Integration**: Integrates with F.U.M. vault contracts via authorized service relationships
- **SSE Broadcasting**: Real-time event streaming to connected clients
- **Flexible Notification System**: Supports Telegram alerts for key events and actions

## Architecture

The automation service consists of several core components:

- **AutomationService**: Central service managing vault authorization and coordinating operations
- **EventManager**: Centralized event handling system for contract and internal events
- **VaultDataService**: Caching and data management layer for vault information
- **Strategy Classes**: Implements strategy-specific logic and monitoring
- **SSEBroadcaster**: Server-Sent Events for real-time client updates
- **Tracker**: Transaction history and performance tracking

## Prerequisites

- **Node.js 22+** and npm
- **fum_library built and packed** into this project — consumed as a local tarball (`file:../fum_library/fum_library-*.tgz`), never via `npm link`. After any change in `../fum_library`, run `cd ../fum_library && npm run pack` to rebuild the tarball and reinstall it here. See the [root README](../README.md) for the full monorepo convention.

## Installation

```bash
# Install dependencies (requires fum_library tarball to exist)
npm install

# Copy environment template
cp .env.example .env.local

# Edit .env.local with your configuration
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

> **Note on ALCHEMY_API_KEY**: Required for both production AND local testing. In production (chainId 42161), it's used for Arbitrum RPC URLs. In local testing (chainId 1337), the AlphaRouter still needs Arbitrum RPC for swap routing.

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
# Run automation service
npm run start

# Run with debug logging
DEBUG=true npm run start
```

The service will:
1. Connect to the blockchain via WebSocket
2. Initialize platform adapters (Uniswap V3, V4, Trader Joe V2.2)
3. Load authorized vaults from the VaultFactory
4. Start monitoring positions and events
5. Expose SSE endpoint at `http://localhost:{SSE_PORT}/events`

## Strategies

### Baby Steps Strategy

A simplified strategy for liquidity management:

- Configurable position range parameters (upper/lower range, thresholds)
- Fee reinvestment capabilities
- Automatic rebalancing when price moves out of range
- Token swap handling for non-aligned assets
- Designed for beginners and straightforward use cases

## Platform Support

- **Uniswap V3**: Concentrated liquidity on Arbitrum
- **Uniswap V4**: Concentrated liquidity with hooks on Arbitrum
- **Trader Joe V2.2**: Liquidity Book (bin-based) on Avalanche

## Testing

See [TESTING.md](TESTING.md) for comprehensive testing documentation including:

- Unit tests for configuration and utilities
- Workflow tests with real blockchain interactions
- Test naming conventions

```bash
# Run all tests
npm test

# Run unit tests only
npm test test/unit

# Run workflow tests only
npm test test/workflow

# Run specific test
npm test test/workflow/service-init/BS-0000.test.js

# Platform-specific workflow tests
npm run test:v3:run-all    # Uniswap V3 (FORK_CHAIN=arbitrum)
npm run test:v4:run-all    # Uniswap V4 (FORK_CHAIN=arbitrum)
npm run test:tj:run-all    # Trader Joe V2.2 (FORK_CHAIN=avalanche)

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

## Development

The project follows a modular architecture:

1. **Adding platform support**: Create platform-specific strategy implementations in `src/strategies/{strategyName}/`
2. **Custom event handlers**: Register with the centralized EventManager
3. **Extending strategies**: Implement new strategies by extending the base strategy class

## Full Ecosystem Testing

For integration testing with the complete F.U.M. stack (frontend + automation + blockchain), see [fum/TESTING.md](../fum/TESTING.md).

## License

See [LICENSE.md](LICENSE.md) for details.

## Version History

See CHANGELOG.md for version history and release notes.
