// scripts/deploy.js
// Chain-agnostic deployment script with network-specific address tracking
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getChainConfig } from 'fum_library/helpers/chainHelpers';
import contractData from 'fum_library/artifacts/contracts';

// Load environment variables
dotenv.config();

// Setup path helpers
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const networkArg = args.find(arg => arg.startsWith('--network='));
const networkName = networkArg ? networkArg.split('=')[1] : 'localhost';
const contractArg = args.find(arg => arg.startsWith('--contract='));
const contractName = contractArg ? contractArg.split('=')[1] : 'all'; // Default to deploying all contracts

// Library path for updating deployment addresses
const LIBRARY_PATH = path.resolve(__dirname, '../../fum_library');

// Get chainId from network name
function getChainId(networkName) {
  // Common network name to chainId mappings
  const networkMap = {
    'localhost': 1337,
    'mainnet': 1,
    'ethereum': 1,
    'arbitrum': 42161,
    'polygon': 137,
    'optimism': 10,
    'base': 8453,
  };

  return networkMap[networkName] || parseInt(networkName, 10);
}

// Get the appropriate private key based on network
function getPrivateKey(chainId) {
  // Use hardcoded key for localhost
  if (chainId === 1337) {
    return '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Default Hardhat account #0
  }

  // For other networks, look up the env var name in config
  const networkConfig = getChainConfig(chainId);
  if (!networkConfig) {
    throw new Error(`Network with chainId ${chainId} not configured`);
  }

  // Get environment variable name from config
  const envVarName = networkConfig.envPK || 'PRIVATE_KEY';
  const privateKey = process.env[envVarName];

  if (!privateKey) {
    throw new Error(`No private key found for network ${networkName}. Set the ${envVarName} environment variable.`);
  }

  return privateKey;
}

/**
 * Update the library's contracts.js files with new deployment addresses
 * @param {Object} deploymentResults - Object mapping contract names to addresses
 * @param {number} chainId - The chain ID for the deployment
 */
function updateLibraryAddresses(deploymentResults, chainId) {
  try {
    console.log('\nUpdating library with new deployment addresses...');

    // Define paths for both src and dist versions
    const srcContractsPath = path.join(LIBRARY_PATH, 'src/artifacts/contracts.js');
    const distContractsPath = path.join(LIBRARY_PATH, 'dist/artifacts/contracts.js');

    // Check if the src file exists and read it
    if (!fs.existsSync(srcContractsPath)) {
      console.warn(`Library contracts file not found at ${srcContractsPath}, skipping address update`);
      return false;
    }

    // Read and parse the existing contracts
    const fileContent = fs.readFileSync(srcContractsPath, 'utf8');
    const contractsMatch = fileContent.match(/const contracts = ([\s\S]*?);[\s\S]*export default contracts/);

    if (!contractsMatch || !contractsMatch[1]) {
      console.warn('Could not parse existing contracts file, skipping address update');
      return false;
    }

    let existingContracts;
    try {
      existingContracts = eval(`(${contractsMatch[1]})`);
    } catch (e) {
      console.warn(`Could not evaluate contracts object: ${e.message}`);
      return false;
    }

    // Map deployment result names to library contract names
    const contractNameMapping = {
      'ParrisIslandStrategy': 'parris',
      'BabyStepsStrategy': 'bob',
      'VaultFactory': 'VaultFactory',
      'BatchExecutor': 'BatchExecutor',
      'PositionVault': 'PositionVault'
    };

    // Update addresses for deployed contracts
    let updatedCount = 0;
    for (const [deployedName, address] of Object.entries(deploymentResults)) {
      const libraryName = contractNameMapping[deployedName] || deployedName;

      if (existingContracts[libraryName]) {
        // Initialize addresses object if it doesn't exist
        if (!existingContracts[libraryName].addresses) {
          existingContracts[libraryName].addresses = {};
        }

        // Update the address for this chain
        existingContracts[libraryName].addresses[chainId.toString()] = address;
        console.log(`  ✅ Updated ${libraryName} address for chain ${chainId}: ${address}`);
        updatedCount++;
      } else {
        console.warn(`  ⚠️ Contract ${libraryName} not found in library, skipping`);
      }
    }

    // Generate the updated file content
    const contractsContent = `// artifacts/contracts.js
      /**
       * Contract ABIs and addresses for the F.U.M. project
       * This file is auto-generated and should not be edited directly
       */

      // Contract ABIs and addresses
      const contracts = ${JSON.stringify(existingContracts, null, 2)};

      export default contracts;`;

    // Write to both src and dist
    fs.writeFileSync(srcContractsPath, contractsContent);
    console.log(`  📝 Updated ${srcContractsPath}`);

    fs.writeFileSync(distContractsPath, contractsContent);
    console.log(`  📝 Updated ${distContractsPath}`);

    console.log(`✅ Library addresses updated (${updatedCount} contracts)\n`);
    return true;
  } catch (error) {
    console.warn(`⚠️ Could not update library addresses: ${error.message}`);
    return false;
  }
}

