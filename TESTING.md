# F.U.M. Integration Testing Guide

This document describes the full integration testing setup for the F.U.M. ecosystem, which requires coordination between three repositories and a local blockchain environment.

## Overview

Full integration testing simulates the complete F.U.M. workflow:
1. A forked Arbitrum blockchain running locally via Ganache
2. Deployed smart contracts (VaultFactory, PositionVault, Strategies)
3. The automation service monitoring and managing positions
4. The frontend for user interaction

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Integration Testing Architecture                     │
└─────────────────────────────────────────────────────────────────────────────┘

   Terminal 1                Terminal 2              Terminal 3              Terminal 4
┌──────────────┐         ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│   Ganache    │         │ fum_library  │        │fum_automation│        │     fum      │
│  (Blockchain)│◄───────►│   (Shared)   │◄──────►│  (Backend)   │◄──────►│  (Frontend)  │
│              │         │              │        │              │        │              │
│ Arbitrum Fork│         │ ABIs, Helpers│        │ SSE Events   │        │ React UI     │
│ Port 8545    │         │ Adapters     │        │ Port 3001    │        │ Port 3000    │
└──────────────┘         └──────────────┘        └──────────────┘        └──────────────┘
       │                        ▲                       │                       │
       │                        │                       │                       │
       └────────────────────────┴───────────────────────┴───────────────────────┘
                              Shared Contract Addresses
```

## Prerequisites

### Required Repositories

Clone all repositories into the same parent directory:

```
code/
├── fum/              # Frontend + Smart Contracts
├── fum_library/      # Shared utilities (must be built)
├── fum_automation/   # Automation service
└── fum_testing/      # Contract unit tests (optional)
```

### Environment Setup

1. **Alchemy API Key** - Required for forking Arbitrum mainnet
2. **Node.js 22+** - Required for ES module JSON import syntax (`with { type: 'json' }`)
3. **MetaMask or another Ethereum wallet** - For frontend wallet interaction

### Environment Files

**fum/.env.local**:
```bash
NEXT_PUBLIC_SSE_URL=http://localhost:3001/events
NEXT_PUBLIC_DEMO_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
NEXT_PUBLIC_ALCHEMY_API_KEY=your_alchemy_api_key
```

**fum_automation/.env.local**:
```bash
# Network Configuration
CHAIN_ID=1337
WS_URL=ws://localhost:8545

# Executor wallet (Ganache account #4) - funded by seed.js
# Address: 0xabA472B2EA519490EE10E643A422D578a507197A
AUTOMATION_PRIVATE_KEY=0x153b8bcb033769a3f3d51b6c2c99be54e76ea190a20752a308a7ec0873383470

# Service Configuration
SSE_PORT=3001
RETRY_INTERVAL_MS=15000
MAX_FAILURE_DURATION_MS=60000
DEBUG=true

# API Keys
ALCHEMY_API_KEY=your_alchemy_api_key
THEGRAPH_API_KEY=your_thegraph_api_key
```

## Quick Start

### Step 1: Start Ganache (Arbitrum Fork)

This starts a local blockchain forked from Arbitrum mainnet:

```bash
cd fum
npm run ganache
```

Ganache will:
- Fork Arbitrum at a recent block
- Deploy VaultFactory, PositionVault, and Strategy contracts
- Update contract addresses in `fum_library` src directory
- Output test account private keys

**Keep this terminal running.**

### Step 2: Seed Test Data

Create a test vault and liquidity position:

```bash
cd fum
npm run seed-localhost
```

This script:
- Creates a vault via VaultFactory
- Mints a WETH/USDC liquidity position on Uniswap V3
- Transfers tokens to the vault
- Executes a couple trades to generate fees to collect for the WETH/USDC position

### Step 3: Set Up fum_library Symlinks (First Time Only)

Full ecosystem testing requires fum and fum_automation to share contract addresses. Symlinks ensure both projects read from the same fum_library:

```bash
cd fum_library
npm run sync  # Creates symlinks to fum and fum_automation
```

After this initial setup, **no additional steps are needed when ganache restarts** - the start-ganache script automatically writes new contract addresses to both `src/` and `dist/`, and the symlinks ensure all projects see the changes immediately.

### Step 4: Start Automation Service

```bash
cd fum_automation
npm run start
```

The automation service will:
- Connect to the local Ganache node
- Load existing connected vault configurations
- Start monitoring for vault blockchain events
- Expose SSE endpoint at `http://localhost:3001/events`

**Keep this terminal running.**

### Step 5: Start Frontend

```bash
cd fum
npm run dev
```

Open `http://localhost:3000` and connect MetaMask:

1. Add a custom network:
   - Network name: `Ganache Local`
   - RPC URL: `http://localhost:8545`
   - Chain ID: `1337`
   - Currency symbol: `ETH`

2. Import Account 0 using this private key:
   ```
   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```
   This account owns the test vault and has tokens for testing.


## Vault Testing Scenarios

### Price Manipulation

Simulate price movements to trigger rebalancing:

```bash
# Push USDC price up (buy pressure)
npm run manipulate-price:up

# Push USDC price down (sell pressure)
npm run manipulate-price:down

# Generate fees on USDC/USDT pool (run with --swaps=N for more volume)
npm run generate-fees
npm run generate-fees -- --swaps=300
```

