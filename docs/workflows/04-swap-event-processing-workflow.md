# Swap Event Detection & Processing Workflow

**Workflow ID**: 04
**Trigger**: Blockchain pool Swap events affecting monitored vault positions
**Purpose**: Detect price changes and execute automated position management (emergency exits, rebalancing, fee collection)
**Complexity**: High (real-time event processing, complex decision logic, automated transaction execution)

## Overview

The Swap Event Detection & Processing Workflow monitors DEX pool swap events in real-time to detect price movements that affect monitored vault positions. When price changes are detected, the system evaluates whether emergency action is needed, positions require rebalancing, or fees should be collected. This is the core automated trading logic that keeps vault positions optimized and protects against excessive losses.

## Real-Time Event-Driven Trigger

**Source**: DEX pool contracts (Uniswap V3, etc.)
**Entry Point**: Swap(address,address,int256,int256,uint160,uint128,int24) events on monitored pools
**Detection**: EventManager filter listeners registered for each vault's position pools
**Prerequisites**: Vault authorized and monitoring active, swap event listeners registered for position pools

## Complete Function Call Chain

```
🎯 Blockchain Event: Pool.Swap(sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick)
    ↓
📡 EventManager Pool Monitoring (src/EventManager.js)
    ├── subscribeToSwapEvents(vault, provider) [Previously registered during vault setup]
    │   ├── Get unique pools from vault positions
    │   ├── Get platform adapter for pool ABI
    │   └── Register filter listener per pool via registerFilterListener()
    ├── Pool swap event filter matches
    └── handleSwapEvent(log) [Internal handler per pool, line 747]
        ├── Parse log to get basic event info
        └── Emit 'SwapEventDetected' with event data
            └── eventManager.emit('SwapEventDetected', { vaultAddress, poolAddress, platform, log })
                ↓
🎬 AutomationService Event Handler (src/AutomationService.js:243)
    └── handleSwapEvent(vaultAddress, poolAddress, platform, log) [line 1410]
        ├── Shutdown check - return if isShuttingDown
        ├── Vault locking - lockVault(vaultAddress)
        │   └── Skip if already locked (returns false)
        ├── Get vault data
        │   └── vaultDataService.getVault(vaultAddress)
        ├── Get strategy instance
        │   └── this.strategies[vault.strategy.strategyId]
        ├── Strategy delegation
        │   └── strategy.handleSwapEvent(vault, poolAddress, platform, log)
        │       ↓
🎮 BabyStepsStrategy (src/strategies/BabyStepsStrategy.js:2985)
    └── handleSwapEvent(vault, poolAddress, platform, log)
        ├── Get platform-specific handler
        │   └── BabyStepsStrategyFactory.getHandler(platform, this)
        │       └── Returns UniswapV3BabyStepsStrategy for 'uniswapv3'
        ├── If no handler found
        │   └── Emit 'VaultUnrecoverable' with reason
        └── Delegate to platform handler
            └── handler.handleSwapEvent(vault, poolAddress, log)
                ↓
⚡ UniswapV3BabyStepsStrategy (src/strategies/babySteps/UniswapV3BabyStepsStrategy.js:60)
    └── handleSwapEvent(vault, poolAddress, log)
        ├── Parse Uniswap V3 swap event
        │   ├── Extract currentTick from decoded.args.tick
        │   └── Extract sqrtPriceX96 from decoded.args.sqrtPriceX96
        ├── Find affected position in the pool
        │   └── Object.values(vault.positions).find(pos => pos.pool === poolAddress)
        ├── If no position found
        │   └── Emit 'VaultUnrecoverable' and throw error
        ├── FIRST: Emergency Exit Check (Highest Priority)
        │   └── checkEmergencyExitTrigger(vault, position, currentTick) [line 145]
        │       ├── Get cached baseline tick from parent.emergencyExitBaseline[vault.address]
        │       ├── Get emergencyExitTrigger from vault.strategy.parameters
        │       ├── Get pool metadata and token data
        │       ├── Convert ticks to prices using adapter.tickToPrice()
        │       ├── Calculate price movement percentage
        │       └── Return true if movement >= trigger threshold
        │           ↓ [IF EMERGENCY EXIT TRIGGERED]
        │   └── parent.executeEmergencyExit(vault, position, currentTick)
        │       ├── Step 1: Close ALL positions immediately
        │       │   └── closePositions(vault, allPositions)
        │       ├── Step 2: Emit VaultUnrecoverable event
        │       │   └── Triggers blacklisting workflow
        │       └── Step 3: Send urgent notification
        │           └── sendTelegramMessage('🚨 EMERGENCY EXIT')
        │           ↓ [WORKFLOW ENDS - NO FURTHER PROCESSING]
        ├── THEN: Rebalance Check
        │   └── checkRebalanceNeeded(position, currentTick, params) [line 212]
        │       ├── Check if position is out of range
        │       │   └── currentTick < tickLower || currentTick > tickUpper
        │       ├── Check threshold distances
        │       │   ├── Calculate lowerPercent = (currentTick - tickLower) / rangeSize * 100
        │       │   ├── Calculate upperPercent = (tickUpper - currentTick) / rangeSize * 100
        │       │   └── Compare to rebalanceThresholdLower/Upper
        │       └── Return true if rebalance needed
        │           ↓ [IF REBALANCE NEEDED]
        │   └── parent.rebalancePosition(vault, position, currentTick)
        │       ├── Step 1: Close out-of-range position
        │       │   └── closePositions(vault, { [position.id]: position })
        │       ├── Step 2: Extract fees from closure events
        │       │   └── extractFeesFromClosureEvents(receipt, positionMetadata)
        │       ├── Step 3: Refresh token balances
        │       │   └── vaultDataService.refreshPositionsAndTokens(vault.address)
        │       ├── Step 4: Calculate available deployment
        │       │   └── calculateAvailableDeployment(vault)
        │       ├── Step 5: Create new position with available capital
        │       │   └── createNewPosition(vault, availableDeployment, assetValues)
        │       ├── Step 6: Refresh vault data
        │       │   └── vaultDataService.refreshPositionsAndTokens(vault.address)
        │       └── Step 7: Emit success event
        │           └── eventManager.emit('PositionRebalanced')
        │           ↓ [WORKFLOW ENDS - REBALANCE COMPLETE]
        └── ELSE: Fee Collection Check (Position In Range)
            └── checkFeesToCollect(vault, position) [line ~240]
                ├── Check if fees are above threshold
                └── Return true if collection needed
                    ↓ [IF FEES NEED COLLECTION]
            └── parent.collectFees(vault, position)
                ├── Execute fee collection transaction
                ├── Emit FeesCollected event
                └── Update vault state
                    ↓ [WORKFLOW ENDS - FEE COLLECTION COMPLETE OR NO ACTION]
        ├── Error handling and re-throw
        │   └── Errors propagate up for vault blacklisting
        └── Vault unlocking (in finally block of AutomationService)
            └── unlockVault(vaultAddress) [Always executed]
```

