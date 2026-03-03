#!/usr/bin/env node
/**
 * V3 Backtest Runner — Unified Orchestrator
 * Replays V3 pool events while running real BabyStepsStrategy rebalance logic.
 * Connects to the already-running Hardhat node from setup-v3-backtest.js.
 *
 * Two-terminal workflow:
 *   Terminal 1: npm run backtest:setup   (starts Hardhat, deploys, keeps running)
 *   Terminal 2: npm run backtest:run -- --vault 0x... --pool-replay 0x...
 *
 * Usage:
 *   node backtest/runners/run-v3-backtest.js \
 *     --chain 42161 --tokens WETH USDC --fee 500 \
 *     --vault <vaultAddress> --pool-replay <poolReplayAddress> \
 *     [--limit <n>]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { getAdaptersForChain, getAllTokens, initFumLibrary } from 'fum_library';
import { priceCache } from 'fum_library/services/coingecko';
import EventManager from '../../src/core/EventManager.js';
import VaultDataService from '../../src/core/VaultDataService.js';
import { AlphaRouter } from '@uniswap/smart-order-router';
import BabyStepsStrategy from '../../src/strategies/babySteps/BabyStepsStrategy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Load environment variables
dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env.local') });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const HARDHAT_URL = 'http://localhost:8545';
const PLATFORM = 'uniswapV3';
const CHAIN_ID = 1337;           // Hardhat chain ID — library has full config for "Forked Arbitrum"
const REAL_CHAIN_ID = 42161;     // Original chain — used for data file paths only
const BLOCK_TIME_MS = 250;       // Arbitrum ~0.25s/block
const GAS_LIMIT = 1_000_000;     // Fixed gas limit — skips eth_estimateGas
const MNEMONIC = 'debris coral coral sleep shed prison nation mountain fatigue prosper dose portion';

// Price file symbol mapping: strategy uses WETH, price file is ETH.json
const PRICE_FILE_MAP = {
  WETH: 'ETH',
};

// ---------------------------------------------------------------------------
// BacktestBabyStepsStrategy — subclass to track rebalance state + data
// ---------------------------------------------------------------------------
class BacktestBabyStepsStrategy extends BabyStepsStrategy {
  constructor(dependencies) {
    super(dependencies);
    this.rebalancing = false;
    this.rebalanceCount = 0;
    this.rebalanceHistory = [];
    // Set by replay loop before each block
    this.currentBlock = null;
    this.currentTimestamp = null;
  }

  async rebalancePosition(vault, position) {
    this.rebalancing = true;
    const rebalanceStart = Date.now();

    // Capture before-state
    const before = {
      positionId: position.id,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      liquidity: position.liquidity?.toString(),
      block: this.currentBlock,
      timestamp: this.currentTimestamp,
      date: this.currentTimestamp ? new Date(this.currentTimestamp * 1000).toISOString() : null,
    };

    console.log(`\n  🔄 Rebalance #${this.rebalanceCount + 1} triggered — switching to real-time replay`);
    console.log(`     Block: ${before.block} | ${before.date}`);
    console.log(`     Old range: [${before.tickLower}, ${before.tickUpper}]`);

    try {
      await super.rebalancePosition(vault, position);
      this.rebalanceCount++;

      // Capture after-state: re-fetch vault to get new position
      const freshVault = await this.vaultDataService.getVault(vault.address);
      const positions = freshVault.positions || {};
      const newPosition = Object.values(positions).find(p => p.id !== position.id) ||
        Object.values(positions)[0];

      const after = newPosition ? {
        positionId: newPosition.id,
        tickLower: newPosition.tickLower,
        tickUpper: newPosition.tickUpper,
        liquidity: newPosition.liquidity?.toString(),
      } : null;

      const entry = {
        index: this.rebalanceCount,
        before,
        after,
        durationMs: Date.now() - rebalanceStart,
        success: true,
      };
      this.rebalanceHistory.push(entry);

      if (after) {
        console.log(`     New range: [${after.tickLower}, ${after.tickUpper}] (position ${after.positionId})`);
      }
      console.log(`  ✅ Rebalance #${this.rebalanceCount} complete — resuming fast replay\n`);
    } catch (err) {
      this.rebalanceHistory.push({
        index: this.rebalanceCount + 1,
        before,
        after: null,
        durationMs: Date.now() - rebalanceStart,
        success: false,
        error: err.message,
      });
      console.error(`  ❌ Rebalance failed: ${err.message}`);
      throw err;
    } finally {
      this.rebalancing = false;
    }
  }
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    chain: null,
    tokens: [],
    fee: null,
    vault: null,
    poolReplay: null,
    limit: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--chain') {
      params.chain = parseInt(args[++i]);
    } else if (args[i] === '--tokens') {
      params.tokens.push(args[++i]);
      params.tokens.push(args[++i]);
    } else if (args[i] === '--fee') {
      params.fee = parseInt(args[++i]);
    } else if (args[i] === '--vault') {
      params.vault = args[++i];
    } else if (args[i] === '--pool-replay') {
      params.poolReplay = args[++i];
    } else if (args[i] === '--limit') {
      params.limit = parseInt(args[++i]);
    }
  }

  if (!params.chain || params.tokens.length !== 2 || !params.fee || !params.vault || !params.poolReplay) {
    console.error('Usage: node run-v3-backtest.js --chain <chainId> --tokens <t0> <t1> --fee <fee> --vault <address> --pool-replay <address> [--limit <n>]');
    console.error('   Example: node run-v3-backtest.js --chain 42161 --tokens WETH USDC --fee 500 --vault 0x4C6a... --pool-replay 0xcFe0...');
    process.exit(1);
  }

  return params;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
function loadCalldataFile(chain, t0, t1, fee) {
  const [s0, s1] = [t0, t1].sort();
  const filePath = path.join(__dirname, `../data/${chain}/${PLATFORM}/${s0}-${s1}-${fee}/calldata.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Calldata file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadEventsFile(chain, t0, t1, fee) {
  const [s0, s1] = [t0, t1].sort();
  const filePath = path.join(__dirname, `../data/${chain}/${PLATFORM}/${s0}-${s1}-${fee}/events.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Events file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Load price data for the given token symbols.
 * Returns { WETH: [{timestamp, price}, ...], USDC: [...] } sorted by timestamp.
 */
