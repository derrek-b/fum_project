/**
 * PlatformAdapter Unit Tests
 *
 * Covers the abstract base class contract:
 * - Constructor validation (abstract guard + required argument checks)
 * - All abstract methods throw "<name> must be implemented by subclasses"
 * - Optional incentive-capability methods return safe no-op defaults
 */

import { describe, it, expect } from 'vitest';
import PlatformAdapter from '../../../src/adapters/PlatformAdapter.js';

// Minimal subclass that satisfies the constructor but overrides no abstract
// methods, so every method call hits the base implementation.
class ConcreteAdapter extends PlatformAdapter {
  constructor(chainId = 1337, platformId = 'test', platformName = 'Test Platform') {
    super(chainId, platformId, platformName);
  }
}

describe('PlatformAdapter - Unit Tests', () => {
  describe('constructor', () => {
    it('stores chainId, platformId, and platformName on the instance', () => {
      const adapter = new ConcreteAdapter(42161, 'uniswapV3', 'Uniswap V3');
      expect(adapter.chainId).toBe(42161);
      expect(adapter.platformId).toBe('uniswapV3');
      expect(adapter.platformName).toBe('Uniswap V3');
    });

    it('defaults supportsNativePools to false', () => {
      const adapter = new ConcreteAdapter();
      expect(adapter.supportsNativePools).toBe(false);
    });

    it('throws when PlatformAdapter is instantiated directly', () => {
      expect(() => new PlatformAdapter(1337, 'test', 'Test Platform'))
        .toThrow('Abstract class cannot be instantiated');
    });

    it('throws when chainId is missing', () => {
      // ConcreteAdapter's default-param would swallow `undefined`, so use a
      // subclass that forwards args verbatim to hit the base-class guard.
      class NoDefaults extends PlatformAdapter {
        constructor(c, p, n) { super(c, p, n); }
      }
      expect(() => new NoDefaults(undefined, 'test', 'Test Platform'))
        .toThrow('chainId must be a valid number');
    });

    it('throws when chainId is not a number', () => {
      expect(() => new ConcreteAdapter('1337', 'test', 'Test Platform'))
        .toThrow('chainId must be a valid number');
    });

    it('throws when platformId is empty', () => {
      expect(() => new ConcreteAdapter(1337, '', 'Test Platform'))
        .toThrow('platformId must be defined');
    });

    it('throws when platformName is empty', () => {
      expect(() => new ConcreteAdapter(1337, 'test', ''))
        .toThrow('platformName must be defined');
    });
  });

  describe('abstract methods — synchronous', () => {
    const adapter = new ConcreteAdapter();

    // [methodName, callFn] — callFn invokes the method on `adapter` with
    // minimal valid-shape args; the call must throw before using them.
    const syncMethods = [
      ['getSwapEventFilter',          (a) => a.getSwapEventFilter('0xpool')],
      ['parseSwapEvent',              (a) => a.parseSwapEvent({})],
      ['evaluatePriceMovement',       (a) => a.evaluatePriceMovement({}, 0, {}, {})],
      ['parseSwapReceipt',            (a) => a.parseSwapReceipt({}, [])],
      ['parseIncreaseLiquidityReceipt', (a) => a.parseIncreaseLiquidityReceipt({}, {})],
      ['sortTokens',                  (a) => a.sortTokens({}, {})],
      ['describePool',                (a) => a.describePool({})],
      ['getPositionRange',            (a) => a.getPositionRange({}, 5, 5)],
      ['extractPositionBounds',       (a) => a.extractPositionBounds({})],
      ['getPoolCurrent',              (a) => a.getPoolCurrent({})],
    ];

    it.each(syncMethods)('%s throws "must be implemented by subclasses"', (name, call) => {
      expect(() => call(adapter)).toThrow(`${name} must be implemented by subclasses`);
    });
  });

  describe('abstract methods — async', () => {
    const adapter = new ConcreteAdapter();

    const asyncMethods = [
      ['getPositionsForVDS',          (a) => a.getPositionsForVDS('0xvault', {})],
      ['getPositionsForDisplay',      (a) => a.getPositionsForDisplay('0xowner', {})],
      ['refreshPositionForDisplay',   (a) => a.refreshPositionForDisplay('1', {})],
      ['getPositionById',             (a) => a.getPositionById('1', {})],
      ['getAccruedFeesUSD',           (a) => a.getAccruedFeesUSD({}, {}, {})],
      ['generateClaimFeesData',       (a) => a.generateClaimFeesData({})],
      ['evaluatePositionRange',       (a) => a.evaluatePositionRange({}, {})],
      ['calculateTokenAmounts',       (a) => a.calculateTokenAmounts({}, {}, {}, {}, {})],
      ['generateRemoveLiquidityData', (a) => a.generateRemoveLiquidityData({})],
      ['generateAddLiquidityData',    (a) => a.generateAddLiquidityData({})],
      ['getOptimalTokenRatio',        (a) => a.getOptimalTokenRatio({})],
      ['generateCreatePositionData',  (a) => a.generateCreatePositionData({})],
      ['batchSwapTransactions',       (a) => a.batchSwapTransactions([], {})],
      ['parseClosureReceipt',         (a) => a.parseClosureReceipt({}, {})],
      ['parseCollectReceipt',         (a) => a.parseCollectReceipt({}, {})],
      ['getBestSwapQuote',            (a) => a.getBestSwapQuote({})],
      ['getRequiredApprovals',        (a) => a.getRequiredApprovals('swap', '0xvault', [], {})],
      ['selectBestPool',              (a) => a.selectBestPool('WETH', 'USDC', {}, 42161)],
      ['getPoolData',                 (a) => a.getPoolData('0xpool', {})],
    ];

    it.each(asyncMethods)('%s rejects with "must be implemented by subclasses"', async (name, call) => {
      await expect(call(adapter)).rejects.toThrow(`${name} must be implemented by subclasses`);
    });
  });

  describe('optional incentive methods — default no-op implementations', () => {
    const adapter = new ConcreteAdapter();

    it('getPoolIncentives returns { active: false, programs: [] }', async () => {
      const result = await adapter.getPoolIncentives('0xpool', {}, {});
      expect(result).toEqual({ active: false, programs: [] });
    });

    it('getIncentivePreCloseTransactions returns an empty array', async () => {
      const result = await adapter.getIncentivePreCloseTransactions({}, { programs: [] }, {});
      expect(result).toEqual([]);
    });

    it('getIncentivePostCreateTransactions returns an empty array', async () => {
      const result = await adapter.getIncentivePostCreateTransactions('1', { programs: [] }, {});
      expect(result).toEqual([]);
    });

    it('getIncentiveClaimTransactions returns an empty array', async () => {
      const result = await adapter.getIncentiveClaimTransactions('0xvault', '0xpool', {}, {});
      expect(result).toEqual([]);
    });
  });
});
