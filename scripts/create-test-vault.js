// scripts/create-test-vault.js
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import config from '../src/utils/config.js';

// Load environment variables
dotenv.config();

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const networkArg = args.find(arg => arg.startsWith('--network='));
const networkName = networkArg ? networkArg.split('=')[1] : 'localhost';

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

// Load contract ABIs from contracts.json
const loadContractData = (contractName) => {
  const contractsPath = path.join(__dirname, '../src/abis/contracts.json');

  if (!fs.existsSync(contractsPath)) {
    throw new Error(`contracts.json not found at ${contractsPath}`);
  }

  const contractsData = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));

  if (!contractsData[contractName]) {
    if (contractName in FALLBACK_ABIS) {
      // Return a mock contract data object with the fallback ABI
      console.log(`${contractName} not found in contracts.json, using fallback ABI`);
      return { abi: FALLBACK_ABIS[contractName] };
    }
    throw new Error(`Contract ${contractName} not found in contracts.json`);
  }

  return contractsData[contractName];
};

// Load contract ABI
const loadContractABI = (contractName) => {
  // Try to load from contracts.json or fallback
  try {
    return loadContractData(contractName).abi;
  } catch (error) {
    // If not in contracts.json and no fallback, throw error
    if (!(contractName in FALLBACK_ABIS)) {
      throw error;
    }
    console.log(`Using fallback ABI for ${contractName}`);
    return FALLBACK_ABIS[contractName];
  }
};

