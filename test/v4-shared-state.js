/**
 * Shared state management for V4 test infrastructure
 *
 * This module provides utilities to share state between vitest's globalSetup
 * (which runs in a separate process) and the V4 test files.
 *
 * State is persisted to a JSON file that tests can read to connect to the
 * shared Hardhat instance on port 8547.
 *
 * Separate from V3 shared-state.js to allow independent test runs.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.hardhat-state-v4.json');

/**
 * Save shared Hardhat state for V4 tests to use
 * @param {Object} state - State object containing:
 *   - pid: Hardhat process ID
 *   - port: Hardhat RPC port (8547 for V4)
 *   - baseSnapshotId: Snapshot ID taken after contract deployment
 *   - deployedContracts: Object with contract addresses
 */
export function saveV4SharedState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Load shared Hardhat state for V4 tests
 * @returns {Object} State object
 * @throws {Error} If state file doesn't exist
 */
export function loadV4SharedState() {
  if (!fs.existsSync(STATE_FILE)) {
    throw new Error(
      'V4 shared Hardhat state not found. Did v4-global-setup run?\n' +
      'Expected state file at: ' + STATE_FILE
    );
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

/**
 * Clear V4 shared state file (called during teardown)
 */
export function clearV4SharedState() {
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
}

/**
 * Check if V4 shared state exists
 * @returns {boolean}
 */
export function hasV4SharedState() {
  return fs.existsSync(STATE_FILE);
}
