/**
 * Strategy Helpers Unit Tests
 *
 * Tests for strategy configuration utilities and validation functions
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import {
  validateIdString,
  lookupAllStrategyIds,
  lookupAvailableStrategies,
  getStrategyDetails,
  getStrategyTemplates,
  getTemplateDefaults,
  getParamDefaultValues,
  getStrategyParameters,
  getStrategyParametersByGroup,
  getStrategyParametersByContractGroup,
  validateStrategyParams,
  getParameterSetterMethod,
  shouldShowParameter,
  getStrategyTokens,
  formatParameterValue,
  validateTokensForStrategy,
  validatePositionsForStrategy,
  mapStrategyParameters
} from '../../../src/helpers/strategyHelpers.js';
import { getAllTokens } from '../../../src/helpers/tokenHelpers.js';
import strategies from '../../../src/configs/strategies.js';

// Helper to encode Bob strategy parameters as hex bytes
const encodeBobParams = (params) => {
  const [targetRangeUpper, targetRangeLower, feeReinvestment, reinvestmentTrigger, reinvestmentRatio, maxSlippage, emergencyExitTrigger] = params;
  return ethers.utils.defaultAbiCoder.encode(
    ['uint16', 'uint16', 'bool', 'uint256', 'uint16', 'uint16', 'uint16'],
    [targetRangeUpper, targetRangeLower, feeReinvestment, reinvestmentTrigger, reinvestmentRatio, maxSlippage, emergencyExitTrigger]
  );
};


describe('Strategy Helpers', () => {
  describe('validateIdString', () => {
    describe('Success Cases', () => {
      it('should accept valid ID strings', () => {
        expect(() => validateIdString('bob')).not.toThrow();
        expect(() => validateIdString('none')).not.toThrow();
        expect(() => validateIdString('unknownStrategy')).not.toThrow();
      });

      it('should accept single character strings', () => {
        expect(() => validateIdString('a')).not.toThrow();
        expect(() => validateIdString('1')).not.toThrow();
      });

      it('should accept strings with special characters', () => {
        expect(() => validateIdString('strategy-v2')).not.toThrow();
        expect(() => validateIdString('strategy_test')).not.toThrow();
        expect(() => validateIdString('strategy.test')).not.toThrow();
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null ID', () => {
        expect(() => validateIdString(null)).toThrow('ID parameter is required');
      });

      it('should throw error for undefined ID', () => {
        expect(() => validateIdString(undefined)).toThrow('ID parameter is required');
      });

      it('should throw error for number ID', () => {
        expect(() => validateIdString(1)).toThrow('ID must be a string');
        expect(() => validateIdString(123)).toThrow('ID must be a string');
        expect(() => validateIdString(0)).toThrow('ID must be a string');
      });

      it('should throw error for boolean ID', () => {
        expect(() => validateIdString(true)).toThrow('ID must be a string');
        expect(() => validateIdString(false)).toThrow('ID must be a string');
      });

      it('should throw error for array ID', () => {
        expect(() => validateIdString(['bob'])).toThrow('ID must be a string');
        expect(() => validateIdString([])).toThrow('ID must be a string');
      });

      it('should throw error for object ID', () => {
        expect(() => validateIdString({ strategy: 'bob' })).toThrow('ID must be a string');
        expect(() => validateIdString({})).toThrow('ID must be a string');
      });

      it('should throw error for empty string ID', () => {
        expect(() => validateIdString('')).toThrow('ID cannot be empty');
      });

      it('should throw error for special values', () => {
        expect(() => validateIdString(NaN)).toThrow('ID must be a string');
        expect(() => validateIdString(Infinity)).toThrow('ID must be a string');
        expect(() => validateIdString(-Infinity)).toThrow('ID must be a string');
      });
    });
  });

  describe('lookupAllStrategyIds', () => {
    it('should return array of all strategy IDs including "none"', () => {
      const result = lookupAllStrategyIds();

      // Should return an array
      expect(Array.isArray(result)).toBe(true);

      // Should return exactly 2 strategies (none, bob)
      expect(result).toHaveLength(2);
      expect(result.sort()).toEqual(['bob', 'none']);

      // Should include all strategy IDs (including "none" unlike lookupAvailableStrategies)
      expect(result).toContain('none');
      expect(result).toContain('bob');

      // All items should be strings
      result.forEach(id => {
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      });
    });
  });

  describe('lookupAvailableStrategies', () => {
    it('should return all strategies except "none" with correct structure', () => {
      const result = lookupAvailableStrategies();

      // Should return exactly 1 strategy (bob)
      expect(result).toHaveLength(1);
      expect(result.map(s => s.id).sort()).toEqual(['bob']);

      // Test specific strategy details
      const bob = result.find(s => s.id === 'bob');
      expect(bob.name).toBe('Baby Steps');
      expect(bob.subtitle).toBe('Baby Step into Liquidity Management');

      // Test structure - all should have required properties
      result.forEach(strategy => {
        expect(strategy).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          subtitle: expect.any(String),
          description: expect.any(String),
          templateEnumMap: expect.any(Object),
          parameters: expect.any(Object),
          parameterGroups: expect.any(Object),
          contractParametersGroups: expect.any(Object)
        });
      });
    });
  });

  describe('getStrategyDetails', () => {
    describe('success cases', () => {
      it('should return complete strategy details for existing strategy', () => {
      const result = getStrategyDetails('bob');

      // Test full structure
      expect(result).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        subtitle: expect.any(String),
        description: expect.any(String),
        icon: expect.any(String),
        color: expect.any(String),
        borderColor: expect.any(String),
        textColor: expect.any(String),
        minTokens: expect.any(Number),
        maxTokens: expect.any(Number),
        minPlatforms: expect.any(Number),
        maxPlatforms: expect.any(Number),
        minPositions: expect.any(Number),
        maxPositions: expect.any(Number),
        supportedTokens: expect.any(Object),
        parameters: expect.any(Object),
        parameterGroups: expect.any(Object),
        contractParametersGroups: expect.any(Object),
        templateEnumMap: expect.any(Object),
        templates: expect.any(Object),
        strategyProperties: expect.any(Object)
      });

      // Cherry pick specific values for bob strategy
      expect(result.id).toBe('bob');
      expect(result.name).toBe('Baby Steps');
      expect(result.subtitle).toBe('Baby Step into Liquidity Management');
      expect(result.color).toBe('gold');
      expect(result.minTokens).toBe(2);
      expect(result.maxTokens).toBe(2);

      // Test strategyProperties specific values for bob strategy
      expect(result.strategyProperties).toMatchObject({
        minTVL: 1000000,
        minPoolAge: 90,
        tvlAveragingPeriod: 14,
        transactionDeadlineSeconds: 60
      });
      });
    })

    describe('Error Cases', () => {
      it('should throw error for non-existent strategy', () => {
        expect(() => getStrategyDetails('nonExistentStrategy')).toThrow('Strategy nonExistentStrategy not found');
      });

      it('should throw error for missing string property', () => {
        // Mock a strategy with missing name property
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, name: undefined };

        expect(() => getStrategyDetails('bob')).toThrow('Strategy bob missing or invalid property: name');

        // Restore original
        strategies.bob = originalBob;
      });

      it('should throw error for invalid number property', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, minTokens: 'invalid' };

        expect(() => getStrategyDetails('bob')).toThrow('Strategy bob missing or invalid property: minTokens');

        strategies.bob = originalBob;
      });

      it('should throw error for missing tokenSupport property', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, tokenSupport: undefined };

        expect(() => getStrategyDetails('bob')).toThrow('Strategy bob missing or invalid tokenSupport property');

        strategies.bob = originalBob;
      });

      it('should throw error for missing object property', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, templates: undefined };

        expect(() => getStrategyDetails('bob')).toThrow('Strategy bob missing or invalid property: templates');

        strategies.bob = originalBob;
      });

      it('should throw error for missing strategyProperties property', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, strategyProperties: undefined };

        expect(() => getStrategyDetails('bob')).toThrow('Strategy bob missing or invalid property: strategyProperties');

        strategies.bob = originalBob;
      });

      it('should throw error for invalid templateEnumMap', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, templateEnumMap: ['invalid'] };

        expect(() => getStrategyDetails('bob')).toThrow('Strategy bob missing or invalid property: templateEnumMap');

        strategies.bob = originalBob;
      });
    });
  });

  describe('getStrategyTemplates', () => {
    describe('Success Cases', () => {
      it('should return templates array even for minimal strategies', () => {
        // Test with 'none' strategy that has minimal template set
        const result = getStrategyTemplates('none');
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Custom');
      });

      it('should return templates for strategy with templates', () => {
        const result = getStrategyTemplates('bob');

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(5);

        // Test template structure
        result.forEach(template => {
          expect(template).toMatchObject({
            name: expect.any(String),
            description: expect.any(String)
          });
        });

        // Test specific template exists
        const conservativeTemplate = result.find(t => t.name === 'Conservative');
        expect(conservativeTemplate).toBeDefined();
        expect(conservativeTemplate.name).toBe('Conservative');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for non-existent strategy', () => {
        expect(() => getStrategyTemplates('nonExistentStrategy')).toThrow('Strategy nonExistentStrategy not found');
      });

      it('should throw error for strategy with missing templates property', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, templates: undefined };

        expect(() => getStrategyTemplates('bob')).toThrow('Strategy bob templates not configured');

        strategies.bob = originalBob;
      });

      it('should throw error for non-object templates', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, templates: 'invalid' };

        expect(() => getStrategyTemplates('bob')).toThrow('Strategy bob templates must be an object');

        strategies.bob = originalBob;
      });

      it('should throw error for template missing name', () => {
        const originalBob = strategies.bob;
        const invalidTemplates = { 'test': { description: 'Test desc' } }; // missing name
        strategies.bob = { ...originalBob, templates: invalidTemplates };

        expect(() => getStrategyTemplates('bob')).toThrow('Strategy bob template \'test\' missing valid name');

        strategies.bob = originalBob;
      });

      it('should throw error for template missing description', () => {
        const originalBob = strategies.bob;
        const invalidTemplates = { 'test': { name: 'Test' } }; // missing description
        strategies.bob = { ...originalBob, templates: invalidTemplates };

        expect(() => getStrategyTemplates('bob')).toThrow('Strategy bob template \'test\' missing valid description');

        strategies.bob = originalBob;
      });

      it('should throw error for template missing defaults object', () => {
        const originalBob = strategies.bob;
        const invalidTemplates = { 'test': { name: 'Test', description: 'Test desc' } }; // missing defaults
        strategies.bob = { ...originalBob, templates: invalidTemplates };

        expect(() => getStrategyTemplates('bob')).toThrow('Strategy bob template \'test\' missing valid defaults object');

        strategies.bob = originalBob;
      });

      it('should throw error for invalid defaults (non-object)', () => {
        const originalBob = strategies.bob;
        const invalidTemplates = { 'test': { name: 'Test', description: 'Test desc', defaults: 'invalid' } };
        strategies.bob = { ...originalBob, templates: invalidTemplates };

        expect(() => getStrategyTemplates('bob')).toThrow('Strategy bob template \'test\' missing valid defaults object');

        strategies.bob = originalBob;
      });

      it('should throw error for invalid defaults (array)', () => {
        const originalBob = strategies.bob;
        const invalidTemplates = { 'test': { name: 'Test', description: 'Test desc', defaults: [] } };
        strategies.bob = { ...originalBob, templates: invalidTemplates };

        expect(() => getStrategyTemplates('bob')).toThrow('Strategy bob template \'test\' missing valid defaults object');

        strategies.bob = originalBob;
      });
    });
  });

  describe('getTemplateDefaults', () => {
    describe('Success Cases', () => {
      it('should return template defaults for bob conservative template', () => {
        const result = getTemplateDefaults('bob', 'conservative');

        // Should return an object
        expect(typeof result).toBe('object');
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBe(false);

        // Should have defaults for all parameters
        expect(Object.keys(result)).toHaveLength(7);

        // Test specific values (matching bob conservative template in strategies.js)
        expect(result.targetRangeUpper).toBe(10.0);
        expect(result.targetRangeLower).toBe(10.0);
        expect(result.maxSlippage).toBe(0.5);
        expect(result.emergencyExitTrigger).toBe(10);
        expect(result.feeReinvestment).toBe(true);
        expect(result.reinvestmentTrigger).toBe(50);
        expect(result.reinvestmentRatio).toBe(30);
      });

      it('should return custom template defaults', () => {
        const result = getTemplateDefaults('bob', 'custom');

        // Should return the defaults defined in the custom template
        expect(typeof result).toBe('object');
        expect(Object.keys(result)).toHaveLength(7);

        // Custom template has its own defined defaults
        expect(result.targetRangeUpper).toBe(5.0);
        expect(result.targetRangeLower).toBe(5.0);
        expect(result.feeReinvestment).toBe(true);
        expect(result.maxSlippage).toBe(0.5);
      });

      it('should work for all templates in all strategies', () => {
        // Test that all strategy/template combinations work
        Object.entries(strategies).forEach(([strategyId, strategy]) => {
          if (strategy.templates) {
            Object.keys(strategy.templates).forEach(templateId => {
              expect(() => {
                const defaults = getTemplateDefaults(strategyId, templateId);
                expect(typeof defaults).toBe('object');
              }).not.toThrow();
            });
          }
        });
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null strategyId', () => {
        expect(() => getTemplateDefaults(null, 'conservative')).toThrow('ID parameter is required');
      });

      it('should throw error for undefined strategyId', () => {
        expect(() => getTemplateDefaults(undefined, 'conservative')).toThrow('ID parameter is required');
      });

      it('should throw error for non-string strategyId', () => {
        expect(() => getTemplateDefaults(123, 'conservative')).toThrow('ID must be a string');
        expect(() => getTemplateDefaults({}, 'conservative')).toThrow('ID must be a string');
        expect(() => getTemplateDefaults([], 'conservative')).toThrow('ID must be a string');
      });

      it('should throw error for empty strategyId', () => {
        expect(() => getTemplateDefaults('', 'conservative')).toThrow('ID cannot be empty');
      });

      it('should throw error for null templateId', () => {
        expect(() => getTemplateDefaults('bob', null)).toThrow('ID parameter is required');
      });

      it('should throw error for undefined templateId', () => {
        expect(() => getTemplateDefaults('bob', undefined)).toThrow('ID parameter is required');
      });

      it('should throw error for non-string templateId', () => {
        expect(() => getTemplateDefaults('bob', 123)).toThrow('ID must be a string');
        expect(() => getTemplateDefaults('bob', {})).toThrow('ID must be a string');
      });

      it('should throw error for empty templateId', () => {
        expect(() => getTemplateDefaults('bob', '')).toThrow('ID cannot be empty');
      });

      it('should throw error for non-existent strategy', () => {
        expect(() => getTemplateDefaults('nonExistentStrategy', 'conservative')).toThrow('Strategy nonExistentStrategy not found');
      });

      it('should throw error for non-existent template', () => {
        expect(() => getTemplateDefaults('bob', 'nonExistentTemplate')).toThrow('Template nonExistentTemplate not found in strategy bob');
      });

      it('should throw error when templates not configured', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, templates: undefined };

        expect(() => getTemplateDefaults('bob', 'conservative')).toThrow('Strategy bob templates not configured');

        strategies.bob = originalBob;
      });

      it('should throw error when templates is not an object', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, templates: 'invalid' };

        expect(() => getTemplateDefaults('bob', 'conservative')).toThrow('Strategy bob templates not configured');

        strategies.bob = originalBob;
      });

      it('should throw error when templates is an array', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, templates: [] };

        expect(() => getTemplateDefaults('bob', 'conservative')).toThrow('Strategy bob templates not configured');

        strategies.bob = originalBob;
      });


      it('should throw error when template defaults not configured', () => {
        const originalBob = strategies.bob;
        const modifiedTemplates = {
          ...originalBob.templates,
          conservative: { ...originalBob.templates.conservative, defaults: undefined }
        };
        strategies.bob = { ...originalBob, templates: modifiedTemplates };

        expect(() => getTemplateDefaults('bob', 'conservative')).toThrow('Template conservative defaults not configured in strategy bob');

        strategies.bob = originalBob;
      });

      it('should throw error when template defaults is not an object', () => {
        const originalBob = strategies.bob;
        const modifiedTemplates = {
          ...originalBob.templates,
          conservative: { ...originalBob.templates.conservative, defaults: 'invalid' }
        };
        strategies.bob = { ...originalBob, templates: modifiedTemplates };

        expect(() => getTemplateDefaults('bob', 'conservative')).toThrow('Template conservative defaults not configured in strategy bob');

        strategies.bob = originalBob;
      });

      it('should throw error when template defaults is an array', () => {
        const originalBob = strategies.bob;
        const modifiedTemplates = {
          ...originalBob.templates,
          conservative: { ...originalBob.templates.conservative, defaults: [] }
        };
        strategies.bob = { ...originalBob, templates: modifiedTemplates };

        expect(() => getTemplateDefaults('bob', 'conservative')).toThrow('Template conservative defaults not configured in strategy bob');

        strategies.bob = originalBob;
      });
    });
  });

  describe('getParamDefaultValues', () => {
    describe('Success Cases', () => {
      it('should return default parameters for existing strategy', () => {
        const result = getParamDefaultValues('bob');

        // Should return an object
        expect(typeof result).toBe('object');
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBe(false);

        // Should have defaults for all parameters in bob strategy (8 params after removing rebalanceThresholds)
        expect(Object.keys(result)).toHaveLength(7);

        // Test specific parameter defaultValues for bob strategy (from parameters section)
        expect(result.targetRangeUpper).toBe(5.0);
        expect(result.targetRangeLower).toBe(5.0);
        expect(result.feeReinvestment).toBe(true);
        expect(result.reinvestmentTrigger).toBe(50);
        expect(result.reinvestmentRatio).toBe(80);
        expect(result.maxSlippage).toBe(0.5);
        expect(result.emergencyExitTrigger).toBe(15);
      });

      it('should extract defaultValue from parameter definitions', () => {
        const result = getParamDefaultValues('bob');

        // Verify that we're getting the defaultValue from each parameter configuration
        const strategy = strategies.bob;
        Object.entries(strategy.parameters).forEach(([paramId, paramConfig]) => {
          if (paramConfig.defaultValue !== undefined) {
            expect(result[paramId]).toBe(paramConfig.defaultValue);
          }
        });
      });

      it('should work for all available strategies', () => {
        // Test that all strategies have working custom defaults
        Object.keys(strategies).forEach(strategyId => {
          expect(() => {
            const defaults = getParamDefaultValues(strategyId);
            expect(typeof defaults).toBe('object');
            expect(defaults).not.toBeNull();
          }).not.toThrow();
        });
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null strategyId', () => {
        expect(() => getParamDefaultValues(null)).toThrow('ID parameter is required');
      });

      it('should throw error for undefined strategyId', () => {
        expect(() => getParamDefaultValues(undefined)).toThrow('ID parameter is required');
      });

      it('should throw error for non-string strategyId', () => {
        expect(() => getParamDefaultValues(123)).toThrow('ID must be a string');
        expect(() => getParamDefaultValues({})).toThrow('ID must be a string');
        expect(() => getParamDefaultValues([])).toThrow('ID must be a string');
        expect(() => getParamDefaultValues(true)).toThrow('ID must be a string');
        expect(() => getParamDefaultValues(false)).toThrow('ID must be a string');
      });

      it('should throw error for empty strategyId', () => {
        expect(() => getParamDefaultValues('')).toThrow('ID cannot be empty');
      });

      it('should throw error for non-existent strategy', () => {
        expect(() => getParamDefaultValues('nonExistentStrategy')).toThrow('Strategy nonExistentStrategy not found');
      });

      it('should throw error for special values', () => {
        expect(() => getParamDefaultValues(NaN)).toThrow('ID must be a string');
        expect(() => getParamDefaultValues(Infinity)).toThrow('ID must be a string');
        expect(() => getParamDefaultValues(-Infinity)).toThrow('ID must be a string');
      });

      it('should throw error for strategy with missing parameters', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, parameters: undefined };

        expect(() => getParamDefaultValues('bob')).toThrow('Strategy bob parameters not configured');

        strategies.bob = originalBob;
      });

      it('should throw error for strategy with invalid parameters', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, parameters: ['invalid'] };

        expect(() => getParamDefaultValues('bob')).toThrow('Strategy bob parameters not configured');

        strategies.bob = originalBob;
      });

      it('should throw error when parameters is not an object', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, parameters: 'invalid' };

        expect(() => getParamDefaultValues('bob')).toThrow('Strategy bob parameters not configured');

        strategies.bob = originalBob;
      });
    });
  });

  describe('getStrategyParameters', () => {
    describe('Success Cases', () => {
      it('should return parameters object for existing strategy', () => {
        const result = getStrategyParameters('bob');

        expect(typeof result).toBe('object');
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBe(false);

        // Test that it has parameter entries
        const parameterKeys = Object.keys(result);
        expect(parameterKeys.length).toBeGreaterThan(0);

        // Test parameter structure
        Object.entries(result).forEach(([, paramConfig]) => {
          expect(paramConfig).toMatchObject({
            name: expect.any(String),
            description: expect.any(String),
            type: expect.any(String),
            defaultValue: expect.anything(),
            group: expect.any(Number)
          });
        });

        // Test specific parameter exists
        expect(result).toHaveProperty('targetRangeUpper');
        expect(result.targetRangeUpper.name).toBe('Upper Range');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for non-existent strategy', () => {
        expect(() => getStrategyParameters('nonExistentStrategy')).toThrow('Strategy nonExistentStrategy not found');
      });

      it('should throw error for strategy with missing parameters', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, parameters: undefined };

        expect(() => getStrategyParameters('bob')).toThrow('Strategy bob parameters not configured');

        strategies.bob = originalBob;
      });

      it('should throw error for strategy with invalid parameters', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, parameters: ['invalid'] };

        expect(() => getStrategyParameters('bob')).toThrow('Strategy bob parameters not configured');

        strategies.bob = originalBob;
      });
    });
  });

  describe('getStrategyParametersByGroup', () => {
    describe('Success Cases', () => {
      it('should return parameters for valid strategy and group', () => {
        const result = getStrategyParametersByGroup('bob', 0);

        // Should return an object
        expect(typeof result).toBe('object');
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBe(false);

        // Group 0 in bob strategy contains range parameters
        const parameterKeys = Object.keys(result);
        expect(parameterKeys).toHaveLength(2);
        expect(parameterKeys).toContain('targetRangeUpper');
        expect(parameterKeys).toContain('targetRangeLower');

        // Test parameter structure
        expect(result.targetRangeUpper).toMatchObject({
          name: expect.any(String),
          description: expect.any(String),
          type: expect.any(String),
          defaultValue: expect.anything(),
          group: 0
        });
      });

      it('should return fee parameters for group 1', () => {
        const result = getStrategyParametersByGroup('bob', 1);

        const parameterKeys = Object.keys(result);
        expect(parameterKeys).toHaveLength(3);
        expect(parameterKeys).toContain('feeReinvestment');
        expect(parameterKeys).toContain('reinvestmentTrigger');
        expect(parameterKeys).toContain('reinvestmentRatio');

        // All should belong to group 1
        Object.values(result).forEach(param => {
          expect(param.group).toBe(1);
        });
      });

      it('should return risk management parameters for group 2', () => {
        const result = getStrategyParametersByGroup('bob', 2);

        const parameterKeys = Object.keys(result);
        expect(parameterKeys).toHaveLength(2);
        expect(parameterKeys).toContain('maxSlippage');
        expect(parameterKeys).toContain('emergencyExitTrigger');

        // All should belong to group 2
        Object.values(result).forEach(param => {
          expect(param.group).toBe(2);
        });
      });

      it('should return empty object for non-existent group', () => {
        const result = getStrategyParametersByGroup('bob', 999);

        expect(typeof result).toBe('object');
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBe(false);
        expect(Object.keys(result)).toHaveLength(0);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null strategyId', () => {
        expect(() => getStrategyParametersByGroup(null, 0)).toThrow('ID parameter is required');
      });

      it('should throw error for undefined strategyId', () => {
        expect(() => getStrategyParametersByGroup(undefined, 0)).toThrow('ID parameter is required');
      });

      it('should throw error for non-string strategyId', () => {
        expect(() => getStrategyParametersByGroup(123, 0)).toThrow('ID must be a string');
        expect(() => getStrategyParametersByGroup({}, 0)).toThrow('ID must be a string');
        expect(() => getStrategyParametersByGroup([], 0)).toThrow('ID must be a string');
      });

      it('should throw error for empty strategyId', () => {
        expect(() => getStrategyParametersByGroup('', 0)).toThrow('ID cannot be empty');
      });

      it('should throw error for non-existent strategy', () => {
        expect(() => getStrategyParametersByGroup('nonExistentStrategy', 0)).toThrow('Strategy nonExistentStrategy not found');
      });

      it('should throw error for strategy with missing parameters', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, parameters: undefined };

        expect(() => getStrategyParametersByGroup('bob', 0)).toThrow('Strategy bob parameters not configured');

        strategies.bob = originalBob;
      });

      it('should throw error for strategy with invalid parameters', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, parameters: ['invalid'] };

        expect(() => getStrategyParametersByGroup('bob', 0)).toThrow('Strategy bob parameters not configured');

        strategies.bob = originalBob;
      });

      it('should throw error for invalid groupId types', () => {
        // Function should now validate groupId parameter
        expect(() => getStrategyParametersByGroup('bob', null)).toThrow('Group ID parameter is required');
        expect(() => getStrategyParametersByGroup('bob', undefined)).toThrow('Group ID parameter is required');
        expect(() => getStrategyParametersByGroup('bob', 'invalid')).toThrow('Group ID must be a finite number');
        expect(() => getStrategyParametersByGroup('bob', {})).toThrow('Group ID must be a finite number');
        expect(() => getStrategyParametersByGroup('bob', [])).toThrow('Group ID must be a finite number');
        expect(() => getStrategyParametersByGroup('bob', true)).toThrow('Group ID must be a finite number');
        expect(() => getStrategyParametersByGroup('bob', NaN)).toThrow('Group ID must be a finite number');
        expect(() => getStrategyParametersByGroup('bob', Infinity)).toThrow('Group ID must be a finite number');
        expect(() => getStrategyParametersByGroup('bob', -Infinity)).toThrow('Group ID must be a finite number');
        expect(() => getStrategyParametersByGroup('bob', -1)).toThrow('Group ID must be non-negative');
        expect(() => getStrategyParametersByGroup('bob', -0.5)).toThrow('Group ID must be non-negative');
      });
    });
  });

  describe('getStrategyParametersByContractGroup', () => {
    describe('Success Cases', () => {
      it('should return parameters for valid strategy and contract group', () => {
        const result = getStrategyParametersByContractGroup('bob', 'range');

        // Should return an object
        expect(typeof result).toBe('object');
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBe(false);

        // Range contract group in bob strategy contains range parameters (2 after removing rebalanceThresholds)
        const parameterKeys = Object.keys(result);
        expect(parameterKeys).toHaveLength(2);
        expect(parameterKeys).toContain('targetRangeUpper');
        expect(parameterKeys).toContain('targetRangeLower');

        // Test parameter structure and contractGroup
        expect(result.targetRangeUpper).toMatchObject({
          name: expect.any(String),
          description: expect.any(String),
          type: expect.any(String),
          defaultValue: expect.anything(),
          contractGroup: 'range'
        });
      });

      it('should return fee parameters for fee contract group', () => {
        const result = getStrategyParametersByContractGroup('bob', 'fee');

        const parameterKeys = Object.keys(result);
        expect(parameterKeys).toHaveLength(3);
        expect(parameterKeys).toContain('feeReinvestment');
        expect(parameterKeys).toContain('reinvestmentTrigger');
        expect(parameterKeys).toContain('reinvestmentRatio');

        // All should belong to fee contract group
        Object.values(result).forEach(param => {
          expect(param.contractGroup).toBe('fee');
        });
      });

      it('should return risk parameters for risk contract group', () => {
        const result = getStrategyParametersByContractGroup('bob', 'risk');

        const parameterKeys = Object.keys(result);
        expect(parameterKeys).toHaveLength(2);
        expect(parameterKeys).toContain('maxSlippage');
        expect(parameterKeys).toContain('emergencyExitTrigger');

        // All should belong to risk contract group
        Object.values(result).forEach(param => {
          expect(param.contractGroup).toBe('risk');
        });
      });

      it('should return empty object for non-existent contract group', () => {
        const result = getStrategyParametersByContractGroup('bob', 'nonExistentGroup');

        expect(typeof result).toBe('object');
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBe(false);
        expect(Object.keys(result)).toHaveLength(0);
      });

      it('should handle case-sensitive contract group matching', () => {
        const result = getStrategyParametersByContractGroup('bob', 'Range'); // Different case
        expect(Object.keys(result)).toHaveLength(0); // No match due to case sensitivity
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null strategyId', () => {
        expect(() => getStrategyParametersByContractGroup(null, 'range')).toThrow('ID parameter is required');
      });

      it('should throw error for undefined strategyId', () => {
        expect(() => getStrategyParametersByContractGroup(undefined, 'range')).toThrow('ID parameter is required');
      });

      it('should throw error for non-string strategyId', () => {
        expect(() => getStrategyParametersByContractGroup(123, 'range')).toThrow('ID must be a string');
        expect(() => getStrategyParametersByContractGroup({}, 'range')).toThrow('ID must be a string');
        expect(() => getStrategyParametersByContractGroup([], 'range')).toThrow('ID must be a string');
      });

      it('should throw error for empty strategyId', () => {
        expect(() => getStrategyParametersByContractGroup('', 'range')).toThrow('ID cannot be empty');
      });

      it('should throw error for invalid contractGroup types', () => {
        // Function should now validate contractGroup parameter
        expect(() => getStrategyParametersByContractGroup('bob', null)).toThrow('Contract group parameter is required');
        expect(() => getStrategyParametersByContractGroup('bob', undefined)).toThrow('Contract group parameter is required');
        expect(() => getStrategyParametersByContractGroup('bob', 123)).toThrow('Contract group must be a string');
        expect(() => getStrategyParametersByContractGroup('bob', {})).toThrow('Contract group must be a string');
        expect(() => getStrategyParametersByContractGroup('bob', [])).toThrow('Contract group must be a string');
        expect(() => getStrategyParametersByContractGroup('bob', true)).toThrow('Contract group must be a string');
        expect(() => getStrategyParametersByContractGroup('bob', '')).toThrow('Contract group cannot be empty');
      });

      it('should throw error for non-existent strategy', () => {
        expect(() => getStrategyParametersByContractGroup('nonExistentStrategy', 'range')).toThrow('Strategy nonExistentStrategy not found');
      });

      it('should throw error for strategy with missing parameters', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, parameters: undefined };

        expect(() => getStrategyParametersByContractGroup('bob', 'range')).toThrow('Strategy bob parameters not configured');

        strategies.bob = originalBob;
      });

      it('should throw error for strategy with invalid parameters', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, parameters: ['invalid'] };

        expect(() => getStrategyParametersByContractGroup('bob', 'range')).toThrow('Strategy bob parameters not configured');

        strategies.bob = originalBob;
      });

      it('should throw error when parameters is not an object', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, parameters: 'invalid' };

        expect(() => getStrategyParametersByContractGroup('bob', 'range')).toThrow('Strategy bob parameters not configured');

        strategies.bob = originalBob;
      });
    });
  });

  describe('validateStrategyParams', () => {
    describe('Success Cases', () => {
      it('should return valid result for correct parameters', () => {
        const params = {
          targetRangeUpper: 5.0,
          targetRangeLower: 5.0,
          feeReinvestment: true,
          reinvestmentTrigger: 5000,
          reinvestmentRatio: 80,
          maxSlippage: 0.5,
          emergencyExitTrigger: 15
        };

        const result = validateStrategyParams('bob', params);

        expect(result).toMatchObject({
          isValid: true,
          errors: {}
        });
        expect(Object.keys(result.errors)).toHaveLength(0);
      });

      it('should handle conditional parameters correctly when condition is met', () => {
        const params = {
          targetRangeUpper: 5.0,
          targetRangeLower: 5.0,
          feeReinvestment: true, // Condition parameter
          reinvestmentTrigger: 1000, // Conditional parameter - should be validated
          reinvestmentRatio: 90, // Conditional parameter - should be validated
          maxSlippage: 0.5,
          emergencyExitTrigger: 15
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(true);
        expect(Object.keys(result.errors)).toHaveLength(0);
      });

      it('should skip conditional parameters when condition is not met', () => {
        const params = {
          targetRangeUpper: 5.0,
          targetRangeLower: 5.0,
          feeReinvestment: false, // Condition not met
          // reinvestmentTrigger and reinvestmentRatio not provided - should be skipped
          maxSlippage: 0.5,
          emergencyExitTrigger: 15
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(true);
        expect(Object.keys(result.errors)).toHaveLength(0);
      });

      it('should handle empty params object', () => {
        const result = validateStrategyParams('bob', {});

        // Should fail validation because all parameters are required
        expect(result.isValid).toBe(false);
        expect(Object.keys(result.errors).length).toBeGreaterThan(0);
      });
    });

    describe('Validation Error Cases', () => {
      it('should return errors for missing required parameters', () => {
        const params = {
          targetRangeUpper: 5.0,
          // Missing other required parameters
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(false);
        expect(result.errors).toMatchObject({
          targetRangeLower: expect.stringContaining('is required'),
          feeReinvestment: expect.stringContaining('is required'),
          maxSlippage: expect.stringContaining('is required'),
          emergencyExitTrigger: expect.stringContaining('is required')
        });
      });

      it('should return errors for invalid numeric values', () => {
        const params = {
          targetRangeUpper: 'invalid', // Should be number
          targetRangeLower: 5.0,
          feeReinvestment: true,
          reinvestmentTrigger: 5000,
          reinvestmentRatio: 80,
          maxSlippage: 0.5,
          emergencyExitTrigger: 15
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(false);
        expect(result.errors.targetRangeUpper).toContain('must be a number');
      });

      it('should return errors for out-of-range numeric values', () => {
        const params = {
          targetRangeUpper: 25.0, // Max is 20.0
          targetRangeLower: 0.05, // Min is 0.1
          feeReinvestment: true,
          reinvestmentTrigger: 5000,
          reinvestmentRatio: 80,
          maxSlippage: 0.5,
          emergencyExitTrigger: 15
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(false);
        expect(result.errors.targetRangeUpper).toContain('must be at most 20%');
        expect(result.errors.targetRangeLower).toContain('must be at least 0.1%');
      });

      it('should validate conditional parameters when condition is met but values are invalid', () => {
        const params = {
          targetRangeUpper: 5.0,
          targetRangeLower: 5.0,
          feeReinvestment: true, // Condition met
          reinvestmentTrigger: 20000, // Out of range (max 10000)
          reinvestmentRatio: 150, // Out of range (max 100)
          maxSlippage: 0.5,
          emergencyExitTrigger: 15
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(false);
        expect(result.errors.reinvestmentTrigger).toContain('must be at most 10000');
        expect(result.errors.reinvestmentRatio).toContain('must be at most 100%');
      });

      it('should handle null, undefined, and empty string values as required errors', () => {
        const params = {
          targetRangeUpper: null,
          targetRangeLower: undefined,
          feeReinvestment: true,
          reinvestmentTrigger: 5000,
          reinvestmentRatio: 80,
          maxSlippage: "",
          emergencyExitTrigger: 15
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(false);
        expect(result.errors.targetRangeUpper).toContain('is required');
        expect(result.errors.targetRangeLower).toContain('is required');
        expect(result.errors.maxSlippage).toContain('is required');
      });
    });

    describe('Strategy Error Cases', () => {
      it('should throw error for null strategyId', () => {
        expect(() => validateStrategyParams(null, {})).toThrow('ID parameter is required');
      });

      it('should throw error for undefined strategyId', () => {
        expect(() => validateStrategyParams(undefined, {})).toThrow('ID parameter is required');
      });

      it('should throw error for non-string strategyId', () => {
        expect(() => validateStrategyParams(123, {})).toThrow('ID must be a string');
        expect(() => validateStrategyParams({}, {})).toThrow('ID must be a string');
      });

      it('should throw error for empty strategyId', () => {
        expect(() => validateStrategyParams('', {})).toThrow('ID cannot be empty');
      });

      it('should throw error for non-existent strategy', () => {
        expect(() => validateStrategyParams('nonExistentStrategy', {})).toThrow('Strategy nonExistentStrategy not found');
      });

      it('should throw error for invalid params types', () => {
        // Should validate params parameter type
        expect(() => validateStrategyParams('bob', null)).toThrow('Parameters object is required');
        expect(() => validateStrategyParams('bob', undefined)).toThrow('Parameters object is required');
        expect(() => validateStrategyParams('bob', [])).toThrow('Parameters must be an object');
        expect(() => validateStrategyParams('bob', 'invalid')).toThrow('Parameters must be an object');
        expect(() => validateStrategyParams('bob', 123)).toThrow('Parameters must be an object');
        expect(() => validateStrategyParams('bob', true)).toThrow('Parameters must be an object');
        expect(() => validateStrategyParams('bob', Symbol('test'))).toThrow('Parameters must be an object');
      });

      it('should throw error for strategy with missing parameters', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, parameters: undefined };

        expect(() => validateStrategyParams('bob', {})).toThrow('Strategy bob parameters not configured');

        strategies.bob = originalBob;
      });

      it('should throw error for strategy with invalid parameters', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, parameters: ['invalid'] };

        expect(() => validateStrategyParams('bob', {})).toThrow('Strategy bob parameters not configured');

        strategies.bob = originalBob;
      });

      it('should throw error when parameters is not an object', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, parameters: 'invalid' };

        expect(() => validateStrategyParams('bob', {})).toThrow('Strategy bob parameters not configured');

        strategies.bob = originalBob;
      });

      it('should return errors for unknown parameters', () => {
        const params = {
          targetRangeUpper: 5.0,
          unknownParam1: 'test',
          unknownParam2: 123,
          targetRangeLower: 5.0
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(false);
        expect(result.errors.unknownParam1).toBe('Unknown parameter: unknownParam1');
        expect(result.errors.unknownParam2).toBe('Unknown parameter: unknownParam2');
        // Known parameters should not have unknown parameter errors
        expect(result.errors.targetRangeUpper).toBeUndefined();
        expect(result.errors.targetRangeLower).toBeUndefined();
      });

      it('should combine unknown parameter errors with other validation errors', () => {
        const params = {
          targetRangeUpper: 1000, // Out of range (max is likely much lower)
          unknownParam: 'test',
          targetRangeLower: 'invalid' // Should be number
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(false);
        expect(result.errors.unknownParam).toBe('Unknown parameter: unknownParam');
        expect(result.errors.targetRangeUpper).toContain('must be at most');
        expect(result.errors.targetRangeLower).toContain('must be a number');
      });

      it('returns error when decimal/percent/fiat-currency value has more than 2 decimal places', () => {
        // bob's targetRangeUpper is a percent (type: 'percent', min 0.1, max 20) — 5.123
        // is in range but has 3 decimal places, tripping the precision guard.
        const params = {
          targetRangeUpper: 5.123,
          targetRangeLower: 2,
          feeReinvestment: false,
          reinvestmentRatio: 50,
          maxSlippage: 1,
          emergencyExitTrigger: 10,
        };
        const result = validateStrategyParams('bob', params);
        expect(result.isValid).toBe(false);
        expect(result.errors.targetRangeUpper).toContain('cannot have more than 2 decimal places');
      });
    });
  });

  describe('getParameterSetterMethod', () => {
    describe('Success Cases', () => {
      it('should return correct setter method for valid strategy and contract group', () => {
        const result = getParameterSetterMethod('bob', 'range');
        expect(result).toBe('setRangeParameters');
      });

      it('should return setter methods for all bob contract groups', () => {
        expect(getParameterSetterMethod('bob', 'range')).toBe('setRangeParameters');
        expect(getParameterSetterMethod('bob', 'fee')).toBe('setFeeParameters');
        expect(getParameterSetterMethod('bob', 'risk')).toBe('setRiskParameters');
      });

      it('should throw error for non-existent contract group', () => {
        expect(() => getParameterSetterMethod('bob', 'nonExistentGroup')).toThrow('Contract group nonExistentGroup not found in strategy bob');
      });

      it('should throw error for case-sensitive contract group matching', () => {
        expect(() => getParameterSetterMethod('bob', 'Range')).toThrow('Contract group Range not found in strategy bob'); // Different case
      });

      it('should return correct setter method for none strategy', () => {
        const result = getParameterSetterMethod('none', 'manual');
        expect(result).toBe('setTokenDeposits');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null strategyId', () => {
        expect(() => getParameterSetterMethod(null, 'range')).toThrow('ID parameter is required');
      });

      it('should throw error for undefined strategyId', () => {
        expect(() => getParameterSetterMethod(undefined, 'range')).toThrow('ID parameter is required');
      });

      it('should throw error for non-string strategyId', () => {
        expect(() => getParameterSetterMethod(123, 'range')).toThrow('ID must be a string');
        expect(() => getParameterSetterMethod({}, 'range')).toThrow('ID must be a string');
        expect(() => getParameterSetterMethod([], 'range')).toThrow('ID must be a string');
      });

      it('should throw error for empty strategyId', () => {
        expect(() => getParameterSetterMethod('', 'range')).toThrow('ID cannot be empty');
      });

      it('should throw error for non-existent strategy', () => {
        expect(() => getParameterSetterMethod('nonExistentStrategy', 'range')).toThrow('Strategy nonExistentStrategy not found');
      });

      it('should throw error for invalid contractGroupId types', () => {
        expect(() => getParameterSetterMethod('bob', null)).toThrow('Contract group ID parameter is required');
        expect(() => getParameterSetterMethod('bob', undefined)).toThrow('Contract group ID parameter is required');
        expect(() => getParameterSetterMethod('bob', 123)).toThrow('Contract group ID must be a string');
        expect(() => getParameterSetterMethod('bob', {})).toThrow('Contract group ID must be a string');
        expect(() => getParameterSetterMethod('bob', [])).toThrow('Contract group ID must be a string');
        expect(() => getParameterSetterMethod('bob', true)).toThrow('Contract group ID must be a string');
        expect(() => getParameterSetterMethod('bob', '')).toThrow('Contract group ID cannot be empty');
      });

      it('should throw error when strategy exists but contractParametersGroups is missing', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, contractParametersGroups: undefined };

        expect(() => getParameterSetterMethod('bob', 'range')).toThrow('Strategy bob contractParametersGroups not configured');

        strategies.bob = originalBob;
      });

      it('should throw error when strategy exists but contractParametersGroups is not an object', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, contractParametersGroups: 'invalid' };

        expect(() => getParameterSetterMethod('bob', 'range')).toThrow('Strategy bob contractParametersGroups not configured');

        strategies.bob = originalBob;
      });

      it('should throw error when contractParametersGroups is an array', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, contractParametersGroups: ['invalid'] };

        expect(() => getParameterSetterMethod('bob', 'range')).toThrow('Strategy bob contractParametersGroups not configured');

        strategies.bob = originalBob;
      });

      it('should throw error when contract group exists but has no setterMethod', () => {
        const originalBob = strategies.bob;
        strategies.bob = {
          ...originalBob,
          contractParametersGroups: {
            ...originalBob.contractParametersGroups,
            'range': {} // Missing setterMethod
          }
        };

        expect(() => getParameterSetterMethod('bob', 'range')).toThrow('Contract group range setterMethod not configured in strategy bob');

        strategies.bob = originalBob;
      });

      it('should throw error when contract group has null setterMethod', () => {
        const originalBob = strategies.bob;
        strategies.bob = {
          ...originalBob,
          contractParametersGroups: {
            ...originalBob.contractParametersGroups,
            'range': { setterMethod: null }
          }
        };

        expect(() => getParameterSetterMethod('bob', 'range')).toThrow('Contract group range setterMethod not configured in strategy bob');

        strategies.bob = originalBob;
      });

      it('should throw error when contract group has invalid setterMethod types', () => {
        const originalBob = strategies.bob;

        // Test empty string
        strategies.bob = {
          ...originalBob,
          contractParametersGroups: {
            ...originalBob.contractParametersGroups,
            'range': { setterMethod: '' }
          }
        };
        expect(() => getParameterSetterMethod('bob', 'range')).toThrow('Contract group range setterMethod not configured in strategy bob');

        // Test whitespace-only string
        strategies.bob = {
          ...originalBob,
          contractParametersGroups: {
            ...originalBob.contractParametersGroups,
            'range': { setterMethod: '   ' }
          }
        };
        expect(() => getParameterSetterMethod('bob', 'range')).toThrow('Contract group range setterMethod not configured in strategy bob');

        // Test non-string types
        strategies.bob = {
          ...originalBob,
          contractParametersGroups: {
            ...originalBob.contractParametersGroups,
            'range': { setterMethod: 123 }
          }
        };
        expect(() => getParameterSetterMethod('bob', 'range')).toThrow('Contract group range setterMethod not configured in strategy bob');

        strategies.bob = originalBob;
      });
    });
  });

  describe('shouldShowParameter', () => {
    describe('Success Cases', () => {
      it('should return true for parameters without conditional dependency', () => {
        const conditionalParam = {
          name: 'Target Range Upper',
          type: 'percent',
          // No conditionalOn property
        };
        const testValueSet = {};

        const result = shouldShowParameter(conditionalParam, testValueSet);
        expect(result).toBe(true);
      });

      it('should return true when boolean conditional dependency is met', () => {
        const conditionalParam = {
          name: 'Reinvestment Trigger',
          type: 'fiat-currency',
          conditionalOn: 'feeReinvestment',
          conditionalValue: true
        };
        const testValueSet = {
          feeReinvestment: true
        };

        const result = shouldShowParameter(conditionalParam, testValueSet);
        expect(result).toBe(true);
      });

      it('should return false when boolean conditional dependency is not met', () => {
        const conditionalParam = {
          name: 'Reinvestment Trigger',
          type: 'fiat-currency',
          conditionalOn: 'feeReinvestment',
          conditionalValue: true
        };
        const testValueSet = {
          feeReinvestment: false
        };

        const result = shouldShowParameter(conditionalParam, testValueSet);
        expect(result).toBe(false);
      });

      it('should work with string conditional values', () => {
        const conditionalParam = {
          name: 'Some Parameter',
          type: 'number',
          conditionalOn: 'mode',
          conditionalValue: 'advanced'
        };

        // Should return true when condition met
        const resultTrue = shouldShowParameter(conditionalParam, { mode: 'advanced' });
        expect(resultTrue).toBe(true);

        // Should return false when condition not met
        const resultFalse = shouldShowParameter(conditionalParam, { mode: 'basic' });
        expect(resultFalse).toBe(false);
      });

      it('should work with number conditional values', () => {
        const conditionalParam = {
          name: 'Some Parameter',
          type: 'percent',
          conditionalOn: 'level',
          conditionalValue: 2
        };

        // Should return true when condition met
        const resultTrue = shouldShowParameter(conditionalParam, { level: 2 });
        expect(resultTrue).toBe(true);

        // Should return false when condition not met
        const resultFalse = shouldShowParameter(conditionalParam, { level: 1 });
        expect(resultFalse).toBe(false);
      });

      it('should return false when condition parameter is missing', () => {
        const conditionalParam = {
          name: 'Reinvestment Trigger',
          type: 'fiat-currency',
          conditionalOn: 'feeReinvestment',
          conditionalValue: true
        };
        const testValueSet = {
          // feeReinvestment missing
        };

        const result = shouldShowParameter(conditionalParam, testValueSet);
        expect(result).toBe(false);
      });

      it('should return false when condition parameter is undefined', () => {
        const conditionalParam = {
          name: 'Reinvestment Trigger',
          type: 'fiat-currency',
          conditionalOn: 'feeReinvestment',
          conditionalValue: true
        };
        const testValueSet = {
          feeReinvestment: undefined
        };

        const result = shouldShowParameter(conditionalParam, testValueSet);
        expect(result).toBe(false);
      });

      it('should return false when condition parameter is null', () => {
        const conditionalParam = {
          name: 'Reinvestment Trigger',
          type: 'fiat-currency',
          conditionalOn: 'feeReinvestment',
          conditionalValue: true
        };
        const testValueSet = {
          feeReinvestment: null
        };

        const result = shouldShowParameter(conditionalParam, testValueSet);
        expect(result).toBe(false);
      });

      it('should use strict equality for condition checking', () => {
        const conditionalParam = {
          name: 'Some Parameter',
          type: 'number',
          conditionalOn: 'value',
          conditionalValue: 0
        };

        // Should return true for exact match
        expect(shouldShowParameter(conditionalParam, { value: 0 })).toBe(true);

        // Should return false for falsy but not equal values
        expect(shouldShowParameter(conditionalParam, { value: false })).toBe(false);
        expect(shouldShowParameter(conditionalParam, { value: null })).toBe(false);
        expect(shouldShowParameter(conditionalParam, { value: undefined })).toBe(false);
        expect(shouldShowParameter(conditionalParam, { value: '' })).toBe(false);
      });

      it('should handle real strategy conditional parameters', () => {
        // Test actual bob strategy conditional parameters
        const reinvestmentTriggerConfig = {
          name: 'Reinvestment Trigger',
          type: 'fiat-currency',
          conditionalOn: 'feeReinvestment',
          conditionalValue: true
        };

        const reinvestmentRatioConfig = {
          name: 'Reinvestment Ratio',
          type: 'percent',
          conditionalOn: 'feeReinvestment',
          conditionalValue: true
        };

        // Should show when feeReinvestment is true
        expect(shouldShowParameter(reinvestmentTriggerConfig, { feeReinvestment: true })).toBe(true);
        expect(shouldShowParameter(reinvestmentRatioConfig, { feeReinvestment: true })).toBe(true);

        // Should not show when feeReinvestment is false
        expect(shouldShowParameter(reinvestmentTriggerConfig, { feeReinvestment: false })).toBe(false);
        expect(shouldShowParameter(reinvestmentRatioConfig, { feeReinvestment: false })).toBe(false);
      });
    });

    describe('Edge Cases and Error Handling', () => {
      it('should handle null conditionalParam gracefully', () => {
        expect(shouldShowParameter(null, {})).toBe(false);
      });

      it('should handle undefined conditionalParam gracefully', () => {
        expect(shouldShowParameter(undefined, {})).toBe(false);
      });

      it('should handle null testValueSet gracefully', () => {
        const conditionalParam = {
          name: 'Some Parameter',
          conditionalOn: 'someCondition',
          conditionalValue: true
        };

        expect(shouldShowParameter(conditionalParam, null)).toBe(false);
      });

      it('should handle undefined testValueSet gracefully', () => {
        const conditionalParam = {
          name: 'Some Parameter',
          conditionalOn: 'someCondition',
          conditionalValue: true
        };

        expect(shouldShowParameter(conditionalParam, undefined)).toBe(false);
      });

      it('should handle non-object conditionalParam gracefully', () => {
        expect(shouldShowParameter('invalid', {})).toBe(false);
        expect(shouldShowParameter(123, {})).toBe(false);
        expect(shouldShowParameter([], {})).toBe(false);
        expect(shouldShowParameter(true, {})).toBe(false);
      });

      it('should handle non-object testValueSet gracefully', () => {
        const conditionalParam = {
          name: 'Some Parameter',
          conditionalOn: 'someCondition',
          conditionalValue: true
        };

        expect(shouldShowParameter(conditionalParam, 'invalid')).toBe(false);
        expect(shouldShowParameter(conditionalParam, 123)).toBe(false);
        expect(shouldShowParameter(conditionalParam, [])).toBe(false);
        expect(shouldShowParameter(conditionalParam, true)).toBe(false);
      });

      it('should return true when conditionalOn is null or undefined', () => {
        const conditionalParamNull = {
          name: 'Some Parameter',
          conditionalOn: null,
          conditionalValue: true
        };

        const conditionalParamUndefined = {
          name: 'Some Parameter',
          conditionalOn: undefined,
          conditionalValue: true
        };

        expect(shouldShowParameter(conditionalParamNull, {})).toBe(true);
        expect(shouldShowParameter(conditionalParamUndefined, {})).toBe(true);
      });

      it('should return true when conditionalOn is empty string', () => {
        const conditionalParam = {
          name: 'Some Parameter',
          conditionalOn: '',
          conditionalValue: true
        };

        expect(shouldShowParameter(conditionalParam, {})).toBe(true);
      });

      it('should handle missing conditionalValue property', () => {
        const conditionalParam = {
          name: 'Some Parameter',
          conditionalOn: 'someCondition'
          // Missing conditionalValue
        };

        // Should compare against undefined
        expect(shouldShowParameter(conditionalParam, { someCondition: undefined })).toBe(true);
        expect(shouldShowParameter(conditionalParam, { someCondition: 'anything' })).toBe(false);
      });
    });
  });

  describe('getStrategyTokens', () => {
    describe('Success Cases', () => {
      it('should return all tokens for strategy with tokenSupport "all"', () => {
        const tokens = getStrategyTokens('bob');

        expect(tokens).toBeDefined();
        expect(typeof tokens).toBe('object');
        expect(Array.isArray(tokens)).toBe(false);
        expect(Object.keys(tokens).length).toBeGreaterThan(0);

        // Should include common tokens
        expect(tokens).toHaveProperty('ETH');
        expect(tokens).toHaveProperty('USDC');
      });

      it('should filter out WETH (strategies use ETH, automation handles wrapping)', () => {
        const tokens = getStrategyTokens('bob');

        // Should have ETH but NOT WETH
        expect(tokens).toHaveProperty('ETH');
        expect(tokens).not.toHaveProperty('WETH');

        // Verify WETH is in getAllTokens (it's filtered specifically for strategies)
        const allTokens = getAllTokens();
        expect(allTokens).toHaveProperty('WETH');
      });

      it('should work for all available strategies', () => {
        const strategies = ['none', 'bob'];

        strategies.forEach(strategyId => {
          const tokens = getStrategyTokens(strategyId);
          expect(tokens).toBeDefined();
          expect(typeof tokens).toBe('object');
          expect(Array.isArray(tokens)).toBe(false);
        });
      });
    });

    describe('Error Cases', () => {
      it('should throw error for non-existent strategy', () => {
        expect(() => getStrategyTokens('nonExistentStrategy')).toThrow('Strategy nonExistentStrategy not found');
      });

      it('should throw error for invalid strategyId types', () => {
        expect(() => getStrategyTokens(null)).toThrow('ID parameter is required');
        expect(() => getStrategyTokens(undefined)).toThrow('ID parameter is required');
        expect(() => getStrategyTokens(123)).toThrow('ID must be a string');
        expect(() => getStrategyTokens([])).toThrow('ID must be a string');
        expect(() => getStrategyTokens({})).toThrow('ID must be a string');
        expect(() => getStrategyTokens('')).toThrow('ID cannot be empty');
      });

      it('should throw error for strategy missing tokenSupport', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, tokenSupport: undefined };

        expect(() => getStrategyTokens('bob')).toThrow('Strategy bob missing tokenSupport configuration');

        strategies.bob = originalBob;
      });

      it('should throw error for invalid tokenSupport type', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, tokenSupport: 123 };

        expect(() => getStrategyTokens('bob')).toThrow('Strategy bob tokenSupport must be a string');

        strategies.bob = originalBob;
      });

      it('should throw error for invalid tokenSupport value', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, tokenSupport: 'invalid' };

        expect(() => getStrategyTokens('bob')).toThrow('Strategy bob has invalid tokenSupport value: invalid. Must be "all", "stablecoins", or "custom"');

        strategies.bob = originalBob;
      });

      it('should throw error for custom strategy without supportedTokens', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, tokenSupport: 'custom', supportedTokens: undefined };

        expect(() => getStrategyTokens('bob')).toThrow('Strategy bob with tokenSupport "custom" must have valid supportedTokens object');

        strategies.bob = originalBob;
      });

      it('should throw error for custom strategy with empty supportedTokens', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, tokenSupport: 'custom', supportedTokens: {} };

        expect(() => getStrategyTokens('bob')).toThrow('Strategy bob with tokenSupport "custom" must have non-empty supportedTokens');

        strategies.bob = originalBob;
      });

      it('should throw error for custom strategy with invalid supportedTokens type', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, tokenSupport: 'custom', supportedTokens: ['invalid'] };

        expect(() => getStrategyTokens('bob')).toThrow('Strategy bob with tokenSupport "custom" must have valid supportedTokens object');

        strategies.bob = originalBob;
      });
    });

    describe('Custom Strategy Support', () => {
      it('should return custom supportedTokens for custom tokenSupport', () => {
        const originalBob = strategies.bob;
        const customTokens = { ETH: { name: 'Wrapped Ether' }, USDC: { name: 'USD Coin' } };
        strategies.bob = { ...originalBob, tokenSupport: 'custom', supportedTokens: customTokens };

        const result = getStrategyTokens('bob');
        expect(result).toEqual(customTokens);

        strategies.bob = originalBob;
      });
    });

    describe('Backward Compatibility', () => {
      it('should handle strategies with supportedTokens but no tokenSupport', () => {
        const originalBob = strategies.bob;
        const legacyTokens = { ETH: { name: 'Wrapped Ether' } };
        strategies.bob = { ...originalBob, tokenSupport: undefined, supportedTokens: legacyTokens };

        const result = getStrategyTokens('bob');
        expect(result).toEqual(legacyTokens);

        strategies.bob = originalBob;
      });
    });
  });

  describe('formatParameterValue', () => {
    describe('Boolean Parameter Formatting', () => {
      it('should format true boolean as "Yes"', () => {
        const conditionalParam = { type: 'boolean' };
        const result = formatParameterValue(true, conditionalParam);
        expect(result).toBe('Yes');
      });

      it('should format false boolean as "No"', () => {
        const conditionalParam = { type: 'boolean' };
        const result = formatParameterValue(false, conditionalParam);
        expect(result).toBe('No');
      });

      it('should handle truthy values as true for boolean type', () => {
        const conditionalParam = { type: 'boolean' };
        expect(formatParameterValue(1, conditionalParam)).toBe('Yes');
        expect(formatParameterValue('true', conditionalParam)).toBe('Yes');
        expect(formatParameterValue({}, conditionalParam)).toBe('Yes');
      });

      it('should handle falsy values as false for boolean type', () => {
        const conditionalParam = { type: 'boolean' };
        expect(formatParameterValue(0, conditionalParam)).toBe('No');
        expect(formatParameterValue('', conditionalParam)).toBe('No');
        expect(formatParameterValue(NaN, conditionalParam)).toBe('No');
      });
    });

    describe('Select Parameter Formatting', () => {
      it('should return option label for valid select value', () => {
        const conditionalParam = {
          type: 'select',
          options: [
            { value: '0', label: 'Low Priority' },
            { value: '1', label: 'High Priority' }
          ]
        };

        const result = formatParameterValue('1', conditionalParam);
        expect(result).toBe('High Priority');
      });

      it('should return original value when option not found', () => {
        const conditionalParam = {
          type: 'select',
          options: [
            { value: '0', label: 'Low Priority' },
            { value: '1', label: 'High Priority' }
          ]
        };

        const result = formatParameterValue('999', conditionalParam);
        expect(result).toBe('999');
      });

      it('should handle select type without options', () => {
        const conditionalParam = { type: 'select' };
        const result = formatParameterValue('value', conditionalParam);
        expect(result).toBe('value');
      });

      it('should handle select type with null options', () => {
        const conditionalParam = { type: 'select', options: null };
        const result = formatParameterValue('value', conditionalParam);
        expect(result).toBe('value');
      });

      it('should work with different value types in options', () => {
        const conditionalParam = {
          type: 'select',
          options: [
            { value: 0, label: 'Zero' },
            { value: 1, label: 'One' },
            { value: true, label: 'True' },
            { value: 'string', label: 'String Value' }
          ]
        };

        expect(formatParameterValue(0, conditionalParam)).toBe('Zero');
        expect(formatParameterValue(1, conditionalParam)).toBe('One');
        expect(formatParameterValue(true, conditionalParam)).toBe('True');
        expect(formatParameterValue('string', conditionalParam)).toBe('String Value');
      });
    });

    describe('Percent Parameter Formatting', () => {
      it('should format percent with default suffix', () => {
        const conditionalParam = { type: 'percent' };
        const result = formatParameterValue(15.5, conditionalParam);
        expect(result).toBe('15.5%');
      });

      it('should format percent with custom suffix', () => {
        const conditionalParam = { type: 'percent', suffix: ' percent' };
        const result = formatParameterValue(15.5, conditionalParam);
        expect(result).toBe('15.5 percent');
      });

      it('should handle zero percent value', () => {
        const conditionalParam = { type: 'percent' };
        const result = formatParameterValue(0, conditionalParam);
        expect(result).toBe('0%');
      });

      it('should handle negative percent value', () => {
        const conditionalParam = { type: 'percent' };
        const result = formatParameterValue(-5, conditionalParam);
        expect(result).toBe('-5%');
      });

      it('should handle string percent value', () => {
        const conditionalParam = { type: 'percent' };
        const result = formatParameterValue('25', conditionalParam);
        expect(result).toBe('25%');
      });
    });

    describe('Fiat Currency Parameter Formatting', () => {
      it('should format fiat currency with default prefix', () => {
        const conditionalParam = { type: 'fiat-currency' };
        const result = formatParameterValue(100, conditionalParam);
        expect(result).toBe('$100');
      });

      it('should format fiat currency with custom prefix', () => {
        const conditionalParam = { type: 'fiat-currency', prefix: '€' };
        const result = formatParameterValue(100, conditionalParam);
        expect(result).toBe('€100');
      });

      it('should handle zero currency value', () => {
        const conditionalParam = { type: 'fiat-currency' };
        const result = formatParameterValue(0, conditionalParam);
        expect(result).toBe('$0');
      });

      it('should handle decimal currency value', () => {
        const conditionalParam = { type: 'fiat-currency' };
        const result = formatParameterValue(99.99, conditionalParam);
        expect(result).toBe('$99.99');
      });

      it('should handle string currency value', () => {
        const conditionalParam = { type: 'fiat-currency' };
        const result = formatParameterValue('250', conditionalParam);
        expect(result).toBe('$250');
      });
    });

    describe('Integer and Decimal Parameter Formatting', () => {
      it('should format integer type with suffix', () => {
        expect(formatParameterValue(5, { type: 'integer', suffix: ' bps' })).toBe('5 bps');
      });

      it('should format integer type without suffix', () => {
        expect(formatParameterValue(5, { type: 'integer' })).toBe('5');
      });

      it('should format decimal type with suffix', () => {
        expect(formatParameterValue(3.14, { type: 'decimal', suffix: '%' })).toBe('3.14%');
      });

      it('should format decimal type without suffix', () => {
        expect(formatParameterValue(3.14, { type: 'decimal' })).toBe('3.14');
      });
    });

    describe('Default Parameter Formatting', () => {
      it('should format default type without suffix', () => {
        const conditionalParam = { type: 'number' };
        const result = formatParameterValue(42, conditionalParam);
        expect(result).toBe('42');
      });

      it('should format default type with suffix', () => {
        const conditionalParam = { type: 'number', suffix: ' days' };
        const result = formatParameterValue(7, conditionalParam);
        expect(result).toBe('7 days');
      });

      it('should handle unknown parameter type', () => {
        const conditionalParam = { type: 'unknown' };
        const result = formatParameterValue('value', conditionalParam);
        expect(result).toBe('value');
      });

      it('should handle missing parameter type', () => {
        const conditionalParam = {};
        const result = formatParameterValue('value', conditionalParam);
        expect(result).toBe('value');
      });
    });

    describe('Null and Undefined Handling', () => {
      it('should return empty string for null value', () => {
        const conditionalParam = { type: 'percent' };
        const result = formatParameterValue(null, conditionalParam);
        expect(result).toBe('');
      });

      it('should return empty string for undefined value', () => {
        const conditionalParam = { type: 'percent' };
        const result = formatParameterValue(undefined, conditionalParam);
        expect(result).toBe('');
      });

      it('should handle empty string value', () => {
        const conditionalParam = { type: 'percent' };
        const result = formatParameterValue('', conditionalParam);
        expect(result).toBe('%');
      });

      it('should handle zero value', () => {
        const conditionalParam = { type: 'percent' };
        const result = formatParameterValue(0, conditionalParam);
        expect(result).toBe('0%');
      });
    });

    describe('Edge Cases and Error Handling', () => {
      it('should handle null paramConfig', () => {
        expect(() => formatParameterValue('value', null)).toThrow();
      });

      it('should handle undefined paramConfig', () => {
        expect(() => formatParameterValue('value', undefined)).toThrow();
      });

      it('should handle complex object values', () => {
        const conditionalParam = { type: 'number' };
        const result = formatParameterValue({ complex: 'object' }, conditionalParam);
        expect(result).toBe('[object Object]'); // toString() called
      });

      it('should handle array values', () => {
        const conditionalParam = { type: 'number' };
        const result = formatParameterValue([1, 2, 3], conditionalParam);
        expect(result).toBe('1,2,3'); // toString() called
      });

      it('should handle function values', () => {
        const conditionalParam = { type: 'number' };
        const func = () => 'test';
        const result = formatParameterValue(func, conditionalParam);
        expect(result).toContain('test'); // function toString contains function body
      });
    });

    describe('Real Strategy Parameter Examples', () => {
      it('should format bob strategy feeReinvestment parameter', () => {
        const conditionalParam = { type: 'boolean' };
        expect(formatParameterValue(true, conditionalParam)).toBe('Yes');
        expect(formatParameterValue(false, conditionalParam)).toBe('No');
      });

      it('should format bob strategy targetRangeUpper parameter', () => {
        const conditionalParam = { type: 'percent', suffix: '%' };
        expect(formatParameterValue(5.0, conditionalParam)).toBe('5%');
      });

      it('should format bob strategy reinvestmentTrigger parameter', () => {
        const conditionalParam = { type: 'fiat-currency', prefix: '$' };
        expect(formatParameterValue(50, conditionalParam)).toBe('$50');
      });

    });
  });

  describe('validateTokensForStrategy', () => {
    describe('Success Cases (No Messages)', () => {
      it('should return valid result when all vault tokens are in strategy', () => {
        const vaultTokens = { ETH: 1.5, USDC: 1000 };
        const strategyTokens = ['ETH', 'USDC', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when vault tokens are empty', () => {
        const vaultTokens = {};
        const strategyTokens = ['ETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when vault tokens is null', () => {
        const strategyTokens = ['ETH', 'USDC'];

        const result = validateTokensForStrategy(null, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when vault tokens is undefined', () => {
        const strategyTokens = ['ETH', 'USDC'];

        const result = validateTokensForStrategy(undefined, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when strategy tokens is null', () => {
        const vaultTokens = { ETH: 1.5 };

        const result = validateTokensForStrategy(vaultTokens, null);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when strategy tokens is undefined', () => {
        const vaultTokens = { ETH: 1.5 };

        const result = validateTokensForStrategy(vaultTokens, undefined);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when strategy tokens is empty array', () => {
        const vaultTokens = { ETH: 1.5, USDC: 1000 };
        const strategyTokens = [];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when exact token match', () => {
        const vaultTokens = { ETH: 1.5, USDC: 1000 };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when vault has subset of strategy tokens', () => {
        const vaultTokens = { ETH: 1.5 };
        const strategyTokens = ['ETH', 'USDC', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });
    });

    describe('Warning Cases (Returns Warnings)', () => {
      it('should return warning when some vault tokens are not in strategy', () => {
        const vaultTokens = { ETH: 1.5, USDC: 1000, LINK: 500 };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].type).toBe('unmatchedTokens');
        expect(result.warnings[0].count).toBe(1);
        expect(result.warnings[0].items).toEqual(['LINK']);
      });

      it('should return warning when all vault tokens are not in strategy', () => {
        const vaultTokens = { WBTC: 0.5, LINK: 100 };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].type).toBe('unmatchedTokens');
        expect(result.warnings[0].count).toBe(2);
        expect(result.warnings[0].items).toContain('WBTC');
        expect(result.warnings[0].items).toContain('LINK');
      });

      it('should return warning with multiple unmatched tokens', () => {
        const vaultTokens = { ETH: 1.5, WBTC: 0.5, LINK: 100, UNI: 50 };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].type).toBe('unmatchedTokens');
        expect(result.warnings[0].count).toBe(3);
        expect(result.warnings[0].items).toContain('WBTC');
        expect(result.warnings[0].items).toContain('LINK');
        expect(result.warnings[0].items).toContain('UNI');
      });

      it('should handle single unmatched token', () => {
        const vaultTokens = { ETH: 1.5, USDC: 1000, WBTC: 0.5 };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].type).toBe('unmatchedTokens');
        expect(result.warnings[0].count).toBe(1);
        expect(result.warnings[0].items).toEqual(['WBTC']);
      });

      it('should be case-sensitive', () => {
        const vaultTokens = { eth: 1.5, USDC: 1000 }; // lowercase eth
        const strategyTokens = ['ETH', 'USDC']; // uppercase ETH

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].type).toBe('unmatchedTokens');
        expect(result.warnings[0].count).toBe(1);
        expect(result.warnings[0].items).toEqual(['eth']); // lowercase eth is unmatched
      });
    });

    describe('Edge Cases and Input Types', () => {
      it('should handle vault tokens with zero balances', () => {
        const vaultTokens = { ETH: 0, USDC: 1000, LINK: 0 };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].items).toEqual(['LINK']);
      });

      it('should handle vault tokens with negative balances', () => {
        const vaultTokens = { ETH: -1, USDC: 1000 };
        const strategyTokens = ['USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].items).toEqual(['ETH']);
      });

      it('should handle vault tokens with string balances', () => {
        const vaultTokens = { ETH: '1.5', USDC: '1000' };
        const strategyTokens = ['ETH'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].items).toEqual(['USDC']);
      });

      it('should handle non-array strategy tokens gracefully', () => {
        const vaultTokens = { ETH: 1.5 };
        const strategyTokens = 'not-an-array';

        // Should handle non-array gracefully without throwing
        expect(() => validateTokensForStrategy(vaultTokens, strategyTokens)).not.toThrow();
        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].items).toContain('ETH');
      });

      it('should handle empty vault tokens object', () => {
        const vaultTokens = {};
        const strategyTokens = ['ETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
      });

      it('should handle vault tokens with complex token names', () => {
        const vaultTokens = { 'WETH-9': 1.5, 'USDC.e': 1000 };
        const strategyTokens = ['WETH-9'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].items).toEqual(['USDC.e']);
      });

      it('should handle vault tokens with very large numbers', () => {
        const vaultTokens = { ETH: Number.MAX_SAFE_INTEGER, LINK: 1000 };
        const strategyTokens = ['ETH'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].items).toEqual(['LINK']);
      });
    });

    describe('Real-world Usage Scenarios', () => {
      it('should handle typical DeFi vault scenario', () => {
        const vaultTokens = {
          ETH: 2.5,
          USDC: 5000,
          LINK: 1000,
          WBTC: 0.1
        };
        const strategyTokens = ['ETH', 'USDC']; // Strategy only supports ETH/USDC pair

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].items).toContain('LINK');
        expect(result.warnings[0].items).toContain('WBTC');
        expect(result.warnings[0].count).toBe(2);
      });

      it('should handle stablecoin-only strategy', () => {
        const vaultTokens = { USDC: 1000, WBTC: 0.5, ETH: 1.5 };
        const strategyTokens = ['USDC', 'USDC']; // Stablecoin strategy

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].items).toContain('ETH');
        expect(result.warnings[0].items).toContain('WBTC');
      });

      it('should handle vault with tokens strategy does not support', () => {
        const vaultTokens = { SHIB: 1000000, DOGE: 500 };
        const strategyTokens = ['ETH', 'USDC', 'WBTC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].items).toContain('SHIB');
        expect(result.warnings[0].items).toContain('DOGE');
        expect(result.warnings[0].count).toBe(2);
      });

      it('should handle perfect vault-strategy alignment', () => {
        const vaultTokens = { ETH: 1.5, USDC: 3000 };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should be useful for warning users about token swaps', () => {
        const vaultTokens = { ETH: 1, USDC: 1000, LINK: 500, WBTC: 0.1 };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);

        // Should return exactly one warning
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);

        // Should have structured data about tokens that will be swapped
        expect(result.warnings[0].type).toBe('unmatchedTokens');
        expect(result.warnings[0].items).toContain('LINK');
        expect(result.warnings[0].items).toContain('WBTC');
        expect(result.warnings[0].count).toBe(2);

        // Should not include tokens that are already supported
        expect(result.warnings[0].items).not.toContain('ETH');
        expect(result.warnings[0].items).not.toContain('USDC');
      });
    });

    describe('Native/Wrapped Equivalence (chainId)', () => {
      it('should treat ETH as equivalent to WETH when chainId is provided (Arbitrum)', () => {
        const vaultTokens = { ETH: 1 };
        const strategyTokens = ['WETH'];
        const result = validateTokensForStrategy(vaultTokens, strategyTokens, 42161);
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should treat WETH as equivalent to ETH when chainId is provided (bidirectional)', () => {
        const vaultTokens = { WETH: 1 };
        const strategyTokens = ['ETH'];
        const result = validateTokensForStrategy(vaultTokens, strategyTokens, 42161);
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should treat AVAX as equivalent to WAVAX when chainId is provided (Avalanche)', () => {
        const vaultTokens = { AVAX: 1 };
        const strategyTokens = ['WAVAX'];
        const result = validateTokensForStrategy(vaultTokens, strategyTokens, 43114);
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should NOT treat ETH as equivalent to WETH without chainId (backward compat)', () => {
        const vaultTokens = { ETH: 1 };
        const strategyTokens = ['WETH'];
        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].items).toContain('ETH');
      });

      it('should only match native/wrapped — other unmatched tokens still flagged', () => {
        const vaultTokens = { ETH: 1, USDC: 500, LINK: 100 };
        const strategyTokens = ['WETH', 'USDC'];
        const result = validateTokensForStrategy(vaultTokens, strategyTokens, 42161);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].count).toBe(1);
        expect(result.warnings[0].items).toContain('LINK');
        expect(result.warnings[0].items).not.toContain('ETH');
      });
    });

    describe('chainId Validation', () => {
      it('should throw for string chainId', () => {
        const vaultTokens = { ETH: 1 };
        const strategyTokens = ['WETH'];
        expect(() => validateTokensForStrategy(vaultTokens, strategyTokens, 'abc'))
          .toThrow('chainId must be a positive integer');
      });

      it('should throw for negative chainId', () => {
        const vaultTokens = { ETH: 1 };
        const strategyTokens = ['WETH'];
        expect(() => validateTokensForStrategy(vaultTokens, strategyTokens, -1))
          .toThrow('chainId must be a positive integer');
      });

      it('should throw for float chainId', () => {
        const vaultTokens = { ETH: 1 };
        const strategyTokens = ['WETH'];
        expect(() => validateTokensForStrategy(vaultTokens, strategyTokens, 3.5))
          .toThrow('chainId must be a positive integer');
      });

      it('should throw for zero chainId', () => {
        const vaultTokens = { ETH: 1 };
        const strategyTokens = ['WETH'];
        expect(() => validateTokensForStrategy(vaultTokens, strategyTokens, 0))
          .toThrow('chainId must be a positive integer');
      });

      it('should not throw for undefined chainId (optional param)', () => {
        const vaultTokens = { ETH: 1 };
        const strategyTokens = ['WETH'];
        expect(() => validateTokensForStrategy(vaultTokens, strategyTokens, undefined)).not.toThrow();
      });

      it('should not throw for null chainId (optional param)', () => {
        const vaultTokens = { ETH: 1 };
        const strategyTokens = ['WETH'];
        expect(() => validateTokensForStrategy(vaultTokens, strategyTokens, null)).not.toThrow();
      });
    });
  });

  describe('validatePositionsForStrategy', () => {
    describe('Success Cases (No Issues)', () => {
      it('should return valid result when all positions match strategy tokens', () => {
        const vaultPositions = [
          { id: '12345', pool: '0xabc' },
          { id: '67890', pool: '0xdef' }
        ];
        const pools = {
          '0xabc': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } },
          '0xdef': { token0: { symbol: 'USDC' }, token1: { symbol: 'ETH' } }
        };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when no positions in vault', () => {
        const vaultPositions = [];
        const pools = {};
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when vaultPositions is null', () => {
        const pools = {};
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(null, pools, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when vaultPositions is undefined', () => {
        const pools = {};
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(undefined, pools, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when strategyTokens is null', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = { '0xabc': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } } };

        const result = validatePositionsForStrategy(vaultPositions, pools, null);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when strategyTokens is undefined', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = { '0xabc': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } } };

        const result = validatePositionsForStrategy(vaultPositions, pools, undefined);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when strategyTokens is empty array', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = { '0xabc': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } } };
        const strategyTokens = [];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should return valid result when pools is null', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(vaultPositions, null, strategyTokens);
        expect(result).toEqual({ isValid: true, warnings: [] });
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });
    });

    describe('Warning Cases (Returns Warnings)', () => {
      it('should return warning when position has one mismatched token', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = {
          '0xabc': { token0: { symbol: 'ETH' }, token1: { symbol: 'LINK' } }
        };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].type).toBe('unmatchedPositions');
        expect(result.warnings[0].count).toBe(1);
        expect(result.warnings[0].items).toHaveLength(1);
        expect(result.warnings[0].items[0].id).toBe('12345');
        expect(result.warnings[0].items[0].tokenPair).toBe('ETH/LINK');
        expect(result.warnings[0].items[0].nonMatchingTokens).toEqual(['LINK']);
      });

      it('should return warning when position has both tokens mismatched', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = {
          '0xabc': { token0: { symbol: 'WBTC' }, token1: { symbol: 'LINK' } }
        };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].type).toBe('unmatchedPositions');
        expect(result.warnings[0].count).toBe(1);
        expect(result.warnings[0].items[0].id).toBe('12345');
        expect(result.warnings[0].items[0].tokenPair).toBe('WBTC/LINK');
        expect(result.warnings[0].items[0].nonMatchingTokens).toEqual(['WBTC', 'LINK']);
      });

      it('should return warning for multiple positions with mismatches', () => {
        const vaultPositions = [
          { id: '111', pool: '0xaaa' },
          { id: '222', pool: '0xbbb' }
        ];
        const pools = {
          '0xaaa': { token0: { symbol: 'ETH' }, token1: { symbol: 'LINK' } },
          '0xbbb': { token0: { symbol: 'WBTC' }, token1: { symbol: 'USDC' } }
        };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].count).toBe(2);
        expect(result.warnings[0].items).toHaveLength(2);
        expect(result.warnings[0].items[0].id).toBe('111');
        expect(result.warnings[0].items[0].nonMatchingTokens).toEqual(['LINK']);
        expect(result.warnings[0].items[1].id).toBe('222');
        expect(result.warnings[0].items[1].nonMatchingTokens).toEqual(['WBTC']);
      });

      it('should handle mixed scenario - some positions match, some dont', () => {
        const vaultPositions = [
          { id: '111', pool: '0xaaa' }, // matches
          { id: '222', pool: '0xbbb' }, // doesn't match
          { id: '333', pool: '0xccc' }  // matches
        ];
        const pools = {
          '0xaaa': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } },
          '0xbbb': { token0: { symbol: 'LINK' }, token1: { symbol: 'WBTC' } },
          '0xccc': { token0: { symbol: 'USDC' }, token1: { symbol: 'ETH' } }
        };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].count).toBe(1);
        expect(result.warnings[0].items).toHaveLength(1);
        expect(result.warnings[0].items[0].id).toBe('222');
      });

      it('should be case-sensitive with token matching', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = {
          '0xabc': { token0: { symbol: 'weth' }, token1: { symbol: 'USDC' } } // lowercase weth
        };
        const strategyTokens = ['ETH', 'USDC']; // uppercase ETH

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].items[0].nonMatchingTokens).toEqual(['weth']);
      });
    });

    describe('Edge Cases', () => {
      it('should flag positions with no pool field as unable to validate', () => {
        // Hits the `if (!position.pool)` branch — different from the
        // "missing pool data" branch below (which fires when pool ID exists
        // but the pools map has no entry for it).
        const vaultPositions = [
          { id: '12345' /* no pool field */ },
          { /* no id, no pool */ },
        ];
        const result = validatePositionsForStrategy(vaultPositions, {}, ['ETH']);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].count).toBe(2);
        expect(result.warnings[0].items[0].tokenPair).toBe('Unknown - missing pool ID');
        expect(result.warnings[0].items[0].nonMatchingTokens).toEqual(['Unable to validate - missing pool ID']);
        // Second position has no id — falls back to position-index naming
        expect(result.warnings[0].items[1].id).toBe('position-1');
      });

      it('should flag positions with missing pool data as unable to validate', () => {
        const vaultPositions = [
          { id: '111', pool: '0xaaa' },
          { id: '222', pool: '0xbbb' } // pool data missing
        ];
        const pools = {
          '0xaaa': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } }
          // 0xbbb is missing
        };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].count).toBe(1);
        expect(result.warnings[0].items[0].id).toBe('222');
        expect(result.warnings[0].items[0].nonMatchingTokens).toContain('Unable to validate - missing pool data');
      });

      it('should flag positions with null token data as unable to validate', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = {
          '0xabc': { token0: null, token1: { symbol: 'USDC' } }
        };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].count).toBe(1);
        expect(result.warnings[0].items[0].id).toBe('12345');
        expect(result.warnings[0].items[0].nonMatchingTokens).toContain('Unable to validate - missing pool data');
      });

      it('should flag positions with undefined token symbols as unable to validate', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = {
          '0xabc': { token0: { symbol: undefined }, token1: { symbol: 'USDC' } }
        };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].type).toBe('unmatchedPositions');
        expect(result.warnings[0].count).toBe(1);
        expect(result.warnings[0].items[0].id).toBe('12345');
        expect(result.warnings[0].items[0].nonMatchingTokens).toContain('Unable to validate - undefined token symbol');
      });

      it('should flag undefined positions in array as unable to validate', () => {
        const vaultPositions = [
          { id: '111', pool: '0xaaa' },
          undefined,
          { id: '222', pool: '0xbbb' }
        ];
        const pools = {
          '0xaaa': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } },
          '0xbbb': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } }
        };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].count).toBe(1);
        expect(result.warnings[0].items[0].id).toBe('position-1'); // Index 1 is undefined
        expect(result.warnings[0].items[0].nonMatchingTokens).toContain('Unable to validate - undefined position');
      });

      it('should flag positions with invalid pool structure as unable to validate', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = {
          '0xabc': { invalidStructure: true } // missing token0/token1
        };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].count).toBe(1);
        expect(result.warnings[0].items[0].id).toBe('12345');
        expect(result.warnings[0].items[0].nonMatchingTokens).toContain('Unable to validate - missing pool data');
      });

      it('should handle positions with complex token names', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = {
          '0xabc': { token0: { symbol: 'WETH-9' }, token1: { symbol: 'USDC.e' } }
        };
        const strategyTokens = ['WETH-9', 'USDC.e'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });
    });

    describe('Real-world Usage Scenarios', () => {
      it('should handle vault migrating from ETH/USDC to USDC/DAI strategy', () => {
        const vaultPositions = [
          { id: '111', pool: '0xaaa' },
          { id: '222', pool: '0xbbb' }
        ];
        const pools = {
          '0xaaa': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } },
          '0xbbb': { token0: { symbol: 'ETH' }, token1: { symbol: 'LINK' } }
        };
        const strategyTokens = ['USDC', 'DAI']; // New strategy

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].count).toBe(2);
        // Both positions have ETH which is not in new strategy
        expect(result.warnings[0].items[0].nonMatchingTokens).toContain('ETH');
        expect(result.warnings[0].items[1].nonMatchingTokens).toContain('ETH');
      });

      it('should handle vault with all positions needing to be closed', () => {
        const vaultPositions = [
          { id: '111', pool: '0xaaa' },
          { id: '222', pool: '0xbbb' },
          { id: '333', pool: '0xccc' }
        ];
        const pools = {
          '0xaaa': { token0: { symbol: 'WBTC' }, token1: { symbol: 'LINK' } },
          '0xbbb': { token0: { symbol: 'AAVE' }, token1: { symbol: 'UNI' } },
          '0xccc': { token0: { symbol: 'SUSHI' }, token1: { symbol: 'COMP' } }
        };
        const strategyTokens = ['ETH', 'USDC']; // None of the positions match

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].count).toBe(3);
        expect(result.warnings[0].items).toHaveLength(3);
      });

      it('should handle large vault with many positions and partial matches', () => {
        const vaultPositions = [
          { id: '1', pool: '0xa' },
          { id: '2', pool: '0xb' },
          { id: '3', pool: '0xc' },
          { id: '4', pool: '0xd' },
          { id: '5', pool: '0xe' }
        ];
        const pools = {
          '0xa': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } }, // match
          '0xb': { token0: { symbol: 'ETH' }, token1: { symbol: 'DAI' } },  // match
          '0xc': { token0: { symbol: 'ETH' }, token1: { symbol: 'LINK' } }, // LINK mismatch
          '0xd': { token0: { symbol: 'USDC' }, token1: { symbol: 'DAI' } },  // match
          '0xe': { token0: { symbol: 'WBTC' }, token1: { symbol: 'LINK' } }  // both mismatch
        };
        const strategyTokens = ['ETH', 'USDC', 'DAI'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].count).toBe(2); // positions 3 and 5
        expect(result.warnings[0].items).toHaveLength(2);
      });

      it('should handle positions with matching ETH tokens', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = {
          '0xabc': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } }
        };
        const strategyTokens = ['ETH', 'USDC'];

        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });
    });

    describe('Native/Wrapped Equivalence (chainId)', () => {
      it('should treat ETH/USDC position as matching WETH/USDC strategy with chainId', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = {
          '0xabc': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } }
        };
        const strategyTokens = ['WETH', 'USDC'];
        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens, 42161);
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });

      it('should NOT treat ETH/USDC position as matching WETH/USDC strategy without chainId', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = {
          '0xabc': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } }
        };
        const strategyTokens = ['WETH', 'USDC'];
        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens);
        expect(result.isValid).toBe(false);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].items[0].nonMatchingTokens).toContain('ETH');
      });

      it('should treat AVAX/USDC position as matching WAVAX/USDC strategy with chainId', () => {
        const vaultPositions = [{ id: '12345', pool: '0xabc' }];
        const pools = {
          '0xabc': { token0: { symbol: 'AVAX' }, token1: { symbol: 'USDC' } }
        };
        const strategyTokens = ['WAVAX', 'USDC'];
        const result = validatePositionsForStrategy(vaultPositions, pools, strategyTokens, 43114);
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });
    });

    describe('chainId Validation', () => {
      const vaultPositions = [{ id: '12345', pool: '0xabc' }];
      const pools = {
        '0xabc': { token0: { symbol: 'ETH' }, token1: { symbol: 'USDC' } }
      };
      const strategyTokens = ['WETH', 'USDC'];

      it('should throw for string chainId', () => {
        expect(() => validatePositionsForStrategy(vaultPositions, pools, strategyTokens, 'abc'))
          .toThrow('chainId must be a positive integer');
      });

      it('should throw for negative chainId', () => {
        expect(() => validatePositionsForStrategy(vaultPositions, pools, strategyTokens, -1))
          .toThrow('chainId must be a positive integer');
      });

      it('should throw for zero chainId', () => {
        expect(() => validatePositionsForStrategy(vaultPositions, pools, strategyTokens, 0))
          .toThrow('chainId must be a positive integer');
      });
    });
  });

  describe('mapStrategyParameters', () => {
    describe('Success Cases', () => {
      describe('Bob Strategy', () => {
        it('should map Bob strategy parameters correctly', () => {
          // Bob: [targetRangeUpper, targetRangeLower, feeReinvestment, reinvestmentTrigger, reinvestmentRatio, maxSlippage, emergencyExitTrigger]
          const rawBytes = encodeBobParams([1000, 1000, true, 5000, 8000, 50, 1000]);
          const result = mapStrategyParameters('bob', rawBytes);

          expect(result).toEqual({
            targetRangeUpper: 10,
            targetRangeLower: 10,
            feeReinvestment: true,
            reinvestmentTrigger: '50.0',
            reinvestmentRatio: 80,
            maxSlippage: 0.5,
            emergencyExitTrigger: 10
          });
        });

        it('should handle Bob strategy with false boolean parameter', () => {
          const rawBytes = encodeBobParams([1000, 1000, false, 5000, 8000, 50, 1000]);
          const result = mapStrategyParameters('bob', rawBytes);

          expect(result.feeReinvestment).toBe(false);
        });

        it('should convert basis points to percentages correctly for Bob', () => {
          const rawBytes = encodeBobParams([500, 500, true, 5000, 5000, 50, 1000]);
          const result = mapStrategyParameters('bob', rawBytes);

          expect(result.targetRangeUpper).toBe(5);
          expect(result.targetRangeLower).toBe(5);
          expect(result.reinvestmentRatio).toBe(50);
          expect(result.maxSlippage).toBe(0.5);
          expect(result.emergencyExitTrigger).toBe(10);
        });
      });
    });

    describe('Error Cases', () => {
      describe('Parameter Validation', () => {
        it('should throw error for invalid strategyId types', () => {
          const validBytes = encodeBobParams([1000, 1000, true, 5000, 8000, 50, 1000, 9000]);

          expect(() => mapStrategyParameters(null, validBytes)).toThrow('ID parameter is required');
          expect(() => mapStrategyParameters(undefined, validBytes)).toThrow('ID parameter is required');
          expect(() => mapStrategyParameters(123, validBytes)).toThrow('ID must be a string');
          expect(() => mapStrategyParameters('', validBytes)).toThrow('ID cannot be empty');
        });

        it('should throw error for non-string rawBytes', () => {
          expect(() => mapStrategyParameters('bob', null)).toThrow('rawBytes parameter is required');
          expect(() => mapStrategyParameters('bob', undefined)).toThrow('rawBytes parameter is required');
          expect(() => mapStrategyParameters('bob', 123)).toThrow('rawBytes must be a hex string');
          expect(() => mapStrategyParameters('bob', {})).toThrow('rawBytes must be a hex string');
          expect(() => mapStrategyParameters('bob', [])).toThrow('rawBytes must be a hex string');
        });

        it('should throw error for unknown strategy', () => {
          const validBytes = encodeBobParams([1000, 1000, true, 5000, 8000, 50, 1000, 9000]);
          expect(() => mapStrategyParameters('unknown', validBytes)).toThrow('Strategy unknown not found');
        });

        it('should throw error for unsupported strategy', () => {
          const validBytes = encodeBobParams([1000, 1000, true, 5000, 8000, 50, 1000, 9000]);
          expect(() => mapStrategyParameters('none', validBytes)).toThrow('No parameter mapping defined for strategy none');
        });

        it('should throw error for case-sensitive strategy IDs', () => {
          const rawBytes = encodeBobParams([1000, 1000, true, 5000, 8000, 50, 1000, 9000]);
          expect(() => mapStrategyParameters('BOB', rawBytes)).toThrow('Strategy BOB not found');
          expect(() => mapStrategyParameters('Bob', rawBytes)).toThrow('Strategy Bob not found');
          expect(() => mapStrategyParameters('bOb', rawBytes)).toThrow('Strategy bOb not found');
        });
      });

      describe('Invalid Hex Bytes', () => {
        it('should throw error for invalid hex string', () => {
          expect(() => mapStrategyParameters('bob', 'not-hex')).toThrow();
          expect(() => mapStrategyParameters('bob', '0x')).toThrow();
          expect(() => mapStrategyParameters('bob', '0xGGGG')).toThrow();
        });

        it('should throw error for incorrectly sized bytes', () => {
          // Too short - not enough data for 8 Bob parameters
          expect(() => mapStrategyParameters('bob', '0x0000')).toThrow();
        });
      });
    });
  });

});

