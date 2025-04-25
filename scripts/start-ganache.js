import { fileURLToPath } from 'url';
import path from 'path';
import ganache from "ganache";
import fs from "fs";
import { ethers } from "ethers";
import dotenv from 'dotenv';
import contractData from 'fum_library/artifacts/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: '.env.local' });

// Fixed path to the library (sibling directory)
const LIBRARY_PATH = path.resolve(__dirname, '../../fum_library');

// Function to update library contracts.js files
function updateLibraryContracts(contractsData) {
  try {
    const libraryDistPath = path.join(LIBRARY_PATH, 'dist/artifacts/contracts.js');
    const libraryContractsPath = path.join(LIBRARY_PATH, 'src/artifacts/contracts.js');

    // Create the artifacts directory if it doesn't exist
    const distArtifactDir = path.dirname(libraryDistPath);
    if (!fs.existsSync(distArtifactDir)) {
      fs.mkdirSync(distArtifactDir, { recursive: true });
    }

    const libraryArtifactsDir = path.dirname(libraryContractsPath);
    if (!fs.existsSync(libraryArtifactsDir)) {
      fs.mkdirSync(libraryArtifactsDir, { recursive: true });
    }

    // Create the library contracts.js file with the updated data
    const libraryContractsContent = `// src/artifacts/contracts.js
      /**
       * Contract ABIs and addresses for the F.U.M. project
       * This file is auto-generated and should not be edited directly
       */

      // Contract ABIs and addresses
      const contracts = ${JSON.stringify(contractsData, null, 2)};

      export default contracts;`;

    fs.writeFileSync(libraryDistPath, libraryContractsContent);
    fs.writeFileSync(libraryContractsPath, libraryContractsContent);
    console.log(`Updated distribution contracts.js at ${libraryDistPath}`)
    console.log(`Updated library contracts.js at ${libraryContractsPath}`);
    return true;
  } catch (error) {
    console.warn(`Could not update library contracts: ${error.message}`);
    console.warn(`Ensure that the library exists at ${LIBRARY_PATH}`);
    return false;
  }
}

// Main function to start Ganache and deploy contracts
async function main() {
  try {
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

      // Create a deep copy of contractData to avoid modifying the imported object
      const contractsDataCopy = JSON.parse(JSON.stringify(contractData));

      // Deployment results
      const deploymentResults = {};

      try {
        // Deploy VaultFactory
        console.log("\nDeploying VaultFactory...");
        const VaultFactoryBytecodePath = path.join(__dirname, `../bytecode/VaultFactory.bin`);
        const VaultFactoryBytecode = "0x" + fs.readFileSync(VaultFactoryBytecodePath, "utf8").trim();
        const VaultFactory = new ethers.ContractFactory(
          contractsDataCopy.VaultFactory.abi,
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

        // Update contracts data copy
        contractsDataCopy.VaultFactory.addresses[chainId] = vaultFactoryAddress;
        deploymentResults.VaultFactory = vaultFactoryAddress;

        // Deploy ParrisIslandStrategy
        console.log("\nDeploying ParrisIslandStrategy...");
        const ParrisIslandStrategyBytecodePath = path.join(__dirname, `../bytecode/ParrisIslandStrategy.bin`);
        const ParrisIslandStrategyBytecode = "0x" + fs.readFileSync(ParrisIslandStrategyBytecodePath, "utf8").trim();
        const ParrisIslandStrategy = new ethers.ContractFactory(
          contractsDataCopy.parris.abi,
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

        // Update contracts data copy (map to 'parris')
        contractsDataCopy.parris.addresses[chainId] = strategyAddress;
        deploymentResults.ParrisIslandStrategy = strategyAddress;

        // Deploy BabyStepsStrategy
        console.log("\nDeploying BabyStepsStrategy...");
        const BabyStepsStrategyBytecodePath = path.join(__dirname, `../bytecode/BabyStepsStrategy.bin`);

        // Check if bytecode file exists
        if (fs.existsSync(BabyStepsStrategyBytecodePath)) {
          const BabyStepsStrategyBytecode = "0x" + fs.readFileSync(BabyStepsStrategyBytecodePath, "utf8").trim();

          // Check if we have the ABI
          if (contractsDataCopy.bob?.abi && contractsDataCopy.bob.abi.length > 0) {
            const BabyStepsStrategy = new ethers.ContractFactory(
              contractsDataCopy.bob.abi,
              BabyStepsStrategyBytecode,
              wallet
            );

            const babyStepsStrategy = await BabyStepsStrategy.deploy({
              gasLimit: 5000000,
              gasPrice: ethers.parseUnits("0.1", "gwei"),
            });
            console.log(`Transaction hash: ${babyStepsStrategy.deploymentTransaction().hash}`);
            console.log("Waiting for deployment to be confirmed...");
            await babyStepsStrategy.waitForDeployment();
            const babyStepsStrategyAddress = await babyStepsStrategy.getAddress();
            console.log(`BabyStepsStrategy deployed to: ${babyStepsStrategyAddress}`);

            // Update contracts data copy (map to 'bob')
            contractsDataCopy.bob.addresses[chainId] = babyStepsStrategyAddress;
            deploymentResults.BabyStepsStrategy = babyStepsStrategyAddress;
          } else {
            console.warn("Warning: BabyStepsStrategy ABI not found. Skipping deployment.");
          }
        } else {
          console.warn(`Warning: BabyStepsStrategy bytecode not found at ${BabyStepsStrategyBytecodePath}. Skipping deployment.`);
        }

        // Update the library's contracts.js file
        updateLibraryContracts(contractsDataCopy);

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
      } catch (deployError) {
        console.error("Error during deployment:", deployError);
      }

      console.log("\nGanache is running. Press Ctrl+C to stop.");
    });
  } catch (error) {
    console.error("Error starting Ganache:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
