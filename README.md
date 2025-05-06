# F.U.M. Automation

Automated liquidity management service for the F.U.M. (Friendly Uniswap Manager) protocol, handling position monitoring and lifecycle operations.

## Overview

The F.U.M. Automation service provides 24/7 automated management of liquidity positions across various DeFi platforms. It monitors on-chain events, evaluates positions against strategy parameters, and executes rebalances, fee collection, and other optimization tasks.

## Features

- **Event-Driven Architecture**: Real-time monitoring of price movements and fee accrual
- **Multi-Strategy Support**: Implements various liquidity management strategies including:
  - **Parris Island Strategy**: Advanced adaptive range management with learning capabilities
  - **Baby Steps Strategy**: Simplified strategy with essential parameters for beginner users
- **Multi-Platform Support**: Adaptable to different DEXes through platform-specific implementations
- **Secure Vault Integration**: Integrates with F.U.M. vault contracts via authorized service relationships
- **Flexible Notification System**: Supports Telegram alerts for key events and actions
- **Extensible Strategy Framework**: Base classes for creating custom strategies

## Architecture

The automation service consists of several core components:

- **AutomationService**: Central service managing vault authorization and coordinating operations
- **VaultRegistry**: Handles vault authorization events and maintains the list of authorized vaults
- **EventManager**: Centralized event handling system for contract events
- **VaultDataService**: Caching and data management layer for vault information
- **Strategy Classes**: Implements strategy-specific logic and monitoring

## Usage

```bash
# Install dependencies
npm install

# Run automation service (requires environment variables)
node scripts/run-automation.js
```

## Configuration

The automation service requires the following environment variables:

```
# RPC/WS Configuration
WS_URL=wss://your-websocket-endpoint
RPC_URL=https://your-rpc-endpoint
CHAIN_ID=1337

# Contract Addresses
FACTORY_ADDRESS=0x...
PARRIS_STRATEGY_ADDRESS=0x...
BOB_STRATEGY_ADDRESS=0x...
AUTOMATION_ADDRESS=0x...

# Notification Settings
TELEGRAM_BOT_API_KEY=your-bot-key
TELEGRAM_CHAT_ID=your-chat-id
```

## Strategies

### Parris Island Strategy

Advanced liquidity management strategy:

- Configurable position range parameters
- Fee reinvestment capabilities
- Risk management controls
- Designed for more sophisticated beginner users

### Baby Steps Strategy

A simplified strategy for easier management:

- Streamlined parameter set
- Basic monitoring capabilities
- Simplified risk management
- Designed for beginners and education

## Platform Support

Each strategy can be implemented for different platforms:

- **UniswapV3**: Complete implementation for Uniswap V3 pools
- **PancakeSwap**: Coming soon
- **More platforms**: Extensible architecture supports additional platforms

## Development

The project follows a modular architecture that makes it easy to extend:

1. **Adding new strategies**: Extend the `StrategyBase` class and implement required methods
2. **Adding platform support**: Create platform-specific implementations in strategy subfolders
3. **Custom event handlers**: Register with the centralized EventManager

## License

See LICENSE file for details.

## Version History

See CHANGELOG.md for version history and release notes.