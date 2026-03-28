/**
 * test/scripts/generate-fees.js
 *
 * NOTE: This script is for local Hardhat testing only
 *
 * Generates trading fees on liquidity positions by performing round-trip swaps.
 * Each round-trip (buy then sell) generates fees without net price movement.
 * Uses hardhat_setStorageAt to mint tokens — no pool interaction for token acquisition.
 *
 * Default: WETH/USDC (V3) or ETH/USDC (V4) — matches seed script positions.
 * With --token: swaps against WETH (V3) or ETH (V4) paired pools.
 *
 * Usage:
 *   npm run generate-fees                          # V3 WETH/USDC (default)
 *   npm run generate-fees:usdt                     # V3 WETH/USDT
 *   npm run generate-fees:wbtc                     # V3 WETH/WBTC 0.05%
 *   npm run generate-fees:link                     # V3 WETH/LINK 0.3%
 *   npm run generate-fees:v4                       # V4 ETH/USDC
 *   npm run generate-fees -- --platform=v4 --token=LINK  # V4 ETH/LINK 0.3%
 *   npm run generate-fees -- --swaps=20            # More round-trips
 *
 * Token pools:
 *   WETH (default) — WETH/USDC 0.05% (V3) or ETH/USDC 0.05% (V4)
 *   USDT           — WETH/USDT 0.05% (V3) or ETH/USDT 0.05% (V4)
 *   WBTC           — WETH/WBTC 0.05% (V3) or ETH/WBTC 0.05% (V4)
 *   LINK           — WETH/LINK 0.30% (V3) or ETH/LINK 0.30% (V4)
 */

import { ethers } from 'ethers';

// =============================================================================
// Configuration
// =============================================================================

const RPC_URL = 'http://localhost:8545';
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Hardhat account #0

// Token addresses (Arbitrum fork)
const NATIVE_ETH = ethers.constants.AddressZero;
const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const WBTC_ADDRESS = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f';
const LINK_ADDRESS = '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4';

// ERC20 balance storage slots (auto-discovered by backtest/discover-slots.js)
const TOKEN_BALANCE_SLOTS = {
  [USDC_ADDRESS.toLowerCase()]: 9,
  [WBTC_ADDRESS.toLowerCase()]: 51,
  [WETH_ADDRESS.toLowerCase()]: 51,
  [LINK_ADDRESS.toLowerCase()]: 51,
  [USDT_ADDRESS.toLowerCase()]: 51,
};

// Token metadata and pool configuration
const TOKENS = {
  WETH: {
    address: WETH_ADDRESS, decimals: 18, symbol: 'WETH',
    quoteAddress: USDC_ADDRESS, quoteSymbol: 'USDC', quoteDecimals: 6,
    fee: 500, swapAmountEth: '1',
  },
  USDT: {
    address: USDT_ADDRESS, decimals: 6, symbol: 'USDT',
    quoteAddress: USDT_ADDRESS, quoteSymbol: 'USDT', quoteDecimals: 6,
    fee: 500, swapAmountEth: '1',
  },
  WBTC: {
    address: WBTC_ADDRESS, decimals: 8, symbol: 'WBTC',
    quoteAddress: WBTC_ADDRESS, quoteSymbol: 'WBTC', quoteDecimals: 8,
    fee: 500, swapAmountEth: '1',
  },
  LINK: {
    address: LINK_ADDRESS, decimals: 18, symbol: 'LINK',
    quoteAddress: LINK_ADDRESS, quoteSymbol: 'LINK', quoteDecimals: 18,
    fee: 3000, swapAmountEth: '1',
  }
};

// V3 addresses
const V3_SWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';

// V4 addresses
const UNIVERSAL_ROUTER = '0xa51afafe0263b40edaef0df8781ea9aa03e381a3';
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// V4 action types
const Actions = {
  SWAP_EXACT_IN_SINGLE: 6,
  SETTLE: 11,
  TAKE: 14
};

const POOL_KEY_STRUCT = '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const SWAP_EXACT_IN_SINGLE_STRUCT = `(${POOL_KEY_STRUCT} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`;

// =============================================================================
// ABIs
// =============================================================================

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address owner) external view returns (uint256)',
];

const V3_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)'
];

const PERMIT2_ABI = [
  'function approve(address token, address spender, uint160 amount, uint48 expiration) external'
];

