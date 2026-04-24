<!-- Source: src/adapters/UniswapV3Adapter.js, src/adapters/UniswapV4Adapter.js, src/adapters/TraderJoeV2_2Adapter.js, src/services/blockExplorer.js -->
# Coverage Gaps — Why Some Lines Aren't Covered

Every uncovered line in `fum_library/src/adapters/` and `fum_library/src/services/blockExplorer.js` is enumerated below and classified. This doc is the authoritative audit — if you're tempted to chase a specific uncovered line, check the classification first. Most of what remains is either physically unreachable, shadowed by upstream guards, or requires infrastructure work whose payoff is 2-5 lines per fixture.

## Snapshot

| File | Coverage | Uncovered |
|---|---|---|
| UniswapV3Adapter.js | 99.42% | 31 lines |
| UniswapV4Adapter.js | 99.19% | 36 lines |
| TraderJoeV2_2Adapter.js | 98.79% | 32 lines |
| services/blockExplorer.js | 97.78% | 4 lines |
| **Total** | | **103 lines** |

Every single uncovered line is accounted for below.

## Category A — Physically unreachable code

### A.1 Regex + BigInt redundant catches (V3 only, 20 lines)

Pattern in `_calculateUncollectedFeesInternal`:

```js
if (!/^\d+$/.test(position.liquidity)) {
  throw new Error('Invalid position.liquidity: must be a valid numeric string');
}
try {
  liquidity = BigInt(position.liquidity);
} catch (error) {
  throw new Error('Invalid position.liquidity: must be a valid numeric string');  // UNCOVERED
}
```

`/^\d+$/` only matches decimal-only strings, and `BigInt()` never throws on those. The `catch` is unreachable.

`UniswapV3Adapter.js` **2543-2544, 2553-2554, 2563-2564, 2573-2574, 2583-2584, 2600-2601, 2614-2615, 2627-2628, 2637-2638, 2813-2814** (position.liquidity, feeGrowthInside0/1LastX128, tokensOwed0/1, tickLowerData, tickUpperData, feeGrowthGlobal0/1, calculateTokenAmounts liquidity).

### A.2 "Helper throws first" guards (10 lines)

`getTokenByAddress` and `getTokenBySymbol` (in `src/helpers/tokenHelpers.js`) either return a valid token or throw — they never return `undefined`. The adapter's `if (!token) throw ...` checks after these calls are dead.

- `UniswapV3Adapter.js` **1203-1204, 1208-1209** (`_fetchPoolData` "Unsupported token" for both tokens)
- `UniswapV3Adapter.js` **3058-3059** (selectBestPool internal resolveTokenData)
- `UniswapV4Adapter.js` **4049-4050** (selectBestPool internal resolveTokenData)
- `TraderJoeV2_2Adapter.js` **2620-2621** (selectBestPool internal resolveTokenData)

### A.3 Arithmetically unreachable throw (TJ only, 2 lines)

`TraderJoeV2_2Adapter.js` **2831-2832** — `getPositionRange`'s final `if (lowerBinId >= upperBinId)` guard. `upperPercent`/`lowerPercent` are pre-validated `> 0 && <= 100`, so `Math.log(1 + p/100)` is strictly positive, so `Math.ceil(.../logBase) >= 1`. That guarantees `upperBinId > activeId > lowerBinId` strictly — the guard can never fire.

### A.4 blockExplorer factory safety nets (4 lines)

- `services/blockExplorer.js` **98-99** — "Unknown explorer type": fires only if `EXPLORER_BY_CHAIN` returns a value that isn't `'arbiscan'` or `'alchemy'`. The const map only contains those two strings.
- `services/blockExplorer.js` **109-110** — "No Etherscan chain ID configured": fires only when a chain is marked `'arbiscan'` in `EXPLORER_BY_CHAIN` but missing from `ETHERSCAN_CHAIN_IDS`. The const maps are kept consistent.

Both are defensive safety nets against future misconfiguration.

## Category B — Outer-catch "filter rethrow" branches (20 lines)

Every generate\*/parse\*/read\* method wraps its body in:

```js
try {
  // ... actual work ...
} catch (error) {
  if (error.message.includes('X') || error.message.includes('Y')) {
    throw error;     // UNCOVERED — pass-through arm
  }
  throw new Error(`Failed to ...: ${error.message}`);
}
```

The filter-passthrough arm only fires when a nested internal call (not top-level pre-validation) throws a filter-matching message. Since pre-validation throws those exact messages *before* the try block runs, the filter passthrough is unreachable through normal test inputs. The *observable* error propagation is covered by the shape-validation tests that hit the pre-validation path.

