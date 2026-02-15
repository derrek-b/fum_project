# Parameter Update Workflow

**Workflow ID**: 06  
**Trigger**: `ParameterUpdated(address indexed vault, string paramName)` event from strategy contracts  
**Purpose**: Synchronize vault cache when strategy parameters change on-chain  
**Complexity**: Simple (event → cache refresh → notification)

## Overview

The Parameter Update Workflow handles real-time synchronization of strategy parameters when vault owners modify their strategy configuration on-chain. This ensures the automation service always has the latest parameter values for strategy decision-making.

## Event Trigger

**Source**: Strategy contract (e.g., BabyStepsStrategy, ParrisIslandStrategy)  
**Event Signature**: `ParameterUpdated(address indexed vault, string paramName)`  
**When Fired**: When vault owner calls parameter update functions on strategy contract  
**Event Data**:
- `vault`: Address of vault whose parameters changed
- `paramName`: Name of parameter group that was updated

## Function Call Chain

```
📡 ParameterUpdated Event
    ↓
🔍 EventManager.subscribeToStrategyParameterEvents()
    ↓ (handleParameterUpdate)
🔍 VaultRegistry.handleParameterUpdate()
    ├── Event decoding & validation
    ├── Check if vault exists in VaultDataService
    ├── VaultDataService.getVault(vaultAddress, forceRefresh=true)
    └── Call AutomationService.handleParameterUpdate()
        ↓
📢 AutomationService.handleParameterUpdate()
    ├── Log parameter update
    └── Send Telegram notification
```

## Detailed Flow Analysis

### Step 1: Event Subscription Setup
**Location**: `EventManager.subscribeToStrategyParameterEvents()`
- Creates event filter for `ParameterUpdated` events
- Registers global listener with EventManager
- Uses ethers.js event filtering with topic matching

### Step 2: Event Detection & Decoding
**Location**: `VaultRegistry.handleParameterUpdate()`
- Receives raw blockchain event log
- Decodes event using ethers Interface
- Extracts vault address and parameter name
- Validates event structure

### Step 3: Authorization Check
**Location**: `VaultRegistry.handleParameterUpdate()`
- Checks if vault exists in VaultDataService cache
- Ignores events from unauthorized vaults
- Only processes vaults that have authorized our automation service

### Step 4: Cache Refresh
**Location**: `VaultDataService.getVault(vaultAddress, forceRefresh=true)`
- Forces complete refresh of vault data from blockchain
- Reloads all strategy parameters from strategy contract
- Updates `vault.strategy.parameters` object in cache
- Uses full refresh instead of incremental parameter update

### Step 5: Notification & Logging
**Location**: `AutomationService.handleParameterUpdate()`
- Logs parameter update to console
- Sends Telegram notification with vault and parameter info
- Non-blocking notification (errors caught and logged)

## Data Flow Analysis

**Input**: Blockchain event with vault address + parameter name  
**Processing**: Full vault data refresh from strategy contract  
**Cache Update**: Complete `vault.strategy.parameters` object replacement  
**Output**: Updated vault cache + user notification  
**No Strategy Impact**: Does not trigger strategy evaluation or transactions

## Key Components & Dependencies

- **EventManager**: Event listening and filtering infrastructure
- **VaultRegistry**: Event handling, routing, and authorization checks
- **VaultDataService**: Cache management and blockchain data refresh
- **AutomationService**: Notification handling and logging
- **Strategy Contracts**: Parameter storage and event emission
- **Telegram Bot**: External notification delivery

## Side Effects & State Changes

### Cache Updates
- **Primary**: `vault.strategy.parameters` object completely refreshed
- **Secondary**: `vault.lastUpdated` timestamp updated
- **Scope**: Single vault only (no cross-vault impact)

### External Effects
- **Logging**: Console output in both VaultRegistry and AutomationService
- **Notification**: Telegram message sent asynchronously
- **No Transactions**: Does not trigger any blockchain transactions

### No Strategy Impact
- **No Evaluation**: Does not trigger strategy.evaluateState()
- **No Actions**: Does not initiate rebalancing or fee collection
- **Pure Sync**: Only synchronizes cache with blockchain state

## Error Handling Scenarios

### Event Processing Errors
**Location**: `VaultRegistry.handleParameterUpdate()`
- **Event Parsing Failure**: Malformed event data caught and logged
- **Interface Decode Error**: Invalid event signature handled gracefully
- **Recovery**: Skip malformed event, continue processing others

### Cache Refresh Errors
**Location**: `VaultDataService.getVault()`
- **Blockchain Connection Issues**: Provider errors caught
- **Contract Call Failures**: Strategy contract unavailable
- **Recovery**: Log error, maintain stale cache until next update

### Notification Errors
**Location**: `AutomationService.handleParameterUpdate()`
- **Telegram API Failures**: Network or API errors caught
- **Bot Configuration Issues**: Invalid token or chat ID
- **Recovery**: Log error, continue workflow (non-critical)

### Authorization Edge Cases
- **Vault Not Found**: Silently ignored (vault not authorized)
- **Concurrent Updates**: Race conditions handled by cache locks
- **Recovery**: Graceful degradation, no system impact

## Workflow Testing

### Testing Approach

**Workflow Testing Strategy**: Single comprehensive test that follows the complete function call chain from event trigger to final side effects. Tests integration, return values, and state changes all together using real blockchain environment.

