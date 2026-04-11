// test/scripts/seed-v4.js
// Seeds the local Hardhat Arbitrum fork with a vault, tokens, and a Uniswap V4 ETH/USDC position.
//
// Usage:
//   node test/scripts/seed-v4.js                     # vault + tokens + position on wallet
//   ENABLE_STRATEGY=1 node test/scripts/seed-v4.js   # + strategy + targets on vault
//   ENABLE_AUTOMATION=1 node test/scripts/seed-v4.js  # + position transferred to vault + executor (full automation)
//
// NOTE: This script is for local Hardhat testing only

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ERC20Artifact from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };
import { UniswapV4Adapter } from 'fum_library/adapters';
import { getTokenAddress } from 'fum_library/helpers/tokenHelpers';
import { getChainConfig, getPlatformAddresses, configureChainHelpers } from 'fum_library/helpers/chainHelpers';
import contractData from 'fum_library/artifacts/contracts';

// V4 adapter constructor eagerly creates an AlphaRouter that requires an Alchemy RPC URL.
// We don't use AlphaRouter in this script (direct V4 swaps), but the constructor requires it.
configureChainHelpers({ alchemyApiKey: 'dummy-local-hardhat' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ERC20ABI = ERC20Artifact.abi;

const WETH_ABI = [
  'function deposit() payable',
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint amount) returns (bool)',
  'function transfer(address to, uint amount) returns (bool)',
];

const ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)',
];

const STRATEGY_ABI = [
  'function authorizeVault(address vault) external',
  'function selectTemplate(uint8 template) external',
];

const POSITION_MANAGER_ABI = [
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
];

// Arbitrum addresses (same on local fork)
const CHAIN_ID = 1337;
const RPC_URL = 'http://localhost:8545';
const NATIVE_ETH = ethers.constants.AddressZero;
const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const WBTC_ADDRESS = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f';
const LINK_ADDRESS = '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4';
const UNISWAP_V3_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const FEE = 500;
const TICK_SPACING = 10;
const TEMPLATE_AGGRESSIVE = 3;

// V4 swap action types
const Actions = {
  SWAP_EXACT_IN_SINGLE: 6,
  SETTLE: 11,
  TAKE: 14
};

const POOL_KEY_STRUCT = '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const SWAP_EXACT_IN_SINGLE_STRUCT = `(${POOL_KEY_STRUCT} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`;

/**
 * Execute a swap directly through the V4 ETH/USDC pool via Universal Router.
 * Bypasses AlphaRouter to guarantee the swap hits the specific pool.
 */
async function executeDirectV4Swap(signer, poolKey, universalRouterAddress, tokenIn, tokenOut, amountIn) {
  const zeroForOne = tokenIn.toLowerCase() < tokenOut.toLowerCase();
  const amountInBN = ethers.BigNumber.from(amountIn);

  const swapEncoded = ethers.utils.defaultAbiCoder.encode(
    [SWAP_EXACT_IN_SINGLE_STRUCT],
    [[
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      zeroForOne,
      amountInBN.toString(),
      '0',
      '0x'
    ]]
  );

  const settleEncoded = ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint256', 'bool'],
    [tokenIn, 0, true]
  );

  const takeEncoded = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'uint256'],
    [tokenOut, signer.address, 0]
  );

  const actionBytes = ethers.utils.hexlify([
    Actions.SWAP_EXACT_IN_SINGLE,
    Actions.SETTLE,
    Actions.TAKE
  ]);

  const v4SwapPayload = ethers.utils.defaultAbiCoder.encode(
    ['bytes', 'bytes[]'],
    [actionBytes, [swapEncoded, settleEncoded, takeEncoded]]
  );

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const commands = ethers.utils.hexlify([0x10]);

  const routerInterface = new ethers.utils.Interface([
    'function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable'
  ]);
  const calldata = routerInterface.encodeFunctionData('execute', [commands, [v4SwapPayload], deadline]);

  const isNativeIn = tokenIn === NATIVE_ETH;
  const tx = await signer.sendTransaction({
    to: universalRouterAddress,
    data: calldata,
    value: isNativeIn ? amountInBN : 0
  });
  return tx.wait();
}

