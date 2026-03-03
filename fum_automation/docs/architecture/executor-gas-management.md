<!-- Source: src/core/VaultHealth.js, src/core/AutomationService.js, src/strategies/base/StrategyBase.js -->
# Executor Gas Management

## Overview

VaultHealth (`src/core/VaultHealth.js`) monitors per-vault executor balances and coordinates automated gas top-ups. Each vault's executor is an HD-derived EOA that needs native tokens for gas. VaultHealth ensures executors stay funded by coordinating with strategies via a holdback system and executing top-ups when vault funds are available.

VaultHealth follows AutomationService's lifecycle pattern (`start`/`stop`) and EventManager's dependency injection pattern (`setX` methods).

## Holdback System

When an executor's balance drops below `minExecutorBalance` (per-chain config), VaultHealth calculates a holdback amount in USD:

```
holdbackAmount = (maxExecutorBalance - currentBalance) × nativeTokenPrice
```

The holdback is stored per vault. Strategies read it via `getHoldback(vaultAddress)` and subtract it from deployable capital when sizing positions. The strategy doesn't know or care what the holdback is for — it just deploys less.

**setHoldback** — Sets the holdback for a vault. Uses CoinGecko for USD conversion (the holdback must be in USD because strategies compare it against position value in USD).

**clearHoldback** — Clears the holdback after a successful top-up.

**getHoldback** — Returns the current holdback amount in USD for strategy consumption. Returns 0 if no holdback is set.

**Strategy integration** — `calculateAvailableDeployment` in StrategyBase subtracts the holdback from `tokenValue` before comparing against `minDeployment`. This means the holdback reduces the position size rather than preventing deployment entirely (unless the remaining capital is below `minDeployment`).

**Service restart** — In-memory holdback state is lost on crash. VaultHealth recalculates from scratch on startup by checking all executor balances during `loadAuthorizedVaults`, setting holdbacks as needed before strategies execute.

## Top-Up Funding Paths

When VaultHealth acquires the vault lock and executes a top-up, it tries three paths in priority order. The target amount is `maxExecutorBalance - currentBalance`.

**Path 0: Native balance in vault** — If the vault holds native ETH/AVAX, call `vault.fundExecutor(amount)` directly. Cheapest path — no swap, no unwrap.

**Path 1: Unwrap wrapped native** — If the vault holds WETH/WAVAX, unwrap it to native, then fund the executor. A 25% deficit threshold gate applies: skip this path if the wrapped native balance covers less than 25% of the remaining deficit. This prevents tiny unwrap operations when the wrapped balance is negligible.

**Pre-gate** — Before attempting the ERC20 swap path (Path 2), check if the remaining deficit after Path 0 and Path 1 is less than 25% of the original top-up target. If so, skip — the executor is close enough to `maxExecutorBalance` that the gas cost of an ERC20 swap isn't justified.

**Path 2: ERC20 swap** — For vaults holding only ERC20s (e.g., stablecoin strategies), swap a small amount to native gas token via platform adapter swap infrastructure.

- Uses `adapter.getBestSwapQuote()` with EXACT_OUTPUT to determine the precise input amount needed — only swaps what's required, not the full token balance
- Tokens whose balance < 25% of the required input are skipped (dust gate via quoter, no CoinGecko/USD estimation needed for this gate)
- Adapters are tried in `vault.targetPlatforms` order — if an adapter can't route the pair, the next is tried
- Quote and swap always use the same adapter (no double-quote race)

**Token selection priority** — Path 0 and 1 are attempted first because they're cheaper (no swap fees). Path 2 selects the token with the best swap quote, not the largest balance.

## Event-Driven Triggers

VaultHealth uses two complementary trigger mechanisms:

**Interval-based** — Checks all managed vault executor balances every `balanceCheckIntervalMs` (default 5 minutes). Recalculates holdbacks each cycle — overwrites previous holdback with fresh `maxBalance - currentBalance`. Clears holdback when executor balance recovers above `minBalance`. This is the fallback that catches cases where executor gets low between operations or where no rebalance has happened recently.

