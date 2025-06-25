/**
 * UniswapV3Adapter Unit Tests
 * 
 * Tests using Ganache fork of Arbitrum - no mocks, real blockchain interactions.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { setupTestEnvironment } from '../../test-env.js';
import UniswapV3Adapter from '../../../src/adapters/UniswapV3Adapter.js';
import chains from '../../../src/configs/chains.js';

describe('UniswapV3Adapter - Unit Tests', () => {
  let env;
  let adapter;
  let snapshotId;
  
  beforeAll(async () => {
    try {
      // Setup test environment with Ganache fork only (no heavy contract deployment)
      env = await setupTestEnvironment({
        deployContracts: false, // Skip contract deployment for faster constructor testing
      });
      
      // Create adapter instance using chainId from provider
      const network = await env.provider.getNetwork();
      adapter = new UniswapV3Adapter(Number(network.chainId));
      
      console.log('Ganache test environment started successfully');
      console.log('Provider URL:', env.provider.connection?.url || 'Local provider');
      console.log('Chain ID:', await env.provider.getNetwork().then(n => n.chainId));
      
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

  // Test to verify Ganache is working
  it('should connect to Ganache fork successfully', async () => {
    const network = await env.provider.getNetwork();
    expect(network.chainId).toBe(1337n);
    
    const blockNumber = await env.provider.getBlockNumber();
    expect(blockNumber).toBeGreaterThan(0);
  });

  describe('Constructor', () => {
    describe('Happy Path', () => {
      it('should construct successfully with valid chainId', () => {
        expect(adapter).toBeDefined();
        expect(adapter).toBeInstanceOf(UniswapV3Adapter);
      });

      it('should set basic properties correctly', () => {
        expect(adapter.chainId).toBe(1337);
        expect(adapter.platformId).toBe('uniswapV3');
        expect(adapter.platformName).toBe('Uniswap V3');
      });

      it('should cache platform addresses', () => {
        expect(adapter.addresses).toBeDefined();
        expect(adapter.addresses).toBeTypeOf('object');
        expect(adapter.addresses.enabled).toBe(true);
        expect(adapter.addresses.factoryAddress).toBeDefined();
        expect(adapter.addresses.positionManagerAddress).toBeDefined();
        expect(adapter.addresses.routerAddress).toBeDefined();
        
        // Verify addresses are valid ethereum addresses
        expect(adapter.addresses.factoryAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(adapter.addresses.positionManagerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(adapter.addresses.routerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });

      it('should cache fee tiers', () => {
        expect(adapter.feeTiers).toBeDefined();
        expect(Array.isArray(adapter.feeTiers)).toBe(true);
        expect(adapter.feeTiers).toEqual([100, 500, 3000, 10000]);
      });

      it('should cache chain config', () => {
        expect(adapter.chainConfig).toBeDefined();
        expect(adapter.chainConfig).toBeTypeOf('object');
      });

      it('should create token lookup maps', () => {
        expect(adapter.tokensByAddress).toBeInstanceOf(Map);
        expect(adapter.tokensBySymbol).toBeInstanceOf(Map);
        
        // Maps should have some entries for chain 1337
        expect(adapter.tokensByAddress.size).toBeGreaterThan(0);
        expect(adapter.tokensBySymbol.size).toBeGreaterThan(0);
        
        // Should have common tokens like WETH and USDC
        expect(adapter.tokensBySymbol.has('WETH')).toBe(true);
        expect(adapter.tokensBySymbol.has('USDC')).toBe(true);
      });

      it('should store ABIs correctly', () => {
        expect(adapter.nonfungiblePositionManagerABI).toBeDefined();
        expect(adapter.uniswapV3PoolABI).toBeDefined();
        expect(adapter.swapRouterABI).toBeDefined();
        expect(adapter.erc20ABI).toBeDefined();
        
        // ABIs should be arrays
        expect(Array.isArray(adapter.nonfungiblePositionManagerABI)).toBe(true);
        expect(Array.isArray(adapter.uniswapV3PoolABI)).toBe(true);
        expect(Array.isArray(adapter.swapRouterABI)).toBe(true);
        expect(Array.isArray(adapter.erc20ABI)).toBe(true);
        
        // ABIs should not be empty
        expect(adapter.nonfungiblePositionManagerABI.length).toBeGreaterThan(0);
        expect(adapter.uniswapV3PoolABI.length).toBeGreaterThan(0);
        expect(adapter.swapRouterABI.length).toBeGreaterThan(0);
        expect(adapter.erc20ABI.length).toBeGreaterThan(0);
      });

      it('should create contract interfaces', () => {
        expect(adapter.swapRouterInterface).toBeDefined();
        expect(adapter.positionManagerInterface).toBeDefined();
        expect(adapter.poolInterface).toBeDefined();
        expect(adapter.erc20Interface).toBeDefined();
        
        // Interfaces should have encode/decode methods
        expect(typeof adapter.swapRouterInterface.encodeFunctionData).toBe('function');
        expect(typeof adapter.positionManagerInterface.encodeFunctionData).toBe('function');
        expect(typeof adapter.poolInterface.encodeFunctionData).toBe('function');
        expect(typeof adapter.erc20Interface.encodeFunctionData).toBe('function');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null chainId', () => {
        expect(() => new UniswapV3Adapter(null)).toThrow('chainId must be a valid number');
      });

      it('should throw error for undefined chainId', () => {
        expect(() => new UniswapV3Adapter(undefined)).toThrow('chainId must be a valid number');
      });

      it('should throw error for string chainId', () => {
        expect(() => new UniswapV3Adapter('1337')).toThrow('chainId must be a valid number');
      });

      it('should throw error for NaN chainId', () => {
        expect(() => new UniswapV3Adapter(NaN)).toThrow('chainId must be a valid number');
      });

      it('should throw error for unsupported chainId', () => {
        expect(() => new UniswapV3Adapter(999999)).toThrow('Uniswap V3 not available on chain 999999');
      });
    });
  });

  describe('_validateSlippageTolerance', () => {
    describe('Success Cases', () => {
      it('should accept boundary minimum (0)', () => {
        const result = adapter._validateSlippageTolerance(0);
        expect(result).toBe(0);
      });

      it('should accept boundary maximum (100)', () => {
        const result = adapter._validateSlippageTolerance(100);
        expect(result).toBe(100);
      });

      it('should accept mid-range integer (50)', () => {
        const result = adapter._validateSlippageTolerance(50);
        expect(result).toBe(50);
      });

      it('should accept mid-range decimal (50.1)', () => {
        const result = adapter._validateSlippageTolerance(50.1);
        expect(result).toBe(50.1);
      });
    });

    describe('Out of Range Cases', () => {
      it('should throw error for below minimum (-1)', () => {
        expect(() => adapter._validateSlippageTolerance(-1)).toThrow('Invalid slippage tolerance: -1. Must be between 0 and 100.');
      });

      it('should throw error for above maximum (101)', () => {
        expect(() => adapter._validateSlippageTolerance(101)).toThrow('Invalid slippage tolerance: 101. Must be between 0 and 100.');
      });
    });

    describe('Invalid Type Cases', () => {
      it('should throw error for string type', () => {
        expect(() => adapter._validateSlippageTolerance("5")).toThrow('Invalid slippage tolerance: 5. Must be between 0 and 100.');
      });

      it('should throw error for null', () => {
        expect(() => adapter._validateSlippageTolerance(null)).toThrow('Invalid slippage tolerance: null. Must be between 0 and 100.');
      });

      it('should throw error for undefined', () => {
        expect(() => adapter._validateSlippageTolerance(undefined)).toThrow('Invalid slippage tolerance: undefined. Must be between 0 and 100.');
      });

      it('should throw error for NaN', () => {
        expect(() => adapter._validateSlippageTolerance(NaN)).toThrow('Invalid slippage tolerance: NaN. Must be between 0 and 100.');
      });

      it('should throw error for object', () => {
        expect(() => adapter._validateSlippageTolerance({})).toThrow('Invalid slippage tolerance: [object Object]. Must be between 0 and 100.');
      });
    });

    describe('Special Number Cases', () => {
      it('should throw error for positive infinity', () => {
        expect(() => adapter._validateSlippageTolerance(Infinity)).toThrow('Invalid slippage tolerance: Infinity. Must be between 0 and 100.');
      });

      it('should throw error for negative infinity', () => {
        expect(() => adapter._validateSlippageTolerance(-Infinity)).toThrow('Invalid slippage tolerance: -Infinity. Must be between 0 and 100.');
      });
    });
  });

  describe('_createDeadline', () => {
    describe('Success Cases', () => {
      it('should handle zero minutes (current timestamp)', () => {
        const beforeTime = Math.floor(Date.now() / 1000);
        const result = adapter._createDeadline(0);
        const expected = beforeTime + (0 * 60);
        expect(result).toBe(expected);
      });

      it('should handle small value (5 minutes)', () => {
        const beforeTime = Math.floor(Date.now() / 1000);
        const result = adapter._createDeadline(5);
        const expected = beforeTime + (5 * 60);
        expect(result).toBe(expected);
      });

      it('should handle large value (1440 minutes / 24 hours)', () => {
        const beforeTime = Math.floor(Date.now() / 1000);
        const result = adapter._createDeadline(1440);
        const expected = beforeTime + (1440 * 60);
        expect(result).toBe(expected);
      });

      it('should handle decimal value (0.5 minutes / 30 seconds)', () => {
        const beforeTime = Math.floor(Date.now() / 1000);
        const result = adapter._createDeadline(0.5);
        const expected = beforeTime + (0.5 * 60);
        expect(result).toBe(expected);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for negative value', () => {
        expect(() => adapter._createDeadline(-1)).toThrow('Invalid deadline minutes: -1. Must be a non-negative number.');
      });

      it('should throw error for string type', () => {
        expect(() => adapter._createDeadline("5")).toThrow('Invalid deadline minutes: 5. Must be a non-negative number.');
      });

      it('should throw error for null', () => {
        expect(() => adapter._createDeadline(null)).toThrow('Invalid deadline minutes: null. Must be a non-negative number.');
      });

      it('should throw error for undefined', () => {
        expect(() => adapter._createDeadline(undefined)).toThrow('Invalid deadline minutes: undefined. Must be a non-negative number.');
      });

      it('should throw error for NaN', () => {
        expect(() => adapter._createDeadline(NaN)).toThrow('Invalid deadline minutes: NaN. Must be a non-negative number.');
      });

      it('should throw error for object', () => {
        expect(() => adapter._createDeadline({})).toThrow('Invalid deadline minutes: [object Object]. Must be a non-negative number.');
      });
    });

    describe('Time Validation', () => {
      it('should return Unix timestamp in seconds with correct offset', () => {
        const minutes = 10;
        const beforeTimeSec = Math.floor(Date.now() / 1000);
        const result = adapter._createDeadline(minutes);
        const expected = beforeTimeSec + (minutes * 60);
        
        // Should be exactly the calculated seconds value (validates both format and calculation)
        expect(result).toBe(expected);
        expect(result).toBeLessThan(Date.now()); // Way less than current time in ms (format validation)
      });
    });
  });
});