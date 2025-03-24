// scripts/deploy.js
// Chain-agnostic deployment script with network-specific address tracking
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import config from '../src/utils/config.js';

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
  const networkConfig = config.chains[chainId];
  if (!networkConfig) {
    throw new Error(`Network with chainId ${chainId} not configured in config.js`);
  }

  // Get environment variable name from config
  const envVarName = networkConfig.envPK || 'PRIVATE_KEY';
  const privateKey = process.env[envVarName];

  if (!privateKey) {
    throw new Error(`No private key found for network ${networkName}. Set the ${envVarName} environment variable.`);
  }

  return privateKey;
}

async function deploy() {
  // Get network details
  const chainId = getChainId(networkName);
  const networkConfig = config.chains[chainId];

  if (!networkConfig) {
    throw new Error(`Network with chainId ${chainId} not configured in config.js`);
  }

  console.log(`Deploying to ${networkConfig.name} (${chainId})...`);

  // Connect to provider
  const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

  // Get private key and create wallet
  const privateKey = getPrivateKey(chainId);
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`Deploying with account: ${wallet.address}`);

  // Check wallet balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);

  // Load contract ABIs from contracts.json
  const contractsPath = path.join(__dirname, '../src/abis/contracts.json');
  let contractsData;

  try {
    contractsData = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));
  } catch (error) {
    console.log("contracts.json not found or invalid, creating new file");
    contractsData = {};
  }

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

    // Look for existing ABI or create a minimal entry
    let abi = [];
    if (contractsData[contractName] && contractsData[contractName].abi) {
      abi = contractsData[contractName].abi;
    } else {
      console.warn(`No ABI found for ${contractName}, using empty array`);
      contractsData[contractName] = {
        abi: [],
        addresses: {}
      };
    }

    // Deploy the contract
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);

    // Check if the contract has constructor parameters
    let contract;
    if (contractName === "VaultFactory") {
      // Deploy using the wallet address as the owner parameter
      contract = await factory.deploy(wallet.address);
    } else {
      // No constructor parameters for other contracts
      contract = await factory.deploy();
    }

    console.log(`Transaction hash: ${contract.deploymentTransaction().hash}`);

    // Wait for deployment to complete
    console.log('Waiting for deployment to be confirmed...');
    await contract.deploymentTransaction().wait();

    const contractAddress = await contract.getAddress();
    console.log(`${contractName} deployed to: ${contractAddress}`);

    // Update contracts.json with the new address for this network
    if (!contractsData[contractName]) {
      contractsData[contractName] = {
        abi: abi,
        addresses: {}
      };
    }

    if (!contractsData[contractName].addresses) {
      contractsData[contractName].addresses = {};
    }

    contractsData[contractName].addresses[chainId] = contractAddress;

    // Save results for deployment info
    deploymentResults[contractName] = contractAddress;

    return contractAddress;
  };

  // Determine which contracts to deploy
  let contractsToDeploy = [];
  if (contractName === 'all') {
    // Deploy all contracts
    contractsToDeploy = ['BatchExecutor', 'VaultFactory'];
  } else {
    // Deploy only the specified contract
    contractsToDeploy = [contractName];
  }

  // Deploy each contract
  for (const contract of contractsToDeploy) {
    await deployContract(contract);
  }

  // Update contracts.json with all deployed addresses
  fs.writeFileSync(contractsPath, JSON.stringify(contractsData, null, 2));
  console.log(`Updated contracts.json with new addresses for network ${chainId}`);

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

  if(chainId !== 1337) {// Save deployment info
    const deploymentPath = path.join(deploymentsDir, `${chainId}-${timestamp}.json`);
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    return
  }
  // Save deployment info
  const deploymentPath = path.join(deploymentsDir, `${chainId}-${timestamp}.json`);
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));

  // Also save as latest deployment for this network
  const latestPath = path.join(deploymentsDir, `${chainId}-latest.json`);
  fs.writeFileSync(latestPath, JSON.stringify(deploymentInfo, null, 2));

  console.log(`Deployment info saved to deployments/${chainId}-latest.json`);
  console.log('Deployment completed successfully!');
}

// Execute deployment
deploy().catch(error => {
  console.error('Deployment failed:', error);
  process.exit(1);
});
