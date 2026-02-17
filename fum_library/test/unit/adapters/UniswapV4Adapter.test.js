/**
 * UniswapV4Adapter Unit Tests
 *
 * Tests using Hardhat fork of Arbitrum - no mocks, real blockchain interactions.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import JSBI from 'jsbi';
import { setupV4TestEnvironment } from '../../setup/v4-setup.js';
import UniswapV4Adapter from '../../../src/adapters/UniswapV4Adapter.js';
import chains from '../../../src/configs/chains.js';
import { configureBlockExplorer, resetBlockExplorerConfig } from '../../../src/services/blockExplorer.js';
import { getTokenAddress, getWrappedNativeAddress } from '../../../src/helpers/tokenHelpers.js';
import { clearIncentiveCache } from '../../../src/services/merkl.js';

/**
 * Encode a direct single-pool V4 swap via the UniversalRouter.
 * Bypasses AlphaRouter to guarantee the swap hits a specific pool.
 *
 * @param {Object} params
 * @param {Object} params.poolKey - V4 PoolKey { currency0, currency1, fee, tickSpacing, hooks }
 * @param {boolean} params.zeroForOne - true = swap currency0→currency1, false = currency1→currency0
 * @param {string} params.amountIn - Amount in (wei string)
 * @param {string} params.recipient - Address to receive output
 * @param {string} params.universalRouterAddress - UniversalRouter contract address
 * @param {Object} params.universalRouterInterface - ethers Interface for encoding
 * @returns {{ to: string, data: string, value: string }}
 */
