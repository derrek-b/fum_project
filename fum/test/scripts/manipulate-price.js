/**
 * test/scripts/manipulate-price.js
 *
 * NOTE: This script is for local Hardhat testing only
 *
 * Manipulates pool prices to push positions out of range for testing rebalancing.
 * Computes swap amounts from pool liquidity to move price ~0.1% per swap.
 * Uses hardhat_setStorageAt to mint tokens — no pool interaction for token acquisition.
 *
 * Default: WETH/USDC (V3) or ETH/USDC (V4) — matches seed script positions.
 * With --token: targets WETH-paired pools (V3) or ETH-paired pools (V4).
 *
 * Usage:
 *   npm run manipulate-price:up                              # V3 WETH/USDC (default)
 *   npm run manipulate-price:down
 *   npm run manipulate-price:v4:up                           # V4 ETH/USDC
 *   npm run manipulate-price:v4:down
 *   npm run manipulate-price:up -- --token=LINK              # V3 WETH/LINK
 *   npm run manipulate-price:up -- --platform=v4 --token=WBTC # V4 ETH/WBTC
 *
 * Directions:
 *   up   - Buy the base token (push its price up relative to the quote)
 *   down - Sell the base token (push its price down relative to the quote)
 *
 * Token pools:
 *   (default) — WETH/USDC 0.05% (V3) or ETH/USDC 0.05% (V4)
 *   USDT      — WETH/USDT 0.05% (V3) or ETH/USDT 0.05% (V4)
 *   WBTC      — WETH/WBTC 0.05% (V3) or ETH/WBTC 0.05% (V4)
 *   LINK      — WETH/LINK 0.30% (V3) or ETH/LINK 0.30% (V4)
 */

import { ethers } from 'ethers';

// =============================================================================
// Configuration
// =============================================================================

const RPC_URL = 'http://localhost:8545';

// Token addresses (Arbitrum fork)
const NATIVE_ETH = ethers.constants.AddressZero;
const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const WBTC_ADDRESS = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f';
const LINK_ADDRESS = '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4';

// ERC20 balance storage slots (auto-discovered by backtest/discover-slots.js)
const TOKEN_BALANCE_SLOTS = {
  [USDC_ADDRESS.toLowerCase()]: 9,
  [WBTC_ADDRESS.toLowerCase()]: 51,
  [WETH_ADDRESS.toLowerCase()]: 51,
  [LINK_ADDRESS.toLowerCase()]: 51,
  [USDT_ADDRESS.toLowerCase()]: 51,
};

// Token metadata — quote tokens that pair with WETH (V3) or ETH (V4)
const TOKENS = {
  USDC: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC', fee: 500 },
  USDT: { address: USDT_ADDRESS, decimals: 6, symbol: 'USDT', fee: 500 },
  WBTC: { address: WBTC_ADDRESS, decimals: 8, symbol: 'WBTC', fee: 500 },
  LINK: { address: LINK_ADDRESS, decimals: 18, symbol: 'LINK', fee: 3000 },
};

// V3 addresses
const V3_SWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';

// V4 addresses
const UNIVERSAL_ROUTER = '0xa51afafe0263b40edaef0df8781ea9aa03e381a3';
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const STATE_VIEW_ADDRESS = '0x76fd297e2d437cd7f76d50f01afe6160f86e9990';

// V4 action types
const Actions = {
  SWAP_EXACT_IN_SINGLE: 6,
  SETTLE: 11,
  TAKE: 14
};

const POOL_KEY_STRUCT = '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const SWAP_EXACT_IN_SINGLE_STRUCT = `(${POOL_KEY_STRUCT} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`;

// Swap configuration
const CONFIG = {
  INITIAL_ETH_FUNDING: '5000',
  TARGET_PRICE_MOVE: 0.001,  // 0.1% per swap
  NUM_SWAPS: 5,
  SWAP_DELAY: 3000,
};

// =============================================================================
// ABIs
// =============================================================================

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address owner) external view returns (uint256)',
];

const WETH_ABI = [
  ...ERC20_ABI,
  'function deposit() external payable',
];

const V3_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)'
];

const V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

const V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
];

const STATE_VIEW_ABI = [
  'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) external view returns (uint128)'
];

const PERMIT2_ABI = [
  'function approve(address token, address spender, uint160 amount, uint48 expiration) external'
];

