/**
 * @fileoverview Shared test mnemonic and executor derivation helper.
 * Centralizes the test mnemonic to avoid duplication across vault setup files.
 */

import { ethers } from 'ethers';

export const TEST_MNEMONIC = 'pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard';
export const TEST_HD_NODE = ethers.utils.HDNode.fromMnemonic(TEST_MNEMONIC);

/**
 * Derive the executor address for a given vault's executorIndex.
 * Uses the same BIP-44 derivation path as AutomationService.
 *
 * @param {number} executorIndex - The vault's executorIndex from VaultFactory
 * @returns {string} Checksummed executor address
 */
export function deriveTestExecutorAddress(executorIndex) {
  return TEST_HD_NODE.derivePath("m/44'/60'/0'/0/" + executorIndex).address;
}
