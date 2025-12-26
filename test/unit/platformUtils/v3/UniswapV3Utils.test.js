/**
 * @fileoverview Unit tests for UniswapV3Utils
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import UniswapV3Utils from '../../../../src/platformUtils/v3/UniswapV3Utils.js';

describe('UniswapV3Utils', () => {
  describe('PLATFORM_ID', () => {
    it('should export correct platform ID', () => {
      expect(UniswapV3Utils.PLATFORM_ID).toBe('uniswapV3');
    });
  });

  describe('evaluatePositionRange', () => {
    let mockAdapter;
    let mockProvider;

    beforeEach(() => {
      mockAdapter = {
        getCurrentTick: vi.fn()
      };
      mockProvider = {};
    });

    describe('validation', () => {
      it('should throw if position missing tickLower', async () => {
        const position = { tickUpper: 100, pool: '0x123' };

        await expect(
          UniswapV3Utils.evaluatePositionRange(position, {
            adapter: mockAdapter,
            provider: mockProvider
          })
        ).rejects.toThrow('Position missing tick range data');
      });

      it('should throw if position missing tickUpper', async () => {
        const position = { tickLower: 0, pool: '0x123' };

        await expect(
          UniswapV3Utils.evaluatePositionRange(position, {
            adapter: mockAdapter,
            provider: mockProvider
          })
        ).rejects.toThrow('Position missing tick range data');
      });

      it('should throw if position missing pool', async () => {
        const position = { tickLower: 0, tickUpper: 100 };

        await expect(
          UniswapV3Utils.evaluatePositionRange(position, {
            adapter: mockAdapter,
            provider: mockProvider
          })
        ).rejects.toThrow('Position missing pool address');
      });

      it('should throw if tick range is invalid (lower >= upper)', async () => {
        const position = { tickLower: 100, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(100);

        await expect(
          UniswapV3Utils.evaluatePositionRange(position, {
            adapter: mockAdapter,
            provider: mockProvider
          })
        ).rejects.toThrow('Invalid tick range');
      });
    });

    describe('in-range detection', () => {
      it('should return inRange=true when current tick is within bounds', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(50);

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.inRange).toBe(true);
        expect(result.currentTick).toBe(50);
      });

      it('should return inRange=true when at lower bound', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(0);

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.inRange).toBe(true);
      });

      it('should return inRange=true when at upper bound', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(100);

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.inRange).toBe(true);
      });

      it('should return inRange=false when below lower bound', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(-10);

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.inRange).toBe(false);
      });

      it('should return inRange=false when above upper bound', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(110);

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.inRange).toBe(false);
      });
    });

    describe('distance calculations', () => {
      it('should return correct distances when centered (50%)', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(50);

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.distanceToUpper).toBeCloseTo(0.5, 5);
        expect(result.distanceToLower).toBeCloseTo(0.5, 5);
      });

      it('should return correct distances when close to upper', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(95);

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.distanceToUpper).toBeCloseTo(0.05, 5);
        expect(result.distanceToLower).toBeCloseTo(0.95, 5);
      });

      it('should return correct distances when close to lower', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(5);

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.distanceToUpper).toBeCloseTo(0.95, 5);
        expect(result.distanceToLower).toBeCloseTo(0.05, 5);
      });
    });

    describe('centeredness calculation', () => {
      it('should return centeredness=0.5 when perfectly centered', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(50);

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.centeredness).toBeCloseTo(0.5, 5);
      });

      it('should return centeredness=0 when at lower bound', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(0);

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.centeredness).toBe(0);
      });

      it('should return centeredness=1 when at upper bound', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(100);

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.centeredness).toBe(1);
      });

      it('should clamp centeredness to 0-1 range when out of bounds', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(150); // beyond upper

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.centeredness).toBe(1); // clamped to max
      });
    });

    describe('negative tick values', () => {
      it('should handle negative tick ranges correctly', async () => {
        const position = { tickLower: -100, tickUpper: 0, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(-50); // centered

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.inRange).toBe(true);
        expect(result.centeredness).toBeCloseTo(0.5, 5);
        expect(result.distanceToUpper).toBeCloseTo(0.5, 5);
        expect(result.distanceToLower).toBeCloseTo(0.5, 5);
      });

      it('should handle mixed positive/negative tick ranges', async () => {
        const position = { tickLower: -50, tickUpper: 50, pool: '0x123' };
        mockAdapter.getCurrentTick.mockResolvedValue(0); // centered

        const result = await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(result.inRange).toBe(true);
        expect(result.centeredness).toBeCloseTo(0.5, 5);
      });
    });

    describe('adapter integration', () => {
      it('should call adapter.getCurrentTick with correct parameters', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0xPoolAddress' };
        mockAdapter.getCurrentTick.mockResolvedValue(50);

        await UniswapV3Utils.evaluatePositionRange(position, {
          adapter: mockAdapter,
          provider: mockProvider
        });

        expect(mockAdapter.getCurrentTick).toHaveBeenCalledWith('0xPoolAddress', mockProvider);
        expect(mockAdapter.getCurrentTick).toHaveBeenCalledTimes(1);
      });

      it('should propagate adapter errors', async () => {
        const position = { tickLower: 0, tickUpper: 100, pool: '0x123' };
        mockAdapter.getCurrentTick.mockRejectedValue(new Error('RPC error'));

        await expect(
          UniswapV3Utils.evaluatePositionRange(position, {
            adapter: mockAdapter,
            provider: mockProvider
          })
        ).rejects.toThrow('RPC error');
      });
    });
  });
});
