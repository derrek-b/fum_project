<!-- Source: fum_library/src/adapters/PlatformAdapter.js, fum_automation/src/strategies/base/StrategyBase.js, fum_automation/src/strategies/babySteps/BabyStepsStrategy.js, fum_automation/src/core/VaultDataService.js -->
# Design: Incentive Lifecycle Across Platform Types

## Status: Draft

## Problem

We need to support incentive rewards across platforms with fundamentally different models:

- **Auto-tracking** (Merkl, Camelot custom): Positions are tracked automatically from on-chain events. No staking. Claims are vault-wide and idempotent.
- **Staking** (Uniswap V3 Staker, PancakeSwap, Aerodrome, legacy QuickSwap): Positions must be explicitly staked into a farming/staker contract. The NFT leaves the vault. Claims are per-position.

The staking model creates problems that auto-tracking doesn't have:
1. Staked positions are **invisible** to current position discovery (NFT is in the staker contract, not the vault)
2. Positions must be **unstaked before closing** (can't close what you don't hold)
3. New positions should be **staked after creation** to start earning
4. The automation must know **per-position staking state** to operate correctly

This doc covers the full incentive lifecycle: discovery, tracking, strategy integration, and error handling.

## Three Layers

### Layer 1 — Pool Incentive Status (pool-level, slow-changing)

**Question**: "Does this pool have active incentive campaigns, and what kind?"

- Changes on the scale of days/weeks (campaigns are created/expire)
- Used as a **tiebreaker** in pool selection (prefer incentivized pools when all else is equal) and to determine whether incentive operations are needed during rebalance
- For staking platforms: also identifies which staking contract to interact with
- Only need current state — no need to track expired campaigns
- Already partially implemented: `getPoolIncentives()` with 5-min cache in merkl.js

**Data shape per pool:**
```js
{
  active: true,
  model: 'auto-tracking' | 'staking',
  programs: [{
    rewardToken: '0x...',
    rewardTokenSymbol: 'UNI',
    endTimestamp: 1771498800,
    stakingContract: '0x...',   // null for auto-tracking
  }],
}
```

**Refresh strategy**: Cached with TTL (current: 5 min). Refreshed on-demand when the strategy needs it. Not worth a dedicated polling loop — campaign changes are rare.

### Layer 2 — Position Incentive State (position-level, tracked)

**Question**: "Is this position staked? Where?"

This is the layer that doesn't exist yet and is needed for staking platforms.

**Auto-tracking (Merkl/V4):**
- No per-position state needed. All positions are auto-tracked.
- `getStakedPositions()` returns `[]`.

**Staking platforms:**
- Position NFT is transferred to the staker contract on stake.
- Current `getPositionsForVDS()` queries the position manager for vault-owned NFTs — staked positions won't appear.
- Need a `getStakedPositions(vaultAddress, provider)` as a **sibling to `getPositions`**, both called by `getPositionsForVDS`.
- Both unstaked and staked positions must be tracked in the same position cache, with staking state as metadata.

**Discovery hierarchy:**
```
getPositionsForVDS(vaultAddress, provider)    ← VaultDataService calls this
  ├── getPositions(vaultAddress, provider)    ← unstaked positions
  │     → query NFPM: "which tokenIds does this vault own?"
  │     → query NFPM: positions(tokenId) for each → ticks, liquidity, pool, etc.
  │
  ├── getStakedPositions(vaultAddress, provider)  ← staked positions
  │     → query staker contract: "which tokenIds did this vault stake?"
  │     → query NFPM: positions(tokenId) for each → same position details
  │
  └── merge both sets, tag staked ones with incentiveState
```

Position details always come from the NFPM regardless of staking state. The staker contract holds the NFT but doesn't modify the underlying position data. `positions(tokenId)` is a public view function — you can read any position's details regardless of who currently owns the NFT. The only difference between the two paths is **how we discover the tokenIds** (vault ownership vs staker contract query). The position detail logic can be shared.

**Discovery flow (service init or executor grant):**
```
1. getPositionsForVDS calls getPositions(vaultAddress, provider)
   → returns unstaked positions (NFTs in vault) with full position details

2. getPositionsForVDS calls getStakedPositions(vaultAddress, provider)
   → returns staked positions (NFTs in staking contracts) with full position details
   → each includes: positionId, stakingContract, incentiveProgram

3. getPositionsForVDS merges into unified position set with staking state
```

**Position state transitions (staking platforms):**

Staking is a two-step process in each direction (e.g., V3 Staker):

```
Staking:
[in vault] --transfer NFT--> [deposited, not earning] --stakeToken--> [staked, earning]

Unstaking:
[staked, earning] --unstakeToken--> [deposited, not earning] --withdrawToken--> [in vault]
```