async function main() {
  const enableAutomation = process.env.ENABLE_AUTOMATION === '1';
  const enableStrategy = enableAutomation || process.env.ENABLE_STRATEGY === '1';

  const networkConfig = getChainConfig(CHAIN_ID);
  if (!networkConfig) {
    throw new Error(`Network with chainId ${CHAIN_ID} not configured`);
  }

  console.log(`Seeding local Hardhat (${networkConfig.name}) — Uniswap V4 ETH/USDC`);
  if (enableAutomation) console.log('  Mode: full automation (strategy + executor + position in vault)');
  else if (enableStrategy) console.log('  Mode: strategy configured (position on wallet)');
  else console.log('  Mode: base (position on wallet, no strategy)');

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Hardhat account #0
    provider
  );
  console.log(`\nUsing account: ${signer.address}`);

  // === 1. Create vault ===
  const deploymentPath = path.join(__dirname, `../../deployments/${CHAIN_ID}-latest.json`);
  let vaultFactoryAddress;
  if (fs.existsSync(deploymentPath)) {
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    vaultFactoryAddress = deployment.contracts.VaultFactory;
  } else {
    vaultFactoryAddress = contractData.VaultFactory?.addresses?.[CHAIN_ID.toString()];
    if (!vaultFactoryAddress) {
      throw new Error(`No VaultFactory address found for chainId ${CHAIN_ID}. Run "npm run hardhat" first.`);
    }
  }

  const vaultFactoryABI = contractData.VaultFactory.abi;
  const positionVaultABI = contractData.PositionVault.abi;
  const vaultFactory = new ethers.Contract(vaultFactoryAddress, vaultFactoryABI, signer);

  console.log(`\nCreating vault...`);
  const vaultName = 'Test Vault V4 ' + Math.floor(Date.now() / 1000);
  const createTx = await vaultFactory.createVault(vaultName);
  const createReceipt = await createTx.wait();

  const vaultCreatedEvents = createReceipt.logs
    .filter(log => {
      try { return vaultFactory.interface.parseLog(log).name === 'VaultCreated'; }
      catch { return false; }
    })
    .map(log => vaultFactory.interface.parseLog(log));

  if (vaultCreatedEvents.length === 0) {
    throw new Error('VaultCreated event not found in transaction logs');
  }

  const vaultAddress = vaultCreatedEvents[0].args[1];
  console.log(`Vault created: ${vaultAddress} ("${vaultName}")`);

  const vault = new ethers.Contract(vaultAddress, positionVaultABI, signer);

  // === 2. Fund wallet with tokens ===
  const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);
  const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20ABI, signer);
  const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20ABI, signer);
  const wbtcContract = new ethers.Contract(WBTC_ADDRESS, ERC20ABI, signer);
  const linkContract = new ethers.Contract(LINK_ADDRESS, ERC20ABI, signer);

  // Wrap 45 ETH → WETH (5 to keep + 10 each for 4 token swaps)
  console.log('\nWrapping 45 ETH to WETH...');
  await (await wethContract.deposit({ value: ethers.utils.parseEther('45') })).wait();

  // Approve V3 router for token acquisition swaps
  const v3Router = new ethers.Contract(UNISWAP_V3_ROUTER_ADDRESS, ROUTER_ABI, signer);
  await (await wethContract.approve(UNISWAP_V3_ROUTER_ADDRESS, ethers.utils.parseEther('40'))).wait();

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const swapWethFor = async (tokenOut, symbol, fee = 500) => {
    console.log(`Swapping 10 WETH for ${symbol}...`);
    const tx = await v3Router.exactInputSingle({
      tokenIn: WETH_ADDRESS, tokenOut, fee,
      recipient: signer.address, deadline,
      amountIn: ethers.utils.parseEther('10'),
      amountOutMinimum: 0, sqrtPriceLimitX96: 0,
    });
    await tx.wait();
  };

  await swapWethFor(USDC_ADDRESS, 'USDC', 500);
  await swapWethFor(USDT_ADDRESS, 'USDT', 500);
  await swapWethFor(WBTC_ADDRESS, 'WBTC', 500);
  await swapWethFor(LINK_ADDRESS, 'LINK', 3000);

  console.log('\nWallet token balances:');
  console.log(`  WETH: ${ethers.utils.formatEther(await wethContract.balanceOf(signer.address))}`);
  console.log(`  USDC: ${ethers.utils.formatUnits(await usdcContract.balanceOf(signer.address), 6)}`);
  console.log(`  USDT: ${ethers.utils.formatUnits(await usdtContract.balanceOf(signer.address), 6)}`);
  console.log(`  WBTC: ${ethers.utils.formatUnits(await wbtcContract.balanceOf(signer.address), 8)}`);
  console.log(`  LINK: ${ethers.utils.formatEther(await linkContract.balanceOf(signer.address))}`);

  // === 3. Transfer tokens to vault ===
  console.log('\nTransferring tokens to the vault...');

  const wethTransferAmount = ethers.utils.parseEther('3');
  const usdcTransferAmount = ethers.utils.parseUnits('1000', 6);

  await (await wethContract.transfer(vaultAddress, wethTransferAmount)).wait();
  console.log(`  Transferred ${ethers.utils.formatEther(wethTransferAmount)} WETH`);

  await (await usdcContract.transfer(vaultAddress, usdcTransferAmount)).wait();
  console.log(`  Transferred ${ethers.utils.formatUnits(usdcTransferAmount, 6)} USDC`);

  // Send 3 ETH to vault (V4 uses native ETH)
  const ethTransferAmount = ethers.utils.parseEther('3');
  await (await signer.sendTransaction({ to: vaultAddress, value: ethTransferAmount })).wait();
  console.log(`  Transferred ${ethers.utils.formatEther(ethTransferAmount)} ETH`);

  console.log('\nVault balances:');
  console.log(`  ETH:  ${ethers.utils.formatEther(await provider.getBalance(vaultAddress))}`);
  console.log(`  WETH: ${ethers.utils.formatEther(await wethContract.balanceOf(vaultAddress))}`);
  console.log(`  USDC: ${ethers.utils.formatUnits(await usdcContract.balanceOf(vaultAddress), 6)}`);

  // === 4. Mint V4 position ===
  console.log('\nCreating Uniswap V4 ETH/USDC position...');

  const adapter = new UniswapV4Adapter(CHAIN_ID);
  const usdcAddress = getTokenAddress('USDC', CHAIN_ID);

  const poolData = await adapter.fetchPoolDataForTesting(
    NATIVE_ETH, usdcAddress, FEE, TICK_SPACING,
    ethers.constants.AddressZero, provider
  );

  if (!poolData || poolData.liquidity === '0') {
    throw new Error('V4 native ETH/USDC 500 pool has no liquidity');
  }

  console.log(`Pool tick: ${poolData.tick}, liquidity: ${poolData.liquidity}`);

  const tickLower = Math.floor(poolData.tick / TICK_SPACING) * TICK_SPACING - TICK_SPACING * 10;
  const tickUpper = Math.floor(poolData.tick / TICK_SPACING) * TICK_SPACING + TICK_SPACING * 10;
  console.log(`Tick range: ${tickLower} to ${tickUpper}`);

  const ethForPosition = ethers.utils.parseEther('1');
  const usdcBalance = await usdcContract.balanceOf(signer.address);
  const usdcForPosition = usdcBalance.div(4);
  console.log(`Position: 1 ETH + ${ethers.utils.formatUnits(usdcForPosition, 6)} USDC`);

  // Approve USDC via Permit2
  console.log('Setting up Permit2 approvals...');
  await (await usdcContract.approve(PERMIT2_ADDRESS, ethers.constants.MaxUint256)).wait();

  const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, [
    'function approve(address token, address spender, uint160 amount, uint48 expiration) external'
  ], signer);

  const positionManagerAddress = adapter.addresses.positionManagerAddress;
  const maxAmount = ethers.BigNumber.from(2).pow(160).sub(1);
  const farFutureExpiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;

  await (await permit2Contract.approve(
    usdcAddress, positionManagerAddress, maxAmount, farFutureExpiration
  )).wait();

  // Create position
  console.log('Creating position...');
  const poolKey = {
    currency0: NATIVE_ETH,
    currency1: usdcAddress,
    fee: FEE,
    tickSpacing: TICK_SPACING,
    hooks: ethers.constants.AddressZero
  };

  const createPositionData = await adapter.generateCreatePositionData({
    position: { tickLower, tickUpper },
    token0Amount: ethForPosition.toString(),
    token1Amount: usdcForPosition.toString(),
    provider,
    walletAddress: signer.address,
    poolKey,
    poolData,
    token0Data: { address: NATIVE_ETH, decimals: 18 },
    token1Data: { address: usdcAddress, decimals: 6 },
    slippageTolerance: 5,
    deadlineMinutes: 20
  });

  const mintTx = await signer.sendTransaction({
    to: createPositionData.to,
    data: createPositionData.data,
    value: createPositionData.value
  });
  const mintReceipt = await mintTx.wait();

  const mintResult = adapter.parseIncreaseLiquidityReceipt(mintReceipt, {
    position: { tickLower, tickUpper },
    poolData
  });
  const tokenId = mintResult.tokenId;
  console.log(`Position minted: #${tokenId}`);

  // === 5. Generate fees with direct V4 pool swaps ===
  const NUM_SWAPS = 10;
  console.log(`\nGenerating fees with ${NUM_SWAPS} round-trip swaps on V4 ETH/USDC ${FEE / 100}bps pool...`);

  const v4Addresses = getPlatformAddresses(CHAIN_ID, 'uniswapV4');
  const universalRouterAddress = v4Addresses.universalRouterAddress;

  await (await permit2Contract.approve(
    usdcAddress, universalRouterAddress, maxAmount, farFutureExpiration
  )).wait();

  for (let i = 0; i < NUM_SWAPS; i++) {
    try {
      await executeDirectV4Swap(
        signer, poolKey, universalRouterAddress,
        NATIVE_ETH, usdcAddress,
        ethers.utils.parseEther('0.5')
      );

      const usdcBal = await usdcContract.balanceOf(signer.address);
      const swapBack = usdcBal.div(2);
      await executeDirectV4Swap(
        signer, poolKey, universalRouterAddress,
        usdcAddress, NATIVE_ETH,
        swapBack
      );

      console.log(`  Round-trip ${i + 1}/${NUM_SWAPS} complete`);
    } catch (error) {
      console.error(`  Round-trip ${i + 1} failed: ${error.message}`);
    }
  }

  // === 6. Set strategy + targets (opt-in) ===
  if (enableStrategy) {
    const targetPlatform = 'uniswapV4';
    const targetTokens = ['ETH', 'USDC'];

    console.log(`\nSetting vault targets: ${targetPlatform} / ${targetTokens.join(', ')}...`);
    await (await vault.setTargetPlatforms([targetPlatform])).wait();
    await (await vault.setTargetTokens(targetTokens)).wait();

    const babyStepsAddress = JSON.parse(fs.readFileSync(deploymentPath, 'utf8')).contracts.BabyStepsStrategy;
    const strategy = new ethers.Contract(babyStepsAddress, STRATEGY_ABI, signer);

    console.log(`Configuring BabySteps Aggressive strategy (${babyStepsAddress})...`);
    await (await strategy.authorizeVault(vaultAddress)).wait();
    await (await vault.setStrategy(babyStepsAddress)).wait();

    const selectTemplateCalldata = strategy.interface.encodeFunctionData('selectTemplate', [TEMPLATE_AGGRESSIVE]);
    await (await vault.execute([babyStepsAddress], [selectTemplateCalldata])).wait();

    console.log('Strategy configured: BabySteps Aggressive (template 3)');
  } else {
    console.log('\nSkipping strategy setup (set ENABLE_STRATEGY=1 to enable)');
  }

  // === 7. Transfer position to vault + authorize executor (opt-in) ===
  if (enableAutomation) {
    // Transfer position into vault
    console.log(`\nTransferring position #${tokenId} to vault...`);
    const v4PositionManager = new ethers.Contract(positionManagerAddress, POSITION_MANAGER_ABI, signer);
    await (await v4PositionManager['safeTransferFrom(address,address,uint256)'](signer.address, vaultAddress, tokenId)).wait();
    console.log(`Position #${tokenId} transferred to vault`);

    // Authorize executor — LAST step, triggers automation service
    const vaultInfo = await vaultFactory.getVaultInfo(vaultAddress);
    const executorIndex = vaultInfo[4];

    const DEV_MNEMONIC = 'pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard';
    const hdNode = ethers.utils.HDNode.fromMnemonic(DEV_MNEMONIC);
    const executorAddress = hdNode.derivePath(`m/44'/60'/0'/0/${executorIndex}`).address;

    const executorFunding = ethers.utils.parseEther('10');
    console.log(`Authorizing executor ${executorAddress} and funding with ${ethers.utils.formatEther(executorFunding)} ETH...`);
    await (await vault.setExecutor(executorAddress, { value: executorFunding })).wait();

    const executorBalance = await provider.getBalance(executorAddress);
    console.log(`Executor authorized and funded. Balance: ${ethers.utils.formatEther(executorBalance)} ETH`);
  } else {
    console.log('\nSkipping automation setup (set ENABLE_AUTOMATION=1 to enable)');
  }

  // === Summary ===
  console.log('\n====================');
  console.log('Seed complete!');
  console.log(`Vault: ${vaultAddress}`);
  console.log(`Position: #${tokenId} (${enableAutomation ? 'in vault' : 'on wallet — transfer via UI'})`);
  console.log('Wallet funded with WETH, USDC, USDT, WBTC, LINK.');
  if (enableAutomation) console.log('Automation enabled — vault ready for automation service.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error in seed-v4 script:', error);
    process.exit(1);
  });
