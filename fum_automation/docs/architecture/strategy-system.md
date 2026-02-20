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
