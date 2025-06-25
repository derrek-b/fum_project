#!/usr/bin/env node

/**
 * Integration Test Runner
 * 
 * Helper script to run integration tests with proper environment setup.
 * Usage: node scripts/test-integration.js
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Check if test/.env.test exists
const envTestPath = path.join(rootDir, 'test', '.env.test');

if (!fs.existsSync(envTestPath)) {
  console.error('❌ test/.env.test not found!');
  console.error('   Please copy test/.env.test.example to test/.env.test and configure your API key');
  process.exit(1);
}

// Run vitest with integration test pattern
const vitest = spawn('npx', ['vitest', 'run', 'integration'], {
  stdio: 'inherit',
  cwd: rootDir,
  env: {
    ...process.env,
    NODE_ENV: 'test',
  },
});

vitest.on('close', (code) => {
  process.exit(code);
});