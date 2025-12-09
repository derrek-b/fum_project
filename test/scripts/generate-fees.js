// test/scripts/generate-fees.js
// Simple script to generate fees by performing multiple swaps on a Uniswap V3 pool
// NOTE: This script is for local Ganache testing only
//
// Uses the USDC/USDT 0.01% pool to generate fees for stablecoin positions

import { ethers } from 'ethers';

// Define token addresses and pool configuration
const TOKENS = {
  USDC: {
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
    decimals: 6,
    symbol: 'USDC'
  },
  USDT: {
    address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT on Arbitrum
    decimals: 6,
    symbol: 'USDT'
  },
  WETH: {
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH on Arbitrum (for acquiring stables)
    decimals: 18,
    symbol: 'WETH'
  }
};

// Fee tier for USDC/USDT pool (0.01%)
const POOL_FEE = 100;

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
const SWAP_AMOUNT = '250000'; // 250k per swap direction

const ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)'
];

// Main function to perform swaps
async function performSwaps(numSwaps = 5) {
  console.log(`\n=== Starting generate-fees script ===`);
  console.log(`Will perform ${numSwaps} round-trip swaps on USDC/USDT 0.01% pool`);

  // Setup provider - hardcoded for local Ganache testing
  const rpcUrl = "http://localhost:8545";
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  console.log(`Connected to local Ganache: ${rpcUrl}`);

  // Setup signer (wallet)
  // WARNING: This is using the first Hardhat test account private key
  // NEVER use this in production - it's only for local development
  const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Using wallet address: ${wallet.address}`);

  // Setup contract instances
  const wethContract = new ethers.Contract(TOKENS.WETH.address, WETH_ABI, wallet);
  const usdcContract = new ethers.Contract(TOKENS.USDC.address, ERC20_ABI, wallet);
  const usdtContract = new ethers.Contract(TOKENS.USDT.address, ERC20_ABI, wallet);
  const ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Uniswap V3 Router
  const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);

  // Get initial stablecoin balances
  let usdcBalance = await usdcContract.balanceOf(wallet.address);
  let usdtBalance = await usdtContract.balanceOf(wallet.address);
  console.log(`\nInitial USDC balance: ${ethers.utils.formatUnits(usdcBalance, 6)} USDC`);
  console.log(`Initial USDT balance: ${ethers.utils.formatUnits(usdtBalance, 6)} USDT`);

  const swapAmount = ethers.utils.parseUnits(SWAP_AMOUNT, 6);

  // Only acquire more stables if we have less than 200k of either
  // (Acquiring large amounts can fail due to pool liquidity limits)
  const minRequiredBalance = ethers.utils.parseUnits('200000', 6);

  // Check if we need to acquire stablecoins
  if (usdcBalance.lt(minRequiredBalance) || usdtBalance.lt(minRequiredBalance)) {
    console.log(`\n--- Acquiring stablecoins for swaps ---`);

    // Calculate how much WETH we need (~$3k per ETH)
    const wethNeeded = ethers.utils.parseEther("200"); // 200 WETH (~$600k)

    // Check ETH balance and wrap if needed
    const ethBalance = await provider.getBalance(wallet.address);
    let wethBalance = await wethContract.balanceOf(wallet.address);

    if (wethBalance.lt(wethNeeded)) {
      const ethToWrap = wethNeeded.sub(wethBalance);
      if (ethBalance.lt(ethToWrap)) {
        // Fund the wallet with more ETH using Ganache's evm_setAccountBalance
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
    if (usdcBalance.lt(minRequiredBalance)) {
      const wethForUsdc = ethers.utils.parseEther("100"); // ~$300k worth
      console.log(`Swapping ${ethers.utils.formatEther(wethForUsdc)} WETH for USDC...`);

      const usdcSwapParams = {
        tokenIn: TOKENS.WETH.address,
        tokenOut: TOKENS.USDC.address,
        fee: 500, // 0.05% WETH/USDC pool
        recipient: wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        amountIn: wethForUsdc,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0
      };
      const tx1 = await router.exactInputSingle(usdcSwapParams, { gasLimit: 500000 });
      await tx1.wait();
      usdcBalance = await usdcContract.balanceOf(wallet.address);
      console.log(`  USDC balance: ${ethers.utils.formatUnits(usdcBalance, 6)}`);
    }

    // Swap WETH for USDT (using 0.05% pool)
    if (usdtBalance.lt(minRequiredBalance)) {
      const wethForUsdt = ethers.utils.parseEther("100"); // ~$300k worth
      console.log(`Swapping ${ethers.utils.formatEther(wethForUsdt)} WETH for USDT...`);

      const usdtSwapParams = {
        tokenIn: TOKENS.WETH.address,
        tokenOut: TOKENS.USDT.address,
        fee: 500, // 0.05% WETH/USDT pool
        recipient: wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        amountIn: wethForUsdt,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0
      };
      const tx2 = await router.exactInputSingle(usdtSwapParams, { gasLimit: 500000 });
      await tx2.wait();
      usdtBalance = await usdtContract.balanceOf(wallet.address);
      console.log(`  USDT balance: ${ethers.utils.formatUnits(usdtBalance, 6)}`);
    }
  }

  // Approve router to spend stablecoins
  console.log("\nApproving router to spend USDC and USDT...");
  const approveUsdc = await usdcContract.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256);
  await approveUsdc.wait();
  const approveUsdt = await usdtContract.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256);
  await approveUsdt.wait();
  console.log("Approvals complete");

  // Record starting balances for summary
  const startingUsdc = await usdcContract.balanceOf(wallet.address);
  const startingUsdt = await usdtContract.balanceOf(wallet.address);

  // Perform round-trip swaps to generate fees
  console.log(`\n=== Performing ${numSwaps} round-trip swaps on USDC/USDT 0.01% pool ===`);
  console.log(`Swap amount: ${SWAP_AMOUNT} per direction`);

  for (let i = 0; i < numSwaps; i++) {
    try {
      console.log(`\n--- Round-trip ${i + 1}/${numSwaps} ---`);

      // Swap 1: USDC → USDT
      console.log(`  USDC → USDT (${SWAP_AMOUNT} USDC)...`);
      const swap1Params = {
        tokenIn: TOKENS.USDC.address,
        tokenOut: TOKENS.USDT.address,
        fee: POOL_FEE,
        recipient: wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        amountIn: swapAmount,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0
      };
      const tx1 = await router.exactInputSingle(swap1Params, { gasLimit: 500000 });
      await tx1.wait();
      console.log(`  ✓ USDC → USDT complete`);

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 500));

      // Swap 2: USDT → USDC
      console.log(`  USDT → USDC (${SWAP_AMOUNT} USDT)...`);
      const swap2Params = {
        tokenIn: TOKENS.USDT.address,
        tokenOut: TOKENS.USDC.address,
        fee: POOL_FEE,
        recipient: wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        amountIn: swapAmount,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0
      };
      const tx2 = await router.exactInputSingle(swap2Params, { gasLimit: 500000 });
      await tx2.wait();
      console.log(`  ✓ USDT → USDC complete`);

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
  const finalUsdt = await usdtContract.balanceOf(wallet.address);

  console.log("\n=== Swap Summary ===");
  console.log(`Starting USDC: ${ethers.utils.formatUnits(startingUsdc, 6)}`);
  console.log(`Final USDC:    ${ethers.utils.formatUnits(finalUsdc, 6)}`);
  console.log(`USDC Change:   ${ethers.utils.formatUnits(finalUsdc.sub(startingUsdc), 6)}`);

  console.log(`Starting USDT: ${ethers.utils.formatUnits(startingUsdt, 6)}`);
  console.log(`Final USDT:    ${ethers.utils.formatUnits(finalUsdt, 6)}`);
  console.log(`USDT Change:   ${ethers.utils.formatUnits(finalUsdt.sub(startingUsdt), 6)}`);

  // Calculate approximate fees generated
  // 0.01% fee on each swap, 2 swaps per round-trip, numSwaps round-trips
  const swapAmountNum = parseFloat(SWAP_AMOUNT);
  const totalVolume = swapAmountNum * 2 * numSwaps;
  const approxFees = totalVolume * 0.0001; // 0.01% fee
  console.log(`\nApproximate fees generated: $${approxFees.toFixed(2)}`);
  console.log(`(Based on ${numSwaps} round-trips × 2 swaps × $${SWAP_AMOUNT} × 0.01% fee)`);

  console.log("\n=== Fee generation complete ===");
  console.log("Your USDC/USDT liquidity positions should now have accrued fees.");
}

// Parse command line arguments for number of swaps
function parseArgs() {
  const args = process.argv.slice(2);
  let numSwaps = 5; // default

  for (const arg of args) {
    if (arg.startsWith('--swaps=')) {
      numSwaps = parseInt(arg.split('=')[1], 10);
      if (isNaN(numSwaps) || numSwaps < 1) {
        console.error('Invalid --swaps value. Using default of 5.');
        numSwaps = 5;
      }
    }
  }

  return numSwaps;
}

// Run the script
const numSwaps = parseArgs();
performSwaps(numSwaps)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error running generate-fees script:", error);
    process.exit(1);
  });
