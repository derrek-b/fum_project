/**
 * UniswapV4Adapter Unit Tests
 *
 * Tests using Hardhat fork of Arbitrum - no mocks, real blockchain interactions.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { setupV4TestEnvironment } from '../../setup/v4-setup.js';
import UniswapV4Adapter from '../../../src/adapters/UniswapV4Adapter.js';
import chains from '../../../src/configs/chains.js';

describe('UniswapV4Adapter - Unit Tests', () => {
  let env;
  let adapter;
  let snapshotId;

  beforeAll(async () => {
    try {
      // Setup V4 test environment with Hardhat fork
      // This includes: ETH→USDC swap, Permit2 approvals, pool data fetch
      env = await setupV4TestEnvironment({
        deployContracts: true,
        port: 8547,
      });

      // Use the adapter from the V4 environment
      adapter = env.adapter;

      console.log('V4 test environment started successfully');
      console.log('Provider URL:', env.provider.connection?.url || 'Local provider');
      console.log('Chain ID:', await env.provider.getNetwork().then(n => n.chainId));
      console.log('USDC balance:', ethers.utils.formatUnits(env.usdcBalance, 6));

      // Take ONE snapshot after V4 setup for all tests to revert to
      // This snapshot includes: funded USDC, Permit2 approvals, pool data
      if (env && env.snapshot) {
        snapshotId = await env.snapshot();
        console.log('Initial snapshot taken:', snapshotId);
      }

      console.log('Running tests...');

    } catch (error) {
      console.error('Failed to setup test environment:', error);
      throw error;
    }
  }, 180000); // 3 minute timeout for V4 setup (includes swap)

  afterAll(async () => {
    if (env && env.teardown) {
      await env.teardown();
    }
  });

  afterEach(async () => {
    // Revert to the ONE snapshot taken in beforeAll
    if (env && env.revert && snapshotId) {
      try {
        await env.revert(snapshotId);
      } catch (error) {
        console.warn('Failed to revert snapshot:', error.message);
      }
    }
  });

  // Test to verify Hardhat is working
  it('should connect to Hardhat fork successfully', async () => {
    const network = await env.provider.getNetwork();
    expect(network.chainId).toBe(1337);

    const blockNumber = await env.provider.getBlockNumber();
    expect(blockNumber).toBeGreaterThan(0);
  });

  describe('Constructor', () => {
    describe('Success Cases', () => {
      it('should construct successfully with valid chainId', () => {
        expect(adapter).toBeDefined();
        expect(adapter).toBeInstanceOf(UniswapV4Adapter);
      });

      it('should set basic properties correctly', () => {
        expect(adapter.chainId).toBe(1337);
        expect(adapter.platformId).toBe('uniswapV4');
        expect(adapter.platformName).toBe('Uniswap V4');
      });

      it('should cache platform addresses', () => {
        expect(adapter.addresses).toBeDefined();
        expect(adapter.addresses).toBeTypeOf('object');

        // V4-specific addresses
        expect(adapter.addresses.poolManagerAddress).toBeDefined();
        expect(adapter.addresses.positionManagerAddress).toBeDefined();
        expect(adapter.addresses.stateViewAddress).toBeDefined();
        expect(adapter.addresses.quoterAddress).toBeDefined();
        expect(adapter.addresses.universalRouterAddress).toBeDefined();

        // Verify addresses are valid ethereum addresses
        expect(adapter.addresses.poolManagerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(adapter.addresses.positionManagerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(adapter.addresses.stateViewAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(adapter.addresses.quoterAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(adapter.addresses.universalRouterAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });

      it('should cache tick bounds', () => {
        expect(adapter.tickBounds).toBeDefined();
        expect(adapter.tickBounds).toBeTypeOf('object');
        expect(adapter.tickBounds.minTick).toBeDefined();
        expect(adapter.tickBounds.maxTick).toBeDefined();
        // Standard Uniswap tick bounds
        expect(adapter.tickBounds.minTick).toBe(-887272);
        expect(adapter.tickBounds.maxTick).toBe(887272);
      });

      it('should cache chain config', () => {
        expect(adapter.chainConfig).toBeDefined();
        expect(adapter.chainConfig).toBeTypeOf('object');
      });

      it('should store ABIs correctly', () => {
        expect(adapter.poolManagerABI).toBeDefined();
        expect(adapter.positionManagerABI).toBeDefined();
        expect(adapter.stateViewABI).toBeDefined();
        expect(adapter.quoterABI).toBeDefined();
        expect(adapter.universalRouterABI).toBeDefined();
        expect(adapter.erc20ABI).toBeDefined();

        // ABIs should be arrays
        expect(Array.isArray(adapter.poolManagerABI)).toBe(true);
        expect(Array.isArray(adapter.positionManagerABI)).toBe(true);
        expect(Array.isArray(adapter.stateViewABI)).toBe(true);
        expect(Array.isArray(adapter.quoterABI)).toBe(true);
        expect(Array.isArray(adapter.universalRouterABI)).toBe(true);
        expect(Array.isArray(adapter.erc20ABI)).toBe(true);

        // ABIs should not be empty
        expect(adapter.poolManagerABI.length).toBeGreaterThan(0);
        expect(adapter.positionManagerABI.length).toBeGreaterThan(0);
        expect(adapter.stateViewABI.length).toBeGreaterThan(0);
        expect(adapter.quoterABI.length).toBeGreaterThan(0);
        expect(adapter.universalRouterABI.length).toBeGreaterThan(0);
        expect(adapter.erc20ABI.length).toBeGreaterThan(0);
      });

      it('should create contract interfaces', () => {
        expect(adapter.poolManagerInterface).toBeDefined();
        expect(adapter.positionManagerInterface).toBeDefined();
        expect(adapter.stateViewInterface).toBeDefined();
        expect(adapter.quoterInterface).toBeDefined();
        expect(adapter.universalRouterInterface).toBeDefined();
        expect(adapter.erc20Interface).toBeDefined();

        // Interfaces should have encode/decode methods
        expect(typeof adapter.poolManagerInterface.encodeFunctionData).toBe('function');
        expect(typeof adapter.positionManagerInterface.encodeFunctionData).toBe('function');
        expect(typeof adapter.stateViewInterface.encodeFunctionData).toBe('function');
        expect(typeof adapter.quoterInterface.encodeFunctionData).toBe('function');
        expect(typeof adapter.universalRouterInterface.encodeFunctionData).toBe('function');
        expect(typeof adapter.erc20Interface.encodeFunctionData).toBe('function');
      });

      it('should initialize AlphaRouter with correct chainId', () => {
        expect(adapter.alphaRouter).toBeDefined();
        expect(adapter.alphaRouter).toBeTypeOf('object');
        // For test chain (1337), AlphaRouter uses real Arbitrum (42161)
        expect(adapter.alphaRouterChainId).toBe(42161);
      });

      it('should initialize poolKeyCache as a Map', () => {
        expect(adapter.poolKeyCache).toBeDefined();
        expect(adapter.poolKeyCache).toBeInstanceOf(Map);
        expect(adapter.poolKeyCache.size).toBe(0);
      });
    });

    describe('Invalid Type Cases', () => {
      it('should throw error for null chainId', () => {
        expect(() => new UniswapV4Adapter(null)).toThrow('chainId must be a valid number');
      });

      it('should throw error for undefined chainId', () => {
        expect(() => new UniswapV4Adapter(undefined)).toThrow('chainId must be a valid number');
      });

      it('should throw error for string chainId', () => {
        expect(() => new UniswapV4Adapter('1337')).toThrow('chainId must be a valid number');
      });
    });

    describe('Special Cases', () => {
      it('should throw error for NaN chainId', () => {
        expect(() => new UniswapV4Adapter(NaN)).toThrow('chainId must be a valid number');
      });

      it('should throw error for Infinity chainId', () => {
        expect(() => new UniswapV4Adapter(Infinity)).toThrow('chainId must be a finite number');
      });

      it('should throw error for -Infinity chainId', () => {
        expect(() => new UniswapV4Adapter(-Infinity)).toThrow('chainId must be a finite number');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chainId', () => {
        expect(() => new UniswapV4Adapter(999999)).toThrow('Chain 999999 is not supported');
      });
    });
  });

  describe('getApprovalTarget', () => {
    it('should return Permit2 address for swap operations', () => {
      const target = adapter.getApprovalTarget('swap');
      expect(target).toBeDefined();
      expect(target).toMatch(/^0x[a-fA-F0-9]{40}$/);
      // Permit2 has a known address
      expect(target.toLowerCase()).toBe('0x000000000022d473030f116ddee9f6b43ac78ba3');
    });

    it('should return Permit2 address by default', () => {
      const target = adapter.getApprovalTarget();
      expect(target.toLowerCase()).toBe('0x000000000022d473030f116ddee9f6b43ac78ba3');
    });

    it('should return PositionManager address for liquidity operations', () => {
      const target = adapter.getApprovalTarget('liquidity');
      expect(target).toBeDefined();
      expect(target).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(target).toBe(adapter.addresses.positionManagerAddress);
    });
  });

  describe('sortTokens', () => {
    it('should sort tokens by address (lower first)', () => {
      const tokenA = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC' };
      const tokenB = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH' };

      const result = adapter.sortTokens(tokenA, tokenB);

      // WETH address (0x82...) < USDC address (0xaf...) when compared as hex
      expect(result.sortedToken0.symbol).toBe('WETH');
      expect(result.sortedToken1.symbol).toBe('USDC');
      expect(result.tokensSwapped).toBe(true);
    });

    it('should not swap when tokens already in correct order', () => {
      const tokenA = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH' };
      const tokenB = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC' };

      const result = adapter.sortTokens(tokenA, tokenB);

      expect(result.sortedToken0.symbol).toBe('WETH');
      expect(result.sortedToken1.symbol).toBe('USDC');
      expect(result.tokensSwapped).toBe(false);
    });

    it('should throw error for missing token addresses', () => {
      expect(() => adapter.sortTokens({}, { address: '0x123' }))
        .toThrow('Both tokens must have valid addresses');

      expect(() => adapter.sortTokens({ address: '0x123' }, {}))
        .toThrow('Both tokens must have valid addresses');
    });

    it('should throw error for null tokens', () => {
      expect(() => adapter.sortTokens(null, { address: '0x123' }))
        .toThrow('Both tokens must have valid addresses');
    });
  });

  describe('_getSwapEventSignature', () => {
    it('should return the correct Uniswap V4 swap event signature', () => {
      const signature = adapter._getSwapEventSignature();
      expect(signature).toBe('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)');
    });

    it('should generate the correct topic hash for V4 swap events', () => {
      const { ethers } = require('ethers');
      const signature = adapter._getSwapEventSignature();
      const topicHash = ethers.utils.id(signature);
      // V4 Swap event topic hash
      expect(topicHash).toBe('0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f');
    });
  });

  describe('getSwapEventFilter', () => {
    const validPoolId = '0x' + 'a'.repeat(64); // Valid bytes32

    it('should return correct filter structure', () => {
      const filter = adapter.getSwapEventFilter(validPoolId);

      expect(filter).toHaveProperty('address');
      expect(filter).toHaveProperty('topics');
      expect(filter.address).toBe(adapter.addresses.poolManagerAddress);
      expect(filter.topics).toHaveLength(2);
    });

    it('should use PoolManager address (not individual pool)', () => {
      const filter = adapter.getSwapEventFilter(validPoolId);
      expect(filter.address).toBe(adapter.addresses.poolManagerAddress);
    });

    it('should include poolId as second topic', () => {
      const filter = adapter.getSwapEventFilter(validPoolId);
      expect(filter.topics[1]).toBe(validPoolId);
    });

    it('should throw error for null poolId', () => {
      expect(() => adapter.getSwapEventFilter(null))
        .toThrow('poolId parameter is required and must be a string');
    });

    it('should throw error for undefined poolId', () => {
      expect(() => adapter.getSwapEventFilter(undefined))
        .toThrow('poolId parameter is required and must be a string');
    });

    it('should throw error for non-string poolId', () => {
      expect(() => adapter.getSwapEventFilter(123))
        .toThrow('poolId parameter is required and must be a string');
    });

    it('should throw error for invalid bytes32 format', () => {
      expect(() => adapter.getSwapEventFilter('0x123'))
        .toThrow('Invalid poolId format');
    });
  });

  describe('parseSwapEvent', () => {
    // Create a valid V4 swap event log for testing
    const { ethers } = require('ethers');
    const validSignature = 'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)';
    const validTopic0 = ethers.utils.id(validSignature);
    const validPoolId = '0x' + 'a'.repeat(64);
    const validSender = ethers.utils.hexZeroPad('0x1234567890123456789012345678901234567890', 32); // padded address

    // Encode the non-indexed data
    const abiCoder = new ethers.utils.AbiCoder();
    const validData = abiCoder.encode(
      ['int128', 'int128', 'uint160', 'uint128', 'int24', 'uint24'],
      [
        '-1000000000000000000', // amount0
        '2000000000000000000',  // amount1
        '79228162514264337593543950336', // sqrtPriceX96
        '1000000000000000000', // liquidity
        -100, // tick
        3000  // fee
      ]
    );

    const validLog = {
      address: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
      topics: [validTopic0, validPoolId, validSender],
      data: validData
    };

    describe('Validation', () => {
      it('should throw error for null log', () => {
        expect(() => adapter.parseSwapEvent(null))
          .toThrow('Log parameter is required');
      });

      it('should throw error for undefined log', () => {
        expect(() => adapter.parseSwapEvent(undefined))
          .toThrow('Log parameter is required');
      });

      it('should throw error for log without address', () => {
        expect(() => adapter.parseSwapEvent({ topics: [], data: '0x' }))
          .toThrow('Log must have address property');
      });

      it('should throw error for log without topics', () => {
        expect(() => adapter.parseSwapEvent({ address: '0x123', data: '0x' }))
          .toThrow('Log must have topics array');
      });

      it('should throw error for log with non-array topics', () => {
        expect(() => adapter.parseSwapEvent({ address: '0x123', topics: 'not-array', data: '0x' }))
          .toThrow('Log must have topics array');
      });

      it('should throw error for log with fewer than 3 topics', () => {
        expect(() => adapter.parseSwapEvent({ address: '0x123', topics: [validTopic0, validPoolId], data: '0x' }))
          .toThrow('Log must have at least 3 topics');
      });

      it('should throw error for log without data', () => {
        expect(() => adapter.parseSwapEvent({ address: '0x123', topics: [validTopic0, validPoolId, validSender] }))
          .toThrow('Log must have data property');
      });

      it('should throw error for wrong event signature', () => {
        const wrongLog = {
          ...validLog,
          topics: ['0x' + '1'.repeat(64), validPoolId, validSender]
        };
        expect(() => adapter.parseSwapEvent(wrongLog))
          .toThrow('Invalid swap event signature');
      });
    });

    describe('Parsing', () => {
      it('should parse valid V4 swap event correctly', () => {
        const result = adapter.parseSwapEvent(validLog);

        expect(result.poolId).toBe(validPoolId);
        expect(result.tick).toBe(-100);
        expect(result.sqrtPriceX96).toBe('79228162514264337593543950336');
        expect(result.liquidity).toBe('1000000000000000000');
        expect(result.amount0).toBe('-1000000000000000000');
        expect(result.amount1).toBe('2000000000000000000');
        expect(result.sender).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result.fee).toBe(3000);
      });

      it('should return all expected properties', () => {
        const result = adapter.parseSwapEvent(validLog);

        expect(result).toHaveProperty('poolId');
        expect(result).toHaveProperty('tick');
        expect(result).toHaveProperty('sqrtPriceX96');
        expect(result).toHaveProperty('liquidity');
        expect(result).toHaveProperty('amount0');
        expect(result).toHaveProperty('amount1');
        expect(result).toHaveProperty('sender');
        expect(result).toHaveProperty('fee');
      });

      it('should return tick as number', () => {
        const result = adapter.parseSwapEvent(validLog);
        expect(typeof result.tick).toBe('number');
      });

      it('should return fee as number', () => {
        const result = adapter.parseSwapEvent(validLog);
        expect(typeof result.fee).toBe('number');
      });

      it('should return amounts as strings', () => {
        const result = adapter.parseSwapEvent(validLog);
        expect(typeof result.amount0).toBe('string');
        expect(typeof result.amount1).toBe('string');
        expect(typeof result.sqrtPriceX96).toBe('string');
        expect(typeof result.liquidity).toBe('string');
      });
    });
  });

  describe('parseSwapReceipt', () => {
    describe('Error Cases', () => {
      it('should throw for null receipt', () => {
        expect(() => adapter.parseSwapReceipt(null, [])).toThrow('Receipt parameter is required');
      });

      it('should throw for undefined receipt', () => {
        expect(() => adapter.parseSwapReceipt(undefined, [])).toThrow('Receipt parameter is required');
      });

      it('should throw for receipt without logs', () => {
        expect(() => adapter.parseSwapReceipt({}, [])).toThrow('Receipt must have logs property');
      });

      it('should throw for null swapMetadata', () => {
        expect(() => adapter.parseSwapReceipt({ logs: [] }, null)).toThrow('Swap metadata parameter is required');
      });

      it('should throw for non-array swapMetadata', () => {
        expect(() => adapter.parseSwapReceipt({ logs: [] }, {})).toThrow('Swap metadata must be an array');
      });

      it('should throw for metadata missing tokenInAddress', () => {
        expect(() => adapter.parseSwapReceipt({ logs: [] }, [{ tokenOutAddress: '0x123' }]))
          .toThrow('Swap metadata must have tokenInAddress');
      });

      it('should throw for metadata missing tokenOutAddress', () => {
        expect(() => adapter.parseSwapReceipt({ logs: [] }, [{ tokenInAddress: '0x123' }]))
          .toThrow('Swap metadata must have tokenOutAddress');
      });
    });

    describe('Success Cases', () => {
      const NATIVE_ETH = ethers.constants.AddressZero;
      const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

      it('should return empty array for empty metadata', () => {
        const receipt = { logs: [] };
        const result = adapter.parseSwapReceipt(receipt, []);
        expect(result).toEqual([]);
      });

      it('should parse real swap receipt and match actual amounts', async () => {
        const signer = env.provider.getSigner(0);
        const signerAddress = await signer.getAddress();

        // Check USDC balance before
        const usdcContract = new ethers.Contract(
          USDC,
          ['function balanceOf(address) view returns (uint256)'],
          env.provider
        );
        const balanceBefore = await usdcContract.balanceOf(signerAddress);

        // Generate and execute swap - force V4 routing to test parseSwapReceipt
        const amountIn = ethers.utils.parseEther('0.05').toString();
        const swapData = await adapter._generateSwapData({
          tokenIn: NATIVE_ETH,
          tokenOut: USDC,
          amountIn,
          recipient: signerAddress,
          slippageTolerance: 1,
          deadlineMinutes: 20,
          forceProtocol: 'V4'
        });

        const tx = await signer.sendTransaction({
          to: swapData.to,
          data: swapData.data,
          value: swapData.value
        });
        const receipt = await tx.wait();

        // Get actual USDC received
        const balanceAfter = await usdcContract.balanceOf(signerAddress);
        const actualUsdcReceived = balanceAfter.sub(balanceBefore);

        // Parse the receipt with V4 swap metadata
        const metadata = [{
          tokenInAddress: NATIVE_ETH,
          tokenOutAddress: USDC,
          expectedSwapEvents: 1
        }];
        const parsed = adapter.parseSwapReceipt(receipt, metadata);

        // Verify parsed amounts match actual
        expect(parsed).toHaveLength(1);
        expect(parsed[0].actualAmountIn).toBe(amountIn);
        expect(parsed[0].actualAmountOut).toBe(actualUsdcReceived.toString());

        // Verify quoted amount is close to actual (within slippage tolerance)
        const quotedAmount = BigInt(swapData.quote.amountOut);
        const actualAmount = BigInt(parsed[0].actualAmountOut);
        const slippageBps = Math.abs(Number((quotedAmount - actualAmount) * 10000n / quotedAmount));
        expect(slippageBps).toBeLessThan(100); // Less than 1% slippage

        console.log(`V4 swap - Quoted: ${ethers.utils.formatUnits(swapData.quote.amountOut, 6)} USDC, Actual: ${ethers.utils.formatUnits(parsed[0].actualAmountOut, 6)} USDC, Slippage: ${slippageBps}bps`);
      }, 120000);
    });
  });

  describe('_generateSwapData', () => {
    // Token addresses for Arbitrum
    const NATIVE_ETH = ethers.constants.AddressZero;
    const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';

    // Valid base params for success tests
    const validParams = {
      tokenIn: NATIVE_ETH,
      tokenOut: USDC,
      amountIn: ethers.utils.parseEther('0.01').toString(),
      recipient: '0x1234567890123456789012345678901234567890',
      slippageTolerance: 0.5,
      deadlineMinutes: 20
    };

    describe('Parameter Validation', () => {
      it('should throw when tokenIn is missing', async () => {
        await expect(adapter._generateSwapData({
          ...validParams,
          tokenIn: undefined
        })).rejects.toThrow('tokenIn is required');
      });

      it('should throw when tokenOut is missing', async () => {
        await expect(adapter._generateSwapData({
          ...validParams,
          tokenOut: undefined
        })).rejects.toThrow('tokenOut is required');
      });

      it('should throw when amountIn is missing', async () => {
        await expect(adapter._generateSwapData({
          ...validParams,
          amountIn: undefined
        })).rejects.toThrow('amountIn is required');
      });

      it('should throw when amountIn is not a string', async () => {
        await expect(adapter._generateSwapData({
          ...validParams,
          amountIn: 1000000
        })).rejects.toThrow('amountIn must be a string');
      });

      it('should throw when amountIn is zero', async () => {
        await expect(adapter._generateSwapData({
          ...validParams,
          amountIn: '0'
        })).rejects.toThrow('amountIn cannot be zero');
      });

      it('should throw when recipient is missing', async () => {
        await expect(adapter._generateSwapData({
          ...validParams,
          recipient: undefined
        })).rejects.toThrow('recipient is required');
      });

      it('should throw when recipient is invalid address', async () => {
        await expect(adapter._generateSwapData({
          ...validParams,
          recipient: 'not-an-address'
        })).rejects.toThrow('Invalid recipient address');
      });

      it('should throw when slippageTolerance is negative', async () => {
        await expect(adapter._generateSwapData({
          ...validParams,
          slippageTolerance: -1
        })).rejects.toThrow('slippageTolerance must be between 0 and 100');
      });

      it('should throw when slippageTolerance exceeds 100', async () => {
        await expect(adapter._generateSwapData({
          ...validParams,
          slippageTolerance: 101
        })).rejects.toThrow('slippageTolerance must be between 0 and 100');
      });

      it('should throw when deadlineMinutes is zero', async () => {
        await expect(adapter._generateSwapData({
          ...validParams,
          deadlineMinutes: 0
        })).rejects.toThrow('deadlineMinutes must be positive');
      });

      it('should throw when deadlineMinutes is negative', async () => {
        await expect(adapter._generateSwapData({
          ...validParams,
          deadlineMinutes: -5
        })).rejects.toThrow('deadlineMinutes must be positive');
      });

      it('should throw when tokenIn address is not in config', async () => {
        await expect(adapter._generateSwapData({
          ...validParams,
          tokenIn: '0x1111111111111111111111111111111111111111'  // Unknown token
        })).rejects.toThrow('No token found at address');
      });

      it('should throw when tokenOut address is not in config', async () => {
        await expect(adapter._generateSwapData({
          ...validParams,
          tokenOut: '0x2222222222222222222222222222222222222222'  // Unknown token
        })).rejects.toThrow('No token found at address');
      });
    });

    describe('Success Cases', () => {
      it('should generate valid swap data for ETH -> USDC', async () => {
        const result = await adapter._generateSwapData({
          tokenIn: NATIVE_ETH,
          tokenOut: USDC,
          amountIn: ethers.utils.parseEther('0.01').toString(),
          recipient: '0x1234567890123456789012345678901234567890',
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        // Verify structure
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');

        // Verify to is Universal Router
        expect(result.to).toBe(adapter.addresses.universalRouterAddress);

        // Verify value equals amountIn for native ETH input
        expect(result.value).toBe(ethers.utils.parseEther('0.01').toString());

        // Verify data is hex string
        expect(result.data).toMatch(/^0x/);

        // Verify quote structure
        expect(result.quote).toHaveProperty('amountOut');
        expect(result.quote).toHaveProperty('amountOutMinimum');
        expect(result.quote).toHaveProperty('gasEstimate');
        expect(result.quote).toHaveProperty('route');

        // Verify amountOut is a positive number string
        expect(BigInt(result.quote.amountOut)).toBeGreaterThan(0n);
      }, 60000); // 60s timeout for AlphaRouter

      it('should generate valid swap data for WETH -> USDC (ERC20 input)', async () => {
        const result = await adapter._generateSwapData({
          tokenIn: WETH,
          tokenOut: USDC,
          amountIn: ethers.utils.parseEther('0.01').toString(),
          recipient: '0x1234567890123456789012345678901234567890',
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        // Verify structure
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');

        // Verify value is '0' for ERC20 input (no ETH to send)
        expect(result.value).toBe('0');

        // Verify to is Universal Router
        expect(result.to).toBe(adapter.addresses.universalRouterAddress);
      }, 60000);

      it('should use default slippageTolerance and deadlineMinutes when not provided', async () => {
        const result = await adapter._generateSwapData({
          tokenIn: NATIVE_ETH,
          tokenOut: USDC,
          amountIn: ethers.utils.parseEther('0.01').toString(),
          recipient: '0x1234567890123456789012345678901234567890'
          // slippageTolerance and deadlineMinutes omitted - should use defaults
        });

        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');
      }, 60000);
    });

    describe('Execution Tests', () => {
      it('should execute ETH -> USDC swap successfully', async () => {
        // Get a funded signer from the test environment
        const signer = env.provider.getSigner(0);
        const signerAddress = await signer.getAddress();

        // Check USDC balance before
        const usdcContract = new ethers.Contract(
          USDC,
          ['function balanceOf(address) view returns (uint256)'],
          env.provider
        );
        const balanceBefore = await usdcContract.balanceOf(signerAddress);

        // Generate swap data
        const swapData = await adapter._generateSwapData({
          tokenIn: NATIVE_ETH,
          tokenOut: USDC,
          amountIn: ethers.utils.parseEther('0.1').toString(),
          recipient: signerAddress,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        // Execute the swap
        const tx = await signer.sendTransaction({
          to: swapData.to,
          data: swapData.data,
          value: swapData.value
        });
        const receipt = await tx.wait();

        // Verify transaction succeeded
        expect(receipt.status).toBe(1);

        // Verify USDC was received
        const balanceAfter = await usdcContract.balanceOf(signerAddress);
        const usdcReceived = balanceAfter.sub(balanceBefore);
        expect(usdcReceived.gt(0)).toBe(true);

        console.log(`Swapped 0.1 ETH for ${ethers.utils.formatUnits(usdcReceived, 6)} USDC`);
      }, 120000); // 2 minute timeout
    });
  });

  describe('Stub Methods (Not Yet Implemented)', () => {
    // These tests verify that unimplemented methods throw appropriate errors
    // Remove these as methods get implemented

    it('evaluatePriceMovement should throw not implemented', () => {
      expect(() => adapter.evaluatePriceMovement({}, 0, {}, {}))
        .toThrow('UniswapV4Adapter.evaluatePriceMovement not implemented');
    });

    it('getPositionsForVDS should throw not implemented', async () => {
      await expect(adapter.getPositionsForVDS('0x123', env.provider))
        .rejects.toThrow('UniswapV4Adapter.getPositionsForVDS not implemented');
    });

    it('getAccruedFeesUSD should throw not implemented', async () => {
      await expect(adapter.getAccruedFeesUSD({}, {}, env.provider))
        .rejects.toThrow('UniswapV4Adapter.getAccruedFeesUSD not implemented');
    });

    it('evaluatePositionRange should throw not implemented', async () => {
      await expect(adapter.evaluatePositionRange({}, env.provider))
        .rejects.toThrow('UniswapV4Adapter.evaluatePositionRange not implemented');
    });

    it('calculateTokenAmounts should throw not implemented', async () => {
      await expect(adapter.calculateTokenAmounts({}, {}, {}, {}))
        .rejects.toThrow('UniswapV4Adapter.calculateTokenAmounts not implemented');
    });

    it('generateClaimFeesData should throw not implemented', async () => {
      await expect(adapter.generateClaimFeesData({}))
        .rejects.toThrow('UniswapV4Adapter.generateClaimFeesData not implemented');
    });

    it('generateRemoveLiquidityData should throw not implemented', async () => {
      await expect(adapter.generateRemoveLiquidityData({}))
        .rejects.toThrow('UniswapV4Adapter.generateRemoveLiquidityData not implemented');
    });

    it('generateAddLiquidityData should throw not implemented', async () => {
      await expect(adapter.generateAddLiquidityData({}))
        .rejects.toThrow('UniswapV4Adapter.generateAddLiquidityData not implemented');
    });

    it('getAddLiquidityAmounts should throw not implemented', async () => {
      await expect(adapter.getAddLiquidityAmounts({}))
        .rejects.toThrow('UniswapV4Adapter.getAddLiquidityAmounts not implemented');
    });

    // generateCreatePositionData - IMPLEMENTED (tests in separate describe block)

    it('getBestSwapQuote should throw not implemented', async () => {
      await expect(adapter.getBestSwapQuote({}))
        .rejects.toThrow('UniswapV4Adapter.getBestSwapQuote not implemented');
    });

    it('batchSwapTransactions should throw not implemented', async () => {
      await expect(adapter.batchSwapTransactions([], {}))
        .rejects.toThrow('UniswapV4Adapter.batchSwapTransactions not implemented');
    });

    it('parseClosureReceipt should throw not implemented', () => {
      expect(() => adapter.parseClosureReceipt({}, {}))
        .toThrow('UniswapV4Adapter.parseClosureReceipt not implemented');
    });

    it('parseCollectReceipt should throw not implemented', () => {
      expect(() => adapter.parseCollectReceipt({}, {}))
        .toThrow('UniswapV4Adapter.parseCollectReceipt not implemented');
    });


    it('selectBestPool should throw not implemented', async () => {
      await expect(adapter.selectBestPool('WETH', 'USDC', env.provider, 1337))
        .rejects.toThrow('UniswapV4Adapter.selectBestPool not implemented');
    });

    // getPositionRange - IMPLEMENTED (tests in separate describe block)
    // extractPositionBounds - IMPLEMENTED (tests in separate describe block)
    // getPoolCurrent - IMPLEMENTED (tests in separate describe block)

    it('getPoolKeyFromId should throw not implemented', async () => {
      await expect(adapter.getPoolKeyFromId('0x123', env.provider))
        .rejects.toThrow('UniswapV4Adapter.getPoolKeyFromId not implemented');
    });
  });

  describe('getPoolCurrent', () => {
    describe('Error Cases', () => {
      it('should throw when poolData is null', () => {
        expect(() => adapter.getPoolCurrent(null))
          .toThrow('Pool data must have tick property');
      });

      it('should throw when poolData is undefined', () => {
        expect(() => adapter.getPoolCurrent(undefined))
          .toThrow('Pool data must have tick property');
      });

      it('should throw when poolData.tick is undefined', () => {
        expect(() => adapter.getPoolCurrent({}))
          .toThrow('Pool data must have tick property');
      });

      it('should throw when poolData.tick is explicitly undefined', () => {
        expect(() => adapter.getPoolCurrent({ tick: undefined }))
          .toThrow('Pool data must have tick property');
      });
    });

    describe('Success Cases', () => {
      it('should return tick from poolData', () => {
        const poolData = { tick: 12345 };
        expect(adapter.getPoolCurrent(poolData)).toBe(12345);
      });

      it('should handle negative ticks', () => {
        const poolData = { tick: -54321 };
        expect(adapter.getPoolCurrent(poolData)).toBe(-54321);
      });

      it('should handle zero tick', () => {
        const poolData = { tick: 0 };
        expect(adapter.getPoolCurrent(poolData)).toBe(0);
      });

      it('should handle tick at platform bounds', () => {
        const poolData = { tick: 887272 }; // max tick
        expect(adapter.getPoolCurrent(poolData)).toBe(887272);
      });
    });
  });

  describe('extractPositionBounds', () => {
    describe('Error Cases', () => {
      it('should throw when position is null', () => {
        expect(() => adapter.extractPositionBounds(null))
          .toThrow('Position is required and must be an object');
      });

      it('should throw when position is undefined', () => {
        expect(() => adapter.extractPositionBounds(undefined))
          .toThrow('Position is required and must be an object');
      });

      it('should throw when position is an array', () => {
        expect(() => adapter.extractPositionBounds([]))
          .toThrow('Position is required and must be an object');
      });

      it('should throw when position is a string', () => {
        expect(() => adapter.extractPositionBounds('position'))
          .toThrow('Position is required and must be an object');
      });

      it('should throw when tickLower is missing', () => {
        expect(() => adapter.extractPositionBounds({ tickUpper: 100 }))
          .toThrow('Position missing tickLower property');
      });

      it('should throw when tickLower is null', () => {
        expect(() => adapter.extractPositionBounds({ tickLower: null, tickUpper: 100 }))
          .toThrow('Position missing tickLower property');
      });

      it('should throw when tickUpper is missing', () => {
        expect(() => adapter.extractPositionBounds({ tickLower: -100 }))
          .toThrow('Position missing tickUpper property');
      });

      it('should throw when tickUpper is null', () => {
        expect(() => adapter.extractPositionBounds({ tickLower: -100, tickUpper: null }))
          .toThrow('Position missing tickUpper property');
      });
    });

    describe('Success Cases', () => {
      it('should extract bounds from valid position', () => {
        const position = { tickLower: -100, tickUpper: 100 };
        const result = adapter.extractPositionBounds(position);
        expect(result).toEqual({ lower: -100, upper: 100 });
      });

      it('should handle negative tick bounds', () => {
        const position = { tickLower: -5000, tickUpper: -1000 };
        const result = adapter.extractPositionBounds(position);
        expect(result).toEqual({ lower: -5000, upper: -1000 });
      });

      it('should handle position with extra properties', () => {
        const position = { tickLower: 0, tickUpper: 500, liquidity: '12345', tokenId: 1 };
        const result = adapter.extractPositionBounds(position);
        expect(result).toEqual({ lower: 0, upper: 500 });
      });

      it('should handle zero bounds', () => {
        const position = { tickLower: 0, tickUpper: 0 };
        const result = adapter.extractPositionBounds(position);
        expect(result).toEqual({ lower: 0, upper: 0 });
      });
    });
  });

  describe('_calculateTickRangeFromPercentages', () => {
    describe('Error Cases', () => {
      it('should throw for invalid currentTick (NaN)', () => {
        expect(() => adapter._calculateTickRangeFromPercentages(NaN, 5, 5, 60))
          .toThrow('Invalid currentTick: NaN. Must be a finite number.');
      });

      it('should throw for invalid currentTick (Infinity)', () => {
        expect(() => adapter._calculateTickRangeFromPercentages(Infinity, 5, 5, 60))
          .toThrow('Invalid currentTick: Infinity. Must be a finite number.');
      });

      it('should throw for invalid upperPercent (NaN)', () => {
        expect(() => adapter._calculateTickRangeFromPercentages(0, NaN, 5, 60))
          .toThrow('Invalid upperPercent: NaN. Must be a finite number.');
      });

      it('should throw for upperPercent <= 0', () => {
        expect(() => adapter._calculateTickRangeFromPercentages(0, 0, 5, 60))
          .toThrow('Invalid upperPercent: 0. Must be between 0 and 100 (exclusive of 0).');
      });

      it('should throw for upperPercent > 100', () => {
        expect(() => adapter._calculateTickRangeFromPercentages(0, 101, 5, 60))
          .toThrow('Invalid upperPercent: 101. Must be between 0 and 100 (exclusive of 0).');
      });

      it('should throw for invalid lowerPercent (NaN)', () => {
        expect(() => adapter._calculateTickRangeFromPercentages(0, 5, NaN, 60))
          .toThrow('Invalid lowerPercent: NaN. Must be a finite number.');
      });

      it('should throw for lowerPercent <= 0', () => {
        expect(() => adapter._calculateTickRangeFromPercentages(0, 5, -1, 60))
          .toThrow('Invalid lowerPercent: -1. Must be between 0 and 100 (exclusive of 0).');
      });

      it('should throw for lowerPercent > 100', () => {
        expect(() => adapter._calculateTickRangeFromPercentages(0, 5, 150, 60))
          .toThrow('Invalid lowerPercent: 150. Must be between 0 and 100 (exclusive of 0).');
      });

      it('should throw for invalid tickSpacing (NaN)', () => {
        expect(() => adapter._calculateTickRangeFromPercentages(0, 5, 5, NaN))
          .toThrow('Invalid tickSpacing: NaN. Must be a positive finite number.');
      });

      it('should throw for tickSpacing <= 0', () => {
        expect(() => adapter._calculateTickRangeFromPercentages(0, 5, 5, 0))
          .toThrow('Invalid tickSpacing: 0. Must be a positive finite number.');
      });

      it('should throw for negative tickSpacing', () => {
        expect(() => adapter._calculateTickRangeFromPercentages(0, 5, 5, -10))
          .toThrow('Invalid tickSpacing: -10. Must be a positive finite number.');
      });
    });

    describe('Success Cases', () => {
      it('should calculate correct tick range for 5% spread at tick 0', () => {
        const result = adapter._calculateTickRangeFromPercentages(0, 5, 5, 60);

        // 5% up: price = 1.05, tick = log(1.05)/log(1.0001) ≈ 488
        // 5% down: price = 0.95, tick = log(0.95)/log(1.0001) ≈ -513
        // Aligned to tick spacing 60: upper = 480, lower = -480
        expect(result.tickLower).toBeLessThan(0);
        expect(result.tickUpper).toBeGreaterThan(0);
        expect(result.tickLower % 60 == 0).toBe(true); // aligned to tick spacing
        expect(result.tickUpper % 60 == 0).toBe(true); // aligned to tick spacing
      });

      it('should align to tick spacing 10', () => {
        const result = adapter._calculateTickRangeFromPercentages(1000, 5, 5, 10);

        expect(result.tickLower % 10 == 0).toBe(true);
        expect(result.tickUpper % 10 == 0).toBe(true);
      });

      it('should align to tick spacing 1', () => {
        const result = adapter._calculateTickRangeFromPercentages(1000, 5, 5, 1);

        // spacing 1 means any integer is valid
        expect(Number.isInteger(result.tickLower)).toBe(true);
        expect(Number.isInteger(result.tickUpper)).toBe(true);
      });

      it('should align to tick spacing 200', () => {
        const result = adapter._calculateTickRangeFromPercentages(1000, 10, 10, 200);

        expect(result.tickLower % 200 == 0).toBe(true);
        expect(result.tickUpper % 200 == 0).toBe(true);
      });

      it('should handle negative currentTick', () => {
        const result = adapter._calculateTickRangeFromPercentages(-50000, 5, 5, 60);

        expect(result.tickLower).toBeLessThan(-50000);
        expect(result.tickUpper).toBeGreaterThan(-50000);
        expect(result.tickLower % 60 == 0).toBe(true);
        expect(result.tickUpper % 60 == 0).toBe(true);
      });

      it('should clamp to platform tick bounds', () => {
        // Very high tick near max bound
        const result = adapter._calculateTickRangeFromPercentages(887000, 5, 5, 60);

        expect(result.tickUpper).toBeLessThanOrEqual(887272); // max tick
      });

      it('should return tickLower < tickUpper', () => {
        const result = adapter._calculateTickRangeFromPercentages(0, 5, 5, 60);

        expect(result.tickLower).toBeLessThan(result.tickUpper);
      });

      it('should handle arbitrary tick spacing (V4 flexibility)', () => {
        // V4 allows any tick spacing, not just the V3 standard ones
        const result = adapter._calculateTickRangeFromPercentages(0, 5, 5, 42);

        // Use == 0 to handle -0 vs +0 edge case
        expect(result.tickLower % 42 == 0).toBe(true);
        expect(result.tickUpper % 42 == 0).toBe(true);
      });
    });
  });

  describe('getPositionRange', () => {
    describe('Error Cases', () => {
      it('should throw when poolData is null', () => {
        expect(() => adapter.getPositionRange(null, 5, 5))
          .toThrow('poolData is required and must be an object');
      });

      it('should throw when poolData is undefined', () => {
        expect(() => adapter.getPositionRange(undefined, 5, 5))
          .toThrow('poolData is required and must be an object');
      });

      it('should throw when poolData is not an object', () => {
        expect(() => adapter.getPositionRange('invalid', 5, 5))
          .toThrow('poolData is required and must be an object');
      });

      it('should throw when poolData.tick is missing', () => {
        expect(() => adapter.getPositionRange({ tickSpacing: 60 }, 5, 5))
          .toThrow('poolData.tick is required');
      });

      it('should throw when poolData.tick is null', () => {
        expect(() => adapter.getPositionRange({ tick: null, tickSpacing: 60 }, 5, 5))
          .toThrow('poolData.tick is required');
      });

      it('should throw when poolData.tick is not finite', () => {
        expect(() => adapter.getPositionRange({ tick: Infinity, tickSpacing: 60 }, 5, 5))
          .toThrow('poolData.tick must be a finite number');
      });

      it('should throw when poolData.tickSpacing is missing', () => {
        expect(() => adapter.getPositionRange({ tick: 0 }, 5, 5))
          .toThrow('poolData.tickSpacing is required');
      });

      it('should throw when poolData.tickSpacing is null', () => {
        expect(() => adapter.getPositionRange({ tick: 0, tickSpacing: null }, 5, 5))
          .toThrow('poolData.tickSpacing is required');
      });

      it('should throw when poolData.tickSpacing is not positive', () => {
        expect(() => adapter.getPositionRange({ tick: 0, tickSpacing: 0 }, 5, 5))
          .toThrow('poolData.tickSpacing must be a positive finite number');
      });

      it('should throw when poolData.tickSpacing is negative', () => {
        expect(() => adapter.getPositionRange({ tick: 0, tickSpacing: -10 }, 5, 5))
          .toThrow('poolData.tickSpacing must be a positive finite number');
      });

      it('should throw when upperPercent is missing', () => {
        expect(() => adapter.getPositionRange({ tick: 0, tickSpacing: 60 }, undefined, 5))
          .toThrow('upperPercent is required');
      });

      it('should throw when upperPercent is null', () => {
        expect(() => adapter.getPositionRange({ tick: 0, tickSpacing: 60 }, null, 5))
          .toThrow('upperPercent is required');
      });

      it('should throw when upperPercent is not finite', () => {
        expect(() => adapter.getPositionRange({ tick: 0, tickSpacing: 60 }, NaN, 5))
          .toThrow('upperPercent must be a finite number');
      });

      it('should throw when lowerPercent is missing', () => {
        expect(() => adapter.getPositionRange({ tick: 0, tickSpacing: 60 }, 5, undefined))
          .toThrow('lowerPercent is required');
      });

      it('should throw when lowerPercent is null', () => {
        expect(() => adapter.getPositionRange({ tick: 0, tickSpacing: 60 }, 5, null))
          .toThrow('lowerPercent is required');
      });

      it('should throw when lowerPercent is not finite', () => {
        expect(() => adapter.getPositionRange({ tick: 0, tickSpacing: 60 }, 5, Infinity))
          .toThrow('lowerPercent must be a finite number');
      });
    });

    describe('Success Cases', () => {
      it('should calculate range for 5% upper/lower', () => {
        const poolData = { tick: 0, tickSpacing: 60 };
        const result = adapter.getPositionRange(poolData, 5, 5);

        expect(result).toHaveProperty('tickLower');
        expect(result).toHaveProperty('tickUpper');
        expect(result).toHaveProperty('currentTick');
        expect(result.currentTick).toBe(0);
        expect(result.tickLower).toBeLessThan(result.tickUpper);
      });

      it('should align ticks to tick spacing', () => {
        const poolData = { tick: 1000, tickSpacing: 60 };
        const result = adapter.getPositionRange(poolData, 5, 5);

        expect(result.tickLower % 60 == 0).toBe(true);
        expect(result.tickUpper % 60 == 0).toBe(true);
      });

      it('should preserve currentTick in result', () => {
        const poolData = { tick: -12345, tickSpacing: 10 };
        const result = adapter.getPositionRange(poolData, 10, 10);

        expect(result.currentTick).toBe(-12345);
      });

      it('should handle different tick spacings', () => {
        const poolData1 = { tick: 0, tickSpacing: 1 };
        const poolData200 = { tick: 0, tickSpacing: 200 };

        const result1 = adapter.getPositionRange(poolData1, 5, 5);
        const result200 = adapter.getPositionRange(poolData200, 5, 5);

        // Both should have valid ranges
        expect(result1.tickLower).toBeLessThan(result1.tickUpper);
        expect(result200.tickLower).toBeLessThan(result200.tickUpper);

        // tick spacing alignment (use == 0 to handle -0 vs +0)
        expect(result1.tickLower % 1 == 0).toBe(true);
        expect(result200.tickLower % 200 == 0).toBe(true);
      });

      it('should handle arbitrary tick spacing (V4 flexibility)', () => {
        // V4 allows any tick spacing, not just V3 standard ones
        const poolData = { tick: 0, tickSpacing: 42 };
        const result = adapter.getPositionRange(poolData, 5, 5);

        // Use == 0 to handle -0 vs +0 edge case
        expect(result.tickLower % 42 == 0).toBe(true);
        expect(result.tickUpper % 42 == 0).toBe(true);
      });
    });
  });

  describe('_computePoolId', () => {
    const { ethers } = require('ethers');

    // Token addresses on Arbitrum (sorted for V4 PoolKey)
    const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
    const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

    describe('Success Cases', () => {
      it('should compute poolId from valid PoolKey', () => {
        // WETH < USDC when comparing addresses, so WETH is currency0
        const poolKey = {
          currency0: WETH,
          currency1: USDC,
          fee: 3000,
          tickSpacing: 60,
          hooks: ethers.constants.AddressZero
        };

        const poolId = adapter._computePoolId(poolKey);

        // Should return bytes32 format
        expect(poolId).toMatch(/^0x[a-fA-F0-9]{64}$/);
      });

      it('should produce deterministic results', () => {
        const poolKey = {
          currency0: WETH,
          currency1: USDC,
          fee: 3000,
          tickSpacing: 60,
          hooks: ethers.constants.AddressZero
        };

        const poolId1 = adapter._computePoolId(poolKey);
        const poolId2 = adapter._computePoolId(poolKey);

        expect(poolId1).toBe(poolId2);
      });

      it('should produce different poolIds for different fee tiers', () => {
        const poolKey500 = {
          currency0: WETH,
          currency1: USDC,
          fee: 500,
          tickSpacing: 10,
          hooks: ethers.constants.AddressZero
        };

        const poolKey3000 = {
          currency0: WETH,
          currency1: USDC,
          fee: 3000,
          tickSpacing: 60,
          hooks: ethers.constants.AddressZero
        };

        const poolId500 = adapter._computePoolId(poolKey500);
        const poolId3000 = adapter._computePoolId(poolKey3000);

        expect(poolId500).not.toBe(poolId3000);
      });

      it('should produce different poolIds for different hooks', () => {
        const poolKeyNoHooks = {
          currency0: WETH,
          currency1: USDC,
          fee: 3000,
          tickSpacing: 60,
          hooks: ethers.constants.AddressZero
        };

        const poolKeyWithHooks = {
          currency0: WETH,
          currency1: USDC,
          fee: 3000,
          tickSpacing: 60,
          hooks: '0x1234567890123456789012345678901234567890'
        };

        const poolIdNoHooks = adapter._computePoolId(poolKeyNoHooks);
        const poolIdWithHooks = adapter._computePoolId(poolKeyWithHooks);

        expect(poolIdNoHooks).not.toBe(poolIdWithHooks);
      });
    });

    describe('Validation', () => {
      it('should throw for null poolKey', () => {
        expect(() => adapter._computePoolId(null))
          .toThrow('poolKey parameter is required');
      });

      it('should throw for missing currency0', () => {
        expect(() => adapter._computePoolId({ currency1: USDC, fee: 3000, tickSpacing: 60, hooks: ethers.constants.AddressZero }))
          .toThrow('poolKey must have currency0 and currency1');
      });

      it('should throw for missing currency1', () => {
        expect(() => adapter._computePoolId({ currency0: WETH, fee: 3000, tickSpacing: 60, hooks: ethers.constants.AddressZero }))
          .toThrow('poolKey must have currency0 and currency1');
      });

      it('should throw for missing fee', () => {
        expect(() => adapter._computePoolId({ currency0: WETH, currency1: USDC, tickSpacing: 60, hooks: ethers.constants.AddressZero }))
          .toThrow('poolKey must have fee');
      });

      it('should throw for missing tickSpacing', () => {
        expect(() => adapter._computePoolId({ currency0: WETH, currency1: USDC, fee: 3000, hooks: ethers.constants.AddressZero }))
          .toThrow('poolKey must have tickSpacing');
      });

      it('should throw for missing hooks', () => {
        expect(() => adapter._computePoolId({ currency0: WETH, currency1: USDC, fee: 3000, tickSpacing: 60 }))
          .toThrow('poolKey must have hooks');
      });

      it('should throw for unsorted currencies', () => {
        // USDC > WETH in address comparison, so this is wrong order
        expect(() => adapter._computePoolId({
          currency0: USDC,  // Wrong - should be lower address
          currency1: WETH,
          fee: 3000,
          tickSpacing: 60,
          hooks: ethers.constants.AddressZero
        })).toThrow('currency0 must be less than currency1');
      });

      it('should throw for invalid address format', () => {
        expect(() => adapter._computePoolId({
          currency0: 'not-an-address',
          currency1: USDC,
          fee: 3000,
          tickSpacing: 60,
          hooks: ethers.constants.AddressZero
        })).toThrow('Invalid address in poolKey');
      });
    });
  });

  describe('getPoolData', () => {
    describe('Parameter Validation', () => {
      it('should reject missing poolId', async () => {
        await expect(adapter.getPoolData(null, env.provider))
          .rejects.toThrow('poolId parameter is required');

        await expect(adapter.getPoolData(undefined, env.provider))
          .rejects.toThrow('poolId parameter is required');

        await expect(adapter.getPoolData('', env.provider))
          .rejects.toThrow('poolId parameter is required');
      });

      it('should reject invalid poolId format - not bytes32', async () => {
        // Too short
        await expect(adapter.getPoolData('0x123', env.provider))
          .rejects.toThrow('Invalid poolId format');

        // Wrong length (address instead of bytes32)
        await expect(adapter.getPoolData('0x1234567890123456789012345678901234567890', env.provider))
          .rejects.toThrow('Invalid poolId format');

        // Not hex - still fails format validation
        await expect(adapter.getPoolData('not-a-hex-string', env.provider))
          .rejects.toThrow('Invalid poolId format');
      });

      it('should reject missing provider', async () => {
        const validPoolId = '0x' + '0'.repeat(64);
        await expect(adapter.getPoolData(validPoolId, null))
          .rejects.toThrow('Provider parameter is required');

        await expect(adapter.getPoolData(validPoolId, undefined))
          .rejects.toThrow('Provider parameter is required');
      });

      it('should accept valid bytes32 poolId format', async () => {
        // Valid format but non-existent pool should fail at contract level, not validation
        const validPoolId = '0x' + 'a'.repeat(64);

        // This should pass validation but fail when querying StateView
        // (pool doesn't exist, so StateView will return zeros or revert)
        try {
          await adapter.getPoolData(validPoolId, env.provider);
        } catch (error) {
          // Should NOT be a validation error - should be a contract/data error
          expect(error.message).not.toContain('poolId parameter is required');
          expect(error.message).not.toContain('Invalid poolId format');
          expect(error.message).not.toContain('Provider parameter is required');
        }
      });
    });

    describe('Return Structure', () => {
      const { ethers } = require('ethers');

      // Token addresses on Arbitrum (sorted for V4 PoolKey)
      const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
      const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

      // Common V4 pool configurations to try
      const poolConfigs = [
        { fee: 500, tickSpacing: 10 },
        { fee: 3000, tickSpacing: 60 },
        { fee: 10000, tickSpacing: 200 }
      ];

      it('should return pool data with correct structure for existing pool', async () => {
        // Try to find an existing WETH/USDC pool
        let poolData = null;
        let poolId = null;

        for (const config of poolConfigs) {
          const poolKey = {
            currency0: WETH,
            currency1: USDC,
            fee: config.fee,
            tickSpacing: config.tickSpacing,
            hooks: ethers.constants.AddressZero
          };

          poolId = adapter._computePoolId(poolKey);

          try {
            poolData = await adapter.getPoolData(poolId, env.provider);
            // If we get here without error, we found a pool
            if (poolData.liquidity !== '0') {
              break; // Found an active pool
            }
          } catch (error) {
            // Pool doesn't exist or query failed, try next config
            continue;
          }
        }

        // If no pool found, skip test (V4 may not have pools on this fork yet)
        if (!poolData || poolData.liquidity === '0') {
          console.log('No active V4 WETH/USDC pool found on fork - skipping structure test');
          return;
        }

        // Core fields (V3-compatible interface)
        expect(poolData).toHaveProperty('address');
        expect(poolData).toHaveProperty('sqrtPriceX96');
        expect(poolData).toHaveProperty('tick');
        expect(poolData).toHaveProperty('liquidity');
        expect(poolData).toHaveProperty('fee');
        expect(poolData).toHaveProperty('feeGrowthGlobal0X128');
        expect(poolData).toHaveProperty('feeGrowthGlobal1X128');
        expect(poolData).toHaveProperty('lastUpdated');

        // V4-specific fields
        expect(poolData).toHaveProperty('protocolFee');
        expect(poolData).toHaveProperty('lpFee');

        // Type checks
        expect(poolData.address).toBe(poolId); // V4 returns poolId in address field
        expect(typeof poolData.sqrtPriceX96).toBe('string');
        expect(typeof poolData.tick).toBe('number');
        expect(typeof poolData.liquidity).toBe('string');
        expect(typeof poolData.fee).toBe('number');
        expect(typeof poolData.feeGrowthGlobal0X128).toBe('string');
        expect(typeof poolData.feeGrowthGlobal1X128).toBe('string');
        expect(typeof poolData.lastUpdated).toBe('number');
        expect(typeof poolData.protocolFee).toBe('number');
        expect(typeof poolData.lpFee).toBe('number');

        // fee should equal lpFee (V3 compatibility alias)
        expect(poolData.fee).toBe(poolData.lpFee);
      });

      it('should return valid numeric values for existing pool', async () => {
        // Try to find an existing WETH/USDC pool
        let poolData = null;

        for (const config of poolConfigs) {
          const poolKey = {
            currency0: WETH,
            currency1: USDC,
            fee: config.fee,
            tickSpacing: config.tickSpacing,
            hooks: ethers.constants.AddressZero
          };

          const poolId = adapter._computePoolId(poolKey);

          try {
            poolData = await adapter.getPoolData(poolId, env.provider);
            if (poolData.liquidity !== '0') {
              break; // Found an active pool
            }
          } catch (error) {
            continue;
          }
        }

        // If no pool found, skip test
        if (!poolData || poolData.liquidity === '0') {
          console.log('No active V4 WETH/USDC pool found on fork - skipping values test');
          return;
        }

        // Tick should be in valid range
        expect(poolData.tick).toBeGreaterThanOrEqual(-887272);
        expect(poolData.tick).toBeLessThanOrEqual(887272);

        // Fees should be non-negative
        expect(poolData.fee).toBeGreaterThanOrEqual(0);
        expect(poolData.protocolFee).toBeGreaterThanOrEqual(0);
        expect(poolData.lpFee).toBeGreaterThanOrEqual(0);

        // lastUpdated should be recent
        expect(poolData.lastUpdated).toBeGreaterThan(Date.now() - 60000); // Within last minute
      });

      it('should handle non-existent pool gracefully', async () => {
        // Create a poolId for a pool that definitely doesn't exist
        const poolKey = {
          currency0: WETH,
          currency1: USDC,
          fee: 12345, // Non-standard fee tier
          tickSpacing: 1,
          hooks: ethers.constants.AddressZero
        };

        const poolId = adapter._computePoolId(poolKey);

        // StateView should return zeros for non-existent pool (or could error)
        try {
          const poolData = await adapter.getPoolData(poolId, env.provider);
          // If it returns data, it should be zeros
          expect(poolData.liquidity).toBe('0');
          expect(poolData.sqrtPriceX96).toBe('0');
        } catch (error) {
          // Some implementations may throw for non-existent pools
          expect(error.message).toContain('Failed to get pool data');
        }
      });
    });
  });

  describe('generateCreatePositionData', () => {
    const { ethers } = require('ethers');

    // Token addresses on Arbitrum
    // V4 uses native ETH (address(0)) which is always < any other address
    const NATIVE_ETH = ethers.constants.AddressZero;
    const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';

    // Mock pool data for validation tests (not used in success tests)
    // Success tests use real pool data from _fetchPoolData
    const mockPoolKey = {
      currency0: NATIVE_ETH,  // ETH is always currency0 (lowest address)
      currency1: USDC,
      fee: 3000,
      tickSpacing: 60,
      hooks: ethers.constants.AddressZero
    };

    const mockPoolData = {
      fee: 3000,
      sqrtPriceX96: '79228162514264337593543950336', // sqrt(1) * 2^96
      liquidity: '1000000000000000000',
      tick: 0
    };

    const mockToken0Data = {
      address: NATIVE_ETH,
      decimals: 18,
      symbol: 'ETH'
    };

    const mockToken1Data = {
      address: USDC,
      decimals: 6,
      symbol: 'USDC'
    };

    const mockPosition = {
      tickLower: -60,
      tickUpper: 60
    };

    const validWalletAddress = '0x1234567890123456789012345678901234567890';

    describe('Parameter Validation', () => {
      describe('position validation', () => {
        it('should throw for null position', async () => {
          await expect(adapter.generateCreatePositionData({
            position: null,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('Position parameter is required');
        });

        it('should throw for missing tickLower', async () => {
          await expect(adapter.generateCreatePositionData({
            position: { tickUpper: 60 },
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('Position tickLower is required');
        });

        it('should throw for tickLower >= tickUpper', async () => {
          await expect(adapter.generateCreatePositionData({
            position: { tickLower: 60, tickUpper: 60 },
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('Position tickLower must be less than tickUpper');
        });
      });

      describe('token amount validation', () => {
        it('should throw for missing token0Amount', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: null,
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('Token0 amount is required');
        });

        it('should throw for non-string token0Amount', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: 1000000000000000000,
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('Token0 amount must be a string');
        });

        it('should throw when both amounts are zero', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '0',
            token1Amount: '0',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('At least one token amount must be greater than 0');
        });
      });

      describe('poolKey validation', () => {
        it('should throw for missing poolKey', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: null,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('PoolKey parameter is required for V4');
        });

        it('should throw for missing poolKey.currency0', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: { ...mockPoolKey, currency0: null },
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('PoolKey must have currency0 and currency1');
        });

        it('should throw for unsorted poolKey currencies', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: { ...mockPoolKey, currency0: USDC, currency1: WETH }, // Wrong order
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('PoolKey currency0 must be less than currency1');
        });

        it('should throw for missing poolKey.hooks', async () => {
          const poolKeyNoHooks = { ...mockPoolKey };
          delete poolKeyNoHooks.hooks;
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: poolKeyNoHooks,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('PoolKey must have hooks');
        });
      });

      describe('poolData validation', () => {
        it('should throw for missing poolData', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: null,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('Pool data parameter is required');
        });

        it('should throw for missing sqrtPriceX96', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: { ...mockPoolData, sqrtPriceX96: null },
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('Pool data sqrtPriceX96 is required');
        });
      });

      describe('wallet and provider validation', () => {
        it('should throw for missing provider', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: null,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('Provider parameter is required');
        });

        it('should throw for missing walletAddress', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: null,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('Wallet address is required');
        });

        it('should throw for invalid walletAddress', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: 'not-an-address',
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('Invalid wallet address');
        });
      });

      describe('slippage and deadline validation', () => {
        it('should throw for missing slippageTolerance', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: null,
            deadlineMinutes: 30
          })).rejects.toThrow('Slippage tolerance is required');
        });

        it('should throw for slippageTolerance > 100', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 150,
            deadlineMinutes: 30
          })).rejects.toThrow('Slippage tolerance must be between 0 and 100');
        });

        it('should throw for missing deadlineMinutes', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: null
          })).rejects.toThrow('Deadline minutes is required');
        });

        it('should throw for deadlineMinutes <= 0', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 0
          })).rejects.toThrow('Deadline minutes must be greater than 0');
        });
      });

      describe('token data validation', () => {
        it('should throw for missing token0Data', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: null,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('Token0 data parameter is required');
        });

        it('should throw for same token addresses', async () => {
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolKey: mockPoolKey,
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: { ...mockToken1Data, address: NATIVE_ETH }, // Same as token0
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('Token0 and token1 addresses cannot be the same');
        });
      });
    });

    describe('Success Cases', () => {
      // V4 native ETH/USDC pool configuration (500 fee tier, 10 tick spacing)
      const FEE = 500;
      const TICK_SPACING = 10;

      let baseParams;

      beforeAll(async () => {
        // Fetch real pool data for native ETH/USDC 500 fee tier pool
        const fetchedPoolData = await adapter._fetchPoolData(
          NATIVE_ETH,
          USDC,
          FEE,
          TICK_SPACING,
          ethers.constants.AddressZero,
          env.provider
        );

        // Verify pool has liquidity
        if (!fetchedPoolData || fetchedPoolData.liquidity === '0') {
          throw new Error(
            'V4 native ETH/USDC 500 fee tier pool has no liquidity on Arbitrum fork. ' +
            'Tests require an active pool. Check fork block number or StateView address.'
          );
        }

        // Calculate tick range around current tick
        const tickLower = Math.floor(fetchedPoolData.tick / TICK_SPACING) * TICK_SPACING - TICK_SPACING * 10;
        const tickUpper = Math.ceil(fetchedPoolData.tick / TICK_SPACING) * TICK_SPACING + TICK_SPACING * 10;

        baseParams = {
          position: {
            tickLower,
            tickUpper
          },
          token0Amount: ethers.utils.parseEther('0.01').toString(), // 0.01 ETH
          token1Amount: ethers.utils.parseUnits('10', 6).toString(), // 10 USDC
          provider: env.provider,
          walletAddress: validWalletAddress,
          poolKey: fetchedPoolData.poolKey,
          poolData: fetchedPoolData,
          token0Data: fetchedPoolData.token0,
          token1Data: fetchedPoolData.token1,
          slippageTolerance: 0.5,
          deadlineMinutes: 30
        };

        console.log(`Using V4 ETH/USDC pool: tick ${fetchedPoolData.tick}, liquidity ${fetchedPoolData.liquidity}`);
      });

      it('should generate valid transaction data with both token amounts', async () => {
        const result = await adapter.generateCreatePositionData(baseParams);

        // Should return transaction data
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');

        // 'to' should be the PositionManager address
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);

        // 'data' should be hex string (encoded calldata)
        expect(result.data).toMatch(/^0x/);

        // 'value' should be string (ETH value to send for native ETH)
        expect(typeof result.value).toBe('string');
      });

      it('should include quote with liquidity and amounts', async () => {
        const result = await adapter.generateCreatePositionData(baseParams);

        expect(result.quote).toHaveProperty('liquidity');
        expect(result.quote).toHaveProperty('mintAmount0');
        expect(result.quote).toHaveProperty('mintAmount1');
        expect(result.quote).toHaveProperty('tokensSwapped');

        // Liquidity should be a positive numeric string
        expect(result.quote.liquidity).toMatch(/^\d+$/);
        expect(BigInt(result.quote.liquidity)).toBeGreaterThan(0n);
      });

      it('should work with only token0 amount (token1 = 0)', async () => {
        const result = await adapter.generateCreatePositionData({
          ...baseParams,
          token1Amount: '0'
        });

        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result.quote.liquidity).toMatch(/^\d+$/);
      });

      it('should work with only token1 amount (token0 = 0)', async () => {
        const result = await adapter.generateCreatePositionData({
          ...baseParams,
          token0Amount: '0'
        });

        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result.quote.liquidity).toMatch(/^\d+$/);
      });

      it('should handle token sorting correctly when tokens passed in wrong order', async () => {
        // Pass tokens in reverse order (USDC as token0, ETH as token1)
        const result = await adapter.generateCreatePositionData({
          ...baseParams,
          token0Amount: baseParams.token1Amount, // USDC amount
          token1Amount: baseParams.token0Amount, // ETH amount
          token0Data: baseParams.token1Data, // USDC as "token0"
          token1Data: baseParams.token0Data  // ETH as "token1"
        });

        // Should still work - adapter sorts tokens internally
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result.quote.tokensSwapped).toBe(true);
      });

      it('should accept hookData parameter', async () => {
        const result = await adapter.generateCreatePositionData({
          ...baseParams,
          hookData: '0x1234'
        });

        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
      });

      it('should execute successfully and create a position', async () => {
        const signer = env.signers[0];

        // Use smaller amounts for execution test
        const execParams = {
          ...baseParams,
          token0Amount: ethers.utils.parseEther('0.001').toString(), // 0.001 ETH
          token1Amount: ethers.utils.parseUnits('3', 6).toString(),   // 3 USDC
          walletAddress: signer.address,
          slippageTolerance: 5 // Higher slippage for test reliability
        };

        const txData = await adapter.generateCreatePositionData(execParams);

        // Execute the transaction
        const tx = await signer.sendTransaction({
          to: txData.to,
          data: txData.data,
          value: txData.value,
          gasLimit: 1000000
        });
        const receipt = await tx.wait();

        // Verify transaction succeeded
        expect(receipt.status).toBe(1);

        // Verify quote liquidity is positive
        expect(BigInt(txData.quote.liquidity)).toBeGreaterThan(0n);

        console.log(`Position created - Liquidity: ${txData.quote.liquidity}, ETH: ${ethers.utils.formatEther(txData.quote.mintAmount0)}, USDC: ${ethers.utils.formatUnits(txData.quote.mintAmount1, 6)}`);
      }, 120000);

      it('should execute with only native ETH (no USDC)', async () => {
        const signer = env.signers[0];

        const execParams = {
          ...baseParams,
          token0Amount: ethers.utils.parseEther('0.002').toString(),
          token1Amount: '0',
          walletAddress: signer.address,
          slippageTolerance: 5
        };

        const txData = await adapter.generateCreatePositionData(execParams);

        const tx = await signer.sendTransaction({
          to: txData.to,
          data: txData.data,
          value: txData.value,
          gasLimit: 1000000
        });
        const receipt = await tx.wait();

        expect(receipt.status).toBe(1);
        expect(BigInt(txData.quote.liquidity)).toBeGreaterThan(0n);
      }, 120000);
    });
  });

  describe('parseIncreaseLiquidityReceipt', () => {
    describe('Parameter Validation', () => {
      // Mock data for validation tests
      const mockPoolData = {
        sqrtPriceX96: '1461446703485210103287273052203988822378723970342',
        liquidity: '1000000000000000000',
        tick: -195243
      };
      const mockPosition = { tickLower: -195510, tickUpper: -194970 };

      // Helper to create minimal mock ModifyLiquidity log for validation tests
      const createMockModifyLiquidityLog = () => {
        const topic = ethers.utils.id('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)');
        const data = ethers.utils.defaultAbiCoder.encode(
          ['int24', 'int24', 'int256', 'bytes32'],
          [-195510, -194970, '1000000000000', ethers.constants.HashZero]
        );
        return {
          address: chains[1337].platformAddresses.uniswapV4.poolManagerAddress,
          topics: [topic, '0x' + 'a'.repeat(64), ethers.utils.hexZeroPad('0x1234', 32)],
          data
        };
      };

      it('should throw for null receipt', () => {
        expect(() => adapter.parseIncreaseLiquidityReceipt(null, { position: mockPosition, poolData: mockPoolData }))
          .toThrow('Receipt parameter is required');
      });

      it('should throw for undefined receipt', () => {
        expect(() => adapter.parseIncreaseLiquidityReceipt(undefined, { position: mockPosition, poolData: mockPoolData }))
          .toThrow('Receipt parameter is required');
      });

      it('should throw for receipt without logs property', () => {
        expect(() => adapter.parseIncreaseLiquidityReceipt({}, { position: mockPosition, poolData: mockPoolData }))
          .toThrow('Receipt must have logs property');
      });

      it('should throw for missing position parameter', () => {
        const receipt = { logs: [createMockModifyLiquidityLog()] };
        expect(() => adapter.parseIncreaseLiquidityReceipt(receipt, { poolData: mockPoolData }))
          .toThrow('position is required for V4 receipt parsing');
      });

      it('should throw for missing poolData.sqrtPriceX96', () => {
        const receipt = { logs: [createMockModifyLiquidityLog()] };
        expect(() => adapter.parseIncreaseLiquidityReceipt(receipt, { position: mockPosition, poolData: {} }))
          .toThrow('poolData.sqrtPriceX96 is required for V4 receipt parsing');
      });

      it('should throw when ModifyLiquidity event not found', () => {
        const receipt = { logs: [{ topics: ['0xwrong'], data: '0x' }] };
        expect(() => adapter.parseIncreaseLiquidityReceipt(receipt, { position: mockPosition, poolData: mockPoolData }))
          .toThrow('ModifyLiquidity event not found in receipt');
      });
    });

    describe('Success Cases', () => {
      // Token addresses - V4 uses native ETH (address(0))
      const NATIVE_ETH = ethers.constants.AddressZero;
      const TICK_SPACING = 10;

      // Pool data and signer come from the V4 environment setup
      // which already includes: ETH→USDC swap, Permit2 approvals
      let poolData;
      let signer;
      let USDC;

      beforeAll(() => {
        // Use pool data from V4 environment setup
        poolData = env.poolData;
        signer = env.signers[0];
        USDC = env.usdcAddress;
      });

      it('should parse real position creation receipt', async () => {
        // Calculate tick range around current tick
        const tickLower = Math.floor(poolData.tick / TICK_SPACING) * TICK_SPACING - TICK_SPACING * 10;
        const tickUpper = Math.ceil(poolData.tick / TICK_SPACING) * TICK_SPACING + TICK_SPACING * 10;

        const position = { tickLower, tickUpper };

        // Generate position creation transaction
        const txData = await adapter.generateCreatePositionData({
          position,
          token0Amount: ethers.utils.parseEther('0.001').toString(), // 0.001 ETH
          token1Amount: ethers.utils.parseUnits('3', 6).toString(),   // 3 USDC
          provider: env.provider,
          walletAddress: signer.address,
          poolKey: poolData.poolKey,
          poolData: poolData,
          token0Data: poolData.token0,
          token1Data: poolData.token1,
          slippageTolerance: 5, // 5% slippage for test reliability
          deadlineMinutes: 30
        });

        // Execute the transaction
        const tx = await signer.sendTransaction({
          to: txData.to,
          data: txData.data,
          value: txData.value,
          gasLimit: 1000000
        });
        const receipt = await tx.wait();

        expect(receipt.status).toBe(1);

        // Parse the receipt
        const result = adapter.parseIncreaseLiquidityReceipt(receipt, { position, poolData });

        // Verify result structure
        expect(result).toHaveProperty('tokenId');
        expect(result).toHaveProperty('liquidity');
        expect(result).toHaveProperty('amount0');
        expect(result).toHaveProperty('amount1');
        expect(result).toHaveProperty('tickLower');
        expect(result).toHaveProperty('tickUpper');
        expect(result).toHaveProperty('poolAddress');

        // tokenId should be a valid number string (new position minted)
        expect(result.tokenId).toMatch(/^\d+$/);
        expect(BigInt(result.tokenId)).toBeGreaterThan(0n);

        // liquidity should be positive (increase)
        expect(BigInt(result.liquidity)).toBeGreaterThan(0n);

        // amounts should be numeric strings
        expect(result.amount0).toMatch(/^\d+$/);
        expect(result.amount1).toMatch(/^\d+$/);

        // tick bounds should match what we requested
        expect(result.tickLower).toBe(tickLower);
        expect(result.tickUpper).toBe(tickUpper);

        console.log('Parsed receipt:', {
          tokenId: result.tokenId,
          liquidity: result.liquidity,
          amount0: result.amount0,
          amount1: result.amount1
        });
      });

      it('should correctly calculate amounts matching quote', async () => {
        const tickLower = Math.floor(poolData.tick / TICK_SPACING) * TICK_SPACING - TICK_SPACING * 5;
        const tickUpper = Math.ceil(poolData.tick / TICK_SPACING) * TICK_SPACING + TICK_SPACING * 5;
        const position = { tickLower, tickUpper };

        const txData = await adapter.generateCreatePositionData({
          position,
          token0Amount: ethers.utils.parseEther('0.0005').toString(),
          token1Amount: ethers.utils.parseUnits('1.5', 6).toString(),
          provider: env.provider,
          walletAddress: signer.address,
          poolKey: poolData.poolKey,
          poolData: poolData,
          token0Data: poolData.token0,
          token1Data: poolData.token1,
          slippageTolerance: 5,
          deadlineMinutes: 30
        });

        const tx = await signer.sendTransaction({
          to: txData.to,
          data: txData.data,
          value: txData.value,
          gasLimit: 1000000
        });
        const receipt = await tx.wait();

        const result = adapter.parseIncreaseLiquidityReceipt(receipt, { position, poolData });

        // Quote liquidity should match (or be close to) receipt liquidity
        const quoteLiquidity = BigInt(txData.quote.liquidity);
        const receiptLiquidity = BigInt(result.liquidity);

        // Allow 1% tolerance for rounding
        const tolerance = quoteLiquidity / 100n;
        const diff = quoteLiquidity > receiptLiquidity
          ? quoteLiquidity - receiptLiquidity
          : receiptLiquidity - quoteLiquidity;

        expect(diff).toBeLessThanOrEqual(tolerance);
      });
    });
  });
});
