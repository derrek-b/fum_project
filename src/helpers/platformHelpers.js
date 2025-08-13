/**
 * @module helpers/platformHelpers
 * @description Platform configuration utilities for managing DeFi protocol integrations and metadata.
 * Provides functions to query platform information, logos, colors, and chain-specific availability.
 * @since 1.0.0
 */

import platforms from '../configs/platforms.js';
import { getPlatformAddresses } from './chainHelpers.js';

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
 * Validate platformId parameter using established validation pattern
 * @param {any} platformId - The value to validate as a platformId
 * @throws {Error} If platformId is not a valid string
 */
export function validatePlatformId(platformId) {
  if (platformId === null || platformId === undefined) {
    throw new Error('platformId parameter is required');
  }

  if (typeof platformId !== 'string') {
    throw new Error('platformId must be a string');
  }

  if (platformId === '') {
    throw new Error('platformId cannot be empty');
  }
}

/**
 * Get platform metadata by ID
 * @memberof module:helpers/platformHelpers
 * @param {string} platformId - The platform ID to look up (e.g., 'uniswapV3', 'aaveV3')
 * @returns {Object} Platform metadata object containing name, logo, color, features
 * @throws {Error} If platformId is not valid (null, undefined, not a string, or empty)
 * @throws {Error} If platform is not supported
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
 * // Throws: Error: Platform unknown is not supported
 * @since 1.0.0
 */
export function getPlatformMetadata(platformId) {
  validatePlatformId(platformId);

  const metadata = platforms[platformId];
  if (!metadata) {
    throw new Error(`Platform ${platformId} is not supported`);
  }

  return metadata;
}

/**
 * Get platform name by ID
 * @memberof module:helpers/platformHelpers
 * @param {string} platformId - The platform ID to look up
 * @returns {string} Human-readable platform name
 * @throws {Error} If platformId is not valid (null, undefined, not a string, or empty)
 * @throws {Error} If platform is not supported
 * @throws {Error} If platform name is not configured or is empty
 * @example
 * // Get known platform name
 * getPlatformName('uniswapV3'); // "Uniswap V3"
 * getPlatformName('aaveV3'); // "Aave V3"
 *
 * @example
 * // Unknown platform throws error
 * getPlatformName('unknownPlatform'); // Throws: Error: Platform unknownPlatform is not supported
 *
 * @example
 * // Platform without name throws error
 * getPlatformName('platformWithoutName'); // Throws: Error: Platform platformWithoutName name not configured
 * @since 1.0.0
 */
export function getPlatformName(platformId) {
  validatePlatformId(platformId);

  const platform = platforms[platformId];
  if (!platform) {
    throw new Error(`Platform ${platformId} is not supported`);
  }

  if (!platform.name || platform.name === '') {
    throw new Error(`Platform ${platformId} name not configured`);
  }

  return platform.name;
}

/**
 * Get the primary color for a platform
 * @memberof module:helpers/platformHelpers
 * @param {string} platformId - The platform ID
 * @returns {string} Color hex code for UI theming
 * @throws {Error} If platformId is not valid (null, undefined, not a string, or empty)
 * @throws {Error} If platform is not supported
 * @throws {Error} If platform color is not configured or is empty
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
 *
 * @example
 * // Unknown platform throws error
 * getPlatformColor('unknownPlatform'); // Throws: Error: Platform unknownPlatform is not supported
 *
 * @example
 * // Platform without color throws error
 * getPlatformColor('platformWithoutColor'); // Throws: Error: Platform platformWithoutColor color not configured
 * @since 1.0.0
 */
export function getPlatformColor(platformId) {
  validatePlatformId(platformId);

  const platform = platforms[platformId];
  if (!platform) {
    throw new Error(`Platform ${platformId} is not supported`);
  }

  if (!platform.color || platform.color === '') {
    throw new Error(`Platform ${platformId} color not configured`);
  }

  return platform.color;
}

