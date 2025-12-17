# FUM Automation Testing Guide

This document describes how to run and create tests for the FUM Automation Service.

> **Note:** For full ecosystem integration testing (frontend + automation + blockchain), see [fum/TESTING.md](../fum/TESTING.md).

## Overview

The test suite uses a **shared Hardhat instance** architecture for reliable, deterministic testing. A single Hardhat blockchain is started once before all tests, contracts are deployed once, and each test file reverts to a clean snapshot for isolation.

```
test/
├── global-setup.js          # Starts shared Hardhat, deploys contracts, takes snapshot
├── shared-state.js          # State sharing between globalSetup and tests
├── setup.js                 # Per-test setup (loads env, initializes fum_library)
├── helpers/
│   ├── hardhat-setup.js     # Connects to shared Hardhat, reverts to snapshot
│   └── test-vault-setup.js  # Test vault creation utilities
├── unit/                    # Fast, isolated unit tests
│   ├── AutomationService.config.test.js
│   └── utilities.test.js
├── workflow/                # Integration tests with real blockchain
│   ├── service-init/        # Service initialization scenarios
│   ├── service-stop/        # Graceful shutdown tests
│   ├── swap-event/          # Swap detection and rebalancing
│   ├── vault-auth/          # Vault authorization workflow
│   ├── vault-revoke/        # Vault revocation workflow
│   └── native-eth/          # Native ETH handling tests
└── scenarios/               # JSON configs for custom test scenarios
    ├── README.md            # Scenario configuration reference
    ├── default.json
    └── *.json
```

## Test Architecture

### Shared Hardhat Instance

Unlike traditional test setups where each test file spawns its own blockchain, we use a shared instance:

```
┌──────────────────────────────────────────────────────────┐
│                    globalSetup.js                        │
│  1. Start Hardhat (port 8545)                           │
│  2. Deploy FUM contracts ONCE                            │
│  3. Take BASE_SNAPSHOT (contracts deployed, no vaults)   │
│  4. Save state to .hardhat-state.json                    │
└──────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Test File A     │  │ Test File B     │  │ Test File C     │
│ Revert to BASE  │  │ Revert to BASE  │  │ Revert to BASE  │
│ Setup vault     │  │ Setup vault     │  │ Setup vault     │
│ Run tests       │  │ Run tests       │  │ Run tests       │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                             ↓
┌──────────────────────────────────────────────────────────┐
│                   globalTeardown                         │
│  1. Stop Hardhat                                         │
│  2. Clean up state file                                  │
└──────────────────────────────────────────────────────────┘
```

**Benefits:**
- **Consistent addresses** - Contracts deployed once, addresses never drift
- **Faster tests** - No Hardhat startup per file (~3-5s saved per file)
- **No race conditions** - contracts.js updated once in globalSetup
- **Clean isolation** - Snapshots ensure each test file starts fresh

## Prerequisites

### Local Development Setup

The `.npmrc` file omits devDependencies for production deployment. For local testing, run:

```bash
npm run setup:dev
```

This installs all dev and optional dependencies needed for testing.

### Environment Variables

Tests only need API keys from `.env.local`. All other config (chainId, wsUrl, ports, etc.) is hardcoded in the test helpers.

```bash
# Required - AlphaRouter needs real Arbitrum RPC for swap routing
ALCHEMY_API_KEY=your_alchemy_api_key

# Optional but recommended - without this, CoinGecko rate limits may cause failures
COINGECKO_API_KEY=your_coingecko_api_key
```

> **Note:** Other `.env.local` variables (CHAIN_ID, WS_URL, AUTOMATION_PRIVATE_KEY, etc.) are for running the service for full ecosystem integration testing, not for unit or workflow tests.

### Dependencies

The GitHub dependency works out of the box for running tests. Workflow tests deploy their own contracts and save addresses to the installed fum_library in `node_modules/`.

**To test local fum_library changes:**

