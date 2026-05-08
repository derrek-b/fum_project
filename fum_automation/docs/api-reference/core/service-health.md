<!-- Source: src/core/ServiceHealth.js -->
# ServiceHealth API

**Source:** `src/core/ServiceHealth.js`

Transport-layer and subscription-layer health monitoring for the automation service's WebSocket provider. Composes two private components:

- **SubscriptionCanary** — Subscribes to `provider.on('block', ...)` (ethers.js v5 wrapper over `eth_subscribe newHeads`). If no block notification arrives within `2 × expectedBlockMs + 500ms`, fires `onUnhealthy`. Disabled on chains where `expectedBlockMs` is `null` (e.g., Hardhat auto-mine forks where idle produces no blocks).

  **⚠️ Production behavior — canary is no-op'd (added 2026-05-08).** An early-return at the top of `SubscriptionCanary.start()` short-circuits when `expectedBlockMsOverride === undefined` (i.e., production callers — tests always provide an override and continue to exercise the real path). Reason: on Arbitrum's 4-blocks/sec cadence, the canary's `eth_subscribe newHeads` was burning ~5.5M–35M CU/day on Alchemy, exceeding the free monthly tier in healthy operation alone. Search for `TEMPORARY NO-OP` in the source to find the gate. To re-enable, see notes in the source comment — but consider replacing with a traffic-observation canary (track when our existing subscriptions last delivered an event) instead of restoring the original `newHeads` approach.

- **PingPongKeepalive** — Sends WebSocket `ping` frames every 10s, expects `pong` within 5s. Catches silent transport death (half-dead TCP connections with no close event). Runs on all chains including Hardhat. **Currently the only active health monitor in production** while the canary is no-op'd.

On any failure, `onUnhealthy` routes through `AutomationService.handleProviderDisconnect` → `attemptReconnection`.

## Constructor

```javascript
new ServiceHealth({
  eventManager,    // EventManager instance (optional, for future event emission)
  log              // function, default: console.log with [ServiceHealth] prefix
})
```

## Lifecycle

### start(opts)

Start health monitoring.

| Option | Type | Required | Description |
|---|---|---|---|
| `provider` | WebSocketProvider | yes | ethers.js v5 WebSocket provider |
| `chainId` | number | yes | Chain ID for expectedBlockMs lookup |
| `onUnhealthy` | function(reason) | yes | Called when either mechanism detects unhealth |
| `expectedBlockMsOverride` | number \| null | no | Test-only: override canary threshold. `null` disables canary. |
| `pingIntervalMs` | number | no | Override ping interval (default 10000) |
| `pongTimeoutMs` | number | no | Override pong timeout (default 5000) |

### stop()

Stop both components. Safe to call when not running. Preserves `_startArgs` for `updateProvider()`.

### updateProvider(provider)

Re-attach both components to a new provider after reconnection. Reuses the `chainId`, `onUnhealthy` callback, and overrides from the most recent `start()` call.

## Status

| Method | Returns | Description |
|---|---|---|
| `isCanaryActive()` | `boolean` | Whether the canary is watching blocks (false when disabled or not started — also false in production due to the no-op gate) |
| `isKeepaliveActive()` | `boolean` | Whether ping/pong keepalive is running |

## See Also

- [Architecture Overview](../../architecture/overview.md) — Where ServiceHealth fits in the system
- [Automation Flow](../../architecture/automation-flow.md) — Provider reconnection flow
