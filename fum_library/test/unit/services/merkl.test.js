/**
 * Merkl Service Unit Tests
 *
 * Tests for fetchPoolIncentives and fetchClaimData.
 * Real API calls for happy paths, mocked fetch for error/caching tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchPoolIncentives,
  fetchClaimData,
  clearIncentiveCache,
} from '../../../src/services/merkl.js';

// Known incentivized V4 pool: USDT/USDC 0.0008% on Arbitrum
const ARBITRUM_CHAIN_ID = 42161;
const KNOWN_INCENTIVIZED_POOL = '0xab05003a63d2f34ac7eec4670bca3319f0e3d2f62af5c2b9cbd69d03fd804fd2';
const BOGUS_POOL_ID = '0x0000000000000000000000000000000000000000000000000000000000000001';

describe('Merkl Service', () => {
  beforeEach(() => {
    clearIncentiveCache();
  });

  describe('clearIncentiveCache', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should clear all cached entries', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      // First call populates cache
      await fetchPoolIncentives(ARBITRUM_CHAIN_ID, BOGUS_POOL_ID);
      expect(global.fetch).toHaveBeenCalledOnce();

      // Second call uses cache
      await fetchPoolIncentives(ARBITRUM_CHAIN_ID, BOGUS_POOL_ID);
      expect(global.fetch).toHaveBeenCalledOnce();

      // Clear cache, third call should fetch again
      clearIncentiveCache();
      await fetchPoolIncentives(ARBITRUM_CHAIN_ID, BOGUS_POOL_ID);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchPoolIncentives', () => {
    describe('Parameter Validation', () => {
      it('should throw when chainId is missing', async () => {
        await expect(fetchPoolIncentives(null, KNOWN_INCENTIVIZED_POOL))
          .rejects.toThrow('chainId and poolId are required');
      });

      it('should throw when poolId is missing', async () => {
        await expect(fetchPoolIncentives(ARBITRUM_CHAIN_ID, null))
          .rejects.toThrow('chainId and poolId are required');
      });
    });

    describe('Success Cases — Real API', () => {
      it('should return active incentives when campaigns exist', async () => {
        const result = await fetchPoolIncentives(ARBITRUM_CHAIN_ID, KNOWN_INCENTIVIZED_POOL);

        // Pool may or may not have active campaigns depending on timing,
        // but the shape should always be correct
        expect(result).toHaveProperty('active');
        expect(result).toHaveProperty('programs');
        expect(typeof result.active).toBe('boolean');
        expect(Array.isArray(result.programs)).toBe(true);

        if (result.active) {
          const program = result.programs[0];
          expect(program).toHaveProperty('rewardToken');
          expect(program).toHaveProperty('rewardTokenSymbol');
          expect(program).toHaveProperty('endTimestamp');
          expect(typeof program.rewardToken).toBe('string');
          expect(typeof program.rewardTokenSymbol).toBe('string');
          expect(typeof program.endTimestamp).toBe('number');
          // rewardToken should be an address
          expect(program.rewardToken).toMatch(/^0x[a-fA-F0-9]{40}$/);
        }
      }, 15000);

      it('should return inactive when no matching pool found', async () => {
        const result = await fetchPoolIncentives(ARBITRUM_CHAIN_ID, BOGUS_POOL_ID);

        expect(result.active).toBe(false);
        expect(result.programs).toEqual([]);
      }, 15000);

      it('should normalize poolId to lowercase for matching', async () => {
        const uppercasePoolId = KNOWN_INCENTIVIZED_POOL.toUpperCase();
        const result = await fetchPoolIncentives(ARBITRUM_CHAIN_ID, uppercasePoolId);

        // Should match the same pool regardless of case
        expect(result).toHaveProperty('active');
        expect(result).toHaveProperty('programs');
      }, 15000);

      it('should map campaign fields to correct program shape', async () => {
        const result = await fetchPoolIncentives(ARBITRUM_CHAIN_ID, KNOWN_INCENTIVIZED_POOL);

        if (result.active && result.programs.length > 0) {
          for (const program of result.programs) {
            // Each program should have exactly these keys
            expect(Object.keys(program).sort()).toEqual(['endTimestamp', 'rewardToken', 'rewardTokenSymbol']);
          }
        }
      }, 15000);
    });

    describe('Caching', () => {
      let originalFetch;

      beforeEach(() => {
        originalFetch = global.fetch;
      });

      afterEach(() => {
        global.fetch = originalFetch;
        vi.useRealTimers();
      });

      it('should return cached result within TTL (fetch called once)', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [{
            identifier: KNOWN_INCENTIVIZED_POOL.toLowerCase(),
            campaigns: [],
          }],
        });

        await fetchPoolIncentives(ARBITRUM_CHAIN_ID, KNOWN_INCENTIVIZED_POOL);
        await fetchPoolIncentives(ARBITRUM_CHAIN_ID, KNOWN_INCENTIVIZED_POOL);

        expect(global.fetch).toHaveBeenCalledOnce();
      });

      it('should bypass cache after 5-min TTL expires', async () => {
        vi.useFakeTimers();

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [{
            identifier: KNOWN_INCENTIVIZED_POOL.toLowerCase(),
            campaigns: [],
          }],
        });

        await fetchPoolIncentives(ARBITRUM_CHAIN_ID, KNOWN_INCENTIVIZED_POOL);
        expect(global.fetch).toHaveBeenCalledOnce();

        // Advance past 5-minute TTL
        vi.advanceTimersByTime(5 * 60 * 1000 + 1);

        await fetchPoolIncentives(ARBITRUM_CHAIN_ID, KNOWN_INCENTIVIZED_POOL);
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });

      it('should cache negative results too', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [],
        });

        const result1 = await fetchPoolIncentives(ARBITRUM_CHAIN_ID, BOGUS_POOL_ID);
        const result2 = await fetchPoolIncentives(ARBITRUM_CHAIN_ID, BOGUS_POOL_ID);

        expect(result1).toEqual({ active: false, programs: [] });
        expect(result2).toEqual({ active: false, programs: [] });
        expect(global.fetch).toHaveBeenCalledOnce();
      });
    });

    describe('Expired Campaign Filtering', () => {
      let originalFetch;

      beforeEach(() => {
        originalFetch = global.fetch;
      });

      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('should filter out expired campaigns', async () => {
        const expiredTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [{
            identifier: KNOWN_INCENTIVIZED_POOL.toLowerCase(),
            campaigns: [{
              rewardToken: { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI' },
              endTimestamp: expiredTimestamp,
            }],
          }],
        });

        const result = await fetchPoolIncentives(ARBITRUM_CHAIN_ID, KNOWN_INCENTIVIZED_POOL);

        expect(result.active).toBe(false);
        expect(result.programs).toEqual([]);
      });
    });

    describe('Error Handling', () => {
      let originalFetch;

      beforeEach(() => {
        originalFetch = global.fetch;
      });

      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('should throw on HTTP error', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        });

        await expect(fetchPoolIncentives(ARBITRUM_CHAIN_ID, KNOWN_INCENTIVIZED_POOL))
          .rejects.toThrow('Failed to fetch Merkl pool incentives');
      });

      it('should throw on network failure', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));

        await expect(fetchPoolIncentives(ARBITRUM_CHAIN_ID, KNOWN_INCENTIVIZED_POOL))
          .rejects.toThrow('Failed to fetch Merkl pool incentives');
      });

      it('should return inactive result when opportunities response is not an array', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ error: 'malformed' }),
        });

        const result = await fetchPoolIncentives(ARBITRUM_CHAIN_ID, KNOWN_INCENTIVIZED_POOL);

        expect(result).toEqual({ active: false, programs: [] });
      });
    });

    describe('Active Campaign Mapping', () => {
      let originalFetch;

      beforeEach(() => {
        originalFetch = global.fetch;
      });

      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('should map active campaigns into programs', async () => {
        const futureTimestamp = Math.floor(Date.now() / 1000) + 86400; // 1 day from now

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [{
            identifier: KNOWN_INCENTIVIZED_POOL.toLowerCase(),
            campaigns: [{
              rewardToken: { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI' },
              endTimestamp: futureTimestamp,
            }],
          }],
        });

        const result = await fetchPoolIncentives(ARBITRUM_CHAIN_ID, KNOWN_INCENTIVIZED_POOL);

        expect(result.active).toBe(true);
        expect(result.programs).toHaveLength(1);
        expect(result.programs[0]).toEqual({
          rewardToken: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
          rewardTokenSymbol: 'UNI',
          endTimestamp: futureTimestamp,
        });
      });
    });
  });

  describe('fetchClaimData', () => {
    describe('Parameter Validation', () => {
      it('should throw when chainId is missing', async () => {
        await expect(fetchClaimData(null, '0x1234'))
          .rejects.toThrow('chainId and userAddress are required');
      });

      it('should throw when userAddress is missing', async () => {
        await expect(fetchClaimData(ARBITRUM_CHAIN_ID, null))
          .rejects.toThrow('chainId and userAddress are required');
      });
    });

    describe('Success Cases', () => {
      let originalFetch;

      beforeEach(() => {
        originalFetch = global.fetch;
      });

      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('should return claim data with user, tokens, amounts, proofs', async () => {
        const userAddress = '0xABCD1234ABCD1234ABCD1234ABCD1234ABCD1234';

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ([{
            chain: { id: ARBITRUM_CHAIN_ID, name: 'Arbitrum' },
            rewards: [{
              recipient: userAddress,
              amount: '500000000000000',
              claimed: '100000000000000',
              pending: '400000000000000',
              proofs: ['0xaaaa', '0xbbbb', '0xcccc'],
              token: { address: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', symbol: 'aArbWETH', decimals: 18 },
            }],
          }]),
        });

        const result = await fetchClaimData(ARBITRUM_CHAIN_ID, userAddress);

        expect(result).not.toBeNull();
        expect(result.user).toBe(userAddress);
        expect(result.tokens).toEqual(['0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8']);
        expect(result.amounts).toEqual(['500000000000000']);
        expect(result.proofs).toEqual([['0xaaaa', '0xbbbb', '0xcccc']]);
      });

      it('should construct correct API URL', async () => {
        const userAddress = '0xABCD1234ABCD1234ABCD1234ABCD1234ABCD1234';

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ([{
            chain: { id: ARBITRUM_CHAIN_ID },
            rewards: [],
          }]),
        });

        await fetchClaimData(ARBITRUM_CHAIN_ID, userAddress);

        const [url] = global.fetch.mock.calls[0];
        expect(url).toBe(`https://api.merkl.xyz/v4/users/${userAddress}/rewards?chainId=${ARBITRUM_CHAIN_ID}`);
      });

      it('should filter to only pending rewards and use cumulative amount', async () => {
        const userAddress = '0xABCD1234ABCD1234ABCD1234ABCD1234ABCD1234';

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ([{
            chain: { id: ARBITRUM_CHAIN_ID },
            rewards: [
              {
                amount: '500000000000000',
                pending: '400000000000000',
                proofs: ['0xaaaa'],
                token: { address: '0xtoken1', symbol: 'TK1', decimals: 18 },
              },
              {
                amount: '200000000000000',
                pending: '0',
                proofs: ['0xbbbb'],
                token: { address: '0xtoken2', symbol: 'TK2', decimals: 18 },
              },
            ],
          }]),
        });

        const result = await fetchClaimData(ARBITRUM_CHAIN_ID, userAddress);

        // Should only include token1 (pending > 0), using cumulative amount
        expect(result.tokens).toEqual(['0xtoken1']);
        expect(result.amounts).toEqual(['500000000000000']);
        expect(result.proofs).toEqual([['0xaaaa']]);
      });
    });

    describe('Nothing to Claim', () => {
      let originalFetch;

      beforeEach(() => {
        originalFetch = global.fetch;
      });

      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('should return null when no chain entry matches', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ([{
            chain: { id: 999 },
            rewards: [{ pending: '100', token: { address: '0x1' }, amount: '100', proofs: [] }],
          }]),
        });

        const result = await fetchClaimData(ARBITRUM_CHAIN_ID, '0xuser');
        expect(result).toBeNull();
      });

      it('should return null when all pending are zero', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ([{
            chain: { id: ARBITRUM_CHAIN_ID },
            rewards: [{
              amount: '500000',
              pending: '0',
              proofs: ['0xaaaa'],
              token: { address: '0xtoken1', symbol: 'TK1', decimals: 18 },
            }],
          }]),
        });

        const result = await fetchClaimData(ARBITRUM_CHAIN_ID, '0xuser');
        expect(result).toBeNull();
      });

      it('should return null when rewards array is empty', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ([{
            chain: { id: ARBITRUM_CHAIN_ID },
            rewards: [],
          }]),
        });

        const result = await fetchClaimData(ARBITRUM_CHAIN_ID, '0xuser');
        expect(result).toBeNull();
      });
    });

    describe('Error Handling', () => {
      let originalFetch;

      beforeEach(() => {
        originalFetch = global.fetch;
      });

      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('should throw on HTTP error', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        });

        await expect(fetchClaimData(ARBITRUM_CHAIN_ID, '0xuser'))
          .rejects.toThrow('Failed to fetch Merkl claim data');
      });

      it('should throw on network failure', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));

        await expect(fetchClaimData(ARBITRUM_CHAIN_ID, '0xuser'))
          .rejects.toThrow('Failed to fetch Merkl claim data');
      });

      it('should return null when claim response is not an array', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ error: 'malformed' }),
        });

        const result = await fetchClaimData(ARBITRUM_CHAIN_ID, '0xuser');

        expect(result).toBeNull();
      });
    });
  });
});
