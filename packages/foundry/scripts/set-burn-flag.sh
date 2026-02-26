#!/bin/bash

# Set the burn flag on a reserved token (marks it as burned on the old chain)
# Usage: ./scripts/set-burn-flag.sh <PX_CONTRACT_ADDRESS> <TOKEN_ID>

set -e

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <PX_CONTRACT_ADDRESS> <TOKEN_ID>"
    exit 1
fi

PX_CONTRACT_ADDRESS=$1
TOKEN_ID=$2

# Load environment variables
if [ ! -f ".env" ]; then
    echo "Error: .env file not found"
    exit 1
fi
export $(grep -v '^#' .env | xargs)

if [ -z "$PRIVATE_KEY" ]; then
    echo "Error: PRIVATE_KEY must be set in .env"
    exit 1
fi

if [ -z "$RPC_URL" ]; then
    echo "Error: RPC_URL must be set in .env"
    exit 1
fi

echo "Setting burn flag on token $TOKEN_ID on $PX_CONTRACT_ADDRESS"

cast send "$PX_CONTRACT_ADDRESS" "setBurnFlags(uint256[],bool[])" \
    "[$TOKEN_ID]" \
    "[true]" \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY"

echo ""
echo "Done. Verifying burn flag..."
RESULT=$(cast call "$PX_CONTRACT_ADDRESS" "getReservation(uint256)(address,bool)" "$TOKEN_ID" --rpc-url "$RPC_URL")

echo "Token $TOKEN_ID reservation: $RESULT"
