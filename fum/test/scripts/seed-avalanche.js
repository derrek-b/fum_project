// test/scripts/seed-avalanche.js
// Seeds the local Hardhat Avalanche fork with a vault and tokens.
// Optionally creates a Trader Joe V2.2 WAVAX/USDC position in the vault,
// configures strategy, and enables automation.
//
// Usage:
//   node test/scripts/seed-avalanche.js                                        # vault + tokens
//   ENABLE_POSITION=1 node test/scripts/seed-avalanche.js                      # + position in vault
//   ENABLE_STRATEGY=1 node test/scripts/seed-avalanche.js                      # + strategy + targets
//   ENABLE_STRATEGY=1 ENABLE_POSITION=1 node test/scripts/seed-avalanche.js    # + strategy + position
//   ENABLE_AUTOMATION=1 node test/scripts/seed-avalanche.js                    # + strategy + executor
//   ENABLE_AUTOMATION=1 ENABLE_POSITION=1 node test/scripts/seed-avalanche.js  # + strategy + position + executor
//
// NOTE: This script is for local Hardhat testing only

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TraderJoeV2_2Adapter } from 'fum_library/adapters';
import { getChainConfig, getPlatformAddresses } from 'fum_library/helpers/chainHelpers';
import contractData from 'fum_library/artifacts/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHAIN_ID = 1338;
const RPC_URL = 'http://localhost:8546';
const LB_PAIR_ADDRESS = '0x864d4e5ee7318e97483db7eb0912e09f161516ea'; // WAVAX/USDC 10bps pool
const TEMPLATE_AGGRESSIVE = 3;

// Avalanche token addresses
const WAVAX_ADDRESS = '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7';
const USDC_ADDRESS = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const USDT_ADDRESS = '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7';

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

const STRATEGY_ABI = [
  'function authorizeVault(address vault) external',
  'function selectTemplate(uint8 template) external',
];