async function main() {
  // Get network configuration
  const chainId = networkName === 'localhost' ? 1337 : 42161; // Default to Arbitrum unless localhost
  const networkConfig = config.chains[chainId];

  if (!networkConfig) {
    throw new Error(`Network with chainId ${chainId} not configured`);
  }

  console.log(`Creating test vault with sample position on ${networkConfig.name}...`);

  // Set up provider and signer
  const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

  let signer;
  if (networkName === 'localhost') {
    // For local testing, use the first account
    signer = new ethers.Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Default Hardhat account #0
      provider
    );
  } else {
    // For real networks, use private key from .env
    if (!process.env.PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY environment variable not set');
    }
    signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  }

  console.log(`Using account: ${signer.address}`);

  // Get the VaultFactory address
  let vaultFactoryAddress;

  // First try to get from deployment file
  const deploymentPath = path.join(__dirname, `../deployments/${chainId}-latest.json`);
  if (fs.existsSync(deploymentPath)) {
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    vaultFactoryAddress = deployment.contracts.VaultFactory;
  } else {
    // Fall back to contracts.json
    const vaultFactoryData = loadContractData('VaultFactory');
    vaultFactoryAddress = vaultFactoryData.addresses?.[chainId.toString()];

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

  // Connect to the vault
  const vault = new ethers.Contract(
    vaultAddress,
    positionVaultABI,
    signer
  );

  // =============== Create Real Uniswap V3 Position =============== //
  console.log("\nSetting up for Uniswap position creation...");

  // Define token addresses for Arbitrum
  const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'; // WETH on Arbitrum
  const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // USDC on Arbitrum

  // Define Uniswap V3 contract addresses
  const UNISWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Uniswap V3 Router
  const UNISWAP_POSITION_MANAGER_ADDRESS = networkConfig.platforms.uniswapV3.positionManagerAddress;

  console.log(`Using Uniswap Position Manager at: ${UNISWAP_POSITION_MANAGER_ADDRESS}`);

  // Create contract instances
  const wethContract = new ethers.Contract(WETH_ADDRESS, FALLBACK_ABIS.WETH, signer);
  const usdcContract = new ethers.Contract(USDC_ADDRESS, FALLBACK_ABIS.ERC20, signer);
  const positionManager = new ethers.Contract(UNISWAP_POSITION_MANAGER_ADDRESS, FALLBACK_ABIS.NonfungiblePositionManager, signer);
  const router = new ethers.Contract(UNISWAP_ROUTER_ADDRESS, FALLBACK_ABIS.UniswapV3Router, signer);

  // Check ETH balance
  const ethBalance = await provider.getBalance(signer.address);
  console.log(`ETH balance: ${ethers.formatEther(ethBalance)} ETH`);

  // Wrap some ETH to get WETH if needed
  const wethBalance = await wethContract.balanceOf(signer.address);
  if (wethBalance < ethers.parseEther("1")) {
    console.log("\nWrapping 2 ETH to WETH...");
    const wrapTx = await wethContract.deposit({ value: ethers.parseEther("2") });
    await wrapTx.wait();
    console.log("ETH wrapped to WETH successfully");
  }

  // Get token balances
  const updatedWethBalance = await wethContract.balanceOf(signer.address);
  const usdcBalance = await usdcContract.balanceOf(signer.address);

  console.log(`WETH balance: ${ethers.formatEther(updatedWethBalance)} WETH`);
  console.log(`USDC balance: ${ethers.formatUnits(usdcBalance, 6)} USDC`);

  // If we don't have USDC, swap some WETH for USDC
  if (usdcBalance < ethers.parseUnits("100", 6)) {
    console.log("\nSwapping WETH for USDC...");

    // First approve the router to spend WETH
    const approveTx = await wethContract.approve(UNISWAP_ROUTER_ADDRESS, ethers.parseEther("1"));
    await approveTx.wait();
    console.log("Router approved to spend WETH");

    // Set up swap parameters
    const swapParams = {
      tokenIn: WETH_ADDRESS,
      tokenOut: USDC_ADDRESS,
      fee: 500, // 0.05% fee pool
      recipient: signer.address,
      deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes
      amountIn: ethers.parseEther("0.5"), // Swap 0.5 WETH
      amountOutMinimum: 0, // No minimum for testing
      sqrtPriceLimitX96: 0 // No price limit
    };

    // Execute the swap
    const swapTx = await router.exactInputSingle(swapParams);
    await swapTx.wait();
    console.log("WETH swapped for USDC successfully");

    // Get new USDC balance
    const newUsdcBalance = await usdcContract.balanceOf(signer.address);
    console.log(`New USDC balance: ${ethers.formatUnits(newUsdcBalance, 6)} USDC`);
  }

  // Get the current pool data to determine price and tick range
  console.log("\nGetting pool data to determine price range...");

  // For local network, directly use a known pool address
  const poolAddress = "0x17c14D2c404D167802b16C450d3c99F88F2c4F4d"; // WETH/USDC 0.05% pool

  console.log(`Using Uniswap V3 pool at: ${poolAddress}`);

  const poolContract = new ethers.Contract(poolAddress, FALLBACK_ABIS.UniswapV3Pool, provider);

  // Get current tick and pricing data
  const slot0 = await poolContract.slot0();
  const currentTick = Number(slot0.tick);
  const tickSpacing = await poolContract.tickSpacing();

  console.log(`Current tick: ${currentTick}`);
  console.log(`Tick spacing: ${Number(tickSpacing)}`);

  // Calculate a price range centered around the current price
  const tickLower = Math.floor(currentTick - 1000); // ~10% below current price
  const tickUpper = Math.ceil(currentTick + 1000); // ~10% above current price

  // Adjust ticks to be multiples of tickSpacing
  const adjustedTickLower = Math.floor(tickLower / Number(tickSpacing)) * Number(tickSpacing);
  const adjustedTickUpper = Math.ceil(tickUpper / Number(tickSpacing)) * Number(tickSpacing);

  console.log(`Adjusted tick range: ${adjustedTickLower} to ${adjustedTickUpper}`);

  // Create the position
  console.log("\nCreating Uniswap V3 position...");

  // First approve the position manager to spend our tokens
  const wethAmount = ethers.parseEther("0.1"); // 0.1 WETH
  const usdcAmount = ethers.parseUnits("200", 6); // 200 USDC

  // Approve WETH
  const approveWethTx = await wethContract.approve(UNISWAP_POSITION_MANAGER_ADDRESS, wethAmount);
  await approveWethTx.wait();
  console.log("Position manager approved to spend WETH");

  // Approve USDC
  const approveUsdcTx = await usdcContract.approve(UNISWAP_POSITION_MANAGER_ADDRESS, usdcAmount);
  await approveUsdcTx.wait();
  console.log("Position manager approved to spend USDC");

  // Determine the token order (Uniswap requires tokens to be in address order)
  const isWETHToken0 = WETH_ADDRESS.toLowerCase() < USDC_ADDRESS.toLowerCase();

  // Setup mint parameters
  const mintParams = {
    token0: isWETHToken0 ? WETH_ADDRESS : USDC_ADDRESS,
    token1: isWETHToken0 ? USDC_ADDRESS : WETH_ADDRESS,
    fee: 500, // 0.05% fee tier
    tickLower: adjustedTickLower,
    tickUpper: adjustedTickUpper,
    amount0Desired: isWETHToken0 ? wethAmount : usdcAmount,
    amount1Desired: isWETHToken0 ? usdcAmount : wethAmount,
    amount0Min: 0, // No minimum for testing
    amount1Min: 0, // No minimum for testing
    recipient: signer.address, // Initially mint to our address
    deadline: Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes
  };

  console.log("Mint parameters:", {
    token0: isWETHToken0 ? "WETH" : "USDC",
    token1: isWETHToken0 ? "USDC" : "WETH",
    fee: mintParams.fee,
    tickLower: mintParams.tickLower,
    tickUpper: mintParams.tickUpper
  });

  // Create the position
  const mintTx = await positionManager.mint(mintParams, { gasLimit: 5000000 });
  console.log(`Mint transaction sent: ${mintTx.hash}`);
  const mintReceipt = await mintTx.wait();
  console.log("Position created successfully");

  // Extract tokenId from the mint transaction
  const positionId = await extractTokenIdFromReceipt(mintReceipt, positionManager);
  console.log(`Position created with ID: ${positionId}`);

  // Get position details
  const positionDetails = await positionManager.positions(positionId);
  console.log("\nPosition Details:");
  console.log(`Token0: ${positionDetails.token0}`);
  console.log(`Token1: ${positionDetails.token1}`);
  console.log(`Fee Tier: ${positionDetails.fee}`);
  console.log(`Tick Range: ${positionDetails.tickLower} to ${positionDetails.tickUpper}`);
  console.log(`Liquidity: ${positionDetails.liquidity}`);

  // Now transfer the position to the vault
  console.log("\nTransferring position to vault...");

  // First set approval for the vault to manage positions
  console.log("Approving vault to manage positions...");
  const approveTx = await positionManager.setApprovalForAll(vaultAddress, true);
  await approveTx.wait();
  console.log("Vault approved to manage positions");

  // Transfer position to vault
  const transferTx = await positionManager.safeTransferFrom(signer.address, vaultAddress, positionId);
  await transferTx.wait();
  console.log(`Position ${positionId} transferred to vault`);

  // Verify the position is now owned by the vault
  const newOwner = await positionManager.ownerOf(positionId);
  if (newOwner.toLowerCase() === vaultAddress.toLowerCase()) {
    console.log("Position transfer verified - vault is now the owner");
  } else {
    console.error(`Position transfer failed. Current owner: ${newOwner}`);
  }

  // Verify position is tracked by vault
  const isManaged = await vault.managedPositions(positionId);
  console.log(`Position managed by vault: ${isManaged}`);

  // Transfer additional tokens to the vault
  console.log("\nTransferring additional tokens to the vault...");

  // Check current WETH balance
  const currentWethBalance = await wethContract.balanceOf(signer.address);
  console.log(`Current WETH balance: ${ethers.formatEther(currentWethBalance)} WETH`);

  // Amount to transfer: 3 WETH
  const wethTransferAmount = ethers.parseEther("3");

  // Wrap more ETH if needed
  if (currentWethBalance < (wethTransferAmount * BigInt('3'))) {
    const additionalWethNeeded = (wethTransferAmount * BigInt('2')) - currentWethBalance;
    console.log(`\nWrapping ${ethers.formatEther(additionalWethNeeded)} additional ETH to WETH...`);
    const wrapTx = await wethContract.deposit({ value: additionalWethNeeded });
    await wrapTx.wait();
    console.log("Additional ETH wrapped to WETH successfully");
  }

  // Check current USDC balance
  const currentUsdcBalance = await usdcContract.balanceOf(signer.address);
  console.log(`Current USDC balance: ${ethers.formatUnits(currentUsdcBalance, 6)} USDC`);

  // Amount to transfer: 1000 USDC
  const usdcTransferAmount = ethers.parseUnits("1000", 6);

  // Ensure we have enough USDC (might need to swap more WETH for USDC)
  if (currentUsdcBalance < usdcTransferAmount) {
    const additionalUsdcNeeded = usdcTransferAmount - currentUsdcBalance;
    console.log(`\nNeed ${ethers.formatUnits(additionalUsdcNeeded, 6)} more USDC. Swapping WETH for USDC...`);

    // Estimate WETH needed for swap (rough estimate for test purposes)
    const estimatedWethNeeded = ethers.parseEther("1"); // Approximate amount needed for remaining USDC

    // Approve the router to spend WETH
    const approveTx = await wethContract.approve(UNISWAP_ROUTER_ADDRESS, estimatedWethNeeded);
    await approveTx.wait();
    console.log("Router approved to spend WETH for additional USDC");

    // Set up swap parameters
    const swapParams = {
      tokenIn: WETH_ADDRESS,
      tokenOut: USDC_ADDRESS,
      fee: 500, // 0.05% fee pool
      recipient: signer.address,
      deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes
      amountIn: estimatedWethNeeded,
      amountOutMinimum: 0, // No minimum for testing
      sqrtPriceLimitX96: 0 // No price limit
    };

    // Execute the swap
    const swapTx = await router.exactInputSingle(swapParams);
    await swapTx.wait();
    console.log("WETH swapped for additional USDC successfully");

    // Get new USDC balance
    const newUsdcBalance = await usdcContract.balanceOf(signer.address);
    console.log(`New USDC balance: ${ethers.formatUnits(newUsdcBalance, 6)} USDC`);
  }

  // Transfer 3 WETH to the vault
  console.log("\nTransferring 3 WETH to the vault...");
  const transferWethTx = await wethContract.transfer(vaultAddress, wethTransferAmount);
  await transferWethTx.wait();
  console.log(`Successfully transferred ${ethers.formatEther(wethTransferAmount)} WETH to vault`);

  // Transfer 6000 USDC to the vault
  console.log("\nTransferring 1000 USDC to the vault...");
  const transferUsdcTx = await usdcContract.transfer(vaultAddress, usdcTransferAmount);
  await transferUsdcTx.wait();
  console.log(`Successfully transferred ${ethers.formatUnits(usdcTransferAmount, 6)} USDC to vault`);

  // Verify token balances in the vault
  const vaultWethBalance = await wethContract.balanceOf(vaultAddress);
  const vaultUsdcBalance = await usdcContract.balanceOf(vaultAddress);
  console.log("\nVault token balances:");
  console.log(`WETH: ${ethers.formatEther(vaultWethBalance)} WETH`);
  console.log(`USDC: ${ethers.formatUnits(vaultUsdcBalance, 6)} USDC`);

  console.log("\nTest vault setup complete!");
  console.log("====================");
  console.log(`Vault Address: ${vaultAddress}`);
  console.log(`Position ID: ${positionId}`);
  console.log(`Position Platform: Uniswap V3`);
}

// Helper function to extract tokenId from mint transaction receipt
async function extractTokenIdFromReceipt(receipt, positionManager) {
  // Look for Transfer event from position manager
  for (const log of receipt.logs) {
    try {
      // Find Transfer event (Transfer(address,address,uint256))
      if (log.topics[0] === ethers.id("Transfer(address,address,uint256)")) {
        // Check if it's a transfer from zero address (new mint)
        const zeroAddress = ethers.zeroPadValue("0x0000000000000000000000000000000000000000", 32);
        if (log.topics[1] === zeroAddress) {
          return ethers.toBigInt(log.topics[3]);
        }
      }
    } catch (e) {
      continue;
    }
  }

  // Fallback: get balance and check the last token
  const balance = await positionManager.balanceOf(receipt.from);
  if (Number(balance) > 0) {
    const tokenId = await positionManager.tokenOfOwnerByIndex(receipt.from, Number(balance) - 1);
    return tokenId;
  }

  throw new Error("Could not extract tokenId from receipt");
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
