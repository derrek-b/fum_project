<!-- Source: fum_library/src/adapters/PlatformAdapter.js, fum_library/src/adapters/UniswapV3Adapter.js, fum_library/src/adapters/UniswapV4Adapter.js, fum_library/src/adapters/TraderJoeV2_2Adapter.js, fum_library/src/services/merkl.js, fum_automation/src/core/VaultDataService.js, fum_automation/src/core/AutomationService.js, fum_automation/src/strategies/babySteps/BabyStepsStrategy.js -->
# Design: Incentive Lifecycle v2

## Status: Draft — All Layers Complete

Consolidated from the original incentive-lifecycle-design.md (deleted — all reference material moved here).

## Overview

Support incentive reward earning and collection across platforms with fundamentally different models:

- **Auto-tracking** (Merkl, TJ V2.2 hooks): Positions tracked automatically. No staking. Claims are vault-wide (Merkl) or per-pool (TJ hooks).
- **Staking** (Uniswap V3 Staker): Position NFT must be transferred to a staker contract. Multi-step deposit/stake/unstake/withdraw lifecycle.

Six layers:
1. **Pool Incentive Status** — Does this pool have active incentive campaigns?
2. **Position Incentive State** — Is this position staked? What do I need to unstake it?
3. **Strategy Integration** — How and when the strategy triggers incentive operations during the position lifecycle
4. **Contract/Validator Layer** — Validators for incentive claim targets (Merkl, TJ hooks, V3 Staker)
5. **Error Handling** — Failure modes and severity per operation type
6. **Incentive Tracking** — Recording incentive operations in Tracker (transactions, metadata aggregates, new event types)

---

## Layer 1 — Pool Incentive Status

### What It Answers

"Does this pool have active incentive campaigns, and what kind?"

Pool-level, slow-changing data (campaigns change on the scale of days/weeks). Used to:
- Determine whether incentive operations are needed during the position lifecycle
- Drive Layer 2 state transitions (e.g., campaign expiry triggers unstaking)

### Design Decisions

#### 1. Discovery logic lives on PlatformAdapter

Each adapter implements `getPoolIncentives()` and handles its own platform-specific discovery internally:
- V3 Adapter: queries V3 Staker contract for active incentive keys
- V4 Adapter: calls Merkl API via shared `merkl.js` service
- TJ Adapter: queries LBHooksLens for rewarder hooks

Rationale: Every incentive system we support is platform-specific except Merkl, which is already handled as a shared service (`merkl.js`) that multiple adapters can call. No cross-platform incentive abstraction is needed. If a second cross-platform incentive system appears, that's when a separate IncentiveProvider abstraction earns its place.

#### 2. Return shape is adapter-specific (not standardized)

The strategy does NOT destructure or consume incentive details — that's the adapter's job. Each adapter returns whatever shape it needs for its own downstream methods (`getIncentivePreCloseTransactions`, `getIncentiveClaimTransactions`, etc.). The adapter produces this data and consumes it later.

The strategy only reads two things:
- **Presence of `pool.incentives`** — truthy means the pool is incentivized, `null` means it's not. No `active` boolean needed.
- **`pool.incentives.model`** — `'auto-tracking'` or `'staking'`. Determines whether the strategy needs pre-close/post-create staking operations that can fail and block the main lifecycle.

Everything else flows through opaquely: the strategy passes `pool.incentives` back to adapter methods without inspecting it.

#### 3. Incentives are part of the pool metadata cache

Incentive status is attached to pool objects wherever they are created and cached. It flows into `AutomationService.poolData` through the existing `PoolDataFetched` event mechanism alongside token symbols, fee tiers, and platform identifiers.

#### 4. Fetched in `getPositionsForVDS()` and `getPositionById()` (not `selectBestPool`)

These are the two adapter methods whose return values flow into the `AutomationService.poolData` metadata cache:

**`getPositionsForVDS(vaultAddress, provider)`** — Called during vault load. Discovers positions and builds poolData. Incentive status is fetched per-pool and included in the poolData metadata.

**`getPositionById(tokenId, provider)`** — Called after every position creation/modification. Returns position + poolData. Incentive status is fetched for the position's pool and included.

Both emit `PoolDataFetched` events through `VaultDataService`, which updates `AutomationService.poolData`.

**`selectBestPool()` is deferred** — Using incentive status as a pool selection tiebreaker is a separate concern (pool selection refinement) and not part of the incentive earning/collecting lifecycle. Will be addressed separately.

#### 5. Natural refresh mechanism — no polling needed

Every position operation (create, add, rebalance) triggers `getPositionById`, which refreshes the pool's incentive status. Vault initialization triggers `getPositionsForVDS`, which does the same. This provides sufficient refresh cadence for data that changes on the scale of days/weeks.

When a campaign expires, the next refresh sets `pool.incentives` to `null`. This is the signal for Layer 2: if a position is staked in a program that no longer exists, it needs to be unstaked. The pool metadata refresh drives the position-level state machine without dedicated expiration polling.

### poolData Shape (with incentives)

The `incentives` field is added to the existing pool metadata structure:

```js
// AutomationService.poolData
{
  '0xPoolAddress...': {
    token0Symbol: 'USDC',
    token1Symbol: 'WETH',
    fee: 3000,                    // or binStep for TJ
    platform: 'uniswapV3',
    incentives: {                 // null if no active campaigns
      model: 'staking',          // 'auto-tracking' | 'staking'
      feeCollection: 'unstake-required',  // staking model only (see below)
      // ...adapter-specific data (opaque to strategy)
    }
  }
}
```

**`feeCollection`** — describes trading fee behavior while a position is staked. Only present when `model === 'staking'`. Auto-tracking positions aren't staked, so fee collection works normally.

| Value | Meaning | Platforms | Strategy behavior |
|-------|---------|-----------|-------------------|
| `'native'` | Staking contract proxies fee collection | PancakeSwap MasterChefV3, QuickSwap FarmingCenter | Collect normally — adapter targets staking contract instead of NFPM |
| `'unstake-required'` | Fees accrue in NFPM but can't be collected without unstaking | Uniswap V3 Staker | Skip fee collection for staked positions — collect on rebalance |
| `'redirected'` | Fees don't accrue to the LP while staked (redirected to protocol voters) | Aerodrome CLGauge | Skip fee collection, report 0 accrued fees for staked positions |

### Code Paths Summary

```
Vault Load (existing positions):
  VDS.fetchPositions()
    → adapter.getPositionsForVDS(vault, provider)
      → adapter.getPoolIncentives(poolAddress, ...) per pool   ← NEW
      → returns { positions, poolData: { ...metadata, incentives } }
    → emits PoolDataFetched
    → AutomationService.poolData updated

Position Creation/Modification:
  Strategy.createNewPosition() or addToPosition()
    → adapter.getPositionById(tokenId, provider)
      → adapter.getPoolIncentives(poolAddress, ...)            ← NEW
      → returns { position, poolData: { ...metadata, incentives } }
    → VDS.updatePosition(vault, position, poolData)
    → emits PoolDataFetched
    → AutomationService.poolData updated

Strategy reads pool.incentives:
  if (poolMetadata.incentives) {
    // pool is incentivized
    if (poolMetadata.incentives.model === 'staking') {
      // need pre-close unstake, post-create stake
    }
  }

Fee evaluation in handleSwapEvent:
  if (position.stakingState && poolMetadata.incentives.feeCollection !== 'native') {
    → skip fee collection (collected on next rebalance or N/A)
  } else {
    → existing fee collection flow (unchanged)
    // covers: unstaked positions, auto-tracking positions,
    // and staked positions with native fee collection proxy
  }
```

---

## Layer 2 — Position Incentive State

### What It Answers

"Is this position staked? What do I need to unstake it?"

Position-level state that only applies to staking platforms (V3 Staker). Auto-tracking platforms (V4/Merkl, TJ hooks) need no per-position incentive state — positions stay in the vault and rewards accrue automatically.

