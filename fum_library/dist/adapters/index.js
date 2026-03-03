// fum_library/adapters/index.js

/**
 * Adapter system for DeFi platforms
 *
 * This module exports a consistent interface for interacting with
 * different DeFi platforms (Uniswap V3, Sushiswap, etc.) through adapters.
 */

import AdapterFactory from './AdapterFactory.js';

export { default as PlatformAdapter } from './PlatformAdapter.js';
export { default as UniswapV3Adapter } from './UniswapV3Adapter.js';
export { default as UniswapV4Adapter } from './UniswapV4Adapter.js';
export { default as TraderJoeV2_2Adapter } from './TraderJoeV2_2Adapter.js';
export { AdapterFactory };

// Export a convenience function to get all adapters for a chain
export const getAdaptersForChain = (chainId) => {
  return AdapterFactory.getAdaptersForChain(chainId);
};

// Export a convenience function to get a specific adapter
export const getAdapter = (platformId, chainId) => {
  return AdapterFactory.getAdapter(platformId, chainId);
};

// Export a function to get all supported platforms
export const getSupportedPlatforms = () => {
  return AdapterFactory.getSupportedPlatforms();
};

// Export a function to register a new adapter
export const registerAdapter = (platformId, AdapterClass) => {
  return AdapterFactory.registerAdapter(platformId, AdapterClass);
};
