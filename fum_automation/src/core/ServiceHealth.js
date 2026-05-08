/**
 * @module core/ServiceHealth
 * @description Transport-layer and subscription-layer health monitoring for
 * the automation service's WebSocket provider.
 *
 * Owns two private components:
 *
 *   SubscriptionCanary — subscribes to `newHeads` on the same WS pipe as the
 *   vault event subscriptions. If no block notification arrives within the
 *   per-chain threshold (2 × expectedBlockMs + 500ms buffer), the canary
 *   fires `onUnhealthy` — catching silent subscription death where the
 *   underlying transport stays alive but eth_subscription notifications stop.
 *   Disabled on chains whose `expectedBlockMs` is `null` (Hardhat forks on
 *   auto-mine, where idle produces no blocks and the canary would false-
 *   positive constantly).
 *
 *   PingPongKeepalive — sends WebSocket ping frames every 10 seconds and
 *   expects pong within 5 seconds. Catches silent transport death (half-dead
 *   TCP connection with no close event), independently of subscription
 *   activity. Runs on every chain including Hardhat — the transport-layer
 *   check is cadence-agnostic and harmless when the node is healthy.
 *
 * On any failure, the owning AutomationService routes `onUnhealthy` through
 * the existing `handleProviderDisconnect` → `attemptReconnection` path.
 *
 * @since 2.1.0
 */

import { getExpectedBlockMs } from 'fum_library/helpers/chainHelpers';

const DEFAULT_CANARY_BUFFER_MS = 500;
const DEFAULT_PING_INTERVAL_MS = 10_000;
const DEFAULT_PONG_TIMEOUT_MS = 5_000;

/**
 * Subscription canary — detects silent `eth_subscription` pipe death.
 */
class SubscriptionCanary {
  constructor({ log, bufferMs = DEFAULT_CANARY_BUFFER_MS }) {
    this.log = log;
    this.bufferMs = bufferMs;
    this.provider = null;
    this.thresholdMs = null;
    this.onUnhealthy = null;
    this.deadlineTimer = null;
    this.blockHandler = null;
    this.enabled = false;
  }

  /**
   * Start the canary. If `expectedBlockMs` is null the canary is disabled and
   * this method is a no-op (logs once and returns).
   */
  start({ provider, chainId, onUnhealthy, expectedBlockMsOverride }) {
    this.stop();

    // ----------------------------------------------------------------------
    // TEMPORARY NO-OP (added 2026-05-08): canary disabled in production.
    //
    // Steady-state newHeads delivery on Arbitrum (4 events/sec from this
    // canary's `eth_subscribe newHeads`) projected to burn 5.5M–35M CU/day
    // on Alchemy (depends on per-event billing rate), exceeding the free
    // monthly tier in healthy operation alone. Confirmed against publicnode
    // baseline 2026-05-08: ~240 newHeads/min is the dominant WS traffic.
    //
    // PingPongKeepalive still catches transport-layer death globally; what
    // we lose is detection of "transport alive but Alchemy stopped delivering
    // events" — a real failure mode but acceptable cost for now.
    //
    // To re-enable: remove this early-return block. Tests pass through
    // because they always provide `expectedBlockMsOverride`; production
    // callers never do, so production hits the no-op while the canary
    // tests in fum_automation/test/ still exercise the real path.
    // ----------------------------------------------------------------------
    if (expectedBlockMsOverride === undefined) {
      this.log(`SubscriptionCanary: production no-op active (canary disabled for chain ${chainId})`);
      this.enabled = false;
      return;
    }

    const expectedBlockMs =
      expectedBlockMsOverride !== undefined
        ? expectedBlockMsOverride
        : getExpectedBlockMs(chainId);

    if (expectedBlockMs === null) {
      this.log(`SubscriptionCanary: disabled for chain ${chainId}`);
      this.enabled = false;
      return;
    }

    this.provider = provider;
    this.thresholdMs = 2 * expectedBlockMs + this.bufferMs;
    this.onUnhealthy = onUnhealthy;
    this.enabled = true;

    this.blockHandler = () => this.#resetDeadline();
    this.provider.on('block', this.blockHandler);
    this.#resetDeadline();

    this.log(
      `SubscriptionCanary: started for chain ${chainId} ` +
      `(expectedBlockMs=${expectedBlockMs}, thresholdMs=${this.thresholdMs})`
    );
  }

