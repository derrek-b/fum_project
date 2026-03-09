// test/scripts/create-test-vault.js
// Creates a test vault, funds the wallet and vault with tokens.
// Optionally enables automation (executor + strategy).
//
// Usage:
//   node test/scripts/create-test-vault.js                                            # vault + tokens only
//   ENABLE_STRATEGY=1 TARGET_PLATFORM=uniswapV3 node test/scripts/create-test-vault.js  # + strategy + targets
//   ENABLE_AUTOMATION=1 TARGET_PLATFORM=uniswapV3 node test/scripts/create-test-vault.js # + executor + strategy + targets
//
// TARGET_PLATFORM determines both platform and target tokens:
//   uniswapV3     → WETH/USDC
//   uniswapV4     → ETH/USDC
//
// NOTE: This script is for local Hardhat testing only
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
  // Hardcoded for local Hardhat testing only
  const chainId = 1337;
  const rpcUrl = 'http://localhost:8545';
  const networkConfig = getChainConfig(chainId);

  if (!networkConfig) {
    throw new Error(`Network with chainId ${chainId} not configured`);
  }

  console.log(`Creating test vault on local Hardhat (${networkConfig.name})...`);

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

  const vault = new ethers.Contract(vaultAddress, positionVaultABI, signer);

  const enableAutomation = process.env.ENABLE_AUTOMATION === '1';
  const enableStrategy = enableAutomation || process.env.ENABLE_STRATEGY === '1';

  // === Set strategy + targets (opt-in: ENABLE_STRATEGY=1 or ENABLE_AUTOMATION=1) ===
  // Must run BEFORE executor auth — setExecutor triggers the automation service,
  // so strategy and targets need to be in place first.
  if (enableStrategy) {
    const targetPlatform = process.env.TARGET_PLATFORM;
    const TARGET_TOKENS_BY_PLATFORM = {
      uniswapV3: ['WETH', 'USDC'],
      uniswapV4: ['ETH', 'USDC'],
    };
    const targetTokens = TARGET_TOKENS_BY_PLATFORM[targetPlatform];
    if (!targetTokens) {
      throw new Error(`TARGET_PLATFORM must be set to one of: ${Object.keys(TARGET_TOKENS_BY_PLATFORM).join(', ')}`);
    }

    // Set target platform and tokens on vault
    console.log(`\nSetting vault targets: ${targetPlatform} / ${targetTokens.join(', ')}...`);
    await (await vault.setTargetPlatforms([targetPlatform])).wait();
    await (await vault.setTargetTokens(targetTokens)).wait();

    // Configure BabySteps Aggressive strategy
    const babyStepsAddress = JSON.parse(fs.readFileSync(deploymentPath, 'utf8')).contracts.BabyStepsStrategy;
    const STRATEGY_ABI = [
      'function authorizeVault(address vault) external',
      'function selectTemplate(uint8 template) external',
    ];
    const TEMPLATE_AGGRESSIVE = 3;

    const strategy = new ethers.Contract(babyStepsAddress, STRATEGY_ABI, signer);

    console.log(`Configuring BabySteps Aggressive strategy (${babyStepsAddress})...`);

    // 1. Authorize vault on strategy (caller must be vault owner)
    await (await strategy.authorizeVault(vaultAddress)).wait();

    // 2. Set strategy address on vault
    await (await vault.setStrategy(babyStepsAddress)).wait();

    // 3. Select aggressive template via vault.execute (msg.sender must be vault)
    const selectTemplateCalldata = strategy.interface.encodeFunctionData('selectTemplate', [TEMPLATE_AGGRESSIVE]);
    await (await vault.execute([babyStepsAddress], [selectTemplateCalldata])).wait();

    console.log('Strategy configured: BabySteps Aggressive (template 3)');
  } else {
    console.log('\nSkipping strategy setup (set ENABLE_STRATEGY=1 to enable)');
  }

  // === Authorize automation executor (opt-in: ENABLE_AUTOMATION=1) ===
  // Runs LAST — this fires the on-chain event that the automation service listens for.
  if (enableAutomation) {
    const vaultInfo = await vaultFactory.getVaultInfo(vaultAddress);
    const executorIndex = vaultInfo[4];
    console.log(`\nVault assigned executorIndex: ${executorIndex}`);

    // Dev-only mnemonic — must match AUTOMATION_MNEMONIC in fum_automation/.env.local
    const DEV_MNEMONIC = 'pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard';
    const hdNode = ethers.utils.HDNode.fromMnemonic(DEV_MNEMONIC);
    const executorAddress = hdNode.derivePath(`m/44'/60'/0'/0/${executorIndex}`).address;
    console.log(`Derived executor address: ${executorAddress}`);

    const executorFunding = ethers.utils.parseEther("10");
    console.log(`Authorizing executor and funding with ${ethers.utils.formatEther(executorFunding)} ETH...`);
    await (await vault.setExecutor(executorAddress, { value: executorFunding })).wait();

    const executorBalance = await provider.getBalance(executorAddress);
    console.log(`Executor authorized and funded. Balance: ${ethers.utils.formatEther(executorBalance)} ETH`);
  } else {
    console.log('\nSkipping executor setup (set ENABLE_AUTOMATION=1 to enable)');
  }

  // === Fund wallet with diverse tokens ===
  const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
  const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
  const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
  const WBTC_ADDRESS = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f';
  const LINK_ADDRESS = '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4';

  const wethContract = new ethers.Contract(WETH_ADDRESS, FALLBACK_ABIS.WETH, signer);
  const usdcContract = new ethers.Contract(USDC_ADDRESS, FALLBACK_ABIS.ERC20, signer);
  const usdtContract = new ethers.Contract(USDT_ADDRESS, FALLBACK_ABIS.ERC20, signer);
  const wbtcContract = new ethers.Contract(WBTC_ADDRESS, FALLBACK_ABIS.ERC20, signer);
  const linkContract = new ethers.Contract(LINK_ADDRESS, FALLBACK_ABIS.ERC20, signer);

  // Wrap 45 ETH → WETH (5 to keep + 10 each for 4 token swaps)
  console.log("\nWrapping 45 ETH to WETH...");
  const wrapTx = await wethContract.deposit({ value: ethers.utils.parseEther("45") });
  await wrapTx.wait();

  // Approve router for all swaps
  const UNISWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
  const router = new ethers.Contract(UNISWAP_ROUTER_ADDRESS, FALLBACK_ABIS.UniswapV3Router, signer);

  const approveWethTx = await wethContract.approve(UNISWAP_ROUTER_ADDRESS, ethers.utils.parseEther("40"));
  await approveWethTx.wait();

  // Swap 10 WETH for each token
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const swapWethFor = async (tokenOut, symbol, fee = 500) => {
    console.log(`Swapping 10 WETH for ${symbol}...`);
    const tx = await router.exactInputSingle({
      tokenIn: WETH_ADDRESS,
      tokenOut,
      fee,
      recipient: signer.address,
      deadline,
      amountIn: ethers.utils.parseEther("10"),
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    });
    await tx.wait();
  };

  await swapWethFor(USDC_ADDRESS, 'USDC', 500);
  await swapWethFor(USDT_ADDRESS, 'USDT', 500);
  await swapWethFor(WBTC_ADDRESS, 'WBTC', 500);
  await swapWethFor(LINK_ADDRESS, 'LINK', 3000);

  // Print wallet balances
  console.log("\nWallet token balances:");
  console.log(`  WETH: ${ethers.utils.formatEther(await wethContract.balanceOf(signer.address))}`);
  console.log(`  USDC: ${ethers.utils.formatUnits(await usdcContract.balanceOf(signer.address), 6)}`);
  console.log(`  USDT: ${ethers.utils.formatUnits(await usdtContract.balanceOf(signer.address), 6)}`);
  console.log(`  WBTC: ${ethers.utils.formatUnits(await wbtcContract.balanceOf(signer.address), 8)}`);
  console.log(`  LINK: ${ethers.utils.formatEther(await linkContract.balanceOf(signer.address))}`);

  // === Transfer tokens to the vault ===
  console.log("\nTransferring tokens to the vault...");

  const wethTransferAmount = ethers.utils.parseEther("3");
  const usdcTransferAmount = ethers.utils.parseUnits("1000", 6);

  await (await wethContract.transfer(vaultAddress, wethTransferAmount)).wait();
  console.log(`  Transferred ${ethers.utils.formatEther(wethTransferAmount)} WETH`);

  await (await usdcContract.transfer(vaultAddress, usdcTransferAmount)).wait();
  console.log(`  Transferred ${ethers.utils.formatUnits(usdcTransferAmount, 6)} USDC`);

  // Verify vault balances
  console.log("\nVault token balances:");
  console.log(`  WETH: ${ethers.utils.formatEther(await wethContract.balanceOf(vaultAddress))}`);
  console.log(`  USDC: ${ethers.utils.formatUnits(await usdcContract.balanceOf(vaultAddress), 6)}`);

  console.log("\nTest vault setup complete!");
  console.log("====================");
  console.log(`Vault Address: ${vaultAddress}`);
  console.log("Wallet funded with WETH, USDC, USDT, WBTC, LINK for manual UI testing.");
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