async function main() {
  const enableAutomation = process.env.ENABLE_AUTOMATION === '1';
  const enableStrategy = enableAutomation || process.env.ENABLE_STRATEGY === '1';
  const enablePosition = process.env.ENABLE_POSITION === '1';

  const networkConfig = getChainConfig(CHAIN_ID);
  if (!networkConfig) {
    throw new Error(`Network with chainId ${CHAIN_ID} not configured`);
  }

  const flags = [
    enablePosition && 'position',
    enableStrategy && 'strategy',
    enableAutomation && 'executor',
  ].filter(Boolean);

  console.log(`Seeding local Hardhat (${networkConfig.name}) — Trader Joe V2.2 WAVAX/USDC`);
  console.log(`  Mode: vault + tokens${flags.length ? ' + ' + flags.join(' + ') : ''}`);

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
      throw new Error(`No VaultFactory address found for chainId ${CHAIN_ID}. Run "npm run hardhat:av" first.`);
    }
  }

  const vaultFactoryABI = contractData.VaultFactory.abi;
  const positionVaultABI = contractData.PositionVault.abi;
  const vaultFactory = new ethers.Contract(vaultFactoryAddress, vaultFactoryABI, signer);

  console.log(`\nCreating vault...`);
  const vaultName = 'Avalanche Test Vault ' + Math.floor(Date.now() / 1000);
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
  const wavaxContract = new ethers.Contract(WAVAX_ADDRESS, WAVAX_ABI, signer);
  const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
  const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, signer);

  const tjAddresses = getPlatformAddresses(CHAIN_ID, 'traderjoeV2_2');
  const lbRouter = new ethers.Contract(tjAddresses.lbRouterAddress, LB_ROUTER_ABI, signer);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  // Wrap 310 AVAX → WAVAX (50 vault + 100 for USDC swap + 100 for USDT swap + 60 buffer)
  console.log('\nWrapping 310 AVAX to WAVAX...');
  await (await wavaxContract.deposit({ value: ethers.utils.parseEther('310') })).wait();

  await (await wavaxContract.approve(tjAddresses.lbRouterAddress, ethers.constants.MaxUint256)).wait();

  console.log('Swapping 100 WAVAX for USDC...');
  await (await lbRouter.swapExactTokensForTokens(
    ethers.utils.parseEther('100'), 0,
    { pairBinSteps: [10], versions: [3], tokenPath: [WAVAX_ADDRESS, USDC_ADDRESS] },
    signer.address, deadline
  )).wait();

  console.log('Swapping 100 WAVAX for USDT (via USDC)...');
  await (await lbRouter.swapExactTokensForTokens(
    ethers.utils.parseEther('100'), 0,
    {
      pairBinSteps: [10, 1],
      versions: [3, 3],
      tokenPath: [WAVAX_ADDRESS, USDC_ADDRESS, USDT_ADDRESS],
    },
    signer.address, deadline
  )).wait();

  console.log('\nWallet balances:');
  console.log(`  AVAX:  ${ethers.utils.formatEther(await provider.getBalance(signer.address))}`);
  console.log(`  WAVAX: ${ethers.utils.formatEther(await wavaxContract.balanceOf(signer.address))}`);
  console.log(`  USDC:  ${ethers.utils.formatUnits(await usdcContract.balanceOf(signer.address), 6)}`);
  console.log(`  USDT:  ${ethers.utils.formatUnits(await usdtContract.balanceOf(signer.address), 6)}`);

  // === 3. Transfer tokens to vault ===
  console.log('\nTransferring tokens to the vault...');

  const wavaxTransfer = ethers.utils.parseEther('50');
  await (await wavaxContract.transfer(vaultAddress, wavaxTransfer)).wait();
  console.log(`  Transferred ${ethers.utils.formatEther(wavaxTransfer)} WAVAX`);

  const avaxTransfer = ethers.utils.parseEther('50');
  await (await signer.sendTransaction({ to: vaultAddress, value: avaxTransfer })).wait();
  console.log(`  Transferred ${ethers.utils.formatEther(avaxTransfer)} AVAX`);

  const walletUsdc = await usdcContract.balanceOf(signer.address);
  await (await usdcContract.transfer(vaultAddress, walletUsdc)).wait();
  console.log(`  Transferred ${ethers.utils.formatUnits(walletUsdc, 6)} USDC`);

  console.log('\nVault balances:');
  console.log(`  AVAX:  ${ethers.utils.formatEther(await provider.getBalance(vaultAddress))}`);
  console.log(`  WAVAX: ${ethers.utils.formatEther(await wavaxContract.balanceOf(vaultAddress))}`);
  console.log(`  USDC:  ${ethers.utils.formatUnits(await usdcContract.balanceOf(vaultAddress), 6)}`);

  // === 4. Create TJ position in vault (opt-in) ===
  let positionId = null;

  if (enablePosition) {
    console.log('\nCreating Trader Joe WAVAX/USDC position in vault...');

    const adapter = new TraderJoeV2_2Adapter(CHAIN_ID, provider);
    const poolData = await adapter.getPoolData(LB_PAIR_ADDRESS, provider);
    console.log(`Pool active bin: ${poolData.activeId}, binStep: ${poolData.binStep}`);

    const BIN_SPACING = 10;
    const lowerBinId = poolData.activeId - BIN_SPACING;
    const upperBinId = poolData.activeId + BIN_SPACING;
    console.log(`Bin range: ${lowerBinId} to ${upperBinId}`);

    // Use half of vault's tokens for the position
    const vaultWavax = await wavaxContract.balanceOf(vaultAddress);
    const vaultUsdc = await usdcContract.balanceOf(vaultAddress);
    const wavaxForPosition = vaultWavax.div(2);
    const usdcForPosition = vaultUsdc.div(2);

    // Sort tokens (TJ requires tokenX = lower address)
    const wavaxData = { address: WAVAX_ADDRESS, symbol: 'WAVAX', decimals: 18 };
    const usdcData = { address: USDC_ADDRESS, symbol: 'USDC', decimals: 6 };
    const { sortedToken0, sortedToken1, tokensSwapped } = adapter.sortTokens(wavaxData, usdcData);

    const token0Amount = tokensSwapped ? wavaxForPosition : usdcForPosition;
    const token1Amount = tokensSwapped ? usdcForPosition : wavaxForPosition;

    // Approve TJPositionManager to pull tokens from vault
    const approvalTxs = await adapter.getRequiredApprovals(
      'liquidity', vaultAddress, [WAVAX_ADDRESS, USDC_ADDRESS], provider
    );

    if (approvalTxs.length > 0) {
      console.log(`Approving TJPositionManager (${approvalTxs.length} tokens)...`);
      const approveTx = await vault.approve(
        approvalTxs.map(t => t.to),
        approvalTxs.map(t => t.data)
      );
      await approveTx.wait();
    }

    console.log('Creating position...');
    const createPositionData = await adapter.generateCreatePositionData({
      position: { lowerBinId, upperBinId },
      token0Amount: token0Amount.toString(),
      token1Amount: token1Amount.toString(),
      provider,
      walletAddress: vaultAddress,
      poolData: { ...poolData, address: LB_PAIR_ADDRESS },
      token0Data: sortedToken0,
      token1Data: sortedToken1,
      slippageTolerance: 1,
      deadlineMinutes: 5,
    });

    const mintTx = await vault.mint(
      [createPositionData.to],
      [createPositionData.data],
      [createPositionData.value],
      { gasLimit: 10000000 }
    );
    const mintReceipt = await mintTx.wait();

    const POSITION_CREATED_TOPIC = ethers.utils.id(
      'PositionCreated(uint256,address,address,address,uint256[],uint256[],uint256,uint256)'
    );
    const positionCreatedLog = mintReceipt.logs.find(log => log.topics[0] === POSITION_CREATED_TOPIC);

    if (!positionCreatedLog) {
      throw new Error('PositionCreated event not found — mint may have failed');
    }

    positionId = ethers.BigNumber.from(positionCreatedLog.topics[1]);
    console.log(`Position created: #${positionId}`);

    // === 5. Generate fees with round-trip swaps ===
    const NUM_SWAPS = 10;
    const BIN_STEP = 10;
    const VERSION = 3;
    console.log(`\nGenerating fees with ${NUM_SWAPS} round-trip swaps on WAVAX/USDC ${BIN_STEP}bps pool...`);

    // Fund signer with WAVAX for swaps
    await (await wavaxContract.deposit({ value: ethers.utils.parseEther('100') })).wait();
    await (await wavaxContract.approve(tjAddresses.lbRouterAddress, ethers.constants.MaxUint256)).wait();

    // Swap 50 WAVAX → USDC to have both tokens for round-trips
    await (await lbRouter.swapExactTokensForTokens(
      ethers.utils.parseEther('50'), 0,
      { pairBinSteps: [BIN_STEP], versions: [VERSION], tokenPath: [WAVAX_ADDRESS, USDC_ADDRESS] },
      signer.address, deadline
    )).wait();

    const signerUsdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
    await (await signerUsdc.approve(tjAddresses.lbRouterAddress, ethers.constants.MaxUint256)).wait();

    for (let i = 0; i < NUM_SWAPS; i++) {
      try {
        await (await lbRouter.swapExactTokensForTokens(
          ethers.utils.parseEther('5'), 0,
          { pairBinSteps: [BIN_STEP], versions: [VERSION], tokenPath: [WAVAX_ADDRESS, USDC_ADDRESS] },
          signer.address, deadline
        )).wait();

        const usdcBal = await signerUsdc.balanceOf(signer.address);
        const swapBack = usdcBal.div(2);
        await (await lbRouter.swapExactTokensForTokens(
          swapBack, 0,
          { pairBinSteps: [BIN_STEP], versions: [VERSION], tokenPath: [USDC_ADDRESS, WAVAX_ADDRESS] },
          signer.address, deadline
        )).wait();

        console.log(`  Round-trip ${i + 1}/${NUM_SWAPS} complete`);
      } catch (error) {
        console.error(`  Round-trip ${i + 1} failed: ${error.message}`);
      }
    }
  } else {
    console.log('\nSkipping position creation (set ENABLE_POSITION=1 to enable)');
  }

  // === 6. Set strategy + targets (opt-in) ===
  if (enableStrategy) {
    const targetPlatform = 'traderjoeV2_2';
    const targetTokens = ['WAVAX', 'USDC'];

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

  // === 7. Authorize executor (opt-in) ===
  // Runs LAST — this fires the on-chain event that the automation service listens for.
  if (enableAutomation) {
    const vaultInfo = await vaultFactory.getVaultInfo(vaultAddress);
    const executorIndex = vaultInfo[4];

    const DEV_MNEMONIC = 'pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard';
    const hdNode = ethers.utils.HDNode.fromMnemonic(DEV_MNEMONIC);
    const executorAddress = hdNode.derivePath(`m/44'/60'/0'/0/${executorIndex}`).address;

    const executorFunding = ethers.utils.parseEther('10');
    console.log(`\nAuthorizing executor ${executorAddress} and funding with ${ethers.utils.formatEther(executorFunding)} AVAX...`);
    await (await vault.setExecutor(executorAddress, { value: executorFunding })).wait();

    const executorBalance = await provider.getBalance(executorAddress);
    console.log(`Executor authorized and funded. Balance: ${ethers.utils.formatEther(executorBalance)} AVAX`);
  } else {
    console.log('\nSkipping automation setup (set ENABLE_AUTOMATION=1 to enable)');
  }

  // === Summary ===
  console.log('\n====================');
  console.log('Seed complete!');
  console.log(`Vault: ${vaultAddress}`);
  if (positionId) console.log(`Position: #${positionId} (in vault)`);
  console.log('Wallet funded with AVAX, WAVAX, USDT.');
  if (enableStrategy) console.log('Strategy: BabySteps Aggressive (template 3)');
  if (enableAutomation) console.log('Automation enabled — vault ready for automation service.');

  console.log('\nFinal wallet balances:');
  console.log(`  AVAX:  ${ethers.utils.formatEther(await provider.getBalance(signer.address))}`);
  console.log(`  WAVAX: ${ethers.utils.formatEther(await wavaxContract.balanceOf(signer.address))}`);
  console.log(`  USDT:  ${ethers.utils.formatUnits(await usdtContract.balanceOf(signer.address), 6)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error in seed-avalanche script:', error);
    process.exit(1);
  });
