<!-- Source: src/adapters/AdapterFactory.js -->
# AdapterFactory API Reference

Factory class for creating platform-specific adapter instances.

**Source:** `src/adapters/AdapterFactory.js`

## Overview

`AdapterFactory` manages a static registry of platform adapter classes and creates instances on demand. Adapters are keyed by platform ID and constructed with `(chainId)` only — providers are passed per-method call on the resulting adapter instance.

## Registered Adapters

| Platform ID | Adapter Class | Description |
|---|---|---|
| `uniswapV3` | `UniswapV3Adapter` | Uniswap V3 concentrated liquidity |
| `uniswapV4` | `UniswapV4Adapter` | Uniswap V4 (singleton PoolManager) |
| `traderjoeV2_2` | `TraderJoeV2_2Adapter` | Trader Joe V2.2 Liquidity Book |

## Static Methods

### getAdapter(platformId, chainId)

Create a specific platform adapter.

```javascript
const adapter = AdapterFactory.getAdapter('uniswapV3', 42161);
```

| Param | Type | Description |
|---|---|---|
| `platformId` | `string` | Platform identifier (e.g., `'uniswapV3'`) |
| `chainId` | `number` | Chain ID (e.g., 42161 for Arbitrum) |

**Returns:** Platform adapter instance.

**Throws:**
- `"Platform ID must be a valid string"` — if platformId missing/not string
- `"chainId must be a valid number"` — if chainId missing/not number
- `"No adapter available for platform: ..."` — if platformId not registered
- `"Failed to create ... adapter for chain ..."` — if adapter constructor fails

---

### getAdaptersForChain(chainId)

Create all registered adapters for a specific chain. Unlike `getAdapter`, this does not throw on individual adapter failures — it collects them in a `failures` array.

```javascript
const { adapters, failures } = AdapterFactory.getAdaptersForChain(42161);

console.log(`Created ${adapters.length} adapters`);
if (failures.length > 0) {
  console.warn('Failed adapters:', failures.map(f => f.platformId));
}
```

| Param | Type | Description |
|---|---|---|
| `chainId` | `number` | Chain ID |

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

`adapters/index.js` re-exports thin wrappers around the factory for ergonomic imports:

```javascript
import {
  getAdaptersForChain,
  getAdapter,
  getSupportedPlatforms
} from 'fum_library/adapters';

const { adapters, failures } = getAdaptersForChain(42161);
const adapter = getAdapter('uniswapV3', 42161);
```

> There is no convenience wrapper for `registerAdapterForTestingOnly` — call `AdapterFactory.registerAdapterForTestingOnly(platformId, AdapterClass)` directly. The omission is intentional: the wrapper would re-expose the testing-only escape hatch under a production-looking name.

## Usage Examples

### In automation service startup

```javascript
import { AdapterFactory } from 'fum_library/adapters';

const { adapters, failures } = AdapterFactory.getAdaptersForChain(42161);

for (const adapter of adapters) {
  console.log(`Loaded ${adapter.platformName} (${adapter.platformId})`);
}
```

### Getting a specific adapter for a known platform

```javascript
const adapter = AdapterFactory.getAdapter(position.platform, chainId);
const poolData = await adapter.getPoolData(position.pool, provider);
```

## See Also

- [PlatformAdapter](./platform-adapter.md) — Base class interface
- [Adapters Architecture](../../architecture/adapters.md) — Design decisions and usage flows
