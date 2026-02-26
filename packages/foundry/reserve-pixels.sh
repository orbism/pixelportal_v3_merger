#!/bin/bash

# Reserve Pixels Script
# Reserves three specific pixels for three wallet addresses and sets burn flags

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

# Wallet addresses to reserve pixels for
WALLET_1="0x1c563dCDb1a53c264f6bc94d783E9d4B25636C05"
WALLET_2="0x08d3269f1A93A13046D655Fd6E56577d0D6c9851"
WALLET_3="0x9d455AFFe240a25AdC6cD75293ca6ab2a010ab0f"
WALLET_4="0x8d3269f1A93A13046D655Fd6E56577d0D6c98518"

# Constants
INDEX_OFFSET=1000000
SHIBA_WIDTH=640
SHIBA_HEIGHT=480
TOTAL_PIXELS=$((SHIBA_WIDTH * SHIBA_HEIGHT))

# Generate four random pixel IDs within the valid range
# Pixel IDs are INDEX_OFFSET + (0 to TOTAL_PIXELS-1)
# Using predetermined "random" values for reproducibility:
# Pixel 1: (123, 456) -> 123 + 456*640 = 123 + 291840 = 291963 -> tokenId = 1291963
# Pixel 2: (500, 200) -> 500 + 200*640 = 500 + 128000 = 128500 -> tokenId = 1128500
# Pixel 3: (320, 240) -> 320 + 240*640 = 320 + 153600 = 153920 -> tokenId = 1153920
# Pixel 4: (0, 312) -> 0 + 312*640 = 200000 -> tokenId = 1200000

PIXEL_1=$((INDEX_OFFSET + 291963))  # 1291963
PIXEL_2=$((INDEX_OFFSET + 128500))  # 1128500
PIXEL_3=$((INDEX_OFFSET + 153920))  # 1153920
PIXEL_4=$((INDEX_OFFSET + 200000))  # 1200000

print_status "=== PIXEL RESERVATION SCRIPT ==="
echo ""
print_status "Configuration:"
echo "  Proxy Address: $PROXY_ADDRESS"
echo "  RPC URL: $RPC_URL"
echo ""
print_status "Pixels to reserve:"
echo "  Pixel $PIXEL_1 -> $WALLET_1"
echo "  Pixel $PIXEL_2 -> $WALLET_2"
echo "  Pixel $PIXEL_3 -> $WALLET_3"
echo "  Pixel $PIXEL_4 -> $WALLET_4"
echo ""

# Verify proxy contract exists
print_status "Verifying proxy contract..."
CURRENT_NAME=$(cast call $PROXY_ADDRESS "name()(string)" --rpc-url $RPC_URL 2>/dev/null) || {
    print_error "Failed to read from proxy contract at $PROXY_ADDRESS"
    exit 1
}
print_success "Proxy contract verified: $CURRENT_NAME"

# Check if already paused
print_status "Checking current pause state..."
IS_PAUSED=$(cast call $PROXY_ADDRESS "paused()(bool)" --rpc-url $RPC_URL)
echo "  Currently paused: $IS_PAUSED"

# Step 1: Pause the contract
if [ "$IS_PAUSED" == "false" ]; then
    print_status "Pausing contract..."
    cast send $PROXY_ADDRESS "pause()" --rpc-url $RPC_URL --private-key $PRIVATE_KEY
    print_success "Contract paused"
else
    print_status "Contract already paused, skipping pause step"
fi

# Verify paused
IS_PAUSED=$(cast call $PROXY_ADDRESS "paused()(bool)" --rpc-url $RPC_URL)
if [ "$IS_PAUSED" != "true" ]; then
    print_error "Contract is not paused - cannot proceed with reservation"
    exit 1
fi

# Step 2: Reserve the three pixels
print_status "Reserving pixels..."

# Prepare arrays for the batch call
# tokenIds: [PIXEL_1, PIXEL_2, PIXEL_3]
# recipients: [WALLET_1, WALLET_2, WALLET_3]

cast send $PROXY_ADDRESS \
    "reserveTokensForMigration(uint256[],address[])" \
    "[$PIXEL_1,$PIXEL_2,$PIXEL_3,$PIXEL_4]" \
    "[$WALLET_1,$WALLET_2,$WALLET_3,$WALLET_4]" \
    --rpc-url $RPC_URL \
    --private-key $PRIVATE_KEY

print_success "Pixels reserved"

# Verify reservations
print_status "Verifying reservations..."
for PIXEL in $PIXEL_1 $PIXEL_2 $PIXEL_3 $PIXEL_4; do
    RESERVATION=$(cast call $PROXY_ADDRESS "reservations(uint256)(address,bool)" $PIXEL --rpc-url $RPC_URL)
    echo "  Pixel $PIXEL: $RESERVATION"
done

# Step 3: Set burn flags to true for all three pixels
print_status "Setting burn flags to true..."

cast send $PROXY_ADDRESS \
    "setBurnFlags(uint256[],bool[])" \
    "[$PIXEL_1,$PIXEL_2,$PIXEL_3,$PIXEL_4]" \
    "[true,true,true,true]" \
    --rpc-url $RPC_URL \
    --private-key $PRIVATE_KEY

print_success "Burn flags set"

# Verify burn flags
print_status "Verifying burn flags..."
for PIXEL in $PIXEL_1 $PIXEL_2 $PIXEL_3 $PIXEL_4; do
    RESERVATION=$(cast call $PROXY_ADDRESS "reservations(uint256)(address,bool)" $PIXEL --rpc-url $RPC_URL)
    echo "  Pixel $PIXEL: $RESERVATION"
done

# Step 4: Unpause the contract
print_status "Unpausing contract..."
cast send $PROXY_ADDRESS "unpause()" --rpc-url $RPC_URL --private-key $PRIVATE_KEY
print_success "Contract unpaused"

# Verify unpaused
IS_PAUSED=$(cast call $PROXY_ADDRESS "paused()(bool)" --rpc-url $RPC_URL)
if [ "$IS_PAUSED" != "false" ]; then
    print_error "Contract is still paused!"
    exit 1
fi

# Final summary
echo ""
print_success "=== RESERVATION COMPLETE ==="
echo ""
echo "  Reserved Pixels:"
echo "    Pixel $PIXEL_1 (coords: 123, 456) -> $WALLET_1"
echo "    Pixel $PIXEL_2 (coords: 500, 200) -> $WALLET_2"
echo "    Pixel $PIXEL_3 (coords: 320, 240) -> $WALLET_3"
echo "    Pixel $PIXEL_4 (coords: 0, 312) -> $WALLET_4"
echo ""
echo "  All burn flags set to true"
echo "  Contract is now unpaused"
echo ""
print_status "Users can now claim their reserved pixels using claimReservedToken()"
