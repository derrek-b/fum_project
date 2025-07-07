/**
 * Test Environment
 * 
 * Main entry point for setting up the complete test environment.
 * Combines Ganache, contract deployment, and test utilities.
 */

import { ethers } from 'ethers';
import { startGanache, TEST_ACCOUNTS } from './setup/ganache-config.js';
import { deployFUMContracts, deployTestVault, syncBytecodeFromFUM } from './setup/test-contracts.js';
import chains from '../src/configs/chains.js';
import tokens from '../src/configs/tokens.js';
import UniswapV3Adapter from '../src/adapters/UniswapV3Adapter.js';
import contractData from '../src/artifacts/contracts.js';
import ERC20_ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' assert { type: 'json' };
import path from 'path';
import { fileURLToPath } from 'url';

const ERC20_ABI = ERC20_ARTIFACT.abi;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Complete test environment setup
 * @param {Object} options - Configuration options
 * @returns {Object} Test environment with all utilities
 */
export async function setupTestEnvironment(options = {}) {
  const {
    port = 8545,
    deployContracts = true,
    updateContractsFile = false,
    quiet = true,
    syncBytecode = false,
    fumProjectPath = path.join(__dirname, '../../fum'), // Adjust if needed
  } = options;
  
  console.log('🚀 Starting test environment...');
  
  // Sync bytecode if requested
  if (syncBytecode) {
    console.log('📦 Syncing bytecode from FUM project...');
    await syncBytecodeFromFUM(fumProjectPath);
  }
  
  // Start Ganache
  console.log('🔧 Starting Ganache with Arbitrum fork...');
  const ganache = await startGanache({ port, quiet });
  
  let contracts = {};
  let contractAddresses = {};
  
  // Deploy contracts if requested
  if (deployContracts) {
    console.log('📄 Deploying FUM contracts...');
    const deployment = await deployFUMContracts(
      ganache.signers[0], 
      { updateContractsFile }
    );
    contracts = deployment.contracts;
    contractAddresses = deployment.addresses;
  }
  
  // Create a test vault with position and assets
  let testVault = null;
  let testPosition = null;
  let positionTokenId = null;
  
  if (deployContracts) {
    console.log('💰 Setting up test vault with assets...');
    console.log('  - Starting vault creation...');
    
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
    testVault = new ethers.Contract(vaultAddress, vaultAbi, ganache.signers[0]);
    
    // Get chain config for our forked network
    const chainConfig = chains[1337];
    const uniswapV3 = chainConfig.platformAddresses.uniswapV3;
    
    // Create adapter for interacting with Uniswap
    const adapter = new UniswapV3Adapter(1337);
    
    // Setup tokens - we'll need WETH and USDC
    const owner = ganache.signers[0];
    
    // 1. Wrap 10 ETH to WETH
    console.log('  - Wrapping 10 ETH to WETH...');
    const WETH_ABI = [
      'function deposit() payable',
      'function withdraw(uint256 amount)',
      ...ERC20_ABI // Include all standard ERC20 functions
    ];
    
    // Get WETH address from tokens config
    const wethAddress = tokens.WETH.addresses[1337];
    const weth = new ethers.Contract(wethAddress, WETH_ABI, owner);
    
    const wrapTx = await weth.deposit({ value: ethers.parseEther('10') });
    await wrapTx.wait();
    console.log('  - WETH wrapped successfully');
    
    // 2. Swap 2 WETH for USDC
    console.log('  - Swapping 2 WETH for USDC...');
    
    // First approve router to spend WETH
    const approveTx = await weth.approve(uniswapV3.routerAddress, ethers.parseEther('2'));
    await approveTx.wait();
    
    // Get USDC address from tokens config
    const usdcAddress = tokens.USDC.addresses[1337];
    
    // Create swap params
    const swapParams = {
      tokenIn: wethAddress,
      tokenOut: usdcAddress,
      fee: 500, // 0.05% fee pool
      recipient: owner.address,
      amountIn: ethers.parseEther('2'),
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
      provider: ganache.provider,
      chainId: 1337,
      deadlineMinutes: 2  // 2 minutes for L2
    };
    
    const swapData = await adapter.generateSwapData(swapParams);
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
    
    console.log(`  - WETH balance: ${ethers.formatEther(wethBalance)} WETH`);
    console.log(`  - USDC balance: ${ethers.formatUnits(usdcBalance, 6)} USDC`);
    
    // 4. Create a position using 20% of assets
    console.log('  - Creating Uniswap V3 position...');
    
    // Approve position manager to spend tokens
    const wethAmount = wethBalance / 5n; // 20% of WETH
    const usdcAmount = usdcBalance / 5n; // 20% of USDC
    
    await (await weth.approve(uniswapV3.positionManagerAddress, wethAmount)).wait();
    await (await usdc.approve(uniswapV3.positionManagerAddress, usdcAmount)).wait();
    
    // Get current pool data to center position around current tick
    const poolData = await adapter.fetchPoolData(wethAddress, usdcAddress, 500, ganache.provider);
    
    // Create position centered around current tick
    const tickSpacing = 10; // 0.05% fee tier has 10 tick spacing
    const tickLower = Math.floor(poolData.tick / tickSpacing) * tickSpacing - tickSpacing * 10;
    const tickUpper = Math.floor(poolData.tick / tickSpacing) * tickSpacing + tickSpacing * 10;
    
    const POSITION_MANAGER_ABI = [
      'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
      'function safeTransferFrom(address from, address to, uint256 tokenId) external'
    ];
    
    const positionManager = new ethers.Contract(uniswapV3.positionManagerAddress, POSITION_MANAGER_ABI, owner);
    
    // Sort tokens to match pool order
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
    
    // Get tokenId directly from mint function return values
    const mintResult = await positionManager.mint.staticCall(mintParams);
    positionTokenId = mintResult[0]; // tokenId is first return value
    console.log(`  - Position will have ID: ${positionTokenId}`);
    
    // Now execute the actual mint transaction
    const mintTx = await positionManager.mint(mintParams);
    await mintTx.wait();
    console.log(`  - Created position NFT with ID: ${positionTokenId}`);
    
    // 5. Transfer all assets to vault
    console.log('  - Transferring assets to vault...');
    
    // Transfer remaining WETH
    const remainingWeth = await weth.balanceOf(owner.address);
    if (remainingWeth > 0n) {
      await (await weth.transfer(vaultAddress, remainingWeth)).wait();
    }
    
    // Transfer remaining USDC
    const remainingUsdc = await usdc.balanceOf(owner.address);
    if (remainingUsdc > 0n) {
      await (await usdc.transfer(vaultAddress, remainingUsdc)).wait();
    }
    
    // Transfer position NFT to vault (vault can receive ERC721)
    if (positionTokenId) {
      await (await positionManager.safeTransferFrom(owner.address, vaultAddress, positionTokenId)).wait();
    }
    
    console.log('  ✅ Test vault setup complete!');
    
    testPosition = {
      tokenId: positionTokenId,
      tickLower,
      tickUpper,
      token0,
      token1,
      fee: 500,
    };
  }
  
  // Create test environment object
  const env = {
    // Ganache utilities
    provider: ganache.provider,
    wsProvider: ganache.wsProvider,
    signers: ganache.signers,
    accounts: TEST_ACCOUNTS,
    
    // Contract instances
    contracts,
    contractAddresses,
    
    // Test vault and position
    testVault,
    testPosition,
    positionTokenId,
    
    
    // Helper functions
    async createVault(params = {}) {
      if (!contracts.vaultFactory) {
        throw new Error('VaultFactory not deployed');
      }
      
      const vaultConfig = {
        name: 'Test Vault',
        symbol: 'TEST-V',
        depositor: ganache.signers[0].address,
        executor: ganache.signers[1].address,
        strategist: ganache.signers[2].address,
        feeRecipient: ganache.signers[3].address,
        performanceFee: 1000, // 10%
        managementFee: 200,   // 2%
        ...params,
      };
      
      return deployTestVault(contracts.vaultFactory, vaultConfig);
    },
    
    async fundAccount(address, amountETH = '10') {
      const funder = ganache.signers[0];
      const tx = await funder.sendTransaction({
        to: address,
        value: ethers.parseEther(amountETH),
      });
      await tx.wait();
      return tx;
    },
    
    async getTokenBalance(tokenAddress, accountAddress) {
      const ERC20_ABI = [
        'function balanceOf(address account) view returns (uint256)',
      ];
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, ganache.provider);
      return await token.balanceOf(accountAddress);
    },
    
    // Snapshot management
    async snapshot() {
      return await ganache.provider.send('evm_snapshot', []);
    },
    
    async revert(snapshotId) {
      await ganache.provider.send('evm_revert', [snapshotId]);
    },
    
    // Time manipulation
    async increaseTime(seconds) {
      await ganache.provider.send('evm_increaseTime', [seconds]);
      await ganache.provider.send('evm_mine', []);
    },
    
    async mineBlocks(count = 1) {
      for (let i = 0; i < count; i++) {
        await ganache.provider.send('evm_mine', []);
      }
    },
    
    // Cleanup function
    async teardown() {
      console.log('🧹 Cleaning up test environment...');
      await ganache.stop();
    },
  };
  
  console.log('✅ Test environment ready!');
  
  // Log useful information
  if (!quiet) {
    console.log('\n📊 Test Environment Summary:');
    console.log(`- RPC URL: http://localhost:${port}`);
    console.log(`- WebSocket URL: ws://localhost:${port}`);
    console.log(`- Test accounts: ${ganache.signers.length}`);
    console.log(`- Contracts deployed: ${Object.keys(contracts).length}`);
    console.log('\n');
  }
  
  return env;
}

/**
 * Quick setup for unit tests that don't need full environment
 * @param {Object} options - Configuration options
 * @returns {Object} Minimal test environment
 */
export async function quickTestSetup(options = {}) {
  return setupTestEnvironment({
    deployContracts: false,
    quiet: true,
    ...options,
  });
}

// Export all test utilities
export * from './setup/ganache-config.js';
export * from './setup/test-contracts.js';