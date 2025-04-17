// scripts/test-automation.js
const { ethers } = require("ethers");
const path = require("path");
const fs = require("fs");
const AutomationService = require("../src/automation/AutomationService");

async function main() {
  try {
    console.log("Testing Automation Service with Local Network...");

    // Load contract data from contracts.json
    const contractsPath = path.join(__dirname, '../src/abis/contracts.json');

    if (!fs.existsSync(contractsPath)) {
      console.error(`contracts.json not found at ${contractsPath}`);
      process.exit(1);
    }

    const contractsData = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));

    // Set chainId for local network
    const chainId = 1337;

    // Extract contract addresses for the local network
    console.log(contractsData.VaultFactory)
    const vaultFactoryAddress = contractsData.VaultFactory.addresses[chainId];
    const strategyAddress = contractsData.parris.addresses[chainId];

    if (!vaultFactoryAddress || !strategyAddress) {
      console.error(`Missing contract addresses for chainId ${chainId} in contracts.json`);
      console.error("Make sure your contracts are deployed and addresses are updated in contracts.json");
      process.exit(1);
    }

    console.log(`Using VaultFactory at: ${vaultFactoryAddress}`);
    console.log(`Using ParrisIslandStrategy at: ${strategyAddress}`);

    // Create a provider and get a wallet address
    const provider = new ethers.JsonRpcProvider("http://localhost:8545");
    const wsProvider = new ethers.WebSocketProvider("ws://localhost:8545");

    // Set automation wallet address (aka: executor, automationServiceAddress)
    const executor = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

    // Define known pools for testing
    // This is a workaround since we don't have pool discovery implemented yet
    const knownPools = [
      {
        // Use a real pool address if available, or a placeholder for testing
        address: "0xC6962004f452bE9203591991D15f6b388e09E8D0", // USDC/ETH 0.3% Uniswap V3 pool on Ethereum
        token0: "USDC",
        token1: "ETH",
        fee: 500,
        platform: "uniswapV3"
      }
    ];

    console.log("Using the following test pools:");
    knownPools.forEach(pool => {
      console.log(`- ${pool.token0}/${pool.token1} ${pool.fee/10000}% at ${pool.address}`);
    });

    // Start automation service with comprehensive configuration
    const service = new AutomationService({
      debug: true,
      automationServiceAddress: executor,
      chainId: chainId,
      rpcUrl: 'http://localhost:8545',
      wsUrl: 'ws://localhost:8545',
      // Add all required parameters:
      factoryAddress: vaultFactoryAddress,
      parrisStrategyAddress: strategyAddress,
      knownPools: knownPools,
      // Additional configuration
      gasPrice: {
        maxFeePerGas: ethers.parseUnits('3', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei')
      },
      pollInterval: 30000 // 30 seconds
    });

    try {
      await service.start();
      console.log("\nAutomation service running in test mode.");
      console.log("The service is now listening for swap events on the configured pools.");
      console.log("When a swap event occurs, you should see 'We are handling price events, BABY!'");
      console.log("\nPress Ctrl+C to stop.");
    } catch (error) {
      console.error("Failed to start automation service:", error);
      process.exit(1);
    }

    // Keep the process running
    process.on("SIGINT", async () => {
      console.log("\nShutting down test automation service...");
      await service.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

main();
