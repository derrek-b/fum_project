/**
 * Chain Configuration Validation Tests
 *
 * Tests to validate the structure and integrity of chain configurations
 */

import { describe, it, expect } from 'vitest';
import chains from '../../../src/configs/chains.js';
import platforms from '../../../src/configs/platforms.js';

/**
 * Validate Ethereum address format
 * @param {string} address - Address to validate
 * @returns {boolean} Whether address is valid format
 */
function validateEthereumAddress(address) {
  if (typeof address !== 'string') return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate executor address (valid Ethereum address OR "0x0")
 * @param {string} address - Address to validate
 * @returns {boolean} Whether address is valid
 */
function validateExecutorAddress(address) {
  if (typeof address !== 'string') return false;
  return address === '0x0' || validateEthereumAddress(address);
}

/**
 * Validate URL format (HTTP or HTTPS)
 * @param {string} url - URL to validate
 * @returns {boolean} Whether URL is valid format
 */
function validateURL(url) {
  if (typeof url !== 'string') return false;
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate chain ID (positive integer)
 * @param {any} chainId - Chain ID to validate
 * @returns {boolean} Whether chain ID is valid
 */
function validateChainId(chainId) {
  const num = Number(chainId);
  return Number.isInteger(num) && num > 0;
}

/**
 * Validate native currency object structure
 * @param {string} chainId - Chain ID for error reporting
 * @param {Object} nativeCurrency - Native currency object to validate
 * @throws {Error} If native currency is invalid
 */
function validateNativeCurrency(chainId, nativeCurrency) {
  if (!nativeCurrency || typeof nativeCurrency !== 'object' || Array.isArray(nativeCurrency)) {
    throw new Error(`Chain ${chainId} nativeCurrency must be an object`);
  }

  // Validate name
  if (!nativeCurrency.name || typeof nativeCurrency.name !== 'string' || nativeCurrency.name.trim() === '') {
    throw new Error(`Chain ${chainId} nativeCurrency.name must be a non-empty string`);
  }

  // Validate symbol
  if (!nativeCurrency.symbol || typeof nativeCurrency.symbol !== 'string' || nativeCurrency.symbol.trim() === '') {
    throw new Error(`Chain ${chainId} nativeCurrency.symbol must be a non-empty string`);
  }

  // Validate decimals
  if (!Number.isInteger(nativeCurrency.decimals) || nativeCurrency.decimals < 0) {
    throw new Error(`Chain ${chainId} nativeCurrency.decimals must be a non-negative integer`);
  }
}

/**
 * Platform-specific required addresses
 * Each platform may have different contract requirements
 */
const REQUIRED_PLATFORM_ADDRESSES = {
  uniswapV3: ['factoryAddress', 'positionManagerAddress', 'routerAddress', 'universalRouterAddress', 'quoterAddress'],
  // Add more platforms as they are implemented:
  // sushiswap: ['factoryAddress', 'positionManagerAddress', 'routerAddress'],
};

/**
 * Validate platform addresses structure
 * @param {string} chainId - Chain ID for error reporting
 * @param {Object} platformAddresses - Platform addresses object to validate
 * @throws {Error} If platform addresses structure is invalid
 */
function validatePlatformAddresses(chainId, platformAddresses) {
  if (!platformAddresses || typeof platformAddresses !== 'object' || Array.isArray(platformAddresses)) {
    throw new Error(`Chain ${chainId} platformAddresses must be an object`);
  }

  // Validate each platform
  Object.entries(platformAddresses).forEach(([platformId, platformConfig]) => {
    if (!platformConfig || typeof platformConfig !== 'object' || Array.isArray(platformConfig)) {
      throw new Error(`Chain ${chainId} platformAddresses.${platformId} must be an object`);
    }

    // Get platform-specific required addresses
    const requiredAddresses = REQUIRED_PLATFORM_ADDRESSES[platformId];
    if (!requiredAddresses) {
      throw new Error(`Chain ${chainId} references platform ${platformId} which has no defined address requirements`);
    }

    // Validate required address properties for this platform
    requiredAddresses.forEach(addressProp => {
      if (!platformConfig[addressProp] || !validateEthereumAddress(platformConfig[addressProp])) {
        throw new Error(`Chain ${chainId} platformAddresses.${platformId}.${addressProp} must be a valid Ethereum address`);
      }
    });

    // Validate enabled property
    if (typeof platformConfig.enabled !== 'boolean') {
      throw new Error(`Chain ${chainId} platformAddresses.${platformId}.enabled must be a boolean`);
    }
  });
}

describe('Chain Configuration Validation', () => {
  it('should have all required properties for every chain', () => {
    const requiredStringProperties = ['name'];
    const requiredArrayProperties = ['rpcUrls', 'blockExplorerUrls'];
    const requiredObjectProperties = ['nativeCurrency', 'platformAddresses'];
    const requiredExecutorProperties = ['executorAddress'];
    const requiredNumberProperties = ['minDeploymentForGas'];
    // Note: envPK and executorEnvPK can be null/undefined (environment variables)

    const errors = [];

    Object.entries(chains).forEach(([chainId, chain]) => {
      const chainErrors = [];

      // Validate chain ID format
      if (!validateChainId(chainId)) {
        chainErrors.push(`Chain ID '${chainId}' must be a positive integer`);
      }

      // Validate required string properties
      requiredStringProperties.forEach(prop => {
        if (!chain[prop] || typeof chain[prop] !== 'string' || chain[prop].trim() === '') {
          chainErrors.push(`Missing or empty string property: ${prop}`);
        }
      });

      // Validate required array properties
      requiredArrayProperties.forEach(prop => {
        if (!Array.isArray(chain[prop]) || chain[prop].length === 0) {
          chainErrors.push(`Property ${prop} must be a non-empty array`);
        } else {
          // Validate each URL in the array
          chain[prop].forEach((url, index) => {
            if (!validateURL(url)) {
              chainErrors.push(`Property ${prop}[${index}] must be a valid HTTP/HTTPS URL, got: ${url}`);
            }
          });
        }
      });

      // Validate required object properties
      requiredObjectProperties.forEach(prop => {
        if (!chain[prop] || typeof chain[prop] !== 'object' || Array.isArray(chain[prop])) {
          chainErrors.push(`Missing or invalid object property: ${prop}`);
        }
      });

      // Validate executor address
      requiredExecutorProperties.forEach(prop => {
        if (!validateExecutorAddress(chain[prop])) {
          chainErrors.push(`Property ${prop} must be a valid Ethereum address or '0x0', got: ${chain[prop]}`);
        }
      });

      // Validate required number properties
      requiredNumberProperties.forEach(prop => {
        if (typeof chain[prop] !== 'number' || !Number.isFinite(chain[prop]) || chain[prop] <= 0) {
          chainErrors.push(`Property ${prop} must be a positive finite number, got: ${chain[prop]}`);
        }
      });

      // Validate native currency structure
      try {
        validateNativeCurrency(chainId, chain.nativeCurrency);
      } catch (error) {
        chainErrors.push(`nativeCurrency validation failed: ${error.message}`);
      }

      // Validate platform addresses structure
      try {
        validatePlatformAddresses(chainId, chain.platformAddresses);
      } catch (error) {
        chainErrors.push(`platformAddresses validation failed: ${error.message}`);
      }

      // Note: envPK and executorEnvPK are environment variables and can be null/undefined
      // No validation needed for these as they're set at runtime

      // If there are errors for this chain, add them to the main errors array
      if (chainErrors.length > 0) {
        errors.push(`Chain "${chainId}" validation errors:`);
        chainErrors.forEach(error => errors.push(`  - ${error}`));
      }
    });

    // If there are any validation errors, fail the test with detailed information
    if (errors.length > 0) {
      const errorMessage = `Chain configuration validation failed:\n${errors.join('\n')}`;
      throw new Error(errorMessage);
    }

    // If we get here, all chains are valid
    expect(errors).toHaveLength(0);
  });

  it('should reference only existing platforms in platformAddresses', () => {
    const platformKeys = Object.keys(platforms);
    const errors = [];

    Object.entries(chains).forEach(([chainId, chain]) => {
      if (chain.platformAddresses && typeof chain.platformAddresses === 'object') {
        Object.keys(chain.platformAddresses).forEach(platformId => {
          if (!platformKeys.includes(platformId)) {
            errors.push(`Chain ${chainId} references non-existent platform: ${platformId}`);
          }
        });
      }
    });

    if (errors.length > 0) {
      throw new Error(`Platform reference errors:\n${errors.join('\n')}`);
    }

    expect(errors).toHaveLength(0);
  });

  it('should have all platforms in REQUIRED_PLATFORM_ADDRESSES defined in platforms config', () => {
    const platformKeys = Object.keys(platforms);
    const requiredPlatformKeys = Object.keys(REQUIRED_PLATFORM_ADDRESSES);
    const errors = [];

    requiredPlatformKeys.forEach(platformId => {
      if (!platformKeys.includes(platformId)) {
        errors.push(`Platform ${platformId} is defined in REQUIRED_PLATFORM_ADDRESSES but not in platforms config`);
      }
    });

    if (errors.length > 0) {
      throw new Error(`Platform configuration errors:\n${errors.join('\n')}`);
    }

    expect(errors).toHaveLength(0);
  });
});