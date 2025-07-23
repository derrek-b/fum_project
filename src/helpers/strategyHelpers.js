/**
 * @module helpers/strategyHelpers
 * @description Strategy configuration utilities for managing trading strategies, parameters, and templates.
 * Provides functions to query strategies, validate parameters, and manage strategy configurations.
 * @since 1.0.0
 */

import strategies from '../configs/strategies.js';

/**
 * Validate strategyId parameter using established validation pattern
 * @param {any} strategyId - The value to validate as a strategyId
 * @throws {Error} If strategyId is not a valid string
 */
export function validateStrategyId(strategyId) {
  if (strategyId === null || strategyId === undefined) {
    throw new Error('strategyId parameter is required');
  }

  if (typeof strategyId !== 'string') {
    throw new Error('strategyId must be a string');
  }

  if (strategyId === '') {
    throw new Error('strategyId cannot be empty');
  }
}

/**
 * Validate templateEnumMap configuration for a strategy
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @param {Object} templateEnumMap - The templateEnumMap to validate
 * @param {Array} templates - The templates array to validate against
 * @throws {Error} Throws error if templateEnumMap is invalid
 * @example
 * // Validate templateEnumMap for a strategy
 * validateTemplateEnumMap('bob', strategy.templateEnumMap, strategy.templates);
 * @since 1.0.0
 */
export function validateTemplateEnumMap(strategyId, templateEnumMap, templates) {
  // Check templateEnumMap exists and is object
  if (!templateEnumMap || typeof templateEnumMap !== 'object' || Array.isArray(templateEnumMap)) {
    throw new Error(`Strategy ${strategyId} templateEnumMap must be an object`);
  }

  // Check templates exists and is object
  if (!templates || typeof templates !== 'object' || Array.isArray(templates)) {
    throw new Error(`Strategy ${strategyId} templates must be an object`);
  }

  const enumKeys = Object.keys(templateEnumMap);
  const enumValues = Object.values(templateEnumMap);
  const templateIds = Object.keys(templates);

  // Rule 1: Must have 'custom' template with enum 0
  if (templateEnumMap['custom'] !== 0) {
    throw new Error(`Strategy ${strategyId} templateEnumMap must have 'custom': 0`);
  }

  // Rule 2: All enum values must be numbers
  enumValues.forEach((value, index) => {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new Error(`Strategy ${strategyId} templateEnumMap value '${value}' at key '${enumKeys[index]}' must be an integer`);
    }
  });

  // Rule 3: Enum values must be unique
  const uniqueValues = [...new Set(enumValues)];
  if (uniqueValues.length !== enumValues.length) {
    throw new Error(`Strategy ${strategyId} templateEnumMap values must be unique`);
  }

  // Rule 4: Enum values must be sequential starting from 0
  const sortedValues = [...enumValues].sort((a, b) => a - b);
  for (let i = 0; i < sortedValues.length; i++) {
    if (sortedValues[i] !== i) {
      throw new Error(`Strategy ${strategyId} templateEnumMap values must be sequential starting from 0, got [${sortedValues.join(', ')}]`);
    }
  }

  // Rule 5: Each enum entry must have corresponding template
  enumKeys.forEach(enumKey => {
    if (!templateIds.includes(enumKey)) {
      throw new Error(`Strategy ${strategyId} templateEnumMap key '${enumKey}' missing corresponding template`);
    }
  });
}

/**
 * Base parameter configuration validator
 * Validates properties common to all parameter types
 * @memberof module:helpers/strategyHelpers
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @param {Object} parameterGroups - Parameter groups to validate group dependency
 * @param {Object} contractParametersGroups - Contract parameter groups to validate contractGroup dependency
 * @throws {Error} If required properties are missing or invalid
 * @example
 * // Validate base properties
 * validateParameterBase('targetRangeUpper', paramConfig, strategy.parameterGroups, strategy.contractParametersGroups);
 * @since 1.0.0
 */
export function validateParameterBase(paramId, paramConfig, parameterGroups, contractParametersGroups) {
  // Validate type
  if (!paramConfig.type || typeof paramConfig.type !== 'string') {
    throw new Error(`Parameter ${paramId} missing valid type`);
  }

  // Validate name
  if (!paramConfig.name || typeof paramConfig.name !== 'string' || paramConfig.name.trim() === '') {
    throw new Error(`Parameter ${paramId} missing valid name`);
  }

  // Validate description
  if (!paramConfig.description || typeof paramConfig.description !== 'string' || paramConfig.description.trim() === '') {
    throw new Error(`Parameter ${paramId} missing valid description`);
  }

  // Validate defaultValue exists (can be any type including false, 0, etc)
  if (paramConfig.defaultValue === undefined) {
    throw new Error(`Parameter ${paramId} missing defaultValue`);
  }

  // Validate group
  if (typeof paramConfig.group !== 'number' || !Number.isFinite(paramConfig.group) || paramConfig.group < 0) {
    throw new Error(`Parameter ${paramId} missing valid group number`);
  }

  // Validate contractGroup
  if (!paramConfig.contractGroup || typeof paramConfig.contractGroup !== 'string' || paramConfig.contractGroup.trim() === '') {
    throw new Error(`Parameter ${paramId} missing valid contractGroup`);
  }

  // Validate group dependencies if groups are provided
  if (parameterGroups && contractParametersGroups) {
    const validGroupIds = Object.keys(parameterGroups);
    const validContractGroupIds = Object.keys(contractParametersGroups);

    // Validate .group references a valid parameterGroup
    const groupIdStr = String(paramConfig.group);
    if (!validGroupIds.includes(groupIdStr)) {
      throw new Error(`Parameter ${paramId} references unknown parameterGroup '${paramConfig.group}'. Available groups: [${validGroupIds.join(', ')}]`);
    }

    // Validate .contractGroup references a valid contractParametersGroup
    if (!validContractGroupIds.includes(paramConfig.contractGroup)) {
      throw new Error(`Parameter ${paramId} references unknown contractParametersGroup '${paramConfig.contractGroup}'. Available groups: [${validContractGroupIds.join(', ')}]`);
    }
  }

  // Validate conditional properties (if one exists, both must exist)
  if (paramConfig.conditionalOn !== undefined || paramConfig.conditionalValue !== undefined) {
    // If either exists, both must exist
    if (!paramConfig.conditionalOn || typeof paramConfig.conditionalOn !== 'string' || paramConfig.conditionalOn.trim() === '') {
      throw new Error(`Parameter ${paramId} has conditionalValue but missing valid conditionalOn`);
    }

    // conditionalValue can be any type (boolean, string, number, etc) but must exist
    if (paramConfig.conditionalValue === undefined) {
      throw new Error(`Parameter ${paramId} has conditionalOn but missing conditionalValue`);
    }
  }
}

