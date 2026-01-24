/**
 * @fileoverview Shared utilities for V4 swap event testing
 * Provides helpers for executing swaps and querying pool state on Uniswap V4
 */

import { ethers } from 'ethers';
import { UniswapV4Adapter } from 'fum_library/adapters';
import { getTokenAddress, getTokenBySymbol } from 'fum_library';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)'
];

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const NATIVE_ETH = ethers.constants.AddressZero;

/**
 * Get token address for V4, handling native ETH
 */
export function getV4TokenAddress(symbol, chainId = 1337) {
  if (symbol === 'ETH') {
    return NATIVE_ETH;
  }
  return getTokenAddress(symbol, chainId);
}

/**
 * Get token data by symbol, handling ETH
 */
export function getV4TokenData(symbol) {
  if (symbol === 'ETH') {
    return { symbol: 'ETH', decimals: 18 };
  }
  return getTokenBySymbol(symbol);
}

/**
 * Setup Permit2 approval for a token (required for V4)
 */
async function setupPermit2Approval(tokenContract, positionManagerAddress, signer) {
  // Step 1: ERC-20 approve to Permit2
  await (await tokenContract.approve(PERMIT2_ADDRESS, ethers.constants.MaxUint256)).wait();

  // Step 2: Permit2 approve to PositionManager
  const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, [
    'function approve(address token, address spender, uint160 amount, uint48 expiration) external'
  ], signer);

  const maxAmount = ethers.BigNumber.from(2).pow(160).sub(1);
  const farFutureExpiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;

  await (await permit2Contract.approve(
    tokenContract.address,
    positionManagerAddress,
    maxAmount,
    farFutureExpiration
  )).wait();
}

/**
 * Create and fund a swap wallet for V4 market manipulation
 * @param {Object} testEnv - Test environment from setupV4TestBlockchain
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Swap wallet with token contracts
 */
export async function setupV4SwapWallet(testEnv, options = {}) {
  const {
    ethAmount = '1000',
    usdcAmount = '300' // Amount of ETH to swap for USDC
  } = options;

  const swapWallet = testEnv.hardhatServer.signers[1];
  const usdcAddress = getTokenAddress('USDC', 1337);

  // Fund swap wallet with ETH
  const fundTx = await testEnv.deployer.sendTransaction({
    to: swapWallet.address,
    value: ethers.utils.parseEther(ethAmount)
  });
  await fundTx.wait();
  console.log(`  Funded V4 swap wallet with ${ethAmount} ETH`);

  // Build USDC reserves if requested via V4 swap
  let usdcBalance = ethers.BigNumber.from(0);
  if (parseFloat(usdcAmount) > 0) {
    const adapter = new UniswapV4Adapter(1337, testEnv.hardhatServer.provider);

    // Swap native ETH for USDC
    const swapAmountWei = ethers.utils.parseEther(usdcAmount);
    const swapData = await adapter._generateSwapData({
      tokenIn: NATIVE_ETH,
      tokenOut: usdcAddress,
      amountIn: swapAmountWei.toString(),
      recipient: swapWallet.address,
      slippageTolerance: 5,
      deadlineMinutes: 20
    });

    const swapTx = await swapWallet.sendTransaction({
      to: swapData.to,
      data: swapData.data,
      value: swapData.value
    });
    await swapTx.wait();

    const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, swapWallet);
    usdcBalance = await usdcContract.balanceOf(swapWallet.address);
    console.log(`  Built USDC reserves via V4: ${ethers.utils.formatUnits(usdcBalance, 6)} USDC`);

    // Setup Permit2 approval for USDC (needed for USDC -> ETH swaps)
    await setupPermit2Approval(usdcContract, adapter.addresses.positionManagerAddress, swapWallet);
    console.log(`  Permit2 approval set for USDC`);
  }

  return {
    wallet: swapWallet,
    usdcAddress,
    usdcBalance
  };
}

/**
 * Execute a swap on Uniswap V4
 * @param {Object} testEnv - Test environment
 * @param {Object} params - Swap parameters
 * @returns {Promise<Object>} Transaction receipt
 */
export async function executeV4Swap(testEnv, params) {
  const {
    tokenIn,
    tokenOut,
    amountIn,
    wallet,
    slippage = 5
  } = params;

  const adapter = new UniswapV4Adapter(1337, testEnv.hardhatServer.provider);

  // For ERC20 input tokens, need Permit2 approval (already set up in setupV4SwapWallet)
  // For native ETH input, no approval needed

  // Generate swap data
  const swapData = await adapter._generateSwapData({
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    recipient: wallet.address,
    slippageTolerance: slippage,
    deadlineMinutes: 20
  });

  // Execute swap
  const tx = await wallet.sendTransaction({
    to: swapData.to,
    data: swapData.data,
    value: swapData.value || 0
  });

  return tx.wait();
}

/**
 * Get V4 pool data
 * @param {Object} testEnv - Test environment
 * @param {string} token0 - Token0 address (use AddressZero for ETH)
 * @param {string} token1 - Token1 address
 * @param {number} fee - Fee tier
 * @param {number} tickSpacing - Tick spacing
 * @returns {Promise<Object>} Pool data
 */
export async function getV4PoolData(testEnv, token0, token1, fee = 500, tickSpacing = 10) {
  const adapter = new UniswapV4Adapter(1337, testEnv.hardhatServer.provider);
  return adapter._fetchPoolData(
    token0,
    token1,
    fee,
    tickSpacing,
    ethers.constants.AddressZero, // No hooks
    testEnv.hardhatServer.provider
  );
}

/**
 * Get current V4 pool tick
 * @param {Object} testEnv - Test environment
 * @param {string} token0 - Token0 address
 * @param {string} token1 - Token1 address
 * @param {number} fee - Fee tier
 * @param {number} tickSpacing - Tick spacing
 * @returns {Promise<number>} Current tick
 */
export async function getV4PoolTick(testEnv, token0, token1, fee = 500, tickSpacing = 10) {
  const poolData = await getV4PoolData(testEnv, token0, token1, fee, tickSpacing);
  return poolData.tick;
}

/**
 * Configure strategy parameters for a vault (same as V3 - strategy contract is platform-agnostic)
 * @param {Object} testEnv - Test environment
 * @param {string} vaultAddress - Vault address
 * @param {Object} vault - Vault contract instance
 * @param {Object} params - Strategy parameters
 */
export async function configureV4StrategyParameters(testEnv, vaultAddress, vault, params = {}) {
  const {
    targetRangeUpper = 25,    // 0.25%
    targetRangeLower = 25,    // 0.25%
    rebalanceThresholdUpper = 150, // 1.5%
    rebalanceThresholdLower = 150, // 1.5%
    maxSlippage = 500,        // 5%
    emergencyExitTrigger = 50, // 0.5%
    maxUtilization = 8000,    // 80%
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

  // Encode parameter calls
  const strategyInterface = new ethers.utils.Interface([
    'function setRangeParameters(uint16 upperRange, uint16 lowerRange) external',
    'function setRiskParameters(uint16 slippage, uint16 exitTrigger, uint16 utilization) external',
    'function setFeeParameters(bool reinvest, uint256 trigger, uint16 ratio) external'
  ]);

  const setRangeData = strategyInterface.encodeFunctionData('setRangeParameters', [
    targetRangeUpper,
    targetRangeLower
  ]);

  const setRiskData = strategyInterface.encodeFunctionData('setRiskParameters', [
    maxSlippage,
    emergencyExitTrigger,
    maxUtilization
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

  console.log(`  V4 Strategy parameters configured for vault ${vaultAddress}`);
}
