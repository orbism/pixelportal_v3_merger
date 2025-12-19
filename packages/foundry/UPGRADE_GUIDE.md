# PX Token Upgrade Guide

## 📋 Overview

This guide explains the best practices for upgrading the PX token contract and provides step-by-step instructions for safely executing upgrades.

## 🏗 Upgrade Architecture

The PX token uses the **ERC1967 Proxy Pattern** for upgradeability:

```
User → Proxy Contract → Implementation Contract (V1/V2/V3...)
```

- **Proxy**: Stores all state and delegates calls to implementation
- **Implementation**: Contains the logic but no state
- **Upgrades**: Deploy new implementation, update proxy to point to it

## ⚠️ CRITICAL SAFETY RULES

### 1. Storage Layout Safety
```solidity
// ✅ SAFE: Add new variables at the end
contract PXV2 is PX {
    // ... all existing V1 variables unchanged ...
    uint256 public newFeature;        // Safe to add
    mapping(address => bool) public newMapping; // Safe to add
    uint256[49] private __gapV2;      // Reduce gap accordingly
}

// ❌ UNSAFE: Never do these
contract PXV2Bad is PX {
    uint256 public newVar;            // ❌ Adding before existing vars
    // uint256 public puppersRemaining; // ❌ Removing existing vars
    address public DOG20;             // ❌ Changing type of existing vars
}
```

### 2. Initialization Safety
```solidity
// ✅ Use reinitializer for new versions
function initializeV2(...) external reinitializer(2) {
    // V2 initialization logic
}

// ❌ Never reuse initializer
function initialize(...) external initializer {
    // This will fail on upgrade
}
```

## 🔄 Upgrade Process

### Phase 1: Development & Testing

#### 1. **Create New Implementation**
```bash
# Example: PXV2.sol with new features
cp src/PX.sol src/PXV2.sol
# Add new features while preserving storage layout
```

#### 2. **Validate Storage Layout**
```bash
# Generate storage layout for comparison
forge inspect PX storageLayout > layouts/PX_V1.json
forge inspect PXV2 storageLayout > layouts/PXV2_V2.json
# Manually compare layouts
```

#### 3. **Test Locally**
```bash
# Start local node
anvil

# Deploy V1
forge script script/DeployPXWithAdmin.s.sol:DeployPXWithAdmin --broadcast

# Test upgrade
forge script script/UpgradePX.s.sol:UpgradePX --sig "testUpgrade(address,address)" $PROXY $NEW_IMPL
```

### Phase 2: Testnet Deployment

#### 1. **Deploy to Testnet**
```bash
# Deploy new implementation
forge script script/UpgradePX.s.sol:UpgradePX --sig "deployNewImplementation(string,bytes32)" "v2.0.0" $(cast keccak "PX_V2") --rpc-url $SEPOLIA_RPC_URL --broadcast

# Test upgrade on testnet
forge script script/UpgradePX.s.sol:UpgradePX --sig "testUpgrade(address,address)" $TESTNET_PROXY $NEW_IMPL --rpc-url $SEPOLIA_RPC_URL

# Execute upgrade on testnet
forge script script/UpgradePX.s.sol:UpgradePX --sig "upgradeProxy(address,address)" $TESTNET_PROXY $NEW_IMPL --rpc-url $SEPOLIA_RPC_URL --broadcast
```

#### 2. **Testnet Validation**
```bash
# Test all functionality
cast call $TESTNET_PROXY "name()"
cast call $TESTNET_PROXY "version()" # If V2 has version function
cast call $TESTNET_PROXY "totalSupply()"
```

### Phase 3: Mainnet Deployment

#### 1. **Deploy Implementation**
```bash
# Deploy new implementation to mainnet
forge script script/UpgradePX.s.sol:UpgradePX --sig "deployNewImplementation(string,bytes32)" "v2.0.0" $(cast keccak "PX_V2") --rpc-url $ETH_RPC_URL --broadcast --verify
```

#### 2. **Final Testing on Fork**
```bash
# Test on mainnet fork
forge script script/UpgradePX.s.sol:UpgradePX --sig "testUpgrade(address,address)" $MAINNET_PROXY $NEW_IMPL --fork-url $ETH_RPC_URL
```

#### 3. **Execute Upgrade**
```bash
# Execute the upgrade
forge script script/UpgradePX.s.sol:UpgradePX --sig "upgradeProxy(address,address)" $MAINNET_PROXY $NEW_IMPL --rpc-url $ETH_RPC_URL --broadcast
```

## 🛠 Script Commands Reference

### Deployment Commands
```bash
# Deploy new implementation
forge script script/UpgradePX.s.sol:UpgradePX \
  --sig "deployNewImplementation(string,bytes32)" \
  "v2.0.0" \
  $(cast keccak "PX_V2") \
  --rpc-url $RPC_URL --broadcast

# Get current implementation
forge script script/UpgradePX.s.sol:UpgradePX \
  --sig "getCurrentImplementation(address)" \
  $PROXY_ADDRESS \
  --rpc-url $RPC_URL
```

