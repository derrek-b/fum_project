/**
 * Token Helpers Test Suite
 *
 * Comprehensive tests for all tokenHelper functions following established patterns
 */

import { describe, it, expect } from 'vitest';
import {
  getAllTokens,
  getTokenBySymbol,
  getTokenAddress,
  getStablecoins,
  areTokensSupportedOnChain,
  getTokenByAddress,
  getTokensByChain,
  getAllTokenSymbols,
  getTokensByType,
  getCoingeckoId,
  getTokenAddresses,
  validateTokensExist,
  getTokensBySymbol,
  isStablecoin,
  detectStablePair,
  isNativeToken,
  getWrappedNativeAddress,
  getWrappedNativeSymbol,
  getNativeSymbol,
  isWrappedNativeToken,
  getNativeTokenForChain
} from '../../../src/helpers/tokenHelpers.js';
import tokens from '../../../src/configs/tokens.js';

describe('Token Helpers', () => {
  describe('getAllTokens', () => {
    describe('Success Cases', () => {
      it('should return all tokens from configuration including WETH', () => {
        const result = getAllTokens();
        expect(typeof result).toBe('object');
        expect(Array.isArray(result)).toBe(false);
        // Should include all base tokens plus WETH
        expect(Object.keys(result)).toContain('WETH');
        expect(Object.keys(result)).toContain('ETH');
        expect(Object.keys(result)).toContain('USDC');
      });

      it('should return tokens with expected structure', () => {
        const result = getAllTokens();
        const tokenKeys = Object.keys(result);

        expect(tokenKeys.length).toBeGreaterThan(0);

        // Test with known tokens
        expect(result.USDC).toBeDefined();
        expect(result.ETH).toBeDefined();

        // Verify token structure
        const usdc = result.USDC;
        expect(usdc).toHaveProperty('name');
        expect(usdc).toHaveProperty('symbol');
        expect(usdc).toHaveProperty('decimals');
        expect(usdc).toHaveProperty('addresses');
        expect(usdc).toHaveProperty('isStablecoin');

        // Verify ETH has native token properties
        const eth = result.ETH;
        expect(eth).toHaveProperty('isNative');
        expect(eth.isNative).toBe(true);
        expect(eth).toHaveProperty('wrappedAddresses');
        expect(eth).toHaveProperty('wrappedSymbol');
        expect(eth.wrappedSymbol).toBe('WETH');
      });

      it('should include all expected token properties', () => {
        const result = getAllTokens();
        const firstToken = Object.values(result)[0];

        const expectedProperties = ['name', 'symbol', 'decimals', 'coingeckoId', 'addresses', 'logoURI', 'isStablecoin'];
        expectedProperties.forEach(prop => {
          expect(firstToken).toHaveProperty(prop);
        });
      });

      it('should include WETH derived from ETH wrappedAddresses', () => {
        const result = getAllTokens();
        const weth = result.WETH;

        expect(weth).toBeDefined();
        expect(weth.symbol).toBe('WETH');
        expect(weth.name).toBe('Wrapped Ether');
        expect(weth.isNative).toBe(false);
        expect(weth.addresses).toBeDefined();
        // WETH addresses should come from ETH's wrappedAddresses
        expect(weth.addresses[42161]).toBe('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1');
      });

      it('should include WAVAX derived from AVAX wrappedAddresses', () => {
        const result = getAllTokens();
        const wavax = result.WAVAX;

        expect(wavax).toBeDefined();
        expect(wavax.symbol).toBe('WAVAX');
        expect(wavax.name).toBe('Wrapped Avalanche');
        expect(wavax.isNative).toBe(false);
        expect(wavax.addresses).toBeDefined();
        // WAVAX addresses should come from AVAX's wrappedAddresses
        expect(wavax.addresses[43114]).toBe('0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7');
      });
    });
  });

  describe('getTokenBySymbol', () => {
    describe('Success Cases', () => {
      it('should return token for valid symbol', () => {
        const result = getTokenBySymbol('USDC');

        expect(result).toBeDefined();
        expect(result.symbol).toBe('USDC');
        expect(result.name).toBe('USD Coin');
        expect(result.decimals).toBe(6);
        expect(result.isStablecoin).toBe(true);
      });

      it('should return ETH token correctly', () => {
        const result = getTokenBySymbol('ETH');

        expect(result).toBeDefined();
        expect(result.symbol).toBe('ETH');
        expect(result.name).toBe('Ether');
        expect(result.decimals).toBe(18);
        expect(result.isStablecoin).toBe(false);
        expect(result.isNative).toBe(true);
        expect(result.wrappedAddresses).toBeDefined();
        expect(result.wrappedSymbol).toBe('WETH');
      });

      it('should handle unicode keys correctly', () => {
        const result = getTokenBySymbol('USD₮0');
        expect(result).toBeDefined();
        expect(result.symbol).toBe('USD₮0');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unknown token', () => {
        expect(() => getTokenBySymbol('UNKNOWN'))
          .toThrow('Token UNKNOWN not found');
      });

      it('should throw error for case-sensitive symbols correctly', () => {
        expect(() => getTokenBySymbol('usdc'))
          .toThrow('Token usdc not found');
      });
      it('should throw error for null symbol', () => {
        expect(() => getTokenBySymbol(null)).toThrow('Token symbol parameter is required');
      });

      it('should throw error for undefined symbol', () => {
        expect(() => getTokenBySymbol(undefined)).toThrow('Token symbol parameter is required');
      });

      it('should throw error for non-string symbol', () => {
        expect(() => getTokenBySymbol(123)).toThrow('Token symbol must be a string');
        expect(() => getTokenBySymbol({})).toThrow('Token symbol must be a string');
        expect(() => getTokenBySymbol([])).toThrow('Token symbol must be a string');
      });

      it('should throw error for empty string symbol', () => {
        expect(() => getTokenBySymbol('')).toThrow('Token symbol cannot be empty');
      });
    });

    describe('Wrapped Symbol Fallback', () => {
      it('should resolve WETH via wrappedSymbol fallback', () => {
        const result = getTokenBySymbol('WETH');

        expect(result).toBeDefined();
        expect(result.symbol).toBe('WETH');
        expect(result.name).toBe('Wrapped Ether');
        expect(result.decimals).toBe(18);
        expect(result.isNative).toBe(false);
        expect(result.addresses).toBeDefined();
        // Wrapped address should NOT be ADDRESS_ZERO (native uses zero, wrapped uses real address)
        expect(result.addresses[42161]).toBeDefined();
        expect(result.addresses[42161]).not.toBe('0x0000000000000000000000000000000000000000');
      });

      it('should resolve WAVAX via wrappedSymbol fallback', () => {
        const result = getTokenBySymbol('WAVAX');

        expect(result).toBeDefined();
        expect(result.symbol).toBe('WAVAX');
        expect(result.name).toBe('Wrapped Avalanche');
        expect(result.decimals).toBe(18);
        expect(result.isNative).toBe(false);
        expect(result.addresses).toBeDefined();
        expect(result.addresses[43114]).toBeDefined();
        expect(result.addresses[43114]).not.toBe('0x0000000000000000000000000000000000000000');
      });

      it('should still throw for truly unknown symbols', () => {
        expect(() => getTokenBySymbol('WDOGE')).toThrow('Token WDOGE not found');
      });

      it('should return different object from native token lookup', () => {
        const eth = getTokenBySymbol('ETH');
        const weth = getTokenBySymbol('WETH');

        expect(eth.symbol).toBe('ETH');
        expect(weth.symbol).toBe('WETH');
        expect(eth.isNative).toBe(true);
        expect(weth.isNative).toBe(false);
        // Addresses should differ — native uses ADDRESS_ZERO, wrapped uses real contract
        expect(eth.addresses[42161]).not.toBe(weth.addresses[42161]);
      });
    });
  });

  describe('getTokenAddress', () => {
    describe('Success Cases', () => {
      it('should return address for valid symbol and chain', () => {
        const result = getTokenAddress('USDC', 42161);
        expect(result).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
      });

      it('should return address for local fork chain', () => {
        const result = getTokenAddress('USDC', 1337);
        expect(result).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
      });

      it('should return AddressZero for native ETH token', () => {
        const result = getTokenAddress('ETH', 42161);
        expect(result).toBe('0x0000000000000000000000000000000000000000');
      });

      it('should return AddressZero for ETH on all supported chains', () => {
        const chainIds = [42161, 1337];
        chainIds.forEach(chainId => {
          const result = getTokenAddress('ETH', chainId);
          expect(result).toBe('0x0000000000000000000000000000000000000000');
        });
      });


      it('should work with all configured chains', () => {
        const chainIds = [42161, 1337];
        chainIds.forEach(chainId => {
          const result = getTokenAddress('USDC', chainId);
          expect(result).toBeDefined();
          expect(typeof result).toBe('string');
          expect(result.startsWith('0x')).toBe(true);
        });
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid symbol', () => {
        expect(() => getTokenAddress(null, 42161)).toThrow('Token symbol parameter is required');
        expect(() => getTokenAddress('', 42161)).toThrow('Token symbol cannot be empty');
      });

      it('should throw error for invalid chainId', () => {
        expect(() => getTokenAddress('USDC', null)).toThrow('Chain ID parameter is required');
        expect(() => getTokenAddress('USDC', 'invalid')).toThrow('Chain ID must be a positive integer');
        expect(() => getTokenAddress('USDC', -1)).toThrow('Chain ID must be a positive integer');
        expect(() => getTokenAddress('USDC', 0)).toThrow('Chain ID must be a positive integer');
      });

      it('should throw error for unknown token', () => {
        expect(() => getTokenAddress('UNKNOWN', 42161))
          .toThrow('Token UNKNOWN not found');
      });

      it('should throw error for token not on chain', () => {
        expect(() => getTokenAddress('USDC', 999999))
          .toThrow('Token USDC not available on chain 999999');
      });
    });
  });

  describe('getStablecoins', () => {
    describe('Success Cases', () => {
      it('should return only stablecoin tokens', () => {
        const result = getStablecoins();

        expect(typeof result).toBe('object');
        expect(Array.isArray(result)).toBe(false);

        Object.values(result).forEach(token => {
          expect(token.isStablecoin).toBe(true);
        });
      });

      it('should include USDC in stablecoins', () => {
        const result = getStablecoins();
        expect(result.USDC).toBeDefined();
        expect(result.USDC.isStablecoin).toBe(true);
      });

      it('should include USDT in stablecoins', () => {
        const result = getStablecoins();
        expect(result['USD₮0']).toBeDefined();
        expect(result['USD₮0'].isStablecoin).toBe(true);
      });

      it('should not include ETH in stablecoins', () => {
        const result = getStablecoins();
        expect(result.ETH).toBeUndefined();
      });

      it('should have consistent structure with getAllTokens', () => {
        const allTokens = getAllTokens();
        const stablecoins = getStablecoins();

        Object.entries(stablecoins).forEach(([symbol, token]) => {
          expect(allTokens[symbol]).toEqual(token);
        });
      });
    });
  });

  describe('isStablecoin', () => {
    describe('Success Cases', () => {
      it('should return correct value for all configured tokens', () => {
        Object.entries(tokens).forEach(([symbol, token]) => {
          const result = isStablecoin(symbol);
          expect(result).toBe(token.isStablecoin);
        });
      });

      it('should be consistent with getStablecoins', () => {
        const stablecoins = getStablecoins();

        // All tokens in getStablecoins should return true
        Object.keys(stablecoins).forEach(symbol => {
          expect(isStablecoin(symbol)).toBe(true);
        });

        // All tokens not in getStablecoins should return false
        const allTokens = Object.keys(tokens);
        const nonStablecoins = allTokens.filter(symbol => !stablecoins[symbol]);

        nonStablecoins.forEach(symbol => {
          expect(isStablecoin(symbol)).toBe(false);
        });
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null symbol', () => {
        expect(() => isStablecoin(null))
          .toThrow('Token symbol parameter is required');
      });

      it('should throw error for undefined symbol', () => {
        expect(() => isStablecoin(undefined))
          .toThrow('Token symbol parameter is required');
      });

      it('should throw error for empty string symbol', () => {
        expect(() => isStablecoin(''))
          .toThrow('Token symbol cannot be empty');
      });

      it('should throw error for non-string symbol', () => {
        expect(() => isStablecoin(123))
          .toThrow('Token symbol must be a string');
        expect(() => isStablecoin({}))
          .toThrow('Token symbol must be a string');
        expect(() => isStablecoin([]))
          .toThrow('Token symbol must be a string');
        expect(() => isStablecoin(true))
          .toThrow('Token symbol must be a string');
      });

      it('should throw error for unknown token', () => {
        expect(() => isStablecoin('UNKNOWN'))
          .toThrow('Token UNKNOWN not found');
      });

      it('should throw error for case-sensitive mismatch', () => {
        expect(() => isStablecoin('usdc'))
          .toThrow('Token usdc not found');
        expect(() => isStablecoin('Usdc'))
          .toThrow('Token Usdc not found');
        expect(() => isStablecoin('USDC '))
          .toThrow('Token USDC  not found');
      });
    });
  });

  describe('detectStablePair', () => {
    describe('Success Cases', () => {
      it('should return true for USDC-USDT stable pair', () => {
        const usdcAddress = getTokenAddress('USDC', 1337);
        const usdtAddress = getTokenAddress('USD₮0', 1337);

        const result = detectStablePair(usdcAddress, usdtAddress, 1337);

        expect(result).toBe(true);
        expect(typeof result).toBe('boolean');
      });

      it('should return true for USDT-USDC stable pair (reversed order)', () => {
        const usdcAddress = getTokenAddress('USDC', 1337);
        const usdtAddress = getTokenAddress('USD₮0', 1337);

        const result = detectStablePair(usdtAddress, usdcAddress, 1337);

        expect(result).toBe(true);
      });

      it('should return false for ETH-USDC mixed pair (using WETH address)', () => {
        const wethAddress = getWrappedNativeAddress(1337);
        const usdcAddress = getTokenAddress('USDC', 1337);

        const result = detectStablePair(wethAddress, usdcAddress, 1337);

        expect(result).toBe(false);
        expect(typeof result).toBe('boolean');
      });

      it('should return false for USDC-ETH mixed pair (reversed, using WETH address)', () => {
        const wethAddress = getWrappedNativeAddress(1337);
        const usdcAddress = getTokenAddress('USDC', 1337);

        const result = detectStablePair(usdcAddress, wethAddress, 1337);

        expect(result).toBe(false);
      });

      it('should return false for ETH-WBTC non-stable pair (using WETH address)', () => {
        const wethAddress = getWrappedNativeAddress(1337);
        const wbtcAddress = getTokenAddress('WBTC', 1337);

        const result = detectStablePair(wethAddress, wbtcAddress, 1337);

        expect(result).toBe(false);
      });

      it('should work with all combinations of known tokens', () => {
        const wethAddress = getWrappedNativeAddress(1337);
        const usdcAddress = getTokenAddress('USDC', 1337);
        const usdtAddress = getTokenAddress('USD₮0', 1337);
        const wbtcAddress = getTokenAddress('WBTC', 1337);

        // Test all combinations
        const pairs = [
          { tokenA: usdcAddress, tokenB: usdtAddress, expected: true },  // stable-stable
          { tokenA: usdtAddress, tokenB: usdcAddress, expected: true },  // stable-stable reversed
          { tokenA: usdcAddress, tokenB: wethAddress, expected: false }, // stable-volatile (ETH via WETH address)
          { tokenA: wethAddress, tokenB: usdcAddress, expected: false }, // volatile-stable
          { tokenA: usdcAddress, tokenB: wbtcAddress, expected: false }, // stable-volatile
          { tokenA: wbtcAddress, tokenB: usdcAddress, expected: false }, // volatile-stable
          { tokenA: wethAddress, tokenB: wbtcAddress, expected: false }, // volatile-volatile
          { tokenA: wbtcAddress, tokenB: wethAddress, expected: false }, // volatile-volatile reversed
        ];

        for (const { tokenA, tokenB, expected } of pairs) {
          const result = detectStablePair(tokenA, tokenB, 1337);
          expect(result).toBe(expected);
        }
      });
    });

    describe('Error Cases', () => {
      it('should return false for unknown token addresses', () => {
        const unknownAddress1 = '0x1234567890123456789012345678901234567890';
        const unknownAddress2 = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

        const result = detectStablePair(unknownAddress1, unknownAddress2, 1337);

        expect(result).toBe(false);
      });

      it('should return false when first token is unknown', () => {
        const unknownAddress = '0x1234567890123456789012345678901234567890';
        const usdcAddress = getTokenAddress('USDC', 1337);

        const result = detectStablePair(unknownAddress, usdcAddress, 1337);

        expect(result).toBe(false);
      });

      it('should return false when second token is unknown', () => {
        const usdcAddress = getTokenAddress('USDC', 1337);
        const unknownAddress = '0x1234567890123456789012345678901234567890';

        const result = detectStablePair(usdcAddress, unknownAddress, 1337);

        expect(result).toBe(false);
      });

      it('should return false for addresses not on chain', () => {
        // These are mainnet addresses that might not be in our 1337 test chain config
        const mainnetOnlyToken1 = '0x4Fabb145d64652a948d72533023f6E7A623C7C53'; // BUSD mainnet
        const mainnetOnlyToken2 = '0x956F47F50A910163D8BF957Cf5846D573E7f87CA'; // FEI mainnet

        const result = detectStablePair(mainnetOnlyToken1, mainnetOnlyToken2, 1337);

        expect(result).toBe(false);
      });

      it('should throw error for invalid tokenAddressA', () => {
        const usdcAddress = getTokenAddress('USDC', 1337);

        expect(() => detectStablePair(null, usdcAddress, 1337))
          .toThrow('Address parameter is required');
        expect(() => detectStablePair('', usdcAddress, 1337))
          .toThrow('Address must be a valid Ethereum address');
        expect(() => detectStablePair('0xinvalid', usdcAddress, 1337))
          .toThrow('Address must be a valid Ethereum address');
        expect(() => detectStablePair(123, usdcAddress, 1337))
          .toThrow('Address must be a string');
      });

      it('should throw error for invalid tokenAddressB', () => {
        const usdcAddress = getTokenAddress('USDC', 1337);

        expect(() => detectStablePair(usdcAddress, null, 1337))
          .toThrow('Address parameter is required');
        expect(() => detectStablePair(usdcAddress, '', 1337))
          .toThrow('Address must be a valid Ethereum address');
        expect(() => detectStablePair(usdcAddress, '0xinvalid', 1337))
          .toThrow('Address must be a valid Ethereum address');
        expect(() => detectStablePair(usdcAddress, 123, 1337))
          .toThrow('Address must be a string');
      });

      it('should throw error for invalid chainId', () => {
        const usdcAddress = getTokenAddress('USDC', 1337);
        const usdtAddress = getTokenAddress('USD₮0', 1337);

        expect(() => detectStablePair(usdcAddress, usdtAddress, null))
          .toThrow('Chain ID parameter is required');
        expect(() => detectStablePair(usdcAddress, usdtAddress, 'invalid'))
          .toThrow('Chain ID must be a positive integer');
        expect(() => detectStablePair(usdcAddress, usdtAddress, -1))
          .toThrow('Chain ID must be a positive integer');
        expect(() => detectStablePair(usdcAddress, usdtAddress, 0))
          .toThrow('Chain ID must be a positive integer');
      });
    });

    describe('Special Cases', () => {
      it('should return false for zero addresses', () => {
        const zeroAddress = '0x0000000000000000000000000000000000000000';
        const usdcAddress = getTokenAddress('USDC', 1337);

        const result1 = detectStablePair(zeroAddress, usdcAddress, 1337);
        const result2 = detectStablePair(usdcAddress, zeroAddress, 1337);
        const result3 = detectStablePair(zeroAddress, zeroAddress, 1337);

        expect(result1).toBe(false);
        expect(result2).toBe(false);
        expect(result3).toBe(false);
      });

      it('should be deterministic and return same result on multiple calls', () => {
        const usdcAddress = getTokenAddress('USDC', 1337);
        const usdtAddress = getTokenAddress('USD₮0', 1337);

        const result1 = detectStablePair(usdcAddress, usdtAddress, 1337);
        const result2 = detectStablePair(usdcAddress, usdtAddress, 1337);
        const result3 = detectStablePair(usdcAddress, usdtAddress, 1337);

        expect(result1).toBe(result2);
        expect(result2).toBe(result3);
        expect(result1).toBe(true);
      });

      it('should be deterministic for non-stable pairs', () => {
        const wethAddress = getWrappedNativeAddress(1337);
        const usdcAddress = getTokenAddress('USDC', 1337);

        const result1 = detectStablePair(wethAddress, usdcAddress, 1337);
        const result2 = detectStablePair(wethAddress, usdcAddress, 1337);

        expect(result1).toBe(result2);
        expect(result1).toBe(false);
      });
    });
  });

  describe('areTokensSupportedOnChain', () => {
    describe('Success Cases', () => {
      it('should return true when all tokens are supported', () => {
        const result = areTokensSupportedOnChain(['USDC', 'ETH'], 42161);
        expect(result).toBe(true);
      });

      it('should return true for single token', () => {
        const result = areTokensSupportedOnChain(['USDC'], 42161);
        expect(result).toBe(true);
      });

      it('should return true for native ETH token', () => {
        const result = areTokensSupportedOnChain(['ETH'], 42161);
        expect(result).toBe(true);
      });

      it('should return false when some tokens are not supported', () => {
        const result = areTokensSupportedOnChain(['USDC', 'UNKNOWN'], 42161);
        expect(result).toBe(false);
      });

      it('should return false when tokens are not on chain', () => {
        const result = areTokensSupportedOnChain(['USDC'], 999999);
        expect(result).toBe(false);
      });

      it('should work with all valid tokens on Arbitrum', () => {
        const result = areTokensSupportedOnChain(['USDC', 'ETH', 'WBTC'], 42161);
        expect(result).toBe(true);
      });

      it('should work with mixed token support', () => {
        const supportedResult = areTokensSupportedOnChain(['USDC', 'ETH'], 42161);
        expect(supportedResult).toBe(true);

        const unsupportedResult = areTokensSupportedOnChain(['USDC', 'NONEXISTENT'], 42161);
        expect(unsupportedResult).toBe(false);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid symbols array', () => {
        expect(() => areTokensSupportedOnChain(null, 42161)).toThrow('Token symbols parameter is required');
        expect(() => areTokensSupportedOnChain('USDC', 42161)).toThrow('Token symbols must be an array');
        expect(() => areTokensSupportedOnChain([], 42161)).toThrow('Token symbols array cannot be empty');
      });

      it('should throw error for invalid symbols in array', () => {
        expect(() => areTokensSupportedOnChain([null], 42161)).toThrow('Token symbols[0]: Token symbol parameter is required');
        expect(() => areTokensSupportedOnChain(['USDC', ''], 42161)).toThrow('Token symbols[1]: Token symbol cannot be empty');
        expect(() => areTokensSupportedOnChain(['USDC', 123], 42161)).toThrow('Token symbols[1]: Token symbol must be a string');
      });

      it('should throw error for invalid chainId', () => {
        expect(() => areTokensSupportedOnChain(['USDC'], null)).toThrow('Chain ID parameter is required');
        expect(() => areTokensSupportedOnChain(['USDC'], 'invalid')).toThrow('Chain ID must be a positive integer');
      });
    });
  });

  describe('getTokenByAddress', () => {
    describe('Success Cases', () => {
      it('should return token for valid address and chain', () => {
        const address = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
        const result = getTokenByAddress(address, 42161);

        expect(result).toBeDefined();
        expect(result.symbol).toBe('USDC');
      });

      it('should handle case-insensitive addresses', () => {
        const address = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
        const result = getTokenByAddress(address, 42161);

        expect(result).toBeDefined();
        expect(result.symbol).toBe('USDC');
      });

      it('should resolve WETH address to WETH token (not ETH)', () => {
        const address = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
        const result = getTokenByAddress(address, 42161);

        expect(result).toBeDefined();
        expect(result.symbol).toBe('WETH');
        expect(result.isNative).toBe(false);
        expect(result.name).toBe('Wrapped Ether');
      });

      it('should resolve WETH address on local fork to WETH token', () => {
        const address = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
        const result = getTokenByAddress(address, 1337);

        expect(result).toBeDefined();
        expect(result.symbol).toBe('WETH');
        expect(result.isNative).toBe(false);
        expect(result.name).toBe('Wrapped Ether');
      });

    });

    describe('Error Cases', () => {
      it('should throw error for invalid address format', () => {
        expect(() => getTokenByAddress('invalid', 42161)).toThrow('Address must be a valid Ethereum address');
        expect(() => getTokenByAddress('0x123', 42161)).toThrow('Address must be a valid Ethereum address');
        expect(() => getTokenByAddress('0x123456789012345678901234567890123456789G', 42161)).toThrow('Address must be a valid Ethereum address');
      });

      it('should throw error for missing address', () => {
        expect(() => getTokenByAddress(null, 42161)).toThrow('Address parameter is required');
        expect(() => getTokenByAddress(undefined, 42161)).toThrow('Address parameter is required');
        expect(() => getTokenByAddress('', 42161)).toThrow('Address must be a valid Ethereum address');
      });

      it('should throw error for non-string address', () => {
        expect(() => getTokenByAddress(123, 42161)).toThrow('Address must be a string');
        expect(() => getTokenByAddress({}, 42161)).toThrow('Address must be a string');
      });

      it('should throw error for invalid chainId', () => {
        const address = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
        expect(() => getTokenByAddress(address, null)).toThrow('Chain ID parameter is required');
        expect(() => getTokenByAddress(address, 'invalid')).toThrow('Chain ID must be a positive integer');
      });

      it('should throw error for unknown address', () => {
        const address = '0x1234567890123456789012345678901234567890';
        expect(() => getTokenByAddress(address, 42161))
          .toThrow(`No token found at address ${address} on chain 42161`);
      });

      it('should throw error for address not on chain', () => {
        const address = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
        expect(() => getTokenByAddress(address, 999999))
          .toThrow(`No token found at address ${address} on chain 999999`);
      });
    });
  });

  describe('getTokensByChain', () => {
    describe('Success Cases', () => {
      it('should return tokens available on Arbitrum', () => {
        const result = getTokensByChain(42161);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);

        result.forEach(token => {
          // Native tokens have AddressZero for addresses but wrappedAddresses
          if (token.isNative) {
            expect(token.wrappedAddresses[42161]).toBeDefined();
          } else {
            expect(token.addresses[42161]).toBeDefined();
            expect(typeof token.addresses[42161]).toBe('string');
          }
        });
      });

      it('should return tokens available on Avalanche', () => {
        const result = getTokensByChain(43114);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);

        result.forEach(token => {
          if (token.isNative) {
            // ETH is not native on Avalanche, skip
          } else {
            expect(token.addresses[43114]).toBeDefined();
          }
        });
      });

      it('should return tokens available on local chain', () => {
        const result = getTokensByChain(1337);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
      });

      it('should return empty array for unsupported chain', () => {
        const result = getTokensByChain(999999);
        expect(result).toEqual([]);
      });

      it('should include USDC and ETH on Arbitrum chains', () => {
        const supportedChains = [42161, 1337];

        supportedChains.forEach(chainId => {
          const tokens = getTokensByChain(chainId);
          const symbols = tokens.map(token => token.symbol);

          expect(symbols).toContain('USDC');
          expect(symbols).toContain('ETH');
        });
      });

      it('should include native ETH token with correct properties', () => {
        const result = getTokensByChain(42161);
        const ethToken = result.find(t => t.symbol === 'ETH');

        expect(ethToken).toBeDefined();
        expect(ethToken.isNative).toBe(true);
        expect(ethToken.addresses[42161]).toBe('0x0000000000000000000000000000000000000000');
        expect(ethToken.wrappedAddresses[42161]).toBe('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1');
        expect(ethToken.wrappedSymbol).toBe('WETH');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid chainId', () => {
        expect(() => getTokensByChain(null)).toThrow('Chain ID parameter is required');
        expect(() => getTokensByChain('invalid')).toThrow('Chain ID must be a positive integer');
        expect(() => getTokensByChain(-1)).toThrow('Chain ID must be a positive integer');
        expect(() => getTokensByChain(0)).toThrow('Chain ID must be a positive integer');
      });
    });
  });

  describe('getAllTokenSymbols', () => {
    describe('Success Cases', () => {
      it('should return array of all token symbols', () => {
        const result = getAllTokenSymbols();

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);

        expect(result).toContain('USDC');
        expect(result).toContain('ETH');
        expect(result).toContain('WBTC');
      });

      it('should include unicode symbol keys', () => {
        const result = getAllTokenSymbols();
        expect(result).toContain('USD₮0');
      });

      it('should return same symbols as Object.keys(getAllTokens())', () => {
        const result = getAllTokenSymbols();
        const expected = Object.keys(getAllTokens());

        expect(result).toEqual(expected);
      });

      it('should contain only strings', () => {
        const result = getAllTokenSymbols();

        result.forEach(symbol => {
          expect(typeof symbol).toBe('string');
          expect(symbol.length).toBeGreaterThan(0);
        });
      });
    });
  });

  describe('getTokensByType', () => {
    describe('Success Cases', () => {
      it('should return stablecoins when isStablecoin is true', () => {
        const result = getTokensByType(true);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);

        result.forEach(token => {
          expect(token.isStablecoin).toBe(true);
        });

        const symbols = result.map(token => token.symbol);
        expect(symbols).toContain('USDC');
        expect(symbols).toContain('USD₮0');
      });

      it('should return non-stablecoins when isStablecoin is false', () => {
        const result = getTokensByType(false);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);

        result.forEach(token => {
          expect(token.isStablecoin).toBe(false);
        });

        const symbols = result.map(token => token.symbol);
        expect(symbols).toContain('ETH');
        expect(symbols).toContain('WBTC');
      });

      it('should have consistent results with getStablecoins', () => {
        const stablecoinsByType = getTokensByType(true);
        const stablecoinsHelper = Object.values(getStablecoins());

        expect(stablecoinsByType.length).toBe(stablecoinsHelper.length);

        const symbolsByType = stablecoinsByType.map(token => token.symbol);
        const symbolsHelper = stablecoinsHelper.map(token => token.symbol);

        expect(symbolsByType.sort()).toEqual(symbolsHelper.sort());
      });

      it('should cover all tokens when combining both types', () => {
        const stablecoins = getTokensByType(true);
        const nonStablecoins = getTokensByType(false);
        const totalTokens = stablecoins.length + nonStablecoins.length;

        const allTokens = Object.values(getAllTokens());
        expect(totalTokens).toBe(allTokens.length);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for non-boolean parameter', () => {
        expect(() => getTokensByType('true')).toThrow('isStablecoin parameter must be a boolean');
        expect(() => getTokensByType(1)).toThrow('isStablecoin parameter must be a boolean');
        expect(() => getTokensByType(null)).toThrow('isStablecoin parameter must be a boolean');
        expect(() => getTokensByType(undefined)).toThrow('isStablecoin parameter must be a boolean');
        expect(() => getTokensByType({})).toThrow('isStablecoin parameter must be a boolean');
      });
    });
  });

  describe('getCoingeckoId', () => {
    describe('Success Cases', () => {
      it('should return CoinGecko ID for USDC', () => {
        const result = getCoingeckoId('USDC');
        expect(result).toBe('usd-coin');
      });

      it('should return CoinGecko ID for ETH', () => {
        const result = getCoingeckoId('ETH');
        expect(result).toBe('ethereum');
      });

      it('should return CoinGecko ID for WBTC', () => {
        const result = getCoingeckoId('WBTC');
        expect(result).toBe('wrapped-bitcoin');
      });

      it('should return CoinGecko ID for LINK', () => {
        const result = getCoingeckoId('LINK');
        expect(result).toBe('chainlink');
      });

      it('should work with all configured tokens', () => {
        const allSymbols = getAllTokenSymbols();

        allSymbols.forEach(symbol => {
          const result = getCoingeckoId(symbol);
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
        });
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid symbol', () => {
        expect(() => getCoingeckoId(null)).toThrow('Token symbol parameter is required');
        expect(() => getCoingeckoId('')).toThrow('Token symbol cannot be empty');
        expect(() => getCoingeckoId(123)).toThrow('Token symbol must be a string');
      });

      it('should throw error for unknown token', () => {
        expect(() => getCoingeckoId('UNKNOWN')).toThrow('Unknown token symbol: UNKNOWN. Token not found in configuration.');
      });
    });
  });

  describe('getTokenAddresses', () => {
    describe('Success Cases', () => {
      it('should return addresses for multiple ERC20 tokens', () => {
        const result = getTokenAddresses(['USDC', 'WBTC'], 42161);

        expect(typeof result).toBe('object');
        expect(result.USDC).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
        expect(result.WBTC).toBe('0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f');
      });

      it('should return AddressZero for native ETH token', () => {
        const result = getTokenAddresses(['USDC', 'ETH'], 42161);

        expect(result.USDC).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
        expect(result.ETH).toBe('0x0000000000000000000000000000000000000000');
      });

      it('should return addresses for local fork chain', () => {
        const result = getTokenAddresses(['USDC', 'WBTC'], 1337);

        expect(result.USDC).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
        expect(result.WBTC).toBe('0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f');
      });

      it('should return all addresses when all tokens are available', () => {
        const result = getTokenAddresses(['USDC', 'WBTC'], 42161);

        expect(Object.keys(result)).toHaveLength(2);
        expect(result.USDC).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
        expect(result.WBTC).toBe('0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f');
      });

      it('should work with single token', () => {
        const result = getTokenAddresses(['USDC'], 42161);
        expect(result.USDC).toBeDefined();
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid symbols', () => {
        expect(() => getTokenAddresses(null, 42161)).toThrow('Token symbols parameter is required');
        expect(() => getTokenAddresses([], 42161)).toThrow('Token symbols array cannot be empty');
      });

      it('should throw error for invalid chainId', () => {
        expect(() => getTokenAddresses(['USDC'], null)).toThrow('Chain ID parameter is required');
        expect(() => getTokenAddresses(['USDC'], 'invalid')).toThrow('Chain ID must be a positive integer');
      });

      it('should throw error when token not found', () => {
        expect(() => getTokenAddresses(['UNKNOWN', 'USDC'], 42161))
          .toThrow('Token UNKNOWN not found');
      });

      it('should throw error when token not available on chain', () => {
        expect(() => getTokenAddresses(['USDC', 'ETH'], 999999))
          .toThrow('Token USDC not available on chain 999999');
      });
    });
  });

  describe('validateTokensExist', () => {
    describe('Success Cases', () => {
      it('should return true for existing tokens', () => {
        const result = validateTokensExist(['USDC', 'ETH']);
        expect(result).toBe(true);
      });

      it('should return true for single existing token', () => {
        const result = validateTokensExist(['USDC']);
        expect(result).toBe(true);
      });

      it('should return false for non-existing tokens', () => {
        const result = validateTokensExist(['USDC', 'UNKNOWN']);
        expect(result).toBe(false);
      });

      it('should return false for all non-existing tokens', () => {
        const result = validateTokensExist(['UNKNOWN1', 'UNKNOWN2']);
        expect(result).toBe(false);
      });

      it('should work with all valid token symbols', () => {
        const allSymbols = getAllTokenSymbols();
        const result = validateTokensExist(allSymbols);
        expect(result).toBe(true);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid symbols parameter', () => {
        expect(() => validateTokensExist(null)).toThrow('Token symbols parameter is required');
        expect(() => validateTokensExist([])).toThrow('Token symbols array cannot be empty');
        expect(() => validateTokensExist('USDC')).toThrow('Token symbols must be an array');
      });
    });
  });

  describe('getTokensBySymbol', () => {
    describe('Success Cases', () => {
      it('should return tokens for multiple symbols', () => {
        const result = getTokensBySymbol(['USDC', 'ETH']);

        expect(typeof result).toBe('object');
        expect(result.USDC).toBeDefined();
        expect(result.ETH).toBeDefined();

        expect(result.USDC.name).toBe('USD Coin');
        expect(result.ETH.name).toBe('Ether');
        expect(result.ETH.isNative).toBe(true);
      });

      it('should return token for single symbol', () => {
        const result = getTokensBySymbol(['USDC']);

        expect(result.USDC).toBeDefined();
        expect(result.USDC.symbol).toBe('USDC');
        expect(result.USDC.decimals).toBe(6);
      });

      it('should throw error when any token not found', () => {
        expect(() => getTokensBySymbol(['USDC', 'UNKNOWN']))
          .toThrow('Token UNKNOWN not found');
      });

      it('should throw error on first unknown token', () => {
        expect(() => getTokensBySymbol(['UNKNOWN1', 'UNKNOWN2']))
          .toThrow('Token UNKNOWN1 not found');
      });

      it('should return complete token objects', () => {
        const result = getTokensBySymbol(['USDC']);

        const token = result.USDC;

        expect(token).toHaveProperty('name');
        expect(token).toHaveProperty('symbol');
        expect(token).toHaveProperty('decimals');
        expect(token).toHaveProperty('addresses');
        expect(token).toHaveProperty('isStablecoin');
        expect(token).toHaveProperty('coingeckoId');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid symbols parameter', () => {
        expect(() => getTokensBySymbol(null)).toThrow('Token symbols parameter is required');
        expect(() => getTokensBySymbol([])).toThrow('Token symbols array cannot be empty');
        expect(() => getTokensBySymbol('USDC')).toThrow('Token symbols must be an array');
      });
    });
  });

  describe('isNativeToken', () => {
    describe('Success Cases', () => {
      it('should return true for ETH', () => {
        const result = isNativeToken('ETH');
        expect(result).toBe(true);
      });

      it('should return false for USDC', () => {
        const result = isNativeToken('USDC');
        expect(result).toBe(false);
      });

      it('should return false for WBTC', () => {
        const result = isNativeToken('WBTC');
        expect(result).toBe(false);
      });

      it('should return false for all non-native tokens', () => {
        const allTokens = getAllTokens();
        Object.values(allTokens).forEach(token => {
          const result = isNativeToken(token.symbol);
          expect(result).toBe(token.isNative === true);
        });
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null symbol', () => {
        expect(() => isNativeToken(null)).toThrow('Token symbol parameter is required');
      });

      it('should throw error for undefined symbol', () => {
        expect(() => isNativeToken(undefined)).toThrow('Token symbol parameter is required');
      });

      it('should throw error for empty string symbol', () => {
        expect(() => isNativeToken('')).toThrow('Token symbol cannot be empty');
      });

      it('should throw error for non-string symbol', () => {
        expect(() => isNativeToken(123)).toThrow('Token symbol must be a string');
        expect(() => isNativeToken({})).toThrow('Token symbol must be a string');
      });

      it('should throw error for unknown token', () => {
        expect(() => isNativeToken('UNKNOWN')).toThrow('Token UNKNOWN not found');
      });
    });
  });

  describe('isWrappedNativeToken', () => {
    describe('Success Cases', () => {
      it('should return true for WETH', () => {
        expect(isWrappedNativeToken('WETH')).toBe(true);
      });

      it('should return true for WAVAX', () => {
        expect(isWrappedNativeToken('WAVAX')).toBe(true);
      });

      it('should return false for native tokens', () => {
        expect(isWrappedNativeToken('ETH')).toBe(false);
        expect(isWrappedNativeToken('AVAX')).toBe(false);
      });

      it('should return false for regular tokens', () => {
        expect(isWrappedNativeToken('USDC')).toBe(false);
        expect(isWrappedNativeToken('WBTC')).toBe(false);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid symbol', () => {
        expect(() => isWrappedNativeToken(null)).toThrow('Token symbol parameter is required');
        expect(() => isWrappedNativeToken('')).toThrow('Token symbol cannot be empty');
        expect(() => isWrappedNativeToken(123)).toThrow('Token symbol must be a string');
      });
    });
  });

  describe('getWrappedNativeAddress', () => {
    describe('Success Cases', () => {
      it('should return WETH address for Arbitrum chains', () => {
        expect(getWrappedNativeAddress(42161)).toBe('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1');
        expect(getWrappedNativeAddress(1337)).toBe('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1');
      });

      it('should return WAVAX address for Avalanche chains', () => {
        expect(getWrappedNativeAddress(43114)).toBe('0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7');
        expect(getWrappedNativeAddress(1338)).toBe('0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7');
      });

      it('should return valid Ethereum addresses', () => {
        const chainIds = [42161, 1337, 43114, 1338];
        chainIds.forEach(chainId => {
          const result = getWrappedNativeAddress(chainId);
          expect(result).toMatch(/^0x[a-fA-F0-9]{40}$/);
        });
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null chainId', () => {
        expect(() => getWrappedNativeAddress(null)).toThrow('Chain ID parameter is required');
      });

      it('should throw error for invalid chainId', () => {
        expect(() => getWrappedNativeAddress('invalid')).toThrow('Chain ID must be a positive integer');
        expect(() => getWrappedNativeAddress(-1)).toThrow('Chain ID must be a positive integer');
        expect(() => getWrappedNativeAddress(0)).toThrow('Chain ID must be a positive integer');
      });

      it('should throw error for unsupported chain', () => {
        expect(() => getWrappedNativeAddress(999999)).toThrow('No wrapped native token configured for chain 999999');
      });
    });
  });

  describe('getWrappedNativeSymbol', () => {
    describe('Success Cases', () => {
      it('should return WETH for Arbitrum chains', () => {
        expect(getWrappedNativeSymbol(42161)).toBe('WETH');
        expect(getWrappedNativeSymbol(1337)).toBe('WETH');
      });

      it('should return WAVAX for Avalanche chains', () => {
        expect(getWrappedNativeSymbol(43114)).toBe('WAVAX');
        expect(getWrappedNativeSymbol(1338)).toBe('WAVAX');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid chainId', () => {
        expect(() => getWrappedNativeSymbol(null)).toThrow('Chain ID parameter is required');
        expect(() => getWrappedNativeSymbol('invalid')).toThrow('Chain ID must be a positive integer');
      });

      it('should throw error for unsupported chain', () => {
        expect(() => getWrappedNativeSymbol(999999)).toThrow('No wrapped native token configured for chain 999999');
      });
    });
  });

  describe('getNativeSymbol', () => {
    describe('Success Cases', () => {
      it('should return ETH for Arbitrum chains', () => {
        expect(getNativeSymbol(42161)).toBe('ETH');
        expect(getNativeSymbol(1337)).toBe('ETH');
      });

      it('should return AVAX for Avalanche chains', () => {
        expect(getNativeSymbol(43114)).toBe('AVAX');
        expect(getNativeSymbol(1338)).toBe('AVAX');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid chainId', () => {
        expect(() => getNativeSymbol(null)).toThrow('Chain ID parameter is required');
        expect(() => getNativeSymbol('invalid')).toThrow('Chain ID must be a positive integer');
      });

      it('should throw error for unsupported chain', () => {
        expect(() => getNativeSymbol(999999)).toThrow('No native token configured for chain 999999');
      });
    });
  });

  describe('getNativeTokenForChain', () => {
    describe('Success Cases', () => {
      it('should return ETH config for Arbitrum chains', () => {
        const result = getNativeTokenForChain(42161);
        expect(result.symbol).toBe('ETH');
        expect(result.wrappedSymbol).toBe('WETH');
        expect(result.isNative).toBe(true);
      });

      it('should return AVAX config for Avalanche chains', () => {
        const result = getNativeTokenForChain(43114);
        expect(result.symbol).toBe('AVAX');
        expect(result.wrappedSymbol).toBe('WAVAX');
        expect(result.isNative).toBe(true);
      });

      it('should return local fork configs', () => {
        const result1337 = getNativeTokenForChain(1337);
        expect(result1337.symbol).toBe('ETH');

        const result1338 = getNativeTokenForChain(1338);
        expect(result1338.symbol).toBe('AVAX');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid chainId', () => {
        expect(() => getNativeTokenForChain(null)).toThrow('Chain ID parameter is required');
        expect(() => getNativeTokenForChain('invalid')).toThrow('Chain ID must be a positive integer');
      });

      it('should throw error for unsupported chain', () => {
        expect(() => getNativeTokenForChain(999999)).toThrow('No native token configured for chain 999999');
      });
    });
  });

  describe('getAllTokenSymbols with wrapped tokens', () => {
    it('should include both WETH and WAVAX', () => {
      const symbols = getAllTokenSymbols();
      expect(symbols).toContain('WETH');
      expect(symbols).toContain('WAVAX');
    });

    it('should include base native tokens', () => {
      const symbols = getAllTokenSymbols();
      expect(symbols).toContain('ETH');
      expect(symbols).toContain('AVAX');
    });
  });

  describe('getCoingeckoId with wrapped tokens', () => {
    it('should return ethereum coingecko ID for WETH', () => {
      expect(getCoingeckoId('WETH')).toBe('ethereum');
    });

    it('should return avalanche-2 coingecko ID for WAVAX', () => {
      expect(getCoingeckoId('WAVAX')).toBe('avalanche-2');
    });
  });

  describe('isNativeToken with wrapped tokens', () => {
    it('should return false for WETH', () => {
      expect(isNativeToken('WETH')).toBe(false);
    });

    it('should return false for WAVAX', () => {
      expect(isNativeToken('WAVAX')).toBe(false);
    });

    it('should return true for AVAX', () => {
      expect(isNativeToken('AVAX')).toBe(true);
    });
  });

  describe('getTokenByAddress with WAVAX', () => {
    it('should resolve WAVAX address to WAVAX token', () => {
      const address = '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7';
      const result = getTokenByAddress(address, 43114);

      expect(result).toBeDefined();
      expect(result.symbol).toBe('WAVAX');
      expect(result.isNative).toBe(false);
      expect(result.name).toBe('Wrapped Avalanche');
    });
  });
});
