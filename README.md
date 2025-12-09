# F.U.M. Automation

Automated liquidity management service for the F.U.M. (Friendly Uniswap Manager) protocol, handling position monitoring and lifecycle operations.

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

### Repository Structure

The F.U.M. ecosystem requires repositories to be cloned as siblings:

```
code/
├── fum/              # Frontend + Smart Contracts
├── fum_library/      # Shared utilities (required)
└── fum_automation/   # This repository
```

### fum_library Setup

fum_library must be built before installing dependencies:

```bash
# Clone fum_library if not already present
cd ..
git clone https://github.com/derrek-b/fum_library.git

# Build and pack the library
cd fum_library
npm install
npm run build && npm pack

# Return to fum_automation
cd ../fum_automation
```

## Installation

```bash
# Install dependencies (requires fum_library to be built first)
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
| `CHAIN_ID` | Network ID (1337=Ganache, 42161=Arbitrum One) |
| `WS_URL` | WebSocket RPC endpoint for real-time events |
| `AUTOMATION_PRIVATE_KEY` | Private key for executor wallet (signs transactions) |
| `SSE_PORT` | Port for Server-Sent Events HTTP server |
| `RETRY_INTERVAL_MS` | Interval between retry cycles for failed vaults |
| `MAX_FAILURE_DURATION_MS` | Time before a failing vault is blacklisted |
| `THEGRAPH_API_KEY` | The Graph API key for subgraph queries |
| `ALCHEMY_API_KEY` | Alchemy API key for Arbitrum RPC (see note below) |

> **Note on ALCHEMY_API_KEY**: Required for both production AND local testing. In production (chainId 42161), it's used for Arbitrum RPC URLs. In local testing (chainId 1337), the AlphaRouter still needs Arbitrum RPC for swap routing.

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG` | `false` | Enable verbose logging |
| `BLACKLIST_PATH` | `./data/blacklist.json` | Path to vault blacklist file |
| `TRACKING_DATA_DIR` | `./data/vaults` | Directory for vault tracking data |
| `COINGECKO_API_KEY` | - | CoinGecko API key for token prices (see note below) |
| `TELEGRAM_BOT_API_KEY` | - | Telegram bot API key for notifications |
| `TELEGRAM_CHAT_ID` | - | Telegram chat ID for notifications |

> **Note on COINGECKO_API_KEY**: While technically optional, this is **strongly recommended for production**. Without it, the free CoinGecko tier's rate limits will cause price fetching failures under normal operating conditions. For local testing, the lower request volume may stay within free tier limits.

## Usage

```bash
# Run automation service
npm run start

# Run with debug logging
DEBUG=true npm run start
```

The service will:
1. Connect to the blockchain via WebSocket
2. Initialize platform adapters (UniswapV3)
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

- **UniswapV3**: Complete implementation for Uniswap V3 pools on Arbitrum
- Additional platforms can be added through the extensible adapter architecture

## Testing

See [TESTING.md](TESTING.md) for comprehensive testing documentation including:

- Unit tests for configuration and utilities
- Workflow tests with real blockchain interactions
- Custom test scenarios via JSON configuration
- Test naming conventions

```bash
# Run all tests
npm test

# Run unit tests only
npm test test/unit

# Run workflow tests only
npm test test/workflow

# Run specific test
npm test test/workflow/service-init/BS-0vaults.test.js

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
