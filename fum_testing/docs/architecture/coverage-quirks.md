<!-- Source: .solcover.js, hardhat.config.js, contracts/*.sol, contracts/validators/*.sol, test/unit/*.test.js -->
# Coverage Quirks

**Why the coverage report lies and what to do about it.**

`npx hardhat coverage` runs solidity-coverage 0.8.16 against contracts compiled with `viaIR: true`. That combination produces a large number of false-negative gaps — lines and branches that are actually exercised by tests but reported as uncovered. Before investing in "improving coverage," read this doc and classify the gap. Most gaps are tool artifacts and require no test changes.

## TL;DR

After two rounds of genuine-gap closure (2026-04-20), every priority contract reports **100% line coverage and 100% function coverage**. Branch coverage sits at ~93%, and the remaining uncovered branches fall cleanly into two accepted categories:

| | Count | Share |
|---|---:|---:|
| Uncovered statement lines | 0 | — |
| Uncalled functions | 0 | — |
| Uncovered branches | 48 | — |
| Of those: tool artifacts (tests exist, lcov doesn't register) | ~42 | ~87% |
| Of those: NONREENTRANT_GUARD "locked" branches (accepted) | 6 | ~13% |
| Of those: genuine uncovered code | 0 | 0% |

**The ~42 tool-artifact branches would all register with a better coverage tool** (see [`MEMORY.md` → TODO / Tooling](../../../MEMORY.md) for the `forge coverage` migration evaluation). **The 6 NONREENTRANT_GUARD branches are genuinely untested** but intentionally so — testing them requires per-function reentrancy attacker mocks with zero marginal security value against OpenZeppelin's battle-tested `ReentrancyGuard`.

> **Revision history**
>
> - **2026-04-20 round 1**: Initial audit identified 164 uncovered items, categorized 154 as tool artifacts and 10 as genuine. Implemented T4 (ETH-rejecting owner), T3 (post-validation failures), T1 (unauthorized-caller setters). Post-run: 84 uncovered items remained.
> - **2026-04-20 round 1 refinement**: Recon surfaced that 4 originally-classified "genuine" items were actually artifacts — `TJPositionManager.getPositionCount` (FNDA miscount, 2 items), `UniversalRouterValidator.sol:171` (bare-`revert` in `else` block, 1 item), `PositionVault` burn post-validation (existing test at `PositionVault.test.js:2433` already covered it, 1 item).
> - **2026-04-20 round 2**: Post-fix recon identified *additional* genuine gaps the initial audit missed — BabyStepsStrategy AGGRESSIVE/STABLECOIN `feeReinvestment` assertions (2 branches), V3 multicall truncated-collect (1 branch), V4 `validateCollect` TAKE/TAKE_PORTION/SWEEP action handlers (9 items), TJPositionManager `supply==0` else-branches + sweep-with-proxy-balance (7+ items), plus bonus `amountY` slippage and `addToPosition` supply==0 branches. All closed with test-only additions. Post-run: ~50 uncovered branches remain, all tool artifacts.

## Why this happens

Two things combine:

1. **`viaIR: true`** rewrites Solidity through the Yul IR pipeline. The IR aggressively inlines, reorders, and merges branches. Statements and branches that the source writer sees as distinct can collapse into a single instrumentation point.
2. **solidity-coverage 0.8.16** instruments AST nodes and counts hits at the bytecode offsets it injects. When the IR pipeline moves or folds those offsets, hits land at the wrong node (or nowhere), producing `DA:0` / `BRDA:0` on code that clearly ran.

viaIR cannot be disabled: `TJPositionManager.sol` and `ParrisIslandStrategy.sol` exceed the stack-depth limit with the legacy pipeline. Turning off viaIR breaks compilation.

`.solcover.js` sets `configureYulOptimizer: true` as a partial workaround, but the quirks documented below still appear.

## Quirk classes

When a gap appears in the report, classify it with one of these tags before acting. Every class here has been confirmed in this codebase — these are not hypothetical.

### REQUIRE_FAIL — ~103 gaps (most common)

The false branch of a `require` statement. The failure path is tested explicitly (test calls the contract with bad input, expects a revert with the exact message), but lcov reports `BRDA:...,0`.

Example — `StrategyBase.sol:31`:

```solidity
function authorizeVault(address vault) external {
    require(vault != address(0), "StrategyBase: zero vault address");  // line 31
```

Test at `StrategyBase.test.js:118`:

```javascript
it("Should fail when authorizing zero address", async function() {
  await expect(
    strategy.connect(user1).authorizeVault(ethers.ZeroAddress)
  ).to.be.revertedWith("StrategyBase: zero vault address");
});
```

The test reaches line 31, the condition is false, the revert fires, the test passes. lcov still reports hit=0 on branch 1.

**Variant — bare `revert` in `else` block.** Same underlying cause, slightly different shape:

```solidity
else {
    revert("UniversalRouterValidator: command not allowed");  // line 171
}
```

Three tests at `UniversalRouterValidator.test.js` L457/L466/L475 pass TRANSFER / PAY_PORTION / unknown-command calldata and expect the revert. lcov still reports `DA:171,0`. The "tool loses the hit through the revert" problem isn't specific to `require` — it also hits bare `revert(...)` inside conditional blocks.

**Variant — post-validation `require(success, ...)` inside a vault loop.** The audit initially flagged `PositionVault` burn at `BRDA:524,89,1` as a genuine T3 gap, but the existing test at `PositionVault.test.js:2433` (`setShouldFail(true)` then expect revert with "PositionVault: burn failed") already exercises it. Same artifact pattern — test exists, branch reports hit=0.

**Action**: none. Move on.

### NONREENTRANT_GUARD — 12 gaps (accepted, not chased)

The "locked" branch of OpenZeppelin's `nonReentrant` modifier. Only triggerable by a reentrant call, which requires a dedicated attacker contract per function.

Found on every `nonReentrant` function in `TJPositionManager.sol` (`createPosition`, `addToPosition`, `collectFees`, `decreaseLiquidity`, `removePosition`, `safeTransferFrom`).

**Action**: **Do not write tests for these.** OpenZeppelin's `ReentrancyGuard` is battle-tested. Writing 12 reentrant-attacker mocks for adversarial-high-cost coverage with zero marginal security value is a waste.

### INHERITED_BODY — 6 gaps

Body of an inherited function that is called from a concrete contract. `FNDA > 0` (the function is called) but `DA:0` on the body lines.

Example — `StrategyBase.sol:52–53` (inside `deauthorizeVault`):

```solidity
authorizedVaults[vault] = false;
emit VaultAuthorized(vault, false);
```

`BabyStepsStrategy` inherits `StrategyBase`; tests call `deauthorizeVault` through `BabyStepsStrategy` bytecode. `FNDA:5,deauthorizeVault` but these body lines still show `DA:0`.

**Action**: none. The lines run.

### INDIRECT_CALL — 6 gaps

Function reached via `vault.execute([target], [calldata])` or via validator → manager dispatch, rather than a direct call. Direct calls register, indirect ones sometimes don't.

Example — `TJPositionManager.sol:250` (`emit PositionCreated(...)`). Tests only reach `createPosition` through `vault.mint([pm], [calldata], [0n])` → `vaultFactory.validateMint` → `positionManager.createPosition`. The event emit at L250 shows `DA:0` even though many tests emit and assert on it.

**Action**: none. Verify once (grep for `emit EventName` in test assertions) that the code really does run, then ignore.

### MODIFIER_DISJUNCT — 6 gaps

A branch inside a compound modifier condition, e.g., `msg.sender == owner || msg.sender == executor`. Tests exercise each disjunct separately (owner call, executor call, unauthorized revert), but the tool fails to attribute one or both branches.

Example — `PositionVault.sol:148` (`onlyAuthorized` modifier applied to `swap`). Tests at `PositionVault.test.js:2641` (owner), `:2656` (executor), `:2672` (unauthorized) all exist.

**Action**: none. If every disjunct has a named test, the branch is covered even if lcov says otherwise.

### OTHER — ~20 gaps

Grab-bag for artifacts that don't fit the above. Seen in this codebase:

- **Inline conditionals** — `if (returnData.length > 0)` error-bubbling patterns in `PositionVault` `mint`/`increaseLiquidity` (lines 359, 413) with explicit tests for both sides.
- **Internal helper lines** — statements inside `_filterNonZero`, `_burnFeesViaProxy`, `_decreaseLiquidityWithFees` in `TJPositionManager` that run via tested outer paths.
- **Phantom negative counts** — `UniversalRouterValidator.sol` shows `BRDA:...,−1` / `−2` / `−4`. These are instrumentation anomalies, not real branches.
- **Unused-variable suppressions** — `vault;` statements that silence "unused parameter" warnings (e.g., `UniswapV3PositionValidator.sol:148`). No runtime logic.
- **FNDA miscount** — function is called from tests but lcov reports `FNDA:0,funcName` (and the body lines are reported `DA:0`). Example: `TJPositionManager.getPositionCount` at `TJPositionManager.sol:481–483`. Two separate test assertions call it (`TJPositionManager.test.js:385` and `:426`), yet `FNDA:0,getPositionCount` and `DA:482,0` both appear. Adding more call sites doesn't help — the tool is failing to register existing ones. This is distinct from INHERITED_BODY (where FNDA>0 but body DA=0); here FNDA itself is 0.

**Action**: inspect once to confirm the pattern, then ignore.

## Before you chase a gap

1. **Check the function exists in a test file.** Grep for the function name or error message in `test/unit/`. If a "should fail when X" test exists and passes, the gap is almost certainly a tool artifact.
2. **Trace execution.** Does the test's `expect(...).to.be.revertedWith(...)` reference the exact require message? Does the setup actually trigger the intended condition (right signer, right input)?
3. **Classify against the quirk list above.** If it fits, ignore.
4. **Only if it doesn't fit**, ask: is this a genuine gap worth testing? What's the effort tier (add a test, extend a mock, build new infrastructure)?

## Audit snapshot (2026-04-20 — final, round 2)

Final per-contract state after round 1 + round 2 closures. The historical initial-audit numbers (164 items, 10 genuine gaps) are preserved in the revision history above.

| Contract | Uncovered | Tool artifact | NONREENTRANT accepted | Genuine (B) |
|---|---:|---:|---:|---:|
| PositionVault.sol | 19 branches | 19 | 0 | 0 |
| TJPositionManager.sol | 12 branches | 6 | 6 | 0 |
| VaultFactory.sol | 0 | — | — | — |
| BabyStepsStrategy.sol | 0 | — | — | — |
| StrategyBase.sol | 0 | — | — | — |
| MerklIncentiveValidator.sol | 0 | — | — | — |
| TJPositionValidator.sol | 0 | — | — | — |
| TJSwapValidator.sol | 0 | — | — | — |
| UniswapV3PositionValidator.sol | 0 | — | — | — |
| UniswapV4PositionValidator.sol | 15 branches | 15 | 0 | 0 |
| UniversalRouterValidator.sol | 2 branches | 2 | 0 | 0 |
| **Total** | **48 branches** | **42** | **6** | **0** |

The 6 NONREENTRANT_GUARD branches all live in TJPositionManager at the declarations of its six `nonReentrant` external functions: `createPosition` (L149), `addToPosition` (L285), `collectFees` (L399), `decreaseLiquidity` (L425), `removePosition` (L450), `safeTransferFrom` (L493). Each branch represents the "already-locked → revert" side of OpenZeppelin's `ReentrancyGuard` — only reachable via a reentrancy attacker mock.

### Closed by round 1 + round 2 work

- **Tier 4 — ETH-rejecting owner** (2 items closed). Added `MaliciousOwner.sol` with reverting `receive()`, two tests in `PositionVault.test.js`. Both `BRDA:268` / `BRDA:281` registered. See [testing-patterns.md](testing-patterns.md) → MaliciousOwner section.
- **Tier 3 — post-validation `require(success)`** (3 items, 0 registered). Added tests for `decreaseLiquidity` / `collect` / `burn` failure paths in `PositionVault.test.js`. Tests run and pass, but lcov still reports the branches uncovered — confirmed REQUIRE_FAIL tool artifacts (documented under that quirk class).
- **Tier 1 — BabyStepsStrategy unauthorized setters** (4 items, closed). Direct-call negative tests added for `setRangeParameters` / `setFeeParameters` / `setRiskParameters`. All MODIFIER_DISJUNCT branches now register.
- **Round 2 — additional test-only closures**:
  - BabyStepsStrategy AGGRESSIVE/STABLECOIN `getFeeReinvestment` — assertion added to existing template-value tests
  - V3 `UniswapV3PositionValidator.sol:97` multicall truncated-collect — 1 test added
  - V4 `validateCollect` TAKE/TAKE_PORTION/SWEEP — 6 tests added (mirrored from `validateDecreaseLiquidity` coverage)
  - TJPositionManager `supply==0` fallback branches in `collectFees` / `removePosition` / `addToPosition` — 3 tests added using `mockLBPair.setTotalSupply(..., 0)` after position creation
  - TJPositionManager proxy-token sweep (`_sweepProxyTokens` balance>0 path) — 1 test added using pre-funded proxy before `addToPosition`
  - TJPositionManager `amountY` slippage require — 1 test mirroring the `amountX` version
  - TJPositionManager `_removeFromOwnerPositions` non-first-index branch — 1 test transferring position 2 (at index 1) in a multi-position vault
  - TJPositionManager `_decreaseLiquidityWithFees` empty-filteredIds branch — 1 test passing `feeShares == liquidityMinted` with `percentage=1` so Step A zeros liquidity and Step B's principalBurn is all zero

### Remaining genuine gaps worth addressing

**None.** TJPositionValidator.validateBurn (Tier 5a placeholder) was resolved upstream when `getPositionCount`'s FNDA registered in round 1. Every code path reachable via normal execution is now exercised.

### Remaining 48 uncovered branches — classification

**~42 tool artifacts** (tests exist, lcov doesn't register):

- **PositionVault (19)**: onlyOwner / onlyAuthorized modifier false-branches, require-length-mismatch in `swap`, fund/withdraw/wrap/unwrap require-false branches, incentive balance/call-success requires, inline `if (returnData.length > 0)` error-bubbling in `mint`/`increaseLiquidity`, the 3 post-validation `require(success)` calls (tests exist, don't register — viaIR REQUIRE_FAIL pattern).
- **TJPositionManager (6)**: owner/active/length requires in createPosition (L150), addToPosition (L288), collectFees (L402), decreaseLiquidity (L427, L428), removePosition (L453) — all with existing negative tests.
- **UniswapV4PositionValidator (15)**: selector / calldata-length / param-length requires, `_extractAddress` offset check.
- **UniversalRouterValidator (2)**: V4 TAKE_PORTION / TAKE_PAIR non-vault recipient requires.

**6 NONREENTRANT_GUARD accepted-untested branches** (all in TJPositionManager):

- `BRDA:149` createPosition, `BRDA:285` addToPosition, `BRDA:399` collectFees, `BRDA:425` decreaseLiquidity, `BRDA:450` removePosition, `BRDA:493` safeTransferFrom — each is the "locked → revert" branch of the `nonReentrant` modifier, triggerable only by a reentrancy attacker mock. See the NONREENTRANT_GUARD quirk class above for the rationale.

PositionVault's functions are also `nonReentrant`, but the coverage tool doesn't surface separate branches for those — likely an artifact of how the modifier's branches fold together with the other require-false branches during viaIR instrumentation on that contract.

### Reproducing the audit

To re-categorize gaps after contract changes:

```bash
# From fum/ — the canonical entrypoint
npm run contracts:test:coverage

# Inspect per-contract gaps
awk '/SF:.*CONTRACTNAME\.sol$/,/end_of_record/' ../fum_testing/coverage/lcov.info \
  | grep -E "^(DA:[0-9]+,0|BRDA:[0-9]+,[0-9]+,[0-9]+,(0|-)|FNDA:0,)$"
```

For each result, apply the classification process above. The vast majority will slot into an existing quirk class.

## See also

- [testing-patterns.md](testing-patterns.md) — Mock APIs, deployment sequences, calldata encoding
- [fum/docs/architecture/scripts-pipeline.md](../../../fum/docs/architecture/scripts-pipeline.md) — How `contracts:test:coverage` fits the sync pipeline
- `MEMORY.md` → TODO / Tooling — Evaluate migrating to `forge coverage`
