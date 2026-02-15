// test/scripts/generate-fees.js
// Simple script to generate fees by performing multiple swaps on a Uniswap V3 pool
// NOTE: This script is for local Hardhat testing only
//
// Usage: node generate-fees.js [--token=SYMBOL] [--swaps=N] [--fee=FEE_TIER]
// Example: node generate-fees.js --token=WETH --swaps=10 --fee=3000
// Default: USDC/USDT swaps on 0.01% pool
//
// Fee tiers: 100 (0.01%), 500 (0.05%), 3000 (0.3%), 10000 (1%)

import { ethers } from 'ethers';

// Define token addresses and pool configuration
// All tokens are on Arbitrum mainnet (forked)
const TOKENS = {
  USDC: {
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    decimals: 6,
    symbol: 'USDC',
    poolFeeWithUsdc: null // Base token
  },
  USDT: {
    address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    decimals: 6,
    symbol: 'USDT',
    poolFeeWithUsdc: 100 // 0.01% - stablecoin pool
  },
  WETH: {
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    decimals: 18,
    symbol: 'WETH',
    poolFeeWithUsdc: 500 // 0.05%
  },
  WBTC: {
    address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    decimals: 8,
    symbol: 'WBTC',
    poolFeeWithUsdc: 500 // 0.05%
  },
  LINK: {
    address: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4',
    decimals: 18,
    symbol: 'LINK',
    poolFeeWithUsdc: 3000 // 0.3%
  }
};

// Define contract ABIs (minimal versions)
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

const WETH_ABI = [
  ...ERC20_ABI,
  'function deposit() external payable'
];

// Note: Fees are distributed across ALL LPs proportionally, so we need large volumes
// to generate meaningful fees for a single position
const DEFAULT_SWAP_AMOUNT = '10000'; // 10k USDC per swap for most pairs
const SWAP_AMOUNTS = {
  USDT: '250000'  // 250k USDC per swap (stablecoin)
};

const ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)'
];