Uncovered filter-rethrow lines:

- `UniswapV3Adapter.js` **473-474** (parseSwapEvent), **1730-1731** (getPositionsForDisplay)
- `UniswapV4Adapter.js` **472-473** (parseSwapEvent), **728-729** (getPositionsForVDS), **968-969** (getPositionsForDisplay), **1843-1844** (generateRemoveLiquidityData), **2093-2094** (generateAddLiquidityData), **2309-2310** (_getAddLiquidityAmounts), **2824-2825** (generateCreatePositionData)
- `TraderJoeV2_2Adapter.js` **197-198** (parseSwapEvent)

(V4 `refreshPositionForDisplay` 1110-1111 is NOT in this list anymore — the zero-liquidity fixture test produces `"Position X has zero liquidity"`, which matches the filter and exercises the passthrough.)

## Category C — Fixture-dependent or SDK-internal paths

Reachable in principle but require on-chain state, burned NFTs, mainnet-only code paths, or SDK-internal data shapes that the Hardhat-fork fixture doesn't produce. Each would require meaningful fixture infrastructure for 2-9 lines of payoff.

### C.1 Burned-NFT skip (V4 only, 2 lines)

`UniswapV4Adapter.js` **235-236** — `_discoverTokenIdsByTransferEvents`, the `catch` covering ERC721 `ownerOf` reverts on burned tokens. Needs an actually-burned V4 position NFT with a prior Transfer event showing the vault as recipient so the scan surfaces it. No test fixture burns positions.

### C.2 Production-only fallback (V4 only, 2 lines)

`UniswapV4Adapter.js` **804-805** — `getV4PositionsByOwner` subgraph fallback (the `else` arm of `if (isLocalChain(this.chainId))`). Local fork tests run on chain ID 1337 and take the `_discoverTokenIdsByTransferEvents` branch. Hitting this line requires testing against real Arbitrum mainnet — out of scope for unit tests.

### C.3 TJ guards shadowed by upstream "not found" check (TJ only, 10 lines)

After `decreaseLiquidity(100%)`, the TJ position manager contract zeros out the removed position's `lbPair` (setting it to `AddressZero`) **in addition to** clearing `active` and `depositIds`. Both `refreshPositionForDisplay` and `getPositionById` check `lbPair === AddressZero` first and throw "Position X not found", which shadows the downstream guards. The only way to trigger the shadowed guards is a contract-state fork where `lbPair` stays populated while other fields clear — TJ's real contract behaviour never produces that state.

- `TraderJoeV2_2Adapter.js` **569-570** — `refreshPositionForDisplay` "not active" (shadowed by 563-565 "not found")
- `TraderJoeV2_2Adapter.js` **574-575** — `refreshPositionForDisplay` "no deposit bins" (shadowed)
- `TraderJoeV2_2Adapter.js` **676-677** — `getPositionById` "no deposit bins" (shadowed by 668-670 "not found")
- `TraderJoeV2_2Adapter.js` **327-328** — `getPositionsForVDS` inactive-position `continue`. Fires when `getPositionById` *returns* a position with `active: false`. In practice `getPositionById` throws ("not found" — see above) before returning, so the outer code never sees a returned-but-inactive position.
- `TraderJoeV2_2Adapter.js` **408-409** — `getPositionsForDisplay` returns `{positions: {}}` when every position is inactive. A vault where every position was removed produces `lbPair=AddressZero` for all of them and `getPositionById` throws inside `getPositionsForDisplay`'s loop, bypassing the all-inactive path. The test fixture doesn't provide a way to hold truly-inactive-but-still-existing positions.

### C.4 ETH-tracking graceful-degradation catches (V4 only, 9 lines)

- `UniswapV4Adapter.js` **3542-3544** (parseClosureReceipt native-ETH fees calc branch for token1-native case)
- `UniswapV4Adapter.js` **3549-3551** (parseClosureReceipt `console.warn` block)
- `UniswapV4Adapter.js` **3741-3743** (parseCollectReceipt `console.warn` block)

These require the block-explorer fetch to fail *mid-parse* AND a native-ETH position to be active in the receipt at the same time. The block explorer is stable in tests (fetch calls spied with deterministic responses). Forcing both preconditions simultaneously would need an orchestrated spy + fixture dance for nine lines of graceful-degradation logging.

