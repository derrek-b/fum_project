/**
 * Contract Deployment Integration Tests
 * 
 * Tests that contracts can be deployed and addresses are updated correctly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestEnvironment } from '../../test-env.js';
import { getContract } from '../../../src/blockchain/contracts.js';
import contractData from '../../../src/artifacts/contracts.js';

describe('Contract Deployment Integration', () => {
  let env;
  
  beforeAll(async () => {
    try {
      // Setup test environment with contract deployment
      env = await setupTestEnvironment({
        deployContracts: true,
        updateContractsFile: true,
      });
    } catch (error) {
      console.error('Failed to setup test environment:', error);
      throw error;
    }
  });
  
  afterAll(async () => {
    if (env && env.teardown) {
      await env.teardown();
    }
  });
  
  it('should deploy all FUM contracts', () => {
    // Check that we have deployed contract instances
    expect(env.contracts.batchExecutor).toBeDefined();
    expect(env.contracts.vaultFactory).toBeDefined();
    expect(env.contracts.parrisIsland).toBeDefined();
    expect(env.contracts.babySteps).toBeDefined();
    
    // Check that we have addresses
    expect(env.contractAddresses.BatchExecutor).toBeDefined();
    expect(env.contractAddresses.VaultFactory).toBeDefined();
    expect(env.contractAddresses.ParrisIslandStrategy).toBeDefined();
    expect(env.contractAddresses.BabyStepsStrategy).toBeDefined();
  });
  
  it('should update artifacts/contracts.js with deployed addresses', () => {
    // Check that the contract data was updated
    expect(contractData.BatchExecutor.addresses['1337']).toBe(env.contractAddresses.BatchExecutor);
    expect(contractData.VaultFactory.addresses['1337']).toBe(env.contractAddresses.VaultFactory);
    expect(contractData.parris.addresses['1337']).toBe(env.contractAddresses.ParrisIslandStrategy);
    expect(contractData.bob.addresses['1337']).toBe(env.contractAddresses.BabyStepsStrategy);
  });
  
  it('should be able to get contract instances using getContract helper', async () => {
    // Test that we can get contract instances from the blockchain module
    const factory = getContract('VaultFactory', env.provider);
    const batchExecutor = getContract('BatchExecutor', env.provider);
    
    expect(factory).toBeDefined();
    expect(batchExecutor).toBeDefined();
    
    // Test that the addresses match
    const factoryAddress = await factory.getAddress();
    const batchExecutorAddress = await batchExecutor.getAddress();
    
    expect(factoryAddress).toBe(env.contractAddresses.VaultFactory);
    expect(batchExecutorAddress).toBe(env.contractAddresses.BatchExecutor);
  });
  
  it('should be able to create a test vault', async () => {
    const vaultAddress = await env.createVault({
      name: 'Test Integration Vault',
      symbol: 'TIV',
    });
    
    expect(vaultAddress).toBeDefined();
    expect(vaultAddress.length).toBe(42); // Ethereum address length
    expect(vaultAddress.startsWith('0x')).toBe(true);
    
    // Verify the vault was created by checking it exists
    const factory = getContract('VaultFactory', env.provider);
    const vaultCount = await factory.getTotalVaultCount();
    expect(Number(vaultCount)).toBeGreaterThan(0);
  });
  
  it('should have contracts with proper ABIs', () => {
    // Check that contracts have proper ABIs
    expect(contractData.VaultFactory.abi).toBeDefined();
    expect(contractData.BatchExecutor.abi).toBeDefined();
    expect(contractData.parris.abi).toBeDefined();
    expect(contractData.bob.abi).toBeDefined();
    
    // Check that ABIs have the expected functions
    const factoryAbi = contractData.VaultFactory.abi;
    const createVaultFunction = factoryAbi.find(fn => fn.name === 'createVault');
    expect(createVaultFunction).toBeDefined();
    expect(createVaultFunction.type).toBe('function');
  });
});