/**
 * The Graph Service Unit Tests
 *
 * Tests using real The Graph API - requires THEGRAPH_API_KEY in .env.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPoolTVLAverage, getPoolAge } from '../../../src/services/theGraph.js';

describe('The Graph Service - Real API Tests', () => {
  // Real test parameters using actual platform config
  const validParams = {
    poolAddress: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640', // USDC/WETH 0.05% pool on Ethereum
    chainId: 1,
    platformId: 'uniswapV3',
    days: 7,
    apiKey: process.env.THEGRAPH_API_KEY || 'missing-api-key'
  };

  describe('getPoolTVLAverage', () => {
    describe('Success Cases', () => {
      it('should fetch USDC/WETH pool TVL on Ethereum mainnet with Uniswap V3 schema', async () => {
        const result = await getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        );

        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThan(100000);
        expect(Number.isFinite(result)).toBe(true);
      });

      it('should fetch WETH/USDC pool TVL on Arbitrum with Messari schema', async () => {
        const arbitrumPoolAddress = '0xc31e54c7a869b9fcbecc14363cf510d1c41fa443'; // WETH/USDC on Arbitrum

        const result = await getPoolTVLAverage(
          arbitrumPoolAddress,
          42161, // Arbitrum One (uses Messari schema)
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        );

        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThan(100000);
        expect(Number.isFinite(result)).toBe(true);
      });

      it('should handle different day periods for historical data', async () => {
        const result3Days = await getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          3,
          validParams.apiKey
        );

        const result7Days = await getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          7,
          validParams.apiKey
        );

        expect(typeof result3Days).toBe('number');
        expect(typeof result7Days).toBe('number');
        expect(result3Days).toBeGreaterThan(100000);
        expect(result7Days).toBeGreaterThan(100000);
      });

      it('should handle different pool addresses on same chain', async () => {
        // Test different pool on Ethereum mainnet
        const wbtcEthPool = '0xcbcdf9626bc03e24f779434178a73a0b4bad62ed'; // WBTC/WETH pool
        
        const result = await getPoolTVLAverage(
          wbtcEthPool,
          validParams.chainId,
          validParams.platformId,
          3, // Shorter period for faster test
          validParams.apiKey
        );

        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThan(0);
        expect(Number.isFinite(result)).toBe(true);
      });

    });

    describe('Error Cases', () => {
      // poolAddress parameter validation
      it('should throw error for invalid poolAddress values', async () => {
        await expect(getPoolTVLAverage(
          null,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolTVLAverage(
          undefined,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolTVLAverage(
          '',
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolTVLAverage(
          123,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolTVLAverage(
          {},
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolTVLAverage(
          [],
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('poolAddress must be a non-empty string');
      });

      // chainId parameter validation
      it('should throw error for invalid chainId values', async () => {
        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          0,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          -1,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          1.5,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          null,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          undefined,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          'Claude is awesome',
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          {},
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          [],
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');
      });

      // platformId parameter validation
      it('should throw error for invalid platformId values', async () => {
        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          null,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          undefined,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          '',
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          123,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          {},
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          [],
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('platformId must be a non-empty string');
      });

      // days parameter validation
      it('should throw error for invalid days values', async () => {
        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          0,
          validParams.apiKey
        )).rejects.toThrow('days must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          -1,
          validParams.apiKey
        )).rejects.toThrow('days must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          1.5,
          validParams.apiKey
        )).rejects.toThrow('days must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          null,
          validParams.apiKey
        )).rejects.toThrow('days must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          undefined,
          validParams.apiKey
        )).rejects.toThrow('days must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          'Claude is awesome',
          validParams.apiKey
        )).rejects.toThrow('days must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          {},
          validParams.apiKey
        )).rejects.toThrow('days must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          [],
          validParams.apiKey
        )).rejects.toThrow('days must be a positive integer');
      });

      // apiKey parameter validation
      it('should throw error for invalid apiKey values', async () => {
        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          null
        )).rejects.toThrow('apiKey must be a non-empty string');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          undefined
        )).rejects.toThrow('apiKey must be a non-empty string');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          ''
        )).rejects.toThrow('apiKey must be a non-empty string');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          123
        )).rejects.toThrow('apiKey must be a non-empty string');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          {}
        )).rejects.toThrow('apiKey must be a non-empty string');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          []
        )).rejects.toThrow('apiKey must be a non-empty string');
      });
    });

    describe('Configuration Errors', () => {
      it('should throw error for unsupported platform', async () => {
        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          'unknownPlatform',
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('Platform unknownPlatform is not supported');
      });

      it('should throw error when subgraph not configured for chain', async () => {
        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          999999, // Non-existent chain
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('No subgraph configured for platform uniswapV3 on chain 999999');
      });
    });


    describe('Network and API Errors (Mocked)', () => {
      let originalFetch;

      beforeEach(() => {
        originalFetch = global.fetch;
      });

      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('should throw error for HTTP error responses', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found'
        });

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('The Graph API request failed: 404 Not Found');
      });

      it('should throw error for GraphQL query errors', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            errors: [
              { message: 'Field "pool" argument "id" of type "ID!" is required' }
            ]
          })
        });

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('The Graph query error: Field "pool" argument "id" of type "ID!" is required');
      });

      it('should throw error for network failures', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('The Graph service error: Network error');
      });

      it('should throw error when no historical data returned', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: {
              poolDayDatas: []
            }
          })
        });

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.days,
          validParams.apiKey
        )).rejects.toThrow('No historical data available for pool');
      });

      it('should throw error when incomplete historical data returned', async () => {
        const incompleteData = [
          { date: '1640995200', tvlUSD: '1000000' },
          { date: '1641081600', tvlUSD: '1100000' },
          { date: '1641168000', tvlUSD: '1200000' }
          // Only 3 days instead of 7
        ];

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: {
              poolDayDatas: incompleteData
            }
          })
        });

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          7,
          validParams.apiKey
        )).rejects.toThrow('Incomplete data: requested 7 days, got 3 valid days');
      });
    });
  });

  describe('getPoolAge', () => {
    describe('Success Cases', () => {
      it('should fetch USDC/WETH pool creation timestamp on Ethereum mainnet with Uniswap V3 schema', async () => {
        const result = await getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        );

        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThan(1620000000); // After May 2021 (Uniswap V3 launch)
        expect(result).toBeLessThan(Math.floor(Date.now() / 1000)); // Before now
        expect(Number.isInteger(result)).toBe(true);
      });

      it('should fetch WETH/USDC pool creation timestamp on Arbitrum with Messari schema', async () => {
        const arbitrumPoolAddress = '0xc31e54c7a869b9fcbecc14363cf510d1c41fa443'; // WETH/USDC on Arbitrum

        const result = await getPoolAge(
          arbitrumPoolAddress,
          42161, // Arbitrum One (uses Messari schema)
          validParams.platformId,
          validParams.apiKey
        );

        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThan(1620000000); // After May 2021
        expect(result).toBeLessThan(Math.floor(Date.now() / 1000)); // Before now
        expect(Number.isInteger(result)).toBe(true);
      });

      it('should return consistent timestamp for same pool across multiple calls', async () => {
        const result1 = await getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        );

        const result2 = await getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        );

        expect(result1).toBe(result2); // Pool creation timestamp should never change
      });

      it('should handle different pool addresses on same chain', async () => {
        // Test different pool on Ethereum mainnet
        const wbtcEthPool = '0xcbcdf9626bc03e24f779434178a73a0b4bad62ed'; // WBTC/WETH pool
        
        const result = await getPoolAge(
          wbtcEthPool,
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        );

        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThan(1620000000);
        expect(result).toBeLessThan(Math.floor(Date.now() / 1000));
        expect(Number.isInteger(result)).toBe(true);
      });
    });

    describe('Error Cases', () => {
      // poolAddress parameter validation
      it('should throw error for invalid poolAddress values', async () => {
        await expect(getPoolAge(
          null,
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolAge(
          undefined,
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolAge(
          '',
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolAge(
          123,
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolAge(
          {},
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolAge(
          [],
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('poolAddress must be a non-empty string');
      });

      // chainId parameter validation
      it('should throw error for invalid chainId values', async () => {
        await expect(getPoolAge(
          validParams.poolAddress,
          0,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolAge(
          validParams.poolAddress,
          -1,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolAge(
          validParams.poolAddress,
          1.5,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolAge(
          validParams.poolAddress,
          null,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolAge(
          validParams.poolAddress,
          undefined,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolAge(
          validParams.poolAddress,
          'not-a-number',
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolAge(
          validParams.poolAddress,
          {},
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolAge(
          validParams.poolAddress,
          [],
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('chainId must be a positive integer');
      });

      // platformId parameter validation
      it('should throw error for invalid platformId values', async () => {
        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          null,
          validParams.apiKey
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          undefined,
          validParams.apiKey
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          '',
          validParams.apiKey
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          123,
          validParams.apiKey
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          {},
          validParams.apiKey
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          [],
          validParams.apiKey
        )).rejects.toThrow('platformId must be a non-empty string');
      });

      // apiKey parameter validation
      it('should throw error for invalid apiKey values', async () => {
        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          null
        )).rejects.toThrow('apiKey must be a non-empty string');

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          undefined
        )).rejects.toThrow('apiKey must be a non-empty string');

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          ''
        )).rejects.toThrow('apiKey must be a non-empty string');

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          123
        )).rejects.toThrow('apiKey must be a non-empty string');

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          {}
        )).rejects.toThrow('apiKey must be a non-empty string');

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          []
        )).rejects.toThrow('apiKey must be a non-empty string');
      });
    });

    describe('Configuration Errors', () => {
      it('should throw error for unsupported platform', async () => {
        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          'unknownPlatform',
          validParams.apiKey
        )).rejects.toThrow('Platform unknownPlatform is not supported');
      });

      it('should throw error when subgraph not configured for chain', async () => {
        await expect(getPoolAge(
          validParams.poolAddress,
          999999, // Non-existent chain
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('No subgraph configured for platform uniswapV3 on chain 999999');
      });
    });

    describe('Network and API Errors (Mocked)', () => {
      let originalFetch;

      beforeEach(() => {
        originalFetch = global.fetch;
      });

      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('should throw error for HTTP error responses', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found'
        });

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('The Graph API request failed: 404 Not Found');
      });

      it('should throw error for GraphQL query errors', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            errors: [
              { message: 'Field "pool" argument "id" of type "ID!" is required' }
            ]
          })
        });

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('The Graph query error: Field "pool" argument "id" of type "ID!" is required');
      });

      it('should throw error for network failures', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow('The Graph service error: Network error');
      });

      it('should throw error when pool not found (Uniswap schema)', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: {
              pool: null
            }
          })
        });

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow(`Pool ${validParams.poolAddress} not found`);
      });

      it('should throw error when pool not found (Messari schema)', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: {
              liquidityPool: null
            }
          })
        });

        // Mock the platform metadata to return Messari queryType
        const mockPlatform = {
          subgraphs: {
            42161: {
              id: 'test-id',
              queryType: 'messari'
            }
          }
        };

        // We need to test with Arbitrum to get Messari schema
        await expect(getPoolAge(
          validParams.poolAddress,
          42161,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow(`Pool ${validParams.poolAddress} not found`);
      });

      it('should throw error when creation timestamp is missing (Uniswap schema)', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: {
              pool: {
                createdAtTimestamp: null
              }
            }
          })
        });

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow(`No creation timestamp available for pool ${validParams.poolAddress}`);
      });

      it('should throw error when creation timestamp is missing (Uniswap schema)', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: {
              pool: {
                createdAtTimestamp: null
              }
            }
          })
        });

        // Test with Arbitrum (uses Uniswap schema)
        await expect(getPoolAge(
          validParams.poolAddress,
          42161,
          validParams.platformId,
          validParams.apiKey
        )).rejects.toThrow(`No creation timestamp available for pool ${validParams.poolAddress}`);
      });
    });
  });
});
