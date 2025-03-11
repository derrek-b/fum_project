// utils/positionHelpers.js
import { TickMath } from "@uniswap/v3-sdk";
import JSBI from 'jsbi'; // Import JSBI separately

export function isInRange(currentTick, tickLower, tickUpper) {
  return currentTick >= tickLower && tickUpper >= currentTick;
}

export function calculatePrice(sqrtPriceX96, decimals0, decimals1, invert = false) {
  if (!sqrtPriceX96 || sqrtPriceX96 === "0") return "N/A";

  // Convert sqrtPriceX96 to a number and calculate price
  const sqrtPriceX96AsNumber = Number(sqrtPriceX96) / (2 ** 96);
  const priceInt = sqrtPriceX96AsNumber * sqrtPriceX96AsNumber;

  // Apply decimal adjustment - must handle both positive and negative cases
  const decimalsDiff = decimals1 - decimals0;
  let price = priceInt * Math.pow(10, decimalsDiff < 0 ? -decimalsDiff : 0);

  // Invert the price if requested
  if (invert) {
    price = 1 / price;
  }

  // Format with appropriate precision
  const formattedPrice = Number.isFinite(price) ? price.toFixed(6) : "N/A";
  return formattedPrice;
}

/**
 * Convert a tick value to a corresponding price
 * @param {number} tick - The tick value
 * @param {number} decimals0 - Decimals of token0
 * @param {number} decimals1 - Decimals of token1
 * @param {boolean} invert - Whether to invert the price (show token0/token1 instead of token1/token0)
 * @returns {string} The formatted price corresponding to the tick
 */
export function tickToPrice(tick, decimals0, decimals1, invert = false) {
  if (!Number.isFinite(tick)) return "N/A";

  // Calculate raw price using the same formula from Uniswap: 1.0001^tick
  const rawPrice = Math.pow(1.0001, tick);

  // Apply the SAME decimal adjustment as in calculatePrice function
  const decimalsDiff = decimals1 - decimals0;
  let price = rawPrice * Math.pow(10, decimalsDiff < 0 ? -decimalsDiff : 0);

  // Invert if requested (token0 per token1 instead of token1 per token0)
  if (invert) {
    price = 1 / price;
  }

  // Format based on value (same formatting logic as used elsewhere)
  if (!Number.isFinite(price)) return "N/A";
  if (price < 0.0001) return "< 0.0001";
  if (price > 1000000) return price.toLocaleString(undefined, { maximumFractionDigits: 0 });

  // Return with appropriate precision
  return price.toFixed(6);
}

/**
 * Format a price value with appropriate precision
 * @param {number} price - The price to format
 * @returns {string} The formatted price
 */
export function formatPrice(price) {
  if (!Number.isFinite(price)) return "N/A";
  if (price === 0) return "0";

  // Handle very small numbers
  if (price < 0.0001) return "<0.0001";

  // Dynamic precision based on price magnitude
  if (price < 0.001) return price.toFixed(6);
  if (price < 0.1) return price.toFixed(5);
  if (price < 1) return price.toFixed(4);
  if (price < 100) return price.toFixed(2);
  if (price > 1000000) return price.toExponential(2);

  return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Calculate uncollected fees for a Uniswap V3 position
 * @param {Object} params - Parameters object
 * @param {Object} params.position - Position data from the NonfungiblePositionManager
 * @param {number} params.currentTick - Current tick from the pool
 * @param {BigInt|string} params.feeGrowthGlobal0X128 - Global fee growth for token0
 * @param {BigInt|string} params.feeGrowthGlobal1X128 - Global fee growth for token1
 * @param {Object} params.tickLower - Lower tick data
 * @param {Object} params.tickUpper - Upper tick data
 * @param {Object} params.token0 - Token0 data with decimals
 * @param {Object} params.token1 - Token1 data with decimals
 * @param {boolean} params.verbose - Whether to log detailed calculations
 * @returns {Object} Uncollected fees for token0 and token1
 */
export function calculateUncollectedFees({
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
    console.log(`- Position ID: ${position.id || 'N/A'}`);
    console.log(`- Position Liquidity: ${position.liquidity.toString()}`);
    console.log(`- Position Tick Range: ${position.tickLower} to ${position.tickUpper}`);
    console.log(`- Position Last Fee Growth Inside 0: ${position.feeGrowthInside0LastX128.toString()}`);
    console.log(`- Position Last Fee Growth Inside 1: ${position.feeGrowthInside1LastX128.toString()}`);
    console.log(`- Position Tokens Owed 0: ${position.tokensOwed0.toString()}`);
    console.log(`- Position Tokens Owed 1: ${position.tokensOwed1.toString()}`);

    console.log(`\nPosition Data (Converted):`);
    console.log(`- Position Liquidity: ${liquidity}`);
    console.log(`- Position Tick Range: ${tickLowerValue} to ${tickUpperValue}`);
    console.log(`- Position Last Fee Growth Inside 0: ${feeGrowthInside0LastX128}`);
    console.log(`- Position Last Fee Growth Inside 1: ${feeGrowthInside1LastX128}`);
    console.log(`- Position Tokens Owed 0: ${tokensOwed0}`);
    console.log(`- Position Tokens Owed 1: ${tokensOwed1}`);

    console.log(`\nPool Data (Raw):`);
    console.log(`- Current Tick: ${currentTick}`);
    console.log(`- Fee Growth Global 0: ${feeGrowthGlobal0X128.toString()}`);
    console.log(`- Fee Growth Global 1: ${feeGrowthGlobal1X128.toString()}`);

    console.log(`\nPool Data (Converted):`);
    console.log(`- Current Tick: ${currentTick}`);
    console.log(`- Fee Growth Global 0: ${toBigInt(feeGrowthGlobal0X128)}`);
    console.log(`- Fee Growth Global 1: ${toBigInt(feeGrowthGlobal1X128)}`);

    console.log(`\nTick Data (Raw):`);
    if (tickLower) {
      console.log(`- Lower Tick (${tickLowerValue}) Fee Growth Outside 0: ${tickLower.feeGrowthOutside0X128.toString()}`);
      console.log(`- Lower Tick (${tickLowerValue}) Fee Growth Outside 1: ${tickLower.feeGrowthOutside1X128.toString()}`);
      console.log(`- Lower Tick Initialized: ${tickLower.initialized || false}`);
    } else {
      console.log(`- Lower Tick (${tickLowerValue}) Data: Not available (using zeros)`);
    }

    if (tickUpper) {
      console.log(`- Upper Tick (${tickUpperValue}) Fee Growth Outside 0: ${tickUpper.feeGrowthOutside0X128.toString()}`);
      console.log(`- Upper Tick (${tickUpperValue}) Fee Growth Outside 1: ${tickUpper.feeGrowthOutside1X128.toString()}`);
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
