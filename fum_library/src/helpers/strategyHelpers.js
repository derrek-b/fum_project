/**
 * @module helpers/strategyHelpers
 * @description Strategy configuration utilities for managing trading strategies, parameters, and templates.
 * Provides functions to query strategies, validate parameters, and manage strategy configurations.
 * @since 1.0.0
 */

import { ethers } from 'ethers';
import strategies from '../configs/strategies.js';
import { getAllTokens, getStablecoins, getTokensByChain } from './tokenHelpers.js';

/**
 * Validate ID string parameter using established validation pattern
 * @param {any} id - The value to validate as an ID string
 * @throws {Error} If id is not a valid string
 */
export function validateIdString(id) {
  if (id === null || id === undefined) {
    throw new Error('ID parameter is required');
  }

  if (typeof id !== 'string') {
    throw new Error('ID must be a string');
  }

  if (id === '') {
    throw new Error('ID cannot be empty');
  }
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
  validateIdString(strategyId);

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
  const requiredObjectProperties = ['parameters', 'strategyProperties'];
  requiredObjectProperties.forEach(prop => {
    if (!strategy[prop] || typeof strategy[prop] !== 'object' || Array.isArray(strategy[prop])) {
      throw new Error(`Strategy ${strategyId} missing or invalid property: ${prop}`);
    }
  });

  // Validate tokenSupport configuration
  if (!strategy.tokenSupport || typeof strategy.tokenSupport !== 'string') {
    throw new Error(`Strategy ${strategyId} missing or invalid tokenSupport property`);
  }

  const validTokenSupport = ['all', 'stablecoins', 'custom'];
  if (!validTokenSupport.includes(strategy.tokenSupport)) {
    throw new Error(`Strategy ${strategyId} tokenSupport must be one of: ${validTokenSupport.join(', ')}`);
  }

  // Validate conditional supportedTokens based on tokenSupport
  if (strategy.tokenSupport === 'custom') {
    if (!strategy.supportedTokens || typeof strategy.supportedTokens !== 'object' || Array.isArray(strategy.supportedTokens)) {
      throw new Error(`Strategy ${strategyId} with tokenSupport "custom" must have valid supportedTokens object`);
    }
    if (Object.keys(strategy.supportedTokens).length === 0) {
      throw new Error(`Strategy ${strategyId} with tokenSupport "custom" must have non-empty supportedTokens`);
    }
  } else {
    if (strategy.supportedTokens !== undefined) {
      throw new Error(`Strategy ${strategyId} with tokenSupport "${strategy.tokenSupport}" must not have supportedTokens property`);
    }
  }

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
    supportedTokens: (() => {
      switch (strategy.tokenSupport) {
        case 'all':
          return getAllTokens();
        case 'stablecoins':
          return getStablecoins();
        case 'custom':
          return strategy.supportedTokens;
        default:
          return {};
      }
    })(),
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
    templates: strategy.templates,
    strategyProperties: strategy.strategyProperties
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
  validateIdString(strategyId);

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
    if (!template.defaults || typeof template.defaults !== 'object' || Array.isArray(template.defaults)) {
      throw new Error(`Strategy ${strategyId} template '${templateId}' missing valid defaults object`);
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
  validateIdString(strategyId);
  validateIdString(templateId);

  const strategy = strategies[strategyId];
  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  if (!strategy.templates || typeof strategy.templates !== 'object' || Array.isArray(strategy.templates)) {
    throw new Error(`Strategy ${strategyId} templates not configured`);
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
 * Get default parameter values from parameter definitions
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @returns {Object} Object mapping parameter IDs to their default values
 * @throws {Error} If strategy not found or parameters not configured
 * @example
 * // Get parameter default values for a strategy
 * const defaults = getParamDefaultValues('bob');
 * // Returns: {
 * //   targetRangeUpper: 102,
 * //   targetRangeLower: 98,
 * //   rebalanceThresholdUpper: 2,
 * //   ...
 * // }
 * @since 1.0.0
 */
export function getParamDefaultValues(strategyId) {
  validateIdString(strategyId);

  const strategy = strategies[strategyId];
  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  if (!strategy.parameters || typeof strategy.parameters !== 'object' || Array.isArray(strategy.parameters)) {
    throw new Error(`Strategy ${strategyId} parameters not configured`);
  }

  const defaults = {};

  Object.entries(strategy.parameters).forEach(([paramId, paramConfig]) => {
    if (paramConfig.defaultValue !== undefined) {
      defaults[paramId] = paramConfig.defaultValue;
    }
  });

  return defaults;
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
  validateIdString(strategyId);

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
  validateIdString(strategyId);

  if (groupId === null || groupId === undefined) {
    throw new Error('Group ID parameter is required');
  }

  if (typeof groupId !== 'number' || !Number.isFinite(groupId)) {
    throw new Error('Group ID must be a finite number');
  }

  if (groupId < 0) {
    throw new Error('Group ID must be non-negative');
  }

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
 * Get strategy parameters by contract group
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @param {string} contractGroup - Contract group ID (e.g., 'rangeParams', 'feeParams')
 * @returns {Object} Object with parameter definitions for the contract group
 * @example
 * // Get all range-related parameters
 * const rangeParams = getStrategyParametersByContractGroup('bob', 'rangeParams');
 * // Returns parameters that map to the same contract method
 *
 * @example
 * // Prepare parameters for contract call
 * const feeParams = getStrategyParametersByContractGroup(strategyId, 'feeParams');
 * const values = Object.keys(feeParams).map(paramId => userValues[paramId]);
 * @since 1.0.0
 */
export function getStrategyParametersByContractGroup(strategyId, contractGroup) {
  validateIdString(strategyId);

  if (contractGroup === null || contractGroup === undefined) {
    throw new Error('Contract group parameter is required');
  }

  if (typeof contractGroup !== 'string') {
    throw new Error('Contract group must be a string');
  }

  if (contractGroup === '') {
    throw new Error('Contract group cannot be empty');
  }

  const strategy = strategies[strategyId];
  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  if (!strategy.parameters || typeof strategy.parameters !== 'object' || Array.isArray(strategy.parameters)) {
    throw new Error(`Strategy ${strategyId} parameters not configured`);
  }

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
  validateIdString(strategyId);

  if (params === null || params === undefined) {
    throw new Error('Parameters object is required');
  }

  if (typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('Parameters must be an object');
  }

  const strategy = strategies[strategyId];
  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  if (!strategy.parameters || typeof strategy.parameters !== 'object' || Array.isArray(strategy.parameters)) {
    throw new Error(`Strategy ${strategyId} parameters not configured`);
  }

  const errors = {};

  // Validate that all provided params exist in strategy
  Object.keys(params).forEach(paramId => {
    if (!strategy.parameters[paramId]) {
      errors[paramId] = `Unknown parameter: ${paramId}`;
    }
  });

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
    if (paramConfig.type === "integer" || paramConfig.type === "decimal" ||
        paramConfig.type === "percent" || paramConfig.type === "fiat-currency") {
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

      // Integer validation - must be whole number
      if (paramConfig.type === "integer") {
        if (!Number.isInteger(numValue)) {
          errors[paramId] = `${paramConfig.name} must be a whole number`;
          return;
        }
      }

      // Precision validation - max 2 decimal places for decimal, percent, and fiat-currency
      if (paramConfig.type === "decimal" || paramConfig.type === "percent" ||
          paramConfig.type === "fiat-currency") {
        const decimalPlaces = (value.toString().split('.')[1] || '').length;
        if (decimalPlaces > 2) {
          errors[paramId] = `${paramConfig.name} cannot have more than 2 decimal places`;
          return;
        }
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
 * @returns {string} Contract setter method name
 * @throws {Error} If strategy not found, contractGroupId invalid, group not found, or setterMethod not configured
 * @example
 * // Get setter method for range parameters
 * const method = getParameterSetterMethod('bob', 'rangeParams');
 * // Returns: "setRangeParameters"
 *
 * @example
 * // Use to call contract method
 * const setterMethod = getParameterSetterMethod(strategyId, groupId);
 * await contract[setterMethod](...parameterValues);
 * @since 1.0.0
 */
export function getParameterSetterMethod(strategyId, contractGroupId) {
  validateIdString(strategyId);

  if (contractGroupId === null || contractGroupId === undefined) {
    throw new Error('Contract group ID parameter is required');
  }

  if (typeof contractGroupId !== 'string') {
    throw new Error('Contract group ID must be a string');
  }

  if (contractGroupId === '') {
    throw new Error('Contract group ID cannot be empty');
  }

  const strategy = strategies[strategyId];
  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  if (!strategy.contractParametersGroups || typeof strategy.contractParametersGroups !== 'object' || Array.isArray(strategy.contractParametersGroups)) {
    throw new Error(`Strategy ${strategyId} contractParametersGroups not configured`);
  }

  const contractGroup = strategy.contractParametersGroups[contractGroupId];
  if (!contractGroup) {
    throw new Error(`Contract group ${contractGroupId} not found in strategy ${strategyId}`);
  }

  if (!contractGroup.setterMethod || typeof contractGroup.setterMethod !== 'string' || contractGroup.setterMethod.trim() === '') {
    throw new Error(`Contract group ${contractGroupId} setterMethod not configured in strategy ${strategyId}`);
  }

  return contractGroup.setterMethod;
}

/**
 * Check if a parameter should be shown based on condition
 * @memberof module:helpers/strategyHelpers
 * @param {Object} conditionalParam - Parameter configuration object with conditional properties
 * @param {string} conditionalParam.conditionalOn - Parameter ID this depends on
 * @param {*} conditionalParam.conditionalValue - Value required for this parameter to show
 * @param {Object} testValueSet - Current parameter values to test against (key-value pairs)
 * @returns {boolean} Whether the parameter should be shown
 * @example
 * // Check if reinvestment trigger should be shown
 * const conditionalParam = {
 *   conditionalOn: 'feeReinvestment',
 *   conditionalValue: true
 * };
 * const show = shouldShowParameter(conditionalParam, { feeReinvestment: true });
 * // Returns: true
 *
 * @example
 * // Hide parameter when condition not met
 * const show = shouldShowParameter(conditionalParam, { feeReinvestment: false });
 * // Returns: false
 * @since 1.0.0
 */
export function shouldShowParameter(conditionalParam, testValueSet) {
  // Defensive validation - return false for invalid inputs to prevent crashes
  if (!conditionalParam || typeof conditionalParam !== 'object' || Array.isArray(conditionalParam)) return false;
  if (!testValueSet || typeof testValueSet !== 'object' || Array.isArray(testValueSet)) return false;

  // If no conditional dependency, always show the parameter
  if (!conditionalParam.conditionalOn) return true;

  const testValue = testValueSet[conditionalParam.conditionalOn];
  return testValue === conditionalParam.conditionalValue;
}

/**
 * Get supported tokens for a strategy based on tokenSupport configuration
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @returns {Object} Object with supported token symbols as keys (WETH is filtered out - use ETH)
 * @throws {Error} If strategy not found or tokenSupport configuration invalid
 * @example
 * // Get tokens for strategy that supports all tokens
 * const tokens = getStrategyTokens('bob');
 * // Returns: { ETH: { name: "Ether", ... }, USDC: { ... }, ... }
 * // Note: WETH is filtered out - strategies use ETH, automation handles wrapping
 *
 * @example
 * // Get tokens for stablecoin-only strategy
 * const stableTokens = getStrategyTokens('fed');
 * // Returns: { USDC: { ... }, USDT: { ... }, DAI: { ... } }
 *
 * @example
 * // Get tokens for custom strategy
 * const customTokens = getStrategyTokens('customStrategy');
 * // Returns strategy's specific supportedTokens object
 * @since 1.0.0
 */
export function getStrategyTokens(strategyId) {
  validateIdString(strategyId);

  const strategy = strategies[strategyId];
  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  let tokens;

  // Handle backward compatibility - if strategy still has supportedTokens but no tokenSupport
  if (strategy.supportedTokens && !strategy.tokenSupport) {
    tokens = strategy.supportedTokens;
  } else {
    // Validate tokenSupport field exists
    if (!strategy.tokenSupport) {
      throw new Error(`Strategy ${strategyId} missing tokenSupport configuration`);
    }

    // Validate tokenSupport enum value
    if (typeof strategy.tokenSupport !== 'string') {
      throw new Error(`Strategy ${strategyId} tokenSupport must be a string`);
    }

    switch (strategy.tokenSupport) {
      case 'all':
        tokens = getAllTokens();
        break;

      case 'stablecoins':
        tokens = getStablecoins();
        break;

      case 'custom':
        if (!strategy.supportedTokens || typeof strategy.supportedTokens !== 'object' || Array.isArray(strategy.supportedTokens)) {
          throw new Error(`Strategy ${strategyId} with tokenSupport "custom" must have valid supportedTokens object`);
        }
        if (Object.keys(strategy.supportedTokens).length === 0) {
          throw new Error(`Strategy ${strategyId} with tokenSupport "custom" must have non-empty supportedTokens`);
        }
        tokens = strategy.supportedTokens;
        break;

      default:
        throw new Error(`Strategy ${strategyId} has invalid tokenSupport value: ${strategy.tokenSupport}. Must be "all", "stablecoins", or "custom"`);
    }
  }

  // Filter out WETH - strategies use ETH, automation handles wrapping
  const { WETH, ...filteredTokens } = tokens;
  return filteredTokens;
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

  if (paramConfig.type === 'integer' || paramConfig.type === 'decimal') {
    return `${value}${paramConfig.suffix || ''}`;
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
export function validateTokensForStrategy (vaultTokens, strategyTokens, chainId) {
  // Early exit if no tokens in vault or no strategy config
  if (!vaultTokens || Object.keys(vaultTokens).length === 0 || !strategyTokens) {
    return { isValid: true, warnings: [] };
  }

  // If no tokens are specified in the strategy, we can't validate
  if (!strategyTokens.length) {
    return { isValid: true, warnings: [] };
  }

  // Build native ↔ wrapped equivalents map from chain tokens
  const nativeEquivalents = {};
  if (chainId) {
    getTokensByChain(chainId).forEach(t => {
      if (t.isNative) {
        nativeEquivalents[t.symbol] = t.wrappedSymbol;
        nativeEquivalents[t.wrappedSymbol] = t.symbol;
      }
    });
  }

  // Check if each vault token is included in strategy tokens (treating native ≡ wrapped)
  const vaultTokenSymbols = Object.keys(vaultTokens);

  const unmatchedTokens = vaultTokenSymbols.filter(symbol =>
    !strategyTokens.includes(symbol) &&
    !(nativeEquivalents[symbol] && strategyTokens.includes(nativeEquivalents[symbol]))
  );

  if (unmatchedTokens.length === 0) {
    return { isValid: true, warnings: [] };
  }

  return {
    isValid: false,
    warnings: [{
      type: 'unmatchedTokens',
      count: unmatchedTokens.length,
      items: unmatchedTokens
    }]
  };
}

/**
 * Validates that vault positions use tokens that are part of the strategy
 * @param {Array} vaultPositions - Array of position objects from the vault
 * @param {Object} pools - Pools data object from Redux (keyed by pool address)
 * @param {Array<string>} strategyTokens - Array of token symbols selected for the strategy
 * @returns {Array<string>} Array of warning messages (empty if all positions match)
 * @example
 * const positions = [{ id: '12345', pool: '0xabc...' }];
 * const pools = { '0xabc...': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } } };
 * const strategyTokens = ['USDC', 'DAI'];
 * const messages = validatePositionsForStrategy(positions, pools, strategyTokens);
 * // Returns: ["The following positions will be closed immediately: Position #12345 (ETH/USDC uses non-strategy token ETH). These positions will be closed and tokens swapped into your strategy tokens."]
 * @since 1.0.0
 */
export function validatePositionsForStrategy (vaultPositions, pools, strategyTokens, chainId) {
  // Early exit if no positions or no strategy tokens
  if (!vaultPositions || vaultPositions.length === 0) {
    return { isValid: true, warnings: [] };
  }

  if (!strategyTokens || strategyTokens.length === 0) {
    return { isValid: true, warnings: [] };
  }

  if (!pools) {
    return { isValid: true, warnings: [] };
  }

  // Build native ↔ wrapped equivalents map from chain tokens
  const nativeEquivalents = {};
  if (chainId) {
    getTokensByChain(chainId).forEach(t => {
      if (t.isNative) {
        nativeEquivalents[t.symbol] = t.wrappedSymbol;
        nativeEquivalents[t.wrappedSymbol] = t.symbol;
      }
    });
  }

  // Check each position for token mismatches
  const mismatchedPositions = [];

  vaultPositions.forEach((position, index) => {
    // Flag undefined positions as unable to validate
    if (!position) {
      mismatchedPositions.push({
        id: `position-${index}`,
        tokenPair: 'Unknown - undefined position',
        nonMatchingTokens: ['Unable to validate - undefined position']
      });
      return;
    }

    // Flag positions without pool ID as unable to validate
    if (!position.pool) {
      mismatchedPositions.push({
        id: position.id || `position-${index}`,
        tokenPair: 'Unknown - missing pool ID',
        nonMatchingTokens: ['Unable to validate - missing pool ID']
      });
      return;
    }

    const poolData = pools[position.pool];

    // Flag positions with missing pool data as unable to validate
    if (!poolData || !poolData.token0 || !poolData.token1) {
      mismatchedPositions.push({
        id: position.id,
        tokenPair: 'Unknown - missing pool data',
        nonMatchingTokens: ['Unable to validate - missing pool data']
      });
      return;
    }

    const token0Symbol = poolData.token0.symbol;
    const token1Symbol = poolData.token1.symbol;

    // Flag positions with undefined token symbols as unable to validate
    if (!token0Symbol || !token1Symbol) {
      mismatchedPositions.push({
        id: position.id,
        tokenPair: `${token0Symbol || 'undefined'}/${token1Symbol || 'undefined'}`,
        nonMatchingTokens: ['Unable to validate - undefined token symbol']
      });
      return;
    }

    // Check if both tokens are in the strategy (treating native ≡ wrapped)
    const token0Match = strategyTokens.includes(token0Symbol) ||
      (nativeEquivalents[token0Symbol] && strategyTokens.includes(nativeEquivalents[token0Symbol]));
    const token1Match = strategyTokens.includes(token1Symbol) ||
      (nativeEquivalents[token1Symbol] && strategyTokens.includes(nativeEquivalents[token1Symbol]));

    // If either token doesn't match, add to mismatched list
    if (!token0Match || !token1Match) {
      const nonMatchingTokens = [];
      if (!token0Match) nonMatchingTokens.push(token0Symbol);
      if (!token1Match) nonMatchingTokens.push(token1Symbol);

      mismatchedPositions.push({
        id: position.id,
        tokenPair: `${token0Symbol}/${token1Symbol}`,
        nonMatchingTokens: nonMatchingTokens
      });
    }
  });

  // Return result
  if (mismatchedPositions.length === 0) {
    return { isValid: true, warnings: [] };
  }

  return {
    isValid: false,
    warnings: [{
      type: 'unmatchedPositions',
      count: mismatchedPositions.length,
      items: mismatchedPositions
    }]
  };
}

/**
 * Map strategy parameters from contract return value to named objects
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - Strategy ID (e.g., 'bob', 'parris', 'fed')
 * @param {string} rawBytes - ABI-encoded bytes from contract getAllParameters call
 * @returns {Object} Named parameters with human-readable values
 * @throws {Error} If strategyId is invalid or rawBytes cannot be decoded
 * @example
 * // Map Bob strategy parameters from contract
 * const rawBytes = await strategyContract.getAllParameters(vaultAddress);
 * const mapped = mapStrategyParameters('bob', rawBytes);
 * // Returns: {
 * //   targetRangeUpper: 102,
 * //   targetRangeLower: 98,
 * //   rebalanceThresholdUpper: 2,
 * //   ...
 * // }
 * @since 1.0.0
 */
export function mapStrategyParameters(strategyId, rawBytes) {
  // Validate strategyId parameter
  validateIdString(strategyId);

  // Validate rawBytes parameter
  if (rawBytes === null || rawBytes === undefined) {
    throw new Error('rawBytes parameter is required');
  }

  if (typeof rawBytes !== 'string') {
    throw new Error('rawBytes must be a hex string');
  }

  // Validate strategy exists
  const strategy = strategies[strategyId];
  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  try {
    const strategyIdLower = strategyId.toLowerCase();

    // Strategy-specific parameter decoding and mapping
    if (strategyIdLower === 'bob') {
      // Decode bytes to typed values
      const params = ethers.utils.defaultAbiCoder.decode(
        ['uint16', 'uint16', 'bool', 'uint256', 'uint16', 'uint16', 'uint16'],
        rawBytes
      );

      return {
        // Range Parameters
        targetRangeUpper: parseInt(params[0]) / 100, // Convert basis points to percent
        targetRangeLower: parseInt(params[1]) / 100,

        // Fee Settings
        feeReinvestment: params[2],
        reinvestmentTrigger: ethers.utils.formatUnits(params[3], 2), // Convert to dollars with 2 decimal places
        reinvestmentRatio: parseInt(params[4]) / 100,

        // Risk Management
        maxSlippage: parseInt(params[5]) / 100,
        emergencyExitTrigger: parseInt(params[6]) / 100
      };
    }
    else if (strategyIdLower === 'parris') {
      // Decode bytes to typed values
      // Note: OracleSource and PlatformSelectionCriteria enums are uint8 in Solidity
      const params = ethers.utils.defaultAbiCoder.decode(
        [
          'uint16', 'uint16', 'uint16', 'uint16',           // Range params
          'bool', 'uint256', 'uint16',                       // Fee settings
          'uint16', 'uint16', 'uint16',                      // Risk management
          'bool', 'uint8', 'uint8', 'uint16', 'uint16', 'uint16', 'uint16', 'uint16', 'uint16', // Adaptive
          'uint8', 'uint16',                                 // Oracle (enum is uint8)
          'uint16', 'uint256', 'uint16',                     // Position sizing
          'uint8', 'uint256'                                 // Platform (enum is uint8)
        ],
        rawBytes
      );

      return {
        // Range Parameters
        targetRangeUpper: parseInt(params[0]) / 100, // Convert basis points to percent
        targetRangeLower: parseInt(params[1]) / 100,
        rebalanceThresholdUpper: parseInt(params[2]) / 100,
        rebalanceThresholdLower: parseInt(params[3]) / 100,

        // Fee Settings
        feeReinvestment: params[4],
        reinvestmentTrigger: ethers.utils.formatUnits(params[5], 2),
        reinvestmentRatio: parseInt(params[6]) / 100,

        // Risk Management
        maxSlippage: parseInt(params[7]) / 100,
        emergencyExitTrigger: parseInt(params[8]) / 100,
        maxVaultUtilization: parseInt(params[9]) / 100,

        // Adaptive Settings
        adaptiveRanges: params[10],
        rebalanceCountThresholdHigh: parseInt(params[11]),
        rebalanceCountThresholdLow: parseInt(params[12]),
        adaptiveTimeframeHigh: parseInt(params[13]),
        adaptiveTimeframeLow: parseInt(params[14]),
        rangeAdjustmentPercentHigh: parseInt(params[15]) / 100,
        thresholdAdjustmentPercentHigh: parseInt(params[16]) / 100,
        rangeAdjustmentPercentLow: parseInt(params[17]) / 100,
        thresholdAdjustmentPercentLow: parseInt(params[18]) / 100,

        // Oracle Settings
        oracleSource: parseInt(params[19]),
        priceDeviationTolerance: parseInt(params[20]) / 100,

        // Position Sizing
        maxPositionSizePercent: parseInt(params[21]) / 100,
        minPositionSize: ethers.utils.formatUnits(params[22], 2),
        targetUtilization: parseInt(params[23]) / 100,

        // Platform Settings
        platformSelectionCriteria: parseInt(params[24]),
        minPoolLiquidity: ethers.utils.formatUnits(params[25], 2)
      };
    }
    else if (strategyIdLower === 'fed') {
      // Decode bytes to typed values
      const params = ethers.utils.defaultAbiCoder.decode(
        ['uint16', 'uint16', 'bool', 'uint16'],
        rawBytes
      );

      return {
        targetRange: parseInt(params[0]) / 100,
        rebalanceThreshold: parseInt(params[1]) / 100,
        feeReinvestment: params[2],
        maxSlippage: parseInt(params[3]) / 100
      };
    }

    // If we reach here, we don't know how to map this strategy
    throw new Error(`No parameter mapping defined for strategy ${strategyId}`);
  } catch (error) {
    // Re-throw our custom errors as-is
    if (error.message.includes('No parameter mapping')) {
      throw error;
    }
    // Wrap decode/other errors with context
    throw new Error(`Error mapping strategy parameters for ${strategyId}: ${error.message}`);
  }
}
