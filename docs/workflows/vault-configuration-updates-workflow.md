# Vault Configuration Updates Workflow

**Workflow ID**: 07  
**Trigger**: `TargetTokensUpdated(address[], tokens)` or `TargetPlatformsUpdated(address[], platforms)` events from vault contracts  
**Purpose**: Synchronize vault cache and restart monitoring when vault configuration changes  
**Complexity**: Medium (event → cache update → monitoring restart → adapter reconfiguration)

## Overview

The Vault Configuration Updates Workflow handles real-time synchronization of vault target configuration when vault owners modify their token or platform preferences on-chain. This workflow ensures the automation service immediately adapts to configuration changes by updating cached data, restarting monitoring with new parameters, and reconfiguring platform adapters as needed.

## Event Triggers

### Target Tokens Updated Event
**Source**: Position vault contracts  
**Event Signature**: `TargetTokensUpdated(address[], tokens)`  
**When Fired**: When vault owner calls `setTargetTokens()` with new token list  
**Event Data**:
- `tokens`: Array of token addresses for the new target token configuration

### Target Platforms Updated Event
**Source**: Position vault contracts  
**Event Signature**: `TargetPlatformsUpdated(address[], platforms)`  
**When Fired**: When vault owner calls `setTargetPlatforms()` with new platform list  
**Event Data**:
- `platforms`: Array of platform identifiers for the new target platform configuration

## Function Call Chain

### Target Tokens Update Flow
```
📡 TargetTokensUpdated Event
    ↓
🔍 EventManager.subscribeToVaultConfigEvents()
    ↓ (handleTokensUpdate)
🔍 VaultRegistry.handleTokensUpdate()
    ├── Log tokens update with vault address and new tokens
    ├── VaultDataService.updateTargetTokens(vault.address, tokens)
    │   ├── ethers.utils.getAddress(vaultAddress) normalization
    │   ├── getVault(normalizedAddress) to retrieve current vault data
    │   ├── vault.targetTokens = [...newTokens] cache update
    │   ├── vault.lastUpdated = Date.now() timestamp update
    │   ├── this.vaults.set(normalizedAddress, vault) cache storage
    │   └── EventManager.emit('targetTokensUpdated', address, tokens)
    ├── VaultDataService.getVault(vault.address, forceRefresh=true)
    └── this.onTargetTokensUpdated(updatedVault, tokens)
        ↓
📢 AutomationService.handleTargetTokensUpdate()
    ├── Validate vault and tokens parameters
    ├── VaultDataService.getVault(vault.address) to get current data
    ├── identifyVaultStrategy(vaultData) to get current strategy
    ├── strategies[strategyType].cleanup(vaultData) to stop monitoring
    ├── VaultDataService.updateTargetTokens(vault.address, newTokens)
    ├── VaultDataService.getVault(vault.address, forceRefresh=true)
    ├── startMonitoringVault(updatedVault) to restart with new config
    └── Send Telegram notification with new token configuration
```

### Target Platforms Update Flow
```
📡 TargetPlatformsUpdated Event
    ↓
🔍 EventManager.subscribeToVaultConfigEvents()
    ↓ (handlePlatformsUpdate)
🔍 VaultRegistry.handlePlatformsUpdate()
    ├── Log platforms update with vault address and new platforms
    ├── VaultDataService.updateTargetPlatforms(vault.address, platforms)
    │   ├── ethers.utils.getAddress(vaultAddress) normalization
    │   ├── getVault(normalizedAddress) to retrieve current vault data
    │   ├── vault.targetPlatforms = [...newPlatforms] cache update
    │   ├── vault.lastUpdated = Date.now() timestamp update
    │   ├── this.vaults.set(normalizedAddress, vault) cache storage
    │   └── EventManager.emit('targetPlatformsUpdated', address, platforms)
    ├── VaultDataService.getVault(vault.address, forceRefresh=true)
    └── this.onTargetPlatformsUpdated(updatedVault, platforms)
        ↓
📢 AutomationService.handleTargetPlatformsUpdate()
    ├── Validate vault and platforms parameters
    ├── VaultDataService.getVault(vault.address) to get current data
    ├── identifyVaultStrategy(vaultData) to get current strategy
    ├── strategies[strategyType].cleanup(vaultData) to stop monitoring
    ├── VaultDataService.updateTargetPlatforms(vault.address, newPlatforms)
    ├── VaultDataService.getVault(vault.address, forceRefresh=true)
    ├── startMonitoringVault(updatedVault) to restart with new config
    └── Send Telegram notification with new platform configuration
```

## Detailed Flow Analysis

