/**
 * Vitest configuration for V4 tests
 *
 * Uses port 8547 via v4-global-setup.js to avoid conflicts with V3 tests.
 * Run with: npm run test:v4
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // V4-specific global setup - starts Hardhat on port 8547
    globalSetup: './test/v4-global-setup.js',
    // Per-file setup - loads env vars, initializes fum_library
    setupFiles: ['./test/setup.js'],
    // Only include V4 workflow tests
    include: ['./test/workflow/v4/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 5000,
    // Run tests sequentially - V4 tests use Hardhat forks which are resource-intensive
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  }
});
