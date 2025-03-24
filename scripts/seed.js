// seed.js - Script to create a test Uniswap V3 liquidity position

// Import required libraries
const { ethers } = require('ethers');
const { Token, CurrencyAmount } = require('@uniswap/sdk-core');
const { Pool, Position, NonfungiblePositionManager, TickMath } = require('@uniswap/v3-sdk');
const JSBI = require('jsbi');
const IUniswapV3PoolABI = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json').abi;
const NonfungiblePositionManagerABI = require('@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json').abi;
const ERC20ABI = require('@openzeppelin/contracts/build/contracts/ERC20.json').abi;
// const fs = require('fs');
// const path = require('path');

// Define config directly for local fork of Arbitrum
const config = {
  chains: {
    arbitrum: {
      chainId: 1337, // Local chainId for test environment
      rpcUrl: "http://localhost:8545", // Using local fork of Arbitrum
      name: "Local Arbitrum Fork",
      platforms: {
        uniswapV3: {
          name: "Uniswap V3",
          factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984", // Arbitrum Uniswap V3 factory
          positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", // Arbitrum Uniswap V3 NonfungiblePositionManager
        },
      },
    },
  },
};

// Function to perform multiple swaps to generate fees with nonce management
async function performSwapsToGenerateFees(wallet, numSwaps = 10) {
  console.log(`\n--- Performing ${numSwaps} swaps to generate fees ---`);

  // Setup contracts and addresses
  const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
  const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
  const UNISWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564';

  // Contract setup
  const wethContract = new ethers.Contract(
    WETH_ADDRESS,
    ['function approve(address spender, uint256 amount) external returns (bool)'],
    wallet
  );

  const usdcContract = new ethers.Contract(
    USDC_ADDRESS,
    ['function approve(address spender, uint256 amount) external returns (bool)'],
    wallet
  );

  const ROUTER_ABI = [
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)'
  ];

  const router = new ethers.Contract(
    UNISWAP_ROUTER_ADDRESS,
    ROUTER_ABI,
    wallet
  );

  // Get the current nonce and provider
  const provider = wallet.provider;
  let currentNonce = await provider.getTransactionCount(wallet.address);
  console.log(`Starting with nonce: ${currentNonce}`);

  // Approve router to spend tokens (with explicit nonce)
  console.log('Approving router to spend WETH...');
  const approveTx1 = await wethContract.approve(
    UNISWAP_ROUTER_ADDRESS,
    ethers.parseEther('5000'),
    { nonce: currentNonce++ }
  );
  await approveTx1.wait();
  console.log('WETH approval confirmed');

  console.log('Approving router to spend USDC...');
  const approveTx2 = await usdcContract.approve(
    UNISWAP_ROUTER_ADDRESS,
    ethers.parseUnits('5000000', 6),
    { nonce: currentNonce++ }
  );
  await approveTx2.wait();
  console.log('USDC approval confirmed');

  // Reset nonce after approvals in case anything changed
  currentNonce = await provider.getTransactionCount(wallet.address);
  console.log(`Nonce after approvals: ${currentNonce}`);

  // Perform alternating swaps
  for (let i = 0; i < numSwaps; i++) {
    try {
      // Re-check nonce before each swap to ensure we're in sync
      currentNonce = await provider.getTransactionCount(wallet.address);

      const isWethToUsdc = i % 2 === 0;
      const tokenIn = isWethToUsdc ? WETH_ADDRESS : USDC_ADDRESS;
      const tokenOut = isWethToUsdc ? USDC_ADDRESS : WETH_ADDRESS;
      const amountIn = isWethToUsdc ?
        ethers.parseEther('2') : // 0.1 WETH
        ethers.parseUnits('3800', 6); // 100 USDC

      console.log(`Swap ${i+1}/${numSwaps}: ${isWethToUsdc ? 'WETH → USDC' : 'USDC → WETH'} (nonce: ${currentNonce})`);

      // Setup swap parameters
      const params = {
        tokenIn,
        tokenOut,
        fee: 500, // 0.05%
        recipient: wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes
        amountIn,
        amountOutMinimum: 0, // No minimum for testing
        sqrtPriceLimitX96: 0 // No price limit
      };

      // Execute swap with explicit nonce
      const tx = await router.exactInputSingle(
        params,
        { nonce: currentNonce }
      );

      console.log(`  Swap transaction sent: ${tx.hash}`);

      // Wait for the transaction to be mined
      await tx.wait();
      console.log(`  Swap confirmed`);

      // Small delay to give the node time to update its state (optional)
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.error(`Error in swap ${i+1}:`, error.message);
      // Continue with the next swap even if one fails
    }
  }

  console.log('Swap operations completed');
}