/**
 * Validate boolean parameter configuration
 * @memberof module:helpers/strategyHelpers
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @throws {Error} If parameter is invalid
 * @example
 * // Validate boolean parameter
 * validateBooleanParameter('feeReinvestment', {
 *   name: "Reinvest Fees",
 *   description: "Automatically reinvest collected fees",
 *   type: "boolean",
 *   defaultValue: true,
 *   group: 1,
 *   contractGroup: "fee"
 * });
 * @since 1.0.0
 */
export function validateBooleanParameter(paramId, paramConfig, parameterGroups, contractParametersGroups) {
  // First validate base properties
  validateParameterBase(paramId, paramConfig, parameterGroups, contractParametersGroups);

  // Validate type is boolean
  if (paramConfig.type !== 'boolean') {
    throw new Error(`Parameter ${paramId} type must be 'boolean', got '${paramConfig.type}'`);
  }

  // Validate defaultValue is boolean
  if (typeof paramConfig.defaultValue !== 'boolean') {
    throw new Error(`Parameter ${paramId} defaultValue must be boolean, got ${typeof paramConfig.defaultValue}`);
  }
}

/**
 * Validate token-deposits parameter configuration
 * @memberof module:helpers/strategyHelpers
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @throws {Error} If parameter is invalid
 * @example
 * // Validate token-deposits parameter
 * validateTokenDepositsParameter('tokenDeposits', {
 *   name: "Token Deposits",
 *   description: "Select tokens and amounts to deposit into your vault",
 *   type: "token-deposits",
 *   defaultValue: { tokens: [], amounts: {} },
 *   group: 0,
 *   contractGroup: "manual"
 * });
 * @since 1.0.0
 */
export function validateTokenDepositsParameter(paramId, paramConfig, parameterGroups, contractParametersGroups) {
  // First validate base properties
  validateParameterBase(paramId, paramConfig, parameterGroups, contractParametersGroups);

  // Validate type is token-deposits
  if (paramConfig.type !== 'token-deposits') {
    throw new Error(`Parameter ${paramId} type must be 'token-deposits', got '${paramConfig.type}'`);
  }

  // Validate defaultValue is object with correct structure
  if (!paramConfig.defaultValue || typeof paramConfig.defaultValue !== 'object' || Array.isArray(paramConfig.defaultValue)) {
    throw new Error(`Parameter ${paramId} defaultValue must be an object`);
  }

  // Validate tokens property
  if (!Array.isArray(paramConfig.defaultValue.tokens)) {
    throw new Error(`Parameter ${paramId} defaultValue.tokens must be an array`);
  }

  // Validate amounts property
  if (!paramConfig.defaultValue.amounts || typeof paramConfig.defaultValue.amounts !== 'object' || Array.isArray(paramConfig.defaultValue.amounts)) {
    throw new Error(`Parameter ${paramId} defaultValue.amounts must be an object`);
  }
}

/**
 * Validate percent parameter configuration
 * @memberof module:helpers/strategyHelpers
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @throws {Error} If parameter is invalid
 * @example
 * // Validate percent parameter
 * validatePercentParameter('targetRangeUpper', {
 *   name: "Upper Range",
 *   description: "Range percentage above current price",
 *   type: "percent",
 *   defaultValue: 5.0,
 *   group: 0,
 *   contractGroup: "range",
 *   min: 0.1,
 *   max: 20.0,
 *   step: 0.1,
 *   suffix: "%"
 * });
 * @since 1.0.0
 */
export function validatePercentParameter(paramId, paramConfig, parameterGroups, contractParametersGroups) {
  // First validate base properties
  validateParameterBase(paramId, paramConfig, parameterGroups, contractParametersGroups);

  // Validate type is percent
  if (paramConfig.type !== 'percent') {
    throw new Error(`Parameter ${paramId} type must be 'percent', got '${paramConfig.type}'`);
  }

  // Validate defaultValue is number
  if (typeof paramConfig.defaultValue !== 'number' || !Number.isFinite(paramConfig.defaultValue)) {
    throw new Error(`Parameter ${paramId} defaultValue must be a finite number`);
  }

  // Validate min (required for percent, must be >= 0)
  if (typeof paramConfig.min !== 'number' || !Number.isFinite(paramConfig.min) || paramConfig.min < 0) {
    throw new Error(`Parameter ${paramId} min must be a finite number >= 0`);
  }

  // Validate max (required for percent)
  if (typeof paramConfig.max !== 'number' || !Number.isFinite(paramConfig.max)) {
    throw new Error(`Parameter ${paramId} max must be a finite number`);
  }

  // Validate min < max
  if (paramConfig.min >= paramConfig.max) {
    throw new Error(`Parameter ${paramId} min (${paramConfig.min}) must be less than max (${paramConfig.max})`);
  }

  // Validate step (required for percent, must be > 0)
  if (typeof paramConfig.step !== 'number' || !Number.isFinite(paramConfig.step) || paramConfig.step <= 0) {
    throw new Error(`Parameter ${paramId} step must be a positive finite number`);
  }

  // Validate defaultValue is within range
  if (paramConfig.defaultValue < paramConfig.min || paramConfig.defaultValue > paramConfig.max) {
    throw new Error(`Parameter ${paramId} defaultValue (${paramConfig.defaultValue}) must be between min (${paramConfig.min}) and max (${paramConfig.max})`);
  }

  // Validate defaultValue aligns with step (with floating point tolerance)
  const offset = paramConfig.defaultValue - paramConfig.min;
  const steps = offset / paramConfig.step;
  const tolerance = 1e-10;
  if (Math.abs(steps - Math.round(steps)) > tolerance) {
    throw new Error(`Parameter ${paramId} defaultValue (${paramConfig.defaultValue}) must be reachable from min (${paramConfig.min}) using step (${paramConfig.step})`);
  }

  // Validate suffix (required for percent, must be "%")
  if (paramConfig.suffix !== '%') {
    throw new Error(`Parameter ${paramId} suffix must be '%' for percent type`);
  }
}

/**
 * Validate number parameter configuration
 * @memberof module:helpers/strategyHelpers
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @throws {Error} If parameter is invalid
 * @example
 * // Validate number parameter
 * validateNumberParameter('rebalanceCountThresholdHigh', {
 *   name: "High Rebalance Count",
 *   description: "If more than this many rebalances occur in the timeframe, widen ranges",
 *   type: "number",
 *   defaultValue: 3,
 *   group: 3,
 *   contractGroup: "adaptive",
 *   min: 1,
 *   max: 20,
 *   step: 1,
 *   conditionalOn: "adaptiveRanges",
 *   conditionalValue: true
 * });
 * @since 1.0.0
 */
