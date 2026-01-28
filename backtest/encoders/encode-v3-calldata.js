#!/usr/bin/env node
/**
 * Encodes collected V3 events into ready-to-execute calldata
 * Reads events.json and produces calldata.json grouped by block
 *
 * Usage: node backtest/encoders/encode-v3-calldata.js --chain 42161 --tokens WETH USDC --fee 500
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTokenBySymbol, getWethAddress } from 'fum_library';
import { encodeSwap, encodeMint, encodeBurn, encodeDirectBurn } from '../helpers/encode-pool-replay.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    chain: null,
    tokens: [],
    fee: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--chain') {
      params.chain = parseInt(args[++i]);
    } else if (args[i] === '--tokens') {
      params.tokens.push(args[++i]);
      params.tokens.push(args[++i]);
    } else if (args[i] === '--fee') {
      params.fee = parseInt(args[++i]);
    }
  }

  if (!params.chain || params.tokens.length !== 2 || !params.fee) {
    console.error('Usage: node encode-v3-calldata.js --chain <chainId> --tokens <token0> <token1> --fee <fee>');
    console.error('   Example: node encode-v3-calldata.js --chain 42161 --tokens WETH USDC --fee 500');
    process.exit(1);
  }

  return params;
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

function main() {
  const params = parseArgs();

  console.log('🔧 V3 Calldata Encoder');
  console.log(`   Chain: ${params.chain}`);
  console.log(`   Tokens: ${params.tokens[0]}/${params.tokens[1]}`);
  console.log(`   Fee: ${params.fee}\n`);

  // Load events file
  const [t0, t1] = [params.tokens[0], params.tokens[1]].sort();
  const fileName = `${t0}-${t1}-${params.fee}`;
  const dataDir = path.join(__dirname, `../data/${params.chain}/uniswapV3/${fileName}`);
  const eventsPath = path.join(dataDir, 'events.json');

  if (!fs.existsSync(eventsPath)) {
    console.error(`Events file not found: ${eventsPath}`);
    process.exit(1);
  }

  const eventsData = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
  console.log(`📁 Loaded ${eventsData.metadata.totalEvents} events`);
  console.log(`   Pool: ${eventsData.metadata.poolAddress}`);
  console.log(`   Blocks: ${eventsData.metadata.startBlock} → ${eventsData.metadata.endBlock}\n`);

  // Get token decimals from metadata token ordering (pool's on-chain order)
  const token0Config = getTokenConfig(eventsData.metadata.token0, params.chain);
  const token1Config = getTokenConfig(eventsData.metadata.token1, params.chain);
  const poolAddress = eventsData.metadata.poolAddress;

  console.log(`   token0: ${token0Config.symbol} (${token0Config.decimals} decimals)`);
  console.log(`   token1: ${token1Config.symbol} (${token1Config.decimals} decimals)\n`);

  // Encode each event
  // Track PoolReplay's liquidity positions to route burns correctly
  // Key: "tickLower:tickUpper", Value: BigInt liquidity amount
  const replayLiquidity = new Map();

  function positionKey(tickLower, tickUpper) {
    return `${tickLower}:${tickUpper}`;
  }

  console.log('📦 Encoding events...');
  const encoded = [];
  let errors = 0;
  let swapCount = 0;
  let mintCount = 0;
  let burnReplayCount = 0;
  let burnImpersonatedCount = 0;
  let burnSplitCount = 0;

  for (let i = 0; i < eventsData.events.length; i++) {
    const event = eventsData.events[i];

    try {
      if (event.type === 'swap') {
        encoded.push({
          calldata: encodeSwap(poolAddress, event, token0Config.decimals, token1Config.decimals),
          type: 'swap',
          blockNumber: event.blockNumber,
          logIndex: event.logIndex
        });
        swapCount++;

      } else if (event.type === 'mint') {
        encoded.push({
          calldata: encodeMint(poolAddress, event),
          type: 'mint',
          blockNumber: event.blockNumber,
          logIndex: event.logIndex
        });
        // Track liquidity added to PoolReplay's positions
        const key = positionKey(event.tickLower, event.tickUpper);
        const current = replayLiquidity.get(key) || 0n;
        replayLiquidity.set(key, current + BigInt(event.amount));
        mintCount++;

      } else if (event.type === 'burn') {
        const key = positionKey(event.tickLower, event.tickUpper);
        const replayLiq = replayLiquidity.get(key) || 0n;
        const burnAmount = BigInt(event.amount);

        if (burnAmount === 0n) {
          // Zero-amount burns are fee pokes — no effect on pool state
          // (only updates per-position fee bookkeeping, no cascading effects)
          continue;

        } else if (replayLiq >= burnAmount) {
          // PoolReplay has enough — burn entirely from PoolReplay
          encoded.push({
            calldata: encodeBurn(poolAddress, event),
            type: 'burn',
            blockNumber: event.blockNumber,
            logIndex: event.logIndex
          });
          replayLiquidity.set(key, replayLiq - burnAmount);
          burnReplayCount++;

        } else if (replayLiq > 0n) {
          // Split burn — PoolReplay has some, impersonate the rest
          encoded.push({
            calldata: encodeBurn(poolAddress, event, replayLiq.toString()),
            type: 'burn',
            blockNumber: event.blockNumber,
            logIndex: event.logIndex
          });
          const remainder = burnAmount - replayLiq;
          encoded.push({
            calldata: encodeDirectBurn(event, remainder.toString()),
            type: 'burn-impersonated',
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
            owner: event.owner
          });
          replayLiquidity.set(key, 0n);
          burnSplitCount++;

        } else {
          // PoolReplay has nothing — impersonate the original owner
          encoded.push({
            calldata: encodeDirectBurn(event),
            type: 'burn-impersonated',
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
            owner: event.owner
          });
          burnImpersonatedCount++;
        }

      } else {
        console.error(`   ⚠️  Unknown event type: ${event.type} at index ${i}`);
        errors++;
        continue;
      }
    } catch (err) {
      errors++;
      console.error(`   ⚠️  Error encoding ${event.type} at block ${event.blockNumber}, logIndex ${event.logIndex}: ${err.message}`);
    }

    // Progress logging every 5000 events
    if ((i + 1) % 5000 === 0) {
      console.log(`   ... ${i + 1}/${eventsData.events.length} events encoded`);
    }
  }

  const totalBurns = burnReplayCount + burnImpersonatedCount + burnSplitCount;
  console.log(`\n   ✅ Encoded ${encoded.length} transactions`);
  console.log(`      ${swapCount} swaps, ${mintCount} mints, ${totalBurns} burns`);
  console.log(`      Burns: ${burnReplayCount} via PoolReplay, ${burnImpersonatedCount} impersonated, ${burnSplitCount} split`);
  if (errors > 0) {
    console.log(`   ⚠️  ${errors} encoding errors`);
  }

  // Group by block number
  const blockMap = new Map();
  for (const tx of encoded) {
    if (!blockMap.has(tx.blockNumber)) {
      blockMap.set(tx.blockNumber, []);
    }
    const entry = {
      calldata: tx.calldata,
      type: tx.type,
      logIndex: tx.logIndex
    };
    if (tx.owner) {
      entry.owner = tx.owner;
    }
    blockMap.get(tx.blockNumber).push(entry);
  }

  // Sort blocks, sort transactions within each block by logIndex
  const blocks = Array.from(blockMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([blockNumber, transactions]) => ({
      blockNumber,
      transactions: transactions.sort((a, b) => a.logIndex - b.logIndex)
    }));

  console.log(`\n📊 Grouped into ${blocks.length} blocks`);

  // Build output
  const calldataData = {
    metadata: {
      poolAddress: eventsData.metadata.poolAddress,
      platform: eventsData.metadata.platform,
      chainId: eventsData.metadata.chainId,
      token0: eventsData.metadata.token0,
      token1: eventsData.metadata.token1,
      fee: eventsData.metadata.fee,
      startBlock: eventsData.metadata.startBlock,
      endBlock: eventsData.metadata.endBlock,
      totalBlocks: blocks.length,
      totalTransactions: encoded.length,
      encodingErrors: errors,
      encodedAt: new Date().toISOString()
    },
    blocks
  };

  // Write calldata file
  const calldataPath = path.join(dataDir, 'calldata.json');
  fs.writeFileSync(calldataPath, JSON.stringify(calldataData, null, 2));

  console.log(`\n💾 Written to ${calldataPath}`);
  console.log(`\n${'='.repeat(50)}`);
  console.log('✅ ENCODING COMPLETE');
  console.log(`${'='.repeat(50)}`);
  console.log(`   ${encoded.length} transactions in ${blocks.length} blocks`);
  console.log(`   ${swapCount} swaps, ${mintCount} mints, ${totalBurns} burns`);
  console.log(`   Burns: ${burnReplayCount} PoolReplay, ${burnImpersonatedCount} impersonated, ${burnSplitCount} split`);
  if (errors > 0) {
    console.log(`   ${errors} errors`);
  }
}

main();