**Environment**: Hardhat sandbox with actual deployed contracts, real vaults, and real parameter state that can be modified on-chain.

**Minimal Mocking**: Use real contracts and real blockchain events. Mock only external services that cannot be reliably sandboxed.

### Workflow Test Scenarios

#### Happy Path Workflow Test
**Complete End-to-End Flow**:
1. **Setup**: Deploy real strategy contract to Hardhat
2. **Vault Creation**: Create vault and authorize automation service as executor
3. **Parameter Change**: Call actual parameter update function on strategy contract  
4. **Event Emission**: Verify `ParameterUpdated` event is emitted by contract
5. **Event Detection**: Verify VaultRegistry event listener picks up the event
6. **Event Processing**: Verify event decoding and vault authorization check
7. **Cache Refresh**: Verify VaultDataService refreshes vault data from blockchain
8. **Parameter Update**: Verify `vault.strategy.parameters` object is updated with new values
9. **Notification**: Verify AutomationService sends Telegram notification
10. **State Verification**: Confirm cache consistency and proper logging

#### Error Scenario Workflow Tests

**Unauthorized Vault Updates**:
- Create vault that has NOT authorized automation service
- Trigger parameter update on strategy contract
- Verify event is ignored (no cache update, no notification)

**Concurrent Parameter Updates**:
- Trigger multiple parameter updates for same vault rapidly
- Verify cache consistency and proper event processing order
- Ensure no race conditions in cache refresh logic

**Parameter Updates During Operations**:
- Trigger parameter update while vault is processing price events
- Verify proper vault locking prevents conflicts
- Ensure parameter updates are processed after locks are released

#### Edge Case Workflow Tests

**Non-Existent Vault Parameters**:
- Trigger parameter update for vault not in VaultDataService
- Verify graceful handling without errors

**Rapid Parameter Changes**:
- Trigger multiple parameter updates in single block
- Verify all updates are processed correctly
- Test event ordering and cache consistency

**Service State Changes**:
- Trigger parameter updates during service startup
- Trigger parameter updates during service shutdown
- Verify proper event handling during state transitions

### Mock Strategy

**Real Components Used**:
- **Strategy Contracts**: Actual deployed contracts in Hardhat
- **Vault Contracts**: Real vaults with authorization state
- **Blockchain Events**: Natural event emission from contract calls
- **Telegram Bot**: Use configured test bot for notifications
- **Cache Operations**: Real VaultDataService with actual data

**Minimal Mocking Required**:
- **Sustained External Failures**: Simulate prolonged Telegram API outages
- **Network Partitions**: Test behavior during extended blockchain connectivity issues
- **Time-Sensitive Scenarios**: Accelerate time-based operations for testing

**No Mocking Needed**:
- ❌ Contract function calls (use real contracts)
- ❌ Event emission (trigger actual parameter changes)
- ❌ Cache operations (use real blockchain data)
- ❌ Event parsing (test against real event structure)

## Refactoring Considerations

### Performance Optimizations
- **Incremental Updates**: Replace full vault refresh with targeted parameter updates
- **Batch Processing**: Group multiple parameter updates for same vault
- **Event Deduplication**: Handle duplicate events from blockchain reorganizations

### Architecture Improvements
- **Event Sourcing**: Store parameter change history for audit trails
- **Async Processing**: Decouple cache updates from event processing
- **Circuit Breakers**: Handle sustained failures gracefully

### Coupling Reductions
- **Notification Abstraction**: Remove direct Telegram dependency
- **Event Flexibility**: Support parameter updates from multiple sources
- **Cache Abstraction**: Separate cache implementation from business logic

### Error Recovery Enhancements
- **Retry Mechanisms**: Automatic retry for transient failures
- **Dead Letter Queues**: Handle persistently failing events
- **Graceful Degradation**: Fallback behaviors for critical failures

## Configuration Dependencies

### Blockchain Configuration
- **Event Filter**: Correct `ParameterUpdated` event signature
- **Chain ID**: Proper chain configuration for event monitoring
- **Provider**: Stable WebSocket connection for real-time events
- **Contract ABIs**: Up-to-date strategy contract interfaces

### External Service Configuration
- **Telegram Bot**: Valid bot token and chat ID for notifications
- **Logging**: Appropriate log levels for debugging and monitoring
- **EventManager**: Proper event listener registration and cleanup

### Performance Tuning
- **Event Polling**: Optimal block confirmation delays
- **Cache TTL**: Appropriate cache expiration settings
- **Notification Rate Limits**: Telegram API compliance settings

## Monitoring & Observability

### Key Metrics
- **Event Processing Rate**: Parameter updates per hour/day
- **Cache Refresh Success Rate**: Percentage of successful vault refreshes
- **Notification Delivery Rate**: Telegram notification success percentage
- **Error Frequency**: Failed event processing attempts

### Logging Requirements
- **Event Detection**: Log all parameter update events received
- **Cache Operations**: Log vault refresh attempts and results
- **Error Tracking**: Detailed error logs for debugging
- **Performance Metrics**: Processing time for each workflow step

### Alerting Scenarios
- **High Error Rate**: Sustained event processing failures
- **Cache Staleness**: Vaults not refreshed within expected timeframe
- **Notification Failures**: Telegram delivery issues
- **Event Lag**: Delayed event processing detection