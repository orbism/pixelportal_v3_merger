import { ethers } from "ethers";
import { action, computed, makeObservable, observable } from "mobx";
import { generatePath } from "react-router-dom";
import { flatMap, keys, orderBy, uniq, values } from "lodash";
import { arrayFuzzyFilterByKey } from "../../helpers/arrays";
import { EmptyClass } from "../../helpers/mixins";
import { abbreviate } from "../../helpers/strings";
import { Reactionable } from "../../services/mixins/reactionable";
import AppStore from "../../store/App.store";
import { sleep } from "./../../helpers/sleep";

export interface PixelOwnerInfo {
  address: string;
  pixels: number[];
  ens: string | null;
  // ud: string | null;
}

interface PixelTransfer {
  id: number;
  from: {
    address: string;
    ens: string | null;
    // ud: string | null;
  };
  insertedAt: string;
  to: {
    address: string;
    ens: string | null;
    // ud: string | null;
  };
  tokenId: number;
  uniqueTransferId: string;
  updatedAt: string;
  blockNumber: number;
  blockCreatedAt: string;
}

export enum SelectedOwnerTab {
  Wallet = "wallet",
  Activity = "activity",
}

class LeaderborkStore extends Reactionable(EmptyClass) {
  @observable
  searchValue = "";

  @observable
  selectedAddress?: string;

  @observable
  selectedPixelId: number | null = null;

  @observable
  selectedTransferId: string | null = null;

  @observable
  lockedDog: number | null = null;

  @observable
  globalTransfers: PixelTransfer[] = [];

  @observable
  selectedOwnerTransfers: PixelTransfer[] = [];

  @observable
  selectedOwnerTab: SelectedOwnerTab = SelectedOwnerTab.Activity;

  @observable
  paginableCount = 20;

  @observable
  dogLockedInPixels: number | null = null;

  constructor(
    selectedAddress?: string,
    selectedPixelId?: number,
    transferId?: string,
    selectedOwnerTab?: SelectedOwnerTab,
  ) {
    super();
    makeObservable(this);

    if (selectedAddress) {
      this.searchValue = selectedAddress;
      this.selectedAddress = selectedAddress;
      this.getSelectedUserTransfers();
    }

    if (selectedPixelId) {
      this.selectedPixelId = selectedPixelId;
    }

    if (transferId) {
      this.selectedTransferId = transferId;
    }

    if (selectedOwnerTab) {
      this.selectedOwnerTab = selectedOwnerTab;
    }

    this.react(
      () => this.searchValue,
      (value, prevValue) => {
        //@ts-ignore
        if ((this.selectedAddress && value.length === prevValue.length - 1) || value === "") {
          this.selectedAddress = undefined;
          this.searchValue = "";
        }

        if (this.searchValue === "") {
          this.getGlobalTransfers();
        }
      },
    );

    this.react(
      () => [this.selectedOwner],
      () => {
        if (this.selectedOwner && !this.selectedPixelId) {
          this.selectedPixelId = this.selectedOwner.pixels?.[0];
          this.getSelectedUserTransfers().then(_ => {
            if (!this.selectedTransferId) {
              this.selectedTransferId = this.selectedOwnerTransfers[0]?.uniqueTransferId;
            }
          });
        }
      },
    );
  }

  init() {
    AppStore.web3.getDogLocked().then(balance => {
      this.lockedDog = Number(balance);
      console.log("debug:: locked dog", this.lockedDog);
    });
    AppStore.web3.getPixelOwnershipMap();
    // AppStore.web3.getPercentDogInPixels().then(({ data: percent }) => (this.dogLockedInPixels = percent));
    if (!this.selectedAddress) {
      this.getGlobalTransfers().then(_ => {
        this.selectedTransferId = this.globalTransfers[0]?.uniqueTransferId;
      });
    }
  }

