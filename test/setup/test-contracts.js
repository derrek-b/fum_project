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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Contract bytecode paths (relative to fum_library root)
const BYTECODE_DIR = path.join(__dirname, '../../bytecode');
const BLOCKCHAIN_CONTRACTS_FILE = path.join(__dirname, '../../src/blockchain/contracts.js');
const ARTIFACTS_CONTRACTS_FILE = path.join(__dirname, '../../src/artifacts/contracts.js');

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
  const contractsData = await import('../../src/artifacts/contracts.js');
  const contractInfo = contractsData.default[mapContractName(contractName)];
  
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
    gasPrice: ethers.parseUnits("0.1", "gwei"),
  });
  await contract.waitForDeployment();
  
  const address = await contract.getAddress();
  console.log(`${contractName} deployed at: ${address}`);
  
  return contract;
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
    contracts.vaultFactory = await deployContract(deployer, 'VaultFactory', [await deployer.getAddress()]);
    
    // Deploy strategies (no constructor args)
    contracts.parrisIsland = await deployContract(deployer, 'ParrisIslandStrategy');
    
    contracts.babySteps = await deployContract(deployer, 'BabyStepsStrategy');
    
    // Get addresses
    const addresses = {
      BatchExecutor: await contracts.batchExecutor.getAddress(),
      VaultFactory: await contracts.vaultFactory.getAddress(),
      ParrisIslandStrategy: await contracts.parrisIsland.getAddress(),
      BabyStepsStrategy: await contracts.babySteps.getAddress(),
    };
    
    // Update contracts.js if requested
    if (config.updateContractsFile) {
      await updateContractsFile(addresses);
    }
    
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
  // Update artifacts/contracts.js (main contracts data file)
  await updateArtifactsContracts(addresses);
}

/**
 * Update the artifacts/contracts.js file with deployed addresses
 * @param {Object} addresses - Deployed contract addresses
 */
async function updateArtifactsContracts(addresses) {
  if (!fs.existsSync(ARTIFACTS_CONTRACTS_FILE)) {
    console.warn(`Artifacts contracts file not found at ${ARTIFACTS_CONTRACTS_FILE}`);
    return;
  }
  
  let content = fs.readFileSync(ARTIFACTS_CONTRACTS_FILE, 'utf8');
  
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
  
  fs.writeFileSync(ARTIFACTS_CONTRACTS_FILE, content);
  console.log('Updated artifacts/contracts.js with test addresses:');
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

/**
 * Sync bytecode from fum project if needed
 * @param {string} fumProjectPath - Path to fum project
 */
export async function syncBytecodeFromFUM(fumProjectPath) {
  const sourceBytecodeDir = path.join(fumProjectPath, 'bytecode');
  
  if (!fs.existsSync(sourceBytecodeDir)) {
    console.warn(`FUM bytecode directory not found at ${sourceBytecodeDir}`);
    return;
  }
  
  // Create bytecode directory if it doesn't exist
  if (!fs.existsSync(BYTECODE_DIR)) {
    fs.mkdirSync(BYTECODE_DIR, { recursive: true });
  }
  
  // Copy bytecode files (.bin files, not .json)
  const files = fs.readdirSync(sourceBytecodeDir);
  for (const file of files) {
    if (file.endsWith('.bin')) {
      const sourcePath = path.join(sourceBytecodeDir, file);
      const destPath = path.join(BYTECODE_DIR, file);
      fs.copyFileSync(sourcePath, destPath);
      console.log(`Copied ${file} to bytecode directory`);
    }
  }
}