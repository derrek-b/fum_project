/**
 * @fileoverview Unit tests for ServiceHealth — SubscriptionCanary and
 * PingPongKeepalive with mocked provider and fake timers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock chainHelpers BEFORE importing ServiceHealth
vi.mock('fum_library/helpers/chainHelpers', () => ({
  getExpectedBlockMs: vi.fn()
}));

import ServiceHealth, { SubscriptionCanary, PingPongKeepalive } from '../../src/core/ServiceHealth.js';
import { getExpectedBlockMs } from 'fum_library/helpers/chainHelpers';

// ---------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------

/**
 * Create a mock provider with block event support.
 * Call mock.emitBlock() to simulate a newHeads notification.
 */
function createMockProvider() {
  const listeners = new Map(); // event -> Set<fn>
  const ws = new EventEmitter();
  ws.ping = vi.fn();

  const provider = {
    _websocket: ws,
    on: vi.fn((event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    }),
    off: vi.fn((event, fn) => {
      if (listeners.has(event)) listeners.get(event).delete(fn);
    }),
    emitBlock(blockNumber = 1) {
      const set = listeners.get('block');
      if (set) {
        for (const fn of set) fn(blockNumber);
      }
    },
    _listeners: listeners,
    _ws: ws
  };
  return provider;
}

const noopLog = () => {};

