// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    include: ['./test/**/*.test.js'],
    testTimeout: 30000, // 30 seconds for integration tests
    hookTimeout: 30000, // 30 seconds for setup/teardown
    // Run tests sequentially - workflow tests use Ganache forks which are resource-intensive
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
