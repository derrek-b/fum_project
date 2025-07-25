/**
 * Strategy Helpers Unit Tests
 *
 * Tests for strategy configuration utilities and validation functions
 */

import { describe, it, expect } from 'vitest';
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
  strategySupportsTokens,
  formatParameterValue,
  validateTokensForStrategy,
  mapStrategyParameters
} from '../../../src/helpers/strategyHelpers.js';
import { getAllTokens } from '../../../src/helpers/tokenHelpers.js';
import strategies from '../../../src/configs/strategies.js';




describe('Strategy Helpers', () => {
  describe('validateIdString', () => {
    describe('Success Cases', () => {
      it('should accept valid ID strings', () => {
        expect(() => validateIdString('bob')).not.toThrow();
        expect(() => validateIdString('parris')).not.toThrow();
        expect(() => validateIdString('fed')).not.toThrow();
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

      // Should return exactly 4 strategies (none, bob, parris, fed)
      expect(result).toHaveLength(4);
      expect(result.sort()).toEqual(['bob', 'fed', 'none', 'parris']);

      // Should include all strategy IDs (including "none" unlike lookupAvailableStrategies)
      expect(result).toContain('none');
      expect(result).toContain('bob');
      expect(result).toContain('parris');
      expect(result).toContain('fed');

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

      // Should return exactly 3 strategies (bob, parris, fed)
      expect(result).toHaveLength(3);
      expect(result.map(s => s.id).sort()).toEqual(['bob', 'fed', 'parris']);

      // Test specific strategy details
      const bob = result.find(s => s.id === 'bob');
      expect(bob.name).toBe('Baby Steps');
      expect(bob.subtitle).toBe('Baby Step into Liquidity Management');

      const parris = result.find(s => s.id === 'parris');
      expect(parris.name).toBe('Parris Island');
      expect(parris.subtitle).toBe('Advanced Liquidity Management');

      const fed = result.find(s => s.id === 'fed');
      expect(fed.name).toBe('The Fed');
      expect(fed.subtitle).toBe('Stablecoin Optimization');

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
        templates: expect.any(Object)
      });

      // Cherry pick specific values for bob strategy
      expect(result.id).toBe('bob');
      expect(result.name).toBe('Baby Steps');
      expect(result.subtitle).toBe('Baby Step into Liquidity Management');
      expect(result.color).toBe('gold');
      expect(result.minTokens).toBe(2);
      expect(result.maxTokens).toBe(2);
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
        expect(Object.keys(result)).toHaveLength(10);

        // Test specific values
        expect(result.targetRangeUpper).toBe(10.0);
        expect(result.targetRangeLower).toBe(10.0);
        expect(result.rebalanceThresholdUpper).toBe(3.0);
        expect(result.rebalanceThresholdLower).toBe(3.0);
        expect(result.maxUtilization).toBe(60);
        expect(result.maxSlippage).toBe(0.3);
        expect(result.emergencyExitTrigger).toBe(20);
        expect(result.feeReinvestment).toBe(false);
        expect(result.reinvestmentTrigger).toBe(50);
        expect(result.reinvestmentRatio).toBe(80);
      });

      it('should return custom template defaults', () => {
        const result = getTemplateDefaults('bob', 'custom');

        // Should return the defaults defined in the custom template
        expect(typeof result).toBe('object');
        expect(Object.keys(result)).toHaveLength(10);

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

        // Should have defaults for all parameters in bob strategy
        expect(Object.keys(result)).toHaveLength(10);

        // Test specific custom template values for bob strategy
        expect(result.targetRangeUpper).toBe(5.0);
        expect(result.targetRangeLower).toBe(5.0);
        expect(result.rebalanceThresholdUpper).toBe(1.5);
        expect(result.rebalanceThresholdLower).toBe(1.5);
        expect(result.feeReinvestment).toBe(true);
        expect(result.reinvestmentTrigger).toBe(50);
        expect(result.reinvestmentRatio).toBe(80);
        expect(result.maxSlippage).toBe(0.5);
        expect(result.emergencyExitTrigger).toBe(15);
        expect(result.maxUtilization).toBe(80);
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

      it('should return fed strategy defaults', () => {
        const result = getParamDefaultValues('fed');

        // Fed strategy has different structure with fewer parameters
        expect(Object.keys(result)).toHaveLength(4);
        expect(result.targetRange).toBe(0.5);
        expect(result.rebalanceThreshold).toBe(1.0);
        expect(result.feeReinvestment).toBe(true);
        expect(result.maxSlippage).toBe(0.5);
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
        expect(parameterKeys).toHaveLength(4);
        expect(parameterKeys).toContain('targetRangeUpper');
        expect(parameterKeys).toContain('targetRangeLower');
        expect(parameterKeys).toContain('rebalanceThresholdUpper');
        expect(parameterKeys).toContain('rebalanceThresholdLower');

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
        expect(parameterKeys).toHaveLength(3);
        expect(parameterKeys).toContain('maxSlippage');
        expect(parameterKeys).toContain('emergencyExitTrigger');
        expect(parameterKeys).toContain('maxUtilization');

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

      it('should work with parris strategy advanced group', () => {
        const result = getStrategyParametersByGroup('parris', 3);

        // Group 3 in parris strategy contains advanced parameters
        const parameterKeys = Object.keys(result);
        expect(parameterKeys.length).toBeGreaterThan(0);

        // Should contain adaptive range parameters
        expect(parameterKeys).toContain('adaptiveRanges');
        expect(parameterKeys).toContain('oracleSource');
        expect(parameterKeys).toContain('platformSelectionCriteria');

        // All should belong to group 3
        Object.values(result).forEach(param => {
          expect(param.group).toBe(3);
        });
      });

      it('should work with fed strategy parameters', () => {
        const result = getStrategyParametersByGroup('fed', 0);

        // Fed strategy group 0 has range parameters
        const parameterKeys = Object.keys(result);
        expect(parameterKeys).toContain('targetRange');
        expect(parameterKeys).toContain('rebalanceThreshold');

        Object.values(result).forEach(param => {
          expect(param.group).toBe(0);
        });
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

        // Range contract group in bob strategy contains range parameters
        const parameterKeys = Object.keys(result);
        expect(parameterKeys).toHaveLength(4);
        expect(parameterKeys).toContain('targetRangeUpper');
        expect(parameterKeys).toContain('targetRangeLower');
        expect(parameterKeys).toContain('rebalanceThresholdUpper');
        expect(parameterKeys).toContain('rebalanceThresholdLower');

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
        expect(parameterKeys).toHaveLength(3);
        expect(parameterKeys).toContain('maxSlippage');
        expect(parameterKeys).toContain('emergencyExitTrigger');
        expect(parameterKeys).toContain('maxUtilization');

        // All should belong to risk contract group
        Object.values(result).forEach(param => {
          expect(param.contractGroup).toBe('risk');
        });
      });

      it('should work with parris strategy adaptive contract group', () => {
        const result = getStrategyParametersByContractGroup('parris', 'adaptive');

        // Adaptive contract group in parris strategy contains adaptive parameters
        const parameterKeys = Object.keys(result);
        expect(parameterKeys.length).toBeGreaterThan(0);

        // Should contain adaptive range parameters
        expect(parameterKeys).toContain('adaptiveRanges');
        expect(parameterKeys).toContain('rebalanceCountThresholdHigh');
        expect(parameterKeys).toContain('rebalanceCountThresholdLow');

        // All should belong to adaptive contract group
        Object.values(result).forEach(param => {
          expect(param.contractGroup).toBe('adaptive');
        });
      });

      it('should work with parris strategy oracle contract group', () => {
        const result = getStrategyParametersByContractGroup('parris', 'oracle');

        const parameterKeys = Object.keys(result);
        expect(parameterKeys).toContain('oracleSource');
        expect(parameterKeys).toContain('priceDeviationTolerance');

        Object.values(result).forEach(param => {
          expect(param.contractGroup).toBe('oracle');
        });
      });

      it('should work with parris strategy positionSizing contract group', () => {
        const result = getStrategyParametersByContractGroup('parris', 'positionSizing');

        const parameterKeys = Object.keys(result);
        expect(parameterKeys).toContain('maxPositionSizePercent');
        expect(parameterKeys).toContain('minPositionSize');
        expect(parameterKeys).toContain('targetUtilization');

        Object.values(result).forEach(param => {
          expect(param.contractGroup).toBe('positionSizing');
        });
      });

      it('should work with parris strategy platform contract group', () => {
        const result = getStrategyParametersByContractGroup('parris', 'platform');

        const parameterKeys = Object.keys(result);
        expect(parameterKeys).toContain('platformSelectionCriteria');
        expect(parameterKeys).toContain('minPoolLiquidity');

        Object.values(result).forEach(param => {
          expect(param.contractGroup).toBe('platform');
        });
      });

      it('should work with fed strategy contract groups', () => {
        const rangeResult = getStrategyParametersByContractGroup('fed', 'range');
        expect(Object.keys(rangeResult)).toContain('targetRange');
        expect(Object.keys(rangeResult)).toContain('rebalanceThreshold');

        const feeResult = getStrategyParametersByContractGroup('fed', 'fee');
        expect(Object.keys(feeResult)).toContain('feeReinvestment');

        const riskResult = getStrategyParametersByContractGroup('fed', 'risk');
        expect(Object.keys(riskResult)).toContain('maxSlippage');
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
          rebalanceThresholdUpper: 1.5,
          rebalanceThresholdLower: 1.5,
          feeReinvestment: true,
          reinvestmentTrigger: 50,
          reinvestmentRatio: 80,
          maxSlippage: 0.5,
          emergencyExitTrigger: 15,
          maxUtilization: 80
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
          rebalanceThresholdUpper: 1.5,
          rebalanceThresholdLower: 1.5,
          feeReinvestment: true, // Condition parameter
          reinvestmentTrigger: 100, // Conditional parameter - should be validated
          reinvestmentRatio: 90, // Conditional parameter - should be validated
          maxSlippage: 0.5,
          emergencyExitTrigger: 15,
          maxUtilization: 80
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(true);
        expect(Object.keys(result.errors)).toHaveLength(0);
      });

      it('should skip conditional parameters when condition is not met', () => {
        const params = {
          targetRangeUpper: 5.0,
          targetRangeLower: 5.0,
          rebalanceThresholdUpper: 1.5,
          rebalanceThresholdLower: 1.5,
          feeReinvestment: false, // Condition not met
          // reinvestmentTrigger and reinvestmentRatio not provided - should be skipped
          maxSlippage: 0.5,
          emergencyExitTrigger: 15,
          maxUtilization: 80
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(true);
        expect(Object.keys(result.errors)).toHaveLength(0);
      });

      it('should validate select parameters correctly', () => {
        const params = {
          targetRangeUpper: 5.0,
          targetRangeLower: 5.0,
          rebalanceThresholdUpper: 1.5,
          rebalanceThresholdLower: 1.5,
          maxVaultUtilization: 80,
          adaptiveRanges: true,
          rebalanceCountThresholdHigh: 3,
          rebalanceCountThresholdLow: 1,
          adaptiveTimeframeHigh: 7,
          adaptiveTimeframeLow: 7,
          rangeAdjustmentPercentHigh: 20,
          thresholdAdjustmentPercentHigh: 15,
          rangeAdjustmentPercentLow: 20,
          thresholdAdjustmentPercentLow: 15,
          maxSlippage: 0.5,
          emergencyExitTrigger: 15,
          oracleSource: "1", // Valid select option
          priceDeviationTolerance: 1.0,
          maxPositionSizePercent: 30,
          minPositionSize: 100,
          targetUtilization: 20,
          feeReinvestment: true,
          reinvestmentTrigger: 50,
          reinvestmentRatio: 80,
          platformSelectionCriteria: "2", // Valid select option
          minPoolLiquidity: 100000
        };

        const result = validateStrategyParams('parris', params);

        expect(result.isValid).toBe(true);
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
          rebalanceThresholdUpper: expect.stringContaining('is required'),
          rebalanceThresholdLower: expect.stringContaining('is required'),
          feeReinvestment: expect.stringContaining('is required'),
          maxSlippage: expect.stringContaining('is required'),
          emergencyExitTrigger: expect.stringContaining('is required'),
          maxUtilization: expect.stringContaining('is required')
        });
      });

      it('should return errors for invalid numeric values', () => {
        const params = {
          targetRangeUpper: 'invalid', // Should be number
          targetRangeLower: 5.0,
          rebalanceThresholdUpper: 1.5,
          rebalanceThresholdLower: 1.5,
          feeReinvestment: true,
          reinvestmentTrigger: 50,
          reinvestmentRatio: 80,
          maxSlippage: 0.5,
          emergencyExitTrigger: 15,
          maxUtilization: 80
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(false);
        expect(result.errors.targetRangeUpper).toContain('must be a number');
      });

      it('should return errors for out-of-range numeric values', () => {
        const params = {
          targetRangeUpper: 25.0, // Max is 20.0
          targetRangeLower: 0.05, // Min is 0.1
          rebalanceThresholdUpper: 1.5,
          rebalanceThresholdLower: 1.5,
          feeReinvestment: true,
          reinvestmentTrigger: 50,
          reinvestmentRatio: 80,
          maxSlippage: 0.5,
          emergencyExitTrigger: 15,
          maxUtilization: 80
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(false);
        expect(result.errors.targetRangeUpper).toContain('must be at most 20%');
        expect(result.errors.targetRangeLower).toContain('must be at least 0.1%');
      });

      it('should return errors for invalid select values', () => {
        const params = {
          targetRangeUpper: 5.0,
          targetRangeLower: 5.0,
          rebalanceThresholdUpper: 1.5,
          rebalanceThresholdLower: 1.5,
          maxVaultUtilization: 80,
          adaptiveRanges: false,
          maxSlippage: 0.5,
          emergencyExitTrigger: 15,
          oracleSource: "invalid", // Invalid select option
          priceDeviationTolerance: 1.0,
          maxPositionSizePercent: 30,
          minPositionSize: 100,
          targetUtilization: 20,
          feeReinvestment: true,
          reinvestmentTrigger: 50,
          reinvestmentRatio: 80,
          platformSelectionCriteria: "999", // Invalid select option
          minPoolLiquidity: 100000
        };

        const result = validateStrategyParams('parris', params);

        expect(result.isValid).toBe(false);
        expect(result.errors.oracleSource).toContain('must be one of the provided options');
        expect(result.errors.platformSelectionCriteria).toContain('must be one of the provided options');
      });

      it('should validate conditional parameters when condition is met but values are invalid', () => {
        const params = {
          targetRangeUpper: 5.0,
          targetRangeLower: 5.0,
          rebalanceThresholdUpper: 1.5,
          rebalanceThresholdLower: 1.5,
          feeReinvestment: true, // Condition met
          reinvestmentTrigger: 2000, // Out of range (max 1000)
          reinvestmentRatio: 150, // Out of range (max 100)
          maxSlippage: 0.5,
          emergencyExitTrigger: 15,
          maxUtilization: 80
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(false);
        expect(result.errors.reinvestmentTrigger).toContain('must be at most 1000');
        expect(result.errors.reinvestmentRatio).toContain('must be at most 100%');
      });

      it('should handle null, undefined, and empty string values as required errors', () => {
        const params = {
          targetRangeUpper: null,
          targetRangeLower: undefined,
          rebalanceThresholdUpper: "",
          rebalanceThresholdLower: 1.5,
          feeReinvestment: true,
          reinvestmentTrigger: 50,
          reinvestmentRatio: 80,
          maxSlippage: 0.5,
          emergencyExitTrigger: 15,
          maxUtilization: 80
        };

        const result = validateStrategyParams('bob', params);

        expect(result.isValid).toBe(false);
        expect(result.errors.targetRangeUpper).toContain('is required');
        expect(result.errors.targetRangeLower).toContain('is required');
        expect(result.errors.rebalanceThresholdUpper).toContain('is required');
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

      it('should return setter methods for parris strategy contract groups', () => {
        expect(getParameterSetterMethod('parris', 'range')).toBe('setRangeParameters');
        expect(getParameterSetterMethod('parris', 'fee')).toBe('setFeeParameters');
        expect(getParameterSetterMethod('parris', 'risk')).toBe('setRiskParameters');
        expect(getParameterSetterMethod('parris', 'adaptive')).toBe('setAdaptiveParameters');
        expect(getParameterSetterMethod('parris', 'oracle')).toBe('setOracleParameters');
        expect(getParameterSetterMethod('parris', 'positionSizing')).toBe('setPositionSizingParameters');
        expect(getParameterSetterMethod('parris', 'platform')).toBe('setPlatformParameters');
      });

      it('should return setter methods for fed strategy contract groups', () => {
        expect(getParameterSetterMethod('fed', 'range')).toBe('setRangeParameters');
        expect(getParameterSetterMethod('fed', 'fee')).toBe('setFeeParameters');
        expect(getParameterSetterMethod('fed', 'risk')).toBe('setRiskParameters');
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
        expect(tokens).toHaveProperty('WETH');
        expect(tokens).toHaveProperty('USDC');
      });

      it('should return stablecoin tokens for strategy with tokenSupport "stablecoins"', () => {
        const tokens = getStrategyTokens('fed');

        expect(tokens).toBeDefined();
        expect(typeof tokens).toBe('object');
        expect(Array.isArray(tokens)).toBe(false);
        expect(Object.keys(tokens).length).toBeGreaterThan(0);

        // Should include stablecoins
        expect(tokens).toHaveProperty('USDC');

        // Should not include non-stablecoins like WETH (if it exists in all tokens)
        const allTokens = getAllTokens();
        if (allTokens.WETH && !tokens.WETH) {
          // This confirms stablecoins are a subset
          expect(Object.keys(tokens).length).toBeLessThan(Object.keys(allTokens).length);
        }
      });

      it('should work for all available strategies', () => {
        const strategies = ['none', 'bob', 'parris', 'fed'];

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
        const customTokens = { WETH: { name: 'Wrapped Ether' }, USDC: { name: 'USD Coin' } };
        strategies.bob = { ...originalBob, tokenSupport: 'custom', supportedTokens: customTokens };

        const result = getStrategyTokens('bob');
        expect(result).toEqual(customTokens);

        strategies.bob = originalBob;
      });
    });

    describe('Backward Compatibility', () => {
      it('should handle strategies with supportedTokens but no tokenSupport', () => {
        const originalBob = strategies.bob;
        const legacyTokens = { WETH: { name: 'Wrapped Ether' } };
        strategies.bob = { ...originalBob, tokenSupport: undefined, supportedTokens: legacyTokens };

        const result = getStrategyTokens('bob');
        expect(result).toEqual(legacyTokens);

        strategies.bob = originalBob;
      });
    });
  });

  describe('strategySupportsTokens', () => {
    describe('Success Cases', () => {
      it('should return true when all tokens are supported', () => {
        // Bob strategy supports all tokens
        const result = strategySupportsTokens('bob', ['WETH', 'USDC']);
        expect(result).toBe(true);
      });

      it('should return true for single supported token', () => {
        const result = strategySupportsTokens('bob', ['WETH']);
        expect(result).toBe(true);
      });

      it('should return true for empty token array', () => {
        // every() returns true for empty arrays
        const result = strategySupportsTokens('bob', []);
        expect(result).toBe(true);
      });

      it('should work with multiple supported tokens', () => {
        const result = strategySupportsTokens('bob', ['WETH', 'USDC', 'USDC', 'WBTC']);
        expect(result).toBe(true);
      });

      it('should work with parris strategy that supports all tokens', () => {
        const result = strategySupportsTokens('parris', ['WETH', 'USDC', 'LINK']);
        expect(result).toBe(true);
      });

      it('should work with fed strategy limited token support', () => {
        // Fed strategy only supports stablecoins
        const stablecoinResult = strategySupportsTokens('fed', ['USDC', 'USDC']);
        expect(stablecoinResult).toBe(true);

        // Should return false for non-stablecoins
        const nonStablecoinResult = strategySupportsTokens('fed', ['WETH', 'WBTC']);
        expect(nonStablecoinResult).toBe(false);
      });

      it('should work with none strategy', () => {
        const result = strategySupportsTokens('none', ['WETH', 'USDC']);
        expect(result).toBe(true);
      });

      it('should handle case-sensitive token symbols', () => {
        // Should work with correct case
        expect(strategySupportsTokens('bob', ['WETH'])).toBe(true);

        // Should not work with incorrect case
        expect(strategySupportsTokens('bob', ['eth'])).toBe(false);
        expect(strategySupportsTokens('bob', ['Eth'])).toBe(false);
      });

      it('should check that ALL tokens are supported', () => {
        // Mix of supported and unsupported tokens should return false
        const result = strategySupportsTokens('fed', ['USDC', 'WETH']); // USDC supported, ETH not supported by fed
        expect(result).toBe(false);
      });
    });

    describe('Failure Cases', () => {
      it('should return false for non-existent strategy', () => {
        const result = strategySupportsTokens('nonExistentStrategy', ['WETH']);
        expect(result).toBe(false);
      });

      it('should return false when strategy has invalid tokenSupport', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, tokenSupport: 'invalid' };

        const result = strategySupportsTokens('bob', ['WETH']);
        expect(result).toBe(false);

        strategies.bob = originalBob;
      });

      it('should return false when strategy has missing tokenSupport', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, tokenSupport: undefined };

        const result = strategySupportsTokens('bob', ['WETH']);
        expect(result).toBe(false);

        strategies.bob = originalBob;
      });

      it('should return false when some tokens are not supported', () => {
        // Fed strategy doesn't support ETH
        const result = strategySupportsTokens('fed', ['WETH']);
        expect(result).toBe(false);
      });

      it('should return false when any token in array is not supported', () => {
        // Fed strategy supports USDC but not ETH
        const result = strategySupportsTokens('fed', ['USDC', 'WETH']);
        expect(result).toBe(false);
      });

      it('should return false for completely unsupported tokens', () => {
        const result = strategySupportsTokens('fed', ['INVALID_TOKEN', 'ANOTHER_INVALID']);
        expect(result).toBe(false);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null strategyId', () => {
        expect(() => strategySupportsTokens(null, ['WETH'])).toThrow('ID parameter is required');
      });

      it('should throw error for undefined strategyId', () => {
        expect(() => strategySupportsTokens(undefined, ['WETH'])).toThrow('ID parameter is required');
      });

      it('should throw error for non-string strategyId', () => {
        expect(() => strategySupportsTokens(123, ['WETH'])).toThrow('ID must be a string');
        expect(() => strategySupportsTokens({}, ['WETH'])).toThrow('ID must be a string');
      });

      it('should throw error for empty strategyId', () => {
        expect(() => strategySupportsTokens('', ['WETH'])).toThrow('ID cannot be empty');
      });

      it('should handle null tokenSymbols gracefully', () => {
        // Should throw when trying to call every() on null
        expect(() => strategySupportsTokens('bob', null)).toThrow();
      });

      it('should handle undefined tokenSymbols gracefully', () => {
        // Should throw when trying to call every() on undefined
        expect(() => strategySupportsTokens('bob', undefined)).toThrow();
      });

      it('should handle non-array tokenSymbols gracefully', () => {
        // Should throw when trying to call every() on non-array
        expect(() => strategySupportsTokens('bob', 'WETH')).toThrow();
        expect(() => strategySupportsTokens('bob', {})).toThrow();
        expect(() => strategySupportsTokens('bob', 123)).toThrow();
      });

      it('should handle array with non-string token symbols', () => {
        // Should not throw, but likely return false since includes() will do strict comparison
        expect(strategySupportsTokens('bob', [null, undefined, 123])).toBe(false);
        expect(strategySupportsTokens('bob', [{}])).toBe(false);
      });
    });

    describe('Real-world Usage Scenarios', () => {
      it('should work for common DeFi token pairs', () => {
        // ETH/USDC pair
        expect(strategySupportsTokens('bob', ['WETH', 'USDC'])).toBe(true);
        expect(strategySupportsTokens('parris', ['WETH', 'USDC'])).toBe(true);
        expect(strategySupportsTokens('fed', ['WETH', 'USDC'])).toBe(false); // Fed doesn't support ETH

        // Stablecoin pairs
        expect(strategySupportsTokens('fed', ['USDC', 'USDC'])).toBe(true);
        expect(strategySupportsTokens('bob', ['USDC', 'USDC'])).toBe(true);
      });

      it('should handle large token lists', () => {
        const manyTokens = ['WETH', 'USDC', 'USDC', 'WBTC', 'LINK'];

        expect(strategySupportsTokens('bob', manyTokens)).toBe(true);
        expect(strategySupportsTokens('parris', manyTokens)).toBe(true);
        expect(strategySupportsTokens('fed', manyTokens)).toBe(false); // Fed doesn't support non-stablecoins
      });

      it('should be useful for filtering compatible strategies', () => {
        const selectedTokens = ['WETH', 'USDC'];

        // Filter strategies that support the selected tokens
        const compatibleStrategies = ['bob', 'parris', 'fed', 'none'].filter(strategyId =>
          strategySupportsTokens(strategyId, selectedTokens)
        );

        // Fed should be filtered out because it doesn't support ETH
        expect(compatibleStrategies).toEqual(['bob', 'parris', 'none']);
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

      it('should format parris strategy oracleSource parameter', () => {
        const conditionalParam = {
          type: 'select',
          options: [
            { value: '0', label: 'DEX Price' },
            { value: '1', label: 'Chainlink' },
            { value: '2', label: 'Time-Weighted Average Price' }
          ]
        };
        expect(formatParameterValue('1', conditionalParam)).toBe('Chainlink');
      });

      it('should format parris strategy adaptiveTimeframeHigh parameter', () => {
        const conditionalParam = { type: 'number', suffix: ' days' };
        expect(formatParameterValue(7, conditionalParam)).toBe('7 days');
      });
    });
  });

  describe('validateTokensForStrategy', () => {
    describe('Success Cases (No Messages)', () => {
      it('should return empty array when all vault tokens are in strategy', () => {
        const vaultTokens = { WETH: 1.5, USDC: 1000 };
        const strategyTokens = ['WETH', 'USDC', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual([]);
      });

      it('should return empty array when vault tokens are empty', () => {
        const vaultTokens = {};
        const strategyTokens = ['WETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual([]);
      });

      it('should return empty array when vault tokens is null', () => {
        const strategyTokens = ['WETH', 'USDC'];

        const result = validateTokensForStrategy(null, strategyTokens);
        expect(result).toEqual([]);
      });

      it('should return empty array when vault tokens is undefined', () => {
        const strategyTokens = ['WETH', 'USDC'];

        const result = validateTokensForStrategy(undefined, strategyTokens);
        expect(result).toEqual([]);
      });

      it('should return empty array when strategy tokens is null', () => {
        const vaultTokens = { WETH: 1.5 };

        const result = validateTokensForStrategy(vaultTokens, null);
        expect(result).toEqual([]);
      });

      it('should return empty array when strategy tokens is undefined', () => {
        const vaultTokens = { WETH: 1.5 };

        const result = validateTokensForStrategy(vaultTokens, undefined);
        expect(result).toEqual([]);
      });

      it('should return empty array when strategy tokens is empty array', () => {
        const vaultTokens = { WETH: 1.5, USDC: 1000 };
        const strategyTokens = [];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual([]);
      });

      it('should return empty array when exact token match', () => {
        const vaultTokens = { WETH: 1.5, USDC: 1000 };
        const strategyTokens = ['WETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual([]);
      });

      it('should return empty array when vault has subset of strategy tokens', () => {
        const vaultTokens = { WETH: 1.5 };
        const strategyTokens = ['WETH', 'USDC', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual([]);
      });
    });

    describe('Message Cases (Returns Messages)', () => {
      it('should return message when some vault tokens are not in strategy', () => {
        const vaultTokens = { WETH: 1.5, USDC: 1000, LINK: 500 };
        const strategyTokens = ['WETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('The following tokens in your vault are not part of your strategy: LINK');
        expect(result[0]).toContain('These tokens will be swapped into the selected strategy tokens');
      });

      it('should return message when all vault tokens are not in strategy', () => {
        const vaultTokens = { WBTC: 0.5, LINK: 100 };
        const strategyTokens = ['WETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('The following tokens in your vault are not part of your strategy: WBTC, LINK');
      });

      it('should return message with multiple unmatched tokens', () => {
        const vaultTokens = { WETH: 1.5, WBTC: 0.5, LINK: 100, UNI: 50 };
        const strategyTokens = ['WETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('WBTC, LINK, UNI');
      });

      it('should handle single unmatched token', () => {
        const vaultTokens = { WETH: 1.5, USDC: 1000, WBTC: 0.5 };
        const strategyTokens = ['WETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('WBTC');
        expect(result[0]).not.toContain(','); // No comma when single token
      });

      it('should be case-sensitive', () => {
        const vaultTokens = { eth: 1.5, USDC: 1000 }; // lowercase eth
        const strategyTokens = ['WETH', 'USDC']; // uppercase ETH

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('eth'); // lowercase eth is unmatched
      });
    });

    describe('Edge Cases and Input Types', () => {
      it('should handle vault tokens with zero balances', () => {
        const vaultTokens = { WETH: 0, USDC: 1000, LINK: 0 };
        const strategyTokens = ['WETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('LINK');
      });

      it('should handle vault tokens with negative balances', () => {
        const vaultTokens = { WETH: -1, USDC: 1000 };
        const strategyTokens = ['USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('WETH');
      });

      it('should handle vault tokens with string balances', () => {
        const vaultTokens = { WETH: '1.5', USDC: '1000' };
        const strategyTokens = ['WETH'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('USDC');
      });

      it('should handle non-array strategy tokens gracefully', () => {
        const vaultTokens = { WETH: 1.5 };
        const strategyTokens = 'not-an-array';

        // Should handle non-array gracefully without throwing
        expect(() => validateTokensForStrategy(vaultTokens, strategyTokens)).not.toThrow();
        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('WETH');
      });

      it('should handle empty vault tokens object', () => {
        const vaultTokens = {};
        const strategyTokens = ['WETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual([]);
      });

      it('should handle vault tokens with complex token names', () => {
        const vaultTokens = { 'WETH-9': 1.5, 'USDC.e': 1000 };
        const strategyTokens = ['WETH-9'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('USDC.e');
      });
    });

    describe('Real-world Usage Scenarios', () => {
      it('should handle typical DeFi vault scenario', () => {
        const vaultTokens = {
          WETH: 2.5,
          USDC: 5000,
          LINK: 1000,
          WBTC: 0.1
        };
        const strategyTokens = ['WETH', 'USDC']; // Strategy only supports ETH/USDC pair

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('LINK, WBTC');
        expect(result[0]).toContain('swapped into the selected strategy tokens');
      });

      it('should handle stablecoin-only strategy', () => {
        const vaultTokens = { USDC: 1000, WBTC: 0.5, WETH: 1.5 };
        const strategyTokens = ['USDC', 'USDC']; // Stablecoin strategy

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('WETH');
      });

      it('should handle vault with tokens strategy does not support', () => {
        const vaultTokens = { SHIB: 1000000, DOGE: 500 };
        const strategyTokens = ['WETH', 'USDC', 'WBTC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('SHIB, DOGE');
      });

      it('should handle perfect vault-strategy alignment', () => {
        const vaultTokens = { WETH: 1.5, USDC: 3000 };
        const strategyTokens = ['WETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);
        expect(result).toEqual([]);
      });

      it('should be useful for warning users about token swaps', () => {
        const vaultTokens = { WETH: 1, USDC: 1000, LINK: 500, WBTC: 0.1 };
        const strategyTokens = ['WETH', 'USDC'];

        const result = validateTokensForStrategy(vaultTokens, strategyTokens);

        // Should return exactly one warning message
        expect(result).toHaveLength(1);

        // Message should inform about tokens that will be swapped
        const message = result[0];
        expect(message).toContain('LINK, WBTC');
        expect(message).toContain('will be swapped');

        // Should not mention tokens that are already supported
        expect(message).not.toContain('WETH');
        expect(message).not.toContain('USDC');
      });
    });
  });

  describe('mapStrategyParameters', () => {
    describe('Success Cases', () => {
      describe('Bob Strategy', () => {
        it('should map Bob strategy parameters correctly', () => {
          const rawParams = [10200, 9800, 200, 200, true, 10000, 8000, 50, 100, 9500];
          const result = mapStrategyParameters('bob', rawParams);

          expect(result).toEqual({
            targetRangeUpper: 102,
            targetRangeLower: 98,
            rebalanceThresholdUpper: 2,
            rebalanceThresholdLower: 2,
            feeReinvestment: true,
            reinvestmentTrigger: '100.0',
            reinvestmentRatio: 80,
            maxSlippage: 0.5,
            emergencyExitTrigger: 1,
            maxUtilization: 95
          });
        });

        it('should handle Bob strategy with false boolean parameter', () => {
          const rawParams = [10200, 9800, 200, 200, false, 10000, 8000, 50, 100, 9500];
          const result = mapStrategyParameters('bob', rawParams);

          expect(result.feeReinvestment).toBe(false);
        });

        it('should convert basis points to percentages correctly for Bob', () => {
          const rawParams = [11000, 9000, 300, 150, true, 10000, 8000, 75, 200, 8500];
          const result = mapStrategyParameters('bob', rawParams);

          expect(result.targetRangeUpper).toBe(110);
          expect(result.targetRangeLower).toBe(90);
          expect(result.rebalanceThresholdUpper).toBe(3);
          expect(result.rebalanceThresholdLower).toBe(1.5);
        });
      });

      describe('Parris Strategy', () => {
        it('should map Parris strategy parameters correctly', () => {
          const rawParams = [
            10200, 9800, 200, 200, true, 10000, 8000, 50, 100, 9500,
            false, 10, 5, 3600, 1800, 500, 300, 200, 100, 0,
            1000, 2000, 5000000000000000000n, 8500, 1, 100000000000000000000n
          ];
          const result = mapStrategyParameters('parris', rawParams);

          expect(result.targetRangeUpper).toBe(102);
          expect(result.adaptiveRanges).toBe(false);
          expect(result.rebalanceCountThresholdHigh).toBe(10);
          expect(result.oracleSource).toBe(0);
          expect(result.maxPositionSizePercent).toBe(20);
        });

        it('should handle Parris strategy with adaptive ranges enabled', () => {
          const rawParams = [
            10200, 9800, 200, 200, true, 10000, 8000, 50, 100, 9500,
            true, 10, 5, 3600, 1800, 500, 300, 200, 100, 0,
            1000, 2000, 5000000000000000000n, 8500, 1, 100000000000000000000n
          ];
          const result = mapStrategyParameters('parris', rawParams);

          expect(result.adaptiveRanges).toBe(true);
        });
      });

      describe('Fed Strategy', () => {
        it('should map Fed strategy parameters correctly', () => {
          const rawParams = [500, 200, true, 100];
          const result = mapStrategyParameters('fed', rawParams);

          expect(result).toEqual({
            targetRange: 5,
            rebalanceThreshold: 2,
            feeReinvestment: true,
            maxSlippage: 1
          });
        });

        it('should handle Fed strategy with false boolean parameter', () => {
          const rawParams = [500, 200, false, 100];
          const result = mapStrategyParameters('fed', rawParams);

          expect(result.feeReinvestment).toBe(false);
        });
      });

    });

    describe('Error Cases', () => {
      describe('Parameter Validation', () => {
        it('should throw error for invalid strategyId types', () => {
          const validParams = [10200, 9800, 200, 200, true, 10000, 8000, 50, 100, 9500];

          expect(() => mapStrategyParameters(null, validParams)).toThrow('ID parameter is required');
          expect(() => mapStrategyParameters(undefined, validParams)).toThrow('ID parameter is required');
          expect(() => mapStrategyParameters(123, validParams)).toThrow('ID must be a string');
          expect(() => mapStrategyParameters('', validParams)).toThrow('ID cannot be empty');
        });

        it('should throw error for non-array params', () => {
          expect(() => mapStrategyParameters('bob', null)).toThrow('Parameters must be an array');
          expect(() => mapStrategyParameters('bob', undefined)).toThrow('Parameters must be an array');
          expect(() => mapStrategyParameters('bob', 'not-array')).toThrow('Parameters must be an array');
          expect(() => mapStrategyParameters('bob', 123)).toThrow('Parameters must be an array');
          expect(() => mapStrategyParameters('bob', {})).toThrow('Parameters must be an array');
        });

        it('should throw error for empty params array', () => {
          expect(() => mapStrategyParameters('bob', [])).toThrow('Parameters array cannot be empty');
        });

        it('should throw error for unknown strategy', () => {
          const validParams = [10200, 9800, 200, 200, true, 10000, 8000, 50, 100, 9500];
          expect(() => mapStrategyParameters('unknown', validParams)).toThrow('Strategy unknown not found');
        });

        it('should throw error for unsupported strategy', () => {
          const validParams = [10200, 9800, 200, 200, true, 10000, 8000, 50, 100, 9500];
          expect(() => mapStrategyParameters('none', validParams)).toThrow('No parameter mapping defined for strategy none');
        });

        it('should throw error for case-sensitive strategy IDs', () => {
          const rawParams = [10200, 9800, 200, 200, true, 10000, 8000, 50, 100, 9500];
          expect(() => mapStrategyParameters('BOB', rawParams)).toThrow('Strategy BOB not found');
          expect(() => mapStrategyParameters('Bob', rawParams)).toThrow('Strategy Bob not found');
          expect(() => mapStrategyParameters('bOb', rawParams)).toThrow('Strategy bOb not found');
        });
      });

      describe('Bob Strategy Parameter Count Validation', () => {
        it('should throw error for wrong number of Bob parameters', () => {
          expect(() => mapStrategyParameters('bob', [1, 2, 3])).toThrow('Bob strategy expects 10 parameters, got 3');
          expect(() => mapStrategyParameters('bob', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toThrow('Bob strategy expects 10 parameters, got 11');
        });
      });

      describe('Bob Strategy Type Validation', () => {
        it('should throw error for invalid Bob parameter types', () => {
          // Invalid boolean parameter (index 4)
          expect(() => mapStrategyParameters('bob', [10200, 9800, 200, 200, 'not-boolean', 10000, 8000, 50, 100, 9500]))
            .toThrow('Bob strategy parameter 4 (feeReinvestment) must be boolean, got string');

          // Invalid numeric parameters
          expect(() => mapStrategyParameters('bob', ['not-number', 9800, 200, 200, true, 10000, 8000, 50, 100, 9500]))
            .toThrow('Bob strategy parameter 0 must be a valid number, got not-number');

          expect(() => mapStrategyParameters('bob', [10200, null, 200, 200, true, 10000, 8000, 50, 100, 9500]))
            .toThrow('Bob strategy parameter 1 must be a valid number, got null');

          expect(() => mapStrategyParameters('bob', [10200, 9800, Infinity, 200, true, 10000, 8000, 50, 100, 9500]))
            .toThrow('Bob strategy parameter 2 must be a valid number, got Infinity');

          expect(() => mapStrategyParameters('bob', [10200, 9800, 200, NaN, true, 10000, 8000, 50, 100, 9500]))
            .toThrow('Bob strategy parameter 3 must be a valid number, got NaN');
        });
      });

      describe('Parris Strategy Parameter Count Validation', () => {
        it('should throw error for wrong number of Parris parameters', () => {
          expect(() => mapStrategyParameters('parris', [1, 2, 3])).toThrow('Parris strategy expects 26 parameters, got 3');

          const shortParams = new Array(25).fill(0);
          shortParams[4] = false; // boolean parameter
          shortParams[10] = true; // boolean parameter
          expect(() => mapStrategyParameters('parris', shortParams)).toThrow('Parris strategy expects 26 parameters, got 25');
        });
      });

      describe('Parris Strategy Type Validation', () => {
        it('should throw error for invalid Parris boolean parameters', () => {
          const params = new Array(26).fill(100);

          // Invalid feeReinvestment (index 4)
          params[4] = 'not-boolean';
          params[10] = true;
          expect(() => mapStrategyParameters('parris', params))
            .toThrow('Parris strategy parameter 4 must be boolean, got string');

          // Invalid adaptiveRanges (index 10)
          params[4] = false;
          params[10] = 'not-boolean';
          expect(() => mapStrategyParameters('parris', params))
            .toThrow('Parris strategy parameter 10 must be boolean, got string');
        });

        it('should throw error for invalid Parris numeric parameters', () => {
          const params = new Array(26).fill(100);
          params[4] = true;
          params[10] = false;

          // Invalid numeric parameter
          params[15] = 'not-number';
          expect(() => mapStrategyParameters('parris', params))
            .toThrow('Parris strategy parameter 15 must be a valid number, got not-number');

          params[15] = null;
          expect(() => mapStrategyParameters('parris', params))
            .toThrow('Parris strategy parameter 15 must be a valid number, got null');
        });
      });

      describe('Fed Strategy Parameter Count Validation', () => {
        it('should throw error for wrong number of Fed parameters', () => {
          expect(() => mapStrategyParameters('fed', [1, 2])).toThrow('Fed strategy expects 4 parameters, got 2');
          expect(() => mapStrategyParameters('fed', [1, 2, true, 4, 5])).toThrow('Fed strategy expects 4 parameters, got 5');
        });
      });

      describe('Fed Strategy Type Validation', () => {
        it('should throw error for invalid Fed parameter types', () => {
          // Invalid boolean parameter (index 2)
          expect(() => mapStrategyParameters('fed', [500, 200, 'not-boolean', 100]))
            .toThrow('Fed strategy parameter 2 (feeReinvestment) must be boolean, got string');

          // Invalid numeric parameters
          expect(() => mapStrategyParameters('fed', ['not-number', 200, true, 100]))
            .toThrow('Fed strategy parameter 0 must be a valid number, got not-number');

          expect(() => mapStrategyParameters('fed', [500, Infinity, true, 100]))
            .toThrow('Fed strategy parameter 1 must be a valid number, got Infinity');

          expect(() => mapStrategyParameters('fed', [500, 200, true, null]))
            .toThrow('Fed strategy parameter 3 must be a valid number, got null');
        });
      });
    });
  });
});