### Design Decisions

#### 1. Minimal position properties — just `stakingState` and `incentiveKey`

Only two properties are added to position objects for staking platforms:

```js
{
  // ...existing position fields (id, pool, tickLower, tickUpper, liquidity, etc.)
  stakingState: true,
  incentiveKey: { rewardToken, pool, startTime, endTime, refundee }
}
```

- **`stakingState`** — `true` when the NFT is in the staker contract, absent/falsy when not. Boolean, not an enum — the V3 SDK provides atomic operations (`Staker.encodeDeposit` for deposit+stake, `Staker.withdrawToken` for unstake+claim+withdraw) so there are no intermediate states in normal operation. A failed transaction reverts entirely; the position stays in its previous state.
- **`incentiveKey`** — The full incentive key stored on the position when staked. Required for building the unstake transaction (`unstakeToken(incentiveKey, tokenId)`). Stored on the position rather than derived from `pool.incentives` because the position must be unstakeable even after a campaign expires and `pool.incentives` refreshes to `null`.

For auto-tracking platforms: these properties are absent. The strategy checks `if (position.stakingState)` — falsy means no staking concerns.

#### 2. No intermediate states needed

The original design doc proposed three states (`vault`/`staker+earning`/`staker+not-earning`) to handle partial failures in multi-step staking flows. This is unnecessary because:

- **Staking**: `Staker.encodeDeposit()` encodes the incentive key as data in a single `safeTransferFrom` call. The staker's `onERC721Received` auto-stakes. Atomic — deposit and stake happen in one transaction.
- **Unstaking**: `Staker.withdrawToken()` builds a multicall of `unstakeToken` + `claimReward` + `withdrawToken`. Atomic — all three happen in one transaction or the whole thing reverts.

No intermediate states means no intermediate state tracking.

#### 3. Discovery: `getStakedPositions` inside `getPositionsForVDS`

For staking platforms, `getPositionsForVDS` discovers both vault-owned and staked positions:

```
getPositionsForVDS(vaultAddress, provider)
  ├── getPositions(vaultAddress, provider)         ← existing: vault-owned NFTs
  │     → NFPM.balanceOf(vault) + tokenOfOwnerByIndex → positions(tokenId)
  │
  ├── getStakedPositions(vaultAddress, provider)   ← new: NFTs in staker
  │     → event scan: DepositTransferred where newOwner=vault
  │     → verify each with deposits(tokenId) on staker contract
  │     → NFPM.positions(tokenId) for position details (public view, works regardless of ownership)
  │     → enrich with stakingState: true and incentiveKey
  │
  └── merge both sets into unified position list
```

**V3 Staker has no enumeration interface** — `deposits` mapping is keyed by tokenId, not by owner. Discovery requires scanning `DepositTransferred(tokenId, oldOwner, newOwner)` events on the staker contract, filtered by vault address. `Staker.INTERFACE` from `@uniswap/v3-sdk` can parse these logs.

Position details always come from the NFPM regardless of staking state — `positions(tokenId)` is a public view function that works regardless of who currently owns the NFT. The only difference between the two discovery paths is how we find the tokenIds.

For auto-tracking platforms (V4, TJ): `getStakedPositions` returns `[]` (base class default).

#### 4. New position enrichment happens in `createNewPosition`

After creating a new position, the strategy orchestrates staking and cache update:

```
Strategy.createNewPosition():
  1. Mint position → get tokenId from receipt
  2. Check pool.incentives:
     - If staking model → execute deposit+stake (Staker.encodeDeposit)
     - If auto-tracking → nothing to do
  3. adapter.getPositionById(tokenId) → get position data
  4. If staked → enrich position with stakingState: true and incentiveKey
  5. vaultDataService.updatePosition(vault, enrichedPosition, poolData) → cache
```

This covers both vault initialization (when `createNewPosition` is called for a new vault) and rebalancing (when `createNewPosition` is called after closing the old position).

`addToPosition` requires staking logic for staked positions. The aligned position selected for `addToPosition` may still be staked — `closePositions` only touches non-aligned positions, leaving the aligned staked position untouched. This applies during both service restarts (existing vaults rediscovered) and vault auth re-grants (user revoked auth, added tokens, re-granted). See 3.4 for the full addToPosition flow with staking.

#### 5. State transitions update the cache via `updatePosition`

After any staking/unstaking operation, the strategy updates the position in the VDS cache:

| Operation | stakingState before | stakingState after | How cache is updated |
|-----------|--------------------|--------------------|---------------------|
| Stake (post-create) | absent | `true` | `createNewPosition` enriches position before `updatePosition` |
| Unstake (pre-close) | `true` | position is about to be closed — removed from cache via `removePosition` |
| Unstake+restake (addToPosition) | `true` | `true` (or absent if campaign expired) | `addToPosition` enriches position before `updatePosition` |
| Discovery (service restart or vault auth grant) | unknown | `true` or absent | `getPositionsForVDS` returns positions with correct state |

### SDK Support (V3 Staker)

The `@uniswap/v3-sdk` (v3.26.0, already installed) exports a `Staker` class with:

| Method | What it builds |
|--------|---------------|
| `Staker.encodeDeposit(incentiveKeys)` | Data param for `safeTransferFrom` — atomic deposit + stake |
| `Staker.collectRewards(incentiveKeys, options)` | Multicall: unstake + claim + restake (harvest, not currently used) |
| `Staker.withdrawToken(incentiveKeys, options)` | Multicall: unstake + claim + withdraw (full exit for pre-close) |
| `Staker.INTERFACE` | Pre-built ethers Interface for encoding/decoding any staker call or event |

The `@uniswap/v3-staker` package (v1.0.0, already installed) provides the contract ABI artifacts.

---

## Layer 3 — Strategy Integration

### What It Answers

"How and when does the strategy trigger incentive operations during the position lifecycle?"

This is the orchestration layer — where incentive operations are wired into BabyStepsStrategy's existing flows (initializeVault, rebalancePosition, handleSwapEvent). Covers the full lifecycle of incentive operations around position management.

### Design Decisions

#### 3.1-2 Close flow: unstake, close, claim, and reward distribution

The close flow integrates incentive operations around the existing position closure logic. Covers pre-close unstaking (staking model), post-close reward claims (auto-tracking), and reward token distribution.

**Close flow with incentives:**

```
closePositions(vault, positions):

  Phase 1 — Pre-close unstake (staking model only)
    For each position:
      if position.stakingState:
        → execute unstake+claim+withdraw (Staker.withdrawToken)
        → parse receipt → extract reward token amounts
        → stash parsed rewards for Phase 5
        → NFT returned to vault, ready for close

  Phase 2 — Close positions (existing flow, unchanged)
    → generate removeLiquidity data per position
    → execute batch via executeBatchTransactions
    → parse receipt for fees and principal

  Phase 3 — Fee distribution (existing flow, unchanged)
    → aggregate fees (target token pair)
    → distribute fees to owner

  Phase 4 — Post-close auto-tracking claims
    For each unique pool in closed positions:
      if pool.incentives && model === 'auto-tracking':
        → execute claim (Merkl vault-wide or TJ per-pool)
        → parse receipt → extract reward token amounts
        → stash parsed rewards for Phase 5

  Phase 5 — Incentive reward distribution
    → transfer all reward tokens directly to owner
```

**Key decisions:**

- **Pre-close unstake (Phase 1)**: Must happen before Phase 2 — can't generate `removeLiquidity` data for an NFT the vault doesn't own. Separate transaction per position (targets staker contract, not position manager). `Staker.withdrawToken()` atomically unstakes + claims staking rewards + withdraws NFT.

