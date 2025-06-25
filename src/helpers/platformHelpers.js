/**
 * @module helpers/platformHelpers
 * @description Platform configuration utilities for managing DeFi protocol integrations and metadata.
 * Provides functions to query platform information, logos, colors, and chain-specific availability.
 * @since 1.0.0
 */

import platforms from '../configs/platforms.js';
import { getPlatformAddresses } from './chainHelpers.js';

/**
 * Get platform metadata by ID
 * @memberof module:helpers/platformHelpers
 * @param {string} platformId - The platform ID to look up (e.g., 'uniswapV3', 'aaveV3')
 * @returns {Object|null} Platform metadata object containing name, logo, color, features - null if not found
 * @example
 * // Get Uniswap V3 metadata
 * const metadata = getPlatformMetadata('uniswapV3');
 * // Returns: {
 * //   name: "Uniswap V3",
 * //   logo: "https://...",
 * //   color: "#FF007A",
 * //   description: "...",
 * //   features: {...}
 * // }
 * 
 * @example
 * // Handle unknown platform
 * const platform = getPlatformMetadata('unknown');
 * if (!platform) {
 *   console.error('Platform not found');
 * }
 * @since 1.0.0
 */
export function getPlatformMetadata(platformId) {
  if (!platformId || !platforms[platformId]) return null;
  return platforms[platformId];
}

/**
 * Get platform name by ID
 * @memberof module:helpers/platformHelpers
 * @param {string} platformId - The platform ID to look up
 * @returns {string} Human-readable platform name or the ID itself if not found
 * @example
 * // Get known platform name
 * getPlatformName('uniswapV3'); // "Uniswap V3"
 * getPlatformName('aaveV3'); // "Aave V3"
 * 
 * @example
 * // Fallback for unknown platform
 * getPlatformName('unknownPlatform'); // "unknownPlatform"
 * @since 1.0.0
 */
export function getPlatformName(platformId) {
  return platforms[platformId]?.name || platformId;
}

/**
 * Get the primary color for a platform
 * @memberof module:helpers/platformHelpers
 * @param {string} platformId - The platform ID
 * @returns {string} Color hex code for UI theming - defaults to gray (#6c757d) if not defined
 * @example
 * // Get platform brand color
 * const uniswapColor = getPlatformColor('uniswapV3'); // "#FF007A"
 * 
 * @example
 * // Use in component styling
 * const platformStyle = {
 *   backgroundColor: getPlatformColor(platformId),
 *   borderColor: getPlatformColor(platformId)
 * };
 * @since 1.0.0
 */
export function getPlatformColor(platformId) {
  return platforms[platformId]?.color || "#6c757d"; // Default gray
}

/**
 * Get platform logo URL
 * @memberof module:helpers/platformHelpers
 * @param {string} platformId - The platform ID
 * @returns {string|null} URL to platform logo image - null if not found
 * @example
 * // Get platform logo for display
 * const logoUrl = getPlatformLogo('uniswapV3');
 * if (logoUrl) {
 *   return <img src={logoUrl} alt="Uniswap V3" />;
 * }
 * 
 * @example
 * // Fallback to default logo
 * const logo = getPlatformLogo(platformId) || '/images/default-platform.png';
 * @since 1.0.0
 */
export function getPlatformLogo(platformId) {
  return platforms[platformId]?.logo || null;
}

/**
 * Get all available platforms for the current chain
 * @memberof module:helpers/platformHelpers
 * @param {number} chainId - The current chain ID
 * @returns {Array<Object>} Array of platform objects with complete configuration for the chain
 * @example
 * // Get all platforms on Ethereum mainnet
 * const platforms = getAvailablePlatforms(1);
 * // Returns: [
 * //   {
 * //     id: "uniswapV3",
 * //     name: "Uniswap V3",
 * //     factoryAddress: "0x1F98...",
 * //     positionManagerAddress: "0xC365...",
 * //     logo: "https://...",
 * //     color: "#FF007A",
 * //     description: "..."
 * //   },
 * //   ...
 * // ]
 * 
 * @example
 * // Build platform selector
 * const platformOptions = getAvailablePlatforms(chainId).map(platform => ({
 *   value: platform.id,
 *   label: platform.name,
 *   icon: platform.logo
 * }));
 * @since 1.0.0
 */
export function getAvailablePlatforms(chainId) {
  if (!chainId) return [];

  const availablePlatforms = [];

  // Get platform IDs from the chain that are enabled
  for (const platformId in platforms) {
    const platformAddresses = getPlatformAddresses(chainId, platformId);

    // Skip if platform not available on this chain
    if (!platformAddresses) continue;

    const metadata = platforms[platformId];
    if (!metadata) continue;

    availablePlatforms.push({
      id: platformId,
      name: metadata.name || platformId,
      factoryAddress: platformAddresses.factoryAddress,
      positionManagerAddress: platformAddresses.positionManagerAddress,
      logo: metadata.logo,
      color: metadata.color || "#6c757d", // Default gray if no color specified
      description: metadata.description || ""
    });
  }

  return availablePlatforms;
}