function loadPriceData(tokenSymbols) {
  const result = {};
  for (const symbol of tokenSymbols) {
    const fileSymbol = PRICE_FILE_MAP[symbol] || symbol;
    const filePath = path.join(__dirname, `../data/prices/${fileSymbol}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Price file not found: ${filePath} (for token ${symbol})`);
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Convert { "timestamp": price } object to sorted array
    const entries = Object.entries(raw.prices).map(([ts, price]) => ({
      timestamp: parseInt(ts),
      price,
    }));
    entries.sort((a, b) => a.timestamp - b.timestamp);
    result[symbol] = entries;
  }
  return result;
}

/**
 * Build a Map<blockNumber, timestamp> from events data.
 * First event per block wins.
 */
function buildBlockTimestampMap(eventsData) {
  const map = new Map();
  for (const event of eventsData.events) {
    if (!map.has(event.blockNumber)) {
      map.set(event.blockNumber, event.timestamp);
    }
  }
  return map;
}

/**
 * Seed the in-memory priceCache for each token using binary search
 * on the sorted price arrays to find the nearest timestamp.
 */
function seedPriceCache(timestamp, priceData) {
  for (const [symbol, prices] of Object.entries(priceData)) {
    if (prices.length === 0) continue;

    // Binary search for nearest timestamp
    let lo = 0;
    let hi = prices.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (prices[mid].timestamp < timestamp) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    // lo is the first entry >= timestamp; check if lo-1 is closer
    let best = lo;
    if (lo > 0) {
      const diffLo = Math.abs(prices[lo].timestamp - timestamp);
      const diffPrev = Math.abs(prices[lo - 1].timestamp - timestamp);
      if (diffPrev < diffLo) best = lo - 1;
    }

    priceCache[symbol] = {
      price: prices[best].price,
      timestamp: Date.now(),
    };
  }
}