### Step 1: Event Subscription Setup
**Location**: `EventManager.subscribeToVaultConfigEvents(vault)`
- Sets up vault-specific event listeners for `TargetTokensUpdated` and `TargetPlatformsUpdated`
- Registers listeners with EventManager using vault contract instance
- Uses vault-specific contract reference for event filtering
- Called during vault authorization to establish configuration monitoring

### Step 2: Event Detection & Decoding
**Location**: `VaultRegistry.handleTokensUpdate()` / `VaultRegistry.handlePlatformsUpdate()`
- Receives configuration change events from specific vault contracts
- Extracts new configuration arrays (tokens or platforms) from event data
- Logs configuration change with vault address and new values
- Validates event data structure before processing

### Step 3: Cache Update in VaultDataService
**Location**: `VaultDataService.updateTargetTokens()` / `VaultDataService.updateTargetPlatforms()`
- Normalizes vault address using `ethers.utils.getAddress()` for consistent lookup
- Retrieves current vault data from cache to maintain other properties
- Updates target configuration arrays with new values
- Updates `lastUpdated` timestamp to track configuration freshness
- Stores updated vault data back to cache Map
- Emits internal events for monitoring configuration changes

### Step 4: Fresh Data Retrieval & Callback
**Location**: `VaultRegistry.handleTokensUpdate()` / `VaultRegistry.handlePlatformsUpdate()`
- Forces fresh vault data retrieval to ensure consistency
- Calls AutomationService callback with updated vault data and new configuration
- Provides both vault object and configuration array to handler
- Handles callback errors gracefully with logging

### Step 5: Monitoring Cleanup
**Location**: `AutomationService.handleTargetTokensUpdate()` / `AutomationService.handleTargetPlatformsUpdate()`
- Validates input parameters for vault data and configuration arrays
- Retrieves current vault data to identify existing strategy
- Calls strategy cleanup to remove old monitoring with previous configuration
- Ensures clean transition between old and new configuration monitoring

### Step 6: Configuration Update & Refresh
**Location**: `AutomationService.handleTargetTokensUpdate()` / `AutomationService.handleTargetPlatformsUpdate()`
- Updates VaultDataService cache with new configuration via dedicated update methods
- Forces fresh vault data retrieval to get complete updated vault state
- Ensures all cached data reflects the new configuration before restarting monitoring

### Step 7: Monitoring Restart
**Location**: `AutomationService.handleTargetTokensUpdate()` / `AutomationService.handleTargetPlatformsUpdate()`
- Calls `startMonitoringVault(updatedVault)` to restart monitoring with new configuration
- Strategy identification uses updated target configuration
- Platform adapters are reconfigured based on new target platforms
- Event listeners are reestablished with new configuration parameters

### Step 8: Notification & Logging
**Location**: `AutomationService.handleTargetTokensUpdate()` / `AutomationService.handleTargetPlatformsUpdate()`
- Logs configuration update completion with vault details
- Sends Telegram notification with vault name/address and new configuration
- Uses non-blocking notification delivery (errors caught and logged)
- Provides user feedback about configuration changes

## Data Flow Analysis

**Input**: Blockchain events with vault address and new configuration arrays  
**Processing**: Cache updates, monitoring cleanup, and monitoring restart with new configuration  
**Cache Update**: Vault target configuration updated in VaultDataService.vaults Map  
**Output**: Updated vault monitoring using new configuration + user notification  
**Strategy Impact**: May trigger adapter reconfiguration and strategy parameter adjustments

## Key Components & Dependencies

- **EventManager**: Vault-specific event listening and configuration change detection
- **VaultRegistry**: Event handling, cache coordination, and callback management
- **VaultDataService**: Configuration cache updates and vault data consistency
- **AutomationService**: Monitoring coordination and notification handling
- **Strategy Cleanup**: Strategy-specific resource cleanup during reconfiguration
- **Platform Adapters**: Reconfiguration based on new target platform settings
- **Vault Contracts**: Configuration state and event emission
- **Telegram Bot**: External notification delivery

## Side Effects & State Changes

### Cache Updates
- **Primary**: Vault `targetTokens` or `targetPlatforms` arrays updated in cache
- **Secondary**: Vault `lastUpdated` timestamp refreshed
- **Scope**: Single vault only (no cross-vault impact)
- **Consistency**: Full vault data refresh ensures cache consistency

### Monitoring Reconfiguration
- **Strategy Cleanup**: Old monitoring stopped before new monitoring starts
- **Event Listeners**: Vault-specific listeners reestablished with new parameters
- **Adapter Reconfiguration**: Platform adapters adjusted for new target platforms
- **No Data Loss**: Ongoing operations complete before reconfiguration