  @computed
  get ownersTypeaheadItems() {
    const addresses = Object.keys(AppStore.web3.addressToPuppers).map(address => ({
      value: address,
      name: AppStore.web3.addressToPuppers[address]?.ens ? AppStore.web3.addressToPuppers[address]?.ens : address,
    }));
    return arrayFuzzyFilterByKey(addresses, this.searchValue, "name").slice(0, 10);
  }

  @computed
  get selectedOwner(): PixelOwnerInfo | undefined {
    return this.sortedPixelOwners.filter(owner => owner.address === this.selectedAddress)?.[0];
  }

  @computed
  get selectedAddressDisplayName() {
    if (this.selectedAddress) {
      if (this.selectedOwner?.ens) {
        return this.selectedOwner.ens;
      } else {
        return abbreviate(this.selectedAddress);
      }
    }
    return "None";
  }

  @computed
  get selectedActivityTokenId() {
    return this.selectedActivityTransfer?.tokenId;
  }

  @computed
  get selectedActivityTransferDetails() {
    let title;
    let description;
    if (this.selectedActivityTransfer.from.address === ethers.constants.AddressZero) {
      title = "Minted";
      description = {
        to: {
          address: this.selectedActivityTransfer.to.address,
          displayName: abbreviate(this.selectedActivityTransfer.to.address),
        },
        from: null,
      };
    } else if (this.selectedActivityTransfer.to.address === ethers.constants.AddressZero) {
      title = "Burned";
      description = {
        from: {
          address: this.selectedActivityTransfer.from.address,
          displayName: abbreviate(this.selectedActivityTransfer.from.address),
        },
        to: null,
      };
    } else {
      title = "Transfer";
      description = {
        from: {
          address: this.selectedActivityTransfer.from.address,
          displayName: abbreviate(this.selectedActivityTransfer.from.address),
        },
        to: {
          address: this.selectedActivityTransfer.to.address,
          displayName: abbreviate(this.selectedActivityTransfer.to.address),
        },
      };
    }
    return { title, description };
  }

  @action
  async setSelectedAddress(address: string) {
    this.selectedAddress = address;
    this.searchValue = this.selectedAddress;
    this.selectedOwnerTab = SelectedOwnerTab.Wallet;
    this.selectedPixelId = this.selectedOwner.pixels[0];
    this.getSelectedUserTransfers();
  }

  setSelectedPixelId(pixelId: number | null) {
    this.selectedPixelId = pixelId;
    this.pushWindowState(
      generatePath(`/leaderbork/:address/${SelectedOwnerTab.Wallet}/:tokenId`, {
        address: this.selectedAddress,
        tokenId: this.selectedPixelId,
      }),
    );
  }

  setActivityId(activityId: string) {
    this.selectedTransferId = activityId;
  }

  pushWindowState(route: string) {
    // helper to push window state without causing a rerender
    return window.history.pushState({}, "", route);
  }

  destroy() {
    return this.disposeReactions();
  }

  @computed
  get transfers() {
    if (this.selectedOwner) {
      return this.selectedOwnerTransfers;
    } else {
      return this.globalTransfers;
    }
  }

  @computed
  get selectedActivityTransfer(): PixelTransfer | undefined {
    if (this.selectedOwner) {
      return this.selectedOwnerTransfers.filter(transfer => transfer.uniqueTransferId === this.selectedTransferId)[0];
    } else {
      return this.globalTransfers.filter(transfer => transfer.uniqueTransferId === this.selectedTransferId)[0];
    }
  }

  async getGlobalTransfers() {
    const l2 = await AppStore.web3.getGlobalTransfers();
    
    // Only fetch L1 transfers on Ethereum mainnet
    const l1 = AppStore.l1.isL1Enabled ? await AppStore.l1.getGlobalTransfers() : [];

    const transfers = orderBy([...l1, ...l2], "blockCreatedAt", "desc");

    this.globalTransfers = transfers.slice(0, 20);
  }