// =============================================================================
// Helpers
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  let direction = null;
  let platform = 'v3';
  let token = 'USDC';

  for (const arg of args) {
    if (arg.startsWith('--direction=')) {
      direction = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--platform=')) {
      platform = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--token=')) {
      token = arg.split('=')[1].toUpperCase();
    }
  }

  if (!direction || !['up', 'down'].includes(direction)) {
    console.error('Usage: node manipulate-price.js --direction=<up|down> [--platform=v3|v4] [--token=USDC|USDT|WBTC|LINK]');
    console.error('  up   - Push WETH/ETH price up (buy WETH/ETH with quote token)');
    console.error('  down - Push WETH/ETH price down (sell WETH/ETH for quote token)');
    process.exit(1);
  }

  if (!['v3', 'v4'].includes(platform)) {
    console.error('Invalid platform. Must be v3 or v4.');
    process.exit(1);
  }

  if (!TOKENS[token]) {
    console.error(`Unknown token: ${token}. Available: ${Object.keys(TOKENS).join(', ')}`);
    process.exit(1);
  }

  return { direction, platform, token };
}

function createDeadline(minutes = 20) {
  return Math.floor(Date.now() / 1000) + (minutes * 60);
}

function tickToPrice(tick, token0Decimals, token1Decimals) {
  return Math.pow(1.0001, tick) * Math.pow(10, token0Decimals - token1Decimals);
}

function buildV4PoolKey(currency0, currency1, fee) {
  const sorted = currency0.toLowerCase() < currency1.toLowerCase();
  const tickSpacing = fee === 3000 ? 60 : 10;
  return {
    currency0: sorted ? currency0 : currency1,
    currency1: sorted ? currency1 : currency0,
    fee,
    tickSpacing,
    hooks: ethers.constants.AddressZero
  };
}

function computeV4PoolId(poolKey) {
  const encoded = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
  );
  return ethers.utils.keccak256(encoded);
}

/**
 * Compute the amount of token needed to move price by targetPct.
 *
 * For a concentrated liquidity pool:
 *   amount1 = L * (sqrtPrice_new - sqrtPrice_current)  [to move price UP = buy token0 with token1]
 *   amount0 = L * (1/sqrtPrice_new - 1/sqrtPrice_current)  [to move price DOWN = sell token0 for token1]
 *
 * Where sqrtPrice_new = sqrtPrice_current * sqrt(1 + targetPct) for UP
 *   and sqrtPrice_new = sqrtPrice_current * sqrt(1 - targetPct) for DOWN
 *
 * @param {BigNumber} sqrtPriceX96 - Current sqrtPriceX96 from pool
 * @param {BigNumber} liquidity - Active liquidity from pool
 * @param {number} targetPct - Target price move as decimal (0.001 = 0.1%)
 * @param {string} direction - 'up' or 'down'
 * @param {boolean} wethIsToken0 - Whether WETH/ETH is token0 in the pool
 * @returns {BigNumber} Amount of input token needed (in token's smallest units)
 */
function computeSwapAmount(sqrtPriceX96, liquidity, targetPct, direction, wethIsToken0) {
  // Convert sqrtPriceX96 to a float for the calculation
  // sqrtPriceX96 = sqrtPrice * 2^96
  const Q96 = 2 ** 96;
  const sqrtPrice = Number(sqrtPriceX96.toString()) / Q96;

  const L = Number(liquidity.toString());

  if (direction === 'up') {
    // Price up = WETH/ETH gets more expensive
    if (wethIsToken0) {
      // token0 = WETH, token1 = quote. Price up means sqrtPrice increases.
      // We're buying token0 with token1: amount1 = L * (sqrtPrice_new - sqrtPrice_current)
      const sqrtPriceNew = sqrtPrice * Math.sqrt(1 + targetPct);
      const amount1 = L * (sqrtPriceNew - sqrtPrice);
      return ethers.BigNumber.from(Math.ceil(amount1).toLocaleString('fullwide', { useGrouping: false }));
    } else {
      // token0 = quote, token1 = WETH. Price of WETH (token1) up means sqrtPrice decreases.
      // We're selling token0 (quote) to buy token1 (WETH): amount0 = L * (1/sqrtPrice_new - 1/sqrtPrice_current)
      const sqrtPriceNew = sqrtPrice * Math.sqrt(1 / (1 + targetPct));
      const amount0 = L * (1 / sqrtPriceNew - 1 / sqrtPrice);
      return ethers.BigNumber.from(Math.ceil(amount0).toLocaleString('fullwide', { useGrouping: false }));
    }
  } else {
    // Price down = WETH/ETH gets cheaper
    if (wethIsToken0) {
      // token0 = WETH, token1 = quote. Price down means sqrtPrice decreases.
      // We're selling token0 (WETH) for token1: amount0 = L * (1/sqrtPrice_new - 1/sqrtPrice_current)
      const sqrtPriceNew = sqrtPrice * Math.sqrt(1 - targetPct);
      const amount0 = L * (1 / sqrtPriceNew - 1 / sqrtPrice);
      return ethers.BigNumber.from(Math.ceil(amount0).toLocaleString('fullwide', { useGrouping: false }));
    } else {
      // token0 = quote, token1 = WETH. Price of WETH (token1) down means sqrtPrice increases.
      // We're selling token1 (WETH): amount1 = L * (sqrtPrice_new - sqrtPrice_current)
      const sqrtPriceNew = sqrtPrice * Math.sqrt(1 / (1 - targetPct));
      const amount1 = L * (sqrtPriceNew - sqrtPrice);
      return ethers.BigNumber.from(Math.ceil(amount1).toLocaleString('fullwide', { useGrouping: false }));
    }
  }
}

