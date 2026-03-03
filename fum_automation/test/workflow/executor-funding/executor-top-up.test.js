/**
 * @fileoverview Test executor top-up via distinct funding source paths
 *
 * Tests:
 * 1. Unwrap path — vault has WETH but no native ETH, forces WETH unwrap for top-up
 * 2. ERC20 swap path — vault has only non-native ERC20s, forces ERC20→native swap
 *
 * Each describe block has its own setupTestBlockchain() for full isolation.
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
import { getMinExecutorBalance, getMaxExecutorBalance } from 'fum_library/helpers/chainHelpers';

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

// ============================================================================
// Unwrap Path — USDC/WETH vault, no native ETH
// ============================================================================
describe('Executor Top-Up — Unwrap Path (USDC/WETH)', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;
  let adapter;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    console.log('Test blockchain connected');

    // Setup swap wallet for market manipulation
    console.log('Setting up swap wallet...');
    const swapSetup = await setupSwapWallet(testEnv, {
      ethAmount: '1000',
      wethAmount: '800',
      usdcAmount: '300'
    });
    swapWallet = swapSetup;

    adapter = new UniswapV3Adapter(1337);

    // Create vault with NO native ETH — forces unwrap path in attemptTopUp
    console.log('Creating test vault (no native ETH)...');
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Top-Up Unwrap Path',
        wrapEthAmount: '10',
        nativeEthAmount: null,           // No native ETH in vault — forces unwrap path
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 100,
          tickRange: { type: 'centered', spacing: 3 }   // Tight for easy rebalance
        }],
        tokenTransfers: { 'WETH': 60, 'USDC': 60 },
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Test vault created: ${testVault.vaultAddress}`);

    // Configure strategy: tight range for rebalancing, high fee/emergency triggers to avoid interference
    await configureStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 25,        // 0.25% range
      targetRangeLower: 25,
      rebalanceThresholdUpper: 150, // 1.5% threshold
      rebalanceThresholdLower: 150,
      emergencyExitTrigger: 500,   // 5% (high — avoid triggering)
      reinvestmentTrigger: 500,    // $5.00 (high — avoid fee collection interference)
      reinvestmentRatio: 5000
    });

    // Start service with 10-second balance check interval
    service = new AutomationService({
      ...testEnv.testConfig,
      vaultHealthIntervalMs: 10000
    });
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

  it('should set holdback, deduct from deployment, then top up executor via unwrap path', async () => {
    // ── Comprehensive event capture for diagnostics ──
    const holdbackSetEvents = [];
    const executorFundedEvents = [];
    const holdbackClearedEvents = [];
    const rebalanceEvents = [];
    const deploymentCalcEvents = [];
    const tokenPrepEvents = [];
    const positionsClosedEvents = [];
    const newPositionEvents = [];
    const tokensSwappedEvents = [];
    const topUpFailedEvents = [];
    const vaultUnlockedEvents = [];

    const VA = testVault.vaultAddress;  // shorthand for filter

    service.eventManager.subscribe('ExecutorHoldbackSet', (data) => {
      if (data.vaultAddress === VA) {
        holdbackSetEvents.push(data);
        console.log(`📊 ExecutorHoldbackSet: deficit ${data.deficitNative} native ($${data.holdbackUsd}), currentBalance=${data.currentBalance}, min=${data.minBalance}, max=${data.maxBalance}`);
      }
    });
    service.eventManager.subscribe('ExecutorFunded', (data) => {
      if (data.vaultAddress === VA) {
        executorFundedEvents.push(data);
        console.log(`📊 ExecutorFunded: ${data.amount} native to ${data.executorAddress}, tx=${data.transactionHash}`);
      }
    });
    service.eventManager.subscribe('ExecutorHoldbackCleared', (data) => {
      if (data.vaultAddress === VA) {
        holdbackClearedEvents.push(data);
        console.log(`📊 ExecutorHoldbackCleared for ${data.vaultAddress}`);
      }
    });
    service.eventManager.subscribe('ExecutorTopUpFailed', (data) => {
      if (data.vaultAddress === VA) {
        topUpFailedEvents.push(data);
        console.log(`📊 ExecutorTopUpFailed: ${data.error}`);
      }
    });
    service.eventManager.subscribe('PositionRebalanced', (data) => {
      if (data.vaultAddress === VA) {
        rebalanceEvents.push(data);
        console.log(`📊 PositionRebalanced: old position ${data.oldPositionId}`);
      }
    });
    service.eventManager.subscribe('DeploymentCalculated', (data) => {
      if (data.vaultAddress === VA) {
        deploymentCalcEvents.push(data);
        console.log(`📊 DeploymentCalculated: totalValue=$${data.totalVaultValue?.toFixed(2)}, tokenValue=$${data.tokenValue?.toFixed(2)}, holdback=$${data.holdbackAmount?.toFixed(2)}, available=$${data.availableDeployment?.toFixed(2)}, min=$${data.minDeployment?.toFixed(2)}`);
      }
    });
    service.eventManager.subscribe('TokenPreparationCompleted', (data) => {
      if (data.vaultAddress === VA) {
        tokenPrepEvents.push(data);
        const t0 = data.targetTokens?.token0;
        const t1 = data.targetTokens?.token1;
        console.log(`📊 TokenPreparationCompleted [${data.preparationResult}]: ${t0?.symbol} required=${t0?.required} avail=${t0?.available} deficit=${t0?.deficit}, ${t1?.symbol} required=${t1?.required} avail=${t1?.available} deficit=${t1?.deficit}`);
        if (data.wrapUnwrap) {
          console.log(`📊   wrap=${data.wrapUnwrap.wrapAmount}, unwrap=${data.wrapUnwrap.unwrapAmount}, deficitSwaps=${data.deficitSwapCount}`);
        }
      }
    });
    service.eventManager.subscribe('PositionsClosed', (data) => {
      if (data.vaultAddress === VA) {
        positionsClosedEvents.push(data);
        console.log(`📊 PositionsClosed: ${data.closedCount} position(s), tx=${data.transactionHash}`);
      }
    });
    service.eventManager.subscribe('NewPositionCreated', (data) => {
      if (data.vaultAddress === VA) {
        newPositionEvents.push(data);
        console.log(`📊 NewPositionCreated: positionId=${data.positionId}, tx=${data.transactionHash}`);
      }
    });
    service.eventManager.subscribe('TokensSwapped', (data) => {
      if (data.vaultAddress === VA) {
        tokensSwappedEvents.push(data);
        console.log(`📊 TokensSwapped: ${data.swapCount || data.swapTransactions?.length || '?'} swap(s), tx=${data.transactionHash}`);
      }
    });
    service.eventManager.subscribe('VaultUnlocked', (data) => {
      if (data.vaultAddress === VA) {
        vaultUnlockedEvents.push(data);
        console.log(`📊 VaultUnlocked: ${data.vaultAddress} (has holdback: ${service.vaultHealth.holdbacks.has(VA)})`);
      }
    });

    const executorAddress = testVault.executorAddress;
    const minBalance = getMinExecutorBalance(1337);

    // Drain executor to just below min (0.0019 < 0.002 min) — leave enough gas for
    // rebalance + VaultHealth top-up at Hardhat fork gas prices (~1.5 gwei)
    console.log(`Draining executor ${executorAddress} to 0.00199 ETH...`);
    await testEnv.hardhatServer.provider.send('hardhat_setBalance', [
      executorAddress,
      ethers.utils.hexValue(ethers.utils.parseEther('0.00199'))
    ]);

    const drainedBalance = await testEnv.hardhatServer.provider.getBalance(executorAddress);
    console.log(`Executor balance after drain: ${ethers.utils.formatEther(drainedBalance)} ETH`);

    // Wait for holdback to be set (next interval check, ≤10 seconds)
    await waitForCondition(
      () => holdbackSetEvents.length > 0,
      20000,
      500
    );

    // Assert holdback set
    expect(service.vaultHealth.holdbacks.has(testVault.vaultAddress)).toBe(true);
    const holdbackAmount = service.vaultHealth.getHoldbackAmount(testVault.vaultAddress);
    expect(holdbackAmount).toBeGreaterThan(0);
    console.log(`Holdback set: $${holdbackAmount.toFixed(2)} USD`);

    // Trigger rebalance by executing large swaps (USDC → WETH direction, push price UP).
    // This is critical: pushing the tick UP means the position goes out of range on the
    // UPPER side. After close, the vault receives mostly USDC. The deficit swap then
    // converts excess USDC → WETH. The mint consumes all USDC and leaves WETH surplus.
    // That surplus WETH is what VaultHealth unwraps for the executor top-up.
    // (Swapping the OTHER direction — WETH→USDC — would leave USDC surplus and zero WETH,
    // which is what was happening before this fix.)
    const wethAddress = getTokenAddressForTest('WETH', 1337);
    const usdcAddress = getTokenAddressForTest('USDC', 1337);
    const swapAmount = ethers.utils.parseUnits('40000', 6); // 40k USDC per swap (~20 ETH equivalent)
    const maxSwaps = 30;

    console.log('Executing swaps to trigger rebalance (USDC → WETH, pushing tick UP)...');
    for (let i = 0; i < maxSwaps; i++) {
      if (rebalanceEvents.length > 0) {
        console.log(`Rebalance triggered after ${i} swaps`);
        break;
      }

      try {
        await executeSwap(testEnv, {
          tokenIn: usdcAddress,
          tokenOut: wethAddress,
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

    // Wait for rebalance
    await waitForCondition(
      () => rebalanceEvents.length > 0,
      60000,
      1000
    );
    expect(rebalanceEvents.length).toBeGreaterThan(0);
    console.log('Rebalance completed');

    // ── Post-rebalance diagnostics: dump on-chain and cached balances ──
    const ERC20_DIAG = ['function balanceOf(address) view returns (uint256)'];
    const wethDiag = new ethers.Contract(wethAddress, ERC20_DIAG, testEnv.hardhatServer.provider);
    const usdcDiag = new ethers.Contract(usdcAddress, ERC20_DIAG, testEnv.hardhatServer.provider);

    const onChainNative = await testEnv.hardhatServer.provider.getBalance(testVault.vaultAddress);
    const onChainWeth = await wethDiag.balanceOf(testVault.vaultAddress);
    const onChainUsdc = await usdcDiag.balanceOf(testVault.vaultAddress);

    console.log('─── POST-REBALANCE ON-CHAIN BALANCES ───');
    console.log(`  Native ETH: ${ethers.utils.formatEther(onChainNative)} (${onChainNative.toString()} wei)`);
    console.log(`  WETH:       ${ethers.utils.formatEther(onChainWeth)} (${onChainWeth.toString()} wei)`);
    console.log(`  USDC:       ${ethers.utils.formatUnits(onChainUsdc, 6)} (${onChainUsdc.toString()} raw)`);

    const cachedVault = await service.vaultDataService.getVault(testVault.vaultAddress);
    console.log('─── POST-REBALANCE CACHED BALANCES ───');
    for (const [symbol, balance] of Object.entries(cachedVault.tokens || {})) {
      console.log(`  ${symbol}: ${balance}`);
    }
    console.log('─── EVENT SUMMARY SO FAR ───');
    console.log(`  DeploymentCalculated: ${deploymentCalcEvents.length}`);
    console.log(`  TokenPreparationCompleted: ${tokenPrepEvents.length}`);
    console.log(`  PositionsClosed: ${positionsClosedEvents.length}`);
    console.log(`  NewPositionCreated: ${newPositionEvents.length}`);
    console.log(`  TokensSwapped: ${tokensSwappedEvents.length}`);
    console.log(`  VaultUnlocked: ${vaultUnlockedEvents.length}`);
    console.log(`  ExecutorTopUpFailed: ${topUpFailedEvents.length}`);
    console.log(`  ExecutorFunded: ${executorFundedEvents.length}`);
    console.log('────────────────────────────');

    // Wait for ExecutorFunded event (fires after VaultUnlocked → attemptTopUp → unwrap WETH → fundExecutor)
    // Allow more time — if top-up fails, we want to see the logs before timeout
    let topUpSucceeded = false;
    try {
      await waitForCondition(
        () => executorFundedEvents.length > 0,
        60000,
        1000
      );
      topUpSucceeded = true;
    } catch (timeoutError) {
      // Dump all captured events before failing
      console.log('═══ TOP-UP TIMED OUT — DUMPING ALL CAPTURED EVENTS ═══');
      console.log(`ExecutorTopUpFailed events: ${JSON.stringify(topUpFailedEvents, null, 2)}`);
      console.log(`DeploymentCalculated events: ${JSON.stringify(deploymentCalcEvents.map(e => ({
        holdbackAmount: e.holdbackAmount,
        tokenValue: e.tokenValue,
        availableDeployment: e.availableDeployment,
        totalVaultValue: e.totalVaultValue
      })), null, 2)}`);
      console.log(`TokenPreparationCompleted events: ${JSON.stringify(tokenPrepEvents.map(e => ({
        result: e.preparationResult,
        targetTokens: e.targetTokens,
        wrapUnwrap: e.wrapUnwrap,
        deficitSwapCount: e.deficitSwapCount
      })), null, 2)}`);
      console.log(`VaultUnlocked count: ${vaultUnlockedEvents.length}`);
      console.log('═══ END DUMP ═══');
      throw timeoutError;
    }

    // Assert top-up succeeded
    const fundedEvent = executorFundedEvents[0];
    expect(fundedEvent.vaultAddress).toBe(testVault.vaultAddress);
    expect(fundedEvent.executorAddress).toBe(executorAddress);
    expect(parseFloat(fundedEvent.amount)).toBeGreaterThan(0);
    expect(fundedEvent.transactionHash).toBeDefined();

    // Assert holdback was deducted from at least one deployment calculation
    // (The top-up may clear the holdback before or after the rebalance's deployment calc,
    // so check that ANY deployment calculation included a holdback deduction.)
    expect(deploymentCalcEvents.length).toBeGreaterThan(0);
    const deploymentsWithHoldback = deploymentCalcEvents.filter(e => e.holdbackAmount > 0);
    console.log(`📊 Deployment events: ${deploymentCalcEvents.length} total, ${deploymentsWithHoldback.length} with holdback`);
    if (deploymentsWithHoldback.length > 0) {
      const withHoldback = deploymentsWithHoldback[0];
      console.log(`📊 Deployment with holdback: holdback=$${withHoldback.holdbackAmount?.toFixed(2)}, tokenValue=$${withHoldback.tokenValue?.toFixed(2)}, available=$${withHoldback.availableDeployment?.toFixed(2)}`);
      expect(withHoldback.holdbackAmount).toBeGreaterThan(0);
      expect(withHoldback.availableDeployment).toBeLessThan(withHoldback.tokenValue);
    }

    // Assert holdback cleared
    expect(service.vaultHealth.holdbacks.has(testVault.vaultAddress)).toBe(false);
    expect(service.vaultHealth.getHoldbackAmount(testVault.vaultAddress)).toBe(0);

    // Assert executor balance recovered
    const recoveredBalance = await testEnv.hardhatServer.provider.getBalance(executorAddress);
    const recoveredBalanceEth = parseFloat(ethers.utils.formatEther(recoveredBalance));
    expect(recoveredBalanceEth).toBeGreaterThanOrEqual(minBalance);
    console.log(`Executor balance recovered: ${recoveredBalanceEth.toFixed(6)} ETH (min: ${minBalance})`);

    // ── Final diagnostic summary ──
    console.log('═══ TEST COMPLETE — FULL EVENT SUMMARY ═══');
    console.log(`  HoldbackSet: ${holdbackSetEvents.length}, HoldbackCleared: ${holdbackClearedEvents.length}`);
    console.log(`  DeploymentCalculated: ${deploymentCalcEvents.length}`);
    console.log(`  TokenPreparationCompleted: ${tokenPrepEvents.length}`);
    console.log(`  PositionsClosed: ${positionsClosedEvents.length}, NewPositionCreated: ${newPositionEvents.length}`);
    console.log(`  TokensSwapped: ${tokensSwappedEvents.length}`);
    console.log(`  ExecutorFunded: ${executorFundedEvents.length}, TopUpFailed: ${topUpFailedEvents.length}`);
    console.log(`  VaultUnlocked: ${vaultUnlockedEvents.length}`);
    console.log('═══ END ═══');

    console.log('Unwrap path top-up test passed');
  }, 240000);
});

// ============================================================================
// ERC20 Swap Path — WBTC/USD₮0 vault, no native ETH or WETH
// ============================================================================
describe('Executor Top-Up — ERC20 Swap Path (WBTC/USD₮0)', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;
  let adapter;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    console.log('Test blockchain connected');

    adapter = new UniswapV3Adapter(1337);

    const wbtcAddress = getTokenAddressForTest('WBTC', 1337);
    const usdtAddress = getTokenAddressForTest('USD₮0', 1337);
    const wrappedNativeAddress = getTokenAddressForTest('WETH', 1337);

    // Verify WBTC/USD₮0 500bp pool exists on the fork
    const poolData = await adapter._fetchPoolData(wbtcAddress, usdtAddress, 500, testEnv.hardhatServer.provider);
    console.log(`WBTC/USD₮0 500bp pool: tick=${poolData.tick}, liquidity=${poolData.liquidity}`);

    // Setup custom swap wallet: need WBTC + USD₮0 for bidirectional pool swaps
    console.log('Setting up swap wallet with WBTC + USD₮0 reserves...');
    const swapWalletSigner = testEnv.hardhatServer.signers[1];

    // Fund swap wallet with ETH, wrap to WETH
    await (await testEnv.deployer.sendTransaction({
      to: swapWalletSigner.address,
      value: ethers.utils.parseEther('1000')
    })).wait();

    const WETH_ABI = [
      'function deposit() payable',
      'function approve(address spender, uint256 amount) returns (bool)',
      'function balanceOf(address) view returns (uint256)'
    ];
    const wethContract = new ethers.Contract(wrappedNativeAddress, WETH_ABI, swapWalletSigner);
    await (await wethContract.deposit({ value: ethers.utils.parseEther('900') })).wait();

    // Swap WETH → WBTC via WETH/WBTC 500bp pool
    const swapParams1 = {
      tokenIn: wrappedNativeAddress,
      tokenOut: wbtcAddress,
      fee: 500,
      recipient: swapWalletSigner.address,
      amountIn: ethers.utils.parseEther('400').toString(),
      slippageTolerance: 5,
      sqrtPriceLimitX96: '0',
      provider: testEnv.hardhatServer.provider,
      deadlineMinutes: 2
    };
    const swapData1 = await adapter._generateSwapData(swapParams1);
    await (await wethContract.approve(swapData1.to, ethers.constants.MaxUint256)).wait();
    await (await swapWalletSigner.sendTransaction({ to: swapData1.to, data: swapData1.data, value: swapData1.value })).wait();

    // Swap WETH → USD₮0 via WETH/USD₮0 500bp pool
    const swapParams2 = {
      tokenIn: wrappedNativeAddress,
      tokenOut: usdtAddress,
      fee: 500,
      recipient: swapWalletSigner.address,
      amountIn: ethers.utils.parseEther('400').toString(),
      slippageTolerance: 5,
      sqrtPriceLimitX96: '0',
      provider: testEnv.hardhatServer.provider,
      deadlineMinutes: 2
    };
    const swapData2 = await adapter._generateSwapData(swapParams2);
    await (await wethContract.approve(swapData2.to, ethers.constants.MaxUint256)).wait();
    await (await swapWalletSigner.sendTransaction({ to: swapData2.to, data: swapData2.data, value: swapData2.value })).wait();

    const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
    const wbtcContract = new ethers.Contract(wbtcAddress, ERC20_ABI, swapWalletSigner);
    const usdtContract = new ethers.Contract(usdtAddress, ERC20_ABI, swapWalletSigner);
    const wbtcBal = await wbtcContract.balanceOf(swapWalletSigner.address);
    const usdtBal = await usdtContract.balanceOf(swapWalletSigner.address);
    console.log(`Swap wallet reserves: ${ethers.utils.formatUnits(wbtcBal, 8)} WBTC, ${ethers.utils.formatUnits(usdtBal, 6)} USD₮0`);

    swapWallet = { wallet: swapWalletSigner };

    // Create vault with WBTC/USD₮0 position — no native ETH, no WETH in vault
    // Owner wraps ETH, swaps ALL to WBTC + USD₮0, position uses them
    console.log('Creating test vault (WBTC/USD₮0, no native or WETH)...');
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Top-Up ERC20 Swap Path',
        wrapEthAmount: '10',
        nativeEthAmount: null,           // No native ETH
        swapTokens: [
          { from: 'WETH', to: 'WBTC', amount: '5' },
          { from: 'WETH', to: 'USD₮0', amount: '4.9' }  // Leave almost nothing as WETH
        ],
        positions: [{
          token0: 'WBTC',
          token1: 'USD₮0',
          fee: 500,
          percentOfAssets: 100,
          tickRange: { type: 'centered', spacing: 3 }
        }],
        tokenTransfers: { 'WBTC': 60, 'USD₮0': 60 },
        targetTokens: ['WBTC', 'USD₮0'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Test vault created: ${testVault.vaultAddress}`);

    // Configure strategy
    await configureStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 25,
      targetRangeLower: 25,
      rebalanceThresholdUpper: 150,
      rebalanceThresholdLower: 150,
      emergencyExitTrigger: 500,
      reinvestmentTrigger: 500,    // High — avoid fee collection interference
      reinvestmentRatio: 5000
    });

    // Start service with 10-second balance check interval
    service = new AutomationService({
      ...testEnv.testConfig,
      vaultHealthIntervalMs: 10000
    });
    await service.start();
    console.log('Automation service started');

    // Wait for vault discovery
    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      500
    );
    console.log('Vault discovered by service');
  }, 240000);

  afterAll(async () => {
    if (service?.isRunning) {
      await service.stop();
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should top up executor via ERC20→native swap when vault has no WETH or native ETH', async () => {
    const holdbackSetEvents = [];
    const executorFundedEvents = [];
    const topUpFailedEvents = [];

    const VA = testVault.vaultAddress;

    service.eventManager.subscribe('ExecutorHoldbackSet', (data) => {
      if (data.vaultAddress === VA) {
        holdbackSetEvents.push(data);
        console.log(`📊 ExecutorHoldbackSet: deficit ${data.deficitNative} native ($${data.holdbackUsd})`);
      }
    });
    service.eventManager.subscribe('ExecutorFunded', (data) => {
      if (data.vaultAddress === VA) {
        executorFundedEvents.push(data);
        console.log(`📊 ExecutorFunded: ${data.amount} native to ${data.executorAddress}`);
      }
    });
    service.eventManager.subscribe('ExecutorTopUpFailed', (data) => {
      if (data.vaultAddress === VA) {
        topUpFailedEvents.push(data);
        console.log(`📊 ExecutorTopUpFailed: ${data.error}`);
      }
    });

    const executorAddress = testVault.executorAddress;
    const minBalance = getMinExecutorBalance(1337);

    // Drain executor to just below min (0.00199 < 0.002 min) — leave enough gas for
    // rebalance + VaultHealth ERC20 swap at Hardhat fork gas prices (~1.5 gwei)
    console.log(`Draining executor ${executorAddress} to 0.00199 ETH...`);
    await testEnv.hardhatServer.provider.send('hardhat_setBalance', [
      executorAddress,
      ethers.utils.hexValue(ethers.utils.parseEther('0.00199'))
    ]);

    // Wait for holdback
    await waitForCondition(
      () => holdbackSetEvents.length > 0,
      20000,
      500
    );
    expect(service.vaultHealth.holdbacks.has(VA)).toBe(true);

    // Push the WBTC/USD₮0 pool tick out of position range to trigger a rebalance attempt.
    // The rebalance doesn't need to succeed — we just need a state-changing event
    // (FeesCollected during position close) to set pendingTopUp, then VaultUnlocked
    // triggers the ERC20→native swap top-up. Stop as soon as ExecutorFunded fires.
    const wbtcAddress = getTokenAddressForTest('WBTC', 1337);
    const usdtAddress = getTokenAddressForTest('USD₮0', 1337);
    const swapAmount = ethers.utils.parseUnits('0.1', 8); // 0.1 WBTC (~$7k) per swap
    const maxSwaps = 30;

    console.log('Executing swaps to push WBTC/USD₮0 pool tick out of range...');
    for (let i = 0; i < maxSwaps; i++) {
      if (executorFundedEvents.length > 0) {
        console.log(`Top-up completed after ${i} swaps`);
        break;
      }

      try {
        await executeSwap(testEnv, {
          tokenIn: wbtcAddress,
          tokenOut: usdtAddress,
          amountIn: swapAmount,
          fee: 500,
          wallet: swapWallet.wallet,
          slippage: 100
        });
        console.log(`  Swap ${i + 1} completed`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log(`  Swap ${i + 1} failed: ${error.message.slice(0, 80)}`);
        break;
      }
    }

    // Wait for ExecutorFunded — the core assertion for this test.
    // Flow: swap events → rebalance attempt starts → FeesCollected/PositionsClosed → pendingTopUp set →
    // rebalance completes or fails → VaultUnlocked → attemptTopUp → ERC20→native swap → fundExecutor
    try {
      await waitForCondition(
        () => executorFundedEvents.length > 0,
        90000,
        1000
      );
    } catch (timeoutError) {
      console.log('═══ TOP-UP TIMED OUT — DUMPING EVENTS ═══');
      console.log(`ExecutorTopUpFailed: ${JSON.stringify(topUpFailedEvents, null, 2)}`);
      console.log(`ExecutorFunded: ${executorFundedEvents.length}`);
      console.log(`Holdback still set: ${service.vaultHealth.holdbacks.has(VA)}`);
      console.log('═══ END DUMP ═══');
      throw timeoutError;
    }

    // Assert ERC20 swap path succeeded
    const fundedEvent = executorFundedEvents[0];
    expect(fundedEvent.vaultAddress).toBe(VA);
    expect(fundedEvent.executorAddress).toBe(executorAddress);
    expect(parseFloat(fundedEvent.amount)).toBeGreaterThan(0);

    // Holdback cleared
    expect(service.vaultHealth.holdbacks.has(VA)).toBe(false);

    // Executor balance recovered
    const recoveredBalance = await testEnv.hardhatServer.provider.getBalance(executorAddress);
    const recoveredBalanceEth = parseFloat(ethers.utils.formatEther(recoveredBalance));
    expect(recoveredBalanceEth).toBeGreaterThanOrEqual(minBalance);
    console.log(`Executor balance recovered: ${recoveredBalanceEth.toFixed(6)} ETH (min: ${minBalance})`);

    console.log('ERC20 swap path top-up test passed');
  }, 240000);
});
