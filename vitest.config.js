// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    include: ['./test/**/*.test.js'],
    testTimeout: 30000, // 30 seconds - original timeout to identify slow tests
    hookTimeout: 30000, // 30 seconds - original timeout to identify slow hooks
    threads: false, // Disable threading entirely - run in main process
    maxConcurrency: 1, // Run tests sequentially
    isolate: false, // Don't isolate test environments
    pool: 'forks', // Use forks pool instead of threads
    poolOptions: {
      forks: {
        singleFork: true // Force single process
      }
    }
  }
});