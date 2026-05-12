// scripts/verify-arbitrum.js
// Verifies deployed FUM contracts on Arbiscan using the deployment record at
// fum/deployments/42161-latest.json. Run with:
//   npx hardhat run scripts/verify-arbitrum.js --network arbitrumOne

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

// Default to the primary tree's deployment record. Override with
// DEPLOYMENT_RECORD=<path> when running from a git worktree (where the
// worktree's own copy of this file may be stale or from an unrelated deploy).
const DEPLOYMENT_RECORD =
  process.env.DEPLOYMENT_RECORD ||
  path.resolve(__dirname, "../../fum/deployments/42161-latest.json");

// Maps deployment-record name → fully-qualified Solidity name + constructor arg builder.
// FQN is required because hardhat-verify needs to know which contracts/*.sol file
// to use (validators live in contracts/validators/, core contracts at root).
const VERIFY_PLAN = {
  VaultFactory: {
    fqn: "contracts/VaultFactory.sol:VaultFactory",
    buildArgs: (record) => [record.deployer, PERMIT2_ADDRESS]
  },
  BabyStepsStrategy: {
    fqn: "contracts/BabyStepsStrategy.sol:BabyStepsStrategy",
    buildArgs: () => []
  },
  UniversalRouterValidator: {
    fqn: "contracts/validators/UniversalRouterValidator.sol:UniversalRouterValidator",
    buildArgs: () => []
  },
  UniswapV3PositionValidator: {
    fqn: "contracts/validators/UniswapV3PositionValidator.sol:UniswapV3PositionValidator",
    buildArgs: () => []
  },
  UniswapV4PositionValidator: {
    fqn: "contracts/validators/UniswapV4PositionValidator.sol:UniswapV4PositionValidator",
    buildArgs: () => []
  }
};

async function main() {
  const record = JSON.parse(fs.readFileSync(DEPLOYMENT_RECORD, "utf8"));
  console.log(`Verifying ${record.network.name} (chainId ${record.network.chainId})`);
  console.log(`Deployer: ${record.deployer}`);
  console.log(`Deployment timestamp: ${record.timestamp}\n`);

  const results = { verified: [], alreadyVerified: [], failed: [] };

  for (const [name, address] of Object.entries(record.contracts)) {
    const plan = VERIFY_PLAN[name];
    if (!plan) {
      console.log(`Skipping ${name} — no plan entry`);
      continue;
    }

    const constructorArguments = plan.buildArgs(record);
    console.log(`\nVerifying ${name} at ${address}`);
    console.log(`  FQN:  ${plan.fqn}`);
    console.log(`  Args: ${JSON.stringify(constructorArguments)}`);

    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments,
        contract: plan.fqn
      });
      console.log(`  ✅ Verified`);
      results.verified.push(name);
    } catch (err) {
      const msg = err.message || String(err);
      if (/already verified/i.test(msg)) {
        console.log(`  ℹ️  Already verified`);
        results.alreadyVerified.push(name);
      } else {
        console.error(`  ❌ Failed: ${msg}`);
        results.failed.push({ name, error: msg });
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Verified:          ${results.verified.join(", ") || "(none)"}`);
  console.log(`Already verified:  ${results.alreadyVerified.join(", ") || "(none)"}`);
  console.log(`Failed:            ${results.failed.map(f => f.name).join(", ") || "(none)"}`);

  if (results.failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
