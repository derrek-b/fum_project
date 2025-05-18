// src/helpers/strategyHelpers.js
import strategies from '../configs/strategies.js';

/**
 * Get the list of available strategy configs (excluding the "none" strategy)
 * @returns {Array} Array of strategy objects with id, name, and subtitle
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
 * @param {string} strategyId - ID of the strategy to get details for
 * @returns {Object} Strategy details object
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
 * @param {string} strategyId - ID of the strategy
 * @returns {Array} Array of template objects
 */
export function getStrategyTemplates(strategyId) {
  const strategy = strategies[strategyId];
  if (!strategy || !strategy.templates) return [];

  return strategy.templates;
}

/**
 * Get default parameters for a specific template
 * @param {string} strategyId - ID of the strategy
 * @param {string} templateId - ID of the template
 * @returns {Object} Default parameter values for the template
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
 * @param {string} strategyId - ID of the strategy
 * @returns {Object} Object with default parameter values
 */
export function getDefaultParams(strategyId) {
  return getTemplateDefaults(strategyId, "custom");
}

/**
 * Get parameter definitions for a strategy
 * @param {string} strategyId - ID of the strategy
 * @returns {Object} Object with parameter definitions
 */
export function getStrategyParameters(strategyId) {
  const strategy = strategies[strategyId];
  if (!strategy) return {};

  return strategy.parameters;
}

/**
 * Get parameters for a specific group
 * @param {string} strategyId - ID of the strategy
 * @param {number} groupId - Group ID
 * @returns {Object} Object with parameter definitions for the specified group
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
 * @param {string} strategyId - ID of the strategy
 * @param {string} contractGroup - Contract group ID
 * @returns {Object} Object with parameter definitions for the contract group
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
 * @param {string} strategyId - ID of the strategy
 * @param {Object} params - Parameter values to validate
 * @returns {Object} Validation result with isValid flag and errors object
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
 * @param {string} strategyId - ID of the strategy
 * @param {string} contractGroupId - Contract group ID
 * @returns {string|null} Setter method name or null if not found
 */
export function getParameterSetterMethod(strategyId, contractGroupId) {
  const strategy = strategies[strategyId];
  if (!strategy || !strategy.contractParametersGroups) return null;

  const group = strategy.contractParametersGroups.find(g => g.id === contractGroupId);
  return group ? group.setterMethod : null;
}

/**
 * Check if a parameter should be shown based on condition
 * @param {Object} paramConfig - Parameter configuration
 * @param {Object} currentParams - Current parameter values
 * @returns {boolean} Whether the parameter should be shown
 */
export function shouldShowParameter(paramConfig, currentParams) {
  if (!paramConfig.conditionalOn) return true;

  const conditionParamValue = currentParams[paramConfig.conditionalOn];
  return conditionParamValue === paramConfig.conditionalValue;
}

/**
 * Get all strategy IDs
 * @returns {Array<string>} Array of strategy IDs
 */
export function getAllStrategyIds() {
  return Object.keys(strategies);
}

/**
 * Check if a strategy supports specific tokens
 * @param {string} strategyId - ID of the strategy
 * @param {Array<string>} tokenSymbols - Array of token symbols
 * @returns {boolean} Whether the strategy supports all tokens
 */
export function strategySupportsTokens(strategyId, tokenSymbols) {
  const strategy = strategies[strategyId];
  if (!strategy || !strategy.supportedTokens) return false;

  const supportedSymbols = Object.keys(strategy.supportedTokens);
  return tokenSymbols.every(symbol => supportedSymbols.includes(symbol));
}

/**
 * Format parameter value for display
 * @param {any} value - Parameter value
 * @param {Object} paramConfig - Parameter configuration
 * @returns {string} Formatted value
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
 * @param {Object} vaultTokens - Object containing token balances in the vault
 * @param {Object} strategyConfig - Strategy configuration containing token selections
 * @returns {Array<string>} Array of validation messages (empty if validation passes)
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
