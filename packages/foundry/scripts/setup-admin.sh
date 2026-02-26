#!/bin/bash

# Setup script to grant admin and burn flag manager roles to a specific address
# Usage: ./scripts/setup-admin.sh <PX_CONTRACT_ADDRESS>

set -e

TARGET_ADDRESS="0x9d455AFFe240a25AdC6cD75293ca6ab2a010ab0f"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <PX_CONTRACT_ADDRESS>"
    exit 1
fi

PX_CONTRACT_ADDRESS=$1

echo "Granting roles to $TARGET_ADDRESS on $PX_CONTRACT_ADDRESS"

echo ""
echo "Granting DEFAULT_ADMIN_ROLE..."
"$SCRIPT_DIR/grant-admin-role.sh" "$PX_CONTRACT_ADDRESS" "$TARGET_ADDRESS"

echo ""
echo "Granting BURN_FLAG_MANAGER_ROLE..."
"$SCRIPT_DIR/grant-burn-flag-manager-role.sh" "$PX_CONTRACT_ADDRESS" "$TARGET_ADDRESS"

echo ""
echo "Done! $TARGET_ADDRESS now has both DEFAULT_ADMIN_ROLE and BURN_FLAG_MANAGER_ROLE."
