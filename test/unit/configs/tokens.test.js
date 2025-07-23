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
 * @param {Object} addresses - Addresses object to validate
 * @param {Array<string>} expectedChainIds - Expected chain IDs for consistency
 * @throws {Error} If addresses are invalid
 */
function validateTokenAddresses(tokenKey, addresses, expectedChainIds) {
  if (!addresses || typeof addresses !== 'object' || Array.isArray(addresses)) {
    throw new Error(`Token ${tokenKey} addresses must be an object`);
  }

  const addressChainIds = Object.keys(addresses);
  
  // Check that all expected chain IDs are present
  expectedChainIds.forEach(chainId => {
    if (!addressChainIds.includes(chainId)) {
      throw new Error(`Token ${tokenKey} missing address for chain ID: ${chainId}`);
    }
  });

  // Check that no extra chain IDs are present
  addressChainIds.forEach(chainId => {
    if (!expectedChainIds.includes(chainId)) {
      throw new Error(`Token ${tokenKey} has unexpected chain ID: ${chainId}. Expected: [${expectedChainIds.join(', ')}]`);
    }
  });

  // Validate each address format
  Object.entries(addresses).forEach(([chainId, address]) => {
    if (!validateEthereumAddress(address)) {
      throw new Error(`Token ${tokenKey} address for chain ${chainId} must be a valid Ethereum address, got: ${address}`);
    }
  });
}

describe('Token Configuration Validation', () => {
  it('should have all required properties for every token', () => {
    const requiredStringProperties = ['name', 'symbol', 'coingeckoId', 'logoURI'];
    const requiredNumberProperties = ['decimals'];
    const requiredObjectProperties = ['addresses'];
    const requiredBooleanProperties = ['isStablecoin'];

    const errors = [];

    // First pass: collect all chain IDs from all tokens to ensure consistency
    const allChainIds = new Set();
    Object.values(tokens).forEach(token => {
      if (token.addresses && typeof token.addresses === 'object') {
        Object.keys(token.addresses).forEach(chainId => allChainIds.add(chainId));
      }
    });
    const expectedChainIds = Array.from(allChainIds).sort();

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

      // Validate token addresses structure and consistency
      try {
        validateTokenAddresses(tokenKey, token.addresses, expectedChainIds);
      } catch (error) {
        tokenErrors.push(`addresses validation failed: ${error.message}`);
      }

      // Validate that symbol matches or is a reasonable variant of the token key
      // Note: We allow for cases like key="USD₮0" with symbol="USDT"
      if (token.symbol && tokenKey !== token.symbol) {
        // This is informational - some tokens have different keys vs symbols
        // e.g., "USD₮0" key with "USDT" symbol
        // Just ensure symbol is not empty, which we already check above
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

    // Validate chain ID consistency across all tokens
    if (expectedChainIds.length === 0) {
      errors.push('No chain IDs found in any token addresses');
    } else {
      // Report the chain IDs for informational purposes
      const chainIdInfo = `Expected chain IDs across all tokens: [${expectedChainIds.join(', ')}]`;
      // This is just informational, not an error
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