/**
 * Get platform logo URL
 * @memberof module:helpers/platformHelpers
 * @param {string} platformId - The platform ID
 * @returns {string} URL to platform logo image
 * @throws {Error} If platformId is not valid (null, undefined, not a string, or empty)
 * @throws {Error} If platform is not supported
 * @throws {Error} If platform logo is not configured or is empty
 * @example
 * // Get platform logo for display
 * const logoUrl = getPlatformLogo('uniswapV3');
 * // Returns: "/Platform_Logos/uniswap.svg"
 * // return <img src={logoUrl} alt="Uniswap V3" />;
 *
 * @example
 * // Unknown platform throws error
 * getPlatformLogo('unknownPlatform'); // Throws: Error: Platform unknownPlatform is not supported
 *
 * @example
 * // Platform without logo throws error
 * getPlatformLogo('platformWithoutLogo'); // Throws: Error: Platform platformWithoutLogo logo not configured
 * @since 1.0.0
 */
export function getPlatformLogo(platformId) {
  validatePlatformId(platformId);

  const platform = platforms[platformId];
  if (!platform) {
    throw new Error(`Platform ${platformId} is not supported`);
  }

  if (!platform.logo || platform.logo === '') {
    throw new Error(`Platform ${platformId} logo not configured`);
  }

  return platform.logo;
}

/**
 * Get fee tiers supported by a platform
 * @memberof module:helpers/platformHelpers
 * @param {string} platformId - The platform ID to get fee tiers for
 * @returns {Array<number>} Array of supported fee tiers in basis points
 * @throws {Error} If platformId is not valid (null, undefined, not a string, or empty)
 * @throws {Error} If platform is not supported
 * @throws {Error} If platform feeTiers are not configured or invalid
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
 *
 * @example
 * // Unknown platform throws error
 * getPlatformFeeTiers('unknownPlatform'); // Throws: Error: Platform unknownPlatform is not supported
 *
 * @example
 * // Platform without feeTiers throws error
 * getPlatformFeeTiers('platformWithoutFeeTiers'); // Throws: Error: Platform platformWithoutFeeTiers feeTiers not configured
 * @since 1.0.0
 */
export function getPlatformFeeTiers(platformId) {
  validatePlatformId(platformId);

  const platform = platforms[platformId];
  if (!platform) {
    throw new Error(`Platform ${platformId} is not supported`);
  }

  if (!platform.feeTiers || typeof platform.feeTiers !== 'object' || Array.isArray(platform.feeTiers)) {
    throw new Error(`Platform ${platformId} feeTiers not configured`);
  }

  const feeArray = Object.keys(platform.feeTiers).map(Number);
  if (feeArray.length === 0) {
    throw new Error(`Platform ${platformId} feeTiers not configured`);
  }

  return feeArray;
}

/**
 * Get tick spacing for a specific fee tier on a platform
 * @param {string} platformId - Platform identifier (e.g., 'uniswapV3')
 * @param {number} fee - Fee tier in basis points (e.g., 500)
 * @returns {number} Tick spacing for the fee tier
 * @throws {Error} If platform is not supported, feeTiers not configured, or fee tier not found
 * @example
 * const spacing = getPlatformTickSpacing('uniswapV3', 500);
 * // Returns: 10
 * @since 1.0.0
 */
export function getPlatformTickSpacing(platformId, fee) {
  validatePlatformId(platformId);

  if (!Number.isFinite(fee)) {
    throw new Error(`Invalid fee: ${fee}. Must be a finite number.`);
  }

  const platform = platforms[platformId];
  if (!platform) {
    throw new Error(`Platform ${platformId} is not supported`);
  }

  if (!platform.feeTiers || typeof platform.feeTiers !== 'object' || Array.isArray(platform.feeTiers)) {
    throw new Error(`Platform ${platformId} feeTiers not configured`);
  }

  const feeConfig = platform.feeTiers[fee];
  if (!feeConfig || typeof feeConfig.spacing !== 'number') {
    const availableFees = Object.keys(platform.feeTiers).join(', ');
    throw new Error(`Invalid fee tier: ${fee}. Must be one of: ${availableFees}`);
  }

  return feeConfig.spacing;
}

