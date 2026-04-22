<!-- Source: src/helpers/strategyHelpers.js -->
# Strategy Helpers API

Strategy configuration utilities for managing FUM's automation strategies, their parameters, and templates.

## Overview

The Strategy Helpers module manages strategy configurations defined in `configs/strategies.js`. It supports strategy discovery, template/default parameter lookups, validation, conditional parameter visibility, token compatibility checks, and on-chain parameter serialization.

FUM currently defines `bob` (BabyStepsStrategy — shipped), plus a sentinel `none` entry.

All lookup functions use fail-fast validation — invalid inputs and missing data throw descriptive errors.

## Exports

```javascript
import {
  // Validation
  validateIdString,
  // Discovery
  lookupAllStrategyIds,
  lookupAvailableStrategies,
  getStrategyDetails,
  // Templates / defaults
  getStrategyTemplates,
  getTemplateDefaults,
  getParamDefaultValues,
  // Parameter introspection
  getStrategyParameters,
  getStrategyParametersByGroup,
  getStrategyParametersByContractGroup,
  getParameterSetterMethod,
  shouldShowParameter,
  // Validation / formatting
  validateStrategyParams,
  formatParameterValue,
  // Token/position checks
  getStrategyTokens,
  validateTokensForStrategy,
  validatePositionsForStrategy,
  // On-chain serialization
  mapStrategyParameters,
} from 'fum_library/helpers/strategyHelpers';
```

## Functions

### validateIdString

Throws if `id` is missing, not a string, or empty. Exported for reuse by callers.

```javascript
validateIdString(id: any): void
```

---

### lookupAllStrategyIds

All configured strategy IDs, including the sentinel `'none'`.

```javascript
lookupAllStrategyIds(): string[]
```

Example: `['none', 'bob']`.

---

### lookupAvailableStrategies

All strategy configs excluding `'none'`. Each entry contains a subset of fields useful for selector UIs:

```javascript
lookupAvailableStrategies(): Array<{
  id: string,
  name: string,
  subtitle: string,
  description: string,
  templateEnumMap: Object,
  parameters: Object,
  parameterGroups: Array,
  contractParametersGroups: Object
}>
```

---

### getStrategyDetails

Full strategy configuration for a specific strategy, with validated required fields (`id`, `name`, `subtitle`, `description`, `icon`, `color`, `borderColor`, `textColor`, min/max token/platform/position counts, `parameters`, `strategyProperties`, `tokenSupport`).

```javascript
getStrategyDetails(strategyId: string): Object
```

**Throws** if the strategy is not found or required properties are missing/invalid.

---

### getStrategyTemplates

Predefined template configurations for a strategy.

```javascript
getStrategyTemplates(strategyId: string): Array<{
  id: string,
  name: string,
  description?: string,
  defaults: Object
}>
```

Example for `'bob'`: `[{ id: 'conservative', ... }, { id: 'balanced', ... }, { id: 'aggressive', ... }]`.

---

### getTemplateDefaults

Default parameter values for a specific template. Pass `'custom'` to get the base defaults from the parameter schema (useful when the user wants a fresh slate instead of a predefined template).

```javascript
getTemplateDefaults(strategyId: string, templateId: string): Object
```

---

### getParamDefaultValues

Base default parameter values from the strategy's parameter schema (equivalent to `getTemplateDefaults(strategyId, 'custom')`).

```javascript
getParamDefaultValues(strategyId: string): Object
```

---

### getStrategyParameters

All parameter definitions for a strategy, keyed by parameter ID.

```javascript
getStrategyParameters(strategyId: string): Object
```

Each parameter entry includes:

```javascript
{
  name: string,
  type: 'number' | 'percent' | 'boolean' | 'select' | 'fiat-currency',
  defaultValue: any,
  min?: number,
  max?: number,
  suffix?: string,
  prefix?: string,
  group?: number,
  contractGroup?: string,
  conditionalOn?: string,
  conditionalValue?: any,
  options?: Array<{ value, label }>
}
```

---

### getStrategyParametersByGroup

Parameters filtered by UI group ID.

```javascript
getStrategyParametersByGroup(strategyId: string, groupId: number): Object
```

---

### getStrategyParametersByContractGroup

Parameters filtered by contract method group (for on-chain parameter updates).

```javascript
getStrategyParametersByContractGroup(strategyId: string, contractGroup: string): Object
```

---

### getParameterSetterMethod

Contract setter method name for a parameter group.

```javascript
getParameterSetterMethod(strategyId: string, contractGroupId: string): string
```

Example: `getParameterSetterMethod('bob', 'rangeParams')` → `'setRangeParameters'`.

**Throws** if the strategy is not found, `contractParametersGroups` is missing, the group is not found, or its `setterMethod` is not configured.

---

### shouldShowParameter

Check if a parameter should be displayed based on conditional logic.

