/**
 * test/scripts/manipulate-price-avalanche.js
 *
 * NOTE: This script is for local Hardhat testing only
 *
 * Manipulates Trader Joe V2.2 pool prices on the Avalanche fork to push positions
 * out of range for testing rebalancing. Drains active bins to shift the active bin ID.
 * Uses hardhat_setStorageAt to mint tokens — no pool interaction for token acquisition.
 *
 * Default: WAVAX/USDC. With --token: USDC/USDT or USDC/AUSD.
 *
 * Each run drains NUM_BINS bins (default 2) in a single swap, landing solidly in the next bin.
 * WAVAX/USDC seed position range is ±10 bins, so 5 runs = 10 bins = out of range.
 *
 * Usage:
 *   npm run manipulate-price:av:up                  # WAVAX/USDC (default)
 *   npm run manipulate-price:av:down
 *   npm run manipulate-price:av:up -- --token=USDT  # USDC/USDT
 *   npm run manipulate-price:av:up -- --token=AUSD  # USDC/AUSD
 *
 * Directions (default WAVAX/USDC):
 *   up   - Buy WAVAX with USDC (pushes WAVAX price up)
 *   down - Sell WAVAX for USDC (pushes WAVAX price down)
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
// tokenX = lower address, tokenY = higher address (TJ convention)
const POOLS = {
  USDC: {
    // WAVAX/USDC — tokenX=WAVAX, tokenY=USDC
    address: '0x864d4e5ee7318e97483db7eb0912e09f161516ea',
    binStep: 10,
    version: 3,
    baseToken: { address: WAVAX_ADDRESS, decimals: 18, symbol: 'WAVAX' },
    quoteToken: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' },
    baseIsTokenX: true,
  },
  USDT: {
    // USDC/USDT — tokenX=USDT (lower addr), tokenY=USDC (higher addr)
    address: '0x2823299af89285ff1a1abf58db37ce57006fef5d',
    binStep: 1,
    version: 3,
    baseToken: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' },
    quoteToken: { address: USDT_ADDRESS, decimals: 6, symbol: 'USDT' },
    baseIsTokenX: false,
  },
  AUSD: {
    // USDC/AUSD — tokenX=AUSD (lower addr), tokenY=USDC (higher addr)
    address: '0x8573f98175d816d520248b5facf40d309b1c9cee',
    binStep: 1,
    version: 3,
    baseToken: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' },
    quoteToken: { address: AUSD_ADDRESS, decimals: 6, symbol: 'AUSD' },
    baseIsTokenX: false,
  },
};

// TJ LBRouter address (Avalanche)
const LB_ROUTER_ADDRESS = '0x18556DA13313f3532c54711497A8FedAC273220E';
const REFERENCE_BIN = 8388608; // 2^23

// Swap configuration
const CONFIG = {
  INITIAL_AVAX_FUNDING: '5000',
  NUM_BINS: 2,          // Bins to drain per run (2 bins × 0.1% = 0.2% per run for binStep=10)
  OVERSHOOT_PCT: 5,     // % of the landing bin's reserves to overshoot into it
};

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

const LB_PAIR_ABI = [
  'function getActiveId() external view returns (uint24)',
  'function getBin(uint24 id) external view returns (uint128 binReserveX, uint128 binReserveY)',
  'function getTokenX() external view returns (address)',
  'function getTokenY() external view returns (address)',
];

// =============================================================================
// Helpers
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  let direction = null;
  let token = 'USDC';

  for (const arg of args) {
    if (arg.startsWith('--direction=')) {
      direction = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--token=')) {
      token = arg.split('=')[1].toUpperCase();
    }
  }

  if (!direction || !['up', 'down'].includes(direction)) {
    console.error('Usage: node manipulate-price-avalanche.js --direction=<up|down> [--token=USDC|USDT|AUSD]');
    console.error('  up   - Buy base token (push price up)');
    console.error('  down - Sell base token (push price down)');
    process.exit(1);
  }

  if (!POOLS[token]) {
    console.error(`Unknown token: ${token}. Available: ${Object.keys(POOLS).join(', ')}`);
    process.exit(1);
  }

  return { direction, token };
}

function createDeadline(minutes = 20) {
  return Math.floor(Date.now() / 1000) + (minutes * 60);
}

/**
 * Compute human-readable price of base token in quote token terms.
 * TJ raw price = (1 + binStep/10000)^(binId - 2^23) gives price of tokenX in tokenY.
 */
