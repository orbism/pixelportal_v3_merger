#!/bin/bash

# Reserve a token ID for an address
# Usage: ./scripts/reserve-token.sh <PX_CONTRACT_ADDRESS> <TOKEN_ID> <RECIPIENT_ADDRESS>

set -e

if [ "$#" -ne 3 ]; then
    echo "Usage: $0 <PX_CONTRACT_ADDRESS> <TOKEN_ID> <RECIPIENT_ADDRESS>"
    exit 1
fi

PX_CONTRACT_ADDRESS=$1
TOKEN_ID=$2
RECIPIENT_ADDRESS=$3

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

echo "Reserving token $TOKEN_ID for $RECIPIENT_ADDRESS on $PX_CONTRACT_ADDRESS"

cast send "$PX_CONTRACT_ADDRESS" "reserveTokensForMigration(uint256[],address[])" \
    "[$TOKEN_ID]" \
    "[$RECIPIENT_ADDRESS]" \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY"

echo ""
echo "Done. Verifying reservation..."
RESULT=$(cast call "$PX_CONTRACT_ADDRESS" "getReservation(uint256)(address,bool)" "$TOKEN_ID" --rpc-url "$RPC_URL")

echo "Token $TOKEN_ID reservation: $RESULT"
