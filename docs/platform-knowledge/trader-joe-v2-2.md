# Trader Joe V2.2 — Platform Knowledge

## Core Model: Bins, Not Ticks

TJ V2.2 uses discrete price "bins" instead of Uniswap's continuous tick ranges. Each bin is an ERC1155 token ID on the LBPair contract. Positions span multiple bins, with per-bin liquidity tracking.

- **activeId** — The current price bin (TJ's equivalent of Uniswap's currentTick)
- **binStep** — Fee tier in basis points (e.g., 10 = 0.10%, 20 = 0.20%)
- Liquidity is tracked per bin, not as a single global value

## Token Ordering

TJ uses **tokenX/tokenY** (not token0/token1), where **X = lower address, Y = higher address**. Same sorting logic as Uniswap, different naming. Always call `sortTokens()` before LBPair lookups or pool data queries.

## Swap Path Structure

Paths are **arrays per hop**, not single values:
```javascript
const path = {
  pairBinSteps: [20],           // binStep per hop
  versions: [3],                // protocol version per hop
  tokenPath: [tokenIn, tokenOut]
};
```

**Gotcha: Version 3 = V2.2, not version 2.** The version numbers are: 1 = V1, 2 = V2.1, 3 = V2.2.

## Native Token Handling

Native AVAX uses `AddressZero` in token paths, not the wrapped address. The mapping is:
- Native (AVAX) → `ethers.constants.AddressZero`
- Wrapped (WAVAX) → actual token address
- Everything else → actual token address

The adapter (`fum_library/src/adapters/TraderJoeV2_2Adapter.js`) does this inline in swap path construction. A standalone helper with the same behavior lives at `fum_automation/test/helpers/traderjoe-swap-utils.js:getTokenAddressForTJ()` for test code; if a future refactor wants to share it, lift it into `fum_library/src/helpers/`.

## Fee Model: Auto-Compounding (V2.2)

LB V2.2 **auto-compounds** swap fees into bin reserves. There is no `pendingFees()`, no `collectFees()`, and no per-user fee tracking on the LBPair contract. The only fee function is `collectProtocolFees()` (for the protocol recipient, not LPs).

Users extract fees by burning LB tokens — they get their proportional share of reserves, which is principal + accumulated fees combined. There is no way to separate "fee tokens" from "principal tokens" on-chain at the LBPair level.

**V2.0 had a debt-based model** (`accTokenXPerShare`, `_cacheFees`, `pendingFees`) that was **removed in V2.1/V2.2**. The C4 audit at trust-security.xyz describes V2.0, not V2.2 — don't use it as a reference for fee behavior.

### Constant-Sum Separation

Each LB bin is a constant-sum market. The liquidity formula:

```
L = price × amountX + amountY
```

Key property: when a swap converts X→Y through a bin, X decreases and Y increases, but **L stays constant** (minus fees). Only fees increase L. Therefore:

```
feeL = currentL - previousL
```

This cleanly isolates fees from composition changes, regardless of how much X/Y ratio shifted.

### No Public Subgraph

LB V2.2 has **no public subgraph** for per-user fee data. The LFJ API (`api.lfj.dev`) requires an API key (application via Google form / Discord). The LiquidityHelperContract (see below) is the only dependency-free option.

## LiquidityHelperContract (LFJ Periphery)

Deployed by LFJ at `0xA5c68C9E55Dde3505e60c4B5eAe411e2977dfB35` on Avalanche. Uses the constant-sum formula to separate fees from composition changes. All functions are **view-only** (no gas for off-chain calls).

ABI is imported from `@traderjoe-xyz/sdk-v2` as `LiquidityHelperV2ABI`.

### Key Functions

**`getAmountsAndFeesEarnedOf(lbPair, user, ids[], previousX[], previousY[])`**
→ `(uint256[] amountsX, uint256[] amountsY, uint256[] feesX, uint256[] feesY)`

Used by: `generateAddLiquidityData()` to get `previousFeesX/Y` for fee-aware baseline calculation on addToPosition.

**`getLiquiditiesForAmounts(lbPair, ids[], amountsX[], amountsY[])`**
→ `(uint256[] liquidities)`

Converts stored X/Y baselines into liquidity values. Input to `getFeeSharesAndFeesEarnedOf`.

**`getFeeSharesAndFeesEarnedOf(lbPair, user, ids[], previousLiquidities[])`**
→ `(uint256[] feeShares, uint256[] feesX, uint256[] feesY)`

The main fee function. `feeShares` are the exact LB token amounts to burn per bin for fee collection. Two-step call pattern: `getLiquiditiesForAmounts` first, then this.

### ERC1155 Per-Position Isolation

A single address holding LB tokens from multiple positions gets a combined `balanceOf` — per-position fee attribution is impossible. We use EIP-1167 minimal proxies (one per position) so each proxy's `balanceOf` reflects only that position's tokens. The LiquidityHelperContract queries the proxy address as `user`.

## Position Creation vs. Uniswap