/**
 * Mint ERC20 tokens directly into a wallet using hardhat_setStorageAt.
 */
async function mintToken(provider, tokenAddress, walletAddress, amountBN) {
  const slot = TOKEN_BALANCE_SLOTS[tokenAddress.toLowerCase()];
  if (slot === undefined) {
    throw new Error(`No storage slot found for token ${tokenAddress}`);
  }

  const storageSlot = ethers.utils.solidityKeccak256(
    ['uint256', 'uint256'],
    [walletAddress, slot]
  );

  await provider.send('hardhat_setStorageAt', [
    tokenAddress,
    storageSlot,
    ethers.utils.hexZeroPad(amountBN.toHexString(), 32)
  ]);
}

// =============================================================================
// V3 Functions
// =============================================================================

async function getV3PoolState(provider, quoteToken, poolFee) {
  const factory = new ethers.Contract(V3_FACTORY, V3_FACTORY_ABI, provider);
  const poolAddress = await factory.getPool(WETH_ADDRESS, quoteToken.address, poolFee);

  if (poolAddress === ethers.constants.AddressZero) return null;

  const pool = new ethers.Contract(poolAddress, V3_POOL_ABI, provider);
  const [slot0, liquidity, token0] = await Promise.all([
    pool.slot0(), pool.liquidity(), pool.token0()
  ]);

  const tick = Number(slot0.tick);
  const wethIsToken0 = token0.toLowerCase() === WETH_ADDRESS.toLowerCase();
  const t0Decimals = wethIsToken0 ? 18 : quoteToken.decimals;
  const t1Decimals = wethIsToken0 ? quoteToken.decimals : 18;
  const rawPrice = tickToPrice(tick, t0Decimals, t1Decimals);
  const wethPrice = wethIsToken0 ? rawPrice : 1 / rawPrice;

  return {
    address: poolAddress,
    tick,
    wethPrice,
    sqrtPriceX96: slot0.sqrtPriceX96,
    liquidity,
    wethIsToken0
  };
}

async function executeV3Swap(wallet, tokenIn, tokenOut, amountIn, poolFee) {
  const router = new ethers.Contract(V3_SWAP_ROUTER, V3_ROUTER_ABI, wallet);
  const tx = await router.exactInputSingle({
    tokenIn, tokenOut,
    fee: poolFee,
    recipient: wallet.address,
    deadline: createDeadline(),
    amountIn,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0
  }, { gasLimit: 500000 });
  return tx.wait();
}

// =============================================================================
// V4 Functions
// =============================================================================

async function getV4PoolState(provider, poolKey, quoteToken) {
  const poolId = computeV4PoolId(poolKey);
  const stateView = new ethers.Contract(STATE_VIEW_ADDRESS, STATE_VIEW_ABI, provider);
  const [slot0, liquidity] = await Promise.all([
    stateView.getSlot0(poolId),
    stateView.getLiquidity(poolId)
  ]);

  const tick = Number(slot0.tick);
  const rawPrice = tickToPrice(tick, 18, quoteToken.decimals);

  return {
    poolId,
    tick,
    wethPrice: rawPrice,
    sqrtPriceX96: slot0.sqrtPriceX96,
    liquidity,
    wethIsToken0: true // ETH (AddressZero) is always currency0
  };
}