function binIdToPrice(binId, binStep, poolConfig) {
  const rawPrice = Math.pow(1 + binStep / 10000, binId - REFERENCE_BIN);
  const tokenXDecimals = poolConfig.baseIsTokenX ? poolConfig.baseToken.decimals : poolConfig.quoteToken.decimals;
  const tokenYDecimals = poolConfig.baseIsTokenX ? poolConfig.quoteToken.decimals : poolConfig.baseToken.decimals;
  const adjustedPrice = rawPrice * Math.pow(10, tokenXDecimals - tokenYDecimals);

  // adjustedPrice = price of tokenX in tokenY. If base is tokenX, that's base/quote. Else invert.
  return poolConfig.baseIsTokenX ? adjustedPrice : 1 / adjustedPrice;
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
// Pool State
// =============================================================================

async function getPoolState(provider, poolConfig) {
  const pair = new ethers.Contract(poolConfig.address, LB_PAIR_ABI, provider);
  const activeId = await pair.getActiveId();
  const activeBin = await pair.getBin(activeId);
  const price = binIdToPrice(Number(activeId), poolConfig.binStep, poolConfig);

  return {
    activeId: Number(activeId),
    price,
    activeBinReserveX: activeBin.binReserveX,
    activeBinReserveY: activeBin.binReserveY,
  };
}

/**
 * Compute the input amount needed to drain NUM_BINS bins and land in the next one.
 *
 * To move price up (buy base):
 *   - If baseIsTokenX: buy X with Y → drains X from bins, active bin shifts up
 *     Input (Y) = sum of X reserves in bins N..N+(NUM_BINS-1) converted to Y, plus 5% of N+NUM_BINS's X reserve
 *   - If baseIsTokenY: buy Y with X → drains Y from bins, active bin shifts down
 *     Input (X) = sum of Y reserves converted to X, plus 5% of landing bin
 *
 * To move price down (sell base): mirror logic.
 */
async function computeSwapAmount(provider, poolConfig, activeId, direction) {
  const pair = new ethers.Contract(poolConfig.address, LB_PAIR_ABI, provider);
  const numBins = CONFIG.NUM_BINS;

  // Determine which direction bins shift and which reserve side gets drained
  // direction=up + baseIsTokenX → bin shifts UP (+), drain X side, input is Y
  // direction=up + !baseIsTokenX → bin shifts DOWN (-), drain Y side, input is X
  // direction=down + baseIsTokenX → bin shifts DOWN (-), drain Y side, input is X
  // direction=down + !baseIsTokenX → bin shifts UP (+), drain X side, input is Y
  const binShiftUp = (direction === 'up') === poolConfig.baseIsTokenX;
  const drainX = binShiftUp; // shifting up = draining X, shifting down = draining Y

  let totalInput = ethers.BigNumber.from(0);
  const binDetails = [];

  // Sum reserves across bins to drain
  for (let i = 0; i < numBins; i++) {
    const binId = binShiftUp ? activeId + i : activeId - i;
    const bin = await pair.getBin(binId);
    const drainReserve = drainX ? bin.binReserveX : bin.binReserveY;

    if (drainX) {
      // Draining X, input is Y. Convert X reserve to Y value using bin price.
      // price of X in Y = binIdToPrice (when baseIsTokenX, this is base/quote price)
      const priceXinY = Math.pow(1 + poolConfig.binStep / 10000, binId - REFERENCE_BIN)
        * Math.pow(10, poolConfig.baseIsTokenX
          ? poolConfig.baseToken.decimals - poolConfig.quoteToken.decimals
          : poolConfig.quoteToken.decimals - poolConfig.baseToken.decimals);
      const inputDecimals = poolConfig.baseIsTokenX ? poolConfig.quoteToken.decimals : poolConfig.baseToken.decimals;
      const drainDecimals = poolConfig.baseIsTokenX ? poolConfig.baseToken.decimals : poolConfig.quoteToken.decimals;

      const drainHuman = Number(ethers.utils.formatUnits(drainReserve, drainDecimals));
      const inputNeeded = drainHuman * priceXinY;
      totalInput = totalInput.add(
        ethers.utils.parseUnits(inputNeeded.toFixed(inputDecimals), inputDecimals)
      );
    } else {
      // Draining Y, input is X. Convert Y reserve to X value.
      const priceXinY = Math.pow(1 + poolConfig.binStep / 10000, binId - REFERENCE_BIN)
        * Math.pow(10, poolConfig.baseIsTokenX
          ? poolConfig.baseToken.decimals - poolConfig.quoteToken.decimals
          : poolConfig.quoteToken.decimals - poolConfig.baseToken.decimals);
      const inputDecimals = poolConfig.baseIsTokenX ? poolConfig.baseToken.decimals : poolConfig.quoteToken.decimals;
      const drainDecimals = poolConfig.baseIsTokenX ? poolConfig.quoteToken.decimals : poolConfig.baseToken.decimals;

      const drainHuman = Number(ethers.utils.formatUnits(drainReserve, drainDecimals));
      const inputNeeded = drainHuman / priceXinY;
      totalInput = totalInput.add(
        ethers.utils.parseUnits(inputNeeded.toFixed(inputDecimals), inputDecimals)
      );
    }

    binDetails.push({ binId, reserve: drainReserve });
  }

  // Add overshoot: 5% of the landing bin's drain-side reserve
  const landingBinId = binShiftUp ? activeId + numBins : activeId - numBins;
  const landingBin = await pair.getBin(landingBinId);
  const landingReserve = drainX ? landingBin.binReserveX : landingBin.binReserveY;

  if (!landingReserve.isZero()) {
    const overshoot = landingReserve.mul(CONFIG.OVERSHOOT_PCT).div(100);
    // Convert overshoot to input token
    if (drainX) {
      const priceXinY = Math.pow(1 + poolConfig.binStep / 10000, landingBinId - REFERENCE_BIN)
        * Math.pow(10, poolConfig.baseIsTokenX
          ? poolConfig.baseToken.decimals - poolConfig.quoteToken.decimals
          : poolConfig.quoteToken.decimals - poolConfig.baseToken.decimals);
      const inputDecimals = poolConfig.baseIsTokenX ? poolConfig.quoteToken.decimals : poolConfig.baseToken.decimals;
      const drainDecimals = poolConfig.baseIsTokenX ? poolConfig.baseToken.decimals : poolConfig.quoteToken.decimals;
      const overshootHuman = Number(ethers.utils.formatUnits(overshoot, drainDecimals));
      totalInput = totalInput.add(
        ethers.utils.parseUnits((overshootHuman * priceXinY).toFixed(inputDecimals), inputDecimals)
      );
    } else {
      const priceXinY = Math.pow(1 + poolConfig.binStep / 10000, landingBinId - REFERENCE_BIN)
        * Math.pow(10, poolConfig.baseIsTokenX
          ? poolConfig.baseToken.decimals - poolConfig.quoteToken.decimals
          : poolConfig.quoteToken.decimals - poolConfig.baseToken.decimals);
      const inputDecimals = poolConfig.baseIsTokenX ? poolConfig.baseToken.decimals : poolConfig.quoteToken.decimals;
      const drainDecimals = poolConfig.baseIsTokenX ? poolConfig.quoteToken.decimals : poolConfig.baseToken.decimals;
      const overshootHuman = Number(ethers.utils.formatUnits(overshoot, drainDecimals));
      totalInput = totalInput.add(
        ethers.utils.parseUnits((overshootHuman / priceXinY).toFixed(inputDecimals), inputDecimals)
      );
    }
  }

  return { amount: totalInput, binDetails, landingBinId };
}

function logPoolState(state, poolConfig, label) {
  const tokenXDecimals = poolConfig.baseIsTokenX ? poolConfig.baseToken.decimals : poolConfig.quoteToken.decimals;
  const tokenYDecimals = poolConfig.baseIsTokenX ? poolConfig.quoteToken.decimals : poolConfig.baseToken.decimals;
  const tokenXSymbol = poolConfig.baseIsTokenX ? poolConfig.baseToken.symbol : poolConfig.quoteToken.symbol;
  const tokenYSymbol = poolConfig.baseIsTokenX ? poolConfig.quoteToken.symbol : poolConfig.baseToken.symbol;

  console.log(`\n${label}`);
  console.log('='.repeat(50));
  console.log(`Pool: ${poolConfig.address}`);
  console.log(`Active Bin: ${state.activeId} (binStep=${poolConfig.binStep})`);
  console.log(`${poolConfig.baseToken.symbol}/${poolConfig.quoteToken.symbol}: ${state.price}`);
  console.log(`Active bin reserves: ${tokenXSymbol}=${ethers.utils.formatUnits(state.activeBinReserveX, tokenXDecimals)} ${tokenYSymbol}=${ethers.utils.formatUnits(state.activeBinReserveY, tokenYDecimals)}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const { direction, token } = parseArgs();
  const poolConfig = POOLS[token];
  const baseSymbol = poolConfig.baseToken.symbol;
  const quoteSymbol = poolConfig.quoteToken.symbol;
  const pctPerBin = poolConfig.binStep / 100; // binStep=10 → 0.1%, binStep=1 → 0.01%
  const targetPct = pctPerBin * CONFIG.NUM_BINS;

  console.log('='.repeat(60));
  console.log(`${baseSymbol}/${quoteSymbol} Price Manipulation (Trader Joe V2.2)`);
  console.log(`Direction: ${direction.toUpperCase()} (${direction === 'up' ? `buy ${baseSymbol}` : `sell ${baseSymbol}`})`);
  console.log(`Target: drain ${CONFIG.NUM_BINS} bins (~${targetPct.toFixed(2)}% price move)`);
  console.log('='.repeat(60));

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = ethers.Wallet.createRandom().connect(provider);
  console.log(`\nSwapper wallet: ${wallet.address}`);

  // Get initial pool state
  const initialState = await getPoolState(provider, poolConfig);
  logPoolState(initialState, poolConfig, 'INITIAL POOL STATE');

  // Fund wallet with AVAX for gas
  console.log('\n--- Funding Wallet ---');
  await provider.send('hardhat_setBalance', [
    wallet.address,
    ethers.utils.hexValue(ethers.utils.parseEther(CONFIG.INITIAL_AVAX_FUNDING))
  ]);
  console.log(`Funded with ${CONFIG.INITIAL_AVAX_FUNDING} AVAX`);

  // Determine input/output tokens
  const inputToken = direction === 'up' ? poolConfig.quoteToken : poolConfig.baseToken;
  const outputToken = direction === 'up' ? poolConfig.baseToken : poolConfig.quoteToken;

  // Compute swap amount
  const { amount: swapAmount, landingBinId } = await computeSwapAmount(
    provider, poolConfig, initialState.activeId, direction
  );
  const formattedAmount = ethers.utils.formatUnits(swapAmount, inputToken.decimals);

  console.log(`\nSwap: ${formattedAmount} ${inputToken.symbol} → ${outputToken.symbol}`);
  console.log(`Expected landing bin: ${landingBinId}`);

  // Mint tokens and approve
  console.log(`\nMinting ${formattedAmount} ${inputToken.symbol} via storage slot...`);
  await mintToken(provider, inputToken.address, wallet.address, swapAmount);

  const inputContract = new ethers.Contract(inputToken.address, ERC20_ABI, wallet);
  await (await inputContract.approve(LB_ROUTER_ADDRESS, ethers.constants.MaxUint256)).wait();

  // Execute single swap
  console.log('Executing swap...');
  const lbRouter = new ethers.Contract(LB_ROUTER_ADDRESS, LB_ROUTER_ABI, wallet);
  const path = {
    pairBinSteps: [poolConfig.binStep],
    versions: [poolConfig.version],
    tokenPath: [inputToken.address, outputToken.address]
  };

  await (await lbRouter.swapExactTokensForTokens(
    swapAmount, 0, path, wallet.address, createDeadline(),
    { gasLimit: 1000000 }
  )).wait();

  // Log final pool state
  const finalState = await getPoolState(provider, poolConfig);
  logPoolState(finalState, poolConfig, 'FINAL POOL STATE');

  const binDelta = finalState.activeId - initialState.activeId;
  const priceDelta = finalState.price - initialState.price;
  const pctChange = (priceDelta / initialState.price) * 100;
  console.log(`\nBin change: ${binDelta > 0 ? '+' : ''}${binDelta}`);
  console.log(`Price: ${initialState.price} → ${finalState.price}`);
  console.log(`Percent change: ${pctChange.toFixed(4)}%`);

  console.log('\nDone!');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
