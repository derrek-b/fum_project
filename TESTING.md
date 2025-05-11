# Testing Documentation for FUM Library

This document provides detailed information about the testing infrastructure and procedures for the FUM Library. The library utilizes Vitest as its testing framework, offering a fast and feature-rich testing experience for JavaScript/TypeScript projects.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Test Structure](#test-structure)
3. [Running Tests](#running-tests)
4. [Writing Tests](#writing-tests)
5. [Mocking](#mocking)
6. [Coverage Reports](#coverage-reports)
7. [Continuous Integration](#continuous-integration)
8. [Best Practices](#best-practices)

## Getting Started

Ensure you have all the necessary dependencies installed:

```bash
npm install
```

The testing tools and libraries are included in the `devDependencies` of the project's `package.json`:

- **Vitest**: Primary testing framework
- **Chai**: Assertion library
- **Sinon**: Mocking, stubbing, and spying library

## Test Structure

Tests are organized under the `/tests` directory, following a structure that mirrors the source code:

```
/tests
├── adapters/                # Tests for adapter modules
│   └── UniswapV3Adapter.test.js
├── helpers/                 # Tests for helper modules
│   ├── chainHelpers.test.js
│   ├── formatHelpers.test.js
│   ├── platformHelpers.test.js
│   ├── strategyHelpers.test.js
│   ├── tokenHelpers.test.js
│   └── vaultHelpers.test.js
├── mocks/                   # Mock data and utilities for testing
│   ├── contracts.js
│   ├── data.js
│   ├── ethers.js
│   ├── formatHelpersData.js
│   ├── tokenData.js
│   └── uniswapv3Data.js
└── setup.js                 # Global test setup
```

## Running Tests

The following npm scripts are available for running tests:

### Run All Tests (Once)

```bash
npm test
```

This command will run all tests in the `/tests` directory once and display the results.

### Watch Mode

```bash
npm run test:watch
```

This runs tests in watch mode, which automatically re-runs tests when source or test files change. This is useful during development.

### Code Coverage

```bash
npm run test:coverage
```

Generates a coverage report, showing which parts of the codebase are covered by tests.

### Running Specific Tests

To run tests for a specific file or directory:

```bash
npx vitest run <path/to/test/file-or-directory>
```

For example:

```bash
npx vitest run tests/helpers/formatHelpers.test.js
```

### Test Filtering

You can run specific tests by using the `--testNamePattern` flag (or `-t`):

```bash
npx vitest run --testNamePattern="formatPrice"
```

This will run only tests whose name contains "formatPrice".

## Writing Tests

Tests are written using the Vitest API, which is similar to Jest. Here's a basic template:

```javascript
import { describe, it, expect } from 'vitest';
import { functionToTest } from '../../src/path/to/module.js';

describe('moduleName', () => {
  describe('functionToTest', () => {
    it('should do something specific', () => {
      const result = functionToTest(input);
      expect(result).toBe(expectedOutput);
    });
    
    it('should handle edge cases', () => {
      const result = functionToTest(edgeCase);
      expect(result).toEqual(expectedEdgeOutput);
    });
  });
});
```

### Key Testing Functions

- `describe`: Groups related tests
- `it`/`test`: Defines a single test
- `expect`: Creates assertions
- `beforeEach`/`afterEach`: Run code before/after each test
- `beforeAll`/`afterAll`: Run code before/after all tests in a block

## Mocking

### Mocking Modules

Vitest provides a `vi.mock()` function to mock modules:

```javascript
import { describe, it, expect, vi } from 'vitest';

// Mock the entire module
vi.mock('../../src/configs/tokens.js', () => {
  return {
    default: { /* mock token data */ }
  };
});

// Import after mocking to get the mocked version
import { getTokenBySymbol } from '../../src/helpers/tokenHelpers.js';
```

### Spies and Mocks for Individual Functions

```javascript
import { describe, it, expect, vi } from 'vitest';

describe('someModule', () => {
  it('should call a dependency correctly', () => {
    // Create a spy
    const spy = vi.spyOn(dependency, 'methodName');
    
    // Function under test
    functionToTest();
    
    // Verify the spy was called
    expect(spy).toHaveBeenCalled();
    
    // Restore the spy
    spy.mockRestore();
  });
});
```

## Coverage Reports

Code coverage reports help identify parts of the codebase that lack test coverage. To generate a coverage report:

```bash
npm run test:coverage
```

The report will show:
- **Statements**: Percentage of statements executed
- **Branches**: Percentage of control flow branches (if/else, switch) executed
- **Functions**: Percentage of functions called
- **Lines**: Percentage of executable lines executed

Reports are generated as HTML in the `/coverage` directory and can be viewed in a browser.

## Continuous Integration

For CI environments, it's recommended to run tests with the following command:

```bash
npx vitest run --coverage
```

This ensures that tests are run without watch mode and that coverage reports are generated.

## Best Practices

1. **Test Isolation**: Ensure each test is independent and doesn't rely on the state from other tests.

2. **Real Configs**: Use the actual configuration files from the library rather than mocking them, especially when testing helper functions. This ensures tests are closely aligned with the real behavior.

3. **Pure Function Testing**: For pure functions, test inputs and outputs directly. Include edge cases (null, undefined, empty arrays, etc.).

4. **Mocking External Dependencies**: Only mock external dependencies that would otherwise make tests flaky or slow (e.g., API calls, blockchain connections).

5. **Descriptive Test Names**: Write descriptive test names that explain what's being tested and the expected behavior. Use the format: "should do something when condition".

6. **Maintain Test Code Quality**: Apply the same code quality standards to test code as you do to production code. Keep tests clean, readable, and maintainable.

7. **Test Organization**: Organize tests logically using `describe` blocks. Follow a pattern that mirrors the structure of the code being tested.

8. **Avoid Excessive Mocking**: While mocking is necessary in some cases, excessive mocking can lead to tests that don't reflect the real behavior of the code.

9. **Async Testing**: For asynchronous code, make sure to use `async/await` or return promises to properly handle asynchronous operations.

10. **Test Error Handling**: Don't just test the happy path. Test error scenarios to ensure your code handles failures gracefully.

## Vitest CLI Flags

Vitest offers many command-line flags to customize test runs:

| Flag                  | Description                                          |
|-----------------------|------------------------------------------------------|
| `--run`               | Run tests once (default in CI)                       |
| `--watch`             | Watch mode (default in dev)                          |
| `--coverage`          | Generate coverage report                             |
| `-t, --testNamePattern` | Run tests with names matching the pattern            |
| `-d, --dir`           | Directory to search for test files                   |
| `--update`            | Update snapshots                                     |
| `--threads`           | Whether to run tests in threads                      |
| `--silent`            | Silent mode (no output)                              |
| `--verbose`           | Enable verbose output with detailed test logs        |
| `--reporter`          | Reporter to use                                      |
| `--ui`                | Start UI dashboard (requires @vitest/ui)             |
| `--open`              | Open UI dashboard automatically (with --ui)          |
| `--api`               | Serve API for UI dashboard (with --ui)               |
| `--isolate`           | Isolate environment for each test file               |

### Using Verbose Mode

Verbose mode is particularly useful when debugging tests as it shows detailed console output that would otherwise be suppressed:

```bash
npx vitest run --verbose
```

In our tests, we use `console.log` statements in several places to show:
- Test scenario descriptions
- Expected vs. actual values
- Calculated values in complex math operations
- Percentage differences in floating-point comparisons

These logs are only visible when running with the `--verbose` flag or in watch mode when focusing on specific tests.

For a complete list of options, run:

```bash
npx vitest --help
```