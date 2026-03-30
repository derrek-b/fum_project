/**
 * @fileoverview Shared utilities for Trader Joe V2.2 swap testing
 * Provides helpers for executing swaps via LBRouter and querying pool state
 */

import { ethers } from 'ethers';
import { TraderJoeV2_2Adapter } from 'fum_library/adapters';
import { getChainConfig, getTokenAddress, getTokenBySymbol } from 'fum_library';
import { getWrappedNativeAddress, isWrappedNativeToken, isNativeToken } from 'fum_library/helpers/tokenHelpers';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)'
];

const WAVAX_ABI = [
  'function deposit() payable',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)'
];

const LB_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) external returns (uint256 amountOut)',
  'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, tuple(uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) external returns (uint256[] amountsIn)'
];

/**
 * Get token address for TJ, handling native and wrapped native tokens
 */
export function getTokenAddressForTJ(symbol, chainId) {
  if (isWrappedNativeToken(symbol)) {
    return getWrappedNativeAddress(chainId);
  }
  if (isNativeToken(symbol)) {
    return ethers.constants.AddressZero;
  }
  return getTokenAddress(symbol, chainId);
}

/**
 * Get token data by symbol, handling native and wrapped native tokens
 */
export function getTokenDataForTJ(symbol) {
  if (isWrappedNativeToken(symbol) || isNativeToken(symbol)) {
    return { symbol, decimals: 18 };
  }
  return getTokenBySymbol(symbol);
}

/**
 * Create and fund a swap wallet for market manipulation (TJ version)
 * @param {Object} testEnv - Test environment from setupTestBlockchain
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Swap wallet with token contracts
 */
