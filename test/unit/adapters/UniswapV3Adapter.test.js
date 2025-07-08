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
import { getTokenBySymbol } from '../../../src/helpers/tokenHelpers.js';

describe('UniswapV3Adapter - Unit Tests', () => {
  let env;
  let adapter;
  let snapshotId;

  beforeAll(async () => {
    try {
      // Setup test environment with Ganache fork and full deployment for contract testing
      env = await setupTestEnvironment({
        deployContracts: true, // Need deployed contracts for gas estimation tests
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
          { address: usdcToken.addresses[1337], decimals: 6 },
          { address: wethToken.addresses[1337], decimals: 18 },
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
          amountIn: ethers.parseEther('0.1'),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
          provider: env.provider,
          chainId: 1337,
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

  describe('_validateProviderChain', () => {
    describe('Success Cases', () => {
      it('should validate correct chain without throwing', async () => {
        await expect(
          adapter._validateProviderChain(env.provider)
        ).resolves.not.toThrow();
      });

      it('should work with provider returning correct chainId as bigint', async () => {
        const mockProvider = {
          getNetwork: async () => ({
            chainId: 1337n, // Correct chain as bigint
            name: 'ganache'
          })
        };

        await expect(
          adapter._validateProviderChain(mockProvider)
        ).resolves.not.toThrow();
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null provider', async () => {
        await expect(
          adapter._validateProviderChain(null)
        ).rejects.toThrow('Invalid provider - must have getNetwork method');
      });

      it('should throw error for undefined provider', async () => {
        await expect(
          adapter._validateProviderChain(undefined)
        ).rejects.toThrow('Invalid provider - must have getNetwork method');
      });

      it('should throw error for provider without getNetwork method', async () => {
        const invalidProvider = {};

        await expect(
          adapter._validateProviderChain(invalidProvider)
        ).rejects.toThrow('Invalid provider - must have getNetwork method');
      });

      it('should throw error when provider is on wrong chain', async () => {
        const wrongChainProvider = {
          getNetwork: async () => ({
            chainId: 1n, // Wrong chain (mainnet instead of ganache)
            name: 'mainnet'
          })
        };

        await expect(
          adapter._validateProviderChain(wrongChainProvider)
        ).rejects.toThrow('Provider chain 1 doesn\'t match adapter chain 1337');
      });

      it('should throw error when getNetwork throws', async () => {
        const failingProvider = {
          getNetwork: async () => {
            throw new Error('Network error');
          }
        };

        await expect(
          adapter._validateProviderChain(failingProvider)
        ).rejects.toThrow('Failed to validate provider chain: Network error');
      });

      it('should throw error when network is null', async () => {
        const mockProvider = {
          getNetwork: async () => null
        };

        await expect(
          adapter._validateProviderChain(mockProvider)
        ).rejects.toThrow('Provider returned invalid network data');
      });

      it('should throw error when chainId is undefined', async () => {
        const mockProvider = {
          getNetwork: async () => ({
            name: 'test-network'
            // missing chainId
          })
        };

        await expect(
          adapter._validateProviderChain(mockProvider)
        ).rejects.toThrow('Provider returned invalid network data');
      });
    });

    describe('Special Cases', () => {
      it('should handle provider with additional network properties', async () => {
        const mockProvider = {
          getNetwork: async () => ({
            chainId: 1337n, // Correct chain
            name: 'ganache',
            ensAddress: '0x123...',
            customProperty: 'test'
          })
        };

        await expect(
          adapter._validateProviderChain(mockProvider)
        ).resolves.not.toThrow();
      });

      it('should distinguish between network errors and chain mismatch', async () => {
        // Chain mismatch error should be thrown as-is
        const wrongChainProvider = {
          getNetwork: async () => ({
            chainId: 42161n,
            name: 'arbitrum'
          })
        };

        await expect(
          adapter._validateProviderChain(wrongChainProvider)
        ).rejects.toThrow('Provider chain 42161 doesn\'t match adapter chain 1337');

        // Network error should be wrapped
        const networkErrorProvider = {
          getNetwork: async () => {
            throw new Error('Connection failed');
          }
        };

        await expect(
          adapter._validateProviderChain(networkErrorProvider)
        ).rejects.toThrow('Failed to validate provider chain: Connection failed');
      });
    });
  });

  describe('getPoolAddress', () => {
    describe('Success Cases', () => {
      it('should return pool address as string for valid tokens and fee', async () => {
        const token0 = {
          address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
          decimals: 18
        };
        const token1 = {
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          decimals: 6
        };

        const poolAddress = await adapter.getPoolAddress(token0, token1, 500, env.provider);

        expect(typeof poolAddress).toBe('string');
        expect(poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(poolAddress.length).toBe(42);
      });

      it('should return same address regardless of token input order', async () => {
        const weth = {
          address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
          decimals: 18
        };
        const usdc = {
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          decimals: 6
        };

        const address1 = await adapter.getPoolAddress(weth, usdc, 500, env.provider);
        const address2 = await adapter.getPoolAddress(usdc, weth, 500, env.provider);

        expect(address1).toBe(address2);
      });

      it('should return different addresses for different fee tiers', async () => {
        const token0 = {
          address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
          decimals: 18
        };
        const token1 = {
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          decimals: 6
        };

        const address500 = await adapter.getPoolAddress(token0, token1, 500, env.provider);
        const address3000 = await adapter.getPoolAddress(token0, token1, 3000, env.provider);

        expect(address500).not.toBe(address3000);
        expect(typeof address500).toBe('string');
        expect(typeof address3000).toBe('string');
      });

    });

    describe('Error Cases', () => {
      it('should throw error for missing token0', async () => {
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        await expect(
          adapter.getPoolAddress(null, token1, 500, env.provider)
        ).rejects.toThrow('Token0 parameter is required');

        await expect(
          adapter.getPoolAddress(undefined, token1, 500, env.provider)
        ).rejects.toThrow('Token0 parameter is required');
      });

      it('should throw error for missing token0 address', async () => {
        const token0 = { decimals: 18 };
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        await expect(
          adapter.getPoolAddress(token0, token1, 500, env.provider)
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
            adapter.getPoolAddress(token0, token1, 500, env.provider)
          ).rejects.toThrow(); // Be permissive due to potential ENS resolution
        }
      });

      it('should throw error for missing token0 decimals', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' };
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        await expect(
          adapter.getPoolAddress(token0, token1, 500, env.provider)
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
            adapter.getPoolAddress(token0, token1, 500, env.provider)
          ).rejects.toThrow('Token0 decimals must be a valid number');
        }
      });

      it('should throw error for missing token1', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };

        await expect(
          adapter.getPoolAddress(token0, null, 500, env.provider)
        ).rejects.toThrow('Token1 parameter is required');

        await expect(
          adapter.getPoolAddress(token0, undefined, 500, env.provider)
        ).rejects.toThrow('Token1 parameter is required');
      });

      it('should throw error for missing token1 address', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };
        const token1 = { decimals: 6 };

        await expect(
          adapter.getPoolAddress(token0, token1, 500, env.provider)
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
            adapter.getPoolAddress(token0, token1, 500, env.provider)
          ).rejects.toThrow(); // Be permissive due to potential ENS resolution
        }
      });

      it('should throw error for missing token1 decimals', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' };

        await expect(
          adapter.getPoolAddress(token0, token1, 500, env.provider)
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
            adapter.getPoolAddress(token0, token1, 500, env.provider)
          ).rejects.toThrow('Token1 decimals must be a valid number');
        }
      });

      it('should throw error for missing fee', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        await expect(
          adapter.getPoolAddress(token0, token1, null, env.provider)
        ).rejects.toThrow('Fee parameter is required');

        await expect(
          adapter.getPoolAddress(token0, token1, undefined, env.provider)
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
            adapter.getPoolAddress(token0, token1, invalidFee, env.provider)
          ).rejects.toThrow('Fee must be a valid number');
        }
      });

      it('should throw error for invalid provider', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        await expect(
          adapter.getPoolAddress(token0, token1, 500, null)
        ).rejects.toThrow('Invalid provider - must have getNetwork method');

        await expect(
          adapter.getPoolAddress(token0, token1, 500, {})
        ).rejects.toThrow('Invalid provider - must have getNetwork method');
      });
    });

    describe('Special Cases', () => {
      it('should be deterministic for same inputs', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };
        const token1 = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

        const address1 = await adapter.getPoolAddress(token0, token1, 500, env.provider);
        const address2 = await adapter.getPoolAddress(token0, token1, 500, env.provider);

        expect(address1).toBe(address2);
      });

      it('should handle tokens with same address (should still work)', async () => {
        const token0 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };
        const token1 = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };

        // This might throw from Uniswap SDK, but should handle gracefully
        await expect(
          adapter.getPoolAddress(token0, token1, 500, env.provider)
        ).rejects.toThrow();
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
        ).rejects.toThrow('Invalid provider - must have getNetwork method');

        await expect(
          adapter.checkPoolExists(token0, token1, 500, {})
        ).rejects.toThrow('Invalid provider - must have getNetwork method');
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
        const failingProvider = {
          getNetwork: async () => {
            throw new Error('Network error');
          }
        };

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
        const wrongChainProvider = {
          getNetwork: async () => ({
            chainId: 1n, // Wrong chain
            name: 'mainnet'
          })
        };

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
        ).rejects.toThrow('Invalid provider - must have getNetwork method');
      });

      it('should throw error for invalid provider', async () => {
        await expect(
          adapter.fetchTickData(validPoolAddress, validTickLower, validTickUpper, null)
        ).rejects.toThrow('Invalid provider - must have getNetwork method');

        await expect(
          adapter.fetchTickData(validPoolAddress, validTickLower, validTickUpper, {})
        ).rejects.toThrow('Invalid provider - must have getNetwork method');
      });

      it('should throw descriptive error for non-existent pool', async () => {
        const nonExistentPool = '0x1234567890123456789012345678901234567890';

        await expect(
          adapter.fetchTickData(nonExistentPool, validTickLower, validTickUpper, env.provider)
        ).rejects.toThrow('Failed to fetch tick data');
      });
    });
  });
});
