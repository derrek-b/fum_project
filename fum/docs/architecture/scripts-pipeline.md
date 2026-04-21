<!-- Source: scripts/deploy.js, scripts/sync-contracts-to-ecosystem.js, scripts/extract-abis.js, scripts/extract-bytecode.js, test/scripts/start-hardhat.js, test/scripts/start-hardhat-avalanche.js, test/scripts/seed.js, test/scripts/seed-v4.js, test/scripts/seed-avalanche.js, test/scripts/generate-fees.js, test/scripts/generate-fees-avalanche.js, test/scripts/manipulate-price.js, test/scripts/manipulate-price-avalanche.js -->
# Scripts Pipeline

How contracts move from source code in `fum/contracts/` through compilation, extraction, and deployment to reach all four subprojects. Reference this before modifying any script or debugging cross-project sync issues.

## Pipeline Overview

```
fum/contracts/ (source of truth)
  │
  ├── sync-contracts-to-ecosystem.js ──────────────────────────────────┐
  │     │                                                              │
  │     ├── Step 1: Copy .sol files ──▶ fum_testing/contracts/         │
  │     │                                    │                         │
  │     │                              Step 2: npx hardhat compile     │
  │     │                                    │                         │
  │     │                                    ▼                         │
  │     ├── Step 3: extract-bytecode.js ◀── fum_testing/artifacts/     │
  │     │     │                                                        │
  │     │     └──▶ fum/bytecode/*.bin                                  │
  │     │           │                                                  │
  │     │           ├── Step 5: Copy ──▶ fum_library/bytecode/         │
  │     │           └── Step 6: Copy ──▶ fum_automation/bytecode/      │
  │     │                                                              │
  │     └── Step 4: extract-abis.js (uses solc directly)               │
  │           └──▶ fum_library/src/artifacts/contracts.js               │
  │           └──▶ fum_library/dist/artifacts/contracts.js              │
  │                                                                    │
  └── deploy.js ──────────────────────────────────────────────────────┘
        ├──▶ fum/deployments/{chainId}-latest.json
        └──▶ fum_library/src+dist/artifacts/contracts.js (addresses)
```

---

## sync-contracts-to-ecosystem.js

**Source:** `scripts/sync-contracts-to-ecosystem.js`
**Command:** `npm run contracts:sync`

Master orchestrator. Distributes contracts from `fum/contracts/` to all sibling projects and runs the full extract pipeline.

### Contract Categories

**CORE_CONTRACTS** (synced to fum_testing, bytecode extracted):
- `BabyStepsStrategy`
- `VaultFactory`
- `PositionVault`
- `TJPositionManager`
- `TJPositionProxy`

**VALIDATOR_CONTRACTS** (synced to fum_testing, bytecode extracted):
- `UniversalRouterValidator`
- `UniswapV3PositionValidator`
- `UniswapV4PositionValidator`
- `TJPositionValidator`
- `TJSwapValidator`
- `MerklIncentiveValidator`

**TESTING_ONLY_CONTRACTS** (synced to fum_testing only, not extracted):
- `StrategyBase`
- `ParrisIslandStrategy`

**TESTING_SUBDIRECTORIES** (entire directories synced to fum_testing):
- `interfaces/`
- `validators/`

### 6-Step Pipeline

| Step | Action | Input | Output |
|---|---|---|---|
| 1 | Sync .sol files to fum_testing | `fum/contracts/` | `fum_testing/contracts/` |
| 2 | Compile in fum_testing | `fum_testing/contracts/` | `fum_testing/artifacts/` |
| 3 | Extract bytecode | `fum_testing/artifacts/` | `fum/bytecode/*.bin` |
| 4 | Extract ABIs (via solc) | `fum/contracts/` | `fum_library/src+dist/artifacts/contracts.js` |
| 5 | Distribute bytecode to library | `fum/bytecode/` | `fum_library/bytecode/` |
| 6 | Distribute bytecode to automation | `fum/bytecode/` | `fum_automation/bytecode/` |

### --sync-only Flag

`node scripts/sync-contracts-to-ecosystem.js --sync-only`

Executes only Step 1. Skips compilation, extraction, and distribution. Used by `contracts:test` and `contracts:test:coverage` — fum_testing handles its own compilation via `npx hardhat test`.

### Validation

Before running, validates all 3 sibling projects exist at expected relative paths (`../fum_testing`, `../fum_automation`, `../fum_library`). Exits with code 1 if any is missing.

---

## extract-abis.js

**Source:** `scripts/extract-abis.js`

Uses **solc directly** (not Hardhat) to compile contracts and extract ABIs. This allows ABI extraction without depending on fum_testing's Hardhat setup.