| | Uniswap V3 | Trader Joe V2.2 |
|---|---|---|
| Position token | ERC721 NFT | ERC1155 (multiple bin IDs) |
| Range | tickLower / tickUpper | lowerBinId / upperBinId |
| Liquidity | Single value | Per-bin array |
| Fee tracking | Built into protocol | Off-chain via LiquidityHelperContract + on-chain baselines (previousX/Y) |
| Position manager | NonfungiblePositionManager | TJPositionManager (custom, with per-position proxies) |

## Swap Events

TJ swap events are completely different from Uniswap:
```
Swap(address sender, address to, uint24 id, bytes32 amountsIn, bytes32 amountsOut, uint24 volatilityAccumulator, bytes32 totalFees, bytes32 protocolFees)
```
- Amounts are **packed bytes32**: upper 128 bits = tokenX amount, lower 128 bits = tokenY amount
- Emitted from LBPair contracts (one per pool, like Uniswap V3 — not singleton like V4)

## Through-Vault Position Creation

TJ positions **must be created through the vault contract** (`vault.mint()`), not via a direct signer transaction. TJPositionManager records `pos.vault = msg.sender` at creation time — if the signer creates the position directly, the signer becomes the owner, and the vault can never operate on it (all subsequent calls check `pos.vault == msg.sender`).

Test setup flow:
1. Transfer position tokens from owner to vault
2. Vault approves TJPositionManager (via `vault.approve()`)
3. Generate create position data with `walletAddress: vaultAddress`
4. Execute via `vault.mint([to], [data], [value])`

This differs from Uniswap V3/V4 where positions are ERC721 NFTs that can be transferred after creation. TJ's proxy-per-position architecture binds ownership at creation — there's no `safeTransferFrom` on TJPositionManager.

## Testing: Bin-Draining Price Manipulation

Used by `fum/test/scripts/manipulate-price-avalanche.js` — not project source code.

**Bin depletion mechanics**: Unlike V3 where swapping any amount moves the tick continuously, TJ bins hold discrete reserves. The active bin only shifts when one side is **fully drained**. Swapping 0.1% of a bin's reserve does nothing to the active bin — you must drain the entire X (or Y) side to shift it.

To move price up (increase tokenX price): drain X reserves from the active bin by buying X with Y. When X is depleted, active bin shifts up. To drain N bins, sum the X reserves across all N bins, convert to Y value using the bin price, and swap that total.

**Overshoot control**: After draining N bins, add 5% of the (N+1)th bin's reserve as overshoot to land solidly in it — using the actual landing bin's reserves prevents overshooting through low-liquidity bins.

**AUSD ERC-7201 storage**: AUSD token (`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`) uses ERC-7201 namespaced storage. Standard `hardhat_setStorageAt` slot discovery fails. Base slot: `0x455730fed596673e69db1907be2e521374ba893f1a04cc5f5dd931616cd6b700`. Balance is packed as `(uint248 balance << 8) | bool isFrozen`. Mapping key: `keccak256(abi.encode(uint256(address), baseSlot))`.

**Token balance storage slots** (Avalanche, for `hardhat_setStorageAt` minting):
- WAVAX (`0xB31f...`): slot 3
- USDC (`0xB97E...`): slot 9
- USDT (`0x9702...`): slot 51
- AUSD: ERC-7201 (see above)

## Gotcha Summary

1. Version 3 = V2.2 (counterintuitive naming)
2. Tokens are X/Y not 0/1 — X = lower address always
3. Bins not ticks — absolute bin IDs, not relative offsets
4. Paths are arrays — binSteps and versions are per-hop
5. Native tokens become AddressZero in paths
6. Per-bin tracking — fee baselines and liquidity are arrays, not single values
7. **`LBPair__ZeroAmount(uint24)`** — `LBPair.burn` reverts on *any* zero amount in the burn array (selector `0x6996a925`). A 21-bin position with fees in 1 bin has 20 zero feeShares — must filter to non-zero entries before calling `removeLiquidity`.
8. **Hardhat Avalanche fork** — `eth_call` against the fork block fails with "No known hardfork for execution on historical block". Fix: mine a local block with `evm_mine` after starting the node (or deploy contracts, which mines blocks). The `chains: { 43114: { hardforkHistory: { cancun: 0 } } }` config alone is not sufficient.
9. **Bin draining ≠ percentage swaps** — Swapping X% of a bin's reserves does NOT move the active bin by X%. The bin only shifts when one side is fully depleted. See "Testing: Bin-Draining Price Manipulation" above.
10. **Hardhat fork lazy-fetch dominates TJ position creation wall-clock time** — On a Hardhat Avalanche fork, creating a TJ position is ~1.3 seconds per bin of wall-clock time (e.g. ~80s for a 51-bin position) even though gas is only ~142k/bin. The bottleneck is Hardhat fetching cold ERC1155 bin storage slots from the upstream Alchemy node, one roundtrip per slot, on first touch. Subsequent operations on the same bins (collect fees, close) are flat at ~100ms regardless of bin count because the slots are cached locally. Confirmed via `fum_automation/test/workflow/traderjoe/gas-profiling.test.js`, which runs across 5/11/21/51-bin positions and prints both gas and wall-clock tables. This is fork-only — production Avalanche RPCs serve state from local DB without per-slot roundtrips.
