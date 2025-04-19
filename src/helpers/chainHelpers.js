// src/helpers/chainHelpers.js
import chains from '../configs/chains.js';

/**
 * Get chain configuration by chain ID
 * @param {number} chainId - The blockchain network ID
 * @returns {Object|null} Chain configuration object or null if not found
 */
export function getChainConfig(chainId) {
  if (!chainId || !chains[chainId]) return null;
  return chains[chainId];
}

/**
 * Get chain name by chain ID
 * @param {number} chainId - The blockchain network ID
 * @returns {string} Chain name or "Unknown Chain" if not found
 */
export function getChainName(chainId) {
  return chains[chainId]?.name || "Unknown Chain";
}

/**
 * Get RPC URL for a specific chain
 * @param {number} chainId - The blockchain network ID
 * @returns {string|null} RPC URL or null if chain not found
 */
export function getChainRpcUrl(chainId) {
  return chains[chainId]?.rpcUrl || null;
}

/**
 * Get the executor address for the specified chain
 * @param {number} chainId - The blockchain network ID
 * @returns {string|null} The executor address or null if not configured
 */
export function getExecutorAddress(chainId) {
  if (!chainId || !chains[chainId]) return null;
  return chains[chainId].executorAddress || null;
}

/**
 * Check if a chain is supported
 * @param {number} chainId - The blockchain network ID to check
 * @returns {boolean} Whether the chain is supported
 */
export function isChainSupported(chainId) {
  return !!chains[chainId];
}

/**
 * Get all supported chain IDs
 * @returns {Array<number>} Array of supported chain IDs
 */
export function getSupportedChainIds() {
  return Object.keys(chains).map(id => parseInt(id));
}

/**
 * Get platform addresses for a specific chain and platform
 * @param {number} chainId - The blockchain network ID
 * @param {string} platformId - The platform identifier
 * @returns {Object|null} Platform addresses or null if not found/enabled
 */
export function getPlatformAddresses(chainId, platformId) {
  const chainConfig = chains[chainId];
  if (!chainConfig || !chainConfig.platformAddresses[platformId]) return null;

  const platformConfig = chainConfig.platformAddresses[platformId];
  if (!platformConfig.enabled) return null;

  return platformConfig;
}

/**
 * Get all platform IDs available on a specific chain
 * @param {number} chainId - The blockchain network ID
 * @returns {Array<string>} Array of platform IDs
 */
export function getChainPlatformIds(chainId) {
  const chainConfig = chains[chainId];
  if (!chainConfig) return [];

  return Object.entries(chainConfig.platformAddresses)
    .filter(([_, config]) => config.enabled)
    .map(([id, _]) => id);
}
