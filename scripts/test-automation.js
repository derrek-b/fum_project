// scripts/test-automation.js
const { ethers } = require("ethers");
const fs = require("fs");
const AutomationService = require("../src/automation/AutomationService");

async function main() {
  try {
    console.log("Testing Automation Service with Ganache...");

    // Load addresses from Ganache deployment
    let addresses;
    try {
      addresses = JSON.parse(fs.readFileSync("./ganache-addresses.json"));
    } catch (error) {
      console.error("Failed to load Ganache addresses. Is Ganache running?");
      console.error("Run 'npm run ganache' first to start Ganache and deploy contracts.");
      process.exit(1);
    }

    console.log(`Using VaultFactory at: ${addresses.VaultFactory}`);
    console.log(`Using ParrisIslandStrategy at: ${addresses.ParrisIslandStrategy}`);

    // Create a provider and get a wallet
    const provider = new ethers.WebSocketProvider("ws://localhost:8545");
    const [wallet] = await provider.listAccounts();

    // Use the first account as our automation service address
    console.log(`Using account ${wallet.address} as automation service address`);

    // Start automation service
    const service = new AutomationService({
      debug: true,
      automationServiceAddress: wallet.address,
      chainId: 1337,
      rpcUrl: 'http://localhost:8545',
      wsUrl: 'ws://localhost:8545'
    });

    await service.start();

    console.log("\nAutomation service running in test mode. Press Ctrl+C to stop.");

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