```javascript
shouldShowParameter(conditionalParam: Object, testValueSet: Object): boolean
```

Returns `true` if `conditionalParam.conditionalOn` is absent (unconditional), or if `testValueSet[conditionalOn] === conditionalParam.conditionalValue`. Defensively returns `false` for invalid inputs instead of throwing.

---

### validateStrategyParams

Validate a set of parameter values against a strategy's rules.

```javascript
validateStrategyParams(strategyId: string, params: Object): {
  isValid: boolean,
  errors: { [parameterId: string]: string, _general?: string }
}
```

Validation:
- Required parameters must have values
- Numeric parameters must be within `min`/`max`
- Select parameters must match available options
- Conditional parameters are only validated when their condition is met

---

### formatParameterValue

Format a parameter value for user display.

```javascript
formatParameterValue(value: any, paramConfig: Object): string
```

| `paramConfig.type` | Example | Output |
|---|---|---|
| `'boolean'` | `formatParameterValue(true, { type: 'boolean' })` | `'Yes'` |
| `'percent'` | `formatParameterValue(5.5, { type: 'percent' })` | `'5.5%'` |
| `'fiat-currency'` | `formatParameterValue(100, { type: 'fiat-currency', prefix: '$' })` | `'$100'` |
| `'select'` | `formatParameterValue('high', { type: 'select', options: [...] })` | matching `option.label` |

---

### getStrategyTokens

Supported tokens for a strategy, derived from the strategy's `tokenSupport` field.

```javascript
getStrategyTokens(strategyId: string): Object
```

| `tokenSupport` value | Result |
|---|---|
| `'all'` | All configured tokens |
| `'stablecoins'` | Only stablecoins |
| `'custom'` | Strategy's own `supportedTokens` object |

Returns an object keyed by token symbol. `WETH` is filtered out — strategies expose `ETH`, and the automation service handles wrapping.

**Throws** if the strategy isn't found, `tokenSupport` is missing/invalid, or `'custom'` is specified but `supportedTokens` is absent/empty.

---

### validateTokensForStrategy

Compare vault tokens against the strategy's allowed tokens.

```javascript
validateTokensForStrategy(
  vaultTokens: Object,
  strategyTokens: string[],
  chainId: number
): string[]
```

Returns an array of user-facing validation messages. Empty array on success.

> The source signature includes `chainId` as a third parameter — used to resolve chain-specific addresses when comparing vault tokens.

---

### validatePositionsForStrategy

Validate vault positions against the strategy's pool/token compatibility rules.

```javascript
validatePositionsForStrategy(
  vaultPositions: Object,
  pools: Object,
  strategyTokens: string[],
  chainId: number
): string[]
```

Returns an array of validation messages (empty on success).

---

### mapStrategyParameters

Decode on-chain parameter bytes into the strategy's named parameter schema.

```javascript
mapStrategyParameters(strategyId: string, rawBytes: string): Object
```

Used when reading strategy parameters back from the contract. Inverse of the encoding performed by the contract-group setter methods.

---

## Common Patterns

### Strategy Selection Workflow

```javascript
import {
  lookupAvailableStrategies,
  getStrategyDetails,
  getStrategyTemplates,
  getTemplateDefaults,
  validateStrategyParams,
} from 'fum_library/helpers/strategyHelpers';

// 1. Show available strategies
const strategies = lookupAvailableStrategies();

// 2. User selects a strategy
const details = getStrategyDetails(selectedStrategyId);

// 3. Show templates
const templates = getStrategyTemplates(selectedStrategyId);

// 4. Load template defaults
const params = getTemplateDefaults(selectedStrategyId, selectedTemplateId);

// 5. Validate before submission
const { isValid, errors } = validateStrategyParams(selectedStrategyId, params);
```

### Dynamic Parameter Form with Conditional Logic

```javascript
import {
  getStrategyParameters,
  getStrategyDetails,
  getStrategyParametersByGroup,
  shouldShowParameter,
  formatParameterValue,
} from 'fum_library/helpers/strategyHelpers';

function renderStrategyForm(strategyId, currentValues) {
  const groups = getStrategyDetails(strategyId).parameterGroups;

  return groups.map(group => {
    const groupParams = getStrategyParametersByGroup(strategyId, group.id);

    return Object.entries(groupParams)
      .filter(([, config]) => shouldShowParameter(config, currentValues))
      .map(([paramId, config]) => ({
        id: paramId,
        ...config,
        value: currentValues[paramId] ?? config.defaultValue,
        formatted: formatParameterValue(currentValues[paramId], config)
      }));
  });
}
```

## See Also

- [`tokenHelpers`](./token-helpers.md) — Token management utilities (used internally by `getStrategyTokens`, `validateTokensForStrategy`)
- [`formatHelpers`](./format-helpers.md) — Value formatting utilities
- [`platformHelpers`](./platform-helpers.md) — Platform metadata utilities
