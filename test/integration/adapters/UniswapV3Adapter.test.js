/**
 * UniswapV3Adapter Integration Tests
 * 
 * Tests the UniswapV3Adapter with real Uniswap contracts on forked Arbitrum.
 * No mocks - these are real integration tests.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { setupTestEnvironment } from '../../test-env.js';
import UniswapV3Adapter from '../../../src/adapters/UniswapV3Adapter.js';
import chains from '../../../src/configs/chains.js';

describe('UniswapV3Adapter - Integration Tests', () => {
  let env;
  let adapter;
  let snapshotId;
  
  beforeAll(async () => {
    try {
      // Setup test environment with Ganache fork AND vault/position setup
      env = await setupTestEnvironment({
        deployContracts: true, // Re-enable vault setup to debug the timeout
      });
      
      // Create adapter instance using chainId
      adapter = new UniswapV3Adapter(1337);
    } catch (error) {
      console.error('Failed to setup test environment:', error);
      throw error;
    }
  }, 60000); // 60 second timeout for setup
  
  afterAll(async () => {
    if (env && env.teardown) {
      await env.teardown();
    }
  });
  
  beforeEach(async () => {
    // Take a snapshot before each test
    if (env && env.snapshot) {
      snapshotId = await env.snapshot();
    }
  });
  
  afterEach(async () => {
    // Revert to snapshot after each test
    if (env && env.revert && snapshotId) {
      await env.revert(snapshotId);
    }
  });
  
  describe('Pool Data Fetching', () => {
    it('should fetch real pool data from WETH/USDC pool', async () => {
      // Use known tokens on Arbitrum
      const weth = {
        address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        decimals: 18,
        symbol: 'WETH',
        name: 'Wrapped Ether'
      };
      const usdc = {
        address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC native on Arbitrum
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin'
      };
      const fee = 500; // 0.05%
      
      const poolData = await adapter.fetchPoolData(weth, usdc, fee, 1337);
      
      expect(poolData).toBeDefined();
      expect(poolData.token0).toBeDefined();
      expect(poolData.token1).toBeDefined();
      expect(poolData.fee).toBe(fee);
      expect(poolData.sqrtPriceX96).toBeDefined();
      expect(poolData.tick).toBeDefined();
      expect(poolData.liquidity).toBeDefined();
    });
    
    it('should handle non-existent pool gracefully', async () => {
      const fakeToken1 = {
        address: '0x0000000000000000000000000000000000000001',
        decimals: 18,
        symbol: 'FAKE1',
        name: 'Fake Token 1'
      };
      const fakeToken2 = {
        address: '0x0000000000000000000000000000000000000002',
        decimals: 18,
        symbol: 'FAKE2',
        name: 'Fake Token 2'
      };
      await expect(adapter.fetchPoolData(fakeToken1, fakeToken2, 500, 1337)).rejects.toThrow();
    });
  });
  
  describe('Price Calculations', () => {
    it('should calculate correct price from real pool data', async () => {
      const weth = {
        address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        decimals: 18,
        symbol: 'WETH',
        name: 'Wrapped Ether'
      };
      const usdc = {
        address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin'
      };
      const poolData = await adapter.fetchPoolData(weth, usdc, 500, 1337);
      
      const price = adapter.calculatePriceFromSqrtPrice(
        poolData.sqrtPriceX96,
        weth, // WETH token object
        usdc, // USDC token object
        1337 // chainId
      );
      
      // Price should be a reasonable ETH/USDC price (just check it's a number)
      const priceNum = parseFloat(price);
      expect(priceNum).toBeGreaterThan(0);
      expect(isNaN(priceNum)).toBe(false);
    });
  });
  
  describe('Swap Data Generation', () => {
    it('should generate valid swap data for WETH to USDC', async () => {
      const weth = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'; // WETH on Arbitrum
      const usdc = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // USDC on Arbitrum (proper checksum)
      
      const swapParams = {
        tokenIn: weth,
        tokenOut: usdc,
        fee: 500, // 0.05%
        recipient: env.signers[0].address,
        amountIn: ethers.parseEther('0.1'), // 0.1 ETH
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
        provider: env.provider,
        chainId: 1337,
        deadlineMinutes: 2  // 2 minutes for L2
      };
      
      const swapData = await adapter.generateSwapData(swapParams);
      
      expect(swapData).toBeDefined();
      expect(swapData.to).toBe(chains[1337].platformAddresses.uniswapV3.routerAddress);
      expect(swapData.data).toBeDefined();
      expect(swapData.data.startsWith('0x')).toBe(true);
      expect(swapData.value).toBe(0); // ERC20 to ERC20 swap, no ETH value
    });
  });
  
  describe('Position Management', () => {
    it('should check if position is in range using real pool data', async () => {
      const weth = {
        address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        decimals: 18,
        symbol: 'WETH',
        name: 'Wrapped Ether'
      };
      const usdc = {
        address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin'
      };
      const poolData = await adapter.fetchPoolData(weth, usdc, 500, 1337);
      
      // Create a position around current tick
      const currentTick = poolData.tick;
      const testPosition = {
        tickLower: currentTick - 1000,
        tickUpper: currentTick + 1000,
      };
      
      const inRange = adapter.isPositionInRange(testPosition, poolData);
      expect(inRange).toBe(true);
      
      // Test out of range position
      const outOfRangePosition = {
        tickLower: currentTick - 10000,
        tickUpper: currentTick - 5000,
      };
      
      const outOfRange = adapter.isPositionInRange(outOfRangePosition, poolData);
      expect(outOfRange).toBe(false);
    });
  });
  
  describe('Fee Calculations', () => {
    it('should calculate uncollected fees for real position in vault', async () => {
      // Skip if no test position was created
      if (!env.testPosition || !env.positionTokenId) {
        console.log('Skipping fee calculation test - no test position available');
        return;
      }
      
      // Get position data from Uniswap
      const POSITION_MANAGER_ABI = [
        'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)'
      ];
      
      const positionManager = new ethers.Contract(
        chains[1337].platformAddresses.uniswapV3.positionManagerAddress,
        POSITION_MANAGER_ABI,
        env.provider
      );
      
      // Get the position data
      const position = await positionManager.positions(env.positionTokenId);
      
      // Get pool data for the position
      const poolData = await adapter.fetchPoolData(
        { address: position.token0, decimals: position.token0 === env.testPosition.token0 ? 6 : 18, symbol: position.token0 === env.testPosition.token0 ? 'USDC' : 'WETH', name: 'Token' },
        { address: position.token1, decimals: position.token1 === env.testPosition.token1 ? 18 : 6, symbol: position.token1 === env.testPosition.token1 ? 'WETH' : 'USDC', name: 'Token' },
        position.fee,
        1337
      );
      
      // Get tick data for fee calculations
      const poolAddress = poolData.poolAddress || (await adapter.getPoolData(
        { address: position.token0, decimals: position.token0 === env.testPosition.token0 ? 6 : 18, symbol: position.token0 === env.testPosition.token0 ? 'USDC' : 'WETH', name: 'Token' },
        { address: position.token1, decimals: position.token1 === env.testPosition.token1 ? 18 : 6, symbol: position.token1 === env.testPosition.token1 ? 'WETH' : 'USDC', name: 'Token' },
        position.fee,
        env.provider
      )).poolAddress;
      
      const tickData = await adapter.fetchTickData(poolAddress, position.tickLower, position.tickUpper);
      
      // Merge tick data into pool data
      poolData.ticks = {
        [position.tickLower]: tickData.tickLower,
        [position.tickUpper]: tickData.tickUpper
      };
      
      // Create position object for fee calculation
      const positionData = {
        liquidity: position.liquidity.toString(),
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        feeGrowthInside0LastX128: position.feeGrowthInside0LastX128.toString(),
        feeGrowthInside1LastX128: position.feeGrowthInside1LastX128.toString(),
        tokensOwed0: position.tokensOwed0.toString(),
        tokensOwed1: position.tokensOwed1.toString(),
      };
      
      // Calculate fees
      const fees = adapter.calculateUncollectedFees(
        positionData,
        poolData,
        position.token0 === env.testPosition.token0 ? 6 : 18, // token0 decimals
        position.token1 === env.testPosition.token1 ? 18 : 6  // token1 decimals
      );
      
      expect(fees).toBeDefined();
      expect(fees.token0).toBeDefined();
      expect(fees.token1).toBeDefined();
      expect(fees.token0.formatted).toBeDefined();
      expect(fees.token1.formatted).toBeDefined();
      
      console.log(`  - Uncollected fees - Token0: ${fees.token0.formatted}, Token1: ${fees.token1.formatted}`);
    });
  });
});