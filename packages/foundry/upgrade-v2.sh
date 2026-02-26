#!/bin/bash

# PX V2 Upgrade Script
# This script upgrades the deployed PX proxy to PXV2 implementation
# PXV2 returns 100% of locked tokens on burn (no dev fee)

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if .env file exists
if [ ! -f ".env" ]; then
    print_error ".env file not found!"
    print_status "Please create a .env file with the following variables:"
    echo "PRIVATE_KEY=your_private_key_here"
    echo "RPC_URL=your_rpc_url_here"
    echo "PROXY_ADDRESS=0x...  # the deployed PX proxy address"
    exit 1
fi

# Load environment variables from .env file
print_status "Loading environment variables from .env file..."
set -a
source .env
set +a

# Validate required environment variables
if [ -z "$PRIVATE_KEY" ]; then
    print_error "PRIVATE_KEY is not set in .env file"
    exit 1
fi

if [ -z "$RPC_URL" ]; then
    print_error "RPC_URL is not set in .env file"
    exit 1
fi

if [ -z "$PROXY_ADDRESS" ]; then
    print_error "PROXY_ADDRESS is not set in .env file"
    exit 1
fi

# Display configuration
print_status "Upgrade Configuration:"
echo "  Network: ${NETWORK_NAME:-unknown}"
echo "  RPC URL: $RPC_URL"
echo "  Proxy Address: $PROXY_ADDRESS"
echo "  Upgrader Address: $(cast wallet address $PRIVATE_KEY 2>/dev/null || echo "Unable to derive address")"

# Check if forge is installed
if ! command -v forge &> /dev/null; then
    print_error "Foundry/forge is not installed or not in PATH"
    print_status "Please install Foundry: https://book.getfoundry.sh/getting-started/installation"
    exit 1
fi

# Check if cast is installed
if ! command -v cast &> /dev/null; then
    print_error "cast is not installed or not in PATH"
    exit 1
fi

# Verify proxy contract exists and get current state
print_status "Verifying proxy contract..."
CURRENT_NAME=$(cast call $PROXY_ADDRESS "name()(string)" --rpc-url $RPC_URL 2>/dev/null) || {
    print_error "Failed to read from proxy contract at $PROXY_ADDRESS"
    print_error "Make sure the PROXY_ADDRESS is correct and the RPC_URL is accessible"
    exit 1
}
print_success "Proxy contract verified: $CURRENT_NAME"

# Get current implementation
print_status "Getting current implementation..."
IMPL_SLOT="0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
CURRENT_IMPL=$(cast storage $PROXY_ADDRESS $IMPL_SLOT --rpc-url $RPC_URL 2>/dev/null) || {
    print_error "Failed to read implementation slot"
    exit 1
}
CURRENT_IMPL_ADDR="0x$(echo $CURRENT_IMPL | cut -c27-66)"
print_status "Current implementation: $CURRENT_IMPL_ADDR"

# Get current state for verification
print_status "Recording pre-upgrade state..."
TOTAL_SUPPLY=$(cast call $PROXY_ADDRESS "totalSupply()(uint256)" --rpc-url $RPC_URL)
PUPPERS_REMAINING=$(cast call $PROXY_ADDRESS "puppersRemaining()(uint256)" --rpc-url $RPC_URL)
PAUSED=$(cast call $PROXY_ADDRESS "paused()(bool)" --rpc-url $RPC_URL)

echo "  Total Supply: $TOTAL_SUPPLY"
echo "  Puppers Remaining: $PUPPERS_REMAINING"
echo "  Paused: $PAUSED"

# Verify deployer has admin role
print_status "Verifying upgrade permissions..."
DEPLOYER_ADDRESS=$(cast wallet address $PRIVATE_KEY)
DEFAULT_ADMIN_ROLE="0x0000000000000000000000000000000000000000000000000000000000000000"
HAS_ADMIN=$(cast call $PROXY_ADDRESS "hasRole(bytes32,address)(bool)" $DEFAULT_ADMIN_ROLE $DEPLOYER_ADDRESS --rpc-url $RPC_URL)

if [ "$HAS_ADMIN" != "true" ]; then
    print_error "Deployer $DEPLOYER_ADDRESS does not have DEFAULT_ADMIN_ROLE"
    print_error "Cannot perform upgrade without admin permissions"
    exit 1
fi
print_success "Deployer has DEFAULT_ADMIN_ROLE"

# Compile contracts
print_status "Compiling contracts..."
forge build
if [ $? -ne 0 ]; then
    print_error "Compilation failed"
    exit 1
fi
print_success "Compilation successful"

# Confirm upgrade
echo ""
print_warning "=== UPGRADE SUMMARY ==="
echo "  From: PX (V1) - 1% dev fee on burns"
echo "  To:   PXV2    - 0% dev fee on burns (100% returned to burner)"
echo ""
read -p "Do you want to proceed with the upgrade? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_status "Upgrade cancelled"
    exit 0
fi

# Execute upgrade
print_status "Executing upgrade..."
UPGRADE_OUTPUT=$(forge script script/UpgradePXUUPS.s.sol:UpgradePXUUPS \
    --rpc-url $RPC_URL \
    --broadcast \
    --private-key $PRIVATE_KEY \
    2>&1)

UPGRADE_EXIT_CODE=$?

echo "$UPGRADE_OUTPUT"

