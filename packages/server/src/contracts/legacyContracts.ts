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

export const CHAIN_IDS = {
  ETHEREUM_MAINNET: 1,
  ETHEREUM_SEPOLIA: 11155111,
  BASE_MAINNET: 8453,
  BASE_SEPOLIA: 84532,
} as const;

export const V1_CONTRACT_ADDRESSES = {
  [CHAIN_IDS.ETHEREUM_MAINNET]: "0xBAac2B4491727D78D2b78815144570b9f2Fe8899",
  [CHAIN_IDS.ETHEREUM_SEPOLIA]: "0x8ad55a76dF77EE8Ec30F598D1f30C7e5c73F11FF",
} as const;

export const V2_CONTRACT_ADDRESSES = {
  [CHAIN_IDS.BASE_MAINNET]: "0xAfb89a09D82FBDE58f18Ac6437B3fC81724e4dF6",
  [CHAIN_IDS.BASE_SEPOLIA]: "0xAfb89a09D82FBDE58f18Ac6437B3fC81724e4dF6",
} as const;

export const DOG_PER_PIXEL = "55239898990000000000000";