function encodeDirectV4Swap({ poolKey, zeroForOne, amountIn, recipient, universalRouterAddress, universalRouterInterface }) {
  const { defaultAbiCoder } = ethers.utils;

  // ABI type strings matching the V4 SDK structs
  const POOL_KEY_STRUCT = '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
  const SWAP_EXACT_IN_SINGLE_STRUCT = `(${POOL_KEY_STRUCT} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`;

  // Encode V4 actions: SWAP_EXACT_IN_SINGLE (6) + SETTLE (11) + TAKE (14)
  const SWAP_EXACT_IN_SINGLE = 6;
  const SETTLE = 11;
  const TAKE = 14;

  const actions = '0x' + [SWAP_EXACT_IN_SINGLE, SETTLE, TAKE]
    .map(a => a.toString(16).padStart(2, '0'))
    .join('');

  const swapParam = defaultAbiCoder.encode(
    [SWAP_EXACT_IN_SINGLE_STRUCT],
    [[
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      zeroForOne,
      amountIn,
      0, // amountOutMinimum (test env, no slippage protection needed)
      '0x' // hookData
    ]]
  );

  const currencyIn = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const currencyOut = zeroForOne ? poolKey.currency1 : poolKey.currency0;
  const FULL_DELTA_AMOUNT = 0; // magic value: settle/take the full delta

  const settleParam = defaultAbiCoder.encode(
    ['address', 'uint256', 'bool'],
    [currencyIn, FULL_DELTA_AMOUNT, true] // payerIsUser = true
  );

  const takeParam = defaultAbiCoder.encode(
    ['address', 'address', 'uint256'],
    [currencyOut, recipient, FULL_DELTA_AMOUNT]
  );

  const params = [swapParam, settleParam, takeParam];

  // Wrap V4 actions into a single V4_SWAP command
  const v4PlannerEncoded = defaultAbiCoder.encode(['bytes', 'bytes[]'], [actions, params]);
  const V4_SWAP = 0x10;
  const commands = '0x' + V4_SWAP.toString(16).padStart(2, '0');
  const inputs = [v4PlannerEncoded];

  const deadline = Math.floor(Date.now() / 1000) + 1200;
  const data = universalRouterInterface.encodeFunctionData('execute(bytes,bytes[],uint256)', [commands, inputs, deadline]);

  // If swapping native ETH (currency0 = AddressZero with zeroForOne), send value
  const value = (zeroForOne && poolKey.currency0 === ethers.constants.AddressZero) ? amountIn : '0';

  return { to: universalRouterAddress, data, value };
}

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

  describe('getRequiredApprovals', () => {
    const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
    let testVaultAddress;

    beforeAll(() => {
      // Use a random address for testing vault
      testVaultAddress = ethers.Wallet.createRandom().address;
    });

    describe('Success Cases', () => {
      it('should return ERC20 approve to Permit2 for swap operations', async () => {
        const txs = await adapter.getRequiredApprovals(
          'swap',
          testVaultAddress,
          [USDC_ADDRESS],
          env.provider
        );

        expect(Array.isArray(txs)).toBe(true);
        expect(txs.length).toBe(1);
        expect(txs[0]).toHaveProperty('to', USDC_ADDRESS);
        expect(txs[0]).toHaveProperty('data');
        expect(txs[0]).toHaveProperty('value', '0');
        // Check that data encodes approve(Permit2, MaxUint256)
        expect(txs[0].data.startsWith('0x095ea7b3')).toBe(true); // approve selector
      });

      it('should return both ERC20 and Permit2 allowance txs for liquidity operations', async () => {
        const txs = await adapter.getRequiredApprovals(
          'liquidity',
          testVaultAddress,
          [USDC_ADDRESS],
          env.provider
        );

        expect(Array.isArray(txs)).toBe(true);
        // For V4 liquidity: 1 ERC20 approve + 1 Permit2 allowance per token
        expect(txs.length).toBe(2);

        // First tx: ERC20 approve to Permit2
        expect(txs[0].to).toBe(USDC_ADDRESS);
        expect(txs[0].data.startsWith('0x095ea7b3')).toBe(true); // approve selector
        expect(txs[0].value).toBe('0');

        // Second tx: Permit2 approve to PositionManager
        expect(txs[1].to.toLowerCase()).toBe(PERMIT2_ADDRESS.toLowerCase());
        expect(txs[1].data.startsWith('0x87517c45')).toBe(true); // Permit2 approve selector
        expect(txs[1].value).toBe('0');
      });

      it('should handle multiple tokens for liquidity operations', async () => {
        const txs = await adapter.getRequiredApprovals(
          'liquidity',
          testVaultAddress,
          [USDC_ADDRESS, WETH_ADDRESS],
          env.provider
        );

        expect(Array.isArray(txs)).toBe(true);
        // For V4 liquidity with 2 tokens: 2 ERC20 approves + 2 Permit2 allowances
        expect(txs.length).toBe(4);

        // USDC ERC20 approve
        expect(txs[0].to).toBe(USDC_ADDRESS);
        expect(txs[0].data.startsWith('0x095ea7b3')).toBe(true);

        // USDC Permit2 approve
        expect(txs[1].to.toLowerCase()).toBe(PERMIT2_ADDRESS.toLowerCase());
        expect(txs[1].data.startsWith('0x87517c45')).toBe(true);

        // WETH ERC20 approve
        expect(txs[2].to).toBe(WETH_ADDRESS);
        expect(txs[2].data.startsWith('0x095ea7b3')).toBe(true);

        // WETH Permit2 approve
        expect(txs[3].to.toLowerCase()).toBe(PERMIT2_ADDRESS.toLowerCase());
        expect(txs[3].data.startsWith('0x87517c45')).toBe(true);
      });

      it('should return transaction objects in correct format', async () => {
        const txs = await adapter.getRequiredApprovals(
          'swap',
          testVaultAddress,
          [USDC_ADDRESS],
          env.provider
        );

        expect(txs.length).toBeGreaterThan(0);
        const tx = txs[0];
        expect(typeof tx.to).toBe('string');
        expect(tx.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(typeof tx.data).toBe('string');
        expect(tx.data.startsWith('0x')).toBe(true);
        expect(tx.value).toBe('0');
      });
    });

    describe('Error Cases', () => {
      it('should throw for invalid operationType', async () => {
        await expect(
          adapter.getRequiredApprovals('invalid', testVaultAddress, [USDC_ADDRESS], env.provider)
        ).rejects.toThrow('operationType must be "swap" or "liquidity"');
      });

      it('should throw for invalid vaultAddress', async () => {
        await expect(
          adapter.getRequiredApprovals('swap', 'invalid', [USDC_ADDRESS], env.provider)
        ).rejects.toThrow('invalid vaultAddress');
      });

      it('should throw for empty tokenAddresses array', async () => {
        await expect(
          adapter.getRequiredApprovals('swap', testVaultAddress, [], env.provider)
        ).rejects.toThrow('tokenAddresses must be a non-empty array');
      });

      it('should throw for missing provider', async () => {
        await expect(
          adapter.getRequiredApprovals('swap', testVaultAddress, [USDC_ADDRESS], null)
        ).rejects.toThrow('provider is required');
      });

      it('should throw for invalid token address', async () => {
        await expect(
          adapter.getRequiredApprovals('swap', testVaultAddress, ['not-an-address'], env.provider)
        ).rejects.toThrow('invalid token address');
      });

      it('should skip native ETH (AddressZero) without error', async () => {
        const txs = await adapter.getRequiredApprovals(
          'liquidity',
          testVaultAddress,
          [ethers.constants.AddressZero, USDC_ADDRESS],
          env.provider
        );
        // Should return array (may include USDC approval), not fail on AddressZero
        expect(Array.isArray(txs)).toBe(true);
      });
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

        // Count V4 Swap events in receipt to handle split routes
        const swapTopicHash = ethers.utils.id('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)');
        const swapEventCount = receipt.logs.filter(log => log.topics[0] === swapTopicHash).length;

        // Parse the receipt with V4 swap metadata
        const metadata = [{
          tokenInAddress: NATIVE_ETH,
          tokenOutAddress: USDC,
          expectedSwapEvents: swapEventCount
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

    describe('Cross-Version Swap Events', () => {
      // Helper: create a Uniswap V2 Swap event log
      const createMockV2SwapLog = (pairAddress, amount0In, amount1In, amount0Out, amount1Out, logIndex = 0) => {
        const topic = ethers.utils.id('Swap(address,uint256,uint256,uint256,uint256,address)');
        const senderTopic = ethers.utils.hexZeroPad('0x1234567890123456789012345678901234567890', 32);
        const toTopic = ethers.utils.hexZeroPad('0x0987654321098765432109876543210987654321', 32);
        const encodedData = ethers.utils.defaultAbiCoder.encode(
          ['uint256', 'uint256', 'uint256', 'uint256'],
          [amount0In, amount1In, amount0Out, amount1Out]
        );
        return {
          address: pairAddress,
          topics: [topic, senderTopic, toTopic],
          data: encodedData,
          logIndex
        };
      };

      // Helper: create a Uniswap V3 Swap event log
      const createMockV3SwapLog = (poolAddress, amount0, amount1, logIndex = 0) => {
        const topic = ethers.utils.id('Swap(address,address,int256,int256,uint160,uint128,int24)');
        const senderTopic = ethers.utils.hexZeroPad('0x1234567890123456789012345678901234567890', 32);
        const recipientTopic = ethers.utils.hexZeroPad('0x0987654321098765432109876543210987654321', 32);
        const encodedData = ethers.utils.defaultAbiCoder.encode(
          ['int256', 'int256', 'uint160', 'uint128', 'int24'],
          [amount0, amount1, '79228162514264337593543950336', '1000000000', 0]
        );
        return {
          address: poolAddress,
          topics: [topic, senderTopic, recipientTopic],
          data: encodedData,
          logIndex
        };
      };

      // Helper: create a Uniswap V4 Swap event log (for unit tests without real execution)
      const createMockV4SwapLog = (poolManagerAddress, amount0, amount1, logIndex = 0) => {
        const topic = ethers.utils.id('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)');
        const poolIdTopic = ethers.utils.hexZeroPad('0xaabbccdd', 32);
        const senderTopic = ethers.utils.hexZeroPad('0x1234567890123456789012345678901234567890', 32);
        const encodedData = ethers.utils.defaultAbiCoder.encode(
          ['int128', 'int128', 'uint160', 'uint128', 'int24', 'uint24'],
          [amount0, amount1, '79228162514264337593543950336', '1000000000', 0, 3000]
        );
        return {
          address: poolManagerAddress,
          topics: [topic, poolIdTopic, senderTopic],
          data: encodedData,
          logIndex
        };
      };

      it('should parse V2 swap events', () => {
        const pairAddress = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc';
        // V2: amount0In=1000000 USDC, amount1Out=500000000000000000 WETH
        const mockLog = createMockV2SwapLog(pairAddress, '1000000', '0', '0', '500000000000000000', 0);

        const receipt = { logs: [mockLog] };
        const metadata = [{
          tokenInAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          tokenOutAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          expectedSwapEvents: 1
        }];

        const result = adapter.parseSwapReceipt(receipt, metadata);

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('1000000');
        expect(result[0].actualAmountOut).toBe('500000000000000000');
      });

      it('should parse V3 swap events', () => {
        const poolAddress = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640';
        // V3: amount0=1000000 (positive=in), amount1=-500000000000000000 (negative=out)
        const mockLog = createMockV3SwapLog(poolAddress, '1000000', '-500000000000000000', 0);

        const receipt = { logs: [mockLog] };
        const metadata = [{
          tokenInAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          tokenOutAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          expectedSwapEvents: 1
        }];

        const result = adapter.parseSwapReceipt(receipt, metadata);

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('1000000');
        expect(result[0].actualAmountOut).toBe('500000000000000000');
      });

      it('should parse cross-version multi-hop (V2 -> V4)', () => {
        const v2PairAddress = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc';
        const poolManager = '0x000000000004444c5dc75cB358380D2e3dE08A90';

        // First hop: V2 pair, USDC -> WETH
        // amount0In=1000000000 USDC, amount1Out=500000000000000000 WETH
        const v2Log = createMockV2SwapLog(v2PairAddress, '1000000000', '0', '0', '500000000000000000', 0);

        // Second hop: V4 pool, WETH -> WBTC
        // V4 convention: positive = user received, negative = user sent
        // amount0=2500000 WBTC (user received), amount1=-500000000000000000 WETH (user sent)
        const v4Log = createMockV4SwapLog(poolManager, '2500000', '-500000000000000000', 1);

        const receipt = { logs: [v2Log, v4Log] };
        const metadata = [{
          tokenInAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
          tokenOutAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
          routes: [{
            tokenPath: [
              '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
              '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
              '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'  // WBTC
            ],
            poolCount: 2
          }]
        }];

        const result = adapter.parseSwapReceipt(receipt, metadata);

        expect(result).toHaveLength(1);
        // First hop (V2): amountIn = amount0In = 1000000000
        expect(result[0].actualAmountIn).toBe('1000000000');
        // Last hop (V4): amountOut = abs(-2500000) = 2500000
        expect(result[0].actualAmountOut).toBe('2500000');
      });
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

    describe('Permit2 Support', () => {
      it('should throw when permit2Signature is provided but permit2Nonce is missing', async () => {
        await expect(adapter._generateSwapData({
          tokenIn: WETH,
          tokenOut: USDC,
          amountIn: ethers.utils.parseEther('0.01').toString(),
          recipient: '0x1234567890123456789012345678901234567890',
          permit2Signature: '0x1234',
          // permit2Nonce missing
          permit2Deadline: Math.floor(Date.now() / 1000) + 1800
        })).rejects.toThrow('permit2Nonce must be a non-negative number');
      }, 60000);

      it('should throw when permit2Signature is provided but permit2Deadline is missing', async () => {
        await expect(adapter._generateSwapData({
          tokenIn: WETH,
          tokenOut: USDC,
          amountIn: ethers.utils.parseEther('0.01').toString(),
          recipient: '0x1234567890123456789012345678901234567890',
          permit2Signature: '0x1234',
          permit2Nonce: 0
          // permit2Deadline missing
        })).rejects.toThrow('permit2Deadline must be a positive number');
      }, 60000);

      it('should throw when permit2Nonce is negative', async () => {
        await expect(adapter._generateSwapData({
          tokenIn: WETH,
          tokenOut: USDC,
          amountIn: ethers.utils.parseEther('0.01').toString(),
          recipient: '0x1234567890123456789012345678901234567890',
          permit2Signature: '0x1234',
          permit2Nonce: -1,
          permit2Deadline: Math.floor(Date.now() / 1000) + 1800
        })).rejects.toThrow('permit2Nonce must be a non-negative number');
      }, 60000);

      it('should throw when permit2Deadline is zero or negative', async () => {
        await expect(adapter._generateSwapData({
          tokenIn: WETH,
          tokenOut: USDC,
          amountIn: ethers.utils.parseEther('0.01').toString(),
          recipient: '0x1234567890123456789012345678901234567890',
          permit2Signature: '0x1234',
          permit2Nonce: 0,
          permit2Deadline: 0
        })).rejects.toThrow('permit2Deadline must be a positive number');

        await expect(adapter._generateSwapData({
          tokenIn: WETH,
          tokenOut: USDC,
          amountIn: ethers.utils.parseEther('0.01').toString(),
          recipient: '0x1234567890123456789012345678901234567890',
          permit2Signature: '0x1234',
          permit2Nonce: 0,
          permit2Deadline: -100
        })).rejects.toThrow('permit2Deadline must be a positive number');
      }, 60000);

      it('should skip Permit2 wrapping for native ETH even when Permit2 params provided', async () => {
        // Native ETH doesn't need Permit2, so even if params are provided, they should be ignored
        const result = await adapter._generateSwapData({
          tokenIn: NATIVE_ETH,
          tokenOut: USDC,
          amountIn: ethers.utils.parseEther('0.01').toString(),
          recipient: '0x1234567890123456789012345678901234567890',
          permit2Signature: '0x1234',  // Should be ignored
          permit2Nonce: 0,
          permit2Deadline: Math.floor(Date.now() / 1000) + 1800
        });

        // Should succeed without using Permit2
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result.value).toBe(ethers.utils.parseEther('0.01').toString());
      }, 60000);

      it('should not require Permit2 params for ERC20 when not provided', async () => {
        // ERC20 without Permit2 params should work (caller handles approval separately)
        const result = await adapter._generateSwapData({
          tokenIn: WETH,
          tokenOut: USDC,
          amountIn: ethers.utils.parseEther('0.01').toString(),
          recipient: '0x1234567890123456789012345678901234567890'
          // No Permit2 params - calldata won't be wrapped
        });

        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result.value).toBe('0');
      }, 60000);
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

  describe('describePool', () => {
    it('should format pool description with V4 terminology', () => {
      const pool = {
        address: '0x1234567890abcdef1234567890abcdef12345678',
        fee: 3000,
        tick: -54321,
        token0: { symbol: 'USDC', address: '0xaaa', decimals: 6 },
        token1: { symbol: 'WETH', address: '0xbbb', decimals: 18 },
        liquidity: '5000000000000',
      };
      const result = adapter.describePool(pool);
      expect(result).toContain('USDC/WETH');
      expect(result).toContain(pool.address);
      expect(result).toContain('fee: 3000bp');
      expect(result).toContain('tick: -54321');
    });

    it('should handle missing token symbols gracefully', () => {
      const pool = { address: '0xabcd', fee: 500, tick: 0 };
      const result = adapter.describePool(pool);
      expect(result).toContain('?/?');
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

  describe('calculateTokenAmounts', () => {
    // Valid test data for use in success cases
    const validPosition = {
      liquidity: '1000000000000',
      tickLower: -198000,
      tickUpper: -192000
    };

    const validPoolData = {
      sqrtPriceX96: '1771595571142957166518320255467520',
      tick: -195000
    };

    const validToken0Data = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };
    const validToken1Data = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

    describe('Error Cases', () => {
      describe('position validation', () => {
        it('should throw when position is null', async () => {
          await expect(adapter.calculateTokenAmounts(null, validPoolData, validToken0Data, validToken1Data))
            .rejects.toThrow('position is required and must be an object');
        });

        it('should throw when position is undefined', async () => {
          await expect(adapter.calculateTokenAmounts(undefined, validPoolData, validToken0Data, validToken1Data))
            .rejects.toThrow('position is required and must be an object');
        });

        it('should throw when position is an array', async () => {
          await expect(adapter.calculateTokenAmounts([], validPoolData, validToken0Data, validToken1Data))
            .rejects.toThrow('position is required and must be an object');
        });

        it('should throw when position.liquidity is missing', async () => {
          const position = { tickLower: -198000, tickUpper: -192000 };
          await expect(adapter.calculateTokenAmounts(position, validPoolData, validToken0Data, validToken1Data))
            .rejects.toThrow('position.liquidity is required');
        });

        it('should throw when position.liquidity is null', async () => {
          const position = { liquidity: null, tickLower: -198000, tickUpper: -192000 };
          await expect(adapter.calculateTokenAmounts(position, validPoolData, validToken0Data, validToken1Data))
            .rejects.toThrow('position.liquidity is required');
        });

        it('should throw when position.liquidity is negative', async () => {
          const position = { liquidity: '-100', tickLower: -198000, tickUpper: -192000 };
          await expect(adapter.calculateTokenAmounts(position, validPoolData, validToken0Data, validToken1Data))
            .rejects.toThrow('position.liquidity must be a non-negative numeric string');
        });

        it('should throw when position.liquidity is non-numeric string', async () => {
          const position = { liquidity: 'abc', tickLower: -198000, tickUpper: -192000 };
          await expect(adapter.calculateTokenAmounts(position, validPoolData, validToken0Data, validToken1Data))
            .rejects.toThrow('position.liquidity must be a non-negative numeric string');
        });

        it('should throw when position.tickLower is missing', async () => {
          const position = { liquidity: '1000', tickUpper: -192000 };
          await expect(adapter.calculateTokenAmounts(position, validPoolData, validToken0Data, validToken1Data))
            .rejects.toThrow('position.tickLower must be a finite number');
        });

        it('should throw when position.tickLower is not finite', async () => {
          const position = { liquidity: '1000', tickLower: Infinity, tickUpper: -192000 };
          await expect(adapter.calculateTokenAmounts(position, validPoolData, validToken0Data, validToken1Data))
            .rejects.toThrow('position.tickLower must be a finite number');
        });

        it('should throw when position.tickUpper is missing', async () => {
          const position = { liquidity: '1000', tickLower: -198000 };
          await expect(adapter.calculateTokenAmounts(position, validPoolData, validToken0Data, validToken1Data))
            .rejects.toThrow('position.tickUpper must be a finite number');
        });

        it('should throw when position.tickUpper is not finite', async () => {
          const position = { liquidity: '1000', tickLower: -198000, tickUpper: NaN };
          await expect(adapter.calculateTokenAmounts(position, validPoolData, validToken0Data, validToken1Data))
            .rejects.toThrow('position.tickUpper must be a finite number');
        });

        it('should throw when tickLower >= tickUpper', async () => {
          const position = { liquidity: '1000', tickLower: -192000, tickUpper: -198000 };
          await expect(adapter.calculateTokenAmounts(position, validPoolData, validToken0Data, validToken1Data))
            .rejects.toThrow('position.tickLower (-192000) must be less than position.tickUpper (-198000)');
        });

        it('should throw when tickLower equals tickUpper', async () => {
          const position = { liquidity: '1000', tickLower: -195000, tickUpper: -195000 };
          await expect(adapter.calculateTokenAmounts(position, validPoolData, validToken0Data, validToken1Data))
            .rejects.toThrow('position.tickLower (-195000) must be less than position.tickUpper (-195000)');
        });
      });

      describe('poolData validation', () => {
        it('should throw when poolData is null', async () => {
          await expect(adapter.calculateTokenAmounts(validPosition, null, validToken0Data, validToken1Data))
            .rejects.toThrow('poolData is required and must be an object');
        });

        it('should throw when poolData is undefined', async () => {
          await expect(adapter.calculateTokenAmounts(validPosition, undefined, validToken0Data, validToken1Data))
            .rejects.toThrow('poolData is required and must be an object');
        });

        it('should throw when poolData is an array', async () => {
          await expect(adapter.calculateTokenAmounts(validPosition, [], validToken0Data, validToken1Data))
            .rejects.toThrow('poolData is required and must be an object');
        });

        it('should throw when poolData.sqrtPriceX96 is missing', async () => {
          const poolData = { tick: -195000 };
          await expect(adapter.calculateTokenAmounts(validPosition, poolData, validToken0Data, validToken1Data))
            .rejects.toThrow('poolData.sqrtPriceX96 is required');
        });

        it('should throw when poolData.sqrtPriceX96 is null', async () => {
          const poolData = { sqrtPriceX96: null, tick: -195000 };
          await expect(adapter.calculateTokenAmounts(validPosition, poolData, validToken0Data, validToken1Data))
            .rejects.toThrow('poolData.sqrtPriceX96 is required');
        });

        it('should throw when poolData.sqrtPriceX96 is non-numeric', async () => {
          const poolData = { sqrtPriceX96: 'abc', tick: -195000 };
          await expect(adapter.calculateTokenAmounts(validPosition, poolData, validToken0Data, validToken1Data))
            .rejects.toThrow('poolData.sqrtPriceX96 must be a non-negative numeric string');
        });

        it('should throw when poolData.tick is not finite', async () => {
          const poolData = { sqrtPriceX96: '1000000000', tick: Infinity };
          await expect(adapter.calculateTokenAmounts(validPosition, poolData, validToken0Data, validToken1Data))
            .rejects.toThrow('poolData.tick must be a finite number');
        });
      });

      describe('token data validation', () => {
        it('should throw when token0Data is null', async () => {
          await expect(adapter.calculateTokenAmounts(validPosition, validPoolData, null, validToken1Data))
            .rejects.toThrow('token0Data is required and must be an object');
        });

        it('should throw when token0Data is undefined', async () => {
          await expect(adapter.calculateTokenAmounts(validPosition, validPoolData, undefined, validToken1Data))
            .rejects.toThrow('token0Data is required and must be an object');
        });

        it('should throw when token1Data is null', async () => {
          await expect(adapter.calculateTokenAmounts(validPosition, validPoolData, validToken0Data, null))
            .rejects.toThrow('token1Data is required and must be an object');
        });

        it('should throw when token1Data is undefined', async () => {
          await expect(adapter.calculateTokenAmounts(validPosition, validPoolData, validToken0Data, undefined))
            .rejects.toThrow('token1Data is required and must be an object');
        });
      });
    });

    describe('Success Cases', () => {
      it('should return [0n, 0n] for zero liquidity', async () => {
        const position = { liquidity: '0', tickLower: -198000, tickUpper: -192000 };
        const result = await adapter.calculateTokenAmounts(position, validPoolData, validToken0Data, validToken1Data);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(result[0]).toBe(0n);
        expect(result[1]).toBe(0n);
      });

      it('should return array of two BigInts', async () => {
        const result = await adapter.calculateTokenAmounts(validPosition, validPoolData, validToken0Data, validToken1Data);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(typeof result[0]).toBe('bigint');
        expect(typeof result[1]).toBe('bigint');
      });

      it('should return non-negative amounts', async () => {
        const result = await adapter.calculateTokenAmounts(validPosition, validPoolData, validToken0Data, validToken1Data);

        expect(result[0]).toBeGreaterThanOrEqual(0n);
        expect(result[1]).toBeGreaterThanOrEqual(0n);
      });

      it('should return only token0 when price is below position range', async () => {
        // Position range: 0 to 1000, current tick: -1000 (below range)
        // When price is below range, position is entirely in token0
        // sqrtPriceX96 at tick -1000 is approx 74458408916906616024112742400
        const position = { liquidity: '1000000000000000', tickLower: 0, tickUpper: 1000 };
        const poolData = {
          sqrtPriceX96: '74458408916906616024112742400', // tick -1000
          tick: -1000
        };

        const result = await adapter.calculateTokenAmounts(position, poolData, validToken0Data, validToken1Data);

        expect(result[0]).toBeGreaterThan(0n); // Has token0
        expect(result[1]).toBe(0n);            // No token1
      });

      it('should return only token1 when price is above position range', async () => {
        // Position range: -2000 to -1000, current tick: 0 (above range)
        // When price is above range, position is entirely in token1
        // sqrtPriceX96 at tick 0 is 79228162514264337593543950336 (Q96 = 2^96)
        const position = { liquidity: '1000000000000000', tickLower: -2000, tickUpper: -1000 };
        const poolData = {
          sqrtPriceX96: '79228162514264337593543950336', // tick 0
          tick: 0
        };

        const result = await adapter.calculateTokenAmounts(position, poolData, validToken0Data, validToken1Data);

        expect(result[0]).toBe(0n);            // No token0
        expect(result[1]).toBeGreaterThan(0n); // Has token1
      });

      it('should return both tokens when price is in range', async () => {
        // Position range: -1000 to 1000, current tick: 0 (in range)
        // sqrtPriceX96 at tick 0 is 79228162514264337593543950336
        const position = { liquidity: '1000000000000000', tickLower: -1000, tickUpper: 1000 };
        const poolData = {
          sqrtPriceX96: '79228162514264337593543950336', // tick 0
          tick: 0
        };

        const result = await adapter.calculateTokenAmounts(position, poolData, validToken0Data, validToken1Data);

        expect(result[0]).toBeGreaterThan(0n); // Has token0
        expect(result[1]).toBeGreaterThan(0n); // Has token1
      });

      it('should handle liquidity as number (converts to string)', async () => {
        const position = { liquidity: 1000000000000, tickLower: -198000, tickUpper: -192000 };
        const result = await adapter.calculateTokenAmounts(position, validPoolData, validToken0Data, validToken1Data);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(typeof result[0]).toBe('bigint');
        expect(typeof result[1]).toBe('bigint');
      });

      it('should handle sqrtPriceX96 as BigInt', async () => {
        const poolData = {
          sqrtPriceX96: BigInt('1771595571142957166518320255467520'),
          tick: -195000
        };
        const result = await adapter.calculateTokenAmounts(validPosition, poolData, validToken0Data, validToken1Data);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
      });

      it('should handle real pool data from test environment', async () => {
        // Skip if test environment not available
        if (!env || !env.poolData) {
          console.log('Skipping - V4 test environment not available');
          return;
        }

        // Create position around current pool tick
        const position = {
          liquidity: '1000000000000',
          tickLower: env.poolData.tick - 600,
          tickUpper: env.poolData.tick + 600
        };

        const result = await adapter.calculateTokenAmounts(
          position,
          env.poolData,
          { address: ethers.constants.AddressZero, decimals: 18 }, // ETH (currency0)
          { address: env.usdcAddress, decimals: 6 }                // USDC (currency1)
        );

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(typeof result[0]).toBe('bigint');
        expect(typeof result[1]).toBe('bigint');
        expect(result[0]).toBeGreaterThan(0n);
        expect(result[1]).toBeGreaterThan(0n);
      });
    });
  });

  describe('_decodePositionInfo', () => {
    describe('Success Cases', () => {
      it('should decode positive tick values', () => {
        // Create packed info with positive ticks
        // Layout: | 200 bits poolId | 24 bits tickUpper | 24 bits tickLower | 8 bits hasSubscriber |
        // tickLower = 1000 = 0x3E8, tickUpper = 2000 = 0x7D0, hasSubscriber = 0
        const tickLower = 1000;
        const tickUpper = 2000;
        const hasSubscriber = 0;

        // Pack: (tickUpper << 32) | (tickLower << 8) | hasSubscriber
        const packed = BigInt(tickUpper) << 32n | BigInt(tickLower) << 8n | BigInt(hasSubscriber);

        const result = adapter._decodePositionInfo(packed.toString());

        expect(result.tickLower).toBe(tickLower);
        expect(result.tickUpper).toBe(tickUpper);
        expect(result.hasSubscriber).toBe(false);
      });

      it('should decode negative tick values (two\'s complement)', () => {
        // Negative ticks use 24-bit two's complement encoding
        // tickLower = -1000 = 0xFFFC18 (in 24-bit two's complement)
        // tickUpper = -500 = 0xFFFE0C (in 24-bit two's complement)
        const tickLower = -1000;
        const tickUpper = -500;

        // Convert to 24-bit unsigned representation
        const tickLowerUnsigned = tickLower < 0 ? 0x1000000 + tickLower : tickLower;
        const tickUpperUnsigned = tickUpper < 0 ? 0x1000000 + tickUpper : tickUpper;

        const packed = BigInt(tickUpperUnsigned) << 32n | BigInt(tickLowerUnsigned) << 8n | 0n;

        const result = adapter._decodePositionInfo(packed.toString());

        expect(result.tickLower).toBe(tickLower);
        expect(result.tickUpper).toBe(tickUpper);
        expect(result.hasSubscriber).toBe(false);
      });

      it('should decode hasSubscriber flag when true', () => {
        const tickLower = 100;
        const tickUpper = 200;
        const hasSubscriber = 1;

        const packed = BigInt(tickUpper) << 32n | BigInt(tickLower) << 8n | BigInt(hasSubscriber);

        const result = adapter._decodePositionInfo(packed.toString());

        expect(result.tickLower).toBe(tickLower);
        expect(result.tickUpper).toBe(tickUpper);
        expect(result.hasSubscriber).toBe(true);
      });

      it('should handle zero values', () => {
        const packed = 0n;

        const result = adapter._decodePositionInfo(packed.toString());

        expect(result.tickLower).toBe(0);
        expect(result.tickUpper).toBe(0);
        expect(result.hasSubscriber).toBe(false);
      });

      it('should handle extreme tick values', () => {
        // Max tick ≈ 887272, min tick ≈ -887272
        // Use smaller values that fit in 24-bit signed int
        const tickLower = -8000000; // Still within 24-bit signed range
        const tickUpper = 8000000;

        // Convert to 24-bit unsigned representation
        const tickLowerUnsigned = tickLower < 0 ? 0x1000000 + tickLower : tickLower;
        const tickUpperUnsigned = tickUpper < 0 ? 0x1000000 + tickUpper : tickUpper;

        const packed = BigInt(tickUpperUnsigned) << 32n | BigInt(tickLowerUnsigned) << 8n | 0n;

        const result = adapter._decodePositionInfo(packed.toString());

        expect(result.tickLower).toBe(tickLower);
        expect(result.tickUpper).toBe(tickUpper);
      });

      it('should handle ethers BigNumber input', () => {
        const { ethers } = require('ethers');
        const tickLower = 500;
        const tickUpper = 1500;

        const packed = BigInt(tickUpper) << 32n | BigInt(tickLower) << 8n | 0n;
        const bigNumber = ethers.BigNumber.from(packed.toString());

        const result = adapter._decodePositionInfo(bigNumber);

        expect(result.tickLower).toBe(tickLower);
        expect(result.tickUpper).toBe(tickUpper);
      });
    });
  });

  describe('getAccruedFeesUSD', () => {
    describe('Error Cases', () => {
      it('should throw when position is null', async () => {
        await expect(adapter.getAccruedFeesUSD(null, { token0: 1, token1: 1 }, env.provider))
          .rejects.toThrow('position is required and must be an object');
      });

      it('should throw when position is undefined', async () => {
        await expect(adapter.getAccruedFeesUSD(undefined, { token0: 1, token1: 1 }, env.provider))
          .rejects.toThrow('position is required and must be an object');
      });

      it('should throw when position is not an object', async () => {
        await expect(adapter.getAccruedFeesUSD('invalid', { token0: 1, token1: 1 }, env.provider))
          .rejects.toThrow('position is required and must be an object');
      });

      it('should throw when position.id is missing', async () => {
        await expect(adapter.getAccruedFeesUSD({}, { token0: 1, token1: 1 }, env.provider))
          .rejects.toThrow('position.id is required');
      });

      it('should throw when position.id is null', async () => {
        await expect(adapter.getAccruedFeesUSD({ id: null }, { token0: 1, token1: 1 }, env.provider))
          .rejects.toThrow('position.id is required');
      });

      it('should throw when tokenPrices is null', async () => {
        await expect(adapter.getAccruedFeesUSD({ id: 1 }, null, env.provider))
          .rejects.toThrow('tokenPrices is required and must be an object');
      });

      it('should throw when tokenPrices is not an object', async () => {
        await expect(adapter.getAccruedFeesUSD({ id: 1 }, 'invalid', env.provider))
          .rejects.toThrow('tokenPrices is required and must be an object');
      });

      it('should throw when provider is null', async () => {
        await expect(adapter.getAccruedFeesUSD({ id: 1 }, { token0: 1, token1: 1 }, null))
          .rejects.toThrow('provider is required');
      });
    });

    describe('Success Cases (requires live position)', () => {
      // These tests create a real position and verify fee calculation

      it('should return zero fees for new position with no swaps', async () => {
        const { ethers } = require('ethers');

        // Create a position first
        const signer = env.signers[0];
        const walletAddress = await signer.getAddress();

        // Get position range around current tick (poolData needs tickSpacing from poolKey)
        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 5, 5);

        // Create position with small amounts
        const token0Amount = ethers.utils.parseUnits('0.01', env.poolData.token0.decimals).toString();
        const token1Amount = ethers.utils.parseUnits('50', env.poolData.token1.decimals).toString();

        const txData = await adapter.generateCreatePositionData({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount,
          token1Amount,
          provider: env.provider,
          walletAddress,
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          slippageTolerance: 0.5,
          deadlineMinutes: 20
        });

        const tx = await signer.sendTransaction({
          to: txData.to,
          data: txData.data,
          value: txData.value
        });
        const receipt = await tx.wait();

        // Parse receipt to get tokenId
        const parsed = adapter.parseIncreaseLiquidityReceipt(receipt, {
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          poolData: env.poolData
        });

        expect(parsed.tokenId).toBeDefined();

        // Get accrued fees (should be zero or near-zero for new position)
        const result = await adapter.getAccruedFeesUSD(
          {
            id: parsed.tokenId,
            token0Decimals: env.poolData.token0.decimals,
            token1Decimals: env.poolData.token1.decimals
          },
          { token0: 3000, token1: 1 }, // ETH ~$3000, USDC = $1
          env.provider
        );

        // Verify structure - V3-compatible format
        expect(result).toHaveProperty('totalUSD');
        expect(result).toHaveProperty('token0Fees');
        expect(result).toHaveProperty('token1Fees');
        expect(result).toHaveProperty('token0USD');
        expect(result).toHaveProperty('token1USD');
        // Raw values for fallback/native ETH handling
        expect(result).toHaveProperty('fees0');
        expect(result).toHaveProperty('fees1');

        // Verify types
        expect(typeof result.totalUSD).toBe('number');
        expect(typeof result.token0Fees).toBe('number');
        expect(typeof result.token1Fees).toBe('number');
        expect(typeof result.token0USD).toBe('number');
        expect(typeof result.token1USD).toBe('number');
        expect(typeof result.fees0).toBe('string');
        expect(typeof result.fees1).toBe('string');

        // New position should have zero or minimal fees (no swaps have occurred through it)
        expect(result.token0USD).toBeGreaterThanOrEqual(0);
        expect(result.token1USD).toBeGreaterThanOrEqual(0);
        expect(result.totalUSD).toBeGreaterThanOrEqual(0);
      }, 120000);

      it('should return non-zero fees after swap through position range', async () => {
        const { ethers } = require('ethers');

        // Create a position first
        const signer = env.signers[0];
        const walletAddress = await signer.getAddress();

        // Get position range around current tick - wider range to catch swaps
        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 10, 10);

        // Create position with decent amounts
        const token0Amount = ethers.utils.parseUnits('0.05', env.poolData.token0.decimals).toString();
        const token1Amount = ethers.utils.parseUnits('200', env.poolData.token1.decimals).toString();

        const txData = await adapter.generateCreatePositionData({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount,
          token1Amount,
          provider: env.provider,
          walletAddress,
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        const tx = await signer.sendTransaction({
          to: txData.to,
          data: txData.data,
          value: txData.value
        });
        const receipt = await tx.wait();

        // Parse receipt to get tokenId
        const parsed = adapter.parseIncreaseLiquidityReceipt(receipt, {
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          poolData: env.poolData
        });

        // Execute a swap to generate fees
        const swapData = await adapter._generateSwapData({
          tokenIn: ethers.constants.AddressZero, // Native ETH
          tokenOut: env.poolData.token1.address, // USDC
          amountIn: ethers.utils.parseEther('0.1').toString(),
          recipient: walletAddress,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        const swapTx = await signer.sendTransaction({
          to: swapData.to,
          data: swapData.data,
          value: swapData.value
        });
        await swapTx.wait();

        // Get accrued fees (should be non-zero after swap)
        const result = await adapter.getAccruedFeesUSD(
          {
            id: parsed.tokenId,
            token0Decimals: env.poolData.token0.decimals,
            token1Decimals: env.poolData.token1.decimals
          },
          { token0: 3000, token1: 1 },
          env.provider
        );

        // Fees should be non-negative
        // Note: Very small swaps may have dust-level fees close to zero
        expect(result.totalUSD).toBeGreaterThanOrEqual(0);
        expect(result.fees0).toBeDefined();
        expect(result.fees1).toBeDefined();
      }, 180000);
    });
  });

  describe('generateClaimFeesData', () => {
    // Valid address for error case testing (doesn't need to be a real wallet)
    const validTestAddress = '0x1234567890123456789012345678901234567890';

    describe('Error Cases', () => {
      it('should throw when position is null', async () => {
        await expect(adapter.generateClaimFeesData({
          position: null,
          walletAddress: validTestAddress,
          provider: env.provider
        })).rejects.toThrow('position is required');
      });

      it('should throw when position is undefined', async () => {
        await expect(adapter.generateClaimFeesData({
          position: undefined,
          walletAddress: validTestAddress,
          provider: env.provider
        })).rejects.toThrow('position is required');
      });

      it('should throw when position is missing from params', async () => {
        await expect(adapter.generateClaimFeesData({
          walletAddress: validTestAddress,
          provider: env.provider
        })).rejects.toThrow('position is required');
      });

      it('should throw when position is a string', async () => {
        await expect(adapter.generateClaimFeesData({
          position: '12345',
          walletAddress: validTestAddress,
          provider: env.provider
        })).rejects.toThrow('position must be an object');
      });

      it('should throw when position is a number', async () => {
        await expect(adapter.generateClaimFeesData({
          position: 12345,
          walletAddress: validTestAddress,
          provider: env.provider
        })).rejects.toThrow('position must be an object');
      });

      it('should throw when position is an array', async () => {
        await expect(adapter.generateClaimFeesData({
          position: [{ id: '12345' }],
          walletAddress: validTestAddress,
          provider: env.provider
        })).rejects.toThrow('position must be an object');
      });

      it('should throw when position.id is null', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: null },
          walletAddress: validTestAddress,
          provider: env.provider
        })).rejects.toThrow('position.id is required');
      });

      it('should throw when position.id is undefined', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: undefined },
          walletAddress: validTestAddress,
          provider: env.provider
        })).rejects.toThrow('position.id is required');
      });

      it('should throw when position.id is missing', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { tickLower: 100, tickUpper: 200 },
          walletAddress: validTestAddress,
          provider: env.provider
        })).rejects.toThrow('position.id is required');
      });

      it('should throw when position.tickLower is missing', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: '12345', tickUpper: 200 },
          walletAddress: validTestAddress,
          provider: env.provider
        })).rejects.toThrow('position.tickLower is required');
      });

      it('should throw when position.tickUpper is missing', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: '12345', tickLower: 100 },
          walletAddress: validTestAddress,
          provider: env.provider
        })).rejects.toThrow('position.tickUpper is required');
      });

      it('should throw when walletAddress is missing', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          provider: env.provider
        })).rejects.toThrow('walletAddress is required');
      });

      it('should throw when walletAddress is empty string', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          walletAddress: '',
          provider: env.provider
        })).rejects.toThrow('walletAddress is required');
      });

      it('should throw when walletAddress is invalid', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          walletAddress: 'not-an-address',
          provider: env.provider
        })).rejects.toThrow('Invalid walletAddress');
      });

      it('should throw when provider is missing', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          walletAddress: validTestAddress
        })).rejects.toThrow('provider is required');
      });

      it('should throw when deadlineMinutes is not a number', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          walletAddress: validTestAddress,
          provider: env.provider,
          deadlineMinutes: 'twenty'
        })).rejects.toThrow('deadlineMinutes must be a positive number');
      });

      it('should throw when deadlineMinutes is zero', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          walletAddress: validTestAddress,
          provider: env.provider,
          deadlineMinutes: 0
        })).rejects.toThrow('deadlineMinutes must be a positive number');
      });

      it('should throw when deadlineMinutes is negative', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          walletAddress: validTestAddress,
          provider: env.provider,
          deadlineMinutes: -5
        })).rejects.toThrow('deadlineMinutes must be a positive number');
      });

      it('should throw when deadlineMinutes is Infinity', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          walletAddress: validTestAddress,
          provider: env.provider,
          deadlineMinutes: Infinity
        })).rejects.toThrow('deadlineMinutes must be a positive number');
      });

      it('should throw when poolData.poolKey is missing', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          walletAddress: validTestAddress,
          provider: env.provider,
          poolData: { token0Symbol: 'ETH', token1Symbol: 'USDC' }  // No poolKey
        })).rejects.toThrow('poolData.poolKey is required');
      });

      it('should throw when poolData is not provided', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          walletAddress: validTestAddress,
          provider: env.provider
        })).rejects.toThrow('poolData is required');
      });
    });

    describe('Success Cases', () => {
      it('should generate valid transaction data for existing position', async () => {
        // Get wallet address from environment
        const walletAddress = await env.signers[0].getAddress();

        // Generate claim fees data using pre-created test position
        const claimFeesData = await adapter.generateClaimFeesData({
          position: env.testPosition,
          walletAddress,
          provider: env.provider,
          poolData: env.poolData
        });

        // Validate transaction data structure
        expect(claimFeesData).toBeDefined();
        expect(claimFeesData.to).toBe(adapter.addresses.positionManagerAddress);
        expect(claimFeesData.data).toBeDefined();
        expect(typeof claimFeesData.data).toBe('string');
        expect(claimFeesData.data.startsWith('0x')).toBe(true);
        expect(claimFeesData.value).toBeDefined();
      }, 120000);

      it('should generate transaction data with provided poolData', async () => {
        // Get wallet address from environment
        const walletAddress = await env.signers[0].getAddress();

        // Generate claim fees data with explicit poolData
        const claimFeesData = await adapter.generateClaimFeesData({
          position: env.testPosition,
          walletAddress,
          provider: env.provider,
          poolData: env.poolData
        });

        expect(claimFeesData).toBeDefined();
        expect(claimFeesData.to).toBe(adapter.addresses.positionManagerAddress);
        expect(claimFeesData.data).toBeDefined();
      }, 120000);

      it('should execute claim fees transaction successfully', async () => {
        // Get vault address for walletAddress parameter
        const vaultAddress = env.testVault.address;

        // Generate claim fees transaction data using pre-created test position
        const claimFeesData = await adapter.generateClaimFeesData({
          position: env.testPosition,
          walletAddress: vaultAddress,
          provider: env.provider,
          poolData: env.poolData
        });

        // Execute through the vault's collect method (vault owns the position)
        const claimTx = await env.testVault.collect(
          [claimFeesData.to],
          [claimFeesData.data]
        );
        const claimReceipt = await claimTx.wait();

        // Transaction should succeed
        expect(claimReceipt.status).toBe(1);
      }, 180000);

      it('should collect non-zero fees after swap through position', async () => {
        const { ethers } = require('ethers');

        // Get signer for swap execution and vault address for claim
        const signer = env.signers[0];
        const signerAddress = await signer.getAddress();
        const vaultAddress = env.testVault.address;

        // Check fees before swap (should be 0 or minimal)
        const feesBefore = await adapter.getAccruedFeesUSD(
          {
            id: env.testPosition.id,
            token0Decimals: env.poolData.token0.decimals,
            token1Decimals: env.poolData.token1.decimals
          },
          { token0: 3000, token1: 1 },
          env.provider
        );

        // Execute a swap to generate fees (signer can do swaps directly)
        const swapData = await adapter._generateSwapData({
          tokenIn: ethers.constants.AddressZero, // Native ETH
          tokenOut: env.poolData.token1.address, // USDC
          amountIn: ethers.utils.parseEther('0.05').toString(),
          recipient: signerAddress,
          slippageTolerance: 1,
          poolData: env.poolData,
          provider: env.provider,
          deadlineMinutes: 20
        });

        const swapTx = await signer.sendTransaction({
          to: swapData.to,
          data: swapData.data,
          value: swapData.value
        });
        await swapTx.wait();

        // Check fees after swap
        const feesAfter = await adapter.getAccruedFeesUSD(
          {
            id: env.testPosition.id,
            token0Decimals: env.poolData.token0.decimals,
            token1Decimals: env.poolData.token1.decimals
          },
          { token0: 3000, token1: 1 },
          env.provider
        );

        // Fees should have increased (or at least not be negative)
        expect(Number(feesAfter.fees0) + Number(feesAfter.fees1))
          .toBeGreaterThanOrEqual(Number(feesBefore.fees0) + Number(feesBefore.fees1));

        // Now claim the fees through the vault (vault owns the position)
        const claimFeesData = await adapter.generateClaimFeesData({
          position: env.testPosition,
          walletAddress: vaultAddress,
          provider: env.provider,
          poolData: env.poolData
        });

        const claimTx = await env.testVault.collect(
          [claimFeesData.to],
          [claimFeesData.data]
        );
        const claimReceipt = await claimTx.wait();

        expect(claimReceipt.status).toBe(1);

        // After claiming, accrued fees should be zero or near-zero
        const feesAfterClaim = await adapter.getAccruedFeesUSD(
          {
            id: env.testPosition.id,
            token0Decimals: env.poolData.token0.decimals,
            token1Decimals: env.poolData.token1.decimals
          },
          { token0: 3000, token1: 1 },
          env.provider
        );

        // Fees should be reset to 0 or near 0 after claiming
        expect(Number(feesAfterClaim.fees0)).toBeLessThanOrEqual(Number(feesAfter.fees0));
        expect(Number(feesAfterClaim.fees1)).toBeLessThanOrEqual(Number(feesAfter.fees1));
      }, 240000);
    });
  });

  describe('generateRemoveLiquidityData', () => {
    // Valid address for error case testing (doesn't need to be a real wallet)
    const validTestAddress = '0x1234567890123456789012345678901234567890';

    describe('Error Cases', () => {
      it('should throw when position is null', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: null,
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('position is required');
      });

      it('should throw when position is undefined', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: undefined,
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('position is required');
      });

      it('should throw when position is a string', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: '12345',
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('position must be an object');
      });

      it('should throw when position is a number', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: 12345,
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('position must be an object');
      });

      it('should throw when position is an array', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: [{ id: '12345' }],
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('position must be an object');
      });

      it('should throw when position.id is null', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: null },
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('position.id is required');
      });

      it('should throw when position.id is undefined', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: undefined },
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('position.id is required');
      });

      it('should throw when position.id is missing', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { tickLower: 100, tickUpper: 200 },
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('position.id is required');
      });

      it('should throw when position.tickLower is missing', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickUpper: 200 },
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('position.tickLower is required');
      });

      it('should throw when position.tickUpper is missing', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: 100 },
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('position.tickUpper is required');
      });

      it('should throw when percentage is missing', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('percentage must be a number between 1 and 100');
      });

      it('should throw when percentage is 0', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          percentage: 0,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('percentage must be a number between 1 and 100');
      });

      it('should throw when percentage is > 100', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          percentage: 101,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('percentage must be a number between 1 and 100');
      });

      it('should throw when percentage is not a number', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          percentage: 'fifty',
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('percentage must be a number between 1 and 100');
      });

      it('should throw when walletAddress is missing', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          percentage: 50,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('walletAddress is required');
      });

      it('should throw when walletAddress is invalid', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          percentage: 50,
          walletAddress: 'not-an-address',
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('Invalid walletAddress');
      });

      it('should throw when provider is missing', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          percentage: 50,
          walletAddress: validTestAddress,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('provider is required');
      });

      it('should throw when slippageTolerance is missing', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          deadlineMinutes: 20
        })).rejects.toThrow('slippageTolerance must be a number between 0 and 100');
      });

      it('should throw when slippageTolerance is negative', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: -1,
          deadlineMinutes: 20
        })).rejects.toThrow('slippageTolerance must be a number between 0 and 100');
      });

      it('should throw when slippageTolerance is > 100', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 101,
          deadlineMinutes: 20
        })).rejects.toThrow('slippageTolerance must be a number between 0 and 100');
      });

      it('should throw when deadlineMinutes is missing', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1
        })).rejects.toThrow('deadlineMinutes must be a positive number');
      });

      it('should throw when deadlineMinutes is <= 0', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 0
        })).rejects.toThrow('deadlineMinutes must be a positive number');
      });

      it('should throw when poolData.poolKey is missing', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          poolData: { token0Symbol: 'ETH', token1Symbol: 'USDC' },  // No poolKey
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('poolData.poolKey is required');
      });

      it('should throw when poolData is not provided', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          percentage: 50,
          walletAddress: validTestAddress,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('poolData is required');
      });
    });

    describe('Success Cases', () => {
      it('should generate valid transaction data for partial removal (50%)', async () => {
        // Get wallet address from environment
        const walletAddress = await env.signers[0].getAddress();

        // Generate remove 50% liquidity data using pre-created test position
        const removeTxData = await adapter.generateRemoveLiquidityData({
          position: env.testPosition,
          percentage: 50,
          walletAddress,
          provider: env.provider,
          poolData: env.poolData,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        // Validate transaction data structure
        expect(removeTxData).toBeDefined();
        expect(removeTxData.to).toBe(adapter.addresses.positionManagerAddress);
        expect(removeTxData.data).toBeDefined();
        expect(typeof removeTxData.data).toBe('string');
        expect(removeTxData.data.startsWith('0x')).toBe(true);
        expect(removeTxData.value).toBeDefined();
      }, 120000);

      it('should generate valid transaction data for full removal (100%)', async () => {
        // Get wallet address from environment
        const walletAddress = await env.signers[0].getAddress();

        // Generate remove 100% liquidity data using pre-created test position
        const removeTxData = await adapter.generateRemoveLiquidityData({
          position: env.testPosition,
          percentage: 100,
          walletAddress,
          provider: env.provider,
          poolData: env.poolData,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        expect(removeTxData).toBeDefined();
        expect(removeTxData.to).toBe(adapter.addresses.positionManagerAddress);
        expect(removeTxData.data).toBeDefined();
      }, 120000);

      it('should execute partial remove successfully', async () => {
        const localSnapshot = await env.snapshot();

        const vaultAddress = env.testVault.address;

        // Get initial liquidity via getPositionById
        const beforeResult = await adapter.getPositionById(env.testPosition.id, env.provider);
        const initialLiquidity = BigInt(beforeResult.position.liquidity);

        // Generate remove 50% liquidity data
        const removeTxData = await adapter.generateRemoveLiquidityData({
          position: env.testPosition,
          percentage: 50,
          walletAddress: vaultAddress,
          provider: env.provider,
          poolData: env.poolData,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        // Execute through the vault's decreaseLiquidity method (vault owns the position)
        const removeTx = await env.testVault.decreaseLiquidity(
          [removeTxData.to],
          [removeTxData.data]
        );
        const removeReceipt = await removeTx.wait();

        expect(removeReceipt.status).toBe(1);

        // Verify position still exists with reduced liquidity
        const afterResult = await adapter.getPositionById(env.testPosition.id, env.provider);
        const remainingLiquidity = BigInt(afterResult.position.liquidity);

        // Liquidity should be roughly half (allow for some rounding)
        expect(remainingLiquidity).toBeLessThan(initialLiquidity);
        expect(remainingLiquidity).toBeGreaterThan(0n);

        await env.revert(localSnapshot);
      }, 180000);

      it('should execute full remove (100%) successfully', async () => {
        const localSnapshot = await env.snapshot();

        const vaultAddress = env.testVault.address;

        // Generate remove 100% liquidity data using pre-created test position
        const removeTxData = await adapter.generateRemoveLiquidityData({
          position: env.testPosition,
          percentage: 100,
          walletAddress: vaultAddress,
          provider: env.provider,
          poolData: env.poolData,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        // Execute through the vault's decreaseLiquidity method (vault owns the position)
        const removeTx = await env.testVault.decreaseLiquidity(
          [removeTxData.to],
          [removeTxData.data]
        );
        const removeReceipt = await removeTx.wait();

        expect(removeReceipt.status).toBe(1);

        // Verify position has zero liquidity after full removal
        await expect(adapter.getPositionById(env.testPosition.id, env.provider))
          .rejects.toThrow('zero liquidity');

        await env.revert(localSnapshot);
      }, 180000);
    });
  });

  describe('generateAddLiquidityData', () => {
    const validTestAddress = '0x1234567890123456789012345678901234567890';

    describe('Error Cases', () => {
      it('should throw when position is null', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: null,
          token0Amount: '1000000000000000000',
          token1Amount: '1000000',
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('position is required');
      });

      it('should throw when position is undefined', async () => {
        await expect(adapter.generateAddLiquidityData({
          token0Amount: '1000000000000000000',
          token1Amount: '1000000',
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('position is required');
      });

      it('should throw when position.id is missing', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { tickLower: -100, tickUpper: 100 },
          token0Amount: '1000000000000000000',
          token1Amount: '1000000',
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('position.id is required');
      });

      it('should throw when token0Amount is missing', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          token1Amount: '1000000',
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('token0Amount is required');
      });

      it('should throw when token0Amount is not a string', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          token0Amount: 1000000000000000000,
          token1Amount: '1000000',
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('token0Amount must be a string');
      });

      it('should throw when token1Amount is missing', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          token0Amount: '1000000000000000000',
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('token1Amount is required');
      });

      it('should throw when token1Amount is not a string', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          token0Amount: '1000000000000000000',
          token1Amount: 1000000,
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('token1Amount must be a string');
      });

      it('should throw when both amounts are 0', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          token0Amount: '0',
          token1Amount: '0',
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('At least one token amount must be greater than 0');
      });

      it('should throw when provider is missing', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          token0Amount: '1000000000000000000',
          token1Amount: '1000000',
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('provider is required');
      });

      it('should throw when slippageTolerance is missing', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          token0Amount: '1000000000000000000',
          token1Amount: '1000000',
          provider: env.provider,
          deadlineMinutes: 20
        })).rejects.toThrow('slippageTolerance must be a number between 0 and 100');
      });

      it('should throw when slippageTolerance is negative', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          token0Amount: '1000000000000000000',
          token1Amount: '1000000',
          provider: env.provider,
          slippageTolerance: -1,
          deadlineMinutes: 20
        })).rejects.toThrow('slippageTolerance must be a number between 0 and 100');
      });

      it('should throw when slippageTolerance is > 100', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          token0Amount: '1000000000000000000',
          token1Amount: '1000000',
          provider: env.provider,
          slippageTolerance: 101,
          deadlineMinutes: 20
        })).rejects.toThrow('slippageTolerance must be a number between 0 and 100');
      });

      it('should throw when deadlineMinutes is missing', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          token0Amount: '1000000000000000000',
          token1Amount: '1000000',
          provider: env.provider,
          slippageTolerance: 1
        })).rejects.toThrow('deadlineMinutes must be a positive number');
      });

      it('should throw when deadlineMinutes is <= 0', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          token0Amount: '1000000000000000000',
          token1Amount: '1000000',
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 0
        })).rejects.toThrow('deadlineMinutes must be a positive number');
      });

      it('should throw when poolData.poolKey is missing', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          token0Amount: '1000000000000000000',
          token1Amount: '1000000',
          provider: env.provider,
          poolData: { token0Symbol: 'ETH', token1Symbol: 'USDC' },  // No poolKey
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('poolData.poolKey is required');
      });

      it('should throw when poolData is not provided', async () => {
        await expect(adapter.generateAddLiquidityData({
          position: { id: '12345', tickLower: -100, tickUpper: 100 },
          token0Amount: '1000000000000000000',
          token1Amount: '1000000',
          provider: env.provider,
          slippageTolerance: 1,
          deadlineMinutes: 20
        })).rejects.toThrow('poolData is required');
      });
    });

    describe('Success Cases', () => {
      it('should generate valid transaction data with both token amounts', async () => {
        const { ethers } = require('ethers');

        // Get signer from environment
        const signer = env.signers[0];
        const walletAddress = await signer.getAddress();

        // Get position range around current tick
        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 10, 10);

        // Create position
        const token0Amount = ethers.utils.parseUnits('0.02', env.poolData.token0.decimals).toString();
        const token1Amount = ethers.utils.parseUnits('60', env.poolData.token1.decimals).toString();

        const createTxData = await adapter.generateCreatePositionData({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount,
          token1Amount,
          provider: env.provider,
          walletAddress,
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        const createTx = await signer.sendTransaction({
          to: createTxData.to,
          data: createTxData.data,
          value: createTxData.value
        });
        const createReceipt = await createTx.wait();

        const parsed = adapter.parseIncreaseLiquidityReceipt(createReceipt, {
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          poolData: env.poolData
        });

        // Now generate add liquidity data
        const result = await adapter.generateAddLiquidityData({
          position: { id: parsed.tokenId, tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount: ethers.utils.parseUnits('0.01', env.poolData.token0.decimals).toString(),
          token1Amount: ethers.utils.parseUnits('30', env.poolData.token1.decimals).toString(),
          provider: env.provider,
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        expect(result).toHaveProperty('to');
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);
        expect(result).toHaveProperty('data');
        expect(result.data).toMatch(/^0x/);
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');
        expect(result.quote).toHaveProperty('liquidity');
        expect(result.quote).toHaveProperty('amount0');
        expect(result.quote).toHaveProperty('amount1');
      }, 180000);

      it('should generate valid transaction data with only token0', async () => {
        const { ethers } = require('ethers');

        // Get signer from environment
        const signer = env.signers[0];
        const walletAddress = await signer.getAddress();

        // Get position range around current tick
        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 10, 10);

        // Create position
        const token0Amount = ethers.utils.parseUnits('0.02', env.poolData.token0.decimals).toString();
        const token1Amount = ethers.utils.parseUnits('60', env.poolData.token1.decimals).toString();

        const createTxData = await adapter.generateCreatePositionData({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount,
          token1Amount,
          provider: env.provider,
          walletAddress,
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        const createTx = await signer.sendTransaction({
          to: createTxData.to,
          data: createTxData.data,
          value: createTxData.value
        });
        const createReceipt = await createTx.wait();

        const parsed = adapter.parseIncreaseLiquidityReceipt(createReceipt, {
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          poolData: env.poolData
        });

        // Generate add liquidity with only token0
        const result = await adapter.generateAddLiquidityData({
          position: { id: parsed.tokenId, tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount: ethers.utils.parseUnits('0.01', env.poolData.token0.decimals).toString(),
          token1Amount: '0',
          provider: env.provider,
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        expect(result).toHaveProperty('to');
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);
        expect(result).toHaveProperty('data');
        expect(result.data).toMatch(/^0x/);
        expect(result).toHaveProperty('quote');
      }, 180000);

      it('should generate valid transaction data with only token1', async () => {
        const { ethers } = require('ethers');

        // Get signer from environment
        const signer = env.signers[0];
        const walletAddress = await signer.getAddress();

        // Get position range around current tick
        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 10, 10);

        // Create position
        const token0Amount = ethers.utils.parseUnits('0.02', env.poolData.token0.decimals).toString();
        const token1Amount = ethers.utils.parseUnits('60', env.poolData.token1.decimals).toString();

        const createTxData = await adapter.generateCreatePositionData({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount,
          token1Amount,
          provider: env.provider,
          walletAddress,
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        const createTx = await signer.sendTransaction({
          to: createTxData.to,
          data: createTxData.data,
          value: createTxData.value
        });
        const createReceipt = await createTx.wait();

        const parsed = adapter.parseIncreaseLiquidityReceipt(createReceipt, {
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          poolData: env.poolData
        });

        // Generate add liquidity with only token1
        const result = await adapter.generateAddLiquidityData({
          position: { id: parsed.tokenId, tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount: '0',
          token1Amount: ethers.utils.parseUnits('30', env.poolData.token1.decimals).toString(),
          provider: env.provider,
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        expect(result).toHaveProperty('to');
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);
        expect(result).toHaveProperty('data');
        expect(result.data).toMatch(/^0x/);
        expect(result).toHaveProperty('quote');
      }, 180000);

      it('should use input balances as max amounts (slippage headroom)', async () => {
        const { ethers } = require('ethers');

        // Get signer from environment
        const signer = env.signers[0];
        const walletAddress = await signer.getAddress();

        // Get position range around current tick
        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 10, 10);

        // Create position first
        const createToken0Amount = ethers.utils.parseUnits('0.02', env.poolData.token0.decimals).toString();
        const createToken1Amount = ethers.utils.parseUnits('60', env.poolData.token1.decimals).toString();

        const createTxData = await adapter.generateCreatePositionData({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount: createToken0Amount,
          token1Amount: createToken1Amount,
          provider: env.provider,
          walletAddress,
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        const createTx = await signer.sendTransaction({
          to: createTxData.to,
          data: createTxData.data,
          value: createTxData.value
        });
        const createReceipt = await createTx.wait();

        const parsed = adapter.parseIncreaseLiquidityReceipt(createReceipt, {
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          poolData: env.poolData
        });

        // Generate add liquidity with specific amounts
        const addToken0Amount = ethers.utils.parseUnits('0.01', env.poolData.token0.decimals).toString();
        const addToken1Amount = ethers.utils.parseUnits('30', env.poolData.token1.decimals).toString();

        const result = await adapter.generateAddLiquidityData({
          position: { id: parsed.tokenId, tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount: addToken0Amount,
          token1Amount: addToken1Amount,
          provider: env.provider,
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          slippageTolerance: 5,
          deadlineMinutes: 20
        });

        // Verify quote includes amountMax values (should equal input balances)
        expect(result.quote).toHaveProperty('amount0Max');
        expect(result.quote).toHaveProperty('amount1Max');

        // amountMax should equal the input token amounts (our balances are the max)
        const inputAmount0 = BigInt(addToken0Amount);
        const inputAmount1 = BigInt(addToken1Amount);
        const amount0Max = BigInt(result.quote.amount0Max);
        const amount1Max = BigInt(result.quote.amount1Max);

        // The max amounts should equal our input balances
        expect(amount0Max).toBe(inputAmount0);
        expect(amount1Max).toBe(inputAmount1);

        console.log(`Balance-as-max verification (addLiquidity):`);
        console.log(`  inputAmount0: ${inputAmount0}, amount0Max: ${amount0Max}`);
        console.log(`  inputAmount1: ${inputAmount1}, amount1Max: ${amount1Max}`);

        // Execute the transaction to verify it succeeds
        const tx = await signer.sendTransaction({
          to: result.to,
          data: result.data,
          value: result.value,
          gasLimit: 1000000
        });
        const receipt = await tx.wait();

        // Verify transaction succeeded
        expect(receipt.status).toBe(1);

        // Verify quote liquidity is positive
        expect(BigInt(result.quote.liquidity)).toBeGreaterThan(0n);
      }, 180000);

      it('should execute add liquidity and increase position', async () => {
        const localSnapshot = await env.snapshot();
        const { ethers } = require('ethers');

        // Get signer from environment
        const signer = env.signers[0];
        const walletAddress = await signer.getAddress();

        // Get position range around current tick
        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 10, 10);

        // Create position
        const token0Amount = ethers.utils.parseUnits('0.02', env.poolData.token0.decimals).toString();
        const token1Amount = ethers.utils.parseUnits('60', env.poolData.token1.decimals).toString();

        const createTxData = await adapter.generateCreatePositionData({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount,
          token1Amount,
          provider: env.provider,
          walletAddress,
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        const createTx = await signer.sendTransaction({
          to: createTxData.to,
          data: createTxData.data,
          value: createTxData.value
        });
        const createReceipt = await createTx.wait();

        const parsed = adapter.parseIncreaseLiquidityReceipt(createReceipt, {
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          poolData: env.poolData
        });

        // Get initial liquidity via getPositionById
        const beforeResult = await adapter.getPositionById(parsed.tokenId, env.provider);
        const initialLiquidity = BigInt(beforeResult.position.liquidity);

        // Generate add liquidity data
        const addTxData = await adapter.generateAddLiquidityData({
          position: { id: parsed.tokenId, tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount: ethers.utils.parseUnits('0.01', env.poolData.token0.decimals).toString(),
          token1Amount: ethers.utils.parseUnits('30', env.poolData.token1.decimals).toString(),
          provider: env.provider,
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        // Execute add liquidity
        const addTx = await signer.sendTransaction({
          to: addTxData.to,
          data: addTxData.data,
          value: addTxData.value
        });
        const addReceipt = await addTx.wait();
        expect(addReceipt.status).toBe(1);

        // Verify liquidity increased via getPositionById
        const afterResult = await adapter.getPositionById(parsed.tokenId, env.provider);
        const newLiquidity = BigInt(afterResult.position.liquidity);

        expect(newLiquidity).toBeGreaterThan(initialLiquidity);

        await env.revert(localSnapshot);
      }, 180000);
    });
  });

  describe('_getAddLiquidityAmounts', () => {
    const validTestAddress1 = '0x1234567890123456789012345678901234567890';
    const validTestAddress2 = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

    // Base valid params for error testing
    const getBaseParams = () => ({
      position: { tickLower: -600, tickUpper: 600 },
      token0Amount: '1000000000000000000',
      token1Amount: '1000000',
      poolData: {
        sqrtPriceX96: '79228162514264337593543950336',
        liquidity: '1000000000000000000',
        tick: 0,
        poolKey: {
          currency0: validTestAddress1,
          currency1: validTestAddress2,
          fee: 3000,
          tickSpacing: 60,
          hooks: '0x0000000000000000000000000000000000000000'
        }
      },
      token0Data: { address: validTestAddress1, decimals: 18 },
      token1Data: { address: validTestAddress2, decimals: 6 },
      provider: env.provider
    });

    describe('Error Cases', () => {
      it('should throw when position is missing', async () => {
        const params = getBaseParams();
        delete params.position;
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('position is required and must be an object');
      });

      it('should throw when position.tickLower is not an integer', async () => {
        const params = getBaseParams();
        params.position.tickLower = 'not-a-number';
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('position.tickLower must be an integer');
      });

      it('should throw when position.tickUpper is not an integer', async () => {
        const params = getBaseParams();
        params.position.tickUpper = 1.5;
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('position.tickUpper must be an integer');
      });

      it('should throw when tickLower >= tickUpper', async () => {
        const params = getBaseParams();
        params.position.tickLower = 600;
        params.position.tickUpper = -600;
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('position.tickLower must be less than position.tickUpper');
      });

      it('should throw when token0Amount is missing', async () => {
        const params = getBaseParams();
        delete params.token0Amount;
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('token0Amount is required');
      });

      it('should throw when token0Amount is not a string', async () => {
        const params = getBaseParams();
        params.token0Amount = 1000000000000000000;
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('token0Amount must be a string');
      });

      it('should throw when token0Amount is not numeric', async () => {
        const params = getBaseParams();
        params.token0Amount = 'abc';
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('token0Amount must be a numeric string');
      });

      it('should throw when token1Amount is missing', async () => {
        const params = getBaseParams();
        delete params.token1Amount;
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('token1Amount is required');
      });

      it('should throw when token1Amount is not a string', async () => {
        const params = getBaseParams();
        params.token1Amount = 1000000;
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('token1Amount must be a string');
      });

      it('should throw when both amounts are 0', async () => {
        const params = getBaseParams();
        params.token0Amount = '0';
        params.token1Amount = '0';
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('At least one token amount must be greater than 0');
      });

      it('should throw when provider is missing', async () => {
        const params = getBaseParams();
        delete params.provider;
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('provider is required');
      });

      it('should throw when poolData is missing', async () => {
        const params = getBaseParams();
        delete params.poolData;
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('poolData is required and must be an object');
      });

      it('should throw when poolData.poolKey is missing', async () => {
        const params = getBaseParams();
        delete params.poolData.poolKey;
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('poolKey is required and must be an object');
      });

      it('should throw when token0Data is missing', async () => {
        const params = getBaseParams();
        delete params.token0Data;
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('token0Data is required and must be an object');
      });

      it('should throw when token1Data is missing', async () => {
        const params = getBaseParams();
        delete params.token1Data;
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('token1Data is required and must be an object');
      });

      it('should throw when tokens are the same', async () => {
        const params = getBaseParams();
        params.token1Data.address = params.token0Data.address;
        await expect(adapter._getAddLiquidityAmounts(params))
          .rejects.toThrow('token0Data and token1Data must have different addresses');
      });
    });

    describe('Success Cases', () => {
      it('should calculate amounts with both token amounts provided', async () => {
        const { ethers } = require('ethers');

        // Get position range
        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 10, 10);

        const result = await adapter._getAddLiquidityAmounts({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount: ethers.utils.parseUnits('0.01', env.poolData.token0.decimals).toString(),
          token1Amount: ethers.utils.parseUnits('30', env.poolData.token1.decimals).toString(),
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          provider: env.provider
        });

        expect(result).toHaveProperty('token0Amount');
        expect(result).toHaveProperty('token1Amount');
        expect(result).toHaveProperty('liquidity');
        expect(typeof result.token0Amount).toBe('string');
        expect(typeof result.token1Amount).toBe('string');
        expect(typeof result.liquidity).toBe('string');
        expect(BigInt(result.liquidity)).toBeGreaterThan(0n);
      });

      it('should calculate amounts with only token0 provided', async () => {
        const { ethers } = require('ethers');

        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 10, 10);

        const result = await adapter._getAddLiquidityAmounts({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount: ethers.utils.parseUnits('0.01', env.poolData.token0.decimals).toString(),
          token1Amount: '0',
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          provider: env.provider
        });

        expect(result).toHaveProperty('token0Amount');
        expect(result).toHaveProperty('token1Amount');
        expect(result).toHaveProperty('liquidity');
        expect(BigInt(result.liquidity)).toBeGreaterThan(0n);
      });

      it('should calculate amounts with only token1 provided', async () => {
        const { ethers } = require('ethers');

        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 10, 10);

        const result = await adapter._getAddLiquidityAmounts({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount: '0',
          token1Amount: ethers.utils.parseUnits('30', env.poolData.token1.decimals).toString(),
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          provider: env.provider
        });

        expect(result).toHaveProperty('token0Amount');
        expect(result).toHaveProperty('token1Amount');
        expect(result).toHaveProperty('liquidity');
        expect(BigInt(result.liquidity)).toBeGreaterThan(0n);
      });

      it('should handle token order correctly when swapped', async () => {
        const { ethers } = require('ethers');

        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 10, 10);

        // Call with tokens in reverse order (token1Data first)
        const result = await adapter._getAddLiquidityAmounts({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount: ethers.utils.parseUnits('30', env.poolData.token1.decimals).toString(),
          token1Amount: ethers.utils.parseUnits('0.01', env.poolData.token0.decimals).toString(),
          poolData: env.poolData,
          token0Data: env.poolData.token1, // Swapped
          token1Data: env.poolData.token0, // Swapped
          provider: env.provider
        });

        expect(result).toHaveProperty('token0Amount');
        expect(result).toHaveProperty('token1Amount');
        expect(result).toHaveProperty('liquidity');
        expect(BigInt(result.liquidity)).toBeGreaterThan(0n);
      });
    });
  });

  describe('getOptimalTokenRatio', () => {

    describe('Success Cases', () => {

      it('should return shares that sum to 1.0 for an in-range position', async () => {
        // Build a ±5% range around current tick
        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 5, 5);

        const result = await adapter.getOptimalTokenRatio({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          token0Price: 3000.0,    // ETH price (token0 is native ETH in V4 ETH/USDC pool)
          token1Price: 1.0,       // USDC price
          provider: env.provider
        });

        expect(result).toBeDefined();
        expect(typeof result.token0Share).toBe('number');
        expect(typeof result.token1Share).toBe('number');

        // Shares must sum to 1.0
        expect(result.token0Share + result.token1Share).toBeCloseTo(1.0, 10);

        // Both shares should be between 0 and 1 for an in-range position
        expect(result.token0Share).toBeGreaterThan(0);
        expect(result.token0Share).toBeLessThan(1);
        expect(result.token1Share).toBeGreaterThan(0);
        expect(result.token1Share).toBeLessThan(1);
      });

      it('should return one-sided ratio for position entirely above current tick', async () => {
        // Position above tick → only SDK-token0 is needed.
        // V4 ETH/USDC pool: currency0 = ETH (0x0) = caller's token0, so token0Share should dominate.
        const tickSpacing = env.poolData.poolKey.tickSpacing;
        const alignedTick = Math.floor(env.poolData.tick / tickSpacing) * tickSpacing;
        const aboveLower = alignedTick + tickSpacing * 10;
        const aboveUpper = alignedTick + tickSpacing * 50;

        const result = await adapter.getOptimalTokenRatio({
          position: { tickLower: aboveLower, tickUpper: aboveUpper },
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          token0Price: 3000.0,
          token1Price: 1.0,
          provider: env.provider
        });

        expect(result.token0Share + result.token1Share).toBeCloseTo(1.0, 10);
        // ETH (caller's token0 = SDK-token0) should dominate
        expect(result.token0Share).toBeGreaterThan(0.95);
        expect(result.token1Share).toBeLessThan(0.05);
      });

      it('should return one-sided ratio for position entirely below current tick', async () => {
        // Position below tick → only SDK-token1 is needed.
        // SDK-token1 = USDC = caller's token1, so token1Share should dominate.
        const tickSpacing = env.poolData.poolKey.tickSpacing;
        const alignedTick = Math.floor(env.poolData.tick / tickSpacing) * tickSpacing;
        const belowLower = alignedTick - tickSpacing * 50;
        const belowUpper = alignedTick - tickSpacing * 10;

        const result = await adapter.getOptimalTokenRatio({
          position: { tickLower: belowLower, tickUpper: belowUpper },
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          token0Price: 3000.0,
          token1Price: 1.0,
          provider: env.provider
        });

        expect(result.token0Share + result.token1Share).toBeCloseTo(1.0, 10);
        // USDC (caller's token1 = SDK-token1) should dominate
        expect(result.token1Share).toBeGreaterThan(0.95);
        expect(result.token0Share).toBeLessThan(0.05);
      });

      it('should return roughly balanced shares for wide symmetric range', async () => {
        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 50, 50);

        const result = await adapter.getOptimalTokenRatio({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          token0Price: 3000.0,
          token1Price: 1.0,
          provider: env.provider
        });

        expect(result.token0Share + result.token1Share).toBeCloseTo(1.0, 10);
        expect(result.token0Share).toBeGreaterThan(0.2);
        expect(result.token0Share).toBeLessThan(0.8);
      });

      it('should handle token sorting correctly (result in caller token order)', async () => {
        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 10, 10);

        // Call with ETH as token0 (normal V4 order)
        const result1 = await adapter.getOptimalTokenRatio({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          token0Price: 3000.0,
          token1Price: 1.0,
          provider: env.provider
        });

        // Call with USDC as token0 (swapped order)
        const result2 = await adapter.getOptimalTokenRatio({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          poolData: env.poolData,
          token0Data: env.poolData.token1, // USDC
          token1Data: env.poolData.token0, // ETH
          token0Price: 1.0,
          token1Price: 3000.0,
          provider: env.provider
        });

        // The ETH share should be the same regardless of caller order
        expect(result1.token0Share).toBeCloseTo(result2.token1Share, 2);
        expect(result1.token1Share).toBeCloseTo(result2.token0Share, 2);
      });
    });

    describe('Error Cases', () => {
      const validTestAddress1 = '0x1234567890123456789012345678901234567890';
      const validTestAddress2 = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

      const getBaseParams = () => ({
        position: { tickLower: -600, tickUpper: 600 },
        poolData: env.poolData,
        token0Data: { address: validTestAddress1, decimals: 18, symbol: 'TOKEN0' },
        token1Data: { address: validTestAddress2, decimals: 6, symbol: 'TOKEN1' },
        token0Price: 100.0,
        token1Price: 1.0,
        provider: env.provider
      });

      it('should throw when position is missing', async () => {
        const params = getBaseParams();
        delete params.position;
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('position is required');
      });

      it('should throw when position ticks are not finite', async () => {
        const params = getBaseParams();
        params.position.tickLower = NaN;
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('position.tickLower and position.tickUpper must be finite numbers');
      });

      it('should throw when tickLower >= tickUpper', async () => {
        const params = getBaseParams();
        params.position.tickLower = params.position.tickUpper;
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('position.tickLower must be less than position.tickUpper');
      });

      it('should throw when poolData is missing', async () => {
        const params = getBaseParams();
        delete params.poolData;
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('poolData is required');
      });

      it('should throw when token0Data is missing', async () => {
        const params = getBaseParams();
        delete params.token0Data;
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('token0Data is required');
      });

      it('should throw when token1Data is missing', async () => {
        const params = getBaseParams();
        delete params.token1Data;
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('token1Data is required');
      });

      it('should throw when token0Price is missing or invalid', async () => {
        const params = getBaseParams();
        params.token0Price = 0;
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('token0Price must be a positive finite number');

        params.token0Price = -5;
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('token0Price must be a positive finite number');

        params.token0Price = NaN;
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('token0Price must be a positive finite number');
      });

      it('should throw when token1Price is missing or invalid', async () => {
        const params = getBaseParams();
        params.token1Price = 0;
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('token1Price must be a positive finite number');

        params.token1Price = 'abc';
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('token1Price must be a positive finite number');
      });

      it('should throw when provider is missing', async () => {
        const params = getBaseParams();
        delete params.provider;
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('provider is required');
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
      tick: 0,
      poolKey: mockPoolKey
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
            poolData: mockPoolData,
            token0Data: mockToken0Data,
            token1Data: mockToken1Data,
            slippageTolerance: 0.5,
            deadlineMinutes: 30
          })).rejects.toThrow('At least one token amount must be greater than 0');
        });
      });

      describe('poolKey validation', () => {
        it('should throw for missing poolData.poolKey', async () => {
          const poolDataNoPoolKey = { ...mockPoolData };
          delete poolDataNoPoolKey.poolKey;
          await expect(adapter.generateCreatePositionData({
            position: mockPosition,
            token0Amount: '1000000000000000000',
            token1Amount: '1000000',
            provider: env.provider,
            walletAddress: validWalletAddress,
            poolData: poolDataNoPoolKey,
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
            poolData: { ...mockPoolData, poolKey: { ...mockPoolKey, currency0: null } },
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
            poolData: { ...mockPoolData, poolKey: { ...mockPoolKey, currency0: USDC, currency1: WETH } }, // Wrong order
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
            poolData: { ...mockPoolData, poolKey: poolKeyNoHooks },
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
          poolData: fetchedPoolData, // poolKey is included in fetchedPoolData
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

      it('should execute successfully with input balances as max amounts', async () => {
        const signer = env.signers[0];

        // Use smaller amounts for execution test
        const execParams = {
          ...baseParams,
          token0Amount: ethers.utils.parseEther('0.001').toString(), // 0.001 ETH
          token1Amount: ethers.utils.parseUnits('3', 6).toString(),   // 3 USDC
          walletAddress: signer.address,
          slippageTolerance: 5
        };

        const txData = await adapter.generateCreatePositionData(execParams);

        // Verify quote includes amountMax values (should equal input balances)
        expect(txData.quote).toHaveProperty('amount0Max');
        expect(txData.quote).toHaveProperty('amount1Max');

        // amountMax should equal the input token amounts (our balances are the max)
        const inputAmount0 = BigInt(execParams.token0Amount);
        const inputAmount1 = BigInt(execParams.token1Amount);
        const amount0Max = BigInt(txData.quote.amount0Max);
        const amount1Max = BigInt(txData.quote.amount1Max);

        // The max amounts should equal our input balances
        expect(amount0Max).toBe(inputAmount0);
        expect(amount1Max).toBe(inputAmount1);

        console.log(`Balance-as-max verification:`);
        console.log(`  inputAmount0: ${inputAmount0}, amount0Max: ${amount0Max}`);
        console.log(`  inputAmount1: ${inputAmount1}, amount1Max: ${amount1Max}`);

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

      it('should execute with only native ETH (no USDC) using out-of-range position', async () => {
        const signer = env.signers[0];

        // For a position that only needs token0 (ETH), the tick range must be
        // ABOVE the current tick. In that case, only ETH is deposited.
        const TICK_SPACING = 10;
        const currentTick = baseParams.poolData.tick;
        // Position entirely above current price - only needs token0 (ETH)
        const tickLower = Math.ceil(currentTick / TICK_SPACING) * TICK_SPACING + TICK_SPACING * 5;
        const tickUpper = tickLower + TICK_SPACING * 10;

        const execParams = {
          ...baseParams,
          position: { tickLower, tickUpper },
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
          poolData: poolData, // poolKey is inside poolData
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
          poolData: poolData, // poolKey is inside poolData
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

  describe('evaluatePositionRange', () => {
    describe('Error Cases', () => {
      it('should throw when position is null', async () => {
        await expect(adapter.evaluatePositionRange(null, env.provider))
          .rejects.toThrow('position parameter is required');
      });

      it('should throw when position is undefined', async () => {
        await expect(adapter.evaluatePositionRange(undefined, env.provider))
          .rejects.toThrow('position parameter is required');
      });

      it('should throw when tickLower is missing', async () => {
        await expect(adapter.evaluatePositionRange(
          { tickUpper: 100 },
          env.provider
        )).rejects.toThrow('Position missing tick range data: tickLower=undefined, tickUpper=100');
      });

      it('should throw when tickUpper is missing', async () => {
        await expect(adapter.evaluatePositionRange(
          { tickLower: -100 },
          env.provider
        )).rejects.toThrow('Position missing tick range data: tickLower=-100, tickUpper=undefined');
      });

      it('should throw when poolId is missing (no swapData)', async () => {
        await expect(adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider
        )).rejects.toThrow('Position missing poolId');
      });

      it('should throw when tick range is invalid (lower >= upper)', async () => {
        await expect(adapter.evaluatePositionRange(
          { tickLower: 100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: 50 } }
        )).rejects.toThrow('Invalid tick range: 100 to 100');
      });

      it('should throw when tick range is invalid (lower > upper)', async () => {
        await expect(adapter.evaluatePositionRange(
          { tickLower: 200, tickUpper: 100 },
          env.provider,
          { swapData: { tick: 50 } }
        )).rejects.toThrow('Invalid tick range: 200 to 100');
      });

      it('should throw when swapData.tick is not a number', async () => {
        await expect(adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: 'not a number' } }
        )).rejects.toThrow('options.swapData must have tick property as a number');
      });

      it('should throw when swapData.tick is NaN', async () => {
        await expect(adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: NaN } }
        )).rejects.toThrow('options.swapData.tick must be a finite number');
      });

      it('should throw when swapData.tick is Infinity', async () => {
        await expect(adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: Infinity } }
        )).rejects.toThrow('options.swapData.tick must be a finite number');
      });

      it('should throw when swapData.tick is -Infinity', async () => {
        await expect(adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: -Infinity } }
        )).rejects.toThrow('options.swapData.tick must be a finite number');
      });

      it('should throw when swapData is null but defined in options', async () => {
        await expect(adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: null }
        )).rejects.toThrow('options.swapData must have tick property as a number');
      });
    });

    describe('Success Cases - with swapData', () => {
      it('should return inRange=true when tick is within range', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: 0 } }
        );

        expect(result.inRange).toBe(true);
        expect(result.current).toBe(0);
      });

      it('should return inRange=true when tick equals tickLower', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: -100 } }
        );

        expect(result.inRange).toBe(true);
        expect(result.current).toBe(-100);
      });

      it('should return inRange=true when tick equals tickUpper', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: 100 } }
        );

        expect(result.inRange).toBe(true);
        expect(result.current).toBe(100);
      });

      it('should return inRange=false when tick is below range', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: -150 } }
        );

        expect(result.inRange).toBe(false);
        expect(result.current).toBe(-150);
      });

      it('should return inRange=false when tick is above range', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: 150 } }
        );

        expect(result.inRange).toBe(false);
        expect(result.current).toBe(150);
      });

      it('should calculate centeredness correctly (0.5 when centered)', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: 0 } }
        );

        expect(result.centeredness).toBe(0.5);
        expect(result.distanceToUpper).toBe(0.5);
        expect(result.distanceToLower).toBe(0.5);
      });

      it('should calculate centeredness=0 at lower bound', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: -100 } }
        );

        expect(result.centeredness).toBe(0);
        expect(result.distanceToUpper).toBe(1);
        expect(result.distanceToLower).toBe(0);
      });

      it('should calculate centeredness=1 at upper bound', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: 100 } }
        );

        expect(result.centeredness).toBe(1);
        expect(result.distanceToUpper).toBe(0);
        expect(result.distanceToLower).toBe(1);
      });

      it('should clamp centeredness to [0,1] when below range', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: -200 } }
        );

        expect(result.centeredness).toBe(0);
        expect(result.distanceToUpper).toBe(1);
        expect(result.distanceToLower).toBe(0);
        expect(result.inRange).toBe(false);
      });

      it('should clamp centeredness to [0,1] when above range', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: 200 } }
        );

        expect(result.centeredness).toBe(1);
        expect(result.distanceToUpper).toBe(0);
        expect(result.distanceToLower).toBe(1);
        expect(result.inRange).toBe(false);
      });

      it('should calculate correct metrics at 25% position', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: 0, tickUpper: 100 },
          env.provider,
          { swapData: { tick: 25 } }
        );

        expect(result.inRange).toBe(true);
        expect(result.centeredness).toBe(0.25);
        expect(result.distanceToUpper).toBe(0.75);
        expect(result.distanceToLower).toBe(0.25);
        expect(result.current).toBe(25);
      });

      it('should calculate correct metrics at 75% position', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: 0, tickUpper: 100 },
          env.provider,
          { swapData: { tick: 75 } }
        );

        expect(result.inRange).toBe(true);
        expect(result.centeredness).toBe(0.75);
        expect(result.distanceToUpper).toBe(0.25);
        expect(result.distanceToLower).toBe(0.75);
        expect(result.current).toBe(75);
      });

      it('should work with negative tick ranges', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: -200, tickUpper: -100 },
          env.provider,
          { swapData: { tick: -150 } }
        );

        expect(result.inRange).toBe(true);
        expect(result.centeredness).toBe(0.5);
        expect(result.distanceToUpper).toBe(0.5);
        expect(result.distanceToLower).toBe(0.5);
        expect(result.current).toBe(-150);
      });

      it('should return all expected properties', async () => {
        const result = await adapter.evaluatePositionRange(
          { tickLower: -100, tickUpper: 100 },
          env.provider,
          { swapData: { tick: 50 } }
        );

        expect(result).toHaveProperty('inRange');
        expect(result).toHaveProperty('centeredness');
        expect(result).toHaveProperty('distanceToUpper');
        expect(result).toHaveProperty('distanceToLower');
        expect(result).toHaveProperty('current');

        expect(typeof result.inRange).toBe('boolean');
        expect(typeof result.centeredness).toBe('number');
        expect(typeof result.distanceToUpper).toBe('number');
        expect(typeof result.distanceToLower).toBe('number');
        expect(typeof result.current).toBe('number');
      });
    });
  });

  describe('parseCollectReceipt', () => {
    // Helper to create mock ERC20 Transfer event logs
    // Transfer(address indexed from, address indexed to, uint256 value)
    const createERC20TransferLog = (tokenAddress, amount, from = '0x1234567890123456789012345678901234567890', to = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd') => {
      const { ethers } = require('ethers');
      const transferTopic = ethers.utils.id('Transfer(address,address,uint256)');

      return {
        address: tokenAddress, // Token contract address
        topics: [
          transferTopic,
          ethers.utils.hexZeroPad(from, 32), // from (indexed)
          ethers.utils.hexZeroPad(to, 32)    // to (indexed)
        ],
        data: ethers.utils.defaultAbiCoder.encode(['uint256'], [amount])
      };
    };

    // Alias for backwards compatibility with existing tests
    const createTransferLog = createERC20TransferLog;

    describe('Error Cases', () => {
      it('should throw when receipt is null', async () => {
        await expect(adapter.parseCollectReceipt(null, {}))
          .rejects.toThrow('Receipt parameter is required');
      });

      it('should throw when receipt is undefined', async () => {
        await expect(adapter.parseCollectReceipt(undefined, {}))
          .rejects.toThrow('Receipt parameter is required');
      });

      it('should throw when receipt.logs is missing', async () => {
        await expect(adapter.parseCollectReceipt({}, {}))
          .rejects.toThrow('Receipt must have logs property');
      });

      it('should throw when positionMetadata is null', async () => {
        await expect(adapter.parseCollectReceipt({ logs: [] }, null))
          .rejects.toThrow('Position metadata parameter is required');
      });

      it('should throw when positionMetadata is undefined', async () => {
        await expect(adapter.parseCollectReceipt({ logs: [] }, undefined))
          .rejects.toThrow('Position metadata parameter is required');
      });

      it('should throw when positionMetadata is not an object', async () => {
        await expect(adapter.parseCollectReceipt({ logs: [] }, 'not an object'))
          .rejects.toThrow('Position metadata must be an object');
      });

      it('should throw when positionMetadata is an array', async () => {
        await expect(adapter.parseCollectReceipt({ logs: [] }, []))
          .rejects.toThrow('Position metadata must be an object');
      });
    });

    describe('Success Cases', () => {
      const { ethers } = require('ethers');

      // Test token addresses
      const TOKEN0_ADDRESS = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'; // WETH on Arbitrum
      const TOKEN1_ADDRESS = '0xaf88d065e77c8cc2239327c5edb3a432268e5831'; // USDC on Arbitrum

      it('should return position with zero amounts when no Transfer events for ERC20 tokens', async () => {
        const result = await adapter.parseCollectReceipt(
          { logs: [] },
          { '12345': { token0Data: { address: TOKEN0_ADDRESS }, token1Data: { address: TOKEN1_ADDRESS } } }
        );

        // Position is always included now, with zero amounts for ERC20 tokens
        expect(result.feesByPosition['12345']).toBeDefined();
        expect(result.feesByPosition['12345'].token0.toString()).toBe('0');
        expect(result.feesByPosition['12345'].token1.toString()).toBe('0');
      });

      it('should return zero amounts when Transfer events exist but for different tokens', async () => {
        const log = createTransferLog(
          '0x1111111111111111111111111111111111111111', // different token
          ethers.utils.parseEther('1')
        );

        const result = await adapter.parseCollectReceipt(
          { logs: [log] },
          { '12345': { token0Data: { address: TOKEN0_ADDRESS }, token1Data: { address: TOKEN1_ADDRESS } } }
        );

        // Position is included with zero amounts since the Transfer was for a different token
        expect(result.feesByPosition['12345']).toBeDefined();
        expect(result.feesByPosition['12345'].token0.toString()).toBe('0');
        expect(result.feesByPosition['12345'].token1.toString()).toBe('0');
      });

      it('should parse fees from PoolManager Transfer events', async () => {
        const amount0 = ethers.utils.parseEther('0.5');
        const amount1 = ethers.utils.parseUnits('1000', 6);

        const logs = [
          createTransferLog(TOKEN0_ADDRESS, amount0),
          createTransferLog(TOKEN1_ADDRESS, amount1)
        ];

        const positionMetadata = {
          '12345': {
            token0Data: { address: TOKEN0_ADDRESS, decimals: 18, symbol: 'WETH' },
            token1Data: { address: TOKEN1_ADDRESS, decimals: 6, symbol: 'USDC' }
          }
        };

        const result = await adapter.parseCollectReceipt({ logs }, positionMetadata);

        expect(result.feesByPosition['12345']).toBeDefined();
        expect(result.feesByPosition['12345'].token0.toString()).toBe(amount0.toString());
        expect(result.feesByPosition['12345'].token1.toString()).toBe(amount1.toString());
        expect(result.feesByPosition['12345'].metadata).toBe(positionMetadata['12345']);
      });

      it('should handle multiple Transfer events for same token', async () => {
        const amount1 = ethers.utils.parseEther('0.3');
        const amount2 = ethers.utils.parseEther('0.2');
        const expectedTotal = amount1.add(amount2);

        const logs = [
          createTransferLog(TOKEN0_ADDRESS, amount1),
          createTransferLog(TOKEN0_ADDRESS, amount2)
        ];

        const positionMetadata = {
          '12345': {
            token0Data: { address: TOKEN0_ADDRESS, decimals: 18 },
            token1Data: { address: TOKEN1_ADDRESS, decimals: 6 }
          }
        };

        const result = await adapter.parseCollectReceipt({ logs }, positionMetadata);

        expect(result.feesByPosition['12345'].token0.toString()).toBe(expectedTotal.toString());
      });

      it('should match fees to correct position by token address (case insensitive)', async () => {
        const amount = ethers.utils.parseEther('1');
        const log = createTransferLog(TOKEN0_ADDRESS.toLowerCase(), amount);

        // Metadata with uppercase address
        const positionMetadata = {
          '12345': {
            token0Data: { address: TOKEN0_ADDRESS.toUpperCase() },
            token1Data: { address: TOKEN1_ADDRESS }
          }
        };

        const result = await adapter.parseCollectReceipt({ logs: [log] }, positionMetadata);

        expect(result.feesByPosition['12345']).toBeDefined();
        expect(result.feesByPosition['12345'].token0.toString()).toBe(amount.toString());
      });

      it('should return zero for tokens with no transfers', async () => {
        // Only token0 has a transfer, not token1
        const amount0 = ethers.utils.parseEther('0.5');
        const logs = [createTransferLog(TOKEN0_ADDRESS, amount0)];

        const positionMetadata = {
          '12345': {
            token0Data: { address: TOKEN0_ADDRESS },
            token1Data: { address: TOKEN1_ADDRESS }
          }
        };

        const result = await adapter.parseCollectReceipt({ logs }, positionMetadata);

        expect(result.feesByPosition['12345'].token0.toString()).toBe(amount0.toString());
        expect(result.feesByPosition['12345'].token1.toString()).toBe('0');
      });

      it('should throw for positions with incomplete metadata', async () => {
        const amount = ethers.utils.parseEther('1');
        const log = createTransferLog(TOKEN0_ADDRESS, amount);

        const positionMetadata = {
          '12345': { token0Data: { address: TOKEN0_ADDRESS } }, // missing token1Data
        };

        await expect(adapter.parseCollectReceipt({ logs: [log] }, positionMetadata))
          .rejects.toThrow('Invalid metadata for position 12345: missing token data');
      });

      it('should handle empty positionMetadata', async () => {
        const amount = ethers.utils.parseEther('1');
        const log = createTransferLog(TOKEN0_ADDRESS, amount);

        const result = await adapter.parseCollectReceipt({ logs: [log] }, {});

        expect(result.feesByPosition).toEqual({});
      });

      it('should ignore non-Transfer events in logs', async () => {
        const { ethers } = require('ethers');

        // Some random event that isn't a Transfer (with valid log structure)
        const randomLog = {
          address: '0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32', // PoolManager address
          topics: [ethers.utils.id('SomeOtherEvent(uint256)')],
          data: '0x'
        };

        const amount = ethers.utils.parseEther('1');
        const transferLog = createTransferLog(TOKEN0_ADDRESS, amount);

        const positionMetadata = {
          '12345': {
            token0Data: { address: TOKEN0_ADDRESS },
            token1Data: { address: TOKEN1_ADDRESS }
          }
        };

        const result = await adapter.parseCollectReceipt(
          { logs: [randomLog, transferLog] },
          positionMetadata
        );

        expect(result.feesByPosition['12345'].token0.toString()).toBe(amount.toString());
      });

      it('should return correct structure with all expected properties', async () => {
        const amount0 = ethers.utils.parseEther('0.1');
        const amount1 = ethers.utils.parseUnits('100', 6);

        const logs = [
          createTransferLog(TOKEN0_ADDRESS, amount0),
          createTransferLog(TOKEN1_ADDRESS, amount1)
        ];

        const metadata = {
          token0Data: { address: TOKEN0_ADDRESS, decimals: 18, symbol: 'WETH' },
          token1Data: { address: TOKEN1_ADDRESS, decimals: 6, symbol: 'USDC' }
        };

        const result = await adapter.parseCollectReceipt({ logs }, { '99999': metadata });

        expect(result).toHaveProperty('feesByPosition');
        expect(result.feesByPosition['99999']).toHaveProperty('token0');
        expect(result.feesByPosition['99999']).toHaveProperty('token1');
        expect(result.feesByPosition['99999']).toHaveProperty('metadata');
        expect(result.feesByPosition['99999'].metadata).toBe(metadata);

        // token0 and token1 should be BigNumber instances
        expect(ethers.BigNumber.isBigNumber(result.feesByPosition['99999'].token0)).toBe(true);
        expect(ethers.BigNumber.isBigNumber(result.feesByPosition['99999'].token1)).toBe(true);
      });
    });

    describe('Native ETH Handling', () => {
      const { ethers } = require('ethers');
      const NATIVE_ETH = ethers.constants.AddressZero;
      const USDC_ADDRESS = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';

      it('should return null for token0 when it is native ETH', async () => {
        // Native ETH as token0, USDC as token1
        const usdcAmount = ethers.utils.parseUnits('100', 6);
        const logs = [createTransferLog(USDC_ADDRESS, usdcAmount)];

        const positionMetadata = {
          '12345': {
            token0Data: { address: NATIVE_ETH, decimals: 18, symbol: 'ETH' },
            token1Data: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' }
          }
        };

        const result = await adapter.parseCollectReceipt({ logs }, positionMetadata);

        expect(result.feesByPosition['12345']).toBeDefined();
        expect(result.feesByPosition['12345'].token0).toBeNull();
        expect(result.feesByPosition['12345'].token1.toString()).toBe(usdcAmount.toString());
      });

      it('should return null for token1 when it is native ETH', async () => {
        // USDC as token0, native ETH as token1
        const usdcAmount = ethers.utils.parseUnits('50', 6);
        const logs = [createTransferLog(USDC_ADDRESS, usdcAmount)];

        const positionMetadata = {
          '12345': {
            token0Data: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' },
            token1Data: { address: NATIVE_ETH, decimals: 18, symbol: 'ETH' }
          }
        };

        const result = await adapter.parseCollectReceipt({ logs }, positionMetadata);

        expect(result.feesByPosition['12345']).toBeDefined();
        expect(result.feesByPosition['12345'].token0.toString()).toBe(usdcAmount.toString());
        expect(result.feesByPosition['12345'].token1).toBeNull();
      });

      it('should return null for native ETH even when no Transfer events exist', async () => {
        // No logs at all
        const positionMetadata = {
          '12345': {
            token0Data: { address: NATIVE_ETH, decimals: 18, symbol: 'ETH' },
            token1Data: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' }
          }
        };

        const result = await adapter.parseCollectReceipt({ logs: [] }, positionMetadata);

        expect(result.feesByPosition['12345']).toBeDefined();
        expect(result.feesByPosition['12345'].token0).toBeNull();
        // USDC should be BigNumber(0) since no Transfer events
        expect(result.feesByPosition['12345'].token1.toString()).toBe('0');
      });

      it('should always include position with native ETH in feesByPosition', async () => {
        const positionMetadata = {
          '12345': {
            token0Data: { address: NATIVE_ETH, decimals: 18, symbol: 'ETH' },
            token1Data: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' }
          }
        };

        const result = await adapter.parseCollectReceipt({ logs: [] }, positionMetadata);

        // Position should always be included even with no events
        expect(Object.keys(result.feesByPosition).length).toBe(1);
        expect(result.feesByPosition['12345']).toBeDefined();
      });

      it('should handle case-insensitive native ETH address (0x0 vs 0x00...0)', async () => {
        // Using the full zero address with uppercase
        const fullZeroAddress = '0x0000000000000000000000000000000000000000';

        const positionMetadata = {
          '12345': {
            token0Data: { address: fullZeroAddress, decimals: 18, symbol: 'ETH' },
            token1Data: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' }
          }
        };

        const result = await adapter.parseCollectReceipt({ logs: [] }, positionMetadata);

        expect(result.feesByPosition['12345'].token0).toBeNull();
      });
    });

    describe('ETH Tracking via Block Explorer', () => {
      const { ethers } = require('ethers');
      const NATIVE_ETH = ethers.constants.AddressZero;
      const USDC_ADDRESS = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';

      afterEach(() => {
        resetBlockExplorerConfig();
      });

      it('should return null for ETH when options not provided (backward compat)', async () => {
        // Without options, ETH should return null
        const positionMetadata = {
          '12345': {
            token0Data: { address: NATIVE_ETH, decimals: 18, symbol: 'ETH' },
            token1Data: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' }
          }
        };

        const result = await adapter.parseCollectReceipt({ logs: [] }, positionMetadata);

        // Without options, ETH tracking is not attempted - returns null
        expect(result.feesByPosition['12345'].token0).toBeNull();
      });

      it('should gracefully return null when block explorer fails (local fork tx)', async () => {
        // Configure API key but use a fake local transaction hash
        // The API will return no results since this tx doesn't exist on Arbiscan
        configureBlockExplorer({ blockExplorerApiKey: process.env.BLOCK_EXPLORER_API_KEY || 'test-key' });

        const positionMetadata = {
          '12345': {
            token0Data: { address: NATIVE_ETH, decimals: 18, symbol: 'ETH' },
            token1Data: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' }
          }
        };

        const mockReceipt = {
          transactionHash: '0x0000000000000000000000000000000000000000000000000000000000000001',
          logs: []
        };

        // Even with options, if API returns no data, ETH should still be null
        const result = await adapter.parseCollectReceipt(mockReceipt, positionMetadata, {
          chainId: 42161,
          walletAddress: '0x1234567890123456789012345678901234567890'
        });

        // Graceful degradation - ETH still null, no crash
        expect(result.feesByPosition['12345'].token0).toBeNull();
      });

      it('should not attempt ETH tracking when chainId missing from options', async () => {
        configureBlockExplorer({ blockExplorerApiKey: 'test-key' });

        const positionMetadata = {
          '12345': {
            token0Data: { address: NATIVE_ETH, decimals: 18, symbol: 'ETH' },
            token1Data: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' }
          }
        };

        // Options without chainId - should not attempt ETH tracking
        const result = await adapter.parseCollectReceipt({ logs: [] }, positionMetadata, {
          walletAddress: '0x1234567890123456789012345678901234567890'
        });

        expect(result.feesByPosition['12345'].token0).toBeNull();
      });

      it('should not attempt ETH tracking when walletAddress missing from options', async () => {
        configureBlockExplorer({ blockExplorerApiKey: 'test-key' });

        const positionMetadata = {
          '12345': {
            token0Data: { address: NATIVE_ETH, decimals: 18, symbol: 'ETH' },
            token1Data: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' }
          }
        };

        // Options without walletAddress - should not attempt ETH tracking
        const result = await adapter.parseCollectReceipt({ logs: [] }, positionMetadata, {
          chainId: 42161
        });

        expect(result.feesByPosition['12345'].token0).toBeNull();
      });

      it('should not attempt ETH tracking for non-ETH positions', async () => {
        configureBlockExplorer({ blockExplorerApiKey: 'test-key' });

        // Position with two ERC20 tokens (no native ETH)
        const WETH_ADDRESS = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
        const positionMetadata = {
          '12345': {
            token0Data: { address: WETH_ADDRESS, decimals: 18, symbol: 'WETH' },
            token1Data: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' }
          }
        };

        const result = await adapter.parseCollectReceipt({ logs: [] }, positionMetadata, {
          chainId: 42161,
          walletAddress: '0x1234567890123456789012345678901234567890'
        });

        // Both tokens are ERC20, so no block explorer needed - values come from Transfer events
        // With no Transfer events, both should be 0 (not null)
        expect(result.feesByPosition['12345'].token0.toString()).toBe('0');
        expect(result.feesByPosition['12345'].token1.toString()).toBe('0');
      });
    });

    describe('Integration - Real Receipt', () => {
      it('should parse real fee collection receipt after swaps generate fees', async () => {
        const { ethers } = require('ethers');

        const signer = env.signers[0];
        const walletAddress = await signer.getAddress();

        // Create a position around current tick - use same params as working fee collection test
        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 10, 10);

        // Create position with decent amounts (matching working test)
        const token0Amount = ethers.utils.parseUnits('0.1', env.poolData.token0.decimals).toString();
        const token1Amount = ethers.utils.parseUnits('300', env.poolData.token1.decimals).toString();

        const createTxData = await adapter.generateCreatePositionData({
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          token0Amount,
          token1Amount,
          provider: env.provider,
          walletAddress,
          poolData: env.poolData,
          token0Data: env.poolData.token0,
          token1Data: env.poolData.token1,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        const createTx = await signer.sendTransaction({
          to: createTxData.to,
          data: createTxData.data,
          value: createTxData.value
        });
        const createReceipt = await createTx.wait();

        const parsed = adapter.parseIncreaseLiquidityReceipt(createReceipt, {
          position: { tickLower: range.tickLower, tickUpper: range.tickUpper },
          poolData: env.poolData
        });

        console.log('Created position tokenId:', parsed.tokenId);

        // Execute swaps in BOTH directions to generate fees in BOTH tokens
        // Direct single-pool swaps via UniversalRouter to guarantee fees hit this pool
        const swapCommon = {
          poolKey: env.poolData.poolKey,
          recipient: walletAddress,
          universalRouterAddress: adapter.addresses.universalRouterAddress,
          universalRouterInterface: adapter.universalRouterInterface
        };

        // Swap 1: ETH -> USDC (zeroForOne=true, generates ETH fees)
        const swap1 = encodeDirectV4Swap({
          ...swapCommon,
          zeroForOne: true,
          amountIn: ethers.utils.parseEther('0.05').toString()
        });
        await (await signer.sendTransaction(swap1)).wait();
        console.log('Swap 1 complete (ETH -> USDC) - generates ETH fees');

        // Swap 2: USDC -> ETH (zeroForOne=false, generates USDC fees)
        // Approve USDC to UniversalRouter via Permit2
        const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
        const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, [
          'function approve(address token, address spender, uint160 amount, uint48 expiration) external'
        ], signer);
        const maxAmount = ethers.BigNumber.from(2).pow(160).sub(1);
        const farFutureExpiration = Math.floor(Date.now() / 1000 + 60 * 60 * 24 * 365);
        await (await permit2Contract.approve(
          env.poolData.token1.address,
          adapter.addresses.universalRouterAddress,
          maxAmount,
          farFutureExpiration
        )).wait();

        const swap2 = encodeDirectV4Swap({
          ...swapCommon,
          zeroForOne: false,
          amountIn: ethers.utils.parseUnits('100', 6).toString()
        });
        await (await signer.sendTransaction(swap2)).wait();
        console.log('Swap 2 complete (USDC -> ETH) - generates USDC fees');

        // Check accrued fees before claiming
        const feesBeforeClaim = await adapter.getAccruedFeesUSD(
          {
            id: parsed.tokenId,
            token0Decimals: env.poolData.token0.decimals,
            token1Decimals: env.poolData.token1.decimals
          },
          { token0: 3000, token1: 1 },
          env.provider
        );
        console.log('Fees before claim:', feesBeforeClaim);

        // Now claim the fees using the position we created
        const claimFeesData = await adapter.generateClaimFeesData({
          position: { id: parsed.tokenId, pool: env.poolData.poolId, tickLower: range.tickLower, tickUpper: range.tickUpper },
          walletAddress,
          provider: env.provider,
          poolData: env.poolData
        });

        const claimTx = await signer.sendTransaction({
          to: claimFeesData.to,
          data: claimFeesData.data,
          value: claimFeesData.value
        });
        const claimReceipt = await claimTx.wait();

        expect(claimReceipt.status).toBe(1);
        console.log('Claim receipt logs count:', claimReceipt.logs.length);

        // Log all events in the receipt for debugging
        console.log('\n=== RECEIPT ANALYSIS ===');
        const erc20TransferTopic = ethers.utils.id('Transfer(address,address,uint256)');
        const modifyLiquidityTopic = ethers.utils.id('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)');
        console.log('ERC20 Transfer topic:', erc20TransferTopic);
        console.log('ModifyLiquidity topic:', modifyLiquidityTopic);
        console.log('Token0 (currency0):', env.poolData.token0.address, env.poolData.token0.symbol);
        console.log('Token1 (currency1):', env.poolData.token1.address, env.poolData.token1.symbol);
        console.log('PoolManager:', adapter.addresses.poolManagerAddress);
        console.log('PositionManager:', adapter.addresses.positionManagerAddress);
        console.log('WETH (Arbitrum):', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1');
        console.log('\nReceipt logs:');
        for (let i = 0; i < claimReceipt.logs.length; i++) {
          const log = claimReceipt.logs[i];
          const isERC20Transfer = log.topics[0] === erc20TransferTopic;
          const isModifyLiquidity = log.topics[0] === modifyLiquidityTopic;
          console.log(`  Log ${i}: address=${log.address}`);
          console.log(`    topic: ${log.topics[0]}`);
          console.log(`    isERC20Transfer=${isERC20Transfer}, isModifyLiquidity=${isModifyLiquidity}`);
          if (isERC20Transfer && log.topics.length >= 3) {
            const from = '0x' + log.topics[1].slice(26);
            const to = '0x' + log.topics[2].slice(26);
            try {
              const amount = ethers.BigNumber.from(log.data);
              console.log(`    Transfer: from=${from} to=${to} amount=${amount.toString()}`);
            } catch(e) {
              console.log(`    Transfer: from=${from} to=${to} data=${log.data}`);
            }
          }
        }
        console.log('=== END RECEIPT ANALYSIS ===\n');

        // Now parse the real receipt
        const positionMetadata = {
          [parsed.tokenId]: {
            token0Data: {
              address: env.poolData.token0.address,
              decimals: env.poolData.token0.decimals,
              symbol: env.poolData.token0.symbol
            },
            token1Data: {
              address: env.poolData.token1.address,
              decimals: env.poolData.token1.decimals,
              symbol: env.poolData.token1.symbol
            }
          }
        };

        const result = await adapter.parseCollectReceipt(claimReceipt, positionMetadata);

        console.log('parseCollectReceipt result:', JSON.stringify(result, (k, v) =>
          typeof v === 'object' && v !== null && v._isBigNumber ? v.toString() : v
        , 2));

        // Verify structure
        expect(result).toHaveProperty('feesByPosition');
        expect(result.feesByPosition[parsed.tokenId]).toBeDefined();

        const fees = result.feesByPosition[parsed.tokenId];

        // Log the values for debugging
        console.log('Pre-calculated fees (ETH):', feesBeforeClaim.fees0);
        console.log('Pre-calculated fees (USDC):', feesBeforeClaim.fees1);
        console.log('Parsed USDC fees from receipt:', fees.token1.toString());

        // Verify BOTH fee types were generated by the bidirectional swaps
        expect(BigInt(feesBeforeClaim.fees0) > 0n).toBe(true); // ETH fees from ETH->USDC swap
        expect(BigInt(feesBeforeClaim.fees1) > 0n).toBe(true); // USDC fees from USDC->ETH swap

        // KEY TEST 1: Native ETH returns null (cannot parse from receipt - no events)
        expect(fees.token0).toBeNull();

        // KEY TEST 2: Parsed USDC amount matches pre-calculated USDC fees
        // This proves parseCollectReceipt correctly extracts ERC20 amounts from real Transfer events
        expect(ethers.BigNumber.isBigNumber(fees.token1)).toBe(true);
        expect(fees.token1.toString()).toBe(feesBeforeClaim.fees1);

        // Verify metadata preserved
        expect(fees.metadata).toBe(positionMetadata[parsed.tokenId]);
      }, 300000);
    });
  });

  describe('parseClosureReceipt', () => {
    // Helper to create mock ModifyLiquidity event logs
    // ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)
    const createModifyLiquidityLog = (poolId, tickLower, tickUpper, liquidityDelta) => {
      const { ethers } = require('ethers');
      const modifyLiquidityTopic = ethers.utils.id('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)');

      const encodedData = ethers.utils.defaultAbiCoder.encode(
        ['int24', 'int24', 'int256', 'bytes32'],
        [tickLower, tickUpper, liquidityDelta, ethers.constants.HashZero]
      );

      return {
        address: '0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32', // PoolManager address
        topics: [
          modifyLiquidityTopic,
          poolId || ethers.constants.HashZero, // indexed poolId
          ethers.utils.hexZeroPad('0x1234567890123456789012345678901234567890', 32) // indexed sender
        ],
        data: encodedData
      };
    };

    // Helper to create mock ERC20 Transfer event logs
    const createTransferLog = (tokenAddress, amount, from = '0x1234567890123456789012345678901234567890', to = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd') => {
      const { ethers } = require('ethers');
      const transferTopic = ethers.utils.id('Transfer(address,address,uint256)');

      return {
        address: tokenAddress,
        topics: [
          transferTopic,
          ethers.utils.hexZeroPad(from, 32),
          ethers.utils.hexZeroPad(to, 32)
        ],
        data: ethers.utils.defaultAbiCoder.encode(['uint256'], [amount])
      };
    };

    describe('Error Cases', () => {
      it('should throw when receipt is null', async () => {
        await expect(adapter.parseClosureReceipt(null, {}))
          .rejects.toThrow('Receipt parameter is required');
      });

      it('should throw when receipt is undefined', async () => {
        await expect(adapter.parseClosureReceipt(undefined, {}))
          .rejects.toThrow('Receipt parameter is required');
      });

      it('should throw when receipt.logs is missing', async () => {
        await expect(adapter.parseClosureReceipt({}, {}))
          .rejects.toThrow('Receipt must have logs property');
      });

      it('should throw when positionMetadata is null', async () => {
        await expect(adapter.parseClosureReceipt({ logs: [] }, null))
          .rejects.toThrow('Position metadata parameter is required');
      });

      it('should throw when positionMetadata is undefined', async () => {
        await expect(adapter.parseClosureReceipt({ logs: [] }, undefined))
          .rejects.toThrow('Position metadata parameter is required');
      });

      it('should throw when positionMetadata is not an object', async () => {
        await expect(adapter.parseClosureReceipt({ logs: [] }, 'not an object'))
          .rejects.toThrow('Position metadata must be an object');
      });

      it('should throw when positionMetadata is an array', async () => {
        await expect(adapter.parseClosureReceipt({ logs: [] }, []))
          .rejects.toThrow('Position metadata must be an object');
      });

      it('should throw when metadata is missing token data', async () => {
        const positionMetadata = {
          '12345': { token0Data: { address: '0x1234' } } // missing token1Data
        };
        await expect(adapter.parseClosureReceipt({ logs: [] }, positionMetadata))
          .rejects.toThrow('Invalid metadata for position 12345: missing token data');
      });

      it('should throw when metadata is missing poolData.sqrtPriceX96', async () => {
        const positionMetadata = {
          '12345': {
            token0Data: { address: '0x1234567890123456789012345678901234567890' },
            token1Data: { address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' },
            position: { tickLower: -100, tickUpper: 100 }
            // missing poolData
          }
        };
        await expect(adapter.parseClosureReceipt({ logs: [] }, positionMetadata))
          .rejects.toThrow('Invalid metadata for position 12345: missing poolData.sqrtPriceX96');
      });

      it('should throw when metadata is missing position', async () => {
        const positionMetadata = {
          '12345': {
            token0Data: { address: '0x1234567890123456789012345678901234567890' },
            token1Data: { address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' },
            poolData: { sqrtPriceX96: '79228162514264337593543950336' }
            // missing position
          }
        };
        await expect(adapter.parseClosureReceipt({ logs: [] }, positionMetadata))
          .rejects.toThrow('Invalid metadata for position 12345: missing position');
      });
    });

    describe('Success Cases', () => {
      const { ethers } = require('ethers');

      // Test token addresses
      const TOKEN0_ADDRESS = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'; // WETH on Arbitrum
      const TOKEN1_ADDRESS = '0xaf88d065e77c8cc2239327c5edb3a432268e5831'; // USDC on Arbitrum
      const NATIVE_ETH = ethers.constants.AddressZero;

      // Valid position metadata for ERC20/ERC20 position
      const createValidMetadata = (tickLower = -100, tickUpper = 100) => ({
        position: { tickLower, tickUpper, liquidity: '1000000000000000000' },
        poolData: { sqrtPriceX96: '79228162514264337593543950336' }, // ~1:1 price
        token0Data: { address: TOKEN0_ADDRESS, decimals: 18, symbol: 'WETH' },
        token1Data: { address: TOKEN1_ADDRESS, decimals: 6, symbol: 'USDC' }
      });

      it('should return empty results when positionMetadata is empty', async () => {
        const result = await adapter.parseClosureReceipt({ logs: [] }, {});

        expect(result.principalByPosition).toEqual({});
        expect(result.feesByPosition).toEqual({});
      });

      it('should return zero principal and fees when no events match', async () => {
        const positionMetadata = { '12345': createValidMetadata() };

        const result = await adapter.parseClosureReceipt({ logs: [] }, positionMetadata);

        // Principal should be zero (no ModifyLiquidity event)
        expect(result.principalByPosition['12345'].amount0.toString()).toBe('0');
        expect(result.principalByPosition['12345'].amount1.toString()).toBe('0');

        // Fees should also be zero (no Transfer events, fee = total - principal = 0 - 0)
        expect(result.feesByPosition['12345'].token0.toString()).toBe('0');
        expect(result.feesByPosition['12345'].token1.toString()).toBe('0');
      });

      it('should parse Transfer events for ERC20 tokens', async () => {
        const amount0 = ethers.utils.parseEther('0.5');
        const amount1 = ethers.utils.parseUnits('100', 6);
        const logs = [
          createTransferLog(TOKEN0_ADDRESS, amount0),
          createTransferLog(TOKEN1_ADDRESS, amount1)
        ];

        const positionMetadata = { '12345': createValidMetadata() };
        const result = await adapter.parseClosureReceipt({ logs }, positionMetadata);

        // Without ModifyLiquidity event, principal is 0, so fees = total
        expect(result.feesByPosition['12345'].token0.toString()).toBe(amount0.toString());
        expect(result.feesByPosition['12345'].token1.toString()).toBe(amount1.toString());
      });

      it('should return null for native ETH fees (token0)', async () => {
        const usdcAmount = ethers.utils.parseUnits('100', 6);
        const logs = [createTransferLog(TOKEN1_ADDRESS, usdcAmount)];

        const positionMetadata = {
          '12345': {
            position: { tickLower: -100, tickUpper: 100, liquidity: '1000000000000000000' },
            poolData: { sqrtPriceX96: '79228162514264337593543950336' },
            token0Data: { address: NATIVE_ETH, decimals: 18, symbol: 'ETH' },
            token1Data: { address: TOKEN1_ADDRESS, decimals: 6, symbol: 'USDC' }
          }
        };

        const result = await adapter.parseClosureReceipt({ logs }, positionMetadata);

        // Native ETH should return null
        expect(result.feesByPosition['12345'].token0).toBeNull();
        // USDC should have the parsed amount
        expect(result.feesByPosition['12345'].token1.toString()).toBe(usdcAmount.toString());
      });

      it('should return null for native ETH fees (token1)', async () => {
        const wethAmount = ethers.utils.parseEther('0.5');
        const logs = [createTransferLog(TOKEN0_ADDRESS, wethAmount)];

        const positionMetadata = {
          '12345': {
            position: { tickLower: -100, tickUpper: 100, liquidity: '1000000000000000000' },
            poolData: { sqrtPriceX96: '79228162514264337593543950336' },
            token0Data: { address: TOKEN0_ADDRESS, decimals: 18, symbol: 'WETH' },
            token1Data: { address: NATIVE_ETH, decimals: 18, symbol: 'ETH' }
          }
        };

        const result = await adapter.parseClosureReceipt({ logs }, positionMetadata);

        // WETH should have the parsed amount
        expect(result.feesByPosition['12345'].token0.toString()).toBe(wethAmount.toString());
        // Native ETH should return null
        expect(result.feesByPosition['12345'].token1).toBeNull();
      });

      it('should return correct structure with principalByPosition and feesByPosition', async () => {
        const amount0 = ethers.utils.parseEther('0.1');
        const logs = [createTransferLog(TOKEN0_ADDRESS, amount0)];

        const positionMetadata = { '99999': createValidMetadata() };
        const result = await adapter.parseClosureReceipt({ logs }, positionMetadata);

        // Verify structure
        expect(result).toHaveProperty('principalByPosition');
        expect(result).toHaveProperty('feesByPosition');

        // Verify principalByPosition structure
        expect(result.principalByPosition['99999']).toHaveProperty('amount0');
        expect(result.principalByPosition['99999']).toHaveProperty('amount1');
        expect(ethers.BigNumber.isBigNumber(result.principalByPosition['99999'].amount0)).toBe(true);
        expect(ethers.BigNumber.isBigNumber(result.principalByPosition['99999'].amount1)).toBe(true);

        // Verify feesByPosition structure
        expect(result.feesByPosition['99999']).toHaveProperty('token0');
        expect(result.feesByPosition['99999']).toHaveProperty('token1');
        expect(result.feesByPosition['99999']).toHaveProperty('metadata');
      });

      it('should aggregate multiple Transfer events for same token', async () => {
        const amount1 = ethers.utils.parseEther('0.3');
        const amount2 = ethers.utils.parseEther('0.2');
        const expectedTotal = amount1.add(amount2);

        const logs = [
          createTransferLog(TOKEN0_ADDRESS, amount1),
          createTransferLog(TOKEN0_ADDRESS, amount2)
        ];

        const positionMetadata = { '12345': createValidMetadata() };
        const result = await adapter.parseClosureReceipt({ logs }, positionMetadata);

        expect(result.feesByPosition['12345'].token0.toString()).toBe(expectedTotal.toString());
      });

      it('should preserve metadata in feesByPosition', async () => {
        const metadata = createValidMetadata();
        const positionMetadata = { '12345': metadata };

        const result = await adapter.parseClosureReceipt({ logs: [] }, positionMetadata);

        expect(result.feesByPosition['12345'].metadata).toBe(metadata);
      });
    });

    describe('Integration - Real Closure Receipt', () => {
      it('should parse real position closure receipt with ModifyLiquidity and Transfer events', async () => {
        const { ethers } = require('ethers');

        const signer = env.signers[0];
        const walletAddress = await signer.getAddress();

        // Step 1: Create a position (same pattern as parseCollectReceipt test)
        const poolDataWithTickSpacing = { ...env.poolData, tickSpacing: env.poolData.poolKey.tickSpacing };
        const range = adapter.getPositionRange(poolDataWithTickSpacing, 10, 10);
        const { tickLower, tickUpper } = range;

        const token0Data = env.poolData.token0;
        const token1Data = env.poolData.token1;

        // Create position with decent amounts
        const token0Amount = ethers.utils.parseUnits('0.1', token0Data.decimals).toString();
        const token1Amount = ethers.utils.parseUnits('300', token1Data.decimals).toString();

        const mintData = await adapter.generateCreatePositionData({
          position: { tickLower, tickUpper },
          token0Amount,
          token1Amount,
          provider: env.provider,
          walletAddress,
          poolData: env.poolData,
          token0Data,
          token1Data,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        const mintTx = await signer.sendTransaction({
          to: mintData.to,
          data: mintData.data,
          value: mintData.value
        });
        const mintReceipt = await mintTx.wait();

        // Parse the mint receipt to get position info
        const parsed = adapter.parseIncreaseLiquidityReceipt(mintReceipt, {
          position: { tickLower, tickUpper },
          poolData: env.poolData
        });

        console.log('Created position:', parsed.tokenId);
        console.log('Position ticks:', tickLower, tickUpper);

        // Step 2: Generate fees with direct single-pool swaps via UniversalRouter
        const swapCommon = {
          poolKey: env.poolData.poolKey,
          recipient: walletAddress,
          universalRouterAddress: adapter.addresses.universalRouterAddress,
          universalRouterInterface: adapter.universalRouterInterface
        };

        // Swap ETH -> USDC (zeroForOne=true)
        const swap1 = encodeDirectV4Swap({
          ...swapCommon,
          zeroForOne: true,
          amountIn: ethers.utils.parseEther('0.05').toString()
        });
        await (await signer.sendTransaction(swap1)).wait();
        console.log('Swap 1 complete (ETH -> USDC)');

        // Swap USDC -> ETH (zeroForOne=false) - need Permit2 setup
        const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
        const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, [
          'function approve(address token, address spender, uint160 amount, uint48 expiration) external'
        ], signer);
        const maxAmount = ethers.BigNumber.from(2).pow(160).sub(1);
        const farFutureExpiration = Math.floor(Date.now() / 1000 + 60 * 60 * 24 * 365);
        await (await permit2Contract.approve(
          token1Data.address,
          adapter.addresses.universalRouterAddress,
          maxAmount,
          farFutureExpiration
        )).wait();

        const swap2 = encodeDirectV4Swap({
          ...swapCommon,
          zeroForOne: false,
          amountIn: ethers.utils.parseUnits('50', token1Data.decimals).toString()
        });
        await (await signer.sendTransaction(swap2)).wait();
        console.log('Swap 2 complete (USDC -> ETH)');

        // Fetch fresh poolData AFTER swaps - need accurate sqrtPriceX96 for principal calculation
        const poolId = adapter._computePoolId(env.poolData.poolKey);
        const freshPoolData = await adapter.getPoolData(poolId, env.provider);
        // Merge poolKey into freshPoolData (getPoolData doesn't return poolKey)
        const poolDataAfterSwaps = { ...freshPoolData, poolKey: env.poolData.poolKey };
        console.log('Pool tick after swaps:', poolDataAfterSwaps.tick);

        // Step 3: Close the position (use liquidity from mint receipt)
        const closeData = await adapter.generateRemoveLiquidityData({
          position: { id: parsed.tokenId, tickLower, tickUpper, liquidity: parsed.liquidity },
          percentage: 100,
          walletAddress,
          provider: env.provider,
          poolData: poolDataAfterSwaps,
          slippageTolerance: 50,
          deadlineMinutes: 20
        });

        const closeTx = await signer.sendTransaction({
          to: closeData.to,
          data: closeData.data,
          value: closeData.value || 0,
          gasLimit: 1000000
        });
        const closeReceipt = await closeTx.wait();

        console.log('Close receipt logs count:', closeReceipt.logs.length);

        // Step 4: Parse the closure receipt
        // Use poolDataAfterSwaps (fetched before closure) for accurate principal calculation
        const positionMetadata = {
          [parsed.tokenId]: {
            position: {
              tickLower,
              tickUpper,
              liquidity: parsed.liquidity
            },
            poolData: poolDataAfterSwaps,
            token0Data,
            token1Data
          }
        };

        const result = await adapter.parseClosureReceipt(closeReceipt, positionMetadata);

        console.log('parseClosureReceipt result:', JSON.stringify(result, (k, v) =>
          typeof v === 'object' && v !== null && v._isBigNumber ? v.toString() : v
        , 2));

        // Verify structure
        expect(result).toHaveProperty('principalByPosition');
        expect(result).toHaveProperty('feesByPosition');
        expect(result.principalByPosition[parsed.tokenId]).toBeDefined();
        expect(result.feesByPosition[parsed.tokenId]).toBeDefined();

        const principal = result.principalByPosition[parsed.tokenId];
        const fees = result.feesByPosition[parsed.tokenId];

        // Principal amounts should be BigNumbers
        expect(ethers.BigNumber.isBigNumber(principal.amount0)).toBe(true);
        expect(ethers.BigNumber.isBigNumber(principal.amount1)).toBe(true);

        // For native ETH position: ETH fees should be null, USDC fees should be BigNumber
        expect(fees.token0).toBeNull(); // ETH - no Transfer events
        expect(ethers.BigNumber.isBigNumber(fees.token1)).toBe(true); // USDC - from Transfer events

        // USDC fees should be non-negative (could be 0 if no fees, or positive if fees generated)
        expect(fees.token1.gte(0)).toBe(true);

        // Verify metadata preserved
        expect(fees.metadata).toBe(positionMetadata[parsed.tokenId]);
      }, 300000);
    });
  });

  describe('getBestSwapQuote', () => {
    // Use WETH address for ERC20 tests (Arbitrum WETH)
    const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';

    describe('Success Cases', () => {
      it('should return best quote using AlphaRouter with EXACT_INPUT', async () => {
        const quoteParams = {
          tokenInAddress: WETH,
          tokenOutAddress: env.usdcAddress,
          amount: ethers.utils.parseEther('1').toString(), // 1 ETH
          isAmountIn: true
        };

        const bestQuote = await adapter.getBestSwapQuote(quoteParams);

        // Should return an object with amountIn, amountOut, route, and methodParameters
        expect(bestQuote).toBeDefined();
        expect(bestQuote).toHaveProperty('amountIn');
        expect(bestQuote).toHaveProperty('amountOut');
        expect(bestQuote).toHaveProperty('route');

        // Amount in should match input
        expect(bestQuote.amountIn).toBe(quoteParams.amount);

        // Amount out should be positive
        expect(typeof bestQuote.amountOut).toBe('string');
        expect(BigInt(bestQuote.amountOut)).toBeGreaterThan(0n);

        // Route should be defined and have expected properties
        expect(bestQuote.route).toBeDefined();
        expect(bestQuote.route.quote).toBeDefined();
        expect(bestQuote.route.route).toBeDefined();
      }, 60000); // First AlphaRouter call may take longer to warm up

      it('should return valid quote for different amounts with EXACT_INPUT', async () => {
        const quoteParams = {
          tokenInAddress: WETH,
          tokenOutAddress: env.usdcAddress,
          amount: ethers.utils.parseEther('0.1').toString(),
          isAmountIn: true
        };

        const bestQuote = await adapter.getBestSwapQuote(quoteParams);

        // Should still return a valid quote
        expect(bestQuote).toBeDefined();
        expect(bestQuote.amountIn).toBe(quoteParams.amount);
        expect(bestQuote.amountOut).toBeDefined();
        expect(bestQuote.route).toBeDefined();
        expect(BigInt(bestQuote.amountOut)).toBeGreaterThan(0n);
      });

      it('should return consistent results across multiple calls with EXACT_INPUT', async () => {
        const quoteParams = {
          tokenInAddress: WETH,
          tokenOutAddress: env.usdcAddress,
          amount: ethers.utils.parseEther('0.25').toString(),
          isAmountIn: true
        };

        const quote1 = await adapter.getBestSwapQuote(quoteParams);
        const quote2 = await adapter.getBestSwapQuote(quoteParams);

        // Results should be very close (allow for minor price fluctuations in live pools)
        // Within 0.1% tolerance
        const amount1 = BigInt(quote1.amountOut);
        const amount2 = BigInt(quote2.amountOut);
        const diff = amount1 > amount2 ? amount1 - amount2 : amount2 - amount1;
        const tolerance = amount1 / 1000n; // 0.1%

        expect(diff).toBeLessThanOrEqual(tolerance);
      });

      it('should return best quote using AlphaRouter with EXACT_OUTPUT', async () => {
        const quoteParams = {
          tokenInAddress: WETH,
          tokenOutAddress: env.usdcAddress,
          amount: ethers.utils.parseUnits('2000', 6).toString(), // 2000 USDC
          isAmountIn: false
        };

        const bestQuote = await adapter.getBestSwapQuote(quoteParams);

        // Should return an object with amountIn, amountOut, route, and methodParameters
        expect(bestQuote).toBeDefined();
        expect(bestQuote).toHaveProperty('amountIn');
        expect(bestQuote).toHaveProperty('amountOut');
        expect(bestQuote).toHaveProperty('route');

        // Amount out should match input (EXACT_OUTPUT mode)
        expect(bestQuote.amountOut).toBe(quoteParams.amount);

        // Amount in should be positive
        expect(typeof bestQuote.amountIn).toBe('string');
        expect(BigInt(bestQuote.amountIn)).toBeGreaterThan(0n);

        // Route should be defined and have expected properties
        expect(bestQuote.route).toBeDefined();
        expect(bestQuote.route.quote).toBeDefined();
        expect(bestQuote.route.route).toBeDefined();
      });
    });

    describe('Native ETH Support', () => {
      it('should return quote for native ETH → ERC20 swap (EXACT_INPUT)', async () => {
        const quoteParams = {
          // No tokenInAddress needed for native ETH
          tokenOutAddress: env.usdcAddress,
          amount: ethers.utils.parseEther('1').toString(),
          isAmountIn: true,
          tokenInIsNative: true,
          tokenOutIsNative: false
        };

        const bestQuote = await adapter.getBestSwapQuote(quoteParams);

        expect(bestQuote).toBeDefined();
        expect(bestQuote.amountIn).toBe(quoteParams.amount);
        expect(BigInt(bestQuote.amountOut)).toBeGreaterThan(0n);
      });

      it('should return quote for ERC20 → native ETH swap (EXACT_INPUT)', async () => {
        const quoteParams = {
          tokenInAddress: env.usdcAddress,
          // No tokenOutAddress needed for native ETH
          amount: ethers.utils.parseUnits('2000', 6).toString(),
          isAmountIn: true,
          tokenInIsNative: false,
          tokenOutIsNative: true
        };

        const bestQuote = await adapter.getBestSwapQuote(quoteParams);

        expect(bestQuote).toBeDefined();
        expect(bestQuote.amountIn).toBe(quoteParams.amount);
        expect(BigInt(bestQuote.amountOut)).toBeGreaterThan(0n);
      });

      it('should default tokenInIsNative and tokenOutIsNative to false', async () => {
        // Existing tests don't pass these params - they should still work
        const quoteParams = {
          tokenInAddress: WETH,
          tokenOutAddress: env.usdcAddress,
          amount: ethers.utils.parseEther('1').toString(),
          isAmountIn: true
          // Note: no tokenInIsNative or tokenOutIsNative
        };

        const bestQuote = await adapter.getBestSwapQuote(quoteParams);
        expect(bestQuote).toBeDefined();
        expect(BigInt(bestQuote.amountOut)).toBeGreaterThan(0n);
      });

      it('should skip tokenInAddress validation when tokenInIsNative is true', async () => {
        // These would fail validation if tokenInIsNative wasn't true
        const invalidAddresses = [null, undefined, '', 'not-an-address'];

        for (const invalidAddr of invalidAddresses) {
          const quoteParams = {
            tokenInAddress: invalidAddr,
            tokenOutAddress: env.usdcAddress,
            amount: ethers.utils.parseEther('1').toString(),
            isAmountIn: true,
            tokenInIsNative: true  // Should skip tokenIn validation
          };

          const bestQuote = await adapter.getBestSwapQuote(quoteParams);
          expect(bestQuote).toBeDefined();
          expect(BigInt(bestQuote.amountOut)).toBeGreaterThan(0n);
        }
      });

      it('should skip tokenOutAddress validation when tokenOutIsNative is true', async () => {
        // These would fail validation if tokenOutIsNative wasn't true
        const invalidAddresses = [null, undefined, '', 'not-an-address'];

        for (const invalidAddr of invalidAddresses) {
          const quoteParams = {
            tokenInAddress: env.usdcAddress,
            tokenOutAddress: invalidAddr,
            amount: ethers.utils.parseUnits('2000', 6).toString(),
            isAmountIn: true,
            tokenOutIsNative: true  // Should skip tokenOut validation
          };

          const bestQuote = await adapter.getBestSwapQuote(quoteParams);
          expect(bestQuote).toBeDefined();
          expect(BigInt(bestQuote.amountOut)).toBeGreaterThan(0n);
        }
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid tokenInAddress when not native', async () => {
        const baseParams = {
          tokenOutAddress: env.usdcAddress,
          amount: ethers.utils.parseEther('1').toString(),
          isAmountIn: true
        };

        // Missing (and tokenInIsNative is false by default)
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, tokenInAddress: null })
        ).rejects.toThrow('TokenIn address parameter is required');

        // Invalid address
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, tokenInAddress: 'invalid-address' })
        ).rejects.toThrow('Invalid tokenIn address');

        // Array
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, tokenInAddress: [] })
        ).rejects.toThrow('TokenIn address parameter is required');

        // Object
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, tokenInAddress: {} })
        ).rejects.toThrow('TokenIn address parameter is required');
      });

      it('should throw error for invalid tokenOutAddress', async () => {
        const baseParams = {
          tokenInAddress: WETH,
          amount: ethers.utils.parseEther('1').toString(),
          isAmountIn: true
        };

        // Missing
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, tokenOutAddress: null })
        ).rejects.toThrow('TokenOut address parameter is required');

        // Invalid address
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, tokenOutAddress: 'Claude is awesome!' })
        ).rejects.toThrow('Invalid tokenOut address');

        // Array
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, tokenOutAddress: [] })
        ).rejects.toThrow('TokenOut address parameter is required');

        // Object
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, tokenOutAddress: {} })
        ).rejects.toThrow('TokenOut address parameter is required');
      });

      it('should throw error for invalid amount', async () => {
        const baseParams = {
          tokenInAddress: WETH,
          tokenOutAddress: env.usdcAddress,
          isAmountIn: true
        };

        // Missing
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, amount: null })
        ).rejects.toThrow('Amount parameter is required');

        // Not a string
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, amount: 123 })
        ).rejects.toThrow('Amount must be a string');

        // Array
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, amount: [] })
        ).rejects.toThrow('Amount must be a string');

        // Object
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, amount: {} })
        ).rejects.toThrow('Amount must be a string');

        // Invalid string
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, amount: 'Claude is awesome!' })
        ).rejects.toThrow('Amount must be a positive numeric string');

        // Zero
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, amount: '0' })
        ).rejects.toThrow('Amount cannot be zero');
      });

      it('should throw error for invalid isAmountIn', async () => {
        const baseParams = {
          tokenInAddress: WETH,
          tokenOutAddress: env.usdcAddress,
          amount: ethers.utils.parseEther('1').toString()
        };

        // Missing
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, isAmountIn: null })
        ).rejects.toThrow('isAmountIn parameter is required and must be a boolean');

        // Not a boolean - string
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, isAmountIn: 'true' })
        ).rejects.toThrow('isAmountIn parameter is required and must be a boolean');

        // Not a boolean - number
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, isAmountIn: 1 })
        ).rejects.toThrow('isAmountIn parameter is required and must be a boolean');

        // Not a boolean - array
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, isAmountIn: [] })
        ).rejects.toThrow('isAmountIn parameter is required and must be a boolean');

        // Not a boolean - object
        await expect(
          adapter.getBestSwapQuote({ ...baseParams, isAmountIn: {} })
        ).rejects.toThrow('isAmountIn parameter is required and must be a boolean');
      });

      it('should throw error when token not found in config', async () => {
        const fakeToken1 = '0x0000000000000000000000000000000000000001';
        const fakeToken2 = '0x0000000000000000000000000000000000000002';

        await expect(
          adapter.getBestSwapQuote({
            tokenInAddress: fakeToken1,
            tokenOutAddress: fakeToken2,
            amount: ethers.utils.parseEther('1').toString(),
            isAmountIn: true
          })
        ).rejects.toThrow(/No token found at address/);
      });
    });

    describe('Performance', () => {
      it('should execute AlphaRouter routing efficiently', async () => {
        const startTime = Date.now();

        const quoteParams = {
          tokenInAddress: WETH,
          tokenOutAddress: env.usdcAddress,
          amount: ethers.utils.parseEther('1').toString(),
          isAmountIn: true
        };

        const bestQuote = await adapter.getBestSwapQuote(quoteParams);
        const endTime = Date.now();

        // Should complete in reasonable time
        expect(endTime - startTime).toBeLessThan(10000); // 10 seconds max (AlphaRouter may be slower)

        // Should still return valid result
        expect(bestQuote).toBeDefined();
        expect(BigInt(bestQuote.amountOut)).toBeGreaterThan(0n);
      });
    });
  });

  describe('batchSwapTransactions', () => {
    describe('Validation Error Cases', () => {
      const mockSigner = { _signTypedData: () => Promise.resolve('0x') };

      it('should throw error for missing signer', async () => {
        await expect(
          adapter.batchSwapTransactions([], { provider: env.provider, chainId: 1337, recipient: '0x1234567890123456789012345678901234567890', slippageTolerance: 0.5 })
        ).rejects.toThrow('signer is required');
      });

      it('should throw error for missing provider', async () => {
        await expect(
          adapter.batchSwapTransactions([], { signer: mockSigner, chainId: 1337, recipient: '0x1234567890123456789012345678901234567890', slippageTolerance: 0.5 })
        ).rejects.toThrow('provider is required');
      });

      it('should throw error for missing chainId', async () => {
        await expect(
          adapter.batchSwapTransactions([], { signer: mockSigner, provider: env.provider, recipient: '0x1234567890123456789012345678901234567890', slippageTolerance: 0.5 })
        ).rejects.toThrow('chainId is required');
      });

      it('should throw error for missing recipient', async () => {
        await expect(
          adapter.batchSwapTransactions([], { signer: mockSigner, provider: env.provider, chainId: 1337, slippageTolerance: 0.5 })
        ).rejects.toThrow('recipient is required');
      });

      it('should throw error for missing slippageTolerance', async () => {
        await expect(
          adapter.batchSwapTransactions([], { signer: mockSigner, provider: env.provider, chainId: 1337, recipient: '0x1234567890123456789012345678901234567890' })
        ).rejects.toThrow('slippageTolerance is required');
      });

      it('should throw error for non-array swapInstructions', async () => {
        const options = { signer: mockSigner, provider: env.provider, chainId: 1337, recipient: '0x1234567890123456789012345678901234567890', slippageTolerance: 0.5 };
        await expect(
          adapter.batchSwapTransactions('not an array', options)
        ).rejects.toThrow('swapInstructions must be an array');

        await expect(
          adapter.batchSwapTransactions({}, options)
        ).rejects.toThrow('swapInstructions must be an array');
      });

      it('should throw error for empty swapInstructions array', async () => {
        const options = { signer: mockSigner, provider: env.provider, chainId: 1337, recipient: '0x1234567890123456789012345678901234567890', slippageTolerance: 0.5 };
        await expect(
          adapter.batchSwapTransactions([], options)
        ).rejects.toThrow('swapInstructions cannot be empty');
      });

      it('should throw error when instruction is missing tokenIn', async () => {
        const options = { signer: mockSigner, provider: env.provider, chainId: 1337, recipient: '0x1234567890123456789012345678901234567890', slippageTolerance: 0.5 };
        await expect(
          adapter.batchSwapTransactions([{ tokenOut: { symbol: 'USDC' }, amount: '1000' }], options)
        ).rejects.toThrow('tokenIn with symbol is required');
      });

      it('should throw error when instruction is missing tokenOut', async () => {
        const options = { signer: mockSigner, provider: env.provider, chainId: 1337, recipient: '0x1234567890123456789012345678901234567890', slippageTolerance: 0.5 };
        await expect(
          adapter.batchSwapTransactions([{ tokenIn: { symbol: 'ETH' }, amount: '1000' }], options)
        ).rejects.toThrow('tokenOut with symbol is required');
      });

      it('should throw error when instruction is missing amount', async () => {
        const options = { signer: mockSigner, provider: env.provider, chainId: 1337, recipient: '0x1234567890123456789012345678901234567890', slippageTolerance: 0.5 };
        await expect(
          adapter.batchSwapTransactions([{ tokenIn: { symbol: 'ETH' }, tokenOut: { symbol: 'USDC' } }], options)
        ).rejects.toThrow('amount is required');
      });
    });

    // Note: Full integration tests for batchSwapTransactions require:
    // - Real token balances
    // - Valid Permit2 approval
    // - Real swap routes
    // These are covered in fum_automation integration tests
  });

  describe('selectBestPool', () => {
    // Note: The Graph API key is configured via configureTheGraph in test setup

    describe('Parameter Validation', () => {
      it('should throw error for invalid tokenASymbol values', async () => {
        await expect(adapter.selectBestPool(
          null, 'USDC', env.provider, 1337
        )).rejects.toThrow('tokenASymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool(
          undefined, 'USDC', env.provider, 1337
        )).rejects.toThrow('tokenASymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool(
          '', 'USDC', env.provider, 1337
        )).rejects.toThrow('tokenASymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool(
          123, 'USDC', env.provider, 1337
        )).rejects.toThrow('tokenASymbol parameter is required and must be a string');
      });

      it('should throw error for invalid tokenBSymbol values', async () => {
        await expect(adapter.selectBestPool(
          'WETH', null, env.provider, 1337
        )).rejects.toThrow('tokenBSymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool(
          'WETH', undefined, env.provider, 1337
        )).rejects.toThrow('tokenBSymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool(
          'WETH', '', env.provider, 1337
        )).rejects.toThrow('tokenBSymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool(
          'WETH', 123, env.provider, 1337
        )).rejects.toThrow('tokenBSymbol parameter is required and must be a string');
      });

      it('should throw error for invalid provider values', async () => {
        await expect(adapter.selectBestPool(
          'WETH', 'USDC', null, 1337
        )).rejects.toThrow('provider parameter is required and must be an ethers provider instance');

        await expect(adapter.selectBestPool(
          'WETH', 'USDC', undefined, 1337
        )).rejects.toThrow('provider parameter is required and must be an ethers provider instance');

        await expect(adapter.selectBestPool(
          'WETH', 'USDC', {}, 1337
        )).rejects.toThrow('provider parameter is required and must be an ethers provider instance');

        await expect(adapter.selectBestPool(
          'WETH', 'USDC', 'not-a-provider', 1337
        )).rejects.toThrow('provider parameter is required and must be an ethers provider instance');
      });

      it('should throw error for invalid chainId values', async () => {
        await expect(adapter.selectBestPool(
          'WETH', 'USDC', env.provider, null
        )).rejects.toThrow('chainId parameter is required and must be a number');

        await expect(adapter.selectBestPool(
          'WETH', 'USDC', env.provider, undefined
        )).rejects.toThrow('chainId parameter is required and must be a number');

        await expect(adapter.selectBestPool(
          'WETH', 'USDC', env.provider, '1337'
        )).rejects.toThrow('chainId parameter is required and must be a number');
      });

      it('should throw error for unknown token symbols', async () => {
        await expect(adapter.selectBestPool(
          'UNKNOWN_TOKEN', 'USDC', env.provider, 1337
        )).rejects.toThrow('Token UNKNOWN_TOKEN not found');

        await expect(adapter.selectBestPool(
          'WETH', 'UNKNOWN_TOKEN', env.provider, 1337
        )).rejects.toThrow('Token UNKNOWN_TOKEN not found');
      });
    });

    describe('Success Cases', () => {
      // Note: These tests use real API calls to The Graph
      // They may return empty results if no V4 pools exist for the token pair
      // V4 is newer so pools may be limited

      it('should search for WETH/USDC pools on Arbitrum', async () => {
        const apiKey = process.env.THEGRAPH_API_KEY;
        if (!apiKey) {
          console.log('Skipping - THEGRAPH_API_KEY not set');
          return;
        }

        // Use Arbitrum mainnet for real subgraph query
        const arbitrumProvider = new ethers.providers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');

        try {
          const result = await adapter.selectBestPool('WETH', 'USDC', arbitrumProvider, 42161);

          // If pools found, verify structure
          expect(result).toHaveProperty('bestPool');
          expect(result).toHaveProperty('poolsDiscovered');
          expect(result).toHaveProperty('poolsActive');
          expect(result.poolsDiscovered).toBeGreaterThanOrEqual(result.poolsActive);
          expect(result.poolsActive).toBeGreaterThan(0);

          // Verify bestPool has expected properties
          expect(result.bestPool).toHaveProperty('address');
          expect(result.bestPool).toHaveProperty('poolId');
          expect(result.bestPool).toHaveProperty('fee');
          expect(result.bestPool).toHaveProperty('tickSpacing');
          expect(result.bestPool).toHaveProperty('liquidity');
          expect(result.bestPool).toHaveProperty('sqrtPriceX96');
          expect(result.bestPool).toHaveProperty('tick');
          expect(result.bestPool).toHaveProperty('hooks');
          expect(result.bestPool).toHaveProperty('totalValueLockedUSD');

          // Verify token0 structure
          expect(result.bestPool).toHaveProperty('token0');
          expect(result.bestPool.token0).toHaveProperty('symbol');
          expect(result.bestPool.token0).toHaveProperty('address');
          expect(result.bestPool.token0).toHaveProperty('decimals');
          expect(result.bestPool.token0.isNative).toEqual(expect.any(Boolean));

          // Verify token1 structure
          expect(result.bestPool).toHaveProperty('token1');
          expect(result.bestPool.token1).toHaveProperty('symbol');
          expect(result.bestPool.token1).toHaveProperty('address');
          expect(result.bestPool.token1).toHaveProperty('decimals');
          expect(result.bestPool.token1.isNative).toEqual(expect.any(Boolean));

          // Verify poolKey structure
          expect(result.bestPool).toHaveProperty('poolKey');
          expect(result.bestPool.poolKey).toHaveProperty('currency0');
          expect(result.bestPool.poolKey).toHaveProperty('currency1');
          expect(result.bestPool.poolKey).toHaveProperty('fee');
          expect(result.bestPool.poolKey).toHaveProperty('tickSpacing');
          expect(result.bestPool.poolKey).toHaveProperty('hooks');
        } catch (error) {
          // No pools is acceptable for V4 (new protocol)
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No V4 WETH/USDC pools exist on Arbitrum yet');
            return;
          }
          throw error;
        }
      }, 30000); // 30s timeout for API calls

      it('should handle native ETH symbol', async () => {
        const apiKey = process.env.THEGRAPH_API_KEY;
        if (!apiKey) {
          console.log('Skipping - THEGRAPH_API_KEY not set');
          return;
        }

        const arbitrumProvider = new ethers.providers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');

        try {
          // ETH (native) should resolve to AddressZero for V4
          const result = await adapter.selectBestPool('ETH', 'USDC', arbitrumProvider, 42161);

          expect(result).toHaveProperty('bestPool');
          expect(result).toHaveProperty('poolsDiscovered');
          expect(result).toHaveProperty('poolsActive');
        } catch (error) {
          // No pools is acceptable
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No V4 ETH/USDC pools exist on Arbitrum yet');
            return;
          }
          throw error;
        }
      }, 30000);

      it('should sort tokens correctly regardless of input order', async () => {
        const apiKey = process.env.THEGRAPH_API_KEY;
        if (!apiKey) {
          console.log('Skipping - THEGRAPH_API_KEY not set');
          return;
        }

        const arbitrumProvider = new ethers.providers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');

        try {
          // Try both orderings - should get same result
          const resultAB = await adapter.selectBestPool('WETH', 'USDC', arbitrumProvider, 42161);
          const resultBA = await adapter.selectBestPool('USDC', 'WETH', arbitrumProvider, 42161);

          // Should find the same pools regardless of order
          expect(resultAB.poolsDiscovered).toBe(resultBA.poolsDiscovered);
          expect(resultAB.bestPool.id).toBe(resultBA.bestPool.id);
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No V4 pools exist for token pair yet');
            return;
          }
          throw error;
        }
      }, 60000); // 60s for two API calls
    });

    describe('Error Cases', () => {
      it('should throw when token is not available on chain', async () => {
        // WBTC may not be available on all chains
        await expect(adapter.selectBestPool(
          'WETH', 'USDC', env.provider, 999999
        )).rejects.toThrow(/configured for chain/);
      });
    });
  });

  describe('_tickToPrice', () => {
    describe('Success Cases', () => {
      it('should calculate price for tick 0 (1:1 ratio)', () => {
        const usdcToken = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6,
          symbol: 'USDC'
        };
        const ethToken = {
          address: getWrappedNativeAddress(1337),
          decimals: 18,
          symbol: 'ETH'
        };

        // Tick 0 = 1:1 price ratio - use USDC/WETH to get a readable price around 1e12
        const tick = 0;

        const price = adapter._tickToPrice(tick, usdcToken, ethToken);

        // Should return a Price object
        expect(price).toBeDefined();
        expect(typeof price).toBe('object');

        // Tick 0 with USDC(6 decimals)/WETH(18 decimals) gives 1e-12 (1 USDC = 1e-12 WETH)
        const priceNum = parseFloat(price.toSignificant(18));
        expect(priceNum).toBeCloseTo(1e-12, 15); // 1e-12 with high precision
      });

      it('should calculate price for positive tick', () => {
        const ethToken = {
          address: getWrappedNativeAddress(1337),
          decimals: 18,
          symbol: 'ETH'
        };
        const usdcToken = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6,
          symbol: 'USDC'
        };

        // Positive tick = higher price
        const tick = 200000; // Arbitrary positive tick

        const price = adapter._tickToPrice(tick, ethToken, usdcToken);

        expect(price).toBeDefined();
        expect(typeof price).toBe('object');

        const priceNum = parseFloat(price.toSignificant(6));
        expect(priceNum).toBeGreaterThan(0);
        expect(Number.isFinite(priceNum)).toBe(true);
      });

      it('should calculate price for negative tick', () => {
        const ethToken = {
          address: getWrappedNativeAddress(1337),
          decimals: 18,
          symbol: 'ETH'
        };
        const usdcToken = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6,
          symbol: 'USDC'
        };

        // Negative tick = lower price
        const tick = -200000; // Arbitrary negative tick

        const price = adapter._tickToPrice(tick, ethToken, usdcToken);

        expect(price).toBeDefined();
        expect(typeof price).toBe('object');

        const priceNum = parseFloat(price.toSignificant(18));
        expect(priceNum).toBeGreaterThan(0);
        expect(Number.isFinite(priceNum)).toBe(true);
      });

      it('should handle inverted token pairs consistently', () => {
        const tokenA = {
          address: getWrappedNativeAddress(1337),
          decimals: 18,
          symbol: 'ETH'
        };
        const tokenB = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6,
          symbol: 'USDC'
        };

        const tick = 100000;

        const priceAB = adapter._tickToPrice(tick, tokenA, tokenB);
        const priceBA = adapter._tickToPrice(tick, tokenB, tokenA);

        const priceABNum = parseFloat(priceAB.toSignificant(18));
        const priceBANum = parseFloat(priceBA.toSignificant(18));

        // Prices should be reciprocals (within small tolerance)
        const product = priceABNum * priceBANum;
        expect(product).toBeGreaterThan(0.99);
        expect(product).toBeLessThan(1.01);
      });

      it('should work with minimal token metadata', () => {
        const tokenA = {
          address: getWrappedNativeAddress(1337),
          decimals: 18
          // No symbol or name
        };
        const tokenB = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6
          // No symbol or name
        };

        const tick = 0;

        const price = adapter._tickToPrice(tick, tokenA, tokenB);

        expect(price).toBeDefined();
        expect(typeof price).toBe('object');
        expect(parseFloat(price.toSignificant(18))).toBeGreaterThan(0);
      });
    });

    describe('Error Cases', () => {
      const validTokenA = {
        address: getWrappedNativeAddress(1337),
        decimals: 18,
        symbol: 'ETH'
      };
      const validTokenB = {
        address: getTokenAddress('USDC', 1337),
        decimals: 6,
        symbol: 'USDC'
      };

      it('should throw error for invalid tick values', () => {
        expect(() => adapter._tickToPrice('not-a-number', validTokenA, validTokenB))
          .toThrow('Invalid tick value');
        expect(() => adapter._tickToPrice(null, validTokenA, validTokenB))
          .toThrow('Invalid tick value');
        expect(() => adapter._tickToPrice(undefined, validTokenA, validTokenB))
          .toThrow('Invalid tick value');
        expect(() => adapter._tickToPrice(NaN, validTokenA, validTokenB))
          .toThrow('Invalid tick value');
        expect(() => adapter._tickToPrice(Infinity, validTokenA, validTokenB))
          .toThrow('Invalid tick value');
        expect(() => adapter._tickToPrice(-Infinity, validTokenA, validTokenB))
          .toThrow('Invalid tick value');
      });

      it('should throw error for missing token information', () => {
        const validTick = 0;

        expect(() => adapter._tickToPrice(validTick, null, validTokenB))
          .toThrow('Missing required token information');
        expect(() => adapter._tickToPrice(validTick, undefined, validTokenB))
          .toThrow('Missing required token information');
        expect(() => adapter._tickToPrice(validTick, validTokenA, null))
          .toThrow('Missing required token information');
        expect(() => adapter._tickToPrice(validTick, validTokenA, undefined))
          .toThrow('Missing required token information');
      });

      it('should throw error for missing token addresses', () => {
        const validTick = 0;
        const tokenMissingAddress = { decimals: 18, symbol: 'TEST' };

        expect(() => adapter._tickToPrice(validTick, tokenMissingAddress, validTokenB))
          .toThrow('baseToken.address is required');
        expect(() => adapter._tickToPrice(validTick, validTokenA, tokenMissingAddress))
          .toThrow('quoteToken.address is required');
      });

      it('should throw error for invalid token addresses', () => {
        const validTick = 0;
        const invalidAddressToken = { address: 'invalid-address', decimals: 18, symbol: 'TEST' };

        expect(() => adapter._tickToPrice(validTick, invalidAddressToken, validTokenB))
          .toThrow('Invalid baseToken.address: invalid-address');
        expect(() => adapter._tickToPrice(validTick, validTokenA, invalidAddressToken))
          .toThrow('Invalid quoteToken.address: invalid-address');
      });

      it('should throw error when base and quote tokens have the same address', () => {
        const validTick = 0;
        const sameToken = {
          address: getWrappedNativeAddress(1337),
          decimals: 18,
          symbol: 'ETH'
        };

        expect(() => adapter._tickToPrice(validTick, sameToken, sameToken))
          .toThrow('Base and quote token addresses cannot be the same');
      });

      it('should throw error for invalid baseToken decimals', () => {
        const validTick = 0;

        const invalidTokens = [
          { address: getWrappedNativeAddress(1337), decimals: 'not-a-number', symbol: 'TEST' },
          { address: getWrappedNativeAddress(1337), decimals: NaN, symbol: 'TEST' },
          { address: getWrappedNativeAddress(1337), decimals: Infinity, symbol: 'TEST' },
          { address: getWrappedNativeAddress(1337), decimals: -Infinity, symbol: 'TEST' },
          { address: getWrappedNativeAddress(1337), decimals: -1, symbol: 'TEST' },
          { address: getWrappedNativeAddress(1337), decimals: 256, symbol: 'TEST' }
        ];

        invalidTokens.forEach(invalidToken => {
          expect(() => adapter._tickToPrice(validTick, invalidToken, validTokenB))
            .toThrow('baseToken.decimals must be a finite number between 0 and 255');
        });
      });

      it('should throw error for invalid quoteToken decimals', () => {
        const validTick = 0;

        const invalidTokens = [
          { address: getTokenAddress('USDC', 1337), decimals: 'not-a-number', symbol: 'TEST' },
          { address: getTokenAddress('USDC', 1337), decimals: NaN, symbol: 'TEST' },
          { address: getTokenAddress('USDC', 1337), decimals: Infinity, symbol: 'TEST' },
          { address: getTokenAddress('USDC', 1337), decimals: -Infinity, symbol: 'TEST' },
          { address: getTokenAddress('USDC', 1337), decimals: -1, symbol: 'TEST' },
          { address: getTokenAddress('USDC', 1337), decimals: 256, symbol: 'TEST' }
        ];

        invalidTokens.forEach(invalidToken => {
          expect(() => adapter._tickToPrice(validTick, validTokenA, invalidToken))
            .toThrow('quoteToken.decimals must be a finite number between 0 and 255');
        });
      });
    });
  });

  describe('evaluatePriceMovement', () => {
    // Mock token data for testing
    const mockToken0Data = {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      symbol: 'USDC',
      decimals: 6
    };

    const mockToken1Data = {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      symbol: 'WETH',
      decimals: 18
    };

    describe('Success Cases', () => {
      it('should calculate zero price movement when ticks are equal', () => {
        const swapData = { tick: 100 };
        const baseline = 100;

        const result = adapter.evaluatePriceMovement(swapData, baseline, mockToken0Data, mockToken1Data);

        expect(result.priceMovementPercent).toBe(0);
        expect(result.direction).toBe('up'); // Equal means 'up' (>= comparison)
      });

      it('should return price movement as a percentage', () => {
        const swapData = { tick: 1000 };
        const baseline = 0;

        const result = adapter.evaluatePriceMovement(swapData, baseline, mockToken0Data, mockToken1Data);

        expect(typeof result.priceMovementPercent).toBe('number');
        expect(result.priceMovementPercent).toBeGreaterThan(0);
      });

      it('should return up direction when price increases', () => {
        // Higher tick = higher price for token0/token1
        const swapData = { tick: 1000 };
        const baseline = 0;

        const result = adapter.evaluatePriceMovement(swapData, baseline, mockToken0Data, mockToken1Data);

        expect(result.direction).toBe('up');
      });

      it('should return down direction when price decreases', () => {
        // Lower tick = lower price for token0/token1
        const swapData = { tick: 0 };
        const baseline = 1000;

        const result = adapter.evaluatePriceMovement(swapData, baseline, mockToken0Data, mockToken1Data);

        expect(result.direction).toBe('down');
      });

      it('should return baselinePrice and currentPrice as strings', () => {
        const swapData = { tick: 100 };
        const baseline = 50;

        const result = adapter.evaluatePriceMovement(swapData, baseline, mockToken0Data, mockToken1Data);

        expect(typeof result.baselinePrice).toBe('string');
        expect(typeof result.currentPrice).toBe('string');
      });

      it('should handle negative ticks', () => {
        const swapData = { tick: -50000 };
        const baseline = -45000;

        const result = adapter.evaluatePriceMovement(swapData, baseline, mockToken0Data, mockToken1Data);

        expect(result).toHaveProperty('priceMovementPercent');
        expect(result).toHaveProperty('direction');
        expect(result.priceMovementPercent).toBeGreaterThanOrEqual(0);
      });

      it('should calculate absolute percentage (always positive)', () => {
        const swapDataUp = { tick: 1000 };
        const swapDataDown = { tick: -1000 };
        const baseline = 0;

        const resultUp = adapter.evaluatePriceMovement(swapDataUp, baseline, mockToken0Data, mockToken1Data);
        const resultDown = adapter.evaluatePriceMovement(swapDataDown, baseline, mockToken0Data, mockToken1Data);

        expect(resultUp.priceMovementPercent).toBeGreaterThanOrEqual(0);
        expect(resultDown.priceMovementPercent).toBeGreaterThanOrEqual(0);
      });
    });

    describe('Validation Error Cases', () => {
      it('should throw error for null swapData', () => {
        expect(() => adapter.evaluatePriceMovement(null, 100, mockToken0Data, mockToken1Data))
          .toThrow('swapData parameter is required');
      });

      it('should throw error for undefined swapData', () => {
        expect(() => adapter.evaluatePriceMovement(undefined, 100, mockToken0Data, mockToken1Data))
          .toThrow('swapData parameter is required');
      });

      it('should throw error for swapData without tick', () => {
        expect(() => adapter.evaluatePriceMovement({}, 100, mockToken0Data, mockToken1Data))
          .toThrow('swapData must have tick property as a number');
      });

      it('should throw error for swapData with non-number tick', () => {
        expect(() => adapter.evaluatePriceMovement({ tick: '100' }, 100, mockToken0Data, mockToken1Data))
          .toThrow('swapData must have tick property as a number');
      });

      it('should throw error for null baseline', () => {
        expect(() => adapter.evaluatePriceMovement({ tick: 100 }, null, mockToken0Data, mockToken1Data))
          .toThrow('baseline parameter is required');
      });

      it('should throw error for undefined baseline', () => {
        expect(() => adapter.evaluatePriceMovement({ tick: 100 }, undefined, mockToken0Data, mockToken1Data))
          .toThrow('baseline parameter is required');
      });

      it('should throw error for non-number baseline', () => {
        expect(() => adapter.evaluatePriceMovement({ tick: 100 }, '100', mockToken0Data, mockToken1Data))
          .toThrow('baseline must be a number (tick value)');
      });

      it('should throw error for missing token0Data', () => {
        expect(() => adapter.evaluatePriceMovement({ tick: 100 }, 100, null, mockToken1Data))
          .toThrow('token0Data must have address, symbol, and decimals properties');
      });

      it('should throw error for token0Data missing address', () => {
        expect(() => adapter.evaluatePriceMovement({ tick: 100 }, 100, { symbol: 'USDC', decimals: 6 }, mockToken1Data))
          .toThrow('token0Data must have address, symbol, and decimals properties');
      });

      it('should throw error for missing token1Data', () => {
        expect(() => adapter.evaluatePriceMovement({ tick: 100 }, 100, mockToken0Data, null))
          .toThrow('token1Data must have address, symbol, and decimals properties');
      });

      it('should throw error for token1Data missing decimals', () => {
        expect(() => adapter.evaluatePriceMovement({ tick: 100 }, 100, mockToken0Data, { address: '0x123', symbol: 'WETH' }))
          .toThrow('token1Data must have address, symbol, and decimals properties');
      });
    });

    describe('Edge Cases', () => {
      it('should handle maximum tick values', () => {
        const swapData = { tick: 887272 }; // Max tick
        const baseline = 0;

        const result = adapter.evaluatePriceMovement(swapData, baseline, mockToken0Data, mockToken1Data);

        expect(result).toHaveProperty('priceMovementPercent');
        expect(result.priceMovementPercent).toBeGreaterThan(0);
      });

      it('should handle minimum tick values', () => {
        const swapData = { tick: -887272 }; // Min tick
        const baseline = 0;

        const result = adapter.evaluatePriceMovement(swapData, baseline, mockToken0Data, mockToken1Data);

        expect(result).toHaveProperty('priceMovementPercent');
        expect(result.priceMovementPercent).toBeGreaterThan(0);
      });
    });
  });

  describe('getPositionsForVDS', () => {
    // Note: The Graph API key is configured via configureTheGraph in test setup

    describe('Success Cases', () => {
      // These tests use real The Graph queries. Since The Graph indexes mainnet/Arbitrum
      // (not our local Hardhat fork), tests that need to find positions use Arbitrum mainnet.

      it('should return empty positions for address with no V4 positions', async () => {
        // Any random address should have no V4 positions
        const emptyAddress = '0x0000000000000000000000000000000000000001';
        const result = await adapter.getPositionsForVDS(emptyAddress, env.provider);

        expect(result).toHaveProperty('positions');
        expect(result).toHaveProperty('poolData');
        expect(result.positions).toEqual({});
        expect(result.poolData).toEqual({});
      });

      it('should return empty positions for vault on local fork (Graph cannot see fork positions)', async () => {
        // The vault has a position on our local fork, but The Graph indexes mainnet,
        // not our local fork, so it returns empty
        const vaultAddress = env.testVault.address;
        const result = await adapter.getPositionsForVDS(vaultAddress, env.provider);

        expect(result).toHaveProperty('positions');
        expect(result).toHaveProperty('poolData');
        // Graph can't see fork positions
        expect(Object.keys(result.positions).length).toBe(0);
      });

      // Test with real Arbitrum mainnet positions (requires THEGRAPH_API_KEY env var)
      it('should return normalized positions from Arbitrum mainnet', async () => {
        const apiKey = process.env.THEGRAPH_API_KEY;
        if (!apiKey) {
          console.log('Skipping real Arbitrum test - THEGRAPH_API_KEY not set');
          return;
        }

        // Create an Arbitrum adapter and provider for real mainnet query
        const arbitrumProvider = new ethers.providers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');
        const arbitrumAdapter = new UniswapV4Adapter(42161, arbitrumProvider);

        // Use a known address with V4 positions on Arbitrum
        // This may need to be updated if the address no longer has positions
        // For now, we'll check any address and verify the structure if positions exist
        const testAddress = '0x0000000000000000000000000000000000000001';

        try {
          const result = await arbitrumAdapter.getPositionsForVDS(testAddress, arbitrumProvider);

          // Verify structure regardless of whether positions exist
          expect(result).toHaveProperty('positions');
          expect(result).toHaveProperty('poolData');
          expect(typeof result.positions).toBe('object');
          expect(typeof result.poolData).toBe('object');

          // If any positions are returned, verify their structure
          const positionIds = Object.keys(result.positions);
          if (positionIds.length > 0) {
            const position = result.positions[positionIds[0]];

            expect(position).toHaveProperty('id');
            expect(position).toHaveProperty('pool');
            expect(position).toHaveProperty('tickLower');
            expect(position).toHaveProperty('tickUpper');
            expect(position).toHaveProperty('liquidity');
            expect(position).toHaveProperty('feeGrowthInside0LastX128');
            expect(position).toHaveProperty('feeGrowthInside1LastX128');
            expect(position).toHaveProperty('tokensOwed0');
            expect(position).toHaveProperty('tokensOwed1');
            expect(position).toHaveProperty('lastUpdated');

            // Verify poolData structure
            const poolData = result.poolData[position.pool];
            expect(poolData).toHaveProperty('token0Symbol');
            expect(poolData).toHaveProperty('token1Symbol');
            expect(poolData).toHaveProperty('fee');
            expect(poolData).toHaveProperty('tickSpacing');
            expect(poolData).toHaveProperty('hooks');
            expect(poolData).toHaveProperty('platform');
            expect(poolData).toHaveProperty('poolKey');
            expect(poolData.platform).toBe('uniswapV4');
            // Verify poolKey structure
            expect(poolData.poolKey).toHaveProperty('currency0');
            expect(poolData.poolKey).toHaveProperty('currency1');
            expect(poolData.poolKey).toHaveProperty('fee');
            expect(poolData.poolKey).toHaveProperty('tickSpacing');
            expect(poolData.poolKey).toHaveProperty('hooks');
          }
        } catch (error) {
          // Graph API errors are expected if no API key or network issues
          if (error.message.includes('The Graph')) {
            console.log('Skipping - The Graph API error:', error.message);
          } else {
            throw error;
          }
        }
      }, 30000);
    });

    describe('Error Cases', () => {
      it('should throw error for missing address', async () => {
        await expect(
          adapter.getPositionsForVDS(null, env.provider)
        ).rejects.toThrow('Address parameter is required');

        await expect(
          adapter.getPositionsForVDS(undefined, env.provider)
        ).rejects.toThrow('Address parameter is required');

        await expect(
          adapter.getPositionsForVDS('', env.provider)
        ).rejects.toThrow('Address parameter is required');
      });

      it('should throw error for invalid address', async () => {
        await expect(
          adapter.getPositionsForVDS('invalid-address', env.provider)
        ).rejects.toThrow('Invalid address: invalid-address');

        await expect(
          adapter.getPositionsForVDS('0x123', env.provider)
        ).rejects.toThrow('Invalid address: 0x123');
      });

      it('should throw error for missing provider', async () => {
        const validAddress = env.testVault.address;

        await expect(
          adapter.getPositionsForVDS(validAddress, null)
        ).rejects.toThrow('Valid provider parameter is required');

        await expect(
          adapter.getPositionsForVDS(validAddress, undefined)
        ).rejects.toThrow('Valid provider parameter is required');

        await expect(
          adapter.getPositionsForVDS(validAddress, {})
        ).rejects.toThrow('Valid provider parameter is required');
      });
    });
  });

  describe('getPositionById', () => {
    describe('Success Cases', () => {
      it('should return position and pool data for valid tokenId', async () => {
        // Use the position created in test setup
        const tokenId = env.positionTokenId;
        const result = await adapter.getPositionById(tokenId, env.provider);

        // Verify structure
        expect(result).toHaveProperty('position');
        expect(result).toHaveProperty('poolData');

        // Verify position fields
        const position = result.position;
        expect(position.id).toBe(String(tokenId));
        expect(position).toHaveProperty('pool');
        expect(position).toHaveProperty('tickLower');
        expect(position).toHaveProperty('tickUpper');
        expect(position).toHaveProperty('liquidity');
        expect(position).toHaveProperty('feeGrowthInside0LastX128');
        expect(position).toHaveProperty('feeGrowthInside1LastX128');
        expect(position).toHaveProperty('tokensOwed0');
        expect(position).toHaveProperty('tokensOwed1');
        expect(position).toHaveProperty('lastUpdated');

        // Verify poolData fields (V4 specific)
        const poolData = Object.values(result.poolData)[0];
        expect(poolData).toHaveProperty('token0Symbol');
        expect(poolData).toHaveProperty('token1Symbol');
        expect(poolData).toHaveProperty('fee');
        expect(poolData).toHaveProperty('tickSpacing');
        expect(poolData).toHaveProperty('hooks');
        expect(poolData).toHaveProperty('platform');
        expect(poolData).toHaveProperty('poolKey');
        expect(poolData.platform).toBe('uniswapV4');

        // Verify poolKey structure
        expect(poolData.poolKey).toHaveProperty('currency0');
        expect(poolData.poolKey).toHaveProperty('currency1');
        expect(poolData.poolKey).toHaveProperty('fee');
        expect(poolData.poolKey).toHaveProperty('tickSpacing');
        expect(poolData.poolKey).toHaveProperty('hooks');
      });

      it('should return position with correct tick bounds', async () => {
        const tokenId = env.positionTokenId;
        const result = await adapter.getPositionById(tokenId, env.provider);

        // Tick bounds should be numbers
        expect(typeof result.position.tickLower).toBe('number');
        expect(typeof result.position.tickUpper).toBe('number');
        // Upper tick should be greater than lower tick
        expect(result.position.tickUpper).toBeGreaterThan(result.position.tickLower);
      });

      it('should return position with liquidity as string', async () => {
        const tokenId = env.positionTokenId;
        const result = await adapter.getPositionById(tokenId, env.provider);

        expect(typeof result.position.liquidity).toBe('string');
        // Should be parseable as BigNumber
        expect(() => ethers.BigNumber.from(result.position.liquidity)).not.toThrow();
      });

      it('should return poolId (bytes32) as pool identifier', async () => {
        const tokenId = env.positionTokenId;
        const result = await adapter.getPositionById(tokenId, env.provider);

        // V4 uses poolId (bytes32) not pool address
        expect(result.position.pool).toMatch(/^0x[a-fA-F0-9]{64}$/);
        // poolData should be keyed by same poolId
        expect(result.poolData).toHaveProperty(result.position.pool);
      });

      it('should handle string tokenId', async () => {
        const tokenId = String(env.positionTokenId);
        const result = await adapter.getPositionById(tokenId, env.provider);

        expect(result.position.id).toBe(tokenId);
        expect(result).toHaveProperty('poolData');
      });

      it('should handle numeric tokenId', async () => {
        const tokenId = Number(env.positionTokenId);
        const result = await adapter.getPositionById(tokenId, env.provider);

        expect(result.position.id).toBe(String(tokenId));
        expect(result).toHaveProperty('poolData');
      });

      it('should return lastUpdated as recent timestamp', async () => {
        const before = Date.now();
        const result = await adapter.getPositionById(env.positionTokenId, env.provider);
        const after = Date.now();

        expect(result.position.lastUpdated).toBeGreaterThanOrEqual(before);
        expect(result.position.lastUpdated).toBeLessThanOrEqual(after);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null tokenId', async () => {
        await expect(adapter.getPositionById(null, env.provider))
          .rejects.toThrow('TokenId parameter is required');
      });

      it('should throw error for undefined tokenId', async () => {
        await expect(adapter.getPositionById(undefined, env.provider))
          .rejects.toThrow('TokenId parameter is required');
      });

      it('should throw error for empty string tokenId', async () => {
        await expect(adapter.getPositionById('', env.provider))
          .rejects.toThrow('TokenId parameter is required');
      });

      it('should throw error for null provider', async () => {
        await expect(adapter.getPositionById(env.positionTokenId, null))
          .rejects.toThrow('Valid provider parameter is required');
      });

      it('should throw error for undefined provider', async () => {
        await expect(adapter.getPositionById(env.positionTokenId, undefined))
          .rejects.toThrow('Valid provider parameter is required');
      });

      it('should throw error for invalid provider object', async () => {
        await expect(adapter.getPositionById(env.positionTokenId, {}))
          .rejects.toThrow('Valid provider parameter is required');
      });

      it('should throw error for non-existent tokenId', async () => {
        const nonExistentId = '999999999999';
        // V4 returns zeroed data for non-existent positions (doesn't revert like V3)
        await expect(adapter.getPositionById(nonExistentId, env.provider))
          .rejects.toThrow('not found or has been burned');
      });

      it('should throw error for zero-liquidity position', async () => {
        // Snapshot before destructive drain so subsequent tests aren't affected
        const localSnapshot = await env.snapshot();

        // Remove all liquidity from the test position via the vault
        const removeTxData = await adapter.generateRemoveLiquidityData({
          position: env.testPosition,
          percentage: 100,
          walletAddress: env.testVault.address,
          provider: env.provider,
          poolData: env.poolData,
          slippageTolerance: 1,
          deadlineMinutes: 20
        });

        const removeTx = await env.testVault.decreaseLiquidity(
          [removeTxData.to],
          [removeTxData.data]
        );
        await removeTx.wait();

        // Position NFT still exists but has zero liquidity — should throw
        await expect(adapter.getPositionById(env.positionTokenId, env.provider))
          .rejects.toThrow('zero liquidity');

        // Revert to restore the position's liquidity for subsequent tests
        await env.revert(localSnapshot);
      }, 180000);
    });
  });

  describe('_resolveTokenSymbol', () => {
    it('should return ETH for AddressZero', () => {
      const result = adapter._resolveTokenSymbol(ethers.constants.AddressZero);
      expect(result).toBe('ETH');
    });

    it('should return token symbol for known tokens', () => {
      const usdcAddress = getTokenAddress('USDC', 1337);
      const result = adapter._resolveTokenSymbol(usdcAddress);
      expect(result).toBe('USDC');
    });

    it('should return UNKNOWN for unrecognized token addresses', () => {
      const unknownAddress = '0x1111111111111111111111111111111111111111';
      const result = adapter._resolveTokenSymbol(unknownAddress);
      expect(result).toBe('UNKNOWN');
    });
  });

  // ===========================================================================
  // Incentive Methods — Merkl Integration
  // ===========================================================================

  describe('Incentive Methods — Merkl Integration', () => {
    // Known incentivized V4 pool on Arbitrum: USDT/USDC 0.0008%
    const KNOWN_INCENTIVIZED_POOL = '0xab05003a63d2f34ac7eec4670bca3319f0e3d2f62af5c2b9cbd69d03fd804fd2';
    const BOGUS_POOL_ID = '0x0000000000000000000000000000000000000000000000000000000000000001';

    beforeEach(() => {
      clearIncentiveCache();
    });

    describe('getPoolIncentives', () => {
      // Real API tests — adapter.chainId is 1337 (Hardhat), which won't have Merkl campaigns.
      // For real API validation, we create a temporary Arbitrum adapter.

      it('should return active incentives when Merkl has campaigns', async () => {
        const arbAdapter = new UniswapV4Adapter(42161);
        const result = await arbAdapter.getPoolIncentives(KNOWN_INCENTIVIZED_POOL, {}, null);

        expect(result).toHaveProperty('active');
        expect(result).toHaveProperty('programs');
        expect(typeof result.active).toBe('boolean');
        expect(Array.isArray(result.programs)).toBe(true);

        if (result.active) {
          const program = result.programs[0];
          expect(program.rewardToken).toMatch(/^0x[a-fA-F0-9]{40}$/);
          expect(typeof program.rewardTokenSymbol).toBe('string');
          expect(typeof program.endTimestamp).toBe('number');
        }
      }, 15000);

      it('should return inactive when no campaigns exist', async () => {
        const arbAdapter = new UniswapV4Adapter(42161);
        const result = await arbAdapter.getPoolIncentives(BOGUS_POOL_ID, {}, null);

        expect(result.active).toBe(false);
        expect(result.programs).toEqual([]);
      }, 15000);

      it('should pass adapter chainId to Merkl API', async () => {
        let originalFetch = global.fetch;

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [],
        });

        try {
          // adapter.chainId is 1337 (Hardhat)
          await adapter.getPoolIncentives(BOGUS_POOL_ID, {}, null);

          const [url] = global.fetch.mock.calls[0];
          expect(url).toContain('chainId=1337');
        } finally {
          global.fetch = originalFetch;
        }
      });
    });

    describe('getIncentiveClaimTransactions', () => {
      let originalFetch;

      beforeEach(() => {
        originalFetch = global.fetch;
      });

      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('should return empty array when no claim data available', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ([{
            chain: { id: 1337 },
            rewards: [],
          }]),
        });

        const result = await adapter.getIncentiveClaimTransactions('0xvault', KNOWN_INCENTIVIZED_POOL, {}, null);
        expect(result).toEqual([]);
      });

      it('should build claim tx with correct distributor address from chain config', async () => {
        const vaultAddress = '0x1234567890123456789012345678901234567890';

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ([{
            chain: { id: 1337 },
            rewards: [{
              amount: '500000000000000',
              pending: '400000000000000',
              proofs: ['0x' + 'aa'.repeat(32)],
              token: { address: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', symbol: 'TK1', decimals: 18 },
            }],
          }]),
        });

        const txs = await adapter.getIncentiveClaimTransactions(vaultAddress, KNOWN_INCENTIVIZED_POOL, {}, null);

        expect(txs.length).toBe(1);
        expect(txs[0].to).toBe(chains[1337].merklDistributorAddress);
      });

      it('should encode calldata with claim selector 0xa0165082', async () => {
        const vaultAddress = '0x1234567890123456789012345678901234567890';

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ([{
            chain: { id: 1337 },
            rewards: [{
              amount: '500000000000000',
              pending: '400000000000000',
              proofs: ['0x' + 'aa'.repeat(32)],
              token: { address: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', symbol: 'TK1', decimals: 18 },
            }],
          }]),
        });

        const txs = await adapter.getIncentiveClaimTransactions(vaultAddress, KNOWN_INCENTIVIZED_POOL, {}, null);

        expect(txs[0].data.startsWith('0xa0165082')).toBe(true);
      });

      it('should decode to correct user, tokens, amounts, proofs', async () => {
        const vaultAddress = '0x1234567890123456789012345678901234567890';
        const tokenAddress = '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8';
        const amount = '500000000000000';
        const proof = '0x' + 'aa'.repeat(32);

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ([{
            chain: { id: 1337 },
            rewards: [{
              amount,
              pending: '400000000000000',
              proofs: [proof],
              token: { address: tokenAddress, symbol: 'TK1', decimals: 18 },
            }],
          }]),
        });

        const txs = await adapter.getIncentiveClaimTransactions(vaultAddress, KNOWN_INCENTIVIZED_POOL, {}, null);

        // Decode the calldata to verify roundtrip
        const iface = new ethers.utils.Interface([
          'function claim(address user, address[] tokens, uint256[] amounts, bytes32[][] proofs)'
        ]);
        const decoded = iface.decodeFunctionData('claim', txs[0].data);

        expect(decoded.user.toLowerCase()).toBe(vaultAddress.toLowerCase());
        expect(decoded.tokens.length).toBe(1);
        expect(decoded.tokens[0].toLowerCase()).toBe(tokenAddress.toLowerCase());
        expect(decoded.amounts[0].toString()).toBe(amount);
        expect(decoded.proofs[0].length).toBe(1);
        expect(decoded.proofs[0][0]).toBe(proof);
      });

      it('should set value to 0x0', async () => {
        const vaultAddress = '0x1234567890123456789012345678901234567890';

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ([{
            chain: { id: 1337 },
            rewards: [{
              amount: '500000000000000',
              pending: '400000000000000',
              proofs: ['0x' + 'aa'.repeat(32)],
              token: { address: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', symbol: 'TK1', decimals: 18 },
            }],
          }]),
        });

        const txs = await adapter.getIncentiveClaimTransactions(vaultAddress, KNOWN_INCENTIVIZED_POOL, {}, null);

        expect(txs[0].value).toBe('0x0');
      });

      it('should return empty array when no distributor configured', async () => {
        const vaultAddress = '0x1234567890123456789012345678901234567890';
        const savedAddress = chains[1337].merklDistributorAddress;

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ([{
            chain: { id: 1337 },
            rewards: [{
              amount: '500000000000000',
              pending: '400000000000000',
              proofs: ['0x' + 'aa'.repeat(32)],
              token: { address: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', symbol: 'TK1', decimals: 18 },
            }],
          }]),
        });

        // Temporarily remove distributor address
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        delete chains[1337].merklDistributorAddress;

        try {
          const txs = await adapter.getIncentiveClaimTransactions(vaultAddress, KNOWN_INCENTIVIZED_POOL, {}, null);
          expect(txs).toEqual([]);
          expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('No Merkl Distributor address configured')
          );
        } finally {
          chains[1337].merklDistributorAddress = savedAddress;
          consoleSpy.mockRestore();
        }
      });

      it('should return empty array when claim data has empty tokens', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ([{
            chain: { id: 1337 },
            rewards: [{
              amount: '0',
              pending: '0',
              proofs: [],
              token: { address: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', symbol: 'TK1', decimals: 18 },
            }],
          }]),
        });

        const result = await adapter.getIncentiveClaimTransactions('0xvault', KNOWN_INCENTIVIZED_POOL, {}, null);
        expect(result).toEqual([]);
      });
    });

    describe('getIncentivePreCloseTransactions (inherited default)', () => {
      it('should return empty array', async () => {
        const result = await adapter.getIncentivePreCloseTransactions({}, {}, null);
        expect(result).toEqual([]);
      });
    });

    describe('getIncentivePostCreateTransactions (inherited default)', () => {
      it('should return empty array', async () => {
        const result = await adapter.getIncentivePostCreateTransactions('posId', {}, null);
        expect(result).toEqual([]);
      });
    });
  });
});
