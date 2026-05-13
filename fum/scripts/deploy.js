// scripts/deploy.js
// Chain-aware production deployment: deploys core contracts, validators, and
// any chain-specific extras (TJPositionProxy/Manager on Avalanche), registers
// validators on VaultFactory, updates fum_library artifacts, and saves a
// deployment record.
//
// Usage:
//   node scripts/deploy.js --network=arbitrum --env-file=.env.vercel.arbitrum
//   node scripts/deploy.js --network=avalanche --env-file=.env.vercel.avalanche
//   node scripts/deploy.js --network=localhost
//
// SECURITY: pass the deployer private key INLINE only — never put it in any
// .env file. Example:
//   ARBITRUM_DEPLOYER_PK=0x... node scripts/deploy.js --network=arbitrum --env-file=.env.vercel.arbitrum

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import { getChainConfig } from 'fum_library/helpers/chainHelpers';
import contractData from 'fum_library/artifacts/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIBRARY_PATH = path.resolve(__dirname, '../../fum_library');
const SYNC_SCRIPT = path.join(__dirname, 'sync-contracts-to-ecosystem.js');
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const DEFAULT_GAS_LIMIT = 5000000;

// ============================================================================
// CLI parsing
// ============================================================================

const args = process.argv.slice(2);
const networkArg = args.find(a => a.startsWith('--network='));
const envFileArg = args.find(a => a.startsWith('--env-file='));

const networkName = networkArg ? networkArg.split('=')[1] : 'localhost';
const envFile = envFileArg ? envFileArg.split('=')[1] : '.env.local';

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/deploy.js [options]

Options:
  --network=<name>     Network to deploy to (default: localhost)
                       Supported: localhost, arbitrum, avalanche
  --env-file=<path>    Env file to load (default: .env.local)
                       Resolved relative to fum/.
                       Production usage requires explicit --env-file=
                       since the file varies per chain.
  --help, -h           Show this help message

