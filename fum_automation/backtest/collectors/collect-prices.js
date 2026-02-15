/**
 * Token price collector using CoinGecko API
 * Fetches historical hourly USD prices and stores in centralized price files
 *
 * Usage:
 *   node collect-prices.js WETH
 *   node collect-prices.js USDC
 *   node collect-prices.js ETH --reverse
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getAllTokens } from 'fum_library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.local
const envPath = path.resolve(__dirname, '../../.env.local');
dotenv.config({ path: envPath });

// Get CoinGecko API key
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
if (!COINGECKO_API_KEY) {
  console.error('❌ COINGECKO_API_KEY not set in environment');
  console.error('   Make sure it is set in .env.local');
  process.exit(1);
}

// Constants
const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const START_TIMESTAMP = 1767225600; // Jan 1, 2026 00:00:00 UTC
const MAX_RANGE_DAYS = 90; // CoinGecko limit for hourly data

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('❌ Usage: node collect-prices.js <TOKEN_SYMBOL> [--reverse]');
    console.error('   Example: node collect-prices.js WETH');
    process.exit(1);
  }

  return {
    tokenSymbol: args[0].toUpperCase(),
    reverse: args.includes('--reverse')
  };
}

/**
 * Get token config from fum_library
 */
function getTokenConfig(tokenSymbol) {
  const tokens = getAllTokens();
  const token = tokens[tokenSymbol];

  if (!token) {
    throw new Error(`Token ${tokenSymbol} not found in token configs`);
  }

  if (!token.coingeckoId) {
    throw new Error(`Token ${tokenSymbol} does not have a coingeckoId configured`);
  }

  return token;
}

/**
 * Load existing price file or create new structure
 */
function loadPriceFile(tokenSymbol, filePath) {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  }

  // Create initial structure
  return {
    token: tokenSymbol,
    coingeckoId: null, // Will be set from token config
    startTimestamp: START_TIMESTAMP,
    endTimestamp: null,
    priceCount: 0,
    collectedAt: null,
    prices: {}
  };
}

/**
 * Query CoinGecko for historical prices
 */
async function queryPrices(coingeckoId, fromTimestamp, toTimestamp) {
  const url = new URL(`${COINGECKO_BASE_URL}/coins/${coingeckoId}/market_chart/range`);
  url.searchParams.append('vs_currency', 'usd');
  url.searchParams.append('from', fromTimestamp);
  url.searchParams.append('to', toTimestamp);
  url.searchParams.append('x_cg_demo_api_key', COINGECKO_API_KEY);

  console.log(`🔍 Querying CoinGecko for ${coingeckoId}...`);
  console.log(`   From: ${new Date(fromTimestamp * 1000).toISOString()}`);
  console.log(`   To: ${new Date(toTimestamp * 1000).toISOString()}`);

  const response = await fetch(url.toString());

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CoinGecko API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  if (!data.prices || !Array.isArray(data.prices)) {
    throw new Error(`Unexpected response format from CoinGecko`);
  }

  return data.prices;
}

/**
 * Convert CoinGecko prices to our format (timestamp in seconds as key)
 */
function convertPrices(prices) {
  const converted = {};

  for (const [timestampMs, price] of prices) {
    const timestampSeconds = Math.floor(timestampMs / 1000);
    converted[timestampSeconds] = price;
  }

  return converted;
}

/**
 * Main execution
 */
