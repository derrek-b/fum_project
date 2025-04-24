const fs = require('fs');
const path = require('path');
const solc = require('solc');

// Fixed path to the library (sibling directory)
const LIBRARY_PATH = path.resolve(__dirname, '../../fum_library');

// Directory where the contracts are located
const contractsDir = path.resolve(__dirname, '../contracts');

// Define contract mapping to handle special naming cases
const contractMapping = {
  'ParrisIslandStrategy.sol': 'parris',
  'BabyStepsStrategy.sol': 'bob',
  'PositionVault.sol': 'PositionVault',
  'VaultFactory.sol': 'VaultFactory'
};

// List of contracts to extract ABIs from
const contractFiles = Object.keys(contractMapping);

// Read the source code of the contracts
const sources = {};
contractFiles.forEach(file => {
  const filePath = path.join(contractsDir, file);
  sources[file] = { content: fs.readFileSync(filePath, 'utf8') };
});

// Prepare the input for solc
const input = {
  language: 'Solidity',
  sources: sources,
  settings: {
    outputSelection: {
      '*': {
        '*': ['abi']
      }
    }
  }
};

// Function to handle imports (e.g., OpenZeppelin contracts)
function findImports(importPath) {
  try {
    if (importPath.startsWith('@openzeppelin/')) {
      const fullPath = path.resolve(__dirname, '../node_modules', importPath);
      return { contents: fs.readFileSync(fullPath, 'utf8') };
    } else {
      const fullPath = path.resolve(contractsDir, importPath);
      return { contents: fs.readFileSync(fullPath, 'utf8') };
    }
  } catch (err) {
    return { error: 'File not found' };
  }
}

// Function to update the library's contracts.js files in both src and dist
function updateLibraryContracts(contractsAbi) {
  try {
    // Define paths for both src and dist versions
    const srcContractsPath = path.join(LIBRARY_PATH, 'src/artifacts/contracts.js');
    const distContractsPath = path.join(LIBRARY_PATH, 'dist/artifacts/contracts.js');

    // First check if the src file exists and read it to preserve addresses
    let existingContracts = {};
    if (fs.existsSync(srcContractsPath)) {
      // Extract the existing contracts object with addresses
      const fileContent = fs.readFileSync(srcContractsPath, 'utf8');
      const contractsMatch = fileContent.match(/const contracts = ([\s\S]*?);[\s\S]*export default contracts/);

      if (contractsMatch && contractsMatch[1]) {
        try {
          // Parse the contracts object, preserving existing addresses
          existingContracts = eval(`(${contractsMatch[1]})`);
        } catch (e) {
          console.warn(`Couldn't parse existing contracts, will create new file: ${e.message}`);
        }
      }
    }

    // Merge new ABIs with existing addresses
    const mergedContracts = {};

    // Process each contract
    Object.keys(contractsAbi).forEach(contractName => {
      mergedContracts[contractName] = {
        abi: contractsAbi[contractName].abi,
        addresses: existingContracts[contractName]?.addresses || {}
      };
    });

    // Create the contract content
    const contractsContent = `// artifacts/contracts.js
      /**
       * Contract ABIs and addresses for the F.U.M. project
       * This file is auto-generated and should not be edited directly
       */

      // Contract ABIs and addresses
      const contracts = ${JSON.stringify(mergedContracts, null, 2)};

      export default contracts;`;

    // Update the src version
    const srcArtifactsDir = path.dirname(srcContractsPath);
    if (!fs.existsSync(srcArtifactsDir)) {
      fs.mkdirSync(srcArtifactsDir, { recursive: true });
    }
    fs.writeFileSync(srcContractsPath, contractsContent);
    console.log(`Library's src/artifacts/contracts.js updated at ${srcContractsPath}`);

    // Update the dist version
    const distArtifactsDir = path.dirname(distContractsPath);
    if (!fs.existsSync(distArtifactsDir)) {
      fs.mkdirSync(distArtifactsDir, { recursive: true });
    }
    fs.writeFileSync(distContractsPath, contractsContent);
    console.log(`Library's dist/artifacts/contracts.js updated at ${distContractsPath}`);

    return true;
  } catch (error) {
    console.warn(`Could not update library contracts: ${error.message}`);
    console.warn(`Ensure that the library exists at ${LIBRARY_PATH}`);
    return false;
  }
}

// Compile the contracts
console.log('Compiling contracts to extract ABIs...');
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

// Check for compilation errors
if (output.errors) {
  output.errors.forEach(err => console.error(err.formattedMessage));
  process.exit(1);
}

// Extract ABIs from the compilation output
const contractsAbi = {};
contractFiles.forEach(file => {
  const originalContractName = path.basename(file, '.sol');
  const mappedContractName = contractMapping[file];

  const contractOutput = output.contracts[file][originalContractName];
  if (contractOutput) {
    contractsAbi[mappedContractName] = { abi: contractOutput.abi };
  } else {
    console.error(`Contract ${originalContractName} not found in compilation output`);
    process.exit(1);
  }
});

// Ensure the output directory exists
const outputDir = path.resolve(__dirname, '../src/abis');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Write the ABIs to contracts.json
const contractsJsonPath = path.join(outputDir, 'contracts.json');
const contractsJson = JSON.stringify(contractsAbi, null, 2);
fs.writeFileSync(contractsJsonPath, contractsJson);
console.log(`contracts.json generated successfully at ${contractsJsonPath}`);

// Update the library's contracts.js file
updateLibraryContracts(contractsAbi);
