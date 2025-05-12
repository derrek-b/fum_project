# FUM Automation Integration Tests

This directory contains integration tests for the FUM Automation service.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create test bytecode directory and copy bytecode files:

```bash
mkdir -p bytecode
cp ../fum/bytecode/BatchExecutor.bin bytecode/
cp ../fum/bytecode/VaultFactory.bin bytecode/
cp ../fum/bytecode/ParrisIslandStrategy.bin bytecode/
cp ../fum/bytecode/BabyStepsStrategy.bin bytecode/
```

3. Verify `.env.test` is configured correctly.

## Running Tests

Run all tests:

```bash
npm test
```

Run in watch mode:

```bash
npm run test:watch
```

Run with coverage:

```bash
npm run test:coverage
```

Run only integration tests:

```bash
npm run test:integration
```

## Test Structure

- `/test/integration/` - Integration tests for complete workflows
- `/test/helpers/` - Helper functions for test setup
- `/test/deployments/` - Contract deployment information for tests

## Test Environment

Each test spins up its own local environment with:

- Local Ganache blockchain instance
- Deployed contract instances
- Test wallets with prefunded ETH
- Mock external services (prices, notifications)

## Adding New Tests

When creating new integration tests:

1. Use the helper functions to set up the test environment
2. Create realistic test scenarios that match production workflows
3. Clean up resources in afterAll hooks
4. Verify expectations with detailed assertions

## Available Tests

1. **Vault Authorization Flow**
   - Tests the complete vault authorization lifecycle
   - Verifies that vaults can authorize and revoke automation services
   - Confirms proper setup of monitoring for authorized vaults

2. **Price Event Monitoring** (Coming soon)
   - Tests detection of price movements
   - Verifies rebalance trigger conditions
   - Tests execution of rebalance operations

3. **Fee Collection** (Coming soon)
   - Tests fee detection and calculation
   - Verifies fee collection threshold logic
   - Tests fee collection transaction generation