## Function Inventory by Module

### EventManager.js - Event Detection (USED)
- **subscribeToSwapEvents(vault, provider)**: Swap event monitoring setup for vault pools
- **handleSwapEvent(log)**: Internal swap event processing (per pool)
- **emit('SwapEventDetected', {...})**: Event emission with `vaultAddress, poolAddress, platform, log`
- **registerFilterListener**: Swap filter registration per pool

### AutomationService.js - Event Orchestration (USED)
- **handleSwapEvent(vaultAddress, poolAddress, platform, log)**: Main swap event handler
- **lockVault/unlockVault**: Race condition prevention
- **sendTelegramMessage**: Error and emergency notifications
- **vaultDataService.getVault**: Vault data retrieval

### BabyStepsStrategy.js - Strategy Delegation (USED)
- **handleSwapEvent(vault, poolAddress, platform, log)**: Delegates to platform-specific handler
- **BabyStepsStrategyFactory.getHandler(platform, this)**: Gets platform-specific handler
- **executeEmergencyExit(vault, position, currentTick)**: Emergency exit execution
- **rebalancePosition(vault, position, currentTick)**: Position rebalancing execution
- **collectFees(vault, position)**: Fee collection execution
- **closePositions(vault, positions)**: Position closure execution
- **calculateAvailableDeployment(vault)**: Capital deployment calculation
- **createNewPosition(vault, deployment, assetValues)**: New position creation

### UniswapV3BabyStepsStrategy.js - Platform-Specific Logic (USED)
- **handleSwapEvent(vault, poolAddress, log)**: Platform-specific swap handling
- **checkEmergencyExitTrigger(vault, position, currentTick)**: Emergency exit evaluation
- **checkRebalanceNeeded(position, currentTick, params)**: Rebalance evaluation
- **checkFeesToCollect(vault, position)**: Fee collection evaluation

### VaultDataService.js - Data Management (USED)
- **getVault(vaultAddress)**: Vault data retrieval
- **refreshPositionsAndTokens(vaultAddress)**: Complete vault data refresh

## Three Decision Paths

### Path 1: Emergency Exit (Critical Price Movement)
**Trigger**: Price movement exceeds emergencyExitTrigger threshold
**Action**: Immediate closure of ALL positions, vault blacklisting
**Outcome**: Vault removed from monitoring, manual intervention required
**Notification**: Urgent Telegram alert
**Key Functions**:
- `checkEmergencyExitTrigger()` in UniswapV3BabyStepsStrategy
- `executeEmergencyExit()` in BabyStepsStrategy

### Path 2: Position Rebalancing (Position Out of Range or Near Boundary)
**Trigger**: Position out of range OR approaching rebalance thresholds
**Action**: Close current position, create new position in optimal range
**Outcome**: Vault continues automated management with new position
**Events**: PositionRebalanced → triggers swap listener refresh
**Key Functions**:
- `checkRebalanceNeeded()` in UniswapV3BabyStepsStrategy
- `rebalancePosition()` in BabyStepsStrategy