The intermediate state (`deposited, not earning`) is a real failure scenario:
- Transfer succeeds, stakeToken fails → NFT is outside the vault but not earning
- unstakeToken succeeds, withdrawToken fails → NFT is still outside the vault

The retry system must know which step failed to know whether to "finish the stake" or "pull it back to the vault."

State is updated after each successful transaction, not polled.

**Data shape per position (additions to existing position data):**
```js
{
  // ... existing position fields (tokenId, pool, ticks, liquidity, etc.)
  incentiveState: {
    location: 'vault' | 'staker',  // where is the NFT right now?
    earning: false,                 // actively staked in an incentive program?
    stakingContract: null,          // address of staker contract, if not in vault
  },
}
```

The three meaningful states:

| State | location | earning | Meaning |
|-------|----------|---------|---------|
| Normal | `vault` | `false` | Unstaked position, NFT in vault |
| Fully staked | `staker` | `true` | Earning rewards, NFT in staker contract |
| Intermediate/error | `staker` | `false` | Needs resolution — finish staking or withdraw back to vault |

### Layer 3 — Reward Claims (action-level, ephemeral)

**Question**: "Are there rewards to collect right now?"

- Checked on-demand, never cached (reward balances change with every block/Merkle root update)
- Produces transaction data for the strategy to execute

**Auto-tracking (Merkl):**
- `fetchClaimData(chainId, vaultAddress)` → vault-wide claim tx
- Claims ALL pending rewards across all tokens in one call
- Idempotent (cumulative model — resubmitting same proof is a no-op)

**Staking platforms:**
- Query staker contract for pending rewards per position
- May need to unstake to claim, or may have a separate `harvest()` / `getReward()` function
- Platform-specific — each adapter knows how its staker works

## PlatformAdapter Interface Changes

Current optional incentive methods:
```js
async getPoolIncentives(poolAddress, poolData, provider)
async getIncentivePreCloseTransactions(position, incentives, provider)
async getIncentivePostCreateTransactions(positionId, incentives, provider)
async getIncentiveClaimTransactions(vaultAddress, poolAddress, poolData, provider)
```

Proposed additions:
```js
// Layer 2 — Discovery (internal to adapter, called by getPositionsForVDS)
async getStakedPositions(vaultAddress, provider)
// Returns: Array of position objects with incentiveState metadata
// Default (PlatformAdapter base): returns []
// Not called by VDS directly — getPositionsForVDS merges internally

// Layer 2 — State transitions
async getStakeTransactions(positionId, stakingContract, provider)
// Returns: Array of tx objects to stake a position
// Default: returns []

async getUnstakeTransactions(positionId, stakingContract, provider)
// Returns: Array of tx objects to unstake a position
// Default: returns []
```

Existing methods get a `model` field added to the incentives object so the strategy knows which flow to use:

```js
// getPoolIncentives return shape adds `model`:
{ active: true, model: 'auto-tracking' | 'staking', programs: [...] }
```

The `getIncentivePreCloseTransactions` and `getIncentivePostCreateTransactions` methods already handle the right thing per platform:
- Auto-tracking: return `[]` (no stake/unstake needed)
- Staking: return unstake/stake transactions respectively

So `getStakeTransactions` and `getUnstakeTransactions` may be redundant with PreClose/PostCreate. **Decision needed**: are they the same operation, or are there cases where you'd stake/unstake outside of a close/create flow? (e.g., staking an existing unstaked position that was created before incentives were enabled)

## VaultDataService Changes

No changes needed at the VaultDataService level. `getPositionsForVDS` already returns the full position set — the merge of staked + unstaked positions happens inside the adapter. VDS continues to call:

```js
const positions = await adapter.getPositionsForVDS(vaultAddress, provider);
// Now includes both unstaked and staked positions, with incentiveState metadata
```

The merged set goes into the same position cache. Downstream code (strategy evaluation, fee calculation) operates on all positions regardless of staking state. Only the rebalance/close flow needs to check `incentiveState.staked` to know whether to unstake first.

## Strategy Integration — Rebalance Flow

```
1. Evaluate positions (same as today — check range, fees, etc.)

2. For non-aligned positions that need closing:
   a. Check pool incentive status (Layer 1)
   b. If incentives active AND model === 'staking':
      - Execute pre-close txs (unstake)
      - Update position incentiveState
   c. Close position (same as today)
   d. If incentives active:
      - Execute claim txs (model-appropriate)

3. Create new position (same as today)

4. For new position in incentivized pool:
   a. If model === 'staking':
      - Execute post-create txs (stake)
      - Update position incentiveState
   b. If model === 'auto-tracking':
      - Nothing to do (auto-tracked)
```

