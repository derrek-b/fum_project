# SSEBroadcaster

The SSEBroadcaster module provides Server-Sent Events (SSE) streaming for real-time event delivery to frontend clients. It subscribes to EventManager events and broadcasts them over HTTP connections.

## Overview

SSEBroadcaster creates an HTTP server that:
- Streams automation events to connected clients via SSE
- Provides REST endpoints for vault metadata and transactions
- Exposes health check and blacklist endpoints
- Handles graceful shutdown with client cleanup

## Constructor

```javascript
import SSEBroadcaster from './SSEBroadcaster.js';

const sseBroadcaster = new SSEBroadcaster(eventManager, {
  port: 3001,
  debug: true,
  getBlacklist: () => automationService.getBlacklist(),
  getVaultMetadata: (addr) => tracker.getMetadata(addr),
  getVaultTransactions: (addr, start, end) => tracker.getTransactions(addr, start, end),
  onCrash: (error) => process.exit(1)
});
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `eventManager` | EventManager | Yes | EventManager instance for event subscription |
| `options.port` | number | Yes | HTTP server port |
| `options.debug` | boolean | No | Enable debug logging (default: false) |
| `options.getBlacklist` | Function | No | Callback to get blacklist data |
| `options.getVaultMetadata` | Function | No | Callback to get vault metadata |
| `options.getVaultTransactions` | Function | No | Async callback to get vault transactions |
| `options.onCrash` | Function | No | Callback for fatal runtime errors |

## Methods

### start()

Start the SSE server and subscribe to events.

```javascript
await sseBroadcaster.start();
// Server listening on http://localhost:3001/events
```

**Returns:** `Promise<void>`

**Throws:** Error if port is in use or server fails to start

### stop()

Stop the SSE server and cleanup all connections.

```javascript
await sseBroadcaster.stop();
```

**Returns:** `Promise<void>`

### broadcast(eventName, data)

Manually broadcast an event to all connected clients.

```javascript
sseBroadcaster.broadcast('CustomEvent', { message: 'Hello' });
```

**Parameters:**
- `eventName` (string) - Name of the event
- `data` (Object) - Event payload

### getStatus()

Get current broadcaster status.

```javascript
const status = sseBroadcaster.getStatus();
// { isRunning: true, port: 3001, connectedClients: 5, subscribedEvents: 18 }
```

**Returns:** `Object` with status information

## HTTP Endpoints

### GET /events

SSE endpoint for real-time event streaming.

**Response:** `text/event-stream`

**Initial Event:**
```
event: connected
data: {"timestamp":1700000000000,"subscribedEvents":["ServiceStarted",...]}
```

**Event Format:**
```
event: NewPositionCreated
data: {"event":"NewPositionCreated","data":{...},"timestamp":1700000000000}
```

**Heartbeat:** Sent every 30 seconds to keep connection alive
```
: heartbeat
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "isRunning": true,
  "connectedClients": 5,
  "port": 3001,
  "subscribedEvents": 18
}
```

### GET /blacklist

Get current blacklisted vaults.

**Response:**
```json
{
  "blacklisted": {
    "0x123...": { "reason": "...", "timestamp": 1700000000000 }
  }
}
```

### GET /vault/:address/metadata

Get vault tracking metadata.

**Response:**
```json
{
  "vaultAddress": "0x123...",
  "baseline": { "value": 10000, "timestamp": 1700000000000 },
  "aggregates": { "cumulativeFeesUSD": 150.00, ... },
  "lastSnapshot": { "value": 10500, "timestamp": 1700000000000 }
}
```

### GET /vault/:address/transactions

Get vault transaction history.

**Query Parameters:**
- `limit` (number, optional) - Maximum number of transactions to return
- `since` (number, optional) - Start timestamp in milliseconds

**Response:**
```json
{
  "transactions": [
    { "type": "FeesCollected", "totalUSD": 50.00, "timestamp": 1700000000000 },
    { "type": "TokensSwapped", "swapCount": 2, "timestamp": 1700000001000 }
  ]
}
```

## Subscribed Events

The broadcaster automatically subscribes to and broadcasts these events:

**Service Lifecycle:**
- `ServiceStarted`
- `ServiceStartFailed`

**Position Operations:**
- `NewPositionCreated`
- `PositionsClosed`
- `PositionRebalanced`
- `LiquidityAddedToPosition`

**Fee & Swap Operations:**
- `FeesCollected`
- `TokensSwapped`

**Monitoring:**
- `VaultBaselineCaptured`
- `MonitoringStarted`

**Errors & Recovery:**
- `VaultLoadFailed`
- `VaultLoadRecovered`
- `VaultUnrecoverable`
- `VaultBlacklisted`
- `VaultUnblacklisted`
- `FeeCollectionFailed`

**Transaction Logging:**
- `TransactionLogged`

## Frontend Integration

### JavaScript Client

```javascript
const eventSource = new EventSource('http://localhost:3001/events');

eventSource.addEventListener('connected', (event) => {
  const data = JSON.parse(event.data);
  console.log('Connected, subscribed to:', data.subscribedEvents);
});

eventSource.addEventListener('NewPositionCreated', (event) => {
  const { data, timestamp } = JSON.parse(event.data);
  console.log('New position:', data.positionId);
});

eventSource.addEventListener('FeesCollected', (event) => {
  const { data } = JSON.parse(event.data);
  console.log(`Fees: $${data.totalUSD}`);
});

eventSource.onerror = (error) => {
  console.error('SSE error:', error);
  // EventSource will auto-reconnect
};
```

### React Hook Example

```javascript
function useAutomationEvents(eventTypes, handler) {
  useEffect(() => {
    const eventSource = new EventSource('http://localhost:3001/events');

    eventTypes.forEach(type => {
      eventSource.addEventListener(type, (event) => {
        const payload = JSON.parse(event.data);
        handler(type, payload.data);
      });
    });

    return () => eventSource.close();
  }, [eventTypes, handler]);
}

// Usage
useAutomationEvents(
  ['FeesCollected', 'TokensSwapped'],
  (type, data) => {
    if (type === 'FeesCollected') {
      updateFeeTotal(data.totalUSD);
    }
  }
);
```

## Integration with AutomationService

The SSEBroadcaster is automatically initialized by AutomationService:

```javascript
const automationService = new AutomationService({
  // ... other config
  ssePort: 3001  // Passed to SSEBroadcaster
});

// Access broadcaster instance
const status = automationService.sseBroadcaster.getStatus();
```

## Notes

- CORS is enabled for all origins (`Access-Control-Allow-Origin: *`)
- Heartbeats are sent every 30 seconds to keep connections alive
- New connections are rejected during shutdown (503 response)
- The `log` field is automatically removed from event payloads before broadcast
- EventSource clients will auto-reconnect on connection loss
