# Strategy Helpers API

Strategy configuration utilities for managing trading strategies, parameters, and templates.

## Overview

The Strategy Helpers module provides comprehensive utilities for working with trading strategies in the FUM Library. It manages strategy configurations, parameter validation, template systems, and token compatibility checks.

## Functions

---

## getAvailableStrategies

Get the list of available strategy configurations (excluding the "none" strategy).

### Signature
```javascript
getAvailableStrategies(): Array<Object>
```

### Parameters

None

### Returns

`Array<Object>` - Array of strategy objects with complete configuration data

### Return Array Item Structure
```javascript
{
  id: string,                        // Strategy identifier
  name: string,                      // Display name
  subtitle: string,                  // Short description
  description: string,               // Full description
  templateEnumMap: Object,           // Template ID to enum mapping
  parameters: Object,                // Parameter definitions
  parameterGroups: Array,            // UI grouping information
  contractParametersGroups: Array,   // Contract method grouping
  comingSoon: boolean               // Availability flag
}
```

### Examples

```javascript
// Get all available strategies
const strategies = getAvailableStrategies();
// Returns: [
//   {
//     id: "bob",
//     name: "Bob",
//     subtitle: "Range-bound trading",
//     description: "...",
//     templateEnumMap: { conservative: 0, balanced: 1, ... },
//     parameters: { ... },
//     parameterGroups: [...],
//     comingSoon: false
//   },
//   ...
// ]

// Filter active strategies only
const activeStrategies = getAvailableStrategies()
  .filter(strategy => !strategy.comingSoon);
```

### Side Effects
None - Pure function

---

## getStrategyDetails

Get detailed information about a specific strategy.

### Signature
```javascript
getStrategyDetails(strategyId: string): Object | null
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| strategyId | `string` | Yes | - | ID of the strategy to get details for (e.g., 'bob', 'parris') |

### Returns

`Object | null` - Strategy details object with complete configuration - null if not found

### Return Object Structure
```javascript
{
  id: string,                    // Strategy identifier
  name: string,                  // Display name
  subtitle: string,              // Short description
  description: string,           // Full description
  icon: string,                  // Strategy icon/emoji
  color: string,                 // Primary color
  borderColor: string,           // Border color
  textColor: string,             // Text color
  supportedTokens: Object,       // Token symbol to boolean map
  minTokens: number,             // Minimum tokens required
  maxTokens: number,             // Maximum tokens allowed
  minPlatforms: number,          // Minimum platforms required
  maxPlatforms: number,          // Maximum platforms allowed
  minPositions: number,          // Minimum positions required
  maxPositions: number,          // Maximum positions allowed
  parameterGroups: Array         // Parameter grouping info
}
```

### Examples

```javascript
// Get Bob strategy details
const bobStrategy = getStrategyDetails('bob');
// Returns: {
//   id: "bob",
//   name: "Bob",
//   subtitle: "Range-bound trading",
//   description: "...",
//   icon: "📊",
//   color: "#4CAF50",
//   supportedTokens: { ETH: true, USDC: true, ... },
//   minTokens: 2,
//   maxTokens: 5,
//   ...
// }

// Handle unknown strategy
const strategy = getStrategyDetails('unknown');
if (!strategy) {
  console.error('Strategy not found');
}
```

### Side Effects
None - Pure function

---

## getStrategyTemplates

Get predefined templates for a specific strategy.

### Signature
```javascript
getStrategyTemplates(strategyId: string): Array<Object>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| strategyId | `string` | Yes | - | ID of the strategy |

### Returns

`Array<Object>` - Array of template objects with predefined parameter sets

### Return Array Item Structure
```javascript
{
  id: string,              // Template identifier
  name: string,            // Template display name
  description?: string,    // Template description
  defaults: Object         // Default parameter values
}
```

### Examples

