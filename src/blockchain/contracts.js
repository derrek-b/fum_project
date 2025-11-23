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
  if (!(provider instanceof ethers.providers.Provider)) {
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

  const contract = new ethers.Contract(
    address,
    contractInfo.abi,
    provider
  );
  return contract;
}

/**
 * Gets the VaultFactory contract for the current network
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @returns {Promise<ethers.Contract>} The VaultFactory contract instance
 * @throws {Error} If provider is invalid
 */
export async function getVaultFactory(provider) {
  // Validate provider
  if (!(provider instanceof ethers.providers.Provider)) {
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
  if (!signer || !signer.provider || typeof signer.getAddress !== 'function') {
    throw new Error('Invalid signer. Must be an ethers signer instance.');
  }

  const factory = await getVaultFactory(signer.provider);
  const factoryWithSigner = factory.connect(signer);

  try {
    const tx = await factoryWithSigner.createVault(name);
    const receipt = await tx.wait();

    // Extract vault address from event logs
    const vaultCreatedTopic = factoryWithSigner.interface.getEventTopic('VaultCreated');
    const vaultCreatedEvent = receipt.logs.find(log => log.topics[0] === vaultCreatedTopic);

    if (!vaultCreatedEvent) {
      throw new Error("Failed to find VaultCreated event in transaction receipt");
    }

    const parsedEvent = factoryWithSigner.interface.parseLog(vaultCreatedEvent);
    return parsedEvent.args.vault || parsedEvent.args[1]; // vault address (named or positional)
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
export function getVaultContract(vaultAddress, provider) {
  // Validate vault address
  if (!vaultAddress) {
    throw new Error('Vault address parameter is required');
  }
  try {
    ethers.utils.getAddress(vaultAddress);
  } catch (error) {
    throw new Error(`Invalid vault address: ${vaultAddress}`);
  }

  // Validate provider
  if (!(provider instanceof ethers.providers.Provider)) {
    throw new Error('Invalid provider. Must be an ethers provider instance.');
  }

  // Validate ABI exists
  const vaultAbi = contractData.PositionVault?.abi;
  if (!vaultAbi || !Array.isArray(vaultAbi) || vaultAbi.length === 0) {
    throw new Error('PositionVault ABI not found or invalid');
  }

  try {
    return new ethers.Contract(
      vaultAddress,
      vaultAbi,
      provider
    );
  } catch (error) {
    throw new Error(`Failed to create contract instance: ${error.message}`);
  }
}

/**
 * Gets all vaults for a user
 * @param {string} userAddress - Address of the user
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @returns {Promise<string[]>} Array of vault addresses
 */
export async function getUserVaults(userAddress, provider) {
  // Validate user address
  if (!userAddress) {
    throw new Error('User address parameter is required');
  }
  try {
    ethers.utils.getAddress(userAddress);
  } catch (error) {
    throw new Error(`Invalid user address: ${userAddress}`);
  }

  // Provider validation happens in getVaultFactory
  const factory = await getVaultFactory(provider);

  try {
    return await factory.getVaults(userAddress);
  } catch (error) {
    throw new Error(`Failed to get user vaults: ${error.message}`);
  }
}

/**
 * Gets all vaults that have authorized a specific executor address
 * @param {string} executorAddress - Address of the executor to check authorization for
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @returns {Promise<string[]>} Array of vault addresses that have authorized the executor
 * @throws {Error} If executorAddress is invalid or provider is invalid
 * @since 1.0.0
 */
export async function getAuthorizedVaults(executorAddress, provider) {
  // Validate executor address
  if (!executorAddress) {
    throw new Error('Executor address parameter is required');
  }
  try {
    ethers.utils.getAddress(executorAddress);
  } catch (error) {
    throw new Error(`Invalid executor address: ${executorAddress}`);
  }

  // Provider validation happens in getVaultFactory
  const factory = await getVaultFactory(provider);
  
  try {
    // Get total number of vaults from factory
    const totalVaults = await factory.getTotalVaultCount();
    const authorizedVaults = [];
    
    // Iterate through all vaults
    for (let i = 0; i < totalVaults; i++) {
      // Get vault address at index
      const vaultAddress = await factory.allVaults(i);
      
      // Get vault contract instance
      const vault = getVaultContract(vaultAddress, provider);
      
      // Check if executor matches
      const executor = await vault.executor();
      
      if (executor.toLowerCase() === executorAddress.toLowerCase()) {
        authorizedVaults.push(vaultAddress);
      }
    }
    
    return authorizedVaults;
  } catch (error) {
    throw new Error(`Failed to get authorized vaults: ${error.message}`);
  }
}

/**
 * Gets information about a vault
 * @param {string} vaultAddress - Address of the vault
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @returns {Promise<{owner: string, name: string, creationTime: number}>} Vault information
 */
export async function getVaultInfo(vaultAddress, provider) {
  // Validate vault address
  if (!vaultAddress) {
    throw new Error('Vault address parameter is required');
  }
  try {
    ethers.utils.getAddress(vaultAddress);
  } catch (error) {
    throw new Error(`Invalid vault address: ${vaultAddress}`);
  }

  // Provider validation happens in getVaultFactory
  const factory = await getVaultFactory(provider);

  try {
    const [owner, name, creationTime] = await factory.getVaultInfo(vaultAddress);

    return {
      owner,
      name,
      creationTime: Number(creationTime)
    };
  } catch (error) {
    throw new Error(`Failed to get vault info: ${error.message}`);
  }
}

/**
 * Get contract information by deployed address
 * @param {string} address - The contract address to look up
 * @returns {Object} Contract information with contractName and chainId
 * @throws {Error} If address is not found in contract data
 * @example
 * // Get contract info for a deployed address
 * const info = getContractInfoByAddress('0x742d35cc6634c0532925a3b8d7d566dd8f4da4d1');
 * // Returns: { contractName: 'bob', chainId: 1 }
 * @since 1.0.0
 */
export function getContractInfoByAddress(address) {
  // Validate address parameter
  if (!address) {
    throw new Error('Address parameter is required');
  }
  try {
    ethers.utils.getAddress(address);
  } catch (error) {
    throw new Error(`Invalid address: ${address}`);
  }

  const normalizedAddress = address.toLowerCase();

  // Search through all contracts and their deployed addresses
  for (const [contractName, contractInfo] of Object.entries(contractData)) {
    if (contractInfo.addresses) {
      for (const [chainId, contractAddress] of Object.entries(contractInfo.addresses)) {
        if (contractAddress.toLowerCase() === normalizedAddress) {
          return {
            contractName,
            chainId: parseInt(chainId)
          };
        }
      }
    }
  }

  throw new Error(`Contract address ${address} not found in contract data`);
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
 * @returns {Promise<boolean>} True if all transactions succeeded (execution is atomic)
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
  // Validate vault address
  if (!vaultAddress) {
    throw new Error('Vault address parameter is required');
  }
  try {
    ethers.utils.getAddress(vaultAddress);
  } catch (error) {
    throw new Error(`Invalid vault address: ${vaultAddress}`);
  }

  // Validate transactions array
  if (!Array.isArray(transactions)) {
    throw new Error('Transactions must be an array');
  }
  if (transactions.length === 0) {
    throw new Error('Transactions array cannot be empty');
  }
  
  // Validate each transaction
  transactions.forEach((tx, index) => {
    if (!tx || typeof tx !== 'object') {
      throw new Error(`Transaction at index ${index} must be an object`);
    }
    if (!tx.target) {
      throw new Error(`Transaction at index ${index} is missing target address`);
    }
    if (!tx.data) {
      throw new Error(`Transaction at index ${index} is missing data`);
    }
    try {
      ethers.utils.getAddress(tx.target);
    } catch (error) {
      throw new Error(`Invalid target address at index ${index}: ${tx.target}`);
    }
    if (typeof tx.data !== 'string') {
      throw new Error(`Transaction data at index ${index} must be a string`);
    }
    if (!tx.data.startsWith('0x')) {
      throw new Error(`Transaction data at index ${index} must be hex encoded (start with 0x)`);
    }
  });

  // Validate signer parameter
  if (!signer || !signer.provider || typeof signer.getAddress !== 'function') {
    throw new Error('Invalid signer. Must be an ethers signer instance.');
  }

  const vault = getVaultContract(vaultAddress, signer.provider);
  const vaultWithSigner = vault.connect(signer);

  const targets = transactions.map(tx => tx.target);
  const data = transactions.map(tx => tx.data);

  try {
    const tx = await vaultWithSigner.execute(targets, data);
    await tx.wait();
    return true; // All transactions succeeded (atomic execution)
  } catch (error) {
    throw new Error(`Failed to execute vault transactions: ${error.message}`);
  }
}
