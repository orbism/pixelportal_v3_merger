import { ethers } from "ethers";
import { computed, makeObservable, observable, action, reaction, runInAction, override } from "mobx";
import { ObjectKeys } from "../helpers/objects";
import { PixelOwnerInfo } from "../pages/Leaderbork/Leaderbork.store";
import { HttpL1 } from "../services";
import env from "../environment";

interface AddressToPuppers {
  [k: string]: {
    tokenIds: number[];
    ens: string | null;
  };
}

class L1Store {
  @observable
  addressToPuppers?: AddressToPuppers;

  constructor() {
    makeObservable(this);

    this.addressToPuppers = {};

    this.init();
  }

  init() {
    // Only fetch L1 data on Ethereum mainnet (chainId 1)
    // L1 API contains historical mainnet pixel data, not needed for testnet
    if (env.chain.id === 1) {
      this.getPixelOwnershipMap();
    }
  }

  getPixelOwnershipMap() {
    return HttpL1.get("/v1/config").then(({ data }) => (this.addressToPuppers = data));
  }

  @computed
  get sortedPixelOwners(): PixelOwnerInfo[] {
    const tds = ObjectKeys(this.addressToPuppers).map((key, index, arr) => ({
      address: key,
      ens: this.addressToPuppers![key].ens,
      pixels: this.addressToPuppers![key].tokenIds,
    }));
    return tds
      .filter(dog => dog.address !== ethers.constants.AddressZero)
      .filter(dog => dog.pixels.length > 0)
      .sort((a, b) => {
        if (a.pixels.length > b.pixels.length) {
          return -1;
        } else if (a.pixels.length < b.pixels.length) {
          return 1;
        } else {
          return 0;
        }
      });
  }

  getGlobalTransfers() {
    return HttpL1.post("/v1/transfers", {
      sort: {
        blockNumber: "desc",
      },
    }).then(({ data }) => {
      return data;
    });
  }

  getUserTransfers(address: string) {
    return HttpL1.post(`/v1/transfers/${address}`, {
      sort: {
        blockNumber: "desc",
      },
    }).then(({ data }) => {
      return data;
    });
  }
}

export default L1Store;
