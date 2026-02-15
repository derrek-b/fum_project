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

Native AVAX uses `AddressZero` in token paths, not the wrapped address. The helper `getTokenAddressForTJ()` handles this:
- Native (AVAX) → `ethers.constants.AddressZero`
- Wrapped (WAVAX) → actual token address
- Everything else → actual token address

## Fee Calculation (TJPositionManager)

Fees are represented as extra LB tokens beyond the principal deposited:
- **principalLb** = `originalShare * supply / reserve` (your proportion of the bin at deposit time)
- **feeLb** = `liquidityMinted - principalLb` (the growth since deposit)

### X-side / Y-side Fallback

The fee calculation tries X-side (reserveX) first. If that yields 0 fee tokens (which happens when fees accrued only on the Y token), it falls back to Y-side calculation. This is important for:
- One-sided bins (below active = Y-only, above active = X-only)
- Active bins where round-trip swaps generated fees asymmetrically on only one token

Previously this was an `else if` which meant Y-side fees in the active bin were missed when X-side had reserves but no fee growth. Fixed to try X first, then check Y if X gave zero.

## Position Creation vs. Uniswap

| | Uniswap V3 | Trader Joe V2.2 |
|---|---|---|
| Position token | ERC721 NFT | ERC1155 (multiple bin IDs) |
| Range | tickLower / tickUpper | lowerBinId / upperBinId |
| Liquidity | Single value | Per-bin array |
| Fee tracking | Built into protocol | Manual via originalShareX/Y baselines |
| Position manager | NonfungiblePositionManager | TJPositionManager (custom contract) |

## Swap Events

TJ swap events are completely different from Uniswap:
```
Swap(address sender, address to, uint24 id, bytes32 amountsIn, bytes32 amountsOut, uint24 volatilityAccumulator, bytes32 totalFees, bytes32 protocolFees)
```
- Amounts are **packed bytes32**: upper 128 bits = tokenX amount, lower 128 bits = tokenY amount
- Emitted from LBPair contracts (one per pool, like Uniswap V3 — not singleton like V4)

## Gotcha Summary

1. Version 3 = V2.2 (counterintuitive naming)
2. Tokens are X/Y not 0/1 — X = lower address always
3. Bins not ticks — absolute bin IDs, not relative offsets
4. Paths are arrays — binSteps and versions are per-hop
5. Native tokens become AddressZero in paths
6. Fee calculation has X→Y fallback — don't assume X-side always has fees
7. Per-bin tracking — fee baselines and liquidity are arrays, not single values
