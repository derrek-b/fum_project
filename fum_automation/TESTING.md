# FUM Automation Testing Guide

This document describes how to run tests for the FUM Automation Service.

> **Note:** For full ecosystem integration testing (frontend + automation + blockchain), see [fum/TESTING.md](../fum/TESTING.md).

## Overview

The test suite uses a **shared Hardhat instance** architecture for reliable, deterministic testing. A single Hardhat blockchain is started once before all tests, contracts are deployed once, and each test file reverts to a clean snapshot for isolation.

```
test/
├── global-setup.js          # Starts shared Hardhat, deploys contracts, takes snapshot
├── shared-state.js          # State sharing between globalSetup and tests
├── setup.js                 # Per-test setup (loads env, initializes fum_library)
├── helpers/
│   ├── hardhat-setup.js     # V3/general: connects to shared Hardhat, reverts to snapshot
│   ├── v4-hardhat-setup.js  # V4-specific Hardhat setup (hardcoded chainId, different SSE port)
│   ├── swap-utils.js        # V3 swap simulation helpers
│   ├── v4-swap-utils.js     # V4 swap simulation helpers
│   ├── traderjoe-swap-utils.js  # Trader Joe swap simulation helpers
│   ├── test-vault-setup.js  # V3 vault creation and position setup
│   ├── v4-vault-setup.js    # V4 vault creation and position setup
│   ├── traderjoe-vault-setup.js  # Trader Joe vault creation and position setup
│   ├── executor-utils.js    # Executor funding and gas utilities
│   ├── tracker-assertions.js  # Transaction history assertion helpers
│   └── wait-utils.js        # Async event and timing wait helpers
├── unit/                    # Fast, isolated unit tests
│   ├── BlacklistManager.test.js
│   ├── EventManager.test.js
│   ├── RetryHelper.test.js
│   ├── ServiceHealth.test.js
│   ├── Tracker.test.js
│   ├── VaultDataService.test.js
│   ├── VaultHealth.test.js
│   ├── errors.test.js
│   └── patchProviderFeeData.test.js
└── workflow/                # Integration tests with real blockchain
    ├── config-update/       # Strategy parameter change handling
    ├── error-handling/      # Recovery, failure, and edge case scenarios
    ├── executor-funding/    # Executor gas top-up workflows
    ├── service-init/        # Service initialization and vault setup flows
    ├── service-stop/        # Graceful shutdown tests
    ├── swap-event/          # Swap detection and rebalancing
    ├── traderjoe/           # Trader Joe V2.2 workflows (FORK_CHAIN=avalanche)
    │   ├── execution/
    │   ├── service-init/
    │   └── gas-profiling.test.js
    ├── v4/                  # Uniswap V4 workflows
    │   ├── error-handling/
    │   ├── execution/
    │   ├── service-init/
    │   └── gas-profiling.test.js
    ├── vault-auth/          # Vault authorization grant + revoke
    ├── vault-setup/         # Vault initialization edge cases
    └── v3-gas-profiling.test.js  # V3 gas usage benchmarks
```

## Test Architecture

### Shared Hardhat Instance

Unlike traditional test setups where each test file spawns its own blockchain, we use a shared instance:

```
┌──────────────────────────────────────────────────────────┐
│                    globalSetup.js                        │
│  1. Start Hardhat (Arb: port 8545; Av: 8546)             │
│  2. Deploy FUM contracts ONCE                            │
│  3. Take BASE_SNAPSHOT (contracts deployed, no vaults)   │
│  4. Save state to .hardhat-state.json                    │
└──────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Test File A     │  │ Test File B     │  │ Test File C     │
│ Revert to BASE  │  │ Revert to BASE  │  │ Revert to BASE  │
│ Setup vault     │  │ Setup vault     │  │ Setup vault     │
│ Run tests       │  │ Run tests       │  │ Run tests       │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                             ↓
┌──────────────────────────────────────────────────────────┐
│                   globalTeardown                         │
│  1. Stop Hardhat                                         │
│  2. Clean up state file                                  │
└──────────────────────────────────────────────────────────┘
```

**Benefits:**
- **Consistent addresses** - Contracts deployed once, addresses never drift
- **Faster tests** - No Hardhat startup or contract deployment per file
- **No race conditions** - contracts.js updated once in globalSetup
- **Clean isolation** - Snapshots ensure each test file starts fresh

## Prerequisites

### Environment Variables

Tests only need API keys from `.env.local`. All other config (chainId, wsUrl, ports, etc.) is hardcoded in the test helpers.

