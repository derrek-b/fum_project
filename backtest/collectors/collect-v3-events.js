/**
 * Uniswap V3 event collector using TheGraph
 * Collects swap, mint, and burn events incrementally and appends to existing dataset
 *
 * Usage:
 *   node collect-v3-events.js --chain 42161 --tokens WETH USDC --fee 500 --runs 5
 *   node collect-v3-events.js --chain 42161 --tokens WETH USDC --fee 500 --runs 30 --reverse
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getPlatformMetadata, getPlatformAddresses, getTokenBySymbol, getWethAddress } from 'fum_library';
import { computePoolAddress } from '@uniswap/v3-sdk';
import { Token } from '@uniswap/sdk-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.local
const envPath = path.resolve(__dirname, '../../.env.local');
dotenv.config({ path: envPath });

// Get TheGraph API key from environment
const GRAPH_API_KEY = process.env.THEGRAPH_API_KEY;
if (!GRAPH_API_KEY) {
  console.error('❌ THEGRAPH_API_KEY not set in environment');
  console.error('   Make sure it is set in .env.local');
  process.exit(1);
}

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    chain: null,
    tokens: [],
    fee: null,
    runs: 5,
    reverse: false
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--chain') {
      params.chain = parseInt(args[++i]);
    } else if (args[i] === '--tokens') {
      params.tokens.push(args[++i]);
      params.tokens.push(args[++i]);
    } else if (args[i] === '--fee') {
      params.fee = parseInt(args[++i]);
    } else if (args[i] === '--runs') {
      params.runs = parseInt(args[++i]);
    } else if (args[i] === '--reverse') {
      params.reverse = true;
    }
  }

  // Validate
  if (!params.chain || params.tokens.length !== 2 || !params.fee) {
    console.error('❌ Usage: node collect-v3-events.js --chain <chainId> --tokens <token0> <token1> --fee <fee> [--runs <number>] [--reverse]');
    console.error('   Example: node collect-v3-events.js --chain 42161 --tokens WETH USDC --fee 500 --runs 5');
    process.exit(1);
  }

  return params;
}

// Get TheGraph endpoint for chain
function getGraphEndpoint(chainId) {
  const platformMetadata = getPlatformMetadata('uniswapV3');
  const subgraph = platformMetadata.subgraphs[chainId];

  if (!subgraph) {
    throw new Error(`No Uniswap V3 subgraph configured for chain ${chainId}`);
  }

  return `https://gateway.thegraph.com/api/${GRAPH_API_KEY}/subgraphs/id/${subgraph.id}`;
}

// Get token config, handling WETH specially
function getTokenConfig(symbol, chainId) {
  if (symbol === 'WETH') {
    return {
      address: getWethAddress(chainId),
      symbol: 'WETH',
      decimals: 18,
      isNative: false
    };
  }

  const config = getTokenBySymbol(symbol);
  if (!config) {
    throw new Error(`Token ${symbol} not found in token configs`);
  }

  const address = config.addresses?.[chainId];
  if (!address) {
    throw new Error(`${symbol} not deployed on chain ${chainId}`);
  }

  return {
    address,
    symbol: config.symbol,
    decimals: config.decimals,
    isNative: config.isNative
  };
}

// Compute pool address using Uniswap V3 SDK
function getPoolAddress(chainId, token0Symbol, token1Symbol, fee) {
  const token0 = getTokenConfig(token0Symbol, chainId);
  const token1 = getTokenConfig(token1Symbol, chainId);

  // Get factory address
  const platformAddresses = getPlatformAddresses(chainId, 'uniswapV3');
  const factoryAddress = platformAddresses.factoryAddress;

  // Create Token objects for Uniswap SDK
  const tokenA = new Token(chainId, token0.address, token0.decimals);
  const tokenB = new Token(chainId, token1.address, token1.decimals);

  // Compute pool address
  return computePoolAddress({
    factoryAddress,
    tokenA,
    tokenB,
    fee
  });
}

// Query all event types from TheGraph
async function queryEvents(endpoint, poolAddress, cursorTimestamp, limit = 1000, reverse = false) {
  const timestampFilter = reverse
    ? `timestamp_lte: ${cursorTimestamp}`
    : `timestamp_gte: ${cursorTimestamp}`;
  const orderDirection = reverse ? 'desc' : 'asc';

  const query = `
    query {
      swaps(
        where: {
          pool: "${poolAddress.toLowerCase()}"
          ${timestampFilter}
        }
        orderBy: timestamp
        orderDirection: ${orderDirection}
        first: ${limit}
      ) {
        id
        timestamp
        transaction {
          id
          blockNumber
        }
        token0 {
          symbol
        }
        token1 {
          symbol
        }
        amount0
        amount1
        logIndex
      }

      mints(
        where: {
          pool: "${poolAddress.toLowerCase()}"
          ${timestampFilter}
        }
        orderBy: timestamp
        orderDirection: ${orderDirection}
        first: ${limit}
      ) {
        id
        timestamp
        transaction {
          id
          blockNumber
        }
        token0 {
          symbol
        }
        token1 {
          symbol
        }
        owner
        sender
        amount
        amount0
        amount1
        tickLower
        tickUpper
        logIndex
      }

      burns(
        where: {
          pool: "${poolAddress.toLowerCase()}"
          ${timestampFilter}
        }
        orderBy: timestamp
        orderDirection: ${orderDirection}
        first: ${limit}
      ) {
        id
        timestamp
        transaction {
          id
          blockNumber
        }
        token0 {
          symbol
        }
        token1 {
          symbol
        }
        owner
        amount
        amount0
        amount1
        tickLower
        tickUpper
        logIndex
      }
    }
  `;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error(`TheGraph API returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(`TheGraph query error: ${JSON.stringify(data.errors)}`);
  }

  return {
    swaps: data.data.swaps || [],
    mints: data.data.mints || [],
    burns: data.data.burns || []
  };
}

// Transform and merge all events into chronological order
function transformAndMergeEvents(swaps, mints, burns) {
  const events = [];

  // Transform swaps
  for (const swap of swaps) {
    events.push({
      type: 'swap',
      blockNumber: parseInt(swap.transaction.blockNumber),
      timestamp: parseInt(swap.timestamp),
      transactionHash: swap.transaction.id,
      logIndex: parseInt(swap.logIndex),
      token0: swap.token0.symbol,
      token1: swap.token1.symbol,
      amount0: swap.amount0,
      amount1: swap.amount1
    });
  }

  // Transform mints
  for (const mint of mints) {
    events.push({
      type: 'mint',
      blockNumber: parseInt(mint.transaction.blockNumber),
      timestamp: parseInt(mint.timestamp),
      transactionHash: mint.transaction.id,
      logIndex: parseInt(mint.logIndex),
      token0: mint.token0.symbol,
      token1: mint.token1.symbol,
      owner: mint.owner,
      sender: mint.sender,
      amount: mint.amount,
      amount0: mint.amount0,
      amount1: mint.amount1,
      tickLower: parseInt(mint.tickLower),
      tickUpper: parseInt(mint.tickUpper)
    });
  }

  // Transform burns
  for (const burn of burns) {
    events.push({
      type: 'burn',
      blockNumber: parseInt(burn.transaction.blockNumber),
      timestamp: parseInt(burn.timestamp),
      transactionHash: burn.transaction.id,
      logIndex: parseInt(burn.logIndex),
      token0: burn.token0.symbol,
      token1: burn.token1.symbol,
      owner: burn.owner,
      amount: burn.amount,
      amount0: burn.amount0,
      amount1: burn.amount1,
      tickLower: parseInt(burn.tickLower),
      tickUpper: parseInt(burn.tickUpper)
    });
  }

  // Sort by timestamp, then by logIndex for events in same block
  events.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber - b.blockNumber;
    }
    return a.logIndex - b.logIndex;
  });

  return events;
}

// Main execution
async function main() {
  const params = parseArgs();

  console.log('🚀 Uniswap V3 Event Collector');
  console.log(`   Chain: ${params.chain}`);
  console.log(`   Tokens: ${params.tokens[0]}/${params.tokens[1]}`);
  console.log(`   Fee: ${params.fee}`);
  console.log(`   Runs: ${params.runs}`);
  console.log(`   Mode: ${params.reverse ? '⏪ REVERSE (collecting earlier events)' : '⏩ FORWARD'}\n`);

  // Get endpoint
  const endpoint = getGraphEndpoint(params.chain);

  // Get token configs for sorting
  const tokenA = getTokenConfig(params.tokens[0], params.chain);
  const tokenB = getTokenConfig(params.tokens[1], params.chain);

  // Sort by address to match pool's on-chain token ordering
  const [poolToken0, poolToken1] = tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
    ? [tokenA, tokenB]
    : [tokenB, tokenA];

  // Sort alphabetically for file name
  const [fileToken0, fileToken1] = [tokenA.symbol, tokenB.symbol].sort();
  const fileName = `${fileToken0}-${fileToken1}-${params.fee}`;
  const filePath = path.join(__dirname, `../data/${params.chain}/uniswapV3/${fileName}/events.json`);

  // Compute pool address
  const poolAddress = getPoolAddress(params.chain, tokenA.symbol, tokenB.symbol, params.fee);
  console.log(`📍 Pool address: ${poolAddress}\n`);

  // Load or create events data
  let eventsData;
  if (fs.existsSync(filePath)) {
    eventsData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    // Update pool address in case it was computed differently
    eventsData.metadata.poolAddress = poolAddress;
  } else {
    // Create new file structure
    console.log(`📝 Creating new events file...`);
    // Default start timestamp: Jan 1, 2026 00:00:00 UTC
    const START_TIMESTAMP = 1767225600;
    eventsData = {
      metadata: {
        poolAddress: poolAddress,
        platform: 'uniswapV3',
        chainId: params.chain,
        token0: poolToken0.symbol,
        token1: poolToken1.symbol,
        fee: params.fee,
        startBlock: null,
        endBlock: null,
        startTimestamp: START_TIMESTAMP,
        endTimestamp: null,
        totalEvents: 0,
        collectedAt: null
      },
      events: []
    };

    // Ensure directory exists and save file
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(eventsData, null, 2));
    console.log(`   ✅ Created file at ${filePath}\n`);
  }

  console.log(`📁 Data file: ${filePath}`);
  console.log(`📊 Current events: ${eventsData.metadata.totalEvents}`);
  if (eventsData.metadata.startBlock) {
    console.log(`📅 First event: ${new Date(eventsData.metadata.startTimestamp * 1000).toISOString()}`);
  }
  if (eventsData.metadata.endTimestamp) {
    console.log(`📅 Last event: ${new Date(eventsData.metadata.endTimestamp * 1000).toISOString()}`);
  }
  if (!eventsData.metadata.startBlock && !eventsData.metadata.endTimestamp) {
    console.log(`📅 No events collected yet`);
  }
  console.log();

  // Run collection loop
  for (let run = 1; run <= params.runs; run++) {
    console.log(`${'='.repeat(60)}`);
    console.log(`📊 RUN ${run}/${params.runs}`);
    console.log(`${'='.repeat(60)}`);

    // Determine cursor timestamp based on direction
    let cursorTimestamp;
    if (params.reverse) {
      cursorTimestamp = eventsData.metadata.startTimestamp;
      console.log(`🔍 Querying events before timestamp: ${cursorTimestamp} (${new Date(cursorTimestamp * 1000).toISOString()})`);
    } else {
      cursorTimestamp = eventsData.metadata.endTimestamp || eventsData.metadata.startTimestamp;
      console.log(`🔍 Querying events after timestamp: ${cursorTimestamp} (${new Date(cursorTimestamp * 1000).toISOString()})`);
    }

    // Query all event types
    const { swaps, mints, burns } = await queryEvents(endpoint, poolAddress, cursorTimestamp, 1000, params.reverse);

    console.log(`   📊 Query results: ${swaps.length} swaps, ${mints.length} mints, ${burns.length} burns`);

    const totalResults = swaps.length + mints.length + burns.length;
    if (totalResults === 0) {
      console.log(`   ℹ️  No new events found`);
      if (params.reverse) {
        console.log(`   🛑 Reached earliest available data`);
        break;
      }
      continue;
    }

    // Transform and merge events (already sorts chronologically)
    const newEvents = transformAndMergeEvents(swaps, mints, burns);
    console.log(`   ✅ Merged into ${newEvents.length} chronological events`);

    // Build set of existing event IDs to check for duplicates
    const existingEventIds = new Set(
      eventsData.events.map(e => `${e.transactionHash}-${e.logIndex}`)
    );

    // Filter out duplicates
    const filteredEvents = newEvents.filter(event => {
      const eventId = `${event.transactionHash}-${event.logIndex}`;
      return !existingEventIds.has(eventId);
    });

    if (filteredEvents.length === 0) {
      console.log(`   ⚠️  All events were duplicates, skipping`);
      if (params.reverse) {
        console.log(`   🛑 No new earlier events found`);
        break;
      }
      continue;
    }

    const duplicateCount = newEvents.length - filteredEvents.length;
    if (duplicateCount > 0) {
      console.log(`   🔄 Skipped ${duplicateCount} duplicate(s)`);
    }

    // Count by type
    const swapCount = filteredEvents.filter(e => e.type === 'swap').length;
    const mintCount = filteredEvents.filter(e => e.type === 'mint').length;
    const burnCount = filteredEvents.filter(e => e.type === 'burn').length;
    console.log(`   ➕ Adding ${filteredEvents.length} new events (${swapCount} swaps, ${mintCount} mints, ${burnCount} burns)`);

    if (params.reverse) {
      // Prepend earlier events and re-sort entire array
      eventsData.events = [...filteredEvents, ...eventsData.events];
      eventsData.events.sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
        return a.logIndex - b.logIndex;
      });

      // Update start metadata from earliest event
      const earliestEvent = eventsData.events[0];
      eventsData.metadata.startBlock = earliestEvent.blockNumber;
      eventsData.metadata.startTimestamp = earliestEvent.timestamp;

      // Update end metadata if not already set
      if (eventsData.metadata.endBlock === null) {
        const latestEvent = eventsData.events[eventsData.events.length - 1];
        eventsData.metadata.endBlock = latestEvent.blockNumber;
        eventsData.metadata.endTimestamp = latestEvent.timestamp;
      }

      console.log(`   📍 Earliest event: block ${earliestEvent.blockNumber}, ${new Date(earliestEvent.timestamp * 1000).toISOString()}`);
    } else {
      // Append newer events (existing forward behavior)
      eventsData.events.push(...filteredEvents);

      const firstEvent = filteredEvents[0];
      const lastEvent = filteredEvents[filteredEvents.length - 1];

      // Set startBlock from first event if not already set
      if (eventsData.metadata.startBlock === null) {
        eventsData.metadata.startBlock = firstEvent.blockNumber;
        console.log(`   📍 Set startBlock: ${firstEvent.blockNumber}`);
      }

      eventsData.metadata.endBlock = lastEvent.blockNumber;
      eventsData.metadata.endTimestamp = lastEvent.timestamp;

      console.log(`   📈 Latest event: ${lastEvent.type} at block ${lastEvent.blockNumber}, ${new Date(lastEvent.timestamp * 1000).toISOString()}`);
    }

    eventsData.metadata.totalEvents = eventsData.events.length;
    eventsData.metadata.collectedAt = new Date().toISOString();
    console.log(`   📊 Total events now: ${eventsData.metadata.totalEvents}`);

    // Save to file
    fs.writeFileSync(filePath, JSON.stringify(eventsData, null, 2));
    console.log(`   💾 Saved to file`);

    if (params.reverse) {
      // In reverse mode, check if The Graph returned fewer than limit (exhausted data)
      const maxResults = Math.max(swaps.length, mints.length, burns.length);
      if (maxResults < 1000) {
        console.log(`   ✅ The Graph returned fewer than 1000 results — likely reached earliest available data`);
        console.log(`   🛑 Stopping early (run ${run}/${params.runs})`);
        break;
      }
    } else {
      // Forward mode: check if we've caught up to current time (within last 24 hours)
      const lastEvent = filteredEvents[filteredEvents.length - 1];
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const timeDiff = currentTimestamp - lastEvent.timestamp;
      const hoursBehind = (timeDiff / 3600).toFixed(1);

      if (timeDiff < 86400) { // Less than 24 hours behind
        console.log(`   ✅ Caught up! Latest event is only ${hoursBehind} hours old`);
        console.log(`   🛑 Stopping early (run ${run}/${params.runs})`);
        break;
      } else {
        const daysBehind = (timeDiff / 86400).toFixed(1);
        console.log(`   ⏰ Still ${daysBehind} days behind current time`);
      }
    }

    // Delay between runs
    if (run < params.runs) {
      console.log(`   ⏳ Waiting 2 seconds before next run...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ COLLECTION COMPLETE`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📊 Total events: ${eventsData.metadata.totalEvents}`);

  // Count by type
  const swapCount = eventsData.events.filter(e => e.type === 'swap').length;
  const mintCount = eventsData.events.filter(e => e.type === 'mint').length;
  const burnCount = eventsData.events.filter(e => e.type === 'burn').length;
  console.log(`   ${swapCount} swaps, ${mintCount} mints, ${burnCount} burns`);

  console.log(`📈 Block range: ${eventsData.metadata.startBlock} → ${eventsData.metadata.endBlock}`);
  if (eventsData.metadata.startTimestamp) {
    console.log(`📅 Earliest: ${new Date(eventsData.metadata.startTimestamp * 1000).toISOString()}`);
  }
  if (eventsData.metadata.endTimestamp) {
    console.log(`📅 Latest: ${new Date(eventsData.metadata.endTimestamp * 1000).toISOString()}`);
  }
  console.log(`💾 File: ${filePath}`);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