  async getSelectedUserTransfers() {
    if (!this.selectedAddress) return;

    const l2 = await AppStore.web3.getUserTransfers(this.selectedAddress);
    
    // Only fetch L1 transfers on Ethereum mainnet
    const l1 = AppStore.l1.isL1Enabled ? await AppStore.l1.getUserTransfers(this.selectedAddress) : [];

    const transfers = orderBy([...l1, ...l2], "blockCreatedAt", "desc");

    this.selectedOwnerTransfers = transfers;
  }

  @computed
  get activityPaneTitle() {
    if (!this.selectedAddress) {
      return "Recent Activity";
    } else {
      if (this.selectedOwner) {
        return abbreviate(this.selectedOwner.address);
      }
      return "";
    }
  }

  setSelectedOwnerTab(tabType: SelectedOwnerTab) {
    this.selectedOwnerTab = tabType;
    if (this.selectedOwnerTab === SelectedOwnerTab.Wallet) {
      this.selectedPixelId = this.selectedOwner.pixels[0];
      this.pushWindowState(
        generatePath(`/leaderbork/:address/${SelectedOwnerTab.Wallet}/:tokenId`, {
          address: this.selectedAddress,
          tokenId: this.selectedPixelId,
        }),
      );
    } else if (this.selectedOwnerTab === SelectedOwnerTab.Activity) {
      this.selectedTransferId = this.selectedOwnerTransfers[0]?.uniqueTransferId;
      this.pushWindowState(
        generatePath(`/leaderbork/:address/${SelectedOwnerTab.Activity}/:activityId`, {
          address: this.selectedAddress,
          activityId: this.selectedTransferId,
        }),
      );
    } else {
      throw new Error("Unknown selected owner tab type");
    }
  }

  @computed
  get selectedPixelChain() {
    const l1 = AppStore.l1.addressToPuppers || {};

    return flatMap(values(l1), "tokenIds").includes(this.selectedPixelId) ? "ethereum" : "base";
  }

  @computed
  get previewPixels() {
    if (this.selectedOwner) {
      return this.selectedOwner.pixels;
    } else {
      return [this.selectedActivityTokenId];
    }
  }

  @computed
  get previewSelectedPixelId() {
    if (this.selectedOwner) {
      if (this.selectedOwnerTab === SelectedOwnerTab.Activity) {
        return this.selectedActivityTokenId;
      } else {
        return this.selectedPixelId;
      }
    } else {
      return this.selectedActivityTokenId;
    }
  }

  @computed
  get showDetails() {
    return (
      (this.selectedPixelId && this.selectedOwnerTab === SelectedOwnerTab.Wallet) ||
      (this.selectedActivityTransfer && this.selectedOwnerTab === SelectedOwnerTab.Activity)
    );
  }

  @action
  async page() {
    const amountToPage = 20;
    // ~make it feel natural~ //
    await sleep(200);
    this.paginableCount += amountToPage;
  }

  @computed
  get sortedPixelOwners() {
    const l1 = AppStore.l1.addressToPuppers || {};
    const l2 = AppStore.web3.addressToPuppers;

    const tds = uniq([...keys(l1), ...keys(l2)]).map((key, index, arr) => {
      const owner = key;
      const ens = l1[key]?.ens || l2[key]?.ens;
      const l1Pixels = l1[key]?.tokenIds || [];
      const l2Pixels = l2[key]?.tokenIds || [];

      return {
        address: owner,
        ens: ens,
        pixels: uniq([...l1Pixels, ...l2Pixels]),
      };
    });

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

  @computed
  get pagableOwners() {
    if (this.sortedPixelOwners) {
      return [...this.sortedPixelOwners].splice(0, this.paginableCount);
    }
    return [];
  }

  @computed
  get hasMorePagableOwners() {
    return this.pagableOwners.length < this.sortedPixelOwners.length;
  }
}

export default LeaderborkStore;