export function validateNumberParameter(paramId, paramConfig, parameterGroups, contractParametersGroups) {
  // First validate base properties (includes conditionals)
  validateParameterBase(paramId, paramConfig, parameterGroups, contractParametersGroups);

  // Validate type is number
  if (paramConfig.type !== 'number') {
    throw new Error(`Parameter ${paramId} type must be 'number', got '${paramConfig.type}'`);
  }

  // Validate defaultValue is number
  if (typeof paramConfig.defaultValue !== 'number' || !Number.isFinite(paramConfig.defaultValue)) {
    throw new Error(`Parameter ${paramId} defaultValue must be a finite number`);
  }

  // Validate min (required for number, must be >= 0 based on analysis)
  if (typeof paramConfig.min !== 'number' || !Number.isFinite(paramConfig.min) || paramConfig.min < 0) {
    throw new Error(`Parameter ${paramId} min must be a finite number >= 0`);
  }

  // Validate max (required for number)
  if (typeof paramConfig.max !== 'number' || !Number.isFinite(paramConfig.max)) {
    throw new Error(`Parameter ${paramId} max must be a finite number`);
  }

  // Validate min < max
  if (paramConfig.min >= paramConfig.max) {
    throw new Error(`Parameter ${paramId} min (${paramConfig.min}) must be less than max (${paramConfig.max})`);
  }

  // Validate step (required for number, must be > 0)
  if (typeof paramConfig.step !== 'number' || !Number.isFinite(paramConfig.step) || paramConfig.step <= 0) {
    throw new Error(`Parameter ${paramId} step must be a positive finite number`);
  }

  // Validate defaultValue is within range
  if (paramConfig.defaultValue < paramConfig.min || paramConfig.defaultValue > paramConfig.max) {
    throw new Error(`Parameter ${paramId} defaultValue (${paramConfig.defaultValue}) must be between min (${paramConfig.min}) and max (${paramConfig.max})`);
  }

  // Validate defaultValue aligns with step (with floating point tolerance)
  const offset = paramConfig.defaultValue - paramConfig.min;
  const steps = offset / paramConfig.step;
  const tolerance = 1e-10;
  if (Math.abs(steps - Math.round(steps)) > tolerance) {
    throw new Error(`Parameter ${paramId} defaultValue (${paramConfig.defaultValue}) must be reachable from min (${paramConfig.min}) using step (${paramConfig.step})`);
  }

  // Validate suffix (optional for number type)
  if (paramConfig.suffix !== undefined) {
    if (typeof paramConfig.suffix !== 'string' || paramConfig.suffix.trim() === '') {
      throw new Error(`Parameter ${paramId} suffix must be a non-empty string`);
    }
  }
}

/**
 * Validate fiat-currency parameter configuration
 * @memberof module:helpers/strategyHelpers
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @throws {Error} If parameter is invalid
 * @example
 * // Validate fiat-currency parameter
 * validateFiatCurrencyParameter('reinvestmentTrigger', {
 *   name: "Reinvestment Trigger",
 *   description: "Minimum USD value of fees before reinvesting",
 *   type: "fiat-currency",
 *   defaultValue: 50,
 *   group: 1,
 *   contractGroup: "fee",
 *   min: 1,
 *   max: 1000,
 *   step: 5,
 *   prefix: "$",
 *   conditionalOn: "feeReinvestment",
 *   conditionalValue: true
 * });
 * @since 1.0.0
 */
export function validateFiatCurrencyParameter(paramId, paramConfig, parameterGroups, contractParametersGroups) {
  // First validate base properties (includes conditionals)
  validateParameterBase(paramId, paramConfig, parameterGroups, contractParametersGroups);

  // Validate type is fiat-currency
  if (paramConfig.type !== 'fiat-currency') {
    throw new Error(`Parameter ${paramId} type must be 'fiat-currency', got '${paramConfig.type}'`);
  }

  // Validate defaultValue is number
  if (typeof paramConfig.defaultValue !== 'number' || !Number.isFinite(paramConfig.defaultValue)) {
    throw new Error(`Parameter ${paramId} defaultValue must be a finite number`);
  }

  // Validate min (required for fiat-currency, must be > 0 for currency values)
  if (typeof paramConfig.min !== 'number' || !Number.isFinite(paramConfig.min) || paramConfig.min <= 0) {
    throw new Error(`Parameter ${paramId} min must be a finite number > 0`);
  }

  // Validate max (required for fiat-currency)
  if (typeof paramConfig.max !== 'number' || !Number.isFinite(paramConfig.max)) {
    throw new Error(`Parameter ${paramId} max must be a finite number`);
  }

  // Validate min < max
  if (paramConfig.min >= paramConfig.max) {
    throw new Error(`Parameter ${paramId} min (${paramConfig.min}) must be less than max (${paramConfig.max})`);
  }

  // Validate step (required for fiat-currency, must be > 0)
  if (typeof paramConfig.step !== 'number' || !Number.isFinite(paramConfig.step) || paramConfig.step <= 0) {
    throw new Error(`Parameter ${paramId} step must be a positive finite number`);
  }

  // Validate defaultValue is within range
  if (paramConfig.defaultValue < paramConfig.min || paramConfig.defaultValue > paramConfig.max) {
    throw new Error(`Parameter ${paramId} defaultValue (${paramConfig.defaultValue}) must be between min (${paramConfig.min}) and max (${paramConfig.max})`);
  }

  // Validate defaultValue aligns with step (with floating point tolerance)
  const offset = paramConfig.defaultValue - paramConfig.min;
  const steps = offset / paramConfig.step;
  const tolerance = 1e-10;
  if (Math.abs(steps - Math.round(steps)) > tolerance) {
    throw new Error(`Parameter ${paramId} defaultValue (${paramConfig.defaultValue}) must be reachable from min (${paramConfig.min}) using step (${paramConfig.step})`);
  }

  // Validate prefix (required for fiat-currency, must be "$")
  if (paramConfig.prefix !== '$') {
    throw new Error(`Parameter ${paramId} prefix must be '$' for fiat-currency type`);
  }
}

/**
 * Validate select parameter configuration
 * @memberof module:helpers/strategyHelpers
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @throws {Error} If parameter is invalid
 * @example
 * // Validate select parameter
 * validateSelectParameter('oracleSource', {
 *   name: "Price Oracle",
 *   description: "Source of price data for strategy decisions",
 *   type: "select",
 *   defaultValue: "0",
 *   group: 3,
 *   contractGroup: "oracle",
 *   options: [
 *     { value: "0", label: "DEX Price" },
 *     { value: "1", label: "Chainlink" },
 *     { value: "2", label: "Time-Weighted Average Price" }
 *   ]
 * });
 * @since 1.0.0
 */
