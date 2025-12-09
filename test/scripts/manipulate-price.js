/**
 * test/scripts/manipulate-price.js
 *
 * NOTE: This script is for local Ganache testing only
 *
 * Manipulates the USDC/USDT pool price in the Ganache sandbox for testing
 * position rebalancing.
 *
 * Usage: npm run manipulate-price -- --direction=<up|down>
 *
 * Directions:
 *   up   - Buy USDC with USDT (pushes USDC price up relative to USDT)
 *   down - Sell USDC for USDT (pushes USDC price down relative to USDT)
 */

import { ethers } from 'ethers';

// =============================================================================
// Configuration
// =============================================================================

const RPC_URL = 'http://localhost:8545';
const CHAIN_ID = 1337;

// Token addresses (Arbitrum fork)
const TOKENS = {
  WETH: {
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    decimals: 18
  },
  USDC: {
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    decimals: 6
  },
  USDT: {
    address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    decimals: 6
  }
};

// Uniswap V3 addresses
const UNISWAP = {
  router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e'
};

// Fee tiers
const FEE_TIERS = {
  STABLECOIN: 100,  // 0.01% - typical for stablecoin pairs
  LOW: 500,         // 0.05%
  MEDIUM: 3000,     // 0.3%
  HIGH: 10000       // 1%
};

// Swap configuration
const CONFIG = {
  // Amount of ETH to fund the swapper wallet with
  INITIAL_ETH_FUNDING: '2000',

  // Amount of WETH to swap for stablecoins (total)
  // Need enough to cover 5 swaps of 30k each = 150k stables
  WETH_TO_SWAP_FOR_STABLES: '60', // ~$180k worth at $3k ETH

  // Amount per swap in the USDC/USDT pool (in token units)
  SWAP_AMOUNT_USDC: '30000',  // 30k USDC per swap
  SWAP_AMOUNT_USDT: '30000',  // 30k USDT per swap

  // Number of swaps to perform
  NUM_SWAPS: 5,

  // Delay between swaps (ms)
  SWAP_DELAY: 500,

  // Slippage tolerance (100 = accept any price for aggressive price movement)
  SLIPPAGE_TOLERANCE: 100,

  // Fee tier for USDC/USDT pool
  USDC_USDT_FEE: FEE_TIERS.STABLECOIN,

  // Fee tier for WETH/stablecoin pools
  WETH_STABLE_FEE: FEE_TIERS.LOW
};

// =============================================================================
// ABIs
// =============================================================================

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

const WETH_ABI = [
  ...ERC20_ABI,
  'function deposit() external payable',
  'function withdraw(uint256 amount) external'
];

const ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)'
];

const QUOTER_ABI = [
  'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
];

const POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
];

// =============================================================================
// Helper Functions
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  let direction = null;

  for (const arg of args) {
    if (arg.startsWith('--direction=')) {
      direction = arg.split('=')[1].toLowerCase();
    }
  }

  if (!direction || !['up', 'down'].includes(direction)) {
    console.error('Usage: npm run manipulate-price -- --direction=<up|down>');
    console.error('  up   - Push USDC price up (buy USDC with USDT)');
    console.error('  down - Push USDC price down (sell USDC for USDT)');
    process.exit(1);
  }

  return { direction };
}

function createDeadline(minutes = 20) {
  return Math.floor(Date.now() / 1000) + (minutes * 60);
}

async function getPoolInfo(provider, token0, token1, fee) {
  const factory = new ethers.Contract(UNISWAP.factory, FACTORY_ABI, provider);
  const poolAddress = await factory.getPool(token0, token1, fee);

  if (poolAddress === ethers.constants.AddressZero) {
    return null;
  }

  const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
  const [slot0, liquidity, poolToken0, poolToken1] = await Promise.all([
    pool.slot0(),
    pool.liquidity(),
    pool.token0(),
    pool.token1()
  ]);

  return {
    address: poolAddress,
    sqrtPriceX96: slot0.sqrtPriceX96,
    tick: slot0.tick,
    liquidity: liquidity,
    token0: poolToken0,
    token1: poolToken1
  };
}