async function deploy() {
  // Get network details
  const chainId = getChainId(networkName);
  const networkConfig = getChainConfig(chainId);

  if (!networkConfig) {
    throw new Error(`Network with chainId ${chainId} not configured`);
  }

  console.log(`Deploying to ${networkConfig.name} (${chainId})...`);

  // Connect to provider
  const provider = new ethers.providers.JsonRpcProvider(networkConfig.rpcUrl);

  // Get private key and create wallet
  const privateKey = getPrivateKey(chainId);
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`Deploying with account: ${wallet.address}`);

  // Check wallet balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`Account balance: ${ethers.utils.formatEther(balance)} ETH`);

  // Make a local copy of the contract data to avoid modifying the imported version
  const contractsDataCopy = JSON.parse(JSON.stringify(contractData));

  // Deployment results to track what was deployed
  const deploymentResults = {};

  // Define a function to deploy a single contract
  const deployContract = async (contractName) => {
    console.log(`\nDeploying ${contractName}...`);

    // For deployment, we need bytecode - extract it from your test environment
    const bytecodePath = path.join(__dirname, `../bytecode/${contractName}.bin`);

    if (!fs.existsSync(bytecodePath)) {
      throw new Error(`Bytecode file not found at ${bytecodePath}. Please extract bytecode from your test environment first.`);
    }

    const bytecode = '0x' + fs.readFileSync(bytecodePath, 'utf8').trim();

    // Look for existing ABI
    let abi = [];
    if (contractName === 'ParrisIslandStrategy') {
      abi = contractsDataCopy['parris']?.abi || [];
    } else if (contractName === 'BabyStepsStrategy') {
      abi = contractsDataCopy['bob']?.abi || [];
    } else {
      abi = contractsDataCopy[contractName]?.abi || [];
    }

    if (abi.length === 0) {
      console.warn(`No ABI found for ${contractName}, using empty array`);
    }

    // Deploy the contract
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);

    // Check if the contract has constructor parameters
    let contract;
    if (contractName === "VaultFactory") {
      // Get Universal Router address for this chain
      const universalRouterAddress = networkConfig.uniswapV3?.universalRouterAddress;
      if (!universalRouterAddress) {
        throw new Error(`Universal Router address not configured for chain ${chainId}`);
      }
      // Deploy using the wallet address as owner and chain's Universal Router
      console.log(`Using Universal Router: ${universalRouterAddress}`);
      contract = await factory.deploy(wallet.address, universalRouterAddress);
    } else {
      // No constructor parameters for other contracts
      contract = await factory.deploy();
    }

    console.log(`Transaction hash: ${contract.deployTransaction.hash}`);

    // Wait for deployment to complete
    console.log('Waiting for deployment to be confirmed...');
    await contract.deployTransaction.wait();

    const contractAddress = contract.address;
    console.log(`${contractName} deployed to: ${contractAddress}`);

    // Save results for deployment info
    deploymentResults[contractName] = contractAddress;

    return contractAddress;
  };

  // Determine which contracts to deploy
  let contractsToDeploy = [];
  if (contractName === 'all') {
    // Deploy all contracts
    contractsToDeploy = ['BatchExecutor', 'VaultFactory', 'ParrisIslandStrategy', 'BabyStepsStrategy'];
  } else {
    // Deploy only the specified contract
    contractsToDeploy = [contractName];
  }

  // Deploy each contract
  for (const contract of contractsToDeploy) {
    await deployContract(contract);
  }

  // Save deployment info to deployments directory
  const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const deploymentInfo = {
    version: "0.2.1",
    timestamp,
    network: {
      name: networkConfig.name,
      chainId
    },
    contracts: deploymentResults,
    deployer: wallet.address
  };

  console.log('Saving deployment info...')

  // Create deployments directory if it doesn't exist
  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Save deployment info
  const deploymentPath = path.join(deploymentsDir, `${chainId}-${timestamp}.json`);
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));

  // Also save as latest deployment for this network (except for mainnet)
  if(chainId !== 1) {
    const latestPath = path.join(deploymentsDir, `${chainId}-latest.json`);
    fs.writeFileSync(latestPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`Deployment info saved to deployments/${chainId}-latest.json`);
  }

  // Update library with new deployment addresses
  updateLibraryAddresses(deploymentResults, chainId);

  console.log('Deployment completed successfully!');
}

// Execute deployment
deploy().catch(error => {
  console.error('Deployment failed:', error);
  process.exit(1);
});
