# FUM Library Test Suite

This directory contains the test suite for fum_library, using Ganache to fork Arbitrum mainnet for realistic integration testing.

## Structure

```
test/
├── setup/                    # Test configuration and utilities
│   ├── ganache-config.js    # Ganache setup and blockchain utilities
│   └── test-contracts.js    # Contract deployment logic
├── unit/                    # Unit tests (pure functions)
│   ├── adapters/           # Adapter unit tests
│   ├── blockchain/         # Blockchain module tests
│   ├── configs/            # Config module tests
│   ├── helpers/            # Helper unit tests
│   └── services/           # Service unit tests
├── test-env.js             # Main test environment setup
├── setup.js                # Global test configuration
├── .env.test               # Test environment variables
└── .env.test.example       # Template for test env vars
```

## Quick Start

### Basic Test Setup

```javascript
import { setupTestEnvironment } from './test-env.js';

describe('My Test Suite', () => {
  let env;
  
  beforeAll(async () => {
    env = await setupTestEnvironment();
  });
  
  afterAll(async () => {
    await env.teardown();
  });
  
  it('should do something', async () => {
    // Your test here
  });
});
```

### Environment Options

```javascript
const env = await setupTestEnvironment({
  port: 8545,               // Ganache port
  deployContracts: true,    // Deploy FUM contracts
  updateContractsFile: false, // Update contracts.js with addresses
  quiet: true,              // Suppress Ganache logs
  syncBytecode: false,      // Sync bytecode from fum project
});
```

## Key Features

### 1. Ganache Fork
- Forks Arbitrum mainnet for realistic testing
- Provides 10 test accounts with 10,000 ETH each
- Deterministic accounts from mnemonic
- WebSocket support enabled

### 2. No Mocks
- Tests use real Uniswap SDK and ethers.js
- Interact with actual deployed contracts
- Test real transaction execution and gas costs

### 3. Test Utilities
- Snapshot/revert for test isolation
- Time manipulation (increase time, mine blocks)
- Account impersonation for testing with whale addresses
- Token balance checking and funding

### 4. Contract Deployment
- Optional deployment of FUM contracts (VaultFactory, strategies)
- Automatic bytecode syncing from fum project
- Updates contracts.js with test addresses

## Environment Variables

**Setup Required Before Running Tests:**

1. **Copy the test environment template:**
   ```bash
   cp test/.env.test.example test/.env.test
   ```

2. **Update test/.env.test with your API keys:**
   ```bash
   # In test/.env.test - replace with your actual API keys
   ALCHEMY_API_KEY=your_actual_api_key_here
   COINGECKO_API_KEY=CG-your_coingecko_api_key_here
   THEGRAPH_API_KEY=your_thegraph_api_key_here
   ```

3. **Tests will automatically load from test/.env.test**

### Available Environment Variables:
```bash
# Required: API keys for external services
ALCHEMY_API_KEY=your_api_key_here      # For forking Arbitrum mainnet
COINGECKO_API_KEY=your_api_key_here    # For price service tests
THEGRAPH_API_KEY=your_api_key_here     # For subgraph queries

# Optional: Test configuration
QUIET_TESTS=false
NODE_ENV=test
GANACHE_PORT=8545
GANACHE_BLOCK_TIME=0.5
TEST_TIMEOUT=30000
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run specific test file
npm test UniswapV3Adapter.test.js
```

## Test Patterns

### Integration Tests
- Test actual contract interactions
- Verify on-chain state changes
- Test transaction reverts and gas usage
- Use forked mainnet state

### Unit Tests
- Test pure functions
- No blockchain interaction needed
- Fast execution
- Deterministic results

## Common Test Scenarios

Common test patterns used across the test suite:
- Token amounts (small, medium, large)
- Uniswap fee tiers (100, 500, 3000, 10000)
- Price ranges for positions
- Test vault configurations
- Deterministic test accounts (10 accounts with 10,000 ETH each)

## Tips

1. **Use Snapshots**: Always snapshot before tests and revert after to ensure isolation
2. **Check Gas**: Integration tests can help identify gas-intensive operations
3. **Test Reverts**: Use `expect().rejects.toThrow()` for testing failed transactions
4. **Time Travel**: Use `increaseTime()` to test time-dependent logic
5. **Account Impersonation**: Use `impersonateAccount()` when you need to test with specific addresses

## Troubleshooting

- **Timeout Errors**: Increase test timeout in vitest.config.js
- **Fork Errors**: Check your RPC URL and network connectivity
- **Contract Not Found**: Ensure bytecode is synced from fum project
- **WebSocket Errors**: Normal during cleanup, can be ignored