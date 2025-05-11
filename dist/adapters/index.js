// fum_library/adapters/index.js

/**
 * Adapter system for DeFi platforms
 *
 * This module exports a consistent interface for interacting with
 * different DeFi platforms (Uniswap V3, Sushiswap, etc.) through adapters.
 */

export { default as PlatformAdapter } from './PlatformAdapter.js';
export { default as UniswapV3Adapter } from './UniswapV3Adapter.js';
export { default as AdapterFactory } from './AdapterFactory.js';

// Export a convenience function to get all adapters for a chain
export const getAdaptersForChain = (config, chainId, provider) => {
  return AdapterFactory.getAdaptersForChain(config, chainId, provider);
};

// Export a convenience function to get a specific adapter
export const getAdapter = (config, platformId, provider) => {
  return AdapterFactory.getAdapter(config, platformId, provider);
};

// Export a function to get all supported platforms
export const getSupportedPlatforms = () => {
  return AdapterFactory.getSupportedPlatforms();
};

// Export a function to register a new adapter
export const registerAdapter = (platformId, AdapterClass) => {
  return AdapterFactory.registerAdapter(platformId, AdapterClass);
};
