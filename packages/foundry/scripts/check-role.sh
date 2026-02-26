#!/bin/bash

# Check if an address has a role
# Usage: ./scripts/check-role.sh <PX_CONTRACT_ADDRESS> <ROLE> <ADDRESS>
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

if [ -z "$RPC_URL" ]; then
    echo "Error: RPC_URL must be set in .env"
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

echo "Checking if $ADDRESS has $ROLE_NAME on $PX_CONTRACT_ADDRESS"

RESULT=$(cast call "$PX_CONTRACT_ADDRESS" "hasRole(bytes32,address)(bool)" \
    "$ROLE_HASH" \
    "$ADDRESS" \
    --rpc-url "$RPC_URL")

if [ "$RESULT" = "true" ]; then
    echo "YES - $ADDRESS has $ROLE_NAME"
else
    echo "NO - $ADDRESS does not have $ROLE_NAME"
fi
