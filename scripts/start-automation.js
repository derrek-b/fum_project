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
import AutomationService from '../src/AutomationService.js';
import contracts from 'fum_library/artifacts/contracts';
import { initFumLibrary } from 'fum_library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Required environment variables
const REQUIRED_VARS = [
  'CHAIN_ID',
  'WS_URL',
  'AUTOMATION_PRIVATE_KEY',
  'SSE_PORT',
  'RETRY_INTERVAL_MS',
  'MAX_FAILURE_DURATION_MS',
  'THEGRAPH_API_KEY',
  'ALCHEMY_API_KEY'
];

// Check if env vars are already set (production) or need to be loaded from file (development)
const allVarsSet = REQUIRED_VARS.every(key => process.env[key]);

if (allVarsSet) {
  console.log('Using environment variables from platform');
} else {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  dotenv.config({ path: envPath });
  console.log(`Loaded environment from: ${envPath}`);
}

/**
 * Validate required environment variables and return config object
 * @returns {Object} Validated configuration object
 * @throws {Error} If required variables are missing
 */
function loadConfig() {
  const missing = REQUIRED_VARS.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Set them in .env.local (development) or in your platform config (production)');
    process.exit(1);
  }

  // Derive executor address from private key
  const wallet = new ethers.Wallet(process.env.AUTOMATION_PRIVATE_KEY);

  return {
    chainId: parseInt(process.env.CHAIN_ID),
    wsUrl: process.env.WS_URL,
    executorAddress: wallet.address,
    debug: process.env.DEBUG === 'true',
    blacklistFilePath: process.env.BLACKLIST_PATH,
    trackingDataDir: process.env.TRACKING_DATA_DIR,
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

    // Initialize fum_library with API keys
    // Note: Alchemy key is required for local testing (chainId 1337) because
    // the AlphaRouter needs a real Arbitrum RPC for swap routing
    initFumLibrary({
      coingeckoApiKey: process.env.COINGECKO_API_KEY,
      alchemyApiKey: process.env.ALCHEMY_API_KEY,
    });

    console.log("Configuration:");
    console.log(`  Chain ID: ${config.chainId}`);
    console.log(`  WebSocket URL: ${config.wsUrl}`);
    console.log(`  Executor: ${config.executorAddress}`);
    console.log(`  Debug: ${config.debug}`);
    console.log(`  SSE Port: ${config.ssePort}`);
    console.log(`  Blacklist Path: ${config.blacklistFilePath}`);
    console.log(`  Tracking Dir: ${config.trackingDataDir}`);
    console.log(`  Retry Interval: ${config.retryIntervalMs}ms (${config.retryIntervalMs / 1000}s)`);
    console.log(`  Max Failure Duration: ${config.maxFailureDurationMs}ms (${config.maxFailureDurationMs / (1000 * 60 * 60)}h)\n`);

    // Get contract addresses from fum_library
    console.log(`Loading contract addresses from fum_library for chain ${config.chainId}...`);

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
      automationServiceAddress: config.executorAddress,
      chainId: config.chainId,
      wsUrl: config.wsUrl,
      bobStrategyAddress,
      blacklistFilePath: config.blacklistFilePath,
      trackingDataDir: config.trackingDataDir,
      ssePort: config.ssePort,
      retryIntervalMs: config.retryIntervalMs,
      maxFailureDurationMs: config.maxFailureDurationMs,
    });

    try {
      await service.initialize(vaultFactoryAddress);
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