- **Post-close auto-tracking claims (Phase 4)**: Claims happen after close, not before. The close is the priority — get the position closed and capital freed for redeployment. If a claim fails post-close, the position is still closed and rewards continue accruing for next time. Merkl claims are vault-wide (claims ALL pending rewards across all pools/campaigns — fine, it's idempotent and free). TJ claims are per-pool on the rewarder contract.

- **Reward distribution is separate from fee distribution (Phase 5)**: Incentive rewards are not fees. They come in arbitrary tokens (ARB, JOE, UNI, etc.) that may not be in the vault's token config, may not have price feeds, and may overlap with target tokens. Direct transfer to owner — no swapping, no formatting, no price calculation. Simple and honest.

- **Receipt parsing for reward identification**: The adapter parses claim receipts (Phase 1 and Phase 4) to extract reward token addresses and amounts. Same pattern used for fee collection and position closure receipts. No pre-fetching of balances or reliance on cached incentive data for amount calculation — the receipt is the source of truth.

- **Single distribution phase**: Phase 5 handles rewards from both staking (Phase 1) and auto-tracking (Phase 4). A pool is one model or the other, so only one source produces rewards per close, but the distribution code path is the same regardless.

Status: **Complete**

#### 3.3 Post-create deposit+stake (staking model)

After creating a new position in an incentivized pool with staking model, stake the NFT.

**Flow in `createNewPosition`:**

```
1. Mint position → get tokenId from receipt
2. Check pool.incentives → if staking model:
   → adapter.getIncentivePostCreateTransactions(tokenId, pool.incentives, provider)
   → execute via vault.stakePosition()
3. adapter.getPositionById(tokenId) → get position data
4. Enrich with stakingState: true and incentiveKey
5. vaultDataService.updatePosition() → cache
```

**Key decisions:**

- **Adapter provides transaction data**: `getIncentivePostCreateTransactions()` returns the stake transaction. The adapter gets `pool.incentives` (its own opaque data) and builds the appropriate transaction — V3 uses `Staker.encodeDeposit()` for atomic deposit+stake via `safeTransferFrom` with encoded data.

- **Vault entry point**: Executes via `vault.stakePosition()` (new, see Layer 4). Not routed through the generic `vault.incentive()`.

- **Rebalance coverage**: `rebalancePosition` calls `createNewPosition` after closing the old position, so the same staking flow applies automatically. No special rebalance handling needed.

- **Failure is non-blocking**: If the stake fails, the position is live and earning trading fees — just not earning incentive rewards. See Layer 5 for retry strategy.

Status: **Complete**

#### 3.4 Pre/post addToPosition unstake and restake (staking model)

V3 NFPM's `increaseLiquidity` requires the caller to be the owner or approved. When an NFT is in the V3 Staker, the vault is neither — it can't add liquidity. The position must be unstaked first, then restaked after adding liquidity.

**When this happens**: `addToPosition` is called from `initializeVault` when an aligned position exists with available capital. The aligned position may be staked in two scenarios:
- **Service restart**: Existing vault rediscovered with a staked position and idle tokens
- **Vault auth re-grant**: User revoked auth (to add tokens, manage manually, etc.), then re-granted. The position was staked by automation before the revoke.

Auto-tracking platforms (V4/Merkl, TJ hooks) need no special handling — the position stays in the vault and `addToPosition` works unchanged.

**Flow in `addToPosition` (staking model):**

```
addToPosition(vault, position, ...):

  Phase 0 — Pre-add unstake (staking model only)
    if position.stakingState:
      → execute unstake+claim+withdraw via vault.unstakePosition()
        (Staker.withdrawToken — atomic unstake+claim+withdraw)
      → parse receipt → extract reward token amounts
      → stash parsed rewards for distribution
      → NFT returned to vault, ready for liquidity ops

  Steps 1-10 — Existing add liquidity flow (unchanged)

  Step 11 — Post-add re-stake (staking model only)
    if pool.incentives?.model === 'staking':
      → execute deposit+stake via vault.stakePosition()
        (Staker.encodeDeposit — atomic deposit+stake)
      → enrich position with stakingState: true, incentiveKey

  Step 12 — Distribute reward tokens
    if rewards were collected in Phase 0:
      → transfer to owner (same pattern as Phase 5 of close flow — 3.1-2)

  Step 13 — Cache update (existing, now with staking enrichment)
    → adapter.getPositionById → updatePosition
```

**Key decisions:**

- **Asymmetric pre/post checks**: Pre-add checks `position.stakingState` (must unstake if staked, regardless of campaign status). Post-add checks `pool.incentives` (only restake if campaign is still active). This naturally handles campaign expiry — if the campaign ended, the position is unstaked but not restaked. No special expiry logic needed.

- **`Staker.withdrawToken` atomically claims rewards**: The SDK's multicall bundles unstake+claim+withdraw. We can't avoid claiming during unstake, so we distribute the rewards to the owner. Same receipt parsing and direct-transfer-to-owner pattern as the close flow (3.1-2).

- **No utilization threshold**: Considered adding a check to skip the unstake→add→restake cycle when the position is already highly utilized (e.g., 90%+). Decided against — the scenario is narrow (staking model + aligned + idle capital), the existing `minimumDeployment` threshold already filters trivially small deployments, and adding a parameter creates configurability overhead. Easy to add later if mainnet gas costs make it a practical concern.

- **Failure handling**: Pre-add unstake failure is a blocker — can't add liquidity to a staked position. Post-add restake failure is non-blocking — position is live and earning fees, just not earning incentive rewards. See Layer 5.

Status: **Complete**

#### 3.5 Campaign expiry with staked positions

No proactive handling needed. Campaign expiry is detected naturally — the next `getPositionsForVDS` or `getPositionById` call refreshes `pool.incentives` to `null`. Staked positions continue earning trading fees (fee accrual is pool-level, unaffected by campaign status). The position gets unstaked during the next natural trigger:

- **Rebalance**: `closePositions` Phase 1 unstakes, new position doesn't restake (pool.incentives is null)
- **addToPosition**: Phase 0 unstakes, post-add doesn't restake (pool.incentives is null)
- **Vault auth revoke**: handled by 3.7

Proactively unstaking during `handleSwapEvent` just because a campaign expired was considered and rejected — it would require implementing a full incentive cycle (unstake, distribute rewards, check for new campaigns, potentially restake) without any immediate benefit, since the position is still earning trading fees while staked. The natural triggers handle it cleanly.

Status: **Complete**

#### 3.6 Fee collection for staked positions (handleSwapEvent)

Fee collection behavior for staked positions is determined by `pool.incentives.feeCollection`:

- **`'native'`** (PancakeSwap, QuickSwap): Collect normally. The adapter targets the staking contract's fee proxy instead of the NFPM. No change to strategy logic — the existing fee evaluation and collection flow works, just with a different target contract.

- **`'unstake-required'`** (V3 Staker) or **`'redirected'`** (Aerodrome): Skip fee collection. For `unstake-required`, fees accrue in the NFPM and are collected on the next rebalance when the position is unstaked as part of the close flow (3.1-2). For `redirected`, no fees accrue to the LP at all.

**Strategy logic in `handleSwapEvent` fee evaluation:**

```
if (position.stakingState && poolMetadata.incentives.feeCollection !== 'native') {
  → skip fee collection
} else {
  → existing fee collection flow (unchanged)
}
```

**Why skip rather than unstake-collect-restake**: The round-trip (unstake+withdraw → collect → deposit+stake) is 3 transactions targeting 2 different contracts. The gas cost scales with chain — tolerable on Arbitrum but expensive on mainnet. Meanwhile, collected fees just sit in the vault until the next rebalance anyway (no autocompounding between rebalances), so early collection provides no compounding benefit. The only cost of skipping is delayed distribution to the owner, which happens at the next rebalance.

**The `unstake-required` vs `redirected` distinction** doesn't matter for the fee collection decision (both skip), but matters elsewhere: fee reporting (`getAccruedFeesUSD` shows accumulated fees for `unstake-required`, 0 for `redirected`) and the future stake-or-don't decision (staking is additive for `unstake-required` but a tradeoff for `redirected`).

Status: **Complete**

#### 3.7 Staked positions on vault auth revoked (offboarding)

The automation service **cannot** unstake on offboard — auth is revoked on-chain before the service detects the event. The service's authorized address is set to `0x0` by the frontend contract call, and the `AuthRevoked` event is what triggers offboarding. By that point the service has no vault access.

**Decision**: Frontend provides a manual unstake UI. The vault owner always has access and can unstake via `vault.unstakePosition()` at any time — before or after revoking automation auth. This applies to all staking model platforms, not just V3.

**Why not a two-step revocation** (frontend calls automation service "prepare for offboard" → service unstakes → frontend revokes on-chain): Even with a two-step flow, you'd still need the frontend unstake UI as a fallback (service down, unstake fails, user closes browser mid-flow). Since the frontend UI solves the problem completely on its own, the two-step flow is a convenience optimization, not a necessity. Deferred — revisit when building the frontend.

**On offboard, the automation service should**: Log/notify (Telegram) that staked positions exist in the vault so the user is aware they need to manually unstake. No on-chain action.

Status: **Complete** (frontend implementation deferred to frontend refactor)

Note: Trading fees continue to accrue while staked (fee accrual is pool-level). Fees can't be *collected* until unstaked, but they're not lost.

---

## Layer 4 — Contract/Validator Layer

### What It Answers

"What vault entry points and validators are needed for incentive operations?"

### Design Decisions

#### 1. Keep existing `PositionVault.incentive()` — no new vault functions

The existing `incentive(targets[], data[], values[])` function handles all incentive operations via per-target factory-mediated validation. No contract changes needed — just deploy new validators and register them.

**Why not three separate vault functions** (`stakePosition`, `unstakePosition`, `claimIncentives`): The factory+validator indirection costs ~6-7k gas per call — <1% of any staking operation. Separate functions would require vault contract changes, redeployment, and re-audit for each new platform. With the current pattern, new platforms just need a new validator deployed and registered via `factory.setIncentiveValidator(target, validator)`.

**How the adapter uses `incentive()`**: The adapter builds platform-specific calldata and the strategy passes it to `vault.incentive()`. The three operation types are logical categories in the adapter, not contract-level functions:

| Operation | Target | Adapter method |
|-----------|--------|---------------|
| Stake (deposit+stake) | NFPM (`safeTransferFrom` to staker) | `getIncentivePostCreateTransactions()` |
| Unstake (unstake+claim+withdraw) | V3 Staker (`multicall`) | `getIncentivePreCloseTransactions()` |
| Claim (auto-tracking rewards) | Merkl Distributor / TJ rewarder | `getIncentiveClaimTransactions()` |

#### 2. Validators needed

Each target contract gets a validator registered in `VaultFactory.incentiveValidators`:

| Validator | Target | What it validates |
|-----------|--------|-------------------|
| **MerklIncentiveValidator** (exists) | Merkl Distributor | Selector is `claim()` (`0xa0165082`), `user` param == vault |
| **V3StakerValidator** (new) | V3 Staker contract | Decode `multicall`, whitelist inner selectors (`unstakeToken`, `claimReward`, `withdrawToken`), verify recipient params == vault |
| **UniswapV3PositionValidator** (extend existing) | NFPM | Add `IIncentiveValidator` interface. `validateIncentive` checks selector is `safeTransferFrom(address,address,uint256,bytes)`, `from` == vault, `to` is a registered staker address |
| **TJRewarderValidator** (new) | TJ rewarder hooks (per-pool) | Selector is `claim()`, `user` param == vault |

The NFPM already has a liquidity validator in `VaultFactory.liquidityValidators` (`UniswapV3PositionValidator`, implements `ILiquidityValidator`) — no conflict. The incentive validator is in a separate registry (`incentiveValidators`) and implements `IIncentiveValidator`. Different interfaces, different registries, same target address. The existing `UniswapV3PositionValidator` cannot be reused for staking because it implements the wrong interface and doesn't whitelist `safeTransferFrom`.

**Deployment note**: The NFPM requires validators in both registries — `liquidityValidators[nfpm]` for position operations and `incentiveValidators[nfpm]` for staking. Deployment scripts must register both.

#### 3. Dual-registry pattern for proxy staking contracts (future platforms)

Some staking contracts act as full position manager proxies — PancakeSwap's MasterChefV3 supports `collect()`, `increaseLiquidity()`, `decreaseLiquidity()` while staked. QuickSwap's FarmingCenter supports `collect()` while staked.

For these platforms, the staking contract gets registered in **both** validator registries:
- **`liquidityValidators[stakingContract]`** — validates liquidity operations (increase/decrease/collect) routed through the existing `vault.increaseLiquidity()`, `vault.mint()`, etc.
- **`incentiveValidators[stakingContract]`** — validates incentive operations (harvest, deposit, withdraw) routed through `vault.incentive()`

The adapter determines which target contract to use based on `position.stakingState`:
- Unstaked position → target NFPM (existing flow)
- Staked position on proxy platform (PancakeSwap) → target staking contract for both liquidity and incentive operations
- Staked position on non-proxy platform (V3 Staker) → must unstake before any liquidity operations (handled by Layer 3)

This keeps each vault function scoped to its operation type. `incentive()` handles incentive operations. `increaseLiquidity()` handles liquidity operations. The adapter knows the right target, and each registry has the right validator. No vault changes when adding platforms — just deploy validators and register in the appropriate registries.

#### 4. Platform-specific claim targets

- **Merkl**: `claim(address, address[], uint256[], bytes32[][])` on global Distributor — existing `MerklIncentiveValidator` reusable as-is
- **TJ hooks**: `claim(address, uint256[])` on per-pool rewarder contracts — new `TJRewarderValidator`, one validator contract registered for each rewarder address (or a single validator that accepts any target and just validates selector + user param)
- **V3 Staker**: claims happen atomically during unstake via `Staker.withdrawToken` multicall — no separate claim operation needed, routed through `vault.incentive()` targeting the staker

**Note**: `PositionVault.onlyAuthorized` allows both the vault owner and the authorized executor. The frontend manual unstake (3.7) works through `vault.incentive()` without contract changes.

Status: **Complete**

---

## Layer 5 — Error Handling

### What It Answers

"What happens when an incentive operation fails? Does it block the main operation?"

### Failure Severity by Operation

| Operation | Blocking? | Why | Layer 3 ref |
|-----------|-----------|-----|-------------|
| **Pre-close unstake** | **Blocker** | Can't generate removeLiquidity data for an NFT the vault doesn't own | 3.1-2 Phase 1 |
| **Pre-add unstake** | **Blocker** | Can't call increaseLiquidity on a position the vault doesn't own | 3.4 Phase 0 |
| **Post-create stake** | Non-blocking | Position is live and earning trading fees, just not earning incentive rewards | 3.3 |
| **Post-add restake** | Non-blocking | Same as post-create — position is live, earning fees | 3.4 Step 11 |
| **Reward claim** | Non-blocking | Rewards continue accruing, claimable on next close or manually | 3.1-2 Phase 4 |
| **Reward distribution to owner** | Non-blocking | Reward tokens remain in vault, transferable on next operation or manually | 3.1-2 Phase 5 |

### Design Decisions

#### 1. Blocking failures use existing infrastructure — no new retry logic

Blocking operations (pre-close unstake, pre-add unstake) throw on failure. The error propagates through the existing two-tier system:

**Tier 1 — Individual `retryRpcCall` wrappers**: Each adapter call (staker contract interactions, NFPM calls) wraps itself in `retryRpcCall` for transient RPC failures (3x exponential backoff). Most failures resolve here without bubbling up.

**Tier 2 — Vault-level periodic retry**: If the error survives tier 1, it propagates up through `initializeVault()` → `setupVault()` → caught by the caller:
- `isRecoverableError()` → `trackFailedVault()` → periodic retry every 5 min
- `UnrecoverableError` → `blacklistVault()` immediately
- Failure persists > 1 hour → blacklisted
- Vault yo-yos 5+ times in 24 hours → blacklisted

Events emitted at each stage: `VaultFailed`, `VaultRetryTrip`, `VaultRecovered`, `VaultBlacklisted` — all flow through EventManager to SSE (frontend) and Tracker (persistence).

No special handling needed for incentive-specific blocking failures. An unstake failure during `initializeVault` is just a regular error that flows through the same retry → blacklist pipeline as any other vault setup failure. The periodic retry re-runs `setupVault` from scratch, which rediscovers the staked position and retries the unstake.

#### 2. Non-blocking failures are caught inside the strategy

Non-blocking operations (post-create stake, post-add restake, reward claims, reward distribution) are wrapped in try-catch within the strategy method. A failed stake or claim must not abort the parent operation — the position is already created/closed and that's what matters.

**Post-create stake / post-add restake (items 1 & 2):**

On failure, the catch block emits an event (for frontend visibility) and continues. The position is live and earning trading fees but not staked — no funds at risk, just missed incentive yield.

**Retry via `handleSwapEvent` fee evaluation interval**: The existing fee evaluation runs every N swap events (currently 50). At the same evaluation point, add a staking status check:

```
Every N swap events:
  1. Fee evaluation (existing)
     if staked && feeCollection !== 'native' → skip
     else → evaluate fee threshold, collect if met

  2. Staking status check (new)
     if pool has staking incentives && position not staked → attempt stake
```

If the stake attempt fails again, it retries at the next evaluation interval. Natural backoff without new infrastructure — piggybacking on the existing periodic health check. No separate timer, no pending-stakes queue.

This covers the gap between the initial failure and the next natural lifecycle trigger (rebalance or vault re-init), which could otherwise leave a position unstaked for the duration of the campaign.

**Reward claim failure — auto-tracking systems (item 3):**

Auto-tracking claims (Merkl vault-wide, TJ per-pool) can fail in Phase 4 of the close flow. Staking claims are handled by the blocking unstake (item 1/2 in the blocking section) — not addressed here.

On failure, the catch block emits an `IncentiveClaimFailed` event. Tracker handles it with the same dual-write pattern used for `FeeDistributionFailed`:

- **`transactions.jsonl`**: `IncentiveClaimFailed` entry with platform, pool, rewarder/distributor address, error — visible in transaction history / demo page
- **`metadata.pendingClaims[]`**: Actionable state persisted to disk — platform, pool address, rewarder/distributor address, vault address, timestamp

This is a unified pattern for all auto-tracking platforms (V4/Merkl and TJ), not just TJ. Even though Merkl claims are vault-wide and easier to retry, the failure recording and retry path is the same. One system, no platform-specific branching.

**Retry paths for pending claims:**

- **Automation service — 50 swap evaluation interval**: Piggybacking on the existing periodic health check in `handleSwapEvent`. The evaluation interval becomes a general position health check:
  1. Fee evaluation (existing)
  2. Staking status check (items 1 & 2)
  3. Pending claims retry — check `metadata.pendingClaims[]`, attempt outstanding claims
     → on success → immediately attempt distribution to owner
     → remove from `pendingClaims`
     → if distribution fails → write to `metadata.failedRewardDistributions[]` (see item 4)
  4. Failed reward distributions retry — check `metadata.failedRewardDistributions[]`, attempt outstanding transfers (see item 4)

  The vault can still call old rewarders/distributors even if the current position is in a different pool. The `pendingClaims` entry has all the info the adapter needs to rebuild the claim transaction. Unified system for all auto-tracking platforms (V4 and TJ) — no platform-specific branching.

- **Frontend**: Read `metadata.pendingClaims[]` and surface "unclaimed rewards" to user for manual collection — critical for scenarios where the vault is no longer being managed (auth revoked, platform/pair switch with no active monitoring).

- **Pre-revoke endpoint** (future): If implemented, trigger outstanding claims before auth revocation.

On successful claim (whether automated retry or manual), remove the entry from `metadata.pendingClaims[]`.

**Persistence requirement**: The `pendingClaims` entry must store everything the adapter needs to rebuild the claim transaction — platform, pool address, rewarder/distributor address, vault address, and any platform-specific parameters. For TJ, this includes the bin IDs (`rewarder.claim(vault, ids)`) since the position may already be closed and the IDs can't be re-derived from on-chain state.

**Reward distribution failure (item 4):**

Applies to all incentive models (staking and auto-tracking). The claim succeeded — reward tokens are in the vault — but the transfer to owner fails. Without persistence, the receipt parsing data (token addresses, amounts) is lost and non-configured tokens (CAKE, ARB, JOE, xGRAIL) are stranded in the vault with no discovery mechanism.

On failure, the catch block emits an `IncentiveDistributionFailed` event. Tracker handles it with a dual-write:

- **`transactions.jsonl`**: `IncentiveDistributionFailed` entry with token addresses, amounts, error — visible in transaction history
- **`metadata.failedRewardDistributions[]`**: Separate field from `failedDistributions[]` (which is for fee distribution failures). Stores token addresses and amounts so a retry just executes the transfers — no re-parsing needed.

**How we get here per model:**
- **Staking**: `Staker.withdrawToken()` atomically claims rewards during unstake → tokens in vault → Phase 5 (close) or Step 12 (addToPosition) distribution fails
- **Auto-tracking**: Phase 4 claim succeeds → tokens in vault → Phase 5 distribution fails
- **Pending claim retry**: 50 swap health check retries a pending claim → claim succeeds → immediate distribution attempt fails

**Retry paths:**

- **Automation service — 50 swap evaluation interval**: Step 4 of the health check — attempt outstanding transfers from `metadata.failedRewardDistributions[]`. On success, remove the entry. Token addresses and amounts are already persisted, just execute the transfers.

- **Frontend**: Read `metadata.failedRewardDistributions[]` and surface to user for manual transfer. Critical for scenarios where the vault is no longer being managed.

On successful distribution (whether automated retry or manual), remove the entry from `metadata.failedRewardDistributions[]`.

#### 3. No top-level retry wrapper around setupVault

`setupVault` is an orchestration of many steps with side effects (closures, swaps, mints). A top-level `retryRpcCall` wrapper would re-execute completed steps on failure, potentially causing duplicate transactions. The individual `retryRpcCall` wrappers at each call site handle transient failures locally. Only persistent failures bubble up to the vault-level periodic retry, which re-runs `setupVault` from scratch.

**Implementation note**: Each step of the 50 swap health check must be independently try-caught. A failure in step 2 (staking check) must not prevent steps 3 (pending claims) and 4 (failed distributions) from running.

Status: **Complete**

---

## Layer 6 — Incentive Tracking

### What It Answers

"How do we record incentive operations for the frontend, transaction history, and performance analytics?"

Incentive operations follow the same Tracker pattern as fees, swaps, and rebalances: strategy emits event → Tracker handler dual-writes to `transactions.jsonl` (history) and `metadata.json` (aggregates + actionable state).

### Design Decisions

#### 1. New event types

Eight new events, each following the existing emit → handle → dual-write pattern:

| Event | Emitted when | transactions.jsonl | metadata.json |
|-------|-------------|-------------------|---------------|
| `PositionStaked` | Post-create/post-add stake succeeds | Full log | Increment `stakingCount`, gas aggregates |
| `PositionUnstaked` | Pre-close/pre-add unstake succeeds | Full log | Increment `unstakingCount`, gas aggregates |
| `PositionStakeFailed` | Post-create/post-add stake fails | Full log | Increment `stakeFailureCount` |
| `IncentivesClaimed` | Auto-tracking claim succeeds | Full log | Increment `incentiveClaimCount`, add to `cumulativeIncentivesClaimedUSD` |
| `IncentivesDistributed` | Reward transfer to owner succeeds | Full log | Add to `cumulativeIncentivesDistributedUSD` |
| `IncentiveClaimFailed` | Auto-tracking claim fails | Full log | Push to `pendingClaims[]` |
| `IncentiveDistributionFailed` | Reward transfer to owner fails | Full log | Push to `failedRewardDistributions[]` |
| `PendingClaimResolved` | Health check retries a pending claim successfully | Full log | Remove from `pendingClaims[]` |

**No `PositionUnstakeFailed` event**: Unstake is a blocking operation. On failure it throws, propagates through `setupVault`, and enters the existing vault retry/blacklist pipeline (`VaultFailed` → `VaultRetryQueued` → `VaultBlacklisted`). The strategy never gets past the error to emit a Tracker event — same as there's no `PositionCloseFailed` or `PositionCreateFailed` event today.

**No `FailedRewardDistributionResolved` event**: When the health check retries a failed distribution successfully, it emits `IncentivesDistributed` (the normal success event). The handler removes the entry from `failedRewardDistributions[]` as part of that success path. No separate event needed.

#### 2. Event data shapes

Each event carries the data the Tracker handler needs for both the transaction log and metadata updates. Following existing conventions (vaultAddress, timestamp, transactionHash on all events, gas data on chain operations).

**`PositionStaked`**:
```js
{
  vaultAddress,
  positionId,            // tokenId
  poolAddress,
  platform,              // 'uniswapV3' etc.
  incentiveKey,          // opaque — stored for unstake reference
  source,                // 'post_create' | 'post_add' | 'health_check'
  gasUsed,
  effectiveGasPrice,
  transactionHash,
  timestamp
}
```

**`PositionUnstaked`**:
```js
{
  vaultAddress,
  positionId,
  poolAddress,
  platform,
  rewardsCollected,      // { tokenAddress: amount } from Staker.withdrawToken receipt
  rewardsCollectedUSD,   // total USD value (best-effort, 0 if no price feed)
  source,                // 'pre_close' | 'pre_add'
  gasUsed,
  effectiveGasPrice,
  transactionHash,
  timestamp
}
```

**`PositionStakeFailed`**:
```js
{
  vaultAddress,
  positionId,
  poolAddress,
  platform,
  source,                // 'post_create' | 'post_add'
  error,                 // error.message
  timestamp
}
```

No gas data — the transaction reverted.

**`IncentivesClaimed`**:
```js
{
  vaultAddress,
  platform,
  poolAddress,           // null for Merkl (vault-wide)
  rewarderAddress,       // Merkl Distributor, TJ rewarder, etc.
  rewards,               // { tokenAddress: amount }
  totalClaimedUSD,
  source,                // 'close_flow' | 'health_check'
  gasUsed,
  effectiveGasPrice,
  transactionHash,
  timestamp
}
```

**`IncentivesDistributed`**:
```js
{
  vaultAddress,
  owner,                 // recipient address
  distributions,         // [{ token, amount, amountFormatted }]
  totalDistributedUSD,
  source,                // 'close_flow' | 'add_flow' | 'health_check'
  transactionHash,
  timestamp
}
```

**`IncentiveClaimFailed`**:
```js
{
  vaultAddress,
  platform,
  poolAddress,
  rewarderAddress,
  error,
  // TJ-specific: binIds (needed to rebuild claim tx after position closed)
  platformData,          // opaque adapter-specific data for retry
  timestamp
}
```

**`IncentiveDistributionFailed`**:
```js
{
  vaultAddress,
  rewards,               // { tokenAddress: amount } — what's stranded in the vault
  totalFailedUSD,
  source,
  error,
  timestamp
}
```

**`PendingClaimResolved`**:
```js
{
  vaultAddress,
  platform,
  poolAddress,
  rewarderAddress,
  originalTimestamp,     // when the claim first failed
  timestamp              // when it was resolved
}
```

#### 3. New metadata fields

Added to the existing `metadata.json` structure alongside current aggregates and arrays.

**New aggregate counters** (in `aggregates`):
```js
{
  // ...existing aggregates (cumulativeFeesUSD, swapCount, etc.)

  stakingCount: 0,                           // successful stake operations
  unstakingCount: 0,                         // successful unstake operations
  stakeFailureCount: 0,                      // failed stake attempts (non-blocking)
  incentiveClaimCount: 0,                    // successful auto-tracking claims
  cumulativeIncentivesClaimedUSD: 0,         // total USD value of all claims
  cumulativeIncentivesDistributedUSD: 0,     // total USD sent to owner
  cumulativeIncentivesDistributeFailedUSD: 0 // total USD of failed distributions
}
```

**New arrays** (alongside `failedDistributions[]`):
```js
{
  // ...existing
  failedDistributions: [],    // existing — fee distribution failures

  // New — incentive-specific actionable state
  pendingClaims: [
    {
      platform,               // 'uniswapV4' | 'traderJoeV2_2'
      poolAddress,
      rewarderAddress,        // target contract for claim tx
      vaultAddress,
      platformData,           // adapter-specific (TJ: { binIds }, Merkl: {})
      failedAt: <timestamp>,
      lastAttempt: <timestamp>,
      attempts: 0
    }
  ],

  failedRewardDistributions: [
    {
      rewards,                // { tokenAddress: amount }
      totalFailedUSD,
      source,                 // where the claim succeeded but distribution failed
      failedAt: <timestamp>,
      lastAttempt: <timestamp>,
      attempts: 0
    }
  ]
}
```

**Why `pendingClaims` stores `platformData`**: The claim transaction must be rebuildable without the original position. For TJ, this means the bin IDs — once a position is closed, the adapter can't re-derive them from on-chain state. The adapter produces `platformData` when the claim fails, and consumes it when retrying. The Tracker treats it as opaque.

**Why `failedRewardDistributions` stores token addresses and amounts**: After a successful claim, the receipt parsing data (which tokens, how much) is ephemeral. If distribution fails and we don't persist this, non-configured tokens (ARB, JOE, CAKE, etc.) are stranded in the vault with no discovery mechanism. The amounts come from receipt parsing at claim time.

#### 4. Handler behavior by event

**`PositionStaked` handler**:
1. Append transaction to `transactions.jsonl`
2. Increment `aggregates.stakingCount`, `aggregates.transactionCount`
3. Add gas to `cumulativeGasETH` / `cumulativeGasUSD`
4. Save metadata

**`PositionUnstaked` handler**:
1. Append transaction to `transactions.jsonl`
2. Increment `aggregates.unstakingCount`, `aggregates.transactionCount`
3. Add gas to `cumulativeGasETH` / `cumulativeGasUSD`
4. If `rewardsCollectedUSD > 0`: add to `cumulativeIncentivesClaimedUSD` (unstake atomically claims)
5. Save metadata

**`PositionStakeFailed` handler**:
1. Append transaction to `transactions.jsonl`
2. Increment `aggregates.stakeFailureCount`
3. Save metadata

No metadata array — the 50 swap health check detects missing stakes by comparing `position.stakingState` against `pool.incentives`. No persistent retry queue needed.

**`IncentivesClaimed` handler**:
1. Append transaction to `transactions.jsonl`
2. Increment `aggregates.incentiveClaimCount`, `aggregates.transactionCount`
3. Add `totalClaimedUSD` to `aggregates.cumulativeIncentivesClaimedUSD`
4. Add gas to `cumulativeGasETH` / `cumulativeGasUSD`
5. Save metadata

**`IncentivesDistributed` handler**:
1. Append transaction to `transactions.jsonl`
2. Add `totalDistributedUSD` to `aggregates.cumulativeIncentivesDistributedUSD`
3. If source is `'health_check'`: find and remove the matching entry from `failedRewardDistributions[]`
4. Save metadata

**`IncentiveClaimFailed` handler**:
1. Append transaction to `transactions.jsonl`
2. Push to `pendingClaims[]` with `failedAt`, `lastAttempt`, `attempts: 1`
3. Save metadata

**`IncentiveDistributionFailed` handler**:
1. Append transaction to `transactions.jsonl`
2. Push to `failedRewardDistributions[]` with `failedAt`, `lastAttempt`, `attempts: 1`
3. Add `totalFailedUSD` to `aggregates.cumulativeIncentivesDistributeFailedUSD`
4. Save metadata

**`PendingClaimResolved` handler**:
1. Append transaction to `transactions.jsonl`
2. Find and remove the matching entry from `pendingClaims[]`
3. Save metadata

#### 5. Retry attempt tracking in metadata arrays

Both `pendingClaims[]` and `failedRewardDistributions[]` track `lastAttempt` and `attempts`. On each health check retry:
- Update `lastAttempt` to current timestamp
- Increment `attempts`
- Save metadata (regardless of retry outcome — the attempt is recorded)

This gives visibility into how long items have been stuck and how many times they've been retried. No max-attempt cutoff — items stay in the array until resolved (automated retry, manual action, or explicit clearing from the frontend).

#### 6. Frontend reads for manual action

The frontend reads `metadata.json` directly for two actionable surfaces:

- **`pendingClaims[]`**: "Unclaimed rewards" — show platform, pool, time since failure. User can trigger manual claim via `vault.incentive()` (owner has `onlyAuthorized` access).
- **`failedRewardDistributions[]`**: "Undistributed rewards" — show token addresses and amounts stranded in vault. User can trigger manual transfer.

Both surfaces are read-only from Tracker's perspective. The frontend calls the vault directly, and if automation is active, the next health check cleans up the metadata entry after success.

Status: **Complete**

---

## Open Items

- **Multi-program staking on V3 Staker**: The V3 Staker contract supports staking a single NFT into multiple incentive programs simultaneously (`stakes[tokenId][incentiveHash]` mapping). Our v2 design stores a single `incentiveKey` per position — one program at a time. Multi-program staking would require an array of incentive keys and multiple unstake→claim→restake cycles on every rebalance. Deferred — V3 Staker programs are rare, and the single-program design covers the common case. Can be extended later if demand materializes.

---

## Platform Incentive Survey

Research completed across all target platforms. Four categories emerge based on incentive model.

### Category 1 — Merkl Auto-Tracking

All use the same Merkl Distributor contract (`0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae`, same address on all chains). Same `claim()` selector `0xa0165082`. Our existing `MerklIncentiveValidator` + `merkl.js` service covers all of these with zero contract-layer changes — only need platform adapters for pool interactions.

#### Uniswap V4 (implemented)
- **Chain**: Arbitrum (42161)
- **Position type**: NFT (ERC-721)
- **Reward tokens**: Any ERC-20 (campaign-defined)
- **Claim**: Vault-wide, idempotent, cumulative Merkle proofs
- **Status**: Library + contract infrastructure implemented — `getPoolIncentives()`, `getIncentiveClaimTransactions()`, MerklIncentiveValidator. Not yet wired into automation strategy.
- **API details**: See [docs/platform-knowledge/merkl-incentives.md](../platform-knowledge/merkl-incentives.md) for endpoint URLs, response shapes, and field-level gotchas

#### SushiSwap V3
- **Chain**: Arbitrum, Ethereum, Polygon, others
- **Position type**: NFT (ERC-721) — SushiSwap V3 is a Uniswap V3 fork, pool/position interfaces nearly identical
- **Reward tokens**: SUSHI (primary), any ERC-20 via third-party campaigns
- **Claim**: Same Merkl Distributor, same flow
- **Key addresses (Arbitrum)**: Factory `0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e`
- **Integration effort**: Low — same Merkl claim flow, V3-compatible position interface

#### QuickSwap V3 (current system)
- **Chain**: Polygon (137)
- **Position type**: NFT (ERC-721) — Algebra-based (not a Uniswap V3 fork, different NFPM interface)
- **Reward tokens**: dQUICK, WMATIC, partner tokens
- **Claim**: Same Merkl Distributor, same flow
- **Key addresses (Polygon)**: NFPM `0x8eF88E4c7CfbbaC1C163f7eddd4B578792201de6`
- **Note**: Legacy Algebra FarmingCenter staking (`0x7F281A8cdF66eF5e9db8434Ec6D97acc1bc01E78`) still on-chain but deprecated. QuickSwap is directing users to Merkl.
- **Integration effort**: Low for Merkl claims. Algebra NFPM has different function signatures from Uniswap V3/V4.

### Category 2 — Custom Auto-Tracking

Same architecture as Merkl (off-chain computation → Merkle tree → on-chain distributor) but proprietary contracts and APIs.

#### Camelot V3/V4
- **Chain**: Arbitrum (42161)
- **Position type**: NFT (ERC-721) — Algebra-based
- **Reward tokens**: GRAIL + xGRAIL (80/20 ratio), partner tokens
- **System**: Custom "Market Maker Rewards" (launched Dec 2024, replaced Merkl + legacy spNFT/Nitro Pool staking)
- **Epochs**: 2-4 hours, rewards based on fees generated (not just liquidity size)
- **Claim**: Proprietary distributor contract (address not publicly documented)
- **Position management**: Unrestricted — NFT stays in vault, no staking
- **Key addresses (Arbitrum)**: V3 NFPM `0x00c7f3082833e796A5b3e4Bd59f6642FF44DCD15`, V4 NFPM `0xA602E7195fcC9364210181DffA33482B5adCE9d8`
- **Integration effort**: Medium — need to reverse-engineer distributor contract or contact Camelot team for claim interface. Algebra NFPM differs from Uniswap.

### Category 3 — Staking (NFT leaves vault)

Position NFT must be transferred to a staking contract. Each platform has significantly different lifecycle flows.

#### Uniswap V3 Staker (`0xe34139463bA50bD61336E0c446Bd8C0867c6fE65` on Arbitrum)

**Lifecycle** — 5 distinct steps:
```
deposit (safeTransferFrom) → stakeToken → unstakeToken → claimReward → withdrawToken
```

| Step | Function | Effect |
|------|----------|--------|
| Deposit | `safeTransferFrom(vault, staker, tokenId)` | NFT moves to staker contract |
| Stake | `stakeToken(incentiveKey, tokenId)` | Starts earning rewards |
| Unstake | `unstakeToken(incentiveKey, tokenId)` | Stops earning, credits rewards to internal mapping |
| Claim | `claimReward(rewardToken, to, amountRequested)` | Transfers credited rewards out |
| Withdraw | `withdrawToken(tokenId, to, data)` | Returns NFT to vault |

**Key behaviors:**
- Steps 1+2 can be combined: `safeTransferFrom` with encoded `data` param triggers auto-stake via `Staker.encodeDeposit()`
- Steps 3+4+5 can be combined: `Staker.withdrawToken()` builds a multicall of unstake+claim+withdraw
- **Cannot manage positions while deposited** — no liquidity changes, no fee collection while NFT is in staker
- Trading fees continue to accrue in the NFPM (fee accrual is pool-level) but cannot be collected until the NFT is withdrawn
- `claimReward` is a separate step that transfers accumulated credits
- "Harvest" pattern (claim without full withdrawal): `multicall([unstakeToken, stakeToken, claimReward])` — unstake, restake into same/new incentive, claim the credits
- Anyone can unstake on behalf of an owner after the incentive ends
- Multiple reward tokens possible (per incentive key)
- **Multi-program staking**: A single deposited NFT can be staked in multiple incentive programs simultaneously (`stakes[tokenId][incentiveHash]`). V2 design supports one program per position (see Open Items).
- **No enumeration interface**: `deposits` mapping is keyed by tokenId, not by owner. Discovery requires scanning `DepositTransferred(tokenId, oldOwner, newOwner)` events.

#### PancakeSwap MasterChefV3 (`0x5e09ACf80C0296740eC5d6F643005a4ef8DaA694` on Arbitrum)

**Lifecycle** — much simpler:
```
deposit (safeTransferFrom) → harvest (optional) → withdraw
```

| Step | Function | Effect |
|------|----------|--------|
| Deposit+Stake | `safeTransferFrom(vault, masterchef, tokenId)` | Single step, immediately staked |
| Harvest | `harvest(tokenId, to)` | Claims CAKE without unstaking |
| Withdraw | `withdraw(tokenId, to)` | Auto-harvests + returns NFT |

**Key behaviors:**
- **CAN manage positions while staked** — proxy functions: `increaseLiquidity()`, `decreaseLiquidity()`, `collectTo()`, `burn()`
- Single reward token (CAKE only)
- `withdraw()` automatically harvests pending CAKE before returning the NFT
- No separate stake/unstake steps — deposit IS staking
- **One pool = one farm**: `v3PoolAddressPid` mapping enforces 1:1 between pools and staking entries

#### Aerodrome CLGauge (per-pool gauge on Base)

**Lifecycle** — gauge-based staking:
```
deposit(tokenId) → getReward(tokenId) (optional) → withdraw(tokenId)
```

| Step | Function | Effect |
|------|----------|--------|
| Deposit | `deposit(uint256 tokenId)` | NFT moves to gauge, starts earning AERO |
| Claim | `getReward(uint256 tokenId)` | Claims accrued AERO for specific position |
| Withdraw | `withdraw(uint256 tokenId)` | Claims pending rewards + returns NFT |

**Key behaviors:**
- **Critical: staking replaces fee income with AERO emissions.** LP fees are redirected to veAERO voters. The LP gets AERO instead of trading fees.
- Limited position management while staked — `increaseLiquidity` requires gauge as caller (`require(msg.sender == gauge)`), typical pattern is withdraw → modify → re-deposit
- Each CL pool has its own CLGauge instance (deployed by GaugeFactory, lookup via Voter contract)
- Only in-range liquidity earns AERO emissions
- Reward token: AERO only (`0x940181a94A35A4569E4529A3CDfB74e38FD98631`)
- **Chain**: Base (8453)

**Key addresses (Base):**
- NFPM: `0x827922686190790b37229fd06084350E74485b72`
- CL PoolFactory: `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A`
- Voter: `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5`
- CL GaugeFactory: `0xD30677bd8dd15132F251Cb54CbDA552d2A05Fb08`

#### QuickSwap V3 Legacy Algebra Farming (deprecated, still on-chain)

**Lifecycle:**
```
safeTransferFrom → enterFarming → collectRewards/claimReward → exitFarming → withdrawToken
```

| Step | Function | Effect |
|------|----------|--------|
| Deposit | `safeTransferFrom(vault, farmingCenter, tokenId)` | NFT moves to FarmingCenter |
| Stake | `enterFarming(incentiveKey, tokenId, tokensLocked, isLimit)` | Starts earning in eternal or limit farming |
| Collect | `collectRewards(incentiveKey, tokenId)` | Collects accrued rewards from eternal farming |
| Claim | `claimReward(rewardToken, to, amountIncentive, amountEternal)` | Transfers reward tokens out |
| Unstake | `exitFarming(incentiveKey, tokenId, isLimit)` | Exits farm program |
| Withdraw | `withdrawToken(tokenId, to, data)` | Returns NFT (requires `numberOfFarms == 0`) |

**Key behaviors:**
- **Cannot manage positions while staked** — must exit farming + withdraw first
- Two farming types: Eternal (enter/exit anytime) and Limit (locked for duration)
- Dual rewards per incentive (reward + bonusReward)
- Optional boost via locked tokens (`tokensLocked` parameter)
- **Key addresses (Polygon)**: FarmingCenter `0x7F281A8cdF66eF5e9db8434Ec6D97acc1bc01E78`

**Note:** QuickSwap has deprecated this system in favor of Merkl. New campaigns use Merkl. Legacy farms still exist on-chain for users who haven't migrated.

### Category 4 — On-Chain Auto-Tracking via Hooks (Bin-Based)

#### Trader Joe V2.2 Liquidity Book

- **Chain**: Avalanche (43114), Arbitrum (42161)
- **Position type**: ERC-1155 bin tokens (not NFTs) — fungible tokens per price bin
- **Model**: **Auto-tracking via on-chain hooks** — no staking, no Merkl. Fully proprietary on-chain system.

**How it works**: Rewarder contracts are deployed as **hooks on the LBPair** via `LBHooksManager`. They intercept `afterMint`/`afterBurn`/`afterBatchTransferFrom` callbacks to track each user's bin token balances in real-time. Rewards accrue automatically for bins within the incentivized range (1-11 bins around the active bin). The range moves dynamically as the price moves.

**Three rewarder types:**
| Type | Purpose | Reward Source |
|------|---------|---------------|
| `LBHooksMCRewarder` | MasterChef-linked | JOE emissions via MasterChef allocation |
| `LBHooksSimpleRewarder` | Single token | Any ERC-20 (e.g., ARB, partner tokens) |
| `LBHooksExtraRewarder` | Dual rewards | Stacks on top of MCRewarder for second token |

**User-facing operations:**
- **Claim**: Call `claim()` on the per-pool rewarder hook contract
- **Read pending**: Use `LBHooksLens.getPendingRewards(rewarder, account, binIds[])`
- **Read range**: Use `LBHooksLens.getRewardedRange(rewarder)` for min/max incentivized bins
- **Position management**: Completely unaffected — add/remove liquidity normally through LBRouter. Hooks track changes automatically.

**Key addresses (same on Avalanche and Arbitrum):**
- LBHooksManager: `0x3A8E1Be95467690F7C592B596e42d11b3710c633`
- LBHooksLens: `0x6124086b90ab910038e607aa1bdd67b284c31c98`
- LBFactory V2.2: `0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c`

**Note**: TJ also has a separate legacy Merkle-tree-based rewards program (`joe-v2-rewarder`) for V2.1 using off-chain "MakerScore" computation. This is TJ's own system, not Merkl by Angle. The V2.2 hooks system supersedes it.

### Cross-Platform Comparison

| Platform | Model | Deposit Steps | Collect Fees While Staked? | Modify Liquidity While Staked? | Claim Rewards Without Unstaking? | Fee Impact | Reward Tokens |
|----------|-------|---------------|---------------------------|-------------------------------|--------------------------------|------------|---------------|
| **Uniswap V4** | Merkl | N/A | N/A | N/A | N/A (vault-wide claim) | None | Any ERC-20 |
| **SushiSwap V3** | Merkl | N/A | N/A | N/A | N/A (vault-wide claim) | None | SUSHI, any ERC-20 |
| **QuickSwap V3** | Merkl (current) | N/A | N/A | N/A | N/A (vault-wide claim) | None | dQUICK, WMATIC |
| **Camelot V3/V4** | Custom auto-track | N/A | N/A | N/A | N/A (vault-wide claim) | None | GRAIL, xGRAIL |
| **Uniswap V3 Staker** | Staking | 2 (deposit+stake) | **No** | **No** | **No** (multicall trick) | None (fees accrue, can't collect) | Any ERC-20 |
| **PancakeSwap** | Staking | 1 (auto-stake) | **Yes** (`collect`/`collectTo`) | **Yes** (`increaseLiquidity`/`decreaseLiquidity`) | **Yes** (`harvest`) | None | CAKE |
| **Aerodrome CL** | Staking | 1 (`deposit`) | **No** (fees redirected) | **No** | **Yes** (`getReward`) | **Fees redirected to voters** | AERO |
| **QuickSwap legacy** | Staking | 2 (deposit+enter) | **Yes** (`collect` proxy) | **No** | **Yes** (`collectRewards`) | None | dQUICK, dual rewards |
| **Trader Joe V2.2** | On-chain hooks | N/A | N/A | N/A | N/A (claim on rewarder) | None | JOE, any ERC-20 |
