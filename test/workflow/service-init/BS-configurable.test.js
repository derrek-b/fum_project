/**
 * @fileoverview Configurable test for AutomationService initialization
 * Allows users to define test scenarios via JSON config files instead of hardcoding
 *
 * Usage:
 *   # Run with default scenario
 *   npm test test/workflow/service-init/BS-configurable
 *
 *   # Run with custom scenario
 *   SCENARIO=test/scenarios/my-scenario.json npm test test/workflow/service-init/BS-configurable
 *
 * See test/scenarios/README.md for documentation on creating scenario files
 */

import { ethers } from 'ethers'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import AutomationService from '../../../src/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load scenario from environment variable or use default
const scenarioPath = process.env.SCENARIO || path.join(__dirname, '../../scenarios/default.json');
const scenarioContent = fs.readFileSync(scenarioPath, 'utf8');
const scenario = JSON.parse(scenarioContent);

console.log(`\n📋 Loading scenario: ${scenario.name}`);
console.log(`   Description: ${scenario.description}`);
console.log(`   Config file: ${scenarioPath}\n`);

// Mock the getPoolTVLAverage and getPoolAge functions for test environment
vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    getPoolTVLAverage: vi.fn().mockResolvedValue(50000000), // $50M TVL
  };
});

describe(`Configurable Service Init - ${scenario.name}`, () => {
  let testEnv;
  let testVault;
  let service;

  beforeAll(async () => {
    // Setup blockchain environment with configured port
    testEnv = await setupTestBlockchain({ port: scenario.port });

    // Create test vault using scenario configuration
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        ...scenario.vaultSetup,
        automationServiceAddress: testEnv.testConfig.automationServiceAddress
      }
    );

    console.log(`✅ Test vault created: ${testVault.vaultAddress}`);
    console.log(`   Positions: ${Object.keys(testVault.positions).length}`);
    console.log(`   Tokens: ${Object.keys(testVault.tokenBalances).join(', ')}`);
    console.log(`   Target: ${scenario.vaultSetup.targetTokens.join('/')}`);
  }, 180000); // timeout for vault setup

  afterAll(async () => {
    // Cleanup service
    if (service) {
      try {
        await service.stop();
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }

    // Cleanup blockchain
    await cleanupTestBlockchain(testEnv);
  });

  describe('Initialization Test', () => {
    it('should successfully initialize without errors', async () => {
      // Create AutomationService instance
      service = new AutomationService(testEnv.testConfig);

      // Track initialization status
      let serviceStarted = false;
      let initializationError = null;

      // Subscribe to ServiceStarted event
      service.eventManager.subscribe('ServiceStarted', (data) => {
        serviceStarted = true;
        console.log(`\n✅ Service started successfully`);
        console.log(`   Vaults initialized: ${data.successfulVaults || 0}`);
        console.log(`   Failed vaults: ${data.failedVaults || 0}`);
      });

      // Track any errors during initialization
      const originalConsoleError = console.error;
      console.error = (...args) => {
        // Capture errors (excluding expected ones like Telegram 404)
        const message = args.join(' ');
        if (!message.includes('Telegram') && !message.includes('404')) {
          initializationError = message;
        }
        originalConsoleError(...args);
      };

      // Start the service
      try {
        await service.start();
      } catch (error) {
        initializationError = error.message;
        throw error;
      } finally {
        console.error = originalConsoleError;
      }

      // Assertions
      expect(serviceStarted).toBe(true);
      expect(initializationError).toBeNull();

      console.log(`\n✅ ${scenario.name} - Initialization completed successfully\n`);
    }, 60000); // 60 second timeout for initialization
  });
});
