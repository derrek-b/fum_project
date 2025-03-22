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
  const contractsData = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));

  // For deployment, we need bytecode - extract it once from your test environment
  const bytecodePath = path.join(__dirname, '../bytecode/VaultFactory.bin');

  if (!fs.existsSync(bytecodePath)) {
    throw new Error(`Bytecode file not found at ${bytecodePath}. Please extract bytecode from your test environment first.`);
  }

  const bytecode = '0x' + fs.readFileSync(bytecodePath, 'utf8').trim();
  const abi = contractsData.VaultFactory.abi;

  // Deploy the contract
  console.log('Deploying VaultFactory...');
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);

  // Deploy using the wallet address as the owner parameter
  const contract = await factory.deploy(wallet.address);
  console.log(`Transaction hash: ${contract.deploymentTransaction().hash}`);

  // Wait for deployment to complete
  console.log('Waiting for deployment to be confirmed...');
  await contract.deploymentTransaction().wait();

  const vaultFactoryAddress = await contract.getAddress();
  console.log(`VaultFactory deployed to: ${vaultFactoryAddress}`);

  // Update contracts.json with the new address for this network
  if (!contractsData.VaultFactory.addresses) {
    contractsData.VaultFactory.addresses = {};
  }
  contractsData.VaultFactory.addresses[chainId] = vaultFactoryAddress;
  fs.writeFileSync(contractsPath, JSON.stringify(contractsData, null, 2));
  console.log(`Updated contracts.json with new address for network ${chainId}`);

  // Save deployment info to deployments directory
  const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const deploymentInfo = {
    version: "0.2.0",
    timestamp,
    network: {
      name: networkConfig.name,
      chainId
    },
    contracts: {
      VaultFactory: vaultFactoryAddress
    },
    deployer: wallet.address
  };

  if(chainId === 1337) {
    console.log('No deployments log for localhost')
    return
  }

  console.log('Saving deployment info...')

  // Create deployments directory if it doesn't exist
  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
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
