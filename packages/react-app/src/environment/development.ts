import deployedContracts from "../contracts/hardhat_contracts.json";

const targetChainId = 84532;
const targetNetworkName = "base-sepolia";

const developmentEnv = {
  api: {
    baseURL: "https://base-sepolia.api.ownthedoge.com",
    // baseURL: "https://otdpp-e3efe865e8b4.herokuapp.com/",
    proxyURL: "http://localhost:3003",
    l1: "https://api.ownthedoge.com",
  },
  app: {
    availableTokens: {
      DOG: {
        decimals: 18,
        contractAddress: deployedContracts[targetChainId]?.[targetNetworkName]?.contracts?.DOG20?.address || "",
      },
    },
    targetChainId,
    targetNetworkName,
    alchemyKey: process.env.REACT_APP_ALCHEMY_ID,
  },
};

export default developmentEnv;
