// Global test setup
import { vi } from 'vitest';

// Set up environment variables if needed
// process.env.SOME_CONFIG = 'test_value';

// Mock modules that will be imported by our code
vi.mock('ethers', () => {
  return {
    ethers: {
      formatUnits: (value, decimals) => {
        return (Number(value) / Math.pow(10, decimals)).toString();
      },
      ZeroAddress: "0x0000000000000000000000000000000000000000"
    }
  };
});

vi.mock('../src/artifacts/contracts.js', () => {
  return {
    default: {
      bob: {
        addresses: {
          1: "0xb0b123456789abcdef0123456789abcdef012345",
          5: "0xb0b987654321fedcba0987654321fedcba09876"
        },
        abi: []
      },
      parris: {
        addresses: {
          1: "0xpar123456789abcdef0123456789abcdef012345",
          5: "0xpar987654321fedcba0987654321fedcba09876"
        },
        abi: []
      },
      fed: {
        addresses: {
          1: "0xfed123456789abcdef0123456789abcdef012345",
          5: "0xfed987654321fedcba0987654321fedcba09876"
        },
        abi: []
      }
    }
  };
});

// Add spy to console methods to suppress or capture output
global.consoleSpy = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {})
};