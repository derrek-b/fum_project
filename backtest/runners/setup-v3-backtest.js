#!/usr/bin/env node
/**
 * V3 Backtest Environment Setup
 * Starts Hardhat forked at the correct block, deploys contracts,
 * creates a vault with a ~$15k V3 position using BabySteps aggressive template
 *
 * Usage: node backtest/runners/setup-v3-backtest.js --chain 42161 --tokens WETH USDC --fee 500
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { getTokenBySymbol, getWethAddress, getPlatformAddresses, initFumLibrary } from 'fum_library';
import { getVaultContract } from 'fum_library/blockchain';
import { deployFUMContracts } from 'fum_library/test/setup/test-contracts';
import { TOKEN_BALANCE_SLOTS } from '../config/token-slots.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Load environment variables
dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env.local') });

const HARDHAT_URL = 'http://localhost:8545';
const HARDHAT_PORT = 8545;
const PLATFORM = 'uniswapV3';

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    chain: null,
    tokens: [],
    fee: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--chain') {
      params.chain = parseInt(args[++i]);
    } else if (args[i] === '--tokens') {
      params.tokens.push(args[++i]);
      params.tokens.push(args[++i]);
    } else if (args[i] === '--fee') {
      params.fee = parseInt(args[++i]);
    }
  }

  if (!params.chain || params.tokens.length !== 2 || !params.fee) {
    console.error('❌ Usage: node setup-v3-backtest.js --chain <chainId> --tokens <token0> <token1> --fee <fee>');
    console.error('   Example: node setup-v3-backtest.js --chain 42161 --tokens WETH USDC --fee 500');
    process.exit(1);
  }

  return params;
}

// Load events file and get metadata
function loadEventsFile(chain, token0, token1, fee) {
  const [t0, t1] = [token0, token1].sort();
  const fileName = `${t0}-${t1}-${fee}`;
  const filePath = path.join(__dirname, `../data/${chain}/${PLATFORM}/${fileName}/events.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Events file not found: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Get token config, handling WETH specially
function getTokenConfig(symbol, chainId) {
  if (symbol === 'WETH') {
    return {
      address: getWethAddress(chainId),
      symbol: 'WETH',
      decimals: 18,
      isNative: false
    };
  }

  const config = getTokenBySymbol(symbol);
  if (!config) {
    throw new Error(`Token ${symbol} not found`);
  }

  const address = config.addresses?.[chainId];
  if (!address) {
    throw new Error(`${symbol} not deployed on chain ${chainId}`);
  }

  return {
    address,
    symbol: config.symbol,
    decimals: config.decimals,
    isNative: config.isNative
  };
}

// Fund wallet with token using storage slot manipulation
async function fundWalletWithToken(provider, walletAddress, tokenAddress, amount, decimals) {
  const slot = TOKEN_BALANCE_SLOTS[tokenAddress.toLowerCase()];
  if (slot === undefined) {
    throw new Error(`No storage slot found for token ${tokenAddress}`);
  }

  const storageSlot = ethers.utils.solidityKeccak256(
    ['uint256', 'uint256'],
    [walletAddress, slot]
  );

  const value = ethers.utils.parseUnits(amount.toString(), decimals);
  await provider.send('hardhat_setStorageAt', [
    tokenAddress,
    storageSlot,
    ethers.utils.hexZeroPad(value.toHexString(), 32)
  ]);
}

// Fund wallet with ETH
async function fundWalletWithETH(provider, walletAddress, amount) {
  const value = ethers.utils.parseEther(amount.toString());
  await provider.send('hardhat_setBalance', [
    walletAddress,
    ethers.utils.hexValue(value)
  ]);
}

// Start Hardhat node with specific fork block
async function startHardhat(forkBlock) {
  return new Promise((resolve, reject) => {
    console.log(`🚀 Starting Hardhat node forked at block ${forkBlock}...`);

    const forkUrl = `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;

    const hardhatProcess = spawn('npx', [
      'hardhat', 'node',
      '--port', HARDHAT_PORT.toString(),
      '--fork', forkUrl,
      '--fork-block-number', forkBlock.toString()
    ], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let ready = false;

    hardhatProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Started HTTP and WebSocket JSON-RPC server')) {
        ready = true;
        console.log('   ✅ Hardhat node started\n');
        setTimeout(() => resolve(hardhatProcess), 1000);
      }
    });

    hardhatProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      if (!msg.includes('WARNING') && !msg.includes('Deprecation')) {
        console.error('   Hardhat:', msg.trim());
      }
    });

    hardhatProcess.on('error', reject);

    setTimeout(() => {
      if (!ready) {
        hardhatProcess.kill();
        reject(new Error('Hardhat node failed to start'));
      }
    }, 120000); // 2 minute timeout for forking
  });
}

async function main() {
  const params = parseArgs();

  console.log('\n🔧 V3 Backtest Environment Setup');
  console.log(`   Chain: ${params.chain}`);
  console.log(`   Platform: ${PLATFORM}`);
  console.log(`   Tokens: ${params.tokens[0]}/${params.tokens[1]}`);
  console.log(`   Fee: ${params.fee}\n`);

  // Load events file
  const eventsData = loadEventsFile(
    params.chain,
    params.tokens[0],
    params.tokens[1],
    params.fee
  );

  console.log('📁 Loaded events file');
  console.log(`   Pool: ${eventsData.metadata.poolAddress}`);
  console.log(`   Events: ${eventsData.metadata.totalEvents}`);
  console.log(`   Start block: ${eventsData.metadata.startBlock}`);
  console.log(`   End block: ${eventsData.metadata.endBlock}\n`);

  // Start Hardhat forked at startBlock - 2 (we mine one block after to avoid hardfork issue)
  const forkBlock = eventsData.metadata.startBlock - 2;
  hardhatProcess = await startHardhat(forkBlock);

  // Connect to Hardhat
  const provider = new ethers.providers.JsonRpcProvider(HARDHAT_URL);

  // Mine one block to avoid hardfork history issue
  // See: https://github.com/NomicFoundation/hardhat/issues/5511
  await provider.send('hardhat_mine', ['0x1']);

  const currentBlock = await provider.getBlockNumber();
  console.log(`📍 Current block: ${currentBlock}\n`);

  // Derive wallet from the same mnemonic as hardhat.config.cjs
  // Must be a Wallet (not JsonRpcSigner) so deployer.address is available synchronously
  const mnemonic = 'debris coral coral sleep shed prison nation mountain fatigue prosper dose portion';
  const wallet = ethers.Wallet.fromMnemonic(mnemonic).connect(provider);
  const walletAddress = wallet.address;
  const signer = wallet;

  // Derive executor wallet (Hardhat account index 1)
  const executorWallet = ethers.Wallet.fromMnemonic(mnemonic, "m/44'/60'/0'/0/1").connect(provider);
  const executorAddress = executorWallet.address;

  // --- Deploy FUM contracts FIRST (nonce 0) for deterministic addresses ---
  // Addresses must match what's stored in fum_library so the automation service can find them
  console.log('📦 Deploying FUM contracts (deterministic addresses)...');
  initFumLibrary({
    alchemyApiKey: process.env.ALCHEMY_API_KEY,
    theGraphApiKey: process.env.THEGRAPH_API_KEY,
    arbiscanApiKey: process.env.ARBISCAN_API_KEY,
  });
  const deployment = await deployFUMContracts(signer);
  console.log(`   VaultFactory: ${deployment.addresses.VaultFactory}`);
  console.log(`   BabyStepsStrategy: ${deployment.addresses.BabyStepsStrategy}\n`);

  // --- Fund wallet with tokens (state cheats, no nonce consumed) ---
  console.log(`💰 Funding wallet: ${walletAddress}`);

  const token0 = getTokenConfig(params.tokens[0], params.chain);
  const token1 = getTokenConfig(params.tokens[1], params.chain);

  const token0Amount = 1000000000;
  const token1Amount = 1000000000;
  const ethAmount = 10000;

  console.log(`   Funding ${token0Amount} ${params.tokens[0]}...`);
  await fundWalletWithToken(provider, walletAddress, token0.address, token0Amount, token0.decimals);

  console.log(`   Funding ${token1Amount} ${params.tokens[1]}...`);
  await fundWalletWithToken(provider, walletAddress, token1.address, token1Amount, token1.decimals);

  console.log(`   Funding ${ethAmount} ETH for gas...`);
  await fundWalletWithETH(provider, walletAddress, ethAmount);

  // Verify balances
  const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function approve(address, uint256) returns (bool)',
    'function transfer(address, uint256) returns (bool)'
  ];
  const token0Contract = new ethers.Contract(token0.address, ERC20_ABI, provider);
  const token1Contract = new ethers.Contract(token1.address, ERC20_ABI, provider);

  const balance0 = await token0Contract.balanceOf(walletAddress);
  const balance1 = await token1Contract.balanceOf(walletAddress);
  const ethBalance = await provider.getBalance(walletAddress);

  console.log(`\n✅ Balances:`);
  console.log(`   ${params.tokens[0]}: ${ethers.utils.formatUnits(balance0, token0.decimals)}`);
  console.log(`   ${params.tokens[1]}: ${ethers.utils.formatUnits(balance1, token1.decimals)}`);
  console.log(`   ETH: ${ethers.utils.formatEther(ethBalance)}`);

  // --- Deploy PoolReplay contract (after FUM contracts, nonce doesn't matter) ---
  console.log('\n📦 Deploying PoolReplay contract...');
  const artifactPath = path.join(PROJECT_ROOT, 'artifacts/contracts/PoolReplay.sol/PoolReplay.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const poolReplay = await factory.deploy();
  await poolReplay.deployed();
  console.log(`   ✅ PoolReplay deployed at: ${poolReplay.address}`);

  // Approve PoolReplay for both tokens (max uint256)
  console.log('🔓 Approving tokens for PoolReplay...');
  const maxApproval = ethers.constants.MaxUint256;
  const token0WithSigner = token0Contract.connect(signer);
  const token1WithSigner = token1Contract.connect(signer);
  await token0WithSigner.approve(poolReplay.address, maxApproval);
  console.log(`   ✅ ${params.tokens[0]} approved`);
  await token1WithSigner.approve(poolReplay.address, maxApproval);
  console.log(`   ✅ ${params.tokens[1]} approved`);

  // --- Create vault ---
  console.log('\n🏦 Creating vault...');
  const vaultFactory = deployment.contracts.vaultFactory;
  const createTx = await vaultFactory.createVault('Backtest Vault');
  const createReceipt = await createTx.wait();

  // Parse VaultCreated event to get vault address
  const vaultCreatedEvent = createReceipt.events.find(e => e.event === 'VaultCreated');
  const vaultAddress = vaultCreatedEvent.args.vault;
  console.log(`   ✅ Vault created at: ${vaultAddress}`);

  // Get vault contract instance
  const vault = getVaultContract(vaultAddress, provider).connect(signer);

  // --- Mint V3 position ---
  console.log('\n🎯 Minting V3 position...');

  // Get current pool tick from slot0
  const poolAddress = eventsData.metadata.poolAddress;
  const POOL_ABI = ['function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint8, bool)'];
  const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
  const slot0 = await poolContract.slot0();
  const currentTick = slot0[1];
  console.log(`   Current tick: ${currentTick}`);

  // Calculate tick range (aggressive template = 300 bps = ~30 tick spacings each side)
  const tickSpacing = 10; // fee 500 → tickSpacing = 10
  const tickSpacingsEachSide = 30;
  const alignedTick = Math.floor(currentTick / tickSpacing) * tickSpacing;
  const tickLower = alignedTick - tickSpacing * tickSpacingsEachSide;
  const tickUpper = alignedTick + tickSpacing * tickSpacingsEachSide;
  console.log(`   Tick range: [${tickLower}, ${tickUpper}]`);

  // Get NonfungiblePositionManager address
  const platformAddresses = getPlatformAddresses(params.chain, PLATFORM);
  const positionManagerAddress = platformAddresses.positionManagerAddress;

  const POSITION_MANAGER_ABI = [
    'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
    'function safeTransferFrom(address from, address to, uint256 tokenId) external'
  ];
  const positionManager = new ethers.Contract(positionManagerAddress, POSITION_MANAGER_ABI, signer);

  // Sort token addresses for V3 (token0 < token1)
  let mintToken0, mintToken1, amount0Desired, amount1Desired;
  if (token0.address.toLowerCase() < token1.address.toLowerCase()) {
    mintToken0 = token0.address;
    mintToken1 = token1.address;
    amount0Desired = ethers.utils.parseUnits('3', token0.decimals);  // 3 WETH
    amount1Desired = ethers.utils.parseUnits('10000', token1.decimals); // 10,000 USDC
  } else {
    mintToken0 = token1.address;
    mintToken1 = token0.address;
    amount0Desired = ethers.utils.parseUnits('10000', token1.decimals); // 10,000 USDC
    amount1Desired = ethers.utils.parseUnits('3', token0.decimals);  // 3 WETH
  }

  // Approve position manager for both tokens
  await token0WithSigner.approve(positionManagerAddress, maxApproval);
  await token1WithSigner.approve(positionManagerAddress, maxApproval);

  // Use callStatic first to get tokenId
  const mintParams = {
    token0: mintToken0,
    token1: mintToken1,
    fee: params.fee,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min: 0,
    amount1Min: 0,
    recipient: walletAddress,
    deadline: ethers.constants.MaxUint256
  };

  const staticResult = await positionManager.callStatic.mint(mintParams);
  const tokenId = staticResult.tokenId;
  console.log(`   Position tokenId: ${tokenId}`);

  // Execute actual mint
  const mintTx = await positionManager.mint(mintParams);
  await mintTx.wait();
  console.log(`   ✅ Position minted`);

  // Transfer NFT to vault
  console.log('   Transferring NFT to vault...');
  const transferTx = await positionManager.safeTransferFrom(walletAddress, vaultAddress, tokenId);
  await transferTx.wait();
  console.log(`   ✅ NFT transferred to vault`);

  // --- Transfer loose tokens to vault for rebalancing ---
  console.log('\n💸 Transferring loose tokens to vault...');
  const looseWeth = ethers.utils.parseUnits('1', 18);       // 1 WETH
  const looseUsdc = ethers.utils.parseUnits('3000', 6);     // 3,000 USDC

  // Determine which contract is WETH and which is USDC
  if (token0.symbol === 'WETH') {
    await token0WithSigner.transfer(vaultAddress, looseWeth);
    await token1WithSigner.transfer(vaultAddress, looseUsdc);
  } else {
    await token1WithSigner.transfer(vaultAddress, looseWeth);
    await token0WithSigner.transfer(vaultAddress, looseUsdc);
  }
  console.log(`   ✅ Transferred 1 WETH + 3,000 USDC to vault`);

  // --- Configure vault ---
  console.log('\n⚙️  Configuring vault...');
  const strategyAddress = deployment.addresses.BabyStepsStrategy;
  const strategyContract = deployment.contracts.babySteps;

  // 1. Set strategy on vault
  await vault.setStrategy(strategyAddress);
  console.log(`   ✅ Strategy set`);

  // 2. Authorize vault on strategy (owner calls strategy directly)
  await strategyContract.authorizeVault(vaultAddress);
  console.log(`   ✅ Vault authorized on strategy`);

  // 3. Select aggressive template (3) via vault.execute
  const selectTemplateData = strategyContract.interface.encodeFunctionData('selectTemplate', [3]);
  await vault.execute([strategyAddress], [selectTemplateData]);
  console.log(`   ✅ Template set to aggressive (3)`);

  // 4. Set target tokens
  await vault.setTargetTokens(['WETH', 'USDC']);
  console.log(`   ✅ Target tokens set`);

  // 5. Set target platforms
  await vault.setTargetPlatforms([PLATFORM]);
  console.log(`   ✅ Target platforms set`);

  // 6. Set executor
  await vault.setExecutor(executorAddress);
  console.log(`   ✅ Executor set`);

  // --- Done ---
  console.log('\n🎉 Backtest environment ready!');
  console.log('   Hardhat is running at', HARDHAT_URL);
  console.log(`   VaultFactory: ${deployment.addresses.VaultFactory}`);
  console.log(`   BabyStepsStrategy: ${strategyAddress}`);
  console.log(`   PoolReplay: ${poolReplay.address}`);
  console.log(`   Vault: ${vaultAddress}`);
  console.log(`   Position tokenId: ${tokenId}`);
  console.log(`   Executor: ${executorAddress}`);
  console.log('   Press Ctrl+C to stop\n');

  // Keep process running until interrupted
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping Hardhat...');
    hardhatProcess.kill();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    hardhatProcess.kill();
    process.exit(0);
  });
}

let hardhatProcess = null;

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  if (hardhatProcess) {
    hardhatProcess.kill();
  }
  process.exit(1);
});