// =============================================================================
// Helpers
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  let numSwaps = 5;
  let targetToken = 'WETH';
  let fee = null;
  let platform = 'v3';

  for (const arg of args) {
    if (arg.startsWith('--swaps=')) {
      numSwaps = parseInt(arg.split('=')[1], 10);
      if (isNaN(numSwaps) || numSwaps < 1) {
        console.error('Invalid --swaps value. Using default of 5.');
        numSwaps = 5;
      }
    } else if (arg.startsWith('--token=')) {
      targetToken = arg.split('=')[1].toUpperCase();
    } else if (arg.startsWith('--fee=')) {
      fee = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--platform=')) {
      platform = arg.split('=')[1].toLowerCase();
    }
  }

  if (!['v3', 'v4'].includes(platform)) {
    console.error('Invalid platform. Must be v3 or v4.');
    process.exit(1);
  }

  return { numSwaps, targetToken, fee, platform };
}

function createDeadline(minutes = 20) {
  return Math.floor(Date.now() / 1000) + (minutes * 60);
}

function buildV4PoolKey(currency0, currency1, fee) {
  const sorted = currency0.toLowerCase() < currency1.toLowerCase();
  const tickSpacing = fee === 3000 ? 60 : 10;
  return {
    currency0: sorted ? currency0 : currency1,
    currency1: sorted ? currency1 : currency0,
    fee,
    tickSpacing,
    hooks: ethers.constants.AddressZero
  };
}

/**
 * Mint ERC20 tokens directly into a wallet using hardhat_setStorageAt.
 */
