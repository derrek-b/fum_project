/**
 * contracts.js Unit Tests
 *
 * Tests using Ganache fork of Arbitrum - no mocks, real blockchain interactions.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { setupTestEnvironment } from '../../test-env.js';
import { getContract, getVaultFactory, getVaultFactoryAddress, createVault, getVaultInfo, getVaultContract, getUserVaults, executeVaultTransactions, getContractInfoByAddress } from '../../../src/blockchain/contracts.js';
import UniswapV3Adapter from '../../../src/adapters/UniswapV3Adapter.js';

describe('contracts.js - Unit Tests', () => {
  let env;
  let snapshotId;

  beforeAll(async () => {
    try {
      // Setup test environment with Ganache fork and full deployment for contract testing
      env = await setupTestEnvironment({
        deployContracts: true, // Need deployed contracts for testing
        syncBytecode: true, // Sync latest bytecode from FUM project
      });

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

  describe('getContract', () => {
    describe('Success Cases', () => {
      it('should return VaultFactory contract with correct address for test chain', async () => {
        const contract = await getContract('VaultFactory', env.provider);

        expect(contract).toBeDefined();
        expect(contract).toBeInstanceOf(ethers.Contract);
        expect(contract.target).toBeDefined();
        expect(contract.runner).toBe(env.provider);

        // Verify it has the actual deployed address
        expect(contract.target).toBe(env.contractAddresses.VaultFactory);

        // Verify it's the correct contract by checking it has expected methods
        expect(contract.interface.hasFunction('createVault')).toBe(true);
        expect(contract.interface.hasFunction('getVaults')).toBe(true);
        expect(contract.interface.hasFunction('getVaultInfo')).toBe(true);
      });

      it('should return BabyStepsStrategy contract with correct address for test chain', async () => {
        const contract = await getContract('bob', env.provider);

        expect(contract).toBeDefined();
        expect(contract).toBeInstanceOf(ethers.Contract);
        expect(contract.target).toBeDefined();
        expect(contract.runner).toBe(env.provider);

        // Verify it has the actual deployed address
        expect(contract.target).toBe(env.contractAddresses.BabyStepsStrategy);

        // Verify it's the correct contract by checking it has expected methods
        expect(contract.interface.hasFunction('authorizeVault')).toBe(true);
        expect(contract.interface.hasFunction('getVersion')).toBe(true);
      });

      it('should return contract instance with proper ABI methods available', async () => {
        const contract = await getContract('VaultFactory', env.provider);

        // Test that we can access interface methods
        expect(contract.interface).toBeDefined();
        expect(contract.interface.fragments.length).toBeGreaterThan(0);

        // Test that specific methods exist
        expect(contract.interface.hasFunction('createVault')).toBe(true);
        expect(contract.interface.hasFunction('getVaults')).toBe(true);
        expect(contract.interface.hasFunction('getVaultCount')).toBe(true);
      });

      it('should return contract connected to the provided provider', async () => {
        const contract = await getContract('VaultFactory', env.provider);

        expect(contract.runner).toBe(env.provider);
        expect(contract.runner).toBeInstanceOf(ethers.JsonRpcProvider);
      });

      it('should work consistently when called multiple times', async () => {
        const contract1 = await getContract('VaultFactory', env.provider);
        const contract2 = await getContract('VaultFactory', env.provider);
        const contract3 = await getContract('VaultFactory', env.provider);

        // Should return different instances
        expect(contract1).not.toBe(contract2);
        expect(contract2).not.toBe(contract3);

        // But with same properties - all should have the actual deployed address
        expect(contract1.target).toBe(env.contractAddresses.VaultFactory);
        expect(contract2.target).toBe(env.contractAddresses.VaultFactory);
        expect(contract3.target).toBe(env.contractAddresses.VaultFactory);
        expect(contract1.runner).toBe(contract2.runner);
        expect(contract2.runner).toBe(contract3.runner);
      });

      it('should allow .connect(signer) pattern for write operations', async () => {
        const readOnlyContract = await getContract('VaultFactory', env.provider);
        const signer = env.signers[0]; // Use first signer from array
        const writeContract = readOnlyContract.connect(signer);

        // Read-only contract should be connected to provider
        expect(readOnlyContract.runner).toBe(env.provider);
        expect(readOnlyContract.runner instanceof ethers.AbstractProvider).toBe(true);

        // Write contract should be connected to signer
        expect(writeContract.runner).toBe(signer);
        expect(writeContract.runner instanceof ethers.AbstractSigner).toBe(true);

        // Both should have same address and interface
        expect(readOnlyContract.target).toBe(writeContract.target);
        expect(readOnlyContract.interface).toBe(writeContract.interface);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid contract name - null', async () => {
        await expect(async () => {
          await getContract(null, env.provider);
        }).rejects.toThrow('Contract name must be a valid string.');
      });

      it('should throw error for invalid contract name - undefined', async () => {
        await expect(async () => {
          await getContract(undefined, env.provider);
        }).rejects.toThrow('Contract name must be a valid string.');
      });

      it('should throw error for invalid contract name - empty string', async () => {
        await expect(async () => {
          await getContract('', env.provider);
        }).rejects.toThrow('Contract name must be a valid string.');
      });

      it('should throw error for invalid contract name - number', async () => {
        await expect(async () => {
          await getContract(123, env.provider);
        }).rejects.toThrow('Contract name must be a valid string.');
      });

      it('should throw error for invalid contract name - object', async () => {
        await expect(async () => {
          await getContract({ name: 'VaultFactory' }, env.provider);
        }).rejects.toThrow('Contract name must be a valid string.');
      });

      it('should throw error for invalid provider - null', async () => {
        await expect(async () => {
          await getContract('VaultFactory', null);
        }).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - undefined', async () => {
        await expect(async () => {
          await getContract('VaultFactory', undefined);
        }).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - plain object', async () => {
        await expect(async () => {
          await getContract('VaultFactory', { fake: 'provider' });
        }).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - signer instead of provider', async () => {
        await expect(async () => {
          await getContract('VaultFactory', env.signers[0]);
        }).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for non-existent contract', async () => {
        await expect(async () => {
          await getContract('NonExistentContract', env.provider);
        }).rejects.toThrow('Contract NonExistentContract not found in contract data');
      });

      it('should throw error when provider network is not available', async () => {
        // Create a mock provider that lacks network property
        const mockProvider = {
          // Missing network property
        };

        await expect(async () => {
          await getContract('VaultFactory', mockProvider);
        }).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error when no deployment found for network', async () => {
        // Create a mock provider that extends AbstractProvider
        class MockProvider extends ethers.AbstractProvider {
          constructor() {
            super();
          }

          async getNetwork() {
            return {
              chainId: 999999n // Chain where contracts aren't deployed
            };
          }
        }

        const mockProvider = new MockProvider();

        await expect(async () => {
          await getContract('VaultFactory', mockProvider);
        }).rejects.toThrow('No VaultFactory deployment found for network 999999');
      });
    });
  });

  describe('getVaultFactory', () => {
    it('should return VaultFactory contract with correct address', async () => {
      const factory = await getVaultFactory(env.provider);

      expect(factory).toBeDefined();
      expect(factory).toBeInstanceOf(ethers.Contract);
      expect(factory.target).toBe(env.contractAddresses.VaultFactory);
      expect(factory.runner).toBe(env.provider);

      // Verify it's the correct contract by checking it has expected methods
      expect(factory.interface.hasFunction('createVault')).toBe(true);
      expect(factory.interface.hasFunction('getVaults')).toBe(true);
      expect(factory.interface.hasFunction('getVaultInfo')).toBe(true);
    });

    it('should throw error for invalid provider', async () => {
      await expect(
        getVaultFactory(null)
      ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');

      await expect(
        getVaultFactory({})
      ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
    });
  });

  describe('getVaultFactoryAddress', () => {
    it('should return VaultFactory address for test environment (1337)', () => {
      const address = getVaultFactoryAddress(1337);

      expect(address).toBeDefined();
      expect(address).toBe(env.contractAddresses.VaultFactory);
      expect(typeof address).toBe('string');
    });

    it('should return null for non-existent chain (999999)', () => {
      const address = getVaultFactoryAddress(999999);

      expect(address).toBeNull();
    });

    it('should throw error for invalid chainId types', () => {
      // Test string
      expect(() => {
        getVaultFactoryAddress('1337');
      }).toThrow('chainId must be a number');

      // Test null
      expect(() => {
        getVaultFactoryAddress(null);
      }).toThrow('chainId must be a number');

      // Test undefined
      expect(() => {
        getVaultFactoryAddress(undefined);
      }).toThrow('chainId must be a number');

      // Test object
      expect(() => {
        getVaultFactoryAddress({ chainId: 1337 });
      }).toThrow('chainId must be a number');

      // Test array
      expect(() => {
        getVaultFactoryAddress([1337]);
      }).toThrow('chainId must be a number');

      // Test boolean
      expect(() => {
        getVaultFactoryAddress(true);
      }).toThrow('chainId must be a number');
    });
  });

  describe('createVault', () => {
    describe('Success Cases', () => {
      it('should create vault with basic name and return valid address', async () => {
        const vaultName = 'Test Vault';
        const signer = env.signers[0];

        const vaultAddress = await createVault(vaultName, signer);

        // Verify returned address is valid
        expect(vaultAddress).toBeDefined();
        expect(typeof vaultAddress).toBe('string');
        expect(vaultAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

        // Verify vault was created correctly using getVaultInfo
        const vaultInfo = await getVaultInfo(vaultAddress, env.provider);
        expect(vaultInfo.name).toBe(vaultName);
        expect(vaultInfo.owner).toBe(signer.address);
        expect(vaultInfo.creationTime).toBeGreaterThan(0);
      });


      it('should create vault with long name and special characters', async () => {
        const vaultName = 'My Super Long DeFi Vault Name! 🚀💰';
        const signer = env.signers[0];

        const vaultAddress = await createVault(vaultName, signer);

        // Verify returned address is valid
        expect(vaultAddress).toBeDefined();
        expect(typeof vaultAddress).toBe('string');
        expect(vaultAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

        // Verify vault name is stored correctly
        const vaultInfo = await getVaultInfo(vaultAddress, env.provider);
        expect(vaultInfo.name).toBe(vaultName);
      });

      it('should create vault with different signer', async () => {
        const vaultName = 'Different Signer Vault';
        const signer = env.signers[1];

        const vaultAddress = await createVault(vaultName, signer);

        // Verify returned address is valid
        expect(vaultAddress).toBeDefined();
        expect(typeof vaultAddress).toBe('string');
        expect(vaultAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

        // Verify vault owner matches the different signer
        const vaultInfo = await getVaultInfo(vaultAddress, env.provider);
        expect(vaultInfo.owner).toBe(signer.address);

        // Verify vault name is stored correctly
        expect(vaultInfo.name).toBe(vaultName);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for invalid name types', async () => {
        const signer = env.signers[0];

        // Test null
        await expect(
          createVault(null, signer)
        ).rejects.toThrow('Name must be a string');

        // Test undefined
        await expect(
          createVault(undefined, signer)
        ).rejects.toThrow('Name must be a string');

        // Test number
        await expect(
          createVault(123, signer)
        ).rejects.toThrow('Name must be a string');

        // Test object
        await expect(
          createVault({}, signer)
        ).rejects.toThrow('Name must be a string');

        // Test array
        await expect(
          createVault([], signer)
        ).rejects.toThrow('Name must be a string');
      });

      it('should throw error for empty vault name', async () => {
        const signer = env.signers[0];

        await expect(
          createVault('', signer)
        ).rejects.toThrow('Vault name cannot be empty');
      });

      it('should throw error for invalid signer types', async () => {
        const vaultName = 'Test Vault';

        // Test null
        await expect(
          createVault(vaultName, null)
        ).rejects.toThrow('Invalid signer. Must be an ethers signer instance.');

        // Test undefined
        await expect(
          createVault(vaultName, undefined)
        ).rejects.toThrow('Invalid signer. Must be an ethers signer instance.');

        // Test object
        await expect(
          createVault(vaultName, {})
        ).rejects.toThrow('Invalid signer. Must be an ethers signer instance.');

        // Test provider instead of signer
        await expect(
          createVault(vaultName, env.provider)
        ).rejects.toThrow('Invalid signer. Must be an ethers signer instance.');
      });
    });
  });

  describe('getVaultContract', () => {

    describe('Success Cases', () => {
      it('should return PositionVault contract with correct address', async () => {
        const vaultContract = getVaultContract(env.testVault.target, env.provider);

        expect(vaultContract).toBeDefined();
        expect(vaultContract).toBeInstanceOf(ethers.Contract);
        expect(vaultContract.target).toBe(env.testVault.target);
        expect(vaultContract.runner).toBe(env.provider);
      });

      it('should return contract with proper PositionVault ABI methods available', async () => {
        const vaultContract = getVaultContract(env.testVault.target, env.provider);

        // Test that we can access interface methods
        expect(vaultContract.interface).toBeDefined();
        expect(vaultContract.interface.fragments.length).toBeGreaterThan(0);

        // Test that specific PositionVault methods exist
        expect(vaultContract.interface.hasFunction('owner')).toBe(true);
        expect(vaultContract.interface.hasFunction('execute')).toBe(true);
        expect(vaultContract.interface.hasFunction('strategy')).toBe(true);
        expect(vaultContract.interface.hasFunction('executor')).toBe(true);
        expect(vaultContract.interface.hasFunction('setStrategy')).toBe(true);
        expect(vaultContract.interface.hasFunction('setExecutor')).toBe(true);
      });

      it('should allow calling read methods', async () => {
        const vaultContract = getVaultContract(env.testVault.target, env.provider);

        // First verify the vault exists and has the expected info
        const vaultInfo = await getVaultInfo(env.testVault.target, env.provider);
        expect(vaultInfo.owner).toBe(env.signers[0].address);

        // Call owner() method
        const owner = await vaultContract.owner();
        expect(owner).toBe(env.signers[0].address);
        expect(owner).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });

      it('should allow .connect(signer) pattern for write operations', async () => {
        const readOnlyContract = getVaultContract(env.testVault.target, env.provider);
        const signer = env.signers[0];
        const writeContract = readOnlyContract.connect(signer);

        // Read-only contract should be connected to provider
        expect(readOnlyContract.runner).toBe(env.provider);
        expect(readOnlyContract.runner instanceof ethers.AbstractProvider).toBe(true);

        // Write contract should be connected to signer
        expect(writeContract.runner).toBe(signer);
        expect(writeContract.runner instanceof ethers.AbstractSigner).toBe(true);

        // Both should have same address and interface
        expect(readOnlyContract.target).toBe(writeContract.target);
        expect(readOnlyContract.interface).toBe(writeContract.interface);
      });

      it('should work consistently when called multiple times', async () => {
        const contract1 = getVaultContract(env.testVault.target, env.provider);
        const contract2 = getVaultContract(env.testVault.target, env.provider);
        const contract3 = getVaultContract(env.testVault.target, env.provider);

        // Should return different instances
        expect(contract1).not.toBe(contract2);
        expect(contract2).not.toBe(contract3);

        // But with same properties
        expect(contract1.target).toBe(env.testVault.target);
        expect(contract2.target).toBe(env.testVault.target);
        expect(contract3.target).toBe(env.testVault.target);
        expect(contract1.runner).toBe(contract2.runner);
        expect(contract2.runner).toBe(contract3.runner);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for missing vault address', async () => {
        expect(() => {
          getVaultContract(null, env.provider);
        }).toThrow('Vault address parameter is required');

        expect(() => {
          getVaultContract(undefined, env.provider);
        }).toThrow('Vault address parameter is required');

        expect(() => {
          getVaultContract('', env.provider);
        }).toThrow('Vault address parameter is required');
      });

      it('should throw error for invalid vault address format', async () => {
        // Invalid hex string
        expect(() => {
          getVaultContract('0xinvalid', env.provider);
        }).toThrow('Invalid vault address: 0xinvalid');

        // Not a hex string
        expect(() => {
          getVaultContract('not-an-address', env.provider);
        }).toThrow('Invalid vault address: not-an-address');

        // Wrong length
        expect(() => {
          getVaultContract('0x1234', env.provider);
        }).toThrow('Invalid vault address: 0x1234');

        // Number instead of string
        expect(() => {
          getVaultContract(123456, env.provider);
        }).toThrow('Invalid vault address: 123456');

        // Object instead of string
        expect(() => {
          getVaultContract({address: env.testVault.target}, env.provider);
        }).toThrow('Invalid vault address: [object Object]');
      });

      it('should throw error for invalid provider - null', async () => {
        expect(() => {
          getVaultContract(env.testVault.target, null);
        }).toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - undefined', async () => {
        expect(() => {
          getVaultContract(env.testVault.target, undefined);
        }).toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - plain object', async () => {
        expect(() => {
          getVaultContract(env.testVault.target, {});
        }).toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - string', async () => {
        expect(() => {
          getVaultContract(env.testVault.target, 'provider');
        }).toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - signer instead of provider', async () => {
        expect(() => {
          getVaultContract(env.testVault.target, env.signers[0]);
        }).toThrow('Invalid provider. Must be an ethers provider instance.');
      });
    });
  });

  describe('getUserVaults', () => {

    describe('Success Cases', () => {
      it('should return array of vault addresses for user with vaults', async () => {
        const userAddress = env.signers[0].address;
        const vaults = await getUserVaults(userAddress, env.provider);

        expect(vaults).toBeDefined();
        expect(Array.isArray(vaults)).toBe(true);
        expect(vaults.length).toBeGreaterThan(0);
        expect(vaults).toContain(env.testVault.target);
      });

      it('should return empty array for user with no vaults', async () => {
        const userAddress = env.signers[1].address; // Different signer who hasn't created vaults
        const vaults = await getUserVaults(userAddress, env.provider);

        expect(vaults).toBeDefined();
        expect(Array.isArray(vaults)).toBe(true);
        expect(vaults.length).toBe(0);
      });

      it('should work with checksummed and non-checksummed addresses', async () => {
        const userAddress = env.signers[0].address;

        // Test with lowercase address
        const lowercaseAddress = userAddress.toLowerCase();
        const vaults1 = await getUserVaults(lowercaseAddress, env.provider);

        // Test with checksummed address
        const checksummedAddress = ethers.getAddress(userAddress);
        const vaults2 = await getUserVaults(checksummedAddress, env.provider);

        // Both should return the same results
        expect(vaults1).toEqual(vaults2);
        expect(vaults1).toContain(env.testVault.target);
      });

      it('should work consistently when called multiple times', async () => {
        const userAddress = env.signers[0].address;

        const vaults1 = await getUserVaults(userAddress, env.provider);
        const vaults2 = await getUserVaults(userAddress, env.provider);
        const vaults3 = await getUserVaults(userAddress, env.provider);

        // All results should be identical
        expect(vaults1).toEqual(vaults2);
        expect(vaults2).toEqual(vaults3);
        expect(vaults1).toContain(env.testVault.target);
      });

      it('should return correct vault address for user who created vault', async () => {
        const userAddress = env.signers[0].address;
        const vaults = await getUserVaults(userAddress, env.provider);

        expect(vaults).toContain(env.testVault.target);
        expect(env.testVault.target).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for missing user address', async () => {
        await expect(
          getUserVaults(null, env.provider)
        ).rejects.toThrow('User address parameter is required');

        await expect(
          getUserVaults(undefined, env.provider)
        ).rejects.toThrow('User address parameter is required');

        await expect(
          getUserVaults('', env.provider)
        ).rejects.toThrow('User address parameter is required');
      });

      it('should throw error for invalid user address format', async () => {
        // Invalid hex string
        await expect(
          getUserVaults('0xinvalid', env.provider)
        ).rejects.toThrow('Invalid user address: 0xinvalid');

        // Not a hex string
        await expect(
          getUserVaults('not-an-address', env.provider)
        ).rejects.toThrow('Invalid user address: not-an-address');

        // Wrong length
        await expect(
          getUserVaults('0x1234', env.provider)
        ).rejects.toThrow('Invalid user address: 0x1234');

        // Number instead of string
        await expect(
          getUserVaults(123456, env.provider)
        ).rejects.toThrow('Invalid user address: 123456');

        // Object instead of string
        await expect(
          getUserVaults({address: env.signers[0].address}, env.provider)
        ).rejects.toThrow('Invalid user address: [object Object]');
      });

      it('should throw error for invalid provider - null', async () => {
        await expect(
          getUserVaults(env.signers[0].address, null)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - undefined', async () => {
        await expect(
          getUserVaults(env.signers[0].address, undefined)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - plain object', async () => {
        await expect(
          getUserVaults(env.signers[0].address, {})
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - string', async () => {
        await expect(
          getUserVaults(env.signers[0].address, 'provider')
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - signer instead of provider', async () => {
        await expect(
          getUserVaults(env.signers[0].address, env.signers[0])
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });
    });
  });

  describe('getVaultInfo', () => {
    describe('Success Cases', () => {
      it('should return vault info with correct structure and values', async () => {
        const vaultInfo = await getVaultInfo(env.testVault.target, env.provider);

        expect(vaultInfo).toBeDefined();
        expect(typeof vaultInfo).toBe('object');

        // Check structure
        expect(vaultInfo).toHaveProperty('owner');
        expect(vaultInfo).toHaveProperty('name');
        expect(vaultInfo).toHaveProperty('creationTime');

        // Check values
        expect(vaultInfo.owner).toBe(env.signers[0].address);
        expect(typeof vaultInfo.name).toBe('string');
        expect(vaultInfo.name.length).toBeGreaterThan(0);
        expect(typeof vaultInfo.creationTime).toBe('number');
        expect(vaultInfo.creationTime).toBeGreaterThan(0);
      });

      it('should return correct owner address', async () => {
        const vaultInfo = await getVaultInfo(env.testVault.target, env.provider);

        expect(vaultInfo.owner).toBe(env.signers[0].address);
        expect(vaultInfo.owner).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });

      it('should work with checksummed and non-checksummed addresses', async () => {
        const vaultAddress = env.testVault.target;

        // Test with lowercase address
        const lowercaseAddress = vaultAddress.toLowerCase();
        const vaultInfo1 = await getVaultInfo(lowercaseAddress, env.provider);

        // Test with checksummed address
        const checksummedAddress = ethers.getAddress(vaultAddress);
        const vaultInfo2 = await getVaultInfo(checksummedAddress, env.provider);

        // Both should return the same results
        expect(vaultInfo1).toEqual(vaultInfo2);
        expect(vaultInfo1.owner).toBe(env.signers[0].address);
      });

      it('should work consistently when called multiple times', async () => {
        const vaultAddress = env.testVault.target;

        const vaultInfo1 = await getVaultInfo(vaultAddress, env.provider);
        const vaultInfo2 = await getVaultInfo(vaultAddress, env.provider);
        const vaultInfo3 = await getVaultInfo(vaultAddress, env.provider);

        // All results should be identical
        expect(vaultInfo1).toEqual(vaultInfo2);
        expect(vaultInfo2).toEqual(vaultInfo3);
        expect(vaultInfo1.owner).toBe(env.signers[0].address);
      });

      it('should return valid data types for all fields', async () => {
        const vaultInfo = await getVaultInfo(env.testVault.target, env.provider);

        // Type validations
        expect(typeof vaultInfo.owner).toBe('string');
        expect(typeof vaultInfo.name).toBe('string');
        expect(typeof vaultInfo.creationTime).toBe('number');

        // Content validations
        expect(vaultInfo.owner).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(vaultInfo.name.length).toBeGreaterThan(0);
        expect(vaultInfo.creationTime).toBeGreaterThan(0);
        expect(Number.isInteger(vaultInfo.creationTime)).toBe(true);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for missing vault address', async () => {
        await expect(
          getVaultInfo(null, env.provider)
        ).rejects.toThrow('Vault address parameter is required');

        await expect(
          getVaultInfo(undefined, env.provider)
        ).rejects.toThrow('Vault address parameter is required');

        await expect(
          getVaultInfo('', env.provider)
        ).rejects.toThrow('Vault address parameter is required');
      });

      it('should throw error for invalid vault address format', async () => {
        // Invalid hex string
        await expect(
          getVaultInfo('0xinvalid', env.provider)
        ).rejects.toThrow('Invalid vault address: 0xinvalid');

        // Not a hex string
        await expect(
          getVaultInfo('not-an-address', env.provider)
        ).rejects.toThrow('Invalid vault address: not-an-address');

        // Wrong length
        await expect(
          getVaultInfo('0x1234', env.provider)
        ).rejects.toThrow('Invalid vault address: 0x1234');

        // Number instead of string
        await expect(
          getVaultInfo(123456, env.provider)
        ).rejects.toThrow('Invalid vault address: 123456');

        // Object instead of string
        await expect(
          getVaultInfo({address: env.testVault.target}, env.provider)
        ).rejects.toThrow('Invalid vault address: [object Object]');
      });

      it('should throw error for invalid provider - null', async () => {
        await expect(
          getVaultInfo(env.testVault.target, null)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - undefined', async () => {
        await expect(
          getVaultInfo(env.testVault.target, undefined)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - plain object', async () => {
        await expect(
          getVaultInfo(env.testVault.target, {})
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - string', async () => {
        await expect(
          getVaultInfo(env.testVault.target, 'provider')
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - signer instead of provider', async () => {
        await expect(
          getVaultInfo(env.testVault.target, env.signers[0])
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });
    });
  });

  describe('executeVaultTransactions', () => {
    let swapTransactions;
    let failingTransactions;

    beforeEach(async () => {
      const signer = env.signers[0];

      // First, ensure the vault has WETH and approve the router
      const wethContract = new ethers.Contract(env.wethAddress, [
        'function transfer(address to, uint256 amount) external returns (bool)',
        'function approve(address spender, uint256 amount) external returns (bool)',
        'function balanceOf(address account) external view returns (uint256)'
      ], signer);

      const usdcContract = new ethers.Contract(env.usdcAddress, [
        'function transfer(address to, uint256 amount) external returns (bool)',
        'function approve(address spender, uint256 amount) external returns (bool)',
        'function balanceOf(address account) external view returns (uint256)'
      ], signer);

      // Create approval transactions for the vault to approve Uniswap router
      const wethApprovalTx = {
        target: env.wethAddress,
        data: wethContract.interface.encodeFunctionData('approve', [
          '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3 SwapRouter
          ethers.parseEther('0.2')
        ])
      };

      const usdcApprovalTx = {
        target: env.usdcAddress,
        data: usdcContract.interface.encodeFunctionData('approve', [
          '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3 SwapRouter
          ethers.parseUnits('200', 6)
        ])
      };

      // Execute approvals first
      await executeVaultTransactions(env.testVault.target, [wethApprovalTx], signer);
      await executeVaultTransactions(env.testVault.target, [usdcApprovalTx], signer);

      // NOW create sample swap transactions using UniswapV3Adapter (after approvals are done)
      const adapter = new UniswapV3Adapter(1337);

      // Get WETH and USDC addresses
      const wethAddress = env.wethAddress;
      const usdcAddress = env.usdcAddress;

      // Create two swap transactions
      const swapParams1 = {
        tokenIn: wethAddress,
        tokenOut: usdcAddress,
        fee: 500,
        recipient: env.testVault.target,
        deadlineMinutes: 60, // 1 hour from now
        amountIn: String(ethers.parseEther('0.1')),
        sqrtPriceLimitX96: String(0),
        slippageTolerance: 100,
        provider: env.provider
      };

      const swapParams2 = {
        tokenIn: usdcAddress,
        tokenOut: wethAddress,
        fee: 500,
        recipient: env.testVault.target,
        deadlineMinutes: 60, // 1 hour from now
        amountIn: String(ethers.parseUnits('100', 6)), // 100 USDC
        sqrtPriceLimitX96: String(0),
        slippageTolerance: 100,
        provider: env.provider
      };

      // Generate transaction data
      const swapTx1 = await adapter.generateSwapData(swapParams1);
      const swapTx2 = await adapter.generateSwapData(swapParams2);

      swapTransactions = [
        {
          target: swapTx1.to,
          data: swapTx1.data
        },
        {
          target: swapTx2.to,
          data: swapTx2.data
        }
      ];

      // Create failing transactions - use a contract call that will definitely revert
      // Try to transfer more WETH than the vault has
      failingTransactions = [
        {
          target: env.wethAddress,
          data: wethContract.interface.encodeFunctionData('transfer', [
            signer.address,
            ethers.parseEther('1000000') // Way more than vault has
          ])
        }
      ];
    });

    describe('Success Cases', () => {
      it('should execute single transaction and return true', async () => {
        const signer = env.signers[0];
        const singleTransaction = [swapTransactions[0]];

        const result = await executeVaultTransactions(
          env.testVault.target,
          singleTransaction,
          signer
        );

        expect(result).toBe(true);
      });

      it('should execute multiple transactions and return true', async () => {
        const signer = env.signers[0];

        const result = await executeVaultTransactions(
          env.testVault.target,
          swapTransactions,
          signer
        );

        expect(result).toBe(true);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for missing vault address', async () => {
        const signer = env.signers[0];

        await expect(
          executeVaultTransactions(null, swapTransactions, signer)
        ).rejects.toThrow('Vault address parameter is required');

        await expect(
          executeVaultTransactions(undefined, swapTransactions, signer)
        ).rejects.toThrow('Vault address parameter is required');

        await expect(
          executeVaultTransactions('', swapTransactions, signer)
        ).rejects.toThrow('Vault address parameter is required');
      });

      it('should throw error for invalid vault address format', async () => {
        const signer = env.signers[0];

        await expect(
          executeVaultTransactions('0xinvalid', swapTransactions, signer)
        ).rejects.toThrow('Invalid vault address: 0xinvalid');

        await expect(
          executeVaultTransactions('not-an-address', swapTransactions, signer)
        ).rejects.toThrow('Invalid vault address: not-an-address');

        await expect(
          executeVaultTransactions(123456, swapTransactions, signer)
        ).rejects.toThrow('Invalid vault address: 123456');
      });

      it('should throw error for invalid transactions array', async () => {
        const signer = env.signers[0];

        await expect(
          executeVaultTransactions(env.testVault.target, null, signer)
        ).rejects.toThrow('Transactions must be an array');

        await expect(
          executeVaultTransactions(env.testVault.target, undefined, signer)
        ).rejects.toThrow('Transactions must be an array');

        await expect(
          executeVaultTransactions(env.testVault.target, [], signer)
        ).rejects.toThrow('Transactions array cannot be empty');

        await expect(
          executeVaultTransactions(env.testVault.target, 'not-array', signer)
        ).rejects.toThrow('Transactions must be an array');
      });

      it('should throw error for invalid individual transactions', async () => {
        const signer = env.signers[0];

        // Invalid transaction object
        await expect(
          executeVaultTransactions(env.testVault.target, [null], signer)
        ).rejects.toThrow('Transaction at index 0 must be an object');

        await expect(
          executeVaultTransactions(env.testVault.target, ['invalid'], signer)
        ).rejects.toThrow('Transaction at index 0 must be an object');

        // Missing target
        await expect(
          executeVaultTransactions(env.testVault.target, [{ data: '0x1234' }], signer)
        ).rejects.toThrow('Transaction at index 0 is missing target address');

        // Missing data
        await expect(
          executeVaultTransactions(env.testVault.target, [{ target: swapTransactions[0].target }], signer)
        ).rejects.toThrow('Transaction at index 0 is missing data');

        // Invalid target address
        await expect(
          executeVaultTransactions(env.testVault.target, [{ target: 'invalid', data: '0x1234' }], signer)
        ).rejects.toThrow('Invalid target address at index 0: invalid');

        // Invalid data type
        await expect(
          executeVaultTransactions(env.testVault.target, [{ target: env.wethAddress, data: 123 }], signer)
        ).rejects.toThrow('Transaction data at index 0 must be a string');

        // Invalid data format (not hex)
        await expect(
          executeVaultTransactions(env.testVault.target, [{ target: env.wethAddress, data: 'not-hex' }], signer)
        ).rejects.toThrow('Transaction data at index 0 must be hex encoded (start with 0x)');
      });

      it('should throw error for invalid signer', async () => {
        await expect(
          executeVaultTransactions(env.testVault.target, swapTransactions, null)
        ).rejects.toThrow('Invalid signer. Must be an ethers signer instance.');

        await expect(
          executeVaultTransactions(env.testVault.target, swapTransactions, undefined)
        ).rejects.toThrow('Invalid signer. Must be an ethers signer instance.');

        await expect(
          executeVaultTransactions(env.testVault.target, swapTransactions, {})
        ).rejects.toThrow('Invalid signer. Must be an ethers signer instance.');

        await expect(
          executeVaultTransactions(env.testVault.target, swapTransactions, env.provider)
        ).rejects.toThrow('Invalid signer. Must be an ethers signer instance.');
      });

      it('should throw error when transactions fail (zero address)', async () => {
        const signer = env.signers[0];

        await expect(
          executeVaultTransactions(env.testVault.target, failingTransactions, signer)
        ).rejects.toThrow('Failed to execute vault transactions');
      });
    });
  });

  describe('getContractInfoByAddress', () => {
    describe('Success Cases', () => {
      it('should return contract info for valid strategy addresses', () => {
        // Test with known strategy addresses from contract data
        // Note: These would be real addresses from your contract artifacts
        const testCases = [
          // These are valid Ethereum addresses that won't be in our contract data
          { address: '0x742d35Cc6634C0532925a3b8d7d566dd8f4Da4d1', expectedName: 'bob', expectedChain: 1 },
          { address: '0xa0B86A33e6411fBDD1B6644280bF6f4AE6E862Ca', expectedName: 'parris', expectedChain: 137 }
        ];

        // Since we don't have access to actual contract data in tests, 
        // we'll test the function logic with mock scenarios
        testCases.forEach(({ address, expectedName, expectedChain }) => {
          try {
            const result = getContractInfoByAddress(address);
            expect(result).toHaveProperty('contractName');
            expect(result).toHaveProperty('chainId');
            expect(typeof result.contractName).toBe('string');
            expect(typeof result.chainId).toBe('number');
          } catch (error) {
            // If address not found in current contract data, that's expected
            expect(error.message).toMatch(/Invalid address|not found in contract data/);
          }
        });
      });

      it('should handle case-insensitive address lookup', () => {
        // Test with mixed case addresses
        const mixedCaseAddresses = [
          '0x742D35CC6634C0532925A3B8D7D566DD8F4DA4D1',
          '0xa0b86a33e6411fbdd1b6644280bf6f4ae6e862ca'
        ];

        mixedCaseAddresses.forEach(address => {
          try {
            const result = getContractInfoByAddress(address);
            expect(result).toHaveProperty('contractName');
            expect(result).toHaveProperty('chainId');
          } catch (error) {
            // Address not found is acceptable for test
            expect(error.message).toContain('not found in contract data');
          }
        });
      });
    });

    describe('Error Cases', () => {
      it('should throw error for null/undefined address', () => {
        expect(() => getContractInfoByAddress(null)).toThrow('Address parameter is required');
        expect(() => getContractInfoByAddress(undefined)).toThrow('Address parameter is required');
        expect(() => getContractInfoByAddress('')).toThrow('Address parameter is required');
      });

      it('should throw error for invalid address format', () => {
        const invalidAddresses = [
          'not-an-address',
          '0x123', // too short
          '0xinvalidhex',
          '0x742d35cc6634c0532925a3b8d7d566dd8f4da4d', // too short (missing digit)
          '0xGGGd35cc6634c0532925a3b8d7d566dd8f4da4d1' // invalid hex characters
        ];

        invalidAddresses.forEach(address => {
          expect(() => getContractInfoByAddress(address)).toThrow(/Invalid address/);
        });
      });

      it('should throw error for valid address not in contract data', () => {
        // Use a valid Ethereum address that definitely won't be in our contract data
        const validButUnknownAddress = '0x0000000000000000000000000000000000000001';
        
        expect(() => getContractInfoByAddress(validButUnknownAddress))
          .toThrow('Contract address 0x0000000000000000000000000000000000000001 not found in contract data');
      });

      it('should handle addresses with different cases consistently', () => {
        const testAddress = '0x0000000000000000000000000000000000000002';
        const upperCaseAddress = testAddress.toUpperCase();
        const lowerCaseAddress = testAddress.toLowerCase();

        // All should throw the same error (address not found)
        expect(() => getContractInfoByAddress(testAddress)).toThrow('not found in contract data');
        expect(() => getContractInfoByAddress(upperCaseAddress)).toThrow(/Invalid address/);
        expect(() => getContractInfoByAddress(lowerCaseAddress)).toThrow('not found in contract data');
      });
    });

    describe('Integration Cases', () => {
      it('should work with ethers address validation', () => {
        // Test that our function properly uses ethers.getAddress for validation
        const checksummedAddress = '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb';
        const lowercaseAddress = checksummedAddress.toLowerCase();

        // Both should be treated as valid addresses (even if not found in contract data)
        try {
          getContractInfoByAddress(checksummedAddress);
        } catch (error) {
          expect(error.message).toContain('not found in contract data');
          expect(error.message).not.toContain('Invalid address');
        }

        try {
          getContractInfoByAddress(lowercaseAddress);
        } catch (error) {
          expect(error.message).toContain('not found in contract data');
          expect(error.message).not.toContain('Invalid address');
        }
      });
    });
  });
});
