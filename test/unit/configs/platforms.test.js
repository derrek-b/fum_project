/**
 * Platform Configuration Validation Tests
 *
 * Tests to validate the structure and integrity of platform configurations
 */

import { describe, it, expect } from 'vitest';
import platforms from '../../../src/configs/platforms.js';
import chains from '../../../src/configs/chains.js';

/**
 * Validate hex color format (#RRGGBB)
 * @param {string} color - Color to validate
 * @returns {boolean} Whether color is valid hex format
 */
function validateHexColor(color) {
  if (typeof color !== 'string') return false;
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

/**
 * Validate path format (basic path validation)
 * @param {string} path - Path to validate
 * @returns {boolean} Whether path is valid format
 */
function validatePath(path) {
  if (typeof path !== 'string') return false;
  // Basic path validation - should start with / and contain valid path characters
  return /^\/[a-zA-Z0-9_\-\/\.]+$/.test(path);
}

/**
 * Validate fee tiers array
 * @param {string} platformId - Platform ID for error reporting
 * @param {Array} feeTiers - Fee tiers array to validate
 * @throws {Error} If fee tiers are invalid
 */
function validateFeeTiers(platformId, feeTiers) {
  if (!Array.isArray(feeTiers)) {
    throw new Error(`Platform ${platformId} feeTiers must be an array`);
  }

  if (feeTiers.length === 0) {
    throw new Error(`Platform ${platformId} feeTiers must be a non-empty array`);
  }

  feeTiers.forEach((tier, index) => {
    if (!Number.isFinite(tier) || tier <= 0) {
      throw new Error(`Platform ${platformId} feeTiers[${index}] must be a finite number > 0, got: ${tier}`);
    }
  });
}

/**
 * Validate features object
 * @param {string} platformId - Platform ID for error reporting
 * @param {Object} features - Features object to validate
 * @throws {Error} If features are invalid
 */
function validateFeatures(platformId, features) {
  if (!features || typeof features !== 'object' || Array.isArray(features)) {
    throw new Error(`Platform ${platformId} features must be an object`);
  }

  // Validate that all feature values are booleans
  Object.entries(features).forEach(([featureName, featureValue]) => {
    if (typeof featureValue !== 'boolean') {
      throw new Error(`Platform ${platformId} features.${featureName} must be a boolean, got: ${typeof featureValue}`);
    }
  });
}

describe('Platform Configuration Validation', () => {
  it('should have all required properties for every platform', () => {
    const requiredStringProperties = ['id', 'name', 'logo', 'color', 'description'];
    const requiredObjectProperties = ['features'];
    const requiredArrayProperties = ['feeTiers'];

    const errors = [];

    Object.entries(platforms).forEach(([platformKey, platform]) => {
      const platformErrors = [];

      // Validate that platform key matches platform id
      if (platform.id !== platformKey) {
        platformErrors.push(`Platform key '${platformKey}' must match platform.id '${platform.id}'`);
      }

      // Validate required string properties
      requiredStringProperties.forEach(prop => {
        if (!platform[prop] || typeof platform[prop] !== 'string' || platform[prop].trim() === '') {
          platformErrors.push(`Missing or empty string property: ${prop}`);
        }
      });

      // Validate required object properties
      requiredObjectProperties.forEach(prop => {
        if (!platform[prop] || typeof platform[prop] !== 'object' || Array.isArray(platform[prop])) {
          platformErrors.push(`Missing or invalid object property: ${prop}`);
        }
      });

      // Validate required array properties
      requiredArrayProperties.forEach(prop => {
        if (!Array.isArray(platform[prop])) {
          platformErrors.push(`Property ${prop} must be an array`);
        }
      });

      // Validate specific format requirements
      if (platform.color && !validateHexColor(platform.color)) {
        platformErrors.push(`Property color must be a valid hex color (#RRGGBB), got: ${platform.color}`);
      }

      if (platform.logo && !validatePath(platform.logo)) {
        platformErrors.push(`Property logo must be a valid path format, got: ${platform.logo}`);
      }

      // Validate fee tiers structure
      try {
        validateFeeTiers(platformKey, platform.feeTiers);
      } catch (error) {
        platformErrors.push(`feeTiers validation failed: ${error.message}`);
      }

      // Validate features structure
      try {
        validateFeatures(platformKey, platform.features);
      } catch (error) {
        platformErrors.push(`features validation failed: ${error.message}`);
      }

      // If there are errors for this platform, add them to the main errors array
      if (platformErrors.length > 0) {
        errors.push(`Platform "${platformKey}" validation errors:`);
        platformErrors.forEach(error => errors.push(`  - ${error}`));
      }
    });

    // If there are any validation errors, fail the test with detailed information
    if (errors.length > 0) {
      const errorMessage = `Platform configuration validation failed:\n${errors.join('\n')}`;
      throw new Error(errorMessage);
    }

    // If we get here, all platforms are valid
    expect(errors).toHaveLength(0);
  });

  it('should be referenced by at least one chain (warning)', () => {
    const warnings = [];
    const referencedPlatforms = new Set();
    
    // Collect all platforms referenced by chains
    Object.entries(chains).forEach(([chainId, chain]) => {
      if (chain.platformAddresses && typeof chain.platformAddresses === 'object') {
        Object.keys(chain.platformAddresses).forEach(platformId => {
          referencedPlatforms.add(platformId);
        });
      }
    });
    
    // Check each platform is referenced
    Object.keys(platforms).forEach(platformId => {
      if (!referencedPlatforms.has(platformId)) {
        warnings.push(`Platform '${platformId}' is not referenced by any chain`);
      }
    });
    
    // This is a warning test - we log but don't fail
    if (warnings.length > 0) {
      console.warn(`Platform coverage warnings:\n${warnings.join('\n')}`);
    }
    
    // We expect this to pass even with warnings
    expect(true).toBe(true);
  });
});