### External Effects
- **Logging**: Comprehensive logging in VaultRegistry and AutomationService
- **Notification**: Telegram message with configuration change details
- **Strategy Adaptation**: Strategies adapt to new token/platform configuration
- **Continuous Monitoring**: Vault monitoring continues with updated configuration

## Error Handling Scenarios

### Event Processing Errors
**Location**: `VaultRegistry.handleTokensUpdate()` / `VaultRegistry.handlePlatformsUpdate()`
- **Event Parsing Failure**: Malformed event data caught and logged
- **Configuration Validation**: Invalid token/platform arrays handled gracefully
- **Recovery**: Skip malformed event, continue processing others

### Cache Update Errors
**Location**: `VaultDataService.updateTargetTokens()` / `VaultDataService.updateTargetPlatforms()`
- **Vault Not Found**: Missing vault in cache handled with specific error
- **Address Normalization Issues**: Invalid vault addresses caught
- **Cache Corruption**: Map operation failures logged and handled
- **Recovery**: Return false to indicate update failure, log detailed error

### Monitoring Transition Errors
**Location**: `AutomationService.handleTargetTokensUpdate()` / `AutomationService.handleTargetPlatformsUpdate()`
- **Strategy Cleanup Failure**: Cleanup errors logged, continue with restart
- **Monitoring Restart Failure**: startMonitoringVault errors handled gracefully
- **Adapter Configuration Issues**: Platform adapter errors logged
- **Recovery**: Attempt to continue with partial configuration

### Callback and Notification Errors
**Location**: Various callback and notification points
- **Callback Function Missing**: Missing handler functions logged as errors
- **Telegram API Failures**: Network or API errors during notification
- **Internal Event Errors**: EventManager emit failures caught
- **Recovery**: Continue workflow, log errors (non-critical for core functionality)

## Workflow Testing

### Testing Approach

**Workflow Testing Strategy**: Single comprehensive test that follows the complete function call chain from event emission to monitoring reconfiguration. Tests cache updates, monitoring transitions, and configuration changes using real blockchain environment.

**Environment**: Hardhat sandbox with deployed vault contracts that can emit real configuration change events and support target token/platform modifications.

**Minimal Mocking**: Use real contracts and real blockchain events. Mock only external services that cannot be reliably sandboxed.

### Workflow Test Scenarios

#### Happy Path Workflow Tests

**Target Tokens Update Flow**:
1. **Setup**: Deploy vault with initial target token configuration
2. **Establish Monitoring**: Verify vault is actively monitored with initial configuration
3. **Configuration Change**: Call vault.setTargetTokens() with new token array
4. **Event Emission**: Verify `TargetTokensUpdated` event is emitted by vault contract
5. **Event Detection**: Verify VaultRegistry event listener picks up the event
6. **Cache Update**: Verify VaultDataService updates target tokens in cache
7. **Monitoring Cleanup**: Verify strategy cleanup is called for old configuration
8. **Monitoring Restart**: Verify monitoring restarted with new token configuration
9. **Notification**: Verify AutomationService sends Telegram notification
10. **State Verification**: Confirm vault monitoring uses new token configuration

**Target Platforms Update Flow**:
1. **Setup**: Deploy vault with initial target platform configuration
2. **Establish Monitoring**: Verify vault is actively monitored with initial configuration
3. **Configuration Change**: Call vault.setTargetPlatforms() with new platform array
4. **Event Emission**: Verify `TargetPlatformsUpdated` event is emitted by vault contract
5. **Event Detection**: Verify VaultRegistry event listener picks up the event
6. **Cache Update**: Verify VaultDataService updates target platforms in cache
7. **Adapter Reconfiguration**: Verify platform adapters are updated for new platforms
8. **Monitoring Restart**: Verify monitoring restarted with new platform configuration
9. **Notification**: Verify AutomationService sends Telegram notification
10. **State Verification**: Confirm vault monitoring uses new platform configuration

#### Error Scenario Workflow Tests

**Configuration Update Failures**:
- Simulate VaultDataService cache update failures
- Verify graceful error handling and appropriate logging
- Ensure monitoring continues with previous configuration

**Monitoring Transition Failures**:
- Simulate strategy cleanup failures during configuration changes
- Verify monitoring restart attempts despite cleanup errors
- Test partial monitoring functionality during transition errors

**Invalid Configuration Data**:
- Trigger events with invalid token/platform arrays
- Verify validation and graceful handling of malformed data
- Ensure service continues processing other configuration changes

**Concurrent Configuration Changes**:
- Trigger multiple configuration updates for same vault rapidly
- Verify proper event processing order and cache consistency
- Ensure no race conditions in monitoring transition

