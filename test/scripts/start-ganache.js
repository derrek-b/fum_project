// test/scripts/start-ganache.js
// NOTE: This script is for local Ganache testing only
import { fileURLToPath } from 'url';
import path from 'path';
import ganache from "ganache";
import fs from "fs";
import { ethers } from "ethers";
import dotenv from 'dotenv';
import contractData from 'fum_library/artifacts/contracts';
import { getChainConfig } from 'fum_library/helpers/chainHelpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: '.env.local' });

// Path to the library (3 levels up from test/scripts/, then into fum_library)
const LIBRARY_PATH = path.resolve(__dirname, '../../../fum_library');

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
    // Parse command line arguments
    const args = process.argv.slice(2);
    const portArgIndex = args.indexOf('--port');
    const port = portArgIndex !== -1 && args.length > portArgIndex + 1
      ? parseInt(args[portArgIndex + 1], 10)
      : 8545; // Default port

    console.log(`Starting Ganache with Arbitrum mainnet fork on port ${port}...`);

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
        blockTime: 0 // Instant mining (auto-mine)
      },
      fork: {
        url: `https://arb-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
      }
    });

    server.listen(port, async (err) => {
      if (err) {
        console.error(`Error starting Ganache: ${err}`);
        return;
      }

      console.log("Ganache started with Local Arbitrum Fork");
      console.log(`WebSocket URL: ws://localhost:${port}`);
      console.log(`HTTP URL: http://localhost:${port}`);

      // Display test accounts for reference
      const provider = server.provider;
      const accounts = await provider.request({ method: "eth_accounts" });
      console.log("\nTest accounts:");
      accounts.forEach((account, i) => {
        console.log(`Account ${i}: ${account}`);
      });

      // Deploy contracts
      console.log("\nDeploying contracts to Ganache...");
      const ethProvider = new ethers.providers.JsonRpcProvider(`http://localhost:${port}`);
      const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Matches Hardhat/Ganache account #0
      const wallet = new ethers.Wallet(privateKey, ethProvider);
      console.log(`Deploying with account: ${wallet.address}: ${ethers.utils.formatEther(await ethProvider.getBalance(wallet.address))} ETH`);

      // Create a deep copy of contractData to avoid modifying the imported object
      const contractsDataCopy = JSON.parse(JSON.stringify(contractData));

      // Deployment results
      const deploymentResults = {};

      try {
        // Get Arbitrum network config for protocol addresses (we're forking Arbitrum)
        const arbitrumConfig = getChainConfig(42161);
        const universalRouterAddress = arbitrumConfig.platformAddresses?.uniswapV3?.universalRouterAddress;
        const positionManagerAddress = arbitrumConfig.platformAddresses?.uniswapV3?.positionManagerAddress;
        const permit2Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3'; // Canonical Permit2 address

        if (!universalRouterAddress || !positionManagerAddress) {
          throw new Error('Missing Uniswap V3 addresses in Arbitrum config');
        }

        // Deploy VaultFactory
        console.log("\nDeploying VaultFactory...");
        console.log(`Using Universal Router: ${universalRouterAddress}`);
        console.log(`Using Permit2: ${permit2Address}`);
        console.log(`Using Position Manager: ${positionManagerAddress}`);

        const VaultFactoryBytecodePath = path.join(__dirname, `../../bytecode/VaultFactory.bin`);
        const VaultFactoryBytecode = "0x" + fs.readFileSync(VaultFactoryBytecodePath, "utf8").trim();
        const VaultFactory = new ethers.ContractFactory(
          contractsDataCopy.VaultFactory.abi,
          VaultFactoryBytecode,
          wallet
        );

        const vaultFactory = await VaultFactory.deploy(
          wallet.address,
          universalRouterAddress,
          permit2Address,
          positionManagerAddress,
          {
            gasLimit: 5000000
          }
        );
        console.log(`Transaction hash: ${vaultFactory.deployTransaction.hash}`);
        console.log("Waiting for deployment to be confirmed...");
        await vaultFactory.deployed();
        const vaultFactoryAddress = vaultFactory.address;
        console.log(`VaultFactory deployed to: ${vaultFactoryAddress}`);

        // Update contracts data copy
        contractsDataCopy.VaultFactory.addresses[chainId] = vaultFactoryAddress;
        deploymentResults.VaultFactory = vaultFactoryAddress;

        // Deploy BabyStepsStrategy
        console.log("\nDeploying BabyStepsStrategy...");
        const BabyStepsStrategyBytecodePath = path.join(__dirname, `../../bytecode/BabyStepsStrategy.bin`);

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
              gasLimit: 5000000
            });
            console.log(`Transaction hash: ${babyStepsStrategy.deployTransaction.hash}`);
            console.log("Waiting for deployment to be confirmed...");
            await babyStepsStrategy.deployed();
            const babyStepsStrategyAddress = babyStepsStrategy.address;
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
        const deploymentsDir = path.join(__dirname, "../../deployments");
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
