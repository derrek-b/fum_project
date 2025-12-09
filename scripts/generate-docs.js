#!/usr/bin/env node

/**
 * Documentation Generation Script for FUM Library
 *
 * This script automatically generates documentation by:
 * 1. Scanning all source files
 * 2. Extracting imports and exports
 * 3. Generating docs/api-reference/modules.md with module reference
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import glob from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');

// Output file for generated documentation
const MODULE_DOCS_FILE = path.join(ROOT_DIR, 'docs', 'api-reference', 'modules.md');

/**
 * Parse a JavaScript file and extract imports and exports
 */
function parseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const relativePath = path.relative(ROOT_DIR, filePath);
  
  const imports = [];
  const exports = [];
  
  // Match import statements
  const importRegex = /import\s+(?:{[^}]+}|[\w\s,]+)\s+from\s+['"]([^'"]+)['"]/g;
  const defaultImportRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  const namedImportRegex = /import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"]/g;
  
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push({
      from: match[1],
      statement: match[0]
    });
  }
  
  // Match export statements
  const namedExportRegex = /export\s+(?:const|let|var|function|class)\s+(\w+)/g;
  const defaultExportRegex = /export\s+default\s+(?:class\s+)?(\w+)/g;
  const reExportRegex = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  const namedReExportRegex = /export\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"]/g;
  const namedAsExportRegex = /export\s+{\s*([^}]+)\s*}\s+from\s+['"]([^'"]+)['"]/g;
  
  while ((match = namedExportRegex.exec(content)) !== null) {
    exports.push({
      type: 'named',
      name: match[1],
      kind: match[0].includes('function') ? 'function' : 
            match[0].includes('class') ? 'class' : 'variable'
    });
  }
  
  while ((match = defaultExportRegex.exec(content)) !== null) {
    exports.push({
      type: 'default',
      name: match[1] || 'anonymous',
      kind: match[0].includes('class') ? 'class' : 'other'
    });
  }
  
  while ((match = reExportRegex.exec(content)) !== null) {
    exports.push({
      type: 're-export',
      from: match[1]
    });
  }
  
  while ((match = namedReExportRegex.exec(content)) !== null) {
    // Parse named re-exports like { default as Name, other }
    const exportList = match[1];
    const from = match[2];
    
    // Split by comma and parse each export
    exportList.split(',').forEach(exp => {
      const cleanExp = exp.trim();
      const defaultAsMatch = cleanExp.match(/default\s+as\s+(\w+)/);
      if (defaultAsMatch) {
        exports.push({
          type: 'named',
          name: defaultAsMatch[1],
          kind: 'class',
          from: from
        });
      } else {
        exports.push({
          type: 'named',
          name: cleanExp,
          kind: 'variable',
          from: from
        });
      }
    });
  }
  
  // Extract file description from leading comment
  const descriptionMatch = content.match(/\/\*\*\s*([\s\S]*?)\s*\*\//);
  let description = '';
  if (descriptionMatch) {
    const commentContent = descriptionMatch[1]
      .replace(/^\s*\*\s?/gm, '') // Remove leading * from each line
      .trim();
    
    // Get first meaningful line (not just spaces/newlines)
    const lines = commentContent.split('\n').filter(line => line.trim());
    if (lines.length > 0) {
      description = lines[0].trim();
    }
  }
  
  return {
    path: relativePath,
    name: path.basename(filePath),
    description,
    imports,
    exports
  };
}

/**
 * Generate module documentation
 */
async function generateModuleDocs() {
  console.log('🔍 Scanning source files...');
  
  const files = glob.sync('**/*.js', {
    cwd: SRC_DIR,
    ignore: ['**/node_modules/**', '**/dist/**', '**/tests/**']
  });
  
  const modules = {};
  
  for (const file of files) {
    const filePath = path.join(SRC_DIR, file);
    const moduleInfo = parseFile(filePath);
    
    const moduleName = path.dirname(file) === '.' ? 'root' : path.dirname(file);
    
    if (!modules[moduleName]) {
      modules[moduleName] = {
        name: moduleName,
        files: []
      };
    }
    
    modules[moduleName].files.push(moduleInfo);
  }
  
  return modules;
}

/**
 * Generate markdown documentation for modules
 */
function generateMarkdown(modules) {
  let markdown = `# FUM Library Module Reference

This document provides a comprehensive reference of all modules, their files, imports, and exports.

Generated on: ${new Date().toISOString()}

## Table of Contents

`;

  // Add TOC
  Object.keys(modules).sort().forEach(moduleName => {
    const displayName = moduleName === 'root' ? 'Root Module' : `${moduleName} Module`;
    markdown += `- [${displayName}](#${moduleName.replace(/\//g, '-')}-module)\n`;
  });

  markdown += '\n---\n\n';

  // Add module details
  Object.keys(modules).sort().forEach(moduleName => {
    const module = modules[moduleName];
    const displayName = moduleName === 'root' ? 'Root' : moduleName;
    
    markdown += `## ${displayName} Module\n\n`;
    
    module.files.forEach(file => {
      markdown += `### ${file.name}\n\n`;
      
      if (file.description) {
        markdown += `${file.description}\n\n`;
      }
      
      markdown += `**Path:** \`${file.path}\`\n\n`;
      
      if (file.imports.length > 0) {
        markdown += `**Imports:**\n`;
        const importsBySource = {};
        file.imports.forEach(imp => {
          if (!importsBySource[imp.from]) {
            importsBySource[imp.from] = [];
          }
          importsBySource[imp.from].push(imp);
        });
        
        Object.keys(importsBySource).sort().forEach(source => {
          markdown += `- from \`${source}\`\n`;
        });
        markdown += '\n';
      }
      
      if (file.exports.length > 0) {
        markdown += `**Exports:**\n`;
        file.exports.forEach(exp => {
          if (exp.type === 'named') {
            const fromInfo = exp.from ? ` (from \`${exp.from}\`)` : '';
            markdown += `- \`${exp.name}\` (${exp.kind})${fromInfo}\n`;
          } else if (exp.type === 'default') {
            markdown += `- default: \`${exp.name}\` (${exp.kind})\n`;
          } else if (exp.type === 're-export') {
            markdown += `- re-exports from \`${exp.from}\`\n`;
          }
        });
        markdown += '\n';
      }
      
      markdown += '---\n\n';
    });
  });

  return markdown;
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 FUM Library Documentation Generator\n');
  
  try {
    // Generate module documentation
    const modules = await generateModuleDocs();
    
    // Create docs directory if it doesn't exist
    const docsDir = path.join(ROOT_DIR, 'docs', 'api-reference');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }
    
    // Generate and save module documentation
    const moduleMarkdown = generateMarkdown(modules);
    fs.writeFileSync(MODULE_DOCS_FILE, moduleMarkdown);
    console.log(`✅ Module documentation generated: ${path.relative(ROOT_DIR, MODULE_DOCS_FILE)}`);

    // Summary
    const totalFiles = Object.values(modules).reduce((sum, m) => sum + m.files.length, 0);
    console.log(`\n📊 Summary:`);
    console.log(`   - Modules scanned: ${Object.keys(modules).length}`);
    console.log(`   - Files processed: ${totalFiles}`);
    console.log(`\n✨ Documentation generation complete!`);
    
  } catch (error) {
    console.error('❌ Error generating documentation:', error);
    process.exit(1);
  }
}

// Run the script
main();