export function validateSelectParameter(paramId, paramConfig, parameterGroups, contractParametersGroups) {
  // First validate base properties (includes conditionals)
  validateParameterBase(paramId, paramConfig, parameterGroups, contractParametersGroups);

  // Validate type is select
  if (paramConfig.type !== 'select') {
    throw new Error(`Parameter ${paramId} type must be 'select', got '${paramConfig.type}'`);
  }

  // Validate options exists and is array
  if (!Array.isArray(paramConfig.options)) {
    throw new Error(`Parameter ${paramId} options must be an array`);
  }

  // Validate options has at least one item
  if (paramConfig.options.length === 0) {
    throw new Error(`Parameter ${paramId} options array cannot be empty`);
  }

  // Validate each option structure
  paramConfig.options.forEach((option, index) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      throw new Error(`Parameter ${paramId} options[${index}] must be an object`);
    }

    // Validate value exists
    if (!option.hasOwnProperty('value')) {
      throw new Error(`Parameter ${paramId} options[${index}] missing 'value' property`);
    }

    // Validate label exists and is non-empty string
    if (!option.label || typeof option.label !== 'string' || option.label.trim() === '') {
      throw new Error(`Parameter ${paramId} options[${index}] missing valid 'label' property`);
    }
  });

  // Validate defaultValue exists in options
  const validValues = paramConfig.options.map(opt => opt.value);
  if (!validValues.includes(paramConfig.defaultValue)) {
    throw new Error(`Parameter ${paramId} defaultValue '${paramConfig.defaultValue}' must be one of the option values: [${validValues.map(v => JSON.stringify(v)).join(', ')}]`);
  }

  // Validate option values are unique
  const duplicateValues = validValues.filter((value, index, arr) => arr.indexOf(value) !== index);
  if (duplicateValues.length > 0) {
    throw new Error(`Parameter ${paramId} has duplicate option values: [${duplicateValues.map(v => JSON.stringify(v)).join(', ')}]`);
  }
}

/**
 * Validate parameter groups configuration
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - Strategy identifier
 * @param {Object} parameterGroups - Parameter groups object to validate
 * @throws {Error} If parameter groups are invalid
 * @example
 * // Validate parameter groups configuration
 * validateParameterGroups('bob', {
 *   0: { name: "Range Settings", description: "Control position ranges" },
 *   1: { name: "Fee Settings", description: "Configure fee handling" }
 * });
 * @since 1.0.0
 */
export function validateParameterGroups(strategyId, parameterGroups) {
  // Validate parameterGroups exists and is object
  if (!parameterGroups || typeof parameterGroups !== 'object' || Array.isArray(parameterGroups)) {
    throw new Error(`Strategy ${strategyId} parameterGroups must be an object`);
  }

  // Validate each parameter group
  Object.entries(parameterGroups).forEach(([groupId, groupConfig]) => {
    // Validate name exists and is non-empty string
    if (!groupConfig.name || typeof groupConfig.name !== 'string' || groupConfig.name.trim() === '') {
      throw new Error(`Strategy ${strategyId} parameterGroup '${groupId}' missing valid name`);
    }

    // Validate description exists and is non-empty string
    if (!groupConfig.description || typeof groupConfig.description !== 'string' || groupConfig.description.trim() === '') {
      throw new Error(`Strategy ${strategyId} parameterGroup '${groupId}' missing valid description`);
    }
  });
}

/**
 * Validate contract parameter groups configuration
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - Strategy identifier
 * @param {Object} contractParametersGroups - Contract parameter groups object to validate
 * @param {Object} strategyParameters - Strategy parameters (unused in single source approach)
 * @throws {Error} If contract parameter groups are invalid
 * @example
 * // Validate contract parameter groups configuration
 * validateContractParametersGroups('bob', {
 *   range: {
 *     setterMethod: "setRangeParameters"
 *   }
 * }, strategy.parameters);
 * @since 1.0.0
 */
export function validateContractParametersGroups(strategyId, contractParametersGroups, strategyParameters) {
  // Validate contractParametersGroups exists and is object
  if (!contractParametersGroups || typeof contractParametersGroups !== 'object' || Array.isArray(contractParametersGroups)) {
    throw new Error(`Strategy ${strategyId} contractParametersGroups must be an object`);
  }

  // Validate each contract parameter group
  Object.entries(contractParametersGroups).forEach(([groupId, groupConfig]) => {
    // Validate setterMethod exists and is non-empty string
    if (!groupConfig.setterMethod || typeof groupConfig.setterMethod !== 'string' || groupConfig.setterMethod.trim() === '') {
      throw new Error(`Strategy ${strategyId} contractParametersGroup '${groupId}' missing valid setterMethod`);
    }

    // Single source approach: parameters are derived from scanning strategy.parameters
    // where paramConfig.contractGroup === groupId, using getParametersByContractGroup()
    // No need to validate parameters array since it no longer exists
  });
}


/**
 * Validate template configuration
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - Strategy identifier
 * @param {string} templateId - Template identifier
 * @param {Object} templateConfig - Template configuration object
 * @param {Object} strategyParameters - Strategy parameters to validate defaults against
 * @param {Object} templateEnumMap - Template enum map to validate template has corresponding entry
 * @throws {Error} If template is invalid
 * @example
 * // Validate template configuration
 * validateTemplateConfiguration('bob', 'conservative', {
 *   name: "Conservative",
 *   description: "Wider ranges with fewer rebalances, lower risk",
 *   defaults: {
 *     targetRangeUpper: 10.0,
 *     targetRangeLower: 10.0,
 *     feeReinvestment: false
 *   }
 * }, strategy.parameters, strategy.templateEnumMap);
 * @since 1.0.0
 */
