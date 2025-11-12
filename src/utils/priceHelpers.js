import { priceCache } from 'fum_library/services';

/**
 * Calculate USD value using cached price (synchronous)
 * Must fetch prices first to populate cache (via fetchTokenPrices from library)
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