### Contract Name Mapping

```javascript
{
  'BabyStepsStrategy.sol': 'bob',           // ← Renamed in library!
  'PositionVault.sol': 'PositionVault',
  'VaultFactory.sol': 'VaultFactory',
  'TJPositionManager.sol': 'TJPositionManager',
  'TJPositionProxy.sol': 'TJPositionProxy',
  'validators/UniversalRouterValidator.sol': 'UniversalRouterValidator',
  'validators/UniswapV3PositionValidator.sol': 'UniswapV3PositionValidator',
  'validators/UniswapV4PositionValidator.sol': 'UniswapV4PositionValidator',
  'validators/TJPositionValidator.sol': 'TJPositionValidator',
  'validators/TJSwapValidator.sol': 'TJSwapValidator',
  'validators/MerklIncentiveValidator.sol': 'MerklIncentiveValidator'
}
```

**Critical:** `BabyStepsStrategy` is exported as `'bob'` in fum_library artifacts. This naming appears in extract-abis.js, deploy.js, and start-hardhat.js.

### Import Resolution

Custom `findImports(importPath)` resolver handles:

1. `@openzeppelin/contracts/...` → resolves from `fum/node_modules/@openzeppelin/contracts/`
2. Relative imports (`../interfaces/X.sol`) → tries `contracts/importPath`, then strips `../` and retries (handles imports from `validators/` subdirectory)

### Address Preservation

When updating ABIs, existing deployment addresses are preserved:

1. Read existing `fum_library/src/artifacts/contracts.js`
2. Parse existing contracts object via regex
3. Merge: new ABI + existing addresses
4. Write to both `src/` and `dist/`

```javascript
mergedContracts[name] = {
  abi: newAbi,
  addresses: existingContracts[name]?.addresses || {}
};
```

---

## extract-bytecode.js

**Source:** `scripts/extract-bytecode.js`

Reads compiled artifacts from fum_testing and outputs raw hex `.bin` files.

**Input:** `fum_testing/artifacts/contracts/{ContractName}.sol/{ContractName}.json`
**Output:** `fum/bytecode/{ContractName}.bin` (hex string, no `0x` prefix)

**Extracted contracts:** All CORE_CONTRACTS + VALIDATOR_CONTRACTS (11 total)

**Prerequisite:** fum_testing must be compiled first (Step 2 of the sync pipeline handles this).

---

## deploy.js

**Source:** `scripts/deploy.js`

Chain-agnostic deployment with automatic address tracking.

### Usage

```bash
node scripts/deploy.js --network=localhost                        # Deploy all to localhost
node scripts/deploy.js --network=arbitrum --contract=VaultFactory # Deploy one contract
node scripts/deploy.js --list                                     # List available contracts
```

### Available Contracts

Only 2 contracts are deployable via this script:
- `VaultFactory`
- `BabyStepsStrategy`

### Network → ChainId Mapping

| Network Name | ChainId |
|---|---|
| `localhost` | 1337 |
| `mainnet` / `ethereum` | 1 |
| `arbitrum` | 42161 |
| `polygon` | 137 |
| `optimism` | 10 |
| `base` | 8453 |

### Private Key Resolution

