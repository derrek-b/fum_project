/**
 * Global Test Teardown
 *
 * This runs after all tests complete. The main teardown logic
 * (stopping Hardhat) is handled by the function returned from globalSetup.
 *
 * This file provides backup cleanup in case something goes wrong.
 */

import { clearSharedState, hasSharedState } from './shared-state.js';

export default async function globalTeardown() {
  // Clean up state file if it still exists
  // (should have been cleaned by globalSetup's teardown function)
  if (hasSharedState()) {
    console.log('Cleaning up leftover state file...');
    clearSharedState();
  }

  console.log('Global teardown complete\n');
}
