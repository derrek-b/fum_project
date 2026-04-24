/**
 * V4 Test Environment Setup
 *
 * Extends the core test environment with Uniswap V4-specific setup:
 * - Creates a vault using VaultFactory
 * - Swaps ETH for USDC using V4 adapter's _generateSwapData
 * - Sets up Permit2 approvals for V4 PositionManager
 * - Creates a V4 position and transfers it to the vault
 * - Fetches V4 pool data for ETH/USDC
 */

import { ethers } from 'ethers';
import { setupCoreEnvironment, connectToSharedHardhat } from '../test-env.js';
import chains from '../../src/configs/chains.js';
import tokens from '../../src/configs/tokens.js';
import UniswapV4Adapter from '../../src/adapters/UniswapV4Adapter.js';
import { configureTheGraph } from '../../src/services/theGraph.js';
import contractData from '../../src/artifacts/contracts.js';
import ERC20_ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };

const ERC20_ABI = ERC20_ARTIFACT.abi;
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

/**
 * Setup V4-specific test environment
 * @param {Object} coreEnv - Core environment from setupCoreEnvironment
 * @returns {Object} Environment extended with V4-specific data
 */
async function setupV4Environment(coreEnv) {
  const { provider, signers, contracts } = coreEnv;
  const owner = signers[0];

  // Configure The Graph API key for V4 subgraph queries
  const theGraphApiKey = process.env.THEGRAPH_API_KEY;
  if (theGraphApiKey) {
    configureTheGraph({ apiKey: theGraphApiKey });
  }

  console.log('💰 Setting up V4 test environment...');

  // Create vault using the VaultFactory
  const vaultFactory = contracts.vaultFactory;
  const createVaultTx = await vaultFactory.createVault('V4 Test Vault');
  const createVaultReceipt = await createVaultTx.wait();

  // Find VaultCreated event to get the vault address
  const vaultCreatedEvent = createVaultReceipt.logs.find(log => {
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

  // Create V4 adapter — constructor creates its own providers internally
  const adapter = new UniswapV4Adapter(1337);

  // Get chain config
  const chainConfig = chains[1337];
  const uniswapV4 = chainConfig.platformAddresses.uniswapV4;

  // Token addresses
  const NATIVE_ETH = ethers.constants.AddressZero;
  const usdcAddress = tokens.USDC.addresses[1337];

  // 1. Swap ETH for USDC using V4 adapter's _generateSwapData
  console.log('  - Swapping 2 ETH for USDC...');

  const swapData = await adapter._generateSwapData({
    tokenIn: NATIVE_ETH,
    tokenOut: usdcAddress,
    amountIn: ethers.utils.parseEther('2').toString(),
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

  const poolData = await adapter.fetchPoolDataForTesting(
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

  // 5. Create a V4 position
  console.log('  - Creating V4 position...');

  // Use 20% of USDC balance for position
  const usdcForPosition = usdcBalance.div(5);
  // Calculate ETH needed (estimate based on USDC/2 ETH swap ratio)
  const ethForPosition = ethers.utils.parseEther('0.2');

  // Calculate tick range around current tick
  const tickLower = Math.floor(poolData.tick / TICK_SPACING) * TICK_SPACING - TICK_SPACING * 10;
  const tickUpper = Math.floor(poolData.tick / TICK_SPACING) * TICK_SPACING + TICK_SPACING * 10;

  // Determine token ordering (ETH is AddressZero, which is always < any other address)
  // So currency0 = ETH (AddressZero), currency1 = USDC
  const poolKey = {
    currency0: NATIVE_ETH,
    currency1: usdcAddress,
    fee: FEE,
    tickSpacing: TICK_SPACING,
    hooks: ethers.constants.AddressZero
  };

  const createPositionData = await adapter.generateCreatePositionData({
    position: { tickLower, tickUpper },
    token0Amount: ethForPosition.toString(), // ETH
    token1Amount: usdcForPosition.toString(), // USDC
    provider,
    walletAddress: owner.address,
    poolKey,
    poolData,
    token0Data: { address: NATIVE_ETH, decimals: 18 },
    token1Data: { address: usdcAddress, decimals: 6 },
    slippageTolerance: 5, // 5% slippage for test
    deadlineMinutes: 20
  });

  // Execute mint transaction
  const mintTx = await owner.sendTransaction({
    to: createPositionData.to,
    data: createPositionData.data,
    value: createPositionData.value
  });
  const mintReceipt = await mintTx.wait();

  // Parse receipt to get tokenId using adapter's method
  const mintResult = adapter.parseIncreaseLiquidityReceipt(mintReceipt, {
    position: { tickLower, tickUpper },
    poolData
  });
  const positionTokenId = mintResult.tokenId;
  console.log(`  - Created position NFT with ID: ${positionTokenId}`);

  // 6. Transfer position and assets to vault
  console.log('  - Transferring assets to vault...');

  // Transfer position NFT to vault
  const POSITION_MANAGER_ABI = [
    'function safeTransferFrom(address from, address to, uint256 tokenId) external'
  ];
  const positionManager = new ethers.Contract(positionManagerAddress, POSITION_MANAGER_ABI, owner);
  await (await positionManager.safeTransferFrom(owner.address, vaultAddress, positionTokenId)).wait();

  // Transfer some USDC to vault
  const remainingUsdc = await usdc.balanceOf(owner.address);
  if (remainingUsdc.gt(0)) {
    const usdcToTransfer = remainingUsdc.mul(60).div(100);
    await (await usdc.transfer(vaultAddress, usdcToTransfer)).wait();
  }

  console.log('  ✅ V4 test environment setup complete!');

  const testPosition = {
    id: positionTokenId.toString(),
    pool: poolData.poolId,
    liquidity: createPositionData.quote.liquidity,
    tickLower,
    tickUpper,
    token0: NATIVE_ETH,
    token1: usdcAddress,
    fee: FEE,
    tickSpacing: TICK_SPACING,
    hooks: ethers.constants.AddressZero
  };

  return {
    adapter,
    testVault,
    testPosition,
    positionTokenId,
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

/**
 * V4 test environment using a shared Hardhat node (started by globalSetup).
 * Connects to the existing node, creates V4-specific state (vault, swaps, position).
 * @returns {Object} Test environment with V4-specific utilities
 */
export async function setupV4SharedEnvironment() {
  const { getDeployedContracts } = await import('./test-contracts.js');
  const coreEnv = await connectToSharedHardhat();

  // Get contract instances from already-deployed addresses
  const deployment = await getDeployedContracts(coreEnv.signers[0]);
  coreEnv.contracts = deployment.contracts;
  coreEnv.contractAddresses = deployment.addresses;

  // Add V4-specific setup (vault, swaps, position, Permit2 approvals)
  const v4Env = await setupV4Environment(coreEnv);

  const env = {
    ...coreEnv,
    ...v4Env,
  };

  console.log('✅ V4 shared environment ready!');
  return env;
}
