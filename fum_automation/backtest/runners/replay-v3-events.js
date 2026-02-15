#!/usr/bin/env node
/**
 * Backtest Replay Runner
 * Executes pre-encoded calldata against the PoolReplay contract on a running Hardhat node
 * Replays all pool events as fast as possible to replicate on-chain state
 *
 * Usage: node backtest/runners/replay-v3-events.js --chain 42161 --tokens WETH USDC --fee 500 --contract 0x...
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HARDHAT_URL = 'http://localhost:8545';

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    chain: null,
    tokens: [],
    fee: null,
    contract: null,
    limit: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--chain') {
      params.chain = parseInt(args[++i]);
    } else if (args[i] === '--tokens') {
      params.tokens.push(args[++i]);
      params.tokens.push(args[++i]);
    } else if (args[i] === '--fee') {
      params.fee = parseInt(args[++i]);
    } else if (args[i] === '--contract') {
      params.contract = args[++i];
    } else if (args[i] === '--limit') {
      params.limit = parseInt(args[++i]);
    }
  }

  if (!params.chain || params.tokens.length !== 2 || !params.fee || !params.contract) {
    console.error('Usage: node replay-v3-events.js --chain <chainId> --tokens <token0> <token1> --fee <fee> --contract <poolReplayAddress>');
    console.error('   Example: node replay-v3-events.js --chain 42161 --tokens WETH USDC --fee 500 --contract 0x5FbDB...');
    process.exit(1);
  }

  return params;
}

async function main() {
  const params = parseArgs();

  console.log('\n🔁 Backtest Replay Runner');
  console.log(`   Chain: ${params.chain}`);
  console.log(`   Tokens: ${params.tokens[0]}/${params.tokens[1]}`);
  console.log(`   Fee: ${params.fee}`);
  console.log(`   PoolReplay: ${params.contract}\n`);

  // Load calldata file
  const [t0, t1] = [params.tokens[0], params.tokens[1]].sort();
  const fileName = `${t0}-${t1}-${params.fee}`;
  const calldataPath = path.join(__dirname, `../data/${params.chain}/uniswapV3/${fileName}/calldata.json`);

  if (!fs.existsSync(calldataPath)) {
    console.error(`Calldata file not found: ${calldataPath}`);
    process.exit(1);
  }

  const calldataData = JSON.parse(fs.readFileSync(calldataPath, 'utf8'));
  const poolAddress = calldataData.metadata.poolAddress;
  const poolReplayAddress = params.contract;

  console.log(`📁 Loaded ${calldataData.metadata.totalTransactions} transactions in ${calldataData.metadata.totalBlocks} blocks`);
  console.log(`   Pool: ${poolAddress}`);
  console.log(`   Blocks: ${calldataData.metadata.startBlock} → ${calldataData.metadata.endBlock}\n`);

  // Connect to Hardhat
  const provider = new ethers.providers.JsonRpcProvider(HARDHAT_URL);
  const accounts = await provider.listAccounts();
  const signer = provider.getSigner(accounts[0]);

  // Verify connection
  const blockNumber = await provider.getBlockNumber();
  console.log(`📍 Connected to Hardhat at block ${blockNumber}`);
  console.log(`   Wallet: ${accounts[0]}\n`);

  // Fixed gas limit — skips eth_estimateGas RPC call per transaction
  const GAS_LIMIT = 1_000_000;

  // Pre-scan calldata for unique impersonated owners, fund and impersonate upfront
  const impersonatedOwners = new Set();
  for (const block of calldataData.blocks) {
    for (const tx of block.transactions) {
      if (tx.type === 'burn-impersonated' && tx.owner) {
        impersonatedOwners.add(tx.owner);
      }
    }
  }

  if (impersonatedOwners.size > 0) {
    console.log(`🔓 Pre-funding and impersonating ${impersonatedOwners.size} burn owners...`);
    for (const owner of impersonatedOwners) {
      await provider.send('hardhat_setBalance', [
        owner,
        ethers.utils.hexValue(ethers.utils.parseEther('1'))
      ]);
      await provider.send('hardhat_impersonateAccount', [owner]);
    }
    console.log('   ✅ Done\n');
  }

  // Cache impersonated signers
  const impersonatedSigners = new Map();
  for (const owner of impersonatedOwners) {
    impersonatedSigners.set(owner, provider.getSigner(owner));
  }

  // Counters
  let txSuccess = 0;
  let txFailed = 0;
  let swapSuccess = 0;
  let mintSuccess = 0;
  let burnSuccess = 0;
  let burnImpersonatedSuccess = 0;
  const startTime = Date.now();

  const totalBlocks = params.limit
    ? Math.min(params.limit, calldataData.blocks.length)
    : calldataData.blocks.length;

  if (params.limit) {
    console.log(`🚀 Starting replay (limited to ${totalBlocks} blocks)...\n`);
  } else {
    console.log('🚀 Starting replay...\n');
  }

  for (let i = 0; i < totalBlocks; i++) {
    const block = calldataData.blocks[i];

    for (const tx of block.transactions) {
      try {
        if (tx.type === 'burn-impersonated') {
          // Use pre-impersonated signer, send burn directly to pool
          const impersonatedSigner = impersonatedSigners.get(tx.owner);
          await impersonatedSigner.sendTransaction({
            to: poolAddress,
            data: tx.calldata,
            gasLimit: GAS_LIMIT
          });
          burnImpersonatedSuccess++;
        } else {
          // swap, mint, burn → send to PoolReplay contract
          await signer.sendTransaction({
            to: poolReplayAddress,
            data: tx.calldata,
            gasLimit: GAS_LIMIT
          });

          if (tx.type === 'swap') swapSuccess++;
          else if (tx.type === 'mint') mintSuccess++;
          else if (tx.type === 'burn') burnSuccess++;
        }
        txSuccess++;
      } catch (err) {
        txFailed++;
        // 🪲 Debug: log first few failures with details
        if (txFailed <= 10) {
          console.error(`   ⚠️  ${tx.type} failed at block ${block.blockNumber}, logIndex ${tx.logIndex}: ${err.reason || err.message}`);
        } else if (txFailed === 11) {
          console.error(`   ⚠️  Suppressing further error details (${txFailed}+ failures)`);
        }
      }
    }

    // Progress logging every 1000 blocks
    if ((i + 1) % 1000 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const txPerSec = (txSuccess / (Date.now() - startTime) * 1000).toFixed(1);
      console.log(`   📊 ${i + 1}/${totalBlocks} blocks | ${txSuccess} ok, ${txFailed} failed | ${txPerSec} tx/s | ${elapsed}s elapsed`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const finalBlock = await provider.getBlockNumber();

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ REPLAY COMPLETE');
  console.log(`${'='.repeat(60)}`);
  console.log(`   Elapsed: ${elapsed}s`);
  console.log(`   Final block: ${finalBlock}`);
  console.log(`   Transactions: ${txSuccess} succeeded, ${txFailed} failed`);
  console.log(`   Swaps: ${swapSuccess} | Mints: ${mintSuccess} | Burns: ${burnSuccess} (PoolReplay) + ${burnImpersonatedSuccess} (impersonated)`);
  console.log(`   Unique impersonated accounts: ${impersonatedOwners.size}`);

  if (txFailed > 0) {
    const failRate = ((txFailed / (txSuccess + txFailed)) * 100).toFixed(1);
    console.log(`   ⚠️  Failure rate: ${failRate}%`);
  }
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
