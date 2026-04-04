/**
 * @fileoverview Shared utilities for swap event testing
 * Provides helpers for executing swaps and querying pool state
 */

import { ethers } from 'ethers';
import { UniswapV3Adapter } from 'fum_library/adapters';
import { getTokenAddress, getTokenBySymbol } from 'fum_library';
import { getWrappedNativeAddress, isWrappedNativeToken } from 'fum_library/helpers/tokenHelpers';

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
 * Get token address, handling wrapped native tokens specially
 */
export function getTokenAddressForTest(symbol, chainId = 1337) {
  if (isWrappedNativeToken(symbol)) {
    return getWrappedNativeAddress(chainId);
  }
  return getTokenAddress(symbol, chainId);
}

/**
 * Get token data by symbol, handling wrapped native tokens specially
 */
export function getTokenDataForTest(symbol) {
  if (isWrappedNativeToken(symbol)) {
    return { symbol, decimals: 18 };
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
  const wrappedNativeAddress = getWrappedNativeAddress(1337);
  const usdcAddress = getTokenAddress('USDC', 1337);

  // Fund swap wallet with ETH
  const fundTx = await testEnv.deployer.sendTransaction({
    to: swapWallet.address,
    value: ethers.utils.parseEther(ethAmount)
  });
  await fundTx.wait();
  console.log(`  Funded swap wallet with ${ethAmount} ETH`);

  // Wrap native to wrapped native
  const wrappedNativeContract = new ethers.Contract(wrappedNativeAddress, WETH_ABI, swapWallet);
  const wrapTx = await wrappedNativeContract.deposit({ value: ethers.utils.parseEther(wethAmount) });
  await wrapTx.wait();
  console.log(`  Wrapped ${wethAmount} native to wrapped native`);

  // Build USDC reserves if requested
  let usdcBalance = ethers.BigNumber.from(0);
  if (parseFloat(usdcAmount) > 0) {
    const adapter = new UniswapV3Adapter(1337);
    const routerAddress = adapter.addresses.routerAddress;

    // Approve router
    const swapAmountWei = ethers.utils.parseEther(usdcAmount);
    const approveTx = await wrappedNativeContract.approve(routerAddress, swapAmountWei);
    await approveTx.wait();

    // Swap wrapped native for USDC
    const swapParams = {
      tokenIn: wrappedNativeAddress,
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
    wrappedNativeAddress,
    usdcAddress,
    wrappedNativeContract,
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
    maxSlippage = 50,        // 0.5%
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

// =============================================================================
// Price-Precise Swap Utilities
// =============================================================================

/**
 * Compute the exact swap amount needed to move pool price by a target percentage.
 * Uses the concentrated liquidity AMM formula with BigInt arithmetic to avoid
 * precision loss on pools with deep liquidity (e.g., Arbitrum WETH/USDC ~$500M TVL).
 *
 * AMM formulas (Uniswap V3/V4):
 *   amount1 = L * (sqrtPrice_new - sqrtPrice)     [buying token0 / selling token1]
 *   amount0 = L * (1/sqrtPrice_new - 1/sqrtPrice) [selling token0 / buying token1]
 *
 * @param {Object} poolData - Pool state with sqrtPriceX96, liquidity, tick
 * @param {Object} options - Configuration
 * @param {number} options.targetPriceMove - Target price move as decimal (0.001 = 0.1%)
 * @param {string} options.direction - 'down' (sell WETH for USDC) or 'up' (buy WETH with USDC)
 * @param {boolean} [options.wethIsToken0=false] - Whether WETH/ETH is token0
 * @returns {{ amount: BigNumber, currentTick: number }}
 */
export function computePriceMovementSwapAmount(poolData, options) {
  const { targetPriceMove, direction, wethIsToken0 = false } = options;

  const sqrtPriceX96 = BigInt(poolData.sqrtPriceX96.toString());
  const L = BigInt(poolData.liquidity.toString());
  const Q96 = 1n << 96n;

  // Compute sqrtPriceNew in Q96 format using float for the ratio, then scale back
  // The ratio sqrt(1 ± pct) is small enough that float precision is fine
  let ratioFloat;
  let needsAmount1; // true = amount1 formula, false = amount0 formula

  if (direction === 'up') {
    if (wethIsToken0) {
      // Price up, weth=token0: sqrtPrice increases, input is token1
      ratioFloat = Math.sqrt(1 + targetPriceMove);
      needsAmount1 = true;
    } else {
      // Price up, weth=token1: sqrtPrice decreases, input is token0
      ratioFloat = Math.sqrt(1 / (1 + targetPriceMove));
      needsAmount1 = false;
    }
  } else {
    if (wethIsToken0) {
      // Price down, weth=token0: sqrtPrice decreases, input is token0
      ratioFloat = Math.sqrt(1 - targetPriceMove);
      needsAmount1 = false;
    } else {
      // Price down, weth=token1: sqrtPrice increases, input is token1
      ratioFloat = Math.sqrt(1 / (1 - targetPriceMove));
      needsAmount1 = true;
    }
  }

  // Scale ratio to BigInt with 18 decimal places of precision
  const SCALE = 10n ** 18n;
  const ratioBig = BigInt(Math.round(ratioFloat * Number(SCALE)));
  const sqrtPriceNewX96 = (sqrtPriceX96 * ratioBig) / SCALE;

  let amount;
  const delta = sqrtPriceNewX96 > sqrtPriceX96
    ? sqrtPriceNewX96 - sqrtPriceX96
    : sqrtPriceX96 - sqrtPriceNewX96;

  if (needsAmount1) {
    // amount1 = L * deltaSqrtPrice / Q96
    amount = (L * delta) / Q96;
  } else {
    // amount0 = L * deltaSqrtPrice / (sqrtPrice * sqrtPriceNew / Q96)
    // Restructured to avoid huge intermediates: divide L*delta by each sqrt separately
    amount = (L * delta / sqrtPriceX96) * Q96 / sqrtPriceNewX96;
  }

  // Add 1% buffer to ensure the swap actually crosses the target
  amount = amount + amount / 100n;

  return {
    amount: ethers.BigNumber.from(amount.toString()),
    currentTick: poolData.tick
  };
}

/**
 * Calculate the number of swaps needed to push a position out of range.
 *
 * @param {number} rangePercent - Position half-range in percent (e.g., 0.25 for ±0.25%)
 * @param {number} pricePerSwap - Price move per swap in percent (e.g., 0.1 for 0.1%)
 * @returns {number} Number of swaps needed (includes 1 extra to land past the edge)
 */
export function calculateSwapsForRange(rangePercent, pricePerSwap) {
  return Math.ceil(rangePercent / pricePerSwap) + 1;
}
