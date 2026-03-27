<!-- Source: src/strategies/base/StrategyBase.js, src/strategies/babySteps/BabyStepsStrategy.js -->
# Strategy System

## Overview

Strategies extend `StrategyBase` and implement 4 required methods. Currently one strategy exists: `BabyStepsStrategy` (type: `'bob'`). There are no platform-specific subclasses — platform logic is handled internally within each strategy using adapters from fum_library.

## Strategy Hierarchy

```
StrategyBase (src/strategies/base/StrategyBase.js)
└── BabyStepsStrategy (src/strategies/babySteps/BabyStepsStrategy.js)
    type: 'bob', name: 'Baby Steps Strategy'
```

## StrategyBase Interface

**Source:** `src/strategies/base/StrategyBase.js` (431 lines)

### Constructor Dependencies

```javascript
constructor(dependencies) {
  this.vaultDataService    // VaultDataService instance
  this.eventManager        // EventManager instance
  this.provider            // ethers provider (null until initialize)
  this.adapters            // Map of platform adapters (null until initialize)
  this.chainId             // Chain ID
  this.debug               // Debug logging flag
  this.vaultLocks          // Shared vault locking object (reference)
  this.poolData            // Shared pool data cache (reference)
  this.sendTelegramMessage // Notification callback
  this.automationService   // Reference to AutomationService
  this.tokens              // Token configurations (null until initialize)
  this.serviceConfig       // Service configuration (null until initialize)
  this.registeredListenerKeys = {}  // Track listeners per vault for cleanup
}
```

### Required Methods (must implement)

| Method | Signature | Called By |
|---|---|---|
| `initializeVault` | `(vault) → Promise<boolean>` | `AutomationService.setupVault` |
| `handleSwapEvent` | `(vault, poolId, platform, log)` | `AutomationService.handleSwapEvent` |
| `cleanup` | `(vaultAddress)` | `AutomationService.cleanupVault` |
| `setupAdditionalMonitoring` | `(vault)` | `AutomationService.startMonitoringVault` |

### Provided Methods

| Method | Description |
|---|---|
| `executeBatchTransactions(vault, transactions, operationType, type)` | Execute tx batch through vault contract. Types: `swap`, `approval`, `mint`, `addliq`, `subliq`, `collect`, `burn`, `incentive`. Returns `{ receipt, gasEstimated }`. |
| `isWrapUnwrapPair(tokenIn, tokenOut)` | Check if tokens are native <-> wrapped native. Returns `{ isWrap, isUnwrap, isWrapOrUnwrap }`. |
| `executeWrap(vault, amount)` | Wrap native to wrapped native (ETH→WETH, AVAX→WAVAX). Emits `NativeWrapped`. |
| `executeUnwrap(vault, amount)` | Unwrap wrapped native to native. Emits `NativeUnwrapped`. |
| `buildSwapDetails(swapMetadata, actualSwaps)` | Combine quoted and actual swap data into unified details array. |
| `log(message, ...args)` | Debug logging with `[ClassName]` prefix. |

### Transaction Execution

`executeBatchTransactions` is the primary mechanism for on-chain operations. It:
1. Extracts targets/calldatas/values from transaction array
2. Gets vault contract, creates signer from `AUTOMATION_PRIVATE_KEY`
3. Estimates gas via role-specific vault function (`swap`, `approve`, `mint`, etc.)
4. Executes with retry (1 retry, 500ms delay)
5. Emits `BatchTransactionExecuted` event with gas efficiency metrics

Vault contract functions map to types:
- `swap(targets, data, values)` — uses vault's internal ETH balance
- `approve(targets, data)` — token approvals
- `mint(targets, data, values)` — new position creation
- `increaseLiquidity(targets, data, values)` — add to existing position
- `decreaseLiquidity(targets, data)` — remove liquidity
- `collect(targets, data)` — collect fees
- `burn(targets, data)` — burn position NFT

## BabyStepsStrategy

**Source:** `src/strategies/babySteps/BabyStepsStrategy.js`

Conservative single-position strategy. `type = 'bob'`, `name = 'Baby Steps Strategy'`.

### Key Behavior
- Loads strategy config via `getStrategyDetails('bob')` from fum_library
- Tracks emergency exit baseline per vault (`emergencyExitBaseline` object)
- Tracks swap count since last fee check per vault (`swapCountSinceLastFeeCheck` object)
- On `initializeVault`: selects best pool, evaluates existing positions (keeps most centered up to `maxPositions`, demotes rest), closes non-aligned positions, prepares tokens, adds liquidity or creates new position, captures emergency baseline
- On `handleSwapEvent`: evaluates position state, decides whether to rebalance (out-of-range only), collect fees, or take no action
- Position evaluation uses `inRange` only — no edge-threshold triggers. Positions near range edges are left alone until they go out of range.
- Token preparation for deficit coverage logs warnings on remaining deficits but proceeds with available balances rather than throwing.

### Token Preparation Phases (`prepareTokensForPosition`)

Converts vault token balances into the two target tokens needed for a position. The flow adapts based on `adapter.supportsNativePools`:

**Step A — Early Wrap** (platforms where `supportsNativePools = false`, e.g., TJ V2.2):
Wraps ALL native tokens to wrapped native upfront. Since these platforms' routers wrap internally anyway, consolidating first eliminates batched-swap slippage when both native and wrapped would target the same pool. After Step A, native balance is zero and the wrapped balance is used for subsequent phases.

**Step B — Combined Native/Wrapped Phase** (platforms where `supportsNativePools = true`, e.g., V3/V4):
When the vault has native tokens AND there's a deficit in a non-native/non-wrapped target token, this phase consolidates native balance + any excess wrapped native from aligned targets into a single swap amount. It double-quotes both the native→target and wrapped→target routes via AlphaRouter and picks the better `amountOut`. The `combinedPhaseConsumed` tracker records how much excess aligned token was committed so Phase 2 doesn't double-spend it.

**Phase 1 — Non-Aligned Token Swaps:**
Swaps remaining non-aligned tokens (tokens that aren't target tokens) toward whichever target has the larger deficit.

**Phase 2 — Excess Target Token Swaps:**
If one target token has excess and the other still has a deficit, swaps the excess to cover it. Uses `adjustedAvailable` amounts that subtract `combinedPhaseConsumed` to prevent double-counting.

### Strategy Parameters

Stored in `vault.strategy.parameters` (see [Cache Structures](./cache-structures.md)):
- `targetRangeUpper/Lower` — target range in basis points
- `rebalanceThresholdUpper/Lower` — rebalance trigger in basis points
- `feeReinvestment` — boolean
- `reinvestmentTrigger` — minimum fee value (wei string)
- `reinvestmentRatio` — reinvestment percentage in basis points
- `maxSlippage` — max slippage in basis points
- `emergencyExitTrigger` — emergency exit threshold in basis points
- `maxUtilization` — max vault utilization in basis points

## Adding a New Strategy

1. Create `src/strategies/myStrategy/MyStrategy.js` extending `StrategyBase`
2. Set `this.type` and `this.name` in constructor (after `super(dependencies)`)
3. Implement all 4 required methods
4. Create `src/strategies/myStrategy/index.js` with the export
5. Add export to `src/strategies/index.js`
6. In `AutomationService` constructor, instantiate and add to `this.strategies` Map

## See Also

- [Cache Structures](./cache-structures.md) — Vault data shapes, strategy parameters
- [Automation Flow](./automation-flow.md) — How strategies are invoked during processing
