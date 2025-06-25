/**
 * Ganache Test Configuration
 * 
 * Consolidated configuration for Ganache test environment.
 * Combines all Ganache setup, contract deployment, and test utilities.
 */

import ganache from 'ganache';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration constants
export const TEST_CONFIG = {
  // Network settings
  chainId: 1337,
  port: 8545,
  
  // Fork settings - Arbitrum mainnet
  forkUrl: (process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY)
    ? `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
    : 'https://arb1.arbitrum.io/rpc', // Fallback to public RPC
  
  // Test accounts
  mnemonic: 'test test test test test test test test test test test junk',
  accountCount: 10,
  defaultBalance: 10000, // ETH per account
  
  // Mining settings
  blockTime: 0.5, // Mine every 0.5 seconds for faster tests
  
  // Logging
  quiet: process.env.NODE_ENV === 'test',
};

// Deterministic test accounts derived from mnemonic
export const TEST_ACCOUNTS = [
  {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  },
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
  },
  {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
  },
  {
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'
  },
  {
    address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'
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
 * Start Ganache server with Arbitrum fork
 * @param {Object} options - Override default configuration
 * @returns {Object} Server instance and utilities
 */
export async function startGanache(options = {}) {
  const config = { ...TEST_CONFIG, ...options };
  
  const server = ganache.server({
    server: {
      port: config.port,
      ws: true, // Enable WebSocket support
    },
    chain: {
      chainId: config.chainId,
      hardfork: 'london',
    },
    wallet: {
      totalAccounts: config.accountCount,
      defaultBalance: config.defaultBalance,
      mnemonic: config.mnemonic,
    },
    miner: {
      blockTime: config.blockTime,
    },
    fork: {
      url: config.forkUrl,
      blockNumber: config.blockNumber || 'latest',
    },
    logging: {
      quiet: config.quiet,
    },
  });

  // Start the server
  await server.listen(config.port);
  
  // Create providers
  const rpcUrl = `http://localhost:${config.port}`;
  const wsUrl = `ws://localhost:${config.port}`;
  
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wsProvider = new ethers.WebSocketProvider(wsUrl);
  
  // Create signers for test accounts
  const signers = TEST_ACCOUNTS.slice(0, config.accountCount).map(
    account => new ethers.Wallet(account.privateKey, provider)
  );
  
  // Helper to stop the server
  const stop = async () => {
    try {
      await wsProvider.destroy();
      await server.close();
    } catch (error) {
      // Ignore cleanup errors
    }
  };
  
  // Handle process termination
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  
  return {
    server,
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
    value: ethers.toHex(ethers.parseEther('10')),
  }]);
  
  // Return impersonated signer
  return await provider.getSigner(address);
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
 * Get contract instance with signer
 * @param {string} address - Contract address
 * @param {Array} abi - Contract ABI
 * @param {ethers.Signer} signer - Signer instance
 * @returns {ethers.Contract} Contract instance
 */
export function getContract(address, abi, signer) {
  return new ethers.Contract(address, abi, signer);
}