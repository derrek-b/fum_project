/**
 * @module start-automation
 * @description Startup script for the FUM Automation Service.
 * In production, environment variables are set by the platform (Heroku, Fleek, etc.).
 * In development, variables are loaded from .env.local.
 * @since 1.0.0
 */

import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import AutomationService from '../src/core/AutomationService.js';
import contracts from 'fum_library/artifacts/contracts';
import { initFumLibrary } from 'fum_library';
import { isLocalChain } from 'fum_library/helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Required env vars split by context. BLOCK_EXPLORER_API_KEY is the only key
// that is genuinely production-only — it powers V4 native-ETH fee tracking
// via Arbiscan internal-tx queries, which has no useful response on a local
// Hardhat fork (fork txs aren't indexed there). All other keys are needed
// somewhere in local dev (either by `npm run start` against a local fork
// or by the workflow tests that share this same .env.local).
const BASE_REQUIRED = [
  'CHAIN_ID',
  'WS_URL',
  'AUTOMATION_MNEMONIC',
  'SSE_PORT',
  'RETRY_INTERVAL_MS',
  'MAX_FAILURE_DURATION_MS',
  'COINGECKO_API_KEY',
  'THEGRAPH_API_KEY',
  'ALCHEMY_API_KEY',
];
const PRODUCTION_ONLY = ['BLOCK_EXPLORER_API_KEY'];

// Check if env vars are already set (production) or need to be loaded from file (development)
const allVarsSet = BASE_REQUIRED.every(key => process.env[key]);

if (allVarsSet) {
  console.log('Using environment variables from platform');
} else {
  const envFile = process.env.ENV_FILE || '.env.local';
  const envPath = path.resolve(__dirname, '..', envFile);
  dotenv.config({ path: envPath });
  console.log(`Loaded environment from: ${envPath}`);
}

/**
 * Validate required environment variables and return config object
 * @returns {Object} Validated configuration object
 * @throws {Error} If required variables are missing
 */
function loadConfig() {
  // CHAIN_ID must exist and parse before we can decide which other vars are required
  if (!process.env.CHAIN_ID) {
    console.error('Missing required environment variable: CHAIN_ID');
    console.error('Set it in .env.local (development) or in your platform config (production)');
    process.exit(1);
  }
  const chainId = parseInt(process.env.CHAIN_ID);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    console.error(`Invalid CHAIN_ID: ${process.env.CHAIN_ID}`);
    process.exit(1);
  }

  // On local Hardhat forks (1337/1338), BLOCK_EXPLORER_API_KEY is skipped —
  // fork txs aren't indexed on Arbiscan, so the V4 ETH-fee path returns null
  // regardless of key. On production chains, all keys are required.
  const required = isLocalChain(chainId)
    ? BASE_REQUIRED
    : [...BASE_REQUIRED, ...PRODUCTION_ONLY];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Set them in .env.local (development) or in your platform config (production)');
    process.exit(1);
  }

  // Validate mnemonic (HDNode creation validates BIP-39 format)
  try {
    ethers.utils.HDNode.fromMnemonic(process.env.AUTOMATION_MNEMONIC);
  } catch (error) {
    console.error(`Invalid AUTOMATION_MNEMONIC: ${error.message}`);
    process.exit(1);
  }

  return {
    chainId,
    wsUrl: process.env.WS_URL,
    debug: process.env.DEBUG === 'true',
    dataDir: process.env.DATA_DIR,
    ssePort: parseInt(process.env.SSE_PORT),
    retryIntervalMs: parseInt(process.env.RETRY_INTERVAL_MS),
    maxFailureDurationMs: parseInt(process.env.MAX_FAILURE_DURATION_MS)
  };
}

/**
 * Main function that initializes and starts the automation service.
 * Configuration is read from environment variables (platform or .env.local).
 *
 * @async
 * @returns {Promise<void>}
 * @throws {Error} Exits with code 1 if service fails to start
 * @since 1.0.0
 *
 * @example
 * // Development: uses .env.local
 * npm run start
 *
 * @example
 * // Production: uses platform environment variables
 * heroku run npm start
 */
async function main() {
  try {
    console.log("Starting Automation Service...\n");

    // Load and validate configuration
    const config = loadConfig();

    // Initialize fum_library with API keys. initFumLibrary is permissive —
    // each service is configured only if its key is truthy, so passing
    // undefined for BLOCK_EXPLORER_API_KEY on local chains is fine.
    initFumLibrary({
      coingeckoApiKey: process.env.COINGECKO_API_KEY,
      alchemyApiKey: process.env.ALCHEMY_API_KEY,
      theGraphApiKey: process.env.THEGRAPH_API_KEY,
      blockExplorerApiKey: process.env.BLOCK_EXPLORER_API_KEY,
    });

    console.log("Configuration:");
    console.log(`  Chain ID: ${config.chainId}`);
    console.log(`  WebSocket URL: ${config.wsUrl}`);
    console.log(`  Debug: ${config.debug}`);
    console.log(`  SSE Port: ${config.ssePort}`);
    console.log(`  Data Dir: ${config.dataDir || './data (default)'}`);
    console.log(`  Retry Interval: ${config.retryIntervalMs}ms (${config.retryIntervalMs / 1000}s)`);
    console.log(`  Max Failure Duration: ${config.maxFailureDurationMs}ms (${config.maxFailureDurationMs / (1000 * 60 * 60)}h)\n`);

    // Verify contract addresses exist in fum_library for this chain
    console.log(`Checking contract addresses in fum_library for chain ${config.chainId}...`);

    const vaultFactoryAddress = contracts.VaultFactory.addresses[config.chainId];
    const bobStrategyAddress = contracts.bob.addresses[config.chainId];

    if (!vaultFactoryAddress) {
      console.error(`Missing VaultFactory address for chainId ${config.chainId}`);
      console.error("Make sure contracts are deployed and addresses are synced to the library");
      process.exit(1);
    }

    console.log(`  VaultFactory: ${vaultFactoryAddress}`);
    console.log(`  BabyStepsStrategy: ${bobStrategyAddress || 'Not deployed'}\n`);

    // Create and start the automation service
    const service = new AutomationService({
      debug: config.debug,
      chainId: config.chainId,
      wsUrl: config.wsUrl,
      dataDir: config.dataDir,
      ssePort: config.ssePort,
      retryIntervalMs: config.retryIntervalMs,
      maxFailureDurationMs: config.maxFailureDurationMs,
    });

    try {
      await service.start();
      console.log("\n========================================");
      console.log("Automation Service Running");
      console.log("========================================");
      console.log("Listening for blockchain events...");
      console.log(`SSE endpoint: http://localhost:${config.ssePort}/events`);
      console.log("\nPress Ctrl+C to stop.\n");
    } catch (error) {
      console.error("Failed to start automation service:", error);
      process.exit(1);
    }

    // Graceful shutdown handler
    const shutdown = async (signal) => {
      console.log(`\n${signal} received. Shutting down automation service...`);
      try {
        await service.stop();
        console.log("Service successfully shut down");
        process.exit(0);
      } catch (error) {
        console.error("Error during shutdown:", error);
        process.exit(1);
      }
    };

    // Handle both SIGINT (Ctrl+C) and SIGTERM
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

  } catch (error) {
    console.error("Failed to start:", error);
    process.exit(1);
  }
}

main();
