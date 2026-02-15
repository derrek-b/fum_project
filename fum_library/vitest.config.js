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
    fileParallelism: false,
    pool: 'forks', // Use forks pool instead of threads
    poolOptions: {
      forks: {
        singleFork: true // Force single process
      }
    }
  }
});
