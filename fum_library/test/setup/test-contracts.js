/**
 * Test Contract Deployment
 *
 * Handles deployment of FUM contracts for testing.
 * Integrates with fum_library contract management.
 */

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getContract } from './hardhat-config.js';
import contractsData from '../../dist/artifacts/contracts.js';
import { getChainConfig, getPlatformAddresses } from '../../dist/helpers/chainHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Contract bytecode paths (relative to fum_library root)
const BYTECODE_DIR = path.join(__dirname, '../../bytecode');
const BLOCKCHAIN_CONTRACTS_FILE = path.join(__dirname, '../../src/blockchain/contracts.js');
const ARTIFACTS_CONTRACTS_FILE = path.join(__dirname, '../../src/artifacts/contracts.js');
const DIST_ARTIFACTS_CONTRACTS_FILE = path.join(__dirname, '../../dist/artifacts/contracts.js');
const SRC_CHAINS_FILE = path.join(__dirname, '../../src/configs/chains.js');
const DIST_CHAINS_FILE = path.join(__dirname, '../../dist/configs/chains.js');

/**
 * Load contract bytecode from file
 * @param {string} contractName - Name of the contract
 * @returns {Object} Contract bytecode and ABI
 */
async function loadContractBytecode(contractName) {
  const bytecodePath = path.join(BYTECODE_DIR, `${contractName}.bin`);

  if (!fs.existsSync(bytecodePath)) {
    throw new Error(`Bytecode not found for ${contractName} at ${bytecodePath}`);
  }

  const bytecodeHex = "0x" + fs.readFileSync(bytecodePath, 'utf8').trim();

  // Get ABI from artifacts
  const contractInfo = contractsData[mapContractName(contractName)];

  if (!contractInfo || !contractInfo.abi) {
    throw new Error(`ABI not found for ${contractName}`);
  }

  return {
    bytecode: bytecodeHex,
    abi: contractInfo.abi,
  };
}

/**
 * Deploy a contract
 * @param {ethers.Signer} deployer - Signer to deploy with
 * @param {string} contractName - Name of the contract
 * @param {Array} args - Constructor arguments
 * @returns {ethers.Contract} Deployed contract instance
 */
async function deployContract(deployer, contractName, args = []) {
  const { bytecode, abi } = await loadContractBytecode(contractName);

  const factory = new ethers.ContractFactory(abi, bytecode, deployer);
  const contract = await factory.deploy(...args, {
    gasLimit: 5000000,
    gasPrice: ethers.utils.parseUnits("1", "gwei"),  // Must exceed fork's baseFeePerGas
  });
  await contract.deployed();

  const address = contract.address;
  console.log(`${contractName} deployed at: ${address}`);

  return contract;
}

/**
 * Validate that deployed addresses match addresses stored in contracts file
 * Fails fast if addresses don't match to avoid long test runs with wrong addresses
 * If addresses don't match, saves the new addresses before exiting so next run uses them
 * @param {Object} actualAddresses - The actual deployed contract addresses
 * @param {number} chainId - The chain ID to validate against
 */
async function validateDeterministicAddresses(actualAddresses, chainId) {

  // Get expected addresses from the contracts file for this chain
  const chainIdStr = String(chainId);
  const expectedAddresses = {
    VaultFactory: contractsData.VaultFactory?.addresses?.[chainIdStr],
    BabyStepsStrategy: contractsData.bob?.addresses?.[chainIdStr],
  };

  let allMatch = true;
  const mismatches = [];
  let hasMissingAddresses = false;

  for (const [contractName, expectedAddress] of Object.entries(expectedAddresses)) {
    const actualAddress = actualAddresses[contractName];

    if (!expectedAddress) {
      console.log(`⚠️  ${contractName}: No stored address found (first deployment)`);
      hasMissingAddresses = true;
      continue;
    }

    if (actualAddress.toLowerCase() === expectedAddress.toLowerCase()) {
      console.log(`✅ ${contractName}: ${actualAddress} (matches stored)`);
    } else {
      console.log(`❌ ${contractName}: ${actualAddress} (stored: ${expectedAddress})`);
      allMatch = false;
      mismatches.push({
        contract: contractName,
        actual: actualAddress,
        expected: expectedAddress
      });
    }
  }

  // Save addresses if any were missing (first deployment for this chain)
  if (hasMissingAddresses && allMatch) {
    console.log('Saving new addresses for first deployment...');
    await updateContractsFile(actualAddresses, chainId);
    console.log('✅ Addresses saved for future runs.\n');
  }

  if (!allMatch) {
    console.error('\n💥 DETERMINISTIC ADDRESS VALIDATION FAILED!');
    console.error('Deployed addresses do not match stored addresses in contracts file.');
    console.error('Possible causes:');
    console.error('  - Custom mnemonic was changed');
    console.error('  - Deployer account or nonce changed');
    console.error('  - Network state affecting deployment');
    console.error('  - Contract deployment order changed');
    console.error('\nMismatched contracts:');
    mismatches.forEach(mismatch => {
      console.error(`  ${mismatch.contract}: deployed ${mismatch.actual}, stored ${mismatch.expected}`);
    });
    console.error('\nSaving new addresses before exit so next run uses them...');

    // Save the new addresses before exiting so next run will use them
    await updateContractsFile(actualAddresses, chainId);
    console.error('✅ New addresses saved. Run the test again to use the updated addresses.');
    console.error('\nFailing fast to avoid wasting time on a broken test run.');

    // Exit the entire process immediately
    process.exit(1);
  }

  console.log('✅ All contract addresses match stored values!\n');
}

