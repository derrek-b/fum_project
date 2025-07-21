/**
 * @module helpers/chainHelpers
 * @description Chain configuration utilities for managing blockchain network settings and platform integrations.
 * Provides functions to query chain configurations, RPC endpoints, platform addresses, and executor contracts.
 * @since 1.0.0
 */

import chains from '../configs/chains.js';

/**
 * Validate chainId parameter using established validation pattern
 * @param {any} chainId - The value to validate as a chainId
 * @throws {Error} If chainId is not a valid number
 */
function validateChainId(chainId) {
  if (chainId === null || chainId === undefined) {
    throw new Error('chainId parameter is required');
  }

  if (typeof chainId !== 'number') {
    throw new Error('chainId must be a number');
  }

  if (!Number.isFinite(chainId)) {
    throw new Error('chainId must be a finite number');
  }
  
  if (!Number.isInteger(chainId)) {
    throw new Error('chainId must be an integer');
  }
  
  if (chainId <= 0) {
    throw new Error('chainId must be greater than 0');
  }
}

/**
 * Get chain configuration by chain ID
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {Object} Chain configuration object containing name, rpcUrl, executorAddress, and platformAddresses
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @example
 * // Get Ethereum mainnet configuration
 * const config = getChainConfig(1);
 * // Returns: { name: "Ethereum", rpcUrl: "https://...", executorAddress: "0x...", platformAddresses: {...} }
 *
 * @example
 * // Handle unknown chain
 * const config = getChainConfig(999999);
 * // Returns: null
 */
export function getChainConfig(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  return config;
}

/**
 * Get chain name by chain ID
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {string} Human-readable chain name
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @example
 * // Get known chain name
 * getChainName(1); // "Ethereum"
 * getChainName(137); // "Polygon"
 *
 * @example
 * // Handle unknown chain
 * getChainName(999999); // "Unknown Chain"
 * @since 1.0.0
 */
export function getChainName(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config || !config.name) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  return config.name;
}

/**
 * Get RPC URL for a specific chain
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {string} RPC endpoint URL for blockchain interactions
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @throws {Error} If no RPC URL is configured for the chain
 * @example
 * // Get RPC URL for Ethereum mainnet
 * const rpcUrl = getChainRpcUrl(1);
 * // Use with ethers.js
 * const provider = new ethers.JsonRpcProvider(rpcUrl);
 *
 * @example
 * // Handle missing RPC URL
 * const rpcUrl = getChainRpcUrl(999999);
 * if (!rpcUrl) {
 *   console.error('Chain not supported');
 * }
 * @since 1.0.0
 */
export function getChainRpcUrls(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (!config.rpcUrls) {
    throw new Error(`No RPC URL configured for chain ${chainId}`);
  }

  return config.rpcUrls;
}

/**
 * Get the executor address for the specified chain
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {string} The executor contract address (0x-prefixed)
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @throws {Error} If no executor address is configured for the chain
 * @example
 * // Get executor for Ethereum mainnet
 * const executor = getExecutorAddress(1);
 * // Returns: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E2e1"
 *
 * @example
 * // Use in contract interaction
 * const executorAddress = getExecutorAddress(chainId);
 * if (executorAddress) {
 *   const contract = new ethers.Contract(executorAddress, executorABI, provider);
 * }
 * @since 1.0.0
 */
export function getExecutorAddress(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (!config.executorAddress || config.executorAddress === '0x0') {
    throw new Error(`No executor address configured for chain ${chainId}`);
  }

  return config.executorAddress;
}

/**
 * Check if a chain is supported
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID to check
 * @returns {boolean} True if the chain is supported, false otherwise
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @example
 * // Check before proceeding with chain-specific operations
 * if (!isChainSupported(chainId)) {
 *   throw new Error(`Chain ${chainId} is not supported`);
 * }
 *
 * @example
 * // Filter supported chains
 * const supportedNetworks = [1, 137, 42161, 10].filter(isChainSupported);
 * @since 1.0.0
 */
export function isChainSupported(chainId) {
  validateChainId(chainId);

  return !!chains[chainId];
}

/**
 * Get all supported chain IDs
 * @memberof module:helpers/chainHelpers
 * @returns {Array<number>} Array of supported chain IDs as integers
 * @example
 * // Get all supported chains
 * const chainIds = getSupportedChainIds();
 * // Returns: [1, 137, 42161, 10, ...]
 *
 * @example
 * // Create chain selector dropdown
 * const chains = getSupportedChainIds().map(id => ({
 *   id,
 *   name: getChainName(id)
 * }));
 * @since 1.0.0
 */
export function getSupportedChainIds() {
  return Object.keys(chains).map(id => parseInt(id));
}

/**
 * Get platform addresses for a specific chain and platform
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @param {string} platformId - The platform identifier (e.g., 'uniswapV3', 'aaveV3')
 * @returns {Object|null} Platform addresses object with factoryAddress and positionManagerAddress - null if not found or disabled
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @throws {Error} If no platform addresses are configured for the chain
 * @throws {Error} If platformId is not valid (null, undefined, not a string, or empty)
 * @example
 * // Get Uniswap V3 addresses on Ethereum
 * const addresses = getPlatformAddresses(1, 'uniswapV3');
 * // Returns: {
 * //   enabled: true,
 * //   factoryAddress: "0x1F984...",
 * //   positionManagerAddress: "0xC3650..."
 * // }
 *
 * @example
 * // Check if platform is available before using
 * const platformConfig = getPlatformAddresses(chainId, platformId);
 * if (!platformConfig) {
 *   console.error(`Platform ${platformId} not available on chain ${chainId}`);
 * }
 * @since 1.0.0
 */
export function getPlatformAddresses(chainId, platformId) {
  validateChainId(chainId);

  if (platformId === null || platformId === undefined) {
    throw new Error('platformId parameter is required');
  }

  if (typeof platformId !== 'string') {
    throw new Error('platformId must be a string');
  }

  if (platformId === '') {
    throw new Error('platformId cannot be empty');
  }

  const chainConfig = chains[chainId];
  if (!chainConfig) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (!chainConfig.platformAddresses) {
    throw new Error(`No platform addresses configured for chain ${chainId}`);
  }

  const platformConfig = chainConfig.platformAddresses[platformId];
  if (!platformConfig) {
    return null; // Platform doesn't exist for this chain (business logic)
  }

  if (!platformConfig.enabled) {
    return null; // Platform disabled (business decision)
  }

  return platformConfig;
}

/**
 * Get all platform IDs available on a specific chain
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {Array<string>} Array of enabled platform IDs for the chain
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @throws {Error} If no platform addresses are configured for the chain
 * @example
 * // Get all platforms on Ethereum mainnet
 * const platforms = getChainPlatformIds(1);
 * // Returns: ['uniswapV3', 'aaveV3', ...]
 *
 * @example
 * // Build platform selector for a specific chain
 * const availablePlatforms = getChainPlatformIds(chainId)
 *   .map(platformId => ({
 *     id: platformId,
 *     name: getPlatformName(platformId),
 *     addresses: getPlatformAddresses(chainId, platformId)
 *   }));
 * @since 1.0.0
 */
export function getChainPlatformIds(chainId) {
  validateChainId(chainId);

  const chainConfig = chains[chainId];
  if (!chainConfig) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (!chainConfig.platformAddresses) {
    throw new Error(`No platform addresses configured for chain ${chainId}`);
  }

  return Object.entries(chainConfig.platformAddresses)
    .filter(([_, config]) => config.enabled)
    .map(([id, _]) => id);
}
