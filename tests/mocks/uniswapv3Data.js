// Mock data for UniswapV3Adapter tests
export const mockTokenData = {
  token0: {
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6
  },
  token1: {
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18
  }
};

export const mockPosition = {
  id: "123456",
  poolAddress: "0x1234567890123456789012345678901234567890",
  tickLower: 74000, // Approximately 1430 USDC per ETH
  tickUpper: 78000, // Approximately 2260 USDC per ETH
  liquidity: 1000000000000,
  feeGrowthInside0LastX128: "100000000000000000000",
  feeGrowthInside1LastX128: "200000000000000000000",
  tokensOwed0: 500000,
  tokensOwed1: 100000000000000,
  platform: "uniswapV3"
};

export const mockPoolData = {
  "0x1234567890123456789012345678901234567890": {
    poolAddress: "0x1234567890123456789012345678901234567890",
    token0: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC
    token1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    fee: 3000,
    sqrtPriceX96: "1771845812128452722853735", // Approximately 1800 USDC per ETH
    tick: 76000, // Roughly in between the position's range (~1800 USDC/ETH)
    liquidity: "1500000000000",
    feeGrowthGlobal0X128: "300000000000000000000",
    feeGrowthGlobal1X128: "400000000000000000000",
    ticks: {
      "74000": {
        feeGrowthOutside0X128: "50000000000000000000",
        feeGrowthOutside1X128: "60000000000000000000",
        initialized: true
      },
      "78000": {
        feeGrowthOutside0X128: "70000000000000000000",
        feeGrowthOutside1X128: "80000000000000000000",
        initialized: true
      }
    }
  }
};

// These scenarios test the sqrtPriceX96 to price conversion with mathematically precise values.
// For sqrtPriceX96, the formula is: price = (sqrtPriceX96/(2^96))^2, adjusted for decimals.
export const mockSqrtPriceScenarios = [
  {
    description: "sqrtPriceX96 of 2^96 (equal decimals) = 1:1 price",
    // 2^96 is the special value where price = 1, because (2^96/(2^96))^2 = 1
    sqrtPriceX96: "79228162514264337593543950336", // 2^96
    decimals0: 18,  // Both tokens have 18 decimals
    decimals1: 18,  // No decimal adjustment needed
    expectedPrice: 1,           // 1:1 exchange rate
    expectedInvertedPrice: 1    // Same when inverted
  },
  {
    description: "sqrtPriceX96 of 2^96 with decimal adjustment (6, 18)",
    // 2^96 gives price = 1, then adjusted for 12 decimal places difference
    sqrtPriceX96: "79228162514264337593543950336", // 2^96
    decimals0: 6,   // Like USDC
    decimals1: 18,  // Like ETH
    expectedPrice: 1000000000000,  // 10^12 due to decimal difference
    expectedInvertedPrice: 0.000000000001  // 10^-12 when inverted
  },
  {
    description: "sqrtPriceX96 of 2^96 * sqrt(2) for price = 2",
    // Math: (2^96 * sqrt(2)/(2^96))^2 = 2
    sqrtPriceX96: "112025696773839094262579857408", // 2^96 * sqrt(2)
    decimals0: 18,  // Both tokens have 18 decimals
    decimals1: 18,
    expectedPrice: 2,           // 2:1 exchange rate
    expectedInvertedPrice: 0.5  // 1/2 when inverted
  }
];

// These scenarios test the tick to price conversion function with known tick values and their corresponding prices.
// The relationship is defined by the Uniswap V3 formula: price = 1.0001^tick.
export const mockTickScenarios = [
  {
    description: "Tick 0 with equal decimals (18, 18) = 1:1 price",
    tick: 0,
    decimals0: 18,  // Both tokens have 18 decimals
    decimals1: 18,
    expectedPrice: 1,           // 1:1 exchange rate
    expectedInvertedPrice: 1    // Same when inverted
  },
  {
    description: "Tick 0 with different decimals (6, 18) = 10^12 price ratio",
    tick: 0,
    decimals0: 6,   // Like USDC
    decimals1: 18,  // Like ETH
    expectedPrice: 1000000000000,  // 10^12 due to decimal difference
    expectedInvertedPrice: 0.000000000001  // 10^-12 when inverted
  },
  {
    description: "Tick 1000 with equal decimals (18, 18) tests the 1.0001^tick formula",
    tick: 1000,
    decimals0: 18,
    decimals1: 18,
    expectedPrice: 1.1051,     // Approximately 1.0001^1000 ≈ 1.1051
    expectedInvertedPrice: 0.9049  // 1/1.1051 ≈ 0.9049
  }
];

export const mockFeeCalculationData = {
  position: {
    liquidity: "1000000000000",
    feeGrowthInside0LastX128: "100000000000000000000",
    feeGrowthInside1LastX128: "200000000000000000000",
    tokensOwed0: "500000",
    tokensOwed1: "100000000000000"
  },
  currentTick: 76000, // Updated to match our new tick range
  feeGrowthGlobal0X128: "300000000000000000000",
  feeGrowthGlobal1X128: "400000000000000000000",
  tickLower: {
    feeGrowthOutside0X128: "50000000000000000000",
    feeGrowthOutside1X128: "60000000000000000000",
    initialized: true
  },
  tickUpper: {
    feeGrowthOutside0X128: "70000000000000000000",
    feeGrowthOutside1X128: "80000000000000000000",
    initialized: true
  },
  token0: {
    symbol: "USDC",
    decimals: 6
  },
  token1: {
    symbol: "WETH",
    decimals: 18
  }
};

export const mockAdapterConfig = {
  1: {  // Mainnet
    platformAddresses: {
      uniswapV3: {
        factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"
      }
    }
  },
  5: {  // Goerli
    platformAddresses: {
      uniswapV3: {
        factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"
      }
    }
  }
};