async function mintToken(provider, tokenAddress, walletAddress, amountBN) {
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

// =============================================================================
// V4 Swap
// =============================================================================

async function executeV4Swap(signer, poolKey, tokenIn, tokenOut, amountIn) {
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

  const commands = ethers.utils.hexlify([0x10]);
  const routerInterface = new ethers.utils.Interface([
    'function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable'
  ]);
  const calldata = routerInterface.encodeFunctionData('execute', [
    commands, [v4SwapPayload], createDeadline()
  ]);

  const isNativeIn = tokenIn === NATIVE_ETH;
  const tx = await signer.sendTransaction({
    to: UNIVERSAL_ROUTER,
    data: calldata,
    value: isNativeIn ? amountInBN : 0
  });
  return tx.wait();
}

// =============================================================================
// V3 Fee Generation
// =============================================================================

async function generateFeesV3(wallet, numSwaps, targetSymbol, feeOverride) {
  const token = TOKENS[targetSymbol];
  if (!token) {
    console.error(`Unknown token: ${targetSymbol}. Available: ${Object.keys(TOKENS).join(', ')}`);
    process.exit(1);
  }

  const isBasePair = targetSymbol === 'WETH';
  const poolFee = feeOverride || token.fee;
  const poolFeePercent = (poolFee / 10000).toFixed(2);
  const ethPerLeg = token.swapAmountEth;
  const wethSwapAmount = ethers.utils.parseEther(ethPerLeg);

  // For WETH token: pair is WETH/USDC. For others: pair is WETH/TOKEN.
  const pairTokenAddress = isBasePair ? USDC_ADDRESS : token.address;
  const pairTokenSymbol = isBasePair ? 'USDC' : token.symbol;
  const pairTokenDecimals = isBasePair ? 6 : token.decimals;

  console.log(`Pool: WETH/${pairTokenSymbol} ${poolFeePercent}%`);
  console.log(`Swap amount: ${ethPerLeg} WETH per leg\n`);

  const wethContract = new ethers.Contract(WETH_ADDRESS, ERC20_ABI, wallet);
  const pairContract = new ethers.Contract(pairTokenAddress, ERC20_ABI, wallet);
  const router = new ethers.Contract(V3_SWAP_ROUTER, V3_ROUTER_ABI, wallet);

  // Mint WETH via storage slot
  const wethNeeded = wethSwapAmount.mul(numSwaps + 2);
  console.log(`Minting ${ethers.utils.formatEther(wethNeeded)} WETH via storage slot...`);
  await mintToken(wallet.provider, WETH_ADDRESS, wallet.address, wethNeeded);

  // Approve router for both tokens
  console.log('Approving tokens...');
  await (await wethContract.approve(V3_SWAP_ROUTER, ethers.constants.MaxUint256)).wait();
  await (await pairContract.approve(V3_SWAP_ROUTER, ethers.constants.MaxUint256)).wait();

  const startingWeth = await wethContract.balanceOf(wallet.address);
  const startingPair = await pairContract.balanceOf(wallet.address);

  console.log(`\n=== Performing ${numSwaps} round-trip swaps ===`);

  for (let i = 0; i < numSwaps; i++) {
    try {
      console.log(`\n--- Round-trip ${i + 1}/${numSwaps} ---`);

      // Leg 1: WETH → pair token
      console.log(`  WETH -> ${pairTokenSymbol} (${ethPerLeg} WETH)...`);
      const pairBefore = await pairContract.balanceOf(wallet.address);
      await (await router.exactInputSingle({
        tokenIn: WETH_ADDRESS, tokenOut: pairTokenAddress, fee: poolFee,
        recipient: wallet.address, deadline: createDeadline(),
        amountIn: wethSwapAmount, amountOutMinimum: 0, sqrtPriceLimitX96: 0
      }, { gasLimit: 500000 })).wait();
      const pairAfter = await pairContract.balanceOf(wallet.address);
      const received = pairAfter.sub(pairBefore);
      console.log(`  Received ${ethers.utils.formatUnits(received, pairTokenDecimals)} ${pairTokenSymbol}`);

      await new Promise(r => setTimeout(r, 500));

      // Leg 2: pair token → WETH (swap back what we received)
      console.log(`  ${pairTokenSymbol} -> WETH (${ethers.utils.formatUnits(received, pairTokenDecimals)} ${pairTokenSymbol})...`);
      await (await router.exactInputSingle({
        tokenIn: pairTokenAddress, tokenOut: WETH_ADDRESS, fee: poolFee,
        recipient: wallet.address, deadline: createDeadline(),
        amountIn: received, amountOutMinimum: 0, sqrtPriceLimitX96: 0
      }, { gasLimit: 500000 })).wait();
      console.log(`  Round-trip complete`);

    } catch (error) {
      console.error(`  Error in round-trip ${i + 1}:`, error.message);
    }

    if (i < numSwaps - 1) await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  const finalWeth = await wethContract.balanceOf(wallet.address);
  const finalPair = await pairContract.balanceOf(wallet.address);
  const ethValue = parseFloat(ethPerLeg) * 3000;
  const totalVolume = ethValue * 2 * numSwaps;
  const approxFees = totalVolume * (poolFee / 1000000);

  console.log('\n=== Summary ===');
  console.log(`WETH: ${ethers.utils.formatEther(startingWeth)} → ${ethers.utils.formatEther(finalWeth)} (${ethers.utils.formatEther(finalWeth.sub(startingWeth))})`);
  console.log(`${pairTokenSymbol}: ${ethers.utils.formatUnits(startingPair, pairTokenDecimals)} → ${ethers.utils.formatUnits(finalPair, pairTokenDecimals)}`);
  console.log(`Volume: ~$${totalVolume.toLocaleString()} (${numSwaps} round-trips x 2 x ~$${ethValue.toLocaleString()})`);
  console.log(`Approximate fees generated: ~$${approxFees.toFixed(2)} (${poolFeePercent}% fee tier)`);
}

// =============================================================================
// V4 Fee Generation
// =============================================================================

async function generateFeesV4(wallet, numSwaps, targetSymbol, feeOverride) {
  const token = TOKENS[targetSymbol];
  if (!token) {
    console.error(`Unknown token: ${targetSymbol}. Available: ${Object.keys(TOKENS).join(', ')}`);
    process.exit(1);
  }

  const isBasePair = targetSymbol === 'WETH';
  const poolFee = feeOverride || token.fee;
  const poolFeePercent = (poolFee / 10000).toFixed(2);
  const ethPerLeg = token.swapAmountEth;
  const ethSwapAmount = ethers.utils.parseEther(ethPerLeg);

  // For WETH token: pair is ETH/USDC. For others: pair is ETH/TOKEN.
  const pairTokenAddress = isBasePair ? USDC_ADDRESS : token.address;
  const pairTokenSymbol = isBasePair ? 'USDC' : token.symbol;
  const pairTokenDecimals = isBasePair ? 6 : token.decimals;

  const poolKey = buildV4PoolKey(NATIVE_ETH, pairTokenAddress, poolFee);

  console.log(`Pool: ETH/${pairTokenSymbol} ${poolFeePercent}% (V4)`);
  console.log(`Swap amount: ${ethPerLeg} ETH per leg\n`);

  const pairContract = new ethers.Contract(pairTokenAddress, ERC20_ABI, wallet);

  // Ensure wallet has enough ETH
  const ethNeeded = ethSwapAmount.mul(numSwaps + 5);
  const ethBalance = await wallet.provider.getBalance(wallet.address);
  if (ethBalance.lt(ethNeeded)) {
    console.log('Funding wallet with ETH...');
    await wallet.provider.send('hardhat_setBalance', [
      wallet.address, ethers.utils.hexValue(ethers.utils.parseEther('1000'))
    ]);
  }

  // Setup Permit2 for pair token → Universal Router (needed for leg 2)
  console.log(`Setting up Permit2 approvals for ${pairTokenSymbol}...`);
  await (await pairContract.approve(PERMIT2_ADDRESS, ethers.constants.MaxUint256)).wait();
  const permit2 = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, wallet);
  const maxAmount = ethers.BigNumber.from(2).pow(160).sub(1);
  const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  await (await permit2.approve(pairTokenAddress, UNIVERSAL_ROUTER, maxAmount, expiration)).wait();

  const startingEth = await wallet.provider.getBalance(wallet.address);
  const startingPair = await pairContract.balanceOf(wallet.address);

  console.log(`\n=== Performing ${numSwaps} round-trip swaps ===`);

  for (let i = 0; i < numSwaps; i++) {
    try {
      console.log(`\n--- Round-trip ${i + 1}/${numSwaps} ---`);

      // Leg 1: ETH → pair token
      const pairBefore = await pairContract.balanceOf(wallet.address);
      console.log(`  ETH -> ${pairTokenSymbol} (${ethPerLeg} ETH)...`);
      await executeV4Swap(wallet, poolKey, NATIVE_ETH, pairTokenAddress, ethSwapAmount);
      const pairAfter = await pairContract.balanceOf(wallet.address);
      const received = pairAfter.sub(pairBefore);
      console.log(`  Received ${ethers.utils.formatUnits(received, pairTokenDecimals)} ${pairTokenSymbol}`);

      await new Promise(r => setTimeout(r, 500));

      // Leg 2: pair token → ETH (swap back what we received)
      console.log(`  ${pairTokenSymbol} -> ETH (${ethers.utils.formatUnits(received, pairTokenDecimals)} ${pairTokenSymbol})...`);
      await executeV4Swap(wallet, poolKey, pairTokenAddress, NATIVE_ETH, received);
      console.log(`  Round-trip complete`);

    } catch (error) {
      console.error(`  Error in round-trip ${i + 1}:`, error.message);
    }

    if (i < numSwaps - 1) await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  const finalEth = await wallet.provider.getBalance(wallet.address);
  const finalPair = await pairContract.balanceOf(wallet.address);
  const ethValue = parseFloat(ethPerLeg) * 3000;
  const totalVolume = ethValue * 2 * numSwaps;
  const approxFees = totalVolume * (poolFee / 1000000);

  console.log('\n=== Summary ===');
  console.log(`ETH: ${ethers.utils.formatEther(startingEth)} → ${ethers.utils.formatEther(finalEth)}`);
  console.log(`${pairTokenSymbol}: ${ethers.utils.formatUnits(startingPair, pairTokenDecimals)} → ${ethers.utils.formatUnits(finalPair, pairTokenDecimals)}`);
  console.log(`Volume: ~$${totalVolume.toLocaleString()} (${numSwaps} round-trips x 2 x ~$${ethValue.toLocaleString()})`);
  console.log(`Approximate fees generated: ~$${approxFees.toFixed(2)} (${poolFeePercent}% fee tier)`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const { numSwaps, targetToken, fee, platform } = parseArgs();

  console.log('='.repeat(60));
  console.log(`Fee Generation Script (${platform.toUpperCase()})`);
  console.log('='.repeat(60));

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Using wallet: ${wallet.address}`);

  if (platform === 'v4') {
    await generateFeesV4(wallet, numSwaps, targetToken, fee);
  } else {
    await generateFeesV3(wallet, numSwaps, targetToken, fee);
  }

  console.log('\n=== Fee generation complete ===');
  console.log('Your liquidity positions should now have accrued fees.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
