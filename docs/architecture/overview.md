# Architecture Overview

## System Philosophy

The FUM Library is built on the principle of **modular extensibility** with **protocol abstraction**. The architecture separates concerns into distinct layers, each with specific responsibilities and clear interfaces.

## Core Design Principles

### 1. **Adapter Pattern for Protocol Integration**
- Each DeFi protocol has its own adapter implementing a common interface
- New protocols can be added without changing existing code
- Uniform data structures across different protocols

### 2. **Layered Architecture**
```
┌─────────────────────────────────────────┐
│             Public API Layer            │ ← Simple, consistent interface
├─────────────────────────────────────────┤
│          Business Logic Layer           │ ← Helpers, calculations, validation
├─────────────────────────────────────────┤
│         Protocol Adapter Layer          │ ← Platform-specific implementations
├─────────────────────────────────────────┤
│         Infrastructure Layer            │ ← Blockchain, services, configs
└─────────────────────────────────────────┘
```

### 3. **Dependency Injection**
- Configuration and providers passed down through layers
- No hard-coded dependencies on specific chains or providers
- Easy testing with mock implementations

### 4. **Immutable Data Flow**
- Functions return new data structures rather than modifying inputs
- Predictable state management
- Side-effect isolation

## Key Architectural Decisions

### Protocol Abstraction Strategy
**Decision**: Use abstract base classes with concrete implementations
**Reasoning**: 
- Enforces consistent interface across protocols
- Provides default implementations for common functionality
- Type safety and IDE support
- Clear extension points for new protocols

### Configuration Management
**Decision**: Static configuration files with runtime overrides
**Reasoning**:
- Version-controlled configuration
- Environment-specific overrides (API keys, RPC URLs)
- Validation at startup rather than runtime
- Easy to audit and review changes

### Error Handling Strategy
**Decision**: Graceful degradation with partial data
**Reasoning**:
- DeFi data can be unreliable (network issues, node sync lag)
- Better UX to show partial data than complete failure
- Clear indication when data is incomplete (`hasPartialData` flags)

### Caching Strategy
**Decision**: Time-based caching with batch optimization
**Reasoning**:
- Price data changes frequently but not every second
- Batch API calls to reduce rate limiting
- Memory-based cache for development simplicity
- 60-second TTL balances freshness vs. performance

## Module Interaction Patterns

### 1. **Orchestration Pattern** (VaultHelpers)
VaultHelpers acts as an orchestrator, coordinating between multiple modules:
```javascript
// VaultHelpers orchestrates data gathering
const positions = await adapter.getPositions(address, chainId);
const prices = await priceService.fetchTokenPrices(tokenSymbols);
const tvl = calculateTVL(positions, prices);
```

### 2. **Factory Pattern** (AdapterFactory)
Centralized creation and management of protocol adapters:
```javascript
// Factory provides appropriate adapter instance
const adapter = AdapterFactory.getAdapter(platformId, provider);
```

### 3. **Strategy Pattern** (Price Fetching)
Different strategies for fetching data based on context:
- Cache hit: Immediate return
- Cache miss: Batch with other requests
- Fallback: Graceful degradation

## Data Flow Architecture

### Request Flow
1. **Entry Point**: Public API receives request
2. **Validation**: Input validation and sanitization
3. **Orchestration**: Helper functions coordinate data gathering
4. **Adaptation**: Protocol adapters fetch blockchain data
5. **Processing**: Raw data transformed into consistent format
6. **Enrichment**: Additional data (prices, metadata) added
7. **Response**: Structured response returned to caller

### Error Propagation
- Validation errors: Thrown immediately with descriptive messages
- Network errors: Caught, logged, marked as partial data
- Calculation errors: Isolated to specific positions/vaults
- Critical errors: Bubble up with context preservation

## Extension Points

### Adding New Protocols
1. Create new adapter extending `PlatformAdapter`
2. Implement required methods with protocol-specific logic
3. Register adapter with `AdapterFactory`
4. Add protocol configuration to `platforms.js`

### Adding New Chains
1. Add chain configuration to `chains.js`
2. Add contract addresses for existing protocols
3. Update token configurations with new chain addresses
4. Test adapter functionality on new chain

### Adding New Data Sources
1. Create service module following existing patterns
2. Implement caching if data is expensive to fetch
3. Add error handling and fallback strategies
4. Integrate with helper functions as needed

## Performance Considerations

### Concurrent Operations
- Multiple blockchain calls executed in parallel
- Batch operations where possible (price fetching)
- Promise.all() for independent operations

### Memory Management
- Limited cache size to prevent memory leaks
- Automatic cache expiration
- No persistent storage requirements

### Network Optimization
- Batch API calls when possible
- Retry logic with exponential backoff
- Connection pooling for blockchain RPCs

## Security Architecture

### Input Validation
- All user inputs validated at entry points
- Address validation for Ethereum addresses
- Numeric range validation for amounts

### Private Key Safety
- Library never handles private keys
- All transactions return unsigned data for external signing
- No storage of sensitive information

### API Key Management
- API keys injected at runtime via configuration
- No API keys stored in code or committed to version control
- Fallback to free tiers when API keys unavailable

## Testing Strategy

### Unit Testing
- Pure functions with deterministic outputs
- Mock external dependencies (blockchain, APIs)
- Edge case validation (zero amounts, invalid addresses)

### Integration Testing
- Adapter implementations with real but predictable data
- End-to-end workflows with test networks
- Configuration validation

### Performance Testing
- Cache effectiveness measurement
- Concurrent request handling
- Memory usage under load

## Monitoring and Observability

### Error Tracking
- Structured error objects with context
- Error categorization (network, validation, calculation)
- Partial data flags for degraded responses

### Performance Metrics
- Cache hit rates
- API call frequencies
- Response time distribution

### Debug Information
- Comprehensive logging at appropriate levels
- Request/response correlation
- Configuration validation results

---

For module-specific architecture details, see:
- [Adapters Architecture](./adapters.md)
- [Helpers Architecture](./helpers.md)
- [Services Architecture](./services.md)
- [Blockchain Architecture](./blockchain.md)