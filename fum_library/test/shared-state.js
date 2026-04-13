/**
 * Shared state for global Hardhat instance.
 * Written by global-setup, read by test files.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.hardhat-state.json');

export function saveSharedState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function loadSharedState() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

export function clearSharedState() {
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    // File may not exist
  }
}
