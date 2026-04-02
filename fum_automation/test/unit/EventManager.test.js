/**
 * @fileoverview Unit tests for EventManager
 * Tests pub/sub functionality, listener management, and helper methods
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import EventManager from '../../src/core/EventManager.js';

describe('EventManager', () => {
  let eventManager;

  beforeEach(() => {
    eventManager = new EventManager();
  });

  describe('Pub/Sub', () => {
    describe('subscribe', () => {
      it('should add a subscriber to an event', () => {
        const callback = vi.fn();
        eventManager.subscribe('testEvent', callback);

        expect(eventManager.eventHandlers['testEvent']).toContain(callback);
      });

      it('should return an unsubscribe function', () => {
        const callback = vi.fn();
        const unsubscribe = eventManager.subscribe('testEvent', callback);

        expect(typeof unsubscribe).toBe('function');
      });

      it('should allow multiple subscribers to same event', () => {
        const callback1 = vi.fn();
        const callback2 = vi.fn();

        eventManager.subscribe('testEvent', callback1);
        eventManager.subscribe('testEvent', callback2);

        expect(eventManager.eventHandlers['testEvent']).toHaveLength(2);
      });
    });

    describe('unsubscribe', () => {
      it('should remove subscriber when unsubscribe is called', () => {
        const callback = vi.fn();
        const unsubscribe = eventManager.subscribe('testEvent', callback);

        unsubscribe();

        expect(eventManager.eventHandlers['testEvent']).not.toContain(callback);
      });

      it('should only remove the specific subscriber', () => {
        const callback1 = vi.fn();
        const callback2 = vi.fn();

        const unsubscribe1 = eventManager.subscribe('testEvent', callback1);
        eventManager.subscribe('testEvent', callback2);

        unsubscribe1();

        expect(eventManager.eventHandlers['testEvent']).not.toContain(callback1);
        expect(eventManager.eventHandlers['testEvent']).toContain(callback2);
      });
    });

    describe('emit', () => {
      it('should call all subscribers with event data', () => {
        const callback1 = vi.fn();
        const callback2 = vi.fn();
        const eventData = { foo: 'bar' };

        eventManager.subscribe('testEvent', callback1);
        eventManager.subscribe('testEvent', callback2);
        eventManager.emit('testEvent', eventData);

        expect(callback1).toHaveBeenCalledWith(eventData);
        expect(callback2).toHaveBeenCalledWith(eventData);
      });

      it('should pass multiple arguments to subscribers', () => {
        const callback = vi.fn();

        eventManager.subscribe('testEvent', callback);
        eventManager.emit('testEvent', 'arg1', 'arg2', 'arg3');

        expect(callback).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
      });

      it('should not error when emitting to event with no subscribers', () => {
        expect(() => {
          eventManager.emit('nonExistentEvent', { data: 'test' });
        }).not.toThrow();
      });

      it('should not call subscribers when disabled', () => {
        const callback = vi.fn();
        eventManager.subscribe('testEvent', callback);

        eventManager.setEnabled(false);
        eventManager.emit('testEvent', { data: 'test' });

        expect(callback).not.toHaveBeenCalled();
      });

      it('should call subscribers after re-enabling', () => {
        const callback = vi.fn();
        eventManager.subscribe('testEvent', callback);

        eventManager.setEnabled(false);
        eventManager.setEnabled(true);
        eventManager.emit('testEvent', { data: 'test' });

        expect(callback).toHaveBeenCalled();
      });

      it('should log event data when log config is provided', () => {
        const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

        eventManager.emit('TestEvent', {
          someData: 'value',
          log: {
            level: 'info',
            message: 'Test log message'
          }
        });

        expect(consoleSpy).toHaveBeenCalledWith(
          '[TestEvent] Test log message',
          expect.any(Object)
        );

        consoleSpy.mockRestore();
      });
    });
  });

  describe('setEnabled', () => {
    it('should return the new enabled state', () => {
      const result = eventManager.setEnabled(false);
      expect(result).toBe(false);

      const result2 = eventManager.setEnabled(true);
      expect(result2).toBe(true);
    });

    it('should coerce truthy/falsy values to boolean', () => {
      eventManager.setEnabled(0);
      expect(eventManager.enabled).toBe(false);

      eventManager.setEnabled(1);
      expect(eventManager.enabled).toBe(true);

      eventManager.setEnabled('');
      expect(eventManager.enabled).toBe(false);

      eventManager.setEnabled('truthy');
      expect(eventManager.enabled).toBe(true);
    });
  });

  describe('generateListenerKey', () => {
    it('should generate consistent key format', () => {
      const key = eventManager.generateListenerKey({
        id: '0xAbC123',
        eventType: 'swap',
        chainId: 1337
      });

      expect(key).toBe('0xabc123-swap-1337');
    });

    it('should include additionalId when provided', () => {
      const key = eventManager.generateListenerKey({
        id: '0xAbC123',
        eventType: 'swap',
        chainId: 1337,
        additionalId: 'extra'
      });

      expect(key).toBe('0xabc123-swap-1337-extra');
    });

    it('should lowercase the id', () => {
      const key = eventManager.generateListenerKey({
        id: '0xABCDEF',
        eventType: 'test',
        chainId: 1
      });

      expect(key).toMatch(/^0xabcdef-/);
    });
  });

  describe('Pool-to-Vault Mappings', () => {
    const poolAddress = '0xPool123';
    const vaultAddress1 = '0xVault1';
    const vaultAddress2 = '0xVault2';

    describe('addVaultToPool', () => {
      it('should add vault to pool mapping', () => {
        eventManager.addVaultToPool(poolAddress, vaultAddress1);

        expect(eventManager.poolToVaults[poolAddress]).toContain(vaultAddress1);
      });

      it('should create pool entry if not exists', () => {
        expect(eventManager.poolToVaults[poolAddress]).toBeUndefined();

        eventManager.addVaultToPool(poolAddress, vaultAddress1);

        expect(eventManager.poolToVaults[poolAddress]).toBeDefined();
      });

      it('should not add duplicate vault', () => {
        eventManager.addVaultToPool(poolAddress, vaultAddress1);
        eventManager.addVaultToPool(poolAddress, vaultAddress1);

        expect(eventManager.poolToVaults[poolAddress]).toHaveLength(1);
      });

      it('should allow multiple vaults per pool', () => {
        eventManager.addVaultToPool(poolAddress, vaultAddress1);
        eventManager.addVaultToPool(poolAddress, vaultAddress2);

        expect(eventManager.poolToVaults[poolAddress]).toHaveLength(2);
      });
    });

    describe('getVaultsForPool', () => {
      it('should return vaults for pool', () => {
        eventManager.addVaultToPool(poolAddress, vaultAddress1);
        eventManager.addVaultToPool(poolAddress, vaultAddress2);

        const vaults = eventManager.getVaultsForPool(poolAddress);

        expect(vaults).toContain(vaultAddress1);
        expect(vaults).toContain(vaultAddress2);
      });

      it('should return empty array for unknown pool', () => {
        const vaults = eventManager.getVaultsForPool('0xUnknown');

        expect(vaults).toEqual([]);
      });
    });

    describe('isPoolMonitored', () => {
      it('should return true for pool with vaults', () => {
        eventManager.addVaultToPool(poolAddress, vaultAddress1);

        expect(eventManager.isPoolMonitored(poolAddress)).toBe(true);
      });

      it('should return false for unknown pool', () => {
        expect(eventManager.isPoolMonitored('0xUnknown')).toBe(false);
      });

      it('should return false for pool with empty vault array', () => {
        eventManager.poolToVaults[poolAddress] = [];

        expect(eventManager.isPoolMonitored(poolAddress)).toBe(false);
      });
    });

    describe('getMonitoredPools', () => {
      it('should return all pool addresses', () => {
        const pool1 = '0xPool1';
        const pool2 = '0xPool2';

        eventManager.addVaultToPool(pool1, vaultAddress1);
        eventManager.addVaultToPool(pool2, vaultAddress2);

        const pools = eventManager.getMonitoredPools();

        expect(pools).toContain(pool1);
        expect(pools).toContain(pool2);
      });

      it('should return empty array when no pools', () => {
        const pools = eventManager.getMonitoredPools();

        expect(pools).toEqual([]);
      });
    });

    describe('getPoolListenerCount', () => {
      it('should return count of monitored pools', () => {
        eventManager.addVaultToPool('0xPool1', vaultAddress1);
        eventManager.addVaultToPool('0xPool2', vaultAddress2);

        expect(eventManager.getPoolListenerCount()).toBe(2);
      });

      it('should return 0 when no pools', () => {
        expect(eventManager.getPoolListenerCount()).toBe(0);
      });
    });
  });

  describe('Listener Helpers', () => {
    describe('hasListener', () => {
      it('should return false for non-existent listener', () => {
        expect(eventManager.hasListener('non-existent-key')).toBe(false);
      });

      it('should return true for existing listener', () => {
        // Manually add a listener entry for testing
        eventManager.listeners['test-key'] = { type: 'test' };

        expect(eventManager.hasListener('test-key')).toBe(true);
      });
    });

    describe('getListenerCount', () => {
      it('should return 0 initially', () => {
        expect(eventManager.getListenerCount()).toBe(0);
      });

      it('should return count of listeners', () => {
        eventManager.listeners['key1'] = { type: 'test' };
        eventManager.listeners['key2'] = { type: 'test' };

        expect(eventManager.getListenerCount()).toBe(2);
      });
    });
  });

  describe('Debug Mode', () => {
    it('should not log when debug is false', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      eventManager.setDebug(false);
      eventManager.log('Test message');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log when debug is true', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      eventManager.setDebug(true);
      eventManager.log('Test message');

      expect(consoleSpy).toHaveBeenCalledWith('[EventManager] Test message');
      consoleSpy.mockRestore();
    });
  });

  describe('Failed Removal Tracking', () => {
    describe('trackFailedListenerRemoval', () => {
      it('should track failed removal', () => {
        const listener = { type: 'test', vaultAddress: '0xVault' };
        const error = new Error('Test error');

        eventManager.trackFailedListenerRemoval('test-key', listener, error);

        expect(eventManager.failedRemovals.has('test-key')).toBe(true);
        const tracked = eventManager.failedRemovals.get('test-key');
        expect(tracked.attempts).toBe(1);
        expect(tracked.lastError).toBe('Test error');
      });

      it('should increment attempts on subsequent failures', () => {
        const listener = { type: 'test', vaultAddress: '0xVault' };
        const error = new Error('Test error');

        eventManager.trackFailedListenerRemoval('test-key', listener, error);
        eventManager.trackFailedListenerRemoval('test-key', listener, error);

        expect(eventManager.failedRemovals.get('test-key').attempts).toBe(2);
      });
    });

    describe('clearFailedRemoval', () => {
      it('should remove tracked failure', () => {
        eventManager.failedRemovals.set('test-key', { attempts: 1 });

        eventManager.clearFailedRemoval('test-key');

        expect(eventManager.failedRemovals.has('test-key')).toBe(false);
      });

      it('should not error when clearing non-existent key', () => {
        expect(() => {
          eventManager.clearFailedRemoval('non-existent');
        }).not.toThrow();
      });
    });

    describe('getFailedRemovals', () => {
      it('should return copy of failed removals', () => {
        eventManager.failedRemovals.set('key1', { attempts: 1 });
        eventManager.failedRemovals.set('key2', { attempts: 2 });

        const failures = eventManager.getFailedRemovals();

        expect(failures.size).toBe(2);
        expect(failures).not.toBe(eventManager.failedRemovals); // Should be a copy
      });
    });
  });

  // ============================================================================
  // emit handler error isolation (validates C1 fix)
  // ============================================================================
  describe('emit handler error isolation', () => {
    it('should call subsequent handlers when one throws', () => {
      const handler1 = vi.fn(() => { throw new Error('handler 1 exploded'); });
      const handler2 = vi.fn();

      eventManager.subscribe('TestEvent', handler1);
      eventManager.subscribe('TestEvent', handler2);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      eventManager.emit('TestEvent', { data: 'test' });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventManager] Handler threw on event "TestEvent"'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  // ============================================================================
  // registerContractListener
  // ============================================================================
  describe('registerContractListener', () => {
    it('should store listener with correct shape', () => {
      const contract = { on: vi.fn(), off: vi.fn() };
      const handler = vi.fn();

      const key = eventManager.registerContractListener({
        contract,
        eventName: 'Transfer',
        handler,
        vaultAddress: '0x1111111111111111111111111111111111111111',
        eventType: 'transfer',
        chainId: 1337
      });

      expect(eventManager.listeners[key]).toBeDefined();
      expect(eventManager.listeners[key].type).toBe('contract');
      expect(eventManager.listeners[key].eventName).toBe('Transfer');
      expect(contract.on).toHaveBeenCalledWith('Transfer', expect.any(Function));
    });

    it('should reactivate zombie listener instead of creating new one', () => {
      const contract = { on: vi.fn(), off: vi.fn() };
      const key = eventManager.generateListenerKey({
        id: '0x1111111111111111111111111111111111111111',
        eventType: 'transfer',
        chainId: 1337
      });

      // Pre-populate as zombie
      eventManager.listeners[key] = { isRemoved: true, type: 'contract', contract };

      const returnedKey = eventManager.registerContractListener({
        contract,
        eventName: 'Transfer',
        handler: vi.fn(),
        vaultAddress: '0x1111111111111111111111111111111111111111',
        eventType: 'transfer',
        chainId: 1337
      });

      expect(returnedKey).toBe(key);
      expect(eventManager.listeners[key].isRemoved).toBeUndefined();
      // contract.on should NOT be called (zombie reactivation skips registration)
      expect(contract.on).not.toHaveBeenCalled();
    });

    it('should skip original handler when isRemoved is set', () => {
      const contract = { on: vi.fn(), off: vi.fn() };
      const originalHandler = vi.fn();

      const key = eventManager.registerContractListener({
        contract,
        eventName: 'Transfer',
        handler: originalHandler,
        vaultAddress: '0x1111111111111111111111111111111111111111',
        eventType: 'transfer',
        chainId: 1337
      });

      // Get the wrapped handler that was passed to contract.on
      const wrappedHandler = contract.on.mock.calls[0][1];

      // Mark as removed
      eventManager.listeners[key].isRemoved = true;

      // Call the wrapped handler — original should NOT be called
      wrappedHandler('arg1', 'arg2');
      expect(originalHandler).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // registerFilterListener
  // ============================================================================
  describe('registerFilterListener', () => {
    it('should store listener when enabled', () => {
      const provider = { on: vi.fn(), off: vi.fn() };
      const filter = { address: '0xpool', topics: [] };

      const key = eventManager.registerFilterListener({
        provider,
        filter,
        handler: vi.fn(),
        address: '0xpool',
        eventType: 'swap',
        chainId: 1337
      });

      expect(eventManager.listeners[key]).toBeDefined();
      expect(eventManager.listeners[key].type).toBe('filter');
      expect(provider.on).toHaveBeenCalled();
    });

    it('should return key but skip registration when disabled', () => {
      eventManager.setEnabled(false);
      const provider = { on: vi.fn(), off: vi.fn() };

      const key = eventManager.registerFilterListener({
        provider,
        filter: {},
        handler: vi.fn(),
        address: '0xpool',
        eventType: 'swap',
        chainId: 1337
      });

      expect(key).toBeDefined();
      expect(eventManager.listeners[key]).toBeUndefined();
      expect(provider.on).not.toHaveBeenCalled();

      eventManager.setEnabled(true);
    });
  });

  // ============================================================================
  // removeListener
  // ============================================================================
  describe('removeListener', () => {
    it('should return false for missing key', async () => {
      expect(await eventManager.removeListener('nonexistent')).toBe(false);
    });

    it('should return false for already-removed listener', async () => {
      eventManager.listeners['test-key'] = { isRemoved: true, type: 'contract' };
      expect(await eventManager.removeListener('test-key')).toBe(false);
    });

    it('should remove contract listener successfully', async () => {
      const contract = { off: vi.fn() };
      eventManager.listeners['test-contract'] = {
        type: 'contract',
        contract,
        eventName: 'Transfer',
        handler: vi.fn()
      };

      const result = await eventManager.removeListener('test-contract');
      expect(result).toBe(true);
      expect(contract.off).toHaveBeenCalledWith('Transfer', expect.any(Function));
      expect(eventManager.listeners['test-contract']).toBeUndefined();
    });

    it('should remove filter listener successfully', async () => {
      const provider = { off: vi.fn() };
      const filter = {};
      eventManager.listeners['test-filter'] = {
        type: 'filter',
        provider,
        filter,
        handler: vi.fn()
      };

      const result = await eventManager.removeListener('test-filter');
      expect(result).toBe(true);
      expect(provider.off).toHaveBeenCalled();
    });

    it('should track failed removal on error', async () => {
      const contract = { off: vi.fn(() => { throw new Error('off failed'); }) };
      eventManager.listeners['fail-key'] = {
        type: 'contract',
        contract,
        eventName: 'Transfer',
        handler: vi.fn()
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await eventManager.removeListener('fail-key');

      expect(result).toBe(false);
      expect(eventManager.failedRemovals.has('fail-key')).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  // ============================================================================
  // removeAllVaultListeners
  // ============================================================================
  describe('removeAllVaultListeners', () => {
    it('should return 0 for null address', async () => {
      expect(await eventManager.removeAllVaultListeners(null)).toBe(0);
    });

    it('should remove vault-specific listeners and emit event', async () => {
      const vaultAddr = '0x1111111111111111111111111111111111111111';
      const contract = { off: vi.fn() };

      eventManager.listeners['vault-listener-1'] = {
        type: 'contract',
        contract,
        eventName: 'Transfer',
        handler: vi.fn(),
        vaultAddress: vaultAddr
      };

      const emitSpy = vi.spyOn(eventManager, 'emit');
      const count = await eventManager.removeAllVaultListeners(vaultAddr);

      expect(count).toBe(1);
      const allRemovedCall = emitSpy.mock.calls.find(c => c[0] === 'AllVaultListenersRemoved');
      expect(allRemovedCall).toBeDefined();
      expect(allRemovedCall[1].removedCount).toBe(1);

      emitSpy.mockRestore();
    });

    it('should clean up empty pool when last vault removed', async () => {
      const vaultAddr = '0x1111111111111111111111111111111111111111';
      const provider = { off: vi.fn() };
      const poolId = '0xpoolAddress';

      // Set up pool mapping with one vault
      eventManager.poolToVaults[poolId] = [vaultAddr];

      // Set up pool swap listener
      const poolKey = `${poolId.toLowerCase()}-swap-1337`;
      eventManager.listeners[poolKey] = {
        type: 'filter',
        provider,
        filter: {},
        handler: vi.fn()
      };

      await eventManager.removeAllVaultListeners(vaultAddr);

      expect(eventManager.poolToVaults[poolId]).toBeUndefined();
    });
  });

  // ============================================================================
  // removeAllListeners
  // ============================================================================
  describe('removeAllListeners', () => {
    it('should remove all listeners and clear pool mappings', async () => {
      const contract = { off: vi.fn() };
      eventManager.listeners['key1'] = { type: 'contract', contract, eventName: 'E', handler: vi.fn() };
      eventManager.listeners['key2'] = { type: 'contract', contract, eventName: 'E', handler: vi.fn() };
      eventManager.poolToVaults = { pool1: ['0xvault'] };

      const count = await eventManager.removeAllListeners();

      expect(count).toBe(2);
      expect(Object.keys(eventManager.poolToVaults)).toHaveLength(0);
    });

    it('should return 0 on duplicate call (isCleaningUp guard)', async () => {
      eventManager.isCleaningUp = true;
      const result = await eventManager.removeAllListeners();
      expect(result).toBe(0);
      eventManager.isCleaningUp = false;
    });
  });

  // ============================================================================
  // retryFailedRemovals
  // ============================================================================
  describe('retryFailedRemovals', () => {
    it('should return zeros for empty failedRemovals', async () => {
      const result = await eventManager.retryFailedRemovals();
      expect(result).toEqual({ attempted: 0, succeeded: 0, stillFailing: 0 });
    });

    it('should count successes and failures correctly', async () => {
      const contract = { off: vi.fn() };

      // Listener that will succeed removal
      eventManager.listeners['good-key'] = { type: 'contract', contract, eventName: 'E', handler: vi.fn() };
      eventManager.failedRemovals.set('good-key', { listener: eventManager.listeners['good-key'], attempts: 1 });

      // Key with no listener — removal returns false
      eventManager.failedRemovals.set('bad-key', { listener: {}, attempts: 1 });

      const result = await eventManager.retryFailedRemovals();

      expect(result.attempted).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.stillFailing).toBe(1);
    });
  });

  // ============================================================================
  // refreshSwapListeners
  // ============================================================================
  describe('refreshSwapListeners', () => {
    const VAULT = '0x1111111111111111111111111111111111111111';
    const POOL_A = '0xPoolAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const CHAIN_ID = 1337;

    it('should remove old pool listener and re-subscribe when vault has positions', async () => {
      const provider = { on: vi.fn(), off: vi.fn() };

      // Set up: vault is in POOL_A with an active swap listener
      eventManager.poolToVaults[POOL_A] = [VAULT];
      eventManager.poolData = { [POOL_A]: { platform: 'uniswapV3' } };

      const poolListenerKey = eventManager.generateListenerKey({
        id: POOL_A, eventType: 'swap', chainId: CHAIN_ID, additionalId: 'uniswapV3'
      });
      eventManager.listeners[poolListenerKey] = {
        type: 'filter', provider, filter: {}, handler: vi.fn()
      };

      // Mock VDS: vault has positions
      eventManager.vaultDataService = {
        getVault: vi.fn().mockResolvedValue({
          address: VAULT,
          positions: { pos1: { pool: '0xPoolBBBB' } }
        })
      };

      // Mock subscribeToSwapEvents to avoid going into adapter/provider code
      eventManager.subscribeToSwapEvents = vi.fn();

      await eventManager.refreshSwapListeners(VAULT, provider, CHAIN_ID);

      // Old pool listener should be removed
      expect(eventManager.listeners[poolListenerKey]).toBeUndefined();
      expect(eventManager.poolToVaults[POOL_A]).toBeUndefined();

      // subscribeToSwapEvents should have been called for re-subscription
      expect(eventManager.subscribeToSwapEvents).toHaveBeenCalled();
    });

    it('should not add swap listeners when vault has no positions', async () => {
      const provider = { on: vi.fn(), off: vi.fn() };

      // Mock VDS: vault has no positions
      eventManager.vaultDataService = {
        getVault: vi.fn().mockResolvedValue({
          address: VAULT,
          positions: {}
        })
      };

      eventManager.subscribeToSwapEvents = vi.fn();

      await eventManager.refreshSwapListeners(VAULT, provider, CHAIN_ID);

      expect(eventManager.subscribeToSwapEvents).not.toHaveBeenCalled();
    });
  });
});
