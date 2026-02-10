/**
 * Token Configuration Validation Tests
 *
 * Tests to validate the structure and integrity of token configurations
 */

import { describe, it, expect } from 'vitest';
import tokens from '../../../src/configs/tokens.js';
import chains from '../../../src/configs/chains.js';

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
 * Validate decimals value (integer 0-30, covers all realistic ERC20 decimals)
 * @param {any} decimals - Decimals value to validate
 * @returns {boolean} Whether decimals is valid
 */
function validateDecimals(decimals) {
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= 30;
}

/**
 * Validate path format (basic path validation)
 * @param {string} path - Path to validate
 * @returns {boolean} Whether path is valid format
 */
function validatePath(path) {
  if (typeof path !== 'string') return false;
  // Basic path validation - should start with / and contain valid path characters
  return /^\/[a-zA-Z0-9_\-\/\.]+$/.test(path);
}

/**
 * Validate token addresses object
 * @param {string} tokenKey - Token key for error reporting
 * @param {Object} token - Full token object to validate
 * @param {Array<string>} validChainIds - Valid chain IDs from chains config
 * @throws {Error} If addresses are invalid
 */
function validateTokenAddresses(tokenKey, token, validChainIds) {
  const addresses = token.addresses;
  const isNativeToken = token.isNative === true;

  if (!addresses || typeof addresses !== 'object' || Array.isArray(addresses)) {
    throw new Error(`Token ${tokenKey} addresses must be an object`);
  }

  const addressChainIds = Object.keys(addresses);

  // Token must have at least one address
  if (addressChainIds.length === 0) {
    throw new Error(`Token ${tokenKey} must have at least one address`);
  }

  // Check that token only references valid chain IDs (chains in our config)
  addressChainIds.forEach(chainId => {
    if (!validChainIds.includes(chainId)) {
      throw new Error(`Token ${tokenKey} references non-existent chain ID: ${chainId}. Valid: [${validChainIds.join(', ')}]`);
    }
  });

  // Validate each address format
  const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';
  Object.entries(addresses).forEach(([chainId, address]) => {
    // Native tokens (like ETH) use AddressZero
    if (isNativeToken) {
      if (address !== ADDRESS_ZERO) {
        throw new Error(`Native token ${tokenKey} address for chain ${chainId} must be AddressZero, got: ${address}`);
      }
    } else {
      if (!validateEthereumAddress(address)) {
        throw new Error(`Token ${tokenKey} address for chain ${chainId} must be a valid Ethereum address, got: ${address}`);
      }
    }
  });

  // Native tokens must have wethAddresses
  if (isNativeToken) {
    if (!token.wethAddresses || typeof token.wethAddresses !== 'object') {
      throw new Error(`Native token ${tokenKey} must have wethAddresses object`);
    }

    // Validate wethAddresses for native tokens
    Object.entries(token.wethAddresses).forEach(([chainId, address]) => {
      if (!validateEthereumAddress(address)) {
        throw new Error(`Native token ${tokenKey} wethAddress for chain ${chainId} must be a valid Ethereum address, got: ${address}`);
      }
    });
  }
}

describe('Token Configuration Validation', () => {
  it('should have all required properties for every token', () => {
    const requiredStringProperties = ['name', 'symbol', 'displaySymbol', 'coingeckoId', 'logoURI'];
    const requiredNumberProperties = ['decimals'];
    const requiredObjectProperties = ['addresses'];
    const requiredBooleanProperties = ['isStablecoin'];

    const errors = [];

    // Get valid chain IDs from chains config - tokens can support any subset of these
    const validChainIds = Object.keys(chains);

    Object.entries(tokens).forEach(([tokenKey, token]) => {
      const tokenErrors = [];

      // Validate required string properties
      requiredStringProperties.forEach(prop => {
        if (!token[prop] || typeof token[prop] !== 'string' || token[prop].trim() === '') {
          tokenErrors.push(`Missing or empty string property: ${prop}`);
        }
      });

      // Validate required number properties
      requiredNumberProperties.forEach(prop => {
        if (token[prop] === undefined || token[prop] === null) {
          tokenErrors.push(`Missing number property: ${prop}`);
        } else if (prop === 'decimals' && !validateDecimals(token[prop])) {
          tokenErrors.push(`Property decimals must be an integer between 0-30, got: ${token[prop]}`);
        }
      });

      // Validate required object properties
      requiredObjectProperties.forEach(prop => {
        if (!token[prop] || typeof token[prop] !== 'object' || Array.isArray(token[prop])) {
          tokenErrors.push(`Missing or invalid object property: ${prop}`);
        }
      });

      // Validate required boolean properties
      requiredBooleanProperties.forEach(prop => {
        if (typeof token[prop] !== 'boolean') {
          tokenErrors.push(`Property ${prop} must be a boolean, got: ${typeof token[prop]}`);
        }
      });

      // Validate specific format requirements
      if (token.logoURI && !validatePath(token.logoURI)) {
        tokenErrors.push(`Property logoURI must be a valid path format, got: ${token.logoURI}`);
      }

      // Validate token addresses structure and format
      // Note: Tokens don't need to support all chains - they can support any subset
      try {
        validateTokenAddresses(tokenKey, token, validChainIds);
      } catch (error) {
        tokenErrors.push(`addresses validation failed: ${error.message}`);
      }

      // Validate that symbol matches the token key for consistent lookups
      if (token.symbol && tokenKey !== token.symbol) {
        tokenErrors.push(`Symbol "${token.symbol}" must match token key "${tokenKey}" for consistent lookups`);
      }
      
      // Validate displaySymbol is present and reasonable for user display
      if (token.displaySymbol) {
        // displaySymbol should be a clean version without special characters for user interfaces
        if (!/^[A-Z0-9]+$/.test(token.displaySymbol)) {
          tokenErrors.push(`displaySymbol "${token.displaySymbol}" should contain only uppercase letters and numbers for user display`);
        }
      }

      // If there are errors for this token, add them to the main errors array
      if (tokenErrors.length > 0) {
        errors.push(`Token "${tokenKey}" validation errors:`);
        tokenErrors.forEach(error => errors.push(`  - ${error}`));
      }
    });

    // Validate that we have at least one token
    if (Object.keys(tokens).length === 0) {
      errors.push('Tokens configuration cannot be empty');
    }

    // Validate that we have valid chain IDs configured
    if (validChainIds.length === 0) {
      errors.push('No chain IDs found in chains configuration');
    }

    // If there are any validation errors, fail the test with detailed information
    if (errors.length > 0) {
      const errorMessage = `Token configuration validation failed:\n${errors.join('\n')}`;
      throw new Error(errorMessage);
    }

    // If we get here, all tokens are valid
    expect(errors).toHaveLength(0);
  });

  it('should reference only existing chain IDs in addresses', () => {
    const validChainIds = Object.keys(chains).map(id => parseInt(id, 10));
    const errors = [];
    
    Object.entries(tokens).forEach(([tokenSymbol, token]) => {
      if (token.addresses && typeof token.addresses === 'object') {
        Object.keys(token.addresses).forEach(chainIdStr => {
          const chainId = parseInt(chainIdStr, 10);
          if (!validChainIds.includes(chainId)) {
            errors.push(`Token ${tokenSymbol} references non-existent chain ID: ${chainId}`);
          }
        });
      }
    });
    
    if (errors.length > 0) {
      throw new Error(`Chain ID reference errors:\n${errors.join('\n')}`);
    }
    
    expect(errors).toHaveLength(0);
  });
});