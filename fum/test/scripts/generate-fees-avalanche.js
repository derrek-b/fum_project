/**
 * test/scripts/generate-fees-avalanche.js
 *
 * NOTE: This script is for local Hardhat testing only
 *
 * Generates trading fees on Trader Joe V2.2 positions by performing round-trip swaps.
 * Each round-trip (buy then sell) generates fees without net price movement.
 * Uses hardhat_setStorageAt to mint tokens — no pool interaction for token acquisition.
 *
 * Default: WAVAX/USDC. With --token: USDC/USDT or USDC/AUSD.
 *
 * Usage:
 *   npm run generate-fees:av                          # WAVAX/USDC (default)
 *   npm run generate-fees:av -- --token=USDT          # USDC/USDT
 *   npm run generate-fees:av -- --token=AUSD          # USDC/AUSD
 *   npm run generate-fees:av -- --swaps=20            # More round-trips
 *
 * Pools:
 *   (default) — WAVAX/USDC binStep=10 (0x864d4e5ee7318e97483db7eb0912e09f161516ea)
 *   USDT      — USDC/USDT  binStep=1  (0x2823299af89285ff1a1abf58db37ce57006fef5d)
 *   AUSD      — USDC/AUSD  binStep=1  (0x8573f98175d816d520248b5facf40d309b1c9cee)
 */

import { ethers } from 'ethers';

// =============================================================================
// Configuration
// =============================================================================

const RPC_URL = 'http://localhost:8546';
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Hardhat account #0

// Token addresses (Avalanche)
const WAVAX_ADDRESS = '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7';
const USDC_ADDRESS = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const USDT_ADDRESS = '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7';
const AUSD_ADDRESS = '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a';

// ERC20 balance storage slots
const TOKEN_BALANCE_SLOTS = {
  [WAVAX_ADDRESS.toLowerCase()]: 3,
  [USDC_ADDRESS.toLowerCase()]: 9,
  [USDT_ADDRESS.toLowerCase()]: 51,
};

// AUSD uses ERC-7201 namespaced storage
const AUSD_ERC7201_BASE_SLOT = '0x455730fed596673e69db1907be2e521374ba893f1a04cc5f5dd931616cd6b700';

// Pool configurations
const POOLS = {
  USDC: {
    address: '0x864d4e5ee7318e97483db7eb0912e09f161516ea',
    binStep: 10,
    version: 3,
    tokenA: { address: WAVAX_ADDRESS, decimals: 18, symbol: 'WAVAX' },
    tokenB: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' },
    // Swap WAVAX per leg (leg 1: WAVAX→USDC, leg 2: USDC→WAVAX)
    swapAmountA: '10', // 10 WAVAX per leg (~$100 at $10 AVAX)
  },
  USDT: {
    address: '0x2823299af89285ff1a1abf58db37ce57006fef5d',
    binStep: 1,
    version: 3,
    tokenA: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' },
    tokenB: { address: USDT_ADDRESS, decimals: 6, symbol: 'USDT' },
    swapAmountA: '1000', // 1000 USDC per leg
  },
  AUSD: {
    address: '0x8573f98175d816d520248b5facf40d309b1c9cee',
    binStep: 1,
    version: 3,
    tokenA: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' },
    tokenB: { address: AUSD_ADDRESS, decimals: 6, symbol: 'AUSD' },
    swapAmountA: '1000', // 1000 USDC per leg
  },
};

// TJ LBRouter address (Avalanche)
const LB_ROUTER_ADDRESS = '0x18556DA13313f3532c54711497A8FedAC273220E';

// =============================================================================
// ABIs
// =============================================================================

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address owner) external view returns (uint256)',
];

const LB_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) external returns (uint256 amountOut)',
];