function tickToPrice(tick, token0Decimals, token1Decimals) {
  // Price = 1.0001^tick * 10^(token0Decimals - token1Decimals)
  const price = Math.pow(1.0001, tick) * Math.pow(10, token0Decimals - token1Decimals);
  return price;
}

async function logPoolState(provider, label) {
  console.log(`\n${label}`);
  console.log('='.repeat(50));

  const poolInfo = await getPoolInfo(
    provider,
    TOKENS.USDC.address,
    TOKENS.USDT.address,
    CONFIG.USDC_USDT_FEE
  );

  if (!poolInfo) {
    console.log('Pool not found!');
    return null;
  }

  // Determine which token is token0 vs token1
  const usdcIsToken0 = poolInfo.token0.toLowerCase() === TOKENS.USDC.address.toLowerCase();

  const price = tickToPrice(poolInfo.tick, 6, 6); // Both have 6 decimals
  const displayPrice = usdcIsToken0 ? price : 1 / price;

  console.log(`Pool Address: ${poolInfo.address}`);
  console.log(`Current Tick: ${poolInfo.tick}`);
  console.log(`USDC/USDT Price: ${displayPrice.toFixed(6)}`);
  console.log(`Liquidity: ${ethers.utils.formatUnits(poolInfo.liquidity, 0)}`);

  return poolInfo;
}

// =============================================================================
// Main Functions
// =============================================================================

