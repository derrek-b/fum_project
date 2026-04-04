/**
 * @fileoverview Test executor top-up via native balance path (V4)
 *
 * V4 positions use native ETH (AddressZero). Closing a V4 position returns native
 * ETH to the vault. When the executor is underfunded:
 * 1. VaultHealth sets holdback → strategy deducts from deployable capital
 * 2. After rebalance (close V4 position → native ETH returns to vault), leftover
 *    native sits in vault because holdback reduced deployment
 * 3. VaultUnlocked fires → attemptTopUp finds vault native balance → fundExecutor
 *
 * This tests the simplest top-up path: native balance available in vault.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../../src/core/AutomationService.js';
import { setupV4TestBlockchain, cleanupV4TestBlockchain } from '../../../helpers/v4-hardhat-setup.js';
import { setupV4TestVault } from '../../../helpers/v4-vault-setup.js';
import {
  setupV4SwapWallet,
  executeV4PoolSwap,
  getV4PoolData,
  configureV4StrategyParameters,
  getV4TokenAddress
} from '../../../helpers/v4-swap-utils.js';
import { waitForCondition } from '../../../helpers/wait-utils.js';
import { getMinExecutorBalance } from 'fum_library/helpers/chainHelpers';

const NATIVE_ETH = ethers.constants.AddressZero;

describe('V4 Executor Top-Up — Native Balance Path', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;

  beforeAll(async () => {
    testEnv = await setupV4TestBlockchain();
    console.log('V4 Test blockchain connected');

    // Setup swap wallet
    console.log('Setting up V4 swap wallet...');
    swapWallet = await setupV4SwapWallet(testEnv, {
      ethAmount: '1000',
      usdcAmount: '0'
    });

    // Create V4 vault with position pre-created during setup (percentOfAssets: 100)
    // This eliminates slow AlphaRouter deficit swaps during service initialization
    console.log('Creating V4 test vault...');
    testVault = await setupV4TestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'V4 Top-Up Native Path',
        nativeEthAmount: '10',
        wrapEthAmount: '10',
        swapTokens: [{ from: 'ETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'ETH',
          token1: 'USDC',
          fee: 500,
          percentOfAssets: 100,
          tickRange: { type: 'centered', spacing: 10 }
        }],
        targetTokens: ['ETH', 'USDC'],
        targetPlatforms: ['uniswapV4'],
        strategy: 'bob'
      }
    );
    console.log(`V4 Test vault created: ${testVault.vaultAddress}`);

    // Configure strategy: wide range, high emergency exit
    await configureV4StrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 500,       // 5% range
      targetRangeLower: 500,
      emergencyExitTrigger: 1000,  // 10% (avoid triggering during aggressive swaps)
      reinvestmentTrigger: 500,    // $5.00 (high — avoid fee collection interference)
      reinvestmentRatio: 5000
    });

    // Start service with 10-second balance check interval
    service = new AutomationService({
      ...testEnv.testConfig,
      vaultHealthIntervalMs: 10000
    });
    await service.start();
    console.log('V4 Automation service started');

    // Wait for vault discovery
    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      500
    );
    console.log('V4 Vault discovered by service');

    // Wait for service to create position
    await waitForCondition(
      async () => {
        const vault = await service.vaultDataService.getVault(testVault.vaultAddress);
        const positions = Object.values(vault.positions || {});
        return positions.length > 0;
      },
      60000,
      1000
    );
    console.log('V4 Position created by service');
  }, 240000);

  afterAll(async () => {
    if (service) {
      try {
        await service.stop(true);
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }
    await cleanupV4TestBlockchain(testEnv);
  });

  it('should set holdback, then top up executor from vault native balance after rebalance', async () => {
    const holdbackSetEvents = [];
    const executorFundedEvents = [];
    const rebalanceEvents = [];

    service.eventManager.subscribe('ExecutorHoldbackSet', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        holdbackSetEvents.push(data);
        console.log(`ExecutorHoldbackSet: deficit ${data.deficitNative} native ($${data.holdbackUsd})`);
      }
    });
    service.eventManager.subscribe('ExecutorFunded', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        executorFundedEvents.push(data);
        console.log(`ExecutorFunded: ${data.amount} native to ${data.executorAddress}`);
      }
    });
    service.eventManager.subscribe('PositionRebalanced', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        rebalanceEvents.push(data);
        console.log(`PositionRebalanced: old position ${data.oldPositionId}`);
      }
    });

    const executorAddress = testVault.executorAddress;
    const minBalance = getMinExecutorBalance(1337);

    // Drain executor to just below min
    console.log(`Draining executor ${executorAddress} to 0.001 ETH...`);
    await testEnv.hardhatServer.provider.send('hardhat_setBalance', [
      executorAddress,
      ethers.utils.hexValue(ethers.utils.parseEther('0.001'))
    ]);

    // Wait for holdback (next interval check, ≤10 seconds)
    await waitForCondition(
      () => holdbackSetEvents.length > 0,
      20000,
      500
    );

    expect(service.vaultHealth.holdbacks.has(testVault.vaultAddress)).toBe(true);
    const holdbackAmount = service.vaultHealth.getHoldbackAmount(testVault.vaultAddress);
    expect(holdbackAmount).toBeGreaterThan(0);
    console.log(`Holdback set: $${holdbackAmount.toFixed(2)} USD`);

    // Trigger rebalance: execute large ETH→USDC swaps to push tick down
    const usdcAddress = getV4TokenAddress('USDC', 1337);
    const swapAmount = ethers.utils.parseEther('50');
    const maxSwaps = 20;

    console.log('Executing V4 swaps to trigger rebalance...');
    for (let i = 0; i < maxSwaps; i++) {
      if (rebalanceEvents.length > 0) {
        console.log(`Rebalance triggered after ${i} swaps`);
        break;
      }

      try {
        await executeV4PoolSwap(testEnv, {
          tokenIn: NATIVE_ETH,
          tokenOut: usdcAddress,
          amountIn: swapAmount,
          wallet: swapWallet.wallet,
          fee: 500,
          tickSpacing: 10,
          slippage: 100
        });

        const poolData = await getV4PoolData(testEnv, NATIVE_ETH, usdcAddress, 500, 10);
        console.log(`  Swap ${i + 1}: current tick = ${poolData.tick}`);

        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log(`  Swap ${i + 1} failed: ${error.message.slice(0, 80)}`);
        break;
      }
    }

    // Wait for rebalance
    await waitForCondition(
      () => rebalanceEvents.length > 0,
      60000,
      1000
    );
    expect(rebalanceEvents.length).toBeGreaterThan(0);
    console.log('V4 Rebalance completed');

    // Wait for ExecutorFunded (VaultUnlocked → attemptTopUp → finds native ETH in vault → fundExecutor)
    // V4 position close returns native ETH to vault. Holdback ensures not all is re-deployed.
    await waitForCondition(
      () => executorFundedEvents.length > 0,
      60000,
      1000
    );

    // Assert top-up succeeded
    const fundedEvent = executorFundedEvents[0];
    expect(fundedEvent.vaultAddress).toBe(testVault.vaultAddress);
    expect(fundedEvent.executorAddress).toBe(executorAddress);
    expect(parseFloat(fundedEvent.amount)).toBeGreaterThan(0);
    expect(fundedEvent.transactionHash).toBeDefined();

    // Holdback cleared
    expect(service.vaultHealth.holdbacks.has(testVault.vaultAddress)).toBe(false);
    expect(service.vaultHealth.getHoldbackAmount(testVault.vaultAddress)).toBe(0);

    // Executor balance recovered
    const recoveredBalance = await testEnv.hardhatServer.provider.getBalance(executorAddress);
    const recoveredBalanceEth = parseFloat(ethers.utils.formatEther(recoveredBalance));
    expect(recoveredBalanceEth).toBeGreaterThanOrEqual(minBalance);
    console.log(`V4 Executor balance recovered: ${recoveredBalanceEth.toFixed(6)} ETH (min: ${minBalance})`);

    console.log('V4 Native balance path top-up test passed');
  }, 240000);
});