// =============================================================================
// Helpers
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  let numSwaps = 5;
  let token = 'USDC'; // Default = WAVAX/USDC pool

  for (const arg of args) {
    if (arg.startsWith('--swaps=')) {
      numSwaps = parseInt(arg.split('=')[1], 10);
      if (isNaN(numSwaps) || numSwaps < 1) {
        console.error('Invalid --swaps value. Using default of 5.');
        numSwaps = 5;
      }
    } else if (arg.startsWith('--token=')) {
      token = arg.split('=')[1].toUpperCase();
    }
  }

  if (!POOLS[token]) {
    console.error(`Unknown token: ${token}. Available: ${Object.keys(POOLS).join(', ')}`);
    process.exit(1);
  }

  return { numSwaps, token };
}

function createDeadline(minutes = 20) {
  return Math.floor(Date.now() / 1000) + (minutes * 60);
}

/**
 * Mint ERC20 tokens directly into a wallet using hardhat_setStorageAt.
 */
async function mintToken(provider, tokenAddress, walletAddress, amountBN) {
  if (tokenAddress.toLowerCase() === AUSD_ADDRESS.toLowerCase()) {
    return mintAUSD(provider, walletAddress, amountBN);
  }

  const slot = TOKEN_BALANCE_SLOTS[tokenAddress.toLowerCase()];
  if (slot === undefined) {
    throw new Error(`No storage slot found for token ${tokenAddress}`);
  }

  const storageSlot = ethers.utils.solidityKeccak256(
    ['uint256', 'uint256'],
    [walletAddress, slot]
  );

  await provider.send('hardhat_setStorageAt', [
    tokenAddress,
    storageSlot,
    ethers.utils.hexZeroPad(amountBN.toHexString(), 32)
  ]);
}

/**
 * Mint AUSD using ERC-7201 namespaced storage.
 * AUSD packs uint248 balance with bool isFrozen: (balance << 8) | isFrozen
 */
async function mintAUSD(provider, walletAddress, amountBN) {
  const storageSlot = ethers.utils.solidityKeccak256(
    ['uint256', 'uint256'],
    [walletAddress, AUSD_ERC7201_BASE_SLOT]
  );

  const packed = amountBN.shl(8);

  await provider.send('hardhat_setStorageAt', [
    AUSD_ADDRESS,
    storageSlot,
    ethers.utils.hexZeroPad(packed.toHexString(), 32)
  ]);
}

// =============================================================================
// Fee Generation
// =============================================================================

