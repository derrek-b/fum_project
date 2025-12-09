// test/scripts/create-test-vault.js
// NOTE: This script is for local Ganache testing only
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getChainConfig } from 'fum_library/helpers/chainHelpers';
import contractData from 'fum_library/artifacts/contracts';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Required Uniswap ABIs
const FALLBACK_ABIS = {
  // Basic ERC20 functions
  ERC20: [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function name() view returns (string)",
    "function approve(address spender, uint amount) returns (bool)",
    "function transfer(address to, uint amount) returns (bool)"
  ],
  // Wrapped ETH with deposit function
  WETH: [
    "function deposit() payable",
    "function balanceOf(address owner) view returns (uint256)",
    "function approve(address spender, uint amount) returns (bool)",
    "function transfer(address to, uint amount) returns (bool)"
  ],
  // Uniswap V3 Pool
  UniswapV3Pool: [
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function liquidity() external view returns (uint128)",
    "function tickSpacing() external view returns (int24)"
  ],
  // Uniswap V3 Router
  UniswapV3Router: [
    "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)"
  ],
  // Uniswap V3 Position Manager - more complete ABI with ERC721 functions
  NonfungiblePositionManager: [
    // ERC721 standard functions
    "function balanceOf(address owner) view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function safeTransferFrom(address from, address to, uint256 tokenId)",
    "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
    "function isApprovedForAll(address owner, address operator) view returns (bool)",
    "function setApprovalForAll(address operator, bool approved)",
    // Position-specific functions
    "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
    "function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)"
  ]
};

// Load contract ABI from contractData or fallback
const loadContractABI = (contractName) => {
  // Try to load from contractData or fallback
  if (contractData[contractName]?.abi) {
    return contractData[contractName].abi;
  } else if (contractName in FALLBACK_ABIS) {
    console.log(`Using fallback ABI for ${contractName}`);
    return FALLBACK_ABIS[contractName];
  } else {
    throw new Error(`No ABI found for ${contractName}`);
  }
};

