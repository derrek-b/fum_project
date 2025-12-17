/**
 * Shared state management for test infrastructure
 *
 * This module provides utilities to share state between vitest's globalSetup
 * (which runs in a separate process) and the test files.
 *
 * State is persisted to a JSON file that tests can read to connect to the
 * shared Hardhat instance.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.hardhat-state.json');

/**
 * Save shared Hardhat state for tests to use
 * @param {Object} state - State object containing:
 *   - pid: Hardhat process ID
 *   - port: Hardhat RPC port
 *   - baseSnapshotId: Snapshot ID taken after contract deployment
 *   - deployedContracts: Object with contract addresses
 */
export function saveSharedState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Load shared Hardhat state
 * @returns {Object} State object
 * @throws {Error} If state file doesn't exist
 */
export function loadSharedState() {
  if (!fs.existsSync(STATE_FILE)) {
    throw new Error(
      'Shared Hardhat state not found. Did globalSetup run?\n' +
      'Expected state file at: ' + STATE_FILE
    );
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

/**
 * Clear shared state file (called during teardown)
 */
export function clearSharedState() {
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
}

/**
 * Check if shared state exists
 * @returns {boolean}
 */
export function hasSharedState() {
  return fs.existsSync(STATE_FILE);
}
