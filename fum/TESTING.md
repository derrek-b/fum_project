# F.U.M. Integration Testing Guide

This document describes the full integration testing setup for the F.U.M. ecosystem, which coordinates sibling subprojects in the monorepo against a local blockchain fork.

> **Working directory.** All commands and paths in this guide assume you're at the monorepo root (`fum_project/`). When a step shows `cd fum`, that's interpreted from the root. See [Monorepo Conventions](../README.md#monorepo-conventions) for details.

## Overview

Full integration testing simulates the complete F.U.M. workflow:
1. A forked Arbitrum or Avalanche blockchain running locally via Hardhat
2. Deployed smart contracts (VaultFactory, PositionVault, strategies, validators, TJPositionManager/Proxy on Avalanche)
3. The automation service monitoring and managing positions
4. The frontend for user interaction

Three testable platforms: Uniswap V3 (Arbitrum), Uniswap V4 (Arbitrum), Trader Joe V2.2 (Avalanche).

A full integration session uses 5 terminals:

| Terminal | Working dir | Command(s) | Lifetime |
|---|---|---|---|
| 1 | `fum` | `npm run hardhat` (or `:av` for Avalanche) | long-running |
| 2 | `fum_library` | `npm run pack` (after each Hardhat restart) | one-shot |
| 3 | `fum_automation` | `npm run start` (or `:av` for Avalanche) | long-running |
| 4 | `fum` | `npm run dev` | long-running |
| 5 | `fum` | `npm run seed-localhost`, `manipulate-price:*`, `generate-fees*` | one-shot |

Terminals 1, 3, 4 must stay open. Terminal 2 is reused for `npm run pack` after every Hardhat restart (deployed addresses land in the fum_library source tree but consumers read from the installed tarball, so a repack is required to propagate). Terminal 5 is reused for the various one-shot test scripts (seed, price manipulation, fee generation).

## Prerequisites

### Monorepo Layout

All four subprojects live as siblings in the monorepo root (`fum_project/`):

```
fum_project/
├── fum/              # Frontend + Smart Contracts
├── fum_library/      # Shared utilities (must be built: `cd fum_library && npm run pack`)
├── fum_automation/   # Automation service
└── fum_testing/      # Contract unit tests
```

### Environment Setup

1. **Alchemy API Key** - Required for forking Arbitrum or Avalanche mainnet
2. **Node.js 22+** - Required for ES module JSON import syntax (`with { type: 'json' }`)
3. **MetaMask or another Ethereum wallet** - For frontend wallet interaction

### Environment Files

Each subproject ships an `.env.example` documenting every variable it consumes, with inline comments for what each one does and which are required vs. optional. Copy and fill in:

```bash
cp fum/.env.example fum/.env.local                       # Frontend
cp fum_automation/.env.example fum_automation/.env.local # Automation (Arbitrum)
```

For Avalanche (Trader Joe) integration testing, also create the chain-specific automation env file (consumed when launching via `npm run start:av`):

```bash
cp fum_automation/.env.example fum_automation/.env.local.av  # Automation (Avalanche)
```

`AUTOMATION_MNEMONIC` is a BIP-39 mnemonic — the automation service derives a per-vault signing key from it (path `m/44'/60'/0'/0/<executorIndex>`). **For local Hardhat testing, it must match the dev mnemonic hardcoded in the seed scripts** (`fum/test/scripts/seed*.js` — search for `DEV_MNEMONIC`), since the seed scripts derive the executor address from that mnemonic and register it via `vault.setExecutor(...)`. If the two don't match, automation's ownership-verification check during vault discovery sees that its derived address doesn't equal the vault's on-chain executor, logs `does not match — skipping`, and never manages the vault.

## Quick Start

### Step 1: Start Hardhat (Terminal 1)

This starts a local blockchain forked from Arbitrum or Avalanche mainnet, deploys the FUM contracts, and writes the deployed addresses into the `fum_library` source tree.

Pick the chain you're testing:

```bash
cd fum
npm run hardhat       # Arbitrum fork — chainId 1337, port 8545 (V3, V4, Merkl validators)
# OR
npm run hardhat:av    # Avalanche fork — chainId 1338, port 8546 (additionally deploys TJPositionProxy, TJPositionManager, TJ validators)
```

Hardhat will:
- Fork the upstream chain at a recent block
- Deploy VaultFactory, BabyStepsStrategy, and all relevant validators for the chosen chain
- Register validators with the VaultFactory
- Write deployed addresses into the `fum_library` source tree (`fum_library/src+dist/artifacts/contracts.js`)
- Output test account private keys

**Keep this terminal running.**

### Step 2: Pack fum_library so consumers see the new addresses (Terminal 2)

Step 1 wrote the new contract addresses into the `fum_library` *source tree*, but `fum` and `fum_automation` consume `fum_library` via an installed tarball under their `node_modules/`. Until that tarball is rebuilt and reinstalled, the consumers will keep using the previous run's addresses. **Skipping this step is the most common cause of "vault not found" / "wrong VaultFactory" errors after restarting Hardhat.**

```bash
cd fum_library
npm run pack
```

This rebuilds the tarball and reinstalls it into both sibling projects. Re-run it every time you restart Hardhat. (See `scripts-pipeline.md`'s "forgot to pack" warning for the failure modes.)

> **Optional but recommended between integration sessions**: vault addresses on Hardhat forks are deterministic (same factory, same nonce → same vault address on a fresh fork). If you don't reset, persisted automation state from a previous session — per-vault tracker logs, blacklist entries, tracking failures — may get re-associated with the same-address vaults you create now. To start with a clean slate:
>
> ```bash
> cd fum_automation
> npm run reset-data
> ```
>
> This wipes `data/vaults/` and resets `data/blacklist.json` + `data/trackingFailures.json` to empty. Skip if you want to keep prior state for debugging.

### Step 3: OPTIONAL - Seed Test Data (Terminal 5)

Create a test vault and configure it for automation:

```bash
cd fum
npm run seed-localhost              # V3: base vault + tokens + position on wallet
npm run seed-localhost:strategy     # V3: + strategy config
npm run seed-localhost:automation   # V3: + strategy config + position moved into vault + executor authorized (triggers automation)
# Same :strategy and :automation suffixes work for V4 (npm run seed-localhost:v4[...])
# and TJ Avalanche (npm run seed-localhost:av[...]; requires `npm run hardhat:av`)
```

See **[Seed Flag Variants](#seed-flag-variants)** below for what each flag does — where positions get minted, what the `:strategy` / `:automation` suffixes add, and the executor funding amounts that drain quickly enough to exercise the VaultHealth top-up flow.

### Step 4: Start Automation Service (Terminal 3)

```bash
cd fum_automation

# Recommended: start with WebSocket subscription diagnostics enabled.
# See "Known Issues" section for details — events are sometimes missed
# on first runs or after a network switch, and this flag makes it observable.
DEBUG_WS_EVENTS=true npm run start         # Arbitrum (uses .env.local)
# OR
DEBUG_WS_EVENTS=true npm run start:av      # Avalanche (uses .env.local.av)
```

The automation service will:
- Connect to the local Hardhat node
- Load existing connected vault configurations
- Start monitoring for vault blockchain events
- Expose SSE endpoint at `http://localhost:3001/events`

With `DEBUG_WS_EVENTS=true`, the service logs `🔬 [WS-DIAG]` lines for `eth_subscribe` requests/confirmations, raw `eth_subscription` events as they arrive, and a subscription-state dump 3s after startup. If you submit an on-chain transaction (executor authorization, strategy config change, swap) and **don't** see a corresponding `RAW subscription event received` line in the logs, see [Known Issues](#known-issues).

**Keep this terminal running.**

### Step 5: Start Frontend (Terminal 4)

```bash
cd fum
npm run dev
```

Open `http://localhost:3000` and connect MetaMask:

1. Add a custom network for the chain you're testing:

   **Arbitrum fork** (chain 1337 — V3, V4):
   - Network name: `Hardhat Local (Arbitrum)`
   - RPC URL: `http://localhost:8545`
   - Chain ID: `1337`
   - Currency symbol: `ETH`

   **Avalanche fork** (chain 1338 — Trader Joe V2.2):
   - Network name: `Hardhat Local (Avalanche)`
   - RPC URL: `http://localhost:8546`
   - Chain ID: `1338`
   - Currency symbol: `AVAX`

2. Import Account 0 using this private key:
   ```
   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```
   This account owns the test vault and has tokens for testing.


## Known Issues

### WebSocket events missed on first run or network switch

**Symptom**: `fum_automation` is connected to the Hardhat fork (transport-layer health is fine — no reconnect logs, no PingPongKeepalive failures), but on-chain events (`ExecutorChanged`, `TargetTokensSet`, swaps, etc.) don't reach the service. Frontend SSE stays silent. Strategy/automation logic doesn't fire after seeding.

**When it happens** — both triggers are **intermittent** (sometimes things just work):
- **Network switch**: switching the local Hardhat fork between Arbitrum (`npm run hardhat`, chain 1337) and Avalanche (`npm run hardhat:av`, chain 1338). Often the first session against the new chain misses events; sometimes back-to-back switches all work fine. No clean predictor.
- **First run after long idle**: observed especially on a fresh start in the morning when the integration terminals had been shut down overnight. No firm threshold.

**Workaround**: stop `fum_automation` (Ctrl+C in Terminal 3) and restart it after first missed event(s). Subscriptions get re-registered against the current Hardhat instance and events start flowing normally. Re-trigger whatever on-chain action was missed (e.g., re-save the strategy via the UI).

**How to confirm it's happening**: with `DEBUG_WS_EVENTS=true` already set in Step 4, save a strategy via the frontend UI (Step 5) — that fires `TargetPlatformsUpdated`, `TargetTokensUpdated`, and `TemplateSelected` (or `ParameterUpdated` + `CustomizationUpdated` for custom params), all of which `fum_automation` subscribes to. Watch the automation logs:
- ✅ Healthy: multiple `🔬 [WS-DIAG] RAW subscription event received` lines appear shortly after the save.
- ❌ Stuck: no `RAW subscription event received` lines despite the tx confirming on-chain. Restart the service and re-save the strategy.

**Observed mitigation that seems to dodge the issue**: running the seed script with the `:strategy` or `:automation` flag (e.g., `npm run seed-localhost:strategy` or `seed-localhost:av:strategy`) fires the strategy-related events from the seed signer, and the subscription pipe seems to stay healthy for subsequent events once it's received that first payload. Anecdotal — observed across consecutive arb↔av switches without recurrence — but a reasonable thing to try if you're hitting the issue and want to avoid restart cycles.

**Mitigations tried that didn't work:**
- Running base `seed-localhost` (no variant) as a "warmup" before starting strategy/executor configuration. Didn't help — base seed only does vault create + token transfer + position mint, none of which fire events `fum_automation` subscribes to, so it doesn't exercise the subscription pipe at all.

**Root cause**: unknown. Could be Hardhat WebSocket subscription state across resets, ethers.js v5 `WebSocketProvider` state on first connect after long idle, OS-level socket weirdness, or a race between `eth_subscribe` confirmation and the first inbound payload. Not investigated deeply because production chains (42161/43114) are protected by `SubscriptionCanary` (which is intentionally disabled on Hardhat — idle forks don't mine blocks, so the canary's block-arrival timeout would constantly false-positive).

## Vault Testing Scenarios

The seed scripts mint a default position on each platform. The script suite lets you push that position out of range (`manipulate-price`) or accumulate fees on it (`generate-fees`). The same scripts also support other token pairs via flags — each platform's "Other pools" table lists what's pre-configured.

> **To trigger rebalances if not using seed script**, configure a narrow strategy range via the frontend; default or wider settings can't be pushed out of range before exhausting fork liquidity.

### Uniswap V3 (Arbitrum, chain 1337)

Default pair: **WETH/USDC, fee tier 0.05%** (matches `seed.js`).

```bash
npm run manipulate-price:up        # WETH/USDC up (buy WETH)
npm run manipulate-price:down      # WETH/USDC down (sell WETH)
npm run generate-fees              # WETH/USDC fee accrual
```

Other pre-configured pools to be used with custom vault strategy configurations (V3 and V4 share `TOKENS` — same fee tiers):

| Token | V3 pool | Fee | Generate fees | Manipulate price |
|---|---|---|---|---|
| USDT | WETH/USDT | 0.05% | `npm run generate-fees:usdt` | `npm run manipulate-price:up -- --token=USDT` |
| WBTC | WETH/WBTC | 0.05% | `npm run generate-fees:wbtc` | `npm run manipulate-price:up -- --token=WBTC` |
| LINK | WETH/LINK | 0.30% | `npm run generate-fees:link` | `npm run manipulate-price:up -- --token=LINK` |

### Uniswap V4 (Arbitrum, chain 1337)

Default pair: **ETH/USDC (native ETH), fee tier 0.05%, tickSpacing 10** (matches `seed-v4.js`).

```bash
npm run manipulate-price:v4:up
npm run manipulate-price:v4:down
npm run generate-fees:v4
```

Other pre-configured pools (same `TOKENS` table as V3 — same fee tiers):

| Token | V4 pool | Fee | Generate fees | Manipulate price |
|---|---|---|---|---|
| USDT | ETH/USDT | 0.05% | `npm run generate-fees:v4 -- --token=USDT` | `npm run manipulate-price:v4:down -- --token=USDT` |
| WBTC | ETH/WBTC | 0.05% | `npm run generate-fees:v4 -- --token=WBTC` | `npm run manipulate-price:v4:down -- --token=WBTC` |
| LINK | ETH/LINK | 0.30% | `npm run generate-fees:v4 -- --token=LINK` | `npm run manipulate-price:v4:down -- --token=LINK` |

### Trader Joe V2.2 (Avalanche, chain 1338)

Requires `npm run hardhat:av` running (port 8546).

Default pair: **WAVAX/USDC, binStep=10** (matches `seed-avalanche.js`).

```bash
npm run manipulate-price:av:up
npm run manipulate-price:av:down
npm run generate-fees:av
```

Other pre-configured pools to be used with custom vault strategy configurations:

| Quote | Pool | binStep | Generate fees | Manipulate price |
|---|---|---|---|---|
| USDT | USDC/USDT | 1 | `npm run generate-fees:av -- --token=USDT` | `npm run manipulate-price:av:up -- --token=USDT` |
| AUSD | USDC/AUSD | 1 | `npm run generate-fees:av -- --token=AUSD` | `npm run manipulate-price:av:up -- --token=AUSD` |

### Movement mechanics per platform

Each `manipulate-price` run moves price by a fixed amount. Re-run multiple times to push the price outside the active position's range.

| Platform | Per-run movement | Knobs (in script `CONFIG`) | Seed position width | Runs to exit seed position |
|---|---|---|---|---|
| V3 | ~0.5% (5 swaps × 0.1%) | `TARGET_PRICE_MOVE`, `NUM_SWAPS` | ±1% (±10 tick spacings × tickSpacing 10) | ~2 |
| V4 | ~0.5% (5 swaps × 0.1%) | `TARGET_PRICE_MOVE`, `NUM_SWAPS` | ±1% (±10 tick spacings × tickSpacing 10) | ~2 |
| TJ | ~0.2% (2 bins × 0.1% binStep) | `NUM_BINS`, `OVERSHOOT_PCT` | ±1% (±10 bins × binStep 10) | ~5 |

V3/V4 re-quote `sqrtPriceX96` and `liquidity` after each swap, so the per-run total can drift slightly above or below 0.5%. TJ drains the active bins fully with a 5% overshoot to land solidly in the next bin, so each run moves price by exactly `NUM_BINS × binStep`.

### Fee generation mechanics per platform

Each `generate-fees` run executes N round-trip swaps (base → quote → base) through a pool, accumulating fees on the LP position in that pool. Per-leg amounts are fixed per script:

| Platform | Default per-leg | Pool overrides | Round-trips |
|---|---|---|---|
| V3 | 1 WETH | (uniform across V3 quote tokens) | 5; override via `-- --swaps=N` |
| V4 | 1 ETH (native) | (uniform; V4 shares V3 `TOKENS`) | 5; override via `-- --swaps=N` |
| TJ | 10 WAVAX (WAVAX/USDC) | 1000 USDC (USDC/USDT, USDC/AUSD) | 5; override via `-- --swaps=N` |

### What to Observe

1. **Frontend** — Position status updates via SSE
2. **Automation logs** — Rebalance triggers and execution
3. **Hardhat console** — Transaction confirmations

## Seed Flag Variants

The seed scripts (`fum/test/scripts/seed.js`, `seed-v4.js`, `seed-avalanche.js`) accept environment flags. The npm scripts wrap these with conventional suffixes:

| Suffix | Flags set | Effect |
|---|---|---|
| (none) | — | Create vault + fund wallet with tokens + transfer tokens to vault + mint a liquidity position **on the wallet** (for transfer-testing) + run round-trip swaps to generate fees on that position. Same flow on V3, V4, and TJ. |
| `:strategy` | `ENABLE_STRATEGY=1` | + set target platform/tokens on the vault + configure BabySteps Aggressive strategy. Targets per script (using the **native** symbol so the UI's strategy checkboxes match): V3 = `ETH` + `USDC` on `uniswapV3` (WETH/USDC pool); V4 = `ETH` + `USDC` on `uniswapV4`; TJ = `AVAX` + `USDC` on `traderjoeV2_2` (WAVAX/USDC pool). Automation is **not** activated yet. |
| `:automation` | `ENABLE_STRATEGY=1` + `ENABLE_AUTOMATION=1` | Implies `:strategy`, plus: the position minted on the wallet is `safeTransferFrom`'d into the vault, and the executor wallet is derived from `DEV_MNEMONIC` at the vault's `executorIndex` and authorized via `vault.setExecutor(executor, { value: EXECUTOR_FUNDING })`. The vault contract forwards `msg.value` straight to the executor address — that's what funds it. |

**Executor funding amounts (`:automation` only)** — sized so 1-3 rebalances drain the executor below `minExecutorBalance`, exercising the VaultHealth top-up flow during integration testing. Production gas math + thresholds: `docs/platform-knowledge/chain-gas-fees.md`.

| Script | `EXECUTOR_FUNDING` | minExecutorBalance |
|---|---|---|
| `seed.js` (V3) | 0.00205 ETH | 0.002 ETH |
| `seed-v4.js` (V4) | 0.00207 ETH | 0.002 ETH |
| `seed-avalanche.js` (TJ) | 0.0403 AVAX | 0.04 AVAX |

The executor is always authorized **last** in the seed flow to avoid race conditions where the automation service picks up a half-configured vault.

## Position Testing Scenarios

Manual position management can be tested independently of vault automation. These operations are available from the position detail page. (Create Position and Add Liquidity is disabled across the board in v2.0 pending a multi-platform AddLiquidityModal redesign — see docs/decisions/addLiquidityModal-redesign-refactor.md.)

> **Setup shortcut:** Step 4 (Start Automation Service) of the Quick Start can be skipped for manual position testing — the frontend reads positions and submits transactions directly via the wallet provider, so the automation service isn't on the call path. You still need Steps 1, 2, 3 (not optional for manual position management), and 5 (Hardhat fork + pack + seed + frontend) for the position to exist and the wallet to own it.

### Available Operations

| Operation | Description | How to Test |
|-----------|-------------|-------------|
| Remove Liquidity | Remove a percentage (1-100%) of liquidity, collect fees | Click "- Remove Liquidity", use slider |
| Claim Fees | Collect earned fees without affecting liquidity | Click "Claim Fees" |
| Close Position | Remove all liquidity, collect fees, optionally burn NFT | Click "Close Position" |

> **Note:** Positions held in a vault have manual operations disabled. They can only be managed through vault automation or by first removing the position from the vault.

### Testing Checklist

| Scenario | How to Test | Expected Result |
|----------|-------------|-----------------|
| Partial removal | Remove Liquidity → 50% | Half of liquidity withdrawn & fees collected |
| Fee collection | Generate fees, then Claim Fees | Fees transferred to wallet |
| Close position | Close Position → check burn NFT | Position removed, NFT burned, & fees collected |

## Troubleshooting

### Hardhat Issues

**"Nonce too high" errors:**
Reset MetaMask account (Settings > Advanced > Clear activity tab data)

**"Contract not deployed" errors:**
Hardhat may have restarted. Re-run `npm run seed-localhost`

### Library Issues

**"Module not found: fum_library":**
```bash
cd fum_library
npm run pack  # Rebuilds and reinstalls library to fum and fum_automation
```

**Addresses out of date after restarting Hardhat:** `npm run hardhat` and `npm run hardhat:av` write deployed addresses to `fum_library/src+dist/artifacts/contracts.js` (the fum_library source tree), but fum and fum_automation consume fum_library via the installed tarball in their respective `node_modules/`. The tarball is frozen until it's rebuilt and reinstalled. After every Hardhat restart, run:

```bash
cd fum_library
npm run pack   # rebuilds, packs, and reinstalls into fum and fum_automation
```

### Automation Connection Issues

**"SSE connection failed":**
- Verify automation is running on port 3001
- Check `NEXT_PUBLIC_SSE_URL` in fum/.env
- Verify no firewall blocking localhost ports

### Frontend State Issues

**Stale data after Hardhat restart:**
1. Delete .next directory in fum
2. Clear browser localStorage
3. Disconnect and reconnect wallet
4. Delete app connection from wallet and reconnect

## Directory Reference

| Path | Purpose |
|------|---------|
| `fum/test/scripts/start-hardhat.js` | Arbitrum-fork Hardhat startup + contract deployment |
| `fum/test/scripts/start-hardhat-avalanche.js` | Avalanche-fork Hardhat startup + contract deployment |
| `fum/test/scripts/seed.js` | V3 Arbitrum seeding (vault, tokens, position, fees) |
| `fum/test/scripts/seed-v4.js` | V4 Arbitrum seeding |
| `fum/test/scripts/seed-avalanche.js` | TJ Avalanche seeding |
| `fum/test/scripts/manipulate-price.js` | V3/V4 Arbitrum price manipulation |
| `fum/test/scripts/manipulate-price-avalanche.js` | TJ Avalanche price manipulation |
| `fum/test/scripts/generate-fees.js` | V3/V4 Arbitrum fee generation |
| `fum/test/scripts/generate-fees-avalanche.js` | TJ Avalanche fee generation |
| `fum/deployments/{chainId}-latest.json` | Deployed contract addresses per chain (1337, 1338, 42161) |
| `fum_library/dist/` | Built library modules |
| `fum_automation/data/` | Vault transaction & state cache |