export function validateTemplateConfiguration(strategyId, templateId, templateConfig, strategyParameters, templateEnumMap) {
  // Validate template has corresponding entry in templateEnumMap
  if (templateEnumMap && !templateEnumMap.hasOwnProperty(templateId)) {
    throw new Error(`Template ${strategyId}.${templateId} missing corresponding templateEnumMap entry`);
  }

  // Validate 'custom' template has enum value 0
  if (templateId === 'custom' && templateEnumMap && templateEnumMap[templateId] !== 0) {
    throw new Error(`Template ${strategyId}.${templateId} must have templateEnumMap value 0, got ${templateEnumMap[templateId]}`);
  }

  // Validate name exists and is non-empty string
  if (!templateConfig.name || typeof templateConfig.name !== 'string' || templateConfig.name.trim() === '') {
    throw new Error(`Template ${strategyId}.${templateId} missing valid name`);
  }

  // Validate description exists and is non-empty string
  if (!templateConfig.description || typeof templateConfig.description !== 'string' || templateConfig.description.trim() === '') {
    throw new Error(`Template ${strategyId}.${templateId} missing valid description`);
  }

  // Validate defaults exists and is object
  if (!templateConfig.defaults || typeof templateConfig.defaults !== 'object' || Array.isArray(templateConfig.defaults)) {
    throw new Error(`Template ${strategyId}.${templateId} defaults must be an object`);
  }

  // Validate that defaults has a property for each parameter
  const parameterIds = Object.keys(strategyParameters);
  const defaultsKeys = Object.keys(templateConfig.defaults);

  // Check for missing defaults
  const missingDefaults = parameterIds.filter(paramId => !defaultsKeys.includes(paramId));
  if (missingDefaults.length > 0) {
    throw new Error(`Template ${strategyId}.${templateId} missing defaults for parameters: ${missingDefaults.join(', ')}`);
  }

  // Check for extra defaults (not corresponding to any parameter)
  const extraDefaults = defaultsKeys.filter(defaultKey => !parameterIds.includes(defaultKey));
  if (extraDefaults.length > 0) {
    throw new Error(`Template ${strategyId}.${templateId} has defaults for unknown parameters: ${extraDefaults.join(', ')}`);
  }

  // Validate each default value against its parameter type and constraints
  Object.entries(templateConfig.defaults).forEach(([paramId, defaultValue]) => {
    const paramConfig = strategyParameters[paramId];

    // Validate the default value fits the parameter type and constraints
    switch (paramConfig.type) {
      case 'boolean':
        if (typeof defaultValue !== 'boolean') {
          throw new Error(`Template ${strategyId}.${templateId} default for ${paramId} must be boolean, got ${typeof defaultValue}`);
        }
        break;

      case 'percent':
      case 'number':
      case 'fiat-currency':
        if (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue)) {
          throw new Error(`Template ${strategyId}.${templateId} default for ${paramId} must be a finite number, got ${typeof defaultValue}`);
        }

        // Validate range constraints
        if (paramConfig.min !== undefined && defaultValue < paramConfig.min) {
          throw new Error(`Template ${strategyId}.${templateId} default for ${paramId} (${defaultValue}) must be >= min (${paramConfig.min})`);
        }

        if (paramConfig.max !== undefined && defaultValue > paramConfig.max) {
          throw new Error(`Template ${strategyId}.${templateId} default for ${paramId} (${defaultValue}) must be <= max (${paramConfig.max})`);
        }

        // Validate step alignment (with floating point tolerance)
        if (paramConfig.step !== undefined) {
          const offset = defaultValue - paramConfig.min;
          const steps = offset / paramConfig.step;
          const tolerance = 1e-10;
          if (Math.abs(steps - Math.round(steps)) > tolerance) {
            throw new Error(`Template ${strategyId}.${templateId} default for ${paramId} (${defaultValue}) must align with step (${paramConfig.step}) from min (${paramConfig.min})`);
          }
        }
        break;

      case 'select':
        // Validate default value exists in options
        if (paramConfig.options) {
          const validValues = paramConfig.options.map(opt => opt.value);
          if (!validValues.includes(defaultValue)) {
            throw new Error(`Template ${strategyId}.${templateId} default for ${paramId} ('${defaultValue}') must be one of: [${validValues.map(v => JSON.stringify(v)).join(', ')}]`);
          }
        }
        break;

      case 'token-deposits':
        // Validate structure for token-deposits
        if (!defaultValue || typeof defaultValue !== 'object' || Array.isArray(defaultValue)) {
          throw new Error(`Template ${strategyId}.${templateId} default for ${paramId} must be an object`);
        }

        if (!Array.isArray(defaultValue.tokens)) {
          throw new Error(`Template ${strategyId}.${templateId} default for ${paramId}.tokens must be an array`);
        }

        if (!defaultValue.amounts || typeof defaultValue.amounts !== 'object' || Array.isArray(defaultValue.amounts)) {
          throw new Error(`Template ${strategyId}.${templateId} default for ${paramId}.amounts must be an object`);
        }
        break;

      default:
        throw new Error(`Template ${strategyId}.${templateId} parameter ${paramId} has unknown type: ${paramConfig.type}`);
    }
  });
};

/**
 * Lookup the list of available strategy configs (excluding the "none" strategy)
 * @memberof module:helpers/strategyHelpers
 * @returns {Array<Object>} Array of strategy objects with complete configuration data
 * @example
 * // Lookup all available strategies
 * const strategies = lookupAvailableStrategies();
 * // Returns: [
 * //   {
 * //     id: "bob",
 * //     name: "Bob",
 * //     subtitle: "Range-bound trading",
 * //     description: "...",
 * //     templateEnumMap: { conservative: 0, balanced: 1, ... },
 * //     parameters: { ... },
 * //     parameterGroups: [...],
 * //     contractParametersGroups: [...]
 * //   },
 * //   ...
 * // ]
 * @since 1.0.0
 */
export function lookupAvailableStrategies() {
  return Object.values(strategies)
    .filter(strategy => strategy.id !== "none")
    .map(strategy => ({
      id: strategy.id,
      name: strategy.name,
      subtitle: strategy.subtitle,
      description: strategy.description,
      templateEnumMap: strategy.templateEnumMap,
      parameters: strategy.parameters,
      parameterGroups: strategy.parameterGroups,
      contractParametersGroups: strategy.contractParametersGroups
    }));
}

/**
 * Get details about a specific strategy
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy to get details for (e.g., 'bob', 'parris')
 * @returns {Object} Strategy details object with complete configuration
 * @throws {Error} Throws error if strategy not found
 * @example
 * // Get Bob strategy details
 * const bobStrategy = getStrategyDetails('bob');
 * // Returns: {
 * //   id: "bob",
 * //   name: "Bob",
 * //   subtitle: "Range-bound trading",
 * //   description: "...",
 * //   icon: "📊",
 * //   color: "#4CAF50",
 * //   supportedTokens: { ETH: true, USDC: true, ... },
 * //   minTokens: 2,
 * //   maxTokens: 5,
 * //   ...
 * // }
 *
 * @example
 * // Handle unknown strategy
 * try {
 *   const strategy = getStrategyDetails('unknown');
 * } catch (error) {
 *   console.error('Strategy not found:', error.message);
 * }
 * @since 1.0.0
 */