// ---------------------------------------------------------------------------
// Strategy dependency initialization (replaces AutomationService wiring)
// ---------------------------------------------------------------------------
async function initializeStrategyDependencies(provider) {
  // 1. EventManager
  const eventManager = new EventManager();
  eventManager.setDebug(false);

  // 2. VaultDataService
  const vaultDataService = new VaultDataService(eventManager);
  vaultDataService.initialize(provider, CHAIN_ID);

  // 3. Adapters — use real chain ID for address lookups
  const adapterResult = getAdaptersForChain(CHAIN_ID);
  if (!adapterResult.adapters || adapterResult.adapters.length === 0) {
    throw new Error(`No adapters available for chain ID ${CHAIN_ID}`);
  }
  if (adapterResult.failures && adapterResult.failures.length > 0) {
    for (const f of adapterResult.failures) {
      console.warn(`  ⚠️ Failed to create adapter ${f.platformId}: ${f.error}`);
    }
  }
  const adapters = new Map();
  for (const adapter of adapterResult.adapters) {
    adapters.set(adapter.platformId, adapter);
  }

  // 3b. Monkey-patch AlphaRouter to route against the fork, not live Arbitrum.
  //     The adapter normally creates AlphaRouter with a real Arbitrum provider
  //     (routes computed against current mainnet state). For backtesting we need
  //     routes computed against the fork's historical state. We create a provider
  //     that connects to the fork but reports chainId 42161 so AlphaRouter's SDK
  //     internals (multicall contracts, subgraph queries) work correctly.
  const v3Adapter = adapters.get('uniswapV3');
  if (v3Adapter) {
    const routingProvider = new ethers.providers.StaticJsonRpcProvider(HARDHAT_URL, {
      chainId: 42161,
      name: 'arbitrum',
    });
    v3Adapter.alphaRouter = new AlphaRouter({
      chainId: 42161,
      provider: routingProvider,
    });
    console.log('   🔧 AlphaRouter patched to use fork provider (chainId 42161)');
  }

  // 4. Tokens — filter by real chain ID for address existence
  const allTokens = getAllTokens();
  const tokens = {};
  for (const [symbol, token] of Object.entries(allTokens)) {
    if (token.addresses && CHAIN_ID in token.addresses) {
      tokens[symbol] = {
        ...token,
        address: token.addresses[CHAIN_ID],
      };
    }
  }

  // 5. Shared objects
  const poolData = {};
  const vaultLocks = {};

  // Inject into VaultDataService
  vaultDataService.setAdapters(adapters);
  vaultDataService.setPoolData(poolData);
  vaultDataService.setTokens(tokens);

  // Inject into EventManager
  eventManager.setPoolData(poolData);
  eventManager.setAdapters(adapters);
  eventManager.setVaultDataService(vaultDataService);

  // 6. Subscribe to PoolDataFetched to auto-populate poolData (same as AutomationService line 757)
  vaultDataService.subscribe('PoolDataFetched', (data) => {
    Object.assign(poolData, data.poolData);
  });
  eventManager.subscribe('PoolDataFetched', (data) => {
    Object.assign(poolData, data.poolData);
  });

  // 7. Set AUTOMATION_MNEMONIC for HDNode derivation
  process.env.AUTOMATION_MNEMONIC = MNEMONIC;

  // 8. Service config
  const serviceConfig = {
    chainId: CHAIN_ID,
    wsUrl: null,
    debug: false,
  };

  // 9. Create strategy (debug: false suppresses per-swap logging)
  const strategy = new BacktestBabyStepsStrategy({
    vaultDataService,
    eventManager,
    provider,
    adapters,
    tokens,
    chainId: CHAIN_ID,
    debug: false,
    vaultLocks,
    poolData,
    automationService: {
      blacklistVault: async () => {},
      trackFailedVault: async () => {},
    },
    serviceConfig,
    sendTelegramMessage: async (msg) => console.log(`  [TELEGRAM] ${msg}`),
  });

  // Inject HDNode for per-vault executor derivation
  strategy.hdNode = ethers.utils.HDNode.fromMnemonic(MNEMONIC);

  return { strategy, vaultDataService, eventManager, vaultLocks, poolData };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const params = parseArgs();

  // ---------------------------------------------------------------------------
  // Log file — tee all console output for full debugging reference
  // ---------------------------------------------------------------------------
  const reportsDir = path.join(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logPath = path.join(reportsDir, `${runId}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  console.log = (...args) => {
    origLog(...args);
    logStream.write(args.join(' ') + '\n');
  };
  console.error = (...args) => {
    origError(...args);
    logStream.write('[ERROR] ' + args.join(' ') + '\n');
  };
  console.warn = (...args) => {
    origWarn(...args);
    logStream.write('[WARN] ' + args.join(' ') + '\n');
  };

  console.log('\n🔁 V3 Backtest Runner');
  console.log(`   Chain: ${params.chain} (fork)`);

  // Initialize fum_library
  initFumLibrary({
    alchemyApiKey: process.env.ALCHEMY_API_KEY,
    theGraphApiKey: process.env.THEGRAPH_API_KEY,
    blockExplorerApiKey: process.env.BLOCK_EXPLORER_API_KEY,
  });

  // Load data files
  const calldataData = loadCalldataFile(params.chain, params.tokens[0], params.tokens[1], params.fee);
  const eventsData = loadEventsFile(params.chain, params.tokens[0], params.tokens[1], params.fee);
  const priceData = loadPriceData(params.tokens);
  const blockTimestampMap = buildBlockTimestampMap(eventsData);

  const poolAddress = calldataData.metadata.poolAddress;
  const vaultAddress = params.vault;
  const poolReplayAddress = params.poolReplay;
  const totalBlocks = params.limit
    ? Math.min(params.limit, calldataData.blocks.length)
    : calldataData.blocks.length;

  const totalTx = calldataData.blocks.slice(0, totalBlocks).reduce((sum, b) => sum + b.transactions.length, 0);

  console.log(`   Pool: ${poolAddress}`);
  console.log(`   Vault: ${vaultAddress}`);
  console.log(`   PoolReplay: ${poolReplayAddress}`);
  console.log(`   Blocks: ${totalBlocks}  |  Transactions: ${totalTx}\n`);

  // Connect to Hardhat
  const provider = new ethers.providers.JsonRpcProvider(HARDHAT_URL);
  const blockNumber = await provider.getBlockNumber();
  console.log(`📍 Connected to Hardhat at block ${blockNumber}`);

  // Mock Arbitrum precompiles that don't exist on Hardhat forks.
  // AlphaRouter calls ArbGasInfo (0x6C) for L1 gas cost estimation.
  // Bytecode stores value 1 (1 wei) in 8 × 32-byte memory slots then returns 256 bytes.
  // Non-zero avoids division-by-zero; negligible value means routes are selected
  // purely by price impact (L1 overhead ≈ 0), which is fine for backtesting.
  //   PUSH1 1, PUSH1 0x00, MSTORE  (×8 for offsets 0x00–0xE0)
  //   PUSH2 0x0100, PUSH1 0x00, RETURN
  const MOCK_NONZERO_BYTECODE =
    '0x6001600052600160205260016040526001606052' +
    '6001608052600160a052600160c052600160e052' +
    '6101006000f3';
  await provider.send('hardhat_setCode', [
    '0x000000000000000000000000000000000000006C', // ArbGasInfo
    MOCK_NONZERO_BYTECODE,
  ]);
  console.log('🔧 Mocked ArbGasInfo precompile at 0x6C (non-zero gas prices)');

  // Initialize strategy dependencies
  console.log('⚙️  Initializing strategy dependencies...');
  const { strategy, vaultDataService, eventManager, vaultLocks } =
    await initializeStrategyDependencies(provider);
  console.log('   ✅ Strategy dependencies ready\n');

  // Event tracking — capture structured data from strategy events
  const feeHistory = [];
  eventManager.subscribe('FeesCollected', (data) => {
    feeHistory.push({
      vaultAddress: data.vaultAddress,
      source: data.source,
      positionIds: data.positionIds,
      totalUSD: data.totalUSD,
      reinvestmentRatio: data.reinvestmentRatio,
      timestamp: data.timestamp,
    });
    console.log(`  💵 Fee collection: $${data.totalUSD?.toFixed(2)} (${data.source})`);
  });

  // Seed initial prices before initializeVault (it calls fetchAssetValues)
  const firstTimestamp = eventsData.metadata.startTimestamp;
  seedPriceCache(firstTimestamp, priceData);

  // Initialize vault via the real production code path
  console.log('🏦 Initializing vault via strategy...');
  const vault = await vaultDataService.getVault(vaultAddress);
  await strategy.initializeVault(vault);
  console.log('   ✅ Vault initialized\n');

  // ---------------------------------------------------------------------------
  // Pre-fund and impersonate burn owners (same pattern as replay-v3-events.js)
  // ---------------------------------------------------------------------------
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
        ethers.utils.hexValue(ethers.utils.parseEther('1')),
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

  // Signer for PoolReplay transactions
  const accounts = await provider.listAccounts();
  const signer = provider.getSigner(accounts[0]);

  // ---------------------------------------------------------------------------
  // Main replay loop
  // ---------------------------------------------------------------------------
  const swapTopicHash = ethers.utils.id('Swap(address,address,int256,int256,uint160,uint128,int24)');
  const normalizedVault = ethers.utils.getAddress(vaultAddress);

  let txSuccess = 0;
  let txFailed = 0;
  let swapEventsProcessed = 0;
  let swapEventsSkipped = 0;
  const startTime = Date.now();

  if (params.limit) {
    console.log(`🚀 Starting replay (limited to ${totalBlocks} blocks)...\n`);
  } else {
    console.log('🚀 Starting replay...\n');
  }

  for (let i = 0; i < totalBlocks; i++) {
    const block = calldataData.blocks[i];

    // Update block context for rebalance tracking
    const blockTimestamp = blockTimestampMap.get(block.blockNumber);
    strategy.currentBlock = block.blockNumber;
    strategy.currentTimestamp = blockTimestamp || strategy.currentTimestamp;

    // Seed price cache for this block's timestamp
    if (blockTimestamp) {
      seedPriceCache(blockTimestamp, priceData);
    }

    // Execute all transactions in this block
    for (const tx of block.transactions) {
      try {
        let receipt;

        if (tx.type === 'burn-impersonated') {
          const resp = await impersonatedSigners.get(tx.owner).sendTransaction({
            to: poolAddress,
            data: tx.calldata,
            gasLimit: GAS_LIMIT,
          });
          receipt = await resp.wait();
        } else {
          const resp = await signer.sendTransaction({
            to: poolReplayAddress,
            data: tx.calldata,
            gasLimit: GAS_LIMIT,
          });
          receipt = await resp.wait();
        }
        txSuccess++;

        // Feed swap events to strategy
        if (tx.type === 'swap' && receipt) {
          const swapLog = receipt.logs.find(
            (l) =>
              l.topics[0] === swapTopicHash &&
              l.address.toLowerCase() === poolAddress.toLowerCase()
          );

          if (swapLog) {
            if (vaultLocks[normalizedVault]) {
              // Vault locked (rebalance in progress) — skip, like production
              swapEventsSkipped++;
            } else {
              // Acquire lock, fire-and-forget handleSwapEvent
              vaultLocks[normalizedVault] = true;
              const freshVault = await vaultDataService.getVault(vaultAddress);

              strategy
                .handleSwapEvent(freshVault, poolAddress, PLATFORM, swapLog)
                .catch((err) => console.error(`  ❌ handleSwapEvent error: ${err.message}`))
                .finally(() => {
                  delete vaultLocks[normalizedVault];
                });

              swapEventsProcessed++;
            }
          }
        }
      } catch (err) {
        txFailed++;
        if (txFailed <= 5) {
          console.error(`  ⚠️ ${tx.type} failed at block ${block.blockNumber}: ${err.reason || err.message}`);
        } else if (txFailed === 6) {
          console.error(`  ⚠️ Suppressing further tx error details...`);
        }
      }
    }

    // Speed control: 0ms normally, 250ms when rebalancing
    if (strategy.rebalancing) {
      await new Promise((r) => setTimeout(r, BLOCK_TIME_MS));
    }

    // Progress logging every 500 blocks
    if ((i + 1) % 500 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `  📊 ${i + 1}/${totalBlocks} blocks | ` +
        `${txSuccess} tx ok, ${txFailed} failed | ` +
        `${swapEventsProcessed} swaps, ${swapEventsSkipped} skipped | ` +
        `${strategy.rebalanceCount} rebalances | ${elapsed}s`
      );
    }
  }

  // Wait for any in-flight rebalance to finish
  while (strategy.rebalancing) {
    await new Promise((r) => setTimeout(r, 500));
  }

  // ---------------------------------------------------------------------------
  // Summary + Report
  // ---------------------------------------------------------------------------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Fetch final vault state for P&L snapshot
  let finalVaultState = null;
  try {
    const finalVault = await vaultDataService.getVault(vaultAddress);
    const positions = finalVault.positions || {};
    finalVaultState = {
      positionCount: Object.keys(positions).length,
      positions: Object.values(positions).map(p => ({
        id: p.id,
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        liquidity: p.liquidity?.toString(),
      })),
    };
  } catch (e) {
    console.warn(`  ⚠️ Could not fetch final vault state: ${e.message}`);
  }

  // Terminal summary — clean and concise
  console.log(`\n${'='.repeat(60)}`);
  console.log('BACKTEST COMPLETE');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Duration: ${elapsed}s`);
  console.log(`  Blocks: ${totalBlocks}  |  TX: ${txSuccess} ok, ${txFailed} failed`);
  console.log(`  Swaps processed: ${swapEventsProcessed}  |  Skipped (locked): ${swapEventsSkipped}`);
  console.log(`  Rebalances: ${strategy.rebalanceCount}`);
  console.log(`  Fee collections: ${feeHistory.length}`);

  if (strategy.rebalanceHistory.length > 0) {
    console.log(`\n  Rebalance timeline:`);
    for (const r of strategy.rebalanceHistory) {
      const status = r.success ? '✅' : '❌';
      const range = r.after
        ? `[${r.before.tickLower}, ${r.before.tickUpper}] → [${r.after.tickLower}, ${r.after.tickUpper}]`
        : `[${r.before.tickLower}, ${r.before.tickUpper}] → FAILED`;
      console.log(`    ${status} #${r.index} | block ${r.before.block} | ${r.before.date} | ${range}`);
    }
  }

  // Write JSON report
  const report = {
    runId,
    timestamp: new Date().toISOString(),
    params: {
      chain: params.chain,
      tokens: params.tokens,
      fee: params.fee,
      pool: poolAddress,
      vault: vaultAddress,
      poolReplay: poolReplayAddress,
      limit: params.limit,
    },
    data: {
      totalBlocks,
      totalTransactions: totalTx,
      blockRange: {
        start: calldataData.blocks[0]?.blockNumber,
        end: calldataData.blocks[totalBlocks - 1]?.blockNumber,
      },
      timestampRange: {
        start: eventsData.metadata.startTimestamp,
        startDate: new Date(eventsData.metadata.startTimestamp * 1000).toISOString(),
        end: eventsData.metadata.endTimestamp,
        endDate: new Date(eventsData.metadata.endTimestamp * 1000).toISOString(),
      },
    },
    results: {
      durationSeconds: parseFloat(elapsed),
      txSuccess,
      txFailed,
      swapEventsProcessed,
      swapEventsSkipped,
      rebalanceCount: strategy.rebalanceCount,
      feeCollectionCount: feeHistory.length,
    },
    rebalances: strategy.rebalanceHistory,
    fees: feeHistory,
    finalVaultState,
  };

  const reportPath = path.join(reportsDir, `${runId}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n  📄 Full log:    ${logPath}`);
  console.log(`  📊 JSON report: ${reportPath}`);

  logStream.end();
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