export async function setupTJSwapWallet(testEnv, options = {}) {
  const {
    avaxAmount = '1000',
    wavaxAmount = '800',
    usdcAmount = '300' // Amount of WAVAX to swap for USDC
  } = options;

  const network = await testEnv.hardhatServer.provider.getNetwork();
  const chainId = network.chainId;

  const chainConfig = getChainConfig(chainId);
  const traderjoeV2_2 = chainConfig.platformAddresses.traderjoeV2_2;

  const swapWallet = testEnv.hardhatServer.signers[1];
  const wrappedNativeAddress = getWrappedNativeAddress(chainId);
  const usdcAddress = getTokenAddress('USDC', chainId);

  // Fund swap wallet with AVAX
  const fundTx = await testEnv.deployer.sendTransaction({
    to: swapWallet.address,
    value: ethers.utils.parseEther(avaxAmount)
  });
  await fundTx.wait();
  console.log(`  Funded swap wallet with ${avaxAmount} AVAX`);

  // Wrap native to wrapped native
  const wrappedNativeContract = new ethers.Contract(wrappedNativeAddress, WAVAX_ABI, swapWallet);
  const wrapTx = await wrappedNativeContract.deposit({ value: ethers.utils.parseEther(wavaxAmount) });
  await wrapTx.wait();
  console.log(`  Wrapped ${wavaxAmount} native to wrapped native`);

  // Build USDC reserves if requested
  let usdcBalance = ethers.BigNumber.from(0);
  if (parseFloat(usdcAmount) > 0) {
    const lbRouter = new ethers.Contract(traderjoeV2_2.lbRouterAddress, LB_ROUTER_ABI, swapWallet);

    // Approve router
    const swapAmountWei = ethers.utils.parseEther(usdcAmount);
    const approveTx = await wrappedNativeContract.approve(traderjoeV2_2.lbRouterAddress, swapAmountWei);
    await approveTx.wait();

    // Build path for swap
    const path = {
      pairBinSteps: [20], // binStep 20 (0.20%)
      versions: [2],      // Version 2.1
      tokenPath: [wrappedNativeAddress, usdcAddress]
    };

    const deadline = Math.floor(Date.now() / 1000) + 300;

    // Swap wrapped native for USDC
    const swapTx = await lbRouter.swapExactTokensForTokens(
      swapAmountWei,
      0, // amountOutMin
      path,
      swapWallet.address,
      deadline
    );
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
 * Execute a swap on Trader Joe V2.2
 * @param {Object} testEnv - Test environment
 * @param {Object} params - Swap parameters
 * @returns {Promise<Object>} Transaction receipt
 */
export async function executeTraderJoeSwap(testEnv, params) {
  const {
    tokenIn,
    tokenOut,
    amountIn,
    binStep = 20,
    version = 3,
    wallet,
    slippage = 5,
    nonce
  } = params;

  const network = await testEnv.hardhatServer.provider.getNetwork();
  const chainId = network.chainId;

  const chainConfig = getChainConfig(chainId);
  const traderjoeV2_2 = chainConfig.platformAddresses.traderjoeV2_2;

  const lbRouter = new ethers.Contract(traderjoeV2_2.lbRouterAddress, LB_ROUTER_ABI, wallet);

  // Approve router if needed
  const tokenInContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);
  const approveTx = await tokenInContract.approve(traderjoeV2_2.lbRouterAddress, amountIn);
  await approveTx.wait();

  // Build path
  const path = {
    pairBinSteps: [binStep],
    versions: [version],
    tokenPath: [tokenIn, tokenOut]
  };

  const deadline = Math.floor(Date.now() / 1000) + 300;

  // Calculate minimum output with slippage
  // For testing, we just accept 0 min output
  const amountOutMin = 0;

  // Execute swap
  const txParams = {
    to: traderjoeV2_2.lbRouterAddress,
    data: lbRouter.interface.encodeFunctionData('swapExactTokensForTokens', [
      amountIn,
      amountOutMin,
      path,
      wallet.address,
      deadline
    ])
  };

  if (nonce !== undefined) {
    txParams.nonce = nonce;
  }

  const tx = await wallet.sendTransaction(txParams);
  return tx.wait();
}

/**
 * Execute multiple swaps to move price in a direction (TJ version)
 * @param {Object} testEnv - Test environment
 * @param {Object} params - Swap parameters
 * @returns {Promise<Object>} Result with swap count and final activeId
 */
export async function executeTraderJoeSwapsUntilCondition(testEnv, params) {
  const {
    tokenIn,
    tokenOut,
    amountPerSwap,
    binStep = 20,
    wallet,
    maxSwaps = 30,
    checkCondition, // Function that returns true when condition is met
    onSwap          // Optional callback after each swap
  } = params;

  const network = await testEnv.hardhatServer.provider.getNetwork();
  const chainId = network.chainId;

  const adapter = new TraderJoeV2_2Adapter(chainId, testEnv.hardhatServer.provider);

  // Find the LBPair address
  const chainConfig = getChainConfig(chainId);
  const traderjoeV2_2 = chainConfig.platformAddresses.traderjoeV2_2;

  const LB_FACTORY_ABI = [
    'function getLBPairInformation(address tokenX, address tokenY, uint256 binStep) view returns (tuple(uint16 binStep, address LBPair, bool createdByOwner, bool ignoredForRouting))'
  ];
  const lbFactory = new ethers.Contract(
    traderjoeV2_2.lbFactoryAddress,
    LB_FACTORY_ABI,
    testEnv.hardhatServer.provider
  );

  // Sort tokens for factory lookup
  const [sortedTokenA, sortedTokenB] = tokenIn.toLowerCase() < tokenOut.toLowerCase()
    ? [tokenIn, tokenOut]
    : [tokenOut, tokenIn];

  const pairInfo = await lbFactory.getLBPairInformation(sortedTokenA, sortedTokenB, binStep);
  const lbPairAddress = pairInfo.LBPair;

  let swapCount = 0;
  let currentActiveId;

  for (let i = 0; i < maxSwaps; i++) {
    // Execute swap
    await executeTraderJoeSwap(testEnv, {
      tokenIn,
      tokenOut,
      amountIn: amountPerSwap,
      binStep,
      wallet
    });

    swapCount++;

    // Get current activeId
    const poolData = await adapter.getPoolData(lbPairAddress, testEnv.hardhatServer.provider);
    currentActiveId = poolData.activeId;

    if (onSwap) {
      onSwap({ swapCount, currentActiveId, poolData });
    }

    // Check if condition is met
    if (checkCondition && checkCondition({ currentActiveId, poolData, swapCount })) {
      break;
    }

    // Small delay between swaps
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { swapCount, currentActiveId };
}

/**
 * Get current pool active bin ID
 * @param {Object} testEnv - Test environment
 * @param {string} lbPairAddress - LBPair contract address
 * @returns {Promise<number>} Current active bin ID
 */
export async function getPoolActiveId(testEnv, lbPairAddress) {
  const network = await testEnv.hardhatServer.provider.getNetwork();
  const chainId = network.chainId;

  const adapter = new TraderJoeV2_2Adapter(chainId, testEnv.hardhatServer.provider);
  const poolData = await adapter.getPoolData(lbPairAddress, testEnv.hardhatServer.provider);
  return poolData.activeId;
}

/**
 * Get full pool data for a TJ LBPair
 * @param {Object} testEnv - Test environment
 * @param {string} lbPairAddress - LBPair contract address
 * @returns {Promise<Object>} Pool data
 */
export async function getTraderJoePoolData(testEnv, lbPairAddress) {
  const network = await testEnv.hardhatServer.provider.getNetwork();
  const chainId = network.chainId;

  const adapter = new TraderJoeV2_2Adapter(chainId, testEnv.hardhatServer.provider);
  return adapter.getPoolData(lbPairAddress, testEnv.hardhatServer.provider);
}

/**
 * Find LBPair address for a token pair
 * @param {Object} testEnv - Test environment
 * @param {string} tokenA - First token address
 * @param {string} tokenB - Second token address
 * @param {number} binStep - Bin step (fee tier)
 * @returns {Promise<string>} LBPair address
 */
export async function findLBPairAddress(testEnv, tokenA, tokenB, binStep = 20) {
  const network = await testEnv.hardhatServer.provider.getNetwork();
  const chainId = network.chainId;

  const chainConfig = getChainConfig(chainId);
  const traderjoeV2_2 = chainConfig.platformAddresses.traderjoeV2_2;

  const LB_FACTORY_ABI = [
    'function getLBPairInformation(address tokenX, address tokenY, uint256 binStep) view returns (tuple(uint16 binStep, address LBPair, bool createdByOwner, bool ignoredForRouting))'
  ];
  const lbFactory = new ethers.Contract(
    traderjoeV2_2.lbFactoryAddress,
    LB_FACTORY_ABI,
    testEnv.hardhatServer.provider
  );

  // Sort tokens for factory lookup
  const [sortedTokenA, sortedTokenB] = tokenA.toLowerCase() < tokenB.toLowerCase()
    ? [tokenA, tokenB]
    : [tokenB, tokenA];

  const pairInfo = await lbFactory.getLBPairInformation(sortedTokenA, sortedTokenB, binStep);
  return pairInfo.LBPair;
}

/**
 * Configure strategy parameters for a TJ vault
 * @param {Object} testEnv - Test environment
 * @param {string} vaultAddress - Vault address
 * @param {Object} vault - Vault contract instance
 * @param {Object} params - Strategy parameters
 */
export async function configureTJStrategyParameters(testEnv, vaultAddress, vault, params = {}) {
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

  // Encode parameter calls
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

  console.log(`  TJ Strategy parameters configured for vault ${vaultAddress}`);
}
