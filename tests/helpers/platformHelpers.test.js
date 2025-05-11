import { describe, it, expect, vi } from 'vitest';
import platforms from '../../src/configs/platforms.js';
import chains from '../../src/configs/chains.js';
import * as chainHelpers from '../../src/helpers/chainHelpers.js';
import {
  getPlatformMetadata,
  getPlatformName,
  getPlatformColor,
  getPlatformLogo,
  getAvailablePlatforms,
  getPlatformById,
  platformSupportsTokens,
  getSupportedPlatformIds
} from '../../src/helpers/platformHelpers.js';

describe('platformHelpers', () => {
  // Get actual platform IDs from the config for testing
  const realPlatformIds = Object.keys(platforms);
  const firstPlatformId = realPlatformIds[0];
  
  // Get a valid chain ID that has platform configurations
  const realChainIds = Object.keys(chains).map(id => parseInt(id));
  const validChainId = realChainIds[0];
  
  describe('getPlatformMetadata', () => {
    it('should return the correct platform metadata for a valid platform ID', () => {
      const metadata = getPlatformMetadata(firstPlatformId);
      expect(metadata).toEqual(platforms[firstPlatformId]);
    });

    it('should return null for an invalid platform ID', () => {
      const metadata = getPlatformMetadata('nonexistent-platform');
      expect(metadata).toBeNull();
    });

    it('should return null for falsy platform ID', () => {
      expect(getPlatformMetadata(null)).toBeNull();
      expect(getPlatformMetadata(undefined)).toBeNull();
      expect(getPlatformMetadata('')).toBeNull();
    });
  });

  describe('getPlatformName', () => {
    it('should return the correct platform name for a valid platform ID', () => {
      const name = getPlatformName(firstPlatformId);
      expect(name).toBe(platforms[firstPlatformId].name);
    });

    it('should return the platform ID itself for an invalid platform ID', () => {
      const invalidId = 'nonexistent-platform';
      const name = getPlatformName(invalidId);
      expect(name).toBe(invalidId);
    });
  });

  describe('getPlatformColor', () => {
    it('should return the correct platform color for a valid platform ID', () => {
      const color = getPlatformColor(firstPlatformId);
      expect(color).toBe(platforms[firstPlatformId].color || "#6c757d");
    });

    it('should return default gray color for an invalid platform ID', () => {
      const color = getPlatformColor('nonexistent-platform');
      expect(color).toBe("#6c757d");
    });
  });

  describe('getPlatformLogo', () => {
    it('should return the correct platform logo for a valid platform ID', () => {
      const logo = getPlatformLogo(firstPlatformId);
      expect(logo).toBe(platforms[firstPlatformId].logo || null);
    });

    it('should return null for an invalid platform ID', () => {
      const logo = getPlatformLogo('nonexistent-platform');
      expect(logo).toBeNull();
    });
  });

  describe('getAvailablePlatforms', () => {
    it('should return an array of available platforms for a valid chain ID', () => {
      // Spy on getPlatformAddresses to verify it's being called correctly
      const spy = vi.spyOn(chainHelpers, 'getPlatformAddresses');
      
      const availablePlatforms = getAvailablePlatforms(validChainId);
      
      // Verify it's an array
      expect(Array.isArray(availablePlatforms)).toBe(true);
      
      // Each platform should have required properties
      availablePlatforms.forEach(platform => {
        expect(platform).toHaveProperty('id');
        expect(platform).toHaveProperty('name');
      });
      
      // Verify we called getPlatformAddresses for each platform
      expect(spy).toHaveBeenCalled();
      
      // Restore the spy
      spy.mockRestore();
    });

    it('should return an empty array for an invalid chain ID', () => {
      const availablePlatforms = getAvailablePlatforms(999999);
      expect(availablePlatforms).toEqual([]);
    });

    it('should return an empty array for falsy chain ID', () => {
      expect(getAvailablePlatforms(null)).toEqual([]);
      expect(getAvailablePlatforms(undefined)).toEqual([]);
      expect(getAvailablePlatforms(0)).toEqual([]);
    });
  });

  describe('getPlatformById', () => {
    it('should return the combined platform config for a valid platform and chain', () => {
      // We need to find a valid chain ID that has the firstPlatformId enabled
      let testChainId, testPlatformId;
      
      // Find a chain where a platform is enabled
      chainLoop:
      for (const [chainId, chainConfig] of Object.entries(chains)) {
        for (const [platformId, platformConfig] of Object.entries(chainConfig.platformAddresses || {})) {
          if (platformConfig && platformConfig.enabled) {
            testChainId = parseInt(chainId);
            testPlatformId = platformId;
            break chainLoop;
          }
        }
      }
      
      if (testChainId && testPlatformId) {
        const platform = getPlatformById(testPlatformId, testChainId);
        
        // Verify it has both metadata and address properties
        expect(platform).toHaveProperty('id', testPlatformId);
        expect(platform).toHaveProperty('name');
        expect(platform).toHaveProperty('factoryAddress');
        expect(platform).toHaveProperty('positionManagerAddress');
      } else {
        console.log('No enabled platforms found, skipping test');
      }
    });

    it('should return null for an invalid platform ID', () => {
      const platform = getPlatformById('nonexistent-platform', validChainId);
      expect(platform).toBeNull();
    });

    it('should return null for an invalid chain ID', () => {
      const platform = getPlatformById(firstPlatformId, 999999);
      expect(platform).toBeNull();
    });

    it('should return null for falsy inputs', () => {
      expect(getPlatformById(null, validChainId)).toBeNull();
      expect(getPlatformById(firstPlatformId, null)).toBeNull();
      expect(getPlatformById(undefined, validChainId)).toBeNull();
      expect(getPlatformById(firstPlatformId, undefined)).toBeNull();
    });
  });

  describe('platformSupportsTokens', () => {
    it('should return true by default (placeholder implementation)', () => {
      // Note: Current implementation always returns true as a placeholder
      const supported = platformSupportsTokens(firstPlatformId, ['USDC', 'WETH'], validChainId);
      expect(supported).toBe(true);
    });
  });

  describe('getSupportedPlatformIds', () => {
    it('should return an array of all supported platform IDs', () => {
      const platformIds = getSupportedPlatformIds();
      expect(platformIds).toEqual(realPlatformIds);
    });

    it('should match the keys from the platforms config', () => {
      const platformIds = getSupportedPlatformIds();
      expect(platformIds).toEqual(Object.keys(platforms));
    });
  });
});