**Localhost (chainId 1337):** Hardcoded Hardhat account #0:
```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

**Other networks:**
1. `${NETWORK_UPPERCASE}_DEPLOYER_PK` env var (e.g., `ARBITRUM_DEPLOYER_PK`)
2. Falls back to `PRIVATE_KEY` env var
3. Throws if neither set

### VaultFactory Constructor

```javascript
factory.deploy(
  wallet.address,              // initialOwner
  permit2Address               // canonical: 0x000000000022D473030F116dDEE9F6B43aC78BA3
);
```

### Three Outputs

1. **Timestamped JSON:** `deployments/{chainId}-{ISO_TIMESTAMP}.json`
2. **Latest JSON:** `deployments/{chainId}-latest.json` (skipped for mainnet chainId=1)
3. **Library address update:** Writes to both `fum_library/src/artifacts/contracts.js` and `fum_library/dist/artifacts/contracts.js`

**Deployment JSON structure:**
```javascript
{
  "version": "0.2.1",
  "timestamp": "2025-02-16T10-30-45",
  "network": { "name": "localhost", "chainId": 1337 },
  "contracts": { "VaultFactory": "0x...", "BabyStepsStrategy": "0x..." },
  "deployer": "0x..."
}
```

### Library Name Mapping

```javascript
{ 'BabyStepsStrategy': 'bob', 'VaultFactory': 'VaultFactory', 'PositionVault': 'PositionVault' }
```

---

## Local Development Scripts

All located in `test/scripts/`.

### start-hardhat.js / start-hardhat-avalanche.js

**Commands:** `npm run hardhat` (Arbitrum) / `npm run hardhat:av` (Avalanche)

Spawns a Hardhat node with a mainnet fork, auto-deploys contracts, and updates fum_library addresses.

| | Arbitrum | Avalanche |
|---|---|---|
| Chain ID | 1337 | 1338 |
| Port | 8545 | 8546 |
| Config | `hardhat.config.cjs` | `hardhat-avalanche.config.cjs` |
| Extra contracts | V3 + V4 position validators, UniversalRouterValidator | TJPositionProxy, TJPositionManager, TJSwapValidator, TJPositionValidator |

**Sequence (both):**
1. Spawn `npx hardhat node --port {port}` (Cancun hardfork for V4 transient storage)
2. Wait for node ready
3. Deploy VaultFactory with canonical Permit2 address
4. Deploy BabyStepsStrategy (no constructor params)
5. Deploy platform-specific validators and register on VaultFactory
6. Update fum_library with localhost addresses (both src/ and dist/)
7. Save deployment to `deployments/{chainId}-latest.json`
8. Keep running (Ctrl+C to stop)

The Avalanche script additionally deploys TJPositionProxy (implementation) and TJPositionManager (with lbRouterAddress + proxy address), and updates `chains.js` with the deployed TJPositionManager address.

### Seed Scripts (per-platform)

Each platform has a single combined seed script that creates a vault, funds it, and optionally configures strategy/automation. The old separate `create-test-vault.js` + `seed.js` two-step flow was replaced to eliminate race conditions where `setExecutor` triggered the automation service before the vault was fully configured.

> `test/scripts/create-test-vault.js` and `test/scripts/create-test-vault-avalanche.js` still exist for direct invocation (`node test/scripts/create-test-vault.js ...`), but no npm script wraps them. Prefer the per-platform seed scripts below.

**Scripts:**
- `seed.js` — Uniswap V3 (WETH/USDC on chain 1337)
- `seed-v4.js` — Uniswap V4 (ETH/USDC on chain 1337)
- `seed-avalanche.js` — Trader Joe V2.2 (WAVAX/USDC on chain 1338)

**Env var flags:**

| Flag | Effect |
|---|---|
| (none) | Create vault, fund wallet with tokens, transfer tokens to vault |
| `ENABLE_STRATEGY=1` | + set target platform/tokens, configure BabySteps Aggressive strategy |
| `ENABLE_AUTOMATION=1` | Implies `ENABLE_STRATEGY=1`. + derive per-vault executor from mnemonic, call `setExecutor` (triggers automation service) |
| `ENABLE_POSITION=1` | (Avalanche only) Create TJ position in vault + generate fees |

**Execution order (designed to prevent race conditions):**
1. Create vault via VaultFactory
2. Fund wallet (wrap native, swap for stablecoins)
3. Transfer tokens to vault
4. Create position (V3/V4: always; TJ: only with `ENABLE_POSITION=1`)
5. Generate fees via round-trip swaps
6. Set strategy + targets (if `ENABLE_STRATEGY` or `ENABLE_AUTOMATION`)
7. Set executor (if `ENABLE_AUTOMATION`) — **always last**, fires on-chain event

For V3/V4, the position stays on the wallet by default (for transfer testing) and is only transferred to the vault when `ENABLE_AUTOMATION=1`. For TJ, positions are minted directly inside the vault via `vault.mint()`.

### generate-fees.js

**Command:** `npm run generate-fees [--platform=v3|v4] [--token=SYMBOL] [--swaps=N]`

Performs round-trip swaps to generate trading fees without net price movement. Supports V3 and V4 via `--platform` flag (default: v3). Uses `hardhat_setStorageAt` to mint tokens directly — no pool interaction for token acquisition.

**Default pair:** WETH/USDC (V3) or ETH/USDC (V4). With `--token`, targets WETH-paired pools (V3) or ETH-paired pools (V4):

| Token | V3 Pool | V4 Pool | Fee |
|---|---|---|---|
| (default) | WETH/USDC | ETH/USDC | 0.05% |
| USDT | WETH/USDT | ETH/USDT | 0.05% |
| WBTC | WETH/WBTC | ETH/WBTC | 0.05% |
| LINK | WETH/LINK | ETH/LINK | 0.30% |

**Execution pattern:** For each round-trip: swap 1 WETH → token, then token → WETH. Creates volume that accrues fees to LP positions.

**Convenience scripts:**
- `npm run generate-fees` — V3 WETH/USDC (default)
- `npm run generate-fees:usdt` — V3 WETH/USDT
- `npm run generate-fees:wbtc` — V3 WETH/WBTC
- `npm run generate-fees:link` — V3 WETH/LINK
- `npm run generate-fees:v4` — V4 ETH/USDC

### generate-fees-avalanche.js

**Command:** `npm run generate-fees:av [--token=USDT|AUSD] [--swaps=N]`

Performs round-trip swaps on Trader Joe V2.2 pools. Uses `hardhat_setStorageAt` to mint tokens (including AUSD via ERC-7201 namespaced storage).

**Default pair:** WAVAX/USDC (10 WAVAX per leg). With `--token`: USDC/USDT or USDC/AUSD (1000 USDC per leg).

### manipulate-price.js

**Command:** `npm run manipulate-price:<up|down> [--platform=v3|v4] [--token=SYMBOL]`

Moves pool price to push positions out of range for testing rebalancing. Computes swap amounts from pool liquidity (V3) or bin reserves (TJ) to move price ~0.1% per swap. Uses `hardhat_setStorageAt` to mint tokens.

**Default pair:** WETH/USDC (V3) or ETH/USDC (V4). Supports same `--token` options as generate-fees.

- **Up:** Buy WETH/ETH with quote token → pushes price up
- **Down:** Sell WETH/ETH for quote token → pushes price down

**Convenience scripts:**
- `npm run manipulate-price:up` / `npm run manipulate-price:down` — V3 WETH/USDC
- `npm run manipulate-price:v4:up` / `npm run manipulate-price:v4:down` — V4 ETH/USDC

### manipulate-price-avalanche.js

**Command:** `npm run manipulate-price:av:<up|down> [--token=USDT|AUSD]`

Moves Trader Joe V2.2 pool price by draining active bins. Each run drains 2 bins (~0.2% for binStep=10 WAVAX/USDC). Seed position range is ±10 bins, so ~5 runs pushes out of range.

**Default pair:** WAVAX/USDC (binStep=10). With `--token`: USDC/USDT or USDC/AUSD (binStep=1).

---

## Cross-Project Effects Summary

| Script | Reads From | Writes To |
|---|---|---|
| sync-contracts-to-ecosystem.js | `fum/contracts/` | `fum_testing/contracts/`, `fum_library/src+dist/artifacts/`, `fum_library/bytecode/`, `fum_automation/bytecode/`, `fum/bytecode/` |
| extract-abis.js | `fum/contracts/` (via solc) | `fum_library/src/artifacts/contracts.js`, `fum_library/dist/artifacts/contracts.js` |
| extract-bytecode.js | `fum_testing/artifacts/` | `fum/bytecode/` |
| deploy.js | `fum/bytecode/`, chain config | `fum/deployments/`, `fum_library/src+dist/artifacts/contracts.js` |
| start-hardhat.js | `fum/bytecode/`, fum_library artifacts | `fum/deployments/`, `fum_library/src+dist/artifacts/contracts.js` |
| start-hardhat-avalanche.js | `fum/bytecode/`, fum_library artifacts | `fum/deployments/`, `fum_library/src+dist/artifacts/contracts.js`, `fum_library/src+dist/configs/chains.js` |

**The "forgot to pack" problem:** deploy.js and start-hardhat.js write directly to `fum_library/dist/` for immediate effect, but fum and fum_automation consume fum_library via tarball. Changes won't propagate until `cd fum_library && npm run pack` is run.

---

## Key Gotchas

1. **Two separate compilations** — Hardhat compiles for bytecode extraction (Step 2–3), solc compiles for ABI extraction (Step 4). They can produce different results if compiler versions differ
2. **`--sync-only` skips everything after copy** — Used by `contracts:test` because fum_testing compiles on its own via `npx hardhat test`
3. **`BabyStepsStrategy` → `'bob'`** — The library artifact name differs from the contract name. Appears in extract-abis.js, deploy.js, and start-hardhat.js
4. **Address preservation** — extract-abis.js reads the existing contracts.js file and preserves addresses when updating ABIs. If the file is corrupted or missing, addresses are lost
5. **hardhat.config.cjs must be .cjs** — The fum package is ESM (`"type": "module"`), but Hardhat requires CommonJS config
6. **Alchemy key required** — Hardhat fork scripts require `ALCHEMY_API_KEY` in `.env.local` (Arbitrum fork on 8545, Avalanche fork on 8546)
7. **Direct dist/ writes don't propagate** — deploy.js writes to `fum_library/dist/` for immediate effect, but consumers use the tarball. Run `npm run pack` after deployment

---

## See Also

- [Contract System](./contract-system.md) — What these scripts build and deploy
- Root `CLAUDE.md` — Quick reference commands for running scripts
- fum_library `CLAUDE.md` — `npm run pack` workflow
