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
import { getContract } from './ganache-config.js';
import contractsData from '../../dist/artifacts/contracts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Contract bytecode paths (relative to fum_library root)
const BYTECODE_DIR = path.join(__dirname, '../../bytecode');
const BLOCKCHAIN_CONTRACTS_FILE = path.join(__dirname, '../../src/blockchain/contracts.js');
const ARTIFACTS_CONTRACTS_FILE = path.join(__dirname, '../../src/artifacts/contracts.js');
const DIST_ARTIFACTS_CONTRACTS_FILE = path.join(__dirname, '../../dist/artifacts/contracts.js');

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
    gasPrice: ethers.utils.parseUnits("0.1", "gwei"),
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
 */
async function validateDeterministicAddresses(actualAddresses) {

  // Get expected addresses from the contracts file
  const expectedAddresses = {
    BatchExecutor: contractsData.BatchExecutor?.addresses?.['1337'],
    VaultFactory: contractsData.VaultFactory?.addresses?.['1337'],
    ParrisIslandStrategy: contractsData.parris?.addresses?.['1337'],
    BabyStepsStrategy: contractsData.bob?.addresses?.['1337'],
  };

  let allMatch = true;
  const mismatches = [];

  for (const [contractName, expectedAddress] of Object.entries(expectedAddresses)) {
    const actualAddress = actualAddresses[contractName];

    if (!expectedAddress) {
      console.log(`⚠️  ${contractName}: No stored address found (first deployment)`);
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
    await updateContractsFile(actualAddresses);
    console.error('✅ New addresses saved. Run the test again to use the updated addresses.');
    console.error('\nFailing fast to avoid wasting time on a broken test run.');

    // Exit the entire process immediately
    process.exit(1);
  }

  console.log('✅ All contract addresses match stored values!\n');
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
    // Deploy BatchExecutor
    contracts.batchExecutor = await deployContract(deployer, 'BatchExecutor');

    // Deploy VaultFactory with owner address
    contracts.vaultFactory = await deployContract(deployer, 'VaultFactory', [deployer.address]);

    // Deploy strategies (no constructor args)
    contracts.parrisIsland = await deployContract(deployer, 'ParrisIslandStrategy');

    contracts.babySteps = await deployContract(deployer, 'BabyStepsStrategy');

    // Get addresses
    const addresses = {
      BatchExecutor: contracts.batchExecutor.address,
      VaultFactory: contracts.vaultFactory.address,
      ParrisIslandStrategy: contracts.parrisIsland.address,
      BabyStepsStrategy: contracts.babySteps.address,
    };

    // Validate deterministic addresses - fail fast if they don't match expected values
    await validateDeterministicAddresses(addresses);

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
 */
async function updateContractsFile(addresses) {
  // Update both src and dist versions using the same logic
  await updateArtifactsContracts(addresses, ARTIFACTS_CONTRACTS_FILE);
  await updateArtifactsContracts(addresses, DIST_ARTIFACTS_CONTRACTS_FILE);
}

/**
 * Update a contracts.js file with deployed addresses
 * @param {Object} addresses - Deployed contract addresses
 * @param {string} filePath - Path to the contracts file to update
 */
async function updateArtifactsContracts(addresses, filePath) {
  console.log(`Attempting to update contracts file at: ${filePath}`);
  
  if (!fs.existsSync(filePath)) {
    console.warn(`Contracts file not found at ${filePath}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Update each contract's 1337 address
  Object.entries(addresses).forEach(([contractName, address]) => {
    // Map contract names to the names used in artifacts
    const artifactName = mapContractName(contractName);

    // Look for the contract's addresses section and update 1337
    const addressPattern = new RegExp(
      `("${artifactName}":[\\s\\S]*?"addresses":\\s*{[^}]*"1337":\\s*)"[^"]*"`,
      'g'
    );

    content = content.replace(addressPattern, `$1"${address}"`);

    // If 1337 doesn't exist, add it
    const addPattern = new RegExp(
      `("${artifactName}":[\\s\\S]*?"addresses":\\s*{)([^}]*)(})`,
      'g'
    );

    content = content.replace(addPattern, (match, before, middle, after) => {
      if (!middle.includes('"1337"')) {
        const newMiddle = middle.trim() ? middle + ',\n      "1337": "' + address + '"' : '\n      "1337": "' + address + '"\n    ';
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
    'BatchExecutor': 'BatchExecutor',
    'VaultFactory': 'VaultFactory',
    'ParrisIslandStrategy': 'parris',
    'BabyStepsStrategy': 'bob',
    'PositionVault': 'PositionVault'
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
    symbol = 'TEST-V',
    depositor,
    executor,
    strategist,
    feeRecipient,
    performanceFee = 1000, // 10%
    managementFee = 200,   // 2%
  } = params;

  const tx = await vaultFactory.createVault(
    name,
    symbol,
    depositor,
    executor,
    strategist,
    feeRecipient,
    performanceFee,
    managementFee
  );

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

  // Load vault ABI (you'll need to have this)
  const { abi } = loadContractBytecode('PositionVault');
  return getContract(vaultAddress, abi, vaultFactory.runner);
}

