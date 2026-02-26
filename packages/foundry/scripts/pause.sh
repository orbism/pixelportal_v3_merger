#!/bin/bash

# Pause or unpause the PX2 contract
# Usage: ./scripts/pause.sh true|false

set -e

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <true|false>"
    echo "  true  - pause the contract"
    echo "  false - unpause the contract"
    exit 1
fi

PAUSE_STATE=$1

if [ "$PAUSE_STATE" != "true" ] && [ "$PAUSE_STATE" != "false" ]; then
    echo "Error: Argument must be 'true' or 'false'"
    exit 1
fi

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

if [ -z "$PROXY_ADDRESS" ]; then
    echo "Error: PROXY_ADDRESS must be set in .env"
    exit 1
fi

# Check current pause state
CURRENT_STATE=$(cast call "$PROXY_ADDRESS" "paused()(bool)" --rpc-url "$RPC_URL")
echo "Current pause state: $CURRENT_STATE"

if [ "$PAUSE_STATE" = "true" ]; then
    if [ "$CURRENT_STATE" = "true" ]; then
        echo "Contract is already paused"
        exit 0
    fi
    echo "Pausing contract at $PROXY_ADDRESS..."
    cast send "$PROXY_ADDRESS" "pause()" \
        --rpc-url "$RPC_URL" \
        --private-key "$PRIVATE_KEY"
else
    if [ "$CURRENT_STATE" = "false" ]; then
        echo "Contract is already unpaused"
        exit 0
    fi
    echo "Unpausing contract at $PROXY_ADDRESS..."
    cast send "$PROXY_ADDRESS" "unpause()" \
        --rpc-url "$RPC_URL" \
        --private-key "$PRIVATE_KEY"
fi

# Verify the change
echo ""
echo "Verifying pause state..."
NEW_STATE=$(cast call "$PROXY_ADDRESS" "paused()(bool)" --rpc-url "$RPC_URL")
echo "New pause state: $NEW_STATE"

if [ "$PAUSE_STATE" = "$NEW_STATE" ]; then
    echo "Success: Contract pause state is now $NEW_STATE"
else
    echo "Warning: Expected pause state $PAUSE_STATE but got $NEW_STATE"
    exit 1
fi