if [ $UPGRADE_EXIT_CODE -ne 0 ]; then
    print_error "Upgrade script failed with exit code $UPGRADE_EXIT_CODE"
    exit 1
fi

# Verify upgrade succeeded
print_status "Verifying upgrade..."

# Get new implementation
NEW_IMPL=$(cast storage $PROXY_ADDRESS $IMPL_SLOT --rpc-url $RPC_URL 2>/dev/null)
NEW_IMPL_ADDR="0x$(echo $NEW_IMPL | cut -c27-66)"

# Compare lowercase versions to handle case differences
CURRENT_IMPL_LOWER=$(echo "$CURRENT_IMPL_ADDR" | tr '[:upper:]' '[:lower:]')
NEW_IMPL_LOWER=$(echo "$NEW_IMPL_ADDR" | tr '[:upper:]' '[:lower:]')

if [ "$NEW_IMPL_LOWER" == "$CURRENT_IMPL_LOWER" ]; then
    print_error "Implementation address did not change - upgrade may have failed"
    exit 1
fi
print_success "Implementation updated: $CURRENT_IMPL_ADDR -> $NEW_IMPL_ADDR"

# Verify state preservation
print_status "Verifying state preservation..."

NEW_TOTAL_SUPPLY=$(cast call $PROXY_ADDRESS "totalSupply()(uint256)" --rpc-url $RPC_URL)
NEW_PUPPERS_REMAINING=$(cast call $PROXY_ADDRESS "puppersRemaining()(uint256)" --rpc-url $RPC_URL)
NEW_PAUSED=$(cast call $PROXY_ADDRESS "paused()(bool)" --rpc-url $RPC_URL)

if [ "$NEW_TOTAL_SUPPLY" != "$TOTAL_SUPPLY" ]; then
    print_error "Total supply changed: $TOTAL_SUPPLY -> $NEW_TOTAL_SUPPLY"
    exit 1
fi

if [ "$NEW_PUPPERS_REMAINING" != "$PUPPERS_REMAINING" ]; then
    print_error "Puppers remaining changed: $PUPPERS_REMAINING -> $NEW_PUPPERS_REMAINING"
    exit 1
fi

if [ "$NEW_PAUSED" != "$PAUSED" ]; then
    print_error "Paused state changed: $PAUSED -> $NEW_PAUSED"
    exit 1
fi

print_success "State preservation verified"

# Verify contract on block explorer
print_status "Verifying new implementation contract on block explorer..."

# Determine chain name from RPC URL or NETWORK_NAME
CHAIN_NAME=""
if [ -n "$NETWORK_NAME" ]; then
    CHAIN_NAME="$NETWORK_NAME"
elif [[ "$RPC_URL" == *"base-sepolia"* ]]; then
    CHAIN_NAME="base-sepolia"
elif [[ "$RPC_URL" == *"base"* ]]; then
    CHAIN_NAME="base"
elif [[ "$RPC_URL" == *"sepolia"* ]]; then
    CHAIN_NAME="sepolia"
elif [[ "$RPC_URL" == *"mainnet"* ]] || [[ "$RPC_URL" == *"eth"* ]]; then
    CHAIN_NAME="mainnet"
fi

if [ -z "$CHAIN_NAME" ]; then
    print_warning "Could not determine chain name for verification"
    print_status "You can manually verify with:"
    echo "  forge verify-contract $NEW_IMPL_ADDR src/PXV2.sol:PXV2 --chain <chain-name> --etherscan-api-key \$ETHERSCAN_API_KEY"
elif [ -z "$ETHERSCAN_API_KEY" ]; then
    print_warning "ETHERSCAN_API_KEY not set in .env - skipping contract verification"
    print_status "You can manually verify with:"
    echo "  forge verify-contract $NEW_IMPL_ADDR src/PXV2.sol:PXV2 --chain $CHAIN_NAME --etherscan-api-key <your-api-key>"
else
    print_status "Verifying on $CHAIN_NAME..."
    VERIFY_OUTPUT=$(forge verify-contract $NEW_IMPL_ADDR src/PXV2.sol:PXV2 \
        --chain $CHAIN_NAME \
        --etherscan-api-key $ETHERSCAN_API_KEY \
        --watch 2>&1) || true

    if echo "$VERIFY_OUTPUT" | grep -q "Contract successfully verified\|Already Verified"; then
        print_success "Contract verified on block explorer"
    else
        print_warning "Contract verification may have failed or is pending"
        echo "$VERIFY_OUTPUT"
        print_status "You can retry verification with:"
        echo "  forge verify-contract $NEW_IMPL_ADDR src/PXV2.sol:PXV2 --chain $CHAIN_NAME --etherscan-api-key \$ETHERSCAN_API_KEY --watch"
    fi
fi

# Final summary
echo ""
print_success "=== UPGRADE COMPLETE ==="
echo "  Proxy Address: $PROXY_ADDRESS"
echo "  Old Implementation: $CURRENT_IMPL_ADDR"
echo "  New Implementation: $NEW_IMPL_ADDR"
echo ""
echo "  Changes in PXV2:"
echo "  - Burns now return 100% of locked tokens (no dev fee)"
echo ""
print_status "Update .env with new implementation address if needed:"
echo "  IMPLEMENTATION_ADDRESS=$NEW_IMPL_ADDR"
