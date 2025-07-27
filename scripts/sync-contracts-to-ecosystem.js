/**
 * @module sync-contracts-to-ecosystem
 * @description Unified contract distribution system that handles all ABI and bytecode 
 * extraction and distribution to fum_testing, fum_automation, and fum_library projects.
 * This is the single source of truth for contract synchronization across the ecosystem.
 * @since 1.0.0
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Core contracts that get distributed to production projects
const CORE_CONTRACTS = [
  'BabyStepsStrategy',
  'ParrisIslandStrategy', 
  'VaultFactory',
  'PositionVault',
  'BatchExecutor'
];

// All contracts including mocks (for testing)
const ALL_CONTRACTS = [
  ...CORE_CONTRACTS,
  'MockERC20',
  'MockPositionNFT'
];

// Project paths
const PROJECTS = {
  fum_testing: path.resolve(__dirname, '../../fum_testing'),
  fum_automation: path.resolve(__dirname, '../../fum_automation'),
  fum_library: path.resolve(__dirname, '../../fum_library')
};

/**
 * Main contract synchronization function
 * Orchestrates the complete contract distribution workflow
 */
async function syncContractsToEcosystem() {
  console.log('🚀 Starting unified contract sync across ecosystem...\n');

  try {
    // Step 1: Sync source files to fum_testing
    console.log('📄 Step 1: Syncing source files to fum_testing...');
    execSync('./sync-contracts.sh', { cwd: __dirname + '/..' });
    console.log('✅ Source files synced to fum_testing\n');
    
    // Step 2: Compile contracts in fum_testing
    console.log('🔨 Step 2: Compiling contracts in fum_testing...');
    execSync('npx hardhat compile', { cwd: PROJECTS.fum_testing });
    console.log('✅ Contracts compiled successfully\n');
    
    // Step 3: Extract bytecode to fum/bytecode
    console.log('📦 Step 3: Extracting bytecode from compiled artifacts...');
    execSync('npm run script scripts/extract-bytecode.js', { cwd: __dirname + '/..' });
    console.log('✅ Bytecode extracted to fum/bytecode\n');
    
    // Step 4: Extract ABIs to fum_library (core contracts only)
    console.log('📋 Step 4: Extracting ABIs to fum_library...');
    execSync('npm run script scripts/extract-abis.js', { cwd: __dirname + '/..' });
    console.log('✅ Core contract ABIs extracted to fum_library\n');
    
    // Step 5: Distribute bytecode to fum_library
    console.log('🚚 Step 5: Distributing bytecode to fum_library...');
    await copyBytecodeToLibrary();
    console.log('✅ Bytecode distributed to fum_library\n');
    
    // Step 6: Distribute bytecode to fum_automation
    console.log('🚚 Step 6: Distributing bytecode to fum_automation...');
    await copyBytecodeToAutomation();
    console.log('✅ Bytecode distributed to fum_automation\n');
    
    // Step 7: Update fum_testing ABIs (all contracts including mocks)
    console.log('📝 Step 7: Updating fum_testing ABIs...');
    await updateTestingABIs();
    console.log('✅ fum_testing ABIs updated\n');
    
    console.log('✨ Contract sync completed successfully!');
    console.log('\n📊 Distribution Summary:');
    console.log(`   • fum_testing: Source files + all ABIs (${ALL_CONTRACTS.length} contracts)`);
    console.log(`   • fum_library: Core ABIs + core bytecode (${CORE_CONTRACTS.length} contracts)`);
    console.log(`   • fum_automation: Core bytecode only (${CORE_CONTRACTS.length} contracts)`);

  } catch (error) {
    console.error('❌ Contract sync failed:', error.message);
    process.exit(1);
  }
}

/**
 * Copy core contract bytecode from fum to fum_library
 */
