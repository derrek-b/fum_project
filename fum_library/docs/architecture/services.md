<!-- Source: src/services/coingecko.js, src/services/theGraph.js, src/services/blockExplorer.js, src/services/merkl.js -->
# Services Architecture

## Overview

The services module integrates with external APIs: CoinGecko for token prices, The Graph for subgraph queries, block explorers (Arbiscan) for internal transaction data, and Merkl for incentive campaign detection and reward claiming. Most services follow a configure-then-use pattern — call the service's `configure*()` function (or `initFumLibrary()`) at startup to set API keys. Merkl requires no configuration.

## CoinGecko Service

**Source:** `src/services/coingecko.js`

Fetches USD token prices from the CoinGecko API with per-token in-memory caching.

### Configuration

```javascript
import { configureCoingecko } from 'fum_library/services/coingecko';

configureCoingecko({ apiKey: process.env.COINGECKO_API_KEY });
```

Stores the API key in a module-level `_config` object. The key is appended to requests as `x_cg_demo_api_key`. If no key is provided, requests go to the free tier endpoint.

### fetchTokenPrices(tokenSymbols, cacheDurationMs)

The main export. Takes an array of token symbols and a cache duration in **milliseconds** (not a string key).

```javascript
import { fetchTokenPrices, CACHE_DURATIONS } from 'fum_library/services/coingecko';

// Using named duration constants
const prices = await fetchTokenPrices(['WETH', 'USDC'], CACHE_DURATIONS['5-SECONDS']);

// Using raw milliseconds
const prices = await fetchTokenPrices(['WETH', 'USDC'], 1500);

// No cache (always fresh)
const prices = await fetchTokenPrices(['WETH', 'USDC'], 0);
```

**Returns:** `{ WETH: 1850.25, USDC: 1.0 }` — prices keyed by uppercase symbol.

**Behavior:**
1. Validates inputs (symbols must be strings, cacheDurationMs must be a non-negative number)
2. Checks in-memory cache — if all requested tokens are cached within `cacheDurationMs`, returns cached prices immediately
3. Maps symbols to CoinGecko IDs via `getCoingeckoId()` from tokenHelpers
4. Calls the CoinGecko `/simple/price` endpoint
5. Validates response (price must be a finite positive number)
6. Updates cache with per-token timestamps
7. On failure: throws — does **not** fall back to stale cache data

### Cache Implementation

Plain object (`priceCache = {}`), not a class. Each entry stores `{ price, timestamp }`:

```javascript
priceCache['WETH'] = { price: 1850.25, timestamp: 1708000000000 };
```

Cache is checked per-token against `cacheDurationMs`. If any requested token is missing or stale, the entire batch is re-fetched.

### CACHE_DURATIONS

Named constants exported for common use cases:

| Key | Value | Use Case |
|---|---|---|
| `'0-SECONDS'` | `0` | Critical transactions — always fresh |
| `'5-SECONDS'` | `5000` | Active liquidity management |
| `'30-SECONDS'` | `30000` | Trading decisions |
| `'1-MINUTE'` | `60000` | Background automation |
| `'2-MINUTES'` | `120000` | Dashboard/portfolio view |
| `'5-MINUTES'` | `300000` | Periodic monitoring |
| `'10-MINUTES'` | `600000` | Error fallback only |

Additional durations exist at 1s, 2s, 10s, and 15s intervals.

### Other Exports

