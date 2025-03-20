const { ethers } = require("hardhat");

// Contract deployment addresses
let liquidityManagerAddress;
let strategyRegistryAddress;
let uniswapV3AdapterAddress;

// Platform addresses
const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const UNISWAP_V3_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

async function main() {
  console.log("Deploying F.U.M. smart contracts...");

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with account: ${deployer.address}`);

  // Get the network we're deploying to
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Deploying to network with chainId: ${chainId}`);

  // Deploy LiquidityManager
  const LiquidityManager = await ethers.getContractFactory("LiquidityManager");
  const liquidityManager = await LiquidityManager.deploy();
  await liquidityManager.deployed();
  liquidityManagerAddress = liquidityManager.address;
  console.log(`LiquidityManager deployed to: ${liquidityManagerAddress}`);

  // Deploy StrategyRegistry
  const StrategyRegistry = await ethers.getContractFactory("StrategyRegistry");
  const strategyRegistry = await StrategyRegistry.deploy();
  await strategyRegistry.deployed();
  strategyRegistryAddress = strategyRegistry.address;
  console.log(`StrategyRegistry deployed to: ${strategyRegistryAddress}`);

  // Deploy UniswapV3Adapter
  const UniswapV3Adapter = await ethers.getContractFactory("UniswapV3Adapter");
  const uniswapV3Adapter = await UniswapV3Adapter.deploy(
    UNISWAP_V3_POSITION_MANAGER,
    UNISWAP_V3_FACTORY
  );
  await uniswapV3Adapter.deployed();
  uniswapV3AdapterAddress = uniswapV3Adapter.address;
  console.log(`UniswapV3Adapter deployed to: ${uniswapV3AdapterAddress}`);

  // Register adapter with the LiquidityManager
  console.log(`Registering UniswapV3Adapter with LiquidityManager...`);
  const registerTx = await liquidityManager.registerAdapter(
    UNISWAP_V3_FACTORY,
    uniswapV3Adapter.address
  );
  await registerTx.wait();
  console.log(`Adapter registered successfully.`);

  // Print deployment summary
  console.log("\nDeployment Summary:");
  console.log("==================");
  console.log(`LiquidityManager: ${liquidityManagerAddress}`);
  console.log(`StrategyRegistry: ${strategyRegistryAddress}`);
  console.log(`UniswapV3Adapter: ${uniswapV3AdapterAddress}`);

  // Write deployment information to a file
  const fs = require("fs");
  const deploymentInfo = {
    network: {
      name: hre.network.name,
      chainId: chainId
    },
    contracts: {
      LiquidityManager: liquidityManagerAddress,
      StrategyRegistry: strategyRegistryAddress,
      UniswapV3Adapter: uniswapV3AdapterAddress
    },
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(
    `deployment-${hre.network.name}-${chainId}.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log(`Deployment information saved to deployment-${hre.network.name}-${chainId}.json`);
}

// Execute deployment
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

// Export deployment function for testing
module.exports = { deploy: main };