  /**
   * Stop the canary and tear down all state. Safe to call when already stopped.
   */
  stop() {
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
    if (this.provider && this.blockHandler) {
      try {
        this.provider.off('block', this.blockHandler);
      } catch {
        // Provider may already be destroyed; ignore.
      }
    }
    this.provider = null;
    this.blockHandler = null;
    this.onUnhealthy = null;
    this.enabled = false;
  }

  #resetDeadline() {
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer);
    }
    this.deadlineTimer = setTimeout(() => {
      if (!this.enabled || !this.onUnhealthy) return;
      const reason = `Canary: no newHeads for >${this.thresholdMs}ms`;
      this.log(`SubscriptionCanary: ${reason}`);
      // One-shot: the owner will tear us down via stop() during reconnect.
      this.enabled = false;
      this.onUnhealthy(reason);
    }, this.thresholdMs);
  }
}

/**
 * Ping/pong keepalive — detects silent transport death.
 */
class PingPongKeepalive {
  constructor({
    log,
    pingIntervalMs = DEFAULT_PING_INTERVAL_MS,
    pongTimeoutMs = DEFAULT_PONG_TIMEOUT_MS
  }) {
    this.log = log;
    this.pingIntervalMs = pingIntervalMs;
    this.pongTimeoutMs = pongTimeoutMs;
    this.provider = null;
    this.ws = null;
    this.onUnhealthy = null;
    this.pingTimer = null;
    this.pongTimer = null;
    this.pongHandler = null;
    this.pongPending = false;
    this.enabled = false;
  }

  start({ provider, onUnhealthy }) {
    this.stop();

    // provider._websocket is the `ws` package WebSocket instance; exposes
    // .ping() and emits 'pong' on reply. See websocket-provider.js line 98.
    if (!provider || !provider._websocket) {
      this.log('PingPongKeepalive: no _websocket on provider, keepalive not started');
      return;
    }

    this.provider = provider;
    this.ws = provider._websocket;
    this.onUnhealthy = onUnhealthy;
    this.enabled = true;

    this.pongHandler = () => {
      this.log('🏓 PingPongKeepalive: pong received');
      this.pongPending = false;
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
        this.pongTimer = null;
      }
    };
    this.ws.on('pong', this.pongHandler);

    this.pingTimer = setInterval(() => this.#sendPing(), this.pingIntervalMs);

    this.log(
      `PingPongKeepalive: started ` +
      `(pingIntervalMs=${this.pingIntervalMs}, pongTimeoutMs=${this.pongTimeoutMs})`
    );
  }

  stop() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    if (this.ws && this.pongHandler) {
      try {
        this.ws.off('pong', this.pongHandler);
      } catch {
        // Ignore — socket may already be closed.
      }
    }
    this.provider = null;
    this.ws = null;
    this.pongHandler = null;
    this.onUnhealthy = null;
    this.pongPending = false;
    this.enabled = false;
  }

  #sendPing() {
    if (!this.enabled || !this.ws) return;

    // If we still have an outstanding ping from the previous interval and
    // its pong never arrived, that's caught by the pongTimer path already —
    // don't stack pings.
    if (this.pongPending) return;

    try {
      this.ws.ping();
      this.log('🏓 PingPongKeepalive: ping sent');
    } catch (error) {
      // send failed (socket closed/corrupted) — treat as unhealthy
      this.log(`PingPongKeepalive: ping send failed: ${error.message}`);
      const reason = `Ping send failed: ${error.message}`;
      this.enabled = false;
      if (this.onUnhealthy) this.onUnhealthy(reason);
      return;
    }

    this.pongPending = true;
    this.pongTimer = setTimeout(() => {
      if (!this.enabled) return;
      if (!this.pongPending) return;
      const reason = `Ping timeout: no pong within ${this.pongTimeoutMs}ms`;
      this.log(`PingPongKeepalive: ${reason}`);
      this.enabled = false;
      if (this.onUnhealthy) this.onUnhealthy(reason);
    }, this.pongTimeoutMs);
  }
}

