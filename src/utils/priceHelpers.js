import { fetchTokenPrices, priceCache, CACHE_DURATIONS } from 'fum_library/services';

/**
 * Prefetch token prices with sensible defaults
 * Populates the price cache for later synchronous lookups
 * @param {string[]} tokenSymbols - Array of token symbols to fetch prices for
 * @returns {Promise<void>}
 */
export async function prefetchTokenPrices(tokenSymbols) {
  if (!tokenSymbols || tokenSymbols.length === 0) return;

  try {
    // Use 2-minute cache for UI updates (balance between fresh prices & rate limits)
    await fetchTokenPrices(tokenSymbols, CACHE_DURATIONS['2-MINUTES']);
  } catch (error) {
    console.error('Failed to prefetch token prices:', error);
    // Don't throw - allow graceful degradation
  }
}

/**
 * Calculate USD value using cached price (synchronous)
 * Must call prefetchTokenPrices first to populate cache
 * @param {string|number} amount - Token amount
 * @param {string} symbol - Token symbol
 * @returns {number|null} USD value or null if price not in cache
 */
export function calculateUsdValueSync(amount, symbol) {
  if (!amount || amount === '0') return null;

  const upperSymbol = symbol?.toUpperCase();
  const cached = priceCache[upperSymbol];

  if (!cached) return null;

  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(numAmount)) return null;

  return numAmount * cached.price;
}