async function executeV4Swap(signer, poolKey, tokenIn, tokenOut, amountIn) {
  const zeroForOne = tokenIn.toLowerCase() < tokenOut.toLowerCase();
  const amountInBN = ethers.BigNumber.from(amountIn);

  const swapEncoded = ethers.utils.defaultAbiCoder.encode(
    [SWAP_EXACT_IN_SINGLE_STRUCT],
    [[
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      zeroForOne,
      amountInBN.toString(),
      '0',
      '0x'
    ]]
  );

  const settleEncoded = ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint256', 'bool'],
    [tokenIn, 0, true]
  );

  const takeEncoded = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'uint256'],
    [tokenOut, signer.address, 0]
  );

  const actionBytes = ethers.utils.hexlify([
    Actions.SWAP_EXACT_IN_SINGLE,
    Actions.SETTLE,
    Actions.TAKE
  ]);

  const v4SwapPayload = ethers.utils.defaultAbiCoder.encode(
    ['bytes', 'bytes[]'],
    [actionBytes, [swapEncoded, settleEncoded, takeEncoded]]
  );

  const commands = ethers.utils.hexlify([0x10]);
  const routerInterface = new ethers.utils.Interface([
    'function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable'
  ]);
  const calldata = routerInterface.encodeFunctionData('execute', [
    commands, [v4SwapPayload], createDeadline()
  ]);

  const isNativeIn = tokenIn === NATIVE_ETH;
  const tx = await signer.sendTransaction({
    to: UNIVERSAL_ROUTER,
    data: calldata,
    value: isNativeIn ? amountInBN : 0
  });
  return tx.wait();
}

// =============================================================================
// Pool State Logging
// =============================================================================

async function getPoolState(provider, platform, quoteToken, poolFee, poolKey) {
  if (platform === 'v3') {
    return getV3PoolState(provider, quoteToken, poolFee);
  } else {
    return getV4PoolState(provider, poolKey, quoteToken);
  }
}

