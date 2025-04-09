const fs = require('fs');
const path = require('path');
const solc = require('solc');

// Directory where the contracts are located
const contractsDir = path.resolve(__dirname, '../contracts');

// List of contracts to extract ABIs from
const contractFiles = ['BatchExecutor.sol', 'PositionVault.sol', 'VaultFactory.sol', 'ParrisIslandStrategy.sol'];

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
      const fullPath = path.resolve(__dirname, 'node_modules', importPath);
      return { contents: fs.readFileSync(fullPath, 'utf8') };
    } else {
      const fullPath = path.resolve(contractsDir, importPath);
      return { contents: fs.readFileSync(fullPath, 'utf8') };
    }
  } catch (err) {
    return { error: 'File not found' };
  }
}

// Compile the contracts
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

// Check for compilation errors
if (output.errors) {
  output.errors.forEach(err => console.error(err.formattedMessage));
  process.exit(1);
}

// Extract ABIs from the compilation output
const contractsAbi = {};
contractFiles.forEach(file => {
  const contractName = path.basename(file, '.sol');
  const contractOutput = output.contracts[file][contractName];
  if (contractOutput) {
    if (contractName === 'ParrisIslandStrategy') {
      contractsAbi['parris'] = { abi: contractOutput.abi };
    } else {
      contractsAbi[contractName] = { abi: contractOutput.abi };
    }
  } else {
    console.error(`Contract ${contractName} not found in compilation output`);
    process.exit(1);
  }
});

// Write the ABIs to contracts.json
const contractsJson = JSON.stringify(contractsAbi, null, 2);
fs.writeFileSync(path.resolve(__dirname, '../src/abis/contracts.json'), contractsJson);
console.log('contracts.json generated successfully');
