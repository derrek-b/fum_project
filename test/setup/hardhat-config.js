/**
 * Hardhat Test Configuration
 *
 * Configuration for Hardhat test environment with Arbitrum fork.
 * Provides utilities for snapshot/revert, account impersonation, and time manipulation.
 *
 * ⚠️  WARNING: TEST CREDENTIALS - DO NOT USE ON MAINNET  ⚠️
 *
 * The mnemonic and private keys in this file are PUBLIC (standard Hardhat test accounts)
 * and used only for local testing. Any funds sent to these addresses on mainnet WILL BE STOLEN.
 */

import { spawn } from 'child_process';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY_ROOT = path.resolve(__dirname, '../..');

// Configuration constants
export const TEST_CONFIG = {
  // Network settings
  chainId: 1337,
  port: 8545,

  // Fork settings - Arbitrum mainnet
  forkUrl: process.env.ALCHEMY_API_KEY
    ? `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
    : 'https://arb1.arbitrum.io/rpc', // Fallback to public RPC

  // Test mnemonic - ⚠️ PUBLIC - DO NOT USE ON MAINNET
  mnemonic: 'debris coral coral sleep shed prison nation mountain fatigue prosper dose portion',
  accountCount: 10,
  defaultBalance: 10000, // ETH per account

  // Logging
  quiet: process.env.NODE_ENV === 'test',
};

// Test accounts derived from the mnemonic
// ⚠️ PUBLIC TEST KEYS - DO NOT USE ON MAINNET - FUNDS WILL BE STOLEN
export const TEST_ACCOUNTS = [
  {
    address: '0x18eE269ff740eA684da2Be21dE294e44253D0eb8',
    privateKey: '0x111cebb9a4c4f2dbc6df8404a145bf7018b7aa857e7b54e76189e7300004a4a0'
  },
  {
    address: '0x45695CF68386Ab226678F238455a8Dd41c028d69',
    privateKey: '0xd1fa41caac59aa98a67a21e77580b9ad136c67efa79ecab073b4cbfdf23c0901'
  },
  {
    address: '0xDAAe129a01d2A49cD031246D21f1bD7812e1F059',
    privateKey: '0x68ae895aa97f0a547d9a34f39e0f3bb72706f0c56a4ce2e03fe91738abb09a5d'
  },
  {
    address: '0xe2dD4a816bB1a4A2128053F5b9CF59Eeeda07E12',
    privateKey: '0x412dc9b4712fc682f9aeaa51466b6d05a2cce5720b65a241fe2444754fae454f'
  },
  {
    address: '0xabA472B2EA519490EE10E643A422D578a507197A',
    privateKey: '0x153b8bcb033769a3f3d51b6c2c99be54e76ea190a20752a308a7ec0873383470'
  }
];

// Arbitrum mainnet contract addresses
export const ARBITRUM_ADDRESSES = {
  // Uniswap V3 contracts
  POSITION_MANAGER: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  SWAP_ROUTER: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  FACTORY: '0x1F98431c8aD98523631AE4a59f267346ea31F984',

  // Common tokens
  WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  USDC: '0xaf88d065e77c8cC2239327C5EDB3A432268e5831',
  USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',

  // Example pools
  WETH_USDC_005: '0xC6962004f452bE9203591991D15f6b388e09E8D0', // 0.05% fee
  WETH_USDC_03: '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443',  // 0.3% fee
};

/**
 * Wait for Hardhat node to be ready
 * @param {string} url - RPC URL to check
 * @param {number} maxAttempts - Maximum connection attempts
 * @returns {Promise<boolean>} True if node is ready
 */
async function waitForNode(url, maxAttempts = 30) {
  const provider = new ethers.providers.JsonRpcProvider(url);
  let ready = false;

  try {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await provider.getBlockNumber();
        ready = true;
        break;
      } catch (e) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  } finally {
    // Always clean up the provider to prevent orphaned polling timers
    provider.polling = false;
    if (provider._poller) {
      clearTimeout(provider._poller);
      provider._poller = null;
    }
    provider.removeAllListeners();
  }

  return ready;
}

/**
 * Start Hardhat node with Arbitrum fork
 * @param {Object} options - Override default configuration
 * @returns {Object} Server process and utilities
 */
export async function startHardhat(options = {}) {
  const config = { ...TEST_CONFIG, ...options };

  // Spawn Hardhat node as subprocess
  const hardhatProcess = spawn('npx', ['hardhat', 'node', '--port', config.port.toString()], {
    cwd: LIBRARY_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
  });

  let nodeReady = false;

  // Monitor stdout for ready message
  hardhatProcess.stdout.on('data', (data) => {
    const output = data.toString();
    if (!config.quiet) {
      process.stdout.write(output);
    }
    if (output.includes('Started HTTP and WebSocket JSON-RPC server')) {
      nodeReady = true;
    }
  });

  hardhatProcess.stderr.on('data', (data) => {
    if (!config.quiet) {
      process.stderr.write(data.toString());
    }
  });

  // Wait for node to be ready
  const ready = await waitForNode(`http://localhost:${config.port}`);
  if (!ready) {
    hardhatProcess.kill();
    throw new Error('Hardhat node failed to start');
  }

  // Create providers
  const rpcUrl = `http://localhost:${config.port}`;
  const wsUrl = `ws://localhost:${config.port}`;

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wsProvider = new ethers.providers.WebSocketProvider(wsUrl);

  // Create signers for test accounts
  const signers = TEST_ACCOUNTS.slice(0, config.accountCount).map(
    account => new ethers.Wallet(account.privateKey, provider)
  );

  // Helper to stop the server
  const stop = async () => {
    // Remove process listeners we registered (prevents hanging on exit)
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);

    try {
      // Clean up JsonRpcProvider to prevent orphaned polling timers
      provider.polling = false;
      if (provider._poller) {
        clearTimeout(provider._poller);
        provider._poller = null;
      }
      provider.removeAllListeners();

      // Clean up WebSocketProvider
      wsProvider.removeAllListeners();
      await wsProvider.destroy();

      // Stop the Hardhat process
      hardhatProcess.kill('SIGINT');
    } catch (error) {
      // Ignore cleanup errors
    }
  };

  // Handle process termination
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  return {
    process: hardhatProcess,
    provider,
    wsProvider,
    signers,
    config,
    stop,
    addresses: ARBITRUM_ADDRESSES,
  };
}

