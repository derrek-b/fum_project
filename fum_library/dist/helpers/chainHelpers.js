/**
 * @module helpers/chainHelpers
 * @description Chain configuration utilities for managing blockchain network settings and platform integrations.
 * Provides functions to query chain configurations, RPC endpoints, platform addresses, and executor contracts.
 * @since 1.0.0
 */

import chains from '../configs/chains.js';

// Module-level configuration (set via configureChainHelpers)
let _chainConfig = {
  alchemyApiKey: null,
};

/**
 * Configure chain helpers
 * @param {Object} options - Configuration options
 * @param {string} [options.alchemyApiKey] - Alchemy API key for RPC URLs requiring authentication
 * @example
 * import { configureChainHelpers } from 'fum_library/helpers/chainHelpers';
 * configureChainHelpers({ alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY });
 */
export function configureChainHelpers({ alchemyApiKey } = {}) {
  if (alchemyApiKey !== undefined) {
    _chainConfig.alchemyApiKey = alchemyApiKey;
  }
}

/**
 * Validate chainId parameter using established validation pattern
 * @param {any} chainId - The value to validate as a chainId
 * @throws {Error} If chainId is not a valid number
 */
export function validateChainId(chainId) {
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
 * @returns {Object} Chain configuration object containing name, rpcUrl, executorXpub, and platformAddresses
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
 * @throws {Error} If chain name is not configured or is empty
 * @example
 * // Get known chain name
 * getChainName(1); // "Ethereum"
 * getChainName(42161); // "Arbitrum One"
 *
 * @example
 * // Unknown chain throws error
 * getChainName(999999); // Throws: Error: Chain 999999 is not supported
 *
 * @example
 * // Chain without name throws error
 * getChainName(chainWithoutName); // Throws: Error: Chain chainWithoutName name not configured
 * @since 1.0.0
 */
export function getChainName(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (!config.name || config.name === '') {
    throw new Error(`Chain ${chainId} name not configured`);
  }

  return config.name;
}

/**
 * Get RPC URLs for a specific chain
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {Array<string>} Array of RPC endpoint URLs for blockchain interactions
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @throws {Error} If no RPC URLs property is configured for the chain
 * @throws {Error} If RPC URLs array is empty or not an array
 * @example
 * // Get RPC URLs for Ethereum mainnet
 * const rpcUrls = getChainRpcUrls(1);
 * // Returns: ["https://cloudflare-eth.com"]
 * // Use with ethers.js
 * const provider = new ethers.JsonRpcProvider(rpcUrls[0]);
 *
 * @example
 * // Chain without RPC URLs throws error
 * getChainRpcUrls(chainWithoutRpc); // Throws: Error: Chain chainWithoutRpc RPC URLs not configured
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

  if (!Array.isArray(config.rpcUrls) || config.rpcUrls.length === 0) {
    throw new Error(`Chain ${chainId} RPC URLs not configured`);
  }

  // Chains that require API key appended at runtime (Alchemy endpoints)
  if (chainId === 42161 || chainId === 43114) {
    const apiKey = _chainConfig.alchemyApiKey;
    if (!apiKey) {
      throw new Error('Alchemy API key not configured. Call configureChainHelpers({ alchemyApiKey }) or initFumLibrary({ alchemyApiKey }) first.');
    }
    return config.rpcUrls.map(url => `${url}/${apiKey}`);
  }

  return config.rpcUrls;
}

/**
 * Get the executor extended public key for the specified chain
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {string} The executor xpub (BIP-32 extended public key)
 * @throws {Error} If chainId is not valid
 * @throws {Error} If chain is not supported
 * @throws {Error} If no executor xpub is configured for the chain
 * @since 2.0.0
 */
export function getExecutorXpub(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (!config.executorXpub || config.executorXpub === '') {
    throw new Error(`No executor xpub configured for chain ${chainId}`);
  }

  return config.executorXpub;
}

/**
 * Get minimum executor balance for the specified chain (native token)
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {number} Minimum executor balance in native token units
 * @throws {Error} If chainId is not valid
 * @throws {Error} If chain is not supported
 * @throws {Error} If no minimum executor balance is configured for the chain
 * @since 2.0.0
 */
export function getMinExecutorBalance(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (typeof config.minExecutorBalance !== 'number' || !Number.isFinite(config.minExecutorBalance) || config.minExecutorBalance <= 0) {
    throw new Error(`No minimum executor balance configured for chain ${chainId}`);
  }

  return config.minExecutorBalance;
}

/**
 * Get maximum executor balance (top-up target) for the specified chain (native token)
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {number} Maximum executor balance in native token units
 * @throws {Error} If chainId is not valid
 * @throws {Error} If chain is not supported
 * @throws {Error} If no maximum executor balance is configured for the chain
 * @since 2.0.0
 */
export function getMaxExecutorBalance(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (typeof config.maxExecutorBalance !== 'number' || !Number.isFinite(config.maxExecutorBalance) || config.maxExecutorBalance <= 0) {
    throw new Error(`No maximum executor balance configured for chain ${chainId}`);
  }

  return config.maxExecutorBalance;
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
 * Check if a chain is a local development chain (Hardhat fork)
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {boolean} True if the chain is a local development chain
 * @throws {Error} If chainId is not a positive integer
 * @since 1.2.1
 */
export function isLocalChain(chainId) {
  validateChainId(chainId);
  return chainId === 1337 || chainId === 1338;
}

/**
 * Lookup all supported chain IDs
 * @memberof module:helpers/chainHelpers
 * @returns {Array<number>} Array of supported chain IDs as integers
 * @example
 * // Lookup all supported chains
 * const chainIds = lookupSupportedChainIds();
 * // Returns: [1, 137, 42161, 10, ...]
 *
 * @example
 * // Create chain selector dropdown
 * const chains = lookupSupportedChainIds().map(id => ({
 *   id,
 *   name: getChainName(id)
 * }));
 * @since 1.0.0
 */
export function lookupSupportedChainIds() {
  return Object.keys(chains).map(id => parseInt(id));
}

/**
 * Get platform addresses for a specific chain and platform
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @param {string} platformId - The platform identifier (e.g., 'uniswapV3', 'aaveV3')
 * @returns {Object} Platform addresses object with factoryAddress and positionManagerAddress
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @throws {Error} If no platform addresses are configured for the chain
 * @throws {Error} If platformId is not valid (null, undefined, not a string, or empty)
 * @throws {Error} If platform is not configured for the chain
 * @example
 * // Get Uniswap V3 addresses on Ethereum
 * const addresses = getPlatformAddresses(1, 'uniswapV3');
 * // Returns: {
 * //   factoryAddress: "0x1F984...",
 * //   positionManagerAddress: "0xC3650..."
 * // }
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
    throw new Error(`Platform ${platformId} not configured for chain ${chainId}`);
  }

  return platformConfig;
}

/**
 * Lookup all platform IDs available on a specific chain
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {Array<string>} Array of platform IDs for the chain
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @throws {Error} If no platform addresses are configured for the chain
 * @example
 * // Lookup all platforms on Ethereum mainnet
 * const platforms = lookupChainPlatformIds(1);
 * // Returns: ['uniswapV3', 'aaveV3', ...]
 *
 * @example
 * // Build platform selector for a specific chain
 * const availablePlatforms = lookupChainPlatformIds(chainId)
 *   .map(platformId => ({
 *     id: platformId,
 *     name: getPlatformName(platformId),
 *     addresses: getPlatformAddresses(chainId, platformId)
 *   }));
 * @since 1.0.0
 */
export function lookupChainPlatformIds(chainId) {
  validateChainId(chainId);

  const chainConfig = chains[chainId];
  if (!chainConfig) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (!chainConfig.platformAddresses) {
    throw new Error(`No platform addresses configured for chain ${chainId}`);
  }

  return Object.keys(chainConfig.platformAddresses);
}

/**
 * Get minimum deployment amount for gas economics on a specific chain
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {number} Minimum deployment amount in USD for gas-efficient operations
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @throws {Error} If no minimum deployment amount is configured for the chain
 * @example
 * // Get minimum deployment for Ethereum (high gas)
 * const minAmount = getMinDeploymentForGas(1);
 * // Returns: 100 (USD)
 *
 * @example
 * // Get minimum deployment for Arbitrum (low gas)
 * const minAmount = getMinDeploymentForGas(42161);
 * // Returns: 10 (USD)
 *
 * @example
 * // Use in strategy logic
 * const minDeployment = getMinDeploymentForGas(chainId);
 * if (availableDeployment > minDeployment) {
 *   // Proceed with deployment
 * }
 * @since 1.0.0
 */
export function getMinDeploymentForGas(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (typeof config.minDeploymentForGas !== 'number' || !Number.isFinite(config.minDeploymentForGas) || config.minDeploymentForGas <= 0) {
    throw new Error(`No minimum deployment amount configured for chain ${chainId}`);
  }

  return config.minDeploymentForGas;
}

/**
 * Get minimum swap value for a specific chain
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {number} Minimum swap value in USD - swaps below this threshold are skipped
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @throws {Error} If no minimum swap value is configured for the chain
 * @example
 * // Get minimum swap value for Arbitrum (low gas)
 * const minValue = getMinSwapValue(42161);
 * // Returns: 0.10 (USD)
 *
 * @example
 * // Get minimum swap value for Ethereum (high gas)
 * const minValue = getMinSwapValue(1);
 * // Returns: 1.00 (USD)
 *
 * @example
 * // Use in strategy logic to skip dust swaps
 * const minSwapValue = getMinSwapValue(chainId);
 * if (tokenUSDValue < minSwapValue) {
 *   // Skip this swap - not economically rational
 * }
 * @since 1.0.0
 */
export function getMinSwapValue(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (typeof config.minSwapValue !== 'number' || !Number.isFinite(config.minSwapValue) || config.minSwapValue < 0) {
    throw new Error(`No minimum swap value configured for chain ${chainId}`);
  }

  return config.minSwapValue;
}

/**
 * Get transaction deadline in minutes for a specific chain
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {number} Transaction deadline in minutes - how long before a pending tx expires
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @throws {Error} If no transaction deadline is configured for the chain
 * @example
 * // Get deadline for Arbitrum (fast L2)
 * const deadline = getTransactionDeadlineMinutes(42161);
 * // Returns: 5
 *
 * @example
 * // Get deadline for Ethereum mainnet (slower blocks)
 * const deadline = getTransactionDeadlineMinutes(1);
 * // Returns: 20
 *
 * @example
 * // Use in liquidity operations
 * const deadlineMinutes = getTransactionDeadlineMinutes(chainId);
 * const txData = await adapter.generateRemoveLiquidityData({
 *   ...params,
 *   deadlineMinutes
 * });
 * @since 1.0.0
 */
export function getTransactionDeadlineMinutes(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (typeof config.transactionDeadlineMinutes !== 'number' || !Number.isFinite(config.transactionDeadlineMinutes) || config.transactionDeadlineMinutes <= 0) {
    throw new Error(`No transaction deadline configured for chain ${chainId}`);
  }

  return config.transactionDeadlineMinutes;
}

/**
 * Get maxPriorityFeePerGas for a specific chain (in wei per gas, as a string)
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {string} maxPriorityFeePerGas in wei per gas — pass to ethers.BigNumber.from()
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @throws {Error} If no maxPriorityFeePerGas is configured for the chain
 * @example
 * // Arbitrum — sequencer ignores tips
 * getMaxPriorityFeePerGas(42161); // "0"
 *
 * @example
 * // Avalanche — near-zero tip (1000 wei/gas = 0.000001 gwei)
 * getMaxPriorityFeePerGas(43114); // "1000"
 * @since 2.0.0
 */
export function getMaxPriorityFeePerGas(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (config.maxPriorityFeePerGas === undefined || config.maxPriorityFeePerGas === null) {
    throw new Error(`No maxPriorityFeePerGas configured for chain ${chainId}`);
  }

  return config.maxPriorityFeePerGas;
}
