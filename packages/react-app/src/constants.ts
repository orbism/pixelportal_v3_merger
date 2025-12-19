// MY INFURA_ID, SWAP IN YOURS FROM https://infura.io/dashboard/ethereum
export const INFURA_ID = "58675762bfa841b7820b101bcf3affbd";

export const ALCHEMY_ID = "6azTt1-LUwpM1O7Olgehu8m59BiT1Th5";

// MY ETHERSCAN_ID, SWAP IN YOURS FROM https://etherscan.io/myapikey
export const ETHERSCAN_KEY = "6NF32XKQ8KSDU2QU8XFXFEUW3EVTWPBN43";

// BLOCKNATIVE ID FOR Notify.js:
export const BLOCKNATIVE_DAPPID = "0b58206a-f3c0-4701-a62f-73c7243e8c77";

interface INetworks {
  [k: string]: {
    name: string;
    color: string;
    chainId: number;
    blockExplorer: string;
    rpcUrl: string;
    faucet?: string;
    price?: number;
    gasPrice?: number;
  };
}

export const NETWORKS: INetworks = {
  localhost: {
    name: "localhost",
    color: "#666666",
    chainId: 31337,
    blockExplorer: "",
    rpcUrl: "http://" + window.location.hostname + ":8545",
  },
  base: {
    name: "base",
    color: "#ff8b9e",
    chainId: 1,
    rpcUrl: `https://api.developer.coinbase.com/rpc/v1/base/6azTt1-LUwpM1O7Olgehu8m59BiT1Th5`,
    blockExplorer: "https://basescan.org/",
  },
  baseSepolia: {
    name: "base-sepolia",
    color: "#ff8b9e",
    chainId: 84532,
    rpcUrl: `https://api.developer.coinbase.com/rpc/v1/base-sepolia/6azTt1-LUwpM1O7Olgehu8m59BiT1Th5`,
    blockExplorer: "https://basescan.org/",
  },
  sepolia: {
    name: "sepolia",
    color: "#8e44ad", // purple
    chainId: 11155111,
    rpcUrl: `https://api.developer.coinbase.com/rpc/v1/base-sepolia/6azTt1-LUwpM1O7Olgehu8m59BiT1Th5`,
    faucet: "https://www.infura.io/faucet/sepolia",
    blockExplorer: "https://sepolia.etherscan.io/",
  },
  mainnet: {
    name: "mainnet",
    color: "#ff8b9e",
    chainId: 1,
    rpcUrl: `https://api.developer.coinbase.com/rpc/v1/base/6azTt1-LUwpM1O7Olgehu8m59BiT1Th5`,
    blockExplorer: "https://etherscan.io/",
  },

};

export const NETWORK = (chainId: number) => {
  for (const n in NETWORKS) {
    if (NETWORKS[n].chainId === chainId) {
      return NETWORKS[n];
    }
  }
};