> **Note:** These scripts interact with forked Uniswap V3 pools. Depending on pool liquidity and price state at the time of the fork, you may need to adjust swap amounts in the scripts (`SWAP_AMOUNT` constant) or run them multiple times to achieve the desired effect. Large swaps may fail if they exceed available liquidity at the current price tick.

> **Important:** These scripts are designed for USDC/USDT stablecoin pairs. To trigger rebalances, you must first configure the vault's strategy via the frontend UI with tight range parameters:
>
> 1. Set the vault's strategy to **BabySteps**
> 2. Select the **Stablecoin** template
> 3. Customize range parameters for testing:
>    - **Upper/Lower Range:** 5 bps (0.05%) - creates a ±10 tick range
>    - **Upper/Lower Threshold:** 20% - triggers rebalance when price is within 2 ticks of the range edge
>    - **Fee Reinvest Trigger:** $5 (minimum) - allows fee collection to trigger with smaller amounts
> 4. Enable automation
>
> With default or wider range settings, the price manipulation swaps can't move the price enough to trigger rebalances before exhausting liquidity in the Ganache sandbox environment.

### What to Observe

1. **Frontend** - Position status updates via SSE
2. **Automation logs** - Rebalance triggers and execution
3. **Ganache console** - Transaction confirmations

### Testing Checklist

| Scenario | How to Test | Expected Result |
|----------|-------------|-----------------|
| Vault creation | Click "Create Vault" in frontend | New vault appears in list |
| Position monitoring | Run automation, wait for SSE events | Position data streams to frontend |
| Price out of range | Run `manipulate-price:up` repeatedly | Automation triggers rebalance |
| Fee collection | Run `generate-fees` | Fees accumulate, will be collected |
| Strategy change | Update strategy params in frontend | Automation picks up new config |

## Position Testing Scenarios

Manual position management can be tested independently of vault automation. These operations are available from the positions overview & position detail page (click any position card).

### Available Operations

| Operation | Description | How to Test |
|-----------|-------------|-------------|
| Create Position | Open a new liquidity position | From Vaults page, click "New Position" |
| Add Liquidity | Add more tokens to an existing position | Click "+ Add Liquidity" on position detail |
| Remove Liquidity | Remove a percentage (1-100%) of liquidity | Click "- Remove Liquidity", use slider |
| Claim Fees | Collect earned fees without affecting liquidity | Click "Claim Fees" |
| Close Position | Remove all liquidity, collect fees, optionally burn NFT | Click "Close Position" |

> **Note:** You cannot adjust the price range on a live position. To change the range, close the position and open a new one with the desired range.

> **Note:** Positions held in a vault have manual operations disabled. They can only be managed through vault automation or by first removing the position from the vault.

### Testing Checklist

| Scenario | How to Test | Expected Result |
|----------|-------------|-----------------|
| Create position | New Position → select tokens, fee tier, range | Position appears in list |
| Add liquidity | Add Liquidity → enter amounts | Position liquidity increases |
| Partial removal | Remove Liquidity → 50% | Half of liquidity withdrawn |
| Fee collection | Generate fees, then Claim Fees | Fees transferred to wallet |
| Close position | Close Position → check burn NFT | Position removed, NFT burned |

## Contract Unit Tests

For isolated smart contract testing without the full stack:

```bash
cd fum
npm run contracts:test
```

This syncs contracts to `fum_testing/` and runs Hardhat tests. See `fum_testing/` for test files.

## Troubleshooting

### Ganache Issues

**"Nonce too high" errors:**
Reset MetaMask account (Settings > Advanced > Clear activity tab data)

**"Contract not deployed" errors:**
Ganache may have restarted. Re-run `npm run seed-localhost`

### Library Sync Issues

**"Module not found: fum_library":**
```bash
cd fum_library
npm run sync  # Sets up symlinks to fum and fum_automation
```

**To restore GitHub dependencies (undo symlinks):**
```bash
cd fum_library
npm run unsync  # Restores fum and fum_automation to GitHub dependency
```

### Automation Connection Issues

**"SSE connection failed":**
- Verify automation is running on port 3001
- Check `NEXT_PUBLIC_SSE_URL` in fum/.env
- Verify no firewall blocking localhost ports

### Frontend State Issues

**Stale data after Ganache restart:**
1. Clear browser localStorage
2. Disconnect and reconnect wallet
3. Reset MetaMask account

## Directory Reference

| Path | Purpose |
|------|---------|
| `fum/test/scripts/start-ganache.js` | Ganache startup + contract deployment |
| `fum/test/scripts/create-test-vault.js` | Creates test vault via VaultFactory |
| `fum/test/scripts/seed.js` | Test data seeding (position, tokens, fees) |
| `fum/test/scripts/manipulate-price.js` | Price manipulation for testing |
| `fum/test/scripts/generate-fees.js` | Fee generation for testing |
| `fum/deployments/1337-latest.json` | Deployed contract addresses |
| `fum_library/dist/` | Built library modules |
| `fum_automation/data/` | Vault transaction & state cache |

## Available Test Scripts

| Script | Location | Description |
|--------|----------|-------------|
| `npm run ganache` | fum | Start Ganache with Arbitrum fork |
| `npm run seed-localhost` | fum | Create test vault and position |
| `npm run manipulate-price:up` | fum | Simulate price increase |
| `npm run manipulate-price:down` | fum | Simulate price decrease |
| `npm run generate-fees` | fum | Generate trading fees |
| `npm run start` | fum_automation | Start automation service |
| `npm run contracts:test` | fum | Run contract unit tests |
