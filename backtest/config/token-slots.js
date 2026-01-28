/**
 * Storage slot numbers for token balance mappings on Arbitrum
 * Maps token address (lowercase) -> storage slot number where balances mapping is stored
 *
 * Auto-discovered by backtest/discover-slots.js
 * Run: npm run discover:slots
 */

export const TOKEN_BALANCE_SLOTS = {
  // Slot 9
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 9,

  // Slot 51
  '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 51,
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 51,
  '0xf97f4df75117a78c1a5a0dbb814af92458539fb4': 51,
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 51,
};
