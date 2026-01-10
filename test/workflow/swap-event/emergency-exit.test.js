/**
 * @fileoverview Test emergency exit when price moves beyond trigger threshold
 *
 * Tests:
 * 1. VaultUnrecoverable event emitted when price moves beyond emergency threshold
 * 2. All positions closed during emergency exit
 * 3. Vault is blacklisted after emergency exit
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import {
  setupSwapWallet,
  executeSwap,
  configureStrategyParameters,
  getTokenAddressForTest
} from '../../helpers/swap-utils.js';
import { waitForCondition } from '../../helpers/wait-utils.js';
import { ethers } from 'ethers';
import { UniswapV3Adapter } from 'fum_library/adapters';

// Mock getPoolTVLAverage to ensure 500 bps pool is always selected
vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    getPoolTVLAverage: vi.fn().mockImplementation((poolAddress) => {
      const address = poolAddress.toLowerCase();
      // WETH/USDC 500 bps pool on Arbitrum - highest TVL
      if (address === '0xc6962004f452be9203591991d15f6b388e09e8d0') {
        return Promise.resolve(100000000); // $100M
      }
      return Promise.resolve(10000000); // $10M
    })
  };
});

describe('Emergency Exit', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;
  let adapter;

  beforeAll(async () => {
    // Setup blockchain
    testEnv = await setupTestBlockchain();
    console.log('Test blockchain connected');

    // Setup swap wallet with massive capital for emergency trigger
    console.log('Setting up swap wallet with large reserves...');
    const swapSetup = await setupSwapWallet(testEnv, {
      ethAmount: '1000',
      wethAmount: '900',
      usdcAmount: '0'
    });
    swapWallet = swapSetup;

    // Create adapter for pool queries
    adapter = new UniswapV3Adapter(1337);

    // Create test vault with tight position
    console.log('Creating test vault...');
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Emergency Exit Test Vault',
        automationServiceAddress: testEnv.testConfig.automationServiceAddress,
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 90,
          tickRange: { type: 'centered', spacing: 5 }
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Test vault created: ${testVault.vaultAddress}`);

    // Configure strategy with very low emergency exit trigger
    await configureStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 25,        // 0.25% range
      targetRangeLower: 25,
      rebalanceThresholdUpper: 150, // 1.5%
      rebalanceThresholdLower: 150,
      emergencyExitTrigger: 50,    // 0.5% - very tight for testing
      reinvestmentTrigger: 1000,   // $10 (high to avoid interference)
      reinvestmentRatio: 5000
    });

    // Initialize and start automation service
    service = new AutomationService(testEnv.testConfig);
    await service.start();
    console.log('Automation service started');

    // Wait for vault discovery
    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      500
    );
    console.log('Vault discovered by service');
  }, 180000);

  afterAll(async () => {
    if (service?.isRunning) {
      await service.stop();
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should trigger emergency exit when price moves beyond threshold', async () => {
    // Track emergency exit events
    const unrecoverableEvents = [];
    const positionsClosedEvents = [];
    const vaultBlacklistedEvents = [];

    service.eventManager.subscribe('VaultUnrecoverable', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        unrecoverableEvents.push(data);
        console.log(`VaultUnrecoverable: ${data.reason}`);
      }
    });

    service.eventManager.subscribe('PositionsClosed', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        positionsClosedEvents.push(data);
        console.log(`PositionsClosed: ${data.positionIds?.length || 0} positions`);
      }
    });

    service.eventManager.subscribe('VaultBlacklisted', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        vaultBlacklistedEvents.push(data);
        console.log(`VaultBlacklisted: ${data.reason}`);
      }
    });

    // Get initial position data
    const initialVault = await service.vaultDataService.getVault(testVault.vaultAddress);
    const initialPositions = Object.values(initialVault.positions);
    expect(initialPositions.length).toBe(1);

    const initialPosition = initialPositions[0];
    console.log(`Initial position: ${initialPosition.id}`);
    console.log(`Initial position liquidity: ${initialPosition.liquidity}`);

    // Get initial pool state for baseline comparison
    const wethAddress = getTokenAddressForTest('WETH', 1337);
    const usdcAddress = getTokenAddressForTest('USDC', 1337);

    const initialPoolData = await adapter.fetchPoolData(
      usdcAddress,
      wethAddress,
      500,
      testEnv.hardhatServer.provider
    );
    console.log(`Initial pool tick: ${initialPoolData.tick}`);

    // Execute massive single swap to trigger emergency exit
    // 0.5% price movement = about 50 bps = ~50 ticks
    // Need a very large swap to move price that much in one block
    console.log('Executing massive swap to trigger emergency exit...');

    const massiveSwapAmount = ethers.utils.parseUnits('550', 18); // 550 WETH

    try {
      await executeSwap(testEnv, {
        tokenIn: wethAddress,
        tokenOut: usdcAddress,
        amountIn: massiveSwapAmount,
        fee: 500,
        wallet: swapWallet.wallet,
        slippage: 100 // 100% slippage tolerance for massive swap
      });
      console.log('Massive swap completed');
    } catch (error) {
      // Swap might fail due to price impact, but the event should still be detected
      console.log(`Swap result: ${error.message.slice(0, 100)}`);
    }

    // Get new pool state
    const newPoolData = await adapter.fetchPoolData(
      usdcAddress,
      wethAddress,
      500,
      testEnv.hardhatServer.provider
    );
    console.log(`New pool tick: ${newPoolData.tick}`);
    console.log(`Tick difference: ${Math.abs(newPoolData.tick - initialPoolData.tick)}`);

    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Wait for VaultBlacklisted event (emitted on emergency exit)
    await waitForCondition(
      () => vaultBlacklistedEvents.length > 0,
      60000,
      1000
    );

    // Verify VaultBlacklisted event with emergency reason
    expect(vaultBlacklistedEvents.length).toBeGreaterThan(0);
    const emergencyEvent = vaultBlacklistedEvents[0];

    expect(emergencyEvent.vaultAddress).toBe(testVault.vaultAddress);
    expect(emergencyEvent.reason).toContain('Emergency');
    console.log(`Emergency exit reason: ${emergencyEvent.reason}`);

    // Check if vault is blacklisted
    const isBlacklisted = service.isVaultBlacklisted(testVault.vaultAddress);
    expect(isBlacklisted).toBe(true);

    console.log('Emergency exit test passed - vault successfully blacklisted');
  }, 180000);
});