/**
 * Update chains.js config with a deployed address
 * @param {number} chainId - Chain ID to update
 * @param {string} platformId - Platform key (e.g. 'traderjoeV2_2')
 * @param {string} key - Address key to update (e.g. 'positionManagerAddress')
 * @param {string} value - The address value to set
 */
async function updateChainsConfig(chainId, platformId, key, value) {
  const files = [SRC_CHAINS_FILE, DIST_CHAINS_FILE];
  let anyFileUpdated = false;

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    // Find the chainId block, then the platformId block within it, then update the key
    // Pattern: find `chainId: {` ... `platformId: {` ... `key: "..."` and replace the value
    const pattern = new RegExp(
      `(${chainId}:\\s*\\{[\\s\\S]*?${platformId}:\\s*\\{[\\s\\S]*?${key}:\\s*)"[^"]*"`,
    );

    if (pattern.test(content)) {
      content = content.replace(pattern, `$1"${value}"`);
      fs.writeFileSync(filePath, content);
      console.log(`  Updated ${key} in ${platformId} for chain ${chainId} in ${path.basename(filePath)}: ${value}`);
      anyFileUpdated = true;
    } else {
      console.warn(`  Could not find ${key} in ${platformId} for chain ${chainId} in ${path.basename(filePath)}`);
    }
  }

  if (!anyFileUpdated) {
    console.warn(`No chains config file found (checked src/ and dist/) — could not update ${key} for chain ${chainId}`);
  }
}

/**
 * Deploy all FUM contracts
 * @param {ethers.Signer} deployer - Signer to deploy with
 * @param {Object} config - Deployment configuration
 * @returns {Object} Deployed contract instances
 */
