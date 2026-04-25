// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Global setup/teardown - starts shared Hardhat instance once for all tests
    globalSetup: './test/global-setup.js',
    // Per-file setup - loads env vars, initializes fum_library
    setupFiles: ['./test/setup.js'],
    include: ['./test/**/*.test.js'],
    testTimeout: 480000, // 8 minutes - AlphaRouter EXACT_OUTPUT quotes are slow on Hardhat forks
    hookTimeout: 480000, // 8 minutes - vault setup includes AlphaRouter-dependent service.start()
    teardownTimeout: 5000, // 5 seconds for teardown (reduces hanging wait)
    // Run tests sequentially - workflow tests use Hardhat forks which are resource-intensive
    // and cannot run in parallel without resource contention issues
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  }
});