```bash
cd ../fum_library
npm run pack  # Rebuilds and reinstalls library to fum and fum_automation
```

## Running Tests

### All Tests

```bash
npm test
```

### Unit Tests Only

```bash
npm test test/unit
```

Unit tests are fast (~2-3 seconds) and don't require a blockchain connection. They test:
- Configuration validation (`AutomationService.config.test.js`)
- Utility functions: RetryHelper, Logger, Tracker (`utilities.test.js`)

### Workflow Tests Only

```bash
npm test test/workflow
```

Workflow tests connect to the shared Hardhat fork of Arbitrum, revert to clean state, and test real scenarios. They take longer (~15-180 seconds each).

### Specific Test File

```bash
npm test test/workflow/service-init/BS-0vaults.test.js
```

### Watch Mode

```bash
npm run test:watch
```

### Coverage Report

```bash
npm run test:coverage
```

## Test Naming Convention

Workflow tests follow a naming pattern that describes the test scenario:

```
BS-{vaults}-{config}.test.js
```

Where:
- **BS** = Baby Steps strategy
- **vaults** = Number of vaults (e.g., `0vaults`, `1vault`)
- **config** = 4-digit configuration code

### Configuration Code (XXXX)

Each digit represents a count:

| Position | Meaning |
|----------|---------|
| 1st | Aligned positions |
| 2nd | Non-aligned positions |
| 3rd | Aligned tokens |
| 4th | Non-aligned tokens |

### Examples

| Test Name | Meaning |
|-----------|---------|
| `BS-0vaults` | No vaults, tests empty initialization |
| `BS-1vault-1111` | 1 aligned pos, 1 non-aligned pos, 1 aligned token, 1 non-aligned token |
| `BS-1vault-0202` | 0 aligned pos, 2 non-aligned pos, 0 aligned tokens, 2 non-aligned tokens |
| `BS-1vault-2020` | 2 aligned pos, 0 non-aligned pos, 2 aligned tokens, 0 non-aligned tokens |
| `BS-1vault-1020` | 1 aligned pos, 0 non-aligned pos, 2 aligned tokens, 0 non-aligned tokens |

### Aligned vs Non-Aligned

- **Aligned position**: Position tokens match the vault's target tokens
- **Non-aligned position**: Position tokens don't match targets (will be closed)
- **Aligned token**: Token in vault matches a target token
- **Non-aligned token**: Token in vault doesn't match targets (will be swapped)

## Workflow Test Categories

### service-init/

Tests the complete service initialization flow:
- Configuration validation
- Provider connection
- Contract initialization
- Adapter setup
- Vault discovery and loading
- Position evaluation
- Initial rebalancing

### service-stop/

Tests graceful shutdown:
- Event listener cleanup
- SSE broadcaster shutdown
- Provider disconnection

### swap-event/

Tests swap detection and rebalancing:
- Detecting swaps that push positions out of range
- Triggering rebalance operations
- Bi-directional price movement handling

### vault-auth/

Tests runtime vault authorization:
- Detecting new vault authorizations via events
- Loading and setting up newly authorized vaults
- Position creation for new vaults

### vault-revoke/

Tests vault revocation handling:
- Detecting revocation events
- Cleaning up vault monitoring
- Removing vault from active management

### native-eth/

Tests native ETH handling:
- Vault setup with native ETH instead of WETH
- Fee distribution as native ETH
- ETH wrapping/unwrapping during operations

## Custom Test Scenarios

For testing specific vault configurations without writing code, use the configurable test with JSON scenarios.

### Running a Custom Scenario

```bash
# Default scenario
npm test test/workflow/service-init/BS-configurable

# Custom scenario
SCENARIO=test/scenarios/my-scenario.json npm test test/workflow/service-init/BS-configurable
```

### Creating Scenarios

See [test/scenarios/README.md](test/scenarios/README.md) for complete documentation on:
- Scenario file structure
- Position configuration options
- Tick range types
- Token transfers
- Example scenarios

