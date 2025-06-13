/**
 * @module helpers/strategyHelpers
 * @description Strategy configuration utilities for managing trading strategies, parameters, and templates.
 * Provides functions to query strategies, validate parameters, and manage strategy configurations.
 * @since 1.0.0
 */

import strategies from '../configs/strategies.js';

/**
 * Get the list of available strategy configs (excluding the "none" strategy)
 * @memberof module:helpers/strategyHelpers
 * @returns {Array<Object>} Array of strategy objects with complete configuration data
 * @example
 * // Get all available strategies
 * const strategies = getAvailableStrategies();
 * // Returns: [
 * //   {
 * //     id: "bob",
 * //     name: "Bob",
 * //     subtitle: "Range-bound trading",
 * //     description: "...",
 * //     templateEnumMap: { conservative: 0, balanced: 1, ... },
 * //     parameters: { ... },
 * //     parameterGroups: [...],
 * //     comingSoon: false
 * //   },
 * //   ...
 * // ]
 * 
 * @example
 * // Filter active strategies only
 * const activeStrategies = getAvailableStrategies()
 *   .filter(strategy => !strategy.comingSoon);
 * @since 1.0.0
 */
export function getAvailableStrategies() {
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
      contractParametersGroups: strategy.contractParametersGroups,
      comingSoon: strategy.comingSoon || false
    }));
}

/**
 * Get details about a specific strategy
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy to get details for (e.g., 'bob', 'parris')
 * @returns {Object|null} Strategy details object with complete configuration - null if not found
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
 * const strategy = getStrategyDetails('unknown');
 * if (!strategy) {
 *   console.error('Strategy not found');
 * }
 * @since 1.0.0
 */
export function getStrategyDetails(strategyId) {
  const strategy = strategies[strategyId];
  if (!strategy) return null;

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
    parameterGroups: strategy.parameterGroups || [],
  };
}

/**
 * Get templates for a specific strategy
 * @memberof module:helpers/strategyHelpers
 * @param {string} strategyId - ID of the strategy
 * @returns {Array<Object>} Array of template objects with predefined parameter sets
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
 * // Build template selector
 * const templateOptions = getStrategyTemplates(strategyId).map(template => ({
 *   value: template.id,
 *   label: template.name,
 *   description: template.description
 * }));
 * @since 1.0.0
 */
export function getStrategyTemplates(strategyId) {
  const strategy = strategies[strategyId];
  if (!strategy || !strategy.templates) return [];

  return strategy.templates;
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
  const strategy = strategies[strategyId];
  if (!strategy || !strategy.templates) return {};

  // For custom template or when no specific template is selected
  if (templateId === "custom" || !templateId) {
    return Object.entries(strategy.parameters || {}).reduce((defaults, [paramId, paramConfig]) => {
      defaults[paramId] = paramConfig.defaultValue;
      return defaults;
    }, {});
  }

  // Find the specific template
  const template = strategy.templates.find(t => t.id === templateId);
  if (!template || !template.defaults) {
    // Fallback to strategy defaults
    return getTemplateDefaults(strategyId, "custom");
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
  const strategy = strategies[strategyId];
  if (!strategy) return {};

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
  const strategy = strategies[strategyId];
  if (!strategy) return {};

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
 * Get all strategy IDs
 * @memberof module:helpers/strategyHelpers
 * @returns {Array<string>} Array of all configured strategy IDs
 * @example
 * // Get all strategy IDs
 * const ids = getAllStrategyIds();
 * // Returns: ['none', 'bob', 'parris', 'fed', ...]
 * 
 * @example
 * // Check if strategy exists
 * if (getAllStrategyIds().includes(userStrategy)) {
 *   loadStrategy(userStrategy);
 * }
 * @since 1.0.0
 */
export function getAllStrategyIds() {
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
 * const compatibleStrategies = getAvailableStrategies()
 *   .filter(strategy => 
 *     strategySupportsTokens(strategy.id, selectedTokens)
 *   );
 * @since 1.0.0
 */
export function strategySupportsTokens(strategyId, tokenSymbols) {
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
