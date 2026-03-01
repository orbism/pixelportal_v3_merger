import * as Sentry from "@sentry/react";
import { ethers } from "ethers";
import { action, computed, makeObservable, observable, toJS } from "mobx";
import { showDebugToast, showErrorToast } from "../../DSL/Toast/Toast";
import { Constructor, EmptyClass } from "../../helpers/mixins";
import { Navigable } from "../../services/mixins/navigable";
import AppStore from "../../store/App.store";

export enum BurnPixelsModalView {
  Select = "select",
  LoadingBurning = "burning",
  Complete = "complete",
}

class BurnPixelsDialogStore extends Navigable<BurnPixelsModalView, Constructor>(EmptyClass) {
  @observable
  selectedPixels: number[] = [];

  @observable
  hasUserSignedTx: boolean = false;

  @observable
  txHash: string | null = null;

  @observable
  oldPixels: number[] = [];

  @observable
  diffPixels: number[] = [];

  constructor(defaultPixel: number | null) {
    super();
    makeObservable(this);
    this.pushNavigation(BurnPixelsModalView.Select);
    if (defaultPixel !== null) {
      this.selectedPixels.push(defaultPixel);
    }
  }

  get stepperItems() {
    return [];
  }

  handlePixelSelect(tokenId: number) {
    if (!this.selectedPixels.includes(tokenId)) {
      this.selectedPixels.push(tokenId);
    } else {
      const index = this.selectedPixels.indexOf(tokenId);
      this.selectedPixels.splice(index, 1);
    }
  }

  async burnSelectedPixels() {
    this.hasUserSignedTx = false;
    // let tx;
    try {
      console.log("Attempting to burn pixels with IDs:", this.selectedPixels);

      // Verify selected pixels still exist on-chain before burning
      const validPixels: number[] = [];
      for (const pixelId of this.selectedPixels) {
        try {
          const owner = await AppStore.web3.pxContract!.ownerOf(pixelId);
          if (owner.toLowerCase() === AppStore.web3.address?.toLowerCase()) {
            validPixels.push(pixelId);
          } else {
            console.warn(`Pixel ${pixelId} not owned by user (owner: ${owner}), skipping`);
          }
        } catch {
          console.warn(`Pixel ${pixelId} no longer exists on-chain, skipping`);
        }
      }
      if (validPixels.length === 0) {
        showErrorToast("Selected pixels no longer exist on-chain. Refreshing data...");
        await AppStore.web3.refreshPixelOwnershipMap();
        this.popNavigation();
        return;
      }
      if (validPixels.length !== this.selectedPixels.length) {
        console.warn(`Filtered out ${this.selectedPixels.length - validPixels.length} stale pixels`);
        this.selectedPixels = validPixels;
      }

      const txMethod = AppStore.web3.pxContract.functions.burnPuppers;
      const estimatedGas = await AppStore.web3.pxContract.estimateGas.burnPuppers(this.selectedPixels);
      const gasLimitSafetyOffset = 80000; 
      const gasLimit = estimatedGas.add(gasLimitSafetyOffset);

      const tx = await txMethod(this.selectedPixels, { gasLimit });

      // if (this.selectedPixels.length === 1) {
      //   console.log("Burning single pixel with ID:", this.selectedPixels[0]);
      //   tx = await AppStore.web3.burnPupper(this.selectedPixels[0]);
      // } else if (this.selectedPixels.length > 1) {
      //   console.log("Burning multiple pixels with IDs:", this.selectedPixels);
      //   tx = await AppStore.web3.burnPuppers(this.selectedPixels);
      // } else {
      //   throw Error("burnSelectedPixels called with incorrect selectedPixels length");
      // }

      
      this.hasUserSignedTx = true;
      this.oldPixels = toJS(AppStore.web3.puppersOwned);
      showDebugToast(`burning pixels`);
      const receipt = await tx.wait();
      this.txHash = receipt.transactionHash;

      await AppStore.web3.refreshPixelOwnershipMap();
      const newPixels = toJS(AppStore.web3.puppersOwned);
      const mintedPixels = newPixels.filter(pixel => {
        if (!this.oldPixels.includes(pixel)) {
          return 1;
        }
        return 0;
      });
      const burnedPixels = this.oldPixels.filter(pixel => {
        if (!newPixels.includes(pixel)) {
          return 1;
        }
        return 0;
      });
      this.diffPixels = mintedPixels.concat(burnedPixels);
      this.pushNavigation(BurnPixelsModalView.Complete);
    } catch (e) {
      Sentry.captureException(e);
      console.error("Error during burning pixels:", e);
      showErrorToast("Error burning pixels");
      this.hasUserSignedTx = false;
      this.popNavigation();
    }
  }

  @action
  selectAllPixels() {
    this.selectedPixels = [...AppStore.web3.puppersOwned];
  }

  @action
  deselectAllPixels() {
    this.selectedPixels = [];
  }

  @computed
  get selectedPixelsDogValue() {
    if (this.selectedPixels.length === 0) {
      return "0";
    }
    const dogPerPixel = 55240;
    return (dogPerPixel * this.selectedPixels.length).toString();
  }

  @computed
  get isAllPixelsSelected() {
    return this.selectedPixels.length === AppStore.web3.puppersOwned.length;
  }

  @computed
  get isUserPixelOwner() {
    return AppStore.web3.puppersOwned.length > 0;
  }

  @computed
  get modalTitle() {
    switch (this.currentView) {
      case BurnPixelsModalView.Select:
        return "Burn Pixels";
      default:
        return "";
    }
  }

  @computed
  get description() {
    switch (this.currentView) {
      case BurnPixelsModalView.Select:
        if (this.isUserPixelOwner) {
          return (
            "Be sure to be careful with which pixels you select. You’ll most likely never see them again."
          );
        } else {
          return "No pixels found - try minting first!";
        }
      default:
        return "";
    }
  }
}

export default BurnPixelsDialogStore;
