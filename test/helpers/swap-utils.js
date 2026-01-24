/**
 * @fileoverview Shared utilities for swap event testing
 * Provides helpers for executing swaps and querying pool state
 */

import { ethers } from 'ethers';
import { UniswapV3Adapter } from 'fum_library/adapters';
import { getTokenAddress, getTokenBySymbol } from 'fum_library';
import { getWethAddress } from 'fum_library/helpers/tokenHelpers';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)'
];

const WETH_ABI = [
  'function deposit() payable',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)'
];

/**
 * Get token address, handling WETH specially
 */
export function getTokenAddressForTest(symbol, chainId = 1337) {
  if (symbol === 'WETH') {
    return getWethAddress(chainId);
  }
  return getTokenAddress(symbol, chainId);
}

/**
 * Get token data by symbol, handling WETH specially
 */
export function getTokenDataForTest(symbol) {
  if (symbol === 'WETH') {
    return { symbol: 'WETH', decimals: 18 };
  }
  return getTokenBySymbol(symbol);
}

/**
 * Create and fund a swap wallet for market manipulation
 * @param {Object} testEnv - Test environment from setupTestBlockchain
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Swap wallet with token contracts
 */
export async function setupSwapWallet(testEnv, options = {}) {
  const {
    ethAmount = '1000',
    wethAmount = '800',
    usdcAmount = '300' // Amount of WETH to swap for USDC
  } = options;

  const swapWallet = testEnv.hardhatServer.signers[1];
  const wethAddress = getWethAddress(1337);
  const usdcAddress = getTokenAddress('USDC', 1337);

  // Fund swap wallet with ETH
  const fundTx = await testEnv.deployer.sendTransaction({
    to: swapWallet.address,
    value: ethers.utils.parseEther(ethAmount)
  });
  await fundTx.wait();
  console.log(`  Funded swap wallet with ${ethAmount} ETH`);

  // Wrap ETH to WETH
  const wethContract = new ethers.Contract(wethAddress, WETH_ABI, swapWallet);
  const wrapTx = await wethContract.deposit({ value: ethers.utils.parseEther(wethAmount) });
  await wrapTx.wait();
  console.log(`  Wrapped ${wethAmount} ETH to WETH`);

  // Build USDC reserves if requested
  let usdcBalance = ethers.BigNumber.from(0);
  if (parseFloat(usdcAmount) > 0) {
    const adapter = new UniswapV3Adapter(1337);
    const routerAddress = adapter.addresses.routerAddress;

    // Approve router
    const swapAmountWei = ethers.utils.parseEther(usdcAmount);
    const approveTx = await wethContract.approve(routerAddress, swapAmountWei);
    await approveTx.wait();

    // Swap WETH for USDC
    const swapParams = {
      tokenIn: wethAddress,
      tokenOut: usdcAddress,
      fee: 500,
      recipient: swapWallet.address,
      amountIn: swapAmountWei.toString(),
      slippageTolerance: 1,
      sqrtPriceLimitX96: "0",
      provider: testEnv.hardhatServer.provider,
      deadlineMinutes: 2
    };

    const swapData = await adapter._generateSwapData(swapParams);
    const swapTx = await swapWallet.sendTransaction({
      to: swapData.to,
      data: swapData.data,
      value: swapData.value
    });
    await swapTx.wait();

    const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, swapWallet);
    usdcBalance = await usdcContract.balanceOf(swapWallet.address);
    console.log(`  Built USDC reserves: ${ethers.utils.formatUnits(usdcBalance, 6)} USDC`);
  }

  return {
    wallet: swapWallet,
    wethAddress,
    usdcAddress,
    wethContract,
    usdcBalance
  };
}

/**
 * Execute a swap on Uniswap V3
 * @param {Object} testEnv - Test environment
 * @param {Object} params - Swap parameters
 * @returns {Promise<Object>} Transaction receipt
 */
export async function executeSwap(testEnv, params) {
  const {
    tokenIn,
    tokenOut,
    amountIn,
    fee = 500,
    wallet,
    slippage = 5,
    nonce
  } = params;

  const adapter = new UniswapV3Adapter(1337);
  const routerAddress = adapter.addresses.routerAddress;

  // Approve router if needed
  const tokenInContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);
  const approveTx = await tokenInContract.approve(routerAddress, amountIn);
  await approveTx.wait();

  // Generate swap data
  const swapData = await adapter._generateSwapData({
    tokenIn,
    tokenOut,
    fee,
    recipient: wallet.address,
    amountIn: amountIn.toString(),
    slippageTolerance: slippage,
    sqrtPriceLimitX96: "0",
    provider: testEnv.hardhatServer.provider,
    deadlineMinutes: 2
  });

  // Execute swap
  const txParams = {
    to: swapData.to,
    data: swapData.data,
    value: swapData.value || 0
  };

  if (nonce !== undefined) {
    txParams.nonce = nonce;
  }

  const tx = await wallet.sendTransaction(txParams);
  return tx.wait();
}

