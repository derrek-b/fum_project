# Uniswap Swap Events — V2, V3, V4

AlphaRouter can route through V2, V3, and V4 pools in a single transaction. Each version emits different swap events with different semantics.

## Event Signatures

| Version | Signature | Signed Amounts? |
|---------|-----------|-----------------|
| V2 | `Swap(address,uint256,uint256,uint256,uint256,address)` | No — unsigned (amount0In, amount1In, amount0Out, amount1Out) |
| V3 | `Swap(address,address,int256,int256,uint160,uint128,int24)` | Yes — signed (amount0, amount1) |
| V4 | `Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)` | Yes — signed (amount0, amount1) |

## Amount Conventions (critical — they differ!)

- **V2**: Unsigned. Only one of amount0In/amount1In is non-zero. Only one of amount0Out/amount1Out is non-zero.
- **V3**: Positive = pool received (user's input). Negative = pool sent (user's output).
- **V4**: Positive = user received (output). Negative = user sent (input). **Opposite of V3!**

## Emission Source

- **V2**: Emitted by the Pair contract (one per pool)
- **V3**: Emitted by the Pool contract (one per pool)
- **V4**: Emitted by the PoolManager contract (singleton — all V4 swaps emit from the same address)

## Implementation

Both UniswapV3Adapter and UniswapV4Adapter have cross-version parsing in `parseSwapReceipt()`. They scan for all three topic hashes, normalize via `_extractSwapAmounts()`, and match to metadata by logIndex order.
