// test/scripts/start-hardhat.js
// Hardhat node start script with contract deployment
// Replaces Ganache for Cancun hardfork support (required for Uniswap V4)

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import contractData from 'fum_library/artifacts/contracts';
import { getChainConfig } from 'fum_library/helpers/chainHelpers';
import { spawn, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: '.env.local' });

// Path to the library
const LIBRARY_PATH = path.resolve(__dirname, '../../../fum_library');
const SYNC_SCRIPT = path.resolve(__dirname, '../../scripts/sync-contracts-to-ecosystem.js');

// Function to update library contracts.js files
function updateLibraryContracts(contractsData) {
  try {
    const libraryDistPath = path.join(LIBRARY_PATH, 'dist/artifacts/contracts.js');
    const libraryContractsPath = path.join(LIBRARY_PATH, 'src/artifacts/contracts.js');

    const distArtifactDir = path.dirname(libraryDistPath);
    if (!fs.existsSync(distArtifactDir)) {
      fs.mkdirSync(distArtifactDir, { recursive: true });
    }

    const libraryArtifactsDir = path.dirname(libraryContractsPath);
    if (!fs.existsSync(libraryArtifactsDir)) {
      fs.mkdirSync(libraryArtifactsDir, { recursive: true });
    }

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
    return false;
  }
}

// Wait for Hardhat node to be ready
async function waitForNode(url, maxAttempts = 30) {
  const provider = new ethers.providers.JsonRpcProvider(url);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await provider.getBlockNumber();
      return true;
    } catch (e) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

