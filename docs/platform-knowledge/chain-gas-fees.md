<!-- Source: fum_library/src/configs/chains.js, fum_library/src/configs/strategies.js, fum_automation/src/utils/patchProviderFeeData.js, fum_automation/src/strategies/babySteps/BabyStepsStrategy.js, fum_automation/test/workflow/traderjoe/gas-profiling.test.js, fum_automation/test/workflow/v3-gas-profiling.test.js, fum_automation/test/workflow/v4/gas-profiling.test.js -->
# Chain Gas Fee Models

How EIP-1559 fees work on each supported chain and why we override ethers.js v5's defaults.

## The Problem: ethers.js v5 Hardcodes 1.5 gwei Priority Fee

ethers.js v5's `getFeeData()` hardcodes `maxPriorityFeePerGas: 1,500,000,000` (1.5 gwei). It never calls `eth_maxPriorityFeePerGas` RPC. This was designed for Ethereum mainnet where tips go to block builders and 1.5 gwei was a reasonable default.

On Arbitrum and Avalanche, actual priority fees are 0 and ~0.000001 gwei respectively. The 1.5 gwei default inflates gas costs ~300x in Hardhat fork tests (Hardhat charges the full amount because it runs standard EIP-1559 EVM, not chain-specific fee logic).

**Fix:** `patchProviderFeeData()` in `fum_automation/src/utils/patchProviderFeeData.js` overrides `provider.getFeeData` using per-chain values from `fum_library/src/configs/chains.js` (`maxPriorityFeePerGas` property). Applied at every provider creation site.

**Source code reference:** ethers.js v5 `packages/abstract-provider/src.ts/index.ts` — `getFeeData()` hardcodes `maxPriorityFeePerGas = BigNumber.from("1500000000")`. User-provided values ARE respected (the fast path in `resolveProperties` skips `getFeeData` entirely when both `maxFeePerGas` and `maxPriorityFeePerGas` are provided).

## Arbitrum

**Fee model:** EIP-1559 base fee only. The sequencer orders transactions first-come-first-served (FCFS) — priority fees are accepted but completely ignored for ordering. The base fee is the sole determinant of transaction cost.

**Real network values** (measured via RPC, block ~437699817):
- `eth_baseFee`: ~0.02 gwei (20,000,000 wei/gas)
- `eth_maxPriorityFeePerGas`: `0x0` (0 wei/gas)
- `eth_gasPrice`: ~0.02 gwei (equals base fee since priority is 0)

**Config value:** `maxPriorityFeePerGas: "0"` (chains 42161, 1337)

**Key details:**
- Sequencer is a single entity (Offchain Labs) that orders by arrival time, not by tip
- ArbOS has custom gas pricing that doesn't match standard EIP-1559 adjustments
- Hardhat's `initialBaseFeePerGas` config is ignored when forking (base fee comes from the forked block)
- Hardhat fork base fee drifts down from real values (~0.02 → ~0.005 gwei) because empty test blocks trigger EIP-1559's -12.5% base fee reduction per block

## Avalanche C-Chain

**Fee model:** EIP-1559 with tips, but both base fee and priority fee are burned. Validators are compensated through staking rewards, not transaction tips. Priority fees exist for EIP-1559 protocol compatibility and are used for transaction ordering, but the economic incentive to tip is near-zero.

**Real network values** (measured via RPC):
- `eth_baseFee`: ~0.018 gwei (18,617,949 wei/gas)
- `eth_maxPriorityFeePerGas`: `0x3e8` (1000 wei/gas = 0.000001 gwei)
- `eth_gasPrice`: ~0.018 gwei

**Config value:** `maxPriorityFeePerGas: "1000"` (chains 43114, 1338)

**Key details:**
- `maxPriorityFeePerGas` value is in **wei per unit of gas** (same unit as Ethereum EIP-1559)
- 1000 wei/gas adds 0.004% to a 0.025 gwei base fee — completely negligible
- Avalanche uses `nAVAX` as the community name for gwei (1 nAVAX = 1 gwei = 10^9 wei)
- Minimum base fee can go as low as 1 nAVAX (1 gwei)
- Under congestion, SnowScan gas tracker shows priority rising to ~0.025 nAVAX for "rapid" tier

## maxFeePerGas Calculation