function logPoolState(state, platform, quoteToken, label) {
  console.log(`\n${label}`);
  console.log('='.repeat(50));
  const baseSymbol = platform === 'v3' ? 'WETH' : 'ETH';

  if (platform === 'v3') {
    console.log(`Pool: ${state.address}`);
  } else {
    console.log(`Pool ID: ${state.poolId.slice(0, 18)}...`);
  }
  console.log(`Tick: ${state.tick}`);
  console.log(`${baseSymbol}/${quoteToken.symbol}: ${state.wethPrice}`);
  console.log(`Liquidity: ${state.liquidity.toString()}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const { direction, platform, token } = parseArgs();
  const quoteToken = TOKENS[token];
  const poolFee = quoteToken.fee;
  const baseSymbol = platform === 'v3' ? 'WETH' : 'ETH';
  const poolKey = platform === 'v4' ? buildV4PoolKey(NATIVE_ETH, quoteToken.address, poolFee) : null;

  console.log('='.repeat(60));
  console.log(`${baseSymbol}/${quoteToken.symbol} Price Manipulation (${platform.toUpperCase()})`);
  console.log(`Direction: ${direction.toUpperCase()} (${direction === 'up' ? `buy ${baseSymbol}` : `sell ${baseSymbol}`})`);
  console.log(`Target: ${(CONFIG.TARGET_PRICE_MOVE * 100).toFixed(1)}% per swap x ${CONFIG.NUM_SWAPS} swaps = ${(CONFIG.TARGET_PRICE_MOVE * 100 * CONFIG.NUM_SWAPS).toFixed(1)}% total`);
  console.log('='.repeat(60));

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = ethers.Wallet.createRandom().connect(provider);
  console.log(`\nSwapper wallet: ${wallet.address}`);

  // Get initial pool state
  const initialState = await getPoolState(provider, platform, quoteToken, poolFee, poolKey);
  if (!initialState) {
    console.error(`${baseSymbol}/${quoteToken.symbol} pool not found. Is the Hardhat fork running?`);
    process.exit(1);
  }
  logPoolState(initialState, platform, quoteToken, 'INITIAL POOL STATE');

  // Fund wallet with ETH for gas (and V4 native swaps for direction=down)
  console.log('\n--- Funding Wallet ---');
  await provider.send('hardhat_setBalance', [
    wallet.address,
    ethers.utils.hexValue(ethers.utils.parseEther(CONFIG.INITIAL_ETH_FUNDING))
  ]);
  console.log(`Funded with ${CONFIG.INITIAL_ETH_FUNDING} ETH`);

  // Setup approvals once
  if (platform === 'v3') {
    await setupV3Approvals(wallet, quoteToken, direction);
  } else {
    await setupV4Approvals(wallet, quoteToken, direction);
  }

  // Execute swaps — recompute amount each iteration from fresh pool state
  console.log(`\n--- Manipulating Price (${direction.toUpperCase()}) ---`);

  for (let i = 0; i < CONFIG.NUM_SWAPS; i++) {
    // Get fresh pool state for accurate swap amount
    const currentState = await getPoolState(provider, platform, quoteToken, poolFee, poolKey);
    const swapAmount = computeSwapAmount(
      currentState.sqrtPriceX96,
      currentState.liquidity,
      CONFIG.TARGET_PRICE_MOVE,
      direction,
      currentState.wethIsToken0
    );

    // Determine input token and format
    let tokenIn, tokenOut, inputSymbol, formattedAmount;
    if (direction === 'up') {
      // Buy WETH/ETH with quote token
      tokenIn = platform === 'v3' ? quoteToken.address : quoteToken.address;
      tokenOut = platform === 'v3' ? WETH_ADDRESS : NATIVE_ETH;
      inputSymbol = quoteToken.symbol;
      formattedAmount = ethers.utils.formatUnits(swapAmount, quoteToken.decimals);

      // Mint the quote tokens we need for this swap
      await mintToken(provider, quoteToken.address, wallet.address, swapAmount);
    } else {
      // Sell WETH/ETH for quote token
      tokenIn = platform === 'v3' ? WETH_ADDRESS : NATIVE_ETH;
      tokenOut = platform === 'v3' ? quoteToken.address : quoteToken.address;
      inputSymbol = baseSymbol;
      formattedAmount = ethers.utils.formatEther(swapAmount);

      if (platform === 'v3') {
        // Mint WETH for this swap
        await mintToken(provider, WETH_ADDRESS, wallet.address, swapAmount);
      }
      // V4 direction=down uses native ETH from hardhat_setBalance — already funded
    }

    console.log(`  Swap ${i + 1}/${CONFIG.NUM_SWAPS}: ${formattedAmount} ${inputSymbol} → ${direction === 'up' ? baseSymbol : quoteToken.symbol} (~${(CONFIG.TARGET_PRICE_MOVE * 100).toFixed(1)}%)`);

    if (platform === 'v3') {
      await executeV3Swap(wallet, tokenIn, tokenOut, swapAmount, poolFee);
    } else {
      await executeV4Swap(wallet, poolKey, tokenIn, tokenOut, swapAmount);
    }

    if (CONFIG.SWAP_DELAY > 0 && i < CONFIG.NUM_SWAPS - 1) {
      await new Promise(r => setTimeout(r, CONFIG.SWAP_DELAY));
    }
  }

  // Log final pool state
  const finalState = await getPoolState(provider, platform, quoteToken, poolFee, poolKey);
  logPoolState(finalState, platform, quoteToken, 'FINAL POOL STATE');

  const tickDelta = finalState.tick - initialState.tick;
  const priceDelta = finalState.wethPrice - initialState.wethPrice;
  const pctChange = (priceDelta / initialState.wethPrice) * 100;
  console.log(`\nTick change: ${tickDelta > 0 ? '+' : ''}${tickDelta}`);
  console.log(`Price: ${initialState.wethPrice} → ${finalState.wethPrice}`);
  console.log(`Price delta: ${priceDelta}`);
  console.log(`Percent change: ${pctChange}%`);

  console.log('\nDone!');
}

// =============================================================================
// Approval Setup
// =============================================================================

async function setupV3Approvals(wallet, quoteToken, direction) {
  console.log('\nApproving tokens for V3 router...');
  if (direction === 'up') {
    const quoteContract = new ethers.Contract(quoteToken.address, ERC20_ABI, wallet);
    await (await quoteContract.approve(V3_SWAP_ROUTER, ethers.constants.MaxUint256)).wait();
  } else {
    const wethContract = new ethers.Contract(WETH_ADDRESS, ERC20_ABI, wallet);
    await (await wethContract.approve(V3_SWAP_ROUTER, ethers.constants.MaxUint256)).wait();
  }
}

async function setupV4Approvals(wallet, quoteToken, direction) {
  if (direction === 'up') {
    // Approve quote token via Permit2 → Universal Router
    const quoteContract = new ethers.Contract(quoteToken.address, ERC20_ABI, wallet);
    console.log(`\nSetting up Permit2 approvals for ${quoteToken.symbol}...`);
    await (await quoteContract.approve(PERMIT2_ADDRESS, ethers.constants.MaxUint256)).wait();
    const permit2 = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, wallet);
    const maxAmount = ethers.BigNumber.from(2).pow(160).sub(1);
    const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
    await (await permit2.approve(quoteToken.address, UNIVERSAL_ROUTER, maxAmount, expiration)).wait();
  }
  // V4 direction=down uses native ETH — no approval needed
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