```javascript
// Get Bob strategy templates
const templates = getStrategyTemplates('bob');
// Returns: [
//   { id: "conservative", name: "Conservative", defaults: {...} },
//   { id: "balanced", name: "Balanced", defaults: {...} },
//   { id: "aggressive", name: "Aggressive", defaults: {...} }
// ]

// Build template selector
const templateOptions = getStrategyTemplates(strategyId).map(template => ({
  value: template.id,
  label: template.name,
  description: template.description
}));
```

### Side Effects
None - Pure function

---

## getTemplateDefaults

Get default parameter values for a specific template.

### Signature
```javascript
getTemplateDefaults(strategyId: string, templateId: string): Object
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| strategyId | `string` | Yes | - | ID of the strategy |
| templateId | `string` | Yes | - | ID of the template (or 'custom' for base defaults) |

### Returns

`Object` - Default parameter values for the template

### Examples

```javascript
// Get conservative template defaults for Bob
const defaults = getTemplateDefaults('bob', 'conservative');
// Returns: {
//   targetRangeUpper: 105,
//   targetRangeLower: 95,
//   rebalanceThresholdUpper: 2,
//   ...
// }

// Get custom/base defaults
const customDefaults = getTemplateDefaults('bob', 'custom');
// Returns default values from parameter definitions
```

### Side Effects
None - Pure function

---

## getDefaultParams

Get the base default parameters for a strategy.

### Signature
```javascript
getDefaultParams(strategyId: string): Object
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| strategyId | `string` | Yes | - | ID of the strategy |

### Returns

`Object` - Object with default parameter values from base configuration

### Examples

```javascript
// Get base defaults for a strategy
const defaults = getDefaultParams('parris');
// Returns all parameter default values
```

### Side Effects
None - Pure function

---

## getStrategyParameters

Get parameter definitions for a strategy.

### Signature
```javascript
getStrategyParameters(strategyId: string): Object
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| strategyId | `string` | Yes | - | ID of the strategy |

### Returns

`Object` - Object with parameter definitions keyed by parameter ID

### Return Object Structure
```javascript
{
  [parameterId]: {
    name: string,              // Display name
    type: string,              // Input type
    defaultValue: any,         // Default value
    min?: number,              // Minimum value
    max?: number,              // Maximum value
    suffix?: string,           // Display suffix
    prefix?: string,           // Display prefix
    group?: number,            // UI group ID
    contractGroup?: string,    // Contract method group
    conditionalOn?: string,    // Conditional parameter ID
    conditionalValue?: any,    // Required value for display
    options?: Array            // Select options
  }
}
```

### Examples

```javascript
// Get all parameter definitions for Bob
const params = getStrategyParameters('bob');
// Returns: {
//   targetRangeUpper: {
//     name: "Target Range Upper",
//     type: "percent",
//     defaultValue: 102,
//     min: 100,
//     max: 200,
//     ...
//   },
//   ...
// }
```

### Side Effects
None - Pure function

---

## getStrategyParametersByGroup

Get parameters filtered by UI group.

### Signature
```javascript
getStrategyParametersByGroup(strategyId: string, groupId: number): Object
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| strategyId | `string` | Yes | - | ID of the strategy |
| groupId | `number` | Yes | - | Group ID to filter by |

### Returns

`Object` - Object with parameter definitions for the specified group

### Examples

```javascript
// Get all parameters in group 0 (Range Settings)
const rangeParams = getStrategyParametersByGroup('bob', 0);
// Returns parameters that belong to group 0

// Build grouped parameter form
strategy.parameterGroups.forEach(group => {
  const params = getStrategyParametersByGroup(strategyId, group.id);
  renderParameterGroup(group.title, params);
});
```

### Side Effects
None - Pure function

---

## getStrategyParametersByContractGroup

Get parameters filtered by contract method group.

### Signature
```javascript
getStrategyParametersByContractGroup(strategyId: string, contractGroup: string): Object
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| strategyId | `string` | Yes | - | ID of the strategy |
| contractGroup | `string` | Yes | - | Contract group ID (e.g., 'rangeParams', 'feeParams') |

### Returns

`Object` - Object with parameter definitions for the contract group

### Examples

```javascript
// Get all range-related parameters
const rangeParams = getStrategyParametersByContractGroup('bob', 'rangeParams');
// Returns parameters that map to the same contract method

