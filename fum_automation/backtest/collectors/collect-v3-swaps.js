/**
 * Uniswap V3 swap data collector using TheGraph
 * Collects swap events incrementally and appends to existing dataset
 *
 * Usage:
 *   node collect-v3-swaps.js --chain 42161 --tokens WETH USDC --fee 500 --runs 5
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getPlatformMetadata } from 'fum_library';

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
    runs: 5
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
    }
  }

  // Validate
  if (!params.chain || params.tokens.length !== 2 || !params.fee) {
    console.error('❌ Usage: node collect-v3-swaps.js --chain <chainId> --tokens <token0> <token1> --fee <fee> [--runs <number>]');
    console.error('   Example: node collect-v3-swaps.js --chain 42161 --tokens WETH USDC --fee 500 --runs 5');
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

// Query swaps from TheGraph
async function querySwaps(endpoint, poolAddress, startTimestamp, limit = 1000) {
  const query = `
    query {
      swaps(
        where: {
          pool: "${poolAddress.toLowerCase()}"
          timestamp_gte: ${startTimestamp}
        }
        orderBy: timestamp
        orderDirection: asc
        first: ${limit}
      ) {
        id
        timestamp
        transaction {
          id
          blockNumber
        }
        pool {
          id
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

  return data.data.swaps;
}

// Main execution
async function main() {
  const params = parseArgs();

  console.log('🚀 Uniswap V3 Swap Collector');
  console.log(`   Chain: ${params.chain}`);
  console.log(`   Tokens: ${params.tokens[0]}/${params.tokens[1]}`);
  console.log(`   Fee: ${params.fee}`);
  console.log(`   Runs: ${params.runs}\n`);

  // Get endpoint
  const endpoint = getGraphEndpoint(params.chain);

  // Build file path
  const [token0, token1] = params.tokens.sort(); // Sort alphabetically
  const fileName = `${token0}-${token1}-${params.fee}`;
  const filePath = path.join(__dirname, `../data/${params.chain}/uniswapV3/${fileName}/swaps.json`);

  // Load existing data
  if (!fs.existsSync(filePath)) {
    throw new Error(`Swaps file not found: ${filePath}\nCreate the file first with pool address in metadata.`);
  }

  const swapsData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const poolAddress = swapsData.metadata.poolAddress;

  console.log(`📁 Data file: ${filePath}`);
  console.log(`📍 Pool: ${poolAddress}`);
  console.log(`📊 Current swaps: ${swapsData.metadata.totalSwaps}`);
  if (swapsData.metadata.endTimestamp) {
    console.log(`📅 Last swap: ${new Date(swapsData.metadata.endTimestamp * 1000).toISOString()}\n`);
  } else {
    console.log(`📅 No swaps collected yet\n`);
  }

  // Run collection loop
  for (let run = 1; run <= params.runs; run++) {
    console.log(`${'='.repeat(60)}`);
    console.log(`📊 RUN ${run}/${params.runs}`);
    console.log(`${'='.repeat(60)}`);

    // Query from last timestamp (or start timestamp if no swaps yet)
    const startTimestamp = swapsData.metadata.endTimestamp || swapsData.metadata.startTimestamp;

    console.log(`🔍 Querying swaps after timestamp: ${startTimestamp} (${new Date(startTimestamp * 1000).toISOString()})`);

    // Query new swaps
    const newSwaps = await querySwaps(endpoint, poolAddress, startTimestamp, 1000);

    if (newSwaps.length === 0) {
      console.log(`   ℹ️  No new swaps found`);
    } else {
      console.log(`   ✅ Found ${newSwaps.length} swaps from query`);

      // Build set of existing swap IDs to check for duplicates
      const existingSwapIds = new Set(
        swapsData.swaps.map(s => `${s.transactionHash}-${s.logIndex}`)
      );

      // Transform and filter out duplicates
      const transformedSwaps = newSwaps
        .map(swap => ({
          blockNumber: parseInt(swap.transaction.blockNumber),
          timestamp: parseInt(swap.timestamp),
          transactionHash: swap.transaction.id,
          logIndex: parseInt(swap.logIndex),
          token0: swap.token0.symbol,
          token1: swap.token1.symbol,
          amount0: swap.amount0,
          amount1: swap.amount1
        }))
        .filter(swap => {
          const swapId = `${swap.transactionHash}-${swap.logIndex}`;
          return !existingSwapIds.has(swapId);
        });

      if (transformedSwaps.length === 0) {
        console.log(`   ⚠️  All swaps were duplicates, skipping`);
        continue;
      }

      const duplicateCount = newSwaps.length - transformedSwaps.length;
      if (duplicateCount > 0) {
        console.log(`   🔄 Skipped ${duplicateCount} duplicate(s)`);
      }
      console.log(`   ➕ Adding ${transformedSwaps.length} new swap(s)`);

      swapsData.swaps.push(...transformedSwaps);

      // Update metadata
      const lastSwap = transformedSwaps[transformedSwaps.length - 1];
      swapsData.metadata.endBlock = lastSwap.blockNumber;
      swapsData.metadata.endTimestamp = lastSwap.timestamp;
      swapsData.metadata.totalSwaps = swapsData.swaps.length;
      swapsData.metadata.collectedAt = new Date().toISOString();

      console.log(`   📈 Latest swap: block ${lastSwap.blockNumber}, ${new Date(lastSwap.timestamp * 1000).toISOString()}`);
      console.log(`   📊 Total swaps now: ${swapsData.metadata.totalSwaps}`);

      // Save to file
      fs.writeFileSync(filePath, JSON.stringify(swapsData, null, 2));
      console.log(`   💾 Saved to file`);

      // Check if we've caught up to current time (within last 24 hours)
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const timeDiff = currentTimestamp - lastSwap.timestamp;
      const hoursBehind = (timeDiff / 3600).toFixed(1);

      if (timeDiff < 86400) { // Less than 24 hours behind
        console.log(`   ✅ Caught up! Latest swap is only ${hoursBehind} hours old`);
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
  console.log(`📊 Total swaps: ${swapsData.metadata.totalSwaps}`);
  console.log(`📈 Block range: ${swapsData.metadata.startBlock} → ${swapsData.metadata.endBlock}`);
  if (swapsData.metadata.endTimestamp) {
    console.log(`📅 Latest: ${new Date(swapsData.metadata.endTimestamp * 1000).toISOString()}`);
  }
  console.log(`💾 File: ${filePath}`);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
