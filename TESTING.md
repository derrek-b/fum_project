# Testing with Jest

The FUM Automation project uses Jest for unit and integration testing.

## Getting Started

### Installation

The Jest testing framework has been added to the project. To install dependencies, run:

```bash
./scripts/install-jest.sh
```

Or manually:

```bash
npm install --save-dev jest jest-environment-node
```

### Running Tests

Run all tests:

```bash
npm test
```

Run specific test types:

```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Run all tests
npm run test:all

# Run tests in watch mode
npm run test:watch
```

## Test Structure

### Unit Tests

Unit tests are located in `tests/unit/` and focus on testing individual components like strategies.

**Important Notes**:
- When testing strategy classes, always test the platform-specific implementations (e.g., `UniswapV3BabyStepsStrategy`) rather than base classes like `BabyStepsStrategy` directly.
- Base classes have abstract methods that are meant to be overridden by the concrete implementations.

Example:
```javascript
// tests/unit/babyStepsStrategy.test.js
describe('BabyStepsStrategy', () => {
  // Test setup...
  
  it('should register event listeners for pool', async () => {
    // Test logic...
    expect(listenerKeys.length).toBeGreaterThan(0);
  });
});
```

### Integration Tests

Integration tests are located in `tests/integration/` and test how components work together.

Example:
```javascript
// tests/integration/feeCollection.test.js
describe('Fee Collection Integration', () => {
  // Test setup...
  
  it('should determine when fees exceed the threshold', async () => {
    // Test logic...
    expect(mockedExecuteFeeCollection).toHaveBeenCalled();
  });
});
```

## Test Fixtures

The tests use fixtures for different test scenarios:

- **Strategy Parameters**: `tests/fixtures/strategyParams.js`
- **Pool Fixtures**: `tests/fixtures/poolFixtures.js`
- **Position Fixtures**: `tests/fixtures/positionFixtures.js`
- **Vault Fixtures**: `tests/fixtures/vaultFixtures.js`

## Mock Helpers

The test framework includes several mock helpers:

- **Mock Contracts**: `tests/helpers/mockContracts.js`
- **Event Simulator**: `tests/helpers/eventSimulator.js`
- **Price Simulator**: `tests/helpers/priceSimulator.js`
- **Service Test Helper**: `tests/helpers/serviceTestHelper.js`

## Migrating from Node:Test

The project has been migrated from Node's native test runner to Jest for improved functionality:

1. **Import Statements**: Removed `import { describe, it, beforeEach } from 'node:test'`
2. **Assertions**: Changed from `assert.equal()` to Jest's `expect().toBe()`
3. **Mocking**: Updated to use Jest's mocking capabilities

## Using Jest Features

### Mocking

```javascript
// Mock a function
const mockedFunction = jest.spyOn(strategy, 'executeRebalance')
  .mockImplementation(async () => {
    return { success: true };
  });

// Test with mock
expect(mockedFunction).toHaveBeenCalled();

// Clean up after test
mockedFunction.mockRestore();
```

### Assertion Examples

```javascript
// Equality
expect(result).toBe(true);
expect(object).toEqual({ key: 'value' });

// Boolean checks
expect(value).toBeTruthy();
expect(value).toBeFalsy();

// Numeric comparisons
expect(number).toBeGreaterThan(0);
expect(number).toBeLessThanOrEqual(100);

// Function calls
expect(mockedFunction).toHaveBeenCalled();
expect(mockedFunction).toHaveBeenCalledWith(arg1, arg2);
```

### Async Testing

```javascript
it('should handle async operations', async () => {
  const result = await asyncFunction();
  expect(result).toBe(expectedValue);
});
```

For additional Jest documentation, see [jestjs.io](https://jestjs.io).