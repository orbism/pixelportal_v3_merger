import * as Sentry from "@sentry/react";
import { computed, makeObservable, observable, runInAction } from "mobx";
import { showDebugToast, showErrorToast } from "../../DSL/Toast/Toast";
import { Constructor, EmptyClass } from "../../helpers/mixins";
import { Navigable } from "../../services/mixins/navigable";
import { Reactionable } from "../../services/mixins/reactionable";
import AppStore from "../../store/App.store";

export enum ClaimPixelsModalView {
  SelectPixels = "select",
  LoadingClaim = "loading",
  Complete = "complete",
}

interface ReservedPixel {
  tokenId: number;
  burnConfirmed: boolean;
}

class ClaimPixelsDialogStore extends Reactionable(
  Navigable<ClaimPixelsModalView, Constructor>(EmptyClass),
) {
  @observable
  claimablePixels: ReservedPixel[] = [];

  @observable
  selectedPixels: number[] = [];

  @observable
  hasUserSignedTx = false;

  @observable
  txHash: string | null = null;

  @observable
  isLoading = false;

  @observable
  claimedPixels: number[] = [];

  constructor() {
    super();
    makeObservable(this);
  }

  get stepperItems() {
    return [];
  }

  async init() {
    console.log('🚀 ClaimPixelsDialog.init() called');
    this.pushNavigation(ClaimPixelsModalView.SelectPixels);
    try {
      await this.loadClaimablePixels();
    } catch (error) {
      console.error('❌ Init failed:', error);
    }
  }

  async loadClaimablePixels() {
    runInAction(() => {
      this.isLoading = true;
    });

    try {
      console.log("🔍 Loading claimable pixels for:", AppStore.web3.address);
      
      const result = await AppStore.web3.getReservedTokensForUser(
        AppStore.web3.address!,
        100 // limit
      );

      const claimablePixels: ReservedPixel[] = [];
      
      // Parse the result arrays
      for (let i = 0; i < result.tokenIds.length; i++) {
        const tokenId = Number(result.tokenIds[i].toString());
        const burnConfirmed = result.burnConfirmed[i];
        
        // Only include pixels that have burn confirmed (ready to claim)
        if (burnConfirmed) {
          claimablePixels.push({ tokenId, burnConfirmed });
        }
      }

      console.log("✅ Found claimable pixels:", claimablePixels);

      runInAction(() => {
        this.claimablePixels = claimablePixels;
        this.isLoading = false;
      });

      if (claimablePixels.length === 0) {
        console.log('⚠️ No claimable pixels found');
        // Don't show error toast, let the UI show the message
      }
    } catch (error) {
      console.error("❌ Failed to load claimable pixels:", error);
      runInAction(() => {
        this.isLoading = false;
      });
      showErrorToast("Failed to load claimable pixels");
    }
  }

  togglePixelSelection(tokenId: number) {
    const index = this.selectedPixels.indexOf(tokenId);
    if (index > -1) {
      this.selectedPixels.splice(index, 1);
    } else {
      this.selectedPixels.push(tokenId);
    }
  }

  selectAll() {
    this.selectedPixels = this.claimablePixels.map(p => p.tokenId);
  }

  deselectAll() {
    this.selectedPixels = [];
  }

  @computed
  get canClaim() {
    return this.selectedPixels.length > 0 && !this.isLoading;
  }

  async handleClaimSubmit() {
    if (!this.canClaim) {
      showErrorToast("Please select at least one pixel to claim");
      return;
    }

    this.pushNavigation(ClaimPixelsModalView.LoadingClaim);
  }

  async claimSelectedPixels() {
    runInAction(() => {
      this.hasUserSignedTx = false;
    });

    try {
      console.log("🎯 Claiming pixels:", this.selectedPixels);
      
      // Claim each selected pixel
      // Note: Could be optimized with batch claiming if contract supports it
      const claimedIds: number[] = [];
      
      for (const tokenId of this.selectedPixels) {
        try {
          console.log(`Claiming pixel ${tokenId}...`);
          
          const tx = await AppStore.web3.claimReservedToken(tokenId);
          
          runInAction(() => {
            this.hasUserSignedTx = true;
          });
          
          showDebugToast(`Claiming pixel ${tokenId}...`);
          const receipt = await tx.wait();
          
          console.log(`✅ Claimed pixel ${tokenId}`, receipt.transactionHash);
          claimedIds.push(tokenId);
          
          runInAction(() => {
            this.txHash = receipt.transactionHash;
          });
        } catch (error) {
          console.error(`❌ Failed to claim pixel ${tokenId}:`, error);
          // Continue with other pixels even if one fails
        }
      }

      if (claimedIds.length > 0) {
        runInAction(() => {
          this.claimedPixels = claimedIds;
        });

        // Refresh user's pixel balance
        await AppStore.web3.refreshPixelOwnershipMap();
        await AppStore.web3.refreshPupperBalance();

        this.pushNavigation(ClaimPixelsModalView.Complete);
        showDebugToast(`Successfully claimed ${claimedIds.length} pixel(s)!`);
      } else {
        showErrorToast("Failed to claim any pixels");
        this.destroyNavigation();
        this.pushNavigation(ClaimPixelsModalView.SelectPixels);
      }
    } catch (error) {
      Sentry.captureException(error);
      showErrorToast("Error claiming pixels");
      console.error("Claim error:", error);
      
      runInAction(() => {
        this.hasUserSignedTx = false;
      });
      
      this.destroyNavigation();
      this.pushNavigation(ClaimPixelsModalView.SelectPixels);
    }
  }

  reset() {
    this.claimablePixels = [];
    this.selectedPixels = [];
    this.hasUserSignedTx = false;
    this.txHash = null;
    this.isLoading = false;
    this.claimedPixels = [];
    this.destroyNavigation();
  }

  destroy() {
    this.reset();
    return this.disposeReactions();
  }
}

export default ClaimPixelsDialogStore;