| Variable | When required |
|---|---|
| `ALCHEMY_API_KEY` | Always — Hardhat config uses Alchemy as the upstream URL the local fork forks from (both Arbitrum and Avalanche) |
| `COINGECKO_API_KEY` | Always — `fum_library`'s coingecko service throws on missing key |
| `THEGRAPH_API_KEY` | V4 workflow tests only — `UniswapV4Adapter` uses The Graph for pool discovery |

> **Note:** Other `.env.local` variables (`CHAIN_ID`, `WS_URL`, `AUTOMATION_MNEMONIC`, etc.) are for running the service against an actual chain or in full-stack integration tests, not for unit or workflow tests run from this project. `BLOCK_EXPLORER_API_KEY` can also be left blank: V4 native-ETH fee tracking queries real Arbiscan, but fork txs aren't indexed there, so it returns empty regardless of key — the ETH fee math is covered in `fum_library` by unit tests with mocked fetch responses plus a real-mainnet integration test that hits Arbiscan against a captured historical tx.

## Running Tests

Tests are **chain-scoped**: each `vitest run` invocation hosts a single Hardhat fork, so V3/V4 (Arbitrum) and Trader Joe (Avalanche) workflow tests cannot share a run. Use the per-chain scripts below.

| Command | Scope | Fork |
|---|---|---|
| `npm test` | Unit tests | none |
| `npm run test:v3` | Uniswap V3 workflows | Arbitrum |
| `npm run test:v4` | Uniswap V4 workflows | Arbitrum |
| `npm run test:arb <path>` | A specific V3 or V4 workflow file | Arbitrum |
| `npm run test:tj` | Trader Joe V2.2 workflows | Avalanche |
| `npm run test:av <path>` | A specific TJ workflow file | Avalanche |

> **`test:arb` and `test:av` require a path argument.** Without one, vitest will run every file under the same fork (e.g. `npm run test:arb` with no path tries to run the TJ suite on Arbitrum and fails).

To run the full suite locally, run `test:v3`, `test:v4`, and `test:tj` in sequence — there is intentionally no single command that runs everything, because no single Hardhat fork can serve both chains.

### Unit Tests

`npm test` runs `vitest run test/unit`. Unit tests are fast (~2-3 seconds) and don't require a blockchain connection. They cover:
- Core services: EventManager, VaultDataService, Tracker, VaultHealth, ServiceHealth
- Utilities: RetryHelper, errors, patchProviderFeeData
- BlacklistManager

### Workflow Tests

Workflow tests connect to a shared Hardhat fork (Arbitrum or Avalanche depending on `FORK_CHAIN`), revert to a clean state, and exercise real scenarios (~15-180 seconds each). Always run them through the chain-scoped commands above so the right fork is active.

To run a specific workflow file, use `test:arb` for V3/V4 or `test:av` for Trader Joe:

```bash
npm run test:arb test/workflow/service-init/BS-0000.test.js
npm run test:av test/workflow/traderjoe/service-init/basic-init.test.js
```

### Watch Mode

There is no `npm run test:watch` script — watch mode is invoked directly via `vitest`, scoped to a directory compatible with a single fork:

```bash
npx vitest test/unit                                        # unit tests, no fork
npx vitest test/workflow/v4                                 # V4 watch (Arbitrum fork)
FORK_CHAIN=avalanche npx vitest test/workflow/traderjoe     # TJ watch (Avalanche fork)
```

### Coverage

Line coverage is intentionally not the headline test metric for this codebase, and `test:coverage` and `test:watch` scripts have been removed from `package.json`. Two reasons:

1. **Single-fork constraint.** A single `vitest run` invocation hosts one Hardhat fork at a time, so V3/V4 (Arbitrum) and Trader Joe (Avalanche) workflow tests cannot share a coverage run. Any number from a bare `vitest run --coverage` would always include false-positive failures on the wrong-fork suite.
2. **Wrong metric for orchestration code.** Even at 100% line coverage, line metrics don't tell you whether the *scenarios* are tested — e.g., "vault unlocks with both a queued config update AND a queued offboard, applied in the right order, with the lock re-acquired before cleanup." Most of `src/core/` and `src/strategies/` is exercised through workflow tests that map to scenarios, not lines.

If you need a one-off line-coverage snapshot of the unit tests (unaffected by the fork constraint), run:

```bash
npx vitest run test/unit --coverage
```

Treat the result as a sanity backstop, not a target. Scenario coverage is the model for this codebase; until a formal scenario matrix is in place, it lives implicitly in the test-file naming (`BS-XXXX` codes) and the directory structure under `test/workflow/`.

