# Backtesting Framework

Tools for collecting historical swap data and backtesting FUM automation strategies.

## Current Status

**Implemented:**
- ✅ Uniswap V3 swap data collector using TheGraph
- ✅ Token price data collector using CoinGecko

**Not Yet Implemented:**
- ⏳ Backtest runner
- ⏳ Performance analysis

---

## Collecting Swap Data

### Setup

1. Make sure `THEGRAPH_API_KEY` is set in `.env.local`
2. Create the initial swaps file with pool address and start block

### Running the Collector

**Default (5 runs):**
```bash
npm run collect:events:weth-usdc
```

**Custom number of runs:**
```bash
npm run collect:events:weth-usdc -- --runs 10
```

### How It Works

1. Reads existing `swaps.json` file to get pool address and last collected timestamp
2. Queries TheGraph for up to 1000 swaps after that timestamp
3. Filters out duplicates (by `transactionHash + logIndex`)
4. Appends new swaps to the file
5. Repeats for the specified number of runs (default: 5)
6. Stops early if caught up to current time (within 24 hours)

### Data Structure

Collected data is stored in:
```
backtest/data/{chainId}/{platform}/{token0}-{token1}-{fee}/swaps.json
```

**Example:**
```
backtest/data/42161/uniswapV3/USDC-WETH-500/swaps.json
```

**File format:**
```json
{
  "metadata": {
    "poolAddress": "0xC6962004f452bE9203591991D15f6b388e09E8D0",
    "platform": "uniswapV3",
    "chainId": 42161,
    "token0": "USDC",
    "token1": "WETH",
    "fee": 500,
    "startBlock": 416593974,
    "endBlock": 416918227,
    "startTimestamp": 1767225600,
    "endTimestamp": 1767306663,
    "totalSwaps": 4996,
    "collectedAt": "2026-01-24T..."
  },
  "swaps": [
    {
      "blockNumber": 416593974,
      "timestamp": 1767225600,
      "transactionHash": "0x...",
      "logIndex": 45,
      "token0": "USDC",
      "token1": "WETH",
      "amount0": "-1000000",
      "amount1": "500000000000000"
    }
    // ... more swaps
  ]
}
```

### Creating New Data Collections

To collect data for a different pool:

1. **Copy the appropriate template:**
   ```bash
   mkdir -p backtest/data/42161/uniswapV3/TOKEN0-TOKEN1-FEE
   cp backtest/templates/uniswapV3-swaps.json backtest/data/42161/uniswapV3/TOKEN0-TOKEN1-FEE/swaps.json
   ```

2. **Edit the file to fill in pool details:**
   - `poolAddress` - The pool contract address
   - `token0` / `token1` - Token symbols
   - `fee` - Fee tier
   - `startTimestamp` - Unix timestamp to start from

3. **Add npm script to `package.json`:**
   ```json
   "collect:events:token0-token1": "node backtest/collectors/collect-v3-events.js --chain 42161 --tokens TOKEN0 TOKEN1 --fee 500"
   ```

4. **Run the collector:**
   ```bash
   npm run collect:events:token0-token1
   ```

**Note:** See `backtest/templates/README.md` for platform-specific template details.

---

## Collecting Price Data

### Setup

1. Make sure `COINGECKO_API_KEY` is set in `.env.local`

### Running the Price Collector

**Collect ETH prices:**
```bash
npm run collect:prices:eth
```

**Collect USDC prices:**
```bash
npm run collect:prices:usdc
```

### How It Works

1. Loads existing `backtest/data/prices/{TOKEN}.json` (or creates new)
2. Gets last collected timestamp (or starts from Jan 1, 2026)
3. Fetches hourly prices from CoinGecko for up to 90 days
4. Filters out duplicate timestamps
5. Merges into prices object (keyed by timestamp)
6. Updates metadata and saves file

**Note:** CoinGecko returns hourly prices for 1-90 day ranges. If collecting >90 days of data, run the script multiple times.

### Data Structure

Price data is stored centrally (not per-chain):
```
backtest/data/prices/{TOKEN}.json
```

**Example:**
```
backtest/data/prices/ETH.json
backtest/data/prices/USDC.json
```

**File format:**
```json
{
  "token": "ETH",
  "coingeckoId": "ethereum",
  "startTimestamp": 1767225600,
  "endTimestamp": 1775001600,
  "priceCount": 2160,
  "collectedAt": "2026-01-24T...",
  "prices": {
    "1767225600": 3456.78,
    "1767229200": 3457.12,
    "1767232800": 3458.45
  }
}
```

**Note:** Prices are keyed by UNIX timestamp (seconds) for hourly intervals. During backtesting, round swap timestamps to the nearest hour to lookup prices.

---

## Directory Structure

```
backtest/
├── README.md                    # This file
├── collectors/                  # Data collection scripts
│   ├── collect-v3-events.js    # Uniswap V3 event collector (swaps, mints, burns)
│   ├── collect-v3-swaps.js    # Uniswap V3 swap collector (legacy)
│   └── collect-prices.js       # Token price collector
├── templates/                   # Templates for creating swap data files
│   ├── README.md               # Platform-specific template docs
│   ├── uniswapV3-swaps.json    # Uniswap V3 template
│   └── uniswapV4-swaps.json    # Uniswap V4 template
├── data/                        # Collected historical data (gitignored)
│   ├── prices/                 # Centralized USD price data
│   │   ├── ETH.json
│   │   └── USDC.json
│   └── 42161/
│       └── uniswapV3/
│           └── USDC-WETH-500/
│               └── swaps.json
├── reports/                     # Generated reports (gitignored)
├── providers/                   # (empty - for future use)
├── runners/                     # (empty - for future use)
└── analyzers/                   # (empty - for future use)
```

---

## Next Steps

1. **Backtest Runner** - Replay swap events and simulate strategy decisions
2. **Performance Analysis** - Compare strategy performance vs holding
