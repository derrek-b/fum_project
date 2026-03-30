/**
 * @fileoverview Shared utilities for V4 swap event testing
 * Provides helpers for executing swaps and querying pool state on Uniswap V4
 */

import { ethers } from 'ethers';
import { UniswapV4Adapter } from 'fum_library/adapters';
import { getTokenAddress, getTokenBySymbol, getPlatformAddresses } from 'fum_library';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)'
];

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const NATIVE_ETH = ethers.constants.AddressZero;

// V4 Action types from @uniswap/v4-sdk
const Actions = {
  SWAP_EXACT_IN_SINGLE: 6,
  SETTLE: 11,
  TAKE: 14
};

// Universal Router command types
const CommandType = {
  V4_SWAP: 0x10
};

// ABI encoding helpers
const POOL_KEY_STRUCT = '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const SWAP_EXACT_IN_SINGLE_STRUCT = `(${POOL_KEY_STRUCT} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`;

// Full delta amount constant (used for SETTLE_ALL and TAKE_ALL)
const FULL_DELTA_AMOUNT = 0;

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
  const adapter = new UniswapV4Adapter(1337, testEnv.hardhatServer.provider);
  const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, swapWallet);
  let usdcBalance = ethers.BigNumber.from(0);

  if (parseFloat(usdcAmount) > 0) {
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

    usdcBalance = await usdcContract.balanceOf(swapWallet.address);
    console.log(`  Built USDC reserves via V4: ${ethers.utils.formatUnits(usdcBalance, 6)} USDC`);
  }

  // Always setup Permit2 approval for USDC (needed for USDC -> ETH return swaps)
  // Note: Swaps go through Universal Router, not Position Manager
  await setupPermit2Approval(usdcContract, adapter.addresses.universalRouterAddress, swapWallet);
  console.log(`  Permit2 approval set for USDC`);

  return {
    wallet: swapWallet,
    usdcAddress,
    usdcBalance
  };
}

/**
 * Execute a swap on Uniswap V4 (uses AlphaRouter - may route through different pools)
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
 * Execute a swap directly through a specific V4 pool (bypasses AlphaRouter)
 * Use this for tests that need swaps to hit a specific pool to trigger events.
 *
 * @param {Object} testEnv - Test environment
 * @param {Object} params - Swap parameters
 * @param {string} params.tokenIn - Input token address (use AddressZero for ETH)
 * @param {string} params.tokenOut - Output token address (use AddressZero for ETH)
 * @param {BigNumber|string} params.amountIn - Amount to swap
 * @param {Object} params.wallet - Signer wallet
 * @param {number} [params.fee=500] - Pool fee tier (500 = 5bp)
 * @param {number} [params.tickSpacing=10] - Pool tick spacing
 * @param {number} [params.slippage=5] - Slippage tolerance percentage
 * @returns {Promise<Object>} Transaction receipt
 */
export async function executeV4PoolSwap(_testEnv, params) {
  const {
    tokenIn,
    tokenOut,
    amountIn,
    wallet,
    fee = 500,
    tickSpacing = 10
    // slippage not used - test swaps accept any output (amountOutMinimum = 0)
  } = params;

  const addresses = getPlatformAddresses(1337, 'uniswapV4');
  const universalRouterAddress = addresses.universalRouterAddress;

  // Sort tokens to build poolKey (V4 requires currency0 < currency1)
  const isToken0In = tokenIn.toLowerCase() < tokenOut.toLowerCase();
  const currency0 = isToken0In ? tokenIn : tokenOut;
  const currency1 = isToken0In ? tokenOut : tokenIn;
  const zeroForOne = isToken0In; // true if swapping token0 -> token1

  // Build poolKey
  const poolKey = {
    currency0,
    currency1,
    fee,
    tickSpacing,
    hooks: ethers.constants.AddressZero
  };

  // Calculate minimum output with slippage (we accept 0 for simplicity in tests)
  const amountInBN = ethers.BigNumber.from(amountIn);
  const amountOutMinimum = 0; // Accept any output for test swaps

  // Build V4 swap actions using V4Planner pattern
  // Actions: SWAP_EXACT_IN_SINGLE -> SETTLE_ALL (input) -> TAKE_ALL (output)
  const actions = buildV4SwapActions(poolKey, zeroForOne, amountInBN, amountOutMinimum, tokenIn, tokenOut, wallet.address);

  // Encode Universal Router execute call
  const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes
  const commands = ethers.utils.hexlify([CommandType.V4_SWAP]);
  const inputs = [actions];

  const universalRouterInterface = new ethers.utils.Interface([
    'function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable'
  ]);

  const calldata = universalRouterInterface.encodeFunctionData('execute', [commands, inputs, deadline]);

  // Determine msg.value (only for native ETH input)
  const isNativeIn = tokenIn === NATIVE_ETH;
  const value = isNativeIn ? amountInBN : 0;

  // Execute swap
  const tx = await wallet.sendTransaction({
    to: universalRouterAddress,
    data: calldata,
    value
  });

  return tx.wait();
}

/**
 * Build V4 swap actions (SWAP_EXACT_IN_SINGLE + SETTLE + TAKE)
 * @private
 */
function buildV4SwapActions(poolKey, zeroForOne, amountIn, amountOutMinimum, tokenIn, tokenOut, recipient) {
  // Action 1: SWAP_EXACT_IN_SINGLE
  // Params: ((address,address,uint24,int24,address) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMin, bytes hookData)
  const swapParams = {
    poolKey: [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
    zeroForOne,
    amountIn: amountIn.toString(),
    amountOutMinimum: amountOutMinimum.toString(),
    hookData: '0x'
  };

  const swapEncoded = ethers.utils.defaultAbiCoder.encode(
    [SWAP_EXACT_IN_SINGLE_STRUCT],
    [[swapParams.poolKey, swapParams.zeroForOne, swapParams.amountIn, swapParams.amountOutMinimum, swapParams.hookData]]
  );

  // Action 2: SETTLE (settle input currency from user)
  // Params: (address currency, uint256 amount, bool payerIsUser)
  // For native ETH: settles from msg.value. For ERC20: settles via Permit2 transfer.
  // FULL_DELTA_AMOUNT (0) means settle the full delta owed
  const settleEncoded = ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint256', 'bool'],
    [tokenIn, FULL_DELTA_AMOUNT, true] // payerIsUser = true
  );

  // Action 3: TAKE (take output currency to recipient)
  // Params: (address currency, address recipient, uint256 amount)
  // FULL_DELTA_AMOUNT (0) means take the full delta owed to us
  const takeEncoded = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'uint256'],
    [tokenOut, recipient, FULL_DELTA_AMOUNT]
  );

  // Build action bytes and params array
  // Actions are single bytes concatenated
  const actionBytes = ethers.utils.hexlify([
    Actions.SWAP_EXACT_IN_SINGLE,
    Actions.SETTLE,
    Actions.TAKE
  ]);

  // Encode final V4 swap payload: (bytes actions, bytes[] params)
  return ethers.utils.defaultAbiCoder.encode(
    ['bytes', 'bytes[]'],
    [actionBytes, [swapEncoded, settleEncoded, takeEncoded]]
  );
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

  console.log(`  V4 Strategy parameters configured for vault ${vaultAddress}`);
}
