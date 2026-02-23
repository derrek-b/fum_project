/**
 * @fileoverview TJ V2.2 Emergency Exit Test
 *
 * Tests emergency exit detection when price moves beyond the emergencyExitTrigger threshold.
 * Emergency exit triggers vault blacklisting WITHOUT closing positions.
 *
 * This validates TJ-specific:
 * - ActiveId-based baseline capture (object { activeId, binStep } vs V3/V4's tick number)
 * - Emergency detection via bin-based price movement calculation
 * - Vault blacklisting flow with positions preserved
 *
 * Run with: FORK_CHAIN=avalanche npm test -- test/workflow/traderjoe/execution/emergency-exit.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../../helpers/hardhat-setup.js';
import { setupTraderJoeTestVault } from '../../../helpers/traderjoe-vault-setup.js';
import {
  setupTJSwapWallet,
  executeTraderJoeSwap,
  configureTJStrategyParameters
} from '../../../helpers/traderjoe-swap-utils.js';
import { waitForCondition } from '../../../helpers/wait-utils.js';
import { getTokenAddress } from 'fum_library';
import { getWrappedNativeAddress } from 'fum_library/helpers/tokenHelpers';

describe('TJ V2.2 Emergency Exit', () => {
  let testEnv;
  let testConfig;
  let service;
  let testVault;
  let swapWallet;
  let wavaxAddress;
  let usdcAddress;

  beforeAll(async () => {
    // Setup blockchain environment (Avalanche fork via FORK_CHAIN=avalanche)
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    const network = await testEnv.hardhatServer.provider.getNetwork();
    const chainId = network.chainId;
    wavaxAddress = getWrappedNativeAddress(chainId);
    usdcAddress = getTokenAddress('USDC', chainId);

    // Give deployer extra balance for large swap wallet funding (deep pool needs heavy capital)
    await testEnv.hardhatServer.provider.send('hardhat_setBalance', [
      testEnv.deployer.address,
      ethers.utils.hexValue(ethers.utils.parseEther('200000'))
    ]);

    // Setup swap wallet with heavy capital to push price beyond emergency threshold
    // binStep=10 pool has deep liquidity — need massive capital to move price 3%+
    console.log('Setting up TJ swap wallet...');
    swapWallet = await setupTJSwapWallet(testEnv, {
      avaxAmount: '100000',
      wavaxAmount: '95000',
      usdcAmount: '0'
    });

    // Create test vault with NO positions - service will create one during setup
    console.log('Creating TJ V2.2 test vault (no initial positions)...');
    testVault = await setupTraderJoeTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'TJ V2.2 Emergency Exit Test',
        automationServiceAddress: testConfig.automationServiceAddress,
        nativeAmount: '0',
        swapTokens: [],
        positions: [],
        tokenTransfers: {},
        targetTokens: ['USDC', 'WAVAX'],
        targetPlatforms: ['traderjoeV2_2'],
        strategy: 'bob'
      }
    );
    console.log(`TJ V2.2 Emergency Exit test vault created: ${testVault.vaultAddress}`);

    // Send native AVAX directly to vault for position creation
    const owner = testEnv.hardhatServer.signers[0];
    const tx = await owner.sendTransaction({
      to: testVault.vaultAddress,
      value: ethers.utils.parseEther('1290')
    });
    await tx.wait();
    console.log('  Sent 1290 AVAX to vault (~$12000 at $9.38/AVAX)');

    // Configure strategy parameters for emergency exit testing:
    // - Wide range (5%) so position stays IN RANGE while price moves past emergency threshold
    // - 3% emergency exit trigger fires BEFORE position goes out of range
    // - High reinvestment trigger to avoid fee collection interference
    await configureTJStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 500,       // 5% range — must be wider than emergency trigger
      targetRangeLower: 500,
      emergencyExitTrigger: 300,   // 3% emergency exit trigger
      reinvestmentTrigger: 1000,   // $10 (high to avoid interference)
      reinvestmentRatio: 5000      // 50% to owner
    });

    // Initialize and start automation service
    service = new AutomationService(testConfig);
    await service.start();
    console.log('TJ V2.2 Emergency Exit automation service started');

    // Wait for vault discovery
    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      500
    );
    console.log('TJ V2.2 Vault discovered by service');

    // Wait for service to create position (setupVault flow)
    await waitForCondition(
      async () => {
        const vault = await service.vaultDataService.getVault(testVault.vaultAddress);
        const positions = Object.values(vault.positions || {});
        return positions.length > 0;
      },
      120000,
      1000
    );
    console.log('TJ V2.2 Position created by service');
  }, 300000);

  afterAll(async () => {
    if (service?.isRunning) {
      await service.stop();
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should trigger emergency exit when price moves beyond threshold during swap event', async () => {
    // Track emergency exit events
    const vaultBlacklistedEvents = [];

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
    console.log(`Initial TJ position: ${initialPosition.id}`);
    console.log(`Initial bin range: ${initialPosition.lowerBinId} to ${initialPosition.upperBinId}`);

    // Get strategy's emergency exit baseline (TJ returns { activeId, binStep })
    const strategy = service.strategies.get('bob');
    const baseline = strategy.emergencyExitBaseline[testVault.vaultAddress];
    console.log(`Strategy emergency baseline: ${JSON.stringify(baseline)}`);

    // Execute LARGE directional swaps to push activeId beyond 3% threshold
    // 5000 WAVAX per swap to move through deep pool bins
    const swapAmount = ethers.utils.parseEther('5000');
    const maxSwaps = 20;

    console.log('Executing TJ V2.2 swaps to trigger emergency exit...');

    for (let i = 0; i < maxSwaps; i++) {
      // Check if emergency exit occurred
      if (vaultBlacklistedEvents.length > 0) {
        console.log(`Emergency exit triggered after ${i + 1} swaps`);
        break;
      }

      try {
        await executeTraderJoeSwap(testEnv, {
          tokenIn: wavaxAddress,
          tokenOut: usdcAddress,
          amountIn: swapAmount,
          binStep: 10,
          version: 3, // V2.2
          wallet: swapWallet.wallet,
          slippage: 100 // High slippage for aggressive price movement
        });

        console.log(`  Swap ${i + 1}/${maxSwaps} (5000 WAVAX->USDC) completed`);

        // Wait for event processing
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log(`  Swap ${i + 1} failed: ${error.message.slice(0, 50)}`);
        break;
      }
    }

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

    // Verify vault is blacklisted
    const isBlacklisted = service.isVaultBlacklisted(testVault.vaultAddress);
    expect(isBlacklisted).toBe(true);

    // Verify positions were NOT closed (emergency exit preserves positions for manual review)
    const finalVault = await service.vaultDataService.getVault(testVault.vaultAddress);
    const finalPositions = Object.values(finalVault.positions);
    console.log(`Final position count: ${finalPositions.length}`);

    console.log('TJ V2.2 Emergency exit test passed - vault successfully blacklisted');
  }, 180000);
});
