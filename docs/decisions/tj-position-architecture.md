<!-- Source: fum/contracts/TJPositionManager.sol, fum/contracts/TJPositionProxy.sol, fum/contracts/validators/TJPositionValidator.sol, fum_library/src/adapters/TraderJoeV2_2Adapter.js, fum_automation/src/strategies/babySteps/BabyStepsStrategy.js -->
# Trader Joe V2.2 Proxy Refactor — Decisions

## Status: Complete

Design decisions from the TJ proxy refactor. Platform-level knowledge (fee model, LiquidityHelperContract, gotchas) is in `docs/platform-knowledge/trader-joe-v2-2.md`.

## Proxy Per Position

EIP-1167 minimal proxy per position (~45k gas to deploy). Each proxy holds ERC1155 LB tokens for one position, enabling per-position `balanceOf` queries against the LiquidityHelperContract. Without isolation, a single TJPositionManager address holds all positions' LB tokens — `balanceOf` returns the combined balance, making per-position fee attribution impossible.

## Off-Chain Fee Math

All fee computation is off-chain via LFJ's LiquidityHelperContract (view calls). The contract stores baselines (`previousX/Y`) and executes burns — no complex math on-chain. This was chosen over: on-chain fee calculation (the old broken approach conflated fees with composition changes), subgraph (none exists for V2.2), and LFJ API (requires application for API key). The helper contract works on Hardhat forks with no external dependencies.

## Fee Handling Varies by Operation

- **Removal operations** (`collectFees`, `decreaseLiquidity`, `removePosition`): Accept `feeShares[]` computed off-chain, burn fee LB tokens via proxy. Two-step burn in `_decreaseLiquidityWithFees`: fee burn first, then principal burn — produces clean `FeesCollected` + `PositionRemoved` events with exact amounts.
- **`addToPosition`**: No fee burn. Accepts `previousFeesX[]`/`previousFeesY[]` and adjusts baselines: `previousX[i] = currentAmount - knownFees`. Fees stay in LB tokens and keep compounding until explicitly collected. No reason to force-collect on add.

## Slippage on Principal Only

`amountXMin`/`amountYMin` on removal operations are computed from principal amounts, not fees + principal. Fee amounts are deterministic given the `feeShares` passed in — not susceptible to sandwich attacks. Including fees in the minimum risks reverts from rounding differences between off-chain helper math and on-chain LBRouter math, which could block position closures.

## Strategy Fee Threading

`checkFeesToCollect()` returns `{ shouldCollect, feeData }` instead of a bare boolean. The `feeData` (full `getAccruedFeesUSD` result including `feeShares` for TJ) is passed opaquely through `collectFees` → `generateClaimFeesData`. Each adapter extracts what it needs (TJ uses `feeData.feeShares`, V3/V4 ignore it). Eliminates redundant second `getAccruedFeesUSD` call — saves ~5 RPC calls per TJ fee cycle, ~9 for V3, ~3 for V4.

## Zero-Amount Filtering in Contract

`_filterNonZero()` strips zero-amount entries from depositIds/amounts arrays before calling `removeLiquidity`. Done in the contract (not adapter) because: (1) two call sites need it — fee burn and principal burn, (2) principal burn amounts are computed inside the contract (`liquidityMinted[i] * percentage / 100` can round to zero), so the adapter can't filter those. See `LBPair__ZeroAmount` gotcha in platform-knowledge doc.

## previousFeesX/Y Trust Model

No on-chain validation of `previousFeesX/Y` values in `addToPosition` beyond length checks. The vault owner could pass arbitrary values, but this is a self-only operation — they can only affect their own position's baseline tracking. Inflating fees would misreport event labels (fees vs principal) but the same total tokens come back either way. On-chain validation would require bin reserve reads, adding gas for no security benefit.
