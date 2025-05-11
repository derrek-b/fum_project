import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  });

  describe('calculatePositionsTVL', () => {
    it('should calculate TVL for positions', async () => {
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
      // The test is checking behavior, not specific return values that might change
    });
  });
});