## Error Handling and Retry

Per the "fail loud" rule, service functions throw on failure. `retryRpcCall` handles transient retries. The strategy handles post-retry failures.

### Failure scenarios by operation:

| Operation | Failure Impact | Strategy Response |
|-----------|---------------|-------------------|
| getPoolIncentives | Can't determine if incentives exist | Proceed with rebalance, skip incentive ops (a stuck position costs real money) |
| getStakedPositions (init) | Missing positions in cache | Log error, retry on next cycle. Staked positions won't be managed until discovered. |
| Pre-close / unstake | **Blocker** (staking) — can't close staked position | Abort close for this position, retry next cycle |
| Pre-close / unstake | N/A (auto-tracking) — returns `[]` | No failure possible |
| Post-create / stake | Position live but not earning incentives | Track as "needs staking", retry next cycle |
| Claim rewards | Rewards still accumulate, claimable later | Track as "pending claim", retry next cycle |

### Retry tracking structure:

```js
// Per-vault, maintained by strategy instance
pendingIncentiveOps: Map<vaultAddress, [{
  type: 'deposit' | 'stakeToken' | 'unstakeToken' | 'withdraw' | 'claim',
  positionId: string | null,     // null for vault-wide claims (Merkl)
  poolAddress: string,
  stakingContract: string | null,
  failedAt: timestamp,
  attempts: number,
}]>
```

The `type` reflects the specific step that failed:
- `deposit` failed → NFT still in vault, retry transfer
- `stakeToken` failed → NFT deposited but not earning, retry stake or withdraw back
- `unstakeToken` failed → NFT still staked, retry unstake
- `withdraw` failed → NFT deposited but not earning, retry withdraw to vault
- `claim` failed → rewards still accumulating, retry claim

Checked at the start of each vault processing cycle. Retried before normal evaluation. Cleared on success. Emitted as events (IncentiveOpFailed, IncentiveOpRetried) for visibility.

## Platform Incentive Survey

Research completed across all target platforms. Three categories emerge.

### Category 1 — Merkl Auto-Tracking

All use the same Merkl Distributor contract (`0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae`, same address on all chains). Same `claim()` selector `0xa0165082`. Our existing `MerklIncentiveValidator` + `merkl.js` service covers all of these with zero contract-layer changes — only need platform adapters for pool interactions.

#### Uniswap V4 (implemented)
- **Chain**: Arbitrum (42161)
- **Position type**: NFT (ERC-721)
- **Reward tokens**: Any ERC-20 (campaign-defined)
- **Claim**: Vault-wide, idempotent, cumulative Merkle proofs
- **Status**: Library + contract infrastructure implemented — `getPoolIncentives()`, `getIncentiveClaimTransactions()`, MerklIncentiveValidator. Not yet wired into automation strategy.
- **API details**: See [docs/platform-knowledge/merkl-incentives.md](../../docs/platform-knowledge/merkl-incentives.md) for endpoint URLs, response shapes, and field-level gotchas

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
- Steps 1+2 can be combined: `safeTransferFrom` with encoded `data` param triggers auto-stake
- **Cannot manage positions while deposited** — no liquidity changes, no fee collection while NFT is in staker
- `unstakeToken` credits rewards to an internal mapping but does NOT transfer them
- `claimReward` is a separate step that transfers accumulated credits
- "Harvest" pattern (claim without full withdrawal): `multicall([unstakeToken, stakeToken, claimReward])` — unstake, restake into same/new incentive, claim the credits
- Anyone can unstake on behalf of an owner after the incentive ends
- Multiple reward tokens possible (per incentive key)

**Design implications:**
- Must unstake + withdraw before any position management (close, modify, fee collection)
- Must re-stake after position changes
- `getAccruedFeesUSD` cannot read fees while staked (NFPM `positions()` returns position data, but `collect()` requires ownership)

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

**Design implications:**
- No unstake needed before position management — `collectTo()` and `decreaseLiquidity()` work through the MasterChef
- Pre-close only needs `withdraw()` (which auto-harvests)
- Post-create only needs `safeTransferFrom()` (which auto-stakes)
- Fee collection works normally via `collectTo()` proxy

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

**Design implications:**
- Fee-vs-emission tradeoff is a strategy-level decision: stake for AERO or stay unstaked for trading fees
- `getAccruedFeesUSD` returns 0 while staked (fees go to voters, not LP)
- Pre-close needs `withdraw()` (which auto-claims AERO)
- Post-create needs `deposit(tokenId)` on the pool's gauge

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