describe('ServiceHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------
  // SubscriptionCanary
  // ---------------------------------------------------------------
  describe('SubscriptionCanary', () => {
    it('fires onUnhealthy when no block arrives within threshold', () => {
      getExpectedBlockMs.mockReturnValue(250); // Arbitrum

      const canary = new SubscriptionCanary({ log: noopLog });
      const onUnhealthy = vi.fn();
      const provider = createMockProvider();

      canary.start({ provider, chainId: 42161, onUnhealthy });

      expect(canary.enabled).toBe(true);
      expect(canary.thresholdMs).toBe(2 * 250 + 500); // 1000ms
      expect(provider.on).toHaveBeenCalledWith('block', expect.any(Function));

      // No block arrives
      vi.advanceTimersByTime(999);
      expect(onUnhealthy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2);
      expect(onUnhealthy).toHaveBeenCalledTimes(1);
      expect(onUnhealthy).toHaveBeenCalledWith(expect.stringContaining('Canary: no newHeads'));
    });

    it('resets deadline on each block', () => {
      getExpectedBlockMs.mockReturnValue(250);
      const canary = new SubscriptionCanary({ log: noopLog });
      const onUnhealthy = vi.fn();
      const provider = createMockProvider();

      canary.start({ provider, chainId: 42161, onUnhealthy });

      // Advance 800ms, emit block, advance 800ms more. Deadline is 1000ms —
      // without reset we'd have fired. With reset we should be at 800ms since
      // the emit, still safe.
      vi.advanceTimersByTime(800);
      provider.emitBlock(1);
      vi.advanceTimersByTime(800);
      expect(onUnhealthy).not.toHaveBeenCalled();

      // Continue past the new deadline
      vi.advanceTimersByTime(300);
      expect(onUnhealthy).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when expectedBlockMs is null (disabled chain)', () => {
      getExpectedBlockMs.mockReturnValue(null);
      const canary = new SubscriptionCanary({ log: noopLog });
      const onUnhealthy = vi.fn();
      const provider = createMockProvider();

      canary.start({ provider, chainId: 1337, onUnhealthy });

      expect(canary.enabled).toBe(false);
      expect(provider.on).not.toHaveBeenCalled();

      // Even after a long wait, nothing fires
      vi.advanceTimersByTime(60_000);
      expect(onUnhealthy).not.toHaveBeenCalled();
    });

    it('respects expectedBlockMsOverride over chain lookup', () => {
      getExpectedBlockMs.mockReturnValue(null);
      const canary = new SubscriptionCanary({ log: noopLog });
      const onUnhealthy = vi.fn();
      const provider = createMockProvider();

      canary.start({
        provider,
        chainId: 1337,
        onUnhealthy,
        expectedBlockMsOverride: 1000
      });

      expect(canary.enabled).toBe(true);
      expect(canary.thresholdMs).toBe(2500);
      expect(getExpectedBlockMs).not.toHaveBeenCalled();
    });

    it('computes threshold = 2 × expectedBlockMs + 500ms buffer', () => {
      getExpectedBlockMs.mockReturnValue(2000); // Avalanche
      const canary = new SubscriptionCanary({ log: noopLog });
      canary.start({ provider: createMockProvider(), chainId: 43114, onUnhealthy: vi.fn() });

      expect(canary.thresholdMs).toBe(2 * 2000 + 500); // 4500ms
    });

    it('stop() clears the timer and detaches the block listener', () => {
      getExpectedBlockMs.mockReturnValue(250);
      const canary = new SubscriptionCanary({ log: noopLog });
      const onUnhealthy = vi.fn();
      const provider = createMockProvider();

      canary.start({ provider, chainId: 42161, onUnhealthy });
      canary.stop();

      expect(canary.enabled).toBe(false);
      expect(canary.deadlineTimer).toBeNull();
      expect(provider.off).toHaveBeenCalledWith('block', expect.any(Function));

      // Timer should not fire after stop
      vi.advanceTimersByTime(10_000);
      expect(onUnhealthy).not.toHaveBeenCalled();
    });

    it('only fires onUnhealthy once (one-shot)', () => {
      getExpectedBlockMs.mockReturnValue(250);
      const canary = new SubscriptionCanary({ log: noopLog });
      const onUnhealthy = vi.fn();
      const provider = createMockProvider();

      canary.start({ provider, chainId: 42161, onUnhealthy });
      vi.advanceTimersByTime(1500);
      vi.advanceTimersByTime(1500);

      expect(onUnhealthy).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------
  // PingPongKeepalive
  // ---------------------------------------------------------------
  describe('PingPongKeepalive', () => {
    it('sends a ping every pingIntervalMs', () => {
      const keepalive = new PingPongKeepalive({
        log: noopLog,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500
      });
      const onUnhealthy = vi.fn();
      const provider = createMockProvider();

      keepalive.start({ provider, onUnhealthy });

      expect(provider._ws.ping).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(provider._ws.ping).toHaveBeenCalledTimes(1);

      // Simulate pong arrival
      provider._ws.emit('pong');

      vi.advanceTimersByTime(1000);
      expect(provider._ws.ping).toHaveBeenCalledTimes(2);
    });

    it('fires onUnhealthy when pong does not arrive within pongTimeoutMs', () => {
      const keepalive = new PingPongKeepalive({
        log: noopLog,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500
      });
      const onUnhealthy = vi.fn();
      const provider = createMockProvider();

      keepalive.start({ provider, onUnhealthy });

      vi.advanceTimersByTime(1000); // ping fires
      expect(provider._ws.ping).toHaveBeenCalledTimes(1);

      // No pong → after pongTimeoutMs, onUnhealthy should fire
      vi.advanceTimersByTime(499);
      expect(onUnhealthy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2);
      expect(onUnhealthy).toHaveBeenCalledWith(expect.stringContaining('Ping timeout'));
    });

    it('clears pong timer when pong arrives in time', () => {
      const keepalive = new PingPongKeepalive({
        log: noopLog,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500
      });
      const onUnhealthy = vi.fn();
      const provider = createMockProvider();

      keepalive.start({ provider, onUnhealthy });

      vi.advanceTimersByTime(1000); // ping
      vi.advanceTimersByTime(200);
      provider._ws.emit('pong');
      vi.advanceTimersByTime(1000); // would have timed out without pong

      expect(onUnhealthy).not.toHaveBeenCalled();
    });

    it('fires onUnhealthy when ping send throws', () => {
      const keepalive = new PingPongKeepalive({
        log: noopLog,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500
      });
      const onUnhealthy = vi.fn();
      const provider = createMockProvider();
      provider._ws.ping = vi.fn(() => {
        throw new Error('socket closed');
      });

      keepalive.start({ provider, onUnhealthy });
      vi.advanceTimersByTime(1000);

      expect(onUnhealthy).toHaveBeenCalledWith(expect.stringContaining('Ping send failed'));
    });

    it('does not stack pings when a pong is still outstanding', () => {
      const keepalive = new PingPongKeepalive({
        log: noopLog,
        pingIntervalMs: 1000,
        pongTimeoutMs: 3000 // longer than interval
      });
      const onUnhealthy = vi.fn();
      const provider = createMockProvider();

      keepalive.start({ provider, onUnhealthy });

      vi.advanceTimersByTime(1000); // first ping
      expect(provider._ws.ping).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000); // interval fires but pong still pending
      expect(provider._ws.ping).toHaveBeenCalledTimes(1); // not stacked
    });

    it('stop() clears all timers and the pong listener', () => {
      const keepalive = new PingPongKeepalive({
        log: noopLog,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500
      });
      const onUnhealthy = vi.fn();
      const provider = createMockProvider();

      keepalive.start({ provider, onUnhealthy });
      keepalive.stop();

      expect(keepalive.enabled).toBe(false);
      expect(keepalive.pingTimer).toBeNull();

      // Nothing fires after stop
      vi.advanceTimersByTime(10_000);
      expect(provider._ws.ping).not.toHaveBeenCalled();
      expect(onUnhealthy).not.toHaveBeenCalled();
    });

    it('does not start when provider has no _websocket', () => {
      const keepalive = new PingPongKeepalive({
        log: noopLog,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500
      });
      const onUnhealthy = vi.fn();
      const provider = { /* no _websocket */ };

      keepalive.start({ provider, onUnhealthy });

      expect(keepalive.enabled).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // ServiceHealth composition
  // ---------------------------------------------------------------
  describe('ServiceHealth (composition)', () => {
    it('starts both canary and keepalive on start()', () => {
      getExpectedBlockMs.mockReturnValue(250);
      const health = new ServiceHealth({ log: noopLog });
      const provider = createMockProvider();
      const onUnhealthy = vi.fn();

      health.start({
        provider,
        chainId: 42161,
        onUnhealthy,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500
      });

      expect(health.running).toBe(true);
      expect(health.isCanaryActive()).toBe(true);
      expect(health.isKeepaliveActive()).toBe(true);
    });

    it('canary is inactive on disabled chain but keepalive still runs', () => {
      getExpectedBlockMs.mockReturnValue(null);
      const health = new ServiceHealth({ log: noopLog });
      const provider = createMockProvider();
      const onUnhealthy = vi.fn();

      health.start({
        provider,
        chainId: 1337,
        onUnhealthy,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500
      });

      expect(health.isCanaryActive()).toBe(false);
      expect(health.isKeepaliveActive()).toBe(true);
    });

    it('stop() stops both components', () => {
      getExpectedBlockMs.mockReturnValue(250);
      const health = new ServiceHealth({ log: noopLog });
      const provider = createMockProvider();

      health.start({
        provider,
        chainId: 42161,
        onUnhealthy: vi.fn(),
        pingIntervalMs: 1000,
        pongTimeoutMs: 500
      });
      health.stop();

      expect(health.running).toBe(false);
      expect(health.isCanaryActive()).toBe(false);
      expect(health.isKeepaliveActive()).toBe(false);
    });

    it('updateProvider() re-attaches both components to new provider', () => {
      getExpectedBlockMs.mockReturnValue(250);
      const health = new ServiceHealth({ log: noopLog });
      const provider1 = createMockProvider();
      const provider2 = createMockProvider();
      const onUnhealthy = vi.fn();

      health.start({
        provider: provider1,
        chainId: 42161,
        onUnhealthy,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500
      });

      health.updateProvider(provider2);

      expect(provider1.off).toHaveBeenCalledWith('block', expect.any(Function));
      expect(provider2.on).toHaveBeenCalledWith('block', expect.any(Function));
      expect(health.isCanaryActive()).toBe(true);
      expect(health.isKeepaliveActive()).toBe(true);
    });

    it('updateProvider() without prior start() throws', () => {
      const health = new ServiceHealth({ log: noopLog });
      expect(() => health.updateProvider(createMockProvider())).toThrow('must call start()');
    });

    it('start() validates required parameters', () => {
      const health = new ServiceHealth({ log: noopLog });

      expect(() => health.start({})).toThrow('provider is required');
      expect(() => health.start({ provider: createMockProvider() }))
        .toThrow('chainId is required');
      expect(() => health.start({ provider: createMockProvider(), chainId: 42161 }))
        .toThrow('onUnhealthy callback is required');
    });

    it('canary and keepalive share the same onUnhealthy callback', () => {
      getExpectedBlockMs.mockReturnValue(250);
      const health = new ServiceHealth({ log: noopLog });
      const provider = createMockProvider();
      const onUnhealthy = vi.fn();

      health.start({
        provider,
        chainId: 42161,
        onUnhealthy,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500
      });

      // Canary path
      vi.advanceTimersByTime(1500);
      expect(onUnhealthy).toHaveBeenCalledWith(expect.stringContaining('Canary'));

      // Reset and test keepalive path in a fresh run
      onUnhealthy.mockClear();
      health.stop();
      health.start({
        provider,
        chainId: 42161,
        onUnhealthy,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500
      });

      // Block keeps the canary happy
      provider.emitBlock(1);
      vi.advanceTimersByTime(1000); // ping fires
      vi.advanceTimersByTime(600); // pong timeout (500ms) + margin
      expect(onUnhealthy).toHaveBeenCalledWith(expect.stringContaining('Ping timeout'));
    });
  });
});
