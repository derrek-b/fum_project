// src/helpers/platformHelpers.js
import platforms from '../configs/platforms.js';
import { getPlatformAddresses } from './chainHelpers.js';

/**
 * Get platform metadata by ID
 * @param {string} platformId - The platform ID to look up
 * @returns {Object|null} Platform metadata or null if not found
 */
export function getPlatformMetadata(platformId) {
  if (!platformId || !platforms[platformId]) return null;
  return platforms[platformId];
}

/**
 * Get platform name by ID
 * @param {string} platformId - The platform ID to look up
 * @returns {string} Platform name or the ID if not found
 */
export function getPlatformName(platformId) {
  return platforms[platformId]?.name || platformId;
}

/**
 * Get the primary color for a platform
 * @param {string} platformId - The platform ID
 * @returns {string} Color hex code
 */
export function getPlatformColor(platformId) {
  return platforms[platformId]?.color || "#6c757d"; // Default gray
}

/**
 * Get platform logo URL
 * @param {string} platformId - The platform ID
 * @returns {string|null} Logo URL or null if not found
 */
export function getPlatformLogo(platformId) {
  return platforms[platformId]?.logo || null;
}

/**
 * Get all available platforms for the current chain
 * @param {number} chainId - The current chain ID
 * @returns {Array} Array of platform objects with id, name, and metadata
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
 * @param {string} platformId - The platform ID to look up
 * @param {number} chainId - The current chain ID
 * @returns {Object|null} Combined platform config or null if not found
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
 * @param {string} platformId - The platform ID to check
 * @param {Array} tokenSymbols - Array of token symbols to check
 * @param {number} chainId - The current chain ID
 * @returns {boolean} Whether the platform supports all tokens
 */
export function platformSupportsTokens(platformId, tokenSymbols, chainId) {
  // This is a placeholder implementation
  // You should expand this based on your token support logic per platform
  return true;
}

/**
 * Get all supported platform IDs
 * @returns {Array<string>} Array of supported platform IDs
 */
export function getSupportedPlatformIds() {
  return Object.keys(platforms);
}
