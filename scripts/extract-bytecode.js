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

// Contract to extract
const CONTRACT_NAME = 'VaultFactory';
const CONTRACT_PATH = path.join(TEST_PROJECT_DIR, 'artifacts/contracts',
                              `${CONTRACT_NAME}.sol`, `${CONTRACT_NAME}.json`);

console.log(`Extracting bytecode from: ${CONTRACT_PATH}`);

// Check if the specific contract file exists
if (!fs.existsSync(CONTRACT_PATH)) {
  console.error(`Error: Contract artifact not found at ${CONTRACT_PATH}`);
  console.error(`Check the following:`);
  console.error(`1. Did the compilation succeed?`);
  console.error(`2. Is the contract name correct? (Looking for ${CONTRACT_NAME}.sol)`);
  console.error(`3. Is the path structure correct?`);

  // Let's check intermediate directories to help debug
  const artifactsDir = path.join(TEST_PROJECT_DIR, 'artifacts');
  const contractsDir = path.join(artifactsDir, 'contracts');
  const solDir = path.join(contractsDir, `${CONTRACT_NAME}.sol`);

  console.log(`Artifacts directory exists: ${fs.existsSync(artifactsDir)}`);
  console.log(`Contracts directory exists: ${fs.existsSync(contractsDir)}`);
  console.log(`${CONTRACT_NAME}.sol directory exists: ${fs.existsSync(solDir)}`);

  if (fs.existsSync(solDir)) {
    console.log(`Contents of ${solDir}:`);
    fs.readdirSync(solDir).forEach(file => {
      console.log(`  - ${file}`);
    });
  }

  process.exit(1);
}

// Continue with the existing code...
try {
  // Read the artifact
  const artifact = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));

  // Extract bytecode (without 0x prefix)
  const bytecode = artifact.bytecode.startsWith('0x')
    ? artifact.bytecode.substring(2)
    : artifact.bytecode;

  // Save bytecode to file
  const outputPath = path.join(OUTPUT_DIR, `${CONTRACT_NAME}.bin`);
  fs.writeFileSync(outputPath, bytecode);

  console.log(`Bytecode extracted to: ${outputPath}`);
  console.log(`Bytecode size: ${bytecode.length / 2} bytes`);

} catch (error) {
  console.error(`Error extracting bytecode: ${error.message}`);
  process.exit(1);
}
