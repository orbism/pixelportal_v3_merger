import { makeObservable, observable, reaction } from "mobx";
import { ethers } from "ethers";
import ModalsStore from "./Modals.store";
import RWDStore from "./RWD.store";
import Web3Store from "./web3.store";
import Web3providerStore from "./web3provider.store";
import L1Store from "./L1.store";
import GuideStore from "./Guide.store";

class _AppStore {
  @observable
  web3: Web3Store;

  @observable
  rwd: RWDStore;

  @observable
  modals: ModalsStore;

  @observable
  web3Provider: Web3providerStore;

  @observable
  l1: L1Store;

  @observable
  guide: GuideStore;

  constructor() {
    makeObservable(this);
    this.web3 = new Web3Store();
    this.rwd = new RWDStore();
    this.modals = new ModalsStore();
    this.web3Provider = new Web3providerStore();
    this.l1 = new L1Store();
    this.guide = new GuideStore();

    reaction(
      () => this.web3Provider.signer,
      signer => {
        if (signer) {
          console.log("Signer detected, reinitializing Web3Store...");
          this.reinitializeWeb3Store();
        }
      },
    );
  }

  reinitializeWeb3Store() {
    this.web3 = new Web3Store();
  }

  refreshWeb3Signer() {
    // Ensure provider is a Web3Provider before calling getSigner
    if (!this.web3.signer && this.web3Provider.provider instanceof ethers.providers.Web3Provider) {
      const signer = this.web3Provider.provider.getSigner();
      if (signer) {
        this.web3.setSigner(signer);
      }
    }
  }

  init() {
    this.rwd.init();
    this.web3.init();
    this.modals.init();
    this.l1.init();
    this.guide.init();
  }
}

const AppStore = new _AppStore();
export default AppStore;