**Event-driven** — Subscribes to two EventManager events:

- `VaultUnlocked` — Fires after any vault lock release (AutomationService deletes lock, then emits event). When a vault with an outstanding holdback completes processing, VaultHealth acquires the lock and attempts a top-up. No delay needed — the event fires after the lock is already released.
- `VaultSetupComplete` — Fires after initial vault setup. If a newly discovered vault's executor needs funding, VaultHealth acts immediately rather than waiting for the next interval.

The `pendingTopUp` flag per vault prevents duplicate top-up attempts when both triggers fire for the same vault.

## Funding-Required State

When an executor runs completely out of gas before VaultHealth can top it up, transaction submissions fail with an insufficient funds error. This triggers a distinct handling path:

**Detection** — `executeBatchTransactions` in StrategyBase uses `isInsufficientFundsError(error)` to detect the condition and wraps the error in `InsufficientGasError`. This helper checks both `error.code === 'INSUFFICIENT_FUNDS'` (Geth/production) and a message substring match (Hardhat uses a different error format that ethers.js v5 wraps as `SERVER_ERROR`). See `utils/errors.js`.

**Lockdown** — AutomationService calls `vaultHealth.enterFundingRequired(vaultAddress)`. The vault is locked from processing. VaultHealth emits `ExecutorFundingRequired` for SSE/alerts (e.g., Telegram notifications).

**Recovery** — VaultHealth subscribes to an on-chain `ExecutorFunded` event on the vault contract. When the user manually funds the executor (via the frontend's "Fund Executor" button), or VaultHealth's own top-up succeeds, the lock is released and the vault resumes normal processing.

**Why insufficient funds always means gas** — Executors are EOAs that never send value. All vault functions (`swap`, `mint`, `liquidity`, `incentive`) are non-payable from the caller's perspective. The `values[]` arrays in these functions control how much of the vault's own ETH to forward to targets (e.g., V4 native ETH pools), not the executor's ETH.

## Dependency Injection

VaultHealth receives its dependencies via setter methods, following EventManager's pattern:

- `setProvider(provider)` — Stores provider reference, resubscribes on-chain listeners. Called at initialization and on provider reconnection.
- `setHdNode(hdNode)` — Cached HDNode for deriving executor addresses (same derivation path as `StrategyBase.getVaultSigner`).
- `setVaultDataService(vds)` — Access to vault cache for token balances, target platforms, contract references.
- `setTokens(tokens)` — Token metadata for native/wrapped-native identification and swap routing.
- `setAdapters(adapters)` — Platform adapter Map for ERC20-to-native swaps in Path 2. `getAdaptersForVault` throws if no target platforms resolve to adapters.
- `setLockFunctions({ lockVault, unlockVault })` — Vault lock acquisition from AutomationService. VaultHealth acquires locks before on-chain operations to prevent concurrent vault access.

## Strategy Integration

**applyHoldbackDeduction** — Strategy calls `vaultHealth.getHoldback(vaultAddress)` during position sizing. The holdback amount (USD) is subtracted from `tokenValue` before the `minDeployment` gate. This ensures the holdback reduces position size rather than causing deployment to be skipped entirely.

**Token selection at mint** — When a holdback is active, the strategy deploys fewer tokens into the new position. VaultHealth's `setHoldback` determines how much capital to reserve; the strategy decides which tokens to hold back based on its own priority logic (native/wrapped-native first to enable cheap Path 0/1 top-ups, otherwise highest-USD token).

**Fee-funded top-ups** — When VaultHealth detects an outstanding holdback at fee collection time, it can divert a portion of collected fees to the executor before fees are redeployed. Fees are already "new money" entering the vault — skimming gas from them doesn't reduce the principal position. This complements the holdback system but can't be the primary mechanism since fee collection timing and amounts are unpredictable.
