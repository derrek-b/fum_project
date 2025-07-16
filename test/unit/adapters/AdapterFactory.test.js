/**
 * AdapterFactory Unit Tests
 *
 * Tests for the AdapterFactory.getAdaptersForChain method
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import AdapterFactory from '../../../src/adapters/AdapterFactory.js';
import UniswapV3Adapter from '../../../src/adapters/UniswapV3Adapter.js';

// Create a failing adapter class for testing error handling
class FailingAdapter {
  constructor(chainId) {
    throw new Error("Adapter creation failed");
  }
}

// Create a mock adapter class for testing registration
class MockAdapter {
  constructor(chainId) {
    if (!chainId || typeof chainId !== 'number') {
      throw new Error("chainId must be a valid number");
    }
    this.chainId = chainId;
    this.platformId = 'mock';
    this.platformName = 'Mock Platform';
  }
}

describe('AdapterFactory - Unit Tests', () => {
  describe('getAdaptersForChain', () => {
    describe('Success Cases', () => {
      it('should return adapters for Arbitrum (42161)', () => {
        const result = AdapterFactory.getAdaptersForChain(42161);

        expect(result).toBeDefined();
        expect(result).toHaveProperty('adapters');
        expect(result).toHaveProperty('failures');
        expect(Array.isArray(result.adapters)).toBe(true);
        expect(Array.isArray(result.failures)).toBe(true);
        expect(result.adapters.length).toBe(1);
        expect(result.failures.length).toBe(0);
        expect(result.adapters[0]).toBeInstanceOf(UniswapV3Adapter);
        expect(result.adapters[0].chainId).toBe(42161);
        expect(result.adapters[0].platformId).toBe('uniswapV3');
      });

      it('should return adapters for Ethereum mainnet (1)', () => {
        const result = AdapterFactory.getAdaptersForChain(1);

        expect(result).toBeDefined();
        expect(result.adapters.length).toBe(1);
        expect(result.failures.length).toBe(0);
        expect(result.adapters[0]).toBeInstanceOf(UniswapV3Adapter);
        expect(result.adapters[0].chainId).toBe(1);
      });

      it('should return adapters for local test chain (1337)', () => {
        const result = AdapterFactory.getAdaptersForChain(1337);

        expect(result).toBeDefined();
        expect(result.adapters.length).toBe(1);
        expect(result.failures.length).toBe(0);
        expect(result.adapters[0]).toBeInstanceOf(UniswapV3Adapter);
        expect(result.adapters[0].chainId).toBe(1337);
      });

      it('should return empty result for unsupported chain', () => {
        const result = AdapterFactory.getAdaptersForChain(999999);

        expect(result).toBeDefined();
        expect(result.adapters.length).toBe(0);
        expect(result.failures.length).toBe(0);
      });

      it('should handle failures gracefully and return working adapters', () => {
        // Register a failing adapter
        AdapterFactory.registerAdapterForTestingOnly('failing', FailingAdapter);

        // Test with a chain that has uniswapV3
        const result = AdapterFactory.getAdaptersForChain(42161);

        // Should still get the working uniswapV3 adapter
        expect(result.adapters.length).toBe(1);
        expect(result.adapters[0]).toBeInstanceOf(UniswapV3Adapter);

        // No failures because failing adapter isn't configured for this chain
        expect(result.failures.length).toBe(0);
      });

      it('should track failures when adapter creation fails', () => {
        // First, we need to mock getChainPlatformIds to return a failing platform
        // Since we can't easily modify the real chain config, we'll temporarily register
        // a failing adapter and manually test the failure tracking

        // Save original method
        const originalGetChainPlatformIds = vi.fn();

        // Mock the chainHelpers to return our test platform
        vi.mock('../../../src/helpers/chainHelpers.js', async (importOriginal) => {
          const actual = await importOriginal();
          return {
            ...actual,
            getChainPlatformIds: (chainId) => {
              if (chainId === 88888) {
                return ['failing', 'mock'];
              }
              return actual.getChainPlatformIds(chainId);
            },
            getChainConfig: (chainId) => {
              if (chainId === 88888) {
                return { name: 'Test Chain' };
              }
              return actual.getChainConfig(chainId);
            }
          };
        });

        // Register adapters
        AdapterFactory.registerAdapterForTestingOnly('failing', FailingAdapter);
        AdapterFactory.registerAdapterForTestingOnly('mock', MockAdapter);

        // Test with our special test chain
        const result = AdapterFactory.getAdaptersForChain(88888);

        // Should get the working adapter
        expect(result.adapters.length).toBe(1);
        expect(result.adapters[0]).toBeInstanceOf(MockAdapter);

        // Should track the failure
        expect(result.failures.length).toBe(1);
        expect(result.failures[0]).toEqual({
          platformId: 'failing',
          error: 'Adapter creation failed',
          errorDetails: expect.any(Error)
        });
        expect(result.failures[0].errorDetails.message).toBe('Adapter creation failed');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null chainId', () => {
        expect(() => {
          AdapterFactory.getAdaptersForChain(null);
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for undefined chainId', () => {
        expect(() => {
          AdapterFactory.getAdaptersForChain(undefined);
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for string chainId', () => {
        expect(() => {
          AdapterFactory.getAdaptersForChain('42161');
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for empty string chainId', () => {
        expect(() => {
          AdapterFactory.getAdaptersForChain('');
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for object chainId', () => {
        expect(() => {
          AdapterFactory.getAdaptersForChain({ chainId: 42161 });
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for array chainId', () => {
        expect(() => {
          AdapterFactory.getAdaptersForChain([42161]);
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for boolean chainId', () => {
        expect(() => {
          AdapterFactory.getAdaptersForChain(true);
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for zero chainId', () => {
        expect(() => {
          AdapterFactory.getAdaptersForChain(0);
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for NaN chainId', () => {
        // NaN is falsy, so !NaN is true, triggering our validation
        expect(() => {
          AdapterFactory.getAdaptersForChain(NaN);
        }).toThrow('chainId must be a valid number');
      });

      it('should return empty result for Infinity chainId', () => {
        // Infinity passes typeof check but isn't a valid chain
        const result = AdapterFactory.getAdaptersForChain(Infinity);

        expect(result).toBeDefined();
        expect(result.adapters.length).toBe(0);
        expect(result.failures.length).toBe(0);
      });

      it('should return empty result for negative Infinity chainId', () => {
        // -Infinity passes typeof check but isn't a valid chain
        const result = AdapterFactory.getAdaptersForChain(-Infinity);

        expect(result).toBeDefined();
        expect(result.adapters.length).toBe(0);
        expect(result.failures.length).toBe(0);
      });

      it('should return empty result for negative chainId', () => {
        const result = AdapterFactory.getAdaptersForChain(-1);

        expect(result).toBeDefined();
        expect(result.adapters.length).toBe(0);
        expect(result.failures.length).toBe(0);
      });
    });
  });

  describe('getAdapter', () => {
    describe('Success Cases', () => {
      it('should return UniswapV3Adapter for valid platform and chain', () => {
        const adapter = AdapterFactory.getAdapter('uniswapV3', 42161);

        expect(adapter).toBeDefined();
        expect(adapter).toBeInstanceOf(UniswapV3Adapter);
        expect(adapter.chainId).toBe(42161);
        expect(adapter.platformId).toBe('uniswapV3');
        expect(adapter.platformName).toBe('Uniswap V3');
      });

      it('should return adapter for Ethereum mainnet', () => {
        const adapter = AdapterFactory.getAdapter('uniswapV3', 1);

        expect(adapter).toBeDefined();
        expect(adapter).toBeInstanceOf(UniswapV3Adapter);
        expect(adapter.chainId).toBe(1);
      });

      it('should return adapter for test chain', () => {
        const adapter = AdapterFactory.getAdapter('uniswapV3', 1337);

        expect(adapter).toBeDefined();
        expect(adapter).toBeInstanceOf(UniswapV3Adapter);
        expect(adapter.chainId).toBe(1337);
      });

      it('should return registered custom adapter', () => {
        // Register a custom adapter
        AdapterFactory.registerAdapterForTestingOnly('mock', MockAdapter);

        const adapter = AdapterFactory.getAdapter('mock', 42161);

        expect(adapter).toBeDefined();
        expect(adapter).toBeInstanceOf(MockAdapter);
        expect(adapter.chainId).toBe(42161);
        expect(adapter.platformId).toBe('mock');
        expect(adapter.platformName).toBe('Mock Platform');
      });
    });

    describe('Error Cases - Platform ID Validation', () => {
      it('should throw error for null platformId', () => {
        expect(() => {
          AdapterFactory.getAdapter(null, 42161);
        }).toThrow('Platform ID must be a valid string');
      });

      it('should throw error for undefined platformId', () => {
        expect(() => {
          AdapterFactory.getAdapter(undefined, 42161);
        }).toThrow('Platform ID must be a valid string');
      });

      it('should throw error for empty string platformId', () => {
        expect(() => {
          AdapterFactory.getAdapter('', 42161);
        }).toThrow('Platform ID must be a valid string');
      });

      it('should throw error for number platformId', () => {
        expect(() => {
          AdapterFactory.getAdapter(123, 42161);
        }).toThrow('Platform ID must be a valid string');
      });

      it('should throw error for object platformId', () => {
        expect(() => {
          AdapterFactory.getAdapter({ platform: 'uniswapV3' }, 42161);
        }).toThrow('Platform ID must be a valid string');
      });

      it('should throw error for array platformId', () => {
        expect(() => {
          AdapterFactory.getAdapter(['uniswapV3'], 42161);
        }).toThrow('Platform ID must be a valid string');
      });

      it('should throw error for boolean platformId', () => {
        expect(() => {
          AdapterFactory.getAdapter(true, 42161);
        }).toThrow('Platform ID must be a valid string');
      });
    });

    describe('Error Cases - Chain ID Validation', () => {
      it('should throw error for null chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', null);
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for undefined chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', undefined);
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for string chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', '42161');
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for empty string chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', '');
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for object chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', { chainId: 42161 });
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for array chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', [42161]);
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for boolean chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', true);
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for zero chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', 0);
        }).toThrow('chainId must be a valid number');
      });

      it('should throw error for NaN chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', NaN);
        }).toThrow('chainId must be a valid number');
      });
    });

    describe('Error Cases - Platform Not Found', () => {
      it('should throw error for non-existent platform', () => {
        expect(() => {
          AdapterFactory.getAdapter('nonexistent', 42161);
        }).toThrow('No adapter available for platform: nonexistent');
      });

      it('should throw error for empty platform registry', () => {
        expect(() => {
          AdapterFactory.getAdapter('sushiswap', 42161);
        }).toThrow('No adapter available for platform: sushiswap');
      });
    });

    describe('Error Cases - Adapter Creation Failures', () => {
      it('should throw error when adapter creation fails', () => {
        // Register a failing adapter
        AdapterFactory.registerAdapterForTestingOnly('failing', FailingAdapter);

        expect(() => {
          AdapterFactory.getAdapter('failing', 42161);
        }).toThrow('Failed to create failing adapter for chain 42161: Adapter creation failed');
      });

      it('should throw error for unsupported chain', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', 999999);
        }).toThrow('Failed to create uniswapV3 adapter for chain 999999: Uniswap V3 not available on chain 999999');
      });

      it('should throw error for Infinity chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', Infinity);
        }).toThrow('Failed to create uniswapV3 adapter for chain Infinity: Uniswap V3 not available on chain Infinity');
      });

      it('should throw error for negative Infinity chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', -Infinity);
        }).toThrow('Failed to create uniswapV3 adapter for chain -Infinity: Uniswap V3 not available on chain -Infinity');
      });

      it('should throw error for negative chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', -1);
        }).toThrow('Failed to create uniswapV3 adapter for chain -1: Uniswap V3 not available on chain -1');
      });

      it('should throw error with custom adapter validation failure', () => {
        // Create an adapter that validates chainId more strictly
        class StrictAdapter {
          constructor(chainId) {
            if (chainId < 1 || chainId > 100000) {
              throw new Error("Chain ID must be between 1 and 100000");
            }
            this.chainId = chainId;
            this.platformId = 'strict';
          }
        }

        AdapterFactory.registerAdapterForTestingOnly('strict', StrictAdapter);

        expect(() => {
          AdapterFactory.getAdapter('strict', 200000);
        }).toThrow('Failed to create strict adapter for chain 200000: Chain ID must be between 1 and 100000');
      });
    });
  });

  describe('getSupportedPlatforms', () => {
    it('should return array of supported platform IDs', () => {
      const platforms = AdapterFactory.getSupportedPlatforms();

      expect(platforms).toBeDefined();
      expect(Array.isArray(platforms)).toBe(true);
      expect(platforms).toContain('uniswapV3');
      expect(platforms.length).toBeGreaterThan(0);
    });

    it('should include newly registered platforms', () => {
      // Register new adapter
      AdapterFactory.registerAdapterForTestingOnly('mock', MockAdapter);

      const platforms = AdapterFactory.getSupportedPlatforms();

      expect(platforms).toContain('mock');
      expect(platforms).toContain('uniswapV3');
      expect(platforms.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('hasAdapter', () => {
    it('should return true for existing uniswapV3 adapter', () => {
      expect(AdapterFactory.hasAdapter('uniswapV3')).toBe(true);
    });

    it('should return false for non-existent adapter and silly inputs', () => {
      expect(AdapterFactory.hasAdapter('nonexistent')).toBe(false);
      expect(AdapterFactory.hasAdapter(null)).toBe(false);
      expect(AdapterFactory.hasAdapter(undefined)).toBe(false);
      expect(AdapterFactory.hasAdapter(123)).toBe(false);
      expect(AdapterFactory.hasAdapter({ text: 'Claude is the bestest AI ever' })).toBe(false);
      expect(AdapterFactory.hasAdapter(['array'])).toBe(false);
      expect(AdapterFactory.hasAdapter(true)).toBe(false);
    });

    it('should return true for newly registered adapter', () => {
      AdapterFactory.registerAdapterForTestingOnly('mock', MockAdapter);
      expect(AdapterFactory.hasAdapter('mock')).toBe(true);
    });
  });
});