Both chains use the same formula (matching ethers.js v5's own default logic):

```
maxFeePerGas = lastBaseFeePerGas * 2 + maxPriorityFeePerGas
```

The `* 2` is fee slippage protection — a ceiling, not the actual price paid. The base fee can increase up to 12.5% per block, so doubling it gives the transaction room to survive several consecutive blocks of base fee increases. The effective price at inclusion is always `baseFee + min(maxPriorityFeePerGas, maxFeePerGas - baseFee)`.

## Gas Price Ranges

Observed gas price ranges per chain, used as inputs for threshold profiling. Token prices used for USD conversion: ETH ~$2,000, AVAX ~$9 (as of March 2026 — recalculate if prices shift significantly).

### Arbitrum

| Tier | Gas Price | Context |
|------|-----------|---------|
| Normal | 0.02 gwei | Stable baseline, Feb–Mar 2026. Network utilization ~35% |
| Elevated | 1 gwei | Occasional bumps during moderate activity |
| High congestion | 10 gwei | Serious congestion (proposed cascading gas targets would cap Oct 2025-level events to ~9 gwei) |
| Extreme spike | 42 gwei | Observed Oct 10, 2025 — ERC-20 transfer cost ~$9.49 in L2 gas alone |

- Min L2 base fee floor: 0.01 gwei (AIP proposal to raise to 0.02 gwei, Nov 2025)
- Sequencer is FCFS — priority fee is always 0, base fee is the sole cost
- L1 data posting adds ~$0.01–0.05 per tx (amortized across batches, varies with L1 congestion)
- Pre-Nitro era (2021–2022) saw spikes to ~297 gwei but that architecture no longer applies

Sources: [Arbiscan Gas Tracker](https://arbiscan.io/gastracker), [Arbiscan Gas Price Chart](https://arbiscan.io/chart/gasprice), [AIP: Raise Gas Target proposal](https://forum.arbitrum.foundation/t/aip-raise-the-gas-target-min-l2-base-fee-implement-improvements-to-the-pricing-algorithm/30182)

### Avalanche C-Chain (Post-Octane, April 2025)

| Tier | Gas Price | Context |
|------|-----------|---------|
| Normal | 0.35 nAVAX | Current baseline, Mar 2026. Network utilization ~7% |
| Elevated | 5 nAVAX | Moderate congestion estimate |
| High congestion | 25 nAVAX | Pre-Octane minimum floor — conservative post-Octane spike estimate |
| Extreme spike | 100 nAVAX | Conservative worst-case estimate (no post-Octane spike data yet) |

- Octane upgrade (April 8, 2025) replaced static 25 nAVAX floor with dynamic fee mechanism
- Pre-Octane: base fee ranged 25–225+ nAVAX routinely, with extreme events into thousands
- Post-Octane: dynamic mechanism dampens spikes significantly, but limited spike data available
- Priority fees are near-zero (0.000001 gwei) — tips are burned, not used for validator incentive

Sources: [SnowScan Gas Tracker](https://snowscan.xyz/gastracker), [SnowScan Gas Price Chart](https://snowscan.xyz/chart/gasprice), [Avalanche Octane Blog](https://www.avax.network/about/blog/octane-optimizing-c-chain-gas-fees)

## Operation Cost Analysis

USD cost per operation at different gas price tiers. Uses gas measurements from fork tests below.

### Arbitrum — Uniswap V3 (ETH = $2,000)

Gas is constant regardless of tick range width (single NFT position).

| Operation | Gas | Normal (0.02 gwei) | High (10 gwei) | Spike (42 gwei) |
|-----------|-----|---------------------|-----------------|------------------|
| Create position | 453k | $0.018 | $9.06 | $38.05 |
| Add liquidity | 229k | $0.009 | $4.58 | $19.24 |
| Collect fees | 179k | $0.007 | $3.58 | $15.04 |
| Close position | 221k | $0.009 | $4.42 | $18.56 |
| Swap | 196k | $0.008 | $3.92 | $16.46 |
| Approvals (one-time) | 114k | $0.005 | $2.28 | $9.59 |
| **Full rebalance** | **~870k** | **$0.035** | **$17.40** | **$73.08** |

### Arbitrum — Uniswap V4 (ETH = $2,000)

Gas is constant regardless of tick range width (single NFT position). V4 uses singleton pool architecture — ~33% more gas than V3 due to additional Permit2 and settlement steps.

| Operation | Gas | Normal (0.02 gwei) | High (10 gwei) | Spike (42 gwei) |
|-----------|-----|---------------------|-----------------|------------------|
| Create position | 587k | $0.023 | $11.74 | $49.31 |
| Add liquidity | 356k | $0.014 | $7.12 | $29.90 |
| Collect fees | 286k | $0.011 | $5.72 | $24.01 |
| Close position | 290k | $0.012 | $5.80 | $24.36 |
| Swap | 196k | $0.008 | $3.92 | $16.46 |
| Approvals (one-time) | 109k | $0.004 | $2.18 | $9.16 |
| **Full rebalance** | **~1,073k** | **$0.043** | **$21.46** | **$90.13** |

Note: L1 data posting cost (~$0.01–0.05) not included above. Swap gas is from V3 router — V4 swaps may differ slightly. Add liquidity is cheaper than create (~50% for V3, ~39% for V4) because it skips NFT minting — used for in-range positions only. Approvals are one-time per vault per platform.

### Avalanche — Trader Joe V2.2 (AVAX = $9, Post-Octane)

Gas scales linearly with bin count. Per-bin marginal cost: ~142k gas/bin (create), ~19k gas/bin (collect fees), ~36k gas/bin (close).

**21 bins** (typical centered position, ±10 bins from active):

| Operation | Gas | Normal (0.35 nAVAX) | High (25 nAVAX) | Spike (100 nAVAX) |
|-----------|-----|----------------------|------------------|---------------------|
| Create position | 3,665k | $0.012 | $0.82 | $3.30 |
| Collect fees | 687k | $0.002 | $0.15 | $0.62 |
| Close position | 997k | $0.003 | $0.22 | $0.90 |
| Swap | 275k | $0.001 | $0.062 | $0.25 |
| Approvals | 65k | $0.0002 | $0.015 | $0.059 |
| **Full rebalance** | **~5,002k** | **$0.016** | **$1.13** | **$4.50** |

**Bin count scaling** (measured via `gas-profiling.test.js`, WAVAX/USDC binStep=10):

| Bins | Create | Collect Fees | Close | Total |
|------|--------|-------------|-------|-------|
| 5 | 1,394k | 377k | 421k | 2,192k |
| 11 | 2,237k | 493k | 637k | 3,368k |
| 21 | 3,665k | 687k | 997k | 5,350k |
| 51 | 7,950k | 1,270k | 2,078k | 11,298k |

## Gas Profiling (Executor Balances)

Measured via Hardhat fork tests with direct vault + adapter calls (no AutomationService overhead). Gas is constant across tick widths for V3/V4 (single NFT positions). Values below are averages across ±10 and ±50 tick spacing widths.

**Uniswap V3 (Arbitrum, WETH/USDC fee=500):** ~870k gas total rebalance

| Width | Create | Add Liq | Collect Fees | Close | Total |
|-------|--------|---------|-------------|-------|-------|
| ±10 | 462k | 229k | 179k | 221k | 862k |
| ±50 | 445k | 229k | 179k | 221k | 845k |
| Approvals (one-time): 114k gas (2 ERC20 → NonfungiblePositionManager) |

**Uniswap V4 (Arbitrum, ETH/USDC fee=500):** ~1,178k gas total rebalance

| Width | Create | Add Liq | Collect Fees | Close | Total |
|-------|--------|---------|-------------|-------|-------|
| ±10 | 585k | 356k | 284k | 280k | 1,148k |
| ±50 | 590k | 357k | 288k | 300k | 1,178k |
| Approvals (one-time): 109k gas (2 Permit2 flow — ERC20→Permit2 + Permit2→PositionManager, USDC only) |

V4 uses ~33% more gas than V3 due to Permit2 approval steps and PoolManager settlement actions (SETTLE/TAKE). Add liquidity (increase existing position) is ~50% cheaper than create for V3 and ~39% cheaper for V4 — it skips NFT minting. Strategy uses add liquidity only for in-range positions; rebalance always does close + create.

**Trader Joe V2.2 (Avalanche, 21 bins):** 5,350k gas total (close + swap + create, excludes approvals)
- Close position: 997k
- Collect fees: 687k (standalone)
- Swap: 275k
- Approvals: 65k
- Create position: 3,665k
- See bin count scaling table above — gas scales ~142k/bin for create, ~36k/bin for close

**Executor balance thresholds** (derived from above, sized for worst-case gas spikes):
- Arbitrum: min=0.002 ETH, max=0.004 ETH. V3 ~870k gas/rebalance, V4 ~1,178k gas/rebalance. At normal 0.02 gwei: ~58 V3 or ~43 V4 rebalances per max balance. At 42 gwei extreme spike: ~2 V3 or ~1.5 V4 rebalances per max balance.
- Avalanche: min=0.04 AVAX, max=0.08 AVAX (~13/26 worst-case rebalances at 565 nAVAX pre-Octane spike; post-Octane spikes expected much lower)

These values are configured as `minExecutorBalance`/`maxExecutorBalance` in chain config. See `docs/decisions/per-vault-signer.md` for the gas distribution design.