/**
 * Get tick bounds for a platform
 * @param {string} platformId - Platform identifier (e.g., 'uniswapV3')
 * @returns {{minTick: number, maxTick: number}} Tick bounds for the platform
 * @throws {Error} If platform is not supported or tick bounds not configured
 * @example
 * const bounds = getPlatformTickBounds('uniswapV3');
 * // Returns: { minTick: -887272, maxTick: 887272 }
 * @since 1.0.0
 */
export function getPlatformTickBounds(platformId) {
  validatePlatformId(platformId);

  const platform = platforms[platformId];
  if (!platform) {
    throw new Error(`Platform ${platformId} is not supported`);
  }

  if (!Number.isFinite(platform.minTick) || !Number.isFinite(platform.maxTick)) {
    throw new Error(`Platform ${platformId} tick bounds not configured`);
  }

  if (platform.minTick >= platform.maxTick) {
    throw new Error(`Platform ${platformId} invalid tick bounds: minTick must be less than maxTick`);
  }

  return {
    minTick: platform.minTick,
    maxTick: platform.maxTick
  };
}

/**
 * Get all available platforms for the current chain
 * @memberof module:helpers/platformHelpers
 * @param {number} chainId - The current chain ID
 * @returns {Array<Object>} Array of platform objects with complete configuration for the chain
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If chain is not supported
 * @throws {Error} If no platform addresses are configured for the chain
 * @throws {Error} If platform metadata is missing required properties
 * @example
 * // Get all platforms on Ethereum mainnet
 * const platforms = getAvailablePlatforms(1);
 * // Returns: [
 * //   {
 * //     id: "uniswapV3",
 * //     name: "Uniswap V3",
 * //     factoryAddress: "0x1F98...",
 * //     positionManagerAddress: "0xC365...",
 * //     routerAddress: "0xE592...",
 * //     quoterAddress: "0x61fF...",
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
  validateChainId(chainId);

  const availablePlatforms = [];

  // Get platform IDs from the chain that are enabled
  for (const platformId in platforms) {
    const platformAddresses = getPlatformAddresses(chainId, platformId);

    // Skip if platform not available on this chain (business logic - disabled or not configured for chain)
    if (!platformAddresses) continue;

    const metadata = platforms[platformId];
    if (!metadata) {
      throw new Error(`Platform ${platformId} metadata not found`);
    }

    // Validate required metadata properties
    if (!metadata.name || metadata.name === '') {
      throw new Error(`Platform ${platformId} name not configured`);
    }

    if (!metadata.logo || metadata.logo === '') {
      throw new Error(`Platform ${platformId} logo not configured`);
    }

    if (!metadata.color || metadata.color === '') {
      throw new Error(`Platform ${platformId} color not configured`);
    }

    if (!metadata.description || metadata.description === '') {
      throw new Error(`Platform ${platformId} description not configured`);
    }

    availablePlatforms.push({
      id: platformId,
      name: metadata.name,
      factoryAddress: platformAddresses.factoryAddress,
      positionManagerAddress: platformAddresses.positionManagerAddress,
      routerAddress: platformAddresses.routerAddress,
      quoterAddress: platformAddresses.quoterAddress,
      logo: metadata.logo,
      color: metadata.color,
      description: metadata.description
    });
  }

  return availablePlatforms;
}

/**
 * Lookup complete platform configuration by ID for a specific chain
 * @memberof module:helpers/platformHelpers
 * @param {string} platformId - The platform ID to look up
 * @param {number} chainId - The current chain ID
 * @returns {Object|null} Combined platform configuration with metadata and addresses - null if not found or not enabled
 * @throws {Error} If platformId is not valid (null, undefined, not a string, or empty)
 * @throws {Error} If chainId is not valid (null, undefined, not a number, not finite, not an integer, or <= 0)
 * @throws {Error} If platform metadata properties are missing or invalid (name, logo, color, description, features, feeTiers)
 * @example
 * // Lookup complete Uniswap V3 config for Ethereum
 * const uniswap = lookupPlatformById('uniswapV3', 1);
 * // Returns: {
 * //   id: "uniswapV3",
 * //   name: "Uniswap V3",
 * //   factoryAddress: "0x1F98...",
 * //   positionManagerAddress: "0xC365...",
 * //   routerAddress: "0xE592...",
 * //   quoterAddress: "0x61fF...",
 * //   logo: "https://...",
 * //   color: "#FF007A",
 * //   description: "...",
 * //   features: { concentrated: true, ... },
 * //   feeTiers: [500, 3000, 10000]
 * // }
 *
 * @example
 * // Check platform availability before using
 * const platform = lookupPlatformById(platformId, chainId);
 * if (!platform) {
 *   throw new Error(`Platform ${platformId} not available on chain ${chainId}`);
 * }
 * @since 1.0.0
 */
