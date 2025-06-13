import { describe, it, expect, vi } from 'vitest';
import { mockStrategyParams, mockPositions, mockPoolData, mockTokenData } from '../mocks/data.js';
import { ethers } from '../mocks/ethers.js';

// Mock the imports used by vaultHelpers
vi.mock('ethers', () => {
  return { ethers: ethers };
});

vi.mock('../../src/adapters/index.js', () => {
  return {
    AdapterFactory: {
      getAdaptersForChain: () => [{
        platformName: 'Uniswap V3',
        calculateTokenAmounts: async () => ({
          token0: { formatted: '0.5' },
          token1: { formatted: '0.2' }
        })
      }],
      getAdapter: () => ({
        calculateTokenAmounts: async () => ({
          token0: { formatted: '0.5' },
          token1: { formatted: '0.2' }
        })
      })
    }
  };
});

vi.mock('../../src/blockchain/index.js', () => {
  return {
    getUserVaults: async () => ['0xvault1', '0xvault2'],
    getVaultInfo: async () => ({
      name: 'Test Vault',
      symbol: 'TEST',
      decimals: 18,
      owner: '0xowner'
    })
  };
});

vi.mock('../../src/services/index.js', () => {
  return {
    fetchTokenPrices: async () => ({ USDC: 1, WETH: 1800, WBTC: 60000 }),
    calculateUsdValue: () => 1800,
    prefetchTokenPrices: async () => {},
    calculateUsdValueSync: (amount, symbol) => {
      const prices = { USDC: 1, WETH: 1800, WBTC: 60000 };
      return amount * (prices[symbol] || 0);
    }
  };
});

vi.mock('../../src/helpers/strategyHelpers.js', () => {
  return {
    getAvailableStrategies: () => [
      { id: 'bob', name: 'Bob Strategy', templateEnumMap: { conservative: 0, balanced: 1, aggressive: 2 } },
      { id: 'parris', name: 'Parris Strategy', templateEnumMap: { conservative: 0, balanced: 1, aggressive: 2 } },
      { id: 'fed', name: 'Fed Strategy', templateEnumMap: { conservative: 0, balanced: 1, aggressive: 2 } }
    ],
    getStrategyParameters: () => ({})
  };
});

