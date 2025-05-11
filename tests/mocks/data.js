// Sample strategy and pool data for tests - Using values from the moderate template
export const mockStrategyParams = {
  bobStrategy: [
    500,   // targetRangeUpper (5.00% above current price)
    500,   // targetRangeLower (5.00% below current price)
    150,   // rebalanceThresholdUpper (1.50% from upper range)
    150,   // rebalanceThresholdLower (1.50% from lower range)
    true,  // feeReinvestment
    5000,  // reinvestmentTrigger ($50.00)
    8000,  // reinvestmentRatio (80.00%)
    50,    // maxSlippage (0.50%)
    1500,  // emergencyExitTrigger (15.00%)
    8000   // maxUtilization (80.00%)
  ],

  parrisStrategy: [
    500,   // targetRangeUpper (5.00% above current price)
    500,   // targetRangeLower (5.00% below current price)
    150,   // rebalanceThresholdUpper (1.50% from upper range)
    150,   // rebalanceThresholdLower (1.50% from lower range)
    true,  // feeReinvestment
    5000,  // reinvestmentTrigger ($50.00)
    8000,  // reinvestmentRatio (80.00%)
    50,    // maxSlippage (0.50%)
    1500,  // emergencyExitTrigger (15.00%)
    8000,  // maxVaultUtilization (80.00%)
    true,  // adaptiveRanges
    3,     // rebalanceCountThresholdHigh
    1,     // rebalanceCountThresholdLow
    7,     // adaptiveTimeframeHigh (in days)
    7,     // adaptiveTimeframeLow (in days)
    2000,  // rangeAdjustmentPercentHigh (20.00%)
    1500,  // thresholdAdjustmentPercentHigh (15.00%)
    2000,  // rangeAdjustmentPercentLow (20.00%)
    1500,  // thresholdAdjustmentPercentLow (15.00%)
    0,     // oracleSource (DEX Price)
    100,   // priceDeviationTolerance (1.00%)
    3000,  // maxPositionSizePercent (30.00%)
    10000, // minPositionSize ($100.00)
    2000,  // targetUtilization (20.00%)
    0,     // platformSelectionCriteria (Highest TVL)
    10000000  // minPoolLiquidity ($100,000.00)
  ],

  fedStrategy: [
    50,    // targetRange (0.50% around current price - using stablecoin template values)
    20,    // rebalanceThreshold (0.20% from range boundaries)
    true,  // feeReinvestment
    10     // maxSlippage (0.10%)
  ]
};

export const mockPositions = [
  {
    id: "123456",
    poolAddress: "0x1234567890123456789012345678901234567890",
    liquidity: 1000000,
    platform: "uniswapV3"
  },
  {
    id: "234567",
    poolAddress: "0x2345678901234567890123456789012345678901",
    liquidity: 2000000,
    platform: "uniswapV3"
  }
];

export const mockPoolData = {
  "0x1234567890123456789012345678901234567890": {
    token0: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC
    token1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    fee: 3000,
    tick: 202000,
  },
  "0x2345678901234567890123456789012345678901": {
    token0: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // WBTC
    token1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    fee: 500,
    tick: 102000,
  }
};

export const mockTokenData = {
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831": { // USDC
    symbol: "USDC",
    decimals: 6,
    name: "USD Coin"
  },
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": { // WETH
    symbol: "WETH",
    decimals: 18,
    name: "Wrapped Ether"
  },
  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": { // WBTC
    symbol: "WBTC",
    decimals: 8,
    name: "Wrapped Bitcoin"
  }
};