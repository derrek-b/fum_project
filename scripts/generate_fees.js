// scripts/generate-fees.js
// Simple script to generate fees by performing multiple swaps on a Uniswap V3 pool

import { ethers } from 'ethers';
(await import("dotenv")).default.config({ path: ".env.local" });

// Define token addresses and pool configuration
const TOKENS = {
  WETH: {
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH on Arbitrum
    decimals: 18,
    symbol: 'WETH'
  },
  USDC: {
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
    decimals: 6,
    symbol: 'USDC'
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

const ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)'
];

// Main function to perform swaps
async function performSwaps(numSwaps = 1) {
  console.log(`\n=== Starting generate-fees script - Performing ${numSwaps} swaps ===`);

  // Setup provider
  const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_RPC || "http://localhost:8545";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  console.log(`Connected to RPC: ${rpcUrl}`);

  // Setup signer (wallet)
  // WARNING: This is using the first Hardhat test account private key
  // NEVER use this in production - it's only for local development
  const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Using wallet address: ${wallet.address}`);

  // Check ETH balance
  const ethBalance = await provider.getBalance(wallet.address);
  console.log(`ETH balance: ${ethers.formatEther(ethBalance)} ETH`);

  // Setup contract instances
  const wethContract = new ethers.Contract(TOKENS.WETH.address, WETH_ABI, wallet);
  const usdcContract = new ethers.Contract(TOKENS.USDC.address, ERC20_ABI, wallet);
  const ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Uniswap V3 Router
  const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);

  // Get initial token balances
  const initialWethBalance = await wethContract.balanceOf(wallet.address);
  const initialUsdcBalance = await usdcContract.balanceOf(wallet.address);
  console.log(`Initial WETH balance: ${ethers.formatUnits(initialWethBalance, TOKENS.WETH.decimals)} WETH`);
  console.log(`Initial USDC balance: ${ethers.formatUnits(initialUsdcBalance, TOKENS.USDC.decimals)} USDC`);

  // Ensure we have some WETH
  if (initialWethBalance < ethers.parseEther("0.5")) {
    console.log("\nWrapping 1 ETH to WETH for swaps...");
    const wrapTx = await wethContract.deposit({ value: ethers.parseEther("1") });
    await wrapTx.wait();
    console.log("ETH wrapped to WETH successfully");

    const newWethBalance = await wethContract.balanceOf(wallet.address);
    console.log(`Updated WETH balance: ${ethers.formatUnits(newWethBalance, TOKENS.WETH.decimals)} WETH`);
  }

  // Approve router to spend tokens (one-time)
  console.log("\nApproving Uniswap Router to spend tokens...");

  const wethAllowance = ethers.parseEther("1"); // 1 WETH
  const wethApproveTx = await wethContract.approve(ROUTER_ADDRESS, wethAllowance);
  await wethApproveTx.wait();
  console.log(`Approved Uniswap Router to spend up to ${ethers.formatEther(wethAllowance)} WETH`);

  const usdcAllowance = ethers.parseUnits("1000", TOKENS.USDC.decimals); // 1000 USDC
  const usdcApproveTx = await usdcContract.approve(ROUTER_ADDRESS, usdcAllowance);
  await usdcApproveTx.wait();
  console.log(`Approved Uniswap Router to spend up to ${ethers.formatUnits(usdcAllowance, TOKENS.USDC.decimals)} USDC`);

  // Perform swaps
  console.log("\n=== Performing swaps to generate fees ===");

  // Get the current nonce to manage transaction ordering
  let currentNonce = await provider.getTransactionCount(wallet.address);
  console.log(`Starting with nonce: ${currentNonce}`);

  for (let i = 0; i < numSwaps; i++) {
    try {
      // Re-check nonce before each swap (in case something external changed it)
      currentNonce = await provider.getTransactionCount(wallet.address);

      // Alternate between WETH→USDC and USDC→WETH swaps
      const isWethToUsdc = i % 2 === 0;
      const tokenIn = isWethToUsdc ? TOKENS.WETH.address : TOKENS.USDC.address;
      const tokenOut = isWethToUsdc ? TOKENS.USDC.address : TOKENS.WETH.address;

      // Determine appropriate amount for the swap
      const amountIn = isWethToUsdc ?
        ethers.parseEther("0.05") : // 0.05 WETH
        ethers.parseUnits("100", TOKENS.USDC.decimals); // 100 USDC

      console.log(`\nSwap ${i+1}/${numSwaps}: ${isWethToUsdc ? 'WETH → USDC' : 'USDC → WETH'} (nonce: ${currentNonce})`);

      // Setup swap parameters
      const swapParams = {
        tokenIn,
        tokenOut,
        fee: 500, // 0.3% fee tier
        recipient: wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes
        amountIn,
        amountOutMinimum: 0, // No minimum for testing
        sqrtPriceLimitX96: 0 // No price limit
      };

      // Execute swap with explicit nonce management
      const swapTx = await router.exactInputSingle(swapParams, { nonce: currentNonce });
      console.log(`Transaction sent: ${swapTx.hash}`);

      // Wait for confirmation
      await swapTx.wait();
      console.log(`Swap confirmed`);

      // Add a small delay between swaps
      if (i < numSwaps - 1) {
        console.log("Waiting briefly before next swap...");
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`Error in swap ${i+1}:`, error.message);
      // Continue to next swap even if this one fails
    }
  }

  // Get final token balances
  const finalWethBalance = await wethContract.balanceOf(wallet.address);
  const finalUsdcBalance = await usdcContract.balanceOf(wallet.address);

  console.log("\n=== Swap Summary ===");
  console.log(`Starting WETH: ${ethers.formatUnits(initialWethBalance, TOKENS.WETH.decimals)}`);
  console.log(`Final WETH:    ${ethers.formatUnits(finalWethBalance, TOKENS.WETH.decimals)}`);
  console.log(`WETH Change:   ${ethers.formatUnits(finalWethBalance - initialWethBalance, TOKENS.WETH.decimals)}`);

  console.log(`Starting USDC: ${ethers.formatUnits(initialUsdcBalance, TOKENS.USDC.decimals)}`);
  console.log(`Final USDC:    ${ethers.formatUnits(finalUsdcBalance, TOKENS.USDC.decimals)}`);
  console.log(`USDC Change:   ${ethers.formatUnits(finalUsdcBalance - initialUsdcBalance, TOKENS.USDC.decimals)}`);

  console.log("\n=== Fee generation swaps completed ===");
  console.log("Your liquidity positions should now have accrued fees.");
  console.log("Reload your app and check the fee display for your positions.");
}

// Run the script with default 5 swaps
performSwaps()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error running generate-fees script:", error);
    process.exit(1);
  });
