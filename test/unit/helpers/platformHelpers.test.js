/**
 * Platform Helpers Unit Tests
 *
 * Tests for platform configuration utilities and validation functions
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validateChainId,
  validatePlatformId,
  getPlatformMetadata,
  getPlatformName,
  getPlatformColor,
  getPlatformLogo,
  getAvailablePlatforms,
  lookupPlatformById,
  getPlatformFeeTiers,
  lookupSupportedPlatformIds
} from '../../../src/helpers/platformHelpers.js';

describe('Platform Helpers', () => {
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

  describe('validatePlatformId', () => {
    describe('Success Cases', () => {
      it('should accept valid platform strings', () => {
        expect(() => validatePlatformId('uniswapV3')).not.toThrow();
        expect(() => validatePlatformId('aaveV3')).not.toThrow();
        expect(() => validatePlatformId('unknownPlatform')).not.toThrow();
      });

      it('should accept single character strings', () => {
        expect(() => validatePlatformId('a')).not.toThrow();
        expect(() => validatePlatformId('1')).not.toThrow();
      });

      it('should accept strings with special characters', () => {
        expect(() => validatePlatformId('uniswap-v3')).not.toThrow();
        expect(() => validatePlatformId('platform_test')).not.toThrow();
        expect(() => validatePlatformId('platform.test')).not.toThrow();
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null platformId', () => {
        expect(() => validatePlatformId(null)).toThrow('platformId parameter is required');
      });

      it('should throw error for undefined platformId', () => {
        expect(() => validatePlatformId(undefined)).toThrow('platformId parameter is required');
      });

      it('should throw error for number platformId', () => {
        expect(() => validatePlatformId(1)).toThrow('platformId must be a string');
        expect(() => validatePlatformId(123)).toThrow('platformId must be a string');
        expect(() => validatePlatformId(0)).toThrow('platformId must be a string');
      });

      it('should throw error for boolean platformId', () => {
        expect(() => validatePlatformId(true)).toThrow('platformId must be a string');
        expect(() => validatePlatformId(false)).toThrow('platformId must be a string');
      });

      it('should throw error for array platformId', () => {
        expect(() => validatePlatformId(['uniswapV3'])).toThrow('platformId must be a string');
        expect(() => validatePlatformId([])).toThrow('platformId must be a string');
      });

      it('should throw error for object platformId', () => {
        expect(() => validatePlatformId({ platform: 'uniswapV3' })).toThrow('platformId must be a string');
        expect(() => validatePlatformId({})).toThrow('platformId must be a string');
      });

      it('should throw error for empty string platformId', () => {
        expect(() => validatePlatformId('')).toThrow('platformId cannot be empty');
      });

      it('should throw error for special values', () => {
        expect(() => validatePlatformId(NaN)).toThrow('platformId must be a string');
        expect(() => validatePlatformId(Infinity)).toThrow('platformId must be a string');
        expect(() => validatePlatformId(-Infinity)).toThrow('platformId must be a string');
      });
    });
  });

  describe('getPlatformMetadata', () => {
    describe('Success Cases', () => {
      it('should return metadata for known platforms', () => {
        const metadata = getPlatformMetadata('uniswapV3');

        // Test full structure is there
        expect(metadata).toBeDefined();
        expect(typeof metadata).toBe('object');

        // Test actual values
        expect(metadata.id).toBe('uniswapV3');
        expect(metadata.name).toBe('Uniswap V3');
        expect(metadata.logo).toBe('/Platform_Logos/uniswap.svg');
        expect(metadata.color).toBe('#FF007A');
        expect(metadata.description).toBe('Uniswap V3 concentrated liquidity positions');

        // Test fee tiers array and values
        expect(Array.isArray(metadata.feeTiers)).toBe(true);
        expect(metadata.feeTiers).toEqual([100, 500, 3000, 10000]);

        // Test features object structure
        expect(typeof metadata.features).toBe('object');
        expect(metadata.features.concentratedLiquidity).toBe(true);
        expect(metadata.features.multipleFeeTiers).toBe(true);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported platform', () => {
        expect(() => getPlatformMetadata('unknownPlatform')).toThrow('Platform unknownPlatform is not supported');
      });

      it('should validate platformId parameter', () => {
        expect(() => getPlatformMetadata(null)).toThrow('platformId parameter is required');
        expect(() => getPlatformMetadata('')).toThrow('platformId cannot be empty');
        expect(() => getPlatformMetadata(123)).toThrow('platformId must be a string');
      });
    });
  });

  describe('getPlatformName', () => {
    describe('Success Cases', () => {
      it('should return actual name for known platforms', () => {
        const name = getPlatformName('uniswapV3');
        expect(typeof name).toBe('string');
        expect(name).toBe('Uniswap V3');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unknown platforms', () => {
        expect(() => getPlatformName('unknownPlatform')).toThrow('Platform unknownPlatform is not supported');
      });

      it('should throw error for platforms with missing or empty name', async () => {
        // Mock platforms config with platform that has no name property
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithoutName: {
              id: 'platformWithoutName',
              // No name property
              color: '#000000'
            },
            platformWithEmptyName: {
              id: 'platformWithEmptyName',
              name: '', // Empty name
              color: '#000000'
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.getPlatformName('platformWithoutName')).toThrow('Platform platformWithoutName name not configured');
        expect(() => platformHelpers.getPlatformName('platformWithEmptyName')).toThrow('Platform platformWithEmptyName name not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.resetModules();
      });

      it('should validate platformId parameter', () => {
        expect(() => getPlatformName(null)).toThrow('platformId parameter is required');
        expect(() => getPlatformName('')).toThrow('platformId cannot be empty');
        expect(() => getPlatformName(123)).toThrow('platformId must be a string');
      });
    });
  });

  describe('getPlatformColor', () => {
    describe('Success Cases', () => {
      it('should return actual color for known platforms', () => {
        const color = getPlatformColor('uniswapV3');
        expect(typeof color).toBe('string');
        expect(color).toBe('#FF007A');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unknown platforms', () => {
        expect(() => getPlatformColor('unknownPlatform')).toThrow('Platform unknownPlatform is not supported');
      });

      it('should throw error for platforms with missing or empty color', async () => {
        // Mock platforms config with platform that has no color property
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithoutColor: {
              id: 'platformWithoutColor',
              name: 'Platform Without Color'
              // No color property
            },
            platformWithEmptyColor: {
              id: 'platformWithEmptyColor',
              name: 'Platform With Empty Color',
              color: '' // Empty color
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.getPlatformColor('platformWithoutColor')).toThrow('Platform platformWithoutColor color not configured');
        expect(() => platformHelpers.getPlatformColor('platformWithEmptyColor')).toThrow('Platform platformWithEmptyColor color not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.resetModules();
      });

      it('should validate platformId parameter', () => {
        expect(() => getPlatformColor(null)).toThrow('platformId parameter is required');
        expect(() => getPlatformColor('')).toThrow('platformId cannot be empty');
        expect(() => getPlatformColor(123)).toThrow('platformId must be a string');
      });
    });
  });

  describe('getPlatformLogo', () => {
    describe('Success Cases', () => {
      it('should return actual logo URL for known platforms', () => {
        const logo = getPlatformLogo('uniswapV3');
        expect(typeof logo).toBe('string');
        expect(logo).toBe('/Platform_Logos/uniswap.svg');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unknown platforms', () => {
        expect(() => getPlatformLogo('unknownPlatform')).toThrow('Platform unknownPlatform is not supported');
      });

      it('should throw error for platforms with missing or empty logo', async () => {
        // Mock platforms config with platform that has no logo property
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithoutLogo: {
              id: 'platformWithoutLogo',
              name: 'Platform Without Logo',
              color: '#000000'
              // No logo property
            },
            platformWithEmptyLogo: {
              id: 'platformWithEmptyLogo',
              name: 'Platform With Empty Logo',
              color: '#000000',
              logo: '' // Empty logo
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.getPlatformLogo('platformWithoutLogo')).toThrow('Platform platformWithoutLogo logo not configured');
        expect(() => platformHelpers.getPlatformLogo('platformWithEmptyLogo')).toThrow('Platform platformWithEmptyLogo logo not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.resetModules();
      });

      it('should validate platformId parameter', () => {
        expect(() => getPlatformLogo(null)).toThrow('platformId parameter is required');
        expect(() => getPlatformLogo('')).toThrow('platformId cannot be empty');
        expect(() => getPlatformLogo(123)).toThrow('platformId must be a string');
      });
    });
  });

  describe('getPlatformFeeTiers', () => {
    describe('Success Cases', () => {
      it('should return array of fee tiers for known platforms', () => {
        const feeTiers = getPlatformFeeTiers('uniswapV3');
        expect(Array.isArray(feeTiers)).toBe(true);
        expect(feeTiers).toEqual([100, 500, 3000, 10000]);

        // Test all values are numbers and positive
        feeTiers.forEach(tier => {
          expect(typeof tier).toBe('number');
          expect(tier).toBeGreaterThan(0);
        });
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unknown platforms', () => {
        expect(() => getPlatformFeeTiers('unknownPlatform')).toThrow('Platform unknownPlatform is not supported');
      });

      it('should throw error for platforms with missing or invalid feeTiers', async () => {
        // Mock platforms config with platform missing feeTiers
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithoutFeeTiers: {
              id: 'platformWithoutFeeTiers',
              name: 'Platform Without Fee Tiers',
              logo: '/test-logo.svg',
              color: '#FF007A',
              description: 'Test description',
              features: { test: true }
              // No feeTiers property
            },
            platformWithInvalidFeeTiers: {
              id: 'platformWithInvalidFeeTiers',
              name: 'Platform With Invalid Fee Tiers',
              logo: '/test-logo.svg',
              color: '#FF007A',
              description: 'Test description',
              features: { test: true },
              feeTiers: 'not-an-array' // String instead of array
            },
            platformWithEmptyFeeTiers: {
              id: 'platformWithEmptyFeeTiers',
              name: 'Platform With Empty Fee Tiers',
              logo: '/test-logo.svg',
              color: '#FF007A',
              description: 'Test description',
              features: { test: true },
              feeTiers: [] // Empty array
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.getPlatformFeeTiers('platformWithoutFeeTiers')).toThrow('Platform platformWithoutFeeTiers feeTiers not configured');
        expect(() => platformHelpers.getPlatformFeeTiers('platformWithInvalidFeeTiers')).toThrow('Platform platformWithInvalidFeeTiers feeTiers not configured');
        expect(() => platformHelpers.getPlatformFeeTiers('platformWithEmptyFeeTiers')).toThrow('Platform platformWithEmptyFeeTiers feeTiers not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.resetModules();
      });

      it('should validate platformId parameter', () => {
        expect(() => getPlatformFeeTiers(null)).toThrow('platformId parameter is required');
        expect(() => getPlatformFeeTiers('')).toThrow('platformId cannot be empty');
        expect(() => getPlatformFeeTiers(123)).toThrow('platformId must be a string');
      });
    });
  });

  describe('getAvailablePlatforms', () => {
    describe('Success Cases', () => {
      it('should return array of available platforms for supported chains', () => {
        const platforms = getAvailablePlatforms(1);
        expect(Array.isArray(platforms)).toBe(true);
        expect(platforms.length).toBeGreaterThan(0);

        // Test the actual uniswapV3 platform values from config
        const uniswapV3 = platforms.find(p => p.id === 'uniswapV3');
        expect(uniswapV3).toBeDefined();

        // Test metadata values from platforms config
        expect(uniswapV3.id).toBe('uniswapV3');
        expect(uniswapV3.name).toBe('Uniswap V3');
        expect(uniswapV3.logo).toBe('/Platform_Logos/uniswap.svg');
        expect(uniswapV3.color).toBe('#FF007A');
        expect(uniswapV3.description).toBe('Uniswap V3 concentrated liquidity positions');

        // Test address values from chains config (Ethereum mainnet)
        expect(uniswapV3.factoryAddress).toBe('0x1F98431c8aD98523631AE4a59f267346ea31F984');
        expect(uniswapV3.positionManagerAddress).toBe('0xC36442b4a4522E871399CD717aBDD847Ab11FE88');
        expect(uniswapV3.routerAddress).toBe('0xE592427A0AEce92De3Edee1F18E0157C05861564');
        expect(uniswapV3.quoterAddress).toBe('0x61fFE014bA17989E743c5F6cB21bF9697530B21e');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chains', () => {
        expect(() => getAvailablePlatforms(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should throw error for platform with missing name', async () => {
        // Mock platforms config with platform missing name property
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithoutName: {
              id: 'platformWithoutName',
              // No name property
              logo: '/test-logo.svg',
              color: '#FF007A',
              description: 'Test description'
            }
          }
        }));

        // Mock chains config with platform addresses
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                platformWithoutName: {
                  factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                  positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
                  routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
                  quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
                  enabled: true
                }
              }
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.getAvailablePlatforms(999)).toThrow('Platform platformWithoutName name not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw error for platform with missing logo', async () => {
        // Mock platforms config with platform missing logo property
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithoutLogo: {
              id: 'platformWithoutLogo',
              name: 'Platform Without Logo',
              // No logo property
              color: '#FF007A',
              description: 'Test description'
            }
          }
        }));

        // Mock chains config with platform addresses
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                platformWithoutLogo: {
                  factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                  positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
                  routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
                  quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
                  enabled: true
                }
              }
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.getAvailablePlatforms(999)).toThrow('Platform platformWithoutLogo logo not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw error for platform with missing color', async () => {
        // Mock platforms config with platform missing color property
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithoutColor: {
              id: 'platformWithoutColor',
              name: 'Platform Without Color',
              logo: '/test-logo.svg',
              // No color property
              description: 'Test description'
            }
          }
        }));

        // Mock chains config with platform addresses
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                platformWithoutColor: {
                  factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                  positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
                  routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
                  quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
                  enabled: true
                }
              }
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.getAvailablePlatforms(999)).toThrow('Platform platformWithoutColor color not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw error for platform with missing description', async () => {
        // Mock platforms config with platform missing description property
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithoutDescription: {
              id: 'platformWithoutDescription',
              name: 'Platform Without Description',
              logo: '/test-logo.svg',
              color: '#FF007A'
              // No description property
            }
          }
        }));

        // Mock chains config with platform addresses
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                platformWithoutDescription: {
                  factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                  positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
                  routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
                  quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
                  enabled: true
                }
              }
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.getAvailablePlatforms(999)).toThrow('Platform platformWithoutDescription description not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should validate chainId parameter', () => {
        expect(() => getAvailablePlatforms(null)).toThrow('chainId parameter is required');
        expect(() => getAvailablePlatforms('1')).toThrow('chainId must be a number');
        expect(() => getAvailablePlatforms(-1)).toThrow('chainId must be greater than 0');
      });
    });
  });

  describe('lookupPlatformById', () => {
    describe('Success Cases', () => {
      it('should return complete platform config for valid platform and chain', () => {
        const platform = lookupPlatformById('uniswapV3', 1);
        expect(platform).toBeDefined();

        // Test actual values from configs
        expect(platform.id).toBe('uniswapV3');
        expect(platform.name).toBe('Uniswap V3');
        expect(platform.logo).toBe('/Platform_Logos/uniswap.svg');
        expect(platform.color).toBe('#FF007A');
        expect(platform.description).toBe('Uniswap V3 concentrated liquidity positions');

        // Test address values from chains config (Ethereum mainnet)
        expect(platform.factoryAddress).toBe('0x1F98431c8aD98523631AE4a59f267346ea31F984');
        expect(platform.positionManagerAddress).toBe('0xC36442b4a4522E871399CD717aBDD847Ab11FE88');
        expect(platform.routerAddress).toBe('0xE592427A0AEce92De3Edee1F18E0157C05861564');
        expect(platform.quoterAddress).toBe('0x61fFE014bA17989E743c5F6cB21bF9697530B21e');

        // Test features and feeTiers structure
        expect(typeof platform.features).toBe('object');
        expect(platform.features.concentratedLiquidity).toBe(true);
        expect(platform.features.multipleFeeTiers).toBe(true);
        expect(Array.isArray(platform.feeTiers)).toBe(true);
        expect(platform.feeTiers).toEqual([100, 500, 3000, 10000]);
      });

      it('should return null for platform not available on chain', async () => {
        // Mock platforms config with a platform that exists
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            testPlatform: {
              id: 'testPlatform',
              name: 'Test Platform',
              logo: '/test-logo.svg',
              color: '#FF007A',
              description: 'Test description',
              features: { test: true },
              feeTiers: [500]
            }
          }
        }));

        // Mock chains config where the platform is not configured for chain 1
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            1: {
              name: 'Ethereum',
              rpcUrls: ['https://cloudflare-eth.com'],
              executorAddress: '0x0',
              platformAddresses: {
                // testPlatform is not configured for this chain
              }
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        const platform = platformHelpers.lookupPlatformById('testPlatform', 1);
        expect(platform).toBeNull();

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => lookupPlatformById('uniswapV3', 999999)).toThrow('Chain 999999 is not supported');
      });

      it('should throw error for platform with missing name', async () => {
        // Mock platforms config with platform missing name
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithoutName: {
              id: 'platformWithoutName',
              // No name property
              logo: '/test-logo.svg',
              color: '#FF007A',
              description: 'Test description',
              features: { test: true },
              feeTiers: [500]
            }
          }
        }));

        // Mock chains config with platform addresses
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                platformWithoutName: {
                  factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                  positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
                  routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
                  quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
                  enabled: true
                }
              }
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.lookupPlatformById('platformWithoutName', 999)).toThrow('Platform platformWithoutName name not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw error for platform with missing logo', async () => {
        // Mock platforms config with platform missing logo
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithoutLogo: {
              id: 'platformWithoutLogo',
              name: 'Platform Without Logo',
              // No logo property
              color: '#FF007A',
              description: 'Test description',
              features: { test: true },
              feeTiers: [500]
            }
          }
        }));

        // Mock chains config with platform addresses
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                platformWithoutLogo: {
                  factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                  positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
                  routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
                  quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
                  enabled: true
                }
              }
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.lookupPlatformById('platformWithoutLogo', 999)).toThrow('Platform platformWithoutLogo logo not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw error for platform with missing color', async () => {
        // Mock platforms config with platform missing color
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithoutColor: {
              id: 'platformWithoutColor',
              name: 'Platform Without Color',
              logo: '/test-logo.svg',
              // No color property
              description: 'Test description',
              features: { test: true },
              feeTiers: [500]
            }
          }
        }));

        // Mock chains config with platform addresses
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                platformWithoutColor: {
                  factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                  positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
                  routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
                  quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
                  enabled: true
                }
              }
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.lookupPlatformById('platformWithoutColor', 999)).toThrow('Platform platformWithoutColor color not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw error for platform with missing description', async () => {
        // Mock platforms config with platform missing description
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithoutDescription: {
              id: 'platformWithoutDescription',
              name: 'Platform Without Description',
              logo: '/test-logo.svg',
              color: '#FF007A',
              // No description property
              features: { test: true },
              feeTiers: [500]
            }
          }
        }));

        // Mock chains config with platform addresses
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                platformWithoutDescription: {
                  factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                  positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
                  routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
                  quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
                  enabled: true
                }
              }
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.lookupPlatformById('platformWithoutDescription', 999)).toThrow('Platform platformWithoutDescription description not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw error for platform with invalid features', async () => {
        // Mock platforms config with platform with invalid features
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithInvalidFeatures: {
              id: 'platformWithInvalidFeatures',
              name: 'Platform With Invalid Features',
              logo: '/test-logo.svg',
              color: '#FF007A',
              description: 'Test description',
              features: [], // Array instead of object
              feeTiers: [500]
            }
          }
        }));

        // Mock chains config with platform addresses
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                platformWithInvalidFeatures: {
                  factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                  positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
                  routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
                  quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
                  enabled: true
                }
              }
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.lookupPlatformById('platformWithInvalidFeatures', 999)).toThrow('Platform platformWithInvalidFeatures features not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should throw error for platform with invalid feeTiers', async () => {
        // Mock platforms config with platform with invalid feeTiers
        vi.doMock('../../../src/configs/platforms.js', () => ({
          default: {
            platformWithInvalidFeeTiers: {
              id: 'platformWithInvalidFeeTiers',
              name: 'Platform With Invalid Fee Tiers',
              logo: '/test-logo.svg',
              color: '#FF007A',
              description: 'Test description',
              features: { test: true },
              feeTiers: 'not-an-array' // String instead of array
            }
          }
        }));

        // Mock chains config with platform addresses
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            999: {
              name: 'Test Chain',
              rpcUrls: ['http://test.com'],
              executorAddress: '0x123',
              platformAddresses: {
                platformWithInvalidFeeTiers: {
                  factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                  positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
                  routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
                  quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
                  enabled: true
                }
              }
            }
          }
        }));

        // Reset modules to use the mocked config
        vi.resetModules();
        const platformHelpers = await import('../../../src/helpers/platformHelpers.js');

        expect(() => platformHelpers.lookupPlatformById('platformWithInvalidFeeTiers', 999)).toThrow('Platform platformWithInvalidFeeTiers feeTiers not configured');

        // Restore original config
        vi.doUnmock('../../../src/configs/platforms.js');
        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should validate both platformId and chainId parameters', () => {
        expect(() => lookupPlatformById(null, 1)).toThrow('platformId parameter is required');
        expect(() => lookupPlatformById('uniswapV3', null)).toThrow('chainId parameter is required');
        expect(() => lookupPlatformById('', 1)).toThrow('platformId cannot be empty');
        expect(() => lookupPlatformById('uniswapV3', -1)).toThrow('chainId must be greater than 0');
      });
    });
  });

  describe('lookupSupportedPlatformIds', () => {
    describe('Success Cases', () => {
      it('should return array of platform IDs', () => {
        const platformIds = lookupSupportedPlatformIds();
        expect(Array.isArray(platformIds)).toBe(true);

        platformIds.forEach(id => {
          expect(typeof id).toBe('string');
          expect(id.length).toBeGreaterThan(0);
        });
      });

      it('should include known platforms', () => {
        const platformIds = lookupSupportedPlatformIds();
        expect(platformIds).toContain('uniswapV3');
      });
    });
  });
});
