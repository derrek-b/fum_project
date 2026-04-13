// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Two projects: Arbitrum-forked tests and Avalanche-forked tests.
    // Each project gets its own module scope so TEST_CONFIG in hardhat-config.js
    // evaluates FORK_CHAIN correctly at import time.
    projects: [
      {
        test: {
          name: 'arbitrum',
          globals: true,
          environment: 'node',
          globalSetup: ['./test/global-setup-arbitrum.js'],
          include: ['./test/**/*.test.js'],
          exclude: ['./test/unit/adapters/TraderJoeV2_2Adapter.test.js'],
          setupFiles: ['./test/setup.js'],
          testTimeout: 120000,
          hookTimeout: 180000,
          fileParallelism: false,
          pool: 'forks',
          poolOptions: {
            forks: { singleFork: true },
          },
        },
      },
      {
        test: {
          name: 'avalanche',
          globals: true,
          environment: 'node',
          include: ['./test/unit/adapters/TraderJoeV2_2Adapter.test.js'],
          env: {
            FORK_CHAIN: 'avalanche',
          },
          setupFiles: ['./test/setup.js'],
          testTimeout: 120000,
          hookTimeout: 180000,
          fileParallelism: false,
          pool: 'forks',
          poolOptions: {
            forks: { singleFork: true },
          },
        },
      },
    ],
  },
});