async function copyBytecodeToLibrary() {
  const sourceBytecodeDir = path.join(__dirname, '../bytecode');
  const destBytecodeDir = path.join(PROJECTS.fum_library, 'bytecode');
  
  // Create destination directory if it doesn't exist
  if (!fs.existsSync(destBytecodeDir)) {
    fs.mkdirSync(destBytecodeDir, { recursive: true });
  }
  
  let successCount = 0;
  for (const contract of CORE_CONTRACTS) {
    const sourceFile = path.join(sourceBytecodeDir, `${contract}.bin`);
    const destFile = path.join(destBytecodeDir, `${contract}.bin`);
    
    if (fs.existsSync(sourceFile)) {
      fs.copyFileSync(sourceFile, destFile);
      console.log(`  ✅ ${contract}.bin → fum_library`);
      successCount++;
    } else {
      console.warn(`  ⚠️ Warning: ${sourceFile} not found`);
    }
  }
  
  console.log(`  📦 Copied ${successCount}/${CORE_CONTRACTS.length} bytecode files to fum_library`);
}

/**
 * Copy core contract bytecode from fum to fum_automation
 */
async function copyBytecodeToAutomation() {
  const sourceBytecodeDir = path.join(__dirname, '../bytecode');
  const destBytecodeDir = path.join(PROJECTS.fum_automation, 'bytecode');
  
  // Create destination directory if it doesn't exist
  if (!fs.existsSync(destBytecodeDir)) {
    fs.mkdirSync(destBytecodeDir, { recursive: true });
  }
  
  let successCount = 0;
  for (const contract of CORE_CONTRACTS) {
    const sourceFile = path.join(sourceBytecodeDir, `${contract}.bin`);
    const destFile = path.join(destBytecodeDir, `${contract}.bin`);
    
    if (fs.existsSync(sourceFile)) {
      fs.copyFileSync(sourceFile, destFile);
      console.log(`  ✅ ${contract}.bin → fum_automation`);
      successCount++;
    } else {
      console.warn(`  ⚠️ Warning: ${sourceFile} not found`);
    }
  }
  
  console.log(`  📦 Copied ${successCount}/${CORE_CONTRACTS.length} bytecode files to fum_automation`);
}

/**
 * Update fum_testing ABIs by extracting from compiled artifacts
 * Creates/updates src/abis/contracts.json with all contracts including mocks
 */
async function updateTestingABIs() {
  const artifactsDir = path.join(PROJECTS.fum_testing, 'artifacts/contracts');
  const abisOutputFile = path.join(PROJECTS.fum_testing, 'src/abis/contracts.json');
  
  // Ensure output directory exists
  const abisDir = path.dirname(abisOutputFile);
  if (!fs.existsSync(abisDir)) {
    fs.mkdirSync(abisDir, { recursive: true });
  }
  
  const contractsAbi = {};
  let successCount = 0;
  
  for (const contractName of ALL_CONTRACTS) {
    const artifactPath = path.join(artifactsDir, `${contractName}.sol`, `${contractName}.json`);
    
    if (fs.existsSync(artifactPath)) {
      try {
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        contractsAbi[contractName] = {
          abi: artifact.abi
        };
        console.log(`  ✅ Extracted ABI for ${contractName}`);
        successCount++;
      } catch (error) {
        console.warn(`  ⚠️ Warning: Failed to parse artifact for ${contractName}: ${error.message}`);
      }
    } else {
      console.warn(`  ⚠️ Warning: Artifact not found for ${contractName} at ${artifactPath}`);
    }
  }
  
  // Write the contracts.json file
  const contractsJson = JSON.stringify(contractsAbi, null, 2);
  fs.writeFileSync(abisOutputFile, contractsJson);
  
  console.log(`  📝 Updated ${abisOutputFile} with ${successCount}/${ALL_CONTRACTS.length} contract ABIs`);
}

/**
 * Validation function to check if all required directories exist
 */
function validateProjectStructure() {
  const missingProjects = [];
  
  for (const [projectName, projectPath] of Object.entries(PROJECTS)) {
    if (!fs.existsSync(projectPath)) {
      missingProjects.push(`${projectName} (${projectPath})`);
    }
  }
  
  if (missingProjects.length > 0) {
    console.error('❌ Missing required projects:');
    missingProjects.forEach(project => console.error(`   • ${project}`));
    process.exit(1);
  }
}

// Run the sync if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validateProjectStructure();
  syncContractsToEcosystem().catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
}

export default syncContractsToEcosystem;