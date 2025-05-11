// Mock data for formatHelpers tests

/**
 * Mock prices for testing formatPrice
 */
export const mockPrices = [
  { value: 0, expected: "0" },
  { value: 0.00005, expected: "<0.0001" },
  { value: 0.0005, expected: "0.000500" },
  { value: 0.005, expected: "0.00500" },
  { value: 0.05, expected: "0.05000" },
  { value: 0.5, expected: "0.5000" },
  { value: 5, expected: "5.00" },
  { value: 50, expected: "50.00" },
  { value: 500, expected: "500" },
  { value: 5000, expected: "5,000" },
  { value: 5000000, expected: "5.00e+6" },
  { value: NaN, expected: "N/A" },
  { value: Infinity, expected: "N/A" },
  { value: null, expected: "N/A" },
  { value: undefined, expected: "N/A" }
];

/**
 * Mock data for testing formatUnits
 */
export const mockTokenAmounts = [
  {
    description: "Zero amount",
    value: 0n,
    decimals: 18,
    expected: "0"
  },
  {
    description: "1 whole unit with 18 decimals (1 ETH)",
    value: 1000000000000000000n,
    decimals: 18,
    expected: "1"
  },
  {
    description: "Fractional amount with 18 decimals (0.5 ETH)",
    value: 500000000000000000n,
    decimals: 18,
    expected: "0.5"
  },
  {
    description: "1 whole unit with 6 decimals (1 USDC)",
    value: 1000000n,
    decimals: 6,
    expected: "1"
  },
  {
    description: "Fractional amount with 6 decimals (0.5 USDC)",
    value: 500000n,
    decimals: 6,
    expected: "0.5"
  },
  {
    description: "Amount with trailing zeros in fractional part",
    value: 1230000000000000000n,
    decimals: 18,
    expected: "1.23"
  },
  {
    description: "Very small amount (< 0.000001 ETH)",
    value: 100000000000n,
    decimals: 18,
    expected: "0.0000001"
  },
  {
    description: "Very large amount",
    value: 123456789000000000000000000n,
    decimals: 18,
    expected: "123456789"
  }
];

/**
 * Mock data for testing formatFeeDisplay
 */
export const mockFees = [
  { value: 0, expected: "0" },
  { value: 0.00005, expected: "< 0.0001" },
  { value: 0.0005, expected: "0.0005" },
  { value: 0.5, expected: "0.5" },
  { value: 0.5000, expected: "0.5" },
  { value: 0.5600, expected: "0.56" },
  { value: 1.2340, expected: "1.234" },
  { value: 1.23400, expected: "1.234" },
  { value: "0.5678", expected: "0.5678" },
  { value: "1.0000", expected: "1" }
];

/**
 * Mock data for testing formatTimestamp
 */
export const mockTimestamps = [
  {
    description: "Unix timestamp in seconds (2023-05-15 14:30:00 UTC)",
    value: 1684160400,
    expected: /May 15, 2023/
  },
  {
    description: "Unix timestamp in milliseconds (2023-05-15 14:30:00 UTC)",
    value: 1684160400000,
    expected: /May 15, 2023/
  },
  {
    description: "Current timestamp (runtime)",
    value: Math.floor(Date.now() / 1000),
    expected: new RegExp(new Date().getFullYear().toString())
  },
  {
    description: "Null timestamp",
    value: null,
    expected: "N/A"
  },
  {
    description: "Invalid timestamp",
    value: "not-a-timestamp",
    expected: "Invalid Date"
  }
];