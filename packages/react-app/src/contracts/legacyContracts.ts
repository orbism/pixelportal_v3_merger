/**
 * Legacy Contract Configuration for V1/V2 Migration
 *
 * V1: Deployed on Ethereum Mainnet (and Sepolia for testing)
 * V2: Deployed on Base (and Base Sepolia for testing)
 */

// Minimal ABI for burn function - same for V1 and V2
export const LEGACY_PX_ABI = [
  {
    inputs: [{ internalType: "uint256[]", name: "puppers", type: "uint256[]" }],
    name: "burnPuppers",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "DOG_TO_PIXEL_SATOSHIS",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

// Chain IDs
export const CHAIN_IDS = {
  ETHEREUM_MAINNET: 1,
  ETHEREUM_SEPOLIA: 11155111,
  BASE_MAINNET: 8453,
  BASE_SEPOLIA: 84532,
} as const;

// V1 Contract Addresses (Ethereum)
export const V1_CONTRACT_ADDRESSES = {
  [CHAIN_IDS.ETHEREUM_MAINNET]: "0xBAac2B4491727D78D2b78815144570b9f2Fe8899",
  [CHAIN_IDS.ETHEREUM_SEPOLIA]: "0x8ad55a76dF77EE8Ec30F598D1f30C7e5c73F11FF", // Sepolia V1 mock contract
} as const;

// V2 Contract Addresses (Base)
export const V2_CONTRACT_ADDRESSES = {
  [CHAIN_IDS.BASE_MAINNET]: "0x07887Ee0Bd24E774903963d50cF4Ec6a0a16977D",
  [CHAIN_IDS.BASE_SEPOLIA]: "0x65Af31F394CB386B79bC3B8c98b9693cA3161d65", // Update with actual Base Sepolia address when deployed
} as const;

// RPC URLs for legacy chains (for read-only operations)
export const LEGACY_RPC_URLS = {
  [CHAIN_IDS.ETHEREUM_MAINNET]: "https://eth-mainnet.g.alchemy.com/v2/",
  [CHAIN_IDS.ETHEREUM_SEPOLIA]: "https://eth-sepolia.g.alchemy.com/v2/",
  [CHAIN_IDS.BASE_MAINNET]: "https://base-mainnet.g.alchemy.com/v2/",
  [CHAIN_IDS.BASE_SEPOLIA]: "https://base-sepolia.g.alchemy.com/v2/",
} as const;

// Network display names
export const NETWORK_NAMES = {
  [CHAIN_IDS.ETHEREUM_MAINNET]: "Ethereum Mainnet",
  [CHAIN_IDS.ETHEREUM_SEPOLIA]: "Ethereum Sepolia",
  [CHAIN_IDS.BASE_MAINNET]: "Base",
  [CHAIN_IDS.BASE_SEPOLIA]: "Base Sepolia",
} as const;

// DOG per pixel (same across all versions)
export const DOG_PER_PIXEL = "55239898990000000000000"; // 55,239.89899 DOG in wei

// Superbridge URL for bridging DOG from Mainnet to Base
export const SUPERBRIDGE_URL = "https://superbridge.app/base";

// Helper to get V1 address based on current environment
export function getV1ContractAddress(isTestnet: boolean): string {
  return isTestnet
    ? V1_CONTRACT_ADDRESSES[CHAIN_IDS.ETHEREUM_SEPOLIA]
    : V1_CONTRACT_ADDRESSES[CHAIN_IDS.ETHEREUM_MAINNET];
}

// Helper to get V2 address based on current environment
export function getV2ContractAddress(isTestnet: boolean): string {
  return isTestnet
    ? V2_CONTRACT_ADDRESSES[CHAIN_IDS.BASE_SEPOLIA]
    : V2_CONTRACT_ADDRESSES[CHAIN_IDS.BASE_MAINNET];
}

// Helper to get V1 chain ID based on current environment
export function getV1ChainId(isTestnet: boolean): number {
  return isTestnet ? CHAIN_IDS.ETHEREUM_SEPOLIA : CHAIN_IDS.ETHEREUM_MAINNET;
}

// Helper to get V2 chain ID based on current environment
export function getV2ChainId(isTestnet: boolean): number {
  return isTestnet ? CHAIN_IDS.BASE_SEPOLIA : CHAIN_IDS.BASE_MAINNET;
}
