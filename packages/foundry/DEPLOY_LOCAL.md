# Local Deployment Instructions

## Status: Ready to Deploy ✅

All build issues have been resolved. The Foundry contracts are ready to deploy to your local Anvil instance.

## Prerequisites

- ✅ Foundry installed
- ✅ Contracts compile successfully (`forge build`)
- ✅ All 96 tests pass (`forge test`)
- ⚠️ Anvil needs to be running on port 1337

## Step 1: Start Anvil

In a separate terminal, run:

```bash
anvil --port 1337
```

This will start a local Ethereum node with 10 pre-funded accounts.

## Step 2: Deploy Contracts

Once Anvil is running, execute:

```bash
cd /Users/orb/Desktop/work/OTD/pixelportal_v3/FIX/doge-pixels-base/packages/foundry

PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
forge script script/DeployLocal.s.sol:DeployLocal \
  --rpc-url http://localhost:1337 \
  --broadcast
```

**Note:** The private key above is the default Anvil account #0 (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)

## What Gets Deployed

The deployment script will:

1. Deploy MockDOG20 token (for testing)
2. Deploy PX implementation contract
3. Deploy ERC1967Proxy (upgradeable proxy)
4. Configure token lock amount (55,240 DOG per pixel)
5. Unpause the contract
6. Mint 100 pixels worth of DOG to deployer
7. Approve PX to spend DOG tokens

## Expected Output

You should see output like:

```
=== DEPLOYING PX LOCALLY ===
Deployer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Chain ID: 1337

1. Deploying MockDOG20...
   DOG20 deployed at: 0x...

2. Deploying PX implementation...
   Implementation deployed at: 0x...

3. Preparing proxy initialization...

4. Deploying ERC1967Proxy...
   Proxy deployed at: 0x...

...

=== DEPLOYMENT SUMMARY ===
DOG20 Token: 0x...
PX Implementation: 0x...
PX Proxy (Main Contract): 0x...
Owner/Deployer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Lock Amount per Pixel: 55239898990000000000000

=== READY TO USE ===
Contract addresses for frontend/server:
  PX_CONTRACT_ADDRESS= 0x...
  DOG20_CONTRACT_ADDRESS= 0x...
```

## Step 3: Save Contract Addresses

Copy the contract addresses from the output. You'll need:
- `PX_CONTRACT_ADDRESS` (the Proxy address)
- `DOG20_CONTRACT_ADDRESS`

These will be used to generate the `hardhat_contracts.json` file for frontend/server integration.

## Next Steps

After successful deployment:
1. Extract ABIs from `out/` directory
2. Generate `hardhat_contracts.json` with new addresses
3. Update frontend/server to use new contracts

## Troubleshooting

**Connection refused on port 1337:**
- Make sure Anvil is running: `anvil --port 1337`
- Check that no other process is using port 1337

**Deployment fails:**
- Check Anvil logs for errors
- Verify the private key is correct
- Try restarting Anvil

**Tests fail:**
- Run `forge test -vvv` for verbose output
- All tests should pass before deploying