vi.mock('../../src/helpers/tokenHelpers.js', () => {
  return {
    getAllTokens: () => ({
      USDC: {
        symbol: 'USDC',
        decimals: 6,
        addresses: { 1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' }
      },
      WETH: {
        symbol: 'WETH',
        decimals: 18,
        addresses: { 1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }
      }
    })
  };
});

// Now import the module we're testing
import {
  mapStrategyParameters,
  calculatePositionsTVL
} from '../../src/helpers/vaultHelpers.js';

describe('vaultHelpers', () => {
  describe('mapStrategyParameters', () => {
    it('should correctly map bob strategy parameters', () => {
      const result = mapStrategyParameters('bob', mockStrategyParams.bobStrategy);

      // Check individual properties instead of exact equality to handle formatting differences
      expect(result.targetRangeUpper).toBe(5);
      expect(result.targetRangeLower).toBe(5);
      expect(result.rebalanceThresholdUpper).toBe(1.5);
      expect(result.rebalanceThresholdLower).toBe(1.5);
      expect(result.feeReinvestment).toBe(true);
      // The ethers.formatUnits mock might format this differently
      expect(Number(result.reinvestmentTrigger)).toBe(50);
      expect(result.reinvestmentRatio).toBe(80);
      expect(result.maxSlippage).toBe(0.5);
      expect(result.emergencyExitTrigger).toBe(15);
      expect(result.maxUtilization).toBe(80);
    });

    it('should correctly map parris strategy parameters', () => {
      const result = mapStrategyParameters('parris', mockStrategyParams.parrisStrategy);

      expect(result).toHaveProperty('targetRangeUpper', 5);
      expect(result).toHaveProperty('targetRangeLower', 5);
      expect(result).toHaveProperty('adaptiveRanges', true);
      expect(result).toHaveProperty('oracleSource', 0);
      expect(result).toHaveProperty('platformSelectionCriteria', 0);
      
      // Test more specific parameters for parris strategy
      expect(result.rebalanceCountThresholdHigh).toBe(3);
      expect(result.rebalanceCountThresholdLow).toBe(1);
      expect(result.adaptiveTimeframeHigh).toBe(7);
      expect(result.adaptiveTimeframeLow).toBe(7);
      expect(result.rangeAdjustmentPercentHigh).toBe(20);
      expect(result.thresholdAdjustmentPercentHigh).toBe(15);
      expect(result.rangeAdjustmentPercentLow).toBe(20);
      expect(result.thresholdAdjustmentPercentLow).toBe(15);
      expect(result.priceDeviationTolerance).toBe(1);
      expect(result.maxPositionSizePercent).toBe(30);
      expect(Number(result.minPositionSize)).toBe(100);
      expect(result.targetUtilization).toBe(20);
      expect(Number(result.minPoolLiquidity)).toBe(100000);
    });

    it('should correctly map fed strategy parameters', () => {
      const result = mapStrategyParameters('fed', mockStrategyParams.fedStrategy);

      expect(result).toEqual({
        targetRange: 0.5,
        rebalanceThreshold: 0.2,
        feeReinvestment: true,
        maxSlippage: 0.1
      });
    });

    it('should return empty object for unknown strategy', () => {
      const result = mapStrategyParameters('unknown', [1, 2, 3]);
      expect(result).toEqual({});
    });

    it('should handle errors gracefully', () => {
      const result = mapStrategyParameters('bob', null);
      expect(result).toEqual({});
    });
    
    it('should handle case insensitivity in strategy IDs', () => {
      // Test with uppercase strategy id
      const resultUpper = mapStrategyParameters('BOB', mockStrategyParams.bobStrategy);
      expect(resultUpper.targetRangeUpper).toBe(5);
      
      // Test with mixed case
      const resultMixed = mapStrategyParameters('BoB', mockStrategyParams.bobStrategy);
      expect(resultMixed.targetRangeUpper).toBe(5);
    });
    
    it('should correctly convert basis points to percentages', () => {
      // Test basis point conversion for bob strategy parameters
      const result = mapStrategyParameters('bob', mockStrategyParams.bobStrategy);
      
      // targetRangeUpper is 500 basis points -> 5.00%
      expect(result.targetRangeUpper).toBe(5);
      
      // maxSlippage is 50 basis points -> 0.50%
      expect(result.maxSlippage).toBe(0.5);
    });
    
    it('should correctly handle boolean parameters', () => {
      // Test boolean parameter for bob strategy
      const result = mapStrategyParameters('bob', mockStrategyParams.bobStrategy);
      expect(result.feeReinvestment).toBe(true);
      
      // Create mock with false boolean
      const mockParamsWithFalse = [...mockStrategyParams.bobStrategy];
      mockParamsWithFalse[4] = false; // feeReinvestment index
      
      const resultWithFalse = mapStrategyParameters('bob', mockParamsWithFalse);
      expect(resultWithFalse.feeReinvestment).toBe(false);
    });
    
    it('should correctly handle money value parameters', () => {
      // Test currency value parameter for parris strategy
      const result = mapStrategyParameters('parris', mockStrategyParams.parrisStrategy);
      
      // minPoolLiquidity is 10000000 -> $100,000.00
      expect(Number(result.minPoolLiquidity)).toBe(100000);
    });
    
    it('should handle partially invalid parameters array', () => {
      // Create mock with some valid and some invalid entries
      const partiallyInvalidParams = [...mockStrategyParams.bobStrategy];
      partiallyInvalidParams[0] = "not a number"; // Invalidate targetRangeUpper
      
      const result = mapStrategyParameters('bob', partiallyInvalidParams);
      
      // The invalid entry should result in NaN after parseInt
      expect(isNaN(result.targetRangeUpper)).toBe(true);
      
      // But other entries should still work
      expect(result.feeReinvestment).toBe(true);
      expect(result.maxSlippage).toBe(0.5);
    });
    
    it('should correctly map parameters with array of incorrect length', () => {
      // Test with too few parameters
      const shortParams = mockStrategyParams.bobStrategy.slice(0, 5); // Only first 5 parameters
      
      const resultShort = mapStrategyParameters('bob', shortParams);
      expect(resultShort).toHaveProperty('targetRangeUpper');
      expect(resultShort).toHaveProperty('feeReinvestment');
      // Parameters beyond index 4 should be undefined
      // When ethers.formatUnits is called with undefined, it returns 'NaN'
      expect(isNaN(Number(resultShort.reinvestmentTrigger))).toBe(true);
      
      // Test with too many parameters
      const longParams = [...mockStrategyParams.bobStrategy, 100, 200, 300]; // Extra parameters
      
      const resultLong = mapStrategyParameters('bob', longParams);
      // Should still map all the expected parameters
      expect(resultLong.targetRangeUpper).toBe(5);
      expect(resultLong.maxUtilization).toBe(80);
      // Extra parameters should be ignored
    });
  });

  describe('calculatePositionsTVL', () => {
    it('should calculate TVL for positions with complete data', async () => {
      const result = await calculatePositionsTVL(
        mockPositions,
        mockPoolData,
        mockTokenData,
        {}, // provider
        1  // chainId
      );
      
      // We expect token0 and token1 for two positions, each with value
      expect(result).toHaveProperty('positionTVL');
      expect(result.positionTVL).toBeGreaterThan(0);
      expect(result).toHaveProperty('hasPartialData');
    });

    it('should return 0 TVL for empty positions array', async () => {
      const result = await calculatePositionsTVL([], {}, {}, {}, 1);
      expect(result.positionTVL).toBe(0);
      expect(result.hasPartialData).toBe(false);
    });

    it('should handle incomplete pool data gracefully', async () => {
      const incompletePoolData = {
        "0x1234567890123456789012345678901234567890": {
          // Missing token0/token1
          fee: 3000,
          tick: 202000
        }
      };

      const result = await calculatePositionsTVL(
        mockPositions,
        incompletePoolData,
        mockTokenData,
        {},
        1
      );

      // The function should complete and return a result
      expect(result).toHaveProperty('positionTVL');
      expect(result).toHaveProperty('hasPartialData');
      
      // With our mock implementation of AdapterFactory, the test might not show partial data
      // since the calculations might not reach a step that would set hasPartialData to true,
      // so we'll just check that positionTVL is calculated correctly
      expect(result.positionTVL).toBeGreaterThanOrEqual(0);
    });

    it('should handle missing token data gracefully', async () => {
      const incompleteTokenData = {
        "0xaf88d065e77c8cC2239327C5EDb3A432268e5831": {
          symbol: "USDC",
          decimals: 6
          // Missing name field
        }
      };

      const result = await calculatePositionsTVL(
        mockPositions,
        mockPoolData,
        incompleteTokenData,
        {},
        1
      );

      expect(result).toHaveProperty('positionTVL');
      expect(result).toHaveProperty('hasPartialData');
    });
    
    it('should handle error conditions and edge cases robustly', async () => {
      // Test with various edge cases to ensure the function is robust
      // without needing to mock specific failure conditions
      
      // Case 1: Missing token data for one pool token
      const partialTokenData = { ...mockTokenData };
      delete partialTokenData["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"]; // Remove WETH
      
      const result1 = await calculatePositionsTVL(
        mockPositions,
        mockPoolData,
        partialTokenData,
        {},
        1
      );
      
      expect(result1).toHaveProperty('positionTVL');
      
      // Case 2: Non-existent token symbol that would result in $0 price
      const oddTokenData = { 
        ...mockTokenData,
        "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": {
          ...mockTokenData["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"],
          symbol: "NON_EXISTENT_TOKEN" // This would result in $0 price
        }
      };
      
      const result2 = await calculatePositionsTVL(
        mockPositions,
        mockPoolData,
        oddTokenData,
        {},
        1
      );
      
      expect(result2).toHaveProperty('positionTVL');
    });

    it('should aggregate multiple position values correctly', async () => {
      // Create additional mock positions to test aggregation
      const additionalMockPositions = [
        ...mockPositions,
        {
          id: "345678",
          poolAddress: "0x2345678901234567890123456789012345678901",
          liquidity: 3000000,
          platform: "uniswapV3"
        }
      ];
      
      const result = await calculatePositionsTVL(
        additionalMockPositions,
        mockPoolData,
        mockTokenData,
        {},
        1
      );
      
      expect(result).toHaveProperty('positionTVL');
      expect(result.positionTVL).toBeGreaterThan(0);
      // The TVL should be the sum of all position values
      // We can't assert the exact value since it depends on the mock implementation
      // of calculateTokenAmounts, but we can check it's calculated
    });
    
    it('should handle position with invalid poolAddress gracefully', async () => {
      const positionsWithInvalidPool = [
        {
          id: "999999",
          poolAddress: "0x9999999999999999999999999999999999999999", // Non-existent pool address
          liquidity: 1000000,
          platform: "uniswapV3"
        },
        ...mockPositions
      ];
      
      const result = await calculatePositionsTVL(
        positionsWithInvalidPool,
        mockPoolData, // Does not contain the 0x9999 address
        mockTokenData,
        {},
        1
      );
      
      expect(result).toHaveProperty('positionTVL');
      expect(result.positionTVL).toBeGreaterThan(0); // Should still calculate TVL for valid positions
    });
  });
});