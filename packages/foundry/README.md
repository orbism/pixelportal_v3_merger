# PX

An upgradeable ERC721 token contract deployed using UUPS proxy pattern with CREATE2 for deterministic addresses.

## Requirements

- [Foundry](https://book.getfoundry.sh/getting-started/installation)

## Build

```shell
forge build
```

## Test

```shell
forge test
```

## Deploy

1. Create a `.env` file with:
   ```
   PRIVATE_KEY=your_private_key_here
   RPC_URL=your_rpc_url_here
   ETHERSCAN_API_KEY=your_etherscan_api_key_here  # optional, for verification
   ```

2. Run the deploy script:
   ```shell
   ./deploy.sh
   ```

## Contract Architecture

- **PX.sol** - Main ERC721 token with token locking, reservation system, and access control
- **PXV2.sol** - Upgrade implementation example
- **ERC721CustomUpgradeable.sol** - Custom ERC721 base optimized for this use case

The contract uses OpenZeppelin's UUPS upgradeable pattern with AccessControl for role-based permissions.

### CREATE2 Deployment

The proxy contract is deployed using [Nick's CREATE2 factory](https://github.com/Arachnid/deterministic-deployment-proxy) at `0x4e59b44847b379578588920cA78FbF26c0B4956C` with salt `keccak256("PX_UUPS_v2")`. This provides a deterministic proxy address based on the salt and bytecode.

**Note:** The implementation contract uses regular CREATE (not CREATE2), so its address depends on the deployer's nonce. To get the same proxy address on different chains, the implementation must be deployed at the same address first.

## Role Management

The contract uses two roles:
- `DEFAULT_ADMIN_ROLE` - Can grant/revoke roles, pause/unpause, set token lock amounts, reserve tokens, and authorize upgrades
- `BURN_FLAG_MANAGER_ROLE` - Can set burn flags on reserved tokens

### Grant admin role to another account

```shell
cast send $PX_CONTRACT_ADDRESS "grantRole(bytes32,address)" \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  $NEW_ADMIN_ADDRESS \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

### Grant burn flag manager role to another account

```shell
cast send $PX_CONTRACT_ADDRESS "grantRole(bytes32,address)" \
  $(cast keccak "BURN_FLAG_MANAGER_ROLE") \
  $NEW_MANAGER_ADDRESS \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

### Revoke a role

```shell
# Revoke burn flag manager role
cast send $PX_CONTRACT_ADDRESS "revokeRole(bytes32,address)" \
  $(cast keccak "BURN_FLAG_MANAGER_ROLE") \
  $ADDRESS_TO_REVOKE \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

### Check if an account has a role

```shell
# Check burn flag manager role
cast call $PX_CONTRACT_ADDRESS "hasRole(bytes32,address)(bool)" \
  $(cast keccak "BURN_FLAG_MANAGER_ROLE") \
  $ADDRESS_TO_CHECK \
  --rpc-url $RPC_URL
```

## Upgrading via Safe Multisig

When the contract is owned by a Safe multisig, use the following process to upgrade:

### Prerequisites

1. Ensure your `.env` has the required variables:
   ```
   PRIVATE_KEY=your_private_key_here
   RPC_URL=your_rpc_url_here
   PROXY_ADDRESS=your_proxy_address_here
   MULTISIG=your_safe_address_here
   ETHERSCAN_API_KEY=your_etherscan_api_key_here
   SAFE_API_KEY=your_safe_api_key_here
   ```

2. Install safe-deployer dependencies:
   ```shell
   cd safe-deployer && npm install && cd ..
   ```

### Step 1: Deploy new implementation and generate upgrade calldata

```shell
source .env && forge script script/PrepareUpgradeForSafe.s.sol:PrepareUpgradeForSafe \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

This deploys the new PXV2 implementation, verifies it on Etherscan, and writes the upgrade calldata to `safe-deployer/calldata-upgrade.txt`.

### Step 2: Propose the upgrade transaction to Safe

```shell
cd safe-deployer && node index.js calldata-upgrade.txt
```

This proposes the `upgradeToAndCall` transaction to the Safe Transaction Service. Signers can then approve it in the Safe UI.

### Step 3: Verify the upgrade (after Safe execution)

```shell
source .env && forge script script/PrepareUpgradeForSafe.s.sol:PrepareUpgradeForSafe \
  --sig "verifyUpgrade(address)" \
  --rpc-url $RPC_URL \
  $PROXY_ADDRESS
```

### Proposing other Safe transactions

Use `generate-calldata.sh` to create calldata for any contract function:

```shell
cd safe-deployer

# Generate calldata for unpause()
./generate-calldata.sh "unpause()"

# Generate calldata for setBaseUri(string)
./generate-calldata.sh "setBaseUri(string)" "https://example.com/"

# Propose the transaction
node index.js calldata-unpause.txt
```
