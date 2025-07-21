/**
 * Format Helpers Unit Tests
 *
 * Tests for formatting utilities and display functions
 */

import { describe, it, expect } from 'vitest';
import { formatPrice, formatFeeDisplay, formatTimestamp } from '../../../src/helpers/formatHelpers.js';

describe('Format Helpers', () => {
  describe('formatPrice', () => {
    describe('Success Cases', () => {
      it('should format zero correctly', () => {
        expect(formatPrice(0)).toBe('0');
      });

      it('should format very small prices with threshold', () => {
        expect(formatPrice(0.00001)).toBe('<0.0001');
        expect(formatPrice(0.00005)).toBe('<0.0001');
        expect(formatPrice(0.00009)).toBe('<0.0001');
      });

      it('should format small prices (0.0001 to 0.001) with 6 decimals', () => {
        expect(formatPrice(0.0001)).toBe('0.000100');
        expect(formatPrice(0.0005)).toBe('0.000500');
        expect(formatPrice(0.0009)).toBe('0.000900');
      });

      it('should format medium-small prices (0.001 to 0.1) with 5 decimals', () => {
        expect(formatPrice(0.001)).toBe('0.00100');
        expect(formatPrice(0.005)).toBe('0.00500');
        expect(formatPrice(0.05)).toBe('0.05000');
        expect(formatPrice(0.099)).toBe('0.09900');
      });

      it('should format prices (0.1 to 1000) with 4 decimals', () => {
        expect(formatPrice(0.1)).toBe('0.1000');
        expect(formatPrice(0.5)).toBe('0.5000');
        expect(formatPrice(0.9999)).toBe('0.9999');
        expect(formatPrice(1)).toBe('1.0000');
        expect(formatPrice(10)).toBe('10.0000');
        expect(formatPrice(100)).toBe('100.0000');
        expect(formatPrice(999.9999)).toBe('999.9999');
      });

      it('should format standard prices (1000 to 999,999) with 2 decimals', () => {
        expect(formatPrice(1000)).toBe('1000.00');
        expect(formatPrice(1234.56)).toBe('1234.56');
        expect(formatPrice(999999)).toBe('999999.00');
      });

      it('should format millions with M abbreviation', () => {
        expect(formatPrice(1000000)).toBe('1.00M');
        expect(formatPrice(1500000)).toBe('1.50M');
        expect(formatPrice(5000000)).toBe('5.00M');
        expect(formatPrice(999999999)).toBe('1000.00M');
      });

      it('should format billions with B abbreviation', () => {
        expect(formatPrice(1000000000)).toBe('1.00B');
        expect(formatPrice(1500000000)).toBe('1.50B');
        expect(formatPrice(5000000000)).toBe('5.00B');
        expect(formatPrice(1234567890000)).toBe('1234.57B');
      });

      it('should handle decimal edge cases correctly', () => {
        expect(formatPrice(0.999999)).toBe('1.0000'); // Rounds to 1.0000 with 4 decimals
        expect(formatPrice(999.999)).toBe('999.9990'); // Under 1000, gets 4 decimals  
        expect(formatPrice(999999.999)).toBe('1000000.00'); // Rounds up to 1M, gets 2 decimals
      });
    });

    describe('Validation Cases', () => {
      it('should handle very large positive numbers', () => {
        expect(formatPrice(Number.MAX_SAFE_INTEGER)).toContain('B');
        expect(formatPrice(1e15)).toBe('1000000.00B');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for negative prices', () => {
        expect(() => formatPrice(-1)).toThrow('Price cannot be negative');
        expect(() => formatPrice(-0.5)).toThrow('Price cannot be negative');
        expect(() => formatPrice(-1000)).toThrow('Price cannot be negative');
        expect(() => formatPrice(-0.0001)).toThrow('Price cannot be negative');
      });

      it('should throw error for non-finite values', () => {
        expect(() => formatPrice(NaN)).toThrow('Price must be a finite number');
        expect(() => formatPrice(Infinity)).toThrow('Price must be a finite number');
        expect(() => formatPrice(-Infinity)).toThrow('Price must be a finite number');
      });

      it('should throw error for null and undefined', () => {
        expect(() => formatPrice(null)).toThrow('Price must be a finite number');
        expect(() => formatPrice(undefined)).toThrow('Price must be a finite number');
      });

      it('should handle edge floating point precision issues', () => {
        // Test values that might cause floating point precision issues
        expect(formatPrice(0.1 + 0.2)).toBe('0.3000'); // Should handle 0.30000000000000004
        expect(formatPrice(1.005)).toBe('1.0050'); // Under 1000, gets 4 decimals
      });
    });

    describe('Boundary Testing', () => {
      it('should test exact boundary values', () => {
        // Test exact boundaries between formatting rules
        expect(formatPrice(0.0001)).toBe('0.000100'); // Exactly at small threshold
        expect(formatPrice(0.001)).toBe('0.00100'); // Boundary between 6 and 5 decimals
        expect(formatPrice(0.1)).toBe('0.1000'); // Boundary between 5 and 4 decimals
        expect(formatPrice(1000)).toBe('1000.00'); // Boundary between 4 and 2 decimals
        expect(formatPrice(1000000)).toBe('1.00M'); // Boundary to millions
        expect(formatPrice(1000000000)).toBe('1.00B'); // Boundary to billions
      });

      it('should test values just below boundaries', () => {
        expect(formatPrice(0.0000999)).toBe('<0.0001');
        expect(formatPrice(0.0009999)).toBe('0.001000');
        expect(formatPrice(0.09999)).toBe('0.09999');
        expect(formatPrice(999.9999)).toBe('999.9999'); // Just under 1000 boundary
        expect(formatPrice(999999.99)).toBe('999999.99'); // Just under 1M boundary  
        expect(formatPrice(999999999.99)).toBe('1000.00M'); // Just under 1B boundary
      });
    });
  });

  describe('formatFeeDisplay', () => {
    describe('Success Cases', () => {
      it('should format zero fee correctly', () => {
        expect(formatFeeDisplay(0)).toBe('0');
      });

      it('should format very small fees with threshold', () => {
        expect(formatFeeDisplay(0.000099999)).toBe('< 0.0001');
        expect(formatFeeDisplay(0.00005)).toBe('< 0.0001');
        expect(formatFeeDisplay(0.00001)).toBe('< 0.0001');
        expect(formatFeeDisplay(0.0000001)).toBe('< 0.0001');
      });

      it('should format fees at exact threshold', () => {
        expect(formatFeeDisplay(0.0001)).toBe('0.0001');
      });

      it('should format normal fees with trailing zeros removed', () => {
        expect(formatFeeDisplay(1.10)).toBe('1.1');
        expect(formatFeeDisplay(0.0300)).toBe('0.03');
        expect(formatFeeDisplay(0.1000)).toBe('0.1');
        expect(formatFeeDisplay(2.5000)).toBe('2.5');
        expect(formatFeeDisplay(0.0010)).toBe('0.001');
      });

      it('should format fees without trailing zeros correctly', () => {
        expect(formatFeeDisplay(0.1234)).toBe('0.1234');
        expect(formatFeeDisplay(1.2345)).toBe('1.2345');
        expect(formatFeeDisplay(0.0001)).toBe('0.0001');
      });

      it('should handle edge cases around threshold', () => {
        expect(formatFeeDisplay(0.00009999)).toBe('< 0.0001');
        expect(formatFeeDisplay(0.0001001)).toBe('0.0001');
      });

      it('should format larger fees correctly', () => {
        expect(formatFeeDisplay(10)).toBe('10');
        expect(formatFeeDisplay(100.5)).toBe('100.5');
        expect(formatFeeDisplay(1000.25)).toBe('1000.25');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for negative fees', () => {
        expect(() => formatFeeDisplay(-1)).toThrow('Fee cannot be negative');
        expect(() => formatFeeDisplay(-0.5)).toThrow('Fee cannot be negative');
        expect(() => formatFeeDisplay(-0.0001)).toThrow('Fee cannot be negative');
        expect(() => formatFeeDisplay(-1000)).toThrow('Fee cannot be negative');
      });

      it('should throw error for non-finite values', () => {
        expect(() => formatFeeDisplay(NaN)).toThrow('Fee must be a finite number');
        expect(() => formatFeeDisplay(Infinity)).toThrow('Fee must be a finite number');
        expect(() => formatFeeDisplay(-Infinity)).toThrow('Fee must be a finite number');
      });

      it('should throw error for null and undefined', () => {
        expect(() => formatFeeDisplay(null)).toThrow('Fee must be a finite number');
        expect(() => formatFeeDisplay(undefined)).toThrow('Fee must be a finite number');
      });
    });

    describe('Regex Behavior Testing', () => {
      it('should remove trailing zeros after decimal point', () => {
        expect(formatFeeDisplay(1.2000)).toBe('1.2');
        expect(formatFeeDisplay(0.5000)).toBe('0.5');
        expect(formatFeeDisplay(10.0000)).toBe('10');
      });

      it('should remove decimal point when all decimals are zero', () => {
        expect(formatFeeDisplay(5.0000)).toBe('5');
        expect(formatFeeDisplay(100.0000)).toBe('100');
      });

      it('should preserve significant trailing digits', () => {
        expect(formatFeeDisplay(1.2340)).toBe('1.234');
        expect(formatFeeDisplay(0.1020)).toBe('0.102');
      });
    });
  });

  describe('formatTimestamp', () => {
    describe('Success Cases', () => {
      it('should format timestamp in seconds correctly', () => {
        // March 25, 2023 timestamp in seconds
        const result = formatTimestamp(1679750400);
        expect(result).toContain('Mar');
        expect(result).toContain('25');
        expect(result).toContain('2023');
      });

      it('should format timestamp in milliseconds correctly', () => {
        // March 25, 2023 timestamp in milliseconds
        const result = formatTimestamp(1679750400000);
        expect(result).toContain('Mar');
        expect(result).toContain('25');
        expect(result).toContain('2023');
      });

      it('should handle timestamps at the 10B threshold', () => {
        // Just below threshold (seconds)
        const secondsResult = formatTimestamp(9999999999);
        expect(secondsResult).toContain('2286');
        
        // Just above threshold (milliseconds)
        const msResult = formatTimestamp(10000000001);
        expect(msResult).toContain('1970');
      });

      it('should format recent timestamps correctly', () => {
        const now = Date.now();
        const result = formatTimestamp(now);
        const currentYear = new Date().getFullYear();
        expect(result).toContain(currentYear.toString());
      });

      it('should format very early Unix timestamps', () => {
        // Use a timestamp that's definitely in 1970 for all timezones
        // Jan 2, 1970 00:00:00 UTC = 86400 seconds
        const result = formatTimestamp(86400);
        expect(result).toContain('1970');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for negative timestamps', () => {
        expect(() => formatTimestamp(-1)).toThrow('Timestamp must be greater than 0');
        expect(() => formatTimestamp(-1000)).toThrow('Timestamp must be greater than 0');
        expect(() => formatTimestamp(-1679750400)).toThrow('Timestamp must be greater than 0');
      });

      it('should throw error for zero timestamp', () => {
        expect(() => formatTimestamp(0)).toThrow('Timestamp must be greater than 0');
      });

      it('should throw error for non-finite values', () => {
        expect(() => formatTimestamp(NaN)).toThrow('Timestamp must be a finite number');
        expect(() => formatTimestamp(Infinity)).toThrow('Timestamp must be a finite number');
        expect(() => formatTimestamp(-Infinity)).toThrow('Timestamp must be a finite number');
      });

      it('should throw error for null and undefined', () => {
        expect(() => formatTimestamp(null)).toThrow('Timestamp must be a finite number');
        expect(() => formatTimestamp(undefined)).toThrow('Timestamp must be a finite number');
      });

      it('should throw error for timestamps that create invalid dates', () => {
        // Number beyond JavaScript Date range
        expect(() => formatTimestamp(8640000000000001)).toThrow('Timestamp creates an invalid date');
        expect(() => formatTimestamp(Number.MAX_SAFE_INTEGER)).toThrow('Timestamp creates an invalid date');
      });
    });

    describe('Edge Cases', () => {
      it('should handle the exact 10B threshold', () => {
        const result = formatTimestamp(10000000000);
        // 10B ms = Nov 20, 1970
        expect(result).toContain('1970');
      });

      it('should handle maximum valid timestamp', () => {
        // Max valid date in JavaScript is ~273,000 years from epoch
        const maxValidTimestamp = 8640000000000000;
        const result = formatTimestamp(maxValidTimestamp);
        expect(result).toBeDefined();
        expect(result).not.toContain('Invalid');
      });

      it('should properly convert seconds to milliseconds', () => {
        // Test a known timestamp in both formats
        const secondsTimestamp = 1679750400;
        const msTimestamp = 1679750400000;
        
        const secondsResult = formatTimestamp(secondsTimestamp);
        const msResult = formatTimestamp(msTimestamp);
        
        expect(secondsResult).toBe(msResult);
      });
    });
  });
});