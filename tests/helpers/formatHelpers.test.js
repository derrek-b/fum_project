import { describe, it, expect } from 'vitest';
import { 
  mockPrices, 
  mockTokenAmounts, 
  mockFees, 
  mockTimestamps 
} from '../mocks/formatHelpersData.js';

import {
  formatPrice,
  formatUnits,
  formatFeeDisplay,
  formatTimestamp
} from '../../src/helpers/formatHelpers.js';

describe('formatHelpers', () => {
  describe('formatPrice', () => {
    it('should format prices with appropriate precision', () => {
      for (const scenario of mockPrices) {
        const result = formatPrice(scenario.value);
        expect(result).toBe(scenario.expected);
      }
    });

    it('should handle null, undefined, and NaN values', () => {
      expect(formatPrice(null)).toBe('N/A');
      expect(formatPrice(undefined)).toBe('N/A');
      expect(formatPrice(NaN)).toBe('N/A');
    });

    it('should format very small prices correctly', () => {
      expect(formatPrice(0.00001)).toBe('<0.0001');
      expect(formatPrice(0.000099)).toBe('<0.0001');
    });

    it('should format very large prices with scientific notation', () => {
      const result = formatPrice(2000000);
      expect(result).toMatch(/^[0-9]+\.[0-9]+e\+[0-9]+$/);
    });
  });

  describe('formatUnits', () => {
    it('should format BigInt values with correct decimal places', () => {
      for (const scenario of mockTokenAmounts) {
        const result = formatUnits(scenario.value, scenario.decimals);
        expect(result).toBe(scenario.expected);
      }
    });

    it('should handle zero values', () => {
      expect(formatUnits(0n, 18)).toBe('0');
      expect(formatUnits(0n, 6)).toBe('0');
      expect(formatUnits(null, 18)).toBe('0');
    });

    it('should correctly handle integer values', () => {
      // 1 ETH
      expect(formatUnits(1000000000000000000n, 18)).toBe('1');
      // 100 ETH
      expect(formatUnits(100000000000000000000n, 18)).toBe('100');
    });

    it('should correctly handle decimal values with trailing zeros', () => {
      // 1.5 ETH
      expect(formatUnits(1500000000000000000n, 18)).toBe('1.5');
      // 1.50 ETH (should be formatted as 1.5)
      expect(formatUnits(1500000000000000000n, 18)).toBe('1.5');
    });

    it('should handle different decimal places', () => {
      // 1 USDC (6 decimals)
      expect(formatUnits(1000000n, 6)).toBe('1');
      // 1 USDT (6 decimals)
      expect(formatUnits(1000000n, 6)).toBe('1');
      // 1 WBTC (8 decimals)
      expect(formatUnits(100000000n, 8)).toBe('1');
    });
  });

  describe('formatFeeDisplay', () => {
    it('should format fees with at most 4 decimal places', () => {
      for (const scenario of mockFees) {
        const result = formatFeeDisplay(scenario.value);
        expect(result).toBe(scenario.expected);
      }
    });

    it('should display very small values as "< 0.0001"', () => {
      expect(formatFeeDisplay(0.00001)).toBe('< 0.0001');
      expect(formatFeeDisplay(0.00000001)).toBe('< 0.0001');
    });

    it('should convert string values correctly', () => {
      expect(formatFeeDisplay('0.1234')).toBe('0.1234');
      expect(formatFeeDisplay('1.2300')).toBe('1.23');
    });

    it('should display zero as "0"', () => {
      expect(formatFeeDisplay(0)).toBe('0');
      expect(formatFeeDisplay('0')).toBe('0');
      expect(formatFeeDisplay('0.0000')).toBe('0');
    });
  });

  describe('formatTimestamp', () => {
    it('should format timestamps correctly', () => {
      for (const scenario of mockTimestamps) {
        if (scenario.value === null || scenario.value === 'not-a-timestamp') {
          const result = formatTimestamp(scenario.value);
          expect(result).toBe(scenario.expected);
        } else {
          const result = formatTimestamp(scenario.value);
          expect(result).toMatch(scenario.expected);
        }
      }
    });

    it('should handle seconds-based timestamps', () => {
      // Using a timestamp that represents the same date regardless of timezone
      const timestamp = 1682899200; // April 30/May 1, 2023 depending on timezone
      const result = formatTimestamp(timestamp);

      // Instead of checking for specific date, check if it's a valid date format
      expect(result).toMatch(/\w{3} \d{1,2}, 2023/);
    });

    it('should handle millisecond-based timestamps', () => {
      // Using millisecond timestamp
      const timestamp = 1682899200000; // April 30/May 1, 2023 depending on timezone
      const result = formatTimestamp(timestamp);

      // Check for 2023 instead of specific date
      expect(result).toMatch(/2023/);
    });

    it('should return "N/A" for falsy values except 0', () => {
      expect(formatTimestamp(null)).toBe('N/A');
      expect(formatTimestamp(undefined)).toBe('N/A');
      expect(formatTimestamp('')).toBe('N/A');
    });

    it('should return "Invalid Date" for non-numeric strings', () => {
      expect(formatTimestamp('not-a-date')).toBe('Invalid Date');
    });
  });
});