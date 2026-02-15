/**
 * Global Test Setup
 * 
 * This file runs before all tests to configure the test environment.
 * Unlike the old setup, we don't mock libraries - we use real implementations.
 */

import { vi } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initFumLibrary } from '../src/init.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load test environment variables from test/.env.test
dotenv.config({ path: path.join(__dirname, '.env.test') });

// Initialize fum_library with test API keys
initFumLibrary({
  coingeckoApiKey: process.env.COINGECKO_API_KEY,
  alchemyApiKey: process.env.ALCHEMY_API_KEY,
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