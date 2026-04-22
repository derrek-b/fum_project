<!-- Source: src/helpers/platformHelpers.js -->
# Platform Helpers API

Platform configuration utilities for managing DeFi protocol integrations and metadata.

## Overview

The Platform Helpers module provides utilities for working with supported DeFi platforms (currently Uniswap V3, Uniswap V4, Trader Joe V2.2). It manages platform metadata, visual branding, fee tiers, tick configuration, and per-chain availability. All lookup functions use fail-fast validation — invalid inputs and missing data throw descriptive errors.

## Exports

```javascript
import {
  validatePlatformId,
  getPlatformMetadata,
  getPlatformName,
  getPlatformColor,
  getPlatformLogo,
  lookupSupportedPlatformIds,
  getPlatformFeeTiers,
  getPlatformTickSpacing,
  getPlatformTickBounds,
  getAvailablePlatforms,
  lookupPlatformById,
} from 'fum_library/helpers/platformHelpers';
```

## Functions

### validatePlatformId

Throws if `platformId` is missing, not a string, or empty. Used internally by every lookup function; exported for reuse by callers.

```javascript
validatePlatformId(platformId: any): void
```

---

### getPlatformMetadata

Return the raw platform config object from `configs/platforms.js`.

```javascript
getPlatformMetadata(platformId: string): Object
```

Returns:

```javascript
{
  id: "uniswapV3",
  name: "Uniswap V3",
  logo: "/Platform_Logos/uniswap.svg",
  color: "#FF007A",
  description: "...",
  features: { concentratedLiquidity: true, ... },
  feeTiers: { 100: {...}, 500: {...}, 3000: {...}, 10000: {...} },
  minTick: -887272,
  maxTick: 887272,
  subgraphs: { [chainId]: { id, queryType } }
}
```

**Throws** if the platform is not configured.

---

### getPlatformName

Human-readable platform name.

```javascript
getPlatformName(platformId: string): string
```

**Throws** if the platform is not supported or the `name` property is missing/empty.

---

### getPlatformColor

Primary brand color (hex string).

```javascript
getPlatformColor(platformId: string): string
```

**Throws** if the platform is not supported or the `color` property is missing/empty.

---

### getPlatformLogo

Logo URL.

```javascript
getPlatformLogo(platformId: string): string
```

**Throws** if the platform is not supported or the `logo` property is missing/empty.

---

### getPlatformFeeTiers

Fee tiers supported by the platform, as an array of basis-point values.

```javascript
getPlatformFeeTiers(platformId: string): number[]
```

Example: `getPlatformFeeTiers('uniswapV3')` → `[100, 500, 3000, 10000]`.

**Throws** if the platform is not supported or `feeTiers` is not configured (e.g., Trader Joe V2.2, which uses per-pool `binStep` instead of fixed tiers).

---

### getPlatformTickSpacing

Tick spacing for a given fee tier.

```javascript
getPlatformTickSpacing(platformId: string, fee: number): number
```

Example: `getPlatformTickSpacing('uniswapV3', 500)` → `10`.

**Throws** if the platform is not configured, `feeTiers` is missing, or the fee tier is not defined.

---

### getPlatformTickBounds

Platform-wide tick range limits.

```javascript
getPlatformTickBounds(platformId: string): { minTick: number, maxTick: number }
```

Example: `getPlatformTickBounds('uniswapV3')` → `{ minTick: -887272, maxTick: 887272 }`.

**Throws** if the platform is not configured or the bounds are missing.

---

### lookupSupportedPlatformIds

All configured platform IDs.

```javascript
lookupSupportedPlatformIds(): string[]
```

Returns e.g. `['uniswapV3', 'uniswapV4', 'traderjoeV2_2']`.

---

### getAvailablePlatforms

All platforms enabled on a specific chain (combined metadata + chain addresses).

```javascript
getAvailablePlatforms(chainId: number): Object[]
```

Returns an array of platform objects that have addresses configured for the chain. Each object merges platform metadata with the chain's `platformAddresses[platformId]` contents.

**Throws** via `validateChainId` for invalid chainIds, and if the chain has no `platformAddresses` configured.

---

### lookupPlatformById

Combined metadata + chain addresses for a specific platform on a specific chain.

```javascript
lookupPlatformById(platformId: string, chainId: number): Object | null
```

Returns `null` only when the platform is not configured on the chain (business-logic signal — use for conditional availability checks). **Throws** for other invalid inputs (unknown platform, missing metadata properties, chain not supported).

---

## Common Patterns

### Multi-Chain Platform Discovery

```javascript
import { lookupSupportedChainIds, getChainName } from 'fum_library/helpers/chainHelpers';
import { lookupPlatformById } from 'fum_library/helpers/platformHelpers';

function getPlatformChains(platformId) {
  return lookupSupportedChainIds()
    .filter(chainId => lookupPlatformById(platformId, chainId) !== null)
    .map(chainId => ({
      chainId,
      chainName: getChainName(chainId),
      platform: lookupPlatformById(platformId, chainId)
    }));
}
```

### Platform Selector UI

```javascript
const platformOptions = getAvailablePlatforms(chainId).map(platform => ({
  value: platform.id,
  label: platform.name,
  icon: platform.logo,
  color: platform.color
}));
```

## See Also

- [`chainHelpers`](./chain-helpers.md) — Chain configuration utilities
- [`tokenHelpers`](./token-helpers.md) — Token management utilities
- [Adapters Architecture](../../architecture/adapters.md) — How adapters consume platform metadata