### Testing Commands
```bash
# Test upgrade (dry run)
forge script script/UpgradePX.s.sol:UpgradePX \
  --sig "testUpgrade(address,address)" \
  $PROXY_ADDRESS \
  $NEW_IMPLEMENTATION \
  --fork-url $RPC_URL

# Test on local fork
forge script script/UpgradePX.s.sol:UpgradePX \
  --sig "testUpgrade(address,address)" \
  $PROXY_ADDRESS \
  $NEW_IMPLEMENTATION \
  --fork-url $RPC_URL
```

### Upgrade Commands
```bash
# Execute upgrade
forge script script/UpgradePX.s.sol:UpgradePX \
  --sig "upgradeProxy(address,address)" \
  $PROXY_ADDRESS \
  $NEW_IMPLEMENTATION \
  --rpc-url $RPC_URL --broadcast
```

### Emergency Commands
```bash
# Emergency pause
forge script script/UpgradePX.s.sol:UpgradePX \
  --sig "emergencyPause(address)" \
  $PROXY_ADDRESS \
  --rpc-url $RPC_URL --broadcast

# Emergency unpause
forge script script/UpgradePX.s.sol:UpgradePX \
  --sig "emergencyUnpause(address)" \
  $PROXY_ADDRESS \
  --rpc-url $RPC_URL --broadcast
```

## 📊 Example: V1 → V2 Upgrade

### What's New in V2:
- **Batch minting**: Mint multiple tokens in one transaction
- **Mint cooldowns**: Rate limiting per user
- **Enhanced metadata**: Description field
- **Emergency withdrawal**: Admin emergency functions
- **Version tracking**: Contract version identification

### Storage Changes:
```solidity
// V1 ends with:
uint256[50] private __gap;

// V2 adds 5 new variables:
uint256 public maxMintPerTx;
string public description;
mapping(address => uint256) public lastMintTimestamp;
uint256 public mintCooldown;
bool public emergencyWithdrawalEnabled;
uint256[45] private __gapV2;  // Reduced from 50 to 45
```

### Upgrade Commands:
```bash
# 1. Deploy V2 implementation
NEW_IMPL=$(forge script script/UpgradePX.s.sol:UpgradePX --sig "deployNewImplementation(string,bytes32)" "v2.0.0" $(cast keccak "PX_V2") --rpc-url $RPC_URL --broadcast | grep "New implementation deployed at:" | cut -d' ' -f5)

# 2. Test upgrade
forge script script/UpgradePX.s.sol:UpgradePX --sig "testUpgrade(address,address)" $PROXY $NEW_IMPL --fork-url $RPC_URL

# 3. Execute upgrade
forge script script/UpgradePX.s.sol:UpgradePX --sig "upgradeProxy(address,address)" $PROXY $NEW_IMPL --rpc-url $RPC_URL --broadcast

# 4. Initialize V2 features
cast send $PROXY "initializeV2(uint256,string,uint256)" 10 "Enhanced PX Token with batch minting" 3600 --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

## 🚨 Emergency Procedures

### If Upgrade Fails:
1. **Pause the contract**: `emergencyPause(address)`
2. **Investigate the issue**: Check transaction logs, revert reasons
3. **Deploy fix**: Create new implementation with fixes
4. **Re-upgrade**: Execute upgrade to fixed implementation
5. **Unpause**: `emergencyUnpause(address)` when safe

### If Contract Needs Emergency Stop:
```bash
# Pause all operations
forge script script/UpgradePX.s.sol:UpgradePX --sig "emergencyPause(address)" $PROXY --rpc-url $RPC_URL --broadcast
```

## ✅ Pre-Upgrade Checklist

- [ ] New implementation thoroughly tested
- [ ] Storage layout compatibility verified
- [ ] Initialization functions properly implemented
- [ ] Upgrade tested on fork/testnet
- [ ] All existing functionality validated
- [ ] New functionality tested
- [ ] Emergency procedures prepared
- [ ] Team notified of upgrade window
- [ ] Users notified if necessary

## 📝 Post-Upgrade Checklist

- [ ] Upgrade transaction confirmed
- [ ] New implementation address verified
- [ ] Basic functionality tested
- [ ] New features tested
- [ ] Pause/unpause functionality verified
- [ ] Event emissions validated
- [ ] Documentation updated
- [ ] Team notified of completion

## 🔗 Useful Resources

- [OpenZeppelin Upgrades Documentation](https://docs.openzeppelin.com/upgrades-plugins/1.x/)
- [ERC1967 Proxy Standard](https://eips.ethereum.org/EIPS/eip-1967)
- [Foundry Book - Scripting](https://book.getfoundry.sh/tutorials/scripting)
- [Storage Layout Validation](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#storage-gaps)