// Function to calculate uncollected fees (similar to our positionHelpers.js)
async function calculateUncollectedFees(wallet, positionId, positionManagerAddress, poolAddress, token0, token1, verbose = true) {
  console.log(`\n--- Calculating uncollected fees for position #${positionId} ---`);

  // Create contract instances
  const positionManager = new ethers.Contract(
    positionManagerAddress,
    [
      'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)'
    ],
    wallet
  );

  const poolContract = new ethers.Contract(
    poolAddress,
    [
      'function feeGrowthGlobal0X128() external view returns (uint256)',
      'function feeGrowthGlobal1X128() external view returns (uint256)',
      'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
      'function ticks(int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)'
    ],
    wallet
  );

  // Fetch position data
  const position = await positionManager.positions(positionId);
  const tickLower = Number(position.tickLower);
  const tickUpper = Number(position.tickUpper);

  // Fetch pool data
  const slot0 = await poolContract.slot0();
  const currentTick = Number(slot0.tick);
  const feeGrowthGlobal0X128 = await poolContract.feeGrowthGlobal0X128();
  const feeGrowthGlobal1X128 = await poolContract.feeGrowthGlobal1X128();

  // Fetch tick data
  let lowerTickData, upperTickData;
  try {
    lowerTickData = await poolContract.ticks(tickLower);
    upperTickData = await poolContract.ticks(tickUpper);
  } catch (error) {
    console.log(`Error fetching tick data: ${error.message}`);
    console.log(`Using default zero values`);
    lowerTickData = {
      feeGrowthOutside0X128: 0,
      feeGrowthOutside1X128: 0,
      initialized: false
    };
    upperTickData = {
      feeGrowthOutside0X128: 0,
      feeGrowthOutside1X128: 0,
      initialized: false
    };
  }

  // Calculate the uncollected fees using our positionHelper methods
  return calculateFees({
    position,
    currentTick,
    feeGrowthGlobal0X128,
    feeGrowthGlobal1X128,
    tickLower: lowerTickData,
    tickUpper: upperTickData,
    token0,
    token1,
    verbose
  });
}