async function deployContracts(port) {
  const chainId = 1337;
  const ethProvider = new ethers.providers.JsonRpcProvider(`http://localhost:${port}`);

  // Hardhat's default first account private key (from the test mnemonic)
  const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const wallet = new ethers.Wallet(privateKey, ethProvider);

  console.log(`\nDeploying with account: ${wallet.address}`);
  console.log(`Balance: ${ethers.utils.formatEther(await ethProvider.getBalance(wallet.address))} ETH`);

  const contractsDataCopy = JSON.parse(JSON.stringify(contractData));
  const deploymentResults = {};

  try {
    const permit2Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

    // Deploy VaultFactory
    console.log("\nDeploying VaultFactory...");
    console.log(`Using Permit2: ${permit2Address}`);

    const VaultFactoryBytecodePath = path.join(__dirname, `../../bytecode/VaultFactory.bin`);
    const VaultFactoryBytecode = "0x" + fs.readFileSync(VaultFactoryBytecodePath, "utf8").trim();
    const VaultFactory = new ethers.ContractFactory(
      contractsDataCopy.VaultFactory.abi,
      VaultFactoryBytecode,
      wallet
    );

    const vaultFactory = await VaultFactory.deploy(
      wallet.address,
      permit2Address,
      { gasLimit: 5000000 }
    );
    console.log(`Transaction hash: ${vaultFactory.deployTransaction.hash}`);
    await vaultFactory.deployed();
    console.log(`VaultFactory deployed to: ${vaultFactory.address}`);

    contractsDataCopy.VaultFactory.addresses[chainId] = vaultFactory.address;
    deploymentResults.VaultFactory = vaultFactory.address;

    // Deploy BabyStepsStrategy
    console.log("\nDeploying BabyStepsStrategy...");
    const BabyStepsStrategyBytecodePath = path.join(__dirname, `../../bytecode/BabyStepsStrategy.bin`);

    if (fs.existsSync(BabyStepsStrategyBytecodePath)) {
      const BabyStepsStrategyBytecode = "0x" + fs.readFileSync(BabyStepsStrategyBytecodePath, "utf8").trim();

      if (contractsDataCopy.bob?.abi && contractsDataCopy.bob.abi.length > 0) {
        const BabyStepsStrategy = new ethers.ContractFactory(
          contractsDataCopy.bob.abi,
          BabyStepsStrategyBytecode,
          wallet
        );

        const babyStepsStrategy = await BabyStepsStrategy.deploy({ gasLimit: 5000000 });
        console.log(`Transaction hash: ${babyStepsStrategy.deployTransaction.hash}`);
        await babyStepsStrategy.deployed();
        console.log(`BabyStepsStrategy deployed to: ${babyStepsStrategy.address}`);

        contractsDataCopy.bob.addresses[chainId] = babyStepsStrategy.address;
        deploymentResults.BabyStepsStrategy = babyStepsStrategy.address;
      } else {
        console.warn("Warning: BabyStepsStrategy ABI not found. Skipping deployment.");
      }
    } else {
      console.warn(`Warning: BabyStepsStrategy bytecode not found. Skipping deployment.`);
    }

    // Deploy validators
    const chainConfig = getChainConfig(chainId);
    const validatorsToDeploy = [
      'UniversalRouterValidator',
      'UniswapV3PositionValidator',
      'UniswapV4PositionValidator',
    ];

    const deployedValidators = {};
    for (const name of validatorsToDeploy) {
      console.log(`\nDeploying ${name}...`);
      const bytecodePath = path.join(__dirname, `../../bytecode/${name}.bin`);

      if (!fs.existsSync(bytecodePath)) {
        console.warn(`Warning: ${name} bytecode not found at ${bytecodePath}. Skipping.`);
        continue;
      }

      const abi = contractsDataCopy[name]?.abi;
      if (!abi || abi.length === 0) {
        console.warn(`Warning: ${name} ABI not found. Skipping.`);
        continue;
      }

      const bytecode = "0x" + fs.readFileSync(bytecodePath, "utf8").trim();
      const factory = new ethers.ContractFactory(abi, bytecode, wallet);
      const contract = await factory.deploy({ gasLimit: 5000000 });
      await contract.deployed();
      console.log(`${name} deployed to: ${contract.address}`);
      deployedValidators[name] = contract.address;
    }

    // Register validators on VaultFactory
    if (Object.keys(deployedValidators).length > 0) {
      console.log("\nRegistering validators on VaultFactory...");
      const factoryContract = new ethers.Contract(vaultFactory.address, contractsDataCopy.VaultFactory.abi, wallet);

      // Swap validator: UniversalRouter (shared by V3 and V4)
      if (deployedValidators.UniversalRouterValidator) {
        const universalRouterAddress = chainConfig.platformAddresses.uniswapV3.universalRouterAddress;
        const tx1 = await factoryContract.setSwapValidator(universalRouterAddress, deployedValidators.UniversalRouterValidator);
        await tx1.wait();
        console.log(`  Registered UniversalRouterValidator for router ${universalRouterAddress}`);
      }

      // Liquidity validators: V3 and V4 position managers
      if (deployedValidators.UniswapV3PositionValidator) {
        const v3PositionManagerAddress = chainConfig.platformAddresses.uniswapV3.positionManagerAddress;
        const tx2 = await factoryContract.setLiquidityValidator(v3PositionManagerAddress, deployedValidators.UniswapV3PositionValidator);
        await tx2.wait();
        console.log(`  Registered UniswapV3PositionValidator for positionManager ${v3PositionManagerAddress}`);
      }

      if (deployedValidators.UniswapV4PositionValidator) {
        const v4PositionManagerAddress = chainConfig.platformAddresses.uniswapV4.positionManagerAddress;
        const tx3 = await factoryContract.setLiquidityValidator(v4PositionManagerAddress, deployedValidators.UniswapV4PositionValidator);
        await tx3.wait();
        console.log(`  Registered UniswapV4PositionValidator for positionManager ${v4PositionManagerAddress}`);
      }

      console.log("Validator registration complete!");

      // Add validator addresses to deployment results and contracts data
      for (const [name, address] of Object.entries(deployedValidators)) {
        deploymentResults[name] = address;
        if (contractsDataCopy[name]) {
          if (!contractsDataCopy[name].addresses) {
            contractsDataCopy[name].addresses = {};
          }
          contractsDataCopy[name].addresses[chainId] = address;
        }
      }
    }

    // Update library contracts
    updateLibraryContracts(contractsDataCopy);

    // Save deployment info
    const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
    const deploymentInfo = {
      version: "2.0.0",
      timestamp,
      network: { name: "arbitrum", chainId },
      contracts: deploymentResults,
      deployer: wallet.address
    };

    const deploymentsDir = path.join(__dirname, "../../deployments");
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    const deploymentPath = path.join(deploymentsDir, `${chainId}-${timestamp}.json`);
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));

    const latestPath = path.join(deploymentsDir, `${chainId}-latest.json`);
    fs.writeFileSync(latestPath, JSON.stringify(deploymentInfo, null, 2));

    console.log(`\nDeployment info saved to deployments/${chainId}-latest.json`);
    console.log("Deployment completed successfully!");

  } catch (deployError) {
    console.error("Error during deployment:", deployError);
    throw deployError;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const portArgIndex = args.indexOf('--port');
  const port = portArgIndex !== -1 && args.length > portArgIndex + 1
    ? parseInt(args[portArgIndex + 1], 10)
    : 8545;

  // Sync contracts BEFORE spawning the node so deployContracts() reads fresh
  // bytecode. Same reason deploy.js does this — prevents shipping stale .bin
  // when contract sources changed but no one ran `npm run contracts:sync`.
  console.log('Running sync-contracts-to-ecosystem.js to guarantee fresh bytecode...\n');
  execSync(`node ${SYNC_SCRIPT}`, { stdio: 'inherit' });
  console.log('');

  console.log("Starting Hardhat node with Arbitrum mainnet fork...");
  console.log("Hardfork: Cancun (supports Uniswap V4 transient storage)");
  console.log(`Port: ${port}`);

  // Start Hardhat node as a subprocess
  const hardhatProcess = spawn('npx', ['hardhat', 'node', '--port', port.toString()], {
    cwd: path.resolve(__dirname, '../..'),
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let nodeReady = false;

  hardhatProcess.stdout.on('data', (data) => {
    const output = data.toString();
    process.stdout.write(output);

    // Detect when node is ready
    if (output.includes('Started HTTP and WebSocket JSON-RPC server')) {
      nodeReady = true;
    }
  });

  hardhatProcess.stderr.on('data', (data) => {
    process.stderr.write(data.toString());
  });

  hardhatProcess.on('error', (error) => {
    console.error('Failed to start Hardhat node:', error);
    process.exit(1);
  });

  hardhatProcess.on('close', (code) => {
    console.log(`Hardhat node exited with code ${code}`);
    process.exit(code);
  });

  // Handle ctrl+c
  process.on('SIGINT', () => {
    console.log('\nShutting down Hardhat node...');
    hardhatProcess.kill('SIGINT');
  });

  // Wait for node to be ready
  console.log("\nWaiting for Hardhat node to start...");
  const ready = await waitForNode(`http://localhost:${port}`);

  if (!ready) {
    console.error("Hardhat node failed to start");
    hardhatProcess.kill();
    process.exit(1);
  }

  console.log("\nHardhat node is ready!");
  console.log(`HTTP URL: http://localhost:${port}`);

  // Deploy contracts
  await deployContracts(port);

  console.log("\nHardhat node is running. Press Ctrl+C to stop.");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