### Pre-Made Scenarios

| File | Description |
|------|-------------|
| `default.json` | Simple 1-position aligned scenario |
| `0202.json` | All non-aligned (migration test) |
| `1111.json` | Mixed aligned/non-aligned |
| `2020.json` | All aligned |

## Test Helper Files

### global-setup.js

Runs once before all tests:
- Starts a single Hardhat instance on port 8545
- Deploys FUM contracts (VaultFactory, BabyStepsStrategy)
- Takes a base snapshot with contracts deployed
- Saves state to `.hardhat-state.json` for tests to use

### shared-state.js

Utility for sharing state between globalSetup (separate process) and test files:
- `saveSharedState()` - Saves Hardhat PID, port, snapshot ID, contract addresses
- `loadSharedState()` - Loads state for test files
- `clearSharedState()` - Cleans up state file

### hardhat-setup.js

Provides `setupTestBlockchain()` which:
- Connects to the shared Hardhat instance
- Reverts to base snapshot (clean state)
- Syncs blockchain timestamp with real time
- Returns test environment with signers, contracts, and config

### test-vault-setup.js

Provides `setupTestVault()` which:
- Creates a vault via VaultFactory
- Wraps ETH and performs token swaps
- Creates Uniswap V3 positions
- Transfers assets to vault
- Authorizes vault with strategy

## Writing New Tests

### Unit Test Template

```javascript
import { describe, it, expect, vi } from 'vitest';

describe('MyModule', () => {
  describe('myFunction', () => {
    it('should do something', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = myFunction(input);

      // Assert
      expect(result).toBe('expected');
    });
  });
});
```

### Workflow Test Template

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import AutomationService from '../../../src/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';

describe('My Workflow Test', () => {
  let testEnv;
  let service;
  let testVault;

  beforeAll(async () => {
    // Setup blockchain (connects to shared Hardhat, reverts to clean state)
    testEnv = await setupTestBlockchain();

    // Create test vault with specific configuration
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'My Test Vault',
        automationServiceAddress: testEnv.testConfig.automationServiceAddress,
        // ... other config
      }
    );
  }, 180000); // Extended timeout for setup

  afterAll(async () => {
    if (service) await service.stop();
    await cleanupTestBlockchain(testEnv);
  });

  it('should do something', async () => {
    service = new AutomationService(testEnv.testConfig);
    await service.start();

    // Test assertions...

    expect(service.isRunning).toBe(true);
  }, 60000);
});
```

## Troubleshooting

### "Alchemy API key not configured"

Ensure `ALCHEMY_API_KEY` is set in `.env.local`. This is required for workflow tests because the AlphaRouter needs a real Arbitrum RPC.

### "Shared Hardhat state not found"

This error means `globalSetup.js` didn't run. Ensure:
- `vitest.config.js` has `globalSetup: './test/global-setup.js'`
- No previous test run left stale state (delete `test/.hardhat-state.json` and retry)

### Timeout errors

Workflow tests have extended timeouts (30-180 seconds). If tests still timeout:
- Check network connectivity (Alchemy RPC)
- Increase timeout in vitest.config.js
- Check if Hardhat is hanging (look for zombie processes on port 8545)

### Stale contract data

If tests fail with contract-related errors after code changes:
```bash
cd ../fum_library
npm run pack  # Rebuilds and reinstalls library to fum and fum_automation
```

### WebSocket connection errors

The shared Hardhat instance uses WebSocket connections. If you see connection errors:
- Ensure no other process is using port 8545
- Check that `cleanupTestBlockchain()` is called in `afterAll`
- The cleanup only closes WebSocket connections, not the shared Hardhat instance

### Tests pass individually but fail together

This is rare with the shared Hardhat architecture, but if it happens:
- Check that tests properly clean up after themselves
- Ensure `afterAll` blocks call `service.stop()` and `cleanupTestBlockchain()`
- Each test file reverts to the base snapshot, so state shouldn't leak