### Path 3: Fee Collection or No Action (Position In Range)
**Trigger**: Position within acceptable range
**Action**: Check for fee collection opportunities, collect if above threshold
**Outcome**: Vault continues monitoring, fees collected if warranted
**Events**: FeesCollected (if applicable)
**Key Functions**:
- `checkFeesToCollect()` in UniswapV3BabyStepsStrategy
- `collectFees()` in BabyStepsStrategy

## Event Signature Changes

### SwapEventDetected Event Structure
```javascript
{
  vaultAddress: '0x...',   // Address of the vault with position in this pool
  poolAddress: '0x...',    // Pool contract address where swap occurred
  platform: 'uniswapv3',   // Platform identifier
  log: {                   // Raw event log
    address: '0x...',
    topics: [...],
    data: '0x...',
    blockNumber: 12345678,
    transactionHash: '0x...'
  }
}
```

## Success and Failure Scenarios

### Success Paths
1. **Emergency Exit Success** → All positions closed, vault blacklisted, manual intervention triggered
2. **Rebalance Success** → Old position closed, new position created, monitoring updated
3. **Fee Collection Success** → Fees collected (and optionally reinvested)
4. **No Action Success** → Position monitoring continues unchanged

### Error Scenarios
1. **No Handler for Platform** → VaultUnrecoverable emitted, vault blacklisted
2. **No Position for Pool** → VaultUnrecoverable emitted, vault blacklisted
3. **Emergency Exit Failures** → Partial position closure, manual intervention still triggered
4. **Rebalance Failures** → Position closure may succeed but new position creation fails
5. **Fee Collection Failures** → Fees not collected, monitoring continues

### Error Recovery
- **Vault locking** → Always unlocked in finally block
- **Failed operations** → Errors re-thrown to trigger vault blacklisting
- **Telegram notifications** → Error alerts sent for monitoring

## Event Flow During Processing

### Events Consumed
- **Swap** (blockchain): Pool price change detection
- **SwapEventDetected** (internal): Triggers processing workflow

### Events Emitted During Processing
- **VaultUnrecoverable**: No handler, missing position, or emergency exit (leads to blacklisting)
- **PositionRebalanced**: Successful rebalancing (triggers listener refresh)
- **FeesCollected**: Successful fee collection

### Notifications
- **Emergency Exit**: Urgent Telegram alert with details
- **Processing Errors**: Error notifications for debugging

## Platform-Specific Handler Architecture

The strategy uses a factory pattern for platform-specific implementations:

```javascript
// In BabyStepsStrategy.handleSwapEvent()
const handler = BabyStepsStrategyFactory.getHandler(platform, this);
await handler.handleSwapEvent(vault, poolAddress, log);
```

**Available Handlers**:
- `UniswapV3BabyStepsStrategy` - For Uniswap V3 pools

Each handler implements:
- `handleSwapEvent(vault, poolAddress, log)` - Main entry point
- `checkEmergencyExitTrigger(vault, position, currentTick)` - Emergency evaluation
- `checkRebalanceNeeded(position, currentTick, params)` - Rebalance evaluation
- `checkFeesToCollect(vault, position)` - Fee collection evaluation

## Real-Time Processing Characteristics

### Performance Considerations
- **Race condition prevention**: Vault locking ensures single processing per vault
- **Event filtering**: Only processes swaps affecting monitored positions
- **Efficient parsing**: Platform-specific ABIs for optimal event processing

### Scalability Features
- **Per-vault processing**: Each vault triggers independent evaluation
- **Pool-based monitoring**: Efficient listener management per pool
- **Graceful degradation**: Individual vault failures trigger blacklisting without affecting others

## Critical vs Optional Operations

### Critical (Must Execute)
- Swap event detection and parsing
- Platform handler delegation
- Vault locking/unlocking
- SwapEventDetected event emission

### Important (Affects Position Management)
- Emergency exit execution (when triggered)
- Position rebalancing (when needed)
- Fee collection (when enabled and above threshold)

### Optional (Failure is Logged)
- Telegram notifications
- Event emissions for monitoring
- Data refresh after operations

## Integration Points

### Triggers Other Workflows
- **VaultUnrecoverable** → Triggers blacklisting and removal (Workflow 03)
- **PositionRebalanced** → Triggers swap listener refresh

### Depends on Service Infrastructure
- EventManager swap monitoring setup
- VaultDataService data management
- Platform adapters for transaction execution
- Telegram notification system
- BabyStepsStrategyFactory for handler resolution

## End States

### Emergency Exit End State
- **All positions closed** for the vault
- **Vault blacklisted** and removed from monitoring
- **Manual intervention** required to resume operations
- **Service continues** monitoring other vaults

### Rebalance End State
- **New position created** in optimal range
- **Monitoring updated** for new position
- **Vault continues** automated management
- **Position tracking** updated for future events

### Fee Collection End State
- **Fees collected** (if above threshold)
- **Vault continues** normal monitoring
- **Position unchanged** but fees optimized

### No Action End State
- **Position monitoring** continues unchanged
- **Vault state** preserved
- **Next swap event** will trigger re-evaluation
