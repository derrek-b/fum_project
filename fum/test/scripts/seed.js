// test/scripts/seed.js
// Seeds the local Hardhat Arbitrum fork with a vault, tokens, and a Uniswap V3 WETH/USDC position.
//
// Usage:
//   node test/scripts/seed.js                     # vault + tokens + position on wallet
//   ENABLE_STRATEGY=1 node test/scripts/seed.js   # + strategy + targets on vault
//   ENABLE_AUTOMATION=1 node test/scripts/seed.js  # + position transferred to vault + executor (full automation)
//
// NOTE: This script is for local Hardhat testing only

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Token } from '@uniswap/sdk-core';
import { Pool, Position } from '@uniswap/v3-sdk';
import IUniswapV3PoolArtifact from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json' with { type: 'json' };
import NonfungiblePositionManagerArtifact from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json' with { type: 'json' };
import ERC20Artifact from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };
import { getChainConfig } from 'fum_library/helpers/chainHelpers';
import contractData from 'fum_library/artifacts/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ABIs
const IUniswapV3PoolABI = IUniswapV3PoolArtifact.abi;
const NonfungiblePositionManagerABI = NonfungiblePositionManagerArtifact.abi;
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

// Arbitrum addresses (same on local fork)
const CHAIN_ID = 1337;
const RPC_URL = 'http://localhost:8545';
const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const WBTC_ADDRESS = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f';
const LINK_ADDRESS = '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4';
const POSITION_MANAGER_ADDRESS = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
const UNISWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const FEE_TIER = 500; // 0.05%
const TEMPLATE_AGGRESSIVE = 3;