async function main() {
  const { tokenSymbol, reverse } = parseArgs();

  console.log('💰 Token Price Collector');
  console.log(`   Token: ${tokenSymbol}`);
  console.log(`   Mode: ${reverse ? '⏪ REVERSE (collecting earlier prices)' : '⏩ FORWARD'}\n`);

  // Get token config
  const tokenConfig = getTokenConfig(tokenSymbol);
  const coingeckoId = tokenConfig.coingeckoId;
  console.log(`📍 CoinGecko ID: ${coingeckoId}`);

  // Build file path
  const filePath = path.join(__dirname, '../data/prices', `${tokenSymbol}.json`);
  console.log(`📁 Data file: ${filePath}\n`);

  // Load existing data
  const priceData = loadPriceFile(tokenSymbol, filePath);
  priceData.coingeckoId = coingeckoId; // Ensure it's set

  // Determine time range to fetch
  let fromTimestamp, toTimestamp;
  const currentTimestamp = Math.floor(Date.now() / 1000);

  if (reverse) {
    // Reverse: fetch prices before startTimestamp
    toTimestamp = priceData.startTimestamp;
    fromTimestamp = toTimestamp - (MAX_RANGE_DAYS * 24 * 60 * 60);
  } else {
    // Forward: fetch prices after endTimestamp
    const lastTimestamp = priceData.endTimestamp || priceData.startTimestamp;
    fromTimestamp = lastTimestamp;
    const maxEndTimestamp = lastTimestamp + (MAX_RANGE_DAYS * 24 * 60 * 60);
    toTimestamp = Math.min(maxEndTimestamp, currentTimestamp);
  }

  console.log(`📊 Current state:`);
  console.log(`   Existing prices: ${priceData.priceCount}`);
  if (priceData.startTimestamp) {
    console.log(`   Earliest price: ${new Date(priceData.startTimestamp * 1000).toISOString()}`);
  }
  if (priceData.endTimestamp) {
    console.log(`   Latest price: ${new Date(priceData.endTimestamp * 1000).toISOString()}`);
  } else {
    console.log(`   Latest price: None (starting fresh)`);
  }
  console.log(`   Fetching from: ${new Date(fromTimestamp * 1000).toISOString()}`);
  console.log(`   Fetching to: ${new Date(toTimestamp * 1000).toISOString()}\n`);

  if (!reverse) {
    // Check if we're already up to date (forward only)
    const lastTimestamp = priceData.endTimestamp || priceData.startTimestamp;
    if (lastTimestamp >= currentTimestamp) {
      console.log(`✅ Already up to date!`);
      return;
    }

    // Check if we're within 1 hour of current time (no new hourly data yet)
    if (toTimestamp - lastTimestamp < 3600) {
      console.log(`ℹ️  Less than 1 hour since last price, no new data available yet`);
      return;
    }
  }

  try {
    // Query CoinGecko
    const prices = await queryPrices(coingeckoId, fromTimestamp, toTimestamp);
    console.log(`   ✅ Received ${prices.length} price points\n`);

    // Convert to our format
    const convertedPrices = convertPrices(prices);

    // Filter out duplicates
    let duplicateCount = 0;
    let addedCount = 0;

    for (const [timestamp, price] of Object.entries(convertedPrices)) {
      if (priceData.prices[timestamp]) {
        duplicateCount++;
      } else {
        priceData.prices[timestamp] = price;
        addedCount++;
      }
    }

    if (duplicateCount > 0) {
      console.log(`🔄 Skipped ${duplicateCount} duplicate(s)`);
    }
    console.log(`➕ Added ${addedCount} new price(s)`);

    // Update metadata from all prices
    const timestamps = Object.keys(priceData.prices).map(t => parseInt(t)).sort((a, b) => a - b);
    priceData.startTimestamp = timestamps[0];
    priceData.endTimestamp = timestamps[timestamps.length - 1];
    priceData.priceCount = timestamps.length;
    priceData.collectedAt = new Date().toISOString();

    // Save to file
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(priceData, null, 2));
    console.log(`💾 Saved to file\n`);

    // Summary
    console.log('============================================================');
    console.log('✅ COLLECTION COMPLETE');
    console.log('============================================================');
    console.log(`📊 Total prices: ${priceData.priceCount}`);
    console.log(`📅 Range: ${new Date(priceData.startTimestamp * 1000).toISOString()} → ${new Date(priceData.endTimestamp * 1000).toISOString()}`);

    if (reverse) {
      // In reverse mode, report how far back we've gone
      const daysCovered = (toTimestamp - priceData.startTimestamp) / (24 * 60 * 60);
      console.log(`\n⏪ Earliest price: ${new Date(priceData.startTimestamp * 1000).toISOString()}`);
      console.log(`   Covering ${daysCovered.toFixed(1)} days before original start`);
      if (addedCount > 0) {
        console.log(`\n💡 Run again to collect another 90-day window further back`);
      }
    } else {
      // Forward mode: check if we hit the 90-day limit
      const lastTimestamp = fromTimestamp;
      const daysCovered = (priceData.endTimestamp - lastTimestamp) / (24 * 60 * 60);
      if (daysCovered >= MAX_RANGE_DAYS - 1) {
        const daysRemaining = (currentTimestamp - priceData.endTimestamp) / (24 * 60 * 60);
        console.log(`\n⚠️  Hit 90-day limit. Run again to collect more data.`);
        console.log(`   Remaining: ~${daysRemaining.toFixed(1)} days`);
      } else {
        const hoursRemaining = (currentTimestamp - priceData.endTimestamp) / 3600;
        if (hoursRemaining > 1) {
          console.log(`\n⏰ ${hoursRemaining.toFixed(1)} hours behind current time`);
        } else {
          console.log(`\n✅ Caught up to current time!`);
        }
      }
    }

  } catch (error) {
    console.error('\n❌ Error collecting prices:', error.message);
    process.exit(1);
  }
}

main();
