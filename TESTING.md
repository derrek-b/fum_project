# FUM Automation Testing Guide

This document describes how to run and create tests for the FUM Automation Service.

> **Note:** For full ecosystem integration testing (frontend + automation + blockchain), see [fum/TESTING.md](../fum/TESTING.md).

## Overview

The test suite is organized into two categories: unit & workflow tests...

```
test/
├── setup.js                 # Global test setup (loads env, initializes fum_library)
├── helpers/
│   ├── ganache-setup.js     # Blockchain environment setup
│   └── test-vault-setup.js  # Test vault creation utilities
├── unit/                    # Fast, isolated unit tests
│   ├── AutomationService.config.test.js
│   └── utilities.test.js
├── workflow/                # Integration tests with real blockchain
│   ├── service-init/        # Service initialization scenarios
│   ├── service-stop/        # Graceful shutdown tests
│   ├── swap-event/          # Swap detection and rebalancing
│   ├── vault-auth/          # Vault authorization workflow
│   └── vault-revoke/        # Vault revocation workflow
└── scenarios/               # JSON configs for custom test scenarios
    ├── README.md            # Scenario configuration reference
    ├── default.json
    └── *.json
```

## Prerequisites

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

Ensure fum_library is built and installed:

```bash
cd ../fum_library
npm run pack
```

> **Note:** If you don't have the `fum` frontend project set up, the pack script will fail when trying to install there. Use this alternative:
> ```bash
> cd ../fum_library
> npm run build && npm pack
> cd ../fum_automation
> npm install ../fum_library/fum_library-*.tgz
> ```

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

Workflow tests spin up a Ganache fork, deploy contracts, and test real scenarios. They take longer (~15-180 seconds or longer each).

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

### ganache-setup.js

Provides `setupTestBlockchain()` which:
- Starts a Ganache fork of Arbitrum
- Deploys FUM contracts (VaultFactory, strategies)
- Validates deterministic addresses
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
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/ganache-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';

describe('My Workflow Test', () => {
  let testEnv;
  let service;
  let testVault;

  beforeAll(async () => {
    // Setup blockchain (use unique port to avoid conflicts)
    testEnv = await setupTestBlockchain({ port: 8555 });

    // Create test vault with specific configuration
    testVault = await setupTestVault(
      testEnv.ganacheServer,
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

### "Address mismatch" errors

Contract addresses are deterministic based on deployer nonce. If addresses don't match:
1. The test will auto-save new addresses
2. Re-run the test to use updated addresses
3. Run `npm run pack` in fum_library to sync

### Port conflicts

Each workflow test uses a unique Ganache port. If running tests in parallel fails, check for port conflicts in the 8545-8560 range.

### Timeout errors

Workflow tests have extended timeouts (30-180 seconds). If tests still timeout:
- Check network connectivity (Alchemy RPC)
- Increase timeout in vitest.config.js
- Run tests individually instead of in parallel

### Stale contract data

If tests fail with contract-related errors after code changes:
```bash
cd ../fum_library
npm run pack
```

This rebuilds the library and reinstalls it in fum_automation.
