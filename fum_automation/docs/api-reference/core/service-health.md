<!-- Source: src/core/ServiceHealth.js -->
# ServiceHealth API

**Source:** `src/core/ServiceHealth.js`

Transport-layer and subscription-layer health monitoring for the automation service's WebSocket provider. Composes two private components:

- **SubscriptionCanary** — Subscribes to `provider.on('block', ...)` (ethers.js v5 wrapper over `eth_subscribe newHeads`). If no block notification arrives within `2 × expectedBlockMs + 500ms`, fires `onUnhealthy`. Disabled on chains where `expectedBlockMs` is `null` (e.g., Hardhat auto-mine forks where idle produces no blocks).

- **PingPongKeepalive** — Sends WebSocket `ping` frames every 10s, expects `pong` within 5s. Catches silent transport death (half-dead TCP connections with no close event). Runs on all chains including Hardhat.

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
| `isCanaryActive()` | `boolean` | Whether the canary is watching blocks (false when disabled or not started) |
| `isKeepaliveActive()` | `boolean` | Whether ping/pong keepalive is running |

## See Also

- [Architecture Overview](../../architecture/overview.md) — Where ServiceHealth fits in the system
- [Automation Flow](../../architecture/automation-flow.md) — Provider reconnection flow
