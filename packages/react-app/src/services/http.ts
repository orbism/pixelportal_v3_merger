import axios, { AxiosRequestConfig } from "axios";
import env from "../environment";

const HttpConfig: AxiosRequestConfig = {};
if (env.api.proxyURL !== null && env.api.proxyURL !== undefined) {
  HttpConfig.baseURL = env.api.proxyURL;
  HttpConfig.headers = {
    "x-api-proxy-dst-host": env.api.baseURL,
  };
} else {
  HttpConfig.baseURL = env.api.baseURL;
}

// For local development (Anvil), use the same local server for both APIs
// For production/testnet, L1 API points to mainnet data (historical pixels)
const HttpConfigL1: AxiosRequestConfig = {
  baseURL: env.chain?.id === 1337 || env.chain?.id === 31337 
    ? env.api.baseURL  // Use local server for Anvil
    : env.api.l1,      // Use production L1 API for testnet/mainnet
};

console.log('HTTP Config:', { 
  main: HttpConfig.baseURL, 
  l1: HttpConfigL1.baseURL,
  chainId: env.chain?.id 
});

const httpFactory = (HttpConfig: AxiosRequestConfig) => {
  return axios.create(HttpConfig);
};

export { httpFactory, HttpConfig, HttpConfigL1 };
