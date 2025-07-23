/**
 * Strategy Helpers Unit Tests
 *
 * Tests for strategy configuration utilities and validation functions
 */

import { describe, it, expect } from 'vitest';
import {
  validateStrategyId,
  validateTemplateEnumMap,
  lookupAvailableStrategies,
  getStrategyDetails,
  getStrategyTemplates,
  getStrategyParameters,
  validateBooleanParameter,
  validatePercentParameter,
  validateNumberParameter,
  validateFiatCurrencyParameter,
  validateSelectParameter,
  validateTokenDepositsParameter,
  validateTemplateConfiguration,
  validateParameterGroups,
  validateContractParametersGroups
} from '../../../src/helpers/strategyHelpers.js';
import strategies from '../../../src/configs/strategies.js';



describe('Strategy Configuration Validation', () => {
  it('should have all required properties for every strategy', () => {
    const requiredStringProperties = [
      'id', 'name', 'subtitle', 'description', 'icon', 'color', 'borderColor', 'textColor'
    ];

    const requiredNumberProperties = [
      'minTokens', 'maxTokens', 'minPlatforms', 'maxPlatforms', 'minPositions', 'maxPositions'
    ];

    const requiredObjectProperties = [
      'supportedTokens', 'parameters', 'templates', 'parameterGroups', 'contractParametersGroups'
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

      // Validate supportedTokens structure (should have token symbol keys)
      if (strategy.supportedTokens && typeof strategy.supportedTokens === 'object') {
        const tokenKeys = Object.keys(strategy.supportedTokens);
        if (tokenKeys.length === 0) {
          strategyErrors.push('supportedTokens should not be empty');
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
        validateContractParametersGroups(strategyId, strategy.contractParametersGroups, strategy.parameters);
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
});

describe('Strategy Helpers', () => {
  describe('validateStrategyId', () => {
    describe('Success Cases', () => {
      it('should accept valid strategy strings', () => {
        expect(() => validateStrategyId('bob')).not.toThrow();
        expect(() => validateStrategyId('parris')).not.toThrow();
        expect(() => validateStrategyId('fed')).not.toThrow();
        expect(() => validateStrategyId('none')).not.toThrow();
        expect(() => validateStrategyId('unknownStrategy')).not.toThrow();
      });

      it('should accept single character strings', () => {
        expect(() => validateStrategyId('a')).not.toThrow();
        expect(() => validateStrategyId('1')).not.toThrow();
      });

      it('should accept strings with special characters', () => {
        expect(() => validateStrategyId('strategy-v2')).not.toThrow();
        expect(() => validateStrategyId('strategy_test')).not.toThrow();
        expect(() => validateStrategyId('strategy.test')).not.toThrow();
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null strategyId', () => {
        expect(() => validateStrategyId(null)).toThrow('strategyId parameter is required');
      });

      it('should throw error for undefined strategyId', () => {
        expect(() => validateStrategyId(undefined)).toThrow('strategyId parameter is required');
      });

      it('should throw error for number strategyId', () => {
        expect(() => validateStrategyId(1)).toThrow('strategyId must be a string');
        expect(() => validateStrategyId(123)).toThrow('strategyId must be a string');
        expect(() => validateStrategyId(0)).toThrow('strategyId must be a string');
      });

      it('should throw error for boolean strategyId', () => {
        expect(() => validateStrategyId(true)).toThrow('strategyId must be a string');
        expect(() => validateStrategyId(false)).toThrow('strategyId must be a string');
      });

      it('should throw error for array strategyId', () => {
        expect(() => validateStrategyId(['bob'])).toThrow('strategyId must be a string');
        expect(() => validateStrategyId([])).toThrow('strategyId must be a string');
      });

      it('should throw error for object strategyId', () => {
        expect(() => validateStrategyId({ strategy: 'bob' })).toThrow('strategyId must be a string');
        expect(() => validateStrategyId({})).toThrow('strategyId must be a string');
      });

      it('should throw error for empty string strategyId', () => {
        expect(() => validateStrategyId('')).toThrow('strategyId cannot be empty');
      });

      it('should throw error for special values', () => {
        expect(() => validateStrategyId(NaN)).toThrow('strategyId must be a string');
        expect(() => validateStrategyId(Infinity)).toThrow('strategyId must be a string');
        expect(() => validateStrategyId(-Infinity)).toThrow('strategyId must be a string');
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

      it('should throw error for missing object property', () => {
        const originalBob = strategies.bob;
        strategies.bob = { ...originalBob, supportedTokens: undefined };

        expect(() => getStrategyDetails('bob')).toThrow('Strategy bob missing or invalid property: supportedTokens');

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
        expect(result.length).toBeGreaterThan(0);

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
});
