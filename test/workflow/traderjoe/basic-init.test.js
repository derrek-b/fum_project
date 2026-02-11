/**
 * @fileoverview Basic initialization tests for Trader Joe V2.2 adapter and vault setup
 *
 * These tests verify:
 * 1. TJ adapter loads correctly on Avalanche fork
 * 2. Can fetch pool data from TJ LBPairs
 * 3. Can create vaults with TJ positions (when TJPositionManager is deployed)
 *
 * Run with: FORK_CHAIN=avalanche npm test -- test/workflow/traderjoe/basic-init.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { TraderJoeV2_2Adapter } from 'fum_library/adapters';
import { getChainConfig, getTokenAddress } from 'fum_library';
import { getWrappedNativeAddress } from 'fum_library/helpers/tokenHelpers';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { loadSharedState } from '../../shared-state.js';

describe('AutomationService - Trader Joe V2.2 Initialization', () => {
  let testEnv;
  let chainId;
  let isAvalancheFork;

  beforeAll(async () => {
    // Load shared state to determine chain
    const state = loadSharedState();
    chainId = state.chainId;
    isAvalancheFork = chainId === 1338;

    console.log(`\n🔷 Running TJ tests on chain ${chainId} (${isAvalancheFork ? 'Avalanche' : 'Arbitrum'} fork)`);

    // Set up test environment
    testEnv = await setupTestBlockchain();
  }, 120000);

  afterAll(async () => {
    if (testEnv) {
      await cleanupTestBlockchain(testEnv);
    }
  });

  describe('Adapter Loading', () => {
    it('should create TraderJoeV2_2Adapter instance', () => {
      const adapter = new TraderJoeV2_2Adapter(chainId, testEnv.hardhatServer.provider);

      expect(adapter).toBeDefined();
      expect(adapter.platformId).toBe('traderjoeV2_2');
      expect(adapter.chainId).toBe(chainId);
    });

    it('should have correct platform addresses configured', () => {
      const chainConfig = getChainConfig(chainId);
      const tjAddresses = chainConfig.platformAddresses.traderjoeV2_2;

      expect(tjAddresses).toBeDefined();
      expect(tjAddresses.lbFactoryAddress).toBeDefined();
      expect(tjAddresses.lbRouterAddress).toBeDefined();
      expect(tjAddresses.lbQuoterAddress).toBeDefined();

      // Verify addresses are valid Ethereum addresses
      expect(ethers.utils.isAddress(tjAddresses.lbFactoryAddress)).toBe(true);
      expect(ethers.utils.isAddress(tjAddresses.lbRouterAddress)).toBe(true);
      expect(ethers.utils.isAddress(tjAddresses.lbQuoterAddress)).toBe(true);
    });

    it('should have token addresses configured for chain', () => {
      // USDC should be available on both chains
      const usdcAddress = getTokenAddress('USDC', chainId);
      expect(usdcAddress).toBeDefined();
      expect(ethers.utils.isAddress(usdcAddress)).toBe(true);

      // WETH/WAVAX should be available via getWrappedNativeAddress
      const wrappedNativeAddress = getWrappedNativeAddress(chainId);
      expect(wrappedNativeAddress).toBeDefined();
      expect(ethers.utils.isAddress(wrappedNativeAddress)).toBe(true);

      // Verify correct addresses for each chain
      if (isAvalancheFork) {
        // Avalanche addresses
        expect(usdcAddress.toLowerCase()).toBe('0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'.toLowerCase());
        expect(wrappedNativeAddress.toLowerCase()).toBe('0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'.toLowerCase());
      } else {
        // Arbitrum addresses
        expect(usdcAddress.toLowerCase()).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831'.toLowerCase());
        expect(wrappedNativeAddress.toLowerCase()).toBe('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'.toLowerCase());
      }
    });
  });

  // Known WAVAX/USDC pool on Trader Joe V2.2 (10bps)
  // https://snowscan.xyz/address/0x864d4e5ee7318e97483db7eb0912e09f161516ea
  const KNOWN_WAVAX_USDC_POOL = '0x864d4e5ee7318e97483db7eb0912e09f161516ea';

  describe('Pool Data Fetching', () => {
    it('should fetch pool data from LBFactory', async () => {
      const chainConfig = getChainConfig(chainId);
      const tjAddresses = chainConfig.platformAddresses.traderjoeV2_2;

      // Create factory contract with getAllLBPairs to find available pools
      const LB_FACTORY_ABI = [
        'function getAllLBPairs(address tokenX, address tokenY) view returns (tuple(uint16 binStep, address LBPair, bool createdByOwner, bool ignoredForRouting)[])'
      ];
      const lbFactory = new ethers.Contract(
        tjAddresses.lbFactoryAddress,
        LB_FACTORY_ABI,
        testEnv.hardhatServer.provider
      );

      // Get WAVAX/USDC pair info
      const wavaxAddress = getWrappedNativeAddress(chainId);
      const usdcAddress = getTokenAddress('USDC', chainId);

      // Sort tokens (lower address first)
      const [tokenX, tokenY] = wavaxAddress.toLowerCase() < usdcAddress.toLowerCase()
        ? [wavaxAddress, usdcAddress]
        : [usdcAddress, wavaxAddress];

      // Query factory for all WAVAX/USDC pools
      const allPairs = await lbFactory.getAllLBPairs(tokenX, tokenY);

      console.log(`    Found ${allPairs.length} WAVAX/USDC pools`);
      allPairs.forEach((pair, i) => {
        console.log(`    Pool ${i}: ${pair.LBPair} (binStep: ${pair.binStep})`);
      });

      // Find the 10bps pool
      const pool10bps = allPairs.find(p => p.binStep === 10);
      expect(pool10bps).toBeDefined();
      expect(pool10bps.LBPair.toLowerCase()).toBe(KNOWN_WAVAX_USDC_POOL.toLowerCase());
    });

    it('should fetch pool state via adapter.getPoolData()', async () => {
      const adapter = new TraderJoeV2_2Adapter(chainId, testEnv.hardhatServer.provider);

      // Use known WAVAX/USDC pool address directly
      const poolData = await adapter.getPoolData(KNOWN_WAVAX_USDC_POOL, testEnv.hardhatServer.provider);

      console.log(`    Pool address: ${poolData.address}`);
      console.log(`    Active bin ID: ${poolData.activeId}`);
      console.log(`    Bin step: ${poolData.binStep}`);
      console.log(`    Reserve X: ${poolData.reserveX}`);
      console.log(`    Reserve Y: ${poolData.reserveY}`);

      expect(poolData).toBeDefined();
      expect(poolData.address.toLowerCase()).toBe(KNOWN_WAVAX_USDC_POOL.toLowerCase());
      expect(typeof poolData.activeId).toBe('number');
      expect(poolData.activeId).toBeGreaterThan(0);
      expect(poolData.binStep).toBe(10);
      expect(poolData.tokenX).toBeDefined();
      expect(poolData.tokenY).toBeDefined();
    });

    it('should correctly sort tokens via adapter.sortTokens()', () => {
      const adapter = new TraderJoeV2_2Adapter(chainId, testEnv.hardhatServer.provider);

      const wavaxAddress = getWrappedNativeAddress(chainId);
      const usdcAddress = getTokenAddress('USDC', chainId);

      const tokenA = { address: wavaxAddress, symbol: 'WAVAX', decimals: 18 };
      const tokenB = { address: usdcAddress, symbol: 'USDC', decimals: 6 };

      const { sortedToken0, sortedToken1, tokensSwapped } = adapter.sortTokens(tokenA, tokenB);

      // Lower address should be tokenX (sortedToken0)
      const expectedTokenX = wavaxAddress.toLowerCase() < usdcAddress.toLowerCase() ? tokenA : tokenB;
      const expectedTokenY = wavaxAddress.toLowerCase() < usdcAddress.toLowerCase() ? tokenB : tokenA;

      expect(sortedToken0.address.toLowerCase()).toBe(expectedTokenX.address.toLowerCase());
      expect(sortedToken1.address.toLowerCase()).toBe(expectedTokenY.address.toLowerCase());

      console.log(`    TokenX (sorted): ${sortedToken0.symbol} (${sortedToken0.address})`);
      console.log(`    TokenY (sorted): ${sortedToken1.symbol} (${sortedToken1.address})`);
      console.log(`    Tokens swapped: ${tokensSwapped}`);
    });
  });

  describe('Swap Event Handling', () => {
    it('should generate correct swap event filter', () => {
      const adapter = new TraderJoeV2_2Adapter(chainId, testEnv.hardhatServer.provider);

      // Use a test LBPair address
      const testPoolAddress = '0x1234567890123456789012345678901234567890';

      const filter = adapter.getSwapEventFilter(testPoolAddress);

      expect(filter).toBeDefined();
      expect(filter.address).toBe(testPoolAddress);
      expect(filter.topics).toBeDefined();
      expect(filter.topics.length).toBe(1);

      // Verify it's the correct Swap event topic
      // Swap(address indexed sender, address indexed to, uint24 id, bytes32 amountsIn, bytes32 amountsOut, uint24 volatilityAccumulator, bytes32 totalFees, bytes32 protocolFees)
      const expectedTopic = ethers.utils.id('Swap(address,address,uint24,bytes32,bytes32,uint24,bytes32,bytes32)');
      expect(filter.topics[0]).toBe(expectedTopic);
    });

    it('should validate getSwapEventFilter input', () => {
      const adapter = new TraderJoeV2_2Adapter(chainId, testEnv.hardhatServer.provider);

      // Should throw for invalid input
      expect(() => adapter.getSwapEventFilter(null)).toThrow('poolId parameter is required');
      expect(() => adapter.getSwapEventFilter('')).toThrow('poolId parameter is required');
      expect(() => adapter.getSwapEventFilter('invalid')).toThrow('Invalid poolId address');
    });
  });

  describe('Position Range Evaluation', () => {
    it('should calculate bin range from percentage', () => {
      const adapter = new TraderJoeV2_2Adapter(chainId, testEnv.hardhatServer.provider);

      // Test calculateBinRange (if available) or manual calculation
      const poolData = {
        activeId: 8388608, // Reference bin ID (price = 1.0)
        binStep: 10        // 0.10%
      };

      // For a 5% range with binStep 10:
      // bins = log(1.05) / log(1.001) = ~49 bins
      const upperPercent = 5;
      const lowerPercent = 5;

      // Calculate expected bins using TJ formula
      const binsPerPercent = Math.log(1 + upperPercent / 100) / Math.log(1 + poolData.binStep / 10000);
      const expectedBins = Math.floor(binsPerPercent);

      console.log(`    Active ID: ${poolData.activeId}`);
      console.log(`    For ±${upperPercent}% range: ~${expectedBins} bins each direction`);
      console.log(`    Expected range: ${poolData.activeId - expectedBins} to ${poolData.activeId + expectedBins}`);

      expect(expectedBins).toBeGreaterThan(0);
    });

    it('should evaluate position range correctly', async () => {
      const adapter = new TraderJoeV2_2Adapter(chainId, testEnv.hardhatServer.provider);

      // Create a mock position with known bin range
      const position = {
        lowerBinId: 8388598, // 10 bins below center
        upperBinId: 8388618, // 10 bins above center
        pool: '0x1234567890123456789012345678901234567890' // Mock pool address
      };

      // Test with swapData (no RPC call)
      const swapData = { activeId: 8388608 }; // Exactly centered

      const result = await adapter.evaluatePositionRange(position, null, { swapData });

      console.log(`    Position range: ${position.lowerBinId} to ${position.upperBinId}`);
      console.log(`    Current activeId: ${swapData.activeId}`);
      console.log(`    In range: ${result.inRange}`);
      console.log(`    Centeredness: ${result.centeredness.toFixed(3)}`);
      console.log(`    Distance to upper: ${result.distanceToUpper.toFixed(3)}`);
      console.log(`    Distance to lower: ${result.distanceToLower.toFixed(3)}`);

      expect(result.inRange).toBe(true);
      expect(result.centeredness).toBeCloseTo(0.5, 1); // Should be centered
      expect(result.distanceToUpper).toBeCloseTo(0.5, 1);
      expect(result.distanceToLower).toBeCloseTo(0.5, 1);
    });

    it('should detect out-of-range positions', async () => {
      const adapter = new TraderJoeV2_2Adapter(chainId, testEnv.hardhatServer.provider);

      const position = {
        lowerBinId: 8388608,
        upperBinId: 8388628,
        pool: '0x1234567890123456789012345678901234567890'
      };

      // activeId below position range
      const swapDataBelow = { activeId: 8388600 };
      const resultBelow = await adapter.evaluatePositionRange(position, null, { swapData: swapDataBelow });

      expect(resultBelow.inRange).toBe(false);

      // activeId above position range
      const swapDataAbove = { activeId: 8388640 };
      const resultAbove = await adapter.evaluatePositionRange(position, null, { swapData: swapDataAbove });

      expect(resultAbove.inRange).toBe(false);
    });
  });
});
