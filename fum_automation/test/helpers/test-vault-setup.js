/**
 * @fileoverview Configurable test vault setup for automation service tests
 * Refactored from fum_library/test/test-env.js to support different AP/NP/AT/NT scenarios
 */

import { ethers } from 'ethers';
import { UniswapV3Adapter } from 'fum_library/adapters';
import { getChainConfig, getTokensByChain, getTokenAddress, getTokenBySymbol } from 'fum_library';
import { getWrappedNativeAddress, getWrappedNativeSymbol, isWrappedNativeToken } from 'fum_library/helpers/tokenHelpers';
import { getVaultContract } from 'fum_library/blockchain';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

/**
 * Map strategy IDs to deployed contract names
 * Add new strategies here as they are implemented
 */
const STRATEGY_CONTRACT_MAP = {
  'bob': 'BabyStepsStrategy',
  // Future strategies:
  // 'parris': 'ParrisStrategy',
  // 'fed': 'FedStrategy',
};

/**
 * Get token address, handling wrapped native tokens specially since they're not in the token config
 * @param {string} symbol - Token symbol
 * @param {number} chainId - Chain ID
 * @returns {string} Token address
 */
function getTokenAddressForTest(symbol, chainId) {
  if (isWrappedNativeToken(symbol)) {
    return getWrappedNativeAddress(chainId);
  }
  return getTokenAddress(symbol, chainId);
}

/**
 * Get token data by symbol, handling wrapped native tokens specially since they're not in the token config
 * @param {string} symbol - Token symbol
 * @returns {Object} Token data with decimals and symbol
 */
function getTokenBySymbolForTest(symbol) {
  if (isWrappedNativeToken(symbol)) {
    return { symbol, decimals: 18 };
  }
  return getTokenBySymbol(symbol);
}

/**
 * Set up a test vault with configurable positions, tokens, and balances
 * @param {Object} hardhat - Hardhat instance with provider and signers
 * @param {Object} contracts - Deployed FUM contract instances
 * @param {Object} deployedContracts - Deployed FUM contract addresses
 * @param {Object} config - Configuration for vault setup
 * @returns {Promise<Object>} Test vault with positions and tokens
 */
export async function setupTestVault(hardhat, contracts, deployedContracts, config = {}) {
  const defaults = {
    // Token configuration
    wrapEthAmount: '10',        // How much ETH to wrap
    nativeEthAmount: null,      // Amount of native ETH to send directly to vault (null = none)
    swapTokens: [               // Which tokens to swap for and amounts
      { from: 'WETH', to: 'USDC', amount: '2' }
    ],

    // Position configuration
    positions: [                // Which positions to create
      {
        token0: 'USDC',
        token1: 'WETH',
        fee: 500,
        percentOfAssets: 20,    // Use 20% of available tokens
        tickRange: {
          type: 'centered',     // 'centered', 'above', 'below', or 'custom'
          spacing: 10           // ± 10 tick spacings from current
        }
      }
    ],

    // Vault token balances
    tokenTransfers: {           // How much to transfer to vault
      'WETH': 60,              // 60% of remaining
      'USDC': 60               // 60% of remaining
    },

    // Vault target configuration
    targetTokens: null,         // If null, auto-derived from positions. If specified, uses exact tokens
    targetPlatforms: ['uniswapV3'], // Target platforms for the vault

    // Strategy configuration
    strategy: 'bob',            // Strategy ID: 'bob' | 'parris' | 'fed' (future)

    vaultName: 'Test Vault',
    slippageTolerance: 1
  };

  const settings = { ...defaults, ...config };

  console.log('💰 Setting up configurable test vault...');
  console.log(`  - Vault: ${settings.vaultName}`);
  console.log(`  - Positions: ${settings.positions.length}`);
  console.log(`  - Token swaps: ${settings.swapTokens.length}`);

  // Create vault using the VaultFactory
  console.log('  - Creating vault...');
  const vaultFactory = contracts.vaultFactory;
  const tx = await vaultFactory.createVault(settings.vaultName);
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

  // Get vault contract instance using library helper
  const testVault = getVaultContract(vaultAddress, hardhat.provider).connect(hardhat.signers[0]);

  // Get chain config for our forked network
  const chainConfig = getChainConfig(1337);
  const uniswapV3 = chainConfig.platformAddresses.uniswapV3;

  // Get tokens for chain
  const tokens = getTokensByChain(1337);

  // Create adapter for interacting with Uniswap
  const adapter = new UniswapV3Adapter(1337);
  const owner = hardhat.signers[0];

  // Step 0.5: Send native ETH to vault (if configured)
  if (settings.nativeEthAmount && parseFloat(settings.nativeEthAmount) > 0) {
    console.log(`  - Sending ${settings.nativeEthAmount} native ETH to vault...`);
    const tx = await owner.sendTransaction({
      to: vaultAddress,
      value: ethers.utils.parseEther(settings.nativeEthAmount)
    });
    await tx.wait();
    console.log('  - Native ETH sent to vault successfully');
  }

  // Step 1: Wrap ETH to WETH
  console.log(`  - Wrapping ${settings.wrapEthAmount} ETH to WETH...`);
  const WETH_ABI = [
    'function deposit() payable',
    'function withdraw(uint256 amount)',
    ...ERC20_ABI
  ];

  const wrappedNativeAddress = getWrappedNativeAddress(1337);
  const wrappedNative = new ethers.Contract(wrappedNativeAddress, WETH_ABI, owner);

  const wrapTx = await wrappedNative.deposit({ value: ethers.utils.parseEther(settings.wrapEthAmount) });
  await wrapTx.wait();
  console.log('  - Native token wrapped successfully');

  // Step 2: Perform token swaps
  const tokenContracts = {};
  const tokenBalances = {};

  for (const swap of settings.swapTokens) {
    console.log(`  - Swapping ${swap.amount} ${swap.from} for ${swap.to}...`);

    // Get token addresses
    const tokenInAddress = getTokenAddressForTest(swap.from, 1337);
    const tokenOutAddress = getTokenAddressForTest(swap.to, 1337);

    // Create contracts if we haven't already
    if (!tokenContracts[swap.from]) {
      tokenContracts[swap.from] = new ethers.Contract(tokenInAddress, ERC20_ABI, owner);
    }
    if (!tokenContracts[swap.to]) {
      tokenContracts[swap.to] = new ethers.Contract(tokenOutAddress, ERC20_ABI, owner);
    }

    // Get token decimals
    const tokenInData = getTokenBySymbolForTest(swap.from);
    const tokenOutData = getTokenBySymbolForTest(swap.to);

    // Approve router to spend input token
    const approveTx = await tokenContracts[swap.from].approve(
      uniswapV3.routerAddress,
      ethers.utils.parseUnits(swap.amount, tokenInData.decimals)
    );
    await approveTx.wait();

    // Create swap params
    const swapParams = {
      tokenIn: tokenInAddress,
      tokenOut: tokenOutAddress,
      fee: 500, // 0.05% fee pool
      recipient: owner.address,
      amountIn: ethers.utils.parseUnits(swap.amount, tokenInData.decimals).toString(),
      slippageTolerance: settings.slippageTolerance,
      sqrtPriceLimitX96: "0",
      provider: hardhat.provider,
      deadlineMinutes: 2
    };

    const swapData = await adapter._generateSwapData(swapParams);
    const swapTx = await owner.sendTransaction({
      to: swapData.to,
      data: swapData.data,
      value: swapData.value,
    });
    await swapTx.wait();
    console.log(`  - Swap completed: ${swap.from} → ${swap.to}`);
  }

  // Step 3: Get current token balances
  console.log('  - Getting token balances...');
  for (const [tokenSymbol, contract] of Object.entries(tokenContracts)) {
    const balance = await contract.balanceOf(owner.address);
    tokenBalances[tokenSymbol] = balance;
    const tokenData = getTokenBySymbolForTest(tokenSymbol);
    console.log(`  - ${tokenSymbol}: ${ethers.utils.formatUnits(balance, tokenData.decimals)}`);
  }

  // Step 4: Create positions
  const createdPositions = {};
  const POSITION_MANAGER_ABI = [
    'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
    'function safeTransferFrom(address from, address to, uint256 tokenId) external'
  ];

  const positionManager = new ethers.Contract(uniswapV3.positionManagerAddress, POSITION_MANAGER_ABI, owner);

  for (let i = 0; i < settings.positions.length; i++) {
    const positionConfig = settings.positions[i];
    console.log(`  - Creating position ${i + 1}: ${positionConfig.token0}/${positionConfig.token1}...`);

    // Get token addresses and sort them
    const token0Address = getTokenAddressForTest(positionConfig.token0, 1337);
    const token1Address = getTokenAddressForTest(positionConfig.token1, 1337);

    const [sortedToken0, sortedToken1, sortedSymbol0, sortedSymbol1] =
      token0Address.toLowerCase() < token1Address.toLowerCase()
        ? [token0Address, token1Address, positionConfig.token0, positionConfig.token1]
        : [token1Address, token0Address, positionConfig.token1, positionConfig.token0];

    // Get pool data for tick calculations
    const poolData = await adapter._fetchPoolData(token0Address, token1Address, positionConfig.fee, hardhat.provider);
    const currentTick = poolData.tick;
    const tickSpacing = positionConfig.fee === 500 ? 10 : positionConfig.fee === 3000 ? 60 : 200;

    // Calculate tick range based on configuration
    let tickLower, tickUpper;

    switch (positionConfig.tickRange.type) {
      case 'centered':
        // Position includes current tick
        const spacing = positionConfig.tickRange.spacing || 10;
        tickLower = Math.floor(currentTick / tickSpacing) * tickSpacing - tickSpacing * spacing;
        tickUpper = Math.floor(currentTick / tickSpacing) * tickSpacing + tickSpacing * spacing;
        break;

      case 'above':
        // Position entirely above current tick (will be 100% token0)
        tickLower = Math.ceil(currentTick / tickSpacing) * tickSpacing + tickSpacing;
        tickUpper = tickLower + tickSpacing * 20;
        break;

      case 'below':
        // Position entirely below current tick (will be 100% token1)
        tickUpper = Math.floor(currentTick / tickSpacing) * tickSpacing - tickSpacing;
        tickLower = tickUpper - tickSpacing * 20;
        break;

      case 'custom':
        // Use exact tick values provided
        tickLower = positionConfig.tickRange.tickLower;
        tickUpper = positionConfig.tickRange.tickUpper;
        break;

      case 'close-to-boundary':
        // Position in range but too close to lower boundary (violates rebalanceThresholdLower)
        // BabyStepsStrategy default rebalanceThresholdLower is 1.5%, so position current tick
        // within 1.5% of range edge will be considered non-aligned
        tickLower = Math.floor(currentTick / tickSpacing) * tickSpacing - tickSpacing;  // Just 1 tick spacing below current
        tickUpper = tickLower + tickSpacing * 20;  // Wide range upward
        console.log(`    Creating close-to-boundary position: current tick will be very close to lower boundary`);
        break;

      case 'off-center':
        // Position in range but current tick is not centered (for testing centeredness comparison)
        // Places current tick at 25% of the range (closer to lower boundary)
        const offCenterSpacing = positionConfig.tickRange.spacing || 10;
        const totalRange = offCenterSpacing * 4; // Total range of 4x spacing
        tickLower = Math.floor(currentTick / tickSpacing) * tickSpacing - tickSpacing * 1; // 1 spacing below current
        tickUpper = tickLower + tickSpacing * totalRange; // Total range above lower
        console.log(`    Creating off-center position: current tick at ~25% of range (less centered)`);
        break;

      default:
        throw new Error(`Unknown tick range type: ${positionConfig.tickRange.type}`);
    }

    console.log(`    Current tick: ${currentTick}, Range: ${tickLower} to ${tickUpper}`);

    // Calculate amounts to use for this position
    const percentOfAssets = positionConfig.percentOfAssets || 20;
    const amount0Desired = tokenBalances[sortedSymbol0].mul(percentOfAssets).div(100);
    const amount1Desired = tokenBalances[sortedSymbol1].mul(percentOfAssets).div(100);

    // Approve position manager to spend tokens
    await (await tokenContracts[sortedSymbol0].approve(uniswapV3.positionManagerAddress, amount0Desired)).wait();
    await (await tokenContracts[sortedSymbol1].approve(uniswapV3.positionManagerAddress, amount1Desired)).wait();

    const mintParams = {
      token0: sortedToken0,
      token1: sortedToken1,
      fee: positionConfig.fee,
      tickLower,
      tickUpper,
      amount0Desired,
      amount1Desired,
      amount0Min: 0,
      amount1Min: 0,
      recipient: owner.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    // Get tokenId and amounts directly from mint function return values
    const mintResult = await positionManager.callStatic.mint(mintParams);
    const [tokenId, liquidity, amount0, amount1] = mintResult;

    console.log(`    Position will have ID: ${tokenId}`);
    console.log(`    Liquidity: ${liquidity}`);

    // Execute the actual mint transaction
    const mintTx = await positionManager.mint(mintParams);
    await mintTx.wait();
    console.log(`    Created position NFT with ID: ${tokenId}`);

    // Transfer position NFT to vault
    await (await positionManager.safeTransferFrom(owner.address, vaultAddress, tokenId)).wait();
    console.log(`    Position transferred to vault`);

    // Store position info
    createdPositions[tokenId.toString()] = {
      tokenId: tokenId.toString(),
      liquidity: liquidity.toString(),
      tickLower,
      tickUpper,
      token0: sortedSymbol0,
      token1: sortedSymbol1,
      fee: positionConfig.fee,
      amount0: amount0.toString(),
      amount1: amount1.toString()
    };

    // Update remaining balances
    tokenBalances[sortedSymbol0] = tokenBalances[sortedSymbol0].sub(amount0);
    tokenBalances[sortedSymbol1] = tokenBalances[sortedSymbol1].sub(amount1);
  }

  // Step 4.5: Execute fee-generating swaps if configured
  if (settings.feeGeneratingSwaps && settings.feeGeneratingSwaps.length > 0) {
    console.log('  - Executing fee-generating swaps to create position fees...');

    for (const feeSwap of settings.feeGeneratingSwaps) {
      const { pool, swaps } = feeSwap;
      console.log(`    Generating fees on pool ${pool.token0}/${pool.token1} (fee: ${pool.fee})...`);

      // Find the adapter and pool address
      const adapter = new UniswapV3Adapter(1337, hardhat.provider);
      const poolAddress = await adapter._getPoolAddress(
        getTokenAddressForTest(pool.token0, 1337),
        getTokenAddressForTest(pool.token1, 1337),
        pool.fee,
        hardhat.provider
      );

      // Execute each swap in the sequence
      for (let i = 0; i < swaps.length; i++) {
        const swap = swaps[i];
        const tokenIn = getTokenBySymbolForTest(swap.from);

        // Execute swap to generate fees
        const swapAmount = ethers.utils.parseUnits(swap.amount, tokenIn.decimals);
        const swapParams = {
          tokenIn: getTokenAddressForTest(swap.from, 1337),
          tokenOut: getTokenAddressForTest(swap.to, 1337),
          fee: pool.fee,
          recipient: hardhat.signers[0].address,
          amountIn: swapAmount.toString(),
          slippageTolerance: 1,
          sqrtPriceLimitX96: "0",
          deadlineMinutes: 2,
          provider: hardhat.provider
        };

        const swapData = await adapter._generateSwapData(swapParams);

        // Approve SwapRouter to spend tokenIn
        const tokenInContract = new ethers.Contract(
          getTokenAddressForTest(swap.from, 1337),
          ERC20_ABI,
          hardhat.signers[0]
        );
        const approveTx = await tokenInContract.approve(swapData.to, swapAmount);
        await approveTx.wait();

        // Execute swap
        const swapTx = await hardhat.signers[0].sendTransaction({
          to: swapData.to,
          data: swapData.data,
          gasLimit: 500000
        });
        await swapTx.wait();

        console.log(`      Swap ${i + 1}/${swaps.length}: ${swap.amount} ${swap.from} → ${swap.to}`);
      }

      console.log(`    ✓ Fee-generating swaps completed for ${pool.token0}/${pool.token1}`);
    }
  }

  // Step 5: Transfer remaining tokens to vault
  console.log('  - Transferring tokens to vault...');
  const finalTokenBalances = {};

  for (const [tokenSymbol, transferPercent] of Object.entries(settings.tokenTransfers)) {
    if (tokenContracts[tokenSymbol] && tokenBalances[tokenSymbol].gt(0)) {
      const transferAmount = tokenBalances[tokenSymbol].mul(transferPercent).div(100);
      if (transferAmount.gt(0)) {
        await (await tokenContracts[tokenSymbol].transfer(vaultAddress, transferAmount)).wait();
        const tokenData = getTokenBySymbolForTest(tokenSymbol);
        console.log(`    Transferred ${ethers.utils.formatUnits(transferAmount, tokenData.decimals)} ${tokenSymbol}`);
      }

      // Record final vault balance
      const vaultBalance = await tokenContracts[tokenSymbol].balanceOf(vaultAddress);
      finalTokenBalances[tokenSymbol] = vaultBalance.toString();
    }
  }

  // Step 6: Configure vault for AutomationService discovery
  console.log('  - Configuring vault for automation service...');

  // Configure vault with specified strategy
  console.log(`    Configuring vault with ${settings.strategy} strategy...`);
  const strategyContractName = STRATEGY_CONTRACT_MAP[settings.strategy];
  if (!strategyContractName) {
    throw new Error(`Unknown strategy ID: ${settings.strategy}. Valid options: ${Object.keys(STRATEGY_CONTRACT_MAP).join(', ')}`);
  }
  if (!deployedContracts[strategyContractName]) {
    throw new Error(`Strategy contract not deployed: ${strategyContractName}`);
  }
  const setStrategyTx = await testVault.setStrategy(deployedContracts[strategyContractName]);
  await setStrategyTx.wait();
  console.log(`    Strategy set to: ${deployedContracts[strategyContractName]}`);

  // Configure target tokens
  const targetTokens = settings.targetTokens || [...new Set(settings.positions.map(p => [p.token0, p.token1]).flat())];
  console.log('    Setting target tokens...');
  const setTokensTx = await testVault.setTargetTokens(targetTokens);
  await setTokensTx.wait();
  console.log(`    Target tokens set to: ${targetTokens.join(', ')}`);

  // Configure target platforms
  console.log('    Setting target platforms...');
  const setTargetPlatformsTx = await testVault.setTargetPlatforms(settings.targetPlatforms);
  await setTargetPlatformsTx.wait();
  console.log(`    Target platforms set to: ${settings.targetPlatforms.join(', ')}`);

  // Authorize our automation service as the vault's executor
  const automationServiceAddress = config.automationServiceAddress;
  if (!automationServiceAddress) {
    throw new Error('automationServiceAddress must be provided in config for vault setup');
  }
  console.log(`    Authorizing automation service ${automationServiceAddress} as vault executor...`);
  const setExecutorTx = await testVault.setExecutor(automationServiceAddress);
  const executorReceipt = await setExecutorTx.wait();
  console.log(`    setExecutor transaction confirmed in block ${executorReceipt.blockNumber} with status: ${executorReceipt.status === 1 ? 'SUCCESS' : 'FAILED'}`);

  // Verify authorization was set correctly
  const executor = await testVault.executor();
  if (executor.toLowerCase() !== automationServiceAddress.toLowerCase()) {
    throw new Error(`Authorization failed: expected ${automationServiceAddress}, got ${executor}`);
  }
  console.log(`    Vault ${vaultAddress} is now authorized for automation service`);

  console.log('  ✅ Configurable test vault setup complete!');

  return {
    vault: testVault,
    vaultAddress,
    positions: createdPositions,
    tokenBalances: finalTokenBalances,
    tokenContracts,
    config: settings
  };
}
