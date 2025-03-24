// scripts/extract-bytecode.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the test project directory path - properly resolving the relative path
const TEST_PROJECT_DIR = process.argv[2] ||
  path.resolve(__dirname, '../../fum_testing');

const OUTPUT_DIR = path.join(__dirname, '../bytecode');

// Contracts to extract
const CONTRACTS_TO_EXTRACT = [
  'VaultFactory',
  'PositionVault',
  'MockPositionNFT',
  'MockERC20',
  'BatchExecutor'
];

// Debug logging
console.log(`Script directory: ${__dirname}`);
console.log(`Test project directory: ${TEST_PROJECT_DIR}`);

// Check if path exists
if (!fs.existsSync(TEST_PROJECT_DIR)) {
  console.error(`Error: Test project directory not found at ${TEST_PROJECT_DIR}`);
  process.exit(1);
}

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Process each contract
let successCount = 0;
let errorCount = 0;

for (const contractName of CONTRACTS_TO_EXTRACT) {
  const CONTRACT_PATH = path.join(TEST_PROJECT_DIR, 'artifacts/contracts',
                                `${contractName}.sol`, `${contractName}.json`);

  console.log(`\nExtracting bytecode from: ${CONTRACT_PATH}`);

  // Check if the specific contract file exists
  if (!fs.existsSync(CONTRACT_PATH)) {
    console.error(`Error: Contract artifact not found at ${CONTRACT_PATH}`);
    errorCount++;
    continue;
  }

  try {
    // Read the artifact
    const artifact = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));

    // Extract bytecode (without 0x prefix)
    const bytecode = artifact.bytecode.startsWith('0x')
      ? artifact.bytecode.substring(2)
      : artifact.bytecode;

    // Save bytecode to file
    const outputPath = path.join(OUTPUT_DIR, `${contractName}.bin`);
    fs.writeFileSync(outputPath, bytecode);

    console.log(`Bytecode extracted to: ${outputPath}`);
    console.log(`Bytecode size: ${bytecode.length / 2} bytes`);
    successCount++;

  } catch (error) {
    console.error(`Error extracting bytecode for ${contractName}: ${error.message}`);
    errorCount++;
  }
}

console.log(`\nExtraction summary:`);
console.log(`- Successfully extracted: ${successCount} contracts`);
console.log(`- Failed to extract: ${errorCount} contracts`);

if (errorCount > 0) {
  process.exit(1);
}
