// test/scripts/create-test-vault-avalanche.js
// Creates a test vault on local Avalanche fork, funds wallet and vault with tokens.
// Optionally enables automation (executor + strategy).
//
// Usage:
//   node test/scripts/create-test-vault-avalanche.js                         # vault + tokens only
//   ENABLE_STRATEGY=1 node test/scripts/create-test-vault-avalanche.js       # + strategy + targets (traderjoeV2_2 / WAVAX,USDC)
//   ENABLE_AUTOMATION=1 node test/scripts/create-test-vault-avalanche.js     # + executor + strategy + targets
//
// NOTE: This script is for local Hardhat testing only

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getChainConfig, getPlatformAddresses } from 'fum_library/helpers/chainHelpers';
import contractData from 'fum_library/artifacts/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHAIN_ID = 1338;
const RPC_URL = 'http://localhost:8546';

// Minimal ABIs
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint amount) returns (bool)',
  'function transfer(address to, uint amount) returns (bool)',
];

const WAVAX_ABI = [
  ...ERC20_ABI,
  'function deposit() payable',
];

const LB_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) external returns (uint256 amountOut)',
];

// Avalanche token addresses
const WAVAX_ADDRESS = '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7';
const USDC_ADDRESS = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const USDT_ADDRESS = '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7';

