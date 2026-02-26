#!/bin/bash

# Grant DEFAULT_ADMIN_ROLE to an address
# Usage: ./scripts/grant-admin-role.sh <PX_CONTRACT_ADDRESS> <NEW_ADMIN_ADDRESS>

set -e

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <PX_CONTRACT_ADDRESS> <NEW_ADMIN_ADDRESS>"
    exit 1
fi

PX_CONTRACT_ADDRESS=$1
NEW_ADMIN_ADDRESS=$2

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

echo "Granting DEFAULT_ADMIN_ROLE to $NEW_ADMIN_ADDRESS on $PX_CONTRACT_ADDRESS"

cast send "$PX_CONTRACT_ADDRESS" "grantRole(bytes32,address)" \
    0x0000000000000000000000000000000000000000000000000000000000000000 \
    "$NEW_ADMIN_ADDRESS" \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY"

echo "Done. Verifying role..."
cast call "$PX_CONTRACT_ADDRESS" "hasRole(bytes32,address)(bool)" \
    0x0000000000000000000000000000000000000000000000000000000000000000 \
    "$NEW_ADMIN_ADDRESS" \
    --rpc-url "$RPC_URL"
