/**
 * UniswapV3Adapter Unit Tests
 *
 * Tests using Ganache fork of Arbitrum - no mocks, real blockchain interactions.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import { setupTestEnvironment } from '../../test-env.js';
import UniswapV3Adapter from '../../../src/adapters/UniswapV3Adapter.js';
import chains from '../../../src/configs/chains.js';
import { getTokenBySymbol, getTokenAddress } from '../../../src/helpers/tokenHelpers.js';

describe('UniswapV3Adapter - Unit Tests', () => {
  let env;
  let adapter;
  let snapshotId;

  beforeAll(async () => {
    try {
      // Setup test environment with Ganache fork and full deployment for contract testing
      env = await setupTestEnvironment({
        deployContracts: true, // Need deployed contracts for gas estimation tests
        syncBytecode: true, // Sync bytecode from FUM project
      });

      // Create adapter instance using chainId from provider
      const network = await env.provider.getNetwork();
      adapter = new UniswapV3Adapter(Number(network.chainId));

      console.log('Ganache test environment started successfully');
      console.log('Provider URL:', env.provider.connection?.url || 'Local provider');
      console.log('Chain ID:', await env.provider.getNetwork().then(n => n.chainId));
      console.log('Running tests...');

    } catch (error) {
      console.error('Failed to setup test environment:', error);
      throw error;
    }
  }, 120000); // 2 minute timeout for setup

  afterAll(async () => {
    if (env && env.teardown) {
      await env.teardown();
    }
  });

  beforeEach(async () => {
    // Take a snapshot before each test
    if (env && env.snapshot) {
      try {
        snapshotId = await env.snapshot();
      } catch (error) {
        console.warn('Failed to create snapshot:', error.message);
        snapshotId = null;
      }
    }
  });

  afterEach(async () => {
    // Revert to snapshot after each test
    if (env && env.revert && snapshotId) {
      try {
        await env.revert(snapshotId);
      } catch (error) {
        console.warn('Failed to revert snapshot:', error.message);
      }
      snapshotId = null; // Clear snapshot ID after use
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
    describe('Success Cases', () => {
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

    describe('Invalid Type Cases', () => {
      it('should throw error for null chainId', () => {
        expect(() => new UniswapV3Adapter(null)).toThrow('chainId must be a valid number');
      });

      it('should throw error for undefined chainId', () => {
        expect(() => new UniswapV3Adapter(undefined)).toThrow('chainId must be a valid number');
      });

      it('should throw error for string chainId', () => {
        expect(() => new UniswapV3Adapter('1337')).toThrow('chainId must be a valid number');
      });
    });

    describe('Special Cases', () => {
      it('should throw error for NaN chainId', () => {
        expect(() => new UniswapV3Adapter(NaN)).toThrow('chainId must be a valid number');
      });

      it('should throw error for Infinity chainId', () => {
        expect(() => new UniswapV3Adapter(Infinity)).toThrow('Uniswap V3 not available on chain Infinity');
      });

      it('should throw error for -Infinity chainId', () => {
        expect(() => new UniswapV3Adapter(-Infinity)).toThrow('Uniswap V3 not available on chain -Infinity');
      });
    });

    describe('Error Cases', () => {
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

    describe('Error Cases', () => {
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

      it('should throw error for object', () => {
        expect(() => adapter._validateSlippageTolerance({})).toThrow('Invalid slippage tolerance: [object Object]. Must be between 0 and 100.');
      });
    });

    describe('Special Cases', () => {
      it('should throw error for NaN', () => {
        expect(() => adapter._validateSlippageTolerance(NaN)).toThrow('Invalid slippage tolerance: NaN. Must be between 0 and 100.');
      });

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
    });

    describe('Invalid Type Cases', () => {
      it('should throw error for string type', () => {
        expect(() => adapter._createDeadline("5")).toThrow('Invalid deadline minutes: 5. Must be a non-negative number.');
      });

      it('should throw error for null', () => {
        expect(() => adapter._createDeadline(null)).toThrow('Invalid deadline minutes: null. Must be a non-negative number.');
      });

      it('should throw error for undefined', () => {
        expect(() => adapter._createDeadline(undefined)).toThrow('Invalid deadline minutes: undefined. Must be a non-negative number.');
      });

      it('should throw error for object', () => {
        expect(() => adapter._createDeadline({})).toThrow('Invalid deadline minutes: [object Object]. Must be a non-negative number.');
      });
    });

    describe('Special Cases', () => {
      it('should throw error for NaN', () => {
        expect(() => adapter._createDeadline(NaN)).toThrow('Invalid deadline minutes: NaN. Must be a non-negative number.');
      });

      it('should throw error for Infinity', () => {
        expect(() => adapter._createDeadline(Infinity)).toThrow('Invalid deadline minutes: Infinity. Must be a non-negative number.');
      });

      it('should throw error for -Infinity', () => {
        expect(() => adapter._createDeadline(-Infinity)).toThrow('Invalid deadline minutes: -Infinity. Must be a non-negative number.');
      });

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

  describe('_estimateGas', () => {
    let poolContract;
    let wethContract;
    let positionManagerContract;

    beforeAll(async () => {
      try {
        // Check if environment is still available
        if (!env || !env.provider) {
          console.warn('Test environment not available, skipping contract setup');
          return;
        }

        // Test provider connectivity before using it
        await env.provider.getNetwork();

        // Get token data using helpers
        const usdcToken = getTokenBySymbol('USDC');
        const wethToken = getTokenBySymbol('WETH');

        // Create real contract instances using addresses from adapter config
        const poolAddress = await adapter.getPoolAddress(
          usdcToken.addresses[1337],
          wethToken.addresses[1337],
          500,
          env.provider
        );
        poolContract = new ethers.Contract(
          poolAddress,
          adapter.uniswapV3PoolABI,
          env.provider
        );

        wethContract = new ethers.Contract(
          wethToken.addresses[1337],
          adapter.erc20ABI,
          env.provider
        );

        positionManagerContract = new ethers.Contract(
          adapter.addresses.positionManagerAddress,
          adapter.nonfungiblePositionManagerABI,
          env.provider
        );
      } catch (error) {
        console.warn('Failed to setup contracts for _estimateGas tests:', error.message);
        // Gracefully skip setup if provider is unavailable
      }
    });

    describe('Success Cases', () => {
      it('should estimate gas for view function', async () => {
        // slot0 is a view function that still has gas cost
        const gasEstimate = await adapter._estimateGas(
          poolContract,
          'slot0',
          [] // no arguments
        );

        expect(gasEstimate).toBeTypeOf('number');
        expect(gasEstimate).toBeGreaterThan(0);
        // View functions should be relatively cheap
        expect(gasEstimate).toBeLessThan(100000);
      });

      it('should estimate gas for state-changing function with arguments', async () => {
        const spender = adapter.addresses.routerAddress;
        const amount = ethers.parseEther('1');

        const gasEstimate = await adapter._estimateGas(
          wethContract,
          'approve',
          [spender, amount],
          { from: env.signers[0].address } // overrides - use address with WETH balance
        );

        expect(gasEstimate).toBeTypeOf('number');
        expect(gasEstimate).toBeGreaterThan(0);
        expect(gasEstimate).toBeLessThan(200000); // Approvals typically under 200k
      });

      it('should handle empty args array', async () => {
        const gasEstimate = await adapter._estimateGas(
          poolContract,
          'slot0',
          []
        );

        expect(gasEstimate).toBeTypeOf('number');
        expect(gasEstimate).toBeGreaterThan(0);
      });

      it('should handle overrides parameter', async () => {
        const gasEstimate = await adapter._estimateGas(
          poolContract,
          'slot0',
          [],
          { from: env.signers[0].address } // Override 'from' address
        );

        expect(gasEstimate).toBeTypeOf('number');
        expect(gasEstimate).toBeGreaterThan(0);
      });

      it('should return raw gas estimate without buffer', async () => {
        // Verify the method returns raw estimates, no buffer applied
        const gasEstimate1 = await adapter._estimateGas(
          poolContract,
          'slot0',
          []
        );

        const gasEstimate2 = await adapter._estimateGas(
          poolContract,
          'slot0',
          []
        );

        // Same method call should return same estimate (no buffer variation)
        expect(gasEstimate1).toBe(gasEstimate2);
        expect(gasEstimate1).toBeTypeOf('number');
        expect(gasEstimate1).toBeGreaterThan(0);
      });
    });

    describe('Invalid Type Cases', () => {
      it('should throw error for invalid contract', async () => {
        await expect(
          adapter._estimateGas(null, 'slot0', [])
        ).rejects.toThrow('Invalid contract instance');
      });

      it('should throw error for invalid method name', async () => {
        await expect(
          adapter._estimateGas(poolContract, '', [])
        ).rejects.toThrow('Method must be a non-empty string');
      });

      it('should throw error for invalid args', async () => {
        await expect(
          adapter._estimateGas(poolContract, 'slot0', 'not-an-array')
        ).rejects.toThrow('Args must be an array');
      });

      it('should throw error for invalid overrides', async () => {
        await expect(
          adapter._estimateGas(poolContract, 'slot0', [], 'invalid-overrides')
        ).rejects.toThrow('Overrides must be an object if provided');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for non-existent method', async () => {
        await expect(
          adapter._estimateGas(poolContract, 'nonExistentMethod', [])
        ).rejects.toThrow("Method 'nonExistentMethod' does not exist or cannot estimate gas");
      });

      it('should throw descriptive error when gas estimation fails', async () => {
        // Try to estimate gas for a transaction that will fail
        // Approve with insufficient balance should still estimate (approvals don't check balance)
        // So let's use a method that will actually fail estimation
        await expect(
          adapter._estimateGas(
            positionManagerContract,
            'positions',
            [999999999] // Non-existent position ID
          )
        ).rejects.toThrow('Gas estimation failed for positions');
      });
    });
  });

  describe('_estimateGasFromTxData', () => {
    let signer;
    let wethContract;
    let usdcContract;

    beforeAll(async () => {
      try {
        // Check if environment is still available
        if (!env || !env.provider) {
          console.warn('Test environment not available, skipping contract setup');
          return;
        }

        // Get signer from test environment
        signer = env.signers[0];

        // Get token data using helpers
        const wethToken = getTokenBySymbol('WETH');
        const usdcToken = getTokenBySymbol('USDC');

        // Create contract instances for building transaction data
        wethContract = new ethers.Contract(
          wethToken.addresses[1337],
          adapter.erc20ABI,
          env.provider
        );

        usdcContract = new ethers.Contract(
          usdcToken.addresses[1337],
          adapter.erc20ABI,
          env.provider
        );
      } catch (error) {
        console.warn('Failed to setup contracts for _estimateGasFromTxData tests:', error.message);
      }
    });

    describe('Success Cases', () => {
      it('should estimate gas for ETH transfer transaction', async () => {
        const txData = {
          to: env.signers[1].address,
          value: ethers.parseEther('0.1'),
          data: '0x' // Empty data for simple ETH transfer
        };

        const gasEstimate = await adapter._estimateGasFromTxData(signer, txData);

        expect(gasEstimate).toBeTypeOf('number');
        expect(gasEstimate).toBeGreaterThan(0);
        // ETH transfers should be exactly 21000 gas
        expect(gasEstimate).toBe(21000);
      });

      it('should estimate gas for ERC20 transfer transaction', async () => {
        // Test vault.execute() calling USDC.transfer() - the actual usage pattern
        const recipient = env.signers[1].address;
        const amount = ethers.parseUnits('100', 6); // 100 USDC
        const transferData = usdcContract.interface.encodeFunctionData('transfer', [recipient, amount]);

        // Encode call to vault's execute function
        const vaultExecuteData = env.testVault.interface.encodeFunctionData('execute', [
          [usdcContract.target], // targets array
          [transferData]         // data array
        ]);

        const txData = {
          to: env.testVault.target, // Call the vault
          data: vaultExecuteData,   // Execute the transfer
          value: 0
        };

        const gasEstimate = await adapter._estimateGasFromTxData(signer, txData);

        expect(gasEstimate).toBeTypeOf('number');
        expect(gasEstimate).toBeGreaterThan(21000); // More than simple ETH transfer
        expect(gasEstimate).toBeLessThan(200000); // Vault execute + ERC20 transfer
      });

      it('should estimate gas for ERC20 approve transaction', async () => {
        const spender = adapter.addresses.routerAddress;
        const amount = ethers.parseEther('10');
        const approveData = wethContract.interface.encodeFunctionData('approve', [spender, amount]);

        const txData = {
          to: wethContract.target,
          data: approveData,
          value: 0
        };

        const gasEstimate = await adapter._estimateGasFromTxData(signer, txData);

        expect(gasEstimate).toBeTypeOf('number');
        expect(gasEstimate).toBeGreaterThan(0);
        expect(gasEstimate).toBeLessThan(100000); // Approvals typically under 100k
      });

      it('should estimate gas for complex swap transaction', async () => {
        // Create swap transaction data using adapter's generateSwapData
        const swapParams = {
          tokenIn: wethContract.target,
          tokenOut: usdcContract.target,
          fee: 500,
          recipient: env.testVault.target,
          amountIn: ethers.parseEther('0.1').toString(),
          slippageTolerance: 1,
          sqrtPriceLimitX96: "0",
          provider: env.provider,
          deadlineMinutes: 2
        };

        const swapTxData = await adapter.generateSwapData(swapParams);

        // Create approval transaction data - vault needs to approve router first
        const approveData = wethContract.interface.encodeFunctionData('approve', [
          swapTxData.to,  // router address
          ethers.parseEther('0.1')  // approve exact amount needed
        ]);

        // Encode call to vault's execute function with BOTH approve and swap
        const vaultExecuteData = env.testVault.interface.encodeFunctionData('execute', [
          [wethContract.target, swapTxData.to],   // targets: [WETH, router]
          [approveData, swapTxData.data]          // data: [approve, swap]
        ]);

        const txData = {
          to: env.testVault.target, // Call the vault
          data: vaultExecuteData,   // Execute approve + swap batch
          value: 0
        };

        const gasEstimate = await adapter._estimateGasFromTxData(signer, txData);

        expect(gasEstimate).toBeTypeOf('number');
        expect(gasEstimate).toBeGreaterThan(100000); // Swaps are complex
        expect(gasEstimate).toBeLessThan(500000); // But shouldn't be too high
      });

      it('should return raw gas estimate without buffer', async () => {
        const txData = {
          to: env.signers[1].address,
          value: ethers.parseEther('0.1'),
          data: '0x'
        };

        const estimate1 = await adapter._estimateGasFromTxData(signer, txData);
        const estimate2 = await adapter._estimateGasFromTxData(signer, txData);

        // Same transaction should return same estimate (no buffer variation)
        expect(estimate1).toBe(estimate2);
        expect(estimate1).toBe(21000); // ETH transfers are always 21000
      });

      it('should handle transaction with from field in txData', async () => {
        const txData = {
          to: env.signers[1].address,
          value: ethers.parseEther('0.1'),
          data: '0x',
          from: signer.address // Include from field
        };

        const gasEstimate = await adapter._estimateGasFromTxData(signer, txData);

        expect(gasEstimate).toBeTypeOf('number');
        expect(gasEstimate).toBe(21000);
      });
    });

    describe('Invalid Type Cases', () => {
      it('should throw error for null signer', async () => {
        const txData = {
          to: env.signers[1].address,
          value: 0,
          data: '0x'
        };

        await expect(
          adapter._estimateGasFromTxData(null, txData)
        ).rejects.toThrow();
      });

      it('should throw error for undefined signer', async () => {
        const txData = {
          to: env.signers[1].address,
          value: 0,
          data: '0x'
        };

        await expect(
          adapter._estimateGasFromTxData(undefined, txData)
        ).rejects.toThrow();
      });

      it('should throw error for non-signer object', async () => {
        const txData = {
          to: env.signers[1].address,
          value: 0,
          data: '0x'
        };

        await expect(
          adapter._estimateGasFromTxData({}, txData) // Plain object, not a signer
        ).rejects.toThrow();
      });

      it('should throw error for null txData', async () => {
        await expect(
          adapter._estimateGasFromTxData(signer, null)
        ).rejects.toThrow();
      });

      it('should throw error for undefined txData', async () => {
        await expect(
          adapter._estimateGasFromTxData(signer, undefined)
        ).rejects.toThrow();
      });

      it('should throw error for txData missing to field', async () => {
        const txData = {
          // Missing 'to' field
          value: 0,
          data: '0x'
        };

        await expect(
          adapter._estimateGasFromTxData(signer, txData)
        ).rejects.toThrow();
      });

      it('should throw error for invalid to address', async () => {
        const txData = {
          to: 'invalid-address', // Not a valid address
          value: 0,
          data: '0x'
        };

        await expect(
          adapter._estimateGasFromTxData(signer, txData)
        ).rejects.toThrow();
      });
    });

    describe('Error Cases', () => {
      it('should throw descriptive error for transaction that would revert', async () => {
        // Try to transfer more WETH than available
        const recipient = env.signers[1].address;
        const amount = ethers.parseEther('999999'); // Way more than balance
        const transferData = wethContract.interface.encodeFunctionData('transfer', [recipient, amount]);

        const txData = {
          to: wethContract.target,
          data: transferData,
          value: 0
        };

        await expect(
          adapter._estimateGasFromTxData(signer, txData)
        ).rejects.toThrow('Gas estimation failed');
      });

      it('should throw error for invalid function selector', async () => {
        const txData = {
          to: wethContract.target,
          data: '0x12345678', // Invalid function selector
          value: 0
        };

        await expect(
          adapter._estimateGasFromTxData(signer, txData)
        ).rejects.toThrow('Gas estimation failed');
      });

      it('should throw error for null to field', async () => {
        const txData = {
          to: null, // Invalid - to field required
          data: '0x',
          value: 0
        };

        await expect(
          adapter._estimateGasFromTxData(signer, txData)
        ).rejects.toThrow("Transaction data must include 'to' field");
      });
    });

    describe('Special Cases', () => {
      it('should handle empty transaction data', async () => {
        const txData = {
          to: env.signers[1].address,
          data: '0x', // Empty data
          value: 0
        };

        const gasEstimate = await adapter._estimateGasFromTxData(signer, txData);

        expect(gasEstimate).toBeTypeOf('number');
        expect(gasEstimate).toBe(21000); // Basic transaction
      });

      it('should handle very large transaction data', async () => {
        // Create a large data payload (e.g., storing data on-chain)
        const largeData = '0x' + 'ff'.repeat(1000); // 1KB of data

        const txData = {
          to: env.signers[1].address,
          data: largeData,
          value: 0
        };

        const gasEstimate = await adapter._estimateGasFromTxData(signer, txData);

        expect(gasEstimate).toBeTypeOf('number');
        expect(gasEstimate).toBeGreaterThan(21000); // More than basic transfer due to data
      });

      it('should handle transaction with all optional fields', async () => {
        const txData = {
          to: env.signers[1].address,
          data: '0x',
          value: ethers.parseEther('0.01'),
          from: signer.address,
          gasLimit: 100000, // These should be ignored for estimation
          gasPrice: ethers.parseUnits('20', 'gwei'),
          nonce: 10
        };

        const gasEstimate = await adapter._estimateGasFromTxData(signer, txData);

        expect(gasEstimate).toBeTypeOf('number');
        expect(gasEstimate).toBe(21000); // Still just an ETH transfer
      });
    });
  });

  describe('_createSlippagePercent', () => {
    describe('Success Cases', () => {
      it('should create Percent object for integer percentage', () => {
        const result = adapter._createSlippagePercent(5);

        expect(result).toBeDefined();
        expect(result.constructor.name).toBe('Percent');
        expect(result.numerator.toString()).toBe('500');
        expect(result.denominator.toString()).toBe('10000');
        // 5% = 500/10000
      });

      it('should create Percent object for decimal percentage', () => {
        const result = adapter._createSlippagePercent(1.5);

        expect(result).toBeDefined();
        expect(result.constructor.name).toBe('Percent');
        expect(result.numerator.toString()).toBe('150');
        expect(result.denominator.toString()).toBe('10000');
        // 1.5% = 150/10000
      });

      it('should create Percent object for zero percentage', () => {
        const result = adapter._createSlippagePercent(0);

        expect(result).toBeDefined();
        expect(result.constructor.name).toBe('Percent');
        expect(result.numerator.toString()).toBe('0');
        expect(result.denominator.toString()).toBe('10000');
        // 0% = 0/10000
      });

      it('should create Percent object for maximum percentage', () => {
        const result = adapter._createSlippagePercent(100);

        expect(result).toBeDefined();
        expect(result.constructor.name).toBe('Percent');
        expect(result.numerator.toString()).toBe('10000');
        expect(result.denominator.toString()).toBe('10000');
        // 100% = 10000/10000
      });

      it('should floor decimal values in conversion', () => {
        const result = adapter._createSlippagePercent(1.99);

        expect(result).toBeDefined();
        expect(result.constructor.name).toBe('Percent');
        expect(result.numerator.toString()).toBe('199');
        expect(result.denominator.toString()).toBe('10000');
        // 1.99% = 199/10000 (not 200)
      });

      it('should handle very small percentages', () => {
        const result = adapter._createSlippagePercent(0.01);

        expect(result).toBeDefined();
        expect(result.constructor.name).toBe('Percent');
        expect(result.numerator.toString()).toBe('1');
        expect(result.denominator.toString()).toBe('10000');
        // 0.01% = 1/10000
      });

      it('should handle percentage with many decimal places', () => {
        const result = adapter._createSlippagePercent(12.3456789);

        expect(result).toBeDefined();
        expect(result.constructor.name).toBe('Percent');
        expect(result.numerator.toString()).toBe('1234');
        expect(result.denominator.toString()).toBe('10000');
        // 12.3456789% = 1234/10000 (floored)
      });
    });

    describe('Error Cases', () => {
      it('should throw error for negative percentage', () => {
        expect(() => adapter._createSlippagePercent(-1)).toThrow('Invalid slippage tolerance: -1. Must be between 0 and 100.');
      });

      it('should throw error for percentage over 100', () => {
        expect(() => adapter._createSlippagePercent(101)).toThrow('Invalid slippage tolerance: 101. Must be between 0 and 100.');
      });

      it('should throw error for NaN', () => {
        expect(() => adapter._createSlippagePercent(NaN)).toThrow('Invalid slippage tolerance: NaN. Must be between 0 and 100.');
      });

      it('should throw error for Infinity', () => {
        expect(() => adapter._createSlippagePercent(Infinity)).toThrow('Invalid slippage tolerance: Infinity. Must be between 0 and 100.');
      });

      it('should throw error for -Infinity', () => {
        expect(() => adapter._createSlippagePercent(-Infinity)).toThrow('Invalid slippage tolerance: -Infinity. Must be between 0 and 100.');
      });

      it('should throw error for string input', () => {
        expect(() => adapter._createSlippagePercent("5")).toThrow('Invalid slippage tolerance: 5. Must be between 0 and 100.');
      });
    });

    describe('Special Cases', () => {
      it('should return consistent Percent objects for same input', () => {
        const result1 = adapter._createSlippagePercent(2.5);
        const result2 = adapter._createSlippagePercent(2.5);

        expect(result1.numerator.toString()).toBe(result2.numerator.toString());
        expect(result1.denominator.toString()).toBe(result2.denominator.toString());
      });

      it('should create valid Percent that can be used in calculations', () => {
        const percent = adapter._createSlippagePercent(10);

        // Test that it's a valid Percent object by checking it has expected methods
        expect(typeof percent.toSignificant).toBe('function');
        expect(typeof percent.toFixed).toBe('function');

        // 10% should display as "10.00"
        expect(percent.toFixed(2)).toBe('10.00');
      });

      it('should handle edge case of 0.009% (rounds down to 0)', () => {
        const result = adapter._createSlippagePercent(0.009);

        expect(result).toBeDefined();
        expect(result.constructor.name).toBe('Percent');
        expect(result.numerator.toString()).toBe('0');
        expect(result.denominator.toString()).toBe('10000');
        // 0.009% * 100 = 0.9, Math.floor(0.9) = 0
      });
    });
  });

  describe('sortTokens', () => {
    describe('Success Cases', () => {
      it('should not swap tokens when token0 has lower address', () => {
        const token0 = { address: '0x1000000000000000000000000000000000000000', symbol: 'TOKEN0' };
        const token1 = { address: '0x2000000000000000000000000000000000000000', symbol: 'TOKEN1' };

        const result = adapter.sortTokens(token0, token1);

        expect(result.sortedToken0).toBe(token0);
        expect(result.sortedToken1).toBe(token1);
        expect(result.tokensSwapped).toBe(false);
      });

      it('should swap tokens when token0 has higher address', () => {
        const token0 = { address: '0x3000000000000000000000000000000000000000', symbol: 'TOKEN0' };
        const token1 = { address: '0x1000000000000000000000000000000000000000', symbol: 'TOKEN1' };

        const result = adapter.sortTokens(token0, token1);

        expect(result.sortedToken0).toBe(token1);
        expect(result.sortedToken1).toBe(token0);
        expect(result.tokensSwapped).toBe(true);
      });

      it('should handle mixed case addresses correctly', () => {
        const token0 = { address: '0xABCDEF0000000000000000000000000000000000', symbol: 'TOKEN0' };
        const token1 = { address: '0x123456FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', symbol: 'TOKEN1' };

        const result = adapter.sortTokens(token0, token1);

        // ABCDEF (lowercase) > 123456 (lowercase), so tokens should be swapped
        expect(result.sortedToken0).toBe(token1);
        expect(result.sortedToken1).toBe(token0);
        expect(result.tokensSwapped).toBe(true);
      });

      it('should handle real token addresses (WETH vs USDC)', () => {
        const weth = {
          address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
          symbol: 'WETH',
          decimals: 18
        };
        const usdc = {
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          symbol: 'USDC',
          decimals: 6
        };

        const result = adapter.sortTokens(weth, usdc);

        // WETH address (82af...) < USDC address (af88...), so no swap needed
        expect(result.sortedToken0).toBe(weth);
        expect(result.sortedToken1).toBe(usdc);
        expect(result.tokensSwapped).toBe(false);
      });

      it('should preserve all token properties', () => {
        const token0 = {
          address: '0x3000000000000000000000000000000000000000',
          symbol: 'TOKEN0',
          decimals: 18,
          name: 'Token Zero',
          customProperty: 'test'
        };
        const token1 = {
          address: '0x1000000000000000000000000000000000000000',
          symbol: 'TOKEN1',
          decimals: 6,
          name: 'Token One'
        };

        const result = adapter.sortTokens(token0, token1);

        // Tokens should be swapped, but all properties preserved
        expect(result.sortedToken0).toEqual(token1);
        expect(result.sortedToken1).toEqual(token0);
        expect(result.sortedToken1.customProperty).toBe('test');
      });

      it('should handle addresses that differ by one character', () => {
        const token0 = { address: '0x1000000000000000000000000000000000000001' };
        const token1 = { address: '0x1000000000000000000000000000000000000000' };

        const result = adapter.sortTokens(token0, token1);

        // token1 ends in 0, token0 ends in 1, so token1 < token0
        expect(result.sortedToken0).toBe(token1);
        expect(result.sortedToken1).toBe(token0);
        expect(result.tokensSwapped).toBe(true);
      });
    });

    describe('Error Cases', () => {
      it('should throw error when token0 has no address', () => {
        const token0 = { symbol: 'TOKEN0' };
        const token1 = { address: '0x1000000000000000000000000000000000000000' };

        expect(() => adapter.sortTokens(token0, token1)).toThrow('Both tokens must have valid addresses');
      });

      it('should throw error when token1 has no address', () => {
        const token0 = { address: '0x1000000000000000000000000000000000000000' };
        const token1 = { symbol: 'TOKEN1' };

        expect(() => adapter.sortTokens(token0, token1)).toThrow('Both tokens must have valid addresses');
      });

      it('should throw error when token0 is null', () => {
        const token1 = { address: '0x1000000000000000000000000000000000000000' };

        expect(() => adapter.sortTokens(null, token1)).toThrow('Both tokens must have valid addresses');
      });

      it('should throw error when token1 is undefined', () => {
        const token0 = { address: '0x1000000000000000000000000000000000000000' };

        expect(() => adapter.sortTokens(token0, undefined)).toThrow('Both tokens must have valid addresses');
      });

      it('should throw error when both tokens are missing', () => {
        expect(() => adapter.sortTokens(null, undefined)).toThrow('Both tokens must have valid addresses');
      });

      it('should throw error when token0 address is empty string', () => {
        const token0 = { address: '' };
        const token1 = { address: '0x1000000000000000000000000000000000000000' };

        expect(() => adapter.sortTokens(token0, token1)).toThrow('Both tokens must have valid addresses');
      });

      it('should throw error when token1 address is empty string', () => {
        const token0 = { address: '0x1000000000000000000000000000000000000000' };
        const token1 = { address: '' };

        expect(() => adapter.sortTokens(token0, token1)).toThrow('Both tokens must have valid addresses');
      });
    });

    describe('Special Cases', () => {
      it('should be deterministic for same input', () => {
        const token0 = { address: '0x3000000000000000000000000000000000000000' };
        const token1 = { address: '0x1000000000000000000000000000000000000000' };

        const result1 = adapter.sortTokens(token0, token1);
        const result2 = adapter.sortTokens(token0, token1);

        expect(result1.sortedToken0).toBe(result2.sortedToken0);
        expect(result1.sortedToken1).toBe(result2.sortedToken1);
        expect(result1.tokensSwapped).toBe(result2.tokensSwapped);
      });

      it('should be consistent regardless of input order', () => {
        const tokenA = { address: '0x1000000000000000000000000000000000000000', symbol: 'A' };
        const tokenB = { address: '0x2000000000000000000000000000000000000000', symbol: 'B' };

        const result1 = adapter.sortTokens(tokenA, tokenB);
        const result2 = adapter.sortTokens(tokenB, tokenA);

        // Both should result in the same sorted order
        expect(result1.sortedToken0).toBe(tokenA);
        expect(result1.sortedToken1).toBe(tokenB);
        expect(result2.sortedToken0).toBe(tokenA);
        expect(result2.sortedToken1).toBe(tokenB);

        // But tokensSwapped should reflect the input order
        expect(result1.tokensSwapped).toBe(false);
        expect(result2.tokensSwapped).toBe(true);
      });

      it('should handle checksum vs lowercase addresses correctly', () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' }; // Mixed case
        const token1 = { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' }; // Lowercase

        const result = adapter.sortTokens(token0, token1);

        // Should treat them as the same address (both convert to lowercase)
        // Since they're the same when lowercased, no swap should occur
        expect(result.sortedToken0).toBe(token0);
        expect(result.sortedToken1).toBe(token1);
        expect(result.tokensSwapped).toBe(false);
      });
    });
  });

  // Mock Provider Classes for testing
  class MockProvider extends ethers.AbstractProvider {
    constructor(chainId, networkName = 'test', additionalProps = {}) {
      super();
      this.chainId = BigInt(chainId);
      this.networkName = networkName;
      this.additionalProps = additionalProps;
    }

    async getNetwork() {
      return {
        chainId: this.chainId,
        name: this.networkName,
        ...this.additionalProps
      };
    }
  }

  class MockFailingProvider extends ethers.AbstractProvider {
    constructor(errorMessage = 'Network error') {
      super();
      this.errorMessage = errorMessage;
    }

    async getNetwork() {
      throw new Error(this.errorMessage);
    }
  }

  class MockNullNetworkProvider extends ethers.AbstractProvider {
    constructor() {
      super();
    }

    async getNetwork() {
      return null;
    }
  }

  class MockInvalidNetworkProvider extends ethers.AbstractProvider {
    constructor() {
      super();
    }

    async getNetwork() {
      return {
        name: 'test-network'
        // missing chainId
      };
    }
  }

  describe('_validateProviderChain', () => {
    describe('Success Cases', () => {
      it('should validate correct chain without throwing', async () => {
        await expect(
          adapter._validateProviderChain(env.provider)
        ).resolves.not.toThrow();
      });

      it('should work with provider returning correct chainId as bigint', async () => {
        const mockProvider = new MockProvider(1337, 'ganache');

        await expect(
          adapter._validateProviderChain(mockProvider)
        ).resolves.not.toThrow();
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null provider', async () => {
        await expect(
          adapter._validateProviderChain(null)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for undefined provider', async () => {
        await expect(
          adapter._validateProviderChain(undefined)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for provider without getNetwork method', async () => {
        const invalidProvider = {};

        await expect(
          adapter._validateProviderChain(invalidProvider)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error when provider is on wrong chain', async () => {
        const wrongChainProvider = new MockProvider(1, 'mainnet');

        await expect(
          adapter._validateProviderChain(wrongChainProvider)
        ).rejects.toThrow('Provider chain 1 doesn\'t match adapter chain 1337');
      });

      it('should throw error when getNetwork throws', async () => {
        const failingProvider = new MockFailingProvider('Network error');

        await expect(
          adapter._validateProviderChain(failingProvider)
        ).rejects.toThrow('Failed to validate provider chain: Network error');
      });

      it('should throw error when network is null', async () => {
        const mockProvider = new MockNullNetworkProvider();

        await expect(
          adapter._validateProviderChain(mockProvider)
        ).rejects.toThrow('Provider returned invalid network data');
      });

      it('should throw error when chainId is undefined', async () => {
        const mockProvider = new MockInvalidNetworkProvider();

        await expect(
          adapter._validateProviderChain(mockProvider)
        ).rejects.toThrow('Provider returned invalid network data');
      });
    });

    describe('Special Cases', () => {
      it('should handle provider with additional network properties', async () => {
        const mockProvider = new MockProvider(1337, 'ganache', {
          ensAddress: '0x123...',
          customProperty: 'test'
        });

        await expect(
          adapter._validateProviderChain(mockProvider)
        ).resolves.not.toThrow();
      });

      it('should distinguish between network errors and chain mismatch', async () => {
        // Chain mismatch error should be thrown as-is
        const wrongChainProvider = new MockProvider(42161, 'arbitrum');

        await expect(
          adapter._validateProviderChain(wrongChainProvider)
        ).rejects.toThrow('Provider chain 42161 doesn\'t match adapter chain 1337');

        // Network error should be wrapped
        const networkErrorProvider = new MockFailingProvider('Connection failed');

        await expect(
          adapter._validateProviderChain(networkErrorProvider)
        ).rejects.toThrow('Failed to validate provider chain: Connection failed');
      });
    });
  });

  describe('getPoolAddress', () => {
    describe('Success Cases', () => {
      it('should return pool address as string for existing pool', async () => {
        const poolAddress = await adapter.getPoolAddress(env.wethAddress, env.usdcAddress, 500, env.provider);

        expect(typeof poolAddress).toBe('string');
        expect(poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(poolAddress.length).toBe(42);
        expect(poolAddress).not.toBe(ethers.ZeroAddress);
      });

      it('should return zero address for non-existent pool', async () => {
        // Use fee tier that doesn't exist (600 basis points)
        const poolAddress = await adapter.getPoolAddress(env.wethAddress, env.usdcAddress, 600, env.provider);

        expect(poolAddress).toBe(ethers.ZeroAddress);
      });

      it('should return same address regardless of token input order', async () => {
        const address1 = await adapter.getPoolAddress(env.wethAddress, env.usdcAddress, 500, env.provider);
        const address2 = await adapter.getPoolAddress(env.usdcAddress, env.wethAddress, 500, env.provider);

        expect(address1).toBe(address2);
        expect(address1).not.toBe(ethers.ZeroAddress);
      });

      it('should return different addresses for different fee tiers', async () => {
        const address500 = await adapter.getPoolAddress(env.wethAddress, env.usdcAddress, 500, env.provider);
        const address3000 = await adapter.getPoolAddress(env.wethAddress, env.usdcAddress, 3000, env.provider);

        expect(address500).not.toBe(address3000);
        expect(typeof address500).toBe('string');
        expect(typeof address3000).toBe('string');
        // Both should be valid pools (not zero address)
        expect(address500).not.toBe(ethers.ZeroAddress);
        expect(address3000).not.toBe(ethers.ZeroAddress);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for missing token0 address', async () => {
        await expect(
          adapter.getPoolAddress(null, env.usdcAddress, 500, env.provider)
        ).rejects.toThrow('Token0 address parameter is required');

        await expect(
          adapter.getPoolAddress(undefined, env.usdcAddress, 500, env.provider)
        ).rejects.toThrow('Token0 address parameter is required');

        await expect(
          adapter.getPoolAddress('', env.usdcAddress, 500, env.provider)
        ).rejects.toThrow('Token0 address parameter is required');
      });

      it('should throw error for invalid token0 address', async () => {
        const invalidAddresses = [
          'not-an-address',
          '0x123', // too short
          '0xGHIJKL', // invalid hex characters
        ];

        for (const invalidAddress of invalidAddresses) {
          await expect(
            adapter.getPoolAddress(invalidAddress, env.usdcAddress, 500, env.provider)
          ).rejects.toThrow(`Invalid token0 address: ${invalidAddress}`);
        }
      });

      it('should throw error for missing token1 address', async () => {
        await expect(
          adapter.getPoolAddress(env.wethAddress, null, 500, env.provider)
        ).rejects.toThrow('Token1 address parameter is required');

        await expect(
          adapter.getPoolAddress(env.wethAddress, undefined, 500, env.provider)
        ).rejects.toThrow('Token1 address parameter is required');

        await expect(
          adapter.getPoolAddress(env.wethAddress, '', 500, env.provider)
        ).rejects.toThrow('Token1 address parameter is required');
      });

      it('should throw error for invalid token1 address', async () => {
        const invalidAddresses = [
          'not-an-address',
          '0x123', // too short
          '0xGHIJKL', // invalid hex characters
        ];

        for (const invalidAddress of invalidAddresses) {
          await expect(
            adapter.getPoolAddress(env.wethAddress, invalidAddress, 500, env.provider)
          ).rejects.toThrow(`Invalid token1 address: ${invalidAddress}`);
        }
      });

      it('should throw error for missing fee', async () => {
        await expect(
          adapter.getPoolAddress(env.wethAddress, env.usdcAddress, null, env.provider)
        ).rejects.toThrow('Fee parameter is required');

        await expect(
          adapter.getPoolAddress(env.wethAddress, env.usdcAddress, undefined, env.provider)
        ).rejects.toThrow('Fee parameter is required');
      });

      it('should throw error for invalid fee type', async () => {
        const invalidFees = [
          'not-a-number',
          NaN,
          Infinity,
          -Infinity,
          {},
          [],
          true
        ];

        for (const invalidFee of invalidFees) {
          await expect(
            adapter.getPoolAddress(env.wethAddress, env.usdcAddress, invalidFee, env.provider)
          ).rejects.toThrow('Fee must be a valid number');
        }
      });

      it('should throw error for invalid provider', async () => {
        await expect(
          adapter.getPoolAddress(env.wethAddress, env.usdcAddress, 500, null)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');

        await expect(
          adapter.getPoolAddress(env.wethAddress, env.usdcAddress, 500, {})
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });
    });

    describe('Special Cases', () => {
      it('should be deterministic for same inputs', async () => {
        const address1 = await adapter.getPoolAddress(env.wethAddress, env.usdcAddress, 500, env.provider);
        const address2 = await adapter.getPoolAddress(env.wethAddress, env.usdcAddress, 500, env.provider);

        expect(address1).toBe(address2);
      });

      it('should return zero address for identical token addresses', async () => {
        // No pool can exist between a token and itself
        const poolAddress = await adapter.getPoolAddress(env.wethAddress, env.wethAddress, 500, env.provider);
        expect(poolAddress).toBe(ethers.ZeroAddress);
      });
    });
  });

  describe('checkPoolExists', () => {
    describe('Success Cases', () => {
      it('should return pool data when pool exists', async () => {
        const weth = {
          address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
          decimals: 18
        };
        const usdc = {
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          decimals: 6
        };

        const result = await adapter.checkPoolExists(weth, usdc, 500, env.provider);

        expect(result).toBeDefined();
        expect(result.exists).toBe(true);
        expect(result.poolAddress).toBeDefined();
        expect(typeof result.poolAddress).toBe('string');
        expect(result.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result.slot0).toBeDefined();
      });

      it('should handle token order correctly', async () => {
        const weth = {
          address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
          decimals: 18
        };
        const usdc = {
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          decimals: 6
        };

        const result1 = await adapter.checkPoolExists(weth, usdc, 500, env.provider);
        const result2 = await adapter.checkPoolExists(usdc, weth, 500, env.provider);

        expect(result1.poolAddress).toBe(result2.poolAddress);
        expect(result1.exists).toBe(result2.exists);
      });

      it('should work with real provider', async () => {
        const token0 = {
          address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
          decimals: 18
        };
        const token1 = {
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          decimals: 6
        };

        const result = await adapter.checkPoolExists(token0, token1, 500, env.provider);

        expect(result).toBeDefined();
        expect(typeof result.exists).toBe('boolean');
        expect(result.poolAddress).toBeDefined();
      });
    });

    describe('Error Cases', () => {
      it('should throw error for missing token0', async () => {
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        await expect(
          adapter.checkPoolExists(null, token1, 500, env.provider)
        ).rejects.toThrow('Token0 parameter is required');

        await expect(
          adapter.checkPoolExists(undefined, token1, 500, env.provider)
        ).rejects.toThrow('Token0 parameter is required');
      });

      it('should throw error for missing token0 address', async () => {
        const token0 = { decimals: 18 };
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        await expect(
          adapter.checkPoolExists(token0, token1, 500, env.provider)
        ).rejects.toThrow('Token0 address is required');
      });

      it('should throw error for invalid token0 address', async () => {
        const invalidAddresses = [
          'not-an-address',
          '0x123', // too short
          '0xGHIJKL', // invalid hex characters
        ];

        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        for (const invalidAddress of invalidAddresses) {
          const token0 = { address: invalidAddress, decimals: 18 };
          await expect(
            adapter.checkPoolExists(token0, token1, 500, env.provider)
          ).rejects.toThrow();
        }
      });

      it('should throw error for missing token0 decimals', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' };
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        await expect(
          adapter.checkPoolExists(token0, token1, 500, env.provider)
        ).rejects.toThrow('Token0 decimals is required');
      });

      it('should throw error for invalid token0 decimals', async () => {
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        const invalidDecimals = [
          'not-a-number',
          NaN,
          Infinity,
          -Infinity,
          {},
          [],
          true
        ];

        for (const invalidDecimal of invalidDecimals) {
          const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: invalidDecimal };
          await expect(
            adapter.checkPoolExists(token0, token1, 500, env.provider)
          ).rejects.toThrow('Token0 decimals must be a valid number');
        }
      });

      it('should throw error for missing token1', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };

        await expect(
          adapter.checkPoolExists(token0, null, 500, env.provider)
        ).rejects.toThrow('Token1 parameter is required');

        await expect(
          adapter.checkPoolExists(token0, undefined, 500, env.provider)
        ).rejects.toThrow('Token1 parameter is required');
      });

      it('should throw error for missing token1 address', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };
        const token1 = { decimals: 6 };

        await expect(
          adapter.checkPoolExists(token0, token1, 500, env.provider)
        ).rejects.toThrow('Token1 address is required');
      });

      it('should throw error for invalid token1 address', async () => {
        const invalidAddresses = [
          'not-an-address',
          '0x123', // too short
          '0xGHIJKL', // invalid hex characters
        ];

        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };

        for (const invalidAddress of invalidAddresses) {
          const token1 = { address: invalidAddress, decimals: 6 };
          await expect(
            adapter.checkPoolExists(token0, token1, 500, env.provider)
          ).rejects.toThrow();
        }
      });

      it('should throw error for missing token1 decimals', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' };

        await expect(
          adapter.checkPoolExists(token0, token1, 500, env.provider)
        ).rejects.toThrow('Token1 decimals is required');
      });

      it('should throw error for invalid token1 decimals', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };

        const invalidDecimals = [
          'not-a-number',
          NaN,
          Infinity,
          -Infinity,
          {},
          [],
          true
        ];

        for (const invalidDecimal of invalidDecimals) {
          const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: invalidDecimal };
          await expect(
            adapter.checkPoolExists(token0, token1, 500, env.provider)
          ).rejects.toThrow('Token1 decimals must be a valid number');
        }
      });

      it('should throw error for missing fee', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        await expect(
          adapter.checkPoolExists(token0, token1, null, env.provider)
        ).rejects.toThrow('Fee parameter is required');

        await expect(
          adapter.checkPoolExists(token0, token1, undefined, env.provider)
        ).rejects.toThrow('Fee parameter is required');
      });

      it('should throw error for invalid fee type', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        const invalidFees = [
          'not-a-number',
          NaN,
          Infinity,
          -Infinity,
          {},
          [],
          true
        ];

        for (const invalidFee of invalidFees) {
          await expect(
            adapter.checkPoolExists(token0, token1, invalidFee, env.provider)
          ).rejects.toThrow('Fee must be a valid number');
        }
      });

      it('should throw error for invalid provider', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        await expect(
          adapter.checkPoolExists(token0, token1, 500, null)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');

        await expect(
          adapter.checkPoolExists(token0, token1, 500, {})
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should return exists: false for non-existent pool', async () => {
        const fakeToken1 = {
          address: '0x0000000000000000000000000000000000000001',
          decimals: 18
        };
        const fakeToken2 = {
          address: '0x0000000000000000000000000000000000000002',
          decimals: 18
        };

        const result = await adapter.checkPoolExists(fakeToken1, fakeToken2, 500, env.provider);

        expect(result).toBeDefined();
        expect(result.exists).toBe(false);
        expect(result.poolAddress).toBeNull();
        expect(result.slot0).toBeNull();
      });
    });

    describe('Special Cases', () => {
      it('should be consistent across multiple calls', async () => {
        const token0 = {
          address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
          decimals: 18
        };
        const token1 = {
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          decimals: 6
        };

        const result1 = await adapter.checkPoolExists(token0, token1, 500, env.provider);
        const result2 = await adapter.checkPoolExists(token0, token1, 500, env.provider);

        expect(result1.exists).toBe(result2.exists);
        expect(result1.poolAddress).toBe(result2.poolAddress);
      });

      it('should return exists: false for valid address format but fake tokens', async () => {
        // These are valid address formats that ethers normalizes, but represent fake tokens
        const fakeToken1 = {
          address: '0x1234567890123456789012345678901234567890',
          decimals: 18
        };
        const fakeToken2 = {
          address: '0x9876543210987654321098765432109876543210',
          decimals: 6
        };

        const result = await adapter.checkPoolExists(fakeToken1, fakeToken2, 500, env.provider);

        expect(result).toBeDefined();
        expect(result.exists).toBe(false);
        expect(result.poolAddress).toBeNull();
        expect(result.slot0).toBeNull();
      });

      it('should handle provider network errors gracefully', async () => {
        const failingProvider = new MockFailingProvider('Network error');

        const token0 = {
          address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
          decimals: 18
        };
        const token1 = {
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          decimals: 6
        };

        await expect(
          adapter.checkPoolExists(token0, token1, 500, failingProvider)
        ).rejects.toThrow('Failed to validate provider chain: Network error');
      });

      it('should throw when provider is on wrong chain', async () => {
        const wrongChainProvider = new MockProvider(1, 'mainnet');

        const token0 = {
          address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
          decimals: 18
        };
        const token1 = {
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          decimals: 6
        };

        await expect(
          adapter.checkPoolExists(token0, token1, 500, wrongChainProvider)
        ).rejects.toThrow('Provider chain 1 doesn\'t match adapter chain 1337');
      });
    });
  });

  describe('_getPositionManager', () => {
    describe('Success Cases', () => {
      it('should return position manager contract with valid provider', () => {
        const contract = adapter._getPositionManager(env.provider);

        expect(contract).toBeDefined();
        expect(contract.target).toBe(adapter.addresses.positionManagerAddress);
        expect(contract.interface).toBeDefined();
      });

      it('should return contract with correct ABI', () => {
        const contract = adapter._getPositionManager(env.provider);

        // Check that it has some expected position manager functions
        expect(contract.interface.hasFunction('positions')).toBe(true);
        expect(contract.interface.hasFunction('balanceOf')).toBe(true);
        expect(contract.interface.hasFunction('tokenOfOwnerByIndex')).toBe(true);
      });

      it('should work with different provider instances', () => {
        const mockProvider1 = {
          _isMockProvider: true,
          call: async () => '0x'
        };
        const mockProvider2 = {
          _isMockProvider: true,
          send: async () => ({})
        };

        const contract1 = adapter._getPositionManager(mockProvider1);
        const contract2 = adapter._getPositionManager(mockProvider2);

        expect(contract1.target).toBe(contract2.target);
        expect(contract1.target).toBe(adapter.addresses.positionManagerAddress);
      });
    });

    describe('Error Cases', () => {
      it('should throw error when provider is null', () => {
        expect(() => adapter._getPositionManager(null)).toThrow('Provider is required');
      });

      it('should throw error when provider is undefined', () => {
        expect(() => adapter._getPositionManager(undefined)).toThrow('Provider is required');
      });

      it('should throw error when addresses are missing', () => {
        // Create adapter with modified addresses to test error case
        const originalAddresses = adapter.addresses;
        adapter.addresses = null;

        expect(() => adapter._getPositionManager(env.provider)).toThrow('Position manager not available for chain 1337');

        // Restore addresses
        adapter.addresses = originalAddresses;
      });

      it('should throw error when positionManagerAddress is missing', () => {
        // Create adapter with modified addresses to test error case
        const originalAddress = adapter.addresses.positionManagerAddress;
        delete adapter.addresses.positionManagerAddress;

        expect(() => adapter._getPositionManager(env.provider)).toThrow('Position manager not available for chain 1337');

        // Restore address
        adapter.addresses.positionManagerAddress = originalAddress;
      });
    });

    describe('Special Cases', () => {
      it('should return consistent contracts for same provider', () => {
        const contract1 = adapter._getPositionManager(env.provider);
        const contract2 = adapter._getPositionManager(env.provider);

        expect(contract1.target).toBe(contract2.target);
      });

      it('should handle provider with additional properties', () => {
        const extendedProvider = {
          ...env.provider,
          customProperty: 'test',
          extraMethod: () => {}
        };

        const contract = adapter._getPositionManager(extendedProvider);

        expect(contract).toBeDefined();
        expect(contract.target).toBe(adapter.addresses.positionManagerAddress);
      });
    });
  });

  describe('_fetchUserPositionIds', () => {
    let positionManager;

    beforeEach(() => {
      // Get the real position manager contract using existing env
      positionManager = adapter._getPositionManager(env.provider);
    });

    describe('Success Cases', () => {
      it('should return array with tokenId when vault has one position', async () => {
        // Use the test vault that already has a position
        const vaultAddress = await env.testVault.getAddress();

        const result = await adapter._fetchUserPositionIds(vaultAddress, positionManager);

        expect(result).toHaveLength(1);
        expect(result[0]).toBe(env.positionTokenId.toString());
      });

      it('should return empty array for wallet with no positions', async () => {
        // Use a different signer that has no positions
        const emptyWallet = env.signers[4].address;

        const result = await adapter._fetchUserPositionIds(emptyWallet, positionManager);

        expect(result).toEqual([]);
      });
    });

    describe('Error Cases', () => {
      it('should throw error when address is missing', async () => {
        await expect(
          adapter._fetchUserPositionIds(null, positionManager)
        ).rejects.toThrow('Address parameter is required');

        await expect(
          adapter._fetchUserPositionIds(undefined, positionManager)
        ).rejects.toThrow('Address parameter is required');

        await expect(
          adapter._fetchUserPositionIds('', positionManager)
        ).rejects.toThrow('Address parameter is required');
      });

      it('should throw error for invalid Ethereum address', async () => {
        const invalidAddresses = [
          'not-an-address',
          '0x123', // too short
          '0xGHIJKL', // invalid hex characters
          '1234567890123456789012345678901234567890', // missing 0x prefix
          '0x0000000000000000000000000000000000000000', // zero address
        ];

        for (const invalidAddress of invalidAddresses) {
          await expect(
            adapter._fetchUserPositionIds(invalidAddress, positionManager)
          ).rejects.toThrow();
        }
      });

      it('should throw error when positionManager is missing', async () => {
        const validAddress = env.signers[0].address;

        await expect(
          adapter._fetchUserPositionIds(validAddress, null)
        ).rejects.toThrow('Position manager parameter is required');

        await expect(
          adapter._fetchUserPositionIds(validAddress, undefined)
        ).rejects.toThrow('Position manager parameter is required');
      });

      it('should throw error for invalid positionManager missing required methods', async () => {
        const validAddress = env.signers[0].address;

        // Object missing both methods
        const invalidManager1 = {};
        await expect(
          adapter._fetchUserPositionIds(validAddress, invalidManager1)
        ).rejects.toThrow('Invalid position manager contract - missing required methods');

        // Object with wrong method types
        const invalidManager2 = {
          balanceOf: 'not-a-function',
          tokenOfOwnerByIndex: 123
        };
        await expect(
          adapter._fetchUserPositionIds(validAddress, invalidManager2)
        ).rejects.toThrow('Invalid position manager contract - missing required methods');
      });
    });

    describe('Special Cases', () => {
      it('should handle contract call failures', async () => {
        const validAddress = env.signers[0].address;

        // Mock position manager that fails on balanceOf
        const mockFailingPositionManager = {
          balanceOf: vi.fn().mockRejectedValue(new Error('Contract call failed')),
          tokenOfOwnerByIndex: vi.fn()
        };

        await expect(
          adapter._fetchUserPositionIds(validAddress, mockFailingPositionManager)
        ).rejects.toThrow('Contract call failed');

        // Mock position manager that fails on tokenOfOwnerByIndex
        const mockFailingOnToken = {
          balanceOf: vi.fn().mockResolvedValue(BigInt(1)),
          tokenOfOwnerByIndex: vi.fn().mockRejectedValue(new Error('Token fetch failed'))
        };

        await expect(
          adapter._fetchUserPositionIds(validAddress, mockFailingOnToken)
        ).rejects.toThrow('Token fetch failed');
      });
    });
  });

  describe('fetchPoolData', () => {
    describe('Success Cases', () => {
      it('should return complete pool data for WETH/USDC 500 pool', async () => {
        const wethAddress = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'; // Arbitrum WETH
        const usdcAddress = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // Arbitrum USDC

        const result = await adapter.fetchPoolData(wethAddress, usdcAddress, 500, env.provider);

        // Test structure - all required properties present
        expect(result).toHaveProperty('poolAddress');
        expect(result).toHaveProperty('token0');
        expect(result).toHaveProperty('token1');
        expect(result).toHaveProperty('sqrtPriceX96');
        expect(result).toHaveProperty('tick');
        expect(result).toHaveProperty('liquidity');
        expect(result).toHaveProperty('fee');
        expect(result).toHaveProperty('tickSpacing');
        expect(result).toHaveProperty('ticks');

        // Test data types
        expect(typeof result.poolAddress).toBe('string');
        expect(typeof result.tick).toBe('number');
        expect(typeof result.fee).toBe('number');
        expect(typeof result.tickSpacing).toBe('number');
        expect(typeof result.sqrtPriceX96).toBe('string');
        expect(typeof result.liquidity).toBe('string');
        expect(typeof result.ticks).toBe('object');

        // Test token data structure
        expect(result.token0).toHaveProperty('address');
        expect(result.token0).toHaveProperty('symbol');
        expect(result.token0).toHaveProperty('decimals');
        expect(result.token0).toHaveProperty('chainId');
        expect(result.token1).toHaveProperty('address');
        expect(result.token1).toHaveProperty('symbol');
        expect(result.token1).toHaveProperty('decimals');
        expect(result.token1).toHaveProperty('chainId');

        // Test reasonable values for active pool
        expect(result.fee).toBe(500);
        expect(result.tickSpacing).toBe(10); // 0.05% fee tier has 10 tick spacing
        expect(result.token0.chainId).toBe(1337);
        expect(Number(result.liquidity)).toBeGreaterThan(0); // Active pool should have liquidity
      });
    });

    describe('Error Cases', () => {
      const validWethAddress = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
      const validUsdcAddress = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

      it('should throw error for missing token0 address', async () => {
        await expect(
          adapter.fetchPoolData(null, validUsdcAddress, 500, env.provider)
        ).rejects.toThrow('Token0 address parameter is required');

        await expect(
          adapter.fetchPoolData(undefined, validUsdcAddress, 500, env.provider)
        ).rejects.toThrow('Token0 address parameter is required');

        await expect(
          adapter.fetchPoolData('', validUsdcAddress, 500, env.provider)
        ).rejects.toThrow('Token0 address parameter is required');
      });

      it('should throw error for invalid token0 address', async () => {
        const invalidAddresses = [
          'not-an-address',
          '0x123',
          '0xGHIJKL',
          '1234567890123456789012345678901234567890',
        ];

        for (const invalidAddress of invalidAddresses) {
          await expect(
            adapter.fetchPoolData(invalidAddress, validUsdcAddress, 500, env.provider)
          ).rejects.toThrow();
        }
      });

      it('should throw error for missing token1 address', async () => {
        await expect(
          adapter.fetchPoolData(validWethAddress, null, 500, env.provider)
        ).rejects.toThrow('Token1 address parameter is required');

        await expect(
          adapter.fetchPoolData(validWethAddress, undefined, 500, env.provider)
        ).rejects.toThrow('Token1 address parameter is required');

        await expect(
          adapter.fetchPoolData(validWethAddress, '', 500, env.provider)
        ).rejects.toThrow('Token1 address parameter is required');
      });

      it('should throw error for invalid token1 address', async () => {
        const invalidAddresses = [
          'not-an-address',
          '0x123',
          '0xGHIJKL',
          '1234567890123456789012345678901234567890',
        ];

        for (const invalidAddress of invalidAddresses) {
          await expect(
            adapter.fetchPoolData(validWethAddress, invalidAddress, 500, env.provider)
          ).rejects.toThrow();
        }
      });

      it('should throw error for missing fee', async () => {
        await expect(
          adapter.fetchPoolData(validWethAddress, validUsdcAddress, null, env.provider)
        ).rejects.toThrow('Fee parameter is required');

        await expect(
          adapter.fetchPoolData(validWethAddress, validUsdcAddress, undefined, env.provider)
        ).rejects.toThrow('Fee parameter is required');
      });

      it('should throw error for invalid fee type', async () => {
        const invalidFees = [
          'not-a-number',
          '500',
          {},
          [],
          NaN,
          Infinity,
          -Infinity,
        ];

        for (const invalidFee of invalidFees) {
          await expect(
            adapter.fetchPoolData(validWethAddress, validUsdcAddress, invalidFee, env.provider)
          ).rejects.toThrow('Fee must be a valid number');
        }
      });

      it('should throw error for invalid provider', async () => {
        await expect(
          adapter.fetchPoolData(validWethAddress, validUsdcAddress, 500, null)
        ).rejects.toThrow();

        await expect(
          adapter.fetchPoolData(validWethAddress, validUsdcAddress, 500, undefined)
        ).rejects.toThrow();

        // Test wrong chain provider
        const wrongChainAdapter = new UniswapV3Adapter(1); // Ethereum instead of 1337
        await expect(
          wrongChainAdapter.fetchPoolData(validWethAddress, validUsdcAddress, 500, env.provider)
        ).rejects.toThrow();
      });

      it('should throw error for unsupported tokens', async () => {
        // Valid address format but not in our token config
        const unknownToken = '0x1234567890123456789012345678901234567890';

        await expect(
          adapter.fetchPoolData(unknownToken, validUsdcAddress, 500, env.provider)
        ).rejects.toThrow(/Unsupported token.*on chain/);

        await expect(
          adapter.fetchPoolData(validWethAddress, unknownToken, 500, env.provider)
        ).rejects.toThrow(/Unsupported token.*on chain/);
      });

      it('should throw error for non-existent pool', async () => {
        // Use fake token addresses that would create a non-existent pool
        const fakeToken1 = '0x0000000000000000000000000000000000000001';
        const fakeToken2 = '0x0000000000000000000000000000000000000002';

        await expect(
          adapter.fetchPoolData(fakeToken1, fakeToken2, 500, env.provider)
        ).rejects.toThrow(/Unsupported token/);
      });
    });
  });

  describe('fetchTickData', () => {
    let validPoolAddress;
    let validTickLower;
    let validTickUpper;

    beforeAll(async () => {
      try {
        // Get valid pool data to use for testing
        const wethToken = getTokenBySymbol('WETH');
        const usdcToken = getTokenBySymbol('USDC');
        const wethAddress = wethToken.addresses[1337];
        const usdcAddress = usdcToken.addresses[1337];

        const poolData = await adapter.fetchPoolData(wethAddress, usdcAddress, 500, env.provider);
        validPoolAddress = poolData.poolAddress;

        // Use valid tick values around current tick
        const currentTick = poolData.tick;
        validTickLower = currentTick - 1000;
        validTickUpper = currentTick + 1000;
      } catch (error) {
        console.warn('Failed to setup fetchTickData test data:', error.message);
      }
    });

    describe('Success Cases', () => {
      it('should fetch tick data successfully with valid parameters', async () => {
        const tickData = await adapter.fetchTickData(
          validPoolAddress,
          validTickLower,
          validTickUpper,
          env.provider
        );

        expect(tickData).toBeDefined();
        expect(tickData.tickLower).toBeDefined();
        expect(tickData.tickUpper).toBeDefined();

        // Check tickLower structure
        expect(tickData.tickLower.liquidityGross).toBeTypeOf('string');
        expect(tickData.tickLower.liquidityNet).toBeTypeOf('string');
        expect(tickData.tickLower.feeGrowthOutside0X128).toBeTypeOf('string');
        expect(tickData.tickLower.feeGrowthOutside1X128).toBeTypeOf('string');
        expect(tickData.tickLower.initialized).toBeTypeOf('boolean');

        // Check tickUpper structure
        expect(tickData.tickUpper.liquidityGross).toBeTypeOf('string');
        expect(tickData.tickUpper.liquidityNet).toBeTypeOf('string');
        expect(tickData.tickUpper.feeGrowthOutside0X128).toBeTypeOf('string');
        expect(tickData.tickUpper.feeGrowthOutside1X128).toBeTypeOf('string');
        expect(tickData.tickUpper.initialized).toBeTypeOf('boolean');
      });


      it('should handle zero tick values', async () => {
        const tickData = await adapter.fetchTickData(
          validPoolAddress,
          0,
          0,
          env.provider
        );

        expect(tickData).toBeDefined();
        expect(tickData.tickLower).toBeDefined();
        expect(tickData.tickUpper).toBeDefined();
      });

      it('should handle negative tick values', async () => {
        const tickData = await adapter.fetchTickData(
          validPoolAddress,
          -1000,
          -500,
          env.provider
        );

        expect(tickData).toBeDefined();
        expect(tickData.tickLower).toBeDefined();
        expect(tickData.tickUpper).toBeDefined();
      });
    });

    describe('Error Cases', () => {
      it('should throw error for missing pool address', async () => {
        await expect(
          adapter.fetchTickData(null, validTickLower, validTickUpper, env.provider)
        ).rejects.toThrow('Pool address parameter is required');

        await expect(
          adapter.fetchTickData(undefined, validTickLower, validTickUpper, env.provider)
        ).rejects.toThrow('Pool address parameter is required');

        await expect(
          adapter.fetchTickData('', validTickLower, validTickUpper, env.provider)
        ).rejects.toThrow('Pool address parameter is required');
      });

      it('should throw error for invalid pool address format', async () => {
        const invalidAddresses = [
          'not-an-address',
          '0x123', // too short
          '0xGHIJKL', // invalid hex characters
          '1234567890123456789012345678901234567890', // missing 0x prefix
        ];

        for (const invalidAddress of invalidAddresses) {
          await expect(
            adapter.fetchTickData(invalidAddress, validTickLower, validTickUpper, env.provider)
          ).rejects.toThrow(); // Just check that it throws, don't check specific message
        }
      });

      it('should throw error for missing tickLower', async () => {
        await expect(
          adapter.fetchTickData(validPoolAddress, null, validTickUpper, env.provider)
        ).rejects.toThrow('tickLower parameter is required');

        await expect(
          adapter.fetchTickData(validPoolAddress, undefined, validTickUpper, env.provider)
        ).rejects.toThrow('tickLower parameter is required');
      });

      it('should throw error for missing tickUpper', async () => {
        await expect(
          adapter.fetchTickData(validPoolAddress, validTickLower, null, env.provider)
        ).rejects.toThrow('tickUpper parameter is required');

        await expect(
          adapter.fetchTickData(validPoolAddress, validTickLower, undefined, env.provider)
        ).rejects.toThrow('tickUpper parameter is required');
      });

      it('should throw error for invalid tickLower type', async () => {
        const invalidTicks = [
          'not-a-number',
          NaN,
          Infinity,
          -Infinity,
          {},
          [],
          true
        ];

        for (const invalidTick of invalidTicks) {
          await expect(
            adapter.fetchTickData(validPoolAddress, invalidTick, validTickUpper, env.provider)
          ).rejects.toThrow('tickLower must be a valid number');
        }
      });

      it('should throw error for invalid tickUpper type', async () => {
        const invalidTicks = [
          'not-a-number',
          NaN,
          Infinity,
          -Infinity,
          {},
          [],
          true
        ];

        for (const invalidTick of invalidTicks) {
          await expect(
            adapter.fetchTickData(validPoolAddress, validTickLower, invalidTick, env.provider)
          ).rejects.toThrow('tickUpper must be a valid number');
        }
      });

      it('should throw error for missing provider', async () => {
        await expect(
          adapter.fetchTickData(validPoolAddress, validTickLower, validTickUpper)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider', async () => {
        await expect(
          adapter.fetchTickData(validPoolAddress, validTickLower, validTickUpper, null)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');

        await expect(
          adapter.fetchTickData(validPoolAddress, validTickLower, validTickUpper, {})
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw descriptive error for non-existent pool', async () => {
        const nonExistentPool = '0x1234567890123456789012345678901234567890';

        await expect(
          adapter.fetchTickData(nonExistentPool, validTickLower, validTickUpper, env.provider)
        ).rejects.toThrow('Failed to fetch tick data');
      });
    });
  });

  describe('_assemblePositionData', () => {
    let positionManager;
    let positionData;
    let poolData;
    let testTokenId;
    let expectedNonce;
    let expectedOperator;
    let expectedFee;
    let expectedTickLower;
    let expectedTickUpper;
    let expectedLiquidity;

    beforeAll(async () => {
      try {
        // Skip if no test position available
        if (!env.positionTokenId) {
          console.warn('No test position available, skipping _assemblePositionData tests');
          return;
        }

        testTokenId = env.positionTokenId;

        // Get position manager and fetch real position data
        positionManager = adapter._getPositionManager(env.provider);
        positionData = await positionManager.positions(testTokenId);

        // Get pool data for the position's tokens
        const wethToken = getTokenBySymbol('WETH');
        const usdcToken = getTokenBySymbol('USDC');
        const wethAddress = wethToken.addresses[1337];
        const usdcAddress = usdcToken.addresses[1337];

        poolData = await adapter.fetchPoolData(wethAddress, usdcAddress, 500, env.provider);

        // Capture expected values for assertions
        expectedNonce = Number(positionData.nonce);
        expectedOperator = positionData.operator;
        expectedFee = Number(positionData.fee);
        expectedTickLower = Number(positionData.tickLower);
        expectedTickUpper = Number(positionData.tickUpper);
        expectedLiquidity = positionData.liquidity.toString();

      } catch (error) {
        console.warn('Failed to setup _assemblePositionData test data:', error.message);
      }
    });

    describe('Success Cases', () => {
      it('should assemble position data correctly with real position', async () => {
        // Skip if test data not available
        if (!positionData || !poolData) {
          console.warn('Test data not available, skipping test');
          return;
        }

        const result = adapter._assemblePositionData(testTokenId, positionData, poolData);

        // Check structure
        expect(result).toBeDefined();
        expect(result).toBeTypeOf('object');

        // Check basic properties
        expect(result.id).toBe(String(testTokenId));
        expect(result.tokenPair).toBe(`${poolData.token0.symbol}/${poolData.token1.symbol}`);
        expect(result.pool).toBe(poolData.poolAddress);
        expect(result.platform).toBe('uniswapV3');
        expect(result.platformName).toBe('Uniswap V3');

        // Check position data conversions match expected values
        expect(result.nonce).toBe(expectedNonce);
        expect(result.operator).toBe(expectedOperator);
        expect(result.fee).toBe(expectedFee);
        expect(result.tickLower).toBe(expectedTickLower);
        expect(result.tickUpper).toBe(expectedTickUpper);
        expect(result.liquidity).toBe(expectedLiquidity);

        // Check string conversions have correct types
        expect(result.feeGrowthInside0LastX128).toBeTypeOf('string');
        expect(result.feeGrowthInside1LastX128).toBeTypeOf('string');
        expect(result.tokensOwed0).toBeTypeOf('string');
        expect(result.tokensOwed1).toBeTypeOf('string');

        // Check string conversions match original BigInt values
        expect(result.feeGrowthInside0LastX128).toBe(positionData.feeGrowthInside0LastX128.toString());
        expect(result.feeGrowthInside1LastX128).toBe(positionData.feeGrowthInside1LastX128.toString());
        expect(result.tokensOwed0).toBe(positionData.tokensOwed0.toString());
        expect(result.tokensOwed1).toBe(positionData.tokensOwed1.toString());
      });

      it('should handle tokenId as different input types correctly', () => {
        // Skip if test data not available
        if (!positionData || !poolData) {
          console.warn('Test data not available, skipping test');
          return;
        }

        // Test with tokenId as number
        const resultNumber = adapter._assemblePositionData(testTokenId, positionData, poolData);
        expect(resultNumber.id).toBe(String(testTokenId));

        // Test with tokenId as string
        const resultString = adapter._assemblePositionData(String(testTokenId), positionData, poolData);
        expect(resultString.id).toBe(String(testTokenId));

        // Both should produce identical results except for id conversion
        expect(resultNumber.tokenPair).toBe(resultString.tokenPair);
        expect(resultNumber.pool).toBe(resultString.pool);
        expect(resultNumber.nonce).toBe(resultString.nonce);
        expect(resultNumber.liquidity).toBe(resultString.liquidity);
      });

      it('should create correct tokenPair string from real token data', () => {
        // Skip if test data not available
        if (!positionData || !poolData) {
          console.warn('Test data not available, skipping test');
          return;
        }

        const result = adapter._assemblePositionData(testTokenId, positionData, poolData);

        // Verify tokenPair format
        expect(result.tokenPair).toMatch(/^[A-Z]+\/[A-Z]+$/);
        expect(result.tokenPair).toBe(`${poolData.token0.symbol}/${poolData.token1.symbol}`);

        // Verify it contains expected token symbols (in correct order from pool data)
        const [token0Symbol, token1Symbol] = result.tokenPair.split('/');
        expect(token0Symbol).toBe(poolData.token0.symbol);
        expect(token1Symbol).toBe(poolData.token1.symbol);
      });

      it('should preserve all platform metadata correctly', () => {
        // Skip if test data not available
        if (!positionData || !poolData) {
          console.warn('Test data not available, skipping test');
          return;
        }

        const result = adapter._assemblePositionData(testTokenId, positionData, poolData);

        // Check platform information matches adapter
        expect(result.platform).toBe(adapter.platformId);
        expect(result.platformName).toBe(adapter.platformName);
        expect(result.platform).toBe('uniswapV3');
        expect(result.platformName).toBe('Uniswap V3');
      });

      it('should handle BigInt to string conversions correctly', () => {
        // Skip if test data not available
        if (!positionData || !poolData) {
          console.warn('Test data not available, skipping test');
          return;
        }

        const result = adapter._assemblePositionData(testTokenId, positionData, poolData);

        // All BigInt values should be converted to strings
        expect(typeof result.liquidity).toBe('string');
        expect(typeof result.feeGrowthInside0LastX128).toBe('string');
        expect(typeof result.feeGrowthInside1LastX128).toBe('string');
        expect(typeof result.tokensOwed0).toBe('string');
        expect(typeof result.tokensOwed1).toBe('string');

        // String values should be parseable as numbers (for validation)
        expect(() => BigInt(result.liquidity)).not.toThrow();
        expect(() => BigInt(result.feeGrowthInside0LastX128)).not.toThrow();
        expect(() => BigInt(result.feeGrowthInside1LastX128)).not.toThrow();
        expect(() => BigInt(result.tokensOwed0)).not.toThrow();
        expect(() => BigInt(result.tokensOwed1)).not.toThrow();
      });
    });
  });

  describe('getPositions', () => {
    describe('Error Cases', () => {
      it('should throw error for missing address', async () => {
        await expect(
          adapter.getPositions(null, env.provider)
        ).rejects.toThrow('Address parameter is required');
      });

      it('should throw error for undefined address', async () => {
        await expect(
          adapter.getPositions(undefined, env.provider)
        ).rejects.toThrow('Address parameter is required');
      });

      it('should throw error for empty string address', async () => {
        await expect(
          adapter.getPositions('', env.provider)
        ).rejects.toThrow('Address parameter is required');
      });

      const invalidAddresses = [
        '0x123',
        'not-an-address',
        '0xInvalidAddress',
        '0x12345678901234567890123456789012345678Z0'
      ];

      invalidAddresses.forEach(invalidAddress => {
        it(`should throw error for invalid address: ${invalidAddress}`, async () => {
          await expect(
            adapter.getPositions(invalidAddress, env.provider)
          ).rejects.toThrow(`Invalid address: ${invalidAddress}`);
        });
      });

      it('should throw error for missing provider', async () => {
        await expect(
          adapter.getPositions(env.signers[0].address, null)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider (missing getNetwork)', async () => {
        const invalidProvider = { send: () => {} };

        await expect(
          adapter.getPositions(env.signers[0].address, invalidProvider)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for provider with wrong chain', async () => {
        // Create a mock provider that returns wrong chain ID
        const wrongChainProvider = new MockProvider(9999);

        await expect(
          adapter.getPositions(env.signers[0].address, wrongChainProvider)
        ).rejects.toThrow('Provider chain 9999 doesn\'t match adapter chain 1337');
      });
    });

    describe('Success Cases', () => {
      let expectedPosition;
      let expectedPoolData;
      let testAddress;

      beforeAll(async () => {
        // Set up test data using the real position (position was transferred to vault)
        testAddress = env.testVault.target;

        // Get the real position data for comparison
        const positionManager = adapter._getPositionManager(env.provider);
        const realPositionData = await positionManager.positions(env.positionTokenId);
        const { token0, token1, fee, tickLower, tickUpper } = realPositionData;

        // Get pool data
        const poolData = await adapter.fetchPoolData(token0, token1, Number(fee), env.provider);

        // Get tick data
        const tickData = await adapter.fetchTickData(poolData.poolAddress, Number(tickLower), Number(tickUpper), env.provider);

        // Assemble expected position using our tested function
        expectedPosition = adapter._assemblePositionData(env.positionTokenId, realPositionData, poolData);

        // Create expected pool data with tick data
        expectedPoolData = {
          ...poolData,
          ticks: {
            [tickLower]: tickData.tickLower,
            [tickUpper]: tickData.tickUpper
          }
        };
      });

      it('should return positions for address with positions', async () => {
        const result = await adapter.getPositions(testAddress, env.provider);

        expect(result).toBeDefined();
        expect(result.positions).toBeInstanceOf(Array);
        expect(result.poolData).toBeTypeOf('object');
      });

      it('should return correct position count', async () => {
        const result = await adapter.getPositions(testAddress, env.provider);

        expect(result.positions).toHaveLength(1);
      });

      it('should return position with correct structure', async () => {
        const result = await adapter.getPositions(testAddress, env.provider);
        const position = result.positions[0];

        // Test position structure matches expected
        expect(position.id).toBe(expectedPosition.id);
        expect(position.tokenPair).toBe(expectedPosition.tokenPair);
        expect(position.pool).toBe(expectedPosition.pool);
        expect(position.nonce).toBe(expectedPosition.nonce);
        expect(position.operator).toBe(expectedPosition.operator);
        expect(position.fee).toBe(expectedPosition.fee);
        expect(position.tickLower).toBe(expectedPosition.tickLower);
        expect(position.tickUpper).toBe(expectedPosition.tickUpper);
        expect(position.liquidity).toBe(expectedPosition.liquidity);
        expect(position.feeGrowthInside0LastX128).toBe(expectedPosition.feeGrowthInside0LastX128);
        expect(position.feeGrowthInside1LastX128).toBe(expectedPosition.feeGrowthInside1LastX128);
        expect(position.tokensOwed0).toBe(expectedPosition.tokensOwed0);
        expect(position.tokensOwed1).toBe(expectedPosition.tokensOwed1);
        expect(position.platform).toBe(expectedPosition.platform);
        expect(position.platformName).toBe(expectedPosition.platformName);
      });

      it('should return correct pool data count', async () => {
        const result = await adapter.getPositions(testAddress, env.provider);
        const poolAddresses = Object.keys(result.poolData);

        expect(poolAddresses).toHaveLength(1);
      });

      it('should return pool data with correct structure', async () => {
        const result = await adapter.getPositions(testAddress, env.provider);
        const poolAddress = Object.keys(result.poolData)[0];
        const poolData = result.poolData[poolAddress];

        // Test pool data structure
        expect(poolData.poolAddress).toBe(expectedPoolData.poolAddress);
        expect(poolData.token0).toEqual(expectedPoolData.token0);
        expect(poolData.token1).toEqual(expectedPoolData.token1);
        expect(poolData.sqrtPriceX96).toBe(expectedPoolData.sqrtPriceX96);
        expect(poolData.tick).toBe(expectedPoolData.tick);
        expect(poolData.fee).toBe(expectedPoolData.fee);
        expect(poolData.liquidity).toBe(expectedPoolData.liquidity);
      });

      it('should include tick data in pool data', async () => {
        const result = await adapter.getPositions(testAddress, env.provider);
        const poolAddress = Object.keys(result.poolData)[0];
        const poolData = result.poolData[poolAddress];

        expect(poolData.ticks).toBeDefined();
        expect(poolData.ticks[expectedPosition.tickLower]).toEqual(expectedPoolData.ticks[expectedPosition.tickLower]);
        expect(poolData.ticks[expectedPosition.tickUpper]).toEqual(expectedPoolData.ticks[expectedPosition.tickUpper]);
      });

      it('should return empty data for address with no positions', async () => {
        // Use a different signer that has no positions
        const result = await adapter.getPositions(env.signers[4].address, env.provider);

        expect(result.positions).toEqual([]);
        expect(result.poolData).toEqual({});
      });

      it('should cache pool data for multiple positions in same pool', async () => {
        // Create a second real position from owner's wallet (assets were kept there during setup)
        const owner = env.signers[0];
        const vaultAddress = await env.testVault.getAddress();

        // Get contracts
        const weth = new ethers.Contract(env.wethAddress, ['function balanceOf(address) view returns (uint256)', 'function approve(address, uint256) returns (bool)', 'function transfer(address, uint256) returns (bool)'], owner);
        const usdc = new ethers.Contract(env.usdcAddress, ['function balanceOf(address) view returns (uint256)', 'function approve(address, uint256) returns (bool)', 'function transfer(address, uint256) returns (bool)'], owner);

        // Check available balances in owner's wallet (40% was kept during setup)
        const ownerWethBalance = await weth.balanceOf(owner.address);
        const ownerUsdcBalance = await usdc.balanceOf(owner.address);


        // Use most of owner's remaining assets to create second position
        const wethAmount = ownerWethBalance / 2n; // 50% of owner's WETH
        const usdcAmount = ownerUsdcBalance / 2n; // 50% of owner's USDC

        // Approve position manager
        await (await weth.approve(env.uniswapV3.positionManagerAddress, wethAmount)).wait();
        await (await usdc.approve(env.uniswapV3.positionManagerAddress, usdcAmount)).wait();

        // Get current pool data and create position with different ticks
        const poolData = await adapter.fetchPoolData(env.wethAddress, env.usdcAddress, 500, env.provider);
        const tickSpacing = 10;
        const tickLower = Math.floor(poolData.tick / tickSpacing) * tickSpacing - tickSpacing * 5; // Different from first position
        const tickUpper = Math.floor(poolData.tick / tickSpacing) * tickSpacing + tickSpacing * 5;

        // Create position manager contract
        const POSITION_MANAGER_ABI = [
          'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
          'function safeTransferFrom(address from, address to, uint256 tokenId) external'
        ];
        const positionManager = new ethers.Contract(env.uniswapV3.positionManagerAddress, POSITION_MANAGER_ABI, owner);

        // Sort tokens to match pool order
        const [token0, token1, amount0Desired, amount1Desired] =
          env.wethAddress.toLowerCase() < env.usdcAddress.toLowerCase()
            ? [env.wethAddress, env.usdcAddress, wethAmount, usdcAmount]
            : [env.usdcAddress, env.wethAddress, usdcAmount, wethAmount];

        const mintParams = {
          token0,
          token1,
          fee: 500,
          tickLower,
          tickUpper,
          amount0Desired,
          amount1Desired,
          amount0Min: 0,
          amount1Min: 0,
          recipient: owner.address,
          deadline: Math.floor(Date.now() / 1000) + 3600,
        };

        // Create the second position
        const mintResult = await positionManager.mint.staticCall(mintParams);
        const secondPositionId = mintResult[0];
        await (await positionManager.mint(mintParams)).wait();

        // Transfer second position to vault using standard ERC721 function
        await (await positionManager.safeTransferFrom(owner.address, vaultAddress, secondPositionId)).wait();


        try {
          const result = await adapter.getPositions(testAddress, env.provider);

          // Should have 2 positions
          expect(result.positions).toHaveLength(2);

          // Should have only 1 pool (same pool, cached)
          const poolAddresses = Object.keys(result.poolData);
          expect(poolAddresses).toHaveLength(1);

          // Pool data should contain tick data for both positions
          const poolData = result.poolData[poolAddresses[0]];
          expect(poolData.ticks[env.testPosition.tickLower]).toBeDefined();
          expect(poolData.ticks[env.testPosition.tickUpper]).toBeDefined();
          expect(poolData.ticks[tickLower]).toBeDefined();
          expect(poolData.ticks[tickUpper]).toBeDefined();

        } finally {
          // Clean up - transfer position back to owner and burn it
          try {
            // Transfer position back to owner first
            await (await positionManager.safeTransferFrom(vaultAddress, owner.address, secondPositionId)).wait();

            // Then burn it from owner's wallet
            const burnABI = ['function burn(uint256 tokenId) external payable'];
            const burnContract = new ethers.Contract(env.uniswapV3.positionManagerAddress, burnABI, owner);
            await (await burnContract.burn(secondPositionId)).wait();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      });

      it('should throw error if any position fails to process', async () => {
        // Mock fetchPoolData to fail for specific call
        const originalFetchPoolData = adapter.fetchPoolData;
        adapter.fetchPoolData = vi.fn().mockImplementation((token0, token1, fee, provider) => {
          // Fail on first call, succeed on others
          if (adapter.fetchPoolData.mock.calls.length === 1) {
            throw new Error('Mocked pool data failure');
          }
          return originalFetchPoolData.call(adapter, token0, token1, fee, provider);
        });

        try {
          await expect(
            adapter.getPositions(testAddress, env.provider)
          ).rejects.toThrow('Failed to process 1 position(s): Position');

        } finally {
          // Restore original function
          adapter.fetchPoolData = originalFetchPoolData;
        }
      });
    });
  });

  describe('isPositionInRange', () => {
    describe('Success Cases', () => {
      it('should return true when current tick is within range', () => {
        const currentTick = 100;
        const tickLower = 50;
        const tickUpper = 150;

        const result = adapter.isPositionInRange(currentTick, tickLower, tickUpper);
        expect(result).toBe(true);
      });

      it('should return true when current tick equals lower tick', () => {
        const currentTick = 50;
        const tickLower = 50;
        const tickUpper = 150;

        const result = adapter.isPositionInRange(currentTick, tickLower, tickUpper);
        expect(result).toBe(true);
      });

      it('should return true when current tick equals upper tick', () => {
        const currentTick = 150;
        const tickLower = 50;
        const tickUpper = 150;

        const result = adapter.isPositionInRange(currentTick, tickLower, tickUpper);
        expect(result).toBe(true);
      });

      it('should return false when current tick is below range', () => {
        const currentTick = 40;
        const tickLower = 50;
        const tickUpper = 150;

        const result = adapter.isPositionInRange(currentTick, tickLower, tickUpper);
        expect(result).toBe(false);
      });

      it('should return false when current tick is above range', () => {
        const currentTick = 160;
        const tickLower = 50;
        const tickUpper = 150;

        const result = adapter.isPositionInRange(currentTick, tickLower, tickUpper);
        expect(result).toBe(false);
      });

      it('should work with negative ticks', () => {
        const currentTick = -100;
        const tickLower = -200;
        const tickUpper = -50;

        const result = adapter.isPositionInRange(currentTick, tickLower, tickUpper);
        expect(result).toBe(true);
      });

      it('should work with large tick values', () => {
        const currentTick = 887272;
        const tickLower = 887270;
        const tickUpper = 887280;

        const result = adapter.isPositionInRange(currentTick, tickLower, tickUpper);
        expect(result).toBe(true);
      });
    });

    describe('Error Cases', () => {
      it('should throw error when currentTick is not a number', () => {
        expect(() => adapter.isPositionInRange('100', 50, 150)).toThrow('Invalid currentTick: must be a number');
        expect(() => adapter.isPositionInRange(null, 50, 150)).toThrow('Invalid currentTick: must be a number');
        expect(() => adapter.isPositionInRange(undefined, 50, 150)).toThrow('Invalid currentTick: must be a number');
        expect(() => adapter.isPositionInRange({}, 50, 150)).toThrow('Invalid currentTick: must be a number');
        expect(() => adapter.isPositionInRange([], 50, 150)).toThrow('Invalid currentTick: must be a number');
        expect(() => adapter.isPositionInRange(true, 50, 150)).toThrow('Invalid currentTick: must be a number');
        expect(() => adapter.isPositionInRange(NaN, 50, 150)).toThrow('Invalid currentTick: must be a number');
        expect(() => adapter.isPositionInRange(Infinity, 50, 150)).toThrow('Invalid currentTick: must be a number');
        expect(() => adapter.isPositionInRange(-Infinity, 50, 150)).toThrow('Invalid currentTick: must be a number');
      });

      it('should throw error when tickLower is not a number', () => {
        expect(() => adapter.isPositionInRange(100, '50', 150)).toThrow('Invalid tickLower: must be a number');
        expect(() => adapter.isPositionInRange(100, null, 150)).toThrow('Invalid tickLower: must be a number');
        expect(() => adapter.isPositionInRange(100, undefined, 150)).toThrow('Invalid tickLower: must be a number');
        expect(() => adapter.isPositionInRange(100, {}, 150)).toThrow('Invalid tickLower: must be a number');
        expect(() => adapter.isPositionInRange(100, [], 150)).toThrow('Invalid tickLower: must be a number');
        expect(() => adapter.isPositionInRange(100, true, 150)).toThrow('Invalid tickLower: must be a number');
        expect(() => adapter.isPositionInRange(100, NaN, 150)).toThrow('Invalid tickLower: must be a number');
        expect(() => adapter.isPositionInRange(100, Infinity, 150)).toThrow('Invalid tickLower: must be a number');
        expect(() => adapter.isPositionInRange(100, -Infinity, 150)).toThrow('Invalid tickLower: must be a number');
      });

      it('should throw error when tickUpper is not a number', () => {
        expect(() => adapter.isPositionInRange(100, 50, '150')).toThrow('Invalid tickUpper: must be a number');
        expect(() => adapter.isPositionInRange(100, 50, null)).toThrow('Invalid tickUpper: must be a number');
        expect(() => adapter.isPositionInRange(100, 50, undefined)).toThrow('Invalid tickUpper: must be a number');
        expect(() => adapter.isPositionInRange(100, 50, {})).toThrow('Invalid tickUpper: must be a number');
        expect(() => adapter.isPositionInRange(100, 50, [])).toThrow('Invalid tickUpper: must be a number');
        expect(() => adapter.isPositionInRange(100, 50, true)).toThrow('Invalid tickUpper: must be a number');
        expect(() => adapter.isPositionInRange(100, 50, NaN)).toThrow('Invalid tickUpper: must be a number');
        expect(() => adapter.isPositionInRange(100, 50, Infinity)).toThrow('Invalid tickUpper: must be a number');
        expect(() => adapter.isPositionInRange(100, 50, -Infinity)).toThrow('Invalid tickUpper: must be a number');
      });

      it('should throw error for first invalid parameter when multiple are invalid', () => {
        expect(() => adapter.isPositionInRange('100', '50', '150')).toThrow('Invalid currentTick: must be a number');
        expect(() => adapter.isPositionInRange(100, null, undefined)).toThrow('Invalid tickLower: must be a number');
      });

      it('should throw error when tickLower > tickUpper', () => {
        const currentTick = 100;
        const tickLower = 150;  // Higher than upper
        const tickUpper = 50;   // Lower than lower

        expect(() => adapter.isPositionInRange(currentTick, tickLower, tickUpper))
          .toThrow('Invalid tick range: tickLower must be less than tickUpper');
      });

      it('should throw error when tickLower equals tickUpper', () => {
        expect(() => adapter.isPositionInRange(100, 100, 100))
          .toThrow('Invalid tick range: tickLower must be less than tickUpper');
      });
    });

    describe('Special Cases', () => {
      it('should handle zero values correctly', () => {
        expect(adapter.isPositionInRange(0, -10, 10)).toBe(true);
        expect(adapter.isPositionInRange(0, 10, 20)).toBe(false);
        expect(adapter.isPositionInRange(0, -20, -10)).toBe(false);
      });

      it('should handle minimum safe tick spacing', () => {
        // Minimum tick spacing in Uniswap V3 is 1
        const currentTick = 100;
        const tickLower = 99;
        const tickUpper = 100;

        const result = adapter.isPositionInRange(currentTick, tickLower, tickUpper);
        expect(result).toBe(true);
      });

      it('should handle extreme tick values near limits', () => {
        // Uniswap V3 tick range is -887272 to 887272
        const minTick = -887272;
        const maxTick = 887272;

        expect(adapter.isPositionInRange(0, minTick, maxTick)).toBe(true);
        expect(adapter.isPositionInRange(minTick, minTick, maxTick)).toBe(true);
        expect(adapter.isPositionInRange(maxTick, minTick, maxTick)).toBe(true);
      });
    });
  });

  describe('calculatePriceFromSqrtPrice', () => {
    describe('Success Cases', () => {
      it('should calculate price for ETH/USDC pair', () => {
        const ethToken = {
          address: getTokenAddress('WETH', 1337), // Ganache fork WETH
          decimals: 18,
          symbol: 'WETH'
        };
        const usdcToken = {
          address: getTokenAddress('USDC', 1337), // Ganache fork USDC
          decimals: 6,
          symbol: 'USDC'
        };

        // ETH price exactly $4000 (calculated sqrtPriceX96)
        const sqrtPriceX96 = '5007918240960887653173817'; // Exactly 4000 USDC per ETH

        const price = adapter.calculatePriceFromSqrtPrice(sqrtPriceX96, ethToken, usdcToken);

        // Should return a Price object
        expect(price).toBeDefined();
        expect(typeof price).toBe('object');

        // Convert to number and check ETH price is reasonable
        const priceNum = parseFloat(price.toFixed(2));
        expect(priceNum).toBeGreaterThan(3900); // ETH > $3900
        expect(priceNum).toBeLessThan(4100);   // ETH < $4100
      });

      it('should calculate price for stablecoin pair close to 1', () => {
        const usdcToken = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6,
          symbol: 'USDC'
        };
        const usdtToken = {
          address: getTokenAddress('USD₮0', 1337),
          decimals: 6,
          symbol: 'USD₮0'
        };

        // Price close to 1:1 (sqrtPriceX96 for price ~1)
        const sqrtPriceX96 = '79228162514264337593543950336'; // sqrt(1) * 2^96

        const price = adapter.calculatePriceFromSqrtPrice(sqrtPriceX96, usdcToken, usdtToken);

        const priceNum = parseFloat(price.toFixed(6));
        expect(priceNum).toBeGreaterThan(0.9);
        expect(priceNum).toBeLessThan(1.1);
      });

      it('should handle inverted token pairs consistently', () => {
        const tokenA = {
          address: getTokenAddress('WETH', 1337),
          decimals: 18,
          symbol: 'WETH'
        };
        const tokenB = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6,
          symbol: 'USDC'
        };

        const sqrtPriceX96 = '1584563250285286751754897';

        const priceAB = adapter.calculatePriceFromSqrtPrice(sqrtPriceX96, tokenA, tokenB);
        const priceBA = adapter.calculatePriceFromSqrtPrice(sqrtPriceX96, tokenB, tokenA);

        const priceABNum = parseFloat(priceAB.toFixed(8));
        const priceBANum = parseFloat(priceBA.toFixed(8));

        // Prices should be reciprocals (within small tolerance for floating point)
        const product = priceABNum * priceBANum;
        expect(product).toBeGreaterThan(0.99);
        expect(product).toBeLessThan(1.01);
      });


      it('should work with minimal token metadata', () => {
        const tokenA = {
          address: getTokenAddress('WETH', 1337),
          decimals: 18
          // No symbol or name
        };
        const tokenB = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6
          // No symbol or name
        };

        const sqrtPriceX96 = '79228162514264337593543950336';

        const price = adapter.calculatePriceFromSqrtPrice(sqrtPriceX96, tokenA, tokenB);

        expect(price).toBeDefined();
        expect(typeof price).toBe('object');
        expect(parseFloat(price.toFixed(6))).toBeGreaterThan(0);
      });
    });

    describe('Error Cases', () => {
      const validTokenA = {
        address: getTokenAddress('WETH', 1337),
        decimals: 18,
        symbol: 'WETH'
      };
      const validTokenB = {
        address: getTokenAddress('USDC', 1337),
        decimals: 6,
        symbol: 'USDC'
      };

      it('should throw error for non-string sqrtPriceX96 values', () => {
        expect(() => adapter.calculatePriceFromSqrtPrice(null, validTokenA, validTokenB))
          .toThrow('sqrtPriceX96 must be a string');
        expect(() => adapter.calculatePriceFromSqrtPrice(undefined, validTokenA, validTokenB))
          .toThrow('sqrtPriceX96 must be a string');
        expect(() => adapter.calculatePriceFromSqrtPrice(123456, validTokenA, validTokenB))
          .toThrow('sqrtPriceX96 must be a string');
        expect(() => adapter.calculatePriceFromSqrtPrice({}, validTokenA, validTokenB))
          .toThrow('sqrtPriceX96 must be a string');
        expect(() => adapter.calculatePriceFromSqrtPrice([], validTokenA, validTokenB))
          .toThrow('sqrtPriceX96 must be a string');
      });

      it('should throw error for invalid sqrtPriceX96 string values', () => {
        expect(() => adapter.calculatePriceFromSqrtPrice('', validTokenA, validTokenB))
          .toThrow('Invalid sqrtPriceX96 value');
        expect(() => adapter.calculatePriceFromSqrtPrice('0', validTokenA, validTokenB))
          .toThrow('Invalid sqrtPriceX96 value');
        expect(() => adapter.calculatePriceFromSqrtPrice('Claude is an awesome AI coder', validTokenA, validTokenB))
          .toThrow('Invalid sqrtPriceX96: must be a valid numeric string');
        expect(() => adapter.calculatePriceFromSqrtPrice('123abc', validTokenA, validTokenB))
          .toThrow('Invalid sqrtPriceX96: must be a valid numeric string');
        expect(() => adapter.calculatePriceFromSqrtPrice('-123', validTokenA, validTokenB))
          .toThrow('Invalid sqrtPriceX96: must be a valid numeric string');
      });

      it('should throw error for missing token information', () => {
        const validSqrtPrice = '79228162514264337593543950336';

        expect(() => adapter.calculatePriceFromSqrtPrice(validSqrtPrice, null, validTokenB))
          .toThrow('Missing required token information');
        expect(() => adapter.calculatePriceFromSqrtPrice(validSqrtPrice, undefined, validTokenB))
          .toThrow('Missing required token information');
        expect(() => adapter.calculatePriceFromSqrtPrice(validSqrtPrice, validTokenA, null))
          .toThrow('Missing required token information');
        expect(() => adapter.calculatePriceFromSqrtPrice(validSqrtPrice, validTokenA, undefined))
          .toThrow('Missing required token information');
      });

      it('should throw error for missing token addresses', () => {
        const validSqrtPrice = '79228162514264337593543950336';
        const tokenMissingAddress = { decimals: 18, symbol: 'TEST' };

        expect(() => adapter.calculatePriceFromSqrtPrice(validSqrtPrice, tokenMissingAddress, validTokenB))
          .toThrow('baseToken.address is required');
        expect(() => adapter.calculatePriceFromSqrtPrice(validSqrtPrice, validTokenA, tokenMissingAddress))
          .toThrow('quoteToken.address is required');
      });

      it('should throw error for invalid token addresses', () => {
        const validSqrtPrice = '79228162514264337593543950336';
        const invalidAddressToken = { address: 'invalid-address', decimals: 18, symbol: 'TEST' };

        expect(() => adapter.calculatePriceFromSqrtPrice(validSqrtPrice, invalidAddressToken, validTokenB))
          .toThrow('Invalid baseToken.address: invalid-address');
        expect(() => adapter.calculatePriceFromSqrtPrice(validSqrtPrice, validTokenA, invalidAddressToken))
          .toThrow('Invalid quoteToken.address: invalid-address');
      });

      it('should throw error for invalid baseToken decimals', () => {
        const validSqrtPrice = '79228162514264337593543950336';

        const invalidTokens = [
          { address: getTokenAddress('WETH', 1337), decimals: 'not-a-number', symbol: 'TEST' },
          { address: getTokenAddress('WETH', 1337), decimals: NaN, symbol: 'TEST' },
          { address: getTokenAddress('WETH', 1337), decimals: Infinity, symbol: 'TEST' },
          { address: getTokenAddress('WETH', 1337), decimals: -Infinity, symbol: 'TEST' },
          { address: getTokenAddress('WETH', 1337), decimals: -1, symbol: 'TEST' },
          { address: getTokenAddress('WETH', 1337), decimals: 256, symbol: 'TEST' }
        ];

        invalidTokens.forEach(invalidToken => {
          expect(() => adapter.calculatePriceFromSqrtPrice(validSqrtPrice, invalidToken, validTokenB))
            .toThrow('baseToken.decimals must be a finite number between 0 and 255');
        });
      });

      it('should throw error for invalid quoteToken decimals', () => {
        const validSqrtPrice = '79228162514264337593543950336';

        const invalidTokens = [
          { address: getTokenAddress('USDC', 1337), decimals: 'not-a-number', symbol: 'TEST' },
          { address: getTokenAddress('USDC', 1337), decimals: NaN, symbol: 'TEST' },
          { address: getTokenAddress('USDC', 1337), decimals: Infinity, symbol: 'TEST' },
          { address: getTokenAddress('USDC', 1337), decimals: -Infinity, symbol: 'TEST' },
          { address: getTokenAddress('USDC', 1337), decimals: -1, symbol: 'TEST' },
          { address: getTokenAddress('USDC', 1337), decimals: 256, symbol: 'TEST' }
        ];

        invalidTokens.forEach(invalidToken => {
          expect(() => adapter.calculatePriceFromSqrtPrice(validSqrtPrice, validTokenA, invalidToken))
            .toThrow('quoteToken.decimals must be a finite number between 0 and 255');
        });
      });
    });
  });

  describe('tickToPrice', () => {
    describe('Success Cases', () => {
      it('should calculate price for tick 0 (1:1 ratio)', () => {
        const usdcToken = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6,
          symbol: 'USDC'
        };
        const ethToken = {
          address: getTokenAddress('WETH', 1337),
          decimals: 18,
          symbol: 'WETH'
        };

        // Tick 0 = 1:1 price ratio - use USDC/WETH to get a readable price around 1e12
        const tick = 0;

        const price = adapter.tickToPrice(tick, usdcToken, ethToken);

        // Should return a Price object
        expect(price).toBeDefined();
        expect(typeof price).toBe('object');

        // Tick 0 with USDC(6 decimals)/WETH(18 decimals) gives 1e-12 (1 USDC = 1e-12 WETH)
        const priceNum = parseFloat(price.toSignificant(18));
        expect(priceNum).toBeCloseTo(1e-12, 15); // 1e-12 with high precision
      });

      it('should calculate price for positive tick', () => {
        const ethToken = {
          address: getTokenAddress('WETH', 1337),
          decimals: 18,
          symbol: 'WETH'
        };
        const usdcToken = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6,
          symbol: 'USDC'
        };

        // Positive tick = higher price
        const tick = 200000; // Arbitrary positive tick

        const price = adapter.tickToPrice(tick, ethToken, usdcToken);

        expect(price).toBeDefined();
        expect(typeof price).toBe('object');

        const priceNum = parseFloat(price.toSignificant(6));
        expect(priceNum).toBeGreaterThan(0);
        expect(Number.isFinite(priceNum)).toBe(true);
      });

      it('should calculate price for negative tick', () => {
        const ethToken = {
          address: getTokenAddress('WETH', 1337),
          decimals: 18,
          symbol: 'WETH'
        };
        const usdcToken = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6,
          symbol: 'USDC'
        };

        // Negative tick = lower price
        const tick = -200000; // Arbitrary negative tick

        const price = adapter.tickToPrice(tick, ethToken, usdcToken);

        expect(price).toBeDefined();
        expect(typeof price).toBe('object');

        const priceNum = parseFloat(price.toSignificant(18));
        expect(priceNum).toBeGreaterThan(0);
        expect(Number.isFinite(priceNum)).toBe(true);
      });

      it('should handle inverted token pairs consistently', () => {
        const tokenA = {
          address: getTokenAddress('WETH', 1337),
          decimals: 18,
          symbol: 'WETH'
        };
        const tokenB = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6,
          symbol: 'USDC'
        };

        const tick = 100000;

        const priceAB = adapter.tickToPrice(tick, tokenA, tokenB);
        const priceBA = adapter.tickToPrice(tick, tokenB, tokenA);

        const priceABNum = parseFloat(priceAB.toSignificant(18));
        const priceBANum = parseFloat(priceBA.toSignificant(18));

        // Prices should be reciprocals (within small tolerance)
        const product = priceABNum * priceBANum;
        expect(product).toBeGreaterThan(0.99);
        expect(product).toBeLessThan(1.01);
      });

      it('should work with minimal token metadata', () => {
        const tokenA = {
          address: getTokenAddress('WETH', 1337),
          decimals: 18
          // No symbol or name
        };
        const tokenB = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6
          // No symbol or name
        };

        const tick = 0;

        const price = adapter.tickToPrice(tick, tokenA, tokenB);

        expect(price).toBeDefined();
        expect(typeof price).toBe('object');
        expect(parseFloat(price.toSignificant(18))).toBeGreaterThan(0);
      });
    });

    describe('Error Cases', () => {
      const validTokenA = {
        address: getTokenAddress('WETH', 1337),
        decimals: 18,
        symbol: 'WETH'
      };
      const validTokenB = {
        address: getTokenAddress('USDC', 1337),
        decimals: 6,
        symbol: 'USDC'
      };

      it('should throw error for invalid tick values', () => {
        expect(() => adapter.tickToPrice('not-a-number', validTokenA, validTokenB))
          .toThrow('Invalid tick value');
        expect(() => adapter.tickToPrice(null, validTokenA, validTokenB))
          .toThrow('Invalid tick value');
        expect(() => adapter.tickToPrice(undefined, validTokenA, validTokenB))
          .toThrow('Invalid tick value');
        expect(() => adapter.tickToPrice(NaN, validTokenA, validTokenB))
          .toThrow('Invalid tick value');
        expect(() => adapter.tickToPrice(Infinity, validTokenA, validTokenB))
          .toThrow('Invalid tick value');
        expect(() => adapter.tickToPrice(-Infinity, validTokenA, validTokenB))
          .toThrow('Invalid tick value');
      });

      it('should throw error for missing token information', () => {
        const validTick = 0;

        expect(() => adapter.tickToPrice(validTick, null, validTokenB))
          .toThrow('Missing required token information');
        expect(() => adapter.tickToPrice(validTick, undefined, validTokenB))
          .toThrow('Missing required token information');
        expect(() => adapter.tickToPrice(validTick, validTokenA, null))
          .toThrow('Missing required token information');
        expect(() => adapter.tickToPrice(validTick, validTokenA, undefined))
          .toThrow('Missing required token information');
      });

      it('should throw error for missing token addresses', () => {
        const validTick = 0;
        const tokenMissingAddress = { decimals: 18, symbol: 'TEST' };

        expect(() => adapter.tickToPrice(validTick, tokenMissingAddress, validTokenB))
          .toThrow('baseToken.address is required');
        expect(() => adapter.tickToPrice(validTick, validTokenA, tokenMissingAddress))
          .toThrow('quoteToken.address is required');
      });

      it('should throw error for invalid token addresses', () => {
        const validTick = 0;
        const invalidAddressToken = { address: 'invalid-address', decimals: 18, symbol: 'TEST' };

        expect(() => adapter.tickToPrice(validTick, invalidAddressToken, validTokenB))
          .toThrow('Invalid baseToken.address: invalid-address');
        expect(() => adapter.tickToPrice(validTick, validTokenA, invalidAddressToken))
          .toThrow('Invalid quoteToken.address: invalid-address');
      });

      it('should throw error for invalid baseToken decimals', () => {
        const validTick = 0;

        const invalidTokens = [
          { address: getTokenAddress('WETH', 1337), decimals: 'not-a-number', symbol: 'TEST' },
          { address: getTokenAddress('WETH', 1337), decimals: NaN, symbol: 'TEST' },
          { address: getTokenAddress('WETH', 1337), decimals: Infinity, symbol: 'TEST' },
          { address: getTokenAddress('WETH', 1337), decimals: -Infinity, symbol: 'TEST' },
          { address: getTokenAddress('WETH', 1337), decimals: -1, symbol: 'TEST' },
          { address: getTokenAddress('WETH', 1337), decimals: 256, symbol: 'TEST' }
        ];

        invalidTokens.forEach(invalidToken => {
          expect(() => adapter.tickToPrice(validTick, invalidToken, validTokenB))
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
          expect(() => adapter.tickToPrice(validTick, validTokenA, invalidToken))
            .toThrow('quoteToken.decimals must be a finite number between 0 and 255');
        });
      });
    });

    describe('Special Cases', () => {
      it('should handle extreme tick values near limits', () => {
        const tokenA = {
          address: getTokenAddress('WETH', 1337),
          decimals: 18,
          symbol: 'WETH'
        };
        const tokenB = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6,
          symbol: 'USDC'
        };

        // Uniswap V3 tick range is approximately -887272 to 887272
        const maxTick = 887272;
        const minTick = -887272;

        expect(() => adapter.tickToPrice(maxTick, tokenA, tokenB)).not.toThrow();
        expect(() => adapter.tickToPrice(minTick, tokenA, tokenB)).not.toThrow();

        const maxPrice = adapter.tickToPrice(maxTick, tokenA, tokenB);
        const minPrice = adapter.tickToPrice(minTick, tokenA, tokenB);

        expect(parseFloat(maxPrice.toSignificant(6))).toBeGreaterThan(0);
        // Min tick (-887272) results in extremely small price that may be 0 when parsed
        const minPriceNum = parseFloat(minPrice.toSignificant(18));
        expect(minPriceNum).toBeGreaterThanOrEqual(0); // Allow 0 for extreme minimum
      });

      it('should handle zero tick consistently', () => {
        const tokenA = {
          address: getTokenAddress('WETH', 1337),
          decimals: 18,
          symbol: 'WETH'
        };
        const tokenB = {
          address: getTokenAddress('USDC', 1337),
          decimals: 6,
          symbol: 'USDC'
        };

        const price1 = adapter.tickToPrice(0, tokenA, tokenB);
        const price2 = adapter.tickToPrice(0, tokenA, tokenB);

        // Should be deterministic
        expect(price1.toSignificant(18)).toBe(price2.toSignificant(18));
      });
    });
  });

  describe('calculateUncollectedFees', () => {
    describe('Success Cases', () => {
      it('should return zero fees for fresh position with no swaps', async () => {
        // Get real position data from our test environment
        const vaultAddress = await env.testVault.getAddress();
        const positions = await adapter.getPositions(vaultAddress, env.provider);

        expect(positions.positions).toBeDefined();
        expect(positions.positions.length).toBeGreaterThan(0);

        const position = positions.positions[0];
        const poolAddress = position.pool;
        const poolData = positions.poolData[poolAddress];

        expect(poolData).toBeDefined();
        expect(poolData.token0).toBeDefined();
        expect(poolData.token1).toBeDefined();

        // Calculate fees with real data - should be 0 for fresh position
        const result = adapter.calculateUncollectedFees(position, poolData);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(typeof result[0]).toBe('bigint');
        expect(typeof result[1]).toBe('bigint');
        expect(result[0]).toBe(0n);
        expect(result[1]).toBe(0n);

      });

      it('should calculate fees after swaps generate fee growth', async () => {
        // Get initial position and pool data
        const vaultAddress = await env.testVault.getAddress();
        const initialPositions = await adapter.getPositions(vaultAddress, env.provider);
        const position = initialPositions.positions[0];
        const poolAddress = position.pool;
        const initialPoolData = initialPositions.poolData[poolAddress];

        // Verify we start with zero fees
        const initialFees = adapter.calculateUncollectedFees(
          position,
          initialPoolData
        );
        expect(initialFees[0]).toBe(0n);
        expect(initialFees[1]).toBe(0n);

        // Set up for swaps - use a different account each time to avoid nonce issues
        // We'll use account[2] since account[0] is the owner and account[1] might be used elsewhere
        const swapperWallet = new ethers.Wallet(env.accounts[2].privateKey, env.provider);

        // Get WETH and USDC addresses from our environment
        const wethAddress = getTokenAddress('WETH', 1337);
        const usdcAddress = getTokenAddress('USDC', 1337);

        // Simple WETH ABI with deposit function
        const wethABI = [
          'function deposit() external payable',
          'function balanceOf(address owner) external view returns (uint256)',
          'function transfer(address to, uint256 value) external returns (bool)',
          'function approve(address spender, uint256 value) external returns (bool)'
        ];

        // Create contract instances
        const wethContract = new ethers.Contract(wethAddress, wethABI, swapperWallet);
        const usdcContract = new ethers.Contract(usdcAddress, adapter.erc20ABI, swapperWallet);
        const swapRouter = new ethers.Contract(adapter.addresses.routerAddress, adapter.swapRouterABI, swapperWallet);

        // Wrap some ETH to WETH (1 ETH)
        const wrapAmount = ethers.parseEther('1');
        const wrapTx = await wethContract.deposit({ value: wrapAmount });
        await wrapTx.wait();

        // Get the current nonce before approve transaction
        let currentNonce = await env.provider.getTransactionCount(swapperWallet.address);

        // Approve router to spend WETH - wait for confirmation like generate_fees.js
        const approveTx = await wethContract.approve(adapter.addresses.routerAddress, wrapAmount, {
          nonce: currentNonce
        });
        await approveTx.wait();

        // Execute swap: WETH -> USDC using pattern from generate_fees.js
        const swapParams = {
          tokenIn: wethAddress,
          tokenOut: usdcAddress,
          fee: position.fee, // Use the same fee tier as our position
          recipient: swapperWallet.address,
          deadline: Math.floor(Date.now() / 1000) + 1200, // 20 minutes from now
          amountIn: wrapAmount,
          amountOutMinimum: 0, // Accept any amount of USDC
          sqrtPriceLimitX96: 0 // No price limit
        };

        // Get fresh nonce for swap transaction
        currentNonce = await env.provider.getTransactionCount(swapperWallet.address);

        // Use high gas price to avoid underpriced transaction errors
        const currentGasPrice = await env.provider.getFeeData();
        const safeGasPrice = (currentGasPrice.gasPrice || ethers.parseUnits('100', 'gwei')) * 3n;

        const gasOptions = {
          nonce: currentNonce,
          gasPrice: safeGasPrice,
          gasLimit: 500000
        };

        const swapTx = await swapRouter.exactInputSingle(swapParams, gasOptions);
        await swapTx.wait();

        // Get USDC balance and swap some back to generate more fees
        const usdcBalance = await usdcContract.balanceOf(swapperWallet.address);
        const swapBackAmount = usdcBalance / 2n; // Swap back half

        if (swapBackAmount > 0) {
          // Get fresh nonce for approve-back transaction
          currentNonce = await env.provider.getTransactionCount(swapperWallet.address);

          const approveBackTx = await usdcContract.approve(adapter.addresses.routerAddress, swapBackAmount, {
            nonce: currentNonce
          });
          await approveBackTx.wait();

          const swapBackParams = {
            tokenIn: usdcAddress,
            tokenOut: wethAddress,
            fee: position.fee,
            recipient: swapperWallet.address,
            deadline: Math.floor(Date.now() / 1000) + 1200,
            amountIn: swapBackAmount,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
          };

          // Get fresh nonce for swap-back transaction
          currentNonce = await env.provider.getTransactionCount(swapperWallet.address);

          const gasOptions2 = {
            nonce: currentNonce,
            gasPrice: safeGasPrice, // Reuse same gas price
            gasLimit: 500000
          };

          const swapBackTx = await swapRouter.exactInputSingle(swapBackParams, gasOptions2);
          await swapBackTx.wait();
        }

        // Get updated pool data after swaps
        const updatedPoolData = await adapter.fetchPoolData(
          initialPoolData.token0.address,
          initialPoolData.token1.address,
          position.fee,
          env.provider
        );

        // Also fetch the tick data for the position's ticks
        const tickData = await adapter.fetchTickData(
          updatedPoolData.poolAddress,
          position.tickLower,
          position.tickUpper,
          env.provider
        );

        // Add tick data to pool data in the correct format (indexed by tick number)
        updatedPoolData.ticks = {
          [position.tickLower]: tickData.tickLower,
          [position.tickUpper]: tickData.tickUpper
        };

        // Verify fee growth has occurred
        expect(BigInt(updatedPoolData.feeGrowthGlobal0X128)).toBeGreaterThan(
          BigInt(initialPoolData.feeGrowthGlobal0X128)
        );

        // Calculate fees with updated pool data
        const updatedFees = adapter.calculateUncollectedFees(
          position,
          updatedPoolData
        );

        // Should now have non-zero fees (at least for one token)
        const hasFees = updatedFees[0] > 0n || updatedFees[1] > 0n;
        expect(hasFees).toBe(true);

        // Verify return structure
        expect(Array.isArray(updatedFees)).toBe(true);
        expect(updatedFees).toHaveLength(2);
        expect(typeof updatedFees[0]).toBe('bigint');
        expect(typeof updatedFees[1]).toBe('bigint');

        // Fees should be non-negative
        expect(updatedFees[0]).toBeGreaterThanOrEqual(0n);
        expect(updatedFees[1]).toBeGreaterThanOrEqual(0n);

      }, 60000); // Longer timeout for swap transactions

      it('should handle positions with existing tokensOwed (claimed but not collected fees)', async () => {
        // Get position data
        const vaultAddress = await env.testVault.getAddress();
        const positions = await adapter.getPositions(vaultAddress, env.provider);
        const position = positions.positions[0];
        const poolData = positions.poolData[position.pool];

        // Create a modified position with some pre-existing tokensOwed
        // This simulates someone calling collect() to claim fees but not transferring them yet
        const positionWithOwed = {
          ...position,
          tokensOwed0: '1000000000000000000', // 1e18 (1.0 WETH)
          tokensOwed1: '500000000000' // 500 billion (with 6 decimals = 500k USDC)
        };

        const result = adapter.calculateUncollectedFees(
          positionWithOwed,
          poolData
        );

        // Should include the pre-existing owed amounts
        expect(result[0]).toBeGreaterThanOrEqual(1000000000000000000n);
        expect(result[1]).toBeGreaterThanOrEqual(500000000000n);

        // Verify structure
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(typeof result[0]).toBe('bigint');
        expect(typeof result[1]).toBe('bigint');

      });

    });

    describe('Error Cases', () => {
      // Get valid test data for error tests
      let validPosition, validPoolData;

      beforeEach(async () => {
        const vaultAddress = await env.testVault.getAddress();
        const positions = await adapter.getPositions(vaultAddress, env.provider);
        validPosition = positions.positions[0];
        validPoolData = positions.poolData[validPosition.pool];
      });

      it('should throw error when position parameter is missing or invalid type', () => {
        expect(() => adapter.calculateUncollectedFees(null, validPoolData))
          .toThrow('Position parameter is required');
        expect(() => adapter.calculateUncollectedFees(undefined, validPoolData))
          .toThrow('Position parameter is required');
      });

      it('should throw error when poolData parameter is missing or invalid type', () => {
        expect(() => adapter.calculateUncollectedFees(validPosition, null))
          .toThrow('poolData parameter is required');
        expect(() => adapter.calculateUncollectedFees(validPosition, undefined))
          .toThrow('poolData parameter is required');
      });


      it('should throw error when position.liquidity is missing or invalid', () => {
        const missingLiquidity = { ...validPosition };
        delete missingLiquidity.liquidity;
        expect(() => adapter.calculateUncollectedFees(missingLiquidity, validPoolData))
          .toThrow('position.liquidity is required');

        expect(() => adapter.calculateUncollectedFees({ ...validPosition, liquidity: null }, validPoolData))
          .toThrow('position.liquidity is required');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, liquidity: 123 }, validPoolData))
          .toThrow('position.liquidity must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, liquidity: {} }, validPoolData))
          .toThrow('position.liquidity must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, liquidity: [] }, validPoolData))
          .toThrow('position.liquidity must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, liquidity: true }, validPoolData))
          .toThrow('position.liquidity must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, liquidity: 'not-a-number' }, validPoolData))
          .toThrow('Invalid position.liquidity: must be a valid numeric string');
      });

      it('should throw error when position.feeGrowthInside0LastX128 is missing or invalid', () => {
        const missingFeeGrowth = { ...validPosition };
        delete missingFeeGrowth.feeGrowthInside0LastX128;
        expect(() => adapter.calculateUncollectedFees(missingFeeGrowth, validPoolData))
          .toThrow('position.feeGrowthInside0LastX128 is required');

        expect(() => adapter.calculateUncollectedFees({ ...validPosition, feeGrowthInside0LastX128: null }, validPoolData))
          .toThrow('position.feeGrowthInside0LastX128 is required');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, feeGrowthInside0LastX128: 123 }, validPoolData))
          .toThrow('position.feeGrowthInside0LastX128 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, feeGrowthInside0LastX128: {} }, validPoolData))
          .toThrow('position.feeGrowthInside0LastX128 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, feeGrowthInside0LastX128: [] }, validPoolData))
          .toThrow('position.feeGrowthInside0LastX128 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, feeGrowthInside0LastX128: true }, validPoolData))
          .toThrow('position.feeGrowthInside0LastX128 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, feeGrowthInside0LastX128: 'invalid' }, validPoolData))
          .toThrow('Invalid position.feeGrowthInside0LastX128: must be a valid numeric string');
      });

      it('should throw error when position.feeGrowthInside1LastX128 is missing or invalid', () => {
        const missingFeeGrowth = { ...validPosition };
        delete missingFeeGrowth.feeGrowthInside1LastX128;
        expect(() => adapter.calculateUncollectedFees(missingFeeGrowth, validPoolData))
          .toThrow('position.feeGrowthInside1LastX128 is required');

        expect(() => adapter.calculateUncollectedFees({ ...validPosition, feeGrowthInside1LastX128: null }, validPoolData))
          .toThrow('position.feeGrowthInside1LastX128 is required');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, feeGrowthInside1LastX128: 123 }, validPoolData))
          .toThrow('position.feeGrowthInside1LastX128 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, feeGrowthInside1LastX128: {} }, validPoolData))
          .toThrow('position.feeGrowthInside1LastX128 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, feeGrowthInside1LastX128: [] }, validPoolData))
          .toThrow('position.feeGrowthInside1LastX128 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, feeGrowthInside1LastX128: true }, validPoolData))
          .toThrow('position.feeGrowthInside1LastX128 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, feeGrowthInside1LastX128: 'invalid' }, validPoolData))
          .toThrow('Invalid position.feeGrowthInside1LastX128: must be a valid numeric string');
      });

      it('should throw error when position.tokensOwed0 is missing or invalid', () => {
        const missingTokensOwed = { ...validPosition };
        delete missingTokensOwed.tokensOwed0;
        expect(() => adapter.calculateUncollectedFees(missingTokensOwed, validPoolData))
          .toThrow('position.tokensOwed0 is required');

        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tokensOwed0: null }, validPoolData))
          .toThrow('position.tokensOwed0 is required');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tokensOwed0: 123 }, validPoolData))
          .toThrow('position.tokensOwed0 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tokensOwed0: {} }, validPoolData))
          .toThrow('position.tokensOwed0 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tokensOwed0: [] }, validPoolData))
          .toThrow('position.tokensOwed0 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tokensOwed0: true }, validPoolData))
          .toThrow('position.tokensOwed0 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tokensOwed0: 'invalid' }, validPoolData))
          .toThrow('Invalid position.tokensOwed0: must be a valid numeric string');
      });

      it('should throw error when position.tokensOwed1 is missing or invalid', () => {
        const missingTokensOwed = { ...validPosition };
        delete missingTokensOwed.tokensOwed1;
        expect(() => adapter.calculateUncollectedFees(missingTokensOwed, validPoolData))
          .toThrow('position.tokensOwed1 is required');

        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tokensOwed1: null }, validPoolData))
          .toThrow('position.tokensOwed1 is required');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tokensOwed1: 123 }, validPoolData))
          .toThrow('position.tokensOwed1 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tokensOwed1: {} }, validPoolData))
          .toThrow('position.tokensOwed1 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tokensOwed1: [] }, validPoolData))
          .toThrow('position.tokensOwed1 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tokensOwed1: true }, validPoolData))
          .toThrow('position.tokensOwed1 must be a string');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tokensOwed1: 'invalid' }, validPoolData))
          .toThrow('Invalid position.tokensOwed1: must be a valid numeric string');
      });

      it('should throw error when position.tickLower is missing or invalid', () => {
        const missingTickLower = { ...validPosition };
        delete missingTickLower.tickLower;
        expect(() => adapter.calculateUncollectedFees(missingTickLower, validPoolData))
          .toThrow('position.tickLower is required');

        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickLower: null }, validPoolData))
          .toThrow('position.tickLower is required');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickLower: undefined }, validPoolData))
          .toThrow('position.tickLower is required');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickLower: 'invalid' }, validPoolData))
          .toThrow('position.tickLower must be a finite number');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickLower: {} }, validPoolData))
          .toThrow('position.tickLower must be a finite number');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickLower: [] }, validPoolData))
          .toThrow('position.tickLower must be a finite number');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickLower: true }, validPoolData))
          .toThrow('position.tickLower must be a finite number');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickLower: NaN }, validPoolData))
          .toThrow('position.tickLower must be a finite number');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickLower: Infinity }, validPoolData))
          .toThrow('position.tickLower must be a finite number');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickLower: -Infinity }, validPoolData))
          .toThrow('position.tickLower must be a finite number');
      });

      it('should throw error when position.tickUpper is missing or invalid', () => {
        const missingTickUpper = { ...validPosition };
        delete missingTickUpper.tickUpper;
        expect(() => adapter.calculateUncollectedFees(missingTickUpper, validPoolData))
          .toThrow('position.tickUpper is required');

        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickUpper: null }, validPoolData))
          .toThrow('position.tickUpper is required');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickUpper: undefined }, validPoolData))
          .toThrow('position.tickUpper is required');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickUpper: 'invalid' }, validPoolData))
          .toThrow('position.tickUpper must be a finite number');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickUpper: {} }, validPoolData))
          .toThrow('position.tickUpper must be a finite number');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickUpper: [] }, validPoolData))
          .toThrow('position.tickUpper must be a finite number');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickUpper: true }, validPoolData))
          .toThrow('position.tickUpper must be a finite number');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickUpper: NaN }, validPoolData))
          .toThrow('position.tickUpper must be a finite number');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickUpper: Infinity }, validPoolData))
          .toThrow('position.tickUpper must be a finite number');
        expect(() => adapter.calculateUncollectedFees({ ...validPosition, tickUpper: -Infinity }, validPoolData))
          .toThrow('position.tickUpper must be a finite number');
      });

      it('should throw error when poolData.tick is missing or invalid', () => {
        const missingTick = { ...validPoolData };
        delete missingTick.tick;
        expect(() => adapter.calculateUncollectedFees(validPosition, missingTick))
          .toThrow('poolData.tick is required');

        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, tick: null }))
          .toThrow('poolData.tick is required');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, tick: undefined }))
          .toThrow('poolData.tick is required');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, tick: 'invalid' }))
          .toThrow('poolData.tick must be a finite number');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, tick: {} }))
          .toThrow('poolData.tick must be a finite number');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, tick: [] }))
          .toThrow('poolData.tick must be a finite number');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, tick: true }))
          .toThrow('poolData.tick must be a finite number');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, tick: NaN }))
          .toThrow('poolData.tick must be a finite number');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, tick: Infinity }))
          .toThrow('poolData.tick must be a finite number');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, tick: -Infinity }))
          .toThrow('poolData.tick must be a finite number');
      });

      it('should throw error when poolData.feeGrowthGlobal0X128 is missing or invalid', () => {
        const missingFeeGrowth = { ...validPoolData };
        delete missingFeeGrowth.feeGrowthGlobal0X128;
        expect(() => adapter.calculateUncollectedFees(validPosition, missingFeeGrowth))
          .toThrow('poolData.feeGrowthGlobal0X128 is required');

        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, feeGrowthGlobal0X128: null }))
          .toThrow('poolData.feeGrowthGlobal0X128 is required');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, feeGrowthGlobal0X128: 123 }))
          .toThrow('poolData.feeGrowthGlobal0X128 must be a string');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, feeGrowthGlobal0X128: {} }))
          .toThrow('poolData.feeGrowthGlobal0X128 must be a string');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, feeGrowthGlobal0X128: [] }))
          .toThrow('poolData.feeGrowthGlobal0X128 must be a string');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, feeGrowthGlobal0X128: true }))
          .toThrow('poolData.feeGrowthGlobal0X128 must be a string');
      });

      it('should throw error when poolData.feeGrowthGlobal1X128 is missing or invalid', () => {
        const missingFeeGrowth = { ...validPoolData };
        delete missingFeeGrowth.feeGrowthGlobal1X128;
        expect(() => adapter.calculateUncollectedFees(validPosition, missingFeeGrowth))
          .toThrow('poolData.feeGrowthGlobal1X128 is required');

        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, feeGrowthGlobal1X128: null }))
          .toThrow('poolData.feeGrowthGlobal1X128 is required');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, feeGrowthGlobal1X128: 123 }))
          .toThrow('poolData.feeGrowthGlobal1X128 must be a string');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, feeGrowthGlobal1X128: {} }))
          .toThrow('poolData.feeGrowthGlobal1X128 must be a string');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, feeGrowthGlobal1X128: [] }))
          .toThrow('poolData.feeGrowthGlobal1X128 must be a string');
        expect(() => adapter.calculateUncollectedFees(validPosition, { ...validPoolData, feeGrowthGlobal1X128: true }))
          .toThrow('poolData.feeGrowthGlobal1X128 must be a string');
      });

      it('should throw error when poolData.ticks is missing or tick data is missing', () => {
        const missingTicks = { ...validPoolData };
        delete missingTicks.ticks;
        expect(() => adapter.calculateUncollectedFees(validPosition, missingTicks))
          .toThrow('poolData.ticks is required');

        // Missing tickLower data
        const missingTickLower = { ...validPoolData, ticks: {} };
        expect(() => adapter.calculateUncollectedFees(validPosition, missingTickLower))
          .toThrow(`Missing tick data for tickLower ${validPosition.tickLower}`);

        // Missing tickUpper data
        const missingTickUpper = {
          ...validPoolData,
          ticks: { [validPosition.tickLower]: validPoolData.ticks[validPosition.tickLower] }
        };
        expect(() => adapter.calculateUncollectedFees(validPosition, missingTickUpper))
          .toThrow(`Missing tick data for tickUpper ${validPosition.tickUpper}`);
      });

      it('should throw error when tick data contains invalid fee growth values', () => {
        // Invalid tickLowerData fee growth values
        const invalidTickLowerData = {
          ...validPoolData,
          ticks: {
            [validPosition.tickLower]: {
              ...validPoolData.ticks[validPosition.tickLower],
              feeGrowthOutside0X128: 'invalid'
            },
            [validPosition.tickUpper]: validPoolData.ticks[validPosition.tickUpper]
          }
        };
        expect(() => adapter.calculateUncollectedFees(validPosition, invalidTickLowerData))
          .toThrow('Invalid tickLowerData fee growth values: must be valid numeric strings');

        // Invalid tickUpperData fee growth values
        const invalidTickUpperData = {
          ...validPoolData,
          ticks: {
            [validPosition.tickLower]: validPoolData.ticks[validPosition.tickLower],
            [validPosition.tickUpper]: {
              ...validPoolData.ticks[validPosition.tickUpper],
              feeGrowthOutside1X128: 'invalid'
            }
          }
        };
        expect(() => adapter.calculateUncollectedFees(validPosition, invalidTickUpperData))
          .toThrow('Invalid tickUpperData fee growth values: must be valid numeric strings');
      });
    });

    describe('Special Cases', () => {
      let validPosition, validPoolData;

      beforeEach(async () => {
        const vaultAddress = await env.testVault.getAddress();
        const positions = await adapter.getPositions(vaultAddress, env.provider);
        validPosition = positions.positions[0];
        validPoolData = positions.poolData[validPosition.pool];
      });

      it('should calculate fees when position is out of range (below)', () => {
        // Create pool data where current tick is below position range
        const outOfRangePoolData = {
          ...validPoolData,
          tick: validPosition.tickLower - 100 // Current tick below position
        };

        const result = adapter.calculateUncollectedFees(validPosition, outOfRangePoolData);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(typeof result[0]).toBe('bigint');
        expect(typeof result[1]).toBe('bigint');
        expect(result[0]).toBeGreaterThanOrEqual(0n);
        expect(result[1]).toBeGreaterThanOrEqual(0n);
      });

      it('should calculate fees when position is out of range (above)', () => {
        // Create pool data where current tick is above position range
        const outOfRangePoolData = {
          ...validPoolData,
          tick: validPosition.tickUpper + 100 // Current tick above position
        };

        const result = adapter.calculateUncollectedFees(validPosition, outOfRangePoolData);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(typeof result[0]).toBe('bigint');
        expect(typeof result[1]).toBe('bigint');
        expect(result[0]).toBeGreaterThanOrEqual(0n);
        expect(result[1]).toBeGreaterThanOrEqual(0n);
      });

      it('should handle fee growth inside underflow correctly', () => {
        // Create scenario where fee growth inside calculation goes negative
        const underflowPoolData = {
          ...validPoolData,
          ticks: {
            [validPosition.tickLower]: {
              ...validPoolData.ticks[validPosition.tickLower],
              feeGrowthOutside0X128: '999999999999999999999999999999999999999',
              feeGrowthOutside1X128: '999999999999999999999999999999999999999'
            },
            [validPosition.tickUpper]: {
              ...validPoolData.ticks[validPosition.tickUpper],
              feeGrowthOutside0X128: '1000000000000000000000000000000000000000',
              feeGrowthOutside1X128: '1000000000000000000000000000000000000000'
            }
          }
        };

        const result = adapter.calculateUncollectedFees(validPosition, underflowPoolData);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(typeof result[0]).toBe('bigint');
        expect(typeof result[1]).toBe('bigint');
        expect(result[0]).toBeGreaterThanOrEqual(0n);
        expect(result[1]).toBeGreaterThanOrEqual(0n);
      });

      it('should handle fee growth delta underflow correctly', () => {
        // Create scenario where fee growth delta calculation goes negative
        // This happens when current fee growth is less than last recorded fee growth
        const deltaUnderflowPosition = {
          ...validPosition,
          feeGrowthInside0LastX128: '999999999999999999999999999999999999999',
          feeGrowthInside1LastX128: '999999999999999999999999999999999999999'
        };

        const deltaUnderflowPoolData = {
          ...validPoolData,
          feeGrowthGlobal0X128: '100000000000000000000000000000000000000',
          feeGrowthGlobal1X128: '100000000000000000000000000000000000000'
        };

        const result = adapter.calculateUncollectedFees(deltaUnderflowPosition, deltaUnderflowPoolData);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(typeof result[0]).toBe('bigint');
        expect(typeof result[1]).toBe('bigint');
        expect(result[0]).toBeGreaterThanOrEqual(0n);
        expect(result[1]).toBeGreaterThanOrEqual(0n);
      });
    });
  });

  describe('calculateTokenAmounts', () => {
    describe('Success Cases', () => {
      it('should calculate token amounts for a valid position', async () => {
        // Get real position data from test environment
        const vaultAddress = await env.testVault.getAddress();
        const positions = await adapter.getPositions(vaultAddress, env.provider);

        expect(positions.positions).toBeDefined();
        expect(positions.positions.length).toBeGreaterThan(0);

        const position = positions.positions[0];
        const poolAddress = position.pool;
        const poolData = positions.poolData[poolAddress];

        // Get token data
        const token0Data = {
          address: poolData.token0.address,
          decimals: poolData.token0.decimals
        };
        const token1Data = {
          address: poolData.token1.address,
          decimals: poolData.token1.decimals
        };

        // Calculate token amounts
        const result = await adapter.calculateTokenAmounts(
          position,
          poolData,
          token0Data,
          token1Data
        );

        // Verify structure
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(typeof result[0]).toBe('bigint');
        expect(typeof result[1]).toBe('bigint');

        // Verify non-negative
        expect(result[0]).toBeGreaterThanOrEqual(0n);
        expect(result[1]).toBeGreaterThanOrEqual(0n);

        // Verify against the known amounts from test position setup
        // The position was created with specific amount0 and amount1
        const expectedAmount0 = BigInt(env.testPosition.amount0);
        const expectedAmount1 = BigInt(env.testPosition.amount1);

        // The calculated amounts should match what was deposited within rounding tolerance
        // The SDK may have rounding differences of 1 unit due to integer math
        const tolerance = 1n;

        expect(result[0]).toBeGreaterThanOrEqual(expectedAmount0 - tolerance);
        expect(result[0]).toBeLessThanOrEqual(expectedAmount0 + tolerance);

        expect(result[1]).toBeGreaterThanOrEqual(expectedAmount1 - tolerance);
        expect(result[1]).toBeLessThanOrEqual(expectedAmount1 + tolerance);
      });

      it('should return [0n, 0n] for zero liquidity position', async () => {
        // Get valid pool data from environment for realistic test
        const vaultAddress = await env.testVault.getAddress();
        const positions = await adapter.getPositions(vaultAddress, env.provider);
        const poolData = positions.poolData[positions.positions[0].pool];

        // Create mock position with zero liquidity
        const zeroLiquidityPosition = {
          liquidity: '0',
          tickLower: -887220,
          tickUpper: 887220
        };

        const token0Data = {
          address: poolData.token0.address,
          decimals: poolData.token0.decimals
        };
        const token1Data = {
          address: poolData.token1.address,
          decimals: poolData.token1.decimals
        };

        const result = await adapter.calculateTokenAmounts(
          zeroLiquidityPosition,
          poolData,
          token0Data,
          token1Data
        );

        expect(result).toEqual([0n, 0n]);
      });

      it('should calculate amounts for position entirely below current tick', async () => {
        // Get pool data
        const vaultAddress = await env.testVault.getAddress();
        const positions = await adapter.getPositions(vaultAddress, env.provider);
        const poolData = positions.poolData[positions.positions[0].pool];

        // Create position with ticks below current tick
        // Fee tier 500 (0.05%) has tick spacing of 10
        const tickSpacing = 10;
        const currentTick = poolData.tick;

        // Round ticks to nearest valid tick spacing
        const tickLower = Math.floor((currentTick - 10000) / tickSpacing) * tickSpacing;
        const tickUpper = Math.floor((currentTick - 5000) / tickSpacing) * tickSpacing;

        const belowTickPosition = {
          liquidity: '1000000000000000000', // 1e18
          tickLower: tickLower,
          tickUpper: tickUpper
        };

        const token0Data = {
          address: poolData.token0.address,
          decimals: poolData.token0.decimals
        };
        const token1Data = {
          address: poolData.token1.address,
          decimals: poolData.token1.decimals
        };

        const result = await adapter.calculateTokenAmounts(
          belowTickPosition,
          poolData,
          token0Data,
          token1Data
        );

        // When position is entirely below current tick, it should contain only token1
        expect(result[0]).toBe(0n); // No token0
        expect(result[1]).toBeGreaterThan(0n); // All liquidity in token1
      });

      it('should calculate amounts for position entirely above current tick', async () => {
        // Get pool data
        const vaultAddress = await env.testVault.getAddress();
        const positions = await adapter.getPositions(vaultAddress, env.provider);
        const poolData = positions.poolData[positions.positions[0].pool];

        // Create position with ticks above current tick
        // Fee tier 500 (0.05%) has tick spacing of 10
        const tickSpacing = 10;
        const currentTick = poolData.tick;

        // Round ticks to nearest valid tick spacing
        const tickLower = Math.floor((currentTick + 5000) / tickSpacing) * tickSpacing;
        const tickUpper = Math.floor((currentTick + 10000) / tickSpacing) * tickSpacing;

        const aboveTickPosition = {
          liquidity: '1000000000000000000', // 1e18
          tickLower: tickLower,
          tickUpper: tickUpper
        };

        const token0Data = {
          address: poolData.token0.address,
          decimals: poolData.token0.decimals
        };
        const token1Data = {
          address: poolData.token1.address,
          decimals: poolData.token1.decimals
        };

        const result = await adapter.calculateTokenAmounts(
          aboveTickPosition,
          poolData,
          token0Data,
          token1Data
        );

        // When position is entirely above current tick, it should contain only token0
        expect(result[0]).toBeGreaterThan(0n); // All liquidity in token0
        expect(result[1]).toBe(0n); // No token1
      });
    });

    describe('Error Cases', () => {
      // Get valid test data for error tests
      let validPosition, validPoolData, validToken0Data, validToken1Data;

      beforeEach(async () => {
        const vaultAddress = await env.testVault.getAddress();
        const positions = await adapter.getPositions(vaultAddress, env.provider);
        validPosition = positions.positions[0];
        validPoolData = positions.poolData[validPosition.pool];
        validToken0Data = {
          address: validPoolData.token0.address,
          decimals: validPoolData.token0.decimals
        };
        validToken1Data = {
          address: validPoolData.token1.address,
          decimals: validPoolData.token1.decimals
        };
      });

      describe('Position parameter validation', () => {
        it('should throw error when position parameter is missing', async () => {
          await expect(
            adapter.calculateTokenAmounts(null, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('position parameter is required');

          await expect(
            adapter.calculateTokenAmounts(undefined, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('position parameter is required');
        });

        it('should throw error when position.liquidity is missing', async () => {
          const missingLiquidity = { ...validPosition };
          delete missingLiquidity.liquidity;

          await expect(
            adapter.calculateTokenAmounts(missingLiquidity, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('position.liquidity is required');

          await expect(
            adapter.calculateTokenAmounts({ ...validPosition, liquidity: null }, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('position.liquidity is required');

          await expect(
            adapter.calculateTokenAmounts({ ...validPosition, liquidity: undefined }, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('position.liquidity is required');
        });

        it('should throw error when position.liquidity is not a string', async () => {
          const invalidTypes = [123, true, {}, [], NaN, Infinity];

          for (const invalidType of invalidTypes) {
            await expect(
              adapter.calculateTokenAmounts({ ...validPosition, liquidity: invalidType }, validPoolData, validToken0Data, validToken1Data)
            ).rejects.toThrow('position.liquidity must be a string');
          }
        });

        it('should throw error when position.liquidity is not a valid numeric string', async () => {
          await expect(
            adapter.calculateTokenAmounts({ ...validPosition, liquidity: 'not-a-number' }, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('Invalid position.liquidity: must be a valid positive numeric string');

          await expect(
            adapter.calculateTokenAmounts({ ...validPosition, liquidity: '123.456' }, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('Invalid position.liquidity: must be a valid positive numeric string');

          await expect(
            adapter.calculateTokenAmounts({ ...validPosition, liquidity: '0x123' }, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('Invalid position.liquidity: must be a valid positive numeric string');
        });

        it('should throw error when position.liquidity is negative', async () => {
          await expect(
            adapter.calculateTokenAmounts({ ...validPosition, liquidity: '-100' }, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('Invalid position.liquidity: must be a valid positive numeric string');
        });

        it('should throw error when position.tickLower is missing or invalid', async () => {
          const missingTickLower = { ...validPosition };
          delete missingTickLower.tickLower;

          await expect(
            adapter.calculateTokenAmounts(missingTickLower, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('position.tickLower is required');

          await expect(
            adapter.calculateTokenAmounts({ ...validPosition, tickLower: null }, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('position.tickLower is required');

          await expect(
            adapter.calculateTokenAmounts({ ...validPosition, tickLower: undefined }, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('position.tickLower is required');

          const invalidTypes = ['string', true, {}, [], NaN, Infinity];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.calculateTokenAmounts({ ...validPosition, tickLower: invalidType }, validPoolData, validToken0Data, validToken1Data)
            ).rejects.toThrow('position.tickLower must be a valid number');
          }
        });

        it('should throw error when position.tickUpper is missing or invalid', async () => {
          const missingTickUpper = { ...validPosition };
          delete missingTickUpper.tickUpper;

          await expect(
            adapter.calculateTokenAmounts(missingTickUpper, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('position.tickUpper is required');

          await expect(
            adapter.calculateTokenAmounts({ ...validPosition, tickUpper: null }, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('position.tickUpper is required');

          await expect(
            adapter.calculateTokenAmounts({ ...validPosition, tickUpper: undefined }, validPoolData, validToken0Data, validToken1Data)
          ).rejects.toThrow('position.tickUpper is required');

          const invalidTypes = ['string', true, {}, [], NaN, Infinity];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.calculateTokenAmounts({ ...validPosition, tickUpper: invalidType }, validPoolData, validToken0Data, validToken1Data)
            ).rejects.toThrow('position.tickUpper must be a valid number');
          }
        });
      });

      describe('PoolData parameter validation', () => {
        it('should throw error when poolData parameter is missing', async () => {
          await expect(
            adapter.calculateTokenAmounts(validPosition, null, validToken0Data, validToken1Data)
          ).rejects.toThrow('poolData parameter is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, undefined, validToken0Data, validToken1Data)
          ).rejects.toThrow('poolData parameter is required');
        });

        it('should throw error when poolData.fee is missing or invalid', async () => {
          const missingFee = { ...validPoolData };
          delete missingFee.fee;

          await expect(
            adapter.calculateTokenAmounts(validPosition, missingFee, validToken0Data, validToken1Data)
          ).rejects.toThrow('poolData.fee is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, { ...validPoolData, fee: null }, validToken0Data, validToken1Data)
          ).rejects.toThrow('poolData.fee is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, { ...validPoolData, fee: undefined }, validToken0Data, validToken1Data)
          ).rejects.toThrow('poolData.fee is required');

          const invalidTypes = ['string', true, {}, [], NaN, Infinity];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.calculateTokenAmounts(validPosition, { ...validPoolData, fee: invalidType }, validToken0Data, validToken1Data)
            ).rejects.toThrow('poolData.fee must be a valid number');
          }
        });

        it('should throw error when poolData.sqrtPriceX96 is missing or invalid', async () => {
          const missingSqrtPrice = { ...validPoolData };
          delete missingSqrtPrice.sqrtPriceX96;

          await expect(
            adapter.calculateTokenAmounts(validPosition, missingSqrtPrice, validToken0Data, validToken1Data)
          ).rejects.toThrow('poolData.sqrtPriceX96 is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, { ...validPoolData, sqrtPriceX96: null }, validToken0Data, validToken1Data)
          ).rejects.toThrow('poolData.sqrtPriceX96 is required');

          const invalidTypes = [123, true, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.calculateTokenAmounts(validPosition, { ...validPoolData, sqrtPriceX96: invalidType }, validToken0Data, validToken1Data)
            ).rejects.toThrow('poolData.sqrtPriceX96 must be a string');
          }
        });

        it('should throw error when poolData.liquidity is missing or invalid', async () => {
          const missingLiquidity = { ...validPoolData };
          delete missingLiquidity.liquidity;

          await expect(
            adapter.calculateTokenAmounts(validPosition, missingLiquidity, validToken0Data, validToken1Data)
          ).rejects.toThrow('poolData.liquidity is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, { ...validPoolData, liquidity: null }, validToken0Data, validToken1Data)
          ).rejects.toThrow('poolData.liquidity is required');

          const invalidTypes = [123, true, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.calculateTokenAmounts(validPosition, { ...validPoolData, liquidity: invalidType }, validToken0Data, validToken1Data)
            ).rejects.toThrow('poolData.liquidity must be a string');
          }
        });

        it('should throw error when poolData.tick is missing or invalid', async () => {
          const missingTick = { ...validPoolData };
          delete missingTick.tick;

          await expect(
            adapter.calculateTokenAmounts(validPosition, missingTick, validToken0Data, validToken1Data)
          ).rejects.toThrow('poolData.tick is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, { ...validPoolData, tick: null }, validToken0Data, validToken1Data)
          ).rejects.toThrow('poolData.tick is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, { ...validPoolData, tick: undefined }, validToken0Data, validToken1Data)
          ).rejects.toThrow('poolData.tick is required');

          const invalidTypes = ['string', true, {}, [], NaN, Infinity];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.calculateTokenAmounts(validPosition, { ...validPoolData, tick: invalidType }, validToken0Data, validToken1Data)
            ).rejects.toThrow('poolData.tick must be a valid number');
          }
        });
      });

      describe('Token data validation', () => {
        it('should throw error when token0Data parameter is missing', async () => {
          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, null, validToken1Data)
          ).rejects.toThrow('token0Data parameter is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, undefined, validToken1Data)
          ).rejects.toThrow('token0Data parameter is required');
        });

        it('should throw error when token0Data.address is missing or invalid', async () => {
          const missingAddress = { ...validToken0Data };
          delete missingAddress.address;

          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, missingAddress, validToken1Data)
          ).rejects.toThrow('token0Data.address is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, { ...validToken0Data, address: null }, validToken1Data)
          ).rejects.toThrow('token0Data.address is required');

          const invalidAddresses = ['not-an-address', '0x123', '0xGHIJKL'];
          for (const invalidAddress of invalidAddresses) {
            await expect(
              adapter.calculateTokenAmounts(validPosition, validPoolData, { ...validToken0Data, address: invalidAddress }, validToken1Data)
            ).rejects.toThrow();
          }
        });

        it('should throw error when token0Data.decimals is missing or invalid', async () => {
          const missingDecimals = { ...validToken0Data };
          delete missingDecimals.decimals;

          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, missingDecimals, validToken1Data)
          ).rejects.toThrow('token0Data.decimals is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, { ...validToken0Data, decimals: null }, validToken1Data)
          ).rejects.toThrow('token0Data.decimals is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, { ...validToken0Data, decimals: undefined }, validToken1Data)
          ).rejects.toThrow('token0Data.decimals is required');

          const invalidTypes = ['string', true, {}, [], NaN, Infinity];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.calculateTokenAmounts(validPosition, validPoolData, { ...validToken0Data, decimals: invalidType }, validToken1Data)
            ).rejects.toThrow('token0Data.decimals must be a valid number');
          }
        });

        it('should throw error when token1Data parameter is missing', async () => {
          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, validToken0Data, null)
          ).rejects.toThrow('token1Data parameter is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, validToken0Data, undefined)
          ).rejects.toThrow('token1Data parameter is required');
        });

        it('should throw error when token1Data.address is missing or invalid', async () => {
          const missingAddress = { ...validToken1Data };
          delete missingAddress.address;

          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, validToken0Data, missingAddress)
          ).rejects.toThrow('token1Data.address is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, validToken0Data, { ...validToken1Data, address: null })
          ).rejects.toThrow('token1Data.address is required');

          const invalidAddresses = ['not-an-address', '0x123', '0xGHIJKL'];
          for (const invalidAddress of invalidAddresses) {
            await expect(
              adapter.calculateTokenAmounts(validPosition, validPoolData, validToken0Data, { ...validToken1Data, address: invalidAddress })
            ).rejects.toThrow();
          }
        });

        it('should throw error when token1Data.decimals is missing or invalid', async () => {
          const missingDecimals = { ...validToken1Data };
          delete missingDecimals.decimals;

          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, validToken0Data, missingDecimals)
          ).rejects.toThrow('token1Data.decimals is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, validToken0Data, { ...validToken1Data, decimals: null })
          ).rejects.toThrow('token1Data.decimals is required');

          await expect(
            adapter.calculateTokenAmounts(validPosition, validPoolData, validToken0Data, { ...validToken1Data, decimals: undefined })
          ).rejects.toThrow('token1Data.decimals is required');

          const invalidTypes = ['string', true, {}, [], NaN, Infinity];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.calculateTokenAmounts(validPosition, validPoolData, validToken0Data, { ...validToken1Data, decimals: invalidType })
            ).rejects.toThrow('token1Data.decimals must be a valid number');
          }
        });
      });
    });
  });

  describe('discoverAvailablePools', () => {
    describe('Success Cases', () => {
      it('should discover all available USDC/WETH pools', async () => {
        const pools = await adapter.discoverAvailablePools(env.usdcAddress, env.wethAddress, env.provider);

        expect(Array.isArray(pools)).toBe(true);
        expect(pools.length).toBe(4); // 0.01%, 0.05%, 0.3%, 1% pools

        const feeTiers = pools.map(p => p.fee).sort((a, b) => a - b);
        expect(feeTiers).toEqual([100, 500, 3000, 10000]);
      });

      it('should return pools with correct structure and data types', async () => {
        const pools = await adapter.discoverAvailablePools(env.usdcAddress, env.wethAddress, env.provider);

        expect(pools.length).toBeGreaterThan(0);

        pools.forEach(pool => {
          expect(pool).toHaveProperty('address');
          expect(pool).toHaveProperty('fee');
          expect(pool).toHaveProperty('liquidity');
          expect(pool).toHaveProperty('sqrtPriceX96');
          expect(pool).toHaveProperty('tick');

          expect(typeof pool.address).toBe('string');
          expect(pool.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
          expect(typeof pool.fee).toBe('number');
          expect(typeof pool.liquidity).toBe('string');
          expect(typeof pool.sqrtPriceX96).toBe('string');
          expect(typeof pool.tick).toBe('bigint');

          expect(BigInt(pool.liquidity)).toBeGreaterThan(0n);
          expect(BigInt(pool.sqrtPriceX96)).toBeGreaterThan(0n);
        });
      });

      it('should return same pools regardless of token input order', async () => {
        const pools1 = await adapter.discoverAvailablePools(env.usdcAddress, env.wethAddress, env.provider);
        const pools2 = await adapter.discoverAvailablePools(env.wethAddress, env.usdcAddress, env.provider);

        expect(pools1.length).toBe(pools2.length);
        expect(pools1.length).toBe(4);

        // Sort both arrays by fee for comparison
        const sortedPools1 = pools1.sort((a, b) => a.fee - b.fee);
        const sortedPools2 = pools2.sort((a, b) => a.fee - b.fee);

        sortedPools1.forEach((pool, index) => {
          expect(pool.address).toBe(sortedPools2[index].address);
          expect(pool.fee).toBe(sortedPools2[index].fee);
          expect(pool.liquidity).toBe(sortedPools2[index].liquidity);
        });
      });

      it('should return empty array for token pair with no pools', async () => {
        // Use two fake addresses that won't have any pools
        const fakeToken1 = '0x0000000000000000000000000000000000000001';
        const fakeToken2 = '0x0000000000000000000000000000000000000002';

        const pools = await adapter.discoverAvailablePools(fakeToken1, fakeToken2, env.provider);

        expect(Array.isArray(pools)).toBe(true);
        expect(pools.length).toBe(0);
      });

      it('should return consistent pool addresses matching getPoolAddress', async () => {
        const pools = await adapter.discoverAvailablePools(env.usdcAddress, env.wethAddress, env.provider);

        expect(pools.length).toBeGreaterThan(0);

        for (const pool of pools) {
          const directAddress = await adapter.getPoolAddress(env.usdcAddress, env.wethAddress, pool.fee, env.provider);
          expect(pool.address).toBe(directAddress);
        }
      });

      it('should be deterministic and return same results on multiple calls', async () => {
        const pools1 = await adapter.discoverAvailablePools(env.usdcAddress, env.wethAddress, env.provider);
        const pools2 = await adapter.discoverAvailablePools(env.usdcAddress, env.wethAddress, env.provider);

        expect(pools1.length).toBe(pools2.length);

        // Sort both for comparison
        const sortedPools1 = pools1.sort((a, b) => a.fee - b.fee);
        const sortedPools2 = pools2.sort((a, b) => a.fee - b.fee);

        sortedPools1.forEach((pool, index) => {
          expect(pool.address).toBe(sortedPools2[index].address);
          expect(pool.liquidity).toBe(sortedPools2[index].liquidity);
          expect(pool.sqrtPriceX96).toBe(sortedPools2[index].sqrtPriceX96);
          expect(pool.tick).toBe(sortedPools2[index].tick);
        });
      });
    });

    describe('Error Cases', () => {
      it('should throw error for missing token0 address', async () => {
        await expect(
          adapter.discoverAvailablePools(null, env.usdcAddress, env.provider)
        ).rejects.toThrow('Token0 address parameter is required');

        await expect(
          adapter.discoverAvailablePools(undefined, env.usdcAddress, env.provider)
        ).rejects.toThrow('Token0 address parameter is required');

        await expect(
          adapter.discoverAvailablePools('', env.usdcAddress, env.provider)
        ).rejects.toThrow('Token0 address parameter is required');
      });

      it('should throw error for invalid token0 address', async () => {
        const invalidAddresses = [
          'not-an-address',
          '0x123', // too short
          '0xGHIJKL', // invalid hex characters
        ];

        for (const invalidAddress of invalidAddresses) {
          await expect(
            adapter.discoverAvailablePools(invalidAddress, env.usdcAddress, env.provider)
          ).rejects.toThrow(`Invalid token0 address: ${invalidAddress}`);
        }
      });

      it('should throw error for missing token1 address', async () => {
        await expect(
          adapter.discoverAvailablePools(env.wethAddress, null, env.provider)
        ).rejects.toThrow('Token1 address parameter is required');

        await expect(
          adapter.discoverAvailablePools(env.wethAddress, undefined, env.provider)
        ).rejects.toThrow('Token1 address parameter is required');

        await expect(
          adapter.discoverAvailablePools(env.wethAddress, '', env.provider)
        ).rejects.toThrow('Token1 address parameter is required');
      });

      it('should throw error for invalid token1 address', async () => {
        const invalidAddresses = [
          'not-an-address',
          '0x123', // too short
          '0xGHIJKL', // invalid hex characters
        ];

        for (const invalidAddress of invalidAddresses) {
          await expect(
            adapter.discoverAvailablePools(env.wethAddress, invalidAddress, env.provider)
          ).rejects.toThrow(`Invalid token1 address: ${invalidAddress}`);
        }
      });

      it('should throw error for invalid provider', async () => {
        await expect(
          adapter.discoverAvailablePools(env.wethAddress, env.usdcAddress, null)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');

        await expect(
          adapter.discoverAvailablePools(env.wethAddress, env.usdcAddress, {})
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error when factory address is missing', async () => {
        // Create adapter with broken config to test factory error handling
        const brokenAdapter = new (class extends adapter.constructor {
          constructor() {
            super(1337);
            this.addresses = { factoryAddress: null }; // Break factory address
          }
        })();

        await expect(
          brokenAdapter.discoverAvailablePools(env.wethAddress, env.usdcAddress, env.provider)
        ).rejects.toThrow('No Uniswap V3 factory address found for chainId: 1337');
      });
    });
  });

  describe('generateClaimFeesData', () => {
    describe('Success Cases', () => {
      it('should generate valid transaction data for position fee collection', async () => {
        const params = {
          positionId: env.positionTokenId.toString(),
          provider: env.provider,
          walletAddress: await env.testVault.getAddress(),
          token0Address: env.usdcAddress,
          token1Address: env.wethAddress,
          token0Decimals: 6,
          token1Decimals: 18
        };

        const result = await adapter.generateClaimFeesData(params);

        expect(result).toBeDefined();
        expect(result).toBeTypeOf('object');
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);
        expect(result.data).toBeDefined();
        expect(result.value).toBeDefined();
        expect(typeof result.to).toBe('string');
        expect(typeof result.data).toBe('string');
        expect(typeof result.value).toBe('string');
        expect(result.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result.data).toMatch(/^0x[a-fA-F0-9]+$/);

        // Verify specific values
        expect(result.value).toBe('0x00'); // No ETH sent for fee collection
        expect(result.data).toMatch(/^0xfc6f7865/); // Function selector for collect
        expect(result.data.length).toBeGreaterThan(10); // Should have substantial calldata

        // Verify the calldata contains our positionId and wallet address
        const expectedPositionId = env.positionTokenId.toString(16).padStart(64, '0');
        const expectedRecipient = (await env.testVault.getAddress()).slice(2).toLowerCase().padStart(64, '0');
        expect(result.data.toLowerCase()).toContain(expectedPositionId);
        expect(result.data.toLowerCase()).toContain(expectedRecipient);
      });

      it('should be deterministic for same inputs', async () => {
        const params = {
          positionId: env.positionTokenId.toString(),
          provider: env.provider,
          walletAddress: await env.testVault.getAddress(),
          token0Address: env.usdcAddress,
          token1Address: env.wethAddress,
          token0Decimals: 6,
          token1Decimals: 18
        };

        const result1 = await adapter.generateClaimFeesData(params);
        const result2 = await adapter.generateClaimFeesData(params);

        expect(result1.to).toBe(result2.to);
        expect(result1.data).toBe(result2.data);
        expect(result1.value).toBe(result2.value);
      });
    });

    describe('Error Cases', () => {
      let baseParams;

      beforeEach(() => {
        baseParams = {
          positionId: '123',
          provider: env.provider,
          walletAddress: env.signers[0].address,
          token0Address: env.usdcAddress,
          token1Address: env.wethAddress,
          token0Decimals: 6,
          token1Decimals: 18
        };
      });

      describe('Position ID validation', () => {

        it('should throw error for null/undefined positionId', async () => {
          await expect(
            adapter.generateClaimFeesData({ ...baseParams, positionId: null })
          ).rejects.toThrow('Position ID is required');

          await expect(
            adapter.generateClaimFeesData({ ...baseParams, positionId: undefined })
          ).rejects.toThrow('Position ID is required');
        });

        it('should throw error for non-string positionId', async () => {
          const invalidTypes = [123, true, false, {}, []];

          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateClaimFeesData({ ...baseParams, positionId: invalidType })
            ).rejects.toThrow('positionId must be a string');
          }
        });

        it('should throw error for non-numeric string positionId', async () => {
          const invalidIds = ['', 'abc', '12abc', '12.5', '-12', '12-34', ' 123', '123 '];

          for (const invalidId of invalidIds) {
            await expect(
              adapter.generateClaimFeesData({ ...baseParams, positionId: invalidId })
            ).rejects.toThrow('positionId must be a numeric string');
          }
        });

        it('should accept leading zeros in positionId', async () => {
          const result = await adapter.generateClaimFeesData({ ...baseParams, positionId: '00123' });
          expect(result).toBeDefined();
          expect(result.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
        });
      });

      describe('Provider validation', () => {
        it('should throw error for null/undefined provider', async () => {
          await expect(
            adapter.generateClaimFeesData({ ...baseParams, provider: null })
          ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');

          await expect(
            adapter.generateClaimFeesData({ ...baseParams, provider: undefined })
          ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
        });

        it('should throw error for provider without getNetwork method', async () => {
          await expect(
            adapter.generateClaimFeesData({ ...baseParams, provider: {} })
          ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
        });

        it('should throw error for provider returning wrong chainId', async () => {
          const wrongChainProvider = new MockProvider(999999);

          await expect(
            adapter.generateClaimFeesData({ ...baseParams, provider: wrongChainProvider })
          ).rejects.toThrow('Provider chain 999999 doesn\'t match adapter chain 1337');
        });

        it('should throw error when provider getNetwork throws', async () => {
          const throwingProvider = new MockFailingProvider('Network connection failed');

          await expect(
            adapter.generateClaimFeesData({ ...baseParams, provider: throwingProvider })
          ).rejects.toThrow('Network connection failed');
        });
      });

      describe('Wallet address validation', () => {
        it('should throw error for missing wallet address', async () => {
          await expect(
            adapter.generateClaimFeesData({ ...baseParams, walletAddress: null })
          ).rejects.toThrow('Wallet address parameter is required');

          await expect(
            adapter.generateClaimFeesData({ ...baseParams, walletAddress: undefined })
          ).rejects.toThrow('Wallet address parameter is required');

          await expect(
            adapter.generateClaimFeesData({ ...baseParams, walletAddress: '' })
          ).rejects.toThrow('Wallet address parameter is required');
        });

        it('should throw error for invalid wallet address format', async () => {
          const invalidAddresses = ['not-an-address', '0x123', '0xGHIJKL'];

          for (const invalidAddress of invalidAddresses) {
            await expect(
              adapter.generateClaimFeesData({ ...baseParams, walletAddress: invalidAddress })
            ).rejects.toThrow(`Invalid wallet address: ${invalidAddress}`);
          }
        });
      });

      describe('Token address validation', () => {
        it('should throw error for missing token addresses', async () => {
          await expect(
            adapter.generateClaimFeesData({ ...baseParams, token0Address: null, token1Address: env.wethAddress })
          ).rejects.toThrow('Token0 address parameter is required');

          await expect(
            adapter.generateClaimFeesData({ ...baseParams, token0Address: env.usdcAddress, token1Address: null })
          ).rejects.toThrow('Token1 address parameter is required');
        });

        it('should throw error for invalid token address format', async () => {
          const invalidAddresses = ['not-an-address', '0x123', '0xGHIJKL'];

          for (const invalidAddress of invalidAddresses) {
            await expect(
              adapter.generateClaimFeesData({ ...baseParams, token0Address: invalidAddress, token1Address: env.wethAddress })
            ).rejects.toThrow(`Invalid token0 address: ${invalidAddress}`);

            await expect(
              adapter.generateClaimFeesData({ ...baseParams, token0Address: env.usdcAddress, token1Address: invalidAddress })
            ).rejects.toThrow(`Invalid token1 address: ${invalidAddress}`);
          }
        });
      });

      describe('Token decimals validation', () => {
        it('should throw error for missing token decimals', async () => {
          await expect(
            adapter.generateClaimFeesData({ ...baseParams, token0Decimals: null, token1Decimals: 18 })
          ).rejects.toThrow('Token0 decimals is required');

          await expect(
            adapter.generateClaimFeesData({ ...baseParams, token0Decimals: 6, token1Decimals: null })
          ).rejects.toThrow('Token1 decimals is required');
        });

        it('should throw error for invalid token decimals type', async () => {
          const invalidTypes = ['18', true, {}, [], NaN, Infinity, -Infinity];

          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateClaimFeesData({ ...baseParams, token0Decimals: invalidType, token1Decimals: 18 })
            ).rejects.toThrow('Token0 decimals must be a valid number');

            await expect(
              adapter.generateClaimFeesData({ ...baseParams, token0Decimals: 6, token1Decimals: invalidType })
            ).rejects.toThrow('Token1 decimals must be a valid number');
          }
        });
      });
    });

  });

  describe('generateRemoveLiquidityData', () => {
    describe('Success Cases', () => {
      let baseParams;

      beforeEach(async () => {
        // Get pool data for test tokens
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        // Use real position tick values from test environment
        const { tickLower, tickUpper } = env.testPosition;

        baseParams = {
          position: {
            id: env.positionTokenId.toString(),
            tickLower: tickLower,
            tickUpper: tickUpper
          },
          percentage: 50,
          provider: env.provider,
          walletAddress: await env.testVault.getAddress(),
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          },
          slippageTolerance: 0.5,
          deadlineMinutes: 30
        };
      });

      it('should generate valid transaction data for removing liquidity', async () => {
        const result = await adapter.generateRemoveLiquidityData(baseParams);

        // Basic structure validation
        expect(result).toBeDefined();
        expect(result).toBeTypeOf('object');
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');

        // Type validation
        expect(typeof result.to).toBe('string');
        expect(typeof result.data).toBe('string');
        expect(typeof result.value).toBe('string');

        // Format validation
        expect(result.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result.data).toMatch(/^0x[a-fA-F0-9]+$/);

        // Contract address should be position manager
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);

        // Should have substantial calldata (remove liquidity + collect fees)
        expect(result.data.length).toBeGreaterThan(10);

        // Value should be 0x00 for ERC20 operations (SDK returns hex format)
        expect(result.value).toBe('0x00');
      });

      it('should be deterministic for same inputs', async () => {
        const result1 = await adapter.generateRemoveLiquidityData(baseParams);
        const result2 = await adapter.generateRemoveLiquidityData(baseParams);

        expect(result1.to).toBe(result2.to);
        expect(result1.data).toBe(result2.data);
        expect(result1.value).toBe(result2.value);
      });

      it('should handle different percentage values', async () => {
        const percentages = [1, 25, 50, 75, 100];

        for (const percentage of percentages) {
          const params = { ...baseParams, percentage };
          const result = await adapter.generateRemoveLiquidityData(params);

          expect(result).toBeDefined();
          expect(result.to).toBe(adapter.addresses.positionManagerAddress);
          expect(result.data).toMatch(/^0x[a-fA-F0-9]+$/);
          expect(result.value).toBe('0x00');
        }
      });

      it('should handle different slippage tolerance values', async () => {
        const slippageValues = [0, 0.1, 0.5, 1.0, 5.0];

        for (const slippageTolerance of slippageValues) {
          const params = { ...baseParams, slippageTolerance };
          const result = await adapter.generateRemoveLiquidityData(params);

          expect(result).toBeDefined();
          expect(result.to).toBe(adapter.addresses.positionManagerAddress);
          expect(result.data).toMatch(/^0x[a-fA-F0-9]+$/);
          expect(result.value).toBe('0x00');
        }
      });

      it('should handle different deadline values', async () => {
        const deadlines = [1, 15, 30, 60, 120];

        for (const deadlineMinutes of deadlines) {
          const params = { ...baseParams, deadlineMinutes };
          const result = await adapter.generateRemoveLiquidityData(params);

          expect(result).toBeDefined();
          expect(result.to).toBe(adapter.addresses.positionManagerAddress);
          expect(result.data).toMatch(/^0x[a-fA-F0-9]+$/);
          expect(result.value).toBe('0x00');
        }
      });

      it('should handle reversed token order correctly', async () => {
        // Test with tokens in reverse order (should still work due to sortTokens)
        const reversedParams = {
          ...baseParams,
          token0Data: baseParams.token1Data,
          token1Data: baseParams.token0Data
        };

        const result = await adapter.generateRemoveLiquidityData(reversedParams);

        expect(result).toBeDefined();
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);
        expect(result.data).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(result.value).toBe('0x00');
      });
    });

    describe('Error Cases', () => {
      let baseParams;

      beforeEach(async () => {
        // Get pool data for test tokens
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        // Use real position tick values from test environment
        const { tickLower, tickUpper } = env.testPosition;

        baseParams = {
          position: {
            id: '123',
            tickLower: tickLower,
            tickUpper: tickUpper
          },
          percentage: 50,
          provider: env.provider,
          walletAddress: env.signers[0].address,
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          },
          slippageTolerance: 0.5,
          deadlineMinutes: 30
        };
      });

      describe('Position validation', () => {
        it('should throw error for null/undefined position', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, position: null })
          ).rejects.toThrow('Position parameter is required');

          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, position: undefined })
          ).rejects.toThrow('Position parameter is required');
        });

        it('should throw error for non-object position', async () => {
          const invalidTypes = ['string', 123, true, false, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateRemoveLiquidityData({ ...baseParams, position: invalidType })
            ).rejects.toThrow('Position must be an object');
          }
        });

        it('should throw error for missing position ID', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              position: { ...baseParams.position, id: null }
            })
          ).rejects.toThrow('Position ID is required');

          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              position: { ...baseParams.position, id: undefined }
            })
          ).rejects.toThrow('Position ID is required');
        });

        it('should throw error for non-string position ID', async () => {
          const invalidTypes = [123, true, false, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateRemoveLiquidityData({
                ...baseParams,
                position: { ...baseParams.position, id: invalidType }
              })
            ).rejects.toThrow('Position ID must be a string');
          }
        });

        it('should throw error for non-numeric string position ID', async () => {
          const invalidIds = ['', 'abc', '12abc', '12.5', '-12', '12-34', ' 123', '123 '];
          for (const invalidId of invalidIds) {
            await expect(
              adapter.generateRemoveLiquidityData({
                ...baseParams,
                position: { ...baseParams.position, id: invalidId }
              })
            ).rejects.toThrow('Position ID must be a numeric string');
          }
        });

        it('should throw error for missing tick values', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              position: { ...baseParams.position, tickLower: null }
            })
          ).rejects.toThrow('Position tickLower is required');

          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              position: { ...baseParams.position, tickUpper: undefined }
            })
          ).rejects.toThrow('Position tickUpper is required');
        });

        it('should throw error for non-finite tick values', async () => {
          const invalidTicks = [NaN, Infinity, -Infinity, 'string', {}, []];
          for (const invalidTick of invalidTicks) {
            await expect(
              adapter.generateRemoveLiquidityData({
                ...baseParams,
                position: { ...baseParams.position, tickLower: invalidTick }
              })
            ).rejects.toThrow('Position tickLower must be a finite number');

            await expect(
              adapter.generateRemoveLiquidityData({
                ...baseParams,
                position: { ...baseParams.position, tickUpper: invalidTick }
              })
            ).rejects.toThrow('Position tickUpper must be a finite number');
          }
        });

        it('should throw error for invalid tick range', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              position: {
                ...baseParams.position,
                tickLower: -200000,
                tickUpper: -210000 // tickLower > tickUpper
              }
            })
          ).rejects.toThrow('Position tickLower must be less than tickUpper');

          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              position: {
                ...baseParams.position,
                tickLower: -200000,
                tickUpper: -200000 // equal ticks
              }
            })
          ).rejects.toThrow('Position tickLower must be less than tickUpper');
        });
      });

      describe('Percentage validation', () => {
        it('should throw error for null/undefined percentage', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, percentage: null })
          ).rejects.toThrow('Percentage parameter is required');

          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, percentage: undefined })
          ).rejects.toThrow('Percentage parameter is required');
        });

        it('should throw error for non-finite percentage', async () => {
          const invalidTypes = [NaN, Infinity, -Infinity, 'string', {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateRemoveLiquidityData({ ...baseParams, percentage: invalidType })
            ).rejects.toThrow('Percentage must be a finite number');
          }
        });

        it('should throw error for out-of-range percentage', async () => {
          const invalidPercentages = [0, -1, -10, 101, 150, 1000];
          for (const invalidPercentage of invalidPercentages) {
            await expect(
              adapter.generateRemoveLiquidityData({ ...baseParams, percentage: invalidPercentage })
            ).rejects.toThrow('Percentage must be between 1 and 100');
          }
        });
      });

      describe('Provider validation', () => {
        it('should throw error for missing provider', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, provider: null })
          ).rejects.toThrow('Provider is required');

          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, provider: undefined })
          ).rejects.toThrow('Provider is required');
        });

        it('should throw error for non-object provider', async () => {
          const invalidTypes = ['string', 123, true, false, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateRemoveLiquidityData({ ...baseParams, provider: invalidType })
            ).rejects.toThrow('Provider must be an ethers provider object');
          }
        });
      });

      describe('Wallet address validation', () => {
        it('should throw error for missing wallet address', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, walletAddress: null })
          ).rejects.toThrow('Wallet address is required');

          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, walletAddress: undefined })
          ).rejects.toThrow('Wallet address is required');

          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, walletAddress: '' })
          ).rejects.toThrow('Wallet address is required');
        });

        it('should throw error for non-string wallet address', async () => {
          const invalidTypes = [123, true, false, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateRemoveLiquidityData({ ...baseParams, walletAddress: invalidType })
            ).rejects.toThrow('Wallet address must be a string');
          }
        });

        it('should throw error for invalid wallet address format', async () => {
          const invalidAddresses = ['not-an-address', '0x123', '0xGHIJKL'];
          for (const invalidAddress of invalidAddresses) {
            await expect(
              adapter.generateRemoveLiquidityData({ ...baseParams, walletAddress: invalidAddress })
            ).rejects.toThrow(`Invalid wallet address: ${invalidAddress}`);
          }
        });
      });

      describe('Pool data validation', () => {
        it('should throw error for null/undefined pool data', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, poolData: null })
          ).rejects.toThrow('Pool data parameter is required');

          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, poolData: undefined })
          ).rejects.toThrow('Pool data parameter is required');
        });

        it('should throw error for non-object pool data', async () => {
          const invalidTypes = ['string', 123, true, false, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateRemoveLiquidityData({ ...baseParams, poolData: invalidType })
            ).rejects.toThrow('Pool data must be an object');
          }
        });

        it('should throw error for missing pool data properties', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              poolData: { ...baseParams.poolData, fee: null }
            })
          ).rejects.toThrow('Pool data fee is required');

          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              poolData: { ...baseParams.poolData, sqrtPriceX96: null }
            })
          ).rejects.toThrow('Pool data sqrtPriceX96 is required');

          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              poolData: { ...baseParams.poolData, liquidity: null }
            })
          ).rejects.toThrow('Pool data liquidity is required');

          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              poolData: { ...baseParams.poolData, tick: null }
            })
          ).rejects.toThrow('Pool data tick is required');
        });

        it('should throw error for invalid pool data types', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              poolData: { ...baseParams.poolData, fee: 'invalid' }
            })
          ).rejects.toThrow('Pool data fee must be a non-negative finite number');

          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              poolData: { ...baseParams.poolData, fee: -1 }
            })
          ).rejects.toThrow('Pool data fee must be a non-negative finite number');

          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              poolData: { ...baseParams.poolData, sqrtPriceX96: 123 }
            })
          ).rejects.toThrow('Pool data sqrtPriceX96 must be a string');

          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              poolData: { ...baseParams.poolData, liquidity: 123 }
            })
          ).rejects.toThrow('Pool data liquidity must be a string');

          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              poolData: { ...baseParams.poolData, tick: 'invalid' }
            })
          ).rejects.toThrow('Pool data tick must be a finite number');
        });
      });

      describe('Token data validation', () => {
        it('should throw error for null/undefined token data', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, token0Data: null })
          ).rejects.toThrow('Token0 data parameter is required');

          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, token1Data: undefined })
          ).rejects.toThrow('Token1 data parameter is required');
        });

        it('should throw error for non-object token data', async () => {
          const invalidTypes = ['string', 123, true, false, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateRemoveLiquidityData({ ...baseParams, token0Data: invalidType })
            ).rejects.toThrow('Token0 data must be an object');

            await expect(
              adapter.generateRemoveLiquidityData({ ...baseParams, token1Data: invalidType })
            ).rejects.toThrow('Token1 data must be an object');
          }
        });

        it('should throw error for missing token addresses', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              token0Data: { ...baseParams.token0Data, address: null }
            })
          ).rejects.toThrow('Token0 address is required');

          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              token1Data: { ...baseParams.token1Data, address: '' }
            })
          ).rejects.toThrow('Token1 address is required');
        });

        it('should throw error for non-string token addresses', async () => {
          const invalidTypes = [123, true, false, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateRemoveLiquidityData({
                ...baseParams,
                token0Data: { ...baseParams.token0Data, address: invalidType }
              })
            ).rejects.toThrow('Token0 address must be a string');

            await expect(
              adapter.generateRemoveLiquidityData({
                ...baseParams,
                token1Data: { ...baseParams.token1Data, address: invalidType }
              })
            ).rejects.toThrow('Token1 address must be a string');
          }
        });

        it('should throw error for invalid token address format', async () => {
          const invalidAddresses = ['not-an-address', '0x123', '0xGHIJKL'];
          for (const invalidAddress of invalidAddresses) {
            await expect(
              adapter.generateRemoveLiquidityData({
                ...baseParams,
                token0Data: { ...baseParams.token0Data, address: invalidAddress }
              })
            ).rejects.toThrow(`Invalid token0 address: ${invalidAddress}`);

            await expect(
              adapter.generateRemoveLiquidityData({
                ...baseParams,
                token1Data: { ...baseParams.token1Data, address: invalidAddress }
              })
            ).rejects.toThrow(`Invalid token1 address: ${invalidAddress}`);
          }
        });

        it('should throw error for missing token decimals', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              token0Data: { ...baseParams.token0Data, decimals: null }
            })
          ).rejects.toThrow('Token0 decimals is required');

          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              token1Data: { ...baseParams.token1Data, decimals: undefined }
            })
          ).rejects.toThrow('Token1 decimals is required');
        });

        it('should throw error for invalid token decimals', async () => {
          const invalidDecimals = [-1, 256, NaN, Infinity, 'string', {}, []];
          for (const invalidDecimal of invalidDecimals) {
            await expect(
              adapter.generateRemoveLiquidityData({
                ...baseParams,
                token0Data: { ...baseParams.token0Data, decimals: invalidDecimal }
              })
            ).rejects.toThrow('Token0 decimals must be a finite number between 0 and 255');

            await expect(
              adapter.generateRemoveLiquidityData({
                ...baseParams,
                token1Data: { ...baseParams.token1Data, decimals: invalidDecimal }
              })
            ).rejects.toThrow('Token1 decimals must be a finite number between 0 and 255');
          }
        });

        it('should throw error for identical token addresses', async () => {
          const sameAddress = env.usdcAddress;
          await expect(
            adapter.generateRemoveLiquidityData({
              ...baseParams,
              token0Data: { ...baseParams.token0Data, address: sameAddress },
              token1Data: { ...baseParams.token1Data, address: sameAddress }
            })
          ).rejects.toThrow('Token0 and token1 addresses cannot be the same');
        });
      });

      describe('Slippage tolerance validation', () => {
        it('should throw error for null/undefined slippage tolerance', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, slippageTolerance: null })
          ).rejects.toThrow('Slippage tolerance is required');

          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, slippageTolerance: undefined })
          ).rejects.toThrow('Slippage tolerance is required');
        });

        it('should throw error for non-finite slippage tolerance', async () => {
          const invalidTypes = [NaN, Infinity, -Infinity, 'string', {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateRemoveLiquidityData({ ...baseParams, slippageTolerance: invalidType })
            ).rejects.toThrow('Slippage tolerance must be a finite number');
          }
        });

        it('should throw error for out-of-range slippage tolerance', async () => {
          const invalidValues = [-1, -0.1, 101, 150];
          for (const invalidValue of invalidValues) {
            await expect(
              adapter.generateRemoveLiquidityData({ ...baseParams, slippageTolerance: invalidValue })
            ).rejects.toThrow('Slippage tolerance must be between 0 and 100');
          }
        });
      });

      describe('Deadline validation', () => {
        it('should throw error for null/undefined deadline', async () => {
          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, deadlineMinutes: null })
          ).rejects.toThrow('Deadline minutes is required');

          await expect(
            adapter.generateRemoveLiquidityData({ ...baseParams, deadlineMinutes: undefined })
          ).rejects.toThrow('Deadline minutes is required');
        });

        it('should throw error for non-finite deadline', async () => {
          const invalidTypes = [NaN, Infinity, -Infinity, 'string', {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateRemoveLiquidityData({ ...baseParams, deadlineMinutes: invalidType })
            ).rejects.toThrow('Deadline minutes must be a finite number');
          }
        });

        it('should throw error for non-positive deadline', async () => {
          const invalidValues = [0, -1, -10];
          for (const invalidValue of invalidValues) {
            await expect(
              adapter.generateRemoveLiquidityData({ ...baseParams, deadlineMinutes: invalidValue })
            ).rejects.toThrow('Deadline minutes must be greater than 0');
          }
        });
      });
    });

  });

  describe('getAddLiquidityQuote', () => {

    describe('Success Cases', () => {
      it('should return position object with metadata', async () => {
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        const params = {
          position: {
            tickLower: -202410,
            tickUpper: -201090
          },
          token0Amount: '1000000000000000000',
          token1Amount: '1000000000',
          provider: env.provider,
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          }
        };

        const result = await adapter.getAddLiquidityQuote(params);

        expect(result).toBeDefined();
        expect(result.position).toBeDefined();
        expect(result.tokensSwapped).toBeDefined();
        expect(result.sortedToken0).toBeDefined();
        expect(result.sortedToken1).toBeDefined();
        expect(result.pool).toBeDefined();

        // Check position has required properties
        expect(result.position.amount0).toBeDefined();
        expect(result.position.amount1).toBeDefined();
        expect(result.position.liquidity).toBeDefined();
        expect(result.position.tickLower).toBe(-202410);
        expect(result.position.tickUpper).toBe(-201090);
      });

      it('should calculate both token amounts when providing only token0', async () => {
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        const params = {
          position: {
            tickLower: env.testPosition.tickLower,
            tickUpper: env.testPosition.tickUpper
          },
          token0Amount: '1000000000000000000',
          token1Amount: '0',
          provider: env.provider,
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          }
        };

        const result = await adapter.getAddLiquidityQuote(params);

        // Account for token sorting - WETH < USDC, so tokens are swapped
        if (result.tokensSwapped) {
          // Our "token0Amount" input (USDC) became amount1 after sorting
          // SDK may use slightly less due to rounding, so check it's very close to our input
          const amount1 = BigInt(result.position.amount1.quotient.toString());
          const inputAmount = BigInt('1000000000000000000');
          const difference = inputAmount - amount1;
          expect(difference).toBeGreaterThanOrEqual(0n); // Should not exceed input
          expect(difference).toBeLessThanOrEqual(BigInt('1000')); // Allow tiny rounding difference
          // Should calculate a non-zero amount for token0 (WETH)
          expect(result.position.amount0.quotient.toString()).not.toBe('0');
          expect(BigInt(result.position.amount0.quotient.toString())).toBeGreaterThan(0n);
        } else {
          // Our "token0Amount" input stayed as amount0
          const amount0 = BigInt(result.position.amount0.quotient.toString());
          const inputAmount = BigInt('1000000000000000000');
          const difference = inputAmount - amount0;
          expect(difference).toBeGreaterThanOrEqual(0n); // Should not exceed input
          expect(difference).toBeLessThanOrEqual(BigInt('1000')); // Allow tiny rounding difference
          // Should calculate a non-zero amount for token1
          expect(result.position.amount1.quotient.toString()).not.toBe('0');
          expect(BigInt(result.position.amount1.quotient.toString())).toBeGreaterThan(0n);
        }
      });

      it('should calculate both token amounts when providing only token1', async () => {
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        const params = {
          position: {
            tickLower: env.testPosition.tickLower,
            tickUpper: env.testPosition.tickUpper
          },
          token0Amount: '0',
          token1Amount: '1000000000000000000',
          provider: env.provider,
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          }
        };

        const result = await adapter.getAddLiquidityQuote(params);

        // Account for token sorting - WETH < USDC, so tokens are swapped
        if (result.tokensSwapped) {
          // Our "token1Amount" input (WETH) became amount0 after sorting
          // SDK may use slightly less due to rounding, so check it's very close to our input
          const amount0 = BigInt(result.position.amount0.quotient.toString());
          const inputAmount = BigInt('1000000000000000000');
          const difference = inputAmount - amount0;
          expect(difference).toBeGreaterThanOrEqual(0n); // Should not exceed input
          expect(difference).toBeLessThanOrEqual(BigInt('1000')); // Allow tiny rounding difference
          // Should calculate a non-zero amount for token1 (USDC)
          expect(result.position.amount1.quotient.toString()).not.toBe('0');
          expect(BigInt(result.position.amount1.quotient.toString())).toBeGreaterThan(0n);
        } else {
          // Our "token1Amount" input stayed as amount1
          const amount1 = BigInt(result.position.amount1.quotient.toString());
          const inputAmount = BigInt('1000000000000000000');
          const difference = inputAmount - amount1;
          expect(difference).toBeGreaterThanOrEqual(0n); // Should not exceed input
          expect(difference).toBeLessThanOrEqual(BigInt('1000')); // Allow tiny rounding difference
          // Should calculate a non-zero amount for token0
          expect(result.position.amount0.quotient.toString()).not.toBe('0');
          expect(BigInt(result.position.amount0.quotient.toString())).toBeGreaterThan(0n);
        }
      });

      it('should handle out-of-range positions correctly (above current tick)', async () => {
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        // Position above current tick should contain only token0
        const currentTick = poolData.tick;
        const tickSpacing = 10; // 0.05% fee tier has 10 tick spacing

        // Create properly spaced ticks above current tick
        const tickLower = Math.floor((currentTick + 1000) / tickSpacing) * tickSpacing;
        const tickUpper = Math.floor((currentTick + 2000) / tickSpacing) * tickSpacing;

        const params = {
          position: {
            tickLower: tickLower,
            tickUpper: tickUpper
          },
          token0Amount: '0',
          token1Amount: '1000000000000000000',
          provider: env.provider,
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          }
        };

        const result = await adapter.getAddLiquidityQuote(params);

        // Above current tick position should hold 100% sorted token0 (WETH)
        // Result amounts are always in sorted order
        const amount0 = BigInt(result.position.amount0.quotient.toString());
        const amount1 = BigInt(result.position.amount1.quotient.toString());
        const inputAmount = BigInt('1000000000000000000');

        // Should have close to input amount of token0 (WETH), allowing for rounding
        expect(amount0 - inputAmount).toBeLessThan(1000n);
        expect(amount0 - inputAmount).toBeGreaterThan(-1000n);
        // Should have zero token1 (USDC)
        expect(amount1).toBe(0n);
      });

      it('should handle out-of-range positions correctly (below current tick)', async () => {
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        // Position below current tick should contain only token1
        const currentTick = poolData.tick;
        const tickSpacing = 10; // 0.05% fee tier has 10 tick spacing

        // Create properly spaced ticks below current tick
        const tickLower = Math.floor((currentTick - 2000) / tickSpacing) * tickSpacing;
        const tickUpper = Math.floor((currentTick - 1000) / tickSpacing) * tickSpacing;

        const params = {
          position: {
            tickLower: tickLower,
            tickUpper: tickUpper
          },
          token0Amount: '1000000',
          token1Amount: '0',
          provider: env.provider,
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          }
        };

        const result = await adapter.getAddLiquidityQuote(params);

        // Below current tick position should hold 100% sorted token1 (USDC)
        // Result amounts are always in sorted order
        const amount0 = BigInt(result.position.amount0.quotient.toString());
        const amount1 = BigInt(result.position.amount1.quotient.toString());
        const inputAmount = BigInt('1000000');

        // Should have zero token0 (WETH)
        expect(amount0).toBe(0n);
        // Should have close to input amount of token1 (USDC), allowing for rounding
        expect(amount1 - inputAmount).toBeLessThan(1000n);
        expect(amount1 - inputAmount).toBeGreaterThan(-1000n);
      });

      it('should scale proportionally when doubling inputs', async () => {
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        const baseParams = {
          position: {
            tickLower: -202410,
            tickUpper: -201090
          },
          provider: env.provider,
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          }
        };

        // Get quote for base amounts
        const quote1 = await adapter.getAddLiquidityQuote({
          ...baseParams,
          token0Amount: '1000000000',
          token1Amount: '2000000000000000000'
        });

        // Get quote for doubled amounts
        const quote2 = await adapter.getAddLiquidityQuote({
          ...baseParams,
          token0Amount: '2000000000',
          token1Amount: '4000000000000000000'
        });

        // Liquidity should scale proportionally (approximately double)
        const liquidity1 = BigInt(quote1.position.liquidity.toString());
        const liquidity2 = BigInt(quote2.position.liquidity.toString());

        expect(liquidity2).toBeGreaterThan(liquidity1);
        // Should be approximately double (within 1% tolerance for rounding)
        const ratio = Number(liquidity2 * 100n / liquidity1);
        expect(ratio).toBeGreaterThan(195); // 2.0 * 100 - 5% tolerance
        expect(ratio).toBeLessThan(205);    // 2.0 * 100 + 5% tolerance
      });

      it('should handle token sorting correctly', async () => {
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        const params = {
          position: {
            tickLower: -202410,
            tickUpper: -201090
          },
          token0Amount: '1000000000',
          token1Amount: '1000000000000000000',
          provider: env.provider,
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          }
        };

        const result = await adapter.getAddLiquidityQuote(params);

        // Check that tokens are sorted correctly (lexicographically by address)
        const expectedTokensSwapped = env.usdcAddress.toLowerCase() > env.wethAddress.toLowerCase();
        expect(result.tokensSwapped).toBe(expectedTokensSwapped);

        // Check that sorted tokens have correct addresses
        if (expectedTokensSwapped) {
          expect(result.sortedToken0.address).toBe(env.wethAddress);
          expect(result.sortedToken1.address).toBe(env.usdcAddress);
        } else {
          expect(result.sortedToken0.address).toBe(env.usdcAddress);
          expect(result.sortedToken1.address).toBe(env.wethAddress);
        }
      });

      it('should return valid liquidity amount', async () => {
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        const params = {
          position: {
            tickLower: -202410,
            tickUpper: -201090
          },
          token0Amount: '1000000000',
          token1Amount: '1000000000000000000',
          provider: env.provider,
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          }
        };

        const result = await adapter.getAddLiquidityQuote(params);

        // Liquidity should be a positive number
        expect(result.position.liquidity).toBeDefined();
        expect(BigInt(result.position.liquidity.toString())).toBeGreaterThan(0n);

        // Should be a valid JSBI/BigInt value
        expect(result.position.liquidity.toString()).toMatch(/^\d+$/);
      });

      it('should maintain consistent tick range', async () => {
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        const params = {
          position: {
            tickLower: -202410,
            tickUpper: -201090
          },
          token0Amount: '1000000000',
          token1Amount: '1000000000000000000',
          provider: env.provider,
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          }
        };

        const result = await adapter.getAddLiquidityQuote(params);

        // Position should maintain the same tick range we provided
        expect(result.position.tickLower).toBe(-202410);
        expect(result.position.tickUpper).toBe(-201090);
      });
    });
    describe('Error Cases', () => {
      // Get valid test data for error tests
      let baseParams;

      beforeEach(async () => {
        // Get pool data for test tokens
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        baseParams = {
          position: {
            tickLower: -202410,
            tickUpper: -201090
          },
          token0Amount: '1000000000000000000',
          token1Amount: '1000000000',
          provider: env.provider,
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          }
        };
      });

      describe('Position validation', () => {
        it('should throw error for missing position', async () => {
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, position: null })
          ).rejects.toThrow('Position parameter is required');
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, position: undefined })
          ).rejects.toThrow('Position parameter is required');
        });

        it('should throw error for non-object position', async () => {
          const invalidTypes = ['string', 123, true, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.getAddLiquidityQuote({ ...baseParams, position: invalidType })
            ).rejects.toThrow('Position must be an object');
          }
        });

        it('should throw error for invalid tick values', async () => {
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, position: { ...baseParams.position, tickLower: null } })
          ).rejects.toThrow('Position tickLower is required');
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, position: { ...baseParams.position, tickUpper: null } })
          ).rejects.toThrow('Position tickUpper is required');
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, position: { ...baseParams.position, tickLower: NaN } })
          ).rejects.toThrow('Position tickLower must be a finite number');
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, position: { ...baseParams.position, tickUpper: Infinity } })
          ).rejects.toThrow('Position tickUpper must be a finite number');
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, position: { ...baseParams.position, tickLower: baseParams.position.tickUpper, tickUpper: baseParams.position.tickLower } })
          ).rejects.toThrow('Position tickLower must be less than tickUpper');
        });
      });

      describe('Token0 amount validation', () => {
        it('should throw error for missing token0Amount', async () => {
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, token0Amount: null })
          ).rejects.toThrow('Token0 amount is required');
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, token0Amount: undefined })
          ).rejects.toThrow('Token0 amount is required');
        });

        it('should throw error for non-string token0Amount', async () => {
          const invalidTypes = [123, true, false, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.getAddLiquidityQuote({ ...baseParams, token0Amount: invalidType })
            ).rejects.toThrow('Token0 amount must be a string');
          }
        });

        it('should throw error for invalid token0Amount format', async () => {
          const invalidAmounts = ['', 'abc', '12.5', '-100', '12abc', ' 123', '123 '];
          for (const invalidAmount of invalidAmounts) {
            await expect(
              adapter.getAddLiquidityQuote({ ...baseParams, token0Amount: invalidAmount })
            ).rejects.toThrow('Token0 amount must be a positive numeric string');
          }
        });

        it('should throw error when both token amounts are zero', async () => {
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, token0Amount: '0', token1Amount: '0' })
          ).rejects.toThrow('At least one token amount must be greater than 0');
        });
      });

      describe('Token1 amount validation', () => {
        it('should throw error for missing token1Amount', async () => {
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, token1Amount: null })
          ).rejects.toThrow('Token1 amount is required');
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, token1Amount: undefined })
          ).rejects.toThrow('Token1 amount is required');
        });

        it('should throw error for non-string token1Amount', async () => {
          const invalidTypes = [123, true, false, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.getAddLiquidityQuote({ ...baseParams, token1Amount: invalidType })
            ).rejects.toThrow('Token1 amount must be a string');
          }
        });

        it('should throw error for invalid token1Amount format', async () => {
          const invalidAmounts = ['', 'abc', '12.5', '-100', '12abc', ' 123', '123 '];
          for (const invalidAmount of invalidAmounts) {
            await expect(
              adapter.getAddLiquidityQuote({ ...baseParams, token1Amount: invalidAmount })
            ).rejects.toThrow('Token1 amount must be a positive numeric string');
          }
        });
      });

      describe('Provider validation', () => {
        it('should throw error for missing provider', async () => {
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, provider: null })
          ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, provider: undefined })
          ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
        });

        it('should throw error for invalid provider', async () => {
          const invalidProviders = [{}, [], 'provider', 123, true];
          for (const invalidProvider of invalidProviders) {
            await expect(
              adapter.getAddLiquidityQuote({ ...baseParams, provider: invalidProvider })
            ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
          }
        });
      });

      describe('Pool data validation', () => {
        it('should throw error for missing pool data', async () => {
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, poolData: null })
          ).rejects.toThrow('Pool data parameter is required');
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, poolData: undefined })
          ).rejects.toThrow('Pool data parameter is required');
        });

        it('should throw error for non-object pool data', async () => {
          const invalidTypes = ['string', 123, true, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.getAddLiquidityQuote({ ...baseParams, poolData: invalidType })
            ).rejects.toThrow('Pool data must be an object');
          }
        });
      });

      describe('Token data validation', () => {
        it('should throw error for missing token data', async () => {
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, token0Data: null })
          ).rejects.toThrow('Token0 data parameter is required');
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, token1Data: null })
          ).rejects.toThrow('Token1 data parameter is required');
        });

        it('should throw error for non-object token data', async () => {
          const invalidTypes = ['string', 123, true, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.getAddLiquidityQuote({ ...baseParams, token0Data: invalidType })
            ).rejects.toThrow('Token0 data must be an object');
            await expect(
              adapter.getAddLiquidityQuote({ ...baseParams, token1Data: invalidType })
            ).rejects.toThrow('Token1 data must be an object');
          }
        });

        it('should throw error for missing token decimals', async () => {
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, token0Data: { address: env.usdcAddress } })
          ).rejects.toThrow('Token0 decimals is required');
          await expect(
            adapter.getAddLiquidityQuote({ ...baseParams, token1Data: { address: env.wethAddress } })
          ).rejects.toThrow('Token1 decimals is required');
        });

        it('should throw error for invalid token decimals', async () => {
          const invalidDecimals = ['6', true, false, {}, [], -1, 256, NaN, Infinity];
          for (const invalidDecimal of invalidDecimals) {
            await expect(
              adapter.getAddLiquidityQuote({ ...baseParams, token0Data: { ...baseParams.token0Data, decimals: invalidDecimal } })
            ).rejects.toThrow('Token0 decimals must be a finite number between 0 and 255');
          }
        });
      });
    });
  });

  describe('getSwapQuote', () => {
    describe('Success Cases', () => {
      it('should return correct quote for 0.5 ETH → USDC swap', async () => {
        // Test 1: Standard token pair quote
        const quoteParams = {
          tokenInAddress: env.wethAddress,
          tokenOutAddress: env.usdcAddress,
          fee: 500,
          amountIn: ethers.parseEther('0.5').toString(), // 0.5 ETH
          provider: env.provider
        };

        const quote = await adapter.getSwapQuote(quoteParams);

        // Test 9: Quote returns positive string
        expect(typeof quote).toBe('string');
        expect(quote).not.toBe('0');
        expect(BigInt(quote)).toBeGreaterThan(0n);

        // Test 10: Quote format validation
        expect(quote).toMatch(/^\d+$/);

        // Test 11: Quote reasonableness - should be roughly 0.5 * usdcPerEth
        const expectedUsdc = parseFloat(env.usdcPerEth) * 0.5;
        const actualUsdc = parseFloat(ethers.formatUnits(quote, 6));

        // Allow 5% variance due to price impact
        expect(actualUsdc).toBeGreaterThan(expectedUsdc * 0.95);
        expect(actualUsdc).toBeLessThan(expectedUsdc * 1.05);
      });

      it('should return correct quote for 1000 USDC → ETH swap', async () => {
        // Test 2: Reverse direction quote
        const quoteParams = {
          tokenInAddress: env.usdcAddress,
          tokenOutAddress: env.wethAddress,
          fee: 500,
          amountIn: ethers.parseUnits('1000', 6).toString(), // 1000 USDC
          provider: env.provider
        };

        const quote = await adapter.getSwapQuote(quoteParams);

        // Test 9: Quote returns positive string
        expect(typeof quote).toBe('string');
        expect(quote).not.toBe('0');
        expect(BigInt(quote)).toBeGreaterThan(0n);

        // Test 10: Quote format validation
        expect(quote).toMatch(/^\d+$/);

        // Test 11: Quote reasonableness - should be roughly 1000 / usdcPerEth
        const expectedEth = 1000 / parseFloat(env.usdcPerEth);
        const actualEth = parseFloat(ethers.formatEther(quote));

        // Allow 5% variance due to price impact
        expect(actualEth).toBeGreaterThan(expectedEth * 0.95);
        expect(actualEth).toBeLessThan(expectedEth * 1.05);
      });

      it('should return consistent quotes for multiple calls', async () => {
        // Test 14: Quote consistency
        const quoteParams = {
          tokenInAddress: env.usdcAddress,
          tokenOutAddress: env.wethAddress,
          fee: 500,
          amountIn: ethers.parseUnits('500', 6).toString(), // 500 USDC
          provider: env.provider
        };

        const quote1 = await adapter.getSwapQuote(quoteParams);
        const quote2 = await adapter.getSwapQuote(quoteParams);
        const quote3 = await adapter.getSwapQuote(quoteParams);

        // All quotes should be identical since pool state hasn't changed
        expect(quote1).toBe(quote2);
        expect(quote2).toBe(quote3);

        // All should be positive and well-formatted
        for (const quote of [quote1, quote2, quote3]) {
          expect(typeof quote).toBe('string');
          expect(quote).toMatch(/^\d+$/);
          expect(BigInt(quote)).toBeGreaterThan(0n);
        }
      });
    });

    describe('Error Cases', () => {
      describe('TokenIn address validation', () => {
        it('should throw error for missing tokenIn address', async () => {
          await expect(
            adapter.getSwapQuote({
              tokenInAddress: null,
              tokenOutAddress: env.wethAddress,
              fee: 500,
              amountIn: ethers.parseUnits('100', 6).toString(),
              provider: env.provider
            })
          ).rejects.toThrow('TokenIn address parameter is required');

          await expect(
            adapter.getSwapQuote({
              tokenInAddress: undefined,
              tokenOutAddress: env.wethAddress,
              fee: 500,
              amountIn: ethers.parseUnits('100', 6).toString(),
              provider: env.provider
            })
          ).rejects.toThrow('TokenIn address parameter is required');

          await expect(
            adapter.getSwapQuote({
              tokenInAddress: '',
              tokenOutAddress: env.wethAddress,
              fee: 500,
              amountIn: ethers.parseUnits('100', 6).toString(),
              provider: env.provider
            })
          ).rejects.toThrow('TokenIn address parameter is required');
        });

        it('should throw error for invalid tokenIn address format', async () => {
          const invalidAddresses = ['not-an-address', '0x123', '0xGHIJKL'];

          for (const invalidAddress of invalidAddresses) {
            await expect(
              adapter.getSwapQuote({
                tokenInAddress: invalidAddress,
                tokenOutAddress: env.wethAddress,
                fee: 500,
                amountIn: ethers.parseUnits('100', 6).toString(),
                provider: env.provider
              })
            ).rejects.toThrow(`Invalid tokenIn address: ${invalidAddress}`);
          }
        });
      });

      describe('TokenOut address validation', () => {
        it('should throw error for missing tokenOut address', async () => {
          await expect(
            adapter.getSwapQuote({
              tokenInAddress: env.usdcAddress,
              tokenOutAddress: null,
              fee: 500,
              amountIn: ethers.parseUnits('100', 6).toString(),
              provider: env.provider
            })
          ).rejects.toThrow('TokenOut address parameter is required');

          await expect(
            adapter.getSwapQuote({
              tokenInAddress: env.usdcAddress,
              tokenOutAddress: undefined,
              fee: 500,
              amountIn: ethers.parseUnits('100', 6).toString(),
              provider: env.provider
            })
          ).rejects.toThrow('TokenOut address parameter is required');

          await expect(
            adapter.getSwapQuote({
              tokenInAddress: env.usdcAddress,
              tokenOutAddress: '',
              fee: 500,
              amountIn: ethers.parseUnits('100', 6).toString(),
              provider: env.provider
            })
          ).rejects.toThrow('TokenOut address parameter is required');
        });

        it('should throw error for invalid tokenOut address format', async () => {
          const invalidAddresses = ['not-an-address', '0x123', '0xGHIJKL'];

          for (const invalidAddress of invalidAddresses) {
            await expect(
              adapter.getSwapQuote({
                tokenInAddress: env.usdcAddress,
                tokenOutAddress: invalidAddress,
                fee: 500,
                amountIn: ethers.parseUnits('100', 6).toString(),
                provider: env.provider
              })
            ).rejects.toThrow(`Invalid tokenOut address: ${invalidAddress}`);
          }
        });
      });

      describe('Fee validation', () => {
        it('should throw error for missing fee', async () => {
          await expect(
            adapter.getSwapQuote({
                tokenInAddress: env.usdcAddress,
                tokenOutAddress: env.wethAddress,
                fee: null,
                amountIn: ethers.parseUnits('100', 6).toString(),
                provider: env.provider
              })
          ).rejects.toThrow('Fee parameter is required');

          await expect(
            adapter.getSwapQuote({
                tokenInAddress: env.usdcAddress,
                tokenOutAddress: env.wethAddress,
                fee: undefined,
                amountIn: ethers.parseUnits('100', 6).toString(),
                provider: env.provider
              })
          ).rejects.toThrow('Fee parameter is required');
        });

        it('should throw error for invalid fee types', async () => {
          const invalidTypes = ['500', true, {}, [], NaN, Infinity, -Infinity];

          for (const invalidType of invalidTypes) {
            await expect(
              adapter.getSwapQuote({
                tokenInAddress: env.usdcAddress,
                tokenOutAddress: env.wethAddress,
                fee: invalidType,
                amountIn: ethers.parseUnits('100', 6).toString(),
                provider: env.provider
              })
            ).rejects.toThrow('Fee must be a valid number');
          }
        });

        it('should throw error for invalid fee tiers', async () => {
          const invalidFees = [1000, 5000, 15000, 0, -500, 1, 2, 999999];

          for (const invalidFee of invalidFees) {
            await expect(
              adapter.getSwapQuote({
                tokenInAddress: env.usdcAddress,
                tokenOutAddress: env.wethAddress,
                fee: invalidFee,
                amountIn: ethers.parseUnits('100', 6).toString(),
                provider: env.provider
              })
            ).rejects.toThrow('Invalid fee tier');
          }
        });
      });

      describe('AmountIn validation', () => {
        it('should throw error for missing amountIn', async () => {
          await expect(
            adapter.getSwapQuote({
              tokenInAddress: env.usdcAddress,
              tokenOutAddress: env.wethAddress,
              fee: 500,
              amountIn: null,
              provider: env.provider
            })
          ).rejects.toThrow('AmountIn parameter is required');

          await expect(
            adapter.getSwapQuote({
              tokenInAddress: env.usdcAddress,
              tokenOutAddress: env.wethAddress,
              fee: 500,
              amountIn: undefined,
              provider: env.provider
            })
          ).rejects.toThrow('AmountIn parameter is required');

          await expect(
            adapter.getSwapQuote({
              tokenInAddress: env.usdcAddress,
              tokenOutAddress: env.wethAddress,
              fee: 500,
              amountIn: '',
              provider: env.provider
            })
          ).rejects.toThrow('AmountIn parameter is required');
        });

        it('should throw error for invalid amountIn format', async () => {
          const invalidAmounts = [
            'invalid-amount',
            '123.456', // No decimals allowed
            '0x123', // No hex
            '-100', // No negative
            '1e18', // No scientific notation
            '1,000' // No commas
          ];

          for (const invalidAmount of invalidAmounts) {
            await expect(
              adapter.getSwapQuote({
                tokenInAddress: env.usdcAddress,
                tokenOutAddress: env.wethAddress,
                fee: 500,
                amountIn: invalidAmount,
                provider: env.provider
              })
            ).rejects.toThrow('AmountIn must be a positive numeric string');
          }
        });

        it('should throw error for zero amountIn', async () => {
          await expect(
            adapter.getSwapQuote({
              tokenInAddress: env.usdcAddress,
              tokenOutAddress: env.wethAddress,
              fee: 500,
              amountIn: '0',
              provider: env.provider
            })
          ).rejects.toThrow('AmountIn cannot be zero');
        });
      });

      describe('Provider validation', () => {
        it('should throw error for missing provider', async () => {
          await expect(
            adapter.getSwapQuote({
                tokenInAddress: env.usdcAddress,
                tokenOutAddress: env.wethAddress,
                fee: 500,
                amountIn: ethers.parseUnits('100', 6).toString(),
                provider: null
              })
          ).rejects.toThrow('Invalid provider');

          await expect(
            adapter.getSwapQuote({
                tokenInAddress: env.usdcAddress,
                tokenOutAddress: env.wethAddress,
                fee: 500,
                amountIn: ethers.parseUnits('100', 6).toString(),
                provider: undefined
              })
          ).rejects.toThrow('Invalid provider');
        });

        it('should throw error for invalid provider type', async () => {
          const invalidTypes = ['string', 123, true, {}, []];

          for (const invalidType of invalidTypes) {
            await expect(
              adapter.getSwapQuote({
                tokenInAddress: env.usdcAddress,
                tokenOutAddress: env.wethAddress,
                fee: 500,
                amountIn: ethers.parseUnits('100', 6).toString(),
                provider: invalidType
              })
            ).rejects.toThrow('Invalid provider');
          }
        });
      });
    });

    describe('Special Cases', () => {
      it('should throw error when tokenIn and tokenOut are the same', async () => {
        await expect(
          adapter.getSwapQuote({
            tokenInAddress: env.usdcAddress,
            tokenOutAddress: env.usdcAddress, // Same as tokenIn
            fee: 500,
            amountIn: ethers.parseUnits('100', 6).toString(),
            provider: env.provider
          })
        ).rejects.toThrow('Failed to get swap quote');
      });

      it('should handle pool with minimal liquidity gracefully', async () => {
        // Find a pool with very low liquidity - typically higher fee tiers have less liquidity
        // Using 10000 fee tier which often has minimal liquidity
        const highFeePoolExists = await adapter.checkPoolExists(
          { address: env.wethAddress, decimals: 18 },
          { address: env.usdcAddress, decimals: 6 },
          10000,
          env.provider
        );

        if (highFeePoolExists.exists) {
          // Try to swap a reasonable amount through low liquidity pool
          const result = await adapter.getSwapQuote({
            tokenInAddress: env.wethAddress,
            tokenOutAddress: env.usdcAddress,
            fee: 10000,
            amountIn: ethers.parseEther('0.1').toString(), // 0.1 ETH
            provider: env.provider
          });

          // Should still return a valid quote, even if price impact is high
          expect(result).toMatch(/^\d+$/);
          expect(BigInt(result)).toBeGreaterThan(0n);
        }
      });

      it('should handle token ordering correctly regardless of input order', async () => {
        // Get quotes for same pool with tokens in different order
        const amountWeth = ethers.parseEther('1').toString();
        const amountUsdc = ethers.parseUnits('2000', 6).toString();

        // WETH -> USDC
        const quoteWethToUsdc = await adapter.getSwapQuote({
          tokenInAddress: env.wethAddress,
          tokenOutAddress: env.usdcAddress,
          fee: 500,
          amountIn: amountWeth,
          provider: env.provider
        });

        // USDC -> WETH
        const quoteUsdcToWeth = await adapter.getSwapQuote({
          tokenInAddress: env.usdcAddress,
          tokenOutAddress: env.wethAddress,
          fee: 500,
          amountIn: amountUsdc,
          provider: env.provider
        });

        // Both should return valid quotes
        expect(quoteWethToUsdc).toMatch(/^\d+$/);
        expect(quoteUsdcToWeth).toMatch(/^\d+$/);
        expect(BigInt(quoteWethToUsdc)).toBeGreaterThan(0n);
        expect(BigInt(quoteUsdcToWeth)).toBeGreaterThan(0n);

        // The quotes should be inversely related (approximately)
        // If 1 WETH = ~2000 USDC, then 2000 USDC should = ~1 WETH
        const wethFromUsdc = parseFloat(ethers.formatEther(quoteUsdcToWeth));
        const usdcFromWeth = parseFloat(ethers.formatUnits(quoteWethToUsdc, 6));

        // Should be roughly reciprocal (within 10% due to fees and price impact)
        const expectedWeth = parseFloat(ethers.formatUnits(amountUsdc, 6)) / usdcFromWeth;
        expect(wethFromUsdc).toBeGreaterThan(expectedWeth * 0.9);
        expect(wethFromUsdc).toBeLessThan(expectedWeth * 1.1);
      });

      it('should throw error for non-existent pool', async () => {
        // Use fake token addresses that would create a non-existent pool
        const fakeToken1 = '0x0000000000000000000000000000000000000001';
        const fakeToken2 = '0x0000000000000000000000000000000000000002';

        // First verify pool doesn't exist
        const poolExists = await adapter.checkPoolExists(
          { address: fakeToken1, decimals: 18 },
          { address: fakeToken2, decimals: 18 },
          500, // Valid fee tier but with fake tokens - pool doesn't exist
          env.provider
        );

        expect(poolExists.exists).toBe(false);

        // Now try to get quote from non-existent pool
        await expect(
          adapter.getSwapQuote({
            tokenInAddress: fakeToken1,
            tokenOutAddress: fakeToken2,
            fee: 500, // Valid fee tier but with fake tokens - pool doesn't exist
            amountIn: ethers.parseEther('1').toString(),
            provider: env.provider
          })
        ).rejects.toThrow('Failed to get swap quote');
      });
    });
  });

  describe('generateSwapData', () => {
    describe('Success Cases', () => {
      it('should generate valid transaction data for ETH → USDC swap', async () => {
        const swapParams = {
          tokenIn: env.wethAddress,
          tokenOut: env.usdcAddress,
          fee: 500,
          recipient: await env.testVault.getAddress(),
          amountIn: ethers.parseEther('0.5').toString(),
          slippageTolerance: 0.5,
          sqrtPriceLimitX96: "0",
          deadlineMinutes: 30,
          provider: env.provider
        };

        const result = await adapter.generateSwapData(swapParams);

        // Basic structure validation
        expect(result).toBeDefined();
        expect(result).toBeTypeOf('object');
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');

        // Type validation
        expect(typeof result.to).toBe('string');
        expect(typeof result.data).toBe('string');
        expect(typeof result.value).toBe('string');

        // Format validation
        expect(result.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result.data).toMatch(/^0x[a-fA-F0-9]+$/);

        // Contract address should be router
        expect(result.to).toBe(adapter.addresses.routerAddress);

        // Data should contain exactInputSingle function selector
        expect(result.data).toMatch(/^0x414bf389/); // exactInputSingle function selector
        expect(result.data.length).toBeGreaterThan(10);

        // Value should be 0x00 for ERC20 swaps (hex format like SDK)
        expect(result.value).toBe("0x00");
      });

      it('should generate valid transaction data for USDC → ETH swap', async () => {
        const swapParams = {
          tokenIn: env.usdcAddress,
          tokenOut: env.wethAddress,
          fee: 500,
          recipient: await env.testVault.getAddress(),
          amountIn: ethers.parseUnits('1000', 6).toString(),
          slippageTolerance: 0.5,
          sqrtPriceLimitX96: "0",
          deadlineMinutes: 30,
          provider: env.provider
        };

        const result = await adapter.generateSwapData(swapParams);

        // Basic structure validation
        expect(result).toBeDefined();
        expect(result).toBeTypeOf('object');
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');

        // Type validation
        expect(typeof result.to).toBe('string');
        expect(typeof result.data).toBe('string');
        expect(typeof result.value).toBe('string');

        // Format validation
        expect(result.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result.data).toMatch(/^0x[a-fA-F0-9]+$/);

        // Contract address should be router
        expect(result.to).toBe(adapter.addresses.routerAddress);

        // Data should contain exactInputSingle function selector
        expect(result.data).toMatch(/^0x414bf389/); // exactInputSingle function selector
        expect(result.data.length).toBeGreaterThan(10);

        // Value should be 0x00 for ERC20 swaps (hex format like SDK)
        expect(result.value).toBe("0x00");
      });

      it('should be deterministic for same inputs', async () => {
        // Mock Date.now to return a fixed timestamp for this test only
        const mockTime = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(mockTime);

        const swapParams = {
          tokenIn: env.wethAddress,
          tokenOut: env.usdcAddress,
          fee: 500,
          recipient: await env.testVault.getAddress(),
          amountIn: ethers.parseEther('0.5').toString(),
          slippageTolerance: 0.5,
          sqrtPriceLimitX96: "0",
          deadlineMinutes: 30,
          provider: env.provider
        };

        const result1 = await adapter.generateSwapData(swapParams);
        const result2 = await adapter.generateSwapData(swapParams);

        expect(result1.to).toBe(result2.to);
        expect(result1.data).toBe(result2.data);
        expect(result1.value).toBe(result2.value);

        // Restore Date.now for other tests
        vi.restoreAllMocks();
      });
    });

    describe('Error Cases', () => {
      let baseParams;
      beforeEach(async () => {
        baseParams = {
          tokenIn: env.wethAddress,
          tokenOut: env.usdcAddress,
          fee: 500,
          recipient: await env.testVault.getAddress(),
          amountIn: ethers.parseEther('0.5').toString(),
          slippageTolerance: 0.5,
          sqrtPriceLimitX96: "0",
          deadlineMinutes: 30,
          provider: env.provider
        };
      });

      describe('TokenIn address validation', () => {
        it('should throw error for missing tokenIn address', async () => {
          await expect(
            adapter.generateSwapData({ ...baseParams, tokenIn: null })
          ).rejects.toThrow('TokenIn address parameter is required');
          await expect(
            adapter.generateSwapData({ ...baseParams, tokenIn: undefined })
          ).rejects.toThrow('TokenIn address parameter is required');
          await expect(
            adapter.generateSwapData({ ...baseParams, tokenIn: '' })
          ).rejects.toThrow('TokenIn address parameter is required');
        });

        it('should throw error for invalid tokenIn address format', async () => {
          const invalidAddresses = ['not-an-address', '0x123', '0xGHIJKL'];
          for (const invalidAddress of invalidAddresses) {
            await expect(
              adapter.generateSwapData({ ...baseParams, tokenIn: invalidAddress })
            ).rejects.toThrow(`Invalid tokenIn address: ${invalidAddress}`);
          }
        });

        it('should throw error for non-string tokenIn address', async () => {
          // Falsy non-string types hit the "required" check
          await expect(
            adapter.generateSwapData({ ...baseParams, tokenIn: false })
          ).rejects.toThrow('TokenIn address parameter is required');

          // Truthy non-string types make it to ethers.getAddress() and fail there
          const truthyTypes = [123, true, {}, []];
          for (const invalidType of truthyTypes) {
            await expect(
              adapter.generateSwapData({ ...baseParams, tokenIn: invalidType })
            ).rejects.toThrow(`Invalid tokenIn address: ${invalidType}`);
          }
        });
      });

      describe('TokenOut address validation', () => {
        it('should throw error for missing tokenOut address', async () => {
          await expect(
            adapter.generateSwapData({ ...baseParams, tokenOut: null })
          ).rejects.toThrow('TokenOut address parameter is required');
          await expect(
            adapter.generateSwapData({ ...baseParams, tokenOut: undefined })
          ).rejects.toThrow('TokenOut address parameter is required');
          await expect(
            adapter.generateSwapData({ ...baseParams, tokenOut: '' })
          ).rejects.toThrow('TokenOut address parameter is required');
        });

        it('should throw error for invalid tokenOut address format', async () => {
          const invalidAddresses = ['not-an-address', '0x123', '0xGHIJKL'];
          for (const invalidAddress of invalidAddresses) {
            await expect(
              adapter.generateSwapData({ ...baseParams, tokenOut: invalidAddress })
            ).rejects.toThrow(`Invalid tokenOut address: ${invalidAddress}`);
          }
        });

        it('should throw error for non-string tokenOut address', async () => {
          // Falsy non-string types hit the "required" check
          await expect(
            adapter.generateSwapData({ ...baseParams, tokenOut: false })
          ).rejects.toThrow('TokenOut address parameter is required');

          // Truthy non-string types make it to ethers.getAddress() and fail there
          const truthyTypes = [123, true, {}, []];
          for (const invalidType of truthyTypes) {
            await expect(
              adapter.generateSwapData({ ...baseParams, tokenOut: invalidType })
            ).rejects.toThrow(`Invalid tokenOut address: ${invalidType}`);
          }
        });
      });

      describe('Fee validation', () => {
        it('should throw error for missing fee', async () => {
          await expect(
            adapter.generateSwapData({ ...baseParams, fee: null })
          ).rejects.toThrow('Fee parameter is required');
          await expect(
            adapter.generateSwapData({ ...baseParams, fee: undefined })
          ).rejects.toThrow('Fee parameter is required');
        });

        it('should throw error for non-number fee', async () => {
          const invalidTypes = ['500', true, false, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateSwapData({ ...baseParams, fee: invalidType })
            ).rejects.toThrow('Fee must be a valid number');
          }
        });

        it('should throw error for invalid fee tiers', async () => {
          // Invalid numbers (NaN, Infinity) fail the "valid number" check first
          const invalidNumbers = [NaN, Infinity];
          for (const invalidNumber of invalidNumbers) {
            await expect(
              adapter.generateSwapData({ ...baseParams, fee: invalidNumber })
            ).rejects.toThrow('Fee must be a valid number');
          }

          // Valid numbers but invalid fee tiers fail the fee tier check
          const invalidTiers = [1000, 5000, 15000, 0, -500, 1, 2, 999999];
          for (const invalidTier of invalidTiers) {
            await expect(
              adapter.generateSwapData({ ...baseParams, fee: invalidTier })
            ).rejects.toThrow('Invalid fee tier');
          }
        });
      });

      describe('Recipient address validation', () => {
        it('should throw error for missing recipient address', async () => {
          await expect(
            adapter.generateSwapData({ ...baseParams, recipient: null })
          ).rejects.toThrow('Recipient address parameter is required');
          await expect(
            adapter.generateSwapData({ ...baseParams, recipient: undefined })
          ).rejects.toThrow('Recipient address parameter is required');
          await expect(
            adapter.generateSwapData({ ...baseParams, recipient: '' })
          ).rejects.toThrow('Recipient address parameter is required');
        });

        it('should throw error for invalid recipient address format', async () => {
          const invalidAddresses = ['not-an-address', '0x123', '0xGHIJKL'];
          for (const invalidAddress of invalidAddresses) {
            await expect(
              adapter.generateSwapData({ ...baseParams, recipient: invalidAddress })
            ).rejects.toThrow(`Invalid recipient address: ${invalidAddress}`);
          }
        });

        it('should throw error for non-string recipient address', async () => {
          // Falsy non-string types hit the "required" check
          await expect(
            adapter.generateSwapData({ ...baseParams, recipient: false })
          ).rejects.toThrow('Recipient address parameter is required');

          // Truthy non-string types make it to ethers.getAddress() and fail there
          const truthyTypes = [123, true, {}, []];
          for (const invalidType of truthyTypes) {
            await expect(
              adapter.generateSwapData({ ...baseParams, recipient: invalidType })
            ).rejects.toThrow(`Invalid recipient address: ${invalidType}`);
          }
        });
      });

      describe('AmountIn validation', () => {
        it('should throw error for missing amountIn', async () => {
          await expect(
            adapter.generateSwapData({ ...baseParams, amountIn: null })
          ).rejects.toThrow('AmountIn parameter is required');
          await expect(
            adapter.generateSwapData({ ...baseParams, amountIn: undefined })
          ).rejects.toThrow('AmountIn parameter is required');
          await expect(
            adapter.generateSwapData({ ...baseParams, amountIn: '' })
          ).rejects.toThrow('AmountIn parameter is required');
        });

        it('should throw error for non-string amountIn', async () => {
          // Falsy non-string types hit the "required" check
          await expect(
            adapter.generateSwapData({ ...baseParams, amountIn: false })
          ).rejects.toThrow('AmountIn parameter is required');

          // Truthy non-string types make it to string type check and fail there
          const truthyTypes = [123, true, {}, []];
          for (const invalidType of truthyTypes) {
            await expect(
              adapter.generateSwapData({ ...baseParams, amountIn: invalidType })
            ).rejects.toThrow('AmountIn must be a string');
          }
        });

        it('should throw error for invalid amountIn format', async () => {
          const invalidAmounts = ['abc', '12.5', '-100', '12abc', ' 123', '123 '];
          for (const invalidAmount of invalidAmounts) {
            await expect(
              adapter.generateSwapData({ ...baseParams, amountIn: invalidAmount })
            ).rejects.toThrow('AmountIn must be a positive numeric string');
          }
        });

        it('should throw error for zero amountIn', async () => {
          await expect(
            adapter.generateSwapData({ ...baseParams, amountIn: '0' })
          ).rejects.toThrow('AmountIn cannot be zero');
        });
      });

      describe('Slippage tolerance validation', () => {
        it('should throw error for missing slippage tolerance', async () => {
          await expect(
            adapter.generateSwapData({ ...baseParams, slippageTolerance: null })
          ).rejects.toThrow('Slippage tolerance is required');
          await expect(
            adapter.generateSwapData({ ...baseParams, slippageTolerance: undefined })
          ).rejects.toThrow('Slippage tolerance is required');
        });

        it('should throw error for non-number slippage tolerance', async () => {
          const invalidTypes = ['0.5', true, false, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateSwapData({ ...baseParams, slippageTolerance: invalidType })
            ).rejects.toThrow('Slippage tolerance must be a finite number');
          }
        });

        it('should throw error for out-of-range slippage tolerance', async () => {
          // Non-finite values fail the "finite number" check first
          const nonFiniteValues = [NaN, Infinity, -Infinity];
          for (const invalidValue of nonFiniteValues) {
            await expect(
              adapter.generateSwapData({ ...baseParams, slippageTolerance: invalidValue })
            ).rejects.toThrow('Slippage tolerance must be a finite number');
          }

          // Finite values but out of range fail the range check
          const outOfRangeValues = [-1, -0.1, 101, 150];
          for (const invalidValue of outOfRangeValues) {
            await expect(
              adapter.generateSwapData({ ...baseParams, slippageTolerance: invalidValue })
            ).rejects.toThrow('Slippage tolerance must be between 0 and 100');
          }
        });
      });

      describe('SqrtPriceLimitX96 validation', () => {
        it('should throw error for missing sqrtPriceLimitX96', async () => {
          await expect(
            adapter.generateSwapData({ ...baseParams, sqrtPriceLimitX96: null })
          ).rejects.toThrow('sqrtPriceLimitX96 parameter is required');
          await expect(
            adapter.generateSwapData({ ...baseParams, sqrtPriceLimitX96: undefined })
          ).rejects.toThrow('sqrtPriceLimitX96 parameter is required');
        });

        it('should throw error for non-string sqrtPriceLimitX96', async () => {
          const invalidTypes = [123, true, false, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateSwapData({ ...baseParams, sqrtPriceLimitX96: invalidType })
            ).rejects.toThrow('sqrtPriceLimitX96 must be a string');
          }
        });

        it('should throw error for invalid sqrtPriceLimitX96 format', async () => {
          const invalidValues = ['abc', '-100', '12.5', ' 123', '123 '];
          for (const invalidValue of invalidValues) {
            await expect(
              adapter.generateSwapData({ ...baseParams, sqrtPriceLimitX96: invalidValue })
            ).rejects.toThrow('sqrtPriceLimitX96 must be a positive numeric string');
          }
        });
      });

      describe('Deadline validation', () => {
        it('should throw error for missing deadline', async () => {
          await expect(
            adapter.generateSwapData({ ...baseParams, deadlineMinutes: null })
          ).rejects.toThrow('Deadline minutes is required');
          await expect(
            adapter.generateSwapData({ ...baseParams, deadlineMinutes: undefined })
          ).rejects.toThrow('Deadline minutes is required');
        });

        it('should throw error for non-number deadline', async () => {
          const invalidTypes = ['30', true, false, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateSwapData({ ...baseParams, deadlineMinutes: invalidType })
            ).rejects.toThrow('Deadline minutes must be a non-negative number');
          }
        });

        it('should throw error for negative deadline', async () => {
          const invalidValues = [-1, -0.1, NaN, Infinity, -Infinity];
          for (const invalidValue of invalidValues) {
            await expect(
              adapter.generateSwapData({ ...baseParams, deadlineMinutes: invalidValue })
            ).rejects.toThrow('Deadline minutes must be a non-negative number');
          }
        });
      });

      describe('Provider validation', () => {
        it('should throw error for missing provider', async () => {
          await expect(
            adapter.generateSwapData({ ...baseParams, provider: null })
          ).rejects.toThrow('Invalid provider');
          await expect(
            adapter.generateSwapData({ ...baseParams, provider: undefined })
          ).rejects.toThrow('Invalid provider');
        });

        it('should throw error for invalid provider', async () => {
          const invalidProviders = [{}, [], 'provider', 123, true];
          for (const invalidProvider of invalidProviders) {
            await expect(
              adapter.generateSwapData({ ...baseParams, provider: invalidProvider })
            ).rejects.toThrow('Invalid provider');
          }
        });
      });
    });

    describe('Special Cases', () => {
      it('should throw error when tokenIn and tokenOut are the same', async () => {
        await expect(
          adapter.generateSwapData({
            tokenIn: env.usdcAddress,
            tokenOut: env.usdcAddress, // Same as tokenIn
            fee: 500,
            recipient: await env.testVault.getAddress(),
            amountIn: ethers.parseUnits('100', 6).toString(),
            slippageTolerance: 0.5,
            sqrtPriceLimitX96: "0",
            deadlineMinutes: 30,
            provider: env.provider
          })
        ).rejects.toThrow('Failed to generate swap data');
      });


      it('should throw error for non-existent pool', async () => {
        // Use fake token addresses that would create a non-existent pool
        const fakeToken1 = '0x0000000000000000000000000000000000000001';
        const fakeToken2 = '0x0000000000000000000000000000000000000002';

        await expect(
          adapter.generateSwapData({
            tokenIn: fakeToken1,
            tokenOut: fakeToken2,
            fee: 500, // Valid fee tier but pool doesn't exist
            recipient: await env.testVault.getAddress(),
            amountIn: ethers.parseEther('1').toString(),
            slippageTolerance: 0.5,
            sqrtPriceLimitX96: "0",
            deadlineMinutes: 30,
            provider: env.provider
          })
        ).rejects.toThrow('Failed to generate swap data');
      });
    });
  });

  describe('generateAddLiquidityData', () => {
    describe('Success Cases', () => {
      let baseParams;
      beforeEach(async () => {
        // Get pool data for test tokens
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        // Use real position tick values from test environment
        const { tickLower, tickUpper } = env.testPosition;

        baseParams = {
          position: {
            id: env.positionTokenId.toString(),
            tickLower: tickLower,
            tickUpper: tickUpper
          },
          token0Amount: ethers.parseUnits("100", 6).toString(), // USDC: 100 tokens
          token1Amount: ethers.parseUnits("0.1", 18).toString(), // WETH: 0.1 tokens
          provider: env.provider,
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          },
          slippageTolerance: 0.5,
          deadlineMinutes: 30
        };
      });

      it('should generate valid transaction data for adding liquidity', async () => {
        const result = await adapter.generateAddLiquidityData(baseParams);

        // Basic structure validation
        expect(result).toBeDefined();
        expect(result).toBeTypeOf('object');
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');

        // Type validation
        expect(typeof result.to).toBe('string');
        expect(typeof result.data).toBe('string');
        expect(typeof result.value).toBe('string');
        expect(typeof result.quote).toBe('object');

        // Format validation
        expect(result.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result.data).toMatch(/^0x[a-fA-F0-9]+$/);

        // Contract address should be position manager
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);

        // Value should be 0x00 for ERC20 operations (SDK returns hex format)
        expect(result.value).toBe('0x00');

        // Data should contain addLiquidity function and have substantial calldata
        expect(result.data.length).toBeGreaterThan(10);
      });

      it('should generate valid transaction data for adding both token amounts', async () => {
        const result = await adapter.generateAddLiquidityData(baseParams);

        // Basic structure validation
        expect(result).toBeDefined();
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');

        // Contract address should be position manager
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);

        // Value should be 0x00 for ERC20 operations
        expect(result.value).toBe('0x00');
      });

      it('should generate valid transaction data for adding only token0', async () => {
        // Create tick range above current price (only token0 can be added)
        // Use poolData.tick to calculate proper out-of-range ticks
        const tickSpacing = 10; // 0.05% fee tier has 10 tick spacing
        const currentTick = env.poolData.tick;

        // Create range above current price
        const tickLower = Math.floor(currentTick / tickSpacing) * tickSpacing + tickSpacing * 20;
        const tickUpper = tickLower + tickSpacing * 20;

        const params = {
          ...baseParams,
          token1Amount: "0",
          position: {
            ...baseParams.position,
            tickLower: tickLower,
            tickUpper: tickUpper
          }
        };

        const result = await adapter.generateAddLiquidityData(params);

        // Basic structure validation
        expect(result).toBeDefined();
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');

        // Contract address should be position manager
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);

        // Value should be 0x00 for ERC20 operations
        expect(result.value).toBe('0x00');
      });

      it('should generate valid transaction data for adding only token1', async () => {
        // Create tick range below current price (only token1 can be added)
        // Use poolData.tick to calculate proper out-of-range ticks
        const tickSpacing = 10; // 0.05% fee tier has 10 tick spacing
        const currentTick = env.poolData.tick;

        // Create range below current price
        const tickUpper = Math.floor(currentTick / tickSpacing) * tickSpacing - tickSpacing * 20;
        const tickLower = tickUpper - tickSpacing * 20;

        const params = {
          ...baseParams,
          token0Amount: "0",
          position: {
            ...baseParams.position,
            tickLower: tickLower,
            tickUpper: tickUpper
          }
        };

        const result = await adapter.generateAddLiquidityData(params);

        // Basic structure validation
        expect(result).toBeDefined();
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');

        // Contract address should be position manager
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);

        // Value should be 0x00 for ERC20 operations
        expect(result.value).toBe('0x00');
      });

      it('should be deterministic for same inputs', async () => {
        const result1 = await adapter.generateAddLiquidityData(baseParams);
        const result2 = await adapter.generateAddLiquidityData(baseParams);

        expect(result1.to).toBe(result2.to);
        expect(result1.data).toBe(result2.data);
        expect(result1.value).toBe(result2.value);
      });

      it('should return calculated amounts with proper token data', async () => {
        const result = await adapter.generateAddLiquidityData(baseParams);

        // Verify quote structure
        expect(result.quote).toBeDefined();
        expect(result.quote).toHaveProperty('position');
        expect(result.quote).toHaveProperty('tokensSwapped');
        expect(result.quote).toHaveProperty('sortedToken0');
        expect(result.quote).toHaveProperty('sortedToken1');
        expect(result.quote).toHaveProperty('pool');

        // Verify position has amounts
        expect(result.quote.position).toHaveProperty('amount0');
        expect(result.quote.position).toHaveProperty('amount1');
        expect(result.quote.position.amount0).toHaveProperty('quotient');
        expect(result.quote.position.amount1).toHaveProperty('quotient');

        // Verify sorted tokens have addresses
        expect(result.quote.sortedToken0).toHaveProperty('address');
        expect(result.quote.sortedToken1).toHaveProperty('address');
        expect(result.quote.sortedToken0.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result.quote.sortedToken1.address).toMatch(/^0x[a-fA-F0-9]{40}$/);

        // Verify amounts are positive numeric strings
        expect(result.quote.position.amount0.quotient.toString()).toMatch(/^\d+$/);
        expect(result.quote.position.amount1.quotient.toString()).toMatch(/^\d+$/);
      });

    });

    describe('Error Cases', () => {
      let baseParams;

      beforeEach(async () => {
        // Get pool data for test tokens
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        // Use real position tick values from test environment
        const { tickLower, tickUpper } = env.testPosition;

        baseParams = {
          position: {
            id: '123',
            tickLower: tickLower,
            tickUpper: tickUpper
          },
          token0Amount: ethers.parseUnits("100", 6).toString(),
          token1Amount: ethers.parseUnits("0.1", 18).toString(),
          provider: env.provider,
          walletAddress: env.signers[0].address,
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          },
          slippageTolerance: 0.5,
          deadlineMinutes: 30
        };
      });

      describe('Position validation', () => {
        it('should throw error for missing position', async () => {
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, position: null })
        ).rejects.toThrow('Position parameter is required');
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, position: undefined })
        ).rejects.toThrow('Position parameter is required');
      });

      it('should throw error for non-object position', async () => {
        const invalidTypes = ['string', 123, true, []];
        for (const invalidType of invalidTypes) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, position: invalidType })
          ).rejects.toThrow('Position must be an object');
        }
      });

      it('should throw error for missing position ID', async () => {
        const invalidPositions = [
          { tickLower: -202410, tickUpper: -201090 },
          { id: null, tickLower: -202410, tickUpper: -201090 },
          { id: undefined, tickLower: -202410, tickUpper: -201090 }
        ];
        for (const invalidPosition of invalidPositions) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, position: invalidPosition })
          ).rejects.toThrow('Position ID is required');
        }
      });

      it('should throw error for non-string position ID', async () => {
        const invalidIds = [123, true, false, {}, []];
        for (const invalidId of invalidIds) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, position: { ...baseParams.position, id: invalidId } })
          ).rejects.toThrow('Position ID must be a string');
        }
      });

      it('should throw error for non-numeric position ID', async () => {
        const invalidIds = ['', 'abc', '12abc', '12.5', '-12', '12-34', ' 123', '123 '];
        for (const invalidId of invalidIds) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, position: { ...baseParams.position, id: invalidId } })
          ).rejects.toThrow('Position ID must be a numeric string');
        }
      });

      it('should throw error for invalid tick values', async () => {
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, position: { ...baseParams.position, tickLower: null } })
        ).rejects.toThrow('Position tickLower is required');
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, position: { ...baseParams.position, tickUpper: null } })
        ).rejects.toThrow('Position tickUpper is required');
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, position: { ...baseParams.position, tickLower: NaN } })
        ).rejects.toThrow('Position tickLower must be a finite number');
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, position: { ...baseParams.position, tickUpper: Infinity } })
        ).rejects.toThrow('Position tickUpper must be a finite number');
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, position: { ...baseParams.position, tickLower: baseParams.position.tickUpper, tickUpper: baseParams.position.tickLower } })
        ).rejects.toThrow('Position tickLower must be less than tickUpper');
      });
    });

    describe('Token0 amount validation', () => {
      it('should throw error for missing token0Amount', async () => {
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, token0Amount: null })
        ).rejects.toThrow('Token0 amount is required');
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, token0Amount: undefined })
        ).rejects.toThrow('Token0 amount is required');
      });

      it('should throw error for non-string token0Amount', async () => {
        const invalidTypes = [123, true, false, {}, []];
        for (const invalidType of invalidTypes) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, token0Amount: invalidType })
          ).rejects.toThrow('Token0 amount must be a string');
        }
      });

      it('should throw error for invalid token0Amount format', async () => {
        const invalidAmounts = ['', 'abc', '12.5', '-100', '12abc', ' 123', '123 '];
        for (const invalidAmount of invalidAmounts) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, token0Amount: invalidAmount })
          ).rejects.toThrow('Token0 amount must be a positive numeric string');
        }
      });

      it('should throw error when both token amounts are zero', async () => {
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, token0Amount: '0', token1Amount: '0' })
        ).rejects.toThrow('At least one token amount must be greater than 0');
      });
    });

    describe('Token1 amount validation', () => {
      it('should throw error for missing token1Amount', async () => {
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, token1Amount: null })
        ).rejects.toThrow('Token1 amount is required');
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, token1Amount: undefined })
        ).rejects.toThrow('Token1 amount is required');
      });

      it('should throw error for non-string token1Amount', async () => {
        const invalidTypes = [123, true, false, {}, []];
        for (const invalidType of invalidTypes) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, token1Amount: invalidType })
          ).rejects.toThrow('Token1 amount must be a string');
        }
      });

      it('should throw error for invalid token1Amount format', async () => {
        const invalidAmounts = ['', 'abc', '12.5', '-100', '12abc', ' 123', '123 '];
        for (const invalidAmount of invalidAmounts) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, token1Amount: invalidAmount })
          ).rejects.toThrow('Token1 amount must be a positive numeric string');
        }
      });
    });

    describe('Provider validation', () => {
      it('should throw error for missing provider', async () => {
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, provider: null })
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, provider: undefined })
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider', async () => {
        const invalidProviders = [{}, [], 'provider', 123, true];
        for (const invalidProvider of invalidProviders) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, provider: invalidProvider })
          ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
        }
      });
    });


    describe('Pool data validation', () => {
      it('should throw error for missing pool data', async () => {
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, poolData: null })
        ).rejects.toThrow('Pool data parameter is required');
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, poolData: undefined })
        ).rejects.toThrow('Pool data parameter is required');
      });

      it('should throw error for non-object pool data', async () => {
        const invalidTypes = ['string', 123, true, []];
        for (const invalidType of invalidTypes) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, poolData: invalidType })
          ).rejects.toThrow('Pool data must be an object');
        }
      });
    });

    describe('Token data validation', () => {
      it('should throw error for missing token data', async () => {
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, token0Data: null })
        ).rejects.toThrow('Token0 data parameter is required');
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, token1Data: null })
        ).rejects.toThrow('Token1 data parameter is required');
      });

      it('should throw error for non-object token data', async () => {
        const invalidTypes = ['string', 123, true, []];
        for (const invalidType of invalidTypes) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, token0Data: invalidType })
          ).rejects.toThrow('Token0 data must be an object');
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, token1Data: invalidType })
          ).rejects.toThrow('Token1 data must be an object');
        }
      });

      it('should throw error for missing token decimals', async () => {
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, token0Data: { address: env.usdcAddress } })
        ).rejects.toThrow('Token0 decimals is required');
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, token1Data: { address: env.wethAddress } })
        ).rejects.toThrow('Token1 decimals is required');
      });

      it('should throw error for invalid token decimals', async () => {
        const invalidDecimals = ['6', true, false, {}, [], -1, 256, NaN, Infinity];
        for (const invalidDecimal of invalidDecimals) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, token0Data: { ...baseParams.token0Data, decimals: invalidDecimal } })
          ).rejects.toThrow('Token0 decimals must be a finite number between 0 and 255');
        }
      });
    });

    describe('Slippage tolerance validation', () => {
      it('should throw error for missing slippage tolerance', async () => {
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, slippageTolerance: null })
        ).rejects.toThrow('Slippage tolerance is required');
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, slippageTolerance: undefined })
        ).rejects.toThrow('Slippage tolerance is required');
      });

      it('should throw error for non-finite slippage tolerance', async () => {
        const invalidValues = ['0.5', true, false, {}, [], NaN, Infinity, -Infinity];
        for (const invalidValue of invalidValues) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, slippageTolerance: invalidValue })
          ).rejects.toThrow('Slippage tolerance must be a finite number');
        }
      });

      it('should throw error for out-of-range slippage tolerance', async () => {
        const invalidValues = [-1, -0.1, 101, 150];
        for (const invalidValue of invalidValues) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, slippageTolerance: invalidValue })
          ).rejects.toThrow('Slippage tolerance must be between 0 and 100');
        }
      });
    });

    describe('Deadline validation', () => {
      it('should throw error for missing deadline', async () => {
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, deadlineMinutes: null })
        ).rejects.toThrow('Deadline minutes is required');
        await expect(
          adapter.generateAddLiquidityData({ ...baseParams, deadlineMinutes: undefined })
        ).rejects.toThrow('Deadline minutes is required');
      });

      it('should throw error for non-finite deadline', async () => {
        const invalidValues = ['30', true, false, {}, [], NaN, Infinity, -Infinity];
        for (const invalidValue of invalidValues) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, deadlineMinutes: invalidValue })
          ).rejects.toThrow('Deadline minutes must be a finite number');
        }
      });

      it('should throw error for negative deadline', async () => {
        const invalidValues = [-1, -0.1];
        for (const invalidValue of invalidValues) {
          await expect(
            adapter.generateAddLiquidityData({ ...baseParams, deadlineMinutes: invalidValue })
          ).rejects.toThrow('Deadline minutes must be greater than 0');
        }
      });
    });
    });
  });

  describe('generateCreatePositionData', () => {
    describe('Success Cases', () => {
      let baseParams;
      beforeEach(async () => {
        // Get pool data for test tokens
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        // Use real position tick values from test environment
        const { tickLower, tickUpper } = env.testPosition;

        baseParams = {
          position: {
            tickLower: tickLower,
            tickUpper: tickUpper
          },
          token0Amount: ethers.parseUnits("100", 6).toString(), // USDC: 100 tokens
          token1Amount: ethers.parseUnits("0.1", 18).toString(), // WETH: 0.1 tokens
          provider: env.provider,
          walletAddress: await env.testVault.getAddress(),
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          },
          slippageTolerance: 0.5,
          deadlineMinutes: 30
        };
      });

      it('should generate valid transaction data for creating position', async () => {
        const result = await adapter.generateCreatePositionData(baseParams);

        // Basic structure validation
        expect(result).toBeDefined();
        expect(result).toBeTypeOf('object');
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');

        // Type validation
        expect(typeof result.to).toBe('string');
        expect(typeof result.data).toBe('string');
        expect(typeof result.value).toBe('string');
        expect(typeof result.quote).toBe('object');

        // Format validation
        expect(result.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result.data).toMatch(/^0x[a-fA-F0-9]+$/);

        // Contract address should be position manager
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);

        // Value should be 0x00 for ERC20 operations (SDK returns hex format)
        expect(result.value).toBe('0x00');

        // Data should contain mint function and have substantial calldata
        expect(result.data.length).toBeGreaterThan(10);
      });

      it('should generate valid transaction data for creating position with both token amounts', async () => {
        const result = await adapter.generateCreatePositionData(baseParams);

        // Basic structure validation
        expect(result).toBeDefined();
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');

        // Contract address should be position manager
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);

        // Value should be 0x00 for ERC20 operations
        expect(result.value).toBe('0x00');
      });

      it('should be deterministic for same inputs', async () => {
        const result1 = await adapter.generateCreatePositionData(baseParams);
        const result2 = await adapter.generateCreatePositionData(baseParams);

        expect(result1.to).toBe(result2.to);
        expect(result1.data).toBe(result2.data);
        expect(result1.value).toBe(result2.value);
      });

      it('should return quote with proper token data', async () => {
        const result = await adapter.generateCreatePositionData(baseParams);

        // Verify quote structure
        expect(result.quote).toBeDefined();
        expect(result.quote).toHaveProperty('position');
        expect(result.quote).toHaveProperty('tokensSwapped');
        expect(result.quote).toHaveProperty('sortedToken0');
        expect(result.quote).toHaveProperty('sortedToken1');
        expect(result.quote).toHaveProperty('pool');

        // Verify position has amounts
        expect(result.quote.position).toHaveProperty('amount0');
        expect(result.quote.position).toHaveProperty('amount1');
        expect(result.quote.position.amount0).toHaveProperty('quotient');
        expect(result.quote.position.amount1).toHaveProperty('quotient');

        // Verify sorted tokens have addresses
        expect(result.quote.sortedToken0).toHaveProperty('address');
        expect(result.quote.sortedToken1).toHaveProperty('address');
        expect(result.quote.sortedToken0.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result.quote.sortedToken1.address).toMatch(/^0x[a-fA-F0-9]{40}$/);

        // Verify amounts are positive numeric strings
        expect(result.quote.position.amount0.quotient.toString()).toMatch(/^\d+$/);
        expect(result.quote.position.amount1.quotient.toString()).toMatch(/^\d+$/);
      });

    });

    describe('Error Cases', () => {
      let baseParams;

      beforeEach(async () => {
        // Get pool data for test tokens
        const poolData = await adapter.fetchPoolData(env.usdcAddress, env.wethAddress, 500, env.provider);

        // Use real position tick values from test environment
        const { tickLower, tickUpper } = env.testPosition;

        baseParams = {
          position: {
            tickLower: tickLower,
            tickUpper: tickUpper
          },
          token0Amount: ethers.parseUnits("100", 6).toString(),
          token1Amount: ethers.parseUnits("0.1", 18).toString(),
          provider: env.provider,
          walletAddress: await env.testVault.getAddress(),
          poolData: poolData,
          token0Data: {
            address: env.usdcAddress,
            decimals: 6
          },
          token1Data: {
            address: env.wethAddress,
            decimals: 18
          },
          slippageTolerance: 0.5,
          deadlineMinutes: 30
        };
      });

      describe('Position validation', () => {
        it('should throw error for missing position', async () => {
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, position: null })
          ).rejects.toThrow('Position parameter is required');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, position: undefined })
          ).rejects.toThrow('Position parameter is required');
        });

        it('should throw error for non-object position', async () => {
          const invalidTypes = ['string', 123, true, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, position: invalidType })
            ).rejects.toThrow('Position must be an object');
          }
        });

        it('should throw error for invalid tick values', async () => {
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, position: { ...baseParams.position, tickLower: null } })
          ).rejects.toThrow('Position tickLower is required');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, position: { ...baseParams.position, tickUpper: null } })
          ).rejects.toThrow('Position tickUpper is required');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, position: { ...baseParams.position, tickLower: NaN } })
          ).rejects.toThrow('Position tickLower must be a finite number');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, position: { ...baseParams.position, tickUpper: Infinity } })
          ).rejects.toThrow('Position tickUpper must be a finite number');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, position: { ...baseParams.position, tickLower: baseParams.position.tickUpper, tickUpper: baseParams.position.tickLower } })
          ).rejects.toThrow('Position tickLower must be less than tickUpper');
        });
      });

      describe('Token0 amount validation', () => {
        it('should throw error for missing token0Amount', async () => {
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, token0Amount: null })
          ).rejects.toThrow('Token0 amount is required');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, token0Amount: undefined })
          ).rejects.toThrow('Token0 amount is required');
        });

        it('should throw error for non-string token0Amount', async () => {
          const invalidTypes = [123, true, false, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, token0Amount: invalidType })
            ).rejects.toThrow('Token0 amount must be a string');
          }
        });

        it('should throw error for invalid token0Amount format', async () => {
          const invalidAmounts = ['', 'abc', '12.5', '-100', '12abc', ' 123', '123 '];
          for (const invalidAmount of invalidAmounts) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, token0Amount: invalidAmount })
            ).rejects.toThrow('Token0 amount must be a positive numeric string');
          }
        });

        it('should throw error when both token amounts are zero', async () => {
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, token0Amount: '0', token1Amount: '0' })
          ).rejects.toThrow('At least one token amount must be greater than 0');
        });
      });

      describe('Token1 amount validation', () => {
        it('should throw error for missing token1Amount', async () => {
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, token1Amount: null })
          ).rejects.toThrow('Token1 amount is required');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, token1Amount: undefined })
          ).rejects.toThrow('Token1 amount is required');
        });

        it('should throw error for non-string token1Amount', async () => {
          const invalidTypes = [123, true, false, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, token1Amount: invalidType })
            ).rejects.toThrow('Token1 amount must be a string');
          }
        });

        it('should throw error for invalid token1Amount format', async () => {
          const invalidAmounts = ['', 'abc', '12.5', '-100', '12abc', ' 123', '123 '];
          for (const invalidAmount of invalidAmounts) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, token1Amount: invalidAmount })
            ).rejects.toThrow('Token1 amount must be a positive numeric string');
          }
        });
      });

      describe('Provider validation', () => {
        it('should throw error for missing provider', async () => {
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, provider: null })
          ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, provider: undefined })
          ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
        });

        it('should throw error for invalid provider', async () => {
          const invalidProviders = [{}, [], 'provider', 123, true];
          for (const invalidProvider of invalidProviders) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, provider: invalidProvider })
            ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
          }
        });
      });

      describe('Wallet address validation', () => {
        it('should throw error for missing wallet address', async () => {
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, walletAddress: null })
          ).rejects.toThrow('Wallet address is required');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, walletAddress: undefined })
          ).rejects.toThrow('Wallet address is required');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, walletAddress: '' })
          ).rejects.toThrow('Wallet address is required');
        });

        it('should throw error for invalid wallet address format', async () => {
          const invalidAddresses = ['not-an-address', '0x123', '0xGHIJKL'];
          for (const invalidAddress of invalidAddresses) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, walletAddress: invalidAddress })
            ).rejects.toThrow(`Invalid wallet address: ${invalidAddress}`);
          }
        });

        it('should throw error for non-string wallet address', async () => {
          const invalidTypes = [123, true, false, {}, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, walletAddress: invalidType })
            ).rejects.toThrow('Wallet address must be a string');
          }
        });
      });

      describe('Pool data validation', () => {
        it('should throw error for missing pool data', async () => {
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, poolData: null })
          ).rejects.toThrow('Pool data parameter is required');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, poolData: undefined })
          ).rejects.toThrow('Pool data parameter is required');
        });

        it('should throw error for non-object pool data', async () => {
          const invalidTypes = ['string', 123, true, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, poolData: invalidType })
            ).rejects.toThrow('Pool data must be an object');
          }
        });
      });

      describe('Token data validation', () => {
        it('should throw error for missing token data', async () => {
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, token0Data: null })
          ).rejects.toThrow('Token0 data parameter is required');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, token1Data: null })
          ).rejects.toThrow('Token1 data parameter is required');
        });

        it('should throw error for non-object token data', async () => {
          const invalidTypes = ['string', 123, true, []];
          for (const invalidType of invalidTypes) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, token0Data: invalidType })
            ).rejects.toThrow('Token0 data must be an object');
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, token1Data: invalidType })
            ).rejects.toThrow('Token1 data must be an object');
          }
        });

        it('should throw error for missing token decimals', async () => {
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, token0Data: { address: env.usdcAddress } })
          ).rejects.toThrow('Token0 decimals is required');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, token1Data: { address: env.wethAddress } })
          ).rejects.toThrow('Token1 decimals is required');
        });

        it('should throw error for invalid token decimals', async () => {
          const invalidDecimals = ['6', true, false, {}, [], -1, 256, NaN, Infinity];
          for (const invalidDecimal of invalidDecimals) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, token0Data: { ...baseParams.token0Data, decimals: invalidDecimal } })
            ).rejects.toThrow('Token0 decimals must be a finite number between 0 and 255');
          }
        });
      });

      describe('Slippage tolerance validation', () => {
        it('should throw error for missing slippage tolerance', async () => {
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, slippageTolerance: null })
          ).rejects.toThrow('Slippage tolerance is required');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, slippageTolerance: undefined })
          ).rejects.toThrow('Slippage tolerance is required');
        });

        it('should throw error for non-finite slippage tolerance', async () => {
          const invalidValues = ['0.5', true, false, {}, [], NaN, Infinity, -Infinity];
          for (const invalidValue of invalidValues) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, slippageTolerance: invalidValue })
            ).rejects.toThrow('Slippage tolerance must be a finite number');
          }
        });

        it('should throw error for out-of-range slippage tolerance', async () => {
          const invalidValues = [-1, -0.1, 101, 150];
          for (const invalidValue of invalidValues) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, slippageTolerance: invalidValue })
            ).rejects.toThrow('Slippage tolerance must be between 0 and 100');
          }
        });
      });

      describe('Deadline validation', () => {
        it('should throw error for missing deadline', async () => {
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, deadlineMinutes: null })
          ).rejects.toThrow('Deadline minutes is required');
          await expect(
            adapter.generateCreatePositionData({ ...baseParams, deadlineMinutes: undefined })
          ).rejects.toThrow('Deadline minutes is required');
        });

        it('should throw error for non-finite deadline', async () => {
          const invalidValues = ['30', true, false, {}, [], NaN, Infinity, -Infinity];
          for (const invalidValue of invalidValues) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, deadlineMinutes: invalidValue })
            ).rejects.toThrow('Deadline minutes must be a finite number');
          }
        });

        it('should throw error for negative deadline', async () => {
          const invalidValues = [-1, -0.1];
          for (const invalidValue of invalidValues) {
            await expect(
              adapter.generateCreatePositionData({ ...baseParams, deadlineMinutes: invalidValue })
            ).rejects.toThrow('Deadline minutes must be greater than 0');
          }
        });
      });
    });
  });
});
