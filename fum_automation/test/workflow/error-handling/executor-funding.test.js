/**
 * @fileoverview Test executor funding error scenarios and recovery paths
 *
 * Tests:
 * 1. Recovery via vault.fundExecutor() — on-chain ExecutorFunded event triggers clearFundingRequired
 * 2. Recovery via raw ETH transfer — interval balance check detects recovery
 * 3. Vault exclusion from swap processing while locked in funding-required state
 *
 * All tests use V3 (USDC/WETH) vault for simplicity — same pattern as rebalance.test.js.
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
import { waitForCondition, sleep } from '../../helpers/wait-utils.js';
import { ethers } from 'ethers';
import { UniswapV3Adapter } from 'fum_library/adapters';
import { getMinExecutorBalance } from 'fum_library/helpers/chainHelpers';
import { getVaultContract } from 'fum_library/blockchain';

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

/**
 * Helper: drain executor to zero and trigger a rebalance to cause InsufficientGasError.
 * Returns after ExecutorFundingRequired event is emitted.
 */
async function drainAndTriggerFundingRequired({
  testEnv, service, testVault, swapWallet, adapter, fundingRequiredEvents
}) {
  const executorAddress = testVault.executorAddress;
  const wethAddress = getTokenAddressForTest('WETH', 1337);
  const usdcAddress = getTokenAddressForTest('USDC', 1337);

  // Drain executor to zero — any transaction attempt will fail with INSUFFICIENT_FUNDS
  console.log(`Draining executor ${executorAddress} to zero...`);
  await testEnv.hardhatServer.provider.send('hardhat_setBalance', [
    executorAddress,
    '0x0'
  ]);

  const balance = await testEnv.hardhatServer.provider.getBalance(executorAddress);
  console.log(`Executor balance: ${ethers.utils.formatEther(balance)} ETH`);

  // Execute large swaps to move tick out of range — triggers rebalance attempt
  // which fails with InsufficientGasError (executor can't pay gas)
  const swapAmount = ethers.utils.parseUnits('20', 18);
  const maxSwaps = 30;

  console.log('Executing swaps to move tick out of range...');
  for (let i = 0; i < maxSwaps; i++) {
    if (fundingRequiredEvents.length > 0) {
      console.log(`Funding-required triggered after ${i} swaps`);
      break;
    }

    try {
      await executeSwap(testEnv, {
        tokenIn: wethAddress,
        tokenOut: usdcAddress,
        amountIn: swapAmount,
        fee: 500,
        wallet: swapWallet.wallet,
        slippage: 100
      });

      const poolData = await adapter._fetchPoolData(usdcAddress, wethAddress, 500, testEnv.hardhatServer.provider);
      console.log(`  Swap ${i + 1}: current tick = ${poolData.tick}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.log(`  Swap ${i + 1} failed: ${error.message.slice(0, 80)}`);
      break;
    }
  }

  // Wait for funding-required state
  await waitForCondition(
    () => fundingRequiredEvents.length > 0,
    60000,
    1000
  );
}

// ============================================================================
// Recovery via vault.fundExecutor() — On-Chain Event Path
// ============================================================================
describe('Executor Funding — Recovery via fundExecutor()', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;
  let adapter;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    console.log('Test blockchain connected');

    // Setup swap wallet
    const swapSetup = await setupSwapWallet(testEnv, {
      ethAmount: '1000',
      wethAmount: '800',
      usdcAmount: '300'
    });
    swapWallet = swapSetup;

    adapter = new UniswapV3Adapter(1337);

    // Create USDC/WETH vault
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Funding Recovery - fundExecutor',
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 100,
          tickRange: { type: 'centered', spacing: 3 }
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Test vault created: ${testVault.vaultAddress}`);

    await configureStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 25,
      targetRangeLower: 25,
      rebalanceThresholdUpper: 150,
      rebalanceThresholdLower: 150,
      emergencyExitTrigger: 500,
      reinvestmentTrigger: 500,
      reinvestmentRatio: 5000
    });

    // Start service with balance check interval for recovery detection
    service = new AutomationService({
      ...testEnv.testConfig,
      vaultHealthIntervalMs: 10000
    });
    await service.start();
    console.log('Automation service started');

    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      500
    );
    console.log('Vault discovered by service');
  }, 180000);

  afterAll(async () => {
    if (service) {
      try {
        await service.stop(true);
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should enter funding-required and recover when owner calls vault.fundExecutor()', async () => {
    const fundingRequiredEvents = [];
    const fundingClearedEvents = [];
    const holdbackSetEvents = [];

    service.eventManager.subscribe('ExecutorFundingRequired', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        fundingRequiredEvents.push(data);
        console.log(`ExecutorFundingRequired: ${data.vaultAddress}`);
      }
    });
    service.eventManager.subscribe('ExecutorFundingCleared', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        fundingClearedEvents.push(data);
        console.log(`ExecutorFundingCleared: ${data.vaultAddress}`);
      }
    });
    service.eventManager.subscribe('ExecutorHoldbackSet', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        holdbackSetEvents.push(data);
      }
    });

    // Drain executor and trigger funding-required via swap event
    await drainAndTriggerFundingRequired({
      testEnv, service, testVault, swapWallet, adapter, fundingRequiredEvents
    });

    // Assert funding-required entered
    expect(service.vaultHealth.fundingRequired.has(testVault.vaultAddress)).toBe(true);
    expect(service.vaultHealth.onChainListeners.has(testVault.vaultAddress)).toBe(true);
    console.log('Funding-required state confirmed');

    // Recover: owner calls vault.fundExecutor() directly
    // First, send native ETH to vault (vault needs balance for fundExecutor)
    const deployer = testEnv.deployer;
    await (await deployer.sendTransaction({
      to: testVault.vaultAddress,
      value: ethers.utils.parseEther('0.01')
    })).wait();

    // Owner calls fundExecutor via vault contract
    const ownerVault = getVaultContract(testVault.vaultAddress, testEnv.hardhatServer.provider)
      .connect(deployer);
    const fundTx = await ownerVault.fundExecutor(ethers.utils.parseEther('0.004'));
    await fundTx.wait();
    console.log('Owner called vault.fundExecutor(0.004 ETH)');

    // Wait for ExecutorFundingCleared (on-chain listener detects ExecutorFunded event)
    await waitForCondition(
      () => fundingClearedEvents.length > 0,
      20000,
      500
    );

    // Assert recovery
    expect(service.vaultHealth.fundingRequired.has(testVault.vaultAddress)).toBe(false);
    expect(service.vaultHealth.onChainListeners.has(testVault.vaultAddress)).toBe(false);
    expect(service.vaultHealth.holdbacks.has(testVault.vaultAddress)).toBe(false);

    // Executor balance should be recovered
    const executorBalance = await testEnv.hardhatServer.provider.getBalance(testVault.executorAddress);
    const executorBalanceEth = parseFloat(ethers.utils.formatEther(executorBalance));
    expect(executorBalanceEth).toBeGreaterThanOrEqual(getMinExecutorBalance(1337));
    console.log(`Executor balance recovered: ${executorBalanceEth.toFixed(6)} ETH`);

    console.log('fundExecutor() recovery test passed');
  }, 240000);
});

