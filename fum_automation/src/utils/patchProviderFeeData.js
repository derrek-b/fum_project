import { ethers } from 'ethers';
import { getMaxPriorityFeePerGas } from 'fum_library/helpers/chainHelpers';

/**
 * Override ethers.js v5's hardcoded 1.5 gwei maxPriorityFeePerGas.
 *
 * ethers v5 getFeeData() never calls eth_maxPriorityFeePerGas — it hardcodes
 * 1.5 gwei as the priority fee. On Arbitrum and Avalanche this is ~300x too high.
 * Hardhat's EVM charges the full amount, making test transactions far more
 * expensive than production.
 *
 * Uses per-chain config values from fum_library/configs/chains.js:
 * - Arbitrum: "0" (sequencer is FCFS, ignores tips)
 * - Avalanche: "1000" (1000 wei/gas, near-zero)
 *
 * @param {ethers.providers.BaseProvider} provider
 * @param {number} chainId
 */
export function patchProviderFeeData(provider, chainId) {
  const configPriority = ethers.BigNumber.from(getMaxPriorityFeePerGas(chainId));
  const original = provider.getFeeData.bind(provider);

  provider.getFeeData = async () => {
    const feeData = await original();
    feeData.maxPriorityFeePerGas = configPriority;
    if (feeData.lastBaseFeePerGas) {
      feeData.maxFeePerGas = feeData.lastBaseFeePerGas.mul(2).add(configPriority);
    }
    return feeData;
  };
}
