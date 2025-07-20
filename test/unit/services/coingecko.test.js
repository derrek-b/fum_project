/**
 * CoinGecko Service Unit Tests
 *
 * Tests using real CoinGecko API - requires COINGECKO_API_KEY in .env.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildApiUrl,
  fetchTokenPrices,
  clearPriceCache,
  priceCache,
  ENDPOINTS,
  CACHE_DURATIONS
} from '../../../src/services/coingecko.js';

describe('CoinGecko Service - Real API Tests', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearPriceCache();
  });

  describe('buildApiUrl', () => {
    describe('Success Cases', () => {
      it('should build SIMPLE_PRICE endpoint URL with WETH', () => {
        const url = buildApiUrl(ENDPOINTS.SIMPLE_PRICE, { ids: 'ethereum', vs_currencies: 'usd' });

        expect(url).toContain('https://api.coingecko.com/api/v3/simple/price');
        expect(url).toContain('ids=ethereum');
        expect(url).toContain('vs_currencies=usd');
      });

      it('should build COIN_DETAILS endpoint URL with WETH', () => {
        const url = buildApiUrl(ENDPOINTS.COIN_DETAILS.replace('{id}', 'ethereum'), { localization: 'false' });

        expect(url).toContain('https://api.coingecko.com/api/v3/coins/ethereum');
        expect(url).toContain('localization=false');
      });

      it('should build COIN_HISTORY endpoint URL with WETH', () => {
        const url = buildApiUrl(ENDPOINTS.COIN_HISTORY.replace('{id}', 'ethereum'), { date: '30-12-2023' });

        expect(url).toContain('https://api.coingecko.com/api/v3/coins/ethereum/history');
        expect(url).toContain('date=30-12-2023');
      });

      it('should build EXCHANGES endpoint URL', () => {
        const url = buildApiUrl(ENDPOINTS.EXCHANGES, { per_page: 10, page: 1 });

        expect(url).toContain('https://api.coingecko.com/api/v3/exchanges');
        expect(url).toContain('per_page=10');
        expect(url).toContain('page=1');
      });

      it('should build EXCHANGE_RATES endpoint URL', () => {
        const url = buildApiUrl(ENDPOINTS.EXCHANGE_RATES);

        expect(url).toContain('https://api.coingecko.com/api/v3/exchange_rates');
      });

      it('should build GLOBAL_DATA endpoint URL', () => {
        const url = buildApiUrl(ENDPOINTS.GLOBAL_DATA);

        expect(url).toContain('https://api.coingecko.com/api/v3/global');
      });

      it('should include API key when available', () => {
        // This will use the API key from environment if set
        const url = buildApiUrl(ENDPOINTS.SIMPLE_PRICE, { ids: 'ethereum' });

        if (process.env.COINGECKO_API_KEY) {
          expect(url).toContain('x_cg_demo_api_key=');
        }
        expect(url).toContain('ids=ethereum');
      });

      it('should handle multiple parameters', () => {
        const url = buildApiUrl(ENDPOINTS.SIMPLE_PRICE, {
          ids: 'ethereum,bitcoin',
          vs_currencies: 'usd,eur',
          include_market_cap: true,
          include_24hr_vol: false
        });

        expect(url).toContain('ids=ethereum%2Cbitcoin');
        expect(url).toContain('vs_currencies=usd%2Ceur');
        expect(url).toContain('include_market_cap=true');
        expect(url).toContain('include_24hr_vol=false');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for missing endpoint', () => {
        expect(() => buildApiUrl()).toThrow('Endpoint is required');
        expect(() => buildApiUrl('')).toThrow('Endpoint is required');
      });

      it('should throw error for invalid endpoint', () => {
        expect(() => buildApiUrl('/invalid/endpoint')).toThrow('Invalid endpoint: /invalid/endpoint');
        expect(() => buildApiUrl('/simple/pric')).toThrow('Invalid endpoint: /simple/pric');
      });

      it('should throw error for null parameter values', () => {
        expect(() => buildApiUrl(ENDPOINTS.SIMPLE_PRICE, { ids: null }))
          .toThrow("Parameter 'ids' cannot be null or undefined");
      });

      it('should throw error for undefined parameter values', () => {
        expect(() => buildApiUrl(ENDPOINTS.SIMPLE_PRICE, { ids: undefined }))
          .toThrow("Parameter 'ids' cannot be null or undefined");
      });

      it('should throw error for object parameter values', () => {
        expect(() => buildApiUrl(ENDPOINTS.SIMPLE_PRICE, { ids: { token: 'ethereum' } }))
          .toThrow("Parameter 'ids' cannot be an object");
      });

      it('should throw error for array parameter values', () => {
        expect(() => buildApiUrl(ENDPOINTS.SIMPLE_PRICE, { ids: ['ethereum', 'bitcoin'] }))
          .toThrow("Parameter 'ids' cannot be an object");
      });
    });

    describe('Special Cases', () => {
      it('should handle empty params object', () => {
        const url = buildApiUrl(ENDPOINTS.GLOBAL_DATA, {});

        expect(url).toContain('https://api.coingecko.com/api/v3/global');
      });

      it('should handle numeric parameters', () => {
        const url = buildApiUrl(ENDPOINTS.EXCHANGES, { per_page: 50, page: 2 });

        expect(url).toContain('per_page=50');
        expect(url).toContain('page=2');
      });

      it('should handle boolean parameters', () => {
        const url = buildApiUrl(ENDPOINTS.SIMPLE_PRICE, {
          include_market_cap: true,
          include_24hr_vol: false
        });

        expect(url).toContain('include_market_cap=true');
        expect(url).toContain('include_24hr_vol=false');
      });

      it('should properly encode special characters in parameters', () => {
        const url = buildApiUrl(ENDPOINTS.SIMPLE_PRICE, {
          ids: 'ethereum,usd-coin',
          vs_currencies: 'usd,eur'
        });

        expect(url).toContain('ethereum%2Cusd-coin');
        expect(url).toContain('usd%2Ceur');
      });
    });
  });

  describe('fetchTokenPrices', () => {
    describe('Success Cases', () => {
      it('should fetch WETH price successfully', async () => {
        const prices = await fetchTokenPrices(['WETH'], CACHE_DURATIONS['0-SECONDS']);

        expect(prices).toHaveProperty('WETH');
        expect(typeof prices.WETH).toBe('number');
        expect(prices.WETH).toBeGreaterThan(0);
      });

      it('should populate cache with timestamp', async () => {
        await fetchTokenPrices(['WETH'], CACHE_DURATIONS['5-SECONDS']);

        expect(priceCache).toHaveProperty('WETH');
        expect(priceCache.WETH).toHaveProperty('price');
        expect(priceCache.WETH).toHaveProperty('timestamp');
        expect(typeof priceCache.WETH.price).toBe('number');
        expect(typeof priceCache.WETH.timestamp).toBe('number');
        expect(priceCache.WETH.price).toBeGreaterThan(0);
      });

      it('should fetch multiple tokens', async () => {
        const prices = await fetchTokenPrices(['WETH', 'USDC'], CACHE_DURATIONS['0-SECONDS']);

        expect(prices).toHaveProperty('WETH');
        expect(prices).toHaveProperty('USDC');
        expect(prices.WETH).toBeGreaterThan(100); // ETH should be > $100
        expect(prices.USDC).toBeCloseTo(1, 1); // USDC should be ~$1
      });

      it('should use cache when within duration', async () => {
        // First call - populate cache
        const firstCall = await fetchTokenPrices(['WETH'], CACHE_DURATIONS['5-MINUTES']);
        const firstTimestamp = priceCache.WETH.timestamp;

        // Small delay to ensure different timestamp if fetched
        await new Promise(resolve => setTimeout(resolve, 10)); // Rate limit delay

        // Second call - should use cache
        const secondCall = await fetchTokenPrices(['WETH'], CACHE_DURATIONS['5-MINUTES']);
        const secondTimestamp = priceCache.WETH.timestamp;

        expect(firstCall.WETH).toBe(secondCall.WETH);
        expect(firstTimestamp).toBe(secondTimestamp); // Should be same timestamp (from cache)
      });

      it('should bypass cache with 0-SECONDS strategy', async () => {
        // First call
        await fetchTokenPrices(['WETH'], CACHE_DURATIONS['5-MINUTES']);
        const cachedTimestamp = priceCache.WETH.timestamp;

        // Second call with 0-SECONDS should fetch fresh
        await fetchTokenPrices(['WETH'], CACHE_DURATIONS['0-SECONDS']);

        // Price might be same, but timestamp should be different
        const newTimestamp = priceCache.WETH.timestamp;
        expect(newTimestamp).toBeGreaterThan(cachedTimestamp);
      });

      it('should accept custom cache duration in milliseconds', async () => {
        // Custom 1.5 second cache duration
        const customDuration = 1500;
        const prices = await fetchTokenPrices(['WETH'], customDuration);

        expect(prices.WETH).toBeGreaterThan(0);
        expect(typeof prices.WETH).toBe('number');
      });

      it('should return empty object for empty token array', async () => {
        const result = await fetchTokenPrices([], CACHE_DURATIONS['0-SECONDS']);
        expect(result).toEqual({});
      });
    });

    describe('Error Cases', () => {
      // tokenSymbols parameter validation
      it('should throw error for null tokenSymbols parameter', async () => {
        await expect(fetchTokenPrices(null, CACHE_DURATIONS['0-SECONDS']))
          .rejects.toThrow('tokenSymbols parameter is required');
      });

      it('should throw error for undefined tokenSymbols parameter', async () => {
        await expect(fetchTokenPrices(undefined, CACHE_DURATIONS['0-SECONDS']))
          .rejects.toThrow('tokenSymbols parameter is required');
      });

      it('should throw error for non-array tokenSymbols', async () => {
        await expect(fetchTokenPrices('WETH', CACHE_DURATIONS['0-SECONDS']))
          .rejects.toThrow('tokenSymbols must be an array');
      });

      it('should throw error for unsupported token symbol', async () => {
        await expect(fetchTokenPrices(['FART'], CACHE_DURATIONS['0-SECONDS']))
          .rejects.toThrow(/Unsupported token in request. All tokens must be configured for price fetching/);
      });

      it('should throw error for null token symbols', async () => {
        await expect(fetchTokenPrices([null], CACHE_DURATIONS['0-SECONDS']))
          .rejects.toThrow('Token symbols cannot be null or undefined');
      });

      it('should throw error for undefined token symbols', async () => {
        await expect(fetchTokenPrices([undefined], CACHE_DURATIONS['0-SECONDS']))
          .rejects.toThrow('Token symbols cannot be null or undefined');
      });

      it('should throw error for empty string token symbols', async () => {
        await expect(fetchTokenPrices([''], CACHE_DURATIONS['0-SECONDS']))
          .rejects.toThrow('All token symbols must be non-empty strings');
      });

      it('should throw error for non-string token symbols', async () => {
        await expect(fetchTokenPrices([123, 'WETH'], CACHE_DURATIONS['0-SECONDS']))
          .rejects.toThrow('All token symbols must be strings. Found: number');
      });

      // cacheDurationMs parameter validation
      it('should throw error for missing cache duration', async () => {
        await expect(fetchTokenPrices(['WETH']))
          .rejects.toThrow('cacheDurationMs parameter is required');
      });

      it('should throw error for null cache duration', async () => {
        await expect(fetchTokenPrices(['WETH'], null))
          .rejects.toThrow('cacheDurationMs parameter is required');
      });

      it('should throw error for undefined cache duration', async () => {
        await expect(fetchTokenPrices(['WETH'], undefined))
          .rejects.toThrow('cacheDurationMs parameter is required');
      });

      it('should throw error for non-number cache duration', async () => {
        await expect(fetchTokenPrices(['WETH'], '1000'))
          .rejects.toThrow('cacheDurationMs must be a valid number');
      });

      it('should throw error for non-finite cache duration', async () => {
        await expect(fetchTokenPrices(['WETH'], Infinity))
          .rejects.toThrow('cacheDurationMs must be a valid number');
      });

      it('should throw error for NaN cache duration', async () => {
        await expect(fetchTokenPrices(['WETH'], NaN))
          .rejects.toThrow('cacheDurationMs must be a valid number');
      });

      it('should throw error for negative cache duration', async () => {
        await expect(fetchTokenPrices(['WETH'], -1))
          .rejects.toThrow('cacheDurationMs must be >= 0. Got: -1');
      });

      it('should throw error when CoinGecko returns incomplete price data', async () => {
        // Mock fetch to return incomplete data
        const originalFetch = global.fetch;
        global.fetch = vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            'ethereum': { 'usd': 2000 }
            // Missing 'usd-coin' data
          })
        });

        await expect(fetchTokenPrices(['WETH', 'USDC'], CACHE_DURATIONS['0-SECONDS']))
          .rejects.toThrow('No price data returned for token USDC');

        // Restore original fetch
        global.fetch = originalFetch;
      });

      it('should throw error when CoinGecko returns invalid price data', async () => {
        // Mock fetch to return invalid price data
        const originalFetch = global.fetch;
        global.fetch = vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            'ethereum': { 'usd': -100 } // Invalid negative price
          })
        });

        await expect(fetchTokenPrices(['WETH'], CACHE_DURATIONS['0-SECONDS']))
          .rejects.toThrow('Invalid price data for token WETH: -100');

        // Restore original fetch
        global.fetch = originalFetch;
      });
    });
  });

  describe('Cache Management', () => {
    it('should export live cache object', async () => {
      // Cache should start empty
      expect(Object.keys(priceCache)).toHaveLength(0);


      // After fetch, cache should have data
      await fetchTokenPrices(['WETH'], CACHE_DURATIONS['5-SECONDS']);
      expect(Object.keys(priceCache)).toHaveLength(1);
      expect(priceCache.WETH).toBeDefined();
      expect(priceCache.WETH.price).toBeGreaterThan(0);
      expect(priceCache.WETH.timestamp).toBeGreaterThan(0);
    });

    it('should clear cache completely', async () => {
      // Populate cache
      await fetchTokenPrices(['WETH', 'USDC'], CACHE_DURATIONS['5-SECONDS']);
      expect(Object.keys(priceCache)).toHaveLength(2);

      // Clear cache
      clearPriceCache();
      expect(Object.keys(priceCache)).toHaveLength(0);
    });
  });

});
