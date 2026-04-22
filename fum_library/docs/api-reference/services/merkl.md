<!-- Source: src/services/merkl.js -->
# Merkl Service API

Incentive campaign detection and reward claiming for Uniswap V4 pools via the Merkl API.

## Overview

The Merkl service integrates with the [Merkl](https://merkl.xyz/) API (v4) to detect active liquidity-mining incentive campaigns and to fetch Merkle-proof claim data for the `Distributor` contract. In FUM, this is the incentive source for Uniswap V4: V3 uses native staking contracts, but V4 relies on Merkl's auto-tracking model (rewards accrue automatically based on liquidity — no staking/unstaking required).

Used by `UniswapV4Adapter` to power its `getPoolIncentives` and `getIncentiveClaimTransactions` overrides.

## Exports

```javascript
import {
  fetchPoolIncentives,
  fetchClaimData,
  clearIncentiveCache
} from 'fum_library/services/merkl';
```

## Configuration

Merkl's public endpoints (`opportunities`, `users/{address}/rewards`) require no API key, so no `configureMerkl()` function exists. The service sends `Accept: application/json` headers and is otherwise unconfigured.

## Caching

- **`fetchPoolIncentives`** caches responses per `chainId:poolId` for 5 minutes. Campaigns don't change frequently enough to justify tighter caching.
- **`fetchClaimData`** is **not cached** — reward data changes with each Merkle root update and callers need fresh data when claiming.
- **`clearIncentiveCache()`** clears the incentive cache (testing utility).

## Functions

---

### fetchPoolIncentives

Fetch active Merkl incentive campaigns for a Uniswap V4 pool. Filters the Merkl `opportunities` endpoint to Uniswap V4 campaigns, matches by `poolId`, and returns active campaigns only (those whose `endTimestamp` is in the future).

#### Signature
```javascript
async fetchPoolIncentives(
  chainId: number,
  poolId: string
): Promise<IncentiveStatus>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `chainId` | `number` | Yes | Chain ID (e.g., `42161` for Arbitrum) |
| `poolId` | `string` | Yes | V4 pool identifier (bytes32 PoolId hash, hex string) |

#### Returns

`Promise<IncentiveStatus>`:

```javascript
{
  active: boolean,              // True if any program has endTimestamp > now
  programs: Array<{
    rewardToken: string,        // Reward token contract address
    rewardTokenSymbol: string,  // Reward token symbol
    endTimestamp: number        // Unix seconds; program ends when this passes
  }>
}
```

When no Merkl opportunity matches the poolId, or no campaigns are active, returns `{ active: false, programs: [] }` (still cached for 5 minutes).

#### Throws

| Error | Condition |
|-------|-----------|
| `chainId and poolId are required` | Missing arguments |
| `Failed to fetch Merkl pool incentives for chain X, pool Y: <reason>` | Wraps network/API errors |

The wrapped error includes Merkl API HTTP status when the request fails (e.g., `Merkl API returned 500`).

#### Example

```javascript
import { fetchPoolIncentives } from 'fum_library/services/merkl';

const incentives = await fetchPoolIncentives(
  42161,
  '0xabc123...0def456'  // V4 PoolId (bytes32)
);

if (incentives.active) {
  for (const program of incentives.programs) {
    const endDate = new Date(program.endTimestamp * 1000);
    console.log(`${program.rewardTokenSymbol} rewards until ${endDate.toISOString()}`);
  }
}
```

---

### fetchClaimData

Fetch pending Merkl rewards with Merkle proofs for a user. Returns data shaped for the `Distributor.claim(address user, address[] tokens, uint256[] amounts, bytes32[][] proofs)` function.

#### Signature
```javascript
async fetchClaimData(
  chainId: number,
  userAddress: string
): Promise<ClaimData | null>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `chainId` | `number` | Yes | Chain ID |
| `userAddress` | `string` | Yes | Vault/user address to check for claimable rewards |

#### Returns

`Promise<ClaimData | null>`:

```javascript
{
  user: string,                  // The userAddress (echoed)
  tokens: string[],              // Reward token contract addresses
  amounts: string[],             // Cumulative claimable amounts (TOTAL earned, not just pending)
  proofs: string[][]             // Merkle proofs, one array per token
} | null
```

Returns `null` when there are no pending rewards for the user on the chain.

> **Note:** `amounts` are **cumulative totals** (all-time earned), not the pending delta. The Distributor contract tracks already-claimed amounts on-chain and computes the delta at claim time. Do not attempt to compute pending amounts from this response.

#### Throws

| Error | Condition |
|-------|-----------|
| `chainId and userAddress are required` | Missing arguments |
| `Failed to fetch Merkl claim data for chain X, user Y: <reason>` | Wraps network/API errors |

#### Example

```javascript
import { fetchClaimData } from 'fum_library/services/merkl';

const claim = await fetchClaimData(42161, vaultAddress);
if (!claim) {
  console.log('No pending rewards');
  return;
}

// Build claim calldata for the Merkl Distributor contract.
// Signature: claim(address user, address[] tokens, uint256[] amounts, bytes32[][] proofs)
const distributorInterface = new ethers.utils.Interface([
  'function claim(address user, address[] tokens, uint256[] amounts, bytes32[][] proofs)'
]);

const calldata = distributorInterface.encodeFunctionData('claim', [
  claim.user,
  claim.tokens,
  claim.amounts,
  claim.proofs
]);
```

---

### clearIncentiveCache

Clear the in-memory incentive cache. Testing utility.

#### Signature
```javascript
clearIncentiveCache(): void
```

#### Example
```javascript
import { clearIncentiveCache, fetchPoolIncentives } from 'fum_library/services/merkl';

// Clear cache between test cases to avoid cross-test contamination
beforeEach(() => clearIncentiveCache());
```

---

## API Endpoints

For Merkl endpoint URLs, raw response shapes, filter-param quirks, and Distributor contract addresses, see [docs/platform-knowledge/merkl-incentives.md](../../../../docs/platform-knowledge/merkl-incentives.md). This doc covers only the library's normalized surface — the platform-knowledge doc owns the upstream API contract.

## Why V4 Only

The FUM library uses Merkl for Uniswap V4 because V4 does not have a native staking contract equivalent to V3's `UniswapV3Staker`. Instead, V4 liquidity providers automatically accrue Merkl rewards based on time-weighted liquidity — no custody transfer required.

For Uniswap V3, use the adapter's built-in staker integration (scanning `UniswapV3Staker` events directly) instead of this service. For Trader Joe V2.2, rewards are read from the LBPair's `getLBHooksParameters()` method and claimed via the hooks rewarder contract.

## Error Handling

The service throws on all failure modes rather than returning stale data or default objects — this is intentional for financial operations where missing a campaign or proof could mean lost rewards.

```javascript
try {
  const incentives = await fetchPoolIncentives(chainId, poolId);
  // use incentives
} catch (error) {
  if (error.message.includes('Merkl API returned')) {
    // upstream API failure — treat as transient, retry or defer
  } else {
    // programming error (missing args) — propagate
    throw error;
  }
}
```

## See Also

- [`theGraph`](./theGraph.md) — V4 pool discovery and position enumeration
- [`blockExplorer`](./blockExplorer.md) — Internal transaction parsing for V4 native ETH tracking
- [Adapters Architecture](../../architecture/adapters.md) — Optional incentive methods on `PlatformAdapter`
- [Merkl API Docs](https://docs.merkl.xyz/)
