const ganache = require("ganache");
const fs = require("fs");
const { ethers } = require("ethers");
const path = require("path");
require("dotenv").config({ path: ".env.local" });

// Load contract artifacts
const contracts = require("../src/abis/contracts.json");

async function main() {
  console.log("Starting Ganache with Arbitrum mainnet fork...");

  const chainId = 1337; // Arbitrum One chain ID
  const server = ganache.server({
    server: {
      ws: true // Enable WebSocket support
    },
    logging: {
      quiet: false
    },
    chain: {
      chainId: chainId,
      hardfork: "london" // Compatible with Arbitrum
    },
    wallet: {
      totalAccounts: 10, // Create 10 test accounts
      defaultBalance: 10000,
      mnemonic: "test test test test test test test test test test test junk"  // ETH balance for each account
    },
    miner: {
      blockTime: .5 // Mine a block every half second
    },
    fork: {
      url: `https://arb-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
    }
  });

  server.listen(8545, async (err) => {
    if (err) {
      console.error(`Error starting Ganache: ${err}`);
      return;
    }

    console.log("Ganache started with Local Arbitrum Fork");
    console.log("WebSocket URL: ws://localhost:8545");
    console.log("HTTP URL: http://localhost:8545");

    // Display test accounts for reference
    const provider = server.provider;
    const accounts = await provider.request({ method: "eth_accounts" });
    console.log("\nTest accounts:");
    accounts.forEach((account, i) => {
      console.log(`Account ${i}: ${account}`);
    });

    // Deploy contracts
    console.log("\nDeploying contracts to Ganache...");
    const ethProvider = new ethers.JsonRpcProvider("http://localhost:8545");
    const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Matches Hardhat/Ganache account #0
    const wallet = new ethers.Wallet(privateKey, ethProvider);
    console.log(`Deploying with account: ${wallet.address}: ${ethers.formatEther(await ethProvider.getBalance(wallet.address))} ETH`);

    // Load contracts.json
    const contractsPath = path.join(__dirname, "../src/abis/contracts.json");
    let contractsData = contracts;
    if (!contractsData.VaultFactory) contractsData.VaultFactory = { abi: contracts.VaultFactory.abi, addresses: {} };
    if (!contractsData.parris) contractsData.parris = { abi: contracts.parris.abi, addresses: {} };

    // Deployment results
    const deploymentResults = {};

    // Deploy VaultFactory
    console.log("\nDeploying VaultFactory...");
    const VaultFactoryBytecodePath = path.join(__dirname, `../bytecode/VaultFactory.bin`);
    const VaultFactoryBytecode = "0x" + fs.readFileSync(VaultFactoryBytecodePath, "utf8").trim();
    const VaultFactory = new ethers.ContractFactory(
      contractsData.VaultFactory.abi,
      VaultFactoryBytecode,
      wallet
    );

    const vaultFactory = await VaultFactory.deploy(wallet.address, {
      gasLimit: 5000000,
      gasPrice: ethers.parseUnits("0.1", "gwei"), // Arbitrum-compatible gas price
    });
    console.log(`Transaction hash: ${vaultFactory.deploymentTransaction().hash}`);
    console.log("Waiting for deployment to be confirmed...");
    await vaultFactory.waitForDeployment();
    const vaultFactoryAddress = await vaultFactory.getAddress();
    console.log(`VaultFactory deployed to: ${vaultFactoryAddress}`);

    // Update contracts.json
    contractsData.VaultFactory.addresses[chainId] = vaultFactoryAddress;
    deploymentResults.VaultFactory = vaultFactoryAddress;

    // Deploy ParrisIslandStrategy
    console.log("\nDeploying ParrisIslandStrategy...");
    const ParrisIslandStrategyBytecodePath = path.join(__dirname, `../bytecode/ParrisIslandStrategy.bin`);
    const ParrisIslandStrategyBytecode = "0x" + fs.readFileSync(ParrisIslandStrategyBytecodePath, "utf8").trim();
    const ParrisIslandStrategy = new ethers.ContractFactory(
      contractsData.parris.abi,
      ParrisIslandStrategyBytecode,
      wallet
    );

    const strategy = await ParrisIslandStrategy.deploy({
      gasLimit: 5000000,
      gasPrice: ethers.parseUnits("0.1", "gwei"),
    });
    console.log(`Transaction hash: ${strategy.deploymentTransaction().hash}`);
    console.log("Waiting for deployment to be confirmed...");
    await strategy.waitForDeployment();
    const strategyAddress = await strategy.getAddress();
    console.log(`ParrisIslandStrategy deployed to: ${strategyAddress}`);

    // Update contracts.json (map to 'parris')
    contractsData.parris.addresses[chainId] = strategyAddress;
    deploymentResults.ParrisIslandStrategy = strategyAddress;

    // Save updated contracts.json
    fs.writeFileSync(contractsPath, JSON.stringify(contractsData, null, 2));
    console.log(`Updated contracts.json with new addresses for network ${chainId}`);

    // Save deployment info to deployments directory
    const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
    const deploymentInfo = {
      version: "0.2.1", // Match Hardhat script version
      timestamp,
      network: {
        name: "arbitrum", // Match Hardhat network name
        chainId
      },
      contracts: deploymentResults,
      deployer: wallet.address
    };

    console.log("Saving deployment info...");
    const deploymentsDir = path.join(__dirname, "../deployments");
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    const deploymentPath = path.join(deploymentsDir, `${chainId}-${timestamp}.json`);
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));

    const latestPath = path.join(deploymentsDir, `${chainId}-latest.json`);
    fs.writeFileSync(latestPath, JSON.stringify(deploymentInfo, null, 2));

    console.log(`Deployment info saved to deployments/${chainId}-latest.json`);
    console.log("Deployment completed successfully!");
    console.log("\nGanache is running. Press Ctrl+C to stop.");
  });
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
