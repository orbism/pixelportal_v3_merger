#!/bin/bash

# PX Token Deployment Script
# This script loads environment variables from a chain-specific .env file and deploys the PX contract using Foundry
#
# Usage: ./deploy-v3.sh <chain>
#   chain: local, base-sepolia, base-mainnet

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

# Check for required chain argument
if [ -z "$1" ]; then
    print_error "Missing required chain argument"
    echo "Usage: ./deploy-v3.sh <chain>"
    echo "  chain: local, base-sepolia, base-mainnet"
    exit 1
fi

CHAIN="$1"
ENV_FILE=".env.${CHAIN}"

# Check if the chain-specific .env file exists
if [ ! -f "$ENV_FILE" ]; then
    print_error "${ENV_FILE} not found!"
    print_status "Please create ${ENV_FILE} with the following variables:"
    echo "PRIVATE_KEY=your_private_key_here"
    echo "RPC_URL=your_rpc_url_here"
    echo "DOG20_TOKEN_ADDRESS=0x...  # the DOG token contract address"
    echo "DEFAULT_LOCK_AMOUNT=1000000000000000000000  # lock amount in wei"
    echo "ETHERSCAN_API_KEY=your_etherscan_api_key_here  # optional, for verification"
    exit 1
fi

# Load environment variables from chain-specific .env file
print_status "Loading environment variables from ${ENV_FILE}..."
set -a
source "$ENV_FILE"
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

# Display configuration
print_status "Deployment Configuration:"
echo "  RPC URL: $RPC_URL"
echo "  Deployer Address: $(cast wallet address $PRIVATE_KEY 2>/dev/null || echo "Unable to derive address")"

SCRIPT_PATH="script/DeployPXV3UUPS.s.sol:DeployPXV3UUPS"
print_status "Deploying PX3 using UUPS proxy pattern"

# Check if forge is installed
if ! command -v forge &> /dev/null; then
    print_error "Foundry/forge is not installed or not in PATH"
    print_status "Please install Foundry: https://book.getfoundry.sh/getting-started/installation"
    exit 1
fi

# Check if cast is installed (for address derivation)
if ! command -v cast &> /dev/null; then
    print_warning "cast is not available - cannot verify deployer address"
fi

# Compile contracts first
print_status "Compiling contracts..."
forge build

if [ $? -ne 0 ]; then
    print_error "Compilation failed"
    exit 1
fi

print_success "Compilation successful"

# Prepare forge command
FORGE_CMD="forge script $SCRIPT_PATH --rpc-url $RPC_URL --broadcast"

# Add verification if ETHERSCAN_API_KEY is set
if [ ! -z "$ETHERSCAN_API_KEY" ]; then
    FORGE_CMD="$FORGE_CMD --verify --etherscan-api-key $ETHERSCAN_API_KEY"
    print_status "Contract verification enabled"
else
    print_warning "ETHERSCAN_API_KEY not set - skipping contract verification"
fi

# Show the command that will be executed
print_status "Executing deployment command:"
echo "  $FORGE_CMD"

# Confirm deployment
read -p "Do you want to proceed with deployment? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_status "Deployment cancelled"
    exit 0
fi

print_status "Starting deployment..."

# Execute the deployment
eval $FORGE_CMD

if [ $? -eq 0 ]; then
    print_success "Deployment completed successfully!"
    print_status "Check the output above for deployed contract addresses"
    print_status "Deployment artifacts saved to broadcast/ directory"
else
    print_error "Deployment failed"
    exit 1
fi
