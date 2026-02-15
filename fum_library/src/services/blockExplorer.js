/**
 * @module services/blockExplorer
 * @description Factory-based service for fetching internal transactions from block explorers
 *
 * Supports:
 * - Arbitrum (42161) & local fork (1337): Arbiscan API
 * - Ethereum (1): Alchemy (future)
 * - Polygon (137): Alchemy (future)
 */

import { ethers } from 'ethers';

// ============================================================================
// Configuration
// ============================================================================

let _config = {
  blockExplorerApiKey: null,
  alchemyApiKey: null,  // For future use
};

// Chain ID to explorer type mapping
const EXPLORER_BY_CHAIN = {
  1337: 'arbiscan',   // Local fork (uses Arbitrum data)
  42161: 'arbiscan',  // Arbitrum One
  1: 'alchemy',       // Ethereum Mainnet (future)
  137: 'alchemy',     // Polygon (future)
};

// Etherscan V2 API unified endpoint
const ETHERSCAN_V2_BASE_URL = 'https://api.etherscan.io/v2/api';

// Chain ID mapping for Etherscan V2 API
// Local fork (1337) uses Arbitrum's chainId since we're querying Arbitrum data
const ETHERSCAN_CHAIN_IDS = {
  1337: 42161,  // Local fork -> Arbitrum One
  42161: 42161, // Arbitrum One
};

/**
 * Configure the block explorer service
 * @param {Object} options
 * @param {string} [options.blockExplorerApiKey] - Block explorer API key (Arbiscan, Snowtrace, etc.)
 * @param {string} [options.alchemyApiKey] - Alchemy API key (for future use)
 */
export function configureBlockExplorer({ blockExplorerApiKey, alchemyApiKey } = {}) {
  if (blockExplorerApiKey !== undefined) _config.blockExplorerApiKey = blockExplorerApiKey;
  if (alchemyApiKey !== undefined) _config.alchemyApiKey = alchemyApiKey;
}

/**
 * Get the current configuration (for testing purposes)
 * @returns {Object} Current configuration
 */
export function getBlockExplorerConfig() {
  return { ..._config };
}

/**
 * Reset configuration to defaults (for testing purposes)
 */
export function resetBlockExplorerConfig() {
  _config = {
    blockExplorerApiKey: null,
    alchemyApiKey: null,
  };
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Get the appropriate block explorer service for a chain
 * @param {number} chainId - Chain ID
 * @returns {Object} Service object with getInternalTransactions and getEthTransfersForWallet methods
 * @throws {Error} If chain is not supported
 */
export function getBlockExplorerService(chainId) {
  if (typeof chainId !== 'number' || !Number.isFinite(chainId)) {
    throw new Error('chainId must be a finite number');
  }

  const explorerType = EXPLORER_BY_CHAIN[chainId];

  if (!explorerType) {
    throw new Error(`No block explorer configured for chainId ${chainId}`);
  }

  if (explorerType === 'arbiscan') {
    return createArbiscanService(chainId);
  }

  if (explorerType === 'alchemy') {
    throw new Error(`Alchemy block explorer not yet implemented for chainId ${chainId}`);
  }

  throw new Error(`Unknown explorer type: ${explorerType}`);
}

// ============================================================================
// Arbiscan Implementation
// ============================================================================

function createArbiscanService(chainId) {
  const etherscanChainId = ETHERSCAN_CHAIN_IDS[chainId];

  if (!etherscanChainId) {
    throw new Error(`No Etherscan chain ID configured for chainId ${chainId}`);
  }

  return {
    /**
     * Get internal transactions for a specific transaction hash
     * @param {string} txHash - Transaction hash
     * @returns {Promise<Array>} Array of internal transactions
     *
     * Response format:
     * [{
     *   blockNumber: "123456",
     *   timeStamp: "1234567890",
     *   hash: "0x...",
     *   from: "0x...",
     *   to: "0x...",
     *   value: "1000000000000000000", // wei
     *   contractAddress: "",
     *   input: "",
     *   type: "call",
     *   gas: "...",
     *   gasUsed: "...",
     *   traceId: "0",
     *   isError: "0",
     *   errCode: ""
     * }]
     */
    async getInternalTransactions(txHash) {
      // Validate txHash
      if (!txHash || typeof txHash !== 'string') {
        throw new Error('txHash is required and must be a string');
      }
      if (!txHash.match(/^0x[a-fA-F0-9]{64}$/)) {
        throw new Error('Invalid transaction hash format');
      }

      const url = new URL(ETHERSCAN_V2_BASE_URL);
      url.searchParams.append('chainid', etherscanChainId);
      url.searchParams.append('module', 'account');
      url.searchParams.append('action', 'txlistinternal');
      url.searchParams.append('txhash', txHash);
      if (_config.blockExplorerApiKey) {
        url.searchParams.append('apikey', _config.blockExplorerApiKey);
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Arbiscan API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Arbiscan returns { status: "1", message: "OK", result: [...] }
      // or { status: "0", message: "No transactions found", result: [] }
      if (data.status === '0' && data.message !== 'No transactions found') {
        throw new Error(`Arbiscan API error: ${data.message}`);
      }

      return data.result || [];
    },

    /**
     * Get ETH transfer amounts from internal transactions for a wallet
     * @param {string} txHash - Transaction hash
     * @param {string} walletAddress - Wallet address to filter transfers
     * @returns {Promise<{received: BigNumber, sent: BigNumber}>}
     */
    async getEthTransfersForWallet(txHash, walletAddress) {
      // Validate walletAddress
      if (!walletAddress || typeof walletAddress !== 'string') {
        throw new Error('walletAddress is required and must be a string');
      }

      const normalizedWallet = walletAddress.toLowerCase();
      const internalTxs = await this.getInternalTransactions(txHash);

      let received = ethers.BigNumber.from(0);
      let sent = ethers.BigNumber.from(0);

      for (const tx of internalTxs) {
        if (tx.isError !== '0') continue; // Skip failed internal txs

        const value = ethers.BigNumber.from(tx.value || '0');
        if (value.isZero()) continue;

        if (tx.to?.toLowerCase() === normalizedWallet) {
          received = received.add(value);
        }
        if (tx.from?.toLowerCase() === normalizedWallet) {
          sent = sent.add(value);
        }
      }

      return { received, sent };
    }
  };
}

// ============================================================================
// Alchemy Implementation (Future)
// ============================================================================

// function createAlchemyService(chainId) {
//   // TODO: Implement when needed for Ethereum/Polygon
//   // Will use alchemy-sdk getAssetTransfers with category: ['internal']
// }
