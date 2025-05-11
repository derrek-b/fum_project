import { describe, it, expect } from 'vitest';
import strategies from '../../src/configs/strategies.js';
import {
  getAvailableStrategies,
  getStrategyDetails,
  getStrategyTemplates,
  getTemplateDefaults,
  getDefaultParams,
  getStrategyParameters,
  getStrategyParametersByGroup,
  getParametersByContractGroup,
  validateStrategyParams,
  getParameterSetterMethod,
  shouldShowParameter,
  getAllStrategyIds,
  strategySupportsTokens,
  formatParameterValue,
  validateTokensForStrategy
} from '../../src/helpers/strategyHelpers.js';

describe('strategyHelpers', () => {
  // Get actual strategy IDs from the config for testing
  const realStrategyIds = Object.keys(strategies);
  const validStrategyId = realStrategyIds.find(id => id !== 'none');
  
  // Find a strategy with at least one template
  const strategyWithTemplates = realStrategyIds.find(id => 
    strategies[id]?.templates && strategies[id].templates.length > 0
  );
  
  // Find a strategy with parameters
  const strategyWithParams = realStrategyIds.find(id => 
    strategies[id]?.parameters && Object.keys(strategies[id].parameters).length > 0
  );
  
  describe('getAvailableStrategies', () => {
    it('should return an array of all strategies except the "none" strategy', () => {
      const result = getAvailableStrategies();
      
      // Should be an array
      expect(Array.isArray(result)).toBe(true);
      
      // Should not include the "none" strategy
      const noneStrategy = result.find(strategy => strategy.id === 'none');
      expect(noneStrategy).toBeUndefined();
      
      // Should include all other strategies
      const otherStrategyIds = realStrategyIds.filter(id => id !== 'none');
      otherStrategyIds.forEach(id => {
        const strategy = result.find(s => s.id === id);
        expect(strategy).toBeDefined();
      });
    });
    
    it('should include required properties for each strategy', () => {
      const result = getAvailableStrategies();
      
      result.forEach(strategy => {
        expect(strategy).toHaveProperty('id');
        expect(strategy).toHaveProperty('name');
        expect(strategy).toHaveProperty('templateEnumMap');
      });
    });
  });
  
  describe('getStrategyDetails', () => {
    it('should return the correct details for a valid strategy ID', () => {
      const details = getStrategyDetails(validStrategyId);
      
      expect(details).toHaveProperty('id', validStrategyId);
      expect(details).toHaveProperty('name', strategies[validStrategyId].name);
      expect(details).toHaveProperty('subtitle', strategies[validStrategyId].subtitle);
      expect(details).toHaveProperty('description', strategies[validStrategyId].description);
    });
    
    it('should return null for an invalid strategy ID', () => {
      const details = getStrategyDetails('nonexistent-strategy');
      expect(details).toBeNull();
    });
  });
  
  describe('getStrategyTemplates', () => {
    it('should return the templates for a strategy with templates', () => {
      if (strategyWithTemplates) {
        const templates = getStrategyTemplates(strategyWithTemplates);
        expect(Array.isArray(templates)).toBe(true);
        expect(templates).toEqual(strategies[strategyWithTemplates].templates);
      } else {
        console.log('No strategy with templates found, skipping test');
      }
    });
    
    it('should return an empty array for a strategy without templates', () => {
      // Find a strategy without templates
      const strategyWithoutTemplates = realStrategyIds.find(id => 
        !strategies[id]?.templates || strategies[id].templates.length === 0
      );
      
      if (strategyWithoutTemplates) {
        const templates = getStrategyTemplates(strategyWithoutTemplates);
        expect(templates).toEqual([]);
      } else {
        console.log('All strategies have templates, skipping test');
      }
    });
    
    it('should return an empty array for an invalid strategy ID', () => {
      const templates = getStrategyTemplates('nonexistent-strategy');
      expect(templates).toEqual([]);
    });
  });
  
  describe('getTemplateDefaults', () => {
    it('should return default parameters for a specific template', () => {
      // Find a strategy with templates
      if (strategyWithTemplates) {
        const templateId = strategies[strategyWithTemplates].templates[0].id;
        const defaults = getTemplateDefaults(strategyWithTemplates, templateId);
        
        // Should be an object
        expect(typeof defaults).toBe('object');
        
        // Should match the template defaults
        const template = strategies[strategyWithTemplates].templates.find(t => t.id === templateId);
        if (template && template.defaults) {
          expect(defaults).toEqual(template.defaults);
        }
      } else {
        console.log('No strategy with templates found, skipping test');
      }
    });
    
    it('should return strategy defaults for a "custom" template', () => {
      if (strategyWithParams) {
        const defaults = getTemplateDefaults(strategyWithParams, 'custom');
        
        // Should be an object
        expect(typeof defaults).toBe('object');
        
        // Check a few default values match strategy parameter defaults
        const params = strategies[strategyWithParams].parameters;
        const paramIds = Object.keys(params);
        
        if (paramIds.length > 0) {
          const firstParamId = paramIds[0];
          expect(defaults[firstParamId]).toBe(params[firstParamId].defaultValue);
        }
      } else {
        console.log('No strategy with parameters found, skipping test');
      }
    });
    
    it('should return an empty object for an invalid strategy ID', () => {
      const defaults = getTemplateDefaults('nonexistent-strategy', 'template1');
      expect(defaults).toEqual({});
    });
  });
  
  describe('getDefaultParams', () => {
    it('should return default parameters for a valid strategy ID', () => {
      if (strategyWithParams) {
        const defaults = getDefaultParams(strategyWithParams);
        
        // Should be an object
        expect(typeof defaults).toBe('object');
        
        // Should equal what getTemplateDefaults returns for "custom"
        const customDefaults = getTemplateDefaults(strategyWithParams, 'custom');
        expect(defaults).toEqual(customDefaults);
      } else {
        console.log('No strategy with parameters found, skipping test');
      }
    });
    
    it('should return an empty object for an invalid strategy ID', () => {
      const defaults = getDefaultParams('nonexistent-strategy');
      expect(defaults).toEqual({});
    });
  });
  
  describe('getStrategyParameters', () => {
    it('should return the parameters for a strategy with parameters', () => {
      if (strategyWithParams) {
        const parameters = getStrategyParameters(strategyWithParams);
        
        // Should be an object
        expect(typeof parameters).toBe('object');
        
        // Should equal the strategy's parameters
        expect(parameters).toEqual(strategies[strategyWithParams].parameters);
      } else {
        console.log('No strategy with parameters found, skipping test');
      }
    });
    
    it('should return an empty object for an invalid strategy ID', () => {
      const parameters = getStrategyParameters('nonexistent-strategy');
      expect(parameters).toEqual({});
    });
  });
  
  describe('getStrategyParametersByGroup', () => {
    it('should return parameters for a specific group', () => {
      // Find a strategy with parameters in a group
      let testStrategy, groupId;
      
      strategyLoop:
      for (const stratId of realStrategyIds) {
        const params = strategies[stratId]?.parameters || {};
        for (const [paramId, paramConfig] of Object.entries(params)) {
          if (paramConfig.group !== undefined) {
            testStrategy = stratId;
            groupId = paramConfig.group;
            break strategyLoop;
          }
        }
      }
      
      if (testStrategy && groupId !== undefined) {
        const groupParams = getStrategyParametersByGroup(testStrategy, groupId);
        
        // Should be an object
        expect(typeof groupParams).toBe('object');
        
        // All returned parameters should belong to the specified group
        Object.values(groupParams).forEach(param => {
          expect(param.group).toBe(groupId);
        });
      } else {
        console.log('No strategy with grouped parameters found, skipping test');
      }
    });
    
    it('should return an empty object for an invalid strategy ID', () => {
      const groupParams = getStrategyParametersByGroup('nonexistent-strategy', 1);
      expect(groupParams).toEqual({});
    });
    
    it('should return an empty object for a non-existent group', () => {
      if (strategyWithParams) {
        const groupParams = getStrategyParametersByGroup(strategyWithParams, 999);
        expect(groupParams).toEqual({});
      } else {
        console.log('No strategy with parameters found, skipping test');
      }
    });
  });
  
  describe('getParametersByContractGroup', () => {
    it('should return parameters for a specific contract group', () => {
      // Find a strategy with parameters in a contract group
      let testStrategy, contractGroup;
      
      strategyLoop:
      for (const stratId of realStrategyIds) {
        const params = strategies[stratId]?.parameters || {};
        for (const [paramId, paramConfig] of Object.entries(params)) {
          if (paramConfig.contractGroup !== undefined) {
            testStrategy = stratId;
            contractGroup = paramConfig.contractGroup;
            break strategyLoop;
          }
        }
      }
      
      if (testStrategy && contractGroup !== undefined) {
        const contractParams = getParametersByContractGroup(testStrategy, contractGroup);
        
        // Should be an object
        expect(typeof contractParams).toBe('object');
        
        // All returned parameters should belong to the specified contract group
        Object.values(contractParams).forEach(param => {
          expect(param.contractGroup).toBe(contractGroup);
        });
      } else {
        console.log('No strategy with contract group parameters found, skipping test');
      }
    });
    
    it('should return an empty object for an invalid strategy ID', () => {
      const contractParams = getParametersByContractGroup('nonexistent-strategy', 'group1');
      expect(contractParams).toEqual({});
    });
    
    it('should return an empty object for a non-existent contract group', () => {
      if (strategyWithParams) {
        const contractParams = getParametersByContractGroup(strategyWithParams, 'nonexistent-group');
        expect(contractParams).toEqual({});
      } else {
        console.log('No strategy with parameters found, skipping test');
      }
    });
  });
  
  describe('validateStrategyParams', () => {
    it('should return valid result for valid parameters', () => {
      if (strategyWithParams) {
        // Get default parameters for the strategy
        const defaultParams = getDefaultParams(strategyWithParams);
        
        // Validate using default parameters
        const result = validateStrategyParams(strategyWithParams, defaultParams);
        
        expect(result).toHaveProperty('isValid', true);
        expect(result).toHaveProperty('errors');
        expect(Object.keys(result.errors)).toHaveLength(0);
      } else {
        console.log('No strategy with parameters found, skipping test');
      }
    });
    
    it('should return invalid result for missing required parameters', () => {
      if (strategyWithParams) {
        // Get default parameters for the strategy
        const defaultParams = getDefaultParams(strategyWithParams);
        
        // Find a required parameter
        const params = strategies[strategyWithParams].parameters;
        const requiredParamId = Object.keys(params).find(id => 
          params[id].conditionalOn === undefined // Not conditional
        );
        
        if (requiredParamId) {
          // Create invalid parameters by removing a required parameter
          const invalidParams = { ...defaultParams };
          delete invalidParams[requiredParamId];
          
          // Validate the invalid parameters
          const result = validateStrategyParams(strategyWithParams, invalidParams);
          
          expect(result).toHaveProperty('isValid', false);
          expect(result).toHaveProperty('errors');
          expect(result.errors[requiredParamId]).toBeDefined();
        } else {
          console.log('No required parameters found, skipping test');
        }
      } else {
        console.log('No strategy with parameters found, skipping test');
      }
    });
    
    it('should return invalid result for an invalid strategy ID', () => {
      const result = validateStrategyParams('nonexistent-strategy', {});
      
      expect(result).toHaveProperty('isValid', false);
      expect(result).toHaveProperty('errors');
      expect(result.errors._general).toBeDefined();
    });
  });
  
  describe('getParameterSetterMethod', () => {
    it('should return the setter method for a valid contract group', () => {
      // Find a strategy with contract parameter groups
      let testStrategy, contractGroupId;
      
      for (const stratId of realStrategyIds) {
        const contractGroups = strategies[stratId]?.contractParametersGroups || [];
        if (contractGroups.length > 0) {
          testStrategy = stratId;
          contractGroupId = contractGroups[0].id;
          break;
        }
      }
      
      if (testStrategy && contractGroupId) {
        const setterMethod = getParameterSetterMethod(testStrategy, contractGroupId);
        
        // Get the expected setter method from the strategy configuration
        const contractGroup = strategies[testStrategy].contractParametersGroups.find(g => g.id === contractGroupId);
        
        expect(setterMethod).toBe(contractGroup.setterMethod);
      } else {
        console.log('No strategy with contract parameter groups found, skipping test');
      }
    });
    
    it('should return null for an invalid contract group', () => {
      if (validStrategyId) {
        const setterMethod = getParameterSetterMethod(validStrategyId, 'nonexistent-group');
        expect(setterMethod).toBeNull();
      } else {
        console.log('No valid strategy ID found, skipping test');
      }
    });
    
    it('should return null for an invalid strategy ID', () => {
      const setterMethod = getParameterSetterMethod('nonexistent-strategy', 'group1');
      expect(setterMethod).toBeNull();
    });
  });
  
  describe('shouldShowParameter', () => {
    it('should return true for a parameter without conditions', () => {
      // Create a parameter config without conditions
      const paramConfig = { name: 'Test Parameter' };
      const currentParams = {};
      
      const shouldShow = shouldShowParameter(paramConfig, currentParams);
      expect(shouldShow).toBe(true);
    });
    
    it('should return true for a parameter with matching condition', () => {
      // Create a parameter config with condition
      const paramConfig = { 
        name: 'Test Parameter',
        conditionalOn: 'otherParam', 
        conditionalValue: true 
      };
      
      const currentParams = { otherParam: true };
      
      const shouldShow = shouldShowParameter(paramConfig, currentParams);
      expect(shouldShow).toBe(true);
    });
    
    it('should return false for a parameter with non-matching condition', () => {
      // Create a parameter config with condition
      const paramConfig = { 
        name: 'Test Parameter',
        conditionalOn: 'otherParam', 
        conditionalValue: true 
      };
      
      const currentParams = { otherParam: false };
      
      const shouldShow = shouldShowParameter(paramConfig, currentParams);
      expect(shouldShow).toBe(false);
    });
  });
  
  describe('getAllStrategyIds', () => {
    it('should return all strategy IDs from the config', () => {
      const strategyIds = getAllStrategyIds();
      expect(strategyIds).toEqual(realStrategyIds);
    });
  });
  
  describe('strategySupportsTokens', () => {
    it('should return true when all tokens are supported by the strategy', () => {
      // Find a strategy with supportedTokens
      const strategyWithSupportedTokens = realStrategyIds.find(id => 
        strategies[id]?.supportedTokens && Object.keys(strategies[id].supportedTokens).length > 0
      );
      
      if (strategyWithSupportedTokens) {
        // Get the tokens supported by this strategy
        const supportedTokens = Object.keys(strategies[strategyWithSupportedTokens].supportedTokens);
        
        if (supportedTokens.length > 0) {
          const result = strategySupportsTokens(strategyWithSupportedTokens, [supportedTokens[0]]);
          expect(result).toBe(true);
        } else {
          console.log('Strategy has empty supportedTokens, skipping test');
        }
      } else {
        console.log('No strategy with supportedTokens found, skipping test');
      }
    });
    
    it('should return false when some tokens are not supported by the strategy', () => {
      // Find a strategy with supportedTokens
      const strategyWithSupportedTokens = realStrategyIds.find(id => 
        strategies[id]?.supportedTokens && Object.keys(strategies[id].supportedTokens).length > 0
      );
      
      if (strategyWithSupportedTokens) {
        const result = strategySupportsTokens(strategyWithSupportedTokens, ['NONEXISTENT_TOKEN']);
        expect(result).toBe(false);
      } else {
        console.log('No strategy with supportedTokens found, skipping test');
      }
    });
    
    it('should return false for an invalid strategy ID', () => {
      const result = strategySupportsTokens('nonexistent-strategy', ['USDC']);
      expect(result).toBe(false);
    });
  });
  
  describe('formatParameterValue', () => {
    it('should format boolean parameters correctly', () => {
      const paramConfig = { type: 'boolean' };
      expect(formatParameterValue(true, paramConfig)).toBe('Yes');
      expect(formatParameterValue(false, paramConfig)).toBe('No');
    });
    
    it('should format select parameters correctly', () => {
      const paramConfig = { 
        type: 'select',
        options: [
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' }
        ]
      };
      
      expect(formatParameterValue('option1', paramConfig)).toBe('Option 1');
      expect(formatParameterValue('option2', paramConfig)).toBe('Option 2');
      expect(formatParameterValue('unknown', paramConfig)).toBe('unknown');
    });
    
    it('should format percent parameters correctly', () => {
      const paramConfig = { type: 'percent' };
      expect(formatParameterValue(50, paramConfig)).toBe('50%');
      
      const paramConfigWithSuffix = { type: 'percent', suffix: ' pct' };
      expect(formatParameterValue(50, paramConfigWithSuffix)).toBe('50 pct');
    });
    
    it('should format fiat-currency parameters correctly', () => {
      const paramConfig = { type: 'fiat-currency' };
      expect(formatParameterValue(100, paramConfig)).toBe('$100');
      
      const paramConfigWithPrefix = { type: 'fiat-currency', prefix: '€' };
      expect(formatParameterValue(100, paramConfigWithPrefix)).toBe('€100');
    });
    
    it('should handle falsy values correctly', () => {
      const paramConfig = { type: 'number' };
      expect(formatParameterValue(null, paramConfig)).toBe('');
      expect(formatParameterValue(undefined, paramConfig)).toBe('');
    });
  });
  
  describe('validateTokensForStrategy', () => {
    it('should return empty array when vault tokens match strategy tokens', () => {
      const vaultTokens = { 'USDC': 100, 'WETH': 1 };
      const strategyTokens = ['USDC', 'WETH'];
      
      const messages = validateTokensForStrategy(vaultTokens, strategyTokens);
      expect(messages).toEqual([]);
    });
    
    it('should return a message when vault tokens do not match strategy tokens', () => {
      const vaultTokens = { 'USDC': 100, 'WETH': 1, 'DAI': 50 };
      const strategyTokens = ['USDC', 'WETH'];
      
      const messages = validateTokensForStrategy(vaultTokens, strategyTokens);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]).toContain('DAI');
    });
    
    it('should return empty array for empty inputs', () => {
      expect(validateTokensForStrategy({}, [])).toEqual([]);
      expect(validateTokensForStrategy(null, [])).toEqual([]);
      expect(validateTokensForStrategy({}, null)).toEqual([]);
    });
  });
});