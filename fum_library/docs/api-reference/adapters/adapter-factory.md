# AdapterFactory API Reference

Factory class for creating platform-specific adapter instances.

**Source:** `src/adapters/AdapterFactory.js`

## Overview

`AdapterFactory` manages a static registry of platform adapter classes and creates instances on demand. Adapters are keyed by platform ID and constructed with `(chainId, provider)`.

## Registered Adapters

| Platform ID | Adapter Class | Description |
|---|---|---|
| `uniswapV3` | `UniswapV3Adapter` | Uniswap V3 concentrated liquidity |
| `uniswapV4` | `UniswapV4Adapter` | Uniswap V4 (singleton PoolManager) |
| `traderjoeV2_2` | `TraderJoeV2_2Adapter` | Trader Joe V2.2 Liquidity Book |

## Static Methods

### getAdapter(platformId, chainId, provider)

Create a specific platform adapter.

```javascript
const adapter = AdapterFactory.getAdapter('uniswapV3', 42161, provider);
```

| Param | Type | Description |
|---|---|---|
| `platformId` | `string` | Platform identifier (e.g., `'uniswapV3'`) |
| `chainId` | `number` | Chain ID (e.g., 42161 for Arbitrum) |
| `provider` | `ethers.Provider` | Ethers provider instance |

**Returns:** Platform adapter instance.

**Throws:**
- `"Platform ID must be a valid string"` — if platformId missing/not string
- `"chainId must be a valid number"` — if chainId missing/not number
- `"No adapter available for platform: ..."` — if platformId not registered
- `"Failed to create ... adapter for chain ..."` — if adapter constructor fails

---

### getAdaptersForChain(chainId, provider)

Create all registered adapters for a specific chain. Unlike `getAdapter`, this does not throw on individual adapter failures — it collects them in a `failures` array.

```javascript
const { adapters, failures } = AdapterFactory.getAdaptersForChain(42161, provider);

console.log(`Created ${adapters.length} adapters`);
if (failures.length > 0) {
  console.warn('Failed adapters:', failures.map(f => f.platformId));
}
```

| Param | Type | Description |
|---|---|---|
| `chainId` | `number` | Chain ID |
| `provider` | `ethers.Provider` | Ethers provider instance |

**Returns:** `{ adapters: Array, failures: Array<{ platformId, error, errorDetails }> }`

Only creates adapters for platforms enabled on the chain (via `lookupChainPlatformIds(chainId)` from chainHelpers).

**Throws:** `"chainId must be a valid number"` — if chainId missing/not number.

---

### getSupportedPlatforms()

List all registered platform IDs.

```javascript
AdapterFactory.getSupportedPlatforms();
// ['uniswapV3', 'uniswapV4', 'traderjoeV2_2']
```

**Returns:** `string[]`

---

### hasAdapter(platformId)

Check if a platform ID is registered.

```javascript
AdapterFactory.hasAdapter('uniswapV3');  // true
AdapterFactory.hasAdapter('sushiswap');  // false
```

**Returns:** `boolean`

---

### registerAdapterForTestingOnly(platformId, AdapterClass)

Register a new adapter class. Intended for testing and plugin scenarios only — registrations are not persistent across restarts.

```javascript
AdapterFactory.registerAdapterForTestingOnly('mockPlatform', MockAdapter);
```

**Throws:** `"Platform ID and Adapter class are required for registration"`

---

## Convenience Wrappers (adapters/index.js)

> **Warning:** The convenience functions exported from `adapters/index.js` have stale signatures that pass an extra `config` parameter not accepted by the factory methods. Use `AdapterFactory` directly.

```javascript
// These have incorrect signatures — do NOT use:
// getAdaptersForChain(config, chainId, provider)  ← wrong
// getAdapter(config, platformId, provider)         ← wrong
// registerAdapter(platformId, AdapterClass)        ← calls non-existent method

// Use AdapterFactory directly instead:
import { AdapterFactory } from 'fum_library/adapters';
```

## Usage Examples

### In automation service startup

```javascript
import { AdapterFactory } from 'fum_library/adapters';

const { adapters, failures } = AdapterFactory.getAdaptersForChain(42161, provider);

for (const adapter of adapters) {
  console.log(`Loaded ${adapter.platformName} (${adapter.platformId})`);
}
```

### Getting a specific adapter for a known platform

```javascript
const adapter = AdapterFactory.getAdapter(position.platform, chainId, provider);
const poolData = await adapter.getPoolData(position.pool, provider);
```

## See Also

- [PlatformAdapter](./platform-adapter.md) — Base class interface
- [Adapters Architecture](../../architecture/adapters.md) — Design decisions and usage flows