/**
 * Execute multiple swaps to move price in a direction
 * @param {Object} testEnv - Test environment
 * @param {Object} params - Swap parameters
 * @returns {Promise<Object>} Result with swap count and final tick
 */
export async function executeSwapsUntilCondition(testEnv, params) {
  const {
    tokenIn,
    tokenOut,
    amountPerSwap,
    fee = 500,
    wallet,
    slippage = 100, // High slippage for aggressive price movement
    maxSwaps = 30,
    checkCondition, // Function that returns true when condition is met
    onSwap // Optional callback after each swap
  } = params;

  const adapter = new UniswapV3Adapter(1337);
  let swapCount = 0;
  let currentTick;

  for (let i = 0; i < maxSwaps; i++) {
    // Execute swap
    await executeSwap(testEnv, {
      tokenIn,
      tokenOut,
      amountIn: amountPerSwap,
      fee,
      wallet,
      slippage
    });

    swapCount++;

    // Get current tick
    const poolData = await adapter._fetchPoolData(
      tokenIn,
      tokenOut,
      fee,
      testEnv.hardhatServer.provider
    );
    currentTick = poolData.tick;

    if (onSwap) {
      onSwap({ swapCount, currentTick, poolData });
    }

    // Check if condition is met
    if (checkCondition && checkCondition({ currentTick, poolData, swapCount })) {
      break;
    }

    // Small delay between swaps
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { swapCount, currentTick };
}

/**
 * Get current pool tick
 * @param {Object} testEnv - Test environment
 * @param {string} token0 - Token0 address
 * @param {string} token1 - Token1 address
 * @param {number} fee - Fee tier
 * @returns {Promise<number>} Current tick
 */
export async function getPoolTick(testEnv, token0, token1, fee = 500) {
  const adapter = new UniswapV3Adapter(1337);
  const poolData = await adapter._fetchPoolData(token0, token1, fee, testEnv.hardhatServer.provider);
  return poolData.tick;
}

/**
 * Get full pool data
 * @param {Object} testEnv - Test environment
 * @param {string} token0 - Token0 address
 * @param {string} token1 - Token1 address
 * @param {number} fee - Fee tier
 * @returns {Promise<Object>} Pool data
 */
export async function getPoolData(testEnv, token0, token1, fee = 500) {
  const adapter = new UniswapV3Adapter(1337);
  return adapter._fetchPoolData(token0, token1, fee, testEnv.hardhatServer.provider);
}

/**
 * Configure strategy parameters for a vault
 * @param {Object} testEnv - Test environment
 * @param {string} vaultAddress - Vault address
 * @param {Object} vault - Vault contract instance
 * @param {Object} params - Strategy parameters
 */
export async function configureStrategyParameters(testEnv, vaultAddress, vault, params = {}) {
  const {
    targetRangeUpper = 25,    // 0.25%
    targetRangeLower = 25,    // 0.25%
    rebalanceThresholdUpper = 150, // 1.5%
    rebalanceThresholdLower = 150, // 1.5%
    maxSlippage = 500,        // 5%
    emergencyExitTrigger = 50, // 0.5%
    feeReinvestment = true,
    reinvestmentTrigger = 100, // $1.00
    reinvestmentRatio = 5000  // 50%
  } = params;

  const babyStepsStrategyAddress = testEnv.deployedContracts.BabyStepsStrategy;

  // Authorize vault to modify parameters
  const strategyContract = new ethers.Contract(
    babyStepsStrategyAddress,
    ['function authorizeVault(address vault) external'],
    testEnv.hardhatServer.signers[0]
  );

  const authTx = await strategyContract.authorizeVault(vaultAddress);
  await authTx.wait();

  // Encode parameter calls - must match BabyStepsStrategy.sol signatures
  const strategyInterface = new ethers.utils.Interface([
    'function setRangeParameters(uint16 upperRange, uint16 lowerRange) external',
    'function setRiskParameters(uint16 slippage, uint16 exitTrigger) external',
    'function setFeeParameters(bool reinvest, uint256 trigger, uint16 ratio) external'
  ]);

  const setRangeData = strategyInterface.encodeFunctionData('setRangeParameters', [
    targetRangeUpper,
    targetRangeLower
  ]);

  const setRiskData = strategyInterface.encodeFunctionData('setRiskParameters', [
    maxSlippage,
    emergencyExitTrigger
  ]);

  const setFeeData = strategyInterface.encodeFunctionData('setFeeParameters', [
    feeReinvestment,
    reinvestmentTrigger,
    reinvestmentRatio
  ]);

  // Execute through vault
  const executeTx = await vault.execute(
    [babyStepsStrategyAddress, babyStepsStrategyAddress, babyStepsStrategyAddress],
    [setRangeData, setRiskData, setFeeData]
  );
  await executeTx.wait();

  console.log(`  Strategy parameters configured for vault ${vaultAddress}`);
}
