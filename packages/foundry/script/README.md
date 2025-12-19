# PX Token Deployment Scripts

This directory contains deployment scripts for the PX token using CREATE2 for deterministic addresses.

## Overview

- **DeployPXWithAdmin.s.sol**: Enhanced deployment script using ProxyAdmin pattern for better upgrade management
- **DeployConfig.sol**: Network configuration library for different chains

## Supported Networks

| Network | Chain ID | Status |
|---------|----------|--------|
| Ethereum Mainnet | 1 | ✅ Supported |
| Ethereum Sepolia | 11155111 | ✅ Supported |
| Base Mainnet | 8453 | ✅ Supported |
| Base Sepolia | 84532 | ✅ Supported |
| Foundry Local | 31337 | ✅ Supported |

## Prerequisites

1. Set up your private key:
   ```bash
   export PRIVATE_KEY=0x...
   ```

2. Set up RPC URLs in foundry.toml or as environment variables:
   ```bash
   export ETH_RPC_URL=https://...
   export BASE_RPC_URL=https://...
   export SEPOLIA_RPC_URL=https://...
   export BASE_SEPOLIA_RPC_URL=https://...
   ```

## Usage

### Preview Deployment

Preview the deployment addresses without actually deploying:

```bash
# Ethereum Mainnet
forge script script/DeployPXWithAdmin.s.sol:DeployPXWithAdmin --sig "previewDeployment()" --rpc-url $ETH_RPC_URL

# Ethereum Sepolia
forge script script/DeployPXWithAdmin.s.sol:DeployPXWithAdmin --sig "previewDeployment()" --rpc-url $SEPOLIA_RPC_URL

# Base Mainnet
forge script script/DeployPXWithAdmin.s.sol:DeployPXWithAdmin --sig "previewDeployment()" --rpc-url $BASE_RPC_URL

# Base Sepolia
forge script script/DeployPXWithAdmin.s.sol:DeployPXWithAdmin --sig "previewDeployment()" --rpc-url $BASE_SEPOLIA_RPC_URL

# Local Foundry Node
forge script script/DeployPXWithAdmin.s.sol:DeployPXWithAdmin --sig "previewDeployment()"
```

### Deploy to Networks

**⚠️ IMPORTANT: Update the configuration in `DeployConfig.sol` before deploying to set the correct addresses!**

#### Ethereum Mainnet
```bash
forge script script/DeployPXWithAdmin.s.sol:DeployPXWithAdmin --rpc-url $ETH_RPC_URL --broadcast --verify
```

#### Ethereum Sepolia
```bash
forge script script/DeployPXWithAdmin.s.sol:DeployPXWithAdmin --rpc-url $SEPOLIA_RPC_URL --broadcast --verify
```

#### Base Mainnet
```bash
forge script script/DeployPXWithAdmin.s.sol:DeployPXWithAdmin --rpc-url $BASE_RPC_URL --broadcast --verify
```

#### Base Sepolia
```bash
forge script script/DeployPXWithAdmin.s.sol:DeployPXWithAdmin --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify
```

#### Local Development
```bash
# Start foundry node in another terminal
anvil

# Deploy
forge script script/DeployPXWithAdmin.s.sol:DeployPXWithAdmin --broadcast
```

## CREATE2 Factory

The deployment uses the CREATE2 factory deployed at `0x4e59b44847b379578588920cA78FbF26c0B4956C` which is available on:
- Ethereum Mainnet
- Ethereum Sepolia
- Base Mainnet
- Base Sepolia
- And many other networks

## Configuration

Before deploying, update the configuration in `DeployConfig.sol`:

1. **DOG20 Address**: Set the correct DOG20 token address for each network
2. **IPFS URI**: Set the base URI for token metadata
3. **Fee Addresses**: Set the development and PleasrDAO fee recipient addresses
4. **Shiba Dimensions**: Configure the width and height (affects total supply)

## Deterministic Addresses

The same salt (`keccak256("PX_TOKEN_WITH_ADMIN_V1")`) will produce the same addresses across all networks. Change the salt in `DeployPXWithAdmin.s.sol` to get different addresses.

## Verification

The `--verify` flag will automatically verify contracts on Etherscan/Basescan after deployment. Make sure you have the appropriate API keys set up:

```bash
export ETHERSCAN_API_KEY=...
export BASESCAN_API_KEY=...
```

## Architecture

The deployment creates three contracts:
1. **ProxyAdmin**: Controls upgrade permissions and provides secure upgrade management
2. **Implementation**: The actual PX contract logic
3. **Proxy**: TransparentUpgradeableProxy that delegates to the implementation

Users should interact with the proxy address, which will be the main PX token contract. The ProxyAdmin contract should be transferred to a multisig for production use.