<!-- Source: src/strategies/babySteps/BabyStepsStrategy.js -->
# BabyStepsStrategy API

**Source:** `src/strategies/babySteps/BabyStepsStrategy.js`
**Extends:** `StrategyBase`

Conservative single-position automation strategy. `type = 'bob'`, `name = 'Baby Steps Strategy'`.

## Constructor

Calls `super(dependencies)`, then:
- Sets `this.type = 'bob'`, `this.name = 'Baby Steps Strategy'`
- Loads strategy config via `getStrategyDetails('bob')` from fum_library
- Initializes `this.emergencyExitBaseline = {}` (per-vault emergency baseline tracking)
- Initializes `this.swapCountSinceLastFeeCheck = {}` (per-vault swap counting)

## Implemented Methods

### initializeVault(vault) → Promise\<boolean\>

Initializes a newly discovered/authorized vault:
1. Evaluates initial positions and assets (aligned vs non-aligned)
2. Selects best pool for the vault's target tokens
3. Detects pool incentive programs
4. Captures emergency exit baseline (total vault value)
5. Creates initial position if vault has deployable assets

### handleSwapEvent(vault, poolId, platform, log)

Called when a swap event is detected on a pool the vault is monitoring:
1. Checks emergency exit trigger (extreme price deviation)
2. Evaluates if position needs rebalancing (out of range)
3. Evaluates fee collection (accrued fees above threshold, enough swaps since last check)
4. Executes appropriate action (rebalance, collect fees, or no-op)

### cleanup(vaultAddress)

Cleans up vault-specific strategy state:
- Removes from `emergencyExitBaseline`
- Removes from `swapCountSinceLastFeeCheck`

### setupAdditionalMonitoring(vault)

Sets up any strategy-specific monitoring beyond the base swap/config events.

## Strategy Parameters

Read from `vault.strategy.parameters`:

| Parameter | Type | Description |
|---|---|---|
| `targetRangeUpper` | number (basis points) | Target range above current price |
| `targetRangeLower` | number (basis points) | Target range below current price |
| `rebalanceThresholdUpper` | number (basis points) | Upper rebalance trigger |
| `rebalanceThresholdLower` | number (basis points) | Lower rebalance trigger |
| `feeReinvestment` | boolean | Enable fee reinvestment |
| `reinvestmentTrigger` | string (wei) | Min fee value to trigger collection |
| `reinvestmentRatio` | number (basis points) | % of fees to reinvest |
| `maxSlippage` | number (basis points) | Maximum slippage tolerance |
| `emergencyExitTrigger` | number (basis points) | Emergency exit price deviation |
| `maxUtilization` | number (basis points) | Max vault utilization for positions |

## See Also

- [Strategy System](../../architecture/strategy-system.md) — Architecture and interface details
- [Cache Structures](../../architecture/cache-structures.md) — Vault data shapes