async function main() {
  // Hardcoded for local Ganache testing only
  const chainId = 1337;
  const rpcUrl = 'http://localhost:8545';
  const networkConfig = getChainConfig(chainId);

  if (!networkConfig) {
    throw new Error(`Network with chainId ${chainId} not configured`);
  }

  console.log(`Creating test vault on local Ganache (${networkConfig.name})...`);

  // Set up provider and signer with hardcoded test account
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Default Hardhat account #0
    provider
  );

  console.log(`Using account: ${signer.address}`);

  // Get the VaultFactory address
  let vaultFactoryAddress;

  // First try to get from deployment file
  const deploymentPath = path.join(__dirname, `../../deployments/${chainId}-latest.json`);
  if (fs.existsSync(deploymentPath)) {
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    vaultFactoryAddress = deployment.contracts.VaultFactory;
  } else {
    // Fall back to contractData
    vaultFactoryAddress = contractData.VaultFactory?.addresses?.[chainId.toString()];

    if (!vaultFactoryAddress) {
      throw new Error(`No VaultFactory address found for chainId ${chainId}. Please deploy it first.`);
    }
  }

  console.log(`Using VaultFactory at: ${vaultFactoryAddress}`);

  // Load contract ABIs
  const vaultFactoryABI = loadContractABI('VaultFactory');
  const positionVaultABI = loadContractABI('PositionVault');

  // Connect to VaultFactory
  const vaultFactory = new ethers.Contract(
    vaultFactoryAddress,
    vaultFactoryABI,
    signer
  );

  // Create a new vault
  console.log("\nCreating new vault...");
  const vaultName = "Test Vault " + Math.floor(Date.now() / 1000);

  const tx = await vaultFactory.createVault(vaultName);
  const receipt = await tx.wait();

  // Extract vault address from event logs
  const vaultCreatedEvents = receipt.logs
    .filter(log => {
      try {
        return vaultFactory.interface.parseLog(log).name === 'VaultCreated';
      } catch (e) {
        return false;
      }
    })
    .map(log => vaultFactory.interface.parseLog(log));

  if (vaultCreatedEvents.length === 0) {
    console.error("Failed to find VaultCreated event in transaction logs");
    process.exit(1);
  }

  const vaultAddress = vaultCreatedEvents[0].args[1]; // Second arg is vault address
  console.log(`New vault created at: ${vaultAddress}`);
  console.log(`Vault name: ${vaultName}`);

  // Define token addresses for Arbitrum that will be needed later
  const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'; // WETH on Arbitrum
  const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // USDC on Arbitrum

  // Create contract instances for tokens
  const wethContract = new ethers.Contract(WETH_ADDRESS, FALLBACK_ABIS.WETH, signer);
  const usdcContract = new ethers.Contract(USDC_ADDRESS, FALLBACK_ABIS.ERC20, signer);

  // Check ETH balance
  const ethBalance = await provider.getBalance(signer.address);
  console.log(`ETH balance: ${ethers.utils.formatEther(ethBalance)} ETH`);

  // Wrap some ETH to get WETH
  console.log("\nWrapping 5 ETH to WETH...");
  const wrapTx = await wethContract.deposit({ value: ethers.utils.parseEther("5") });
  await wrapTx.wait();
  console.log("ETH wrapped to WETH successfully");

  // Setup for swapping some WETH to USDC
  const UNISWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Uniswap V3 Router
  const router = new ethers.Contract(UNISWAP_ROUTER_ADDRESS, FALLBACK_ABIS.UniswapV3Router, signer);

  // Approve the router to spend WETH
  const approveWethTx = await wethContract.approve(UNISWAP_ROUTER_ADDRESS, ethers.utils.parseEther("2"));
  await approveWethTx.wait();
  console.log("Router approved to spend WETH");

  // Swap some WETH for USDC
  console.log("\nSwapping WETH for USDC...");
  const swapParams = {
    tokenIn: WETH_ADDRESS,
    tokenOut: USDC_ADDRESS,
    fee: 500, // 0.05% fee pool
    recipient: signer.address,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes
    amountIn: ethers.utils.parseEther("2"), // Swap 2 WETH
    amountOutMinimum: 0, // No minimum for testing
    sqrtPriceLimitX96: 0 // No price limit
  };

  const swapTx = await router.exactInputSingle(swapParams);
  await swapTx.wait();
  console.log("WETH swapped for USDC successfully");

  // Transfer additional tokens to the vault
  console.log("\nTransferring tokens to the vault...");

  // Get current balances
  const currentWethBalance = await wethContract.balanceOf(signer.address);
  const currentUsdcBalance = await usdcContract.balanceOf(signer.address);

  console.log(`Current WETH balance: ${ethers.utils.formatEther(currentWethBalance)} WETH`);
  console.log(`Current USDC balance: ${ethers.utils.formatUnits(currentUsdcBalance, 6)} USDC`);

  // Amount to transfer: 3 WETH
  const wethTransferAmount = ethers.utils.parseEther("3");

  // Amount to transfer: 1000 USDC
  const usdcTransferAmount = ethers.utils.parseUnits("1000", 6);

  // Transfer WETH to the vault
  console.log("\nTransferring 3 WETH to the vault...");
  const transferWethTx = await wethContract.transfer(vaultAddress, wethTransferAmount);
  await transferWethTx.wait();
  console.log(`Successfully transferred ${ethers.utils.formatEther(wethTransferAmount)} WETH to vault`);

  // Transfer USDC to the vault
  console.log("\nTransferring 1000 USDC to the vault...");
  const transferUsdcTx = await usdcContract.transfer(vaultAddress, usdcTransferAmount);
  await transferUsdcTx.wait();
  console.log(`Successfully transferred ${ethers.utils.formatUnits(usdcTransferAmount, 6)} USDC to vault`);

  // Verify token balances in the vault
  const vaultWethBalance = await wethContract.balanceOf(vaultAddress);
  const vaultUsdcBalance = await usdcContract.balanceOf(vaultAddress);
  console.log("\nVault token balances:");
  console.log(`WETH: ${ethers.utils.formatEther(vaultWethBalance)} WETH`);
  console.log(`USDC: ${ethers.utils.formatUnits(vaultUsdcBalance, 6)} USDC`);

  console.log("\nTest vault setup complete!");
  console.log("====================");
  console.log(`Vault Address: ${vaultAddress}`);
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
