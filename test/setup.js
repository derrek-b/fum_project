/**
 * Global Test Setup
 *
 * This file runs before all tests to configure the test environment.
 * Uses fum_library test environment for consistent testing approach.
 */

import { vi } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initFumLibrary } from 'fum_library';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env.local
dotenv.config({ path: path.join(__dirname, '../.env.local') });

// Initialize fum_library with API keys for adapter initialization
initFumLibrary({
  alchemyApiKey: process.env.ALCHEMY_API_KEY,
  coingeckoApiKey: process.env.COINGECKO_API_KEY,
});

// Suppress console output during tests (optional)
if (process.env.QUIET_TESTS === 'true') {
  global.console = {
    ...console,
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

// Set test environment flag
process.env.NODE_ENV = 'test';

// Global test utilities
global.testUtils = {
  // Add any global utilities here
};

// Cleanup after all tests
if (typeof afterAll !== 'undefined') {
  afterAll(async () => {
    // Ensure all WebSocket connections are closed
    await new Promise(resolve => setTimeout(resolve, 100));
  });
}