// =============================================================================
// Config-injection tests — cover guards that fire only when strategies config
// is malformed (or uses shapes the real 'none'/'bob' strategies don't).
// Uses vi.doMock + resetModules + dynamic import (same pattern as theGraph /
// platformHelpers / chainHelpers config-injection tests).
// =============================================================================
describe('strategyHelpers — config-injection tests', () => {
  let mocked;

  // Minimal valid base that satisfies every structural check in
  // getStrategyDetails before reaching the tokenSupport-specific guards.
  const baseValid = {
    id: 'base', name: 'Base', subtitle: '_', description: '_',
    icon: '_', color: '_', borderColor: '_', textColor: '_',
    minTokens: 1, maxTokens: 1,
    minPlatforms: 1, maxPlatforms: 1,
    minPositions: 1, maxPositions: 1,
    parameters: {},
    strategyProperties: {},
    templates: {},
    parameterGroups: {},
    contractParametersGroups: {},
    templateEnumMap: {},
  };

  beforeAll(async () => {
    vi.doMock('../../../src/configs/strategies.js', () => ({
      default: {
        // Valid stablecoins strategy — exercises getStrategyDetails line 203
        // and getStrategyTokens lines 785-786.
        stablecoinsStrat: { ...baseValid, id: 'stablecoinsStrat', tokenSupport: 'stablecoins' },

        // Valid custom strategy — exercises getStrategyDetails line 205.
        customStrat: { ...baseValid, id: 'customStrat', tokenSupport: 'custom',
          supportedTokens: { FOO: { symbol: 'FOO', decimals: 18 } } },

        // tokenSupport value not in the enum — exercises line 159-160.
        bogusTokenSupport: { ...baseValid, id: 'bogusTokenSupport', tokenSupport: 'bogus' },

        // tokenSupport 'custom' with no supportedTokens — exercises 164-166.
        customNoTokens: { ...baseValid, id: 'customNoTokens', tokenSupport: 'custom' },

        // tokenSupport 'custom' with empty supportedTokens — exercises 167-169.
        customEmpty: { ...baseValid, id: 'customEmpty', tokenSupport: 'custom', supportedTokens: {} },

        // tokenSupport 'all' with a supportedTokens property — exercises 172-173.
        allWithExtra: { ...baseValid, id: 'allWithExtra', tokenSupport: 'all',
          supportedTokens: { FOO: {} } },

        // Strategy with integer + select param types — exercises the
        // integer-whole-number guard (615-619) and select-invalid-option
        // guard (634-639) in validateStrategyParams.
        paramTypes: {
          ...baseValid,
          id: 'paramTypes',
          tokenSupport: 'all',
          parameters: {
            intParam: { type: 'integer', name: 'IntParam', min: 1, max: 100 },
            selectParam: { type: 'select', name: 'SelectParam',
              options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
          },
        },
      },
    }));
    vi.resetModules();
    mocked = await import('../../../src/helpers/strategyHelpers.js');
  });

  afterAll(() => {
    vi.doUnmock('../../../src/configs/strategies.js');
    vi.resetModules();
  });

  describe('getStrategyDetails tokenSupport guards', () => {
    it('throws when tokenSupport value is not in the enum', () => {
      expect(() => mocked.getStrategyDetails('bogusTokenSupport'))
        .toThrow('tokenSupport must be one of: all, stablecoins, custom');
    });

    it('throws when tokenSupport "custom" is missing supportedTokens', () => {
      expect(() => mocked.getStrategyDetails('customNoTokens'))
        .toThrow('must have valid supportedTokens object');
    });

    it('throws when tokenSupport "custom" has empty supportedTokens', () => {
      expect(() => mocked.getStrategyDetails('customEmpty'))
        .toThrow('must have non-empty supportedTokens');
    });

    it('throws when non-custom tokenSupport has a supportedTokens property', () => {
      expect(() => mocked.getStrategyDetails('allWithExtra'))
        .toThrow('must not have supportedTokens property');
    });

    it('returns stablecoins via getStablecoins() when tokenSupport is "stablecoins"', () => {
      const result = mocked.getStrategyDetails('stablecoinsStrat');
      // getStablecoins() returns tokens flagged isStablecoin — presence of USDC
      // is sufficient to prove we took the stablecoins branch.
      expect(result.supportedTokens).toHaveProperty('USDC');
    });

    it('returns strategy.supportedTokens when tokenSupport is "custom"', () => {
      const result = mocked.getStrategyDetails('customStrat');
      expect(result.supportedTokens).toEqual({ FOO: { symbol: 'FOO', decimals: 18 } });
    });
  });

  describe('getStrategyTokens — stablecoins branch', () => {
    it('returns getStablecoins() when tokenSupport is "stablecoins"', () => {
      const tokens = mocked.getStrategyTokens('stablecoinsStrat');
      expect(tokens).toHaveProperty('USDC');
    });
  });

  describe('validateStrategyParams — integer and select type guards', () => {
    it('returns error when integer param is not a whole number', () => {
      const result = mocked.validateStrategyParams('paramTypes', {
        intParam: 5.5,
        selectParam: 'a',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.intParam).toContain('must be a whole number');
    });

    it('returns error when select param value is not in options', () => {
      const result = mocked.validateStrategyParams('paramTypes', {
        intParam: 5,
        selectParam: 'not-a-valid-option',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.selectParam).toContain('must be one of the provided options');
    });
  });
});
