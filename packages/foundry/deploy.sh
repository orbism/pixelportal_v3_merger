#!/bin/bash

# PX Token Deployment Script
# This script loads environment variables from .env and deploys the PX contract using Foundry

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
    print_status "Please create a .env file with the following variables:"
    echo "PRIVATE_KEY=your_private_key_here"
    echo "RPC_URL=your_rpc_url_here"
    echo "ETHERSCAN_API_KEY=your_etherscan_api_key_here (optional, for verification)"
    exit 1
fi

# Load environment variables from .env file
print_status "Loading environment variables from .env file..."
export $(grep -v '^#' .env | xargs)

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

# Default deployment method
DEPLOYMENT_METHOD=${1:-"uups"}

case $DEPLOYMENT_METHOD in
    "uups")
        SCRIPT_PATH="script/DeployPXUUPS.s.sol:DeployPXUUPS"
        print_status "Using UUPS deployment method (recommended)"
        ;;
    "admin")
        SCRIPT_PATH="script/DeployPXWithAdmin.s.sol:DeployPXWithAdmin"
        print_status "Using TransparentProxy with ProxyAdmin deployment method"
        ;;
    *)
        print_error "Invalid deployment method: $DEPLOYMENT_METHOD"
        print_status "Usage: ./deploy.sh [uups|admin]"
        print_status "  uups  - Deploy using UUPS pattern (default, recommended)"
        print_status "  admin - Deploy using TransparentProxy with ProxyAdmin"
        exit 1
        ;;
esac

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