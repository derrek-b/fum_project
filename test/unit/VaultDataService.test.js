/**
 * @fileoverview Unit tests for VaultDataService
 * Tests initialization, caching, and helper methods
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import VaultDataService from '../../src/core/VaultDataService.js';
import EventManager from '../../src/core/EventManager.js';
import { ethers } from 'ethers';

describe('VaultDataService', () => {
  let vaultDataService;
  let mockEventManager;

  // Valid test addresses
  const VAULT_ADDRESS_1 = '0x1111111111111111111111111111111111111111';
  const VAULT_ADDRESS_2 = '0x2222222222222222222222222222222222222222';
  const VAULT_ADDRESS_CHECKSUM = ethers.utils.getAddress(VAULT_ADDRESS_1);

  beforeEach(() => {
    mockEventManager = new EventManager();
    vaultDataService = new VaultDataService(mockEventManager);
  });

  describe('Constructor', () => {
    it('should initialize with empty vaults map', () => {
      expect(vaultDataService.vaults.size).toBe(0);
    });

    it('should store eventManager reference', () => {
      expect(vaultDataService.eventManager).toBe(mockEventManager);
    });

    it('should initialize with null provider and chainId', () => {
      expect(vaultDataService.provider).toBeNull();
      expect(vaultDataService.chainId).toBeNull();
    });
  });

  describe('initialize', () => {
    it('should set provider and chainId', () => {
      const mockProvider = { getNetwork: vi.fn() };
      const chainId = 1337;

      vaultDataService.initialize(mockProvider, chainId);

      expect(vaultDataService.provider).toBe(mockProvider);
      expect(vaultDataService.chainId).toBe(chainId);
    });

    it('should emit initialized event', () => {
      const emitSpy = vi.spyOn(mockEventManager, 'emit');
      const mockProvider = { getNetwork: vi.fn() };

      vaultDataService.initialize(mockProvider, 1337);

      expect(emitSpy).toHaveBeenCalledWith('initialized', { chainId: 1337 });
    });
  });

  describe('Setters', () => {
    describe('setTokens', () => {
      it('should store tokens reference', () => {
        const tokens = { USDC: { decimals: 6 }, WETH: { decimals: 18 } };

        vaultDataService.setTokens(tokens);

        expect(vaultDataService.tokens).toBe(tokens);
      });
    });

    describe('setAdapters', () => {
      it('should store adapters reference', () => {
        const adapters = new Map([['uniswapV3', { name: 'test' }]]);

        vaultDataService.setAdapters(adapters);

        expect(vaultDataService.adapters).toBe(adapters);
      });
    });

    describe('setPoolData', () => {
      it('should store poolData reference', () => {
        const poolData = { '0xPool': { token0: 'USDC', token1: 'WETH' } };

        vaultDataService.setPoolData(poolData);

        expect(vaultDataService.poolData).toBe(poolData);
      });
    });
  });

  describe('ensureInitialized', () => {
    it('should throw if provider is null', () => {
      expect(() => {
        vaultDataService.ensureInitialized();
      }).toThrow('VaultDataService not initialized');
    });

    it('should throw if chainId is null', () => {
      vaultDataService.provider = { getNetwork: vi.fn() };

      expect(() => {
        vaultDataService.ensureInitialized();
      }).toThrow('VaultDataService not initialized');
    });

    it('should not throw when properly initialized', () => {
      vaultDataService.provider = { getNetwork: vi.fn() };
      vaultDataService.chainId = 1337;

      expect(() => {
        vaultDataService.ensureInitialized();
      }).not.toThrow();
    });
  });

  describe('Vault Cache Operations', () => {
    describe('hasVault', () => {
      it('should return false for non-cached vault', () => {
        expect(vaultDataService.hasVault(VAULT_ADDRESS_1)).toBe(false);
      });

      it('should return true for cached vault', () => {
        vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, { address: VAULT_ADDRESS_CHECKSUM });

        expect(vaultDataService.hasVault(VAULT_ADDRESS_1)).toBe(true);
      });

      it('should normalize address for lookup', () => {
        vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, { address: VAULT_ADDRESS_CHECKSUM });

        // Lowercase should still find it
        expect(vaultDataService.hasVault(VAULT_ADDRESS_1.toLowerCase())).toBe(true);
      });
    });

    describe('removeVault', () => {
      it('should remove vault from cache and return true', () => {
        vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, { address: VAULT_ADDRESS_CHECKSUM });

        const result = vaultDataService.removeVault(VAULT_ADDRESS_1);

        expect(result).toBe(true);
        expect(vaultDataService.vaults.has(VAULT_ADDRESS_CHECKSUM)).toBe(false);
      });

      it('should return false if vault not in cache', () => {
        const result = vaultDataService.removeVault(VAULT_ADDRESS_1);

        expect(result).toBe(false);
      });

      it('should emit vaultRemoved event when vault removed', () => {
        const emitSpy = vi.spyOn(mockEventManager, 'emit');
        vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, { address: VAULT_ADDRESS_CHECKSUM });

        vaultDataService.removeVault(VAULT_ADDRESS_1);

        expect(emitSpy).toHaveBeenCalledWith('vaultRemoved', VAULT_ADDRESS_CHECKSUM);
      });

      it('should not emit event if vault not found', () => {
        const emitSpy = vi.spyOn(mockEventManager, 'emit');

        vaultDataService.removeVault(VAULT_ADDRESS_1);

        expect(emitSpy).not.toHaveBeenCalledWith('vaultRemoved', expect.anything());
      });
    });

    describe('getAllVaults', () => {
      it('should return empty array when no vaults', () => {
        expect(vaultDataService.getAllVaults()).toEqual([]);
      });

      it('should return array of all cached vaults', () => {
        const vault1 = { address: VAULT_ADDRESS_CHECKSUM };
        const vault2 = { address: ethers.utils.getAddress(VAULT_ADDRESS_2) };

        vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, vault1);
        vaultDataService.vaults.set(ethers.utils.getAddress(VAULT_ADDRESS_2), vault2);

        const vaults = vaultDataService.getAllVaults();

        expect(vaults).toHaveLength(2);
        expect(vaults).toContain(vault1);
        expect(vaults).toContain(vault2);
      });
    });

    describe('clearCache', () => {
      it('should remove all vaults from cache', () => {
        vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, { address: VAULT_ADDRESS_CHECKSUM });
        vaultDataService.vaults.set(ethers.utils.getAddress(VAULT_ADDRESS_2), { address: VAULT_ADDRESS_2 });

        vaultDataService.clearCache();

        expect(vaultDataService.vaults.size).toBe(0);
      });

      it('should reset lastRefreshTime', () => {
        vaultDataService.lastRefreshTime = Date.now();

        vaultDataService.clearCache();

        expect(vaultDataService.lastRefreshTime).toBeNull();
      });

      it('should emit cacheCleared event', () => {
        const emitSpy = vi.spyOn(mockEventManager, 'emit');

        vaultDataService.clearCache();

        expect(emitSpy).toHaveBeenCalledWith('cacheCleared');
      });
    });
  });

  describe('getVaultStrategyId', () => {
    it('should return null for non-cached vault', () => {
      expect(vaultDataService.getVaultStrategyId(VAULT_ADDRESS_1)).toBeNull();
    });

    it('should return null for vault without strategy', () => {
      vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, { address: VAULT_ADDRESS_CHECKSUM });

      expect(vaultDataService.getVaultStrategyId(VAULT_ADDRESS_1)).toBeNull();
    });

    it('should return strategyId for vault with strategy', () => {
      vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, {
        address: VAULT_ADDRESS_CHECKSUM,
        strategy: { strategyId: 'bob' }
      });

      expect(vaultDataService.getVaultStrategyId(VAULT_ADDRESS_1)).toBe('bob');
    });
  });

  describe('getAvailableEvents', () => {
    it('should return array of event names', () => {
      const events = vaultDataService.getAvailableEvents();

      expect(Array.isArray(events)).toBe(true);
      expect(events).toContain('vaultLoaded');
      expect(events).toContain('vaultLoadError');
      expect(events).toContain('cacheCleared');
    });
  });

  describe('subscribe', () => {
    it('should delegate to eventManager.subscribe', () => {
      const subscribeSpy = vi.spyOn(mockEventManager, 'subscribe');
      const callback = vi.fn();

      vaultDataService.subscribe('testEvent', callback);

      expect(subscribeSpy).toHaveBeenCalledWith('testEvent', callback);
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();

      const unsubscribe = vaultDataService.subscribe('testEvent', callback);

      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('assembleVaultData', () => {
    it('should create vault data structure with all fields', () => {
      const inputData = {
        address: VAULT_ADDRESS_CHECKSUM,
        owner: '0xOwner',
        chainId: 1337,
        strategyAddress: '0xStrategy',
        strategy: { strategyId: 'bob' },
        targetTokens: ['USDC', 'ETH'],
        targetPlatforms: ['uniswapV3'],
        tokens: { USDC: '1000000' },
        positions: { '123': { tickLower: -100 } }
      };

      const result = vaultDataService.assembleVaultData(inputData);

      expect(result.address).toBe(VAULT_ADDRESS_CHECKSUM);
      expect(result.owner).toBe('0xOwner');
      expect(result.chainId).toBe(1337);
      expect(result.strategyAddress).toBe('0xStrategy');
      expect(result.strategy).toEqual({ strategyId: 'bob' });
      expect(result.targetTokens).toEqual(['USDC', 'ETH']);
      expect(result.targetPlatforms).toEqual(['uniswapV3']);
      expect(result.tokens).toEqual({ USDC: '1000000' });
      expect(result.positions).toEqual({ '123': { tickLower: -100 } });
    });

    it('should add lastUpdated timestamp', () => {
      const beforeTime = Date.now();

      const result = vaultDataService.assembleVaultData({
        address: VAULT_ADDRESS_CHECKSUM,
        owner: '0xOwner',
        chainId: 1337,
        strategyAddress: '0xStrategy',
        strategy: null,
        targetTokens: [],
        targetPlatforms: [],
        tokens: {},
        positions: {}
      });

      expect(result.lastUpdated).toBeGreaterThanOrEqual(beforeTime);
      expect(result.lastUpdated).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('getVault - Caching Behavior', () => {
    it('should return cached vault without loading when not forcing refresh', async () => {
      const cachedVault = {
        address: VAULT_ADDRESS_CHECKSUM,
        strategy: { strategyId: 'bob' },
        lastUpdated: Date.now()
      };
      vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, cachedVault);

      const result = await vaultDataService.getVault(VAULT_ADDRESS_1, false);

      // Same object reference proves cache was used (no reload)
      expect(result).toBe(cachedVault);
    });

    it('should normalize address for cache lookup', async () => {
      const cachedVault = { address: VAULT_ADDRESS_CHECKSUM };
      vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, cachedVault);

      const result = await vaultDataService.getVault(VAULT_ADDRESS_1.toLowerCase(), false);

      expect(result).toBe(cachedVault);
    });
  });

  describe('updateTargetTokens', () => {
    beforeEach(() => {
      // Initialize service for methods that require it
      vaultDataService.provider = { getNetwork: vi.fn() };
      vaultDataService.chainId = 1337;
    });

    it('should update target tokens for cached vault', async () => {
      const vault = {
        address: VAULT_ADDRESS_CHECKSUM,
        targetTokens: ['USDC'],
        lastUpdated: Date.now() - 1000
      };
      vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, vault);

      const result = await vaultDataService.updateTargetTokens(VAULT_ADDRESS_1, ['USDC', 'ETH', 'ARB']);

      expect(result).toBe(true);
      expect(vaultDataService.vaults.get(VAULT_ADDRESS_CHECKSUM).targetTokens).toEqual(['USDC', 'ETH', 'ARB']);
    });

    it('should update lastUpdated timestamp', async () => {
      const oldTime = Date.now() - 10000;
      const vault = {
        address: VAULT_ADDRESS_CHECKSUM,
        targetTokens: ['USDC'],
        lastUpdated: oldTime
      };
      vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, vault);

      await vaultDataService.updateTargetTokens(VAULT_ADDRESS_1, ['WETH']);

      expect(vaultDataService.vaults.get(VAULT_ADDRESS_CHECKSUM).lastUpdated).toBeGreaterThan(oldTime);
    });

    it('should emit targetTokensUpdated event', async () => {
      const emitSpy = vi.spyOn(mockEventManager, 'emit');
      const vault = { address: VAULT_ADDRESS_CHECKSUM, targetTokens: [] };
      vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, vault);

      await vaultDataService.updateTargetTokens(VAULT_ADDRESS_1, ['USDC']);

      expect(emitSpy).toHaveBeenCalledWith('targetTokensUpdated', VAULT_ADDRESS_CHECKSUM, ['USDC']);
    });
  });

  describe('updateTargetPlatforms', () => {
    beforeEach(() => {
      vaultDataService.provider = { getNetwork: vi.fn() };
      vaultDataService.chainId = 1337;
    });

    it('should update target platforms for cached vault', async () => {
      const vault = {
        address: VAULT_ADDRESS_CHECKSUM,
        targetPlatforms: ['uniswapV3'],
        lastUpdated: Date.now() - 1000
      };
      vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, vault);

      const result = await vaultDataService.updateTargetPlatforms(VAULT_ADDRESS_1, ['uniswapV3', 'uniswapV4']);

      expect(result).toBe(true);
      expect(vaultDataService.vaults.get(VAULT_ADDRESS_CHECKSUM).targetPlatforms).toEqual(['uniswapV3', 'uniswapV4']);
    });

    it('should emit targetPlatformsUpdated event', async () => {
      const emitSpy = vi.spyOn(mockEventManager, 'emit');
      const vault = { address: VAULT_ADDRESS_CHECKSUM, targetPlatforms: [] };
      vaultDataService.vaults.set(VAULT_ADDRESS_CHECKSUM, vault);

      await vaultDataService.updateTargetPlatforms(VAULT_ADDRESS_1, ['uniswapV4']);

      expect(emitSpy).toHaveBeenCalledWith('targetPlatformsUpdated', VAULT_ADDRESS_CHECKSUM, ['uniswapV4']);
    });
  });
});
