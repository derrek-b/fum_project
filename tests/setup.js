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

// Note: We no longer mock the contracts module so tests will use the actual contract artifacts

// Add spy to console methods to suppress or capture output
global.consoleSpy = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {})
};