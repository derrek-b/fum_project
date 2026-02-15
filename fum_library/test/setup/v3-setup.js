/**
 * V3 Test Environment Setup
 *
 * Extends the core test environment with Uniswap V3-specific setup:
 * - Wraps ETH to WETH
 * - Swaps WETH for USDC
 * - Creates a V3 position
 * - Transfers assets to test vault
 */

import { ethers } from 'ethers';
import { setupCoreEnvironment } from '../test-env.js';
import chains from '../../src/configs/chains.js';
import tokens from '../../src/configs/tokens.js';
import { UniswapV3Adapter } from '../../src/adapters/index.js';
import contractData from '../../src/artifacts/contracts.js';
import ERC20_ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };

const ERC20_ABI = ERC20_ARTIFACT.abi;

/**
 * Setup V3-specific test environment
 * @param {Object} coreEnv - Core environment from setupCoreEnvironment
 * @returns {Object} Environment extended with V3-specific data
 */
async function setupV3Environment(coreEnv) {
  const { provider, signers, contracts } = coreEnv;
  const owner = signers[0];

  console.log('💰 Setting up V3 test environment...');

  // Create vault using the VaultFactory
  const vaultFactory = contracts.vaultFactory;
  const tx = await vaultFactory.createVault('Test Vault');
  const receipt = await tx.wait();

  // Find VaultCreated event to get the vault address
  const vaultCreatedEvent = receipt.logs.find(log => {
    try {
      const parsed = vaultFactory.interface.parseLog(log);
      return parsed && parsed.name === 'VaultCreated';
    } catch {
      return false;
    }
  });

  if (!vaultCreatedEvent) {
    throw new Error('VaultCreated event not found');
  }

  const vaultAddress = vaultFactory.interface.parseLog(vaultCreatedEvent).args[1];
  console.log(`  - Created vault at: ${vaultAddress}`);

  // Get vault contract instance
  const vaultAbi = contractData.PositionVault.abi;
  const testVault = new ethers.Contract(vaultAddress, vaultAbi, owner);

  // Get chain config for our forked network
  const chainConfig = chains[1337];
  const uniswapV3 = chainConfig.platformAddresses.uniswapV3;

  // Create adapter for interacting with Uniswap
  const adapter = new UniswapV3Adapter(1337);

  // 1. Wrap 10 ETH to WETH
  console.log('  - Wrapping 10 ETH to WETH...');
  const WETH_ABI = [
    'function deposit() payable',
    'function withdraw(uint256 amount)',
    ...ERC20_ABI
  ];

  const wethAddress = tokens.ETH.wrappedAddresses[1337];
  const weth = new ethers.Contract(wethAddress, WETH_ABI, owner);

  const wrapTx = await weth.deposit({ value: ethers.utils.parseEther('10') });
  await wrapTx.wait();
  console.log('  - WETH wrapped successfully');

  // 2. Swap 2 WETH for USDC
  console.log('  - Swapping 2 WETH for USDC...');

  const approveTx = await weth.approve(uniswapV3.routerAddress, ethers.utils.parseEther('2'));
  await approveTx.wait();

  const usdcAddress = tokens.USDC.addresses[1337];

  const swapParams = {
    tokenIn: wethAddress,
    tokenOut: usdcAddress,
    fee: 500,
    recipient: owner.address,
    amountIn: ethers.utils.parseEther('2').toString(),
    slippageTolerance: 1,
    sqrtPriceLimitX96: "0",
    provider: provider,
    deadlineMinutes: 2
  };

  const swapData = await adapter._generateSwapData(swapParams);
  const swapTx = await owner.sendTransaction({
    to: swapData.to,
    data: swapData.data,
    value: swapData.value,
  });
  await swapTx.wait();
  console.log('  - Swap completed successfully');

  // 3. Get current balances
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, owner);
  const wethBalance = await weth.balanceOf(owner.address);
  const usdcBalance = await usdc.balanceOf(owner.address);

  console.log(`  - WETH balance: ${ethers.utils.formatEther(wethBalance)} WETH`);
  console.log(`  - USDC balance: ${ethers.utils.formatUnits(usdcBalance, 6)} USDC`);

  const usdcPerEth = (parseFloat(ethers.utils.formatUnits(usdcBalance, 6)) / 2).toString();
  console.log(`  - Current price: 1 ETH = ${usdcPerEth} USDC`);

  // 4. Create a position using 20% of assets
  console.log('  - Creating Uniswap V3 position...');

  const wethAmount = wethBalance.div(5);
  const usdcAmount = usdcBalance.div(5);

  await (await weth.approve(uniswapV3.positionManagerAddress, wethAmount)).wait();
  await (await usdc.approve(uniswapV3.positionManagerAddress, usdcAmount)).wait();

  const poolData = await adapter._fetchPoolData(wethAddress, usdcAddress, 500, provider);

  const tickSpacing = 10;
  const tickLower = Math.floor(poolData.tick / tickSpacing) * tickSpacing - tickSpacing * 10;
  const tickUpper = Math.floor(poolData.tick / tickSpacing) * tickSpacing + tickSpacing * 10;

  const POSITION_MANAGER_ABI = [
    'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
    'function safeTransferFrom(address from, address to, uint256 tokenId) external'
  ];

  const positionManager = new ethers.Contract(uniswapV3.positionManagerAddress, POSITION_MANAGER_ABI, owner);

  const [token0, token1, amount0Desired, amount1Desired] =
    wethAddress.toLowerCase() < usdcAddress.toLowerCase()
      ? [wethAddress, usdcAddress, wethAmount, usdcAmount]
      : [usdcAddress, wethAddress, usdcAmount, wethAmount];

  const mintParams = {
    token0,
    token1,
    fee: 500,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min: 0,
    amount1Min: 0,
    recipient: owner.address,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };

  const mintResult = await positionManager.callStatic.mint(mintParams);
  const [tokenId, liquidity, amount0, amount1] = mintResult;
  const positionTokenId = tokenId;
  console.log(`  - Position will have ID: ${positionTokenId}`);

  const mintTx = await positionManager.mint(mintParams);
  await mintTx.wait();
  console.log(`  - Created position NFT with ID: ${positionTokenId}`);

  // 5. Transfer most assets to vault
  console.log('  - Transferring assets to vault...');

  const remainingWeth = await weth.balanceOf(owner.address);
  if (remainingWeth.gt(0)) {
    const wethToTransfer = remainingWeth.mul(60).div(100);
    await (await weth.transfer(vaultAddress, wethToTransfer)).wait();
  }

  const remainingUsdc = await usdc.balanceOf(owner.address);
  if (remainingUsdc.gt(0)) {
    const usdcToTransfer = remainingUsdc.mul(60).div(100);
    await (await usdc.transfer(vaultAddress, usdcToTransfer)).wait();
  }

  if (positionTokenId) {
    await (await positionManager.safeTransferFrom(owner.address, vaultAddress, positionTokenId)).wait();
  }

  console.log('  ✅ V3 test environment setup complete!');

  const testPosition = {
    id: positionTokenId.toString(),
    liquidity: liquidity.toString(),
    tickLower,
    tickUpper,
    token0,
    token1,
    fee: 500,
    amount0: amount0.toString(),
    amount1: amount1.toString()
  };

  return {
    testVault,
    testPosition,
    positionTokenId,
    wethAddress,
    usdcAddress,
    uniswapV3,
    poolData,
    usdcPerEth,
  };
}

/**
 * Complete V3 test environment setup
 * @param {Object} options - Configuration options
 * @returns {Object} Test environment with V3-specific utilities
 */
export async function setupV3TestEnvironment(options = {}) {
  const {
    port = 8545,
    deployContracts = true,
    updateContractsFile = true,
    quiet = true,
  } = options;

  // Setup core environment first
  const coreEnv = await setupCoreEnvironment({
    port,
    deployContracts,
    updateContractsFile,
    quiet,
  });

  // Add V3-specific setup if contracts are deployed
  let v3Env = {};
  if (deployContracts) {
    v3Env = await setupV3Environment(coreEnv);
  }

  // Merge environments
  const env = {
    ...coreEnv,
    ...v3Env,
  };

  console.log('✅ V3 test environment ready!');

  return env;
}
