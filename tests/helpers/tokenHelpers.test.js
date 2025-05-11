import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { newToken } from '../mocks/tokenData.js';
import tokens from '../../src/configs/tokens.js';

// Using the real tokens config (not mocking)

// Import after the mock is set up
import {
  getAllTokens,
  getTokenBySymbol,
  getTokenAddress,
  getStablecoins,
  areTokensSupportedOnChain,
  getTokenByAddress,
  registerToken,
  getTokensForChain,
  getAllTokenSymbols,
  getTokensByType
} from '../../src/helpers/tokenHelpers.js';

describe('tokenHelpers', () => {
  describe('getAllTokens', () => {
    it('should return all tokens', () => {
      const allTokens = getAllTokens();
      expect(Object.keys(allTokens)).toHaveLength(6); // USDC, WETH, DAI, USDT, FRAX, BUSD

      // Verify all expected tokens exist
      expect(allTokens).toHaveProperty('USDC');
      expect(allTokens).toHaveProperty('WETH');
      expect(allTokens).toHaveProperty('DAI');
      expect(allTokens).toHaveProperty('USDT');
      expect(allTokens).toHaveProperty('FRAX');
      expect(allTokens).toHaveProperty('BUSD');
    });
  });

  describe('getTokenBySymbol', () => {
    it('should return the token for a valid symbol', () => {
      const token = getTokenBySymbol('USDC');
      expect(token).toEqual(tokens['USDC']);
    });

    it('should return null for an invalid symbol', () => {
      const token = getTokenBySymbol('INVALID');
      expect(token).toBeNull();
    });
  });

  describe('getTokenAddress', () => {
    it('should return the address for a valid token and chain', () => {
      const address = getTokenAddress('USDC', 1); // Ethereum
      expect(address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    });

    it('should return null for an invalid token', () => {
      const address = getTokenAddress('INVALID', 1);
      expect(address).toBeNull();
    });

    it('should return null for a valid token on an unsupported chain', () => {
      // Using a chain ID that doesn't exist in our tokens
      const address = getTokenAddress('USDT', 56); // BSC chain ID
      expect(address).toBeNull();
    });
  });

  describe('getStablecoins', () => {
    it('should return only stablecoins', () => {
      const stablecoins = getStablecoins();
      expect(stablecoins).toHaveLength(5); // USDC, DAI, USDT, FRAX, BUSD
      stablecoins.forEach(token => {
        expect(token.isStablecoin).toBe(true);
      });
    });
  });

  describe('areTokensSupportedOnChain', () => {
    it('should return true when all tokens are supported on the chain', () => {
      const areSupported = areTokensSupportedOnChain(['USDC', 'WETH', 'DAI'], 42161); // Arbitrum
      expect(areSupported).toBe(true);
    });

    it('should return false when at least one token is not supported on the chain', () => {
      // Test with BSC chain (56) which is not in our tokens config
      const areSupported = areTokensSupportedOnChain(['USDC', 'USDT'], 56);
      expect(areSupported).toBe(false);
    });

    it('should return false for invalid tokens', () => {
      const areSupported = areTokensSupportedOnChain(['USDC', 'INVALID'], 1);
      expect(areSupported).toBe(false);
    });
  });

  describe('getTokenByAddress', () => {
    it('should return the token for a valid address and chain', () => {
      const token = getTokenByAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 1); // USDC on Ethereum
      expect(token).toEqual(tokens['USDC']);
    });

    it('should handle case-insensitive address matching', () => {
      const token = getTokenByAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 1); // lowercase
      expect(token).toEqual(tokens['USDC']);
    });

    it('should return null for an invalid address', () => {
      const token = getTokenByAddress('0xInvalidAddress', 1);
      expect(token).toBeNull();
    });

    it('should return null when address or chainId are missing', () => {
      expect(getTokenByAddress(null, 1)).toBeNull();
      expect(getTokenByAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', null)).toBeNull();
    });
  });

  describe('registerToken', () => {
    // Store the original tokens object for restoration
    let originalTokens;
    
    beforeEach(() => {
      originalTokens = { ...getAllTokens() };
    });
    
    afterEach(() => {
      // Reset mock tokens to original state
      vi.resetModules();
    });

    it('should register a new token', () => {
      const result = registerToken(newToken);
      expect(result).toBe(true);
      
      const registeredToken = getTokenBySymbol('ARB');
      expect(registeredToken).toEqual(newToken);
    });

    it('should update an existing token', () => {
      const updatedToken = {
        ...tokens['USDC'],
        name: "Updated USD Coin"
      };
      
      const result = registerToken(updatedToken);
      expect(result).toBe(true);
      
      const token = getTokenBySymbol('USDC');
      expect(token.name).toBe("Updated USD Coin");
    });

    it('should return false for invalid token input', () => {
      expect(registerToken(null)).toBe(false);
      expect(registerToken({})).toBe(false);
      expect(registerToken({ name: "No Symbol" })).toBe(false);
    });
  });

  describe('getTokensForChain', () => {
    it('should return tokens available on a specific chain', () => {
      const tokens = getTokensForChain(42161); // Arbitrum
      expect(tokens).toHaveLength(7); // All tokens with Arbitrum addresses

      // Verify specific tokens are present
      const symbols = tokens.map(token => token.symbol);
      expect(symbols).toContain('USDC');
      expect(symbols).toContain('WETH');
      expect(symbols).toContain('DAI');

      // Verify each token has an address for Arbitrum
      tokens.forEach(token => {
        expect(token.addresses[42161]).toBeDefined();
      });
    });

    it('should return an empty array for an unsupported chain', () => {
      const tokens = getTokensForChain(56); // BSC, not in our mock
      expect(tokens).toEqual([]);
    });

    it('should return an empty array when chainId is missing', () => {
      expect(getTokensForChain(null)).toEqual([]);
      expect(getTokensForChain(undefined)).toEqual([]);
    });
  });

  describe('getAllTokenSymbols', () => {
    it('should return all token symbols', () => {
      const symbols = getAllTokenSymbols();
      expect(symbols).toHaveLength(7); // Total number of tokens in the config

      // Verify expected tokens are present
      expect(symbols).toContain('USDC');
      expect(symbols).toContain('WETH');
      expect(symbols).toContain('DAI');
      expect(symbols).toContain('USDT');
      expect(symbols).toContain('FRAX');
      expect(symbols).toContain('BUSD');
    });
  });

  describe('getTokensByType', () => {
    it('should return stablecoins when isStablecoin is true', () => {
      const stablecoins = getTokensByType(true);
      expect(stablecoins).toHaveLength(5); // USDC, DAI, USDT, FRAX, BUSD are stablecoins

      // Verify specific stablecoins are present
      const symbols = stablecoins.map(token => token.symbol);
      expect(symbols).toContain('USDC');
      expect(symbols).toContain('DAI');
      expect(symbols).toContain('USDT');
      expect(symbols).toContain('FRAX');
      expect(symbols).toContain('BUSD');

      // Verify all are marked as stablecoins
      stablecoins.forEach(token => {
        expect(token.isStablecoin).toBe(true);
      });
    });

    it('should return non-stablecoins when isStablecoin is false', () => {
      const nonStablecoins = getTokensByType(false);
      expect(nonStablecoins).toHaveLength(2); // WETH plus one other non-stablecoin

      // Verify WETH is in the results
      const symbols = nonStablecoins.map(token => token.symbol);
      expect(symbols).toContain('WETH');

      // Verify all are marked as non-stablecoins
      nonStablecoins.forEach(token => {
        expect(token.isStablecoin).toBe(false);
      });
    });
  });
});