async function main() {
  const enableAutomation = process.env.ENABLE_AUTOMATION === '1';
  const enableStrategy = enableAutomation || process.env.ENABLE_STRATEGY === '1';

  const networkConfig = getChainConfig(CHAIN_ID);
  if (!networkConfig) {
    throw new Error(`Network with chainId ${CHAIN_ID} not configured`);
  }

  console.log(`Seeding local Hardhat (${networkConfig.name}) — Uniswap V3 WETH/USDC`);
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
  const vaultName = 'Test Vault ' + Math.floor(Date.now() / 1000);
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

  // Wrap 50 ETH → WETH (10 to keep + 10 each for 4 token swaps)
  console.log('\nWrapping 50 ETH to WETH...');
  await (await wethContract.deposit({ value: ethers.utils.parseEther('50') })).wait();

  // Approve router for all swaps
  const router = new ethers.Contract(UNISWAP_ROUTER_ADDRESS, ROUTER_ABI, signer);
  await (await wethContract.approve(UNISWAP_ROUTER_ADDRESS, ethers.utils.parseEther('40'))).wait();

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const swapWethFor = async (tokenOut, symbol, fee = 500) => {
    console.log(`Swapping 10 WETH for ${symbol}...`);
    const tx = await router.exactInputSingle({
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

  console.log('\nVault token balances:');
  console.log(`  WETH: ${ethers.utils.formatEther(await wethContract.balanceOf(vaultAddress))}`);
  console.log(`  USDC: ${ethers.utils.formatUnits(await usdcContract.balanceOf(vaultAddress), 6)}`);

  // === 4. Mint V3 position ===
  console.log('\nCreating Uniswap V3 WETH/USDC position...');

  const WETH = new Token(CHAIN_ID, WETH_ADDRESS, 18, 'WETH', 'Wrapped Ether');
  const USDC = new Token(CHAIN_ID, USDC_ADDRESS, 6, 'USDC', 'USD Coin');

  const poolAddress = Pool.getAddress(WETH, USDC, FEE_TIER);
  const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI, signer);

  const [slot0Data, liquidity, tickSpacing, fee] = await Promise.all([
    poolContract.slot0(),
    poolContract.liquidity(),
    poolContract.tickSpacing(),
    poolContract.fee(),
  ]);

  const sqrtPriceX96 = slot0Data[0];
  const currentTick = Number(slot0Data[1]);

  const sqrtPrice = Number(sqrtPriceX96) / (2 ** 96);
  const price = sqrtPrice * sqrtPrice * Math.pow(10, WETH.decimals - USDC.decimals);
  console.log(`Current price: ${price.toFixed(2)} USDC/WETH (tick: ${currentTick})`);

  // Calculate tick range (±5% centered on current tick)
  const spacing = Number(tickSpacing);
  let tickLower = Math.floor((currentTick - Math.log(1.05) / Math.log(1.0001)) / spacing) * spacing;
  let tickUpper = Math.ceil((currentTick + Math.log(1.05) / Math.log(1.0001)) / spacing) * spacing;

  if (currentTick < tickLower || currentTick > tickUpper) {
    tickLower = Math.floor(currentTick / spacing) * spacing - spacing;
    tickUpper = Math.ceil(currentTick / spacing) * spacing + spacing;
  }

  console.log(`Tick range: ${tickLower} to ${tickUpper}`);

  const poolInstance = new Pool(
    WETH, USDC, Number(fee),
    sqrtPriceX96.toString(),
    liquidity.toString(),
    currentTick
  );

  const wethAmount = ethers.utils.parseEther('3');
  const usdcValue = Math.floor(3 * price * 1e6);

  const position = Position.fromAmounts({
    pool: poolInstance,
    tickLower,
    tickUpper,
    amount0: wethAmount.toString(),
    amount1: usdcValue.toString(),
    useFullPrecision: true,
  });

  console.log(`Position: ${ethers.utils.formatEther(position.amount0.quotient.toString())} WETH + ${ethers.utils.formatUnits(position.amount1.quotient.toString(), 6)} USDC`);

  const positionManager = new ethers.Contract(POSITION_MANAGER_ADDRESS, NonfungiblePositionManagerABI, signer);

  await (await wethContract.approve(POSITION_MANAGER_ADDRESS, position.amount0.quotient.toString())).wait();
  await (await usdcContract.approve(POSITION_MANAGER_ADDRESS, position.amount1.quotient.toString())).wait();

  const mintTx = await positionManager.mint({
    token0: WETH.address,
    token1: USDC.address,
    fee: FEE_TIER,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    amount0Desired: position.amount0.quotient.toString(),
    amount1Desired: position.amount1.quotient.toString(),
    amount0Min: 0,
    amount1Min: 0,
    recipient: signer.address,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20,
  }, { gasLimit: 5000000 });

  const mintReceipt = await mintTx.wait();

  const transferEvent = mintReceipt.logs.find(log => {
    try {
      return log.topics.length === 4 &&
        log.topics[0] === ethers.utils.id('Transfer(address,address,uint256)') &&
        log.topics[1] === ethers.utils.hexZeroPad(ethers.constants.AddressZero, 32);
    } catch { return false; }
  });

  if (!transferEvent) throw new Error('Transfer event not found — mint may have failed');
  const tokenId = ethers.BigNumber.from(transferEvent.topics[3]);
  console.log(`Position minted: #${tokenId}`);

  // === 5. Generate fees with round-trip swaps ===
  const NUM_SWAPS = 10;
  console.log(`\nGenerating fees with ${NUM_SWAPS} round-trip swaps on WETH/USDC ${FEE_TIER / 10000}% pool...`);

  await (await wethContract.approve(UNISWAP_ROUTER_ADDRESS, ethers.constants.MaxUint256)).wait();
  await (await usdcContract.approve(UNISWAP_ROUTER_ADDRESS, ethers.constants.MaxUint256)).wait();

  const swapDeadline = Math.floor(Date.now() / 1000) + 60 * 20;
  for (let i = 0; i < NUM_SWAPS; i++) {
    const isWethToUsdc = i % 2 === 0;
    const tokenIn = isWethToUsdc ? WETH_ADDRESS : USDC_ADDRESS;
    const tokenOut = isWethToUsdc ? USDC_ADDRESS : WETH_ADDRESS;
    const amountIn = isWethToUsdc
      ? ethers.utils.parseEther('0.5')
      : ethers.utils.parseUnits('1700', 6);

    try {
      const tx = await router.exactInputSingle({
        tokenIn, tokenOut, fee: FEE_TIER,
        recipient: signer.address, deadline: swapDeadline, amountIn,
        amountOutMinimum: 0, sqrtPriceLimitX96: 0,
      }, { gasLimit: 300000 });
      await tx.wait();
      console.log(`  Swap ${i + 1}/${NUM_SWAPS}: ${isWethToUsdc ? 'WETH -> USDC' : 'USDC -> WETH'}`);
    } catch (error) {
      console.error(`  Swap ${i + 1} failed: ${error.message}`);
    }
  }

  // === 6. Set strategy + targets (opt-in) ===
  if (enableStrategy) {
    const targetPlatform = 'uniswapV3';
    const targetTokens = ['WETH', 'USDC'];

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
    await (await positionManager['safeTransferFrom(address,address,uint256)'](signer.address, vaultAddress, tokenId)).wait();
    console.log(`Position #${tokenId} transferred to vault`);

    // Authorize executor — LAST step, triggers automation service
    const vaultInfo = await vaultFactory.getVaultInfo(vaultAddress);
    const executorIndex = vaultInfo[4];

    // Dev-only mnemonic — must match AUTOMATION_MNEMONIC in fum_automation/.env.local
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
  console.log('Run "npm run generate-fees:weth" to generate more fees later.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error in seed script:', error);
    process.exit(1);
  });