async function generateFees(wallet, numSwaps, poolConfig) {
  const { tokenA, tokenB, swapAmountA, binStep, version } = poolConfig;
  const swapAmount = ethers.utils.parseUnits(swapAmountA, tokenA.decimals);
  const feePercent = (binStep === 1 ? 0.01 : binStep * 0.1 / 100);

  console.log(`Pool: ${tokenA.symbol}/${tokenB.symbol} (binStep=${binStep})`);
  console.log(`Swap amount: ${swapAmountA} ${tokenA.symbol} per leg\n`);

  const tokenAContract = new ethers.Contract(tokenA.address, ERC20_ABI, wallet);
  const tokenBContract = new ethers.Contract(tokenB.address, ERC20_ABI, wallet);
  const lbRouter = new ethers.Contract(LB_ROUTER_ADDRESS, LB_ROUTER_ABI, wallet);

  // Mint tokenA via storage slot
  const mintAmount = swapAmount.mul(numSwaps + 2);
  console.log(`Minting ${ethers.utils.formatUnits(mintAmount, tokenA.decimals)} ${tokenA.symbol} via storage slot...`);
  await mintToken(wallet.provider, tokenA.address, wallet.address, mintAmount);

  // Approve router for both tokens
  console.log('Approving tokens for LBRouter...');
  await (await tokenAContract.approve(LB_ROUTER_ADDRESS, ethers.constants.MaxUint256)).wait();
  await (await tokenBContract.approve(LB_ROUTER_ADDRESS, ethers.constants.MaxUint256)).wait();

  const startingA = await tokenAContract.balanceOf(wallet.address);
  const startingB = await tokenBContract.balanceOf(wallet.address);

  const pathForward = {
    pairBinSteps: [binStep],
    versions: [version],
    tokenPath: [tokenA.address, tokenB.address]
  };

  const pathReverse = {
    pairBinSteps: [binStep],
    versions: [version],
    tokenPath: [tokenB.address, tokenA.address]
  };

  console.log(`\n=== Performing ${numSwaps} round-trip swaps ===`);

  for (let i = 0; i < numSwaps; i++) {
    try {
      console.log(`\n--- Round-trip ${i + 1}/${numSwaps} ---`);

      // Leg 1: tokenA → tokenB
      console.log(`  ${tokenA.symbol} -> ${tokenB.symbol} (${swapAmountA} ${tokenA.symbol})...`);
      const bBefore = await tokenBContract.balanceOf(wallet.address);
      await (await lbRouter.swapExactTokensForTokens(
        swapAmount, 0, pathForward, wallet.address, createDeadline(),
        { gasLimit: 500000 }
      )).wait();
      const bAfter = await tokenBContract.balanceOf(wallet.address);
      const received = bAfter.sub(bBefore);
      console.log(`  Received ${ethers.utils.formatUnits(received, tokenB.decimals)} ${tokenB.symbol}`);

      await new Promise(r => setTimeout(r, 500));

      // Leg 2: tokenB → tokenA (swap back what we received)
      console.log(`  ${tokenB.symbol} -> ${tokenA.symbol} (${ethers.utils.formatUnits(received, tokenB.decimals)} ${tokenB.symbol})...`);
      await (await lbRouter.swapExactTokensForTokens(
        received, 0, pathReverse, wallet.address, createDeadline(),
        { gasLimit: 500000 }
      )).wait();
      console.log(`  Round-trip complete`);

    } catch (error) {
      console.error(`  Error in round-trip ${i + 1}:`, error.message);
    }

    if (i < numSwaps - 1) await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  const finalA = await tokenAContract.balanceOf(wallet.address);
  const finalB = await tokenBContract.balanceOf(wallet.address);
  const swapAmountNum = parseFloat(swapAmountA);
  const totalVolume = swapAmountNum * 2 * numSwaps;
  const approxFees = totalVolume * feePercent;

  console.log('\n=== Summary ===');
  console.log(`${tokenA.symbol}: ${ethers.utils.formatUnits(startingA, tokenA.decimals)} → ${ethers.utils.formatUnits(finalA, tokenA.decimals)} (${ethers.utils.formatUnits(finalA.sub(startingA), tokenA.decimals)})`);
  console.log(`${tokenB.symbol}: ${ethers.utils.formatUnits(startingB, tokenB.decimals)} → ${ethers.utils.formatUnits(finalB, tokenB.decimals)}`);

  // For WAVAX/USDC, express volume in USD terms
  if (tokenA.symbol === 'WAVAX') {
    const avaxPrice = 20; // rough estimate
    const usdVolume = swapAmountNum * avaxPrice * 2 * numSwaps;
    console.log(`Volume: ~$${usdVolume.toLocaleString()} (${numSwaps} round-trips x 2 x ${swapAmountA} WAVAX x ~$${avaxPrice})`);
  } else {
    console.log(`Volume: ~$${totalVolume.toLocaleString()} (${numSwaps} round-trips x 2 x $${swapAmountA})`);
  }
  console.log(`Approximate fees generated: ~$${approxFees.toFixed(2)}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const { numSwaps, token } = parseArgs();
  const poolConfig = POOLS[token];

  console.log('='.repeat(60));
  console.log(`Fee Generation Script (Trader Joe V2.2 — Avalanche)`);
  console.log('='.repeat(60));

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Using wallet: ${wallet.address}`);

  // Fund with AVAX for gas
  const avaxBalance = await provider.getBalance(wallet.address);
  if (avaxBalance.lt(ethers.utils.parseEther('10'))) {
    console.log('Funding wallet with AVAX for gas...');
    await provider.send('hardhat_setBalance', [
      wallet.address, ethers.utils.hexValue(ethers.utils.parseEther('100'))
    ]);
  }

  await generateFees(wallet, numSwaps, poolConfig);

  console.log('\n=== Fee generation complete ===');
  console.log('Your Trader Joe liquidity positions should now have accrued fees.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