// Prepare parameters for contract call
const feeParams = getStrategyParametersByContractGroup(strategyId, 'feeParams');
const values = Object.keys(feeParams).map(paramId => userValues[paramId]);
```

### Side Effects
None - Pure function

---

## validateStrategyParams

Validate strategy parameter values.

### Signature
```javascript
validateStrategyParams(strategyId: string, params: Object): {isValid: boolean, errors: Object}
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| strategyId | `string` | Yes | - | ID of the strategy |
| params | `Object` | Yes | - | Parameter values to validate (key-value pairs where keys are parameter IDs) |

### Returns

`{isValid: boolean, errors: Object}` - Validation result with isValid flag and error messages

### Return Object Structure
```javascript
{
  isValid: boolean,       // Whether all parameters are valid
  errors: {              // Error messages keyed by parameter ID
    [parameterId]: string,
    _general?: string    // General errors not tied to specific parameter
  }
}
```

### Examples

```javascript
// Validate user input
const validation = validateStrategyParams('bob', {
  targetRangeUpper: 110,
  targetRangeLower: 90,
  rebalanceThresholdUpper: 5
});

if (!validation.isValid) {
  console.error('Validation errors:', validation.errors);
  // errors: { targetRangeLower: "Target Range Lower must be at least 95%" }
}

// Handle conditional parameters
const params = {
  feeReinvestment: true,
  reinvestmentTrigger: 100 // Only validated if feeReinvestment is true
};
const result = validateStrategyParams('bob', params);
```

### Validation Rules

- Required parameters must have values
- Numeric parameters must be within min/max bounds
- Select parameters must match available options
- Conditional parameters are only validated when their condition is met

### Side Effects
None - Pure function

---

## getParameterSetterMethod

Get the contract setter method name for a parameter group.

### Signature
```javascript
getParameterSetterMethod(strategyId: string, contractGroupId: string): string | null
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| strategyId | `string` | Yes | - | ID of the strategy |
| contractGroupId | `string` | Yes | - | Contract group ID |

### Returns

`string | null` - Contract setter method name - null if not found

### Examples

```javascript
// Get setter method for range parameters
const method = getParameterSetterMethod('bob', 'rangeParams');
// Returns: "setRangeParameters"

// Use to call contract method
const setterMethod = getParameterSetterMethod(strategyId, groupId);
if (setterMethod) {
  await contract[setterMethod](...parameterValues);
}
```

### Side Effects
None - Pure function

---

## shouldShowParameter

Check if a parameter should be displayed based on conditional logic.

### Signature
```javascript
shouldShowParameter(paramConfig: Object, currentParams: Object): boolean
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| paramConfig | `Object` | Yes | - | Parameter configuration object |
| paramConfig.conditionalOn | `string` | No | - | Parameter ID this depends on |
| paramConfig.conditionalValue | `any` | No | - | Value required for this parameter to show |
| currentParams | `Object` | Yes | - | Current parameter values (key-value pairs) |

### Returns

`boolean` - Whether the parameter should be shown

### Examples

```javascript
// Check if reinvestment trigger should be shown
const paramConfig = {
  conditionalOn: 'feeReinvestment',
  conditionalValue: true
};
const show = shouldShowParameter(paramConfig, { feeReinvestment: true });
// Returns: true

// Hide parameter when condition not met
const show = shouldShowParameter(paramConfig, { feeReinvestment: false });
// Returns: false
```

### Side Effects
None - Pure function

---

## getAllStrategyIds

Get all configured strategy IDs.

### Signature
```javascript
getAllStrategyIds(): Array<string>
```

### Parameters

None

### Returns

`Array<string>` - Array of all configured strategy IDs

### Examples