// ============================================================================
// Recovery via Raw ETH Transfer — Interval Check Path
// ============================================================================
describe('Executor Funding — Recovery via Raw ETH Transfer', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;
  let adapter;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    console.log('Test blockchain connected');

    const swapSetup = await setupSwapWallet(testEnv, {
      ethAmount: '1000',
      wethAmount: '800',
      usdcAmount: '300'
    });
    swapWallet = swapSetup;

    adapter = new UniswapV3Adapter(1337);

    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Funding Recovery - Raw ETH',
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 100,
          tickRange: { type: 'centered', spacing: 3 }
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Test vault created: ${testVault.vaultAddress}`);

    await configureStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 25,
      targetRangeLower: 25,
      rebalanceThresholdUpper: 150,
      rebalanceThresholdLower: 150,
      emergencyExitTrigger: 500,
      reinvestmentTrigger: 500,
      reinvestmentRatio: 5000
    });

    // 10-second interval for faster recovery detection
    service = new AutomationService({
      ...testEnv.testConfig,
      vaultHealthIntervalMs: 10000
    });
    await service.start();
    console.log('Automation service started');

    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      500
    );
    console.log('Vault discovered by service');
  }, 180000);

  afterAll(async () => {
    if (service) {
      try {
        await service.stop(true);
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should recover when raw ETH is sent directly to executor address', async () => {
    const fundingRequiredEvents = [];
    const fundingClearedEvents = [];

    service.eventManager.subscribe('ExecutorFundingRequired', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        fundingRequiredEvents.push(data);
        console.log(`ExecutorFundingRequired: ${data.vaultAddress}`);
      }
    });
    service.eventManager.subscribe('ExecutorFundingCleared', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        fundingClearedEvents.push(data);
        console.log(`ExecutorFundingCleared: ${data.vaultAddress}`);
      }
    });

    // Drain executor and trigger funding-required
    await drainAndTriggerFundingRequired({
      testEnv, service, testVault, swapWallet, adapter, fundingRequiredEvents
    });

    expect(service.vaultHealth.fundingRequired.has(testVault.vaultAddress)).toBe(true);
    console.log('Funding-required state confirmed');

    // Recover: send raw ETH directly to executor (NOT via vault.fundExecutor)
    // This won't emit ExecutorFunded event — only interval check catches it
    const deployer = testEnv.deployer;
    await (await deployer.sendTransaction({
      to: testVault.executorAddress,
      value: ethers.utils.parseEther('0.005')  // Above minExecutorBalance (0.002)
    })).wait();
    console.log(`Sent 0.005 ETH directly to executor ${testVault.executorAddress}`);

    // Wait for interval check to detect recovery (≤10 seconds per interval)
    await waitForCondition(
      () => fundingClearedEvents.length > 0,
      30000,
      500
    );

    // Assert recovery
    expect(service.vaultHealth.fundingRequired.has(testVault.vaultAddress)).toBe(false);
    expect(service.vaultHealth.onChainListeners.has(testVault.vaultAddress)).toBe(false);
    expect(service.vaultHealth.holdbacks.has(testVault.vaultAddress)).toBe(false);

    const executorBalance = await testEnv.hardhatServer.provider.getBalance(testVault.executorAddress);
    const executorBalanceEth = parseFloat(ethers.utils.formatEther(executorBalance));
    expect(executorBalanceEth).toBeGreaterThanOrEqual(getMinExecutorBalance(1337));
    console.log(`Executor balance: ${executorBalanceEth.toFixed(6)} ETH`);

    console.log('Raw ETH transfer recovery test passed');
  }, 240000);
});

// ============================================================================
// Vault Exclusion — Swap events skipped while in funding-required state
// ============================================================================
describe('Executor Funding — Vault Exclusion While Locked', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;
  let adapter;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    console.log('Test blockchain connected');

    const swapSetup = await setupSwapWallet(testEnv, {
      ethAmount: '1000',
      wethAmount: '800',
      usdcAmount: '300'
    });
    swapWallet = swapSetup;

    adapter = new UniswapV3Adapter(1337);

    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Funding Exclusion Test',
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 100,
          tickRange: { type: 'centered', spacing: 3 }
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Test vault created: ${testVault.vaultAddress}`);

    await configureStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 25,
      targetRangeLower: 25,
      rebalanceThresholdUpper: 150,
      rebalanceThresholdLower: 150,
      emergencyExitTrigger: 500,
      reinvestmentTrigger: 500,
      reinvestmentRatio: 5000
    });

    // Disable balance check interval — we don't want auto-recovery in this test
    service = new AutomationService({
      ...testEnv.testConfig,
      vaultHealthIntervalMs: 0
    });
    await service.start();
    console.log('Automation service started');

    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      500
    );
    console.log('Vault discovered by service');
  }, 180000);

  afterAll(async () => {
    if (service) {
      try {
        await service.stop(true);
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should skip swap event processing while vault is locked in funding-required, then resume after recovery', async () => {
    const fundingRequiredEvents = [];
    const fundingClearedEvents = [];
    const rebalanceEvents = [];
    const feesCollectedEvents = [];
    const newPositionEvents = [];

    service.eventManager.subscribe('ExecutorFundingRequired', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        fundingRequiredEvents.push(data);
        console.log(`ExecutorFundingRequired: ${data.vaultAddress}`);
      }
    });
    service.eventManager.subscribe('ExecutorFundingCleared', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        fundingClearedEvents.push(data);
        console.log(`ExecutorFundingCleared: ${data.vaultAddress}`);
      }
    });
    service.eventManager.subscribe('PositionRebalanced', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        rebalanceEvents.push(data);
        console.log(`PositionRebalanced: ${data.vaultAddress}`);
      }
    });
    service.eventManager.subscribe('FeesCollected', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        feesCollectedEvents.push(data);
        console.log(`FeesCollected: ${data.vaultAddress}`);
      }
    });
    service.eventManager.subscribe('NewPositionCreated', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        newPositionEvents.push(data);
        console.log(`NewPositionCreated: ${data.vaultAddress}`);
      }
    });

    // Drain executor and trigger funding-required
    await drainAndTriggerFundingRequired({
      testEnv, service, testVault, swapWallet, adapter, fundingRequiredEvents
    });

    expect(service.vaultHealth.fundingRequired.has(testVault.vaultAddress)).toBe(true);
    console.log('Funding-required state confirmed — vault should be locked');

    // Record event counts AFTER funding-required is entered
    const rebalanceCountBefore = rebalanceEvents.length;
    const feesCountBefore = feesCollectedEvents.length;
    const newPosCountBefore = newPositionEvents.length;

    // Execute more swaps while vault is locked — these should be skipped
    const wethAddress = getTokenAddressForTest('WETH', 1337);
    const usdcAddress = getTokenAddressForTest('USDC', 1337);

    console.log('Executing swaps while vault is locked...');
    for (let i = 0; i < 3; i++) {
      try {
        await executeSwap(testEnv, {
          tokenIn: wethAddress,
          tokenOut: usdcAddress,
          amountIn: ethers.utils.parseUnits('10', 18),
          fee: 500,
          wallet: swapWallet.wallet,
          slippage: 100
        });
        console.log(`  Locked swap ${i + 1} completed`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log(`  Locked swap ${i + 1} failed: ${error.message.slice(0, 80)}`);
      }
    }

    // Wait a few seconds for event processing to settle
    await sleep(5000);

    // Assert vault did NOT participate — no new activity events
    expect(rebalanceEvents.length).toBe(rebalanceCountBefore);
    expect(feesCollectedEvents.length).toBe(feesCountBefore);
    expect(newPositionEvents.length).toBe(newPosCountBefore);
    expect(service.vaultHealth.fundingRequired.has(testVault.vaultAddress)).toBe(true);
    console.log('Confirmed: vault was excluded from swap processing while locked');

    // Recover: send ETH to executor to restore balance
    const deployer = testEnv.deployer;
    await (await deployer.sendTransaction({
      to: testVault.vaultAddress,
      value: ethers.utils.parseEther('0.01')
    })).wait();

    // Use fundExecutor to trigger on-chain event recovery
    const ownerVault = getVaultContract(testVault.vaultAddress, testEnv.hardhatServer.provider)
      .connect(deployer);
    await (await ownerVault.fundExecutor(ethers.utils.parseEther('0.004'))).wait();
    console.log('Owner called vault.fundExecutor(0.004 ETH) to recover');

    // Wait for funding cleared
    await waitForCondition(
      () => fundingClearedEvents.length > 0,
      20000,
      500
    );

    expect(service.vaultHealth.fundingRequired.has(testVault.vaultAddress)).toBe(false);
    console.log('Funding-required cleared — vault should be unlocked');

    // Execute another swap event — vault should now participate
    // Move price back in the other direction to trigger rebalance
    const postRecoveryRebalanceCount = rebalanceEvents.length;

    console.log('Executing swaps after recovery to verify vault resumes...');
    for (let i = 0; i < 20; i++) {
      if (rebalanceEvents.length > postRecoveryRebalanceCount) {
        console.log(`Post-recovery rebalance triggered after ${i} swaps`);
        break;
      }

      try {
        // Swap USDC → WETH (reverse direction) to move tick
        await executeSwap(testEnv, {
          tokenIn: usdcAddress,
          tokenOut: wethAddress,
          amountIn: ethers.utils.parseUnits('80000', 6),
          fee: 500,
          wallet: swapWallet.wallet,
          slippage: 100
        });
        console.log(`  Recovery swap ${i + 1} completed`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log(`  Recovery swap ${i + 1} failed: ${error.message.slice(0, 80)}`);
        break;
      }
    }

    // Wait for post-recovery activity
    await waitForCondition(
      () => rebalanceEvents.length > postRecoveryRebalanceCount || feesCollectedEvents.length > feesCountBefore,
      60000,
      1000
    );

    // Assert vault is now participating again
    const hasNewActivity = rebalanceEvents.length > postRecoveryRebalanceCount ||
                           feesCollectedEvents.length > feesCountBefore;
    expect(hasNewActivity).toBe(true);
    console.log('Confirmed: vault resumed processing after recovery');

    console.log('Vault exclusion test passed');
  }, 360000);
});
