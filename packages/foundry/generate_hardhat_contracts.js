#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Generate hardhat_contracts.json from Foundry deployment
 * 
 * This script reads ABIs from Foundry's out/ directory and creates
 * a hardhat_contracts.json file compatible with the frontend/server.
 */

// Deployed contract addresses (from Anvil deployment)
const DOG20_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const PX_ADDRESS = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const CHAIN_ID = '1337';
const NETWORK_NAME = 'anvil-local';

// Paths
const OUT_DIR = path.join(__dirname, 'out');
const PX_ABI_PATH = path.join(OUT_DIR, 'PX.sol', 'PX.json');
const DOG20_ABI_PATH = path.join(OUT_DIR, 'MockDOG20.sol', 'MockDOG20.json');
const OUTPUT_PATH = path.join(__dirname, '../hardhat/hardhat_contracts.json');

console.log('🔨 Generating hardhat_contracts.json from Foundry artifacts...\n');

// Read and parse ABI files
console.log('📖 Reading Foundry artifacts...');
const pxArtifact = JSON.parse(fs.readFileSync(PX_ABI_PATH, 'utf8'));
const dog20Artifact = JSON.parse(fs.readFileSync(DOG20_ABI_PATH, 'utf8'));

console.log('  ✅ PX artifact loaded');
console.log('  ✅ MockDOG20 artifact loaded\n');

// Extract ABIs
const pxAbi = pxArtifact.abi;
const dog20Abi = dog20Artifact.abi;

console.log(`📊 ABI Stats:`);
console.log(`  PX: ${pxAbi.length} entries`);
console.log(`  DOG20: ${dog20Abi.length} entries\n`);

// Create hardhat_contracts.json structure
const hardhatContracts = {
  [CHAIN_ID]: {
    [NETWORK_NAME]: {
      name: NETWORK_NAME,
      chainId: CHAIN_ID,
      contracts: {
        PX: {
          address: PX_ADDRESS,
          abi: pxAbi
        },
        DOG20: {
          address: DOG20_ADDRESS,
          abi: dog20Abi
        }
      }
    }
  }
};

// Ensure output directory exists
const outputDir = path.dirname(OUTPUT_PATH);
if (!fs.existsSync(outputDir)) {
  console.log(`📂 Creating directory: ${outputDir}`);
  fs.mkdirSync(outputDir, { recursive: true });
}

// Write output file
console.log(`💾 Writing to: ${OUTPUT_PATH}`);
fs.writeFileSync(
  OUTPUT_PATH,
  JSON.stringify(hardhatContracts, null, 2),
  'utf8'
);

console.log('\n✅ Success! Generated hardhat_contracts.json\n');
console.log('📋 Summary:');
console.log(`  Chain ID: ${CHAIN_ID}`);
console.log(`  Network: ${NETWORK_NAME}`);
console.log(`  PX Address: ${PX_ADDRESS}`);
console.log(`  DOG20 Address: ${DOG20_ADDRESS}`);
console.log(`  Output: ${OUTPUT_PATH}\n`);
console.log('🎯 Next steps:');
console.log('  1. Run: cd ../react-app && yarn create-contracts');
console.log('  2. Run: cd ../server && yarn compile_contracts');
console.log('  3. Update frontend/server RPC to http://localhost:8545');
console.log('  4. Update environment variables with new addresses\n');