```javascript
// Get all strategy IDs
const ids = getAllStrategyIds();
// Returns: ['none', 'bob', 'parris', 'fed', ...]

// Check if strategy exists
if (getAllStrategyIds().includes(userStrategy)) {
  loadStrategy(userStrategy);
}
```

### Side Effects
None - Pure function

---

## getStrategyTokens

Get supported tokens for a strategy based on tokenSupport configuration.

### Signature
```javascript
getStrategyTokens(strategyId: string): Object
```

### Parameters

- `strategyId` (string): ID of the strategy (e.g., 'bob', 'parris', 'fed')

### Returns

`Object` - Object with supported token symbols as keys and token configuration objects as values

### Throws

- `Error` - If strategy not found
- `Error` - If strategyId is invalid (null, undefined, non-string, or empty)
- `Error` - If tokenSupport configuration is missing or invalid
- `Error` - If tokenSupport is "custom" but supportedTokens is invalid or empty

### Examples

#### Get tokens for strategy that supports all tokens
```javascript
import { getStrategyTokens } from 'fum_library/helpers/strategyHelpers';

const tokens = getStrategyTokens('bob');
// Returns: { WETH: { name: "Wrapped Ether", ... }, USDC: { ... }, ... }
```

#### Get tokens for stablecoin-only strategy
```javascript
const stableTokens = getStrategyTokens('fed');
// Returns: { USDC: { ... }, USDT: { ... }, DAI: { ... } }
```

#### Get tokens for custom strategy
```javascript
const customTokens = getStrategyTokens('customStrategy');
// Returns strategy's specific supportedTokens object
```

### Token Support Types

The function handles three types of token support based on the strategy's `tokenSupport` field:

- **"all"**: Returns all available tokens from the token configuration
- **"stablecoins"**: Returns only stablecoin tokens (USDC, USDT, DAI, etc.)
- **"custom"**: Returns the strategy's specific `supportedTokens` object

### Backward Compatibility

The function maintains backward compatibility with older strategy configurations that use `supportedTokens` directly without `tokenSupport`.

---

## strategySupportsTokens

Check if a strategy supports specific tokens.

### Signature
```javascript
strategySupportsTokens(strategyId: string, tokenSymbols: Array<string>): boolean
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| strategyId | `string` | Yes | - | ID of the strategy |
| tokenSymbols | `Array<string>` | Yes | - | Array of token symbols to check |

### Returns

`boolean` - Whether the strategy supports all specified tokens

### Examples

```javascript
// Check if Bob supports ETH/USDC pair
const supported = strategySupportsTokens('bob', ['ETH', 'USDC']);
// Returns: true

// Filter strategies by token support
const compatibleStrategies = getAvailableStrategies()
  .filter(strategy => 
    strategySupportsTokens(strategy.id, selectedTokens)
  );
```

### Side Effects
None - Pure function

---

## formatParameterValue

Format parameter values for user display.

### Signature
```javascript
formatParameterValue(value: any, paramConfig: Object): string
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| value | `any` | Yes | - | Parameter value to format |
| paramConfig | `Object` | Yes | - | Parameter configuration object |
| paramConfig.type | `string` | Yes | - | Parameter type (boolean, select, number, percent, fiat-currency) |
| paramConfig.options | `Array` | No | - | Options for select type |
| paramConfig.suffix | `string` | No | - | Unit suffix for display |
| paramConfig.prefix | `string` | No | - | Unit prefix for display |

### Returns

`string` - Formatted value for user display

### Examples

```javascript
// Format boolean
formatParameterValue(true, { type: 'boolean' }); // "Yes"

// Format percent
formatParameterValue(5.5, { type: 'percent' }); // "5.5%"

// Format currency
formatParameterValue(100, { type: 'fiat-currency', prefix: '$' }); // "$100"

// Format select option
formatParameterValue('high', {
  type: 'select',
  options: [{ value: 'high', label: 'High Priority' }]
}); // "High Priority"
```

### Side Effects
None - Pure function

---

