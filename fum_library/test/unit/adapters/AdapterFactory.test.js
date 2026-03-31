/**
 * AdapterFactory Unit Tests
 *
 * Tests for AdapterFactory methods: getAdaptersForChain, getAdapter,
 * getSupportedPlatforms, hasAdapter
 */

import { describe, it, expect, vi } from 'vitest';

// Mock chainHelpers at module scope (vi.mock is hoisted by vitest).
// Only intercepts the synthetic chain 88888; all real chains pass through.
vi.mock('../../../src/helpers/chainHelpers.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    lookupChainPlatformIds: (chainId) => {
      if (chainId === 88888) {
        return ['failing', 'mock', 'unregistered'];
      }
      return actual.lookupChainPlatformIds(chainId);
    },
    getChainConfig: (chainId) => {
      if (chainId === 88888) {
        return { name: 'Test Chain' };
      }
      return actual.getChainConfig(chainId);
    }
  };
});

import AdapterFactory from '../../../src/adapters/AdapterFactory.js';
import UniswapV3Adapter from '../../../src/adapters/UniswapV3Adapter.js';
import UniswapV4Adapter from '../../../src/adapters/UniswapV4Adapter.js';
import TraderJoeV2_2Adapter from '../../../src/adapters/TraderJoeV2_2Adapter.js';