export function getStrategyDetails(strategyId) {
  validateStrategyId(strategyId);

  const strategy = strategies[strategyId];
  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  // Validate required string properties
  const requiredStringProperties = ['id', 'name', 'subtitle', 'description', 'icon', 'color', 'borderColor', 'textColor'];
  requiredStringProperties.forEach(prop => {
    if (!strategy[prop] || typeof strategy[prop] !== 'string' || strategy[prop].trim() === '') {
      throw new Error(`Strategy ${strategyId} missing or invalid property: ${prop}`);
    }
  });

  // Validate required number properties
  const requiredNumberProperties = ['minTokens', 'maxTokens', 'minPlatforms', 'maxPlatforms', 'minPositions', 'maxPositions'];
  requiredNumberProperties.forEach(prop => {
    if (strategy[prop] === undefined || strategy[prop] === null || typeof strategy[prop] !== 'number' || strategy[prop] < 0) {
      throw new Error(`Strategy ${strategyId} missing or invalid property: ${prop}`);
    }
  });

  // Validate required object properties
  const requiredObjectProperties = ['supportedTokens', 'parameters'];
  requiredObjectProperties.forEach(prop => {
    if (!strategy[prop] || typeof strategy[prop] !== 'object' || Array.isArray(strategy[prop])) {
      throw new Error(`Strategy ${strategyId} missing or invalid property: ${prop}`);
    }
  });

  // Validate templates, parameterGroups, contractParametersGroups are objects
  const requiredObjectProperties2 = ['templates', 'parameterGroups', 'contractParametersGroups'];
  requiredObjectProperties2.forEach(prop => {
    if (!strategy[prop] || typeof strategy[prop] !== 'object' || Array.isArray(strategy[prop])) {
      throw new Error(`Strategy ${strategyId} missing or invalid property: ${prop}`);
    }
  });

  // Validate templateEnumMap
  if (!strategy.templateEnumMap || typeof strategy.templateEnumMap !== 'object' || Array.isArray(strategy.templateEnumMap)) {
    throw new Error(`Strategy ${strategyId} missing or invalid property: templateEnumMap`);
  }

  return {
    id: strategy.id,
    name: strategy.name,
    subtitle: strategy.subtitle,
    description: strategy.description,
    icon: strategy.icon,
    color: strategy.color,
    borderColor: strategy.borderColor,
    textColor: strategy.textColor,
    supportedTokens: strategy.supportedTokens,
    minTokens: strategy.minTokens,
    maxTokens: strategy.maxTokens,
    minPlatforms: strategy.minPlatforms,
    maxPlatforms: strategy.maxPlatforms,
    minPositions: strategy.minPositions,
    maxPositions: strategy.maxPositions,
    parameters: strategy.parameters,
    parameterGroups: strategy.parameterGroups,
    contractParametersGroups: strategy.contractParametersGroups,
    templateEnumMap: strategy.templateEnumMap,
    templates: strategy.templates
  };
}

/**
 * Get templates for a specific strategy
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @returns {Array<Object>} Array of template objects with predefined parameter sets
 * @throws {Error} Throws error if strategy not found or templates not configured
 * @example
 * // Get Bob strategy templates
 * const templates = getStrategyTemplates('bob');
 * // Returns: [
 * //   { id: "conservative", name: "Conservative", defaults: {...} },
 * //   { id: "balanced", name: "Balanced", defaults: {...} },
 * //   { id: "aggressive", name: "Aggressive", defaults: {...} }
 * // ]
 *
 * @example
 * // Build template selector with error handling
 * try {
 *   const templateOptions = getStrategyTemplates(strategyId).map(template => ({
 *     value: template.id,
 *     label: template.name,
 *     description: template.description
 *   }));
 * } catch (error) {
 *   console.error('Failed to get templates:', error.message);
 * }
 * @since 1.0.0
 */
export function getStrategyTemplates(strategyId) {
  validateStrategyId(strategyId);

  const strategy = strategies[strategyId];
  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  if (!strategy.templates) {
    throw new Error(`Strategy ${strategyId} templates not configured`);
  }

  if (!strategy.templates || typeof strategy.templates !== 'object' || Array.isArray(strategy.templates)) {
    throw new Error(`Strategy ${strategyId} templates must be an object`);
  }

  // Validate template structure
  Object.entries(strategy.templates).forEach(([templateId, template]) => {
    if (!template.name || typeof template.name !== 'string') {
      throw new Error(`Strategy ${strategyId} template '${templateId}' missing valid name`);
    }
    if (!template.description || typeof template.description !== 'string') {
      throw new Error(`Strategy ${strategyId} template '${templateId}' missing valid description`);
    }
  });

  return Object.entries(strategy.templates).map(([templateId, template]) => ({
    id: templateId,
    ...template
  }));
}

/**
 * Get default parameters for a specific template
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @param {string} templateId - ID of the template (or 'custom' for base defaults)
 * @returns {Object} Default parameter values for the template
 * @example
 * // Get conservative template defaults for Bob
 * const defaults = getTemplateDefaults('bob', 'conservative');
 * // Returns: {
 * //   targetRangeUpper: 105,
 * //   targetRangeLower: 95,
 * //   rebalanceThresholdUpper: 2,
 * //   ...
 * // }
 *
 * @example
 * // Get custom/base defaults
 * const customDefaults = getTemplateDefaults('bob', 'custom');
 * // Returns default values from parameter definitions
 * @since 1.0.0
 */
export function getTemplateDefaults(strategyId, templateId) {
  validateStrategyId(strategyId);
  validateStrategyId(templateId);

  const strategy = strategies[strategyId];
  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  if (!strategy.templates || typeof strategy.templates !== 'object' || Array.isArray(strategy.templates)) {
    throw new Error(`Strategy ${strategyId} templates not configured`);
  }

  if (!strategy.parameters || typeof strategy.parameters !== 'object' || Array.isArray(strategy.parameters)) {
    throw new Error(`Strategy ${strategyId} parameters not configured`);
  }

  // For custom template or when no specific template is selected
  if (templateId === "custom") {
    return Object.entries(strategy.parameters).reduce((defaults, [paramId, paramConfig]) => {
      defaults[paramId] = paramConfig.defaultValue;
      return defaults;
    }, {});
  }

  // Find the specific template
  const template = strategy.templates[templateId];
  if (!template) {
    throw new Error(`Template ${templateId} not found in strategy ${strategyId}`);
  }

  if (!template.defaults || typeof template.defaults !== 'object' || Array.isArray(template.defaults)) {
    throw new Error(`Template ${templateId} defaults not configured in strategy ${strategyId}`);
  }

  return template.defaults;
}

/**
 * Get the default parameters for a strategy
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @returns {Object} Object with default parameter values from base configuration
 * @example
 * // Get base defaults for a strategy
 * const defaults = getDefaultParams('parris');
 * // Returns all parameter default values
 * @since 1.0.0
 */
