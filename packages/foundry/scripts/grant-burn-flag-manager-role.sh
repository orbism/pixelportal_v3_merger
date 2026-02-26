#!/bin/bash

# Grant BURN_FLAG_MANAGER_ROLE to an address
# Usage: ./scripts/grant-burn-flag-manager-role.sh <PX_CONTRACT_ADDRESS> <NEW_MANAGER_ADDRESS>

set -e

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <PX_CONTRACT_ADDRESS> <NEW_MANAGER_ADDRESS>"
    exit 1
fi

PX_CONTRACT_ADDRESS=$1
NEW_MANAGER_ADDRESS=$2

# Load environment variables
if [ ! -f ".env" ]; then
    echo "Error: .env file not found"
    exit 1
fi
export $(grep -v '^#' .env | xargs)

if [ -z "$PRIVATE_KEY" ] || [ -z "$RPC_URL" ]; then
    echo "Error: PRIVATE_KEY and RPC_URL must be set in .env"
    exit 1
fi

BURN_FLAG_MANAGER_ROLE=$(cast keccak "BURN_FLAG_MANAGER_ROLE")

echo "Granting BURN_FLAG_MANAGER_ROLE to $NEW_MANAGER_ADDRESS on $PX_CONTRACT_ADDRESS"
echo "Role hash: $BURN_FLAG_MANAGER_ROLE"

cast send "$PX_CONTRACT_ADDRESS" "grantRole(bytes32,address)" \
    "$BURN_FLAG_MANAGER_ROLE" \
    "$NEW_MANAGER_ADDRESS" \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY"

echo "Done. Verifying role..."
cast call "$PX_CONTRACT_ADDRESS" "hasRole(bytes32,address)(bool)" \
    "$BURN_FLAG_MANAGER_ROLE" \
    "$NEW_MANAGER_ADDRESS" \
    --rpc-url "$RPC_URL"
