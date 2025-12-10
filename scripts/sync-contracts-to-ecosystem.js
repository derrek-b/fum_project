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

// Production contracts that get synced to fum_testing and distributed
// Mocks and tests now live permanently in fum_testing
const CORE_CONTRACTS = [
  'BabyStepsStrategy',
  'VaultFactory',
  'PositionVault'
];

// Additional contracts synced to fum_testing with --sync-only flag (for testing but not distributed)
const TESTING_ONLY_CONTRACTS = [
  'ParrisIslandStrategy'
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
    await syncSourceFilesToTesting();
    console.log('✅ Source files synced to fum_testing\n');
    
    // Step 2: Compile contracts in fum_testing
    console.log('🔨 Step 2: Compiling contracts in fum_testing...');
    execSync('npx hardhat compile', { cwd: PROJECTS.fum_testing });
    console.log('✅ Contracts compiled successfully\n');
    
    // Step 3: Extract bytecode to fum/bytecode
    console.log('📦 Step 3: Extracting bytecode from compiled artifacts...');
    execSync('node scripts/extract-bytecode.js', { cwd: __dirname + '/..' });
    console.log('✅ Bytecode extracted to fum/bytecode\n');

    // Step 4: Extract ABIs to fum_library (core contracts only)
    console.log('📋 Step 4: Extracting ABIs to fum_library...');
    execSync('node scripts/extract-abis.js', { cwd: __dirname + '/..' });
    console.log('✅ Core contract ABIs extracted to fum_library\n');
    
    // Step 5: Distribute bytecode to fum_library
    console.log('🚚 Step 5: Distributing bytecode to fum_library...');
    await copyBytecodeToLibrary();
    console.log('✅ Bytecode distributed to fum_library\n');
    
    // Step 6: Distribute bytecode to fum_automation
    console.log('🚚 Step 6: Distributing bytecode to fum_automation...');
    await copyBytecodeToAutomation();
    console.log('✅ Bytecode distributed to fum_automation\n');

    console.log('✨ Contract sync completed successfully!');
    console.log('\n📊 Distribution Summary:');
    console.log(`   • fum_testing: Production contracts synced (${CORE_CONTRACTS.length} contracts)`);
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
 * Recursively find all files matching a pattern in a directory
 */
function findFiles(dir, extension) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...findFiles(fullPath, extension));
    } else if (item.name.endsWith(extension)) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Sync production contracts from fum to fum_testing
 * Only syncs CORE_CONTRACTS - mocks and tests live permanently in fum_testing
 */
async function syncSourceFilesToTesting() {
  const sourceDir = path.resolve(__dirname, '..');
  const targetDir = PROJECTS.fum_testing;

  // Ensure target directory exists
  const contractsTargetDir = path.join(targetDir, 'contracts');
  if (!fs.existsSync(contractsTargetDir)) {
    fs.mkdirSync(contractsTargetDir, { recursive: true });
  }

  // Copy production contracts (CORE_CONTRACTS) and testing-only contracts (TESTING_ONLY_CONTRACTS)
  const allContractsToSync = [...CORE_CONTRACTS, ...TESTING_ONLY_CONTRACTS];
  console.log('  Copying contracts...');
  let contractCount = 0;

  for (const contractName of allContractsToSync) {
    const sourceFile = path.join(sourceDir, 'contracts', `${contractName}.sol`);
    const targetFile = path.join(contractsTargetDir, `${contractName}.sol`);

    if (fs.existsSync(sourceFile)) {
      fs.copyFileSync(sourceFile, targetFile);
      console.log(`  ✅ ${contractName}.sol`);
      contractCount++;
    } else {
      console.warn(`  ⚠️ Warning: ${sourceFile} not found`);
    }
  }
  console.log(`  📦 Synced ${contractCount}/${allContractsToSync.length} contracts (${CORE_CONTRACTS.length} production + ${TESTING_ONLY_CONTRACTS.length} testing-only)`);
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

  // Check for --sync-only flag (just sync source files, skip compile/distribute)
  const syncOnly = process.argv.includes('--sync-only');

  if (syncOnly) {
    console.log('🚀 Running source sync only (--sync-only flag detected)...\n');
    syncSourceFilesToTesting()
      .then(() => console.log('\n✨ Source sync completed!'))
      .catch(error => {
        console.error('💥 Unexpected error:', error);
        process.exit(1);
      });
  } else {
    syncContractsToEcosystem().catch(error => {
      console.error('💥 Unexpected error:', error);
      process.exit(1);
    });
  }
}

export default syncContractsToEcosystem;