// Import our fee calculation function (reimplemented directly for simplicity)
function calculateFees({
  position,
  currentTick,
  feeGrowthGlobal0X128,
  feeGrowthGlobal1X128,
  tickLower,
  tickUpper,
  token0,
  token1,
  verbose = false
}) {
  // Convert all inputs to proper types
  const toBigInt = (val) => {
    if (typeof val === 'bigint') return val;
    if (typeof val === 'string') return BigInt(val);
    if (typeof val === 'number') return BigInt(Math.floor(val));
    if (val?._isBigNumber) return BigInt(val.toString());
    if (val?.toString) return BigInt(val.toString());
    return BigInt(0);
  };

  // Position data extraction
  const tickLowerValue = Number(position.tickLower);
  const tickUpperValue = Number(position.tickUpper);
  const liquidity = toBigInt(position.liquidity);
  const feeGrowthInside0LastX128 = toBigInt(position.feeGrowthInside0LastX128);
  const feeGrowthInside1LastX128 = toBigInt(position.feeGrowthInside1LastX128);
  const tokensOwed0 = toBigInt(position.tokensOwed0);
  const tokensOwed1 = toBigInt(position.tokensOwed1);

  if (verbose) {
    console.log(`\n=== CALCULATING UNCOLLECTED FEES ===`);
    console.log(`Position Data (Raw):`);
    console.log(`- Position ID: ${position.tokenId || 'N/A'}`);
    console.log(`- Position Liquidity: ${position.liquidity}`);
    console.log(`- Position Tick Range: ${position.tickLower} to ${position.tickUpper}`);
    console.log(`- Position Last Fee Growth Inside 0: ${position.feeGrowthInside0LastX128}`);
    console.log(`- Position Last Fee Growth Inside 1: ${position.feeGrowthInside1LastX128}`);
    console.log(`- Position Tokens Owed 0: ${position.tokensOwed0}`);
    console.log(`- Position Tokens Owed 1: ${position.tokensOwed1}`);

    console.log(`\nPosition Data (Converted):`);
    console.log(`- Position Liquidity: ${liquidity}`);
    console.log(`- Position Tick Range: ${tickLowerValue} to ${tickUpperValue}`);
    console.log(`- Position Last Fee Growth Inside 0: ${feeGrowthInside0LastX128}`);
    console.log(`- Position Last Fee Growth Inside 1: ${feeGrowthInside1LastX128}`);
    console.log(`- Position Tokens Owed 0: ${tokensOwed0}`);
    console.log(`- Position Tokens Owed 1: ${tokensOwed1}`);

    console.log(`\nPool Data (Raw):`);
    console.log(`- Current Tick: ${currentTick}`);
    console.log(`- Fee Growth Global 0: ${feeGrowthGlobal0X128}`);
    console.log(`- Fee Growth Global 1: ${feeGrowthGlobal1X128}`);

    console.log(`\nPool Data (Converted):`);
    console.log(`- Current Tick: ${currentTick}`);
    console.log(`- Fee Growth Global 0: ${toBigInt(feeGrowthGlobal0X128)}`);
    console.log(`- Fee Growth Global 1: ${toBigInt(feeGrowthGlobal1X128)}`);

    console.log(`\nTick Data (Raw):`);
    if (tickLower) {
      console.log(`- Lower Tick (${tickLowerValue}) Fee Growth Outside 0: ${tickLower.feeGrowthOutside0X128}`);
      console.log(`- Lower Tick (${tickLowerValue}) Fee Growth Outside 1: ${tickLower.feeGrowthOutside1X128}`);
      console.log(`- Lower Tick Initialized: ${tickLower.initialized || false}`);
    } else {
      console.log(`- Lower Tick (${tickLowerValue}) Data: Not available (using zeros)`);
    }

    if (tickUpper) {
      console.log(`- Upper Tick (${tickUpperValue}) Fee Growth Outside 0: ${tickUpper.feeGrowthOutside0X128}`);
      console.log(`- Upper Tick (${tickUpperValue}) Fee Growth Outside 1: ${tickUpper.feeGrowthOutside1X128}`);
      console.log(`- Upper Tick Initialized: ${tickUpper.initialized || false}`);
    } else {
      console.log(`- Upper Tick (${tickUpperValue}) Data: Not available (using zeros)`);
    }
  }

  // Ensure we have tick data or use defaults
  const lowerTickData = {
    feeGrowthOutside0X128: tickLower ? toBigInt(tickLower.feeGrowthOutside0X128) : 0n,
    feeGrowthOutside1X128: tickLower ? toBigInt(tickLower.feeGrowthOutside1X128) : 0n,
    initialized: tickLower ? Boolean(tickLower.initialized) : false
  };

  const upperTickData = {
    feeGrowthOutside0X128: tickUpper ? toBigInt(tickUpper.feeGrowthOutside0X128) : 0n,
    feeGrowthOutside1X128: tickUpper ? toBigInt(tickUpper.feeGrowthOutside1X128) : 0n,
    initialized: tickUpper ? Boolean(tickUpper.initialized) : false
  };

  // Convert global fee growth to BigInt
  const feeGrowthGlobal0X128BigInt = toBigInt(feeGrowthGlobal0X128);
  const feeGrowthGlobal1X128BigInt = toBigInt(feeGrowthGlobal1X128);

  if (verbose) {
    console.log(`\nTick Data (Converted):`);
    console.log(`- Lower Tick (${tickLowerValue}) Fee Growth Outside 0: ${lowerTickData.feeGrowthOutside0X128}`);
    console.log(`- Lower Tick (${tickLowerValue}) Fee Growth Outside 1: ${lowerTickData.feeGrowthOutside1X128}`);
    console.log(`- Upper Tick (${tickUpperValue}) Fee Growth Outside 0: ${upperTickData.feeGrowthOutside0X128}`);
    console.log(`- Upper Tick (${tickUpperValue}) Fee Growth Outside 1: ${upperTickData.feeGrowthOutside1X128}`);
  }

  // Calculate current fee growth inside the position's range
  let feeGrowthInside0X128, feeGrowthInside1X128;

  if (currentTick < tickLowerValue) {
    // Current tick is below the position's range
    feeGrowthInside0X128 = lowerTickData.feeGrowthOutside0X128 - upperTickData.feeGrowthOutside0X128;
    feeGrowthInside1X128 = lowerTickData.feeGrowthOutside1X128 - upperTickData.feeGrowthOutside1X128;

    if (verbose) {
      console.log(`\nCase: Current tick (${currentTick}) is BELOW position range`);
      console.log(`- Formula: feeGrowthInside = lowerTick.feeGrowthOutside - upperTick.feeGrowthOutside`);
      console.log(`- Token0: ${lowerTickData.feeGrowthOutside0X128} - ${upperTickData.feeGrowthOutside0X128}`);
      console.log(`- Token1: ${lowerTickData.feeGrowthOutside1X128} - ${upperTickData.feeGrowthOutside1X128}`);
    }
  } else if (currentTick >= tickUpperValue) {
    // Current tick is at or above the position's range
    feeGrowthInside0X128 = upperTickData.feeGrowthOutside0X128 - lowerTickData.feeGrowthOutside0X128;
    feeGrowthInside1X128 = upperTickData.feeGrowthOutside1X128 - lowerTickData.feeGrowthOutside1X128;

    if (verbose) {
      console.log(`\nCase: Current tick (${currentTick}) is ABOVE position range`);
      console.log(`- Formula: feeGrowthInside = upperTick.feeGrowthOutside - lowerTick.feeGrowthOutside`);
      console.log(`- Token0: ${upperTickData.feeGrowthOutside0X128} - ${lowerTickData.feeGrowthOutside0X128}`);
      console.log(`- Token1: ${upperTickData.feeGrowthOutside1X128} - ${lowerTickData.feeGrowthOutside1X128}`);
    }
  } else {
    // Current tick is within the position's range
    feeGrowthInside0X128 = feeGrowthGlobal0X128BigInt - lowerTickData.feeGrowthOutside0X128 - upperTickData.feeGrowthOutside0X128;
    feeGrowthInside1X128 = feeGrowthGlobal1X128BigInt - lowerTickData.feeGrowthOutside1X128 - upperTickData.feeGrowthOutside1X128;

    if (verbose) {
      console.log(`\nCase: Current tick (${currentTick}) is WITHIN position range`);
      console.log(`- Formula: feeGrowthInside = feeGrowthGlobal - lowerTick.feeGrowthOutside - upperTick.feeGrowthOutside`);
      console.log(`- Token0: ${feeGrowthGlobal0X128BigInt} - ${lowerTickData.feeGrowthOutside0X128} - ${upperTickData.feeGrowthOutside0X128}`);
      console.log(`- Token1: ${feeGrowthGlobal1X128BigInt} - ${lowerTickData.feeGrowthOutside1X128} - ${upperTickData.feeGrowthOutside1X128}`);
    }
  }

  // Handle negative values by adding 2^256
  const MAX_UINT256 = 2n ** 256n;
  if (feeGrowthInside0X128 < 0n) {
    if (verbose) console.log(`Handling negative value for feeGrowthInside0X128: ${feeGrowthInside0X128} + 2^256`);
    feeGrowthInside0X128 += MAX_UINT256;
  }

  if (feeGrowthInside1X128 < 0n) {
    if (verbose) console.log(`Handling negative value for feeGrowthInside1X128: ${feeGrowthInside1X128} + 2^256`);
    feeGrowthInside1X128 += MAX_UINT256;
  }

  if (verbose) {
    console.log(`\nFee Growth Inside (after underflow protection):`);
    console.log(`- Fee Growth Inside 0: ${feeGrowthInside0X128}`);
    console.log(`- Fee Growth Inside 1: ${feeGrowthInside1X128}`);
  }

  // Calculate fee growth since last position update
  let feeGrowthDelta0 = feeGrowthInside0X128 - feeGrowthInside0LastX128;
  let feeGrowthDelta1 = feeGrowthInside1X128 - feeGrowthInside1LastX128;

  // Handle underflow
  if (feeGrowthDelta0 < 0n) {
    if (verbose) console.log(`Handling negative value for feeGrowthDelta0: ${feeGrowthDelta0} + 2^256`);
    feeGrowthDelta0 += MAX_UINT256;
  }

  if (feeGrowthDelta1 < 0n) {
    if (verbose) console.log(`Handling negative value for feeGrowthDelta1: ${feeGrowthDelta1} + 2^256`);
    feeGrowthDelta1 += MAX_UINT256;
  }

  if (verbose) {
    console.log(`\nFee Growth Delta (since last position update):`);
    console.log(`- Token0 Delta: ${feeGrowthDelta0}`);
    console.log(`- Token1 Delta: ${feeGrowthDelta1}`);
  }

  // Calculate uncollected fees
  // The formula is: tokensOwed + (liquidity * feeGrowthDelta) / 2^128
  const DENOMINATOR = 2n ** 128n;

  if (verbose) {
    console.log(`\nFee Calculation Breakdown:`);
    console.log(`- Liquidity: ${liquidity}`);
    console.log(`- Denominator (2^128): ${DENOMINATOR}`);
    console.log(`\nCalculation for Token0:`);
    console.log(`- Fee Growth Delta: ${feeGrowthDelta0}`);
    console.log(`- liquidity * feeGrowthDelta0 = ${liquidity * feeGrowthDelta0}`);
    console.log(`- (liquidity * feeGrowthDelta0) / 2^128 = ${(liquidity * feeGrowthDelta0) / DENOMINATOR}`);
  }

  const uncollectedFees0Raw = tokensOwed0 + (liquidity * feeGrowthDelta0) / DENOMINATOR;
  const uncollectedFees1Raw = tokensOwed1 + (liquidity * feeGrowthDelta1) / DENOMINATOR;

  if (verbose) {
    console.log(`\nUncollected Fees Calculation:`);
    console.log(`- Formula: tokensOwed + (liquidity * feeGrowthDelta) / 2^128`);
    console.log(`- Token0: ${tokensOwed0} + (${liquidity} * ${feeGrowthDelta0}) / ${DENOMINATOR} = ${uncollectedFees0Raw}`);
    console.log(`- Token1: ${tokensOwed1} + (${liquidity} * ${feeGrowthDelta1}) / ${DENOMINATOR} = ${uncollectedFees1Raw}`);

    console.log(`\nConverting to human-readable amounts:`);
    console.log(`- Token0 Decimals: ${token0?.decimals || 18}`);
    console.log(`- Token1 Decimals: ${token1?.decimals || 6}`);
    console.log(`- Token0 Fee: ${formatUnits(uncollectedFees0Raw, token0?.decimals || 18)}`);
    console.log(`- Token1 Fee: ${formatUnits(uncollectedFees1Raw, token1?.decimals || 6)}`);
  }

  // Format with proper decimals
  const token0Decimals = token0?.decimals || 18;
  const token1Decimals = token1?.decimals || 6;

  // Return both raw and formatted values for flexibility
  return {
    token0: {
      raw: uncollectedFees0Raw,
      // Convert to string for safer handling in UI
      formatted: formatUnits(uncollectedFees0Raw, token0Decimals)
    },
    token1: {
      raw: uncollectedFees1Raw,
      formatted: formatUnits(uncollectedFees1Raw, token1Decimals)
    }
  };
}