#### Edge Case Workflow Tests

**Configuration Changes During Operations**:
- Trigger configuration updates while vault has ongoing operations
- Verify proper operation completion before monitoring restart
- Test lock handling and resource management during transitions

**Rapid Configuration Cycles**:
- Change configuration multiple times in rapid succession
- Verify all changes are processed correctly
- Test event ordering and cache consistency

**Service State During Configuration Updates**:
- Trigger configuration updates during service startup
- Trigger configuration updates during service shutdown
- Verify proper event handling during state transitions

### Mock Strategy

**Real Components Used**:
- **Vault Contracts**: Actual deployed vaults with real configuration change capability
- **Configuration Events**: Natural event emission from contract configuration changes
- **Cache Operations**: Real VaultDataService with actual configuration updates
- **Monitoring System**: Real strategy cleanup and restart with new configuration
- **Telegram Bot**: Use configured test bot for notifications

**Minimal Mocking Required**:
- **External Service Failures**: Simulate prolonged Telegram API outages
- **Resource Constraints**: Test behavior during memory or connection limits
- **Time-Sensitive Scenarios**: Accelerate configuration change testing

**No Mocking Needed**:
- ❌ Contract configuration calls (use real setTargetTokens/setTargetPlatforms)
- ❌ Event emission (trigger actual configuration change events)
- ❌ Cache operations (use real configuration updates)
- ❌ Monitoring transitions (test real strategy cleanup and restart)

## Refactoring Considerations

### Performance Optimizations
- **Batch Configuration Updates**: Handle multiple configuration changes efficiently
- **Incremental Monitoring Updates**: Update only changed aspects of monitoring
- **Parallel Processing**: Run cleanup and restart operations concurrently where safe
- **Event Deduplication**: Handle duplicate configuration events from blockchain reorganizations

### Architecture Improvements
- **Configuration Validation**: Enhanced validation of target token/platform arrays
- **Monitoring State Management**: Better tracking of monitoring transition states
- **Adapter Hot-Swapping**: Update adapters without full monitoring restart
- **Configuration History**: Track configuration change history for audit trails

### Coupling Reductions
- **Notification Abstraction**: Remove direct Telegram dependency
- **Event Flexibility**: Support configuration updates from multiple sources
- **Cache Abstraction**: Separate cache implementation from business logic
- **Monitoring Interfaces**: Standardize monitoring start/stop interfaces

### Error Recovery Enhancements
- **Retry Mechanisms**: Automatic retry for transient configuration update failures
- **Rollback Capabilities**: Revert to previous configuration on update failures
- **Partial Configuration Support**: Allow partial functionality during configuration issues
- **Health Monitoring**: Monitor configuration consistency and adapter health

## Configuration Dependencies

### Blockchain Configuration
- **Event Filters**: Correct `TargetTokensUpdated` and `TargetPlatformsUpdated` signatures
- **Chain ID**: Proper chain configuration for vault contract events
- **Provider**: Stable WebSocket connection for real-time configuration events
- **Contract ABIs**: Up-to-date vault contract interfaces

### Platform Configuration
- **Adapter Configurations**: Valid platform adapter configurations for target platforms
- **Token Configurations**: Supported token configurations for target tokens
- **Strategy Configurations**: Strategy compatibility with new token/platform combinations

### External Service Configuration
- **Telegram Bot**: Valid bot token and chat ID for configuration change notifications
- **Logging**: Appropriate log levels for debugging configuration transitions
- **EventManager**: Proper event listener management for vault-specific events

### Performance Tuning
- **Configuration Update Timeouts**: Appropriate timeouts for monitoring transitions
- **Cache Refresh Intervals**: Optimal cache refresh after configuration changes
- **Event Processing Delays**: Proper block confirmation delays for configuration events

## Monitoring & Observability

### Key Metrics
- **Configuration Change Rate**: Target configuration updates per hour/day
- **Update Success Rate**: Percentage of successful configuration transitions
- **Monitoring Restart Time**: Average time to restart monitoring after configuration change
- **Adapter Reconfiguration Success**: Platform adapter update success rate

### Logging Requirements
- **Configuration Detection**: Log all configuration change events received
- **Cache Operations**: Log configuration cache update attempts and results
- **Monitoring Transitions**: Log strategy cleanup and restart operations
- **Error Tracking**: Detailed error logs for debugging configuration failures

### Alerting Scenarios
- **High Configuration Failure Rate**: Sustained configuration update failures
- **Monitoring Transition Issues**: Problems with strategy cleanup or restart
- **Adapter Configuration Failures**: Platform adapter reconfiguration problems
- **Configuration Processing Lag**: Delayed processing of configuration change events