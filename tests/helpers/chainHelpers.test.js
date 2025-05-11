import { describe, it, expect } from 'vitest';
import chains from '../../src/configs/chains.js';
import {
  getChainConfig,
  getChainName,
  getChainRpcUrl,
  getExecutorAddress,
  isChainSupported,
  getSupportedChainIds,
  getPlatformAddresses,
  getChainPlatformIds
} from '../../src/helpers/chainHelpers.js';

describe('chainHelpers', () => {
  // Get actual chain IDs from the config for testing
  const realChainIds = Object.keys(chains).map(id => parseInt(id));
  const firstChainId = realChainIds[0];
  
  describe('getChainConfig', () => {
    it('should return the correct chain config for a valid chain ID', () => {
      const config = getChainConfig(firstChainId);
      expect(config).toEqual(chains[firstChainId]);
    });

    it('should return null for an invalid chain ID', () => {
      const config = getChainConfig(999999); // Non-existent chain ID
      expect(config).toBeNull();
    });

    it('should return null for falsy chain ID', () => {
      expect(getChainConfig(null)).toBeNull();
      expect(getChainConfig(undefined)).toBeNull();
      expect(getChainConfig(0)).toBeNull(); // Assuming 0 is not a valid chain ID
    });
  });

  describe('getChainName', () => {
    it('should return the correct chain name for a valid chain ID', () => {
      const name = getChainName(firstChainId);
      expect(name).toBe(chains[firstChainId].name);
    });

    it('should return "Unknown Chain" for an invalid chain ID', () => {
      const name = getChainName(999999); // Non-existent chain ID
      expect(name).toBe("Unknown Chain");
    });
  });

  describe('getChainRpcUrl', () => {
    it('should return the correct RPC URL for a valid chain ID', () => {
      const url = getChainRpcUrl(firstChainId);
      expect(url).toBe(chains[firstChainId].rpcUrl);
    });

    it('should return null for an invalid chain ID', () => {
      const url = getChainRpcUrl(999999); // Non-existent chain ID
      expect(url).toBeNull();
    });
  });

  describe('getExecutorAddress', () => {
    it('should return the correct executor address for a valid chain ID', () => {
      const address = getExecutorAddress(firstChainId);
      expect(address).toBe(chains[firstChainId].executorAddress);
    });

    it('should return null for an invalid chain ID', () => {
      const address = getExecutorAddress(999999); // Non-existent chain ID
      expect(address).toBeNull();
    });

    it('should return null for falsy chain ID', () => {
      expect(getExecutorAddress(null)).toBeNull();
      expect(getExecutorAddress(undefined)).toBeNull();
    });
  });

  describe('isChainSupported', () => {
    it('should return true for a supported chain ID', () => {
      const supported = isChainSupported(firstChainId);
      expect(supported).toBe(true);
    });

    it('should return false for an unsupported chain ID', () => {
      const supported = isChainSupported(999999); // Non-existent chain ID
      expect(supported).toBe(false);
    });
  });

  describe('getSupportedChainIds', () => {
    it('should return an array of all supported chain IDs', () => {
      const chainIds = getSupportedChainIds();
      expect(chainIds).toEqual(realChainIds);
      expect(chainIds.length).toBe(realChainIds.length);
    });

    it('should return chain IDs as numbers, not strings', () => {
      const chainIds = getSupportedChainIds();
      chainIds.forEach(id => {
        expect(typeof id).toBe('number');
      });
    });
  });

  describe('getPlatformAddresses', () => {
    it('should return platform addresses for a valid chain and platform', () => {
      // Get first chain and first enabled platform
      const chainId = firstChainId;
      const platformEntries = Object.entries(chains[chainId].platformAddresses);
      const enabledPlatform = platformEntries.find(([_, config]) => config.enabled);
      
      if (enabledPlatform) {
        const [platformId, expectedAddresses] = enabledPlatform;
        const addresses = getPlatformAddresses(chainId, platformId);
        expect(addresses).toEqual(expectedAddresses);
      } else {
        // Skip if no enabled platforms for this chain
        console.log(`No enabled platforms found for chain ${chainId}, skipping test`);
      }
    });

    it('should return null for a disabled platform', () => {
      // Find a chain with a disabled platform
      let chainId, platformId;
      
      // Look through chains to find one with disabled platform
      for (const [cid, config] of Object.entries(chains)) {
        const disabledPlatform = Object.entries(config.platformAddresses || {})
          .find(([_, pConfig]) => pConfig && pConfig.enabled === false);
        
        if (disabledPlatform) {
          chainId = parseInt(cid);
          platformId = disabledPlatform[0];
          break;
        }
      }
      
      if (chainId && platformId) {
        const addresses = getPlatformAddresses(chainId, platformId);
        expect(addresses).toBeNull();
      } else {
        // Skip if no disabled platforms found
        console.log('No disabled platforms found, skipping test');
      }
    });

    it('should return null for an invalid chain ID', () => {
      // Get a valid platform ID from the first chain
      const platformId = Object.keys(chains[firstChainId].platformAddresses)[0];
      const addresses = getPlatformAddresses(999999, platformId);
      expect(addresses).toBeNull();
    });

    it('should return null for an invalid platform ID', () => {
      const addresses = getPlatformAddresses(firstChainId, 'nonexistent-platform');
      expect(addresses).toBeNull();
    });
  });

  describe('getChainPlatformIds', () => {
    it('should return an array of enabled platform IDs for a valid chain', () => {
      const platformIds = getChainPlatformIds(firstChainId);
      
      // Get enabled platforms from the original config for validation
      const expectedPlatformIds = Object.entries(chains[firstChainId].platformAddresses)
        .filter(([_, config]) => config.enabled)
        .map(([id, _]) => id);
      
      expect(platformIds).toEqual(expectedPlatformIds);
    });

    it('should return an empty array for an invalid chain ID', () => {
      const platformIds = getChainPlatformIds(999999);
      expect(platformIds).toEqual([]);
    });
  });
});