/**
 * @fileoverview Configurable V4 test vault setup for automation service tests
 *
 * Creates V4 vaults with positions, handling V4-specific operations:
 * - Native ETH support (AddressZero instead of WETH)
 * - Permit2 approval flow
 * - V4 PositionManager interactions
 * - Variable tick spacing per pool
 */

import { ethers } from 'ethers';
import { UniswapV4Adapter } from 'fum_library/adapters';
import { getChainConfig, getTokensByChain, getTokenAddress, getTokenBySymbol } from 'fum_library';
import { getVaultContract } from 'fum_library/blockchain';
import { getWrappedNativeAddress } from 'fum_library/helpers/tokenHelpers';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const NATIVE_ETH = ethers.constants.AddressZero;

/**
 * Map strategy IDs to deployed contract names
 */
const STRATEGY_CONTRACT_MAP = {
  'bob': 'BabyStepsStrategy',
};

/**
 * Get token address, handling ETH specially for V4
 * @param {string} symbol - Token symbol
 * @param {number} chainId - Chain ID
 * @returns {string} Token address (AddressZero for ETH)
 */
function getTokenAddressForV4(symbol, chainId) {
  if (symbol === 'ETH') {
    return NATIVE_ETH;
  }
  return getTokenAddress(symbol, chainId);
}

/**
 * Get token data by symbol, handling ETH specially for V4
 * @param {string} symbol - Token symbol
 * @returns {Object} Token data with decimals and symbol
 */
function getTokenBySymbolForV4(symbol) {
  if (symbol === 'ETH') {
    return { symbol: 'ETH', decimals: 18 };
  }
  return getTokenBySymbol(symbol);
}

/**
 * Set up Permit2 approvals for a token
 * V4 requires: ERC20 approve to Permit2, then Permit2 approve to PositionManager
 *
 * @param {ethers.Contract} token - Token contract
 * @param {string} positionManagerAddress - V4 PositionManager address
 * @param {ethers.Signer} signer - Signer to approve with
 */
async function setupPermit2Approval(token, positionManagerAddress, signer) {
  // Step 1: Standard ERC-20 approve to Permit2
  console.log(`    Approving ${await token.symbol?.()} to Permit2...`);
  await (await token.approve(PERMIT2_ADDRESS, ethers.constants.MaxUint256)).wait();

  // Step 2: Permit2 approve for V4 PositionManager
  console.log(`    Setting Permit2 allowance for PositionManager...`);
  const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, [
    'function approve(address token, address spender, uint160 amount, uint48 expiration) external'
  ], signer);

  const maxAmount = ethers.BigNumber.from(2).pow(160).sub(1); // type(uint160).max
  const farFutureExpiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365; // 1 year

  await (await permit2Contract.approve(
    token.address,
    positionManagerAddress,
    maxAmount,
    farFutureExpiration
  )).wait();
}

/**
 * Set up a V4 test vault with configurable positions, tokens, and balances
 *
 * @param {Object} hardhat - Hardhat instance with provider and signers
 * @param {Object} contracts - Deployed FUM contract instances
 * @param {Object} deployedContracts - Deployed FUM contract addresses
 * @param {Object} config - Configuration for vault setup
 * @returns {Promise<Object>} Test vault with positions and tokens
 */
export async function setupV4TestVault(hardhat, contracts, deployedContracts, config = {}) {
  const defaults = {
    // Token configuration
    nativeEthAmount: '5',       // Native ETH to start with (for swaps + positions)
    swapTokens: [               // Token swaps from native ETH
      { from: 'ETH', to: 'USDC', amount: '2' }
    ],

    // Position configuration
    positions: [
      {
        token0: 'ETH',          // Native ETH (AddressZero)
        token1: 'USDC',
        fee: 500,
        tickSpacing: 10,        // V4 tick spacing (configurable per pool)
        percentOfAssets: 20,
        tickRange: {
          type: 'centered',
          spacing: 10
        }
      }
    ],

    // Vault token balances
    tokenTransfers: {
      'USDC': 60               // 60% of remaining
    },

    // Vault target configuration
    targetTokens: null,         // If null, auto-derived from positions
    targetPlatforms: ['uniswapV4'],

    // Strategy configuration
    strategy: 'bob',

    vaultName: 'V4 Test Vault',
    slippageTolerance: 1
  };

  const settings = { ...defaults, ...config };

  console.log('💰 Setting up V4 test vault...');
  console.log(`  - Vault: ${settings.vaultName}`);
  console.log(`  - Positions: ${settings.positions.length}`);
  console.log(`  - Token swaps: ${settings.swapTokens.length}`);

  // Create vault using the VaultFactory
  console.log('  - Creating vault...');
  const vaultFactory = contracts.vaultFactory;
  const tx = await vaultFactory.createVault(settings.vaultName);
  const receipt = await tx.wait();

  // Find VaultCreated event
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
  const testVault = getVaultContract(vaultAddress, hardhat.provider).connect(hardhat.signers[0]);

  // Get chain config
  const chainConfig = getChainConfig(1337);
  const uniswapV4 = chainConfig.platformAddresses.uniswapV4;

  // Create V4 adapter
  const adapter = new UniswapV4Adapter(1337, hardhat.provider);
  const owner = hardhat.signers[0];

  // Track token contracts and balances
  const tokenContracts = {};
  const tokenBalances = {};

  // Step 1: Perform token swaps from native ETH
  for (const swap of settings.swapTokens) {
    if (swap.from !== 'ETH') {
      throw new Error('V4 vault setup only supports swaps from native ETH');
    }

    console.log(`  - Swapping ${swap.amount} ETH for ${swap.to}...`);

    const tokenOutAddress = getTokenAddressForV4(swap.to, 1337);

    // Create token contract if we haven't already
    if (!tokenContracts[swap.to]) {
      tokenContracts[swap.to] = new ethers.Contract(tokenOutAddress, ERC20_ABI, owner);
    }

    // Generate swap using V4 adapter
    const swapData = await adapter._generateSwapData({
      tokenIn: NATIVE_ETH,
      tokenOut: tokenOutAddress,
      amountIn: ethers.utils.parseEther(swap.amount).toString(),
      recipient: owner.address,
      slippageTolerance: settings.slippageTolerance,
      deadlineMinutes: 20
    });

    const swapTx = await owner.sendTransaction({
      to: swapData.to,
      data: swapData.data,
      value: swapData.value
    });
    await swapTx.wait();

    console.log(`  - Swap completed: ${swap.from} → ${swap.to}`);
  }

  // Step 2: Get current token balances
  console.log('  - Getting token balances...');
  for (const [tokenSymbol, contract] of Object.entries(tokenContracts)) {
    const balance = await contract.balanceOf(owner.address);
    tokenBalances[tokenSymbol] = balance;
    const tokenData = getTokenBySymbolForV4(tokenSymbol);
    console.log(`    ${tokenSymbol}: ${ethers.utils.formatUnits(balance, tokenData.decimals)}`);
  }

  // Step 3: Set up Permit2 approvals for all tokens
  console.log('  - Setting up Permit2 approvals...');
  for (const [tokenSymbol, contract] of Object.entries(tokenContracts)) {
    await setupPermit2Approval(contract, uniswapV4.positionManagerAddress, owner);
  }

  // Step 4: Create V4 positions
  const createdPositions = {};
  const POSITION_MANAGER_ABI = [
    'function safeTransferFrom(address from, address to, uint256 tokenId) external'
  ];
  const positionManager = new ethers.Contract(uniswapV4.positionManagerAddress, POSITION_MANAGER_ABI, owner);

  for (let i = 0; i < settings.positions.length; i++) {
    const positionConfig = settings.positions[i];
    console.log(`  - Creating V4 position ${i + 1}: ${positionConfig.token0}/${positionConfig.token1}...`);

    // Get token addresses (ETH = AddressZero)
    const token0Address = getTokenAddressForV4(positionConfig.token0, 1337);
    const token1Address = getTokenAddressForV4(positionConfig.token1, 1337);

    // V4 currency ordering: AddressZero (ETH) is always < any other address
    const [sortedToken0, sortedToken1, sortedSymbol0, sortedSymbol1] =
      token0Address.toLowerCase() < token1Address.toLowerCase()
        ? [token0Address, token1Address, positionConfig.token0, positionConfig.token1]
        : [token1Address, token0Address, positionConfig.token1, positionConfig.token0];

    const fee = positionConfig.fee;
    const tickSpacing = positionConfig.tickSpacing || 10;

    // Fetch pool data via adapter
    const poolData = await adapter._fetchPoolData(
      sortedToken0,
      sortedToken1,
      fee,
      tickSpacing,
      ethers.constants.AddressZero, // No hooks
      hardhat.provider
    );

    if (!poolData || poolData.liquidity === '0') {
      throw new Error(`V4 ${sortedSymbol0}/${sortedSymbol1} pool has no liquidity`);
    }

    const currentTick = poolData.tick;
    console.log(`    Current tick: ${currentTick}, Pool liquidity: ${poolData.liquidity}`);

    // Calculate tick range based on configuration
    let tickLower, tickUpper;

    switch (positionConfig.tickRange.type) {
      case 'centered':
        const spacing = positionConfig.tickRange.spacing || 10;
        tickLower = Math.floor(currentTick / tickSpacing) * tickSpacing - tickSpacing * spacing;
        tickUpper = Math.floor(currentTick / tickSpacing) * tickSpacing + tickSpacing * spacing;
        break;

      case 'above':
        tickLower = Math.ceil(currentTick / tickSpacing) * tickSpacing + tickSpacing;
        tickUpper = tickLower + tickSpacing * 20;
        break;

      case 'below':
        tickUpper = Math.floor(currentTick / tickSpacing) * tickSpacing - tickSpacing;
        tickLower = tickUpper - tickSpacing * 20;
        break;

      case 'custom':
        tickLower = positionConfig.tickRange.tickLower;
        tickUpper = positionConfig.tickRange.tickUpper;
        break;

      default:
        throw new Error(`Unknown tick range type: ${positionConfig.tickRange.type}`);
    }

    console.log(`    Tick range: ${tickLower} to ${tickUpper}`);

    // Calculate amounts for position
    const percentOfAssets = positionConfig.percentOfAssets || 20;

    // For V4 with native ETH, token0 is ETH (use owner's ETH balance)
    // token1 is the ERC-20 (e.g., USDC)
    let token0Amount, token1Amount;

    if (sortedToken0 === NATIVE_ETH) {
      // ETH is token0, use native ETH balance
      const ethBalance = await hardhat.provider.getBalance(owner.address);
      token0Amount = ethBalance.mul(percentOfAssets).div(100);
      token1Amount = tokenBalances[sortedSymbol1]?.mul(percentOfAssets).div(100) || ethers.BigNumber.from(0);
    } else {
      token0Amount = tokenBalances[sortedSymbol0]?.mul(percentOfAssets).div(100) || ethers.BigNumber.from(0);
      token1Amount = tokenBalances[sortedSymbol1]?.mul(percentOfAssets).div(100) || ethers.BigNumber.from(0);
    }

    // Build poolKey for V4
    const poolKey = {
      currency0: sortedToken0,
      currency1: sortedToken1,
      fee: fee,
      tickSpacing: tickSpacing,
      hooks: ethers.constants.AddressZero
    };

    // Generate position creation data via adapter
    const createPositionData = await adapter.generateCreatePositionData({
      position: { tickLower, tickUpper },
      token0Amount: token0Amount.toString(),
      token1Amount: token1Amount.toString(),
      provider: hardhat.provider,
      walletAddress: owner.address,
      poolKey,
      poolData,
      token0Data: { address: sortedToken0, decimals: sortedToken0 === NATIVE_ETH ? 18 : getTokenBySymbolForV4(sortedSymbol0).decimals },
      token1Data: { address: sortedToken1, decimals: getTokenBySymbolForV4(sortedSymbol1).decimals },
      slippageTolerance: 5,
      deadlineMinutes: 20
    });

    // Execute mint transaction
    const mintTx = await owner.sendTransaction({
      to: createPositionData.to,
      data: createPositionData.data,
      value: createPositionData.value
    });
    const mintReceipt = await mintTx.wait();

    // Parse receipt to get tokenId
    const mintResult = adapter.parseIncreaseLiquidityReceipt(mintReceipt, {
      position: { tickLower, tickUpper },
      poolData
    });
    const tokenId = mintResult.tokenId;
    console.log(`    Created position NFT with ID: ${tokenId}`);

    // Transfer position NFT to vault
    await (await positionManager.safeTransferFrom(owner.address, vaultAddress, tokenId)).wait();
    console.log(`    Position transferred to vault`);

    // Store position info
    createdPositions[tokenId.toString()] = {
      tokenId: tokenId.toString(),
      liquidity: createPositionData.quote?.liquidity?.toString() || mintResult.liquidity?.toString(),
      tickLower,
      tickUpper,
      token0: sortedSymbol0,
      token1: sortedSymbol1,
      fee: fee,
      tickSpacing: tickSpacing
    };

    // Update remaining balances
    if (sortedSymbol1 !== 'ETH' && tokenBalances[sortedSymbol1]) {
      tokenBalances[sortedSymbol1] = tokenBalances[sortedSymbol1].sub(token1Amount);
    }
  }

  // Step 5: Transfer remaining tokens to vault
  console.log('  - Transferring tokens to vault...');
  const finalTokenBalances = {};

  for (const [tokenSymbol, transferPercent] of Object.entries(settings.tokenTransfers)) {
    if (tokenContracts[tokenSymbol] && tokenBalances[tokenSymbol]?.gt(0)) {
      const transferAmount = tokenBalances[tokenSymbol].mul(transferPercent).div(100);
      if (transferAmount.gt(0)) {
        await (await tokenContracts[tokenSymbol].transfer(vaultAddress, transferAmount)).wait();
        const tokenData = getTokenBySymbolForV4(tokenSymbol);
        console.log(`    Transferred ${ethers.utils.formatUnits(transferAmount, tokenData.decimals)} ${tokenSymbol}`);
      }

      const vaultBalance = await tokenContracts[tokenSymbol].balanceOf(vaultAddress);
      finalTokenBalances[tokenSymbol] = vaultBalance.toString();
    }
  }

  // Send remaining native ETH to vault if configured
  if (settings.nativeEthToVault) {
    const ethToSend = ethers.utils.parseEther(settings.nativeEthToVault);
    await (await owner.sendTransaction({ to: vaultAddress, value: ethToSend })).wait();
    console.log(`    Transferred ${settings.nativeEthToVault} ETH to vault`);
  }

  // Wrap ETH to WETH and send to vault if configured
  if (settings.wrapEthToVault) {
    const wrapAmount = ethers.utils.parseEther(settings.wrapEthToVault);
    const WETH_ABI = [
      'function deposit() payable',
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)'
    ];
    const wethAddress = getWrappedNativeAddress(1337);
    const wethContract = new ethers.Contract(wethAddress, WETH_ABI, owner);
    await (await wethContract.deposit({ value: wrapAmount })).wait();
    await (await wethContract.transfer(vaultAddress, wrapAmount)).wait();
    console.log(`    Wrapped and transferred ${settings.wrapEthToVault} WETH to vault`);
  }

  // Step 6: Configure vault for AutomationService discovery
  console.log('  - Configuring vault for automation service...');

  // Configure vault with specified strategy
  console.log(`    Configuring vault with ${settings.strategy} strategy...`);
  const strategyContractName = STRATEGY_CONTRACT_MAP[settings.strategy];
  if (!strategyContractName) {
    throw new Error(`Unknown strategy ID: ${settings.strategy}`);
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

  // Authorize automation service as the vault's executor
  const automationServiceAddress = config.automationServiceAddress;
  if (!automationServiceAddress) {
    throw new Error('automationServiceAddress must be provided in config for vault setup');
  }
  console.log(`    Authorizing automation service ${automationServiceAddress} as vault executor...`);
  const setExecutorTx = await testVault.setExecutor(automationServiceAddress);
  const executorReceipt = await setExecutorTx.wait();
  console.log(`    setExecutor confirmed in block ${executorReceipt.blockNumber}`);

  // Verify authorization
  const executor = await testVault.executor();
  if (executor.toLowerCase() !== automationServiceAddress.toLowerCase()) {
    throw new Error(`Authorization failed: expected ${automationServiceAddress}, got ${executor}`);
  }
  console.log(`    Vault ${vaultAddress} is now authorized for automation service`);

  console.log('  ✅ V4 test vault setup complete!');

  return {
    vault: testVault,
    vaultAddress,
    positions: createdPositions,
    tokenBalances: finalTokenBalances,
    tokenContracts,
    adapter,
    config: settings
  };
}
