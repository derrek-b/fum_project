/**
 * patchProviderFeeData unit tests
 *
 * Verifies that the ethers.js v5 getFeeData override applies correct
 * maxPriorityFeePerGas from chain config. Uses mock providers — no Hardhat needed.
 */
import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { patchProviderFeeData } from '../../src/utils/patchProviderFeeData.js';

/**
 * Create a mock provider whose getFeeData returns ethers v5 defaults
 * (1.5 gwei hardcoded priority fee).
 */
function createMockProvider(baseFeGwei) {
  const baseFeeWei = ethers.utils.parseUnits(baseFeGwei, 'gwei');
  const hardcodedPriority = ethers.utils.parseUnits('1.5', 'gwei');
  return {
    getFeeData: async () => ({
      gasPrice: baseFeeWei,
      lastBaseFeePerGas: baseFeeWei,
      maxFeePerGas: baseFeeWei.mul(2).add(hardcodedPriority),
      maxPriorityFeePerGas: hardcodedPriority,
    }),
  };
}

describe('patchProviderFeeData', () => {
  describe('Arbitrum (chainId 1337, priority = 0)', () => {
    it('should set maxPriorityFeePerGas to 0', async () => {
      const provider = createMockProvider('0.02');
      patchProviderFeeData(provider, 1337);
      const feeData = await provider.getFeeData();
      expect(feeData.maxPriorityFeePerGas.toString()).toBe('0');
    });

    it('should set maxFeePerGas to baseFee * 2', async () => {
      const provider = createMockProvider('0.02');
      patchProviderFeeData(provider, 1337);
      const feeData = await provider.getFeeData();
      const expectedMax = ethers.utils.parseUnits('0.02', 'gwei').mul(2);
      expect(feeData.maxFeePerGas.toString()).toBe(expectedMax.toString());
    });

    it('should not modify lastBaseFeePerGas', async () => {
      const provider = createMockProvider('0.02');
      patchProviderFeeData(provider, 1337);
      const feeData = await provider.getFeeData();
      expect(feeData.lastBaseFeePerGas.toString()).toBe(ethers.utils.parseUnits('0.02', 'gwei').toString());
    });
  });

  describe('Avalanche (chainId 1338, priority = 1000 wei/gas)', () => {
    it('should set maxPriorityFeePerGas to 1000', async () => {
      const provider = createMockProvider('0.025');
      patchProviderFeeData(provider, 1338);
      const feeData = await provider.getFeeData();
      expect(feeData.maxPriorityFeePerGas.toString()).toBe('1000');
    });

    it('should set maxFeePerGas to baseFee * 2 + 1000', async () => {
      const provider = createMockProvider('0.025');
      patchProviderFeeData(provider, 1338);
      const feeData = await provider.getFeeData();
      const expectedMax = ethers.utils.parseUnits('0.025', 'gwei').mul(2).add(1000);
      expect(feeData.maxFeePerGas.toString()).toBe(expectedMax.toString());
    });
  });

  describe('Production chain IDs', () => {
    it('should work with Arbitrum mainnet (42161)', async () => {
      const provider = createMockProvider('0.02');
      patchProviderFeeData(provider, 42161);
      const feeData = await provider.getFeeData();
      expect(feeData.maxPriorityFeePerGas.toString()).toBe('0');
    });

    it('should work with Avalanche mainnet (43114)', async () => {
      const provider = createMockProvider('0.025');
      patchProviderFeeData(provider, 43114);
      const feeData = await provider.getFeeData();
      expect(feeData.maxPriorityFeePerGas.toString()).toBe('1000');
    });
  });
});
