// Direct test of UniswapV3 price calculations
import { mockSqrtPriceScenarios, mockTickScenarios } from './mocks/uniswapv3Data.js';

// This implements what we think the calculation should be
function calculatePriceFromSqrtPrice(sqrtPriceX96, decimals0, decimals1, invert = false) {
  console.log(`Testing sqrtPriceX96=${sqrtPriceX96}, decimals0=${decimals0}, decimals1=${decimals1}, invert=${invert}`);
  
  if (!sqrtPriceX96 || sqrtPriceX96 === "0") return "N/A";

  try {
    // Convert sqrtPriceX96 to a number and calculate price
    const sqrtPriceX96AsNumber = Number(sqrtPriceX96) / (2 ** 96);
    const priceInt = sqrtPriceX96AsNumber * sqrtPriceX96AsNumber;
    
    console.log(`sqrtPriceX96AsNumber=${sqrtPriceX96AsNumber}, priceInt=${priceInt}`);

    // Apply decimal adjustment - must handle both positive and negative cases
    const decimalsDiff = decimals1 - decimals0;
    let price;
    
    if (decimalsDiff > 0) {
      price = priceInt * Math.pow(10, decimalsDiff);
    } else if (decimalsDiff < 0) {
      price = priceInt / Math.pow(10, -decimalsDiff);
    } else {
      price = priceInt;
    }
    
    console.log(`decimalsDiff=${decimalsDiff}, price after adjustment=${price}`);

    // Invert the price if requested
    if (invert) {
      price = 1 / price;
      console.log(`Inverted price=${price}`);
    }

    // Format with appropriate precision
    const formattedPrice = Number.isFinite(price) ? price.toFixed(6) : "N/A";
    return formattedPrice;
  } catch (error) {
    console.error("Error calculating price:", error);
    return "N/A";
  }
}

// Test the calculations with our test data
console.log("=== DIRECT CALCULATION TESTS ===");

console.log("\n--- Testing sqrtPriceX96 to price ---");
mockSqrtPriceScenarios.forEach(scenario => {
  console.log(`\nScenario: ${scenario.description}`);
  const result = calculatePriceFromSqrtPrice(
    scenario.sqrtPriceX96,
    scenario.decimals0,
    scenario.decimals1
  );
  
  console.log(`Result: ${result}, Expected: ${scenario.expectedPrice}`);
  const resultNum = parseFloat(result);
  const expectedNum = scenario.expectedPrice;
  const percentDiff = Math.abs((resultNum - expectedNum) / expectedNum) * 100;
  console.log(`Percent difference: ${percentDiff}%`);
});

console.log("\n--- Testing sqrtPriceX96 to inverted price ---");
mockSqrtPriceScenarios.forEach(scenario => {
  console.log(`\nScenario: ${scenario.description}`);
  const result = calculatePriceFromSqrtPrice(
    scenario.sqrtPriceX96,
    scenario.decimals0,
    scenario.decimals1,
    true // invert
  );
  
  console.log(`Result: ${result}, Expected: ${scenario.expectedInvertedPrice}`);
  const resultNum = parseFloat(result);
  const expectedNum = scenario.expectedInvertedPrice;
  const percentDiff = Math.abs((resultNum - expectedNum) / expectedNum) * 100;
  console.log(`Percent difference: ${percentDiff}%`);
});

// This implements what we think the tick to price calculation should be
function tickToPrice(tick, decimals0, decimals1, invert = false) {
  console.log(`Testing tick=${tick}, decimals0=${decimals0}, decimals1=${decimals1}, invert=${invert}`);
  
  if (!Number.isFinite(tick)) return "N/A";

  try {
    // Calculate raw price using the same formula from Uniswap: 1.0001^tick
    const rawPrice = Math.pow(1.0001, tick);
    console.log(`rawPrice (1.0001^tick)=${rawPrice}`);
    
    // Apply the decimal adjustment
    const decimalsDiff = decimals1 - decimals0;
    let price;
    
    if (decimalsDiff > 0) {
      price = rawPrice * Math.pow(10, decimalsDiff);
    } else if (decimalsDiff < 0) {
      price = rawPrice / Math.pow(10, -decimalsDiff);
    } else {
      price = rawPrice;
    }
    
    console.log(`decimalsDiff=${decimalsDiff}, price after adjustment=${price}`);

    // Invert if requested
    if (invert) {
      price = 1 / price;
      console.log(`Inverted price=${price}`);
    }

    // Format with appropriate precision
    if (!Number.isFinite(price)) return "N/A";
    return price.toFixed(6);
  } catch (error) {
    console.error("Error calculating price from tick:", error);
    return "N/A";
  }
}

console.log("\n--- Testing tick to price ---");
mockTickScenarios.forEach(scenario => {
  console.log(`\nScenario: ${scenario.description}`);
  const result = tickToPrice(
    scenario.tick,
    scenario.decimals0,
    scenario.decimals1
  );
  
  console.log(`Result: ${result}, Expected: ${scenario.expectedPrice}`);
  const resultNum = parseFloat(result);
  const expectedNum = scenario.expectedPrice;
  const percentDiff = Math.abs((resultNum - expectedNum) / expectedNum) * 100;
  console.log(`Percent difference: ${percentDiff}%`);
});

console.log("\n--- Testing tick to inverted price ---");
mockTickScenarios.forEach(scenario => {
  console.log(`\nScenario: ${scenario.description}`);
  const result = tickToPrice(
    scenario.tick,
    scenario.decimals0,
    scenario.decimals1,
    true // invert
  );
  
  console.log(`Result: ${result}, Expected: ${scenario.expectedInvertedPrice}`);
  const resultNum = parseFloat(result);
  const expectedNum = scenario.expectedInvertedPrice;
  const percentDiff = Math.abs((resultNum - expectedNum) / expectedNum) * 100;
  console.log(`Percent difference: ${percentDiff}%`);
});