export async function deployFUMContracts(deployer, config = {}) {
  const contracts = {};

  try {
    // Get chainId to look up correct platform addresses
    const network = await deployer.provider.getNetwork();
    const chainId = network.chainId;

    // Permit2 is canonical across all chains
    const permit2Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

    console.log(`Deploying for chainId ${chainId}:`);

    // Deploy VaultFactory with owner and permit2 (v2.0.0)
    // Validators are registered separately after deployment
    contracts.vaultFactory = await deployContract(deployer, 'VaultFactory', [
      deployer.address,
      permit2Address
    ]);

    // Chain-specific deployments:
    // - 1337 (Arbitrum fork): Deploy Uniswap V3/V4 contracts
    // - 1338 (Avalanche fork): Deploy Trader Joe contracts
    const isAvalanche = chainId === 1338;

    if (!isAvalanche) {
      // Arbitrum fork - deploy Uniswap contracts
      const uniswapAddresses = getPlatformAddresses(chainId, 'uniswapV3');
      const universalRouterAddress = uniswapAddresses.universalRouterAddress;
      const nonfungiblePositionManagerAddress = uniswapAddresses.positionManagerAddress;

      console.log(`  Universal Router: ${universalRouterAddress}`);
      console.log(`  Position Manager: ${nonfungiblePositionManagerAddress}`);

      // Deploy validators (no constructor args)
      contracts.universalRouterValidator = await deployContract(deployer, 'UniversalRouterValidator');
      contracts.v3PositionValidator = await deployContract(deployer, 'UniswapV3PositionValidator');
      contracts.v4PositionValidator = await deployContract(deployer, 'UniswapV4PositionValidator');

      // Register validators with factory
      console.log('Registering validators with factory...');
      await contracts.vaultFactory.setSwapValidator(
        universalRouterAddress,
        contracts.universalRouterValidator.address
      );
      console.log(`  ✅ UniversalRouterValidator registered for ${universalRouterAddress}`);

      await contracts.vaultFactory.setLiquidityValidator(
        nonfungiblePositionManagerAddress,
        contracts.v3PositionValidator.address
      );
      console.log(`  ✅ UniswapV3PositionValidator registered for ${nonfungiblePositionManagerAddress}`);

      // Get V4 position manager address and register V4 validator
      try {
        const uniswapV4Addresses = getPlatformAddresses(chainId, 'uniswapV4');
        const v4PositionManagerAddress = uniswapV4Addresses.positionManagerAddress;
        await contracts.vaultFactory.setLiquidityValidator(
          v4PositionManagerAddress,
          contracts.v4PositionValidator.address
        );
        console.log(`  ✅ UniswapV4PositionValidator registered for ${v4PositionManagerAddress}`);
      } catch (e) {
        console.log(`  ⚠️ V4 not configured for chainId ${chainId}, skipping V4 validator registration`);
      }

      // Deploy and register Merkl incentive validator
      const chainConfig = getChainConfig(chainId);
      if (chainConfig.merklDistributorAddress) {
        contracts.merklIncentiveValidator = await deployContract(deployer, 'MerklIncentiveValidator');
        await contracts.vaultFactory.setIncentiveValidator(
          chainConfig.merklDistributorAddress,
          contracts.merklIncentiveValidator.address
        );
        console.log(`  ✅ MerklIncentiveValidator registered for ${chainConfig.merklDistributorAddress}`);
      }
    } else {
      // Avalanche fork - deploy Trader Joe contracts
      const tjAddresses = getPlatformAddresses(chainId, 'traderjoeV2_2');

      // Deploy TJPositionProxy implementation (cloned per position)
      contracts.tjPositionProxy = await deployContract(deployer, 'TJPositionProxy');

      // Deploy TJPositionManager with router + proxy implementation
      contracts.tjPositionManager = await deployContract(deployer, 'TJPositionManager', [
        tjAddresses.lbRouterAddress,
        contracts.tjPositionProxy.address
      ]);
      contracts.tjPositionValidator = await deployContract(deployer, 'TJPositionValidator');
      contracts.tjSwapValidator = await deployContract(deployer, 'TJSwapValidator');

      // Register TJ validators with factory
      await contracts.vaultFactory.setLiquidityValidator(
        contracts.tjPositionManager.address,
        contracts.tjPositionValidator.address
      );
      console.log(`  ✅ TJPositionValidator registered for ${contracts.tjPositionManager.address}`);

      await contracts.vaultFactory.setSwapValidator(
        tjAddresses.lbRouterAddress,
        contracts.tjSwapValidator.address
      );
      console.log(`  ✅ TJSwapValidator registered for ${tjAddresses.lbRouterAddress}`);

      // Save TJPositionManager address to chains config so adapter can find it
      await updateChainsConfig(chainId, 'traderjoeV2_2', 'positionManagerAddress',
        contracts.tjPositionManager.address);
    }

    // Deploy strategies (no constructor args)
    contracts.babySteps = await deployContract(deployer, 'BabyStepsStrategy');

    // Get addresses
    const addresses = {
      VaultFactory: contracts.vaultFactory.address,
      BabyStepsStrategy: contracts.babySteps.address,
    };

    // Add TJ addresses if deployed
    if (contracts.tjPositionManager) {
      addresses.TJPositionManager = contracts.tjPositionManager.address;
    }
    if (contracts.tjPositionValidator) {
      addresses.TJPositionValidator = contracts.tjPositionValidator.address;
    }
    if (contracts.tjSwapValidator) {
      addresses.TJSwapValidator = contracts.tjSwapValidator.address;
    }

    // Add incentive validator addresses if deployed
    if (contracts.merklIncentiveValidator) {
      addresses.MerklIncentiveValidator = contracts.merklIncentiveValidator.address;
    }

    // Validate deterministic addresses - fail fast if they don't match expected values
    await validateDeterministicAddresses(addresses, chainId);

    return {
      contracts,
      addresses,
    };
  } catch (error) {
    console.error('Contract deployment failed:', error);
    throw error;
  }
}

