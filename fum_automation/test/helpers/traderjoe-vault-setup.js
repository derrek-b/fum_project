/**
 * @fileoverview Configurable Trader Joe V2.2 test vault setup for automation service tests
 *
 * Creates TJ V2.2 vaults with bin-based positions, handling TJ-specific operations:
 * - Bin-based liquidity (lowerBinId, upperBinId instead of ticks)
 * - Token ordering via sortTokens() (tokenX = lower address)
 * - LBRouter for swaps
 * - TJPositionManager for position creation
 */

import { ethers } from 'ethers';
import { TraderJoeV2_2Adapter } from 'fum_library/adapters';
import { getChainConfig, getTokensByChain, getTokenAddress, getTokenBySymbol } from 'fum_library';
import { getWrappedNativeAddress, isWrappedNativeToken, isNativeToken } from 'fum_library/helpers/tokenHelpers';
import { getVaultContract } from 'fum_library/blockchain';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

const WAVAX_ABI = [
  'function deposit() payable',
  'function withdraw(uint256 amount)',
  ...ERC20_ABI
];

/**
 * Map strategy IDs to deployed contract names
 */
const STRATEGY_CONTRACT_MAP = {
  'bob': 'BabyStepsStrategy',
};

/**
 * Get token address for testing, handling native tokens and wrapped versions
 * @param {string} symbol - Token symbol
 * @param {number} chainId - Chain ID
 * @returns {string} Token address
 */
function getTokenAddressForTJ(symbol, chainId) {
  // Handle wrapped native tokens (WAVAX, WETH)
  if (isWrappedNativeToken(symbol)) {
    return getWrappedNativeAddress(chainId);
  }
  // Native tokens (AVAX, ETH) return AddressZero
  if (isNativeToken(symbol)) {
    return ethers.constants.AddressZero;
  }
  return getTokenAddress(symbol, chainId);
}

/**
 * Get token data by symbol, handling native and wrapped native tokens specially
 * @param {string} symbol - Token symbol
 * @returns {Object} Token data with decimals and symbol
 */
function getTokenDataForTJ(symbol) {
  if (isWrappedNativeToken(symbol) || isNativeToken(symbol)) {
    return { symbol, decimals: 18 };
  }
  return getTokenBySymbol(symbol);
}

/**
 * Set up a Trader Joe V2.2 test vault with configurable positions, tokens, and balances
 *
 * @param {Object} hardhat - Hardhat instance with provider and signers
 * @param {Object} contracts - Deployed FUM contract instances
 * @param {Object} deployedContracts - Deployed FUM contract addresses
 * @param {Object} config - Configuration for vault setup
 * @returns {Promise<Object>} Test vault with positions and tokens
 */
