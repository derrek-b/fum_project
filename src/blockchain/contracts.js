/**
 * @module blockchain/contracts
 * @description Utilities for interacting with FUM vault contracts and related infrastructure
 */

// src/blockchain/contracts.js
import { ethers } from 'ethers';
import contractData from '../artifacts/contracts.js';

/**
 * Gets a read-only contract instance using the appropriate address for the current network
 *
 * @function getContract
 * @memberof module:blockchain/contracts
 *
 * @param {string} contractName - Name of the contract ("VaultFactory", "PositionVault", or strategy contracts)
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 *
 * @returns {Promise<ethers.Contract>} The read-only contract instance
 *
 * @throws {Error} If contract not found in contract data
 * @throws {Error} If no deployment found for network
 *
 * @example
 * // Get read-only contract
 * const factory = await getContract('VaultFactory', provider);
 * const vaultCount = await factory.getVaultCount();
 *
 * @example
 * // For write operations, connect a signer
 * const factory = await getContract('VaultFactory', provider);
 * const factoryWithSigner = factory.connect(signer);
 * const tx = await factoryWithSigner.createVault('My Vault');
 *
 * @since 1.0.0
 */
export async function getContract(contractName, provider) {
  // Validate contractName
  if (!contractName || typeof contractName !== 'string') {
    throw new Error('Contract name must be a valid string.');
  }

  // Validate provider
  if (!(provider instanceof ethers.AbstractProvider)) {
    throw new Error('Invalid provider. Must be an ethers provider instance.');
  }

  // Get network information
  const network = await provider.getNetwork();
  if (!network || !network.chainId) {
    throw new Error('Provider network not available. Cannot determine which contracts to use.');
  }

  const chainId = network.chainId.toString();

  const contractInfo = contractData[contractName];

  if (!contractInfo) {
    throw new Error(`Contract ${contractName} not found in contract data`);
  }

  // Get address for this network
  const address = contractInfo.addresses?.[chainId];

  if (!address) {
    throw new Error(`No ${contractName} deployment found for network ${chainId}`);
  }

  return new ethers.Contract(
    address,
    contractInfo.abi,
    provider
  );
}

/**
 * Gets the VaultFactory contract for the current network
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @returns {Promise<ethers.Contract>} The VaultFactory contract instance
 * @throws {Error} If provider is invalid
 */
export async function getVaultFactory(provider) {
  // Validate provider
  if (!(provider instanceof ethers.AbstractProvider)) {
    throw new Error('Invalid provider. Must be an ethers provider instance.');
  }

  return await getContract('VaultFactory', provider);
}

/**
 * Gets the address of the VaultFactory for a specific network
 * @param {number} chainId - Chain ID of the network
 * @returns {string|null} Address of the VaultFactory on the specified network, or null if not deployed
 * @throws {Error} If chainId is invalid
 */
export function getVaultFactoryAddress(chainId) {
  // Validate chainId using established pattern
  if (typeof chainId !== 'number') {
    throw new Error('chainId must be a number');
  }

  return contractData.VaultFactory.addresses?.[chainId.toString()] || null;
}

/**
 * Creates a new vault using the VaultFactory
 *
 * @function createVault
 * @memberof module:blockchain/contracts
 *
 * @param {string} name - Name for the new vault
 * @param {ethers.Signer} signer - Signer for the transaction
 *
 * @returns {Promise<string>} The address of the newly created vault
 *
 * @throws {Error} If name is not a string
 * @throws {Error} If signer is invalid
 * @throws {Error} If failed to find VaultCreated event
 *
 * @example
 * const vaultAddress = await createVault('My DeFi Vault', signer);
 * console.log('Created vault at:', vaultAddress);
 *
 * @since 1.0.0
 */
export async function createVault(name, signer) {
  // Validate name parameter
  if (typeof name !== 'string') {
    throw new Error('Name must be a string');
  }

  // Check for empty name
  if (!name || name.trim().length === 0) {
    throw new Error('Vault name cannot be empty');
  }

  // Validate signer parameter
  if (!(signer instanceof ethers.AbstractSigner)) {
    throw new Error('Invalid signer. Must be an ethers signer instance.');
  }

  const factory = await getVaultFactory(signer.provider);
  const factoryWithSigner = factory.connect(signer);

  try {
    const tx = await factoryWithSigner.createVault(name);
    const receipt = await tx.wait();

    // Extract vault address from event logs using topic-based filtering
    const vaultCreatedTopic = factoryWithSigner.interface.getEvent('VaultCreated').topicHash;
    const vaultCreatedEvent = receipt.logs.find(log => log.topics[0] === vaultCreatedTopic);

    if (!vaultCreatedEvent) {
      throw new Error("Failed to find VaultCreated event in transaction receipt");
    }

    const parsedEvent = factoryWithSigner.interface.parseLog(vaultCreatedEvent);
    return parsedEvent.args[1]; // Second arg is vault address
  } catch (error) {
    // Handle contract revert errors
    if (error.code === 'CALL_EXCEPTION') {
      throw new Error(`Failed to create vault: ${error.reason || error.message}`);
    }

    // Handle transaction errors
    if (error.code === 'TRANSACTION_REPLACED' || error.code === 'CANCELLED') {
      throw new Error(`Transaction failed: ${error.message}`);
    }

    // Handle network errors
    if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') {
      throw new Error(`Network error while creating vault: ${error.message}`);
    }

    // Re-throw other errors (including our own event parsing error)
    throw error;
  }
}

/**
 * Creates a PositionVault contract instance for a specific vault address
 *
 * @function getVaultContract
 * @memberof module:blockchain/contracts
 *
 * @param {string} vaultAddress - Address of the vault
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @param {ethers.Signer} [signer] - Optional signer for write operations
 *
 * @returns {ethers.Contract} The vault contract instance
 *
 * @example
 * const vault = getVaultContract(vaultAddress, provider, signer);
 * const owner = await vault.owner();
 *
 * @since 1.0.0
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
 * Gets all vaults for a user
 * @param {string} userAddress - Address of the user
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @returns {Promise<string[]>} Array of vault addresses
 */
export async function getUserVaults(userAddress, provider) {
  const factory = await getVaultFactory(provider);
  return await factory.getVaults(userAddress);
}

/**
 * Gets information about a vault
 * @param {string} vaultAddress - Address of the vault
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @returns {Promise<{owner: string, name: string, creationTime: number}>} Vault information
 */
export async function getVaultInfo(vaultAddress, provider) {
  const factory = await getVaultFactory(provider);
  const [owner, name, creationTime] = await factory.getVaultInfo(vaultAddress);

  return {
    owner,
    name,
    creationTime: Number(creationTime)
  };
}

/**
 * Executes a batch of transactions through a vault
 *
 * @function executeVaultTransactions
 * @memberof module:blockchain/contracts
 *
 * @param {string} vaultAddress - Address of the vault
 * @param {Array<{target: string, data: string}>} transactions - Array of transactions to execute
 * @param {ethers.Signer} signer - Signer for the transaction
 *
 * @returns {Promise<boolean[]>} Array of success flags for each transaction
 *
 * @example
 * const transactions = [{
 *   target: tokenAddress,
 *   data: tokenContract.interface.encodeFunctionData('approve', [spender, amount])
 * }];
 * const results = await executeVaultTransactions(vaultAddress, transactions, signer);
 *
 * @since 1.0.0
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