export function getDefaultParams(strategyId) {
  validateStrategyId(strategyId);

  return getTemplateDefaults(strategyId, "custom");
}

/**
 * Get parameter definitions for a strategy
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @returns {Object} Object with parameter definitions keyed by parameter ID
 * @example
 * // Get all parameter definitions for Bob
 * const params = getStrategyParameters('bob');
 * // Returns: {
 * //   targetRangeUpper: {
 * //     name: "Target Range Upper",
 * //     type: "percent",
 * //     defaultValue: 102,
 * //     min: 100,
 * //     max: 200,
 * //     ...
 * //   },
 * //   ...
 * // }
 * @since 1.0.0
 */
export function getStrategyParameters(strategyId) {
  validateStrategyId(strategyId);

  const strategy = strategies[strategyId];
  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  if (!strategy.parameters || typeof strategy.parameters !== 'object' || Array.isArray(strategy.parameters)) {
    throw new Error(`Strategy ${strategyId} parameters not configured`);
  }

  return strategy.parameters;
}

/**
 * Get parameters for a specific group
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @param {number} groupId - Group ID to filter by
 * @returns {Object} Object with parameter definitions for the specified group
 * @example
 * // Get all parameters in group 0 (Range Settings)
 * const rangeParams = getStrategyParametersByGroup('bob', 0);
 * // Returns parameters that belong to group 0
 *
 * @example
 * // Build grouped parameter form
 * strategy.parameterGroups.forEach(group => {
 *   const params = getStrategyParametersByGroup(strategyId, group.id);
 *   renderParameterGroup(group.title, params);
 * });
 * @since 1.0.0
 */
export function getStrategyParametersByGroup(strategyId, groupId) {
  validateStrategyId(strategyId);

  const strategy = strategies[strategyId];
  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  if (!strategy.parameters || typeof strategy.parameters !== 'object' || Array.isArray(strategy.parameters)) {
    throw new Error(`Strategy ${strategyId} parameters not configured`);
  }

  const groupParams = {};

  Object.entries(strategy.parameters).forEach(([paramId, paramConfig]) => {
    if (paramConfig.group === groupId) {
      groupParams[paramId] = paramConfig;
    }
  });

  return groupParams;
}

/**
 * Get parameters by contract group
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @param {string} contractGroup - Contract group ID (e.g., 'rangeParams', 'feeParams')
 * @returns {Object} Object with parameter definitions for the contract group
 * @example
 * // Get all range-related parameters
 * const rangeParams = getParametersByContractGroup('bob', 'rangeParams');
 * // Returns parameters that map to the same contract method
 *
 * @example
 * // Prepare parameters for contract call
 * const feeParams = getParametersByContractGroup(strategyId, 'feeParams');
 * const values = Object.keys(feeParams).map(paramId => userValues[paramId]);
 * @since 1.0.0
 */
export function getParametersByContractGroup(strategyId, contractGroup) {
  validateStrategyId(strategyId);

  const strategy = strategies[strategyId];
  if (!strategy) return {};

  const groupParams = {};

  Object.entries(strategy.parameters).forEach(([paramId, paramConfig]) => {
    if (paramConfig.contractGroup === contractGroup) {
      groupParams[paramId] = paramConfig;
    }
  });

  return groupParams;
}

/**
 * Validate strategy parameters
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @param {Object} params - Parameter values to validate (key-value pairs where keys are parameter IDs)
 * @returns {{isValid: boolean, errors: Object}} Validation result with isValid flag and error messages
 * @example
 * // Validate user input
 * const validation = validateStrategyParams('bob', {
 *   targetRangeUpper: 110,
 *   targetRangeLower: 90,
 *   rebalanceThresholdUpper: 5
 * });
 *
 * if (!validation.isValid) {
 *   console.error('Validation errors:', validation.errors);
 *   // errors: { targetRangeLower: "Target Range Lower must be at least 95%" }
 * }
 *
 * @example
 * // Handle conditional parameters
 * const params = {
 *   feeReinvestment: true,
 *   reinvestmentTrigger: 100 // Only validated if feeReinvestment is true
 * };
 * const result = validateStrategyParams('bob', params);
 * @since 1.0.0
 */
