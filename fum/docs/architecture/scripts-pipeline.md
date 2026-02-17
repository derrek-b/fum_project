<!-- Source: scripts/deploy.js, scripts/sync-contracts-to-ecosystem.js, scripts/extract-abis.js, scripts/extract-bytecode.js, test/scripts/start-hardhat.js, test/scripts/create-test-vault.js, test/scripts/seed.js, test/scripts/generate-fees.js, test/scripts/manipulate-price.js -->
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

**Extracted contracts:** All CORE_CONTRACTS + VALIDATOR_CONTRACTS (10 total)

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

### start-hardhat.js

**Command:** `npm run hardhat`

Spawns a Hardhat node with Arbitrum mainnet fork, auto-deploys contracts, and updates fum_library addresses.

**Sequence:**
1. Spawn `npx hardhat node --port 8545` (Cancun hardfork for V4 transient storage)
2. Wait for node ready
3. Deploy VaultFactory with canonical Permit2 address
4. Deploy BabyStepsStrategy (no constructor params)
5. Update fum_library with localhost addresses (both src/ and dist/)
6. Save deployment to `deployments/1337-latest.json`
7. Keep running (Ctrl+C to stop)

### create-test-vault.js + seed.js

**Command:** `npm run seed-localhost` (runs both sequentially)

**create-test-vault.js:**
1. Read VaultFactory address from `deployments/1337-latest.json`
2. Call `vaultFactory.createVault("Test Vault " + timestamp)`
3. Wrap 5 ETH → WETH
4. Swap 2 WETH → USDC via Uniswap V3 (0.05% pool)
5. Transfer 3 WETH + 1000 USDC to vault

**seed.js:**
1. Wrap 45 ETH → WETH
2. Swap WETH for USDC, USDT, WBTC, LINK
3. Fund automation executor address with 10 ETH
4. Log final balances

### generate-fees.js

**Command:** `npm run generate-fees [--token=SYMBOL] [--swaps=N] [--fee=FEE_TIER]`

Performs round-trip swaps to generate trading fees on Uniswap V3 pools.

**Token configs:**

| Token | Pool Fee with USDC | Default Swap Amount |
|---|---|---|
| USDT | 100 (0.01%) | 250,000 USDC |
| WETH | 500 (0.05%) | 10,000 USDC |
| WBTC | 500 (0.05%) | 10,000 USDC |
| LINK | 3000 (0.3%) | 10,000 USDC |

**Execution pattern:** For each round-trip: swap USDC → Token, then Token → USDC. Creates volume that accrues fees to LP positions.

**Convenience scripts:**
- `npm run generate-fees:weth` — WETH/USDC
- `npm run generate-fees:wbtc` — WBTC/USDC
- `npm run generate-fees:link` — LINK/USDC

### manipulate-price.js

**Commands:** `npm run manipulate-price:up` / `npm run manipulate-price:down`

Shifts USDC/USDT pool price to trigger position rebalancing.

- **Up:** Buy USDC with USDT → pushes USDC price up
- **Down:** Sell USDC for USDT → pushes USDC price down

Configuration: 5 swaps of 30,000 tokens each, 500ms delay between swaps, USDC/USDT 0.01% pool.

---

## Cross-Project Effects Summary

| Script | Reads From | Writes To |
|---|---|---|
| sync-contracts-to-ecosystem.js | `fum/contracts/` | `fum_testing/contracts/`, `fum_library/src+dist/artifacts/`, `fum_library/bytecode/`, `fum_automation/bytecode/`, `fum/bytecode/` |
| extract-abis.js | `fum/contracts/` (via solc) | `fum_library/src/artifacts/contracts.js`, `fum_library/dist/artifacts/contracts.js` |
| extract-bytecode.js | `fum_testing/artifacts/` | `fum/bytecode/` |
| deploy.js | `fum/bytecode/`, chain config | `fum/deployments/`, `fum_library/src+dist/artifacts/contracts.js` |
| start-hardhat.js | `fum/bytecode/`, fum_library artifacts | `fum/deployments/`, `fum_library/src+dist/artifacts/contracts.js` |

**The "forgot to pack" problem:** deploy.js and start-hardhat.js write directly to `fum_library/dist/` for immediate effect, but fum and fum_automation consume fum_library via tarball. Changes won't propagate until `cd fum_library && npm run pack` is run.

---

## Key Gotchas

1. **Two separate compilations** — Hardhat compiles for bytecode extraction (Step 2–3), solc compiles for ABI extraction (Step 4). They can produce different results if compiler versions differ
2. **`--sync-only` skips everything after copy** — Used by `contracts:test` because fum_testing compiles on its own via `npx hardhat test`
3. **`BabyStepsStrategy` → `'bob'`** — The library artifact name differs from the contract name. Appears in extract-abis.js, deploy.js, and start-hardhat.js
4. **Address preservation** — extract-abis.js reads the existing contracts.js file and preserves addresses when updating ABIs. If the file is corrupted or missing, addresses are lost
5. **hardhat.config.cjs must be .cjs** — The fum package is ESM (`"type": "module"`), but Hardhat requires CommonJS config
6. **Alchemy key required** — All test scripts assume Arbitrum fork on port 8545, which requires `ALCHEMY_API_KEY` in environment
7. **Direct dist/ writes don't propagate** — deploy.js writes to `fum_library/dist/` for immediate effect, but consumers use the tarball. Run `npm run pack` after deployment

---

## See Also

- [Contract System](./contract-system.md) — What these scripts build and deploy
- Root `CLAUDE.md` — Quick reference commands for running scripts
- fum_library `CLAUDE.md` — `npm run pack` workflow