/**
 * Service health monitor composing subscription canary + ping/pong keepalive.
 */
class ServiceHealth {
  constructor({ eventManager, log } = {}) {
    this.eventManager = eventManager;
    this.log = log || ((msg) => console.log(`[ServiceHealth] ${msg}`));
    this.canary = new SubscriptionCanary({ log: this.log });
    this.keepalive = new PingPongKeepalive({ log: this.log });
    this.running = false;
    this._startArgs = null;
  }

  /**
   * Start health monitoring against the given provider.
   *
   * @param {Object} opts
   * @param {Object} opts.provider - WebSocketProvider instance
   * @param {number} opts.chainId - Chain ID for expectedBlockMs lookup
   * @param {Function} opts.onUnhealthy - Called with a reason string when
   *   either mechanism detects unhealth. Caller is expected to run reconnection.
   * @param {number|null} [opts.expectedBlockMsOverride] - Test-only override
   *   for the canary threshold. When provided, bypasses `getExpectedBlockMs`
   *   lookup. Set to `null` explicitly to force canary-disabled mode.
   * @param {number} [opts.pingIntervalMs]
   * @param {number} [opts.pongTimeoutMs]
   */
  start(opts) {
    const {
      provider,
      chainId,
      onUnhealthy,
      expectedBlockMsOverride,
      pingIntervalMs,
      pongTimeoutMs
    } = opts;

    if (!provider) throw new Error('ServiceHealth.start: provider is required');
    if (!chainId) throw new Error('ServiceHealth.start: chainId is required');
    if (typeof onUnhealthy !== 'function') {
      throw new Error('ServiceHealth.start: onUnhealthy callback is required');
    }

    // Apply optional runtime overrides to the internal components
    if (pingIntervalMs !== undefined) this.keepalive.pingIntervalMs = pingIntervalMs;
    if (pongTimeoutMs !== undefined) this.keepalive.pongTimeoutMs = pongTimeoutMs;

    this._startArgs = { ...opts };

    this.canary.start({ provider, chainId, onUnhealthy, expectedBlockMsOverride });
    this.keepalive.start({ provider, onUnhealthy });
    this.running = true;

    this.log('ServiceHealth: started');
  }

  /**
   * Stop both components. Safe to call when not running. `_startArgs` is
   * preserved so `updateProvider()` can re-attach to a new provider after
   * a reconnect flow that explicitly stopped this monitor.
   */
  stop() {
    this.canary.stop();
    this.keepalive.stop();
    this.running = false;
    this.log('ServiceHealth: stopped');
  }

  /**
   * Re-attach both components to a new provider (e.g. after reconnection).
   * Preserves the chainId, onUnhealthy callback, and overrides from the most
   * recent `start()` call. Works whether or not the monitor was explicitly
   * stopped between the original `start()` and this call.
   *
   * @param {Object} provider - New WebSocketProvider instance
   */
  updateProvider(provider) {
    if (!this._startArgs) {
      throw new Error('ServiceHealth.updateProvider: must call start() first');
    }
    this.start({ ...this._startArgs, provider });
  }

  /**
   * @returns {boolean} Whether the canary is actively watching blocks
   * (false when disabled for the chain or not yet started).
   */
  isCanaryActive() {
    return this.canary.enabled;
  }

  /**
   * @returns {boolean} Whether ping/pong keepalive is running
   */
  isKeepaliveActive() {
    return this.keepalive.enabled;
  }
}

export default ServiceHealth;
export { SubscriptionCanary, PingPongKeepalive };