export function validateStrategyParams(strategyId, params) {
  validateStrategyId(strategyId);

  const strategy = strategies[strategyId];
  if (!strategy) {
    return {
      isValid: false,
      errors: { _general: "Invalid strategy ID" }
    };
  }

  const errors = {};

  // Validate each parameter
  Object.entries(strategy.parameters).forEach(([paramId, paramConfig]) => {
    const value = params[paramId];

    // Skip validation for conditional parameters that aren't applicable
    if (paramConfig.conditionalOn) {
      const conditionParam = params[paramConfig.conditionalOn];
      if (conditionParam !== paramConfig.conditionalValue) {
        return;
      }
    }

    // Required parameter is missing
    if (value === undefined || value === null || value === "") {
      errors[paramId] = `${paramConfig.name} is required`;
      return;
    }

    // Numeric validations
    if (paramConfig.type === "number" || paramConfig.type === "percent" ||
        paramConfig.type === "fiat-currency") {
      const numValue = Number(value);

      if (isNaN(numValue)) {
        errors[paramId] = `${paramConfig.name} must be a number`;
        return;
      }

      if (paramConfig.min !== undefined && numValue < paramConfig.min) {
        errors[paramId] = `${paramConfig.name} must be at least ${paramConfig.min}${paramConfig.suffix || ''}`;
        return;
      }

      if (paramConfig.max !== undefined && numValue > paramConfig.max) {
        errors[paramId] = `${paramConfig.name} must be at most ${paramConfig.max}${paramConfig.suffix || ''}`;
        return;
      }
    }

    // Select validation
    if (paramConfig.type === "select" && paramConfig.options) {
      const validOptions = paramConfig.options.map(opt => opt.value);
      if (!validOptions.includes(value)) {
        errors[paramId] = `${paramConfig.name} must be one of the provided options`;
        return;
      }
    }
  });

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Get parameter setter method for a contract parameter group
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @param {string} contractGroupId - Contract group ID
 * @returns {string|null} Contract setter method name - null if not found
 * @example
 * // Get setter method for range parameters
 * const method = getParameterSetterMethod('bob', 'rangeParams');
 * // Returns: "setRangeParameters"
 *
 * @example
 * // Use to call contract method
 * const setterMethod = getParameterSetterMethod(strategyId, groupId);
 * if (setterMethod) {
 *   await contract[setterMethod](...parameterValues);
 * }
 * @since 1.0.0
 */
export function getParameterSetterMethod(strategyId, contractGroupId) {
  validateStrategyId(strategyId);

  const strategy = strategies[strategyId];
  if (!strategy || !strategy.contractParametersGroups) return null;

  const group = strategy.contractParametersGroups.find(g => g.id === contractGroupId);
  return group ? group.setterMethod : null;
}

/**
 * Check if a parameter should be shown based on condition
 * @memberof module:helpers/strategyHelpers
 * @param {Object} paramConfig - Parameter configuration object
 * @param {string} paramConfig.conditionalOn - Parameter ID this depends on
 * @param {*} paramConfig.conditionalValue - Value required for this parameter to show
 * @param {Object} currentParams - Current parameter values (key-value pairs)
 * @returns {boolean} Whether the parameter should be shown
 * @example
 * // Check if reinvestment trigger should be shown
 * const paramConfig = {
 *   conditionalOn: 'feeReinvestment',
 *   conditionalValue: true
 * };
 * const show = shouldShowParameter(paramConfig, { feeReinvestment: true });
 * // Returns: true
 *
 * @example
 * // Hide parameter when condition not met
 * const show = shouldShowParameter(paramConfig, { feeReinvestment: false });
 * // Returns: false
 * @since 1.0.0
 */
export function shouldShowParameter(paramConfig, currentParams) {
  if (!paramConfig.conditionalOn) return true;

  const conditionParamValue = currentParams[paramConfig.conditionalOn];
  return conditionParamValue === paramConfig.conditionalValue;
}

/**
 * Lookup all strategy IDs
 * @memberof module:helpers/strategyHelpers
 * @returns {Array<string>} Array of all configured strategy IDs
 * @example
 * // Lookup all strategy IDs
 * const ids = lookupAllStrategyIds();
 * // Returns: ['none', 'bob', 'parris', 'fed', ...]
 *
 * @example
 * // Check if strategy exists
 * if (lookupAllStrategyIds().includes(userStrategy)) {
 *   loadStrategy(userStrategy);
 * }
 * @since 1.0.0
 */
export function lookupAllStrategyIds() {
  return Object.keys(strategies);
}

/**
 * Check if a strategy supports specific tokens
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @param {Array<string>} tokenSymbols - Array of token symbols to check
 * @returns {boolean} Whether the strategy supports all specified tokens
 * @example
 * // Check if Bob supports ETH/USDC pair
 * const supported = strategySupportsTokens('bob', ['ETH', 'USDC']);
 * // Returns: true
 *
 * @example
 * // Filter strategies by token support
 * const compatibleStrategies = lookupAvailableStrategies()
 *   .filter(strategy =>
 *     strategySupportsTokens(strategy.id, selectedTokens)
 *   );
 * @since 1.0.0
 */
export function strategySupportsTokens(strategyId, tokenSymbols) {
  validateStrategyId(strategyId);

  const strategy = strategies[strategyId];
  if (!strategy || !strategy.supportedTokens) return false;

  const supportedSymbols = Object.keys(strategy.supportedTokens);
  return tokenSymbols.every(symbol => supportedSymbols.includes(symbol));
}

/**
 * Format parameter value for display
 * @memberof module:helpers/strategyHelpers
 * @param {any} value - Parameter value to format
 * @param {Object} paramConfig - Parameter configuration object
 * @param {string} paramConfig.type - Parameter type (boolean, select, number, percent, fiat-currency)
 * @param {Array} [paramConfig.options] - Options for select type
 * @param {string} [paramConfig.suffix] - Unit suffix for display
 * @param {string} [paramConfig.prefix] - Unit prefix for display
 * @returns {string} Formatted value for user display
 * @example
 * // Format boolean
 * formatParameterValue(true, { type: 'boolean' }); // "Yes"
 *
 * @example
 * // Format percent
 * formatParameterValue(5.5, { type: 'percent' }); // "5.5%"
 *
 * @example
 * // Format currency
 * formatParameterValue(100, { type: 'fiat-currency', prefix: '$' }); // "$100"
 *
 * @example
 * // Format select option
 * formatParameterValue('high', {
 *   type: 'select',
 *   options: [{ value: 'high', label: 'High Priority' }]
 * }); // "High Priority"
 * @since 1.0.0
 */
export function formatParameterValue(value, paramConfig) {
  if (value === undefined || value === null) return '';

  if (paramConfig.type === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (paramConfig.type === 'select' && paramConfig.options) {
    const option = paramConfig.options.find(opt => opt.value === value);
    return option ? option.label : value;
  }

  if (paramConfig.type === 'percent') {
    return `${value}${paramConfig.suffix || '%'}`;
  }

  if (paramConfig.type === 'fiat-currency') {
    return `${paramConfig.prefix || '$'}${value}`;
  }

  return `${value}${paramConfig.suffix || ''}`;
}

/**
 * Validate if tokens in a vault match those configured in a strategy
 * @memberof module:helpers/strategyHelpers
 * @param {Object} vaultTokens - Object containing token balances in the vault (keyed by token symbol)
 * @param {Array<string>} strategyTokens - Array of token symbols configured in the strategy
 * @returns {Array<string>} Array of validation messages (empty if validation passes)
 * @throws {TypeError} If parameters are not in expected format
 * @example
 * // Validate vault tokens against strategy
 * const vaultTokens = { ETH: 1.5, USDC: 1000, DAI: 500 };
 * const strategyTokens = ['ETH', 'USDC'];
 * const messages = validateTokensForStrategy(vaultTokens, strategyTokens);
 * // Returns: ["The following tokens in your vault are not part of your strategy: DAI..."]
 *
 * @example
 * // All tokens match
 * const vaultTokens = { ETH: 1.5, USDC: 1000 };
 * const strategyTokens = ['ETH', 'USDC'];
 * const messages = validateTokensForStrategy(vaultTokens, strategyTokens);
 * // Returns: [] (no messages)
 * @since 1.0.0
 */
export function validateTokensForStrategy (vaultTokens, strategyTokens) {
  const messages = [];

  // Early exit if no tokens in vault or no strategy config
  if (!vaultTokens || Object.keys(vaultTokens).length === 0 || !strategyTokens) {
    return messages;
  }

  // If no tokens are specified in the strategy, we can't validate
  if (!strategyTokens.length) {
    return messages;
  }

  // Check if each vault token is included in strategy tokens
  const vaultTokenSymbols = Object.keys(vaultTokens);

  const unmatchedTokens = vaultTokenSymbols.filter(symbol =>
    !strategyTokens.includes(symbol)
  );

  if (unmatchedTokens.length > 0) {
    messages.push(`The following tokens in your vault are not part of your strategy: ${unmatchedTokens.join(', ')}. These tokens will be swapped into the selected strategy tokens.`);
  }

  return messages;
};
