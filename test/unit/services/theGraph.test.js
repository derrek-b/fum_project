/**
 * The Graph Service Unit Tests
 *
 * Tests using real The Graph API - requires THEGRAPH_API_KEY in .env.test
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { getPoolTVLAverage, getPoolAge, discoverV4Pools, getV4PositionsByOwner, configureTheGraph } from '../../../src/services/theGraph.js';

describe('The Graph Service - Real API Tests', () => {
  // Configure API key at the start
  beforeAll(() => {
    const apiKey = process.env.THEGRAPH_API_KEY;
    if (apiKey) {
      configureTheGraph({ apiKey });
    }
  });

  // Real test parameters using actual platform config
  const validParams = {
    poolAddress: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640', // USDC/WETH 0.05% pool on Ethereum
    chainId: 1,
    platformId: 'uniswapV3',
    days: 7
  };

  describe('getPoolTVLAverage', () => {
    describe('Success Cases', () => {
      it('should fetch USDC/WETH pool TVL on Ethereum mainnet with Uniswap V3 schema', async () => {
        const result = await getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.days
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
          validParams.days
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
          3
        );

        const result7Days = await getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          7
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
          3 // Shorter period for faster test
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
          validParams.days
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolTVLAverage(
          undefined,
          validParams.chainId,
          validParams.platformId,
          validParams.days
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolTVLAverage(
          '',
          validParams.chainId,
          validParams.platformId,
          validParams.days
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolTVLAverage(
          123,
          validParams.chainId,
          validParams.platformId,
          validParams.days
        )).rejects.toThrow('poolAddress must be a non-empty string');
      });

      // chainId parameter validation
      it('should throw error for invalid chainId values', async () => {
        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          0,
          validParams.platformId,
          validParams.days
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          -1,
          validParams.platformId,
          validParams.days
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          1.5,
          validParams.platformId,
          validParams.days
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          null,
          validParams.platformId,
          validParams.days
        )).rejects.toThrow('chainId must be a positive integer');
      });

      // platformId parameter validation
      it('should throw error for invalid platformId values', async () => {
        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          null,
          validParams.days
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          undefined,
          validParams.days
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          '',
          validParams.days
        )).rejects.toThrow('platformId must be a non-empty string');
      });

      // days parameter validation
      it('should throw error for invalid days values', async () => {
        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          0
        )).rejects.toThrow('days must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          -1
        )).rejects.toThrow('days must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          1.5
        )).rejects.toThrow('days must be a positive integer');

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          null
        )).rejects.toThrow('days must be a positive integer');
      });
    });

    describe('Configuration Errors', () => {
      it('should throw error for unsupported platform', async () => {
        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          'unknownPlatform',
          validParams.days
        )).rejects.toThrow('Platform unknownPlatform is not supported');
      });

      it('should throw error when subgraph not configured for chain', async () => {
        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          999999, // Non-existent chain
          validParams.platformId,
          validParams.days
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
          validParams.days
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
          validParams.days
        )).rejects.toThrow('The Graph query error: Field "pool" argument "id" of type "ID!" is required');
      });

      it('should throw error for network failures', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(getPoolTVLAverage(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId,
          validParams.days
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
          validParams.days
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
          7
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
          validParams.platformId
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
          validParams.platformId
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
          validParams.platformId
        );

        const result2 = await getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId
        );

        expect(result1).toBe(result2); // Pool creation timestamp should never change
      });
    });

    describe('Error Cases', () => {
      // poolAddress parameter validation
      it('should throw error for invalid poolAddress values', async () => {
        await expect(getPoolAge(
          null,
          validParams.chainId,
          validParams.platformId
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolAge(
          undefined,
          validParams.chainId,
          validParams.platformId
        )).rejects.toThrow('poolAddress must be a non-empty string');

        await expect(getPoolAge(
          '',
          validParams.chainId,
          validParams.platformId
        )).rejects.toThrow('poolAddress must be a non-empty string');
      });

      // chainId parameter validation
      it('should throw error for invalid chainId values', async () => {
        await expect(getPoolAge(
          validParams.poolAddress,
          0,
          validParams.platformId
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolAge(
          validParams.poolAddress,
          -1,
          validParams.platformId
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getPoolAge(
          validParams.poolAddress,
          null,
          validParams.platformId
        )).rejects.toThrow('chainId must be a positive integer');
      });

      // platformId parameter validation
      it('should throw error for invalid platformId values', async () => {
        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          null
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          undefined
        )).rejects.toThrow('platformId must be a non-empty string');

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          ''
        )).rejects.toThrow('platformId must be a non-empty string');
      });
    });

    describe('Configuration Errors', () => {
      it('should throw error for unsupported platform', async () => {
        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          'unknownPlatform'
        )).rejects.toThrow('Platform unknownPlatform is not supported');
      });

      it('should throw error when subgraph not configured for chain', async () => {
        await expect(getPoolAge(
          validParams.poolAddress,
          999999, // Non-existent chain
          validParams.platformId
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
          validParams.platformId
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
          validParams.platformId
        )).rejects.toThrow('The Graph query error: Field "pool" argument "id" of type "ID!" is required');
      });

      it('should throw error for network failures', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(getPoolAge(
          validParams.poolAddress,
          validParams.chainId,
          validParams.platformId
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
          validParams.platformId
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

        // Test with Arbitrum to get Messari schema
        await expect(getPoolAge(
          validParams.poolAddress,
          42161,
          validParams.platformId
        )).rejects.toThrow(`Pool ${validParams.poolAddress} not found`);
      });

      it('should throw error when creation timestamp is missing', async () => {
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
          validParams.platformId
        )).rejects.toThrow(`No creation timestamp available for pool ${validParams.poolAddress}`);
      });
    });
  });

  describe('discoverV4Pools', () => {
    // V4 test parameters using Arbitrum (chainId 42161)
    // Token addresses must be sorted: token0 < token1
    const v4Params = {
      token0: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', // WETH (lower address)
      token1: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC (higher address)
      chainId: 42161
    };

    describe('Success Cases', () => {
      it('should discover V4 pools for WETH/USDC pair on Arbitrum', async () => {
        const result = await discoverV4Pools(
          v4Params.token0,
          v4Params.token1,
          v4Params.chainId
        );

        expect(Array.isArray(result)).toBe(true);
        // V4 is newer, pools may or may not exist - just verify structure
        if (result.length > 0) {
          const pool = result[0];
          expect(pool).toHaveProperty('id');
          expect(pool).toHaveProperty('token0');
          expect(pool).toHaveProperty('token1');
          expect(pool).toHaveProperty('feeTier');
          expect(pool).toHaveProperty('tickSpacing');
          expect(pool).toHaveProperty('liquidity');
          expect(pool).toHaveProperty('hooks');
          // Verify hooks is zero address (vanilla pools only)
          expect(pool.hooks).toBe('0x0000000000000000000000000000000000000000');
        }
      });

      it('should return empty array when no pools exist for token pair', async () => {
        // Use made-up token addresses that definitely don't have V4 pools
        const fakeToken0 = '0x0000000000000000000000000000000000000001';
        const fakeToken1 = '0x0000000000000000000000000000000000000002';

        const result = await discoverV4Pools(
          fakeToken0,
          fakeToken1,
          v4Params.chainId
        );

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      });

      it('should respect the limit option', async () => {
        const result = await discoverV4Pools(
          v4Params.token0,
          v4Params.token1,
          v4Params.chainId,
          { limit: 1 }
        );

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeLessThanOrEqual(1);
      });

      it('should return pools sorted by liquidity (highest first)', async () => {
        const result = await discoverV4Pools(
          v4Params.token0,
          v4Params.token1,
          v4Params.chainId,
          { limit: 10 }
        );

        expect(Array.isArray(result)).toBe(true);
        if (result.length > 1) {
          for (let i = 0; i < result.length - 1; i++) {
            const currentLiquidity = BigInt(result[i].liquidity);
            const nextLiquidity = BigInt(result[i + 1].liquidity);
            expect(currentLiquidity >= nextLiquidity).toBe(true);
          }
        }
      });
    });

    describe('Error Cases', () => {
      // token0Address parameter validation
      it('should throw error for invalid token0Address values', async () => {
        await expect(discoverV4Pools(
          null,
          v4Params.token1,
          v4Params.chainId
        )).rejects.toThrow('token0Address must be a non-empty string');

        await expect(discoverV4Pools(
          undefined,
          v4Params.token1,
          v4Params.chainId
        )).rejects.toThrow('token0Address must be a non-empty string');

        await expect(discoverV4Pools(
          '',
          v4Params.token1,
          v4Params.chainId
        )).rejects.toThrow('token0Address must be a non-empty string');
      });

      // token1Address parameter validation
      it('should throw error for invalid token1Address values', async () => {
        await expect(discoverV4Pools(
          v4Params.token0,
          null,
          v4Params.chainId
        )).rejects.toThrow('token1Address must be a non-empty string');

        await expect(discoverV4Pools(
          v4Params.token0,
          undefined,
          v4Params.chainId
        )).rejects.toThrow('token1Address must be a non-empty string');

        await expect(discoverV4Pools(
          v4Params.token0,
          '',
          v4Params.chainId
        )).rejects.toThrow('token1Address must be a non-empty string');
      });

      // chainId parameter validation
      it('should throw error for invalid chainId values', async () => {
        await expect(discoverV4Pools(
          v4Params.token0,
          v4Params.token1,
          0
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(discoverV4Pools(
          v4Params.token0,
          v4Params.token1,
          -1
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(discoverV4Pools(
          v4Params.token0,
          v4Params.token1,
          null
        )).rejects.toThrow('chainId must be a positive integer');
      });
    });

    describe('Configuration Errors', () => {
      it('should throw error when V4 subgraph not configured for chain', async () => {
        await expect(discoverV4Pools(
          v4Params.token0,
          v4Params.token1,
          999999 // Non-existent chain
        )).rejects.toThrow('No V4 subgraph configured for chain 999999');
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
          status: 500,
          statusText: 'Internal Server Error'
        });

        await expect(discoverV4Pools(
          v4Params.token0,
          v4Params.token1,
          v4Params.chainId
        )).rejects.toThrow('The Graph API request failed: 500 Internal Server Error');
      });

      it('should throw error for GraphQL query errors', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            errors: [
              { message: 'Invalid query syntax' }
            ]
          })
        });

        await expect(discoverV4Pools(
          v4Params.token0,
          v4Params.token1,
          v4Params.chainId
        )).rejects.toThrow('The Graph query error: Invalid query syntax');
      });

      it('should throw error for network failures', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(discoverV4Pools(
          v4Params.token0,
          v4Params.token1,
          v4Params.chainId
        )).rejects.toThrow('The Graph service error: Network error');
      });

      it('should return empty array when pools is null', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: {
              pools: null
            }
          })
        });

        const result = await discoverV4Pools(
          v4Params.token0,
          v4Params.token1,
          v4Params.chainId
        );

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      });
    });
  });

  describe('getV4PositionsByOwner', () => {
    // V4 test parameters using Arbitrum (chainId 42161)
    const v4Params = {
      // Use a known address that likely has V4 positions
      ownerAddress: '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Universal Router (example)
      chainId: 42161
    };

    describe('Success Cases', () => {
      it('should return array of tokenIds for owner address', async () => {
        const result = await getV4PositionsByOwner(
          v4Params.ownerAddress,
          v4Params.chainId
        );

        expect(Array.isArray(result)).toBe(true);
        // Result may be empty if address has no positions - that's valid
        if (result.length > 0) {
          // Verify each item is a string (tokenId)
          result.forEach(tokenId => {
            expect(typeof tokenId).toBe('string');
            // tokenId should be numeric string
            expect(/^\d+$/.test(tokenId)).toBe(true);
          });
        }
      });

      it('should return empty array when owner has no positions', async () => {
        // Use an address that definitely has no V4 positions
        const emptyOwner = '0x0000000000000000000000000000000000000001';

        const result = await getV4PositionsByOwner(
          emptyOwner,
          v4Params.chainId
        );

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      });

      it('should respect the limit option', async () => {
        const result = await getV4PositionsByOwner(
          v4Params.ownerAddress,
          v4Params.chainId,
          { limit: 1 }
        );

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeLessThanOrEqual(1);
      });

      it('should normalize owner address to lowercase', async () => {
        // Use checksummed address with mixed case
        const checksummedAddress = '0x3fC91A3afd70395Cd496C647d5a6cC9D4B2b7FAD';

        const result = await getV4PositionsByOwner(
          checksummedAddress,
          v4Params.chainId
        );

        // Should not throw - lowercase normalization should handle this
        expect(Array.isArray(result)).toBe(true);
      });
    });

    describe('Error Cases', () => {
      // ownerAddress parameter validation
      it('should throw error for invalid ownerAddress values', async () => {
        await expect(getV4PositionsByOwner(
          null,
          v4Params.chainId
        )).rejects.toThrow('ownerAddress must be a non-empty string');

        await expect(getV4PositionsByOwner(
          undefined,
          v4Params.chainId
        )).rejects.toThrow('ownerAddress must be a non-empty string');

        await expect(getV4PositionsByOwner(
          '',
          v4Params.chainId
        )).rejects.toThrow('ownerAddress must be a non-empty string');
      });

      // chainId parameter validation
      it('should throw error for invalid chainId values', async () => {
        await expect(getV4PositionsByOwner(
          v4Params.ownerAddress,
          0
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getV4PositionsByOwner(
          v4Params.ownerAddress,
          -1
        )).rejects.toThrow('chainId must be a positive integer');

        await expect(getV4PositionsByOwner(
          v4Params.ownerAddress,
          null
        )).rejects.toThrow('chainId must be a positive integer');
      });

      // Unsupported chain
      it('should throw error for unsupported chain', async () => {
        await expect(getV4PositionsByOwner(
          v4Params.ownerAddress,
          999999 // Non-existent chain
        )).rejects.toThrow('No V4 subgraph configured for chain 999999');
      });
    });

    describe('Fetch Error Handling (mocked)', () => {
      let originalFetch;

      beforeEach(() => {
        originalFetch = global.fetch;
      });

      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('should handle network errors gracefully', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(getV4PositionsByOwner(
          v4Params.ownerAddress,
          v4Params.chainId
        )).rejects.toThrow('The Graph service error: Network error');
      });

      it('should return empty array when positions is null', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: {
              positions: null
            }
          })
        });

        const result = await getV4PositionsByOwner(
          v4Params.ownerAddress,
          v4Params.chainId
        );

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      });

      it('should handle GraphQL errors', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            errors: [{ message: 'Invalid query' }]
          })
        });

        await expect(getV4PositionsByOwner(
          v4Params.ownerAddress,
          v4Params.chainId
        )).rejects.toThrow('The Graph query error: Invalid query');
      });
    });
  });

});
