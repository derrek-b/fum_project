/**
 * Chain Helpers Unit Tests
 *
 * Tests for chain configuration utilities and validation functions
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  validateChainId,
  getChainConfig,
  getChainName,
  getChainRpcUrls,
  getExecutorXpub,
  getMinExecutorBalance,
  getMaxExecutorBalance,
  isChainSupported,
  isLocalChain,
  lookupSupportedChainIds,
  getPlatformAddresses,
  lookupChainPlatformIds,
  getMinDeploymentForGas,
  getMinSwapValue,
  getTransactionDeadlineMinutes,
  getMaxPriorityFeePerGas,
  getExpectedBlockMs,
  configureChainHelpers
} from '../../../src/helpers/chainHelpers.js';

describe('Chain Helpers', () => {
  describe('validateChainId', () => {
    describe('Success Cases', () => {
      it('should accept valid positive integers', () => {
        expect(() => validateChainId(1)).not.toThrow();
        expect(() => validateChainId(42161)).not.toThrow();
        expect(() => validateChainId(1337)).not.toThrow();
        expect(() => validateChainId(1338)).not.toThrow();
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
      it('should return correct config for Arbitrum One (chainId 42161)', () => {
        const config = getChainConfig(42161);

        expect(config).toBeDefined();
        expect(typeof config).toBe('object');
        expect(config.name).toBe('Arbitrum One');
        expect(config.rpcUrls).toEqual(['https://arb-mainnet.g.alchemy.com/v2']);  // Base URL - API key appended by getChainRpcUrls()
        expect(config.executorXpub).toBe('');
        expect(config.minExecutorBalance).toBe(0.002);
        expect(config.maxExecutorBalance).toBe(0.004);
        expect(config.expectedBlockMs).toBe(250);
        expect(config.platformAddresses).toHaveProperty('uniswapV3');
      });

      it('should return correct config for Avalanche (chainId 43114)', () => {
        const config = getChainConfig(43114);

        expect(config).toBeDefined();
        expect(typeof config).toBe('object');
        expect(config.name).toBe('Avalanche');
        expect(config.rpcUrls).toEqual(['https://avax-mainnet.g.alchemy.com/v2']);
        expect(config.executorXpub).toBe('');
        expect(config.minExecutorBalance).toBe(0.04);
        expect(config.maxExecutorBalance).toBe(0.08);
        expect(config.expectedBlockMs).toBe(2000);
        expect(config.platformAddresses).toHaveProperty('traderjoeV2_2');
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
      it('should return "Arbitrum One" for chainId 42161', () => {
        const name = getChainName(42161);
        expect(name).toBe('Arbitrum One');
      });

      it('should return "Avalanche" for chainId 43114', () => {
        const name = getChainName(43114);
        expect(name).toBe('Avalanche');
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
      it('should return correct RPC URLs for Arbitrum One (chainId 42161) with API key appended', () => {
        // Configure API key for test using the new configure pattern
        configureChainHelpers({ alchemyApiKey: 'test-api-key-123' });

        const rpcUrls = getChainRpcUrls(42161);

        expect(Array.isArray(rpcUrls)).toBe(true);
        expect(rpcUrls).toEqual(['https://arb-mainnet.g.alchemy.com/v2/test-api-key-123']);
      });

      it('should return correct RPC URLs for Avalanche (chainId 43114) with API key appended', () => {
        // Configure API key for test using the new configure pattern
        configureChainHelpers({ alchemyApiKey: 'test-api-key-123' });

        const rpcUrls = getChainRpcUrls(43114);

        expect(Array.isArray(rpcUrls)).toBe(true);
        expect(rpcUrls).toEqual(['https://avax-mainnet.g.alchemy.com/v2/test-api-key-123']);
      });

      it('should return static RPC URLs for local fork (chainId 1337) without modification', () => {
        const rpcUrls = getChainRpcUrls(1337);

        expect(Array.isArray(rpcUrls)).toBe(true);
        expect(rpcUrls).toEqual(['http://localhost:8545']);
      });

      it('should return static RPC URLs for local Avalanche fork (chainId 1338) without modification', () => {
        const rpcUrls = getChainRpcUrls(1338);

        expect(Array.isArray(rpcUrls)).toBe(true);
        expect(rpcUrls).toEqual(['http://localhost:8546']);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getChainRpcUrls(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should throw error for Arbitrum (chainId 42161) when API key is not configured', () => {
        // Clear API key configuration for test
        configureChainHelpers({ alchemyApiKey: null });

        expect(() => getChainRpcUrls(42161)).toThrow('Alchemy API key not configured');
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

  describe('getExecutorXpub', () => {
    describe('Success Cases', () => {
      it('should return correct xpub for Forked Arbitrum (chainId 1337)', () => {
        const xpub = getExecutorXpub(1337);

        expect(typeof xpub).toBe('string');
        expect(xpub.startsWith('xpub')).toBe(true);
        expect(xpub).toBe('xpub6F8xskVEWJTqZB69U3UmjGe8zwoXUefq5YCBgpyS2xf4CFEzNX4zUbxYBqZLdC96gEayShKc9f9rhgnNhSMtzADf8x4HX8Wia4AjBmqAPir');
      });

      it('should return correct xpub for Forked Avalanche (chainId 1338)', () => {
        const xpub = getExecutorXpub(1338);

        expect(typeof xpub).toBe('string');
        expect(xpub.startsWith('xpub')).toBe(true);
        expect(xpub).toBe('xpub6F8xskVEWJTqZB69U3UmjGe8zwoXUefq5YCBgpyS2xf4CFEzNX4zUbxYBqZLdC96gEayShKc9f9rhgnNhSMtzADf8x4HX8Wia4AjBmqAPir');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getExecutorXpub(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should throw error for chains with empty xpub', () => {
        // Arbitrum production has empty xpub until deployment
        expect(() => getExecutorXpub(42161)).toThrow('No executor xpub configured for chain 42161');
        // Avalanche also not configured
        expect(() => getExecutorXpub(43114)).toThrow('No executor xpub configured for chain 43114');
      });

      it('should throw error when no executorXpub property is configured', async () => {
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            555: {
              name: 'Test Chain Without Xpub',
              rpcUrls: ['http://test.com']
              // No executorXpub property
            }
          }
        }));

        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getExecutorXpub(555)).toThrow('No executor xpub configured for chain 555');

        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should validate chainId parameter', () => {
        expect(() => getExecutorXpub(null)).toThrow('chainId parameter is required');
        expect(() => getExecutorXpub('1')).toThrow('chainId must be a number');
        expect(() => getExecutorXpub(0)).toThrow('chainId must be greater than 0');
      });
    });
  });

  describe('getMinExecutorBalance', () => {
    describe('Success Cases', () => {
      it('should return a positive number for valid chains', () => {
        expect(typeof getMinExecutorBalance(42161)).toBe('number');
        expect(getMinExecutorBalance(42161)).toBeGreaterThan(0);
        expect(typeof getMinExecutorBalance(1337)).toBe('number');
        expect(getMinExecutorBalance(1337)).toBeGreaterThan(0);
        expect(typeof getMinExecutorBalance(1338)).toBe('number');
        expect(getMinExecutorBalance(1338)).toBeGreaterThan(0);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getMinExecutorBalance(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should validate chainId parameter', () => {
        expect(() => getMinExecutorBalance(null)).toThrow('chainId parameter is required');
        expect(() => getMinExecutorBalance('1')).toThrow('chainId must be a number');
      });
    });
  });

  describe('getMaxExecutorBalance', () => {
    describe('Success Cases', () => {
      it('should return a positive number for valid chains', () => {
        expect(typeof getMaxExecutorBalance(42161)).toBe('number');
        expect(getMaxExecutorBalance(42161)).toBeGreaterThan(0);
        expect(typeof getMaxExecutorBalance(1338)).toBe('number');
        expect(getMaxExecutorBalance(1338)).toBeGreaterThan(0);
      });

      it('should be greater than or equal to minExecutorBalance', () => {
        const min = getMinExecutorBalance(42161);
        const max = getMaxExecutorBalance(42161);
        expect(max).toBeGreaterThanOrEqual(min);

        const min1338 = getMinExecutorBalance(1338);
        const max1338 = getMaxExecutorBalance(1338);
        expect(max1338).toBeGreaterThanOrEqual(min1338);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getMaxExecutorBalance(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should validate chainId parameter', () => {
        expect(() => getMaxExecutorBalance(null)).toThrow('chainId parameter is required');
        expect(() => getMaxExecutorBalance('1')).toThrow('chainId must be a number');
      });
    });
  });

  describe('getMaxPriorityFeePerGas', () => {
    describe('Success Cases', () => {
      it('should return a string for valid chains', () => {
        expect(typeof getMaxPriorityFeePerGas(42161)).toBe('string');
        expect(typeof getMaxPriorityFeePerGas(43114)).toBe('string');
      });

      it('should return "0" for Arbitrum (sequencer ignores tips)', () => {
        expect(getMaxPriorityFeePerGas(42161)).toBe('0');
        expect(getMaxPriorityFeePerGas(1337)).toBe('0');
      });

      it('should return "1000" for Avalanche (near-zero priority, 1000 wei/gas)', () => {
        expect(getMaxPriorityFeePerGas(43114)).toBe('1000');
        expect(getMaxPriorityFeePerGas(1338)).toBe('1000');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getMaxPriorityFeePerGas(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should validate chainId parameter', () => {
        expect(() => getMaxPriorityFeePerGas(null)).toThrow('chainId parameter is required');
        expect(() => getMaxPriorityFeePerGas('1')).toThrow('chainId must be a number');
      });
    });
  });

  describe('isChainSupported', () => {
    describe('Success Cases', () => {
      it('should return true for Arbitrum One (chainId 42161)', () => {
        expect(isChainSupported(42161)).toBe(true);
      });

      it('should return true for Avalanche (chainId 43114)', () => {
        expect(isChainSupported(43114)).toBe(true);
      });

      it('should return true for Forked Avalanche (chainId 1338)', () => {
        expect(isChainSupported(1338)).toBe(true);
      });

      it('should return false for unsupported chains', () => {
        expect(isChainSupported(999999)).toBe(false);
        expect(isChainSupported(888888)).toBe(false);
        expect(isChainSupported(137)).toBe(false); // Polygon - not configured
        expect(isChainSupported(1)).toBe(false); // Ethereum - removed
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

  describe('isLocalChain', () => {
    describe('Success Cases', () => {
      it('should return true for Forked Arbitrum (chainId 1337)', () => {
        expect(isLocalChain(1337)).toBe(true);
      });

      it('should return true for Forked Avalanche (chainId 1338)', () => {
        expect(isLocalChain(1338)).toBe(true);
      });

      it('should return false for Arbitrum One (chainId 42161)', () => {
        expect(isLocalChain(42161)).toBe(false);
      });

      it('should return false for Avalanche (chainId 43114)', () => {
        expect(isLocalChain(43114)).toBe(false);
      });
    });

    describe('Error Cases', () => {
      it('should validate chainId parameter', () => {
        expect(() => isLocalChain(null)).toThrow('chainId parameter is required');
        expect(() => isLocalChain('1')).toThrow('chainId must be a number');
        expect(() => isLocalChain(-1)).toThrow('chainId must be greater than 0');
      });
    });
  });

  describe('lookupSupportedChainIds', () => {
    describe('Success Cases', () => {
      it('should return array containing the current configured chain IDs', () => {
        const chainIds = lookupSupportedChainIds();

        expect(Array.isArray(chainIds)).toBe(true);
        expect(chainIds).toContain(42161);  // Arbitrum One
        expect(chainIds).toContain(43114);  // Avalanche
        expect(chainIds).toContain(1337);   // Forked Arbitrum
        expect(chainIds).toContain(1338);   // Forked Avalanche

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
      it('should return correct UniswapV3 addresses for Arbitrum One (chainId 42161)', () => {
        const addresses = getPlatformAddresses(42161, 'uniswapV3');

        expect(addresses).toBeDefined();
        expect(typeof addresses).toBe('object');
        expect(addresses.factoryAddress).toBe('0x1F98431c8aD98523631AE4a59f267346ea31F984');
        expect(addresses.positionManagerAddress).toBe('0xC36442b4a4522E871399CD717aBDD847Ab11FE88');
        expect(addresses.routerAddress).toBe('0xE592427A0AEce92De3Edee1F18E0157C05861564');
        expect(addresses.quoterAddress).toBe('0x61fFE014bA17989E743c5F6cB21bF9697530B21e');
      });

      it('should return correct Trader Joe V2.2 addresses for Avalanche (chainId 43114)', () => {
        const addresses = getPlatformAddresses(43114, 'traderjoeV2_2');

        expect(addresses).toBeDefined();
        expect(typeof addresses).toBe('object');
        expect(addresses.lbFactoryAddress).toBe('0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c');
        expect(addresses.lbRouterAddress).toBe('0x18556DA13313f3532c54711497A8FedAC273220E');
        expect(addresses.lbQuoterAddress).toBe('0x9A550a522BBaDFB69019b0432800Ed17855A51C3');
        expect(addresses.positionManagerAddress).toBe('0xb782f215aB9C9B40287998Ce9cC0a127Ecd7B78C');
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
        expect(() => getPlatformAddresses(42161, 'nonexistentPlatform')).toThrow('Platform nonexistentPlatform not configured for chain 42161');
        expect(() => getPlatformAddresses(42161, 'aaveV3')).toThrow('Platform aaveV3 not configured for chain 42161');
        expect(() => getPlatformAddresses(1337, 'compound')).toThrow('Platform compound not configured for chain 1337');
      });

      it('should validate chainId parameter', () => {
        expect(() => getPlatformAddresses(null, 'uniswapV3')).toThrow('chainId parameter is required');
        expect(() => getPlatformAddresses('1', 'uniswapV3')).toThrow('chainId must be a number');
        expect(() => getPlatformAddresses(-1, 'uniswapV3')).toThrow('chainId must be greater than 0');
      });

      it('should validate platformId parameter', () => {
        expect(() => getPlatformAddresses(42161, null)).toThrow('platformId parameter is required');
        expect(() => getPlatformAddresses(42161, undefined)).toThrow('platformId parameter is required');
        expect(() => getPlatformAddresses(42161, 123)).toThrow('platformId must be a string');
        expect(() => getPlatformAddresses(42161, '')).toThrow('platformId cannot be empty');
      });
    });
  });

  describe('lookupChainPlatformIds', () => {
    describe('Success Cases', () => {
      it('should return array containing expected platforms for supported chains', () => {
        const chain42161Platforms = lookupChainPlatformIds(42161);
        const chain1337Platforms = lookupChainPlatformIds(1337);
        const chain43114Platforms = lookupChainPlatformIds(43114);
        const chain1338Platforms = lookupChainPlatformIds(1338);

        expect(Array.isArray(chain42161Platforms)).toBe(true);
        expect(Array.isArray(chain1337Platforms)).toBe(true);
        expect(Array.isArray(chain43114Platforms)).toBe(true);
        expect(Array.isArray(chain1338Platforms)).toBe(true);

        expect(chain42161Platforms).toContain('uniswapV3');
        expect(chain1337Platforms).toContain('uniswapV3');
        expect(chain43114Platforms).toContain('traderjoeV2_2');
        expect(chain1338Platforms).toContain('traderjoeV2_2');
      });

      it('should return all configured platforms', async () => {
        // Mock chains config with multiple platforms
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain With Multiple Platforms',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                uniswapV3: {
                  factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                },
                aaveV3: {
                  factoryAddress: '0x789',
                },
                compound: {
                  factoryAddress: '0xabc',
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
        expect(platformIds).toContain('aaveV3');
        expect(platformIds).toContain('compound');
        expect(platformIds).toHaveLength(3);

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
        expect(typeof getMinDeploymentForGas(42161)).toBe('number');
        expect(typeof getMinDeploymentForGas(43114)).toBe('number');
        expect(typeof getMinDeploymentForGas(1337)).toBe('number');
        expect(typeof getMinDeploymentForGas(1338)).toBe('number');
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
                uniswapV3: { factoryAddress: '0x456' }
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

  describe('getMinSwapValue', () => {
    describe('Success Cases', () => {
      it('should return a number for valid chains', () => {
        expect(typeof getMinSwapValue(42161)).toBe('number');
        expect(typeof getMinSwapValue(43114)).toBe('number');
        expect(typeof getMinSwapValue(1337)).toBe('number');
        expect(typeof getMinSwapValue(1338)).toBe('number');
      });

      it('should return expected values for each chain', () => {
        expect(getMinSwapValue(42161)).toBe(10);    // Arbitrum
        expect(getMinSwapValue(1337)).toBe(10);     // Local Arbitrum
        expect(getMinSwapValue(43114)).toBe(0.10);  // Avalanche
        expect(getMinSwapValue(1338)).toBe(0.10);   // Local Avalanche
      });

      it('should return values >= 0', () => {
        expect(getMinSwapValue(42161)).toBeGreaterThanOrEqual(0);
        expect(getMinSwapValue(43114)).toBeGreaterThanOrEqual(0);
        expect(getMinSwapValue(1337)).toBeGreaterThanOrEqual(0);
        expect(getMinSwapValue(1338)).toBeGreaterThanOrEqual(0);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getMinSwapValue(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should throw error when minSwapValue is not configured', async () => {
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            777: {
              name: 'Test Chain',
              rpcUrl: 'http://localhost:8545',
              // minSwapValue intentionally missing
            }
          }
        }));

        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getMinSwapValue(777)).toThrow('No minimum swap value configured for chain 777');

        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should validate chainId parameter', () => {
        expect(() => getMinSwapValue(null)).toThrow('chainId parameter is required');
        expect(() => getMinSwapValue(undefined)).toThrow('chainId parameter is required');
        expect(() => getMinSwapValue('1')).toThrow('chainId must be a number');
        expect(() => getMinSwapValue(0)).toThrow('chainId must be greater than 0');
        expect(() => getMinSwapValue(-1)).toThrow('chainId must be greater than 0');
      });
    });
  });

  describe('getTransactionDeadlineMinutes', () => {
    describe('Success Cases', () => {
      it('should return a number for valid chains', () => {
        expect(typeof getTransactionDeadlineMinutes(42161)).toBe('number');
        expect(typeof getTransactionDeadlineMinutes(43114)).toBe('number');
        expect(typeof getTransactionDeadlineMinutes(1337)).toBe('number');
        expect(typeof getTransactionDeadlineMinutes(1338)).toBe('number');
      });

      it('should return expected values for each chain', () => {
        expect(getTransactionDeadlineMinutes(42161)).toBe(5);   // Arbitrum - fast L2
        expect(getTransactionDeadlineMinutes(1337)).toBe(5);    // Local fork (Arbitrum)
        expect(getTransactionDeadlineMinutes(43114)).toBe(5);   // Avalanche
        expect(getTransactionDeadlineMinutes(1338)).toBe(5);    // Local fork (Avalanche)
      });

      it('should return values > 0', () => {
        expect(getTransactionDeadlineMinutes(42161)).toBeGreaterThan(0);
        expect(getTransactionDeadlineMinutes(43114)).toBeGreaterThan(0);
        expect(getTransactionDeadlineMinutes(1337)).toBeGreaterThan(0);
        expect(getTransactionDeadlineMinutes(1338)).toBeGreaterThan(0);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getTransactionDeadlineMinutes(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should throw error when transactionDeadlineMinutes is not configured', async () => {
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            777: {
              name: 'Test Chain',
              rpcUrl: 'http://localhost:8545',
              // transactionDeadlineMinutes intentionally missing
            }
          }
        }));

        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getTransactionDeadlineMinutes(777)).toThrow('No transaction deadline configured for chain 777');

        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should validate chainId parameter', () => {
        expect(() => getTransactionDeadlineMinutes(null)).toThrow('chainId parameter is required');
        expect(() => getTransactionDeadlineMinutes(undefined)).toThrow('chainId parameter is required');
        expect(() => getTransactionDeadlineMinutes('1')).toThrow('chainId must be a number');
        expect(() => getTransactionDeadlineMinutes(0)).toThrow('chainId must be greater than 0');
        expect(() => getTransactionDeadlineMinutes(-1)).toThrow('chainId must be greater than 0');
      });
    });
  });

  describe('getExpectedBlockMs', () => {
    describe('Success Cases', () => {
      it('should return 250 for Arbitrum One (chainId 42161)', () => {
        expect(getExpectedBlockMs(42161)).toBe(250);
      });

      it('should return 2000 for Avalanche (chainId 43114)', () => {
        expect(getExpectedBlockMs(43114)).toBe(2000);
      });

      it('should return null for Hardhat Arbitrum fork (chainId 1337)', () => {
        expect(getExpectedBlockMs(1337)).toBeNull();
      });

      it('should return null for Hardhat Avalanche fork (chainId 1338)', () => {
        expect(getExpectedBlockMs(1338)).toBeNull();
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getExpectedBlockMs(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should throw when expectedBlockMs property is missing from config', async () => {
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            777: {
              name: 'Test Chain',
              // expectedBlockMs intentionally missing
            }
          }
        }));

        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getExpectedBlockMs(777)).toThrow('No expectedBlockMs configured for chain 777');

        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw when expectedBlockMs is a non-positive number', async () => {
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            777: {
              name: 'Test Chain',
              expectedBlockMs: 0,
            }
          }
        }));

        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getExpectedBlockMs(777)).toThrow('expectedBlockMs for chain 777 must be null or a positive finite number');

        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw when expectedBlockMs is a negative number', async () => {
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            777: {
              name: 'Test Chain',
              expectedBlockMs: -100,
            }
          }
        }));

        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getExpectedBlockMs(777)).toThrow('expectedBlockMs for chain 777 must be null or a positive finite number');

        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw when expectedBlockMs is a non-number type', async () => {
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            777: {
              name: 'Test Chain',
              expectedBlockMs: '250',
            }
          }
        }));

        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getExpectedBlockMs(777)).toThrow('expectedBlockMs for chain 777 must be null or a positive finite number');

        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw when expectedBlockMs is Infinity', async () => {
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            777: {
              name: 'Test Chain',
              expectedBlockMs: Infinity,
            }
          }
        }));

        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getExpectedBlockMs(777)).toThrow('expectedBlockMs for chain 777 must be null or a positive finite number');

        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should validate chainId parameter', () => {
        expect(() => getExpectedBlockMs(null)).toThrow('chainId parameter is required');
        expect(() => getExpectedBlockMs(undefined)).toThrow('chainId parameter is required');
        expect(() => getExpectedBlockMs('1')).toThrow('chainId must be a number');
        expect(() => getExpectedBlockMs(0)).toThrow('chainId must be greater than 0');
        expect(() => getExpectedBlockMs(-1)).toThrow('chainId must be greater than 0');
      });
    });
  });
});

// Config-injection tests: guards that fire when a chain entry exists but a
// required field (minExecutorBalance, maxExecutorBalance, maxPriorityFeePerGas)
// is missing or invalid. Real chains all have these, so we inject a synthetic
// chain. chainHelpers is pre-loaded via init.js, hence doMock + resetModules.
describe('chainHelpers — config-injection tests', () => {
  let mockedChainHelpers;
  const BROKEN_CHAIN_ID = 77777;

  beforeAll(async () => {
    vi.doMock('../../../src/configs/chains.js', () => ({
      default: {
        [BROKEN_CHAIN_ID]: {
          name: 'Broken Chain',
          // Intentionally missing minExecutorBalance, maxExecutorBalance,
          // and maxPriorityFeePerGas. Other fields are irrelevant for these tests.
        },
      },
    }));
    vi.resetModules();
    mockedChainHelpers = await import('../../../src/helpers/chainHelpers.js');
  });

  afterAll(() => {
    vi.doUnmock('../../../src/configs/chains.js');
    vi.resetModules();
  });

  it('getMinExecutorBalance throws when the field is missing or invalid', () => {
    expect(() => mockedChainHelpers.getMinExecutorBalance(BROKEN_CHAIN_ID))
      .toThrow(`No minimum executor balance configured for chain ${BROKEN_CHAIN_ID}`);
  });

  it('getMaxExecutorBalance throws when the field is missing or invalid', () => {
    expect(() => mockedChainHelpers.getMaxExecutorBalance(BROKEN_CHAIN_ID))
      .toThrow(`No maximum executor balance configured for chain ${BROKEN_CHAIN_ID}`);
  });

  it('getMaxPriorityFeePerGas throws when the field is missing', () => {
    expect(() => mockedChainHelpers.getMaxPriorityFeePerGas(BROKEN_CHAIN_ID))
      .toThrow(`No maxPriorityFeePerGas configured for chain ${BROKEN_CHAIN_ID}`);
  });
});