async function main() {
  const networkConfig = getChainConfig(CHAIN_ID);
  console.log(`Creating test vault on local Hardhat (${networkConfig.name})...\n`);

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Hardhat account #0
    provider
  );
  console.log(`Using account: ${signer.address}`);

  // === Get VaultFactory ===
  let vaultFactoryAddress;
  const deploymentPath = path.join(__dirname, `../../deployments/${CHAIN_ID}-latest.json`);
  if (fs.existsSync(deploymentPath)) {
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    vaultFactoryAddress = deployment.contracts.VaultFactory;
  } else {
    vaultFactoryAddress = contractData.VaultFactory?.addresses?.[CHAIN_ID.toString()];
    if (!vaultFactoryAddress) {
      throw new Error(`No VaultFactory address found for chainId ${CHAIN_ID}. Run "npm run hardhat:av" first.`);
    }
  }
  console.log(`VaultFactory: ${vaultFactoryAddress}`);

  const vaultFactoryABI = contractData.VaultFactory.abi;
  const positionVaultABI = contractData.PositionVault.abi;
  const vaultFactory = new ethers.Contract(vaultFactoryAddress, vaultFactoryABI, signer);

  // === Create vault ===
  const vaultName = "Avalanche Test Vault " + Math.floor(Date.now() / 1000);
  console.log(`\nCreating vault "${vaultName}"...`);

  const tx = await vaultFactory.createVault(vaultName);
  const receipt = await tx.wait();

  const vaultCreatedEvent = receipt.logs
    .filter(log => {
      try { return vaultFactory.interface.parseLog(log).name === 'VaultCreated'; }
      catch { return false; }
    })
    .map(log => vaultFactory.interface.parseLog(log));

  if (vaultCreatedEvent.length === 0) {
    throw new Error("VaultCreated event not found");
  }

  const vaultAddress = vaultCreatedEvent[0].args[1];
  console.log(`Vault created: ${vaultAddress}`);

  const vault = new ethers.Contract(vaultAddress, positionVaultABI, signer);

  const enableAutomation = process.env.ENABLE_AUTOMATION === '1';
  const enableStrategy = enableAutomation || process.env.ENABLE_STRATEGY === '1';

  // === Set strategy + targets (opt-in: ENABLE_STRATEGY=1 or ENABLE_AUTOMATION=1) ===
  // Must run BEFORE executor auth — setExecutor triggers the automation service,
  // so strategy and targets need to be in place first.
  if (enableStrategy) {
    const targetPlatform = 'traderjoeV2_2';
    const targetTokens = ['WAVAX', 'USDC'];

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

  // === Authorize executor (opt-in: ENABLE_AUTOMATION=1) ===
  // Runs LAST — this fires the on-chain event that the automation service listens for.
  if (enableAutomation) {
    const vaultInfo = await vaultFactory.getVaultInfo(vaultAddress);
    const executorIndex = vaultInfo[4];
    console.log(`\nExecutor index: ${executorIndex}`);

    // Dev-only mnemonic — must match AUTOMATION_MNEMONIC in fum_automation/.env.local
    const DEV_MNEMONIC = 'pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard';
    const hdNode = ethers.utils.HDNode.fromMnemonic(DEV_MNEMONIC);
    const executorAddress = hdNode.derivePath(`m/44'/60'/0'/0/${executorIndex}`).address;
    console.log(`Executor address: ${executorAddress}`);

    const executorFunding = ethers.utils.parseEther("10");
    console.log(`Authorizing executor and funding with ${ethers.utils.formatEther(executorFunding)} AVAX...`);
    await (await vault.setExecutor(executorAddress, { value: executorFunding })).wait();

    const executorBalance = await provider.getBalance(executorAddress);
    console.log(`Executor funded. Balance: ${ethers.utils.formatEther(executorBalance)} AVAX`);
  } else {
    console.log('\nSkipping executor setup (set ENABLE_AUTOMATION=1 to enable)');
  }

  // === Fund wallet with tokens ===
  const wavaxContract = new ethers.Contract(WAVAX_ADDRESS, WAVAX_ABI, signer);
  const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
  const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, signer);

  const tjAddresses = getPlatformAddresses(CHAIN_ID, 'traderjoeV2_2');
  const lbRouter = new ethers.Contract(tjAddresses.lbRouterAddress, LB_ROUTER_ABI, signer);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  // Wrap 310 AVAX → WAVAX (50 vault + 100 for USDC swap + 100 for USDT swap + 60 buffer)
  console.log("\nWrapping 310 AVAX to WAVAX...");
  await (await wavaxContract.deposit({ value: ethers.utils.parseEther("310") })).wait();

  // Approve router for all swaps
  await (await wavaxContract.approve(tjAddresses.lbRouterAddress, ethers.constants.MaxUint256)).wait();

  // Swap 100 WAVAX → USDC (for vault)
  console.log("Swapping 100 WAVAX for USDC...");
  await (await lbRouter.swapExactTokensForTokens(
    ethers.utils.parseEther("100"),
    0,
    { pairBinSteps: [20], versions: [2], tokenPath: [WAVAX_ADDRESS, USDC_ADDRESS] },
    signer.address,
    deadline
  )).wait();

  // Swap 100 WAVAX → USDT (via USDC)
  console.log("Swapping 100 WAVAX for USDT (via USDC)...");
  await (await lbRouter.swapExactTokensForTokens(
    ethers.utils.parseEther("100"),
    0,
    {
      pairBinSteps: [20, 1],
      versions: [2, 3],
      tokenPath: [WAVAX_ADDRESS, USDC_ADDRESS, USDT_ADDRESS],
    },
    signer.address,
    deadline
  )).wait();

  // Print wallet balances
  const walletAvax = await provider.getBalance(signer.address);
  const walletWavax = await wavaxContract.balanceOf(signer.address);
  const walletUsdc = await usdcContract.balanceOf(signer.address);
  const walletUsdt = await usdtContract.balanceOf(signer.address);

  console.log("\nWallet balances:");
  console.log(`  AVAX:  ${ethers.utils.formatEther(walletAvax)}`);
  console.log(`  WAVAX: ${ethers.utils.formatEther(walletWavax)}`);
  console.log(`  USDC:  ${ethers.utils.formatUnits(walletUsdc, 6)}`);
  console.log(`  USDT:  ${ethers.utils.formatUnits(walletUsdt, 6)}`);

  // === Fund the vault ===
  console.log("\nTransferring tokens to the vault...");

  // 50 WAVAX
  const wavaxTransfer = ethers.utils.parseEther("50");
  await (await wavaxContract.transfer(vaultAddress, wavaxTransfer)).wait();
  console.log(`  Transferred ${ethers.utils.formatEther(wavaxTransfer)} WAVAX`);

  // 50 AVAX (native)
  const avaxTransfer = ethers.utils.parseEther("50");
  await (await signer.sendTransaction({ to: vaultAddress, value: avaxTransfer })).wait();
  console.log(`  Transferred ${ethers.utils.formatEther(avaxTransfer)} AVAX`);

  // All USDC to vault
  await (await usdcContract.transfer(vaultAddress, walletUsdc)).wait();
  console.log(`  Transferred ${ethers.utils.formatUnits(walletUsdc, 6)} USDC`);

  // Verify vault balances
  const vaultAvax = await provider.getBalance(vaultAddress);
  const vaultWavax = await wavaxContract.balanceOf(vaultAddress);
  const vaultUsdc = await usdcContract.balanceOf(vaultAddress);

  console.log("\nVault balances:");
  console.log(`  AVAX:  ${ethers.utils.formatEther(vaultAvax)}`);
  console.log(`  WAVAX: ${ethers.utils.formatEther(vaultWavax)}`);
  console.log(`  USDC:  ${ethers.utils.formatUnits(vaultUsdc, 6)}`);

  // Final wallet balances
  console.log("\nFinal wallet balances:");
  console.log(`  AVAX:  ${ethers.utils.formatEther(await provider.getBalance(signer.address))}`);
  console.log(`  WAVAX: ${ethers.utils.formatEther(await wavaxContract.balanceOf(signer.address))}`);
  console.log(`  USDT:  ${ethers.utils.formatUnits(await usdtContract.balanceOf(signer.address), 6)}`);

  console.log("\nTest vault setup complete!");
  console.log("====================");
  console.log(`Vault Address: ${vaultAddress}`);
  console.log("Wallet has AVAX, WAVAX, and USDT for manual UI testing.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
