#!/bin/bash

# Revoke a role from an address
# Usage: ./scripts/revoke-role.sh <PX_CONTRACT_ADDRESS> <ROLE> <ADDRESS>
# ROLE can be: admin, burn-flag-manager

set -e

if [ "$#" -ne 3 ]; then
    echo "Usage: $0 <PX_CONTRACT_ADDRESS> <ROLE> <ADDRESS>"
    echo "  ROLE: admin | burn-flag-manager"
    exit 1
fi

PX_CONTRACT_ADDRESS=$1
ROLE=$2
ADDRESS=$3

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

case $ROLE in
    "admin")
        ROLE_HASH="0x0000000000000000000000000000000000000000000000000000000000000000"
        ROLE_NAME="DEFAULT_ADMIN_ROLE"
        ;;
    "burn-flag-manager")
        ROLE_HASH=$(cast keccak "BURN_FLAG_MANAGER_ROLE")
        ROLE_NAME="BURN_FLAG_MANAGER_ROLE"
        ;;
    *)
        echo "Error: Unknown role '$ROLE'. Use 'admin' or 'burn-flag-manager'"
        exit 1
        ;;
esac

echo "Revoking $ROLE_NAME from $ADDRESS on $PX_CONTRACT_ADDRESS"
echo "Role hash: $ROLE_HASH"

cast send "$PX_CONTRACT_ADDRESS" "revokeRole(bytes32,address)" \
    "$ROLE_HASH" \
    "$ADDRESS" \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY"

echo "Done. Verifying role is revoked..."
cast call "$PX_CONTRACT_ADDRESS" "hasRole(bytes32,address)(bool)" \
    "$ROLE_HASH" \
    "$ADDRESS" \
    --rpc-url "$RPC_URL"
