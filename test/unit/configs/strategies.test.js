/**
 * Strategy Configuration Validation Tests
 *
 * Tests to validate the structure and integrity of strategy configurations
 */

import { describe, it, expect } from 'vitest';
import strategies from '../../../src/configs/strategies.js';

/**
 * Validate templateEnumMap configuration for a strategy
 * @param {string} strategyId - ID of the strategy
 * @param {Object} templateEnumMap - The templateEnumMap to validate
 * @param {Object} templates - The templates object to validate against
 * @throws {Error} Throws error if templateEnumMap is invalid
 */
function validateTemplateEnumMap(strategyId, templateEnumMap, templates) {
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
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @param {Object} parameterGroups - Parameter groups to validate group dependency
 * @param {Object} contractParametersGroups - Contract parameter groups to validate contractGroup dependency
 * @throws {Error} If required properties are missing or invalid
 */
function validateParameterBase(paramId, paramConfig, parameterGroups, contractParametersGroups) {
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
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @param {Object} parameterGroups - Parameter groups for validation
 * @param {Object} contractParametersGroups - Contract parameter groups for validation
 * @throws {Error} If parameter is invalid
 */
function validateBooleanParameter(paramId, paramConfig, parameterGroups, contractParametersGroups) {
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
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @param {Object} parameterGroups - Parameter groups for validation
 * @param {Object} contractParametersGroups - Contract parameter groups for validation
 * @throws {Error} If parameter is invalid
 */
function validateTokenDepositsParameter(paramId, paramConfig, parameterGroups, contractParametersGroups) {
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
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @param {Object} parameterGroups - Parameter groups for validation
 * @param {Object} contractParametersGroups - Contract parameter groups for validation
 * @throws {Error} If parameter is invalid
 */
function validatePercentParameter(paramId, paramConfig, parameterGroups, contractParametersGroups) {
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
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @param {Object} parameterGroups - Parameter groups for validation
 * @param {Object} contractParametersGroups - Contract parameter groups for validation
 * @throws {Error} If parameter is invalid
 */
function validateNumberParameter(paramId, paramConfig, parameterGroups, contractParametersGroups) {
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
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @param {Object} parameterGroups - Parameter groups for validation
 * @param {Object} contractParametersGroups - Contract parameter groups for validation
 * @throws {Error} If parameter is invalid
 */
function validateFiatCurrencyParameter(paramId, paramConfig, parameterGroups, contractParametersGroups) {
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
 * @param {string} paramId - Parameter identifier
 * @param {Object} paramConfig - Parameter configuration object
 * @param {Object} parameterGroups - Parameter groups for validation
 * @param {Object} contractParametersGroups - Contract parameter groups for validation
 * @throws {Error} If parameter is invalid
 */
function validateSelectParameter(paramId, paramConfig, parameterGroups, contractParametersGroups) {
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
 * @param {string} strategyId - Strategy identifier
 * @param {Object} parameterGroups - Parameter groups object to validate
 * @throws {Error} If parameter groups are invalid
 */
function validateParameterGroups(strategyId, parameterGroups) {
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
 * @param {string} strategyId - Strategy identifier
 * @param {Object} contractParametersGroups - Contract parameter groups object to validate
 * @throws {Error} If contract parameter groups are invalid
 */
function validateContractParametersGroups(strategyId, contractParametersGroups) {
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
  });
}

/**
 * Validate template configuration
 * @param {string} strategyId - Strategy identifier
 * @param {string} templateId - Template identifier
 * @param {Object} templateConfig - Template configuration object
 * @param {Object} strategyParameters - Strategy parameters to validate defaults against
 * @param {Object} templateEnumMap - Template enum map to validate template has corresponding entry
 * @throws {Error} If template is invalid
 */
function validateTemplateConfiguration(strategyId, templateId, templateConfig, strategyParameters, templateEnumMap) {
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
}

describe('Strategy Configuration Validation', () => {
  it('should have all required properties for every strategy', () => {
    const requiredStringProperties = [
      'id', 'name', 'subtitle', 'description', 'icon', 'color', 'borderColor', 'textColor', 'tokenSupport'
    ];

    const requiredNumberProperties = [
      'minTokens', 'maxTokens', 'minPlatforms', 'maxPlatforms', 'minPositions', 'maxPositions'
    ];

    const requiredObjectProperties = [
      'parameters', 'templates', 'parameterGroups', 'contractParametersGroups', 'strategyProperties'
    ];

    const errors = [];

    Object.entries(strategies).forEach(([strategyId, strategy]) => {
      const strategyErrors = [];

      // Validate string properties
      requiredStringProperties.forEach(prop => {
        if (!strategy[prop] || typeof strategy[prop] !== 'string' || strategy[prop].trim() === '') {
          strategyErrors.push(`Missing or empty string property: ${prop}`);
        }
      });

      // Validate number properties
      requiredNumberProperties.forEach(prop => {
        if (!Number.isFinite(strategy[prop]) || strategy[prop] < 0) {
          strategyErrors.push(`Missing or invalid number property: ${prop}`);
        }
      });

      // Validate object properties
      requiredObjectProperties.forEach(prop => {
        if (!strategy[prop] || typeof strategy[prop] !== 'object' || Array.isArray(strategy[prop])) {
          strategyErrors.push(`Missing or invalid object property: ${prop}`);
        }
      });

      // Validate templateEnumMap using our validation function
      try {
        validateTemplateEnumMap(strategyId, strategy.templateEnumMap, strategy.templates);
      } catch (error) {
        strategyErrors.push(`templateEnumMap validation failed: ${error.message}`);
      }

      // Validate that strategy has required 'custom' template
      if (!strategy.templates || !strategy.templates.hasOwnProperty('custom')) {
        strategyErrors.push(`Strategy missing required 'custom' template`);
      }

      // Validate tokenSupport enum value
      const validTokenSupport = ['all', 'stablecoins', 'custom'];
      if (!validTokenSupport.includes(strategy.tokenSupport)) {
        strategyErrors.push(`tokenSupport must be one of: ${validTokenSupport.join(', ')}`);
      }

      // Validate conditional supportedTokens based on tokenSupport
      if (strategy.tokenSupport === 'custom') {
        // supportedTokens is required and must be non-empty for custom
        if (!strategy.supportedTokens || typeof strategy.supportedTokens !== 'object' || Array.isArray(strategy.supportedTokens)) {
          strategyErrors.push('supportedTokens is required and must be an object when tokenSupport is "custom"');
        } else if (Object.keys(strategy.supportedTokens).length === 0) {
          strategyErrors.push('supportedTokens must be non-empty when tokenSupport is "custom"');
        }
      } else {
        // supportedTokens must not exist for 'all' and 'stablecoins'
        if (strategy.supportedTokens !== undefined) {
          strategyErrors.push(`supportedTokens must not exist when tokenSupport is "${strategy.tokenSupport}"`);
        }
      }

      // Validate parameters using type-specific validators
      if (strategy.parameters && typeof strategy.parameters === 'object') {
        Object.entries(strategy.parameters).forEach(([paramId, paramConfig]) => {
          try {
            // Use the appropriate type-specific validator based on parameter type
            switch (paramConfig.type) {
              case 'boolean':
                validateBooleanParameter(paramId, paramConfig, strategy.parameterGroups, strategy.contractParametersGroups);
                break;
              case 'percent':
                validatePercentParameter(paramId, paramConfig, strategy.parameterGroups, strategy.contractParametersGroups);
                break;
              case 'number':
                validateNumberParameter(paramId, paramConfig, strategy.parameterGroups, strategy.contractParametersGroups);
                break;
              case 'fiat-currency':
                validateFiatCurrencyParameter(paramId, paramConfig, strategy.parameterGroups, strategy.contractParametersGroups);
                break;
              case 'select':
                validateSelectParameter(paramId, paramConfig, strategy.parameterGroups, strategy.contractParametersGroups);
                break;
              case 'token-deposits':
                validateTokenDepositsParameter(paramId, paramConfig, strategy.parameterGroups, strategy.contractParametersGroups);
                break;
              default:
                strategyErrors.push(`Parameter ${paramId} has unknown type: ${paramConfig.type}`);
            }
          } catch (error) {
            strategyErrors.push(`Parameter ${paramId} validation failed: ${error.message}`);
          }
        });
      }

      // Validate parameterGroups using comprehensive validator
      try {
        validateParameterGroups(strategyId, strategy.parameterGroups);
      } catch (error) {
        strategyErrors.push(`parameterGroups validation failed: ${error.message}`);
      }

      // Validate contractParametersGroups using comprehensive validator
      try {
        validateContractParametersGroups(strategyId, strategy.contractParametersGroups);
      } catch (error) {
        strategyErrors.push(`contractParametersGroups validation failed: ${error.message}`);
      }

      // Validate templates using comprehensive template validator
      if (strategy.templates && typeof strategy.templates === 'object' && !Array.isArray(strategy.templates)) {
        Object.entries(strategy.templates).forEach(([templateId, templateConfig]) => {
          try {
            validateTemplateConfiguration(strategyId, templateId, templateConfig, strategy.parameters, strategy.templateEnumMap);
          } catch (error) {
            strategyErrors.push(`Template ${templateId} validation failed: ${error.message}`);
          }
        });
      }

      // If there are errors for this strategy, add them to the main errors array
      if (strategyErrors.length > 0) {
        errors.push(`Strategy "${strategyId}" validation errors:`);
        strategyErrors.forEach(error => errors.push(`  - ${error}`));
      }
    });

    // If there are any validation errors, fail the test with detailed information
    if (errors.length > 0) {
      const errorMessage = `Strategy configuration validation failed:\n${errors.join('\n')}`;
      throw new Error(errorMessage);
    }

    // If we get here, all strategies are valid
    expect(errors).toHaveLength(0);
  });

  it('should have valid Baby Steps strategy properties', () => {
    const babyStepsConfig = strategies.bob;

    expect(babyStepsConfig).toBeDefined();
    expect(babyStepsConfig.strategyProperties).toBeDefined();
    expect(typeof babyStepsConfig.strategyProperties).toBe('object');

    // Test that all required pool properties exist and are valid numbers
    const requiredPoolProperties = ['minTVL', 'minPoolAge', 'maxFeeTier', 'tvlAveragingPeriod', 'minDeploymentMultiplier'];

    requiredPoolProperties.forEach(prop => {
      expect(babyStepsConfig.strategyProperties[prop]).toBeDefined();
      expect(typeof babyStepsConfig.strategyProperties[prop]).toBe('number');
      expect(Number.isFinite(babyStepsConfig.strategyProperties[prop])).toBe(true);
      expect(babyStepsConfig.strategyProperties[prop]).toBeGreaterThan(0);
    });

    // Test the actual expected values
    expect(babyStepsConfig.strategyProperties.minTVL).toBe(1000000);
    expect(babyStepsConfig.strategyProperties.minPoolAge).toBe(90);
    expect(babyStepsConfig.strategyProperties.maxFeeTier).toBe(3000);
    expect(babyStepsConfig.strategyProperties.tvlAveragingPeriod).toBe(14);
    expect(babyStepsConfig.strategyProperties.minDeploymentMultiplier).toBe(1.0);
  });
});
