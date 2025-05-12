# Testing Guide for F.U.M. Automation

This document provides comprehensive information on testing the F.U.M. Automation service.

## Overview

The test suite for F.U.M. Automation is designed to verify:

1. **Vault Authorization Flow**: Tests the ability to authorize and revoke the automation service for vaults
2. **Event Handling**: Tests the service's ability to respond to blockchain events
3. **Strategy Execution**: Tests strategy-specific decision making logic
4. **Integration**: Tests the full workflow from event detection to action execution

## Test Structure

Tests are organized into the following directories:

- `test/integration/`: Integration tests that verify system components working together
- `test/helpers/`: Helper functions and utilities for setting up test environments
- `test/setup.js`: Global test setup and mocking configuration

## Prerequisites

Before running tests, ensure you have:

1. The `fum_library` project properly set up and linked
2. A local Ethereum development environment (tests will start Ganache automatically)
3. Node.js v16+ installed

## Running Tests

### All Tests

```bash
# Run all tests
npm test
```

### Integration Tests

```bash
# Run integration tests
npm run test:integration
```

### Specific Tests

```bash
# Run a specific test file
npm test -- -t "Vault Authorization Flow"
```

### Verbose Output

```bash
# Run tests with verbose output
npm test -- --reporter verbose
```

### Coverage Reports

```bash
# Generate test coverage report
npm run test:coverage
```

## Test Environment

The test environment automatically:

1. Starts a Ganache instance with deterministic addresses
2. Deploys necessary contracts (VaultFactory, strategies, etc.)
3. Creates test vaults for automation
4. Initializes the automation service in test mode

## Key Testing Features

### Mock Services

The test setup mocks several external services to ensure tests are reliable and fast:

- `Logger`: Mocked to prevent console output pollution during tests
- `Telegram Notifications`: Mocked to prevent sending real alerts
- `Price Feeds`: Mocked to return consistent values

### Test Helpers

Several helper functions simplify test setup:

- `startTestEnvironment()`: Sets up a complete test environment with Ganache and contracts
- `createTestVault()`: Creates a vault with specified parameters for testing

## Testing Auth Flow

The `vaultAuthorization.test.js` file tests the complete authorization flow:

1. Starting with an empty vault list
2. Authorizing the automation service for a vault
3. Setting up monitoring for the authorized vault
4. Processing vault revocation

## Bytecode Synchronization

Contract bytecode is automatically synchronized from the main F.U.M. project before running tests. This ensures tests always use the latest contract implementations.

```bash
# Manually sync bytecode files
npm run sync-bytecode
```

## Debugging Tests

For detailed debugging of tests:

```bash
# Run with full debug logging
DEBUG=fum:* npm test

# Increase test timeout
npm test -- --timeout 60000
```

## Common Issues

### Connection Errors

If tests fail with connection errors, ensure Ganache is not already running on the test port (8545 by default).

### Contract Deployment Failures

If contract deployment fails, check that bytecode files have been properly synchronized from the main project:

```bash
npm run sync-bytecode
```

### Test Timeouts

For tests involving blockchain events, increase the timeout duration:

```bash
npm test -- --timeout 60000
```

## Adding New Tests

When adding new tests:

1. Use the existing helpers for environment setup
2. Mock external dependencies appropriately
3. Follow the "Arrange-Act-Assert" pattern
4. Clean up resources in `afterEach` or `afterAll` blocks

## Continuous Integration

Tests are designed to run in CI environments. The following environment variables can be set in CI:

- `TEST_MODE=ci`: Optimizes test behavior for CI environments
- `SKIP_SLOW_TESTS=true`: Skips time-consuming tests in CI

## License

See LICENSE file for details.