export async function setupTraderJoeTestVault(hardhat, contracts, deployedContracts, config = {}) {
  const defaults = {
    // Token configuration
    nativeAmount: '10',           // AVAX to start with (for wrapping + swaps)
    swapTokens: [                 // Token swaps from AVAX/WAVAX
      { from: 'AVAX', to: 'USDC', amount: '2', binStep: 10, version: 3 }
    ],

    // Position configuration (TJ uses bins instead of ticks)
    positions: [
      {
        tokenX: 'USDC',           // Token with lower address (TJ convention)
        tokenY: 'WAVAX',          // Token with higher address
        binStep: 20,              // Fee in basis points (20 = 0.20%)
        percentOfAssets: 20,
        binRange: {
          type: 'centered',       // 'centered', 'above', 'below', 'custom'
          spacing: 10             // ±10 bins from activeId
        }
      }
    ],

    // Vault token balances
    tokenTransfers: {
      'WAVAX': 60,               // 60% of remaining
      'USDC': 60                 // 60% of remaining
    },

    // Vault target configuration
    targetTokens: null,          // If null, auto-derived from positions
    targetPlatforms: ['traderjoeV2_2'],

    // Strategy configuration
    strategy: 'bob',

    vaultName: 'TJ Test Vault',
    slippageTolerance: 1
  };

  const settings = { ...defaults, ...config };

  // Get chainId from hardhat config or provider
  const network = await hardhat.provider.getNetwork();
  const chainId = network.chainId;

  console.log('🔷 Setting up Trader Joe V2.2 test vault...');
  console.log(`  - Chain: ${chainId}`);
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
  const chainConfig = getChainConfig(chainId);
  const traderjoeV2_2 = chainConfig.platformAddresses.traderjoeV2_2;

  if (!traderjoeV2_2) {
    throw new Error(`Trader Joe V2.2 not configured for chain ${chainId}`);
  }

  // Create TJ adapter
  const adapter = new TraderJoeV2_2Adapter(chainId, hardhat.provider);
  const owner = hardhat.signers[0];

  // Track token contracts and balances
  const tokenContracts = {};
  const tokenBalances = {};

  // Step 1: Wrap native token to wrapped native (WAVAX on Avalanche)
  console.log(`  - Wrapping ${settings.nativeAmount} native to wrapped native...`);
  const wrappedNativeAddress = getWrappedNativeAddress(chainId);
  const wrappedNativeContract = new ethers.Contract(wrappedNativeAddress, WAVAX_ABI, owner);

  const wrapTx = await wrappedNativeContract.deposit({ value: ethers.utils.parseEther(settings.nativeAmount) });
  await wrapTx.wait();

  tokenContracts['WAVAX'] = wrappedNativeContract;
  tokenBalances['WAVAX'] = await wrappedNativeContract.balanceOf(owner.address);
  console.log(`    Wrapped native balance: ${ethers.utils.formatEther(tokenBalances['WAVAX'])}`);

  // Step 2: Perform token swaps via LBRouter
  for (const swap of settings.swapTokens) {
    // Convert AVAX to WAVAX for swap source
    const sourceToken = swap.from === 'AVAX' ? 'WAVAX' : swap.from;
    console.log(`  - Swapping ${swap.amount} ${sourceToken} for ${swap.to}...`);

    const tokenInAddress = getTokenAddressForTJ(sourceToken, chainId);
    const tokenOutAddress = getTokenAddressForTJ(swap.to, chainId);

    // Create token contract if we haven't already
    if (!tokenContracts[swap.to]) {
      tokenContracts[swap.to] = new ethers.Contract(tokenOutAddress, ERC20_ABI, owner);
    }

    const tokenInData = getTokenDataForTJ(sourceToken);
    const swapAmountIn = ethers.utils.parseUnits(swap.amount, tokenInData.decimals);

    // Approve LBRouter to spend input token
    const approveTx = await tokenContracts[sourceToken].approve(traderjoeV2_2.lbRouterAddress, swapAmountIn);
    await approveTx.wait();

    // Use LBRouter swapExactTokensForTokens
    const LB_ROUTER_ABI = [
      'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) external returns (uint256 amountOut)'
    ];
    const lbRouter = new ethers.Contract(traderjoeV2_2.lbRouterAddress, LB_ROUTER_ABI, owner);

    // Build path for the swap — each swap specifies its own binStep and version
    if (!swap.binStep || !swap.version) {
      throw new Error(`Swap ${sourceToken} → ${swap.to} must specify binStep and version`);
    }
    const path = {
      pairBinSteps: [swap.binStep],
      versions: [swap.version],
      tokenPath: [tokenInAddress, tokenOutAddress]
    };

    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

    const swapTx = await lbRouter.swapExactTokensForTokens(
      swapAmountIn,
      0, // amountOutMin - accept any amount for testing
      path,
      owner.address,
      deadline
    );
    await swapTx.wait();

    console.log(`  - Swap completed: ${sourceToken} → ${swap.to}`);
  }

  // Step 3: Get current token balances
  console.log('  - Getting token balances...');
  for (const [tokenSymbol, contract] of Object.entries(tokenContracts)) {
    const balance = await contract.balanceOf(owner.address);
    tokenBalances[tokenSymbol] = balance;
    const tokenData = getTokenDataForTJ(tokenSymbol);
    console.log(`    ${tokenSymbol}: ${ethers.utils.formatUnits(balance, tokenData.decimals)}`);
  }

  // Step 4: Create TJ positions
  const createdPositions = new Map();

  for (let i = 0; i < settings.positions.length; i++) {
    const positionConfig = settings.positions[i];
    console.log(`  - Creating TJ position ${i + 1}: ${positionConfig.tokenX}/${positionConfig.tokenY}...`);

    // Get token addresses
    const tokenXAddress = getTokenAddressForTJ(positionConfig.tokenX, chainId);
    const tokenYAddress = getTokenAddressForTJ(positionConfig.tokenY, chainId);

    // Use adapter's sortTokens for correct TJ ordering
    const tokenXData = { address: tokenXAddress, ...getTokenDataForTJ(positionConfig.tokenX) };
    const tokenYData = { address: tokenYAddress, ...getTokenDataForTJ(positionConfig.tokenY) };
    const { sortedToken0, sortedToken1, tokensSwapped } = adapter.sortTokens(tokenXData, tokenYData);

    // Find the LBPair address via factory
    const LB_FACTORY_ABI = [
      'function getLBPairInformation(address tokenX, address tokenY, uint256 binStep) view returns (tuple(uint16 binStep, address LBPair, bool createdByOwner, bool ignoredForRouting))'
    ];
    const lbFactory = new ethers.Contract(traderjoeV2_2.lbFactoryAddress, LB_FACTORY_ABI, hardhat.provider);

    const pairInfo = await lbFactory.getLBPairInformation(
      sortedToken0.address,
      sortedToken1.address,
      positionConfig.binStep
    );

    if (pairInfo.LBPair === ethers.constants.AddressZero) {
      throw new Error(`LBPair not found for ${positionConfig.tokenX}/${positionConfig.tokenY} with binStep ${positionConfig.binStep}`);
    }

    const lbPairAddress = pairInfo.LBPair;
    console.log(`    LBPair: ${lbPairAddress}`);

    // Fetch pool data via adapter
    const poolData = await adapter.getPoolData(lbPairAddress, hardhat.provider);
    const activeId = poolData.activeId;
    console.log(`    Active bin ID: ${activeId}`);

    // Calculate bin range based on configuration
    let lowerBinId, upperBinId;

    switch (positionConfig.binRange.type) {
      case 'centered':
        const spacing = positionConfig.binRange.spacing || 10;
        lowerBinId = activeId - spacing;
        upperBinId = activeId + spacing;
        break;

      case 'above':
        lowerBinId = activeId + 1;
        upperBinId = activeId + 21;
        break;

      case 'below':
        upperBinId = activeId - 1;
        lowerBinId = activeId - 21;
        break;

      case 'custom':
        lowerBinId = positionConfig.binRange.lowerBinId;
        upperBinId = positionConfig.binRange.upperBinId;
        break;

      default:
        throw new Error(`Unknown bin range type: ${positionConfig.binRange.type}`);
    }

    console.log(`    Bin range: ${lowerBinId} to ${upperBinId}`);

    // Calculate amounts for position
    const percentOfAssets = positionConfig.percentOfAssets || 20;

    // Get sorted token symbols for balance lookup
    const sortedSymbol0 = tokensSwapped ? positionConfig.tokenY : positionConfig.tokenX;
    const sortedSymbol1 = tokensSwapped ? positionConfig.tokenX : positionConfig.tokenY;

    const token0Amount = tokenBalances[sortedSymbol0]?.mul(percentOfAssets).div(100) || ethers.BigNumber.from(0);
    const token1Amount = tokenBalances[sortedSymbol1]?.mul(percentOfAssets).div(100) || ethers.BigNumber.from(0);

    // Approve TJPositionManager for both tokens
    const positionManagerAddress = traderjoeV2_2.positionManagerAddress;
    if (!positionManagerAddress) {
      throw new Error('TJPositionManager address not configured. Deploy TJPositionManager first.');
    }

    if (tokenContracts[sortedSymbol0]) {
      await (await tokenContracts[sortedSymbol0].approve(positionManagerAddress, token0Amount)).wait();
    }
    if (tokenContracts[sortedSymbol1]) {
      await (await tokenContracts[sortedSymbol1].approve(positionManagerAddress, token1Amount)).wait();
    }

    // Generate create position data via adapter
    const createPositionParams = {
      position: { lowerBinId, upperBinId },
      token0Amount: token0Amount.toString(),
      token1Amount: token1Amount.toString(),
      provider: hardhat.provider,
      walletAddress: owner.address,
      poolData: {
        ...poolData,
        address: lbPairAddress
      },
      token0Data: sortedToken0,
      token1Data: sortedToken1,
      slippageTolerance: settings.slippageTolerance,
      deadlineMinutes: 5
    };

    const createPositionData = await adapter.generateCreatePositionData(createPositionParams);

    // Execute position creation
    const mintTx = await owner.sendTransaction({
      to: createPositionData.to,
      data: createPositionData.data,
      value: createPositionData.value
    });
    const mintReceipt = await mintTx.wait();

    // Parse receipt to get tokenId from PositionCreated event
    const POSITION_CREATED_TOPIC = ethers.utils.id('PositionCreated(uint256,address,address,uint256[],uint256[],uint256,uint256)');
    const positionCreatedLog = mintReceipt.logs.find(log => log.topics[0] === POSITION_CREATED_TOPIC);

    if (!positionCreatedLog) {
      throw new Error('PositionCreated event not found in receipt');
    }

    const tokenId = ethers.BigNumber.from(positionCreatedLog.topics[1]).toString();
    console.log(`    Created position NFT with ID: ${tokenId}`);

    // Transfer position NFT to vault
    const TJ_POSITION_MANAGER_ABI = [
      'function safeTransferFrom(address from, address to, uint256 tokenId) external'
    ];
    const positionManager = new ethers.Contract(positionManagerAddress, TJ_POSITION_MANAGER_ABI, owner);
    await (await positionManager.safeTransferFrom(owner.address, vaultAddress, tokenId)).wait();
    console.log(`    Position transferred to vault`);

    // Store position info
    createdPositions.set(tokenId, {
      tokenId,
      lowerBinId,
      upperBinId,
      pool: lbPairAddress,
      tokenX: sortedSymbol0,
      tokenY: sortedSymbol1,
      binStep: positionConfig.binStep
    });

    // Update remaining balances
    if (tokenBalances[sortedSymbol0]) {
      tokenBalances[sortedSymbol0] = tokenBalances[sortedSymbol0].sub(token0Amount);
    }
    if (tokenBalances[sortedSymbol1]) {
      tokenBalances[sortedSymbol1] = tokenBalances[sortedSymbol1].sub(token1Amount);
    }
  }

  // Step 4.5: Execute fee-generating swaps if configured
  if (settings.feeGeneratingSwaps && settings.feeGeneratingSwaps.length > 0) {
    console.log('  - Executing fee-generating swaps to create position fees...');

    const LB_ROUTER_ABI_FEE = [
      'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) external returns (uint256 amountOut)'
    ];
    const lbRouterFee = new ethers.Contract(traderjoeV2_2.lbRouterAddress, LB_ROUTER_ABI_FEE, owner);

    for (const feeSwap of settings.feeGeneratingSwaps) {
      const { pool, swaps } = feeSwap;
      console.log(`    Generating fees on pool ${pool.tokenX}/${pool.tokenY} (binStep: ${pool.binStep})...`);

      for (let i = 0; i < swaps.length; i++) {
        const swap = swaps[i];
        const sourceToken = swap.from === 'AVAX' ? 'WAVAX' : swap.from;
        const tokenInAddress = getTokenAddressForTJ(sourceToken, chainId);
        const tokenOutAddress = getTokenAddressForTJ(swap.to, chainId);
        const tokenInData = getTokenDataForTJ(sourceToken);
        const swapAmountIn = ethers.utils.parseUnits(swap.amount, tokenInData.decimals);

        // Ensure we have a contract for the source token
        if (!tokenContracts[sourceToken]) {
          tokenContracts[sourceToken] = new ethers.Contract(tokenInAddress, ERC20_ABI, owner);
        }
        if (!tokenContracts[swap.to]) {
          tokenContracts[swap.to] = new ethers.Contract(tokenOutAddress, ERC20_ABI, owner);
        }

        // Approve LBRouter to spend input token
        const approveTx = await tokenContracts[sourceToken].approve(traderjoeV2_2.lbRouterAddress, swapAmountIn);
        await approveTx.wait();

        const feePath = {
          pairBinSteps: [pool.binStep],
          versions: [pool.version],
          tokenPath: [tokenInAddress, tokenOutAddress]
        };

        const deadline = Math.floor(Date.now() / 1000) + 300;
        const swapTx = await lbRouterFee.swapExactTokensForTokens(
          swapAmountIn,
          0,
          feePath,
          owner.address,
          deadline
        );
        await swapTx.wait();

        console.log(`      Swap ${i + 1}/${swaps.length}: ${swap.amount} ${swap.from} → ${swap.to}`);
      }

      console.log(`    ✓ Fee-generating swaps completed for ${pool.tokenX}/${pool.tokenY}`);
    }

    // Refresh token balances after fee-generating swaps
    for (const [tokenSymbol, contract] of Object.entries(tokenContracts)) {
      const balance = await contract.balanceOf(owner.address);
      tokenBalances[tokenSymbol] = balance;
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
        const tokenData = getTokenDataForTJ(tokenSymbol);
        console.log(`    Transferred ${ethers.utils.formatUnits(transferAmount, tokenData.decimals)} ${tokenSymbol}`);
      }

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
    throw new Error(`Unknown strategy ID: ${settings.strategy}`);
  }
  if (!deployedContracts[strategyContractName]) {
    throw new Error(`Strategy contract not deployed: ${strategyContractName}`);
  }
  const setStrategyTx = await testVault.setStrategy(deployedContracts[strategyContractName]);
  await setStrategyTx.wait();
  console.log(`    Strategy set to: ${deployedContracts[strategyContractName]}`);

  // Configure target tokens
  const targetTokens = settings.targetTokens ||
    [...new Set(settings.positions.map(p => [p.tokenX, p.tokenY]).flat())];
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

  console.log('  ✅ Trader Joe V2.2 test vault setup complete!');

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