/**
 * Helper to impersonate an account (useful for testing with whale addresses)
 * @param {ethers.Provider} provider - The provider instance
 * @param {string} address - Address to impersonate
 * @returns {ethers.Signer} Impersonated signer
 */
export async function impersonateAccount(provider, address) {
  // Enable account impersonation
  await provider.send('hardhat_impersonateAccount', [address]);

  // Fund the account with ETH for gas
  const [funder] = await provider.listAccounts();
  await provider.send('eth_sendTransaction', [{
    from: funder,
    to: address,
    value: ethers.utils.hexValue(ethers.utils.parseEther('10')),
  }]);

  // Return impersonated signer
  return provider.getSigner(address);
}

/**
 * Stop impersonating an account
 * @param {ethers.Provider} provider - The provider instance
 * @param {string} address - Address to stop impersonating
 */
export async function stopImpersonatingAccount(provider, address) {
  await provider.send('hardhat_stopImpersonatingAccount', [address]);
}

/**
 * Take a snapshot of the blockchain state
 * @param {ethers.Provider} provider - The provider instance
 * @returns {string} Snapshot ID
 */
export async function takeSnapshot(provider) {
  return await provider.send('evm_snapshot', []);
}

/**
 * Revert to a blockchain snapshot
 * @param {ethers.Provider} provider - The provider instance
 * @param {string} snapshotId - The snapshot to revert to
 */
export async function revertToSnapshot(provider, snapshotId) {
  await provider.send('evm_revert', [snapshotId]);
}

/**
 * Mine a specific number of blocks
 * @param {ethers.Provider} provider - The provider instance
 * @param {number} blocks - Number of blocks to mine
 */
export async function mineBlocks(provider, blocks = 1) {
  for (let i = 0; i < blocks; i++) {
    await provider.send('evm_mine', []);
  }
}

/**
 * Increase blockchain time
 * @param {ethers.Provider} provider - The provider instance
 * @param {number} seconds - Number of seconds to increase
 */
export async function increaseTime(provider, seconds) {
  await provider.send('evm_increaseTime', [seconds]);
  await provider.send('evm_mine', []); // Mine a block to apply the time change
}

/**
 * Set the next block timestamp
 * @param {ethers.Provider} provider - The provider instance
 * @param {number} timestamp - Unix timestamp for next block
 */
export async function setNextBlockTimestamp(provider, timestamp) {
  await provider.send('evm_setNextBlockTimestamp', [timestamp]);
}

/**
 * Get contract instance with signer
 * @param {string} address - Contract address
 * @param {Array} abi - Contract ABI
 * @param {ethers.Signer} signer - Signer instance
 * @returns {ethers.Contract} Contract instance
 */
export function getContract(address, abi, signer) {
  return new ethers.Contract(address, abi, signer);
}

