// scripts/create-test-vault.js
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import config from '../src/utils/config.js';

// Load environment variables
dotenv.config();

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const networkArg = args.find(arg => arg.startsWith('--network='));
const networkName = networkArg ? networkArg.split('=')[1] : 'localhost';

// Load contract artifacts
const loadArtifact = (contractName) => {
  const artifactPath = path.join(__dirname, `../artifacts/contracts/${contractName}.sol/${contractName}.json`);
  return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
};

async function main() {
  // Get network configuration
  const chainId = networkName === 'localhost' ? 1337 : 42161; // Default to Arbitrum unless localhost
  const networkConfig = config.chains[chainId];

  if (!networkConfig) {
    throw new Error(`Network with chainId ${chainId} not configured`);
  }

  console.log(`Creating test vault with sample position on ${networkConfig.name}...`);

  // Set up provider and signer
  const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

  let signer;
  if (networkName === 'localhost') {
    // For local testing, use the first account
    signer = new ethers.Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Default Hardhat account #0
      provider
    );
  } else {
    // For real networks, use private key from .env
    if (!process.env.PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY environment variable not set');
    }
    signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  }

  console.log(`Using account: ${signer.address}`);

  // Load deployment info to get contract addresses
  const deploymentPath = path.join(__dirname, `../deployments/${chainId}-latest.json`);

  if (!fs.existsSync(deploymentPath)) {
    console.error(`No deployment found for network ${networkConfig.name}. Please run deploy-vaults.js first.`);
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const vaultFactoryAddress = deployment.contracts.VaultFactory;

  console.log(`Using VaultFactory at: ${vaultFactoryAddress}`);

  // Load contract artifacts
  const VaultFactoryArtifact = loadArtifact('VaultFactory');
  const PositionVaultArtifact = loadArtifact('PositionVault');
  const MockPositionNFTArtifact = loadArtifact('MockPositionNFT');

  // Connect to VaultFactory
  const vaultFactory = new ethers.Contract(
    vaultFactoryAddress,
    VaultFactoryArtifact.abi,
    signer
  );

  // Create a new vault
  console.log("\nCreating new vault...");
  const vaultName = "Test Vault " + Math.floor(Date.now() / 1000);

  const tx = await vaultFactory.createVault(vaultName);
  const receipt = await tx.wait();

  // Extract vault address from event logs
  const vaultCreatedEvents = receipt.logs
    .filter(log => {
      try {
        return vaultFactory.interface.parseLog(log).name === 'VaultCreated';
      } catch (e) {
        return false;
      }
    })
    .map(log => vaultFactory.interface.parseLog(log));

  if (vaultCreatedEvents.length === 0) {
    console.error("Failed to find VaultCreated event in transaction logs");
    process.exit(1);
  }

  const vaultAddress = vaultCreatedEvents[0].args[1]; // Second arg is vault address
  console.log(`New vault created at: ${vaultAddress}`);
  console.log(`Vault name: ${vaultName}`);

  // Connect to the vault
  const vault = new ethers.Contract(
    vaultAddress,
    PositionVaultArtifact.abi,
    signer
  );

  // Get token references from config
  const WETH_ADDRESS = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
  const USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

  // Deploy a mock NFT contract (for testing only)
  console.log("\nDeploying mock NFT contract...");
  const MockPositionNFTFactory = new ethers.ContractFactory(
    MockPositionNFTArtifact.abi,
    MockPositionNFTArtifact.bytecode,
    signer
  );

  const mockNFT = await MockPositionNFTFactory.deploy(signer.address);
  await mockNFT.deploymentTransaction().wait();

  const mockNFTAddress = await mockNFT.getAddress();
  console.log(`Mock NFT deployed at: ${mockNFTAddress}`);

  // Create a position
  console.log("\nCreating mock position...");
  const createTx = await mockNFT.createPosition(
    signer.address,
    WETH_ADDRESS,
    USDC_ADDRESS,
    3000, // fee tier (0.3%)
    -10000, // lower tick
    10000,  // upper tick
    1000000 // liquidity
  );
  await createTx.wait();
  console.log("Mock position created with ID: 1");

  // Approve and transfer the position to the vault
  console.log("\nTransferring position to vault...");
  await mockNFT.approve(vaultAddress, 1);
  await mockNFT["safeTransferFrom(address,address,uint256)"](
    signer.address,
    vaultAddress,
    1
  );

  // Verify position ownership
  const nftOwner = await mockNFT.ownerOf(1);
  if (nftOwner === vaultAddress) {
    console.log("Position successfully transferred to vault!");
  } else {
    console.error("Position transfer failed. Current owner:", nftOwner);
  }

  // Verify position is tracked by vault
  const isManaged = await vault.managedPositions(1);
  console.log(`Position managed by vault: ${isManaged}`);

  console.log("\nTest vault setup complete!");
  console.log("====================");
  console.log(`Vault Address: ${vaultAddress}`);
  console.log(`Mock NFT Address: ${mockNFTAddress}`);
  console.log(`Position ID: 1`);

  // Save test vault info
  const testInfo = {
    chainId,
    network: networkConfig.name,
    vaultAddress,
    vaultName,
    mockNFTAddress,
    positionId: 1,
    timestamp: new Date().toISOString()
  };

  const testDir = path.join(__dirname, "../test-data");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(testDir, `test-vault-${chainId}.json`),
    JSON.stringify(testInfo, null, 2)
  );

  console.log(`Test information saved to ./test-data/test-vault-${chainId}.json`);
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