Always runs sync-contracts-to-ecosystem.js first, guaranteeing the bytes
shipped to chain reflect the current contract source. Closes the failure
mode behind the 2026-05-06 incident, where stale fum/bytecode/*.bin (from
04-12) was deployed weeks after the VERSION constants were added.

Required env vars (loaded from --env-file):
  ALCHEMY_API_KEY      Alchemy key for the target chain's RPC URL.
                       Prefer .env.deploy.<chain> with this var (no
                       NEXT_PUBLIC_ prefix) so the deploy key is distinct
                       from the frontend key — the frontend key is
                       domain-restricted to Vercel and would 403 here.
                       NEXT_PUBLIC_ALCHEMY_API_KEY accepted as fallback
                       only for legacy compatibility.

Required env vars (pass INLINE, never in --env-file):
  ARBITRUM_DEPLOYER_PK   Deployer private key for --network=arbitrum
  AVALANCHE_DEPLOYER_PK  Deployer private key for --network=avalanche
  PRIVATE_KEY            Fallback if {NETWORK}_DEPLOYER_PK is unset

Examples:
  ARBITRUM_DEPLOYER_PK=0x... node scripts/deploy.js \\
    --network=arbitrum --env-file=.env.deploy.arbitrum

  AVALANCHE_DEPLOYER_PK=0x... node scripts/deploy.js \\
    --network=avalanche --env-file=.env.deploy.avalanche

  node scripts/deploy.js --network=localhost
`);
  process.exit(0);
}

if (args.some(a => a.startsWith('--contract=')) || args.includes('--list')) {
  console.error('Error: --contract= and --list flags removed.');
  console.error('Selective deploys produce broken state (validators not registered).');
  console.error('Each chain deploys its full plan — see DEPLOYMENT_PLANS in scripts/deploy.js.');
  process.exit(1);
}

// Load env file (relative to fum/)
const envPath = path.resolve(__dirname, '..', envFile);
const envResult = dotenv.config({ path: envPath });
if (envResult.error && envFile !== '.env.local') {
  // Only warn for explicit --env-file; default .env.local is allowed to be missing
  console.error(`Failed to load env file at ${envPath}: ${envResult.error.message}`);
  process.exit(1);
}

// ============================================================================
// Deployment plans (per chain)
// ============================================================================

const DEPLOYMENT_PLANS = {
  // Arbitrum One
  42161: {
    coreContracts: [
      { name: 'VaultFactory', getConstructorArgs: (deployer) => [deployer, PERMIT2_ADDRESS] },
      { name: 'BabyStepsStrategy' },
    ],
    extraContracts: [],
    validators: [
      {
        name: 'UniversalRouterValidator',
        registerVia: 'setSwapValidator',
        getTargetAddress: (cfg) => cfg.platformAddresses.uniswapV3.universalRouterAddress,
        targetLabel: 'UniversalRouter',
      },
      {
        name: 'UniswapV3PositionValidator',
        registerVia: 'setLiquidityValidator',
        getTargetAddress: (cfg) => cfg.platformAddresses.uniswapV3.positionManagerAddress,
        targetLabel: 'V3 PositionManager',
      },
      {
        name: 'UniswapV4PositionValidator',
        registerVia: 'setLiquidityValidator',
        getTargetAddress: (cfg) => cfg.platformAddresses.uniswapV4.positionManagerAddress,
        targetLabel: 'V4 PositionManager',
      },
    ],
    postDeployHooks: [],
  },

  // Avalanche C-Chain
  43114: {
    coreContracts: [
      { name: 'VaultFactory', getConstructorArgs: (deployer) => [deployer, PERMIT2_ADDRESS] },
      { name: 'BabyStepsStrategy' },
    ],
    extraContracts: [
      { name: 'TJPositionProxy' },
      {
        name: 'TJPositionManager',
        getConstructorArgs: (deployer, deployed, cfg) => [
          cfg.platformAddresses.traderjoeV2_2.lbRouterAddress,
          deployed.TJPositionProxy,
        ],
      },
    ],
    validators: [
      {
        name: 'TJPositionValidator',
        registerVia: 'setLiquidityValidator',
        getTargetAddress: (cfg, deployed) => deployed.TJPositionManager,
        targetLabel: 'TJPositionManager',
      },
      {
        name: 'TJSwapValidator',
        registerVia: 'setSwapValidator',
        getTargetAddress: (cfg) => cfg.platformAddresses.traderjoeV2_2.lbRouterAddress,
        targetLabel: 'LBRouter',
      },
    ],
    postDeployHooks: [
      // TJ adapter reads positionManagerAddress from chains.js at runtime,
      // so the freshly deployed TJPositionManager address must be written back.
      // Mirrors start-hardhat-avalanche.js:275.
      {
        kind: 'updateChainsConfig',
        platform: 'traderjoeV2_2',
        property: 'positionManagerAddress',
        sourceContract: 'TJPositionManager',
      },
    ],
  },
};

// Localhost (1337) reuses the Arbitrum plan (Arbitrum mainnet fork).
DEPLOYMENT_PLANS[1337] = DEPLOYMENT_PLANS[42161];
// Localhost-AV (1338) reuses the Avalanche plan.
DEPLOYMENT_PLANS[1338] = DEPLOYMENT_PLANS[43114];

// ============================================================================
// Helpers
// ============================================================================

function getChainId(name) {
  const map = {
    localhost: 1337,
    'localhost-av': 1338,
    arbitrum: 42161,
    avalanche: 43114,
  };
  return map[name] || parseInt(name, 10);
}

function buildRpcUrl(chainConfig, chainId) {
  let rpcUrl = chainConfig.rpcUrls[0];
  // Production chains need an Alchemy key appended. Accept both the backend
  // convention (ALCHEMY_API_KEY) and the Next.js frontend convention
  // (NEXT_PUBLIC_ALCHEMY_API_KEY) so the same env file (e.g.
  // .env.vercel.arbitrum) can serve both deploy and Vercel-frontend uses.
  if (chainId === 42161 || chainId === 43114) {
    const apiKey = process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    if (!apiKey) {
      throw new Error('ALCHEMY_API_KEY or NEXT_PUBLIC_ALCHEMY_API_KEY required for production deployment (set in --env-file)');
    }
    rpcUrl = `${rpcUrl}/${apiKey}`;
  }
  return rpcUrl;
}

// SECURITY: this reads the deployer PK from an env var. The PK MUST be
// passed inline at the command (e.g. ARBITRUM_DEPLOYER_PK=0x... node ...)
// and never committed to any .env file.
function getPrivateKey(chainId, networkName) {
  if (chainId === 1337 || chainId === 1338) {
    // Hardhat default account #0 — well-known test key, safe to hardcode
    return '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  }
  const envVarName = `${networkName.toUpperCase()}_DEPLOYER_PK`;
  const pk = process.env[envVarName] || process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      `No private key found for ${networkName}. ` +
      `Pass ${envVarName} INLINE (do not store in --env-file): ` +
      `${envVarName}=0x... node scripts/deploy.js --network=${networkName}`
    );
  }
  return pk;
}

function readBytecode(name) {
  const bytecodePath = path.join(__dirname, `../bytecode/${name}.bin`);
  if (!fs.existsSync(bytecodePath)) {
    throw new Error(`Bytecode file not found at ${bytecodePath}. Run extract-bytecode first.`);
  }
  return '0x' + fs.readFileSync(bytecodePath, 'utf8').trim();
}

// Runs the canonical sync pipeline (source sync → compile → extract bytecode
// → extract ABIs → distribute to ecosystem) so deploy never ships stale .bin.
// The 2026-05-06 incident: someone edited fum/contracts/ on 04-20 (added
// VERSION constants), never ran `npm run contracts:sync`, then deployed on
// 05-06 from .bin files extracted 04-12 — shipping pre-VERSION bytecode.
function syncBeforeDeploy() {
  console.log('Running sync-contracts-to-ecosystem.js to guarantee fresh bytecode...\n');
  execSync(`node ${SYNC_SCRIPT}`, { stdio: 'inherit' });
  console.log('');
}

// Maps deployment name to the key used in fum_library/artifacts/contracts.js.
// BabyStepsStrategy is keyed as "bob" historically; everything else uses its
// own name. Keep this here (not in the plan map) so the plan stays declarative.
function libraryKeyFor(deploymentName) {
  return deploymentName === 'BabyStepsStrategy' ? 'bob' : deploymentName;
}

function getAbi(contractsData, deploymentName) {
  const key = libraryKeyFor(deploymentName);
  const abi = contractsData[key]?.abi;
  if (!abi || abi.length === 0) {
    throw new Error(`ABI not found in fum_library artifacts for ${deploymentName} (key: ${key})`);
  }
  return abi;
}

async function deployOne(name, abi, bytecode, wallet, constructorArgs = []) {
  console.log(`\nDeploying ${name}...`);
  if (constructorArgs.length > 0) {
    console.log(`  Constructor args: ${JSON.stringify(constructorArgs)}`);
  }
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(...constructorArgs, { gasLimit: DEFAULT_GAS_LIMIT });
  console.log(`  Tx hash: ${contract.deployTransaction.hash}`);
  await contract.deployed();
  console.log(`  ${name} deployed to: ${contract.address}`);
  return contract.address;
}

async function registerValidators(factoryContract, validators, deployed, chainConfig) {
  if (validators.length === 0) return;
  console.log('\nRegistering validators on VaultFactory...');
  for (const v of validators) {
    const validatorAddress = deployed[v.name];
    if (!validatorAddress) {
      throw new Error(`Cannot register ${v.name} — not in deployed map`);
    }
    const targetAddress = v.getTargetAddress(chainConfig, deployed);
    if (!targetAddress) {
      throw new Error(`Cannot register ${v.name} — target address (${v.targetLabel}) is missing from chain config`);
    }
    const tx = await factoryContract[v.registerVia](targetAddress, validatorAddress);
    await tx.wait();
    console.log(`  Registered ${v.name} via ${v.registerVia}(${v.targetLabel}=${targetAddress})`);
  }
}

// Inline rewrite of chains.js to pin a freshly-deployed address onto the
// runtime chain config. Used by the Avalanche post-deploy hook so the TJ
// adapter can find TJPositionManager at runtime. Mirrors the same helper
// in start-hardhat-avalanche.js:60.
function updateChainsConfig(chainId, platformId, key, value) {
  const files = [
    path.join(LIBRARY_PATH, 'src/configs/chains.js'),
    path.join(LIBRARY_PATH, 'dist/configs/chains.js'),
  ];
  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    let content = fs.readFileSync(filePath, 'utf8');
    const pattern = new RegExp(
      `(${chainId}:\\s*\\{[\\s\\S]*?${platformId}:\\s*\\{[\\s\\S]*?${key}:\\s*)"[^"]*"`
    );
    if (pattern.test(content)) {
      content = content.replace(pattern, `$1"${value}"`);
      fs.writeFileSync(filePath, content);
      console.log(`  Updated ${platformId}.${key} for chain ${chainId} in ${path.basename(filePath)}: ${value}`);
    }
  }
}

function runPostDeployHooks(plan, deployed, chainId) {
  if (plan.postDeployHooks.length === 0) return;
  console.log('\nRunning post-deploy hooks...');
  for (const hook of plan.postDeployHooks) {
    if (hook.kind === 'updateChainsConfig') {
      const value = deployed[hook.sourceContract];
      if (!value) {
        throw new Error(`Post-deploy hook needs ${hook.sourceContract} address but it's not deployed`);
      }
      updateChainsConfig(chainId, hook.platform, hook.property, value);
    } else {
      throw new Error(`Unknown post-deploy hook kind: ${hook.kind}`);
    }
  }
}

function updateLibraryAddresses(deployed, chainId) {
  console.log('\nUpdating fum_library artifacts...');
  const srcPath = path.join(LIBRARY_PATH, 'src/artifacts/contracts.js');
  const distPath = path.join(LIBRARY_PATH, 'dist/artifacts/contracts.js');

  if (!fs.existsSync(srcPath)) {
    console.warn(`  fum_library contracts.js not found at ${srcPath} — skipping`);
    return;
  }

  const fileContent = fs.readFileSync(srcPath, 'utf8');
  const match = fileContent.match(/const contracts = ([\s\S]*?);[\s\S]*export default contracts/);
  if (!match) {
    throw new Error('Could not parse fum_library/src/artifacts/contracts.js');
  }
  const existing = eval(`(${match[1]})`); // eslint-disable-line no-eval

  for (const [name, address] of Object.entries(deployed)) {
    const key = libraryKeyFor(name);
    if (!existing[key]) {
      console.warn(`  ${key} not in artifacts — skipping (run extract-abis to regenerate)`);
      continue;
    }
    if (!existing[key].addresses) existing[key].addresses = {};
    existing[key].addresses[chainId.toString()] = address;
    console.log(`  ${key}.addresses[${chainId}] = ${address}`);
  }

  const out = `// artifacts/contracts.js
      /**
       * Contract ABIs and addresses for the FUM project
       * This file is auto-generated and should not be edited directly
       */

      // Contract ABIs and addresses
      const contracts = ${JSON.stringify(existing, null, 2)};

      export default contracts;`;

  fs.writeFileSync(srcPath, out);
  fs.writeFileSync(distPath, out);
  console.log(`  Wrote ${srcPath}`);
  console.log(`  Wrote ${distPath}`);
}

function saveDeploymentRecord(deployed, chainId, networkConfig, deployer, partial = false) {
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const record = {
    version: '2.0.0',
    timestamp,
    network: { name: networkConfig.name, chainId },
    contracts: deployed,
    deployer,
  };

  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const suffix = partial ? '-PARTIAL' : '';
  const recordPath = path.join(deploymentsDir, `${chainId}-${timestamp}${suffix}.json`);
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
  console.log(`\nDeployment record: ${recordPath}`);

  // Only update {chainId}-latest.json for full successful deploys; we don't
  // want a partial deploy to become "latest" and silently break consumers.
  if (!partial) {
    const latestPath = path.join(deploymentsDir, `${chainId}-latest.json`);
    fs.writeFileSync(latestPath, JSON.stringify(record, null, 2));
    console.log(`Latest pointer:    ${latestPath}`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function deploy() {
  const chainId = getChainId(networkName);
  const plan = DEPLOYMENT_PLANS[chainId];
  if (!plan) {
    throw new Error(`No deployment plan for chainId ${chainId} (network: ${networkName})`);
  }
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) {
    throw new Error(`No chain config for chainId ${chainId}`);
  }

  console.log(`Deploying to ${chainConfig.name} (chainId ${chainId})`);
  console.log(`Env file: ${envPath}`);

  syncBeforeDeploy();

  const rpcUrl = buildRpcUrl(chainConfig, chainId);
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const privateKey = getPrivateKey(chainId, networkName);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`Deployer:  ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance:   ${ethers.utils.formatEther(balance)} ${chainConfig.nativeCurrency?.symbol || 'native'}`);

  const contractsData = JSON.parse(JSON.stringify(contractData));
  const deployed = {}; // { contractName: address }

  try {
    // 1. Core contracts (VaultFactory, BabyStepsStrategy)
    for (const c of plan.coreContracts) {
      const abi = getAbi(contractsData, c.name);
      const bytecode = readBytecode(c.name);
      const args = c.getConstructorArgs ? c.getConstructorArgs(wallet.address, deployed, chainConfig) : [];
      deployed[c.name] = await deployOne(c.name, abi, bytecode, wallet, args);
    }

    // 2. Extra contracts (TJPositionProxy, TJPositionManager on Avalanche)
    for (const c of plan.extraContracts) {
      const abi = getAbi(contractsData, c.name);
      const bytecode = readBytecode(c.name);
      const args = c.getConstructorArgs ? c.getConstructorArgs(wallet.address, deployed, chainConfig) : [];
      deployed[c.name] = await deployOne(c.name, abi, bytecode, wallet, args);
    }

    // 3. Validators
    for (const v of plan.validators) {
      const abi = getAbi(contractsData, v.name);
      const bytecode = readBytecode(v.name);
      deployed[v.name] = await deployOne(v.name, abi, bytecode, wallet, []);
    }

    // 4. Register validators on VaultFactory
    const factoryContract = new ethers.Contract(
      deployed.VaultFactory,
      contractsData.VaultFactory.abi,
      wallet
    );
    await registerValidators(factoryContract, plan.validators, deployed, chainConfig);

    // 5. Post-deploy hooks (e.g., write TJPositionManager back to chains.js)
    runPostDeployHooks(plan, deployed, chainId);

    // 6. Update fum_library artifacts
    updateLibraryAddresses(deployed, chainId);

    // 7. Save deployment record (full)
    saveDeploymentRecord(deployed, chainId, chainConfig, wallet.address, false);

    console.log('\n✅ Deployment complete.');
    console.log('\nNext steps:');
    console.log('  1. cd fum_library && npm run pack');
    console.log('     (propagates new addresses to fum_automation tarball)');
    console.log('  2. Commit fum_library/{src,dist}/artifacts/contracts.js + fum/deployments/');
    console.log('  3. Push → Railway rebuilds the automation service');
  } catch (error) {
    // Save what we managed to deploy as a PARTIAL record so the user can
    // recover/investigate. Do NOT update -latest pointer or library artifacts.
    if (Object.keys(deployed).length > 0) {
      console.error('\n❌ Deployment failed mid-flight. Saving partial record.');
      console.error(`Deployed before failure: ${Object.keys(deployed).join(', ')}`);
      try {
        saveDeploymentRecord(deployed, chainId, chainConfig, wallet.address, true);
      } catch (saveErr) {
        console.error(`Failed to save partial record: ${saveErr.message}`);
      }
    }
    throw error;
  }
}

deploy().catch((error) => {
  console.error('\nDeployment failed:', error);
  process.exit(1);
});
