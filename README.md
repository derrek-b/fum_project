# F.U.M. - DeFi Liquidity Position Management & Automation

A full-stack DeFi application for creating, managing, and automating Uniswap V3 liquidity positions. F.U.M. enables users to deploy personal vaults with configurable automation strategies for hands-off liquidity management.

## Overview

F.U.M. combines a Next.js frontend with Solidity smart contracts to provide:

- **Personal Vaults** - Non-custodial smart contract vaults that hold your tokens and LP positions
- **Uniswap V3 Integration** - Full support for Uniswap V3 concentrated liquidity positions
- **Automated Strategies** - Configure rebalancing parameters and let the automation service manage your positions
- **Real-Time Tracking** - Live updates via Server-Sent Events (SSE) connection to the automation service
- **APY Analytics** - Track returns including fees earned and gas costs

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
│  │ VaultFactory │  │PositionVault │  │   Strategy Contracts  │  │
│  │   (v1.0.0)   │  │   (v1.0.0)   │  │ BabySteps (v1.0.0)    │  │
│  │              │  │              │  │ ParrisIsland (v0.1.0) │  │
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

### Production Ready (v1.0.0)

| Contract | Description |
|----------|-------------|
| **PositionVault** | User-controlled vault holding ERC20 tokens and ERC721 position NFTs. Executes swaps, mints, liquidity operations with security validations. Supports EIP-1271 signature validation. |
| **VaultFactory** | Factory contract for creating and tracking PositionVault instances. Maintains registry of user vaults. |
| **BabyStepsStrategy** | Basic automation strategy with template-based parameters for range width, rebalance thresholds, fee reinvestment, and risk management. |

### In Development (v0.1.0)

| Contract | Description |
|----------|-------------|
| **ParrisIslandStrategy** | Advanced adaptive strategy with additional parameters for position sizing, pool liquidity requirements, oracle selection, and dynamic range adjustments. |

## Features

### Vault Management
- Create multiple vaults with unique names
- Configure target tokens per vault
- Deposit/withdraw ERC20 tokens
- Assign/unassign LP positions to vaults

### Position Management
- View all Uniswap V3 positions across connected wallet and vaults
- Add/remove liquidity from positions
- Collect accumulated fees
- Close positions completely

### Strategy Configuration
- Select from preset templates (Conservative, Moderate, Aggressive, Stablecoin)
- Customize individual parameters:
  - **Range Parameters** - Target range width, rebalance thresholds
  - **Fee Settings** - Reinvestment triggers and ratios
  - **Risk Management** - Max slippage, emergency exit triggers, utilization limits

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

### Repository Structure

The F.U.M. ecosystem requires repositories to be cloned as siblings:

```
code/
├── fum/              # This repository (Frontend + Smart Contracts)
├── fum_library/      # Shared utilities (required)
└── fum_automation/   # Automation service (optional, for full testing)
```

### fum_library Setup

For local development, set up symlinks to use local library changes:

```bash
# Clone fum_library if not already present
cd ..
git clone https://github.com/derrek-b/fum_library.git

# Install and set up symlinks
cd fum_library
npm install
npm run sync  # Creates symlinks to fum and fum_automation

# Return to fum
cd ../fum
```

> **Note:** The GitHub dependency works out of the box for production. Use `npm run sync` only for local development when you need to test library changes. Use `npm run unsync` to restore the GitHub dependency.

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

# For local testing only - Alchemy API key for Arbitrum RPC
# The UniswapV3Adapter needs real Arbitrum for AlphaRouter swap routing
# Not needed for production (uses wallet provider directly)
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

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js development server |
| `npm run build` | Build production bundle |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run contracts:sync` | Sync contracts to fum_library, fum_automation and fum_testing |
| `npm run contracts:test` | Sync contracts to & run Hardhat contract tests in fum_testing |

## Project Structure

```
fum/
├── contracts/              # Solidity smart contracts
│   ├── PositionVault.sol
│   ├── VaultFactory.sol
│   ├── BabyStepsStrategy.sol
│   └── ParrisIslandStrategy.sol
├── src/
│   ├── pages/              # Next.js pages
│   │   ├── index.js        # Landing page
│   │   ├── vaults.js       # Vault management
│   │   ├── positions.js    # Position management
│   │   ├── demo.js         # Demo showcase
│   │   ├── vault/[address].js
│   │   └── position/[id].js
│   ├── components/
│   │   ├── common/         # Shared components (Navbar, Wallet, etc.)
│   │   ├── vaults/         # Vault-related components
│   │   ├── positions/      # Position-related components
│   │   └── transactions/   # Transaction history components
│   ├── redux/              # Redux store and slices
│   ├── contexts/           # React context providers
│   ├── hooks/              # Custom React hooks
│   ├── utils/              # Utility functions
│   └── styles/             # Global styles
├── scripts/                # Deployment and utility scripts
├── test/                   # Test scripts
├── deployments/            # Deployment configurations
└── public/                 # Static assets
```

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
- **Hardhat** - Development framework and testing
- **Ganache** - Local blockchain for development

### External Dependencies
- **fum_library** - Shared adapters, ABIs, and utilities
- **Uniswap V3 SDK** - Position calculations
- **CoinGecko API** - Token pricing (via fum_library)

## Related Repositories

| Repository | Description |
|------------|-------------|
| [fum_library](https://github.com/derrek-b/fum_library) | Shared library with Uniswap V3 adapter, ABIs, and blockchain utilities |
| [fum_automation](https://github.com/derrek-b/fum_automation) | Automation service for position monitoring and rebalancing |
| [fum_testing](https://github.com/derrek-b/fum_testing) | Isolated Hardhat environment for contract testing |

## Version History

- **v0.8.0** - PositionVault empty batch validation
- **v0.7.0** - Dual provider architecture (dedicated RPC + wallet)
- **v0.6.0** - Demo page, transaction history, APY calculations
- **v0.5.0** - Security refactor

## License

Copyright (c) 2025 Derrek Brack and Rabid Husky Designs. All rights reserved.

This software is proprietary and provided for portfolio demonstration purposes only. See [LICENSE.md](LICENSE.md) for details.

## Author

**Derrek Brack** & **Claude Code**

For licensing inquiries, please contact the copyright holder.
