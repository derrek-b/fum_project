/**
 * @module platformUtils/PlatformUtilsFactory
 * @description Factory for selecting platform-specific utility modules
 */

import * as UniswapV3Utils from './v3/UniswapV3Utils.js';
import * as UniswapV4Utils from './v4/UniswapV4Utils.js';

/**
 * Map of platform IDs to their utility modules
 */
const PLATFORM_UTILS = {
  uniswapV3: UniswapV3Utils,
  uniswapV4: UniswapV4Utils,
};

/**
 * Factory class for obtaining platform-specific utility functions
 */
export default class PlatformUtilsFactory {
  /**
   * Get the utility module for a specific platform
   * @param {string} platformId - The platform identifier (e.g., 'uniswapV3', 'uniswapV4')
   * @returns {Object} The utility module with platform-specific functions
   * @throws {Error} If no utils are available for the platform
   */
  static getUtils(platformId) {
    const utils = PLATFORM_UTILS[platformId];
    if (!utils) {
      throw new Error(`No utils available for platform: ${platformId}`);
    }
    return utils;
  }

  /**
   * Check if utils are available for a platform
   * @param {string} platformId - The platform identifier
   * @returns {boolean} True if utils exist for this platform
   */
  static hasUtils(platformId) {
    return platformId in PLATFORM_UTILS;
  }

  /**
   * Get list of all supported platforms
   * @returns {string[]} Array of platform identifiers
   */
  static getSupportedPlatforms() {
    return Object.keys(PLATFORM_UTILS);
  }

  /**
   * Register a new platform utils module (for testing or dynamic loading)
   * @param {string} platformId - The platform identifier
   * @param {Object} utilsModule - The utility module to register
   */
  static registerUtils(platformId, utilsModule) {
    PLATFORM_UTILS[platformId] = utilsModule;
  }
}
