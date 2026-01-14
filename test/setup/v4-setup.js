/**
 * V4 Test Environment Setup
 *
 * Extends the core test environment with Uniswap V4-specific setup:
 * - Swaps ETH for USDC using V4 adapter's _generateSwapData
 * - Sets up Permit2 approvals for V4 PositionManager
 * - Fetches V4 pool data for ETH/USDC
 */

import { ethers } from 'ethers';
import { setupCoreEnvironment } from '../test-env.js';
import chains from '../../src/configs/chains.js';
import tokens from '../../src/configs/tokens.js';
import { UniswapV4Adapter } from '../../src/adapters/index.js';
import ERC20_ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };

const ERC20_ABI = ERC20_ARTIFACT.abi;
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

/**
 * Setup V4-specific test environment
 * @param {Object} coreEnv - Core environment from setupCoreEnvironment
 * @returns {Object} Environment extended with V4-specific data
 */
async function setupV4Environment(coreEnv) {
  const { provider, signers } = coreEnv;
  const owner = signers[0];

  console.log('💰 Setting up V4 test environment...');

  // Create V4 adapter
  const adapter = new UniswapV4Adapter(1337, provider);

  // Get chain config
  const chainConfig = chains[1337];
  const uniswapV4 = chainConfig.platformAddresses.uniswapV4;

  // Token addresses
  const NATIVE_ETH = ethers.constants.AddressZero;
  const usdcAddress = tokens.USDC.addresses[1337];

  // 1. Swap ETH for USDC using V4 adapter's _generateSwapData
  console.log('  - Swapping 1 ETH for USDC...');

  const swapData = await adapter._generateSwapData({
    tokenIn: NATIVE_ETH,
    tokenOut: usdcAddress,
    amountIn: ethers.utils.parseEther('1').toString(),
    recipient: owner.address,
    slippageTolerance: 1,
    deadlineMinutes: 20
  });

  const swapTx = await owner.sendTransaction({
    to: swapData.to,
    data: swapData.data,
    value: swapData.value
  });
  await swapTx.wait();

  // Get USDC balance
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, owner);
  const usdcBalance = await usdc.balanceOf(owner.address);
  console.log(`  - USDC balance: ${ethers.utils.formatUnits(usdcBalance, 6)} USDC`);

  // 2. Approve USDC to Permit2 (standard ERC20 approval)
  console.log('  - Approving USDC to Permit2...');
  await (await usdc.approve(PERMIT2_ADDRESS, ethers.constants.MaxUint256)).wait();

  // 3. Set Permit2 allowance for V4 PositionManager
  console.log('  - Setting Permit2 allowance for PositionManager...');
  const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, [
    'function approve(address token, address spender, uint160 amount, uint48 expiration) external'
  ], owner);

  const positionManagerAddress = adapter.addresses.positionManagerAddress;
  const maxAmount = ethers.BigNumber.from(2).pow(160).sub(1); // type(uint160).max
  const farFutureExpiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365; // 1 year

  await (await permit2Contract.approve(usdcAddress, positionManagerAddress, maxAmount, farFutureExpiration)).wait();

  // 4. Fetch V4 pool data for ETH/USDC
  console.log('  - Fetching V4 pool data...');
  const FEE = 500;
  const TICK_SPACING = 10;

  const poolData = await adapter._fetchPoolData(
    NATIVE_ETH,
    usdcAddress,
    FEE,
    TICK_SPACING,
    ethers.constants.AddressZero,
    provider
  );

  if (!poolData || poolData.liquidity === '0') {
    throw new Error('V4 native ETH/USDC 500 pool has no liquidity');
  }

  console.log(`  - Pool tick: ${poolData.tick}`);
  console.log(`  - Pool liquidity: ${poolData.liquidity}`);

  console.log('  ✅ V4 test environment setup complete!');

  return {
    adapter,
    uniswapV4,
    usdcAddress,
    poolData,
    usdcBalance: usdcBalance.toString(),
  };
}

/**
 * Complete V4 test environment setup
 * @param {Object} options - Configuration options
 * @returns {Object} Test environment with V4-specific utilities
 */
export async function setupV4TestEnvironment(options = {}) {
  const {
    port = 8547, // Different default port to avoid conflicts with V3 tests
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

  // Add V4-specific setup
  const v4Env = await setupV4Environment(coreEnv);

  // Merge environments
  const env = {
    ...coreEnv,
    ...v4Env,
  };

  console.log('✅ V4 test environment ready!');

  return env;
}
