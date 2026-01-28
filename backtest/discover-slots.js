/**
 * Discover and save storage slots for all tokens
 * Runs auto-discovery and updates the config file
 *
 * Usage: npm run discover:slots
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { getAllTokens, getWethAddress } from 'fum_library';
import { setupTestBlockchain, cleanupTestBlockchain } from '../test/helpers/hardhat-setup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHAIN_ID = 42161; // Arbitrum
const MAX_SLOT = 100; // Search slots 0-100
const TEST_ADDRESS = '0x0000000000000000000000000000000000000001';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

async function findBalanceSlot(tokenAddress, provider) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  try {
    const symbol = await token.symbol();
    const decimals = await token.decimals();
    const testValue = ethers.utils.parseUnits('999999', decimals);

    for (let slot = 0; slot <= MAX_SLOT; slot++) {
      const storageSlot = ethers.utils.solidityKeccak256(
        ['uint256', 'uint256'],
        [TEST_ADDRESS, slot]
      );

      await provider.send('hardhat_setStorageAt', [
        tokenAddress,
        storageSlot,
        ethers.utils.hexZeroPad(testValue.toHexString(), 32)
      ]);

      const balance = await token.balanceOf(TEST_ADDRESS);

      if (balance.eq(testValue)) {
        await provider.send('hardhat_setStorageAt', [
          tokenAddress,
          storageSlot,
          ethers.constants.HashZero
        ]);

        console.log(`  ✅ ${symbol.padEnd(6)} slot ${slot.toString().padStart(3)}`);
        return { slot, symbol };
      }

      await provider.send('hardhat_setStorageAt', [
        tokenAddress,
        storageSlot,
        ethers.constants.HashZero
      ]);
    }

    console.log(`  ❌ ${symbol.padEnd(6)} not found in slots 0-${MAX_SLOT}`);
    return { slot: null, symbol };

  } catch (error) {
    console.log(`  ❌ ${tokenAddress}: ${error.message}`);
    return { slot: null, symbol: 'UNKNOWN' };
  }
}

async function discoverAllSlots(provider) {
  console.log('🔍 Discovering storage slots for all tokens...\n');

  const allTokens = getAllTokens();
  const results = {};

  const tokensToSearch = [];
  for (const [symbol, tokenConfig] of Object.entries(allTokens)) {
    let address;

    if (symbol === 'ETH' || tokenConfig.isNative) {
      address = getWethAddress(CHAIN_ID);
    } else {
      address = tokenConfig.addresses?.[CHAIN_ID];
    }

    if (!address) {
      console.log(`⏭️  Skipping ${symbol}: not deployed on Arbitrum`);
      continue;
    }

    tokensToSearch.push({ symbol, address: address.toLowerCase() });
  }

  console.log(`📋 Searching ${tokensToSearch.length} token(s)...\n`);

  for (const { address } of tokensToSearch) {
    const { slot } = await findBalanceSlot(address, provider);
    if (slot !== null) {
      results[address] = slot;
    }
  }

  saveSlots(results);
  return results;
}

function saveSlots(slots) {
  const configPath = path.join(__dirname, 'config/token-slots.js');

  const bySlot = {};
  for (const [address, slot] of Object.entries(slots)) {
    if (!bySlot[slot]) bySlot[slot] = [];
    bySlot[slot].push(address);
  }

  let entries = [];
  for (const [slot, addresses] of Object.entries(bySlot).sort((a, b) => a[0] - b[0])) {
    entries.push(`  // Slot ${slot}`);
    for (const address of addresses.sort()) {
      entries.push(`  '${address}': ${slot},`);
    }
    entries.push('');
  }

  const content = `/**
 * Storage slot numbers for token balance mappings on Arbitrum
 * Maps token address (lowercase) -> storage slot number where balances mapping is stored
 *
 * Auto-discovered by backtest/discover-slots.js
 * Run: npm run discover:slots
 */

export const TOKEN_BALANCE_SLOTS = {
${entries.join('\n').trimEnd()}
};
`;

  fs.writeFileSync(configPath, content);
  console.log(`\n💾 Saved ${Object.keys(slots).length} slot(s) to ${configPath}`);
}

describe('Discover Token Storage Slots', () => {
  let testEnv;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
  });

  afterAll(async () => {
    await cleanupTestBlockchain(testEnv);
  });

  it('should discover and save all token slots', async () => {
    const results = await discoverAllSlots(testEnv.hardhatServer.provider);

    const foundCount = Object.keys(results).length;
    console.log(`\n✅ Found ${foundCount} token slot(s)`);
  }, 180000); // 3 minute timeout for discovery
});
