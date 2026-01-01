/**
 * @fileoverview Unit tests for BabyStepsStrategy.prepareTokensForPosition
 *
 * Tests the token preparation logic including:
 * - Deficit calculation and coverage
 * - Three-phase swap generation (non-aligned, excess target, buffer)
 * - Event emission with proper tracking
 * - Error handling for uncovered deficits
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

// Mock ethers.Wallet to avoid provider validation issues in unit tests
vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      Wallet: vi.fn().mockImplementation(() => ({
        address: '0xMockSigner'
      })),
      utils: actual.ethers.utils,
      BigNumber: actual.ethers.BigNumber,
      constants: actual.ethers.constants
    }
  };
});

// Mock dependencies before importing
vi.mock('../../../../src/platformUtils/PlatformUtilsFactory.js', () => ({
  default: {
    getUtils: vi.fn()
  }
}));

vi.mock('../../../../src/utils/RetryHelper.js', () => ({
  retryRpcCall: vi.fn((fn) => fn())
}));

import BabyStepsStrategy from '../../../../src/strategies/babySteps/BabyStepsStrategy.js';
import PlatformUtilsFactory from '../../../../src/platformUtils/PlatformUtilsFactory.js';

describe('BabyStepsStrategy.prepareTokensForPosition', () => {
  let strategy;
  let mockAdapter;
  let mockPlatformUtils;
  let mockEventManager;
  let emittedEvents;

  // Test fixtures
  const token0Data = {
    symbol: 'WETH',
    address: '0xWETH',
    decimals: 18
  };

  const token1Data = {
    symbol: 'USDC',
    address: '0xUSDC',
    decimals: 6
  };

  const wbtcData = {
    symbol: 'WBTC',
    address: '0xWBTC',
    decimals: 8
  };

  const linkData = {
    symbol: 'LINK',
    address: '0xLINK',
    decimals: 18
  };

  beforeEach(() => {
    emittedEvents = [];

    // Mock event manager
    mockEventManager = {
      emit: vi.fn((eventName, data) => {
        emittedEvents.push({ eventName, data });
      }),
      subscribe: vi.fn()
    };

    // Mock adapter
    mockAdapter = {
      getBestSwapQuote: vi.fn(),
      getApprovalTarget: vi.fn().mockReturnValue('0xMockApprovalTarget')
    };

    // Mock platform utils
    mockPlatformUtils = {
      batchSwapTransactions: vi.fn()
    };
    PlatformUtilsFactory.getUtils.mockReturnValue(mockPlatformUtils);

    // Create strategy instance with minimal mocking
    strategy = Object.create(BabyStepsStrategy.prototype);
    strategy.eventManager = mockEventManager;
    strategy.adapters = new Map([['uniswapV3', mockAdapter]]);
    strategy.tokens = {
      WETH: token0Data,
      USDC: token1Data,
      WBTC: wbtcData,
      LINK: linkData
    };
    strategy.provider = {};
    strategy.chainId = 1;
    strategy.log = vi.fn();
    strategy.ensureApprovals = vi.fn().mockResolvedValue();
    // Add isWrapUnwrapPair from StrategyBase
    strategy.isWrapUnwrapPair = function(tokenIn, tokenOut) {
      const isWrap = tokenIn.isNative === true && tokenOut.symbol === 'WETH';
      const isUnwrap = tokenIn.symbol === 'WETH' && tokenOut.isNative === true;
      return { isWrap, isUnwrap, isWrapOrUnwrap: isWrap || isUnwrap };
    };
  });

  // ===========================================================================
  // 1. Sufficient Tokens (No Swaps Needed)
  // ===========================================================================
  describe('when vault has sufficient tokens', () => {
    const vault = {
      address: '0xVault',
      targetPlatforms: ['uniswapV3'],
      strategy: { strategyId: 'bob', platform: 'uniswapV3', parameters: { maxSlippage: 0.5 } },
      tokens: {
        WETH: '2000000000000000000', // 2 WETH
        USDC: '4000000000'           // 4000 USDC
      }
    };

    const quote = {
      token0Amount: '1000000000000000000', // 1 WETH required
      token1Amount: '2000000000'           // 2000 USDC required
    };

    it('should return empty swap arrays', async () => {
      const result = await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      expect(result.deficitSwaps).toHaveLength(0);
      expect(result.bufferSwaps).toHaveLength(0);
      expect(result.metadata.deficit).toHaveLength(0);
      expect(result.metadata.buffer).toHaveLength(0);
    });

    it('should emit TokenPreparationCompleted with preparationResult=sufficient_tokens', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      expect(emittedEvents).toHaveLength(1);
      const event = emittedEvents[0];
      expect(event.eventName).toBe('TokenPreparationCompleted');
      expect(event.data.preparationResult).toBe('sufficient_tokens');
      expect(event.data.swapTransactions).toHaveLength(0);
      expect(event.data.deficitSwapCount).toBe(0);
      expect(event.data.bufferSwapCount).toBe(0);
    });

    it('should report zero deficits in targetTokens', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.targetTokens.token0.deficit).toBe('0');
      expect(event.targetTokens.token1.deficit).toBe('0');
    });

    it('should have all phasesUsed as false', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.phasesUsed.nonAlignedForDeficit).toBe(false);
      expect(event.phasesUsed.excessTargetTokens).toBe(false);
      expect(event.phasesUsed.bufferSwaps).toBe(false);
    });

    it('should include correct vault and strategy info', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.vaultAddress).toBe('0xVault');
      expect(event.strategyId).toBe('bob');
      expect(event.platformId).toBe('uniswapV3');
    });
  });

  // ===========================================================================
  // 2. Phase 1: Non-Aligned Tokens Cover Deficits
  // ===========================================================================
  describe('when non-aligned tokens cover deficits (Phase 1)', () => {
    const vault = {
      address: '0xVault',
      targetPlatforms: ['uniswapV3'],
      strategy: { strategyId: 'bob', platform: 'uniswapV3', parameters: { maxSlippage: 0.5 } },
      tokens: {
        WETH: '0',                    // No WETH
        USDC: '0',                    // No USDC
        WBTC: '10000000'              // 0.1 WBTC (exactly enough, no remainder for buffer)
      }
    };

    const quote = {
      token0Amount: '1000000000000000000', // 1 WETH required
      token1Amount: '2000000000'           // 2000 USDC required
    };

    beforeEach(() => {
      // Mock EXACT_OUTPUT quote - uses exactly all WBTC available
      mockAdapter.getBestSwapQuote.mockImplementation(({ tokenOutAddress, isAmountIn }) => {
        if (!isAmountIn) {
          // EXACT_OUTPUT: return required input
          if (tokenOutAddress === token0Data.address) {
            return Promise.resolve({ amountIn: '5000000', amountOut: quote.token0Amount }); // 0.05 WBTC for 1 WETH
          }
          if (tokenOutAddress === token1Data.address) {
            return Promise.resolve({ amountIn: '5000000', amountOut: quote.token1Amount }); // 0.05 WBTC for 2000 USDC
          }
        }
        return Promise.resolve({ amountIn: '10000000', amountOut: '500000000000000000' });
      });

      // Mock batch swap transaction generation - deficit swaps first, then empty buffer swaps
      mockPlatformUtils.batchSwapTransactions
        .mockResolvedValueOnce({
          transactions: [
            { to: '0xRouter', data: '0xswap1', value: '0x00' },
            { to: '0xRouter', data: '0xswap2', value: '0x00' }
          ],
          metadata: [
            { tokenInSymbol: 'WBTC', tokenOutSymbol: 'WETH', quotedAmountIn: '5000000', quotedAmountOut: quote.token0Amount, isAmountIn: true },
            { tokenInSymbol: 'WBTC', tokenOutSymbol: 'USDC', quotedAmountIn: '5000000', quotedAmountOut: quote.token1Amount, isAmountIn: true }
          ]
        })
        .mockResolvedValueOnce({
          transactions: [],
          metadata: []
        });
    });

    it('should generate deficit swaps from non-aligned tokens', async () => {
      const result = await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      expect(result.deficitSwaps).toHaveLength(2);
      expect(result.bufferSwaps).toHaveLength(0);
    });

    it('should track non-aligned tokens used in event', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.nonAlignedTokensUsed).toContain('WBTC');
    });

    it('should set phasesUsed.nonAlignedForDeficit = true', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.phasesUsed.nonAlignedForDeficit).toBe(true);
      expect(event.phasesUsed.excessTargetTokens).toBe(false);
      expect(event.phasesUsed.bufferSwaps).toBe(false);
    });

    it('should emit event with preparationResult=swaps_generated', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.preparationResult).toBe('swaps_generated');
      expect(event.deficitSwapCount).toBe(2);
    });

    it('should correctly calculate deficits in event', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.targetTokens.token0.required).toBe(quote.token0Amount);
      expect(event.targetTokens.token0.available).toBe('0');
      expect(event.targetTokens.token0.deficit).toBe(quote.token0Amount);
    });
  });

  // ===========================================================================
  // 3. Phase 1: EXACT_INPUT Fallback
  // ===========================================================================
  describe('when EXACT_INPUT fallback is needed (insufficient input for EXACT_OUTPUT)', () => {
    const vault = {
      address: '0xVault',
      targetPlatforms: ['uniswapV3'],
      strategy: { strategyId: 'bob', platform: 'uniswapV3', parameters: { maxSlippage: 0.5 } },
      tokens: {
        WETH: '0',
        USDC: '0',
        WBTC: '1000000' // Only 0.01 WBTC (not enough)
      }
    };

    const quote = {
      token0Amount: '1000000000000000000', // 1 WETH required
      token1Amount: '2000000000'           // 2000 USDC required
    };

    beforeEach(() => {
      let callCount = 0;
      mockAdapter.getBestSwapQuote.mockImplementation(({ isAmountIn, amount }) => {
        callCount++;
        if (!isAmountIn) {
          // EXACT_OUTPUT: requires more than available
          return Promise.resolve({ amountIn: '50000000', amountOut: amount }); // Needs 0.5 WBTC
        }
        // EXACT_INPUT: use all available
        return Promise.resolve({ amountIn: amount, amountOut: '200000000000000000' }); // Gets 0.2 WETH
      });

      mockPlatformUtils.batchSwapTransactions.mockResolvedValue({
        transactions: [{ to: '0xRouter', data: '0xswap', value: '0x00' }],
        metadata: [{ tokenInSymbol: 'WBTC', tokenOutSymbol: 'WETH', quotedAmountIn: '1000000', quotedAmountOut: '200000000000000000', isAmountIn: true }]
      });
    });

    it('should fall back to EXACT_INPUT when insufficient input', async () => {
      // This will fail deficit verification but tests the fallback logic
      await expect(
        strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data)
      ).rejects.toThrow('Unable to cover deficits');

      // Verify getBestSwapQuote was called with both modes
      const calls = mockAdapter.getBestSwapQuote.mock.calls;
      expect(calls.some(c => c[0].isAmountIn === false)).toBe(true); // EXACT_OUTPUT attempted
      expect(calls.some(c => c[0].isAmountIn === true)).toBe(true);  // EXACT_INPUT fallback
    });
  });

  // ===========================================================================
  // 4. Phase 2: Excess Target Tokens Cover Deficits
  // ===========================================================================
  describe('when excess target tokens cover deficits (Phase 2)', () => {
    const vault = {
      address: '0xVault',
      targetPlatforms: ['uniswapV3'],
      strategy: { strategyId: 'bob', platform: 'uniswapV3', parameters: { maxSlippage: 0.5 } },
      tokens: {
        WETH: '0',                    // No WETH (deficit)
        USDC: '5000000000'            // 5000 USDC (excess to use)
      }
    };

    const quote = {
      token0Amount: '1000000000000000000', // 1 WETH required
      token1Amount: '2000000000'           // 2000 USDC required (have 3000 excess)
    };

    beforeEach(() => {
      mockAdapter.getBestSwapQuote.mockImplementation(({ isAmountIn }) => {
        if (!isAmountIn) {
          return Promise.resolve({ amountIn: '2500000000', amountOut: quote.token0Amount }); // 2500 USDC for 1 WETH
        }
        return Promise.resolve({ amountIn: '3000000000', amountOut: quote.token0Amount });
      });

      mockPlatformUtils.batchSwapTransactions.mockResolvedValue({
        transactions: [{ to: '0xRouter', data: '0xswap', value: '0x00' }],
        metadata: [{ tokenInSymbol: 'USDC', tokenOutSymbol: 'WETH', quotedAmountIn: '2500000000', quotedAmountOut: quote.token0Amount, isAmountIn: true }]
      });
    });

    it('should use excess token1 to cover token0 deficit', async () => {
      const result = await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      expect(result.deficitSwaps).toHaveLength(1);
    });

    it('should set phasesUsed.excessTargetTokens = true', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.phasesUsed.excessTargetTokens).toBe(true);
      expect(event.phasesUsed.nonAlignedForDeficit).toBe(false);
    });

    it('should NOT include target tokens in nonAlignedTokensUsed', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.nonAlignedTokensUsed).not.toContain('USDC');
      expect(event.nonAlignedTokensUsed).not.toContain('WETH');
    });
  });

  // ===========================================================================
  // 5. Phase 3: Buffer Swaps for Remaining Non-Aligned
  // ===========================================================================
  describe('when non-aligned tokens remain after deficit coverage (Phase 3)', () => {
    const vault = {
      address: '0xVault',
      targetPlatforms: ['uniswapV3'],
      strategy: { strategyId: 'bob', platform: 'uniswapV3', parameters: { maxSlippage: 0.5 } },
      tokens: {
        WETH: '1000000000000000000', // Sufficient
        USDC: '2000000000',          // Sufficient
        LINK: '10000000000000000000' // 10 LINK remaining (no deficit to cover)
      }
    };

    const quote = {
      token0Amount: '1000000000000000000',
      token1Amount: '2000000000'
    };

    beforeEach(() => {
      // Mock batch swap transaction generation - empty deficit swaps first, then buffer swaps
      mockPlatformUtils.batchSwapTransactions
        .mockResolvedValueOnce({
          transactions: [],
          metadata: []
        })
        .mockResolvedValueOnce({
          transactions: [
            { to: '0xRouter', data: '0xbuffer1', value: '0x00' },
            { to: '0xRouter', data: '0xbuffer2', value: '0x00' }
          ],
          metadata: [
            { tokenInSymbol: 'LINK', tokenOutSymbol: 'WETH', quotedAmountIn: '5000000000000000000', quotedAmountOut: '100000000000000000', isAmountIn: true },
            { tokenInSymbol: 'LINK', tokenOutSymbol: 'USDC', quotedAmountIn: '5000000000000000000', quotedAmountOut: '500000000', isAmountIn: true }
          ]
        });
    });

    it('should generate 50/50 buffer swaps', async () => {
      const result = await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      // No deficit swaps (sufficient tokens), only buffer swaps
      expect(result.deficitSwaps).toHaveLength(0);
      expect(result.bufferSwaps).toHaveLength(2);
    });

    it('should set phasesUsed.bufferSwaps = true', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.phasesUsed.bufferSwaps).toBe(true);
    });

    it('should report correct buffer swap count', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.bufferSwapCount).toBe(2);
      expect(event.deficitSwapCount).toBe(0);
    });
  });

  // ===========================================================================
  // 6. Multi-Phase Scenarios
  // ===========================================================================
  describe('when multiple phases are needed', () => {
    const vault = {
      address: '0xVault',
      targetPlatforms: ['uniswapV3'],
      strategy: { strategyId: 'bob', platform: 'uniswapV3', parameters: { maxSlippage: 0.5 } },
      tokens: {
        WETH: '0',                     // Deficit
        USDC: '3000000000',            // Has excess (3000, need 2000)
        WBTC: '5000000',               // 0.05 WBTC - covers partial deficit, no remainder
        LINK: '5000000000000000000'    // 5 LINK remaining for buffer
      }
    };

    const quote = {
      token0Amount: '1000000000000000000', // 1 WETH
      token1Amount: '2000000000'           // 2000 USDC
    };

    beforeEach(() => {
      // Phase 1: WBTC covers partial WETH deficit (0.5 WETH)
      // Phase 2: Excess USDC covers remaining (0.5 WETH)
      // Phase 3: LINK gets 50/50 buffer swaps
      mockAdapter.getBestSwapQuote.mockImplementation(({ tokenOutAddress, tokenInAddress, isAmountIn }) => {
        // LINK should NOT be used for deficit swaps - throw so it's skipped and remains for buffer
        if (tokenInAddress === linkData.address) {
          return Promise.reject(new Error('No liquidity for LINK deficit swap'));
        }

        if (!isAmountIn) {
          // EXACT_OUTPUT - needs more than available for WBTC
          if (tokenInAddress === wbtcData.address) {
            return Promise.resolve({ amountIn: '10000000', amountOut: '500000000000000000' }); // Needs 0.1 WBTC (more than 0.05 available)
          }
          // EXACT_OUTPUT for USDC->WETH
          return Promise.resolve({ amountIn: '1000000000', amountOut: '500000000000000000' });
        }
        // EXACT_INPUT fallback for WBTC (use all 0.05)
        if (tokenInAddress === wbtcData.address) {
          return Promise.resolve({ amountIn: '5000000', amountOut: '500000000000000000' }); // All WBTC -> 0.5 WETH
        }
        return Promise.resolve({ amountIn: '1000000000', amountOut: '500000000000000000' });
      });

      // Two calls to batchSwapTransactions - deficit and buffer
      mockPlatformUtils.batchSwapTransactions
        .mockResolvedValueOnce({
          transactions: [
            { to: '0xRouter', data: '0xdeficit1', value: '0x00' },
            { to: '0xRouter', data: '0xdeficit2', value: '0x00' }
          ],
          metadata: [
            { tokenInSymbol: 'WBTC', tokenOutSymbol: 'WETH', quotedAmountIn: '5000000', quotedAmountOut: '500000000000000000', isAmountIn: true },
            { tokenInSymbol: 'USDC', tokenOutSymbol: 'WETH', quotedAmountIn: '1000000000', quotedAmountOut: '500000000000000000', isAmountIn: true }
          ]
        })
        .mockResolvedValueOnce({
          transactions: [
            { to: '0xRouter', data: '0xbuffer1', value: '0x00' },
            { to: '0xRouter', data: '0xbuffer2', value: '0x00' }
          ],
          metadata: [
            { tokenInSymbol: 'LINK', tokenOutSymbol: 'WETH', quotedAmountIn: '2500000000000000000', quotedAmountOut: '50000000000000000', isAmountIn: true },
            { tokenInSymbol: 'LINK', tokenOutSymbol: 'USDC', quotedAmountIn: '2500000000000000000', quotedAmountOut: '250000000', isAmountIn: true }
          ]
        });
    });

    it('should use Phase 1 + Phase 2 + Phase 3', async () => {
      const result = await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      expect(result.deficitSwaps).toHaveLength(2);
      expect(result.bufferSwaps).toHaveLength(2);
    });

    it('should set multiple phasesUsed flags', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.phasesUsed.nonAlignedForDeficit).toBe(true);
      expect(event.phasesUsed.excessTargetTokens).toBe(true);
      expect(event.phasesUsed.bufferSwaps).toBe(true);
    });
  });

  // ===========================================================================
  // 7. Deficit Verification Failure
  // ===========================================================================
  describe('when deficits cannot be covered', () => {
    const vault = {
      address: '0xVault',
      targetPlatforms: ['uniswapV3'],
      strategy: { strategyId: 'bob', platform: 'uniswapV3', parameters: { maxSlippage: 0.5 } },
      tokens: {
        WETH: '0',  // Deficit, nothing to cover it
        USDC: '0'   // Deficit, nothing to cover it
      }
    };

    const quote = {
      token0Amount: '1000000000000000000',
      token1Amount: '2000000000'
    };

    it('should throw error with uncovered amounts', async () => {
      await expect(
        strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data)
      ).rejects.toThrow('Unable to cover deficits');
    });

    it('should include token symbols in error message', async () => {
      await expect(
        strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data)
      ).rejects.toThrow(/WETH|USDC/);
    });

    it('should NOT emit event when error is thrown', async () => {
      await expect(
        strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data)
      ).rejects.toThrow();

      expect(emittedEvents).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 8. Quote Failure Handling
  // ===========================================================================
  describe('when quote fetching fails', () => {
    const vault = {
      address: '0xVault',
      targetPlatforms: ['uniswapV3'],
      strategy: { strategyId: 'bob', platform: 'uniswapV3', parameters: { maxSlippage: 0.5 } },
      tokens: {
        WETH: '0',
        USDC: '0',
        WBTC: '100000000' // Has tokens but quotes fail
      }
    };

    const quote = {
      token0Amount: '1000000000000000000',
      token1Amount: '2000000000'
    };

    it('should handle quote errors gracefully and throw deficit error', async () => {
      mockAdapter.getBestSwapQuote.mockRejectedValue(new Error('No liquidity'));

      await expect(
        strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data)
      ).rejects.toThrow('Unable to cover deficits');
    });
  });

  // ===========================================================================
  // 9. Event Structure Verification
  // ===========================================================================
  describe('TokenPreparationCompleted event structure', () => {
    const vault = {
      address: '0xVault',
      targetPlatforms: ['uniswapV3'],
      strategy: { strategyId: 'bob', platform: 'uniswapV3', parameters: { maxSlippage: 0.5 } },
      tokens: {
        WETH: '2000000000000000000',
        USDC: '4000000000'
      }
    };

    const quote = {
      token0Amount: '1000000000000000000',
      token1Amount: '2000000000'
    };

    it('should include all required fields', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event).toHaveProperty('vaultAddress');
      expect(event).toHaveProperty('strategyId');
      expect(event).toHaveProperty('platformId');
      expect(event).toHaveProperty('targetTokens');
      expect(event).toHaveProperty('preparationResult');
      expect(event).toHaveProperty('swapTransactions');
      expect(event).toHaveProperty('deficitSwapCount');
      expect(event).toHaveProperty('bufferSwapCount');
      expect(event).toHaveProperty('nonAlignedTokensUsed');
      expect(event).toHaveProperty('swapMetadata');
      expect(event).toHaveProperty('phasesUsed');
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('log');
    });

    it('should have correct targetTokens structure', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.targetTokens.token0).toHaveProperty('symbol');
      expect(event.targetTokens.token0).toHaveProperty('required');
      expect(event.targetTokens.token0).toHaveProperty('available');
      expect(event.targetTokens.token0).toHaveProperty('deficit');
      expect(event.targetTokens.token1).toHaveProperty('symbol');
    });

    it('should have correct swapMetadata structure', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.swapMetadata).toHaveProperty('deficit');
      expect(event.swapMetadata).toHaveProperty('buffer');
      expect(Array.isArray(event.swapMetadata.deficit)).toBe(true);
      expect(Array.isArray(event.swapMetadata.buffer)).toBe(true);
    });

    it('should have correct phasesUsed structure', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.phasesUsed).toHaveProperty('nonAlignedForDeficit');
      expect(event.phasesUsed).toHaveProperty('excessTargetTokens');
      expect(event.phasesUsed).toHaveProperty('bufferSwaps');
    });

    it('should have timestamp as number', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(typeof event.timestamp).toBe('number');
      expect(event.timestamp).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // 10. Transaction Count Consistency
  // ===========================================================================
  describe('transaction count consistency', () => {
    const vault = {
      address: '0xVault',
      targetPlatforms: ['uniswapV3'],
      strategy: { strategyId: 'bob', platform: 'uniswapV3', parameters: { maxSlippage: 0.5 } },
      tokens: {
        WETH: '0',
        USDC: '5000000000',
        LINK: '10000000000000000000'
      }
    };

    const quote = {
      token0Amount: '1000000000000000000',
      token1Amount: '2000000000'
    };

    beforeEach(() => {
      mockAdapter.getBestSwapQuote.mockResolvedValue({
        amountIn: '2500000000',
        amountOut: '1000000000000000000'
      });

      mockPlatformUtils.batchSwapTransactions
        .mockResolvedValueOnce({
          transactions: [{ to: '0xRouter', data: '0x1', value: '0x00' }],
          metadata: [{ tokenInSymbol: 'USDC', tokenOutSymbol: 'WETH' }]
        })
        .mockResolvedValueOnce({
          transactions: [
            { to: '0xRouter', data: '0x2', value: '0x00' },
            { to: '0xRouter', data: '0x3', value: '0x00' }
          ],
          metadata: [
            { tokenInSymbol: 'LINK', tokenOutSymbol: 'WETH' },
            { tokenInSymbol: 'LINK', tokenOutSymbol: 'USDC' }
          ]
        });
    });

    it('should match swapTransactions count to deficitSwapCount + bufferSwapCount', async () => {
      await strategy.prepareTokensForPosition(vault, quote, token0Data, token1Data);

      const event = emittedEvents[0].data;
      expect(event.swapTransactions.length).toBe(event.deficitSwapCount + event.bufferSwapCount);
    });
  });
});
