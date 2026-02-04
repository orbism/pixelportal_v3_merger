/**
 * Environment Configuration - Single Source of Truth
 * 
 * All chain and network configuration should be driven by environment variables.
 * This file reads from process.env and provides a consistent config object.
 */

import deployedContracts from "../contracts/abi.json";

// Read chain configuration from environment
const getChainId = (): number => {
  const envChainId = process.env.REACT_APP_CHAIN_ID;
  if (envChainId) {
    return parseInt(envChainId);
  }
  
  // Fallback: Use NODE_ENV to determine default
  const isProduction = process.env.NODE_ENV === "production" && process.env.REACT_APP_DOG_ENV === "production";
  return isProduction ? 8453 : 84532; // base-mainnet : base-sepolia
};

const getNetworkName = (): string => {
  const envNetwork = process.env.REACT_APP_NETWORK_NAME;
  if (envNetwork) {
    return envNetwork;
  }
  
  // Fallback: Derive from chainId
  const chainId = getChainId();
  if (chainId === 1337 || chainId === 31337) return 'anvil-local';
  if (chainId === 8453) return 'base-mainnet';
  if (chainId === 84532) return 'base-sepolia';
  if (chainId === 1) return 'ethereum-mainnet';
  if (chainId === 11155111) return 'sepolia';
  
  console.warn(`Unknown chainId ${chainId}, defaulting to 'unknown'`);
  return 'unknown';
};

const getRpcUrl = (): string => {
  const envRpcUrl = process.env.REACT_APP_RPC_URL;
  if (envRpcUrl) {
    return envRpcUrl;
  }
  
  // Auto-generate based on chain
  const chainId = getChainId();
  const alchemyKey = process.env.REACT_APP_ALCHEMY_ID || '';
  
  if (chainId === 1337 || chainId === 31337) {
    return 'http://localhost:8545';
  } else if (chainId === 8453) {
    return `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  } else if (chainId === 84532) {
    return `https://base-sepolia.g.alchemy.com/v2/${alchemyKey}`;
  } else if (chainId === 1) {
    return `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  } else if (chainId === 11155111) {
    return `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`;
  }
  
  throw new Error(`No RPC URL configured for chain ${chainId}. Set REACT_APP_RPC_URL in .env.local`);
};

// Get contract addresses from deployment or env override
const getContractAddress = (contractName: 'PX' | 'DOG20'): string => {
  // Check for environment override first
  const envVar = contractName === 'PX' 
    ? process.env.REACT_APP_PX_CONTRACT 
    : process.env.REACT_APP_DOG20_CONTRACT;
  
  if (envVar) {
    console.log(`Using ${contractName} address from environment: ${envVar}`);
    return envVar;
  }
  
  // Otherwise get from hardhat_contracts.json
  const chainId = getChainId();
  const networkName = getNetworkName();
  const contracts = deployedContracts[chainId.toString()]?.[networkName]?.contracts;
  const address = contracts?.[contractName]?.address || '';
  
  if (!address) {
    console.warn(`No ${contractName} address found for chain ${chainId} / ${networkName}`);
  }
  
  return address;
};

const getServerUrl = (): string => {
  const envServer = process.env.REACT_APP_SERVER_URL;
  if (envServer) {
    return envServer;
  }

  // Fallback to localhost for local development only
  // For production/staging, REACT_APP_SERVER_URL must be set
  console.warn('REACT_APP_SERVER_URL not set, falling back to localhost:3003');
  return 'http://localhost:3003';
};

const getL1ApiUrl = (): string => {
  const envL1 = process.env.REACT_APP_L1_API_URL;
  if (envL1) {
    return envL1;
  }

  // Default L1 API for Ethereum mainnet data (used for legacy pixel ownership, etc.)
  return 'https://api.ownthedoge.com';
};

// Build the configuration object
const chainId = getChainId();
const networkName = getNetworkName();
const rpcUrl = getRpcUrl();

const config = {
  chain: {
    id: chainId,
    name: networkName,
    rpcUrl: rpcUrl,
  },
  contracts: {
    px: getContractAddress('PX'),
    dog20: getContractAddress('DOG20'),
  },
  api: {
    baseURL: getServerUrl(),
    proxyURL: chainId === 1337 || chainId === 31337 ? getServerUrl() : null,
    l1: getL1ApiUrl(),
  },
  app: {
    availableTokens: {
      DOG: {
        decimals: 18,
        contractAddress: getContractAddress('DOG20'),
      },
    },
    targetChainId: chainId,
    targetNetworkName: networkName,
    alchemyKey: process.env.REACT_APP_ALCHEMY_ID || '',
  },
  services: {
    alchemyKey: process.env.REACT_APP_ALCHEMY_ID || '',
    walletConnectProjectId: process.env.REACT_APP_WALLETCONNECT_PROJECTID || '',
    sentryDsn: process.env.REACT_APP_SENTRY_DSN || '',
  },
  isProduction: process.env.NODE_ENV === 'production' && process.env.REACT_APP_DOG_ENV === 'production',
  isStaging: process.env.NODE_ENV === 'production' && process.env.REACT_APP_DOG_ENV === 'staging',
  isDevelopment: process.env.NODE_ENV === 'development',
};

// Log configuration on startup (helpful for debugging)
console.log('🔧 App Configuration:', {
  chain: `${config.chain.name} (${config.chain.id})`,
  rpc: config.chain.rpcUrl,
  px: config.contracts.px,
  dog20: config.contracts.dog20,
  server: config.api.baseURL,
});

export default config;

