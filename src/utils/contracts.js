/**
 * Helper utilities for working with contracts in the frontend
 */
import { ethers } from 'ethers';
import contractData from '../abis/contracts.json';

/**
 * Gets the contract factory for a contract, using the appropriate address for the current network
 * @param {string} contractName - Name of the contract (e.g., "VaultFactory", "PositionVault", or "BatchExecutor")
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @param {ethers.Signer} [signer] - Optional signer for write operations
 * @returns {ethers.Contract} The contract instance
 */
export function getContract(contractName, provider, signer) {
  const contractInfo = contractData[contractName];

  if (!contractInfo) {
    throw new Error(`Contract ${contractName} not found in contract data`);
  }

  // Get network info to find the right address
  const network = provider.network || { chainId: 1337 }; // Default to localhost/hardhat if no network
  const chainId = network.chainId.toString();

  // Get address for this network
  const address = contractInfo.addresses?.[chainId];

  if (!address) {
    throw new Error(`No ${contractName} deployment found for network ${chainId}`);
  }

  // Use signer if provided, otherwise use provider
  const connection = signer || provider;

  return new ethers.Contract(
    address,
    contractInfo.abi,
    connection
  );
}

/**
 * Creates a PositionVault contract instance for a specific vault address
 * @param {string} vaultAddress - Address of the vault
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @param {ethers.Signer} [signer] - Optional signer for write operations
 * @returns {ethers.Contract} The vault contract instance
 */
export function getVaultContract(vaultAddress, provider, signer) {
  const vaultAbi = contractData.PositionVault.abi;

  // Use signer if provided, otherwise use provider
  const connection = signer || provider;

  return new ethers.Contract(
    vaultAddress,
    vaultAbi,
    connection
  );
}

/**
 * Gets the VaultFactory contract for the current network
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @param {ethers.Signer} [signer] - Optional signer for write operations
 * @returns {ethers.Contract} The VaultFactory contract instance
 */
export function getVaultFactory(provider, signer) {
  return getContract('VaultFactory', provider, signer);
}

/**
 * Gets the BatchExecutor contract for the current network
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @param {ethers.Signer} [signer] - Optional signer for write operations
 * @returns {ethers.Contract} The BatchExecutor contract instance
 */
export function getBatchExecutor(provider, signer) {
  return getContract('BatchExecutor', provider, signer);
}

/**
 * Gets the address of the VaultFactory for a specific network
 * @param {number|string} chainId - Chain ID of the network
 * @returns {string|null} Address of the VaultFactory on the specified network, or null if not deployed
 */
export function getVaultFactoryAddress(chainId) {
  return contractData.VaultFactory.addresses?.[chainId.toString()] || null;
}

/**
 * Gets the address of the BatchExecutor for a specific network
 * @param {number|string} chainId - Chain ID of the network
 * @returns {string|null} Address of the BatchExecutor on the specified network, or null if not deployed
 */
export function getBatchExecutorAddress(chainId) {
  return contractData.BatchExecutor.addresses?.[chainId.toString()] || null;
}

/**
 * Creates a new vault using the VaultFactory
 * @param {string} name - Name for the new vault
 * @param {ethers.Signer} signer - Signer for the transaction
 * @returns {Promise<string>} The address of the newly created vault
 */
export async function createVault(name, signer) {
  const factory = getVaultFactory(signer.provider, signer);

  const tx = await factory.createVault(name);
  const receipt = await tx.wait();

  // Extract vault address from event logs
  const vaultCreatedEvent = receipt.logs.find(
    log => {
      try {
        return factory.interface.parseLog(log)?.name === 'VaultCreated';
      } catch (e) {
        return false;
      }
    }
  );

  if (!vaultCreatedEvent) {
    throw new Error("Failed to find VaultCreated event in transaction logs");
  }

  const parsedEvent = factory.interface.parseLog(vaultCreatedEvent);
  return parsedEvent.args[1]; // Second arg is vault address
}

/**
 * Gets all vaults for a user
 * @param {string} userAddress - Address of the user
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @returns {Promise<string[]>} Array of vault addresses
 */
export async function getUserVaults(userAddress, provider) {
  const factory = getVaultFactory(provider);
  return await factory.getVaults(userAddress);
}

/**
 * Gets information about a vault
 * @param {string} vaultAddress - Address of the vault
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @returns {Promise<{owner: string, name: string, creationTime: number}>} Vault information
 */
export async function getVaultInfo(vaultAddress, provider) {
  const factory = getVaultFactory(provider);
  const [owner, name, creationTime] = await factory.getVaultInfo(vaultAddress);

  return {
    owner,
    name,
    creationTime: Number(creationTime)
  };
}

/**
 * Executes a batch of transactions through a vault
 * @param {string} vaultAddress - Address of the vault
 * @param {Array<{target: string, data: string}>} transactions - Array of transactions to execute
 * @param {ethers.Signer} signer - Signer for the transaction
 * @returns {Promise<boolean[]>} Array of success flags for each transaction
 */
export async function executeVaultTransactions(vaultAddress, transactions, signer) {
  const vault = getVaultContract(vaultAddress, signer.provider, signer);

  const targets = transactions.map(tx => tx.target);
  const data = transactions.map(tx => tx.data);

  const tx = await vault.execute(targets, data);
  const receipt = await tx.wait();

  // Parse events to get execution results
  const executionEvents = receipt.logs
    .filter(log => {
      try {
        return vault.interface.parseLog(log)?.name === 'TransactionExecuted';
      } catch (e) {
        return false;
      }
    })
    .map(log => {
      const parsed = vault.interface.parseLog(log);
      return {
        target: parsed.args[0],
        data: parsed.args[1],
        success: parsed.args[2]
      };
    });

  return executionEvents.map(event => event.success);
}

/**
 * Executes a batch of transactions through the BatchExecutor
 * @param {Array<{to: string, data: string, value: string}>} transactions - Array of transactions to execute
 * @param {ethers.Signer} signer - Signer for the transaction
 * @returns {Promise<{successes: boolean[], results: string[]}>} Results of the batch execution
 */
export async function executeBatchTransactions(transactions, signer) {
  const batchExecutor = getBatchExecutor(signer.provider, signer);

  const targets = transactions.map(tx => tx.to);
  const data = transactions.map(tx => tx.data);
  const values = transactions.map(tx => tx.value || 0);

  // Calculate total ETH value needed
  const totalValue = values.reduce((sum, val) =>
    sum + (typeof val === 'bigint' ? val : BigInt(val.toString())),
    BigInt(0)
  );

  const tx = await batchExecutor.executeBatch(targets, data, values, {
    value: totalValue
  });

  const receipt = await tx.wait();

  // Parse events to get execution results
  const executionEvents = receipt.logs
    .filter(log => {
      try {
        return batchExecutor.interface.parseLog(log)?.name === 'TransactionExecuted';
      } catch (e) {
        return false;
      }
    })
    .map(log => {
      const parsed = batchExecutor.interface.parseLog(log);
      return {
        target: parsed.args[0],
        data: parsed.args[1],
        success: parsed.args[2],
        returnData: parsed.args[3]
      };
    });

  // Return the successful transactions and their results
  return {
    successes: executionEvents.map(event => event.success),
    results: executionEvents.map(event => event.returnData)
  };
}