The 3542-3544 cluster is slightly different: it's the `if (token1Addr === NATIVE_ETH)` branch inside the native-ETH fees calculation. The existing V4 test fixture creates positions where the native ETH side is token0 (AddressZero sorts before any ERC20 address). Token1-native positions would require fabricating a pool where NATIVE_ETH sorts as token1, which isn't representable in V4 (AddressZero is always the lowest-sorting address).

### C.5 SDK-internal variant (V3 only, 1 line)

`UniswapV3Adapter.js` **5622** — `(t.address || t.wrapped?.address || ethers.constants.AddressZero).toLowerCase()` inside `_generateSwapTransaction`'s route-extraction map. The AlphaRouter output's per-hop `Token` objects always have `.address` populated — the `||` chain short-circuits at the first operand. The second and third operands are purely defensive for SDK-internal variants that production doesn't emit.

## Category D — External-dependency-mocking paths

Reachable only by mocking imported modules or deploying stub contracts. Both have high infrastructure cost relative to the line count.

### D.1 V4 no-pools / no-active-pools (7 lines)

- `UniswapV4Adapter.js` **4077-4078** — "No pools found" throw
- `UniswapV4Adapter.js` **4130-4134** — "No active pools (zero TVL)" throw

Both require `discoverV4Pools` (imported from `services/theGraph.js`) to return an empty array or only zero-TVL entries. `vi.mock` on the ESM import affects the whole test file; `vi.spyOn` on a namespace import doesn't work because the adapter destructures the binding at module load. The test-file-scoped `vi.mock` approach risks contaminating the 20+ other V4 tests that depend on real subgraph behaviour.

### D.2 TJ quoter-returns-zero (4 lines)

- `TraderJoeV2_2Adapter.js` **2013-2014** — `_generateSwapTransaction` "No valid route found" when `quotedAmountOut === '0'`
- `TraderJoeV2_2Adapter.js` **2455-2456** — `getBestSwapQuote` "No route found for token pair" when `quotedAmountOut === '0'`

LBQuoter on the Avalanche fork returns non-zero amounts for any real pair. Producing `'0'` requires deploying a stub LBQuoter — infrastructure work for four lines.

### D.3 TJ selectBestPool inline pool-query branches (9 lines)

- `TraderJoeV2_2Adapter.js` **2658-2659** — `getAllLBPairs` returned empty
- `TraderJoeV2_2Adapter.js` **2669-2670** — inline `pairAddress === AddressZero` guard
- `TraderJoeV2_2Adapter.js` **2690-2692** — inline pool-data fetch catch (per-pair query fails)
- `TraderJoeV2_2Adapter.js` **2699-2700** — `validPairs` empty after null-filter
- `TraderJoeV2_2Adapter.js` **2710-2711** — `activePools` empty after liquidity-filter
- `TraderJoeV2_2Adapter.js` **2717** — sort comparator `return 0` when two pools have identical `totalReserves`

Each needs a specific Avalanche fork state (no factory pairs, pair-query revert, zero-liquidity pools, or exactly-equal BigNumber reserves) that the WAVAX/USDC fork doesn't naturally produce. A best-effort AUSD/USD₮0 test exists in the test suite that may hit 2658-2659 depending on actual fork state, but we don't assert on which specific error path it takes.

## Summary

| Category | Lines | Coverable? |
|---|---|---|
| A (dead code: A.1 20 + A.2 10 + A.3 2 + A.4 4) | 36 | No |
| B (filter rethrow branches) | 20 | No (unreachable in practice) |
| C (fixture/SDK-internal: C.1 2 + C.2 2 + C.3 10 + C.4 9 + C.5 1) | 24 | Yes, but high infrastructure cost |
| D (external-dependency mocks: D.1 7 + D.2 4 + D.3 12) | 23 | Yes, but contamination risk |
| **Remaining total** | **103** | |

**Treat ≥99% adapter coverage as the practical ceiling.** The 36 Category-A lines can never be reached given the surrounding code; V8's statement counter has no way to model "this catch is dead because the try block can't produce errors matching the filter." The 20 Category-B filter branches are unreachable in practice for the same reason — the *observable* error propagation is already covered by shape-validation tests that hit the pre-validation path. The 47 remaining Category-C/D lines have a terrible effort-to-value ratio.

If a future source change *removes* one of the upstream guards that makes A/B code dead, the previously-dead code becomes live — and the existing shape-validation tests (which assert on the caller's observable error) will catch any regression. The coverage instrument just can't prove the code path is the one being executed.