## Test Naming Convention

Service-init workflow tests follow a naming pattern that encodes the vault's initial state:

```
BS-XYZW.test.js
```

Where:
- **BS** = Baby Steps strategy
- **XYZW** = 4-digit configuration code

### Configuration Code (XYZW)

Each digit represents a count:

| Position | Meaning |
|----------|---------|
| X (1st) | Positions aligned with strategy targets |
| Y (2nd) | Non-aligned positions |
| Z (3rd) | Aligned tokens (non-position balances) |
| W (4th) | Non-aligned tokens (non-position balances) |

### Examples

| Test Name | Meaning |
|-----------|---------|
| `BS-0000` | No positions, no tokens — empty vault initialization |
| `BS-0010` | 0 aligned pos, 0 non-aligned pos, 1 aligned token, 0 non-aligned |
| `BS-0012` | 0 positions, 1 aligned token, 2 non-aligned tokens |
| `BS-0100` | 1 non-aligned position, no tokens |
| `BS-1000` | 1 aligned position, no extra tokens |
| `BS-1212` | 1 aligned pos, 2 non-aligned pos, 1 aligned token, 2 non-aligned |

Additional test files: `basic-init.test.js` (basic startup), `init-errors.test.js` (error handling during init), `BS-0012-phase2.test.js` (phase 2 token preparation).

### Aligned vs Non-Aligned

- **Aligned position**: Position tokens match the vault's target tokens and target platform
- **Non-aligned position**: Position tokens don't match targets (will be closed)
- **Aligned token**: Token in vault matches a target token
- **Non-aligned token**: Token in vault doesn't match targets (will be swapped)

## Troubleshooting

### "Alchemy API key not configured"

Ensure `ALCHEMY_API_KEY` is set in `.env.local`. Workflow tests need it because `hardhat.config.cjs` uses Alchemy as the upstream URL the Hardhat fork node forks from. The AlphaRouter itself routes against the local fork's on-chain state, not Alchemy.

### "Shared Hardhat state not found"

This error means `globalSetup.js` didn't run. Ensure:
- `vitest.config.js` has `globalSetup: './test/global-setup.js'`
- No previous test run left stale state (delete `test/.hardhat-state.json` and retry)

### Timeout errors

Workflow tests have extended timeouts (30-180 seconds) because two fork-specific overheads dominate wall-clock time:

- **V3/V4 swaps via AlphaRouter** — On chainId 1337 the AlphaRouter can't reach Uniswap's subgraph, so it discovers pools by reading the forked chain on-chain (`StaticV3SubgraphProvider`) and gas-prices via `StaticGasPriceProvider`. EXACT_OUTPUT quotes that would resolve from subgraph data in production fan out into many on-chain calls on the fork. See `fum_library/docs/architecture/adapters.md` for the full config.
- **TJ position creation** — Hardhat lazy-fetches state slot-by-slot from the upstream Alchemy node on first read. A TJ position spans many ERC1155 bin storage slots (~21 bins typical, up to 51), so `mintWithSwap` blocks on a roundtrip per cold slot. Profiled at ~1.3 seconds per bin on first touch (~80s for a 51-bin position); subsequent operations on the same bins are ~600x faster once warm. See `docs/platform-knowledge/trader-joe-v2-2.md` gotcha #10. Run `FORK_CHAIN=avalanche npx vitest run test/workflow/traderjoe/gas-profiling.test.js` to see the wall-clock-vs-bin-count curve.

If tests still timeout beyond those expected costs:
- Check network connectivity (Alchemy RPC)
- Increase timeout in vitest.config.js
- Check if Hardhat is hanging (look for zombie processes on port 8545)

### Stale contract data

If tests fail with contract-related errors after code changes:
```bash
cd ../fum_library
npm run pack  # Rebuilds and reinstalls library to fum and fum_automation
```

### WebSocket connection errors

The shared Hardhat instance uses WebSocket connections. If you see connection errors:
- Ensure no other process is using port 8545
- Check that `cleanupTestBlockchain()` is called in `afterAll`
- The cleanup only closes WebSocket connections, not the shared Hardhat instance

### Tests pass individually but fail together

This is rare with the shared Hardhat architecture, but if it happens:
- Check that tests properly clean up after themselves
- Ensure `afterAll` blocks call `service.stop()` and `cleanupTestBlockchain()`
- Each test file reverts to the base snapshot, so state shouldn't leak
