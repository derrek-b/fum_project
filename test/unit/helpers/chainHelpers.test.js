/**
 * Chain Helpers Unit Tests
 *
 * Tests for chain configuration utilities and validation functions
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validateChainId,
  getChainConfig,
  getChainName,
  getChainRpcUrls,
  getExecutorAddress,
  isChainSupported,
  lookupSupportedChainIds,
  getPlatformAddresses,
  lookupChainPlatformIds,
  getMinDeploymentForGas
} from '../../../src/helpers/chainHelpers.js';

describe('Chain Helpers', () => {
  describe('validateChainId', () => {
    describe('Success Cases', () => {
      it('should accept valid positive integers', () => {
        expect(() => validateChainId(1)).not.toThrow();
        expect(() => validateChainId(42161)).not.toThrow();
        expect(() => validateChainId(1337)).not.toThrow();
      });

      it('should accept integers represented as floats (1.0, 42161.0)', () => {
        expect(() => validateChainId(1.0)).not.toThrow();
        expect(() => validateChainId(42161.0)).not.toThrow();
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null chainId', () => {
        expect(() => validateChainId(null)).toThrow('chainId parameter is required');
      });

      it('should throw error for undefined chainId', () => {
        expect(() => validateChainId(undefined)).toThrow('chainId parameter is required');
      });

      it('should throw error for string chainId', () => {
        expect(() => validateChainId('1')).toThrow('chainId must be a number');
        expect(() => validateChainId('ethereum')).toThrow('chainId must be a number');
      });

      it('should throw error for array chainId', () => {
        expect(() => validateChainId([1])).toThrow('chainId must be a number');
      });

      it('should throw error for object chainId', () => {
        expect(() => validateChainId({ chainId: 1 })).toThrow('chainId must be a number');
      });

      it('should throw error for boolean chainId', () => {
        expect(() => validateChainId(true)).toThrow('chainId must be a number');
        expect(() => validateChainId(false)).toThrow('chainId must be a number');
      });

      it('should throw error for NaN chainId', () => {
        expect(() => validateChainId(NaN)).toThrow('chainId must be a finite number');
      });

      it('should throw error for Infinity chainId', () => {
        expect(() => validateChainId(Infinity)).toThrow('chainId must be a finite number');
        expect(() => validateChainId(-Infinity)).toThrow('chainId must be a finite number');
      });

      it('should throw error for zero chainId', () => {
        expect(() => validateChainId(0)).toThrow('chainId must be greater than 0');
      });

      it('should throw error for negative chainId', () => {
        expect(() => validateChainId(-1)).toThrow('chainId must be greater than 0');
        expect(() => validateChainId(-42161)).toThrow('chainId must be greater than 0');
      });

      it('should throw error for decimal chainId', () => {
        expect(() => validateChainId(1.5)).toThrow('chainId must be an integer');
        expect(() => validateChainId(42161.123)).toThrow('chainId must be an integer');
      });
    });
  });

  describe('getChainConfig', () => {
    describe('Success Cases', () => {
      it('should return correct config for Ethereum mainnet (chainId 1)', () => {
        const config = getChainConfig(1);

        expect(config).toBeDefined();
        expect(typeof config).toBe('object');
        expect(config.name).toBe('Ethereum');
        expect(config.rpcUrls).toEqual(['https://cloudflare-eth.com']);
        expect(config.executorAddress).toBe('0x0');
        expect(config.platformAddresses).toHaveProperty('uniswapV3');
      });

      it('should return correct config for Arbitrum One (chainId 42161)', () => {
        const config = getChainConfig(42161);

        expect(config).toBeDefined();
        expect(typeof config).toBe('object');
        expect(config.name).toBe('Arbitrum One');
        expect(config.rpcUrls).toEqual(['https://arb1.arbitrum.io/rpc']);
        expect(config.executorAddress).toBe('0x0');
        expect(config.platformAddresses).toHaveProperty('uniswapV3');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getChainConfig(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should validate chainId parameter', () => {
        expect(() => getChainConfig(null)).toThrow('chainId parameter is required');
        expect(() => getChainConfig('1')).toThrow('chainId must be a number');
        expect(() => getChainConfig(-1)).toThrow('chainId must be greater than 0');
      });
    });
  });

  describe('getChainName', () => {
    describe('Success Cases', () => {
      it('should return "Ethereum" for chainId 1', () => {
        const name = getChainName(1);
        expect(name).toBe('Ethereum');
      });

      it('should return "Arbitrum One" for chainId 42161', () => {
        const name = getChainName(42161);
        expect(name).toBe('Arbitrum One');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getChainName(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should throw error for chains with missing or empty name', async () => {
        // Mock chains config with chain that has no name property
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            777: {
              // No name property
              rpcUrls: ['http://test.com'],
              executorAddress: '0x0'
            },
            888: {
              name: '', // Empty name
              rpcUrls: ['http://test.com'],
              executorAddress: '0x0'
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getChainName(777)).toThrow('Chain 777 name not configured');
        expect(() => chainHelpers.getChainName(888)).toThrow('Chain 888 name not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should validate chainId parameter', () => {
        expect(() => getChainName(null)).toThrow('chainId parameter is required');
        expect(() => getChainName('1')).toThrow('chainId must be a number');
        expect(() => getChainName(0)).toThrow('chainId must be greater than 0');
      });
    });
  });

  describe('getChainRpcUrls', () => {
    describe('Success Cases', () => {
      it('should return correct RPC URLs for Ethereum mainnet (chainId 1)', () => {
        const rpcUrls = getChainRpcUrls(1);

        expect(Array.isArray(rpcUrls)).toBe(true);
        expect(rpcUrls).toEqual(['https://cloudflare-eth.com']);
      });

      it('should return correct RPC URLs for Arbitrum One (chainId 42161)', () => {
        const rpcUrls = getChainRpcUrls(42161);

        expect(Array.isArray(rpcUrls)).toBe(true);
        expect(rpcUrls).toEqual(['https://arb1.arbitrum.io/rpc']);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getChainRpcUrls(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should throw error when no RPC URL is configured', async () => {
        // Mock chains config to include a chain without rpcUrls
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            555: {
              name: 'Test Chain Without RPC',
              executorAddress: '0x0'
              // No rpcUrls property
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getChainRpcUrls(555)).toThrow('No RPC URL configured for chain 555');

        // Restore original config
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw error for empty RPC URLs array', async () => {
        // Mock chains config with empty rpcUrls array
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            666: {
              name: 'Test Chain With Empty RPC Array',
              rpcUrls: [], // Empty array
              executorAddress: '0x0'
            },
            777: {
              name: 'Test Chain With Non-Array RPC',
              rpcUrls: 'not-an-array', // Not an array
              executorAddress: '0x0'
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getChainRpcUrls(666)).toThrow('Chain 666 RPC URLs not configured');
        expect(() => chainHelpers.getChainRpcUrls(777)).toThrow('Chain 777 RPC URLs not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should validate chainId parameter', () => {
        expect(() => getChainRpcUrls(null)).toThrow('chainId parameter is required');
        expect(() => getChainRpcUrls('1')).toThrow('chainId must be a number');
        expect(() => getChainRpcUrls(-1)).toThrow('chainId must be greater than 0');
      });
    });
  });

  describe('getExecutorAddress', () => {
    describe('Success Cases', () => {
      it('should return correct executor address for Forked Arbitrum (chainId 1337)', () => {
        const address = getExecutorAddress(1337);

        expect(typeof address).toBe('string');
        expect(address).toBe('0xabA472B2EA519490EE10E643A422D578a507197A');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getExecutorAddress(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should throw error for chains with 0x0 executor address', () => {
        expect(() => getExecutorAddress(1)).toThrow('No executor address configured for chain 1');
        expect(() => getExecutorAddress(42161)).toThrow('No executor address configured for chain 42161');
      });

      it('should throw error for chains with empty string executor address', async () => {
        // Mock chains config with empty string executor address
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain With Empty Executor',
              rpcUrls: ['http://test.com'],
              executorAddress: '' // Empty string
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getExecutorAddress(999)).toThrow('No executor address configured for chain 999');

        // Restore original config
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw error when no executor address property is configured', async () => {
        // Mock chains config to include a chain without executorAddress property
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            555: {
              name: 'Test Chain Without Executor',
              rpcUrls: ['http://test.com']
              // No executorAddress property
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getExecutorAddress(555)).toThrow('No executor address configured for chain 555');

        // Restore original config
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should validate chainId parameter', () => {
        expect(() => getExecutorAddress(null)).toThrow('chainId parameter is required');
        expect(() => getExecutorAddress('1')).toThrow('chainId must be a number');
        expect(() => getExecutorAddress(0)).toThrow('chainId must be greater than 0');
      });
    });
  });

  describe('isChainSupported', () => {
    describe('Success Cases', () => {
      it('should return true for Ethereum mainnet (chainId 1)', () => {
        expect(isChainSupported(1)).toBe(true);
      });

      it('should return true for Arbitrum One (chainId 42161)', () => {
        expect(isChainSupported(42161)).toBe(true);
      });

      it('should return false for unsupported chains', () => {
        expect(isChainSupported(999999)).toBe(false);
        expect(isChainSupported(888888)).toBe(false);
        expect(isChainSupported(137)).toBe(false); // Polygon - not configured
      });
    });

    describe('Error Cases', () => {
      it('should validate chainId parameter', () => {
        expect(() => isChainSupported(null)).toThrow('chainId parameter is required');
        expect(() => isChainSupported('1')).toThrow('chainId must be a number');
        expect(() => isChainSupported(-1)).toThrow('chainId must be greater than 0');
      });
    });
  });

  describe('lookupSupportedChainIds', () => {
    describe('Success Cases', () => {
      it('should return array containing the current configured chain IDs', () => {
        const chainIds = lookupSupportedChainIds();

        expect(Array.isArray(chainIds)).toBe(true);
        expect(chainIds).toContain(1);      // Ethereum
        expect(chainIds).toContain(42161);  // Arbitrum One
        expect(chainIds).toContain(1337);   // Forked Arbitrum

        chainIds.forEach(id => {
          expect(typeof id).toBe('number');
          expect(id).toBeGreaterThan(0);
        });
      });

      it('should return unique chain IDs', () => {
        const chainIds = lookupSupportedChainIds();
        const uniqueIds = [...new Set(chainIds)];

        expect(chainIds.length).toBe(uniqueIds.length);
      });
    });
  });

  describe('getPlatformAddresses', () => {
    describe('Success Cases', () => {
      it('should return correct UniswapV3 addresses for Ethereum mainnet (chainId 1)', () => {
        const addresses = getPlatformAddresses(1, 'uniswapV3');

        expect(addresses).toBeDefined();
        expect(typeof addresses).toBe('object');
        expect(addresses.enabled).toBe(true);
        expect(addresses.factoryAddress).toBe('0x1F98431c8aD98523631AE4a59f267346ea31F984');
        expect(addresses.positionManagerAddress).toBe('0xC36442b4a4522E871399CD717aBDD847Ab11FE88');
        expect(addresses.routerAddress).toBe('0xE592427A0AEce92De3Edee1F18E0157C05861564');
        expect(addresses.quoterAddress).toBe('0x61fFE014bA17989E743c5F6cB21bF9697530B21e');
      });

      it('should return correct UniswapV3 addresses for Arbitrum One (chainId 42161)', () => {
        const addresses = getPlatformAddresses(42161, 'uniswapV3');

        expect(addresses).toBeDefined();
        expect(typeof addresses).toBe('object');
        expect(addresses.enabled).toBe(true);
        expect(addresses.factoryAddress).toBe('0x1F98431c8aD98523631AE4a59f267346ea31F984');
        expect(addresses.positionManagerAddress).toBe('0xC36442b4a4522E871399CD717aBDD847Ab11FE88');
        expect(addresses.routerAddress).toBe('0xE592427A0AEce92De3Edee1F18E0157C05861564');
        expect(addresses.quoterAddress).toBe('0x61fFE014bA17989E743c5F6cB21bF9697530B21e');
      });

      it('should return null for disabled platform', async () => {
        // Mock chains config with disabled platform
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain With Disabled Platform',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                uniswapV3: {
                  factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                  enabled: false // Disabled platform
                }
              }
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(chainHelpers.getPlatformAddresses(999, 'uniswapV3')).toBeNull();

        // Restore original config
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getPlatformAddresses(999999, 'uniswapV3')).toThrow('Chain 999999 is not supported');
      });

      it('should throw error when no platformAddresses property is configured', async () => {
        // Mock chains config to include a chain without platformAddresses property
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            777: {
              name: 'Test Chain Without Platform Addresses',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123'
              // No platformAddresses property
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getPlatformAddresses(777, 'uniswapV3')).toThrow('No platform addresses configured for chain 777');

        // Restore original config
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw error for unconfigured platform', () => {
        expect(() => getPlatformAddresses(1, 'nonexistentPlatform')).toThrow('Platform nonexistentPlatform not configured for chain 1');
        expect(() => getPlatformAddresses(42161, 'aaveV3')).toThrow('Platform aaveV3 not configured for chain 42161');
        expect(() => getPlatformAddresses(1337, 'compound')).toThrow('Platform compound not configured for chain 1337');
      });

      it('should validate chainId parameter', () => {
        expect(() => getPlatformAddresses(null, 'uniswapV3')).toThrow('chainId parameter is required');
        expect(() => getPlatformAddresses('1', 'uniswapV3')).toThrow('chainId must be a number');
        expect(() => getPlatformAddresses(-1, 'uniswapV3')).toThrow('chainId must be greater than 0');
      });

      it('should validate platformId parameter', () => {
        expect(() => getPlatformAddresses(1, null)).toThrow('platformId parameter is required');
        expect(() => getPlatformAddresses(1, undefined)).toThrow('platformId parameter is required');
        expect(() => getPlatformAddresses(1, 123)).toThrow('platformId must be a string');
        expect(() => getPlatformAddresses(1, '')).toThrow('platformId cannot be empty');
      });
    });
  });

  describe('lookupChainPlatformIds', () => {
    describe('Success Cases', () => {
      it('should return array containing uniswapV3 for all supported chains', () => {
        const chain1Platforms = lookupChainPlatformIds(1);
        const chain42161Platforms = lookupChainPlatformIds(42161);
        const chain1337Platforms = lookupChainPlatformIds(1337);

        expect(Array.isArray(chain1Platforms)).toBe(true);
        expect(Array.isArray(chain42161Platforms)).toBe(true);
        expect(Array.isArray(chain1337Platforms)).toBe(true);

        expect(chain1Platforms).toContain('uniswapV3');
        expect(chain42161Platforms).toContain('uniswapV3');
        expect(chain1337Platforms).toContain('uniswapV3');
      });


      it('should only return enabled platforms', async () => {
        // Mock chains config with both enabled and disabled platforms
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain With Mixed Platforms',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                uniswapV3: {
                  factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                  enabled: true
                },
                aaveV3: {
                  factoryAddress: '0x789',
                  enabled: false
                },
                compound: {
                  factoryAddress: '0xabc',
                  enabled: true
                }
              }
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        const platformIds = chainHelpers.lookupChainPlatformIds(999);

        expect(platformIds).toContain('uniswapV3');
        expect(platformIds).toContain('compound');
        expect(platformIds).not.toContain('aaveV3'); // disabled platform should not be returned

        // Restore original config
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => lookupChainPlatformIds(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should throw error when no platformAddresses property is configured', async () => {
        // Mock chains config to include a chain without platformAddresses property
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            888: {
              name: 'Test Chain Without Platform Addresses',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123'
              // No platformAddresses property
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.lookupChainPlatformIds(888)).toThrow('No platform addresses configured for chain 888');

        // Restore original config
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should validate chainId parameter', () => {
        expect(() => lookupChainPlatformIds(null)).toThrow('chainId parameter is required');
        expect(() => lookupChainPlatformIds('1')).toThrow('chainId must be a number');
        expect(() => lookupChainPlatformIds(0)).toThrow('chainId must be greater than 0');
      });
    });
  });

  describe('getMinDeploymentForGas', () => {
    describe('Success Cases', () => {
      it('should return a number for valid chains', () => {
        expect(typeof getMinDeploymentForGas(1)).toBe('number');
        expect(typeof getMinDeploymentForGas(42161)).toBe('number');
        expect(typeof getMinDeploymentForGas(1337)).toBe('number');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getMinDeploymentForGas(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should throw error when minDeploymentForGas is not configured', async () => {
        // Mock chains config to include a chain without minDeploymentForGas property
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            777: {
              name: 'Test Chain Without Min Deployment',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                uniswapV3: { enabled: true, factoryAddress: '0x456' }
              }
              // No minDeploymentForGas property
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getMinDeploymentForGas(777)).toThrow('No minimum deployment amount configured for chain 777');

        // Restore original config
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should validate chainId parameter', () => {
        expect(() => getMinDeploymentForGas(null)).toThrow('chainId parameter is required');
        expect(() => getMinDeploymentForGas(undefined)).toThrow('chainId parameter is required');
        expect(() => getMinDeploymentForGas('1')).toThrow('chainId must be a number');
        expect(() => getMinDeploymentForGas(0)).toThrow('chainId must be greater than 0');
        expect(() => getMinDeploymentForGas(-1)).toThrow('chainId must be greater than 0');
      });
    });
  });
});
