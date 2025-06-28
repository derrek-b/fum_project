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
        const poolData = await adapter.getPoolData(
          { address: usdcToken.addresses[1337], decimals: 6 },
          { address: wethToken.addresses[1337], decimals: 18 },
          500,
          env.provider
        );
        poolContract = new ethers.Contract(
          poolData.poolAddress,
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
});