- `ENDPOINTS` — CoinGecko API endpoint constants (SIMPLE_PRICE, COIN_DETAILS, etc.)
- `buildApiUrl(endpoint, params)` — Constructs validated CoinGecko URL with API key. Throws if no key is configured (fail-loud so callers don't silently hit the anonymous public tier).
- `clearPriceCache()` — Empties the cache
- `priceCache` — Direct cache access (for debugging)
- `resetCoingeckoConfig()` — Clears the module-level API key (for testing)

### Error Handling

`fetchTokenPrices` fails fast on errors — no retry logic, no stale fallback. This is intentional for a financial application: using stale prices could lead to bad trading decisions. Callers must handle errors.

---

## The Graph Service

**Source:** `src/services/theGraph.js`

Queries The Graph Protocol subgraphs for pool data and V4 position discovery.

### Configuration

```javascript
import { configureTheGraph } from 'fum_library/services/theGraph';

configureTheGraph({ apiKey: process.env.THE_GRAPH_API_KEY });
```

All query functions require the API key to be configured first. Throws if called without it.

### Exported Functions

#### getPoolTVLAverage(poolAddress, chainId, platformId, days)

Get time-averaged TVL for a pool using daily snapshots from the subgraph.

```javascript
const avgTVL = await getPoolTVLAverage('0xABC...', 42161, 'uniswapV3', 30);
// Returns: 1250000.50 (USD)
```

Supports two subgraph query types (`messari` and `uniswap`) based on platform metadata in `configs/platforms.js`. Throws if the requested number of days doesn't match the available data.

#### getPoolAge(poolAddress, chainId, platformId)

Get the creation timestamp of a pool.

```javascript
const createdAt = await getPoolAge('0xABC...', 42161, 'uniswapV3');
// Returns: 1677000000 (unix seconds)
```

#### discoverV4Pools(token0Address, token1Address, chainId, options?)

Discover Uniswap V4 pools for a token pair. Only returns pools with liquidity > 0 and no hooks (vanilla pools).

```javascript
const pools = await discoverV4Pools('0xtoken0...', '0xtoken1...', 42161, { limit: 10 });
// Returns: [{ id, token0, token1, feeTier, tickSpacing, liquidity, sqrtPrice, tick, hooks, totalValueLockedUSD }]
```

Token addresses must be pre-sorted (lower address first). Results sorted by liquidity descending.

#### getV4PositionsByOwner(ownerAddress, chainId, options?)

Get V4 position tokenIds for an owner. Needed because V4 PositionManager doesn't implement ERC721Enumerable, so on-chain enumeration isn't possible.

```javascript
const tokenIds = await getV4PositionsByOwner('0xVault...', 42161, { limit: 100 });
// Returns: ['12345', '12346', ...]
```

### Subgraph Resolution

Each function looks up the subgraph ID from platform metadata (`getPlatformMetadata(platformId).subgraphs[chainId]`). The subgraph config includes:
- `id` — The Graph subgraph deployment ID
- `queryType` — `'messari'` or `'uniswap'` (determines GraphQL query shape)

### Other Exports

- `resetTheGraphConfig()` — Clears the module-level API key (for testing)

---

## Block Explorer Service

**Source:** `src/services/blockExplorer.js`

Factory-based service for fetching internal transactions from block explorers. Currently supports Arbiscan (Arbitrum + local fork). Uses ethers.js v5 `BigNumber`.

### Configuration

```javascript
import { configureBlockExplorer } from 'fum_library/services/blockExplorer';

configureBlockExplorer({ blockExplorerApiKey: process.env.BLOCK_EXPLORER_API_KEY });
```

### getBlockExplorerService(chainId)

Factory function that returns a chain-specific service object.

```javascript
import { getBlockExplorerService } from 'fum_library/services/blockExplorer';

const explorer = getBlockExplorerService(42161);
```

**Supported chains:**
| Chain ID | Explorer Type | Notes |
|---|---|---|
| 42161 | Arbiscan | Arbitrum One |
| 1337 | Arbiscan | Local fork (queries Arbitrum data) |
| 1, 137 | Alchemy | Not yet implemented — throws |

### Service Methods

The returned service object has two methods:

#### getInternalTransactions(txHash)

Fetch internal (CALL) transactions for a transaction hash via Etherscan V2 API.

```javascript
const internalTxs = await explorer.getInternalTransactions('0xabc...');
// Returns: [{ blockNumber, timeStamp, hash, from, to, value, type, isError, ... }]
```

Returns an array of internal transaction objects. `value` is in wei (string).

#### getEthTransfersForWallet(txHash, walletAddress)

Calculate total ETH received and sent by a specific wallet within a transaction's internal calls.

```javascript
const { received, sent } = await explorer.getEthTransfersForWallet('0xabc...', '0xVault...');
// received: BigNumber, sent: BigNumber (ethers v5)
```

Filters out failed internal transactions (`isError !== '0'`) and zero-value transfers.

### Other Exports

- `getBlockExplorerConfig()` — Returns current config (for testing)
- `resetBlockExplorerConfig()` — Resets to defaults (for testing)

---

## Merkl Service

**Source:** `src/services/merkl.js`

Queries the Merkl API for incentive campaign detection (which pools have active reward programs) and reward claiming (Merkle proofs for the Distributor contract). No configuration needed — no API key required.

See [docs/platform-knowledge/merkl-incentives.md](../../../docs/platform-knowledge/merkl-incentives.md) for API endpoint details, response shapes, and field-level gotchas.

### fetchPoolIncentives(chainId, poolId)

Check if a Uniswap V4 pool has active Merkl incentive campaigns.

```javascript
import { fetchPoolIncentives } from 'fum_library/services/merkl';

const result = await fetchPoolIncentives(42161, '0xab05003a...');
// Returns: { active: true, programs: [{ rewardToken, rewardTokenSymbol, endTimestamp }] }
// Or:      { active: false, programs: [] }
```

**Behavior:**
1. Validates inputs (chainId and poolId required)
2. Checks in-memory cache (5-minute TTL, keyed by `chainId:poolId`)
3. Queries Merkl opportunities endpoint filtered for UNISWAP_V4
4. Matches by `identifier` field (case-insensitive bytes32 comparison)
5. Filters to active campaigns only (endTimestamp > now)
6. On failure: throws with context message

### fetchClaimData(chainId, userAddress)

Fetch Merkle proofs and amounts for unclaimed rewards.

```javascript
import { fetchClaimData } from 'fum_library/services/merkl';

const result = await fetchClaimData(42161, '0xVault...');
// Returns: { user, tokens: ['0x...'], amounts: ['500000...'], proofs: [['0x...']] }
// Or:      null (nothing to claim)
```

**Behavior:**
1. Validates inputs (chainId and userAddress required)
2. Queries Merkl rewards endpoint (`/v4/users/{address}/rewards?chainId={id}`)
3. Filters to rewards where `pending !== '0'`
4. Returns cumulative `amount` (not just pending) — the Distributor contract tracks what's been claimed internally
5. Returns `null` if nothing to claim
6. Not cached — reward data changes with each Merkle root update
7. On failure: throws with context message

### clearIncentiveCache()

Clears the pool incentive cache. Useful for testing.

---

## Initialization Pattern

All services share the same configuration pattern:

1. Module-level `_config` object with defaults
2. `configure*()` function that merges provided options
3. `initFumLibrary()` calls all `configure*()` functions in one shot

Services work without configuration for operations that don't need API keys. Only functions that make external API calls require prior configuration.

## See Also

- [Architecture Overview](./overview.md) — Module structure and initialization
- [API Reference Overview](../api-reference/overview.md) — Per-module function documentation