// Create a failing adapter class for testing error handling
class FailingAdapter {
  constructor() {
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
        expect(result.adapters.length).toBe(2); // V3 and V4 (Trader Joe is on Avalanche, not Arbitrum)
        expect(result.failures.length).toBe(0);

        // Check for V3 and V4 adapters
        const v3Adapter = result.adapters.find(a => a instanceof UniswapV3Adapter);
        const v4Adapter = result.adapters.find(a => a instanceof UniswapV4Adapter);
        expect(v3Adapter).toBeDefined();
        expect(v4Adapter).toBeDefined();
        expect(v3Adapter.chainId).toBe(42161);
        expect(v4Adapter.chainId).toBe(42161);
      });

      it('should return adapters for Avalanche (43114)', () => {
        const result = AdapterFactory.getAdaptersForChain(43114);

        expect(result).toBeDefined();
        expect(result).toHaveProperty('adapters');
        expect(result).toHaveProperty('failures');
        expect(Array.isArray(result.adapters)).toBe(true);
        expect(Array.isArray(result.failures)).toBe(true);
        expect(result.adapters.length).toBe(1); // Trader Joe V2.2 only
        expect(result.failures.length).toBe(0);

        // Check for Trader Joe adapter
        const tjAdapter = result.adapters.find(a => a instanceof TraderJoeV2_2Adapter);
        expect(tjAdapter).toBeDefined();
        expect(tjAdapter.chainId).toBe(43114);
        expect(tjAdapter.platformId).toBe('traderjoeV2_2');
        expect(tjAdapter.platformName).toBe('Trader Joe V2.2');

        // Uniswap adapters should NOT be present on Avalanche
        const v3Adapter = result.adapters.find(a => a instanceof UniswapV3Adapter);
        const v4Adapter = result.adapters.find(a => a instanceof UniswapV4Adapter);
        expect(v3Adapter).toBeUndefined();
        expect(v4Adapter).toBeUndefined();
      });

      it('should return adapters for local test chain (1337)', () => {
        const result = AdapterFactory.getAdaptersForChain(1337);

        expect(result).toBeDefined();
        expect(result.adapters.length).toBe(2); // V3, V4 (Arbitrum fork)
        expect(result.failures.length).toBe(0);

        // Check for V3 and V4 adapters
        const v3Adapter = result.adapters.find(a => a instanceof UniswapV3Adapter);
        const v4Adapter = result.adapters.find(a => a instanceof UniswapV4Adapter);
        expect(v3Adapter).toBeDefined();
        expect(v4Adapter).toBeDefined();
        expect(v3Adapter.chainId).toBe(1337);
        expect(v4Adapter.chainId).toBe(1337);
      });

      it('should return adapters for local Avalanche test chain (1338)', () => {
        const result = AdapterFactory.getAdaptersForChain(1338);

        expect(result).toBeDefined();
        expect(result.adapters.length).toBe(1); // Trader Joe V2.2 only (Avalanche fork)
        expect(result.failures.length).toBe(0);

        // Check for Trader Joe adapter
        const tjAdapter = result.adapters.find(a => a instanceof TraderJoeV2_2Adapter);
        expect(tjAdapter).toBeDefined();
        expect(tjAdapter.chainId).toBe(1338);
        expect(tjAdapter.platformId).toBe('traderjoeV2_2');

        // Uniswap adapters should NOT be present on Avalanche fork
        const v3Adapter = result.adapters.find(a => a instanceof UniswapV3Adapter);
        const v4Adapter = result.adapters.find(a => a instanceof UniswapV4Adapter);
        expect(v3Adapter).toBeUndefined();
        expect(v4Adapter).toBeUndefined();
      });

      it('should throw error for unsupported chain', () => {
        expect(() => {
          AdapterFactory.getAdaptersForChain(999999);
        }).toThrow('Chain 999999 is not supported');
      });

      it('should handle failures gracefully and return working adapters', () => {
        // Register a failing adapter
        AdapterFactory.registerAdapterForTestingOnly('failing', FailingAdapter);

        // Test with a chain that has uniswapV3 and uniswapV4
        const result = AdapterFactory.getAdaptersForChain(42161);

        // Should still get the working adapters (V3 and V4)
        expect(result.adapters.length).toBe(2);
        const v3Adapter = result.adapters.find(a => a instanceof UniswapV3Adapter);
        const v4Adapter = result.adapters.find(a => a instanceof UniswapV4Adapter);
        expect(v3Adapter).toBeDefined();
        expect(v4Adapter).toBeDefined();

        // No failures because failing adapter isn't configured for this chain
        expect(result.failures.length).toBe(0);
      });

      it('should track failures when adapter creation fails', () => {
        // Uses mock chain 88888 which returns ['failing', 'mock', 'unregistered']
        AdapterFactory.registerAdapterForTestingOnly('failing', FailingAdapter);
        AdapterFactory.registerAdapterForTestingOnly('mock', MockAdapter);

        const result = AdapterFactory.getAdaptersForChain(88888);

        // Should get the working adapter
        expect(result.adapters.length).toBe(1);
        expect(result.adapters[0]).toBeInstanceOf(MockAdapter);

        // Should track the failure for 'failing' adapter
        expect(result.failures.length).toBe(1);
        expect(result.failures[0]).toEqual({
          platformId: 'failing',
          error: 'Adapter creation failed',
          errorDetails: expect.any(Error)
        });
        expect(result.failures[0].errorDetails.message).toBe('Adapter creation failed');
      });

      it('should silently skip platform IDs with no registered adapter class', () => {
        // Mock chain 88888 returns ['failing', 'mock', 'unregistered'].
        // 'unregistered' has no adapter class — should be skipped, not a failure.
        AdapterFactory.registerAdapterForTestingOnly('failing', FailingAdapter);
        AdapterFactory.registerAdapterForTestingOnly('mock', MockAdapter);

        const result = AdapterFactory.getAdaptersForChain(88888);

        // 'unregistered' should NOT appear in failures — it's silently skipped
        const unregisteredFailure = result.failures.find(f => f.platformId === 'unregistered');
        expect(unregisteredFailure).toBeUndefined();

        // Only 'failing' should be in failures, 'mock' in adapters
        expect(result.adapters.length).toBe(1);
        expect(result.failures.length).toBe(1);
        expect(result.failures[0].platformId).toBe('failing');
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

      it('should throw error for Infinity chainId', () => {
        // Infinity fails finite number validation
        expect(() => {
          AdapterFactory.getAdaptersForChain(Infinity);
        }).toThrow('chainId must be a finite number');
      });

      it('should throw error for negative Infinity chainId', () => {
        // -Infinity fails finite number validation
        expect(() => {
          AdapterFactory.getAdaptersForChain(-Infinity);
        }).toThrow('chainId must be a finite number');
      });

      it('should throw error for negative chainId', () => {
        expect(() => {
          AdapterFactory.getAdaptersForChain(-1);
        }).toThrow('chainId must be greater than 0');
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

      it('should return UniswapV4Adapter for valid platform and chain', () => {
        const adapter = AdapterFactory.getAdapter('uniswapV4', 42161);

        expect(adapter).toBeDefined();
        expect(adapter).toBeInstanceOf(UniswapV4Adapter);
        expect(adapter.chainId).toBe(42161);
        expect(adapter.platformId).toBe('uniswapV4');
        expect(adapter.platformName).toBe('Uniswap V4');
      });

      it('should return adapter for test chain', () => {
        const adapter = AdapterFactory.getAdapter('uniswapV3', 1337);

        expect(adapter).toBeDefined();
        expect(adapter).toBeInstanceOf(UniswapV3Adapter);
        expect(adapter.chainId).toBe(1337);
      });

      it('should return TraderJoeV2_2Adapter for Avalanche (43114)', () => {
        const adapter = AdapterFactory.getAdapter('traderjoeV2_2', 43114);

        expect(adapter).toBeDefined();
        expect(adapter).toBeInstanceOf(TraderJoeV2_2Adapter);
        expect(adapter.chainId).toBe(43114);
        expect(adapter.platformId).toBe('traderjoeV2_2');
        expect(adapter.platformName).toBe('Trader Joe V2.2');
      });

      it('should return TraderJoeV2_2Adapter for local Avalanche test chain (1338)', () => {
        const adapter = AdapterFactory.getAdapter('traderjoeV2_2', 1338);

        expect(adapter).toBeDefined();
        expect(adapter).toBeInstanceOf(TraderJoeV2_2Adapter);
        expect(adapter.chainId).toBe(1338);
        expect(adapter.platformId).toBe('traderjoeV2_2');
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
        }).toThrow('Failed to create uniswapV3 adapter for chain 999999: Chain 999999 is not supported');
      });

      it('should throw error for Infinity chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', Infinity);
        }).toThrow('Failed to create uniswapV3 adapter for chain Infinity: chainId must be a finite number');
      });

      it('should throw error for negative Infinity chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', -Infinity);
        }).toThrow('Failed to create uniswapV3 adapter for chain -Infinity: chainId must be a finite number');
      });

      it('should throw error for negative chainId', () => {
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', -1);
        }).toThrow('Failed to create uniswapV3 adapter for chain -1: chainId must be greater than 0');
      });

      it('should throw error for Uniswap V3 on Avalanche chain (43114)', () => {
        // Uniswap V3 is not deployed on Avalanche
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', 43114);
        }).toThrow('Failed to create uniswapV3 adapter for chain 43114: Platform uniswapV3 not configured for chain 43114');
      });

      it('should throw error for Uniswap V3 on Avalanche fork (1338)', () => {
        // Uniswap V3 is not deployed on Avalanche fork
        expect(() => {
          AdapterFactory.getAdapter('uniswapV3', 1338);
        }).toThrow('Failed to create uniswapV3 adapter for chain 1338: Platform uniswapV3 not configured for chain 1338');
      });

      it('should throw error for Uniswap V4 on Avalanche chain (43114)', () => {
        // Uniswap V4 is not deployed on Avalanche
        expect(() => {
          AdapterFactory.getAdapter('uniswapV4', 43114);
        }).toThrow('Failed to create uniswapV4 adapter for chain 43114: Platform uniswapV4 not configured for chain 43114');
      });

      it('should throw error for Uniswap V4 on Avalanche fork (1338)', () => {
        // Uniswap V4 is not deployed on Avalanche fork
        expect(() => {
          AdapterFactory.getAdapter('uniswapV4', 1338);
        }).toThrow('Failed to create uniswapV4 adapter for chain 1338: Platform uniswapV4 not configured for chain 1338');
      });

      it('should throw error for Trader Joe on Arbitrum chain (42161)', () => {
        // Trader Joe is not deployed on Arbitrum
        expect(() => {
          AdapterFactory.getAdapter('traderjoeV2_2', 42161);
        }).toThrow('Failed to create traderjoeV2_2 adapter for chain 42161: Platform traderjoeV2_2 not configured for chain 42161');
      });

      it('should throw error for Trader Joe on Arbitrum fork (1337)', () => {
        // Trader Joe is not deployed on Arbitrum fork
        expect(() => {
          AdapterFactory.getAdapter('traderjoeV2_2', 1337);
        }).toThrow('Failed to create traderjoeV2_2 adapter for chain 1337: Platform traderjoeV2_2 not configured for chain 1337');
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
      expect(platforms).toContain('uniswapV4');
      expect(platforms).toContain('traderjoeV2_2');
      expect(platforms.length).toBeGreaterThanOrEqual(3);
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

    it('should return true for existing uniswapV4 adapter', () => {
      expect(AdapterFactory.hasAdapter('uniswapV4')).toBe(true);
    });

    it('should return true for existing traderjoeV2_2 adapter', () => {
      expect(AdapterFactory.hasAdapter('traderjoeV2_2')).toBe(true);
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
