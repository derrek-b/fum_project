<!-- Source: src/core/VaultDataService.js -->
# VaultDataService API

**Source:** `src/core/VaultDataService.js`

Centralized vault data loading, caching, and access. Only stores data for authorized vaults. Uses private `#vaults` Map — all access goes through public methods.

## Constructor

```javascript
new VaultDataService(eventManager)
```

Dependencies injected after construction:
- `initialize(provider, chainId)` — set provider and chain
- `setTokens(tokens)` — token configurations reference
- `setAdapters(adapters)` — platform adapters Map reference
- `setPoolData(poolData)` — pool data cache reference

## Vault Loading

| Method | Description |
|---|---|
| `getVault(vaultAddress, forceRefresh?)` | Get cached vault or load if not cached. Default: no force refresh. |
| `loadVaultData(vaultAddress)` | Full vault data load with retry: vault info, strategy, tokens, positions |

### Vault Data Shape

See [Cache Structures](../../architecture/cache-structures.md) for the complete `#vaults` Map structure. Key fields: `address`, `owner`, `chainId`, `strategyAddress`, `strategy` (with `parameters`), `tokens` (symbol→balance), `positions` (id→position), `targetTokens`, `targetPlatforms`.

## Position & Token Operations

| Method | Description |
|---|---|
| `refreshTokens(vaultAddress)` | Refresh only token balances |
| `updatePosition(vaultAddress, positionData, poolData)` | Update a single position's data |
| `fetchAssetValues(vault, cacheDuration?)` | Calculate USD values for all vault assets. Default: 30s cache. |

## Configuration Updates

| Method | Description |
|---|---|
| `updateTargetTokens(vaultAddress, newTokens)` | Update vault's target token list |
| `updateTargetPlatforms(vaultAddress, newPlatforms)` | Update vault's target platform list |
| `updateStrategyParameters(vaultAddress)` | Re-read strategy parameters from contract |

## Cache Management

| Method | Description |
|---|---|
| `hasVault(vaultAddress)` | Check if vault is cached |
| `removeVault(vaultAddress)` | Remove vault from cache |
| `getAllVaults()` | Get array of all cached vaults |
| `clearCache()` | Clear all cached vaults |
| `getVaultStrategyId(vaultAddress)` | Get strategy ID for a vault |

## Events

| Method | Description |
|---|---|
| `subscribe(event, callback)` | Subscribe to VaultDataService events |
| `getAvailableEvents()` | List all available event types |

Key events emitted: `initialized`, `vaultLoading`, `vaultLoaded`, `vaultLoadError`, `positionsRefreshed`, `positionsRefreshError`, `positionUpdated`, `tokensRefreshed`, `targetTokensUpdated`, `targetPlatformsUpdated`, `strategyParametersUpdated`, `AssetValuesFetched`, `TokenBalancesFetched`, `PoolDataFetched`, `cacheCleared`, `vaultRemoved`.

## Testing Helpers

| Method | Description |
|---|---|
| `_setVaultForTesting(vaultAddress, vaultData)` | Inject test vault data |
| `_getCacheSizeForTesting()` | Get number of cached vaults |

## See Also

- [Cache Structures](../../architecture/cache-structures.md) — Complete vault data shape