async function fundWallet(provider, wallet) {
  console.log('\n--- Funding Wallet ---');

  // Use Ganache's evm_setAccountBalance to fund the wallet
  const balanceHex = ethers.utils.hexValue(
    ethers.utils.parseEther(CONFIG.INITIAL_ETH_FUNDING)
  );

  await provider.send('evm_setAccountBalance', [wallet.address, balanceHex]);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Wallet ${wallet.address} funded with ${ethers.utils.formatEther(balance)} ETH`);
}

async function wrapEth(wallet, amount) {
  console.log(`\nWrapping ${amount} ETH to WETH...`);

  const weth = new ethers.Contract(TOKENS.WETH.address, WETH_ABI, wallet);
  const tx = await weth.deposit({ value: ethers.utils.parseEther(amount) });
  await tx.wait();

  const balance = await weth.balanceOf(wallet.address);
  console.log(`WETH balance: ${ethers.utils.formatEther(balance)}`);
}

async function approveTokens(wallet) {
  console.log('\nApproving tokens for router...');

  const maxApproval = ethers.constants.MaxUint256;

  const weth = new ethers.Contract(TOKENS.WETH.address, ERC20_ABI, wallet);
  const usdc = new ethers.Contract(TOKENS.USDC.address, ERC20_ABI, wallet);
  const usdt = new ethers.Contract(TOKENS.USDT.address, ERC20_ABI, wallet);

  // Send sequentially to avoid nonce conflicts
  const tx1 = await weth.approve(UNISWAP.router, maxApproval);
  await tx1.wait();
  console.log('  WETH approved');

  const tx2 = await usdc.approve(UNISWAP.router, maxApproval);
  await tx2.wait();
  console.log('  USDC approved');

  const tx3 = await usdt.approve(UNISWAP.router, maxApproval);
  await tx3.wait();
  console.log('  USDT approved');
}

async function swapWethForStables(wallet, direction) {
  console.log('\n--- Acquiring Stablecoins ---');

  const router = new ethers.Contract(UNISWAP.router, ROUTER_ABI, wallet);
  const wethAmount = ethers.utils.parseEther(CONFIG.WETH_TO_SWAP_FOR_STABLES);

  // Determine which stablecoin to acquire based on direction
  // IMPORTANT: We acquire the INPUT token for price manipulation, NOT the output
  // up   = need USDT to buy USDC (USDT -> USDC pushes USDC price up)
  // down = need USDC to sell for USDT (USDC -> USDT pushes USDC price down)

  const wethStableFee = FEE_TIERS.LOW; // 500 = 0.05% for WETH pools

  const usdc = new ethers.Contract(TOKENS.USDC.address, ERC20_ABI, wallet);
  const usdt = new ethers.Contract(TOKENS.USDT.address, ERC20_ABI, wallet);

  if (direction === 'up') {
    // For "up": swap WETH directly to USDT
    console.log(`Acquiring USDT for price-up manipulation...`);
    console.log(`Swapping ${ethers.utils.formatEther(wethAmount)} WETH for USDT...`);

    const params = {
      tokenIn: TOKENS.WETH.address,
      tokenOut: TOKENS.USDT.address,
      fee: wethStableFee,
      recipient: wallet.address,
      deadline: createDeadline(),
      amountIn: wethAmount,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0
    };
    const tx = await router.exactInputSingle(params, { gasLimit: 500000 });
    await tx.wait();
    console.log(`  WETH->USDT swap complete`);

    const usdtBalance = await usdt.balanceOf(wallet.address);
    console.log(`\nReady for manipulation with ${ethers.utils.formatUnits(usdtBalance, 6)} USDT`);

  } else {
    // For "down": swap WETH directly to USDC in single swap
    console.log(`Acquiring USDC for price-down manipulation...`);
    console.log(`Swapping ${ethers.utils.formatEther(wethAmount)} WETH for USDC in single swap...`);

    const params = {
      tokenIn: TOKENS.WETH.address,
      tokenOut: TOKENS.USDC.address,
      fee: wethStableFee,
      recipient: wallet.address,
      deadline: createDeadline(),
      amountIn: wethAmount,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0
    };
    const tx = await router.exactInputSingle(params, { gasLimit: 500000 });
    await tx.wait();
    console.log(`  WETH->USDC swap complete`);

    const usdcBalance = await usdc.balanceOf(wallet.address);
    console.log(`\nReady for manipulation with ${ethers.utils.formatUnits(usdcBalance, 6)} USDC`);
  }
}

async function executeSwap(wallet, tokenIn, tokenOut, amountIn, swapNumber) {
  const router = new ethers.Contract(UNISWAP.router, ROUTER_ABI, wallet);

  const tokenInSymbol = tokenIn === TOKENS.USDC.address ? 'USDC' : 'USDT';
  const tokenOutSymbol = tokenOut === TOKENS.USDC.address ? 'USDC' : 'USDT';

  console.log(`  Swap ${swapNumber}: ${ethers.utils.formatUnits(amountIn, 6)} ${tokenInSymbol} -> ${tokenOutSymbol}`);

  const params = {
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    fee: CONFIG.USDC_USDT_FEE,
    recipient: wallet.address,
    deadline: createDeadline(),
    amountIn: amountIn,
    amountOutMinimum: 0, // Accept any price for maximum price impact
    sqrtPriceLimitX96: 0
  };

  // Use manual gas limit to avoid estimation timeout
  const tx = await router.exactInputSingle(params, { gasLimit: 500000 });
  const receipt = await tx.wait();

  return receipt;
}

async function manipulatePrice(wallet, direction) {
  console.log(`\n--- Manipulating Price (${direction.toUpperCase()}) ---`);

  const usdcAmount = ethers.utils.parseUnits(CONFIG.SWAP_AMOUNT_USDC, 6);
  const usdtAmount = ethers.utils.parseUnits(CONFIG.SWAP_AMOUNT_USDT, 6);
  const minSwapAmount = ethers.utils.parseUnits('1000', 6); // Minimum 1000 tokens to bother swapping

  const usdc = new ethers.Contract(TOKENS.USDC.address, ERC20_ABI, wallet);
  const usdt = new ethers.Contract(TOKENS.USDT.address, ERC20_ABI, wallet);

  for (let i = 0; i < CONFIG.NUM_SWAPS; i++) {
    let tokenIn, tokenOut, targetAmount;

    if (direction === 'up') {
      // Buy USDC with USDT (USDT -> USDC)
      tokenIn = TOKENS.USDT.address;
      tokenOut = TOKENS.USDC.address;
      targetAmount = usdtAmount;
    } else {
      // Sell USDC for USDT (USDC -> USDT)
      tokenIn = TOKENS.USDC.address;
      tokenOut = TOKENS.USDT.address;
      targetAmount = usdcAmount;
    }

    // Check balance and adjust amount if needed
    const tokenContract = tokenIn === TOKENS.USDC.address ? usdc : usdt;
    const balance = await tokenContract.balanceOf(wallet.address);

    if (balance.lt(minSwapAmount)) {
      const tokenSymbol = tokenIn === TOKENS.USDC.address ? 'USDC' : 'USDT';
      console.log(`  Stopping: ${tokenSymbol} balance (${ethers.utils.formatUnits(balance, 6)}) below minimum swap amount`);
      break;
    }

    // Use available balance if less than target amount
    const amountIn = balance.lt(targetAmount) ? balance : targetAmount;

    try {
      await executeSwap(wallet, tokenIn, tokenOut, amountIn, i + 1);
    } catch (error) {
      console.error(`  Swap ${i + 1} failed: ${error.message}`);
      const usdcBal = await usdc.balanceOf(wallet.address);
      const usdtBal = await usdt.balanceOf(wallet.address);
      console.log(`  Current balances - USDC: ${ethers.utils.formatUnits(usdcBal, 6)}, USDT: ${ethers.utils.formatUnits(usdtBal, 6)}`);
      break;
    }

    if (CONFIG.SWAP_DELAY > 0 && i < CONFIG.NUM_SWAPS - 1) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.SWAP_DELAY));
    }
  }
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
  const { direction } = parseArgs();

  console.log('='.repeat(60));
  console.log('USDC/USDT Price Manipulation Script');
  console.log(`Direction: ${direction.toUpperCase()}`);
  console.log('='.repeat(60));

  // Setup provider and wallet
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

  // Create a new random wallet for swapping
  const wallet = ethers.Wallet.createRandom().connect(provider);
  console.log(`\nSwapper wallet: ${wallet.address}`);

  // Log initial pool state
  const initialPool = await logPoolState(provider, 'INITIAL POOL STATE');
  if (!initialPool) {
    console.error('USDC/USDT pool not found. Make sure the pool exists.');
    process.exit(1);
  }

  // Fund the wallet
  await fundWallet(provider, wallet);

  // Wrap ETH to WETH (add 10% buffer)
  const wethToWrap = Math.ceil(parseFloat(CONFIG.WETH_TO_SWAP_FOR_STABLES) * 1.1).toString();
  await wrapEth(wallet, wethToWrap);

  // Approve tokens
  await approveTokens(wallet);

  // Swap WETH for stablecoins
  await swapWethForStables(wallet, direction);

  // Log pool state after acquiring stables (WETH swaps might have used different pools)
  await logPoolState(provider, 'POOL STATE BEFORE MANIPULATION');

  // Execute price manipulation
  await manipulatePrice(wallet, direction);

  // Log final pool state
  await logPoolState(provider, 'FINAL POOL STATE');

  // Log final balances
  console.log('\n--- Final Wallet Balances ---');
  const usdc = new ethers.Contract(TOKENS.USDC.address, ERC20_ABI, wallet);
  const usdt = new ethers.Contract(TOKENS.USDT.address, ERC20_ABI, wallet);
  const [usdcBal, usdtBal] = await Promise.all([
    usdc.balanceOf(wallet.address),
    usdt.balanceOf(wallet.address)
  ]);
  console.log(`USDC: ${ethers.utils.formatUnits(usdcBal, 6)}`);
  console.log(`USDT: ${ethers.utils.formatUnits(usdtBal, 6)}`);

  console.log('\nDone!');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
