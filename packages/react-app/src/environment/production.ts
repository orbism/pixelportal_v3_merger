const productionEnv = {
  api: {
    baseURL: "https://base.api.ownthedoge.com",
    l1: "https://api.ownthedoge.com",
  },
  app: {
    availableTokens: {
      DOG: { decimals: 18, contractAddress: "0xAfb89a09D82FBDE58f18Ac6437B3fC81724e4dF6" },
    },
    targetChainId: 8453,
    targetNetworkName: "base-mainnet",
    alchemyKey: process.env.REACT_APP_ALCHEMY_ID,
  },
};
export default productionEnv;
