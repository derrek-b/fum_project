/**
 * @module derive-xpub
 * @description One-time setup tool for a new AUTOMATION_MNEMONIC. Outputs:
 *   1. The branch xpub at m/44'/60'/0'/0 — paste into
 *      `fum_library/src/configs/chains.js` → executorXpub for the chainId
 *      this mnemonic will serve. The frontend uses this to derive per-vault
 *      executor addresses without needing the mnemonic itself.
 *   2. The first N derived executor addresses, as a sanity check that none
 *      of them collide with a wallet you actively use (avoid shipping a
 *      hot key whose addresses you can recognize on a block explorer).
 *
 *   The xpub derives ONLY public keys (addresses) — it cannot sign
 *   transactions and is safe to publish in the frontend bundle.
 *
 *   The mnemonic itself is read into process memory via dotenv and never
 *   printed, logged, or included in error messages.
 *
 * Usage:
 *   ENV_FILE=.env.railway.arbitrum node scripts/derive-xpub.js
 *   ENV_FILE=.env.local COUNT=10 node scripts/derive-xpub.js
 *
 *   Default ENV_FILE: .env.local
 *   Default COUNT:    5
 */

import dotenv from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envFile = process.env.ENV_FILE || '.env.local';
const envPath = path.resolve(__dirname, '..', envFile);

const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error(`Failed to load env file at ${envPath}`);
  console.error(result.error.message);
  process.exit(1);
}

const mnemonic = process.env.AUTOMATION_MNEMONIC;
if (!mnemonic) {
  console.error(`AUTOMATION_MNEMONIC not set in ${envFile}`);
  process.exit(1);
}

let hdNode;
try {
  hdNode = ethers.utils.HDNode.fromMnemonic(mnemonic);
} catch {
  // Swallow the underlying error — its message can include the input phrase.
  console.error('AUTOMATION_MNEMONIC is not a valid BIP-39 phrase');
  process.exit(1);
}

const count = parseInt(process.env.COUNT || '5');
if (!Number.isFinite(count) || count <= 0) {
  console.error(`Invalid COUNT: ${process.env.COUNT}`);
  process.exit(1);
}

console.log(`Loaded env from: ${envFile}`);
console.log('');

// Branch xpub for frontend executor-address derivation. The frontend
// uses this to compute per-vault executor addresses from executorIndex
// without needing the mnemonic. The xpub derives ONLY public keys
// (addresses); it cannot sign transactions and is safe to publish in
// the frontend bundle. Put this in fum_library/src/configs/chains.js
// → executorXpub for the relevant chainId.
const branch = hdNode.derivePath(`m/44'/60'/0'/0`);
const xpub = branch.neuter().extendedKey;
console.log('Branch xpub (m/44\'/60\'/0\'/0) — paste into chains.js executorXpub:');
console.log('');
console.log(`  ${xpub}`);
console.log('');

console.log(`Deriving ${count} executor addresses (path m/44'/60'/0'/0/N)\n`);

for (let i = 0; i < count; i++) {
  const child = hdNode.derivePath(`m/44'/60'/0'/0/${i}`);
  console.log(`  executorIndex ${i.toString().padStart(2)}:  ${child.address}`);
}

console.log('');
console.log('These are the executor addresses for the first', count, 'vaults created');
console.log('against this mnemonic. If ANY of them appear in a wallet you use');
console.log('(MetaMask history, block explorer search of your owner address, etc.),');
console.log('STOP — generate a fresh mnemonic and replace AUTOMATION_MNEMONIC.');