/**
 * Update the fum_library contracts files with deployed addresses
 * @param {Object} addresses - Deployed contract addresses
 * @param {number} chainId - The chain ID to update
 */
async function updateContractsFile(addresses, chainId) {
  // Update both src and dist versions using the same logic
  await updateArtifactsContracts(addresses, ARTIFACTS_CONTRACTS_FILE, chainId);
  await updateArtifactsContracts(addresses, DIST_ARTIFACTS_CONTRACTS_FILE, chainId);
}

/**
 * Update a contracts.js file with deployed addresses
 * @param {Object} addresses - Deployed contract addresses
 * @param {string} filePath - Path to the contracts file to update
 * @param {number} chainId - The chain ID to update
 */
async function updateArtifactsContracts(addresses, filePath, chainId) {
  console.log(`Attempting to update contracts file at: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.warn(`Contracts file not found at ${filePath}`);
    return;
  }

  const chainIdStr = String(chainId);
  let content = fs.readFileSync(filePath, 'utf8');

  // Update each contract's address for this chain
  Object.entries(addresses).forEach(([contractName, address]) => {
    // Map contract names to the names used in artifacts
    const artifactName = mapContractName(contractName);

    // Look for the contract's addresses section and update the chainId
    const addressPattern = new RegExp(
      `("${artifactName}":[\\s\\S]*?"addresses":\\s*{[^}]*"${chainIdStr}":\\s*)"[^"]*"`,
      'g'
    );

    content = content.replace(addressPattern, `$1"${address}"`);

    // If chainId doesn't exist, add it
    const addPattern = new RegExp(
      `("${artifactName}":[\\s\\S]*?"addresses":\\s*{)([^}]*)(})`,
      'g'
    );

    content = content.replace(addPattern, (match, before, middle, after) => {
      if (!middle.includes(`"${chainIdStr}"`)) {
        const newMiddle = middle.trim() ? middle + `,\n      "${chainIdStr}": "` + address + '"' : `\n      "${chainIdStr}": "` + address + '"\n    ';
        return before + newMiddle + after;
      }
      return match;
    });
  });

  fs.writeFileSync(filePath, content);
  console.log(`Updated ${filePath} with test addresses:`);
  Object.entries(addresses).forEach(([name, address]) => {
    console.log(`  ${name}: ${address}`);
  });
}

/**
 * Map deployment names to artifact names
 * @param {string} contractName - Name from deployment
 * @returns {string} Name used in artifacts
 */
function mapContractName(contractName) {
  const nameMap = {
    'VaultFactory': 'VaultFactory',
    'BabyStepsStrategy': 'bob',
    'PositionVault': 'PositionVault',
    'UniversalRouterValidator': 'UniversalRouterValidator',
    'UniswapV3PositionValidator': 'UniswapV3PositionValidator',
    'UniswapV4PositionValidator': 'UniswapV4PositionValidator',
    'TJPositionProxy': 'TJPositionProxy',
    'TJPositionManager': 'TJPositionManager',
    'TJPositionValidator': 'TJPositionValidator',
    'TJSwapValidator': 'TJSwapValidator',
    'MerklIncentiveValidator': 'MerklIncentiveValidator'
  };

  return nameMap[contractName] || contractName;
}

/**
 * Deploy a test vault
 * @param {Object} vaultFactory - VaultFactory contract instance
 * @param {Object} params - Vault parameters
 * @returns {ethers.Contract} Deployed vault instance
 */
export async function deployTestVault(vaultFactory, params) {
  const {
    name = 'Test Vault',
  } = params;

  // v2.0.0: createVault just takes a name string
  const tx = await vaultFactory.createVault(name);
  const receipt = await tx.wait();

  // Find VaultCreated event
  const event = receipt.logs.find(
    log => log.topics[0] === vaultFactory.interface.getEvent('VaultCreated').topicHash
  );

  if (!event) {
    throw new Error('VaultCreated event not found');
  }

  const decodedEvent = vaultFactory.interface.parseLog(event);
  const vaultAddress = decodedEvent.args.vault;

  // Load vault ABI
  const { abi } = await loadContractBytecode('PositionVault');
  return getContract(vaultAddress, abi, vaultFactory.runner);
}