/**
 * Helper function to format BigInt values with decimals
 * @param {BigInt} value - The raw token amount as BigInt
 * @param {number} decimals - Number of decimals for the token
 * @returns {string} Formatted string with proper decimal places
 */
function formatUnits(value, decimals) {
  if (!value) return '0';

  const divisor = BigInt(10 ** decimals);
  const integerPart = (value / divisor).toString();

  let fractionalPart = (value % divisor).toString();
  // Pad with leading zeros if needed
  fractionalPart = fractionalPart.padStart(decimals, '0');

  // Remove trailing zeros
  while (fractionalPart.endsWith('0') && fractionalPart.length > 1) {
    fractionalPart = fractionalPart.substring(0, fractionalPart.length - 1);
  }

  if (fractionalPart === '0') {
    return integerPart;
  }

  return `${integerPart}.${fractionalPart}`;
}

// Main function
async function main() {
  console.log('Starting seed script to create Uniswap V3 test position...');

  // Setup provider and signer
  const provider = new ethers.JsonRpcProvider(config.chains.arbitrum.rpcUrl);

  // WARNING: Never hardcode private keys in production code!
  // This is just for development/testing purposes using a Hardhat generated test private key
  const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`Using wallet address: ${wallet.address}`);

  // Check ETH balance
  const ethBalance = await provider.getBalance(wallet.address);
  console.log(`ETH balance: ${ethers.formatEther(ethBalance)} ETH`);

  // Define token addresses for Arbitrum
  const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'; // WETH on Arbitrum
  const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // USDC on Arbitrum

  // Create token instances
  const WETH = new Token(
    config.chains.arbitrum.chainId,
    WETH_ADDRESS,
    18,
    'WETH',
    'Wrapped Ether'
  );

  const USDC = new Token(
    config.chains.arbitrum.chainId,
    USDC_ADDRESS,
    6,
    'USDC',
    'USD Coin'
  );

  // Create contract instances
  const wethContract = new ethers.Contract(WETH_ADDRESS, ERC20ABI, wallet);
  const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20ABI, wallet);

  // Get token balances before swap
  const initialWethBalance = await wethContract.balanceOf(wallet.address);
  const initialUsdcBalance = await usdcContract.balanceOf(wallet.address);

  console.log(`Initial WETH balance: ${ethers.formatUnits(initialWethBalance, 18)} WETH`);
  console.log(`Initial USDC balance: ${ethers.formatUnits(initialUsdcBalance, 6)} USDC`);

  // To swap ETH for USDC on Uniswap, we'll need to:
  // 1. Wrap some ETH to WETH
  // 2. Approve the Uniswap router to spend our WETH
  // 3. Execute the swap through the Uniswap router

  // Step 1: Wrap ETH to WETH using the WETH contract
  console.log(`Wrapping 10 ETH to WETH...`);

  // WETH contract address is the same as the token address
  const wethContractWithABI = new ethers.Contract(
    WETH_ADDRESS,
    [
      // Minimal ABI for deposit function
      'function deposit() external payable',
      'function balanceOf(address) external view returns (uint)'
    ],
    wallet
  );

  // Get the current nonce
  let currentNonce = await provider.getTransactionCount(wallet.address);
  console.log(`Current nonce: ${currentNonce}`);

  // Deposit 5 ETH to get WETH
  const wrapTx = await wethContractWithABI.deposit({
    value: ethers.parseEther('10'),
    nonce: currentNonce++
  });

  console.log(`Wrap transaction sent: ${wrapTx.hash}`);
  await wrapTx.wait();
  console.log(`Wrap transaction confirmed`);

  // Step 2: Approve Uniswap router to spend our WETH
  const UNISWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Uniswap V3 Router on Arbitrum

  currentNonce = await provider.getTransactionCount(wallet.address);
  console.log(`Nonce after previous transaction: ${currentNonce}`);

  console.log(`Approving Uniswap Router to spend WETH...`);
  const approveTx = await wethContract.approve(
    UNISWAP_ROUTER_ADDRESS,
    ethers.parseEther('5'),
    {
      nonce: currentNonce++
    }
  );

  console.log(`Approve transaction sent: ${approveTx.hash}`);
  await approveTx.wait();
  console.log(`Approve transaction confirmed`);

  // Step 3: Execute the swap using the Uniswap Router
  const UNISWAP_ROUTER_ABI = [
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)'
  ];

  const uniswapRouter = new ethers.Contract(
    UNISWAP_ROUTER_ADDRESS,
    UNISWAP_ROUTER_ABI,
    wallet
  );

  console.log(`Swapping 5 WETH for USDC...`);

  // Current timestamp plus 20 minutes (in seconds)
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

  const swapTx = await uniswapRouter.exactInputSingle({
    tokenIn: WETH_ADDRESS,
    tokenOut: USDC_ADDRESS,
    fee: 500, // 0.3% fee tier
    recipient: wallet.address,
    deadline: deadline,
    amountIn: ethers.parseEther('5'),
    amountOutMinimum: 0, // For testing, we accept any amount out (in production, set a min)
    sqrtPriceLimitX96: 0,
    nonce: currentNonce++
  });

  console.log(`Swap transaction sent: ${swapTx.hash}`);
  await swapTx.wait();
  console.log(`Swap transaction confirmed`);

  // Get token balances after swap
  const finalWethBalance = await wethContract.balanceOf(wallet.address);
  const finalUsdcBalance = await usdcContract.balanceOf(wallet.address);

  console.log(`Final WETH balance: ${ethers.formatUnits(finalWethBalance, 18)} WETH`);
  console.log(`Final USDC balance: ${ethers.formatUnits(finalUsdcBalance, 6)} USDC`);
  console.log(`Acquired ${ethers.formatUnits(finalUsdcBalance - initialUsdcBalance, 6)} USDC`);

  console.log('ETH to USDC swap completed successfully.');

  // Step 4: Gather Pool Information (AFTER the swap to get updated pool state)
  console.log('\n--- Creating Pool Instance and Gathering Information ---');

  // Define fee tier - using 0.05% (500) for WETH/USDC which is common
  const FEE_TIER = 500;

  // Get the pool address
  const poolAddress = Pool.getAddress(WETH, USDC, FEE_TIER);
  console.log(`WETH/USDC Pool Address: ${poolAddress}`);

  // Create a contract instance for the pool
  const poolContract = new ethers.Contract(
    poolAddress,
    IUniswapV3PoolABI,
    wallet
  );

  // Fetch pool data
  console.log('Fetching pool state data...');

  // Get slot0 data (contains the most recent price and tick)
  const slot0Data = await poolContract.slot0();
  console.log('\nSlot0 Data:');
  console.log(`- sqrtPriceX96: ${slot0Data[0]}`);
  console.log(`- Current Tick: ${slot0Data[1]}`);
  console.log(`- Observation Index: ${slot0Data[2]}`);
  console.log(`- Observation Cardinality: ${slot0Data[3]}`);
  console.log(`- Observation Cardinality Next: ${slot0Data[4]}`);
  console.log(`- Fee Protocol: ${slot0Data[5]}`);
  console.log(`- Unlocked: ${slot0Data[6]}`);

  // Get current liquidity
  const liquidity = await poolContract.liquidity();
  console.log(`\nCurrent Pool Liquidity: ${liquidity}`);

  // Get fee growth data
  const feeGrowthGlobal0X128 = await poolContract.feeGrowthGlobal0X128();
  const feeGrowthGlobal1X128 = await poolContract.feeGrowthGlobal1X128();
  console.log(`\nFee Growth Data:`);
  console.log(`- Token0 (WETH): ${feeGrowthGlobal0X128}`);
  console.log(`- Token1 (USDC): ${feeGrowthGlobal1X128}`);

  // Get tick spacing for this pool
  const tickSpacing = await poolContract.tickSpacing();
  console.log(`\nTick Spacing: ${Number(tickSpacing)}`);

  // Get fee amount
  const fee = await poolContract.fee();
  console.log(`Fee: ${fee} (${Number(fee) / 10000}%)`);

  // Calculate the current price from sqrtPriceX96
  const sqrtPriceX96 = slot0Data[0];
  const sqrtPriceX96AsNumber = Number(sqrtPriceX96) / (2 ** 96);
  const priceInt = sqrtPriceX96AsNumber * sqrtPriceX96AsNumber;

  const decimalsDiff = USDC.decimals - WETH.decimals; // USDC (6) - WETH (18) = -12
  const price = priceInt * Math.pow(10, decimalsDiff < 0 ? -decimalsDiff : 0);

  console.log(`\nCurrent Price: ${price.toFixed(2)} USDC per WETH`);
  console.log(`Current Inverse Price: ${(1 / price).toFixed(8)} WETH per USDC`);

  // Calculate nearby tick values for reference
  const currentTick = Number(slot0Data[1]);
  console.log(`\nUseful Tick Values:`);
  console.log(`- Current Tick: ${currentTick}`);

  // Calculate a tick range centered around the current price (±5%)
  // This ensures our range includes the current price
  const tickLower5Percent = Math.floor(currentTick - Math.log(1.05) / Math.log(1.0001));
  const tickUpper5Percent = Math.ceil(currentTick + Math.log(1.05) / Math.log(1.0001));

  // Round to nearest tick spacing
  const nearestLowerTick = Math.ceil(tickLower5Percent / Number(tickSpacing)) * Number(tickSpacing);
  const nearestUpperTick = Math.floor(tickUpper5Percent / Number(tickSpacing)) * Number(tickSpacing);

  console.log(`- 5% Lower Tick (Rounded to Spacing): ${nearestLowerTick}`);
  console.log(`- 5% Upper Tick (Rounded to Spacing): ${nearestUpperTick}`);

  // Double-check if range includes current tick
  const isCurrentTickInRange = currentTick >= nearestLowerTick && currentTick <= nearestUpperTick;
  console.log(`- Is current tick in range? ${isCurrentTickInRange ? 'Yes' : 'No'}`);

  // If current tick is not in range, adjust the range
  let finalLowerTick = nearestLowerTick;
  let finalUpperTick = nearestUpperTick;

  if (!isCurrentTickInRange) {
    console.log('Current tick not in range, adjusting...');
    finalLowerTick = Math.floor(currentTick / Number(tickSpacing)) * Number(tickSpacing) - Number(tickSpacing);
    finalUpperTick = Math.ceil(currentTick / Number(tickSpacing)) * Number(tickSpacing) + Number(tickSpacing);
    console.log(`- Adjusted tick range: ${finalLowerTick} to ${finalUpperTick}`);
  }

  // Create a Pool instance using the SDK
  console.log('\nCreating Pool instance from SDK...');
  const poolInstance = new Pool(
    WETH,                   // token0
    USDC,                   // token1
    Number(fee),            // fee tier
    sqrtPriceX96.toString(),// sqrtRatioX96
    liquidity.toString(),   // liquidity
    Number(slot0Data[1])    // tickCurrent
  );

  console.log('Pool instance created successfully');
  console.log(`Token0: ${poolInstance.token0.symbol}`);
  console.log(`Token1: ${poolInstance.token1.symbol}`);
  console.log(`Current Tick from Pool Instance: ${poolInstance.tickCurrent}`);

  console.log('\nPool information gathering completed.');

  // Step 5: Prepare for position creation
  console.log('\n--- Preparing Position Creation ---');

  // Create Position instance to calculate liquidity
  console.log('Creating Position instance with centered price range...');

  // Amounts we want to use for the position
  const wethAmount = ethers.parseEther('3');
  console.log(`WETH amount for position: ${ethers.formatEther(wethAmount)} WETH`);

  // Convert WETH to CurrencyAmount
  const tokenAmount0 = CurrencyAmount.fromRawAmount(
    WETH,
    wethAmount.toString()
  );

  // Also create a USDC amount (approx. WETH value worth of USDC)
  // Price is in USDC per WETH, so wethAmount * price gives us the USDC value
  const usdcValue = Math.floor(Number(ethers.formatEther(wethAmount)) * price * 10**6);
  const usdcAmount = ethers.parseUnits(usdcValue.toString(), 6);
  console.log(`USDC amount for position: ${ethers.formatUnits(usdcValue, 6)} USDC`);

  const tokenAmount1 = CurrencyAmount.fromRawAmount(
    USDC,
    usdcAmount.toString()
  );

  // Create a position with our price range
  try {
    // First, create a position using createPool which gives more control
    const positionInfo = {
      pool: poolInstance,
      tickLower: finalLowerTick,
      tickUpper: finalUpperTick
    };

    // Calculate optimal liquidity based on desired token amounts
    // There are different methods:
    // 1. fromAmount0() - uses only token0 (WETH) amount
    // 2. fromAmount1() - uses only token1 (USDC) amount
    // 3. fromAmounts() - uses both token amounts but considers them maximums

    // We'll use fromAmounts() to provide both tokens in a balanced way
    const position = Position.fromAmounts({
      ...positionInfo,
      amount0: tokenAmount0.quotient.toString(),
      amount1: tokenAmount1.quotient.toString(),
      useFullPrecision: true
    });

    console.log('\nPosition Parameters:');
    console.log(`- Tick Lower: ${position.tickLower}`);
    console.log(`- Tick Upper: ${position.tickUpper}`);
    console.log(`- Liquidity: ${position.liquidity.toString()}`);
    console.log(`- WETH Amount: ${ethers.formatEther(position.amount0.quotient.toString())} WETH`);
    console.log(`- USDC Amount: ${ethers.formatUnits(position.amount1.quotient.toString(), 6)} USDC`);

    // Check if amounts are zero and warn
    if (position.amount0.quotient.toString() === '0' || position.amount1.quotient.toString() === '0') {
      console.log('\nWARNING: One of the position amounts is zero. This may indicate an issue with the position calculation.');

      // Try a different approach if needed - just for testing
      console.log('\nAttempting alternative position calculation for debugging:');

      // Calculate the liquidity directly from the desired amounts
      const sqrtRatioCurrentX96 = JSBI.BigInt(sqrtPriceX96.toString());
      const sqrtRatioLowerX96 = TickMath.getSqrtRatioAtTick(finalLowerTick);
      const sqrtRatioUpperX96 = TickMath.getSqrtRatioAtTick(finalUpperTick);

      console.log(`- Current sqrt price: ${sqrtRatioCurrentX96.toString()}`);
      console.log(`- Lower sqrt price: ${sqrtRatioLowerX96.toString()}`);
      console.log(`- Upper sqrt price: ${sqrtRatioUpperX96.toString()}`);
    }

    // Calculate price range in human-readable format
    // Fixed price calculation
    const lowerPrice = tickToPrice(WETH, USDC, position.tickLower).toFixed(2);
    const upperPrice = tickToPrice(WETH, USDC, position.tickUpper).toFixed(2);
    console.log(`- Price Range: ${lowerPrice} - ${upperPrice} USDC per WETH`);
    console.log(`- Current Price: ${price.toFixed(2)} USDC per WETH`);

    // Prepare approval for the NonfungiblePositionManager
    console.log('\nPreparing token approvals for position creation...');

    const positionManagerAddress = config.chains.arbitrum.platforms.uniswapV3.positionManagerAddress;

    // Log approval details
    console.log('\nApproval Details:');
    console.log(`- WETH Approval Required: ${ethers.formatEther(position.amount0.quotient.toString())} WETH`);
    console.log(`- USDC Approval Required: ${ethers.formatUnits(position.amount1.quotient.toString(), 6)} USDC`);
    console.log(`- Position Manager Address: ${positionManagerAddress}`);

    // Prepare mint parameters
    const mintParams = {
      token0: WETH.address,
      token1: USDC.address,
      fee: FEE_TIER,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      amount0Desired: position.amount0.quotient.toString(),
      amount1Desired: position.amount1.quotient.toString(),
      amount0Min: 0, // In production, apply slippage tolerance
      amount1Min: 0, // In production, apply slippage tolerance
      recipient: wallet.address,
      deadline: Math.floor(Date.now() / 1000) + 20 * 60 // 20 minutes from now
    };

    console.log('\nMint Transaction Parameters:');
    console.log(JSON.stringify(mintParams, null, 2));

    // Create a Position Manager contract instance
    const positionManager = new ethers.Contract(
      positionManagerAddress,
      NonfungiblePositionManagerABI,
      wallet
    );

    // Execute the actual minting process
    console.log('\n--- Executing Position Creation ---');

    currentNonce = await provider.getTransactionCount(wallet.address);
    console.log(`Nonce after previous transaction: ${currentNonce}`);

    // STEP 1: Approve the position manager to spend our WETH
    console.log(`Approving position manager to spend WETH...`);
    const approveWethTx = await wethContract.approve(
      positionManagerAddress,
      position.amount0.quotient.toString(),
      {
        nonce: currentNonce++
      }
    );
    console.log(`WETH approval transaction sent: ${approveWethTx.hash}`);
    await approveWethTx.wait();
    console.log(`WETH approval confirmed`);

    currentNonce = await provider.getTransactionCount(wallet.address);
    console.log(`Nonce after previous transaction: ${currentNonce}`);

    // STEP 2: Approve the position manager to spend our USDC
    console.log(`Approving position manager to spend USDC...`);
    const approveUsdcTx = await usdcContract.approve(
      positionManagerAddress,
      position.amount1.quotient.toString(),
      {
        nonce: currentNonce++
      }
    );
    console.log(`USDC approval transaction sent: ${approveUsdcTx.hash}`);
    await approveUsdcTx.wait();
    console.log(`USDC approval confirmed`);

    currentNonce = await provider.getTransactionCount(wallet.address);
    console.log(`Nonce after previous transaction: ${currentNonce}`);

    // STEP 3: Execute the mint transaction
    console.log(`Minting new liquidity position...`);
    const mintTx = await positionManager.mint(
      mintParams,
      { gasLimit: 5000000, nonce: currentNonce++ } // Adding gas limit for safety
    );
    console.log(`Mint transaction sent: ${mintTx.hash}`);

    // STEP 4: Wait for the transaction to be mined and get the receipt
    const receipt = await mintTx.wait();
    console.log(`Mint transaction confirmed!`);

    // STEP 5: Process the receipt to extract the tokenId of the minted position
    // Find the Transfer event (NFT minted)
    const transferEvent = receipt.logs.find(log => {
      try {
        // A Transfer event has 3 topics: event signature + from + to
        return log.topics.length === 4 &&
               log.topics[0] === ethers.id("Transfer(address,address,uint256)") &&
               log.topics[1] === ethers.zeroPadValue("0x0000000000000000000000000000000000000000", 32) &&
               log.topics[2] === ethers.zeroPadValue(wallet.address.toLowerCase(), 32);
      } catch (e) {
        return false;
      }
    });

    if (!transferEvent) {
      throw new Error("Transfer event not found in transaction receipt");
    }

    // Extract tokenId from the event
    const tokenId = ethers.toBigInt(transferEvent.topics[3]);
    console.log(`\n🎉 Successfully minted position with ID: ${tokenId}`);

    // STEP 6: Get the position details to confirm
    const positionData = await positionManager.positions(tokenId);
    console.log('\nMinted Position Details:');
    console.log(`- Token0: ${positionData.token0}`);
    console.log(`- Token1: ${positionData.token1}`);
    console.log(`- Fee: ${positionData.fee}`);
    console.log(`- Tick Lower: ${positionData.tickLower}`);
    console.log(`- Tick Upper: ${positionData.tickUpper}`);
    console.log(`- Liquidity: ${positionData.liquidity}`);

    // Calculate and display price values again
    console.log('\nPosition Price Range:');
    console.log(`- Min Price: ${lowerPrice} USDC per WETH`);
    console.log(`- Max Price: ${upperPrice} USDC per WETH`);
    console.log(`- Current Price: ${price.toFixed(2)} USDC per WETH`);
    console.log(`- Status: ${currentTick >= position.tickLower && currentTick <= position.tickUpper ? 'In Range (Active)' : 'Out of Range (Inactive)'}`);

    // Get the balance of positions
    const positionBalance = await positionManager.balanceOf(wallet.address);
    console.log(`\nTotal positions owned: ${positionBalance}`);

    // Save token information for use in the fee calculation
    const token0Info = {
      address: WETH_ADDRESS,
      decimals: 18,
      symbol: 'WETH'
    };

    const token1Info = {
      address: USDC_ADDRESS,
      decimals: 6,
      symbol: 'USDC'
    };

    // NEW SECTION: Generate fees by performing multiple swaps
    console.log('\n=== GENERATING FEES FOR THE POSITION ===');

    // Perform multiple swaps to generate fees (just one swap for now as requested)
    await performSwapsToGenerateFees(wallet, 200);

    // Calculate fees directly without "poking" the position
    console.log('\n=== CALCULATING UNCOLLECTED FEES ===');
    const feesResult = await calculateUncollectedFees(
      wallet,
      tokenId,
      positionManagerAddress,
      poolAddress,
      token0Info,
      token1Info,
      false // verbose logging
    );

    console.log('\n=== FEE CALCULATION RESULT ===');
    console.log(`WETH Fees: ${feesResult.token0.formatted}`);
    console.log(`USDC Fees: ${feesResult.token1.formatted}`);

//     // Save the fee calculation as a separate JS module for frontend reference
//     const feesExportCode = `
// // Generated by seed.js - Example calculation for position ${tokenId}
// export const sampleFeeCalculation = {
//   positionId: "${tokenId}",
//   token0: {
//     symbol: "WETH",
//     fees: "${feesResult.token0.formatted}"
//   },
//   token1: {
//     symbol: "USDC",
//     fees: "${feesResult.token1.formatted}"
//   },
//   calculationMethod: "Off-chain calculation from pool state"
// };
// `;

//     fs.writeFileSync(path.join(__dirname, '..', 'src', 'utils', 'sampleFeeCalculation.js'), feesExportCode);
//     console.log('\nSaved fee calculation example to src/utils/sampleFeeCalculation.js');

  } catch (err) {
    console.error('Error creating position:', err);
  }

  console.log('\nSeed script completed.');

  // Helper function to convert tick to price - FIXED VERSION
  function tickToPrice(baseToken, quoteToken, tick) {
    // Use logarithm for numerical stability with extreme tick values
    const price = Math.exp(tick * Math.log(1.0001));

    // Apply decimal adjustment based on token decimals
    const decimalAdjustment = Math.pow(10, quoteToken.decimals - baseToken.decimals);

    return price * decimalAdjustment;
  }
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error in seed script:', error);
    process.exit(1);
  });