export function lookupPlatformById(platformId, chainId) {
  validatePlatformId(platformId);
  validateChainId(chainId);

  // Get platform metadata
  const metadata = getPlatformMetadata(platformId);

  // Get platform addresses for the chain
  let addresses;
  try {
    addresses = getPlatformAddresses(chainId, platformId);
  } catch (error) {
    // Only return null for "platform not configured" errors (business logic)
    if (error.message.includes('not configured for chain')) {
      return null;
    }
    // Re-throw all other errors (chain not supported, no platform addresses, etc.)
    throw error;
  }
  if (!addresses) return null;

  // Validate required metadata properties
  if (!metadata.name || metadata.name === '') {
    throw new Error(`Platform ${platformId} name not configured`);
  }

  if (!metadata.logo || metadata.logo === '') {
    throw new Error(`Platform ${platformId} logo not configured`);
  }

  if (!metadata.color || metadata.color === '') {
    throw new Error(`Platform ${platformId} color not configured`);
  }

  if (!metadata.description || metadata.description === '') {
    throw new Error(`Platform ${platformId} description not configured`);
  }

  if (!metadata.features || typeof metadata.features !== 'object' || Array.isArray(metadata.features)) {
    throw new Error(`Platform ${platformId} features not configured`);
  }

  // Validate feeTiers using our helper (which validates the object format)
  const feeTiersArray = getPlatformFeeTiers(platformId);

  // Combine metadata and addresses
  return {
    id: platformId,
    name: metadata.name,
    factoryAddress: addresses.factoryAddress,
    positionManagerAddress: addresses.positionManagerAddress,
    routerAddress: addresses.routerAddress,
    quoterAddress: addresses.quoterAddress,
    logo: metadata.logo,
    color: metadata.color,
    description: metadata.description,
    features: metadata.features,
    feeTiers: feeTiersArray
  };
}

/**
 * Lookup all supported platform IDs
 * @memberof module:helpers/platformHelpers
 * @returns {Array<string>} Array of all configured platform IDs
 * @example
 * // Lookup all platform IDs
 * const platformIds = lookupSupportedPlatformIds();
 * // Returns: ['uniswapV3', 'aaveV3', 'compoundV3', ...]
 *
 * @example
 * // Check if a platform is supported
 * const supportedPlatforms = lookupSupportedPlatformIds();
 * if (!supportedPlatforms.includes(userPlatform)) {
 *   throw new Error('Unsupported platform');
 * }
 * @since 1.0.0
 */
export function lookupSupportedPlatformIds() {
  return Object.keys(platforms);
}
