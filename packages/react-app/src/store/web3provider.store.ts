import { computed, makeObservable, observable, action, runInAction } from "mobx";
// import { web3Modal } from "../services/web3Modal";
import { ethers } from "ethers";
import { showDebugToast, showErrorToast } from "../DSL/Toast/Toast";
import { abbreviate } from "../helpers/strings";
import { Http } from "../services";
// import { Core } from "web3modal/dist/core";
// import { Provider } from "@wagmi/core";
// import { Chain } from "wagmi";
import env from "../environment";
import AppStore from "../store/App.store";
import { isProduction } from "../environment/helpers";

export interface EthersContractError {
  message: string;
}

class Web3providerStore {
  @observable
  provider: ethers.providers.BaseProvider | null = null;

  @observable
  signer: ethers.Signer | null = null;

  @observable
  network: any | null = null;

  @observable
  address: string | null = null;

  constructor() {
    makeObservable(this);
    this.initializeProvider();
  }

  initializeProvider() {
    try {
      // Use configuration from environment
      const networkConfig = {
        name: env.app.targetNetworkName,
        chainId: env.app.targetChainId,
      };

      console.log(`Initializing provider for ${networkConfig.name} (chainId: ${networkConfig.chainId})`);
      console.log(`RPC URL: ${env.chain.rpcUrl}`);

      const provider = new ethers.providers.JsonRpcProvider(env.chain.rpcUrl, networkConfig);

      runInAction(() => {
        this.provider = provider;
        console.log("Provider initialized successfully");
      });
    } catch (error) {
      console.error("Failed to initialize provider:", error);
    }
  }

  @action
  setSigner(newSigner: ethers.Signer) {
    if (this.signer !== newSigner) {
      runInAction(() => {
        this.signer = newSigner;
        console.log("Signer set successfully:", newSigner);
      });
    }
  }

  async connect(signer: ethers.Signer, network: any, provider: ethers.providers.BaseProvider) {
    console.log("Received signer:", signer);
    console.log("Signer methods:", Object.keys(signer).join(", "));

    this.setSigner(signer);

    if (!this.signer || typeof this.signer.getAddress !== "function") {
      console.error("Invalid signer object received. Expected a Signer with a getAddress method.");
      return;
    }
    if (!(provider instanceof ethers.providers.BaseProvider)) {
      console.error("Invalid provider type. Expected Web3Provider.");
      return;
    }
    this.signer = signer;
    this.network = network;
    this.provider = provider;

    console.log("Attempting to connect...");
    try {
      const address = await this.signer.getAddress();
      console.log("Connected with address:", address);
      this.address = address;
      AppStore.web3.setAddress(address);
      showDebugToast(`Connected: ${this.address} on ${this.network.name} (chain ID: ${this.network.id})`);
    } catch (e) {
      console.error("Connection failed", e);
      console.error("Failed to get address from signer:", e);
      if (this.provider) {
        this.disconnect();
      }
    }
    await this.validateNetwork();
  }

  async validateNetwork() {
    console.log("Validating network: Current ID", this.network?.id, "Expected ID", env.app.targetChainId);
    if (this.network?.id !== env.app.targetChainId) {
      if (AppStore.web3.isIntentionalNetworkSwitch) {
        console.log("Skipping network validation — intentional switch in progress");
        return;
      }
      showErrorToast(`Please connect to ${env.app.targetNetworkName.toLocaleUpperCase()}`);
      await this.disconnect();
    }
  }

  async disconnect() {
    try {
      showDebugToast(`disconnecting: ${this.address}`);
      console.log("Disconnecting...");

      this.provider = null;
      this.signer = null;
      this.address = null;
      this.network = null;
    } catch (e) {
      console.error(e);
    }
  }

  getENSname(address: string) {
    return Http.get(`/v1/ens/${address}`);
  }

  @computed
  get addressForDisplay() {
    if (this.address) {
      return abbreviate(this.address, 4); // Use abbreviated address directly
    } else {
      return "-";
    }
  }

  @computed
  get isConnected() {
    console.log("Signer:", !!this.signer, "Address:", !!this.address);
    return !!this.signer && !!this.address;
  }
}

export default Web3providerStore;