**Design implications:**
- No staking/unstaking — bin tokens stay in vault, rewards accrue automatically
- Claim target is a **per-pool hook contract** (not a global distributor like Merkl) — need to look up the rewarder address per pool
- Different claim function signature from Merkl — needs its own incentive validator or a more general validator pattern
- `getPoolIncentives` would query LBHooksLens instead of Merkl API
- Reward range is dynamic (tracks active bin) — only in-range bins earn rewards, similar to how only in-range V3 positions earn fees

**Note**: TJ also has a separate legacy Merkle-tree-based rewards program (`joe-v2-rewarder`) for V2.1 using off-chain "MakerScore" computation. This is TJ's own system, not Merkl by Angle. The V2.2 hooks system supersedes it.

### Cross-Platform Comparison

| Platform | Model | Deposit Steps | Manage While Staked? | Claim Without Unstaking? | Fee Impact | Reward Tokens |
|----------|-------|---------------|---------------------|-------------------------|------------|---------------|
| **Uniswap V4** | Merkl | N/A | N/A | N/A (vault-wide claim) | None | Any ERC-20 |
| **SushiSwap V3** | Merkl | N/A | N/A | N/A (vault-wide claim) | None | SUSHI, any ERC-20 |
| **QuickSwap V3** | Merkl (current) | N/A | N/A | N/A (vault-wide claim) | None | dQUICK, WMATIC |
| **Camelot V3/V4** | Custom auto-track | N/A | N/A | N/A (vault-wide claim) | None | GRAIL, xGRAIL |
| **Uniswap V3 Staker** | Staking | 2 (deposit+stake) | **No** | **No** (multicall trick) | None (fees still accrue but can't collect) | Any ERC-20 |
| **PancakeSwap** | Staking | 1 (auto-stake) | **Yes** (proxy) | **Yes** (`harvest`) | None | CAKE |
| **Aerodrome CL** | Staking | 1 (`deposit`) | Limited | **Yes** (`getReward`) | **Fees redirected to voters** | AERO |
| **QuickSwap legacy** | Staking | 2 (deposit+enter) | **No** | **Yes** (`collectRewards`) | None | dQUICK, dual rewards |
| **Trader Joe V2.2** | On-chain hooks | N/A | N/A | N/A (claim on rewarder) | None | JOE, any ERC-20 |

## Open Questions

1. **getStakeTransactions / getUnstakeTransactions vs PreClose / PostCreate**: Are these the same operations? If a pool gets incentives after a position is already open and unstaked, do we need to stake it outside the create flow? (Likely yes — need standalone stake/unstake for positions created before incentives were enabled.)

2. ~~**Staked position fee accrual**~~ **ANSWERED**: V3 Staker — cannot read/collect fees while staked (must withdraw). PancakeSwap — can collect fees via `collectTo()` proxy. The adapter's `getAccruedFeesUSD` must account for this: V3 adapter needs to note "fees unknown while staked" or temporarily withdraw; PancakeSwap adapter can query normally.

3. **Multiple staking contracts per pool**: Can a pool have incentives from multiple staker contracts simultaneously? If so, which one do we stake into?

4. **Campaign transitions**: If a campaign ends and a new one starts on a different staking contract, do we need to unstake from the old and restake into the new? (V3 Staker: yes, explicitly. PancakeSwap: campaigns are managed centrally by MasterChef, likely no migration needed.)

5. ~~**PancakeSwap specifics**~~ **ANSWERED**: PancakeSwap uses MasterChefV3 (`0x5e09ACf80C0296740eC5d6F643005a4ef8DaA694` on Arbitrum). Single-step deposit, proxy position management, harvest() for CAKE claims. See verified details above.

## Phased Implementation

**Phase 0 (done):** V4/Merkl auto-tracking — getPoolIncentives, getIncentiveClaimTransactions, contract layer (MerklIncentiveValidator, PositionVault.incentive())

**Phase 1 (current):** Tests for Phase 0, error handling rule, this design doc

**Phase 2:** Wire incentives into strategy (StrategyBase._executeForType 'incentive' case, uncomment BabyStepsStrategy stubs, try/catch + event emission at call sites)

**Phase 3:** Staking platform support
- Add `model` field to getPoolIncentives return shape
- Add `getStakedPositions` to PlatformAdapter interface
- Add `incentiveState` to position tracking in VaultDataService
- Update discovery flow to merge staked + unstaked positions
- Add retry tracking structure to strategy
- Implement PancakeSwap adapter incentive methods (simpler — single-step deposit, harvest, proxy management)
- Implement V3 Staker adapter incentive methods (more complex — multi-step, no management while staked)

**Phase 4:** EventManager integration for incentive failure visibility
