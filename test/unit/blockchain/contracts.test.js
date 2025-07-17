/**
 * contracts.js Unit Tests
 *
 * Tests using Ganache fork of Arbitrum - no mocks, real blockchain interactions.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { setupTestEnvironment } from '../../test-env.js';
import { getContract, getVaultFactory, getVaultFactoryAddress, createVault, getVaultInfo } from '../../../src/blockchain/contracts.js';

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
});
