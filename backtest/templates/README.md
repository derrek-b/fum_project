# Swap Data Templates

Templates for creating initial swap data files for different platforms.

## Uniswap V3 (`uniswapV3-swaps.json`)

**Required fields:**
- `poolAddress` - The Uniswap V3 pool contract address
- `token0` / `token1` - Token symbols (alphabetically sorted)
- `fee` - Fee tier (100, 500, 3000, 10000)
- `startTimestamp` - Unix timestamp to start collecting from

**Example:**
```bash
cp backtest/templates/uniswapV3-swaps.json backtest/data/42161/uniswapV3/USDC-WETH-500/swaps.json
# Edit the file to fill in poolAddress and other details
```

## Uniswap V4 (`uniswapV4-swaps.json`)

**Required fields:**
- `poolId` - Hash of the poolKey (not an address)
- `currency0` / `currency1` - Currency symbols (can be native ETH)
- `fee` - Fee value (flexible, not fixed tiers)
- `tickSpacing` - Tick spacing for the pool
- `hooks` - Hooks contract address (0x0 if no hooks)
- `startTimestamp` - Unix timestamp to start collecting from

**Note:** V4 uses "currency" instead of "token" to support native ETH without wrapping.

**Example:**
```bash
cp backtest/templates/uniswapV4-swaps.json backtest/data/42161/uniswapV4/ETH-USDC-500/swaps.json
# Edit the file to fill in poolId and other details
```

---

## Platform-Specific Differences

### Identifiers
- **V3**: `poolAddress` (contract address)
- **V4**: `poolId` (hash of poolKey)

### Tokens vs Currencies
- **V3**: `token0` / `token1` (always ERC-20)
- **V4**: `currency0` / `currency1` (can be native ETH)

### Fee Structure
- **V3**: Fixed tiers (100, 500, 3000, 10000)
- **V4**: Flexible fees (any value), separate `tickSpacing` field

### V4-Specific Fields
- `tickSpacing` - Independent from fee
- `hooks` - Custom logic contract address