/**
 * Get complete platform configuration by ID for a specific chain
 * @memberof module:helpers/platformHelpers
 * @param {string} platformId - The platform ID to look up
 * @param {number} chainId - The current chain ID
 * @returns {Object|null} Combined platform configuration with metadata and addresses - null if not found or not enabled
 * @throws {TypeError} If platformId or chainId are invalid
 * @example
 * // Get complete Uniswap V3 config for Ethereum
 * const uniswap = getPlatformById('uniswapV3', 1);
 * // Returns: {
 * //   id: "uniswapV3",
 * //   name: "Uniswap V3",
 * //   factoryAddress: "0x1F98...",
 * //   positionManagerAddress: "0xC365...",
 * //   logo: "https://...",
 * //   color: "#FF007A",
 * //   description: "...",
 * //   features: { concentrated: true, ... },
 * //   feeTiers: [500, 3000, 10000]
 * // }
 * 
 * @example
 * // Check platform availability before using
 * const platform = getPlatformById(platformId, chainId);
 * if (!platform) {
 *   throw new Error(`Platform ${platformId} not available on chain ${chainId}`);
 * }
 * @since 1.0.0
 */
export function getPlatformById(platformId, chainId) {
  if (!platformId || !chainId) return null;

  // Get platform metadata
  const metadata = getPlatformMetadata(platformId);
  if (!metadata) return null;

  // Get platform addresses for the chain
  const addresses = getPlatformAddresses(chainId, platformId);
  if (!addresses) return null;

  // Combine metadata and addresses
  return {
    id: platformId,
    name: metadata.name || platformId,
    factoryAddress: addresses.factoryAddress,
    positionManagerAddress: addresses.positionManagerAddress,
    logo: metadata.logo,
    color: metadata.color || "#6c757d",
    description: metadata.description || "",
    features: metadata.features || {},
    feeTiers: metadata.feeTiers || []
  };
}

/**
 * Check if a platform supports specific tokens
 * @memberof module:helpers/platformHelpers
 * @param {string} platformId - The platform ID to check
 * @param {Array<string>} tokenSymbols - Array of token symbols to check
 * @param {number} chainId - The current chain ID
 * @returns {boolean} Whether the platform supports all specified tokens
 * @example
 * // Check if Uniswap V3 supports token pair
 * const canTrade = platformSupportsTokens('uniswapV3', ['ETH', 'USDC'], 1);
 * if (!canTrade) {
 *   console.warn('Platform does not support this token pair');
 * }
 * 
 * @example
 * // Filter platforms by token support
 * const supportedPlatforms = getAvailablePlatforms(chainId)
 *   .filter(platform => 
 *     platformSupportsTokens(platform.id, selectedTokens, chainId)
 *   );
 * @todo Implement platform-specific token support logic
 * @since 1.0.0
 */
export function platformSupportsTokens(platformId, tokenSymbols, chainId) {
  // This is a placeholder implementation
  // You should expand this based on your token support logic per platform
  return true;
}

/**
 * Get fee tiers supported by a platform
 * @memberof module:helpers/platformHelpers
 * @param {string} platformId - The platform ID to get fee tiers for
 * @returns {Array<number>} Array of supported fee tiers in basis points - empty array if platform not found
 * @example
 * // Get Uniswap V3 fee tiers
 * const feeTiers = getPlatformFeeTiers('uniswapV3');
 * // Returns: [100, 500, 3000, 10000]
 * 
 * @example
 * // Build fee tier dropdown options
 * const feeOptions = getPlatformFeeTiers(platformId).map(tier => ({
 *   value: tier,
 *   label: `${tier / 100}%`,
 *   description: tier === 500 ? 'Most common' : tier === 3000 ? 'Standard' : ''
 * }));
 * 
 * @example
 * // Automation service checking available pools
 * const supportedFeeTiers = getPlatformFeeTiers('uniswapV3');
 * for (const feeTier of supportedFeeTiers) {
 *   const poolExists = await checkPoolExists(token0, token1, feeTier);
 *   // Process pool...
 * }
 * @since 1.0.0
 */
export function getPlatformFeeTiers(platformId) {
  if (!platformId || !platforms[platformId]) return [];
  return platforms[platformId].feeTiers || [];
}

/**
 * Get all supported platform IDs
 * @memberof module:helpers/platformHelpers
 * @returns {Array<string>} Array of all configured platform IDs
 * @example
 * // Get all platform IDs
 * const platformIds = getSupportedPlatformIds();
 * // Returns: ['uniswapV3', 'aaveV3', 'compoundV3', ...]
 * 
 * @example
 * // Check if a platform is supported
 * const supportedPlatforms = getSupportedPlatformIds();
 * if (!supportedPlatforms.includes(userPlatform)) {
 *   throw new Error('Unsupported platform');
 * }
 * @since 1.0.0
 */
export function getSupportedPlatformIds() {
  return Object.keys(platforms);
}