// Main function to perform swaps
async function performSwaps(numSwaps = 5, targetSymbol = 'USDT', feeOverride = null) {
  // Validate target token
  const targetToken = TOKENS[targetSymbol.toUpperCase()];
  if (!targetToken) {
    console.error(`Unknown token: ${targetSymbol}`);
    console.error(`Available tokens: ${Object.keys(TOKENS).filter(t => t !== 'USDC').join(', ')}`);
    process.exit(1);
  }
  if (targetSymbol.toUpperCase() === 'USDC') {
    console.error('Cannot swap USDC with itself. Please specify a different token.');
    process.exit(1);
  }

  // Use fee override if provided, otherwise use token's default
  const poolFee = feeOverride || targetToken.poolFeeWithUsdc;
  const poolFeePercent = (poolFee / 10000).toFixed(2);
  const swapAmount = SWAP_AMOUNTS[targetSymbol.toUpperCase()] || DEFAULT_SWAP_AMOUNT;

  console.log(`\n=== Starting generate-fees script ===`);
  console.log(`Will perform ${numSwaps} round-trip swaps on USDC/${targetToken.symbol} ${poolFeePercent}% pool`);

  // Setup provider - hardcoded for local Hardhat testing
  const rpcUrl = "http://localhost:8545";
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  console.log(`Connected to local Hardhat: ${rpcUrl}`);

  // Setup signer (wallet)
  // WARNING: This is using the first Hardhat test account private key
  // NEVER use this in production - it's only for local development
  const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Using wallet address: ${wallet.address}`);

  // Setup contract instances
  const wethContract = new ethers.Contract(TOKENS.WETH.address, WETH_ABI, wallet);
  const usdcContract = new ethers.Contract(TOKENS.USDC.address, ERC20_ABI, wallet);
  const targetContract = new ethers.Contract(targetToken.address, ERC20_ABI, wallet);
  const ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Uniswap V3 Router
  const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);

  // Get initial token balances
  let usdcBalance = await usdcContract.balanceOf(wallet.address);
  let targetBalance = await targetContract.balanceOf(wallet.address);
  console.log(`\nInitial USDC balance: ${ethers.utils.formatUnits(usdcBalance, 6)} USDC`);
  console.log(`Initial ${targetToken.symbol} balance: ${ethers.utils.formatUnits(targetBalance, targetToken.decimals)} ${targetToken.symbol}`);

  const usdcSwapAmount = ethers.utils.parseUnits(swapAmount, 6);

  // Only acquire more USDC if we don't have enough for swaps
  // Calculate minimum required based on swap amount * number of swaps with buffer
  const minRequiredUsdc = usdcSwapAmount.mul(numSwaps + 2);

  // Check if we need to acquire USDC
  if (usdcBalance.lt(minRequiredUsdc)) {
    console.log(`\n--- Acquiring USDC for swaps ---`);

    // Calculate how much WETH we need (~$3k per ETH)
    const wethNeeded = ethers.utils.parseEther("200"); // 200 WETH (~$600k)

    // Check ETH balance and wrap if needed
    const ethBalance = await provider.getBalance(wallet.address);
    let wethBalance = await wethContract.balanceOf(wallet.address);

    if (wethBalance.lt(wethNeeded)) {
      const ethToWrap = wethNeeded.sub(wethBalance);
      if (ethBalance.lt(ethToWrap)) {
        // Fund the wallet with more ETH using Hardhat's hardhat_setBalance
        console.log("Funding wallet with ETH...");
        await provider.send('evm_setAccountBalance', [
          wallet.address,
          ethers.utils.hexValue(ethers.utils.parseEther("10000"))
        ]);
      }
      console.log(`Wrapping ${ethers.utils.formatEther(ethToWrap)} ETH to WETH...`);
      const wrapTx = await wethContract.deposit({ value: ethToWrap });
      await wrapTx.wait();
      wethBalance = await wethContract.balanceOf(wallet.address);
    }

    // Approve router to spend WETH
    console.log("Approving router to spend WETH...");
    const approveTx = await wethContract.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256);
    await approveTx.wait();

    // Swap WETH for USDC (using 0.05% pool)
    const wethForUsdc = ethers.utils.parseEther("100"); // ~$300k worth
    console.log(`Swapping ${ethers.utils.formatEther(wethForUsdc)} WETH for USDC...`);

    const usdcAcquireParams = {
      tokenIn: TOKENS.WETH.address,
      tokenOut: TOKENS.USDC.address,
      fee: 500, // 0.05% WETH/USDC pool
      recipient: wallet.address,
      deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      amountIn: wethForUsdc,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0
    };
    const tx1 = await router.exactInputSingle(usdcAcquireParams, { gasLimit: 500000 });
    await tx1.wait();
    usdcBalance = await usdcContract.balanceOf(wallet.address);
    console.log(`  USDC balance: ${ethers.utils.formatUnits(usdcBalance, 6)}`);
  }

  // Approve router to spend tokens
  console.log(`\nApproving router to spend USDC and ${targetToken.symbol}...`);
  const approveUsdc = await usdcContract.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256);
  await approveUsdc.wait();
  const approveTarget = await targetContract.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256);
  await approveTarget.wait();
  console.log("Approvals complete");

  // Record starting balances for summary
  const startingUsdc = await usdcContract.balanceOf(wallet.address);
  const startingTarget = await targetContract.balanceOf(wallet.address);

  // Perform round-trip swaps to generate fees
  console.log(`\n=== Performing ${numSwaps} round-trip swaps on USDC/${targetToken.symbol} ${poolFeePercent}% pool ===`);
  console.log(`Swap amount: ${swapAmount} USDC per direction`);

  for (let i = 0; i < numSwaps; i++) {
    try {
      console.log(`\n--- Round-trip ${i + 1}/${numSwaps} ---`);

      // Swap 1: USDC → Target Token
      console.log(`  USDC -> ${targetToken.symbol} (${swapAmount} USDC)...`);
      const swap1Params = {
        tokenIn: TOKENS.USDC.address,
        tokenOut: targetToken.address,
        fee: poolFee,
        recipient: wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        amountIn: usdcSwapAmount,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0
      };
      const tx1 = await router.exactInputSingle(swap1Params, { gasLimit: 500000 });
      await tx1.wait();

      // Get the target token balance to use for return swap
      const targetBalanceAfterSwap = await targetContract.balanceOf(wallet.address);
      console.log(`  OK USDC -> ${targetToken.symbol} complete (received ${ethers.utils.formatUnits(targetBalanceAfterSwap.sub(targetBalance), targetToken.decimals)} ${targetToken.symbol})`);

      // Calculate amount to swap back (use what we just received)
      const targetSwapAmount = targetBalanceAfterSwap.sub(targetBalance);
      targetBalance = targetBalanceAfterSwap;

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 500));

      // Swap 2: Target Token → USDC
      console.log(`  ${targetToken.symbol} -> USDC (${ethers.utils.formatUnits(targetSwapAmount, targetToken.decimals)} ${targetToken.symbol})...`);
      const swap2Params = {
        tokenIn: targetToken.address,
        tokenOut: TOKENS.USDC.address,
        fee: poolFee,
        recipient: wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        amountIn: targetSwapAmount,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0
      };
      const tx2 = await router.exactInputSingle(swap2Params, { gasLimit: 500000 });
      await tx2.wait();
      targetBalance = await targetContract.balanceOf(wallet.address);
      console.log(`  OK ${targetToken.symbol} -> USDC complete`);

    } catch (error) {
      console.error(`  Error in round-trip ${i + 1}:`, error.message);
    }

    // Delay between round-trips
    if (i < numSwaps - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Get final token balances
  const finalUsdc = await usdcContract.balanceOf(wallet.address);
  const finalTarget = await targetContract.balanceOf(wallet.address);

  console.log("\n=== Swap Summary ===");
  console.log(`Starting USDC: ${ethers.utils.formatUnits(startingUsdc, 6)}`);
  console.log(`Final USDC:    ${ethers.utils.formatUnits(finalUsdc, 6)}`);
  console.log(`USDC Change:   ${ethers.utils.formatUnits(finalUsdc.sub(startingUsdc), 6)}`);

  console.log(`Starting ${targetToken.symbol}: ${ethers.utils.formatUnits(startingTarget, targetToken.decimals)}`);
  console.log(`Final ${targetToken.symbol}:    ${ethers.utils.formatUnits(finalTarget, targetToken.decimals)}`);
  console.log(`${targetToken.symbol} Change:   ${ethers.utils.formatUnits(finalTarget.sub(startingTarget), targetToken.decimals)}`);

  // Calculate approximate fees generated
  const swapAmountNum = parseFloat(swapAmount);
  const totalVolume = swapAmountNum * 2 * numSwaps;
  const feePercent = poolFee / 1000000; // Convert from basis points
  const approxFees = totalVolume * feePercent;
  console.log(`\nApproximate fees generated: $${approxFees.toFixed(2)}`);
  console.log(`(Based on ${numSwaps} round-trips x 2 swaps x $${swapAmount} x ${poolFeePercent}% fee)`);

  console.log("\n=== Fee generation complete ===");
  console.log(`Your USDC/${targetToken.symbol} liquidity positions should now have accrued fees.`);
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let numSwaps = 5; // default
  let targetToken = 'USDT'; // default
  let fee = null; // null = use token's default pool fee

  for (const arg of args) {
    if (arg.startsWith('--swaps=')) {
      numSwaps = parseInt(arg.split('=')[1], 10);
      if (isNaN(numSwaps) || numSwaps < 1) {
        console.error('Invalid --swaps value. Using default of 5.');
        numSwaps = 5;
      }
    } else if (arg.startsWith('--token=')) {
      targetToken = arg.split('=')[1].toUpperCase();
    } else if (arg.startsWith('--fee=')) {
      fee = parseInt(arg.split('=')[1], 10);
      if (isNaN(fee) || ![100, 500, 3000, 10000].includes(fee)) {
        console.error('Invalid --fee value. Must be 100, 500, 3000, or 10000.');
        console.error('  100   = 0.01% (stablecoins)');
        console.error('  500   = 0.05%');
        console.error('  3000  = 0.3%');
        console.error('  10000 = 1%');
        process.exit(1);
      }
    }
  }

  return { numSwaps, targetToken, fee };
}

// Run the script
const { numSwaps, targetToken, fee } = parseArgs();
performSwaps(numSwaps, targetToken, fee)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error running generate-fees script:", error);
    process.exit(1);
  });