## validateTokensForStrategy

Validate if vault tokens match strategy configuration.

### Signature
```javascript
validateTokensForStrategy(vaultTokens: Object, strategyTokens: Array<string>): Array<string>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| vaultTokens | `Object` | Yes | - | Object containing token balances in the vault (keyed by token symbol) |
| strategyTokens | `Array<string>` | Yes | - | Array of token symbols configured in the strategy |

### Returns

`Array<string>` - Array of validation messages (empty if validation passes)

### Examples

```javascript
// Validate vault tokens against strategy
const vaultTokens = { ETH: 1.5, USDC: 1000, DAI: 500 };
const strategyTokens = ['ETH', 'USDC'];
const messages = validateTokensForStrategy(vaultTokens, strategyTokens);
// Returns: ["The following tokens in your vault are not part of your strategy: DAI..."]

// All tokens match
const vaultTokens = { ETH: 1.5, USDC: 1000 };
const strategyTokens = ['ETH', 'USDC'];
const messages = validateTokensForStrategy(vaultTokens, strategyTokens);
// Returns: [] (no messages)
```

### Side Effects
None - Pure function

---

## Type Definitions

```typescript
// For TypeScript users
interface StrategyConfig {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  icon?: string;
  color?: string;
  borderColor?: string;
  textColor?: string;
  supportedTokens?: Record<string, boolean>;
  minTokens?: number;
  maxTokens?: number;
  minPlatforms?: number;
  maxPlatforms?: number;
  minPositions?: number;
  maxPositions?: number;
  parameters?: Record<string, ParameterConfig>;
  templates?: Template[];
  parameterGroups?: ParameterGroup[];
  contractParametersGroups?: ContractGroup[];
  comingSoon?: boolean;
}

interface ParameterConfig {
  name: string;
  type: 'number' | 'percent' | 'boolean' | 'select' | 'fiat-currency';
  defaultValue: any;
  min?: number;
  max?: number;
  suffix?: string;
  prefix?: string;
  group?: number;
  contractGroup?: string;
  conditionalOn?: string;
  conditionalValue?: any;
  options?: SelectOption[];
}

interface Template {
  id: string;
  name: string;
  description?: string;
  defaults: Record<string, any>;
}

interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}
```

## Common Patterns

### Strategy Selection Workflow
```javascript
// 1. Get available strategies for selected tokens
const compatibleStrategies = getAvailableStrategies()
  .filter(strategy => 
    !strategy.comingSoon &&
    strategySupportsTokens(strategy.id, selectedTokens)
  );

// 2. User selects strategy
const strategyDetails = getStrategyDetails(selectedStrategyId);

// 3. Show templates
const templates = getStrategyTemplates(selectedStrategyId);

// 4. Load template defaults
const params = getTemplateDefaults(selectedStrategyId, selectedTemplateId);

// 5. Validate before submission
const validation = validateStrategyParams(selectedStrategyId, params);
```

### Dynamic Parameter Form
```javascript
// Build parameter form with conditional logic
function renderStrategyForm(strategyId, currentValues) {
  const parameters = getStrategyParameters(strategyId);
  const groups = getStrategyDetails(strategyId).parameterGroups;
  
  return groups.map(group => {
    const groupParams = getStrategyParametersByGroup(strategyId, group.id);
    
    return Object.entries(groupParams)
      .filter(([paramId, config]) => 
        shouldShowParameter(config, currentValues)
      )
      .map(([paramId, config]) => ({
        id: paramId,
        ...config,
        value: currentValues[paramId] || config.defaultValue,
        formatted: formatParameterValue(currentValues[paramId], config)
      }));
  });
}
```

## See Also

- [`vaultHelpers`](./vault-helpers.md) - Vault and strategy integration
- [`tokenHelpers`](./token-helpers.md) - Token management utilities
- [`formatHelpers`](./format-helpers.md) - Value formatting utilities
- [Strategy Documentation](../../strategies/) - Detailed strategy descriptions