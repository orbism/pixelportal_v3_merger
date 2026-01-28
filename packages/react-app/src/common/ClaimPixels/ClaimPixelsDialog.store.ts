import * as Sentry from "@sentry/react";
import { BigNumber, ethers } from "ethers";
import { computed, makeObservable, observable, runInAction, action } from "mobx";
import { showDebugToast, showErrorToast, showSuccessToast } from "../../DSL/Toast/Toast";
import { Constructor, EmptyClass } from "../../helpers/mixins";
import { Navigable } from "../../services/mixins/navigable";
import { Reactionable } from "../../services/mixins/reactionable";
import AppStore from "../../store/App.store";
import { DOG_PER_PIXEL, SUPERBRIDGE_URL } from "../../contracts/legacyContracts";

export enum ClaimPixelsModalView {
  Overview = "overview",
  ConfirmBurn = "confirm_burn",
  BurningMainnet = "burning_mainnet",
  BurningBase = "burning_base",
  WaitingForConfirmation = "waiting_confirmation",
  ReadyToClaim = "ready_to_claim",
  ClaimingPixels = "claiming",
  Complete = "complete",
}

export type BurnNetwork = "mainnet" | "base";

interface ReservedPixel {
  tokenId: number;
  burnConfirmed: boolean;
}

interface MigrationEligibility {
  mainnet: number[];
  base: number[];
}

class ClaimPixelsDialogStore extends Reactionable(
  Navigable<ClaimPixelsModalView, Constructor>(EmptyClass),
) {
  // Eligibility data from snapshot
  @observable
  eligibility: MigrationEligibility = { mainnet: [], base: [] };

  // Track which pixels have been burned on each network
  @observable
  burnedMainnet: number[] = [];

  @observable
  burnedBase: number[] = [];

  // Pixels ready to claim (burn confirmed in V3 contract)
  @observable
  claimablePixels: ReservedPixel[] = [];

  @observable
  selectedPixels: number[] = [];

  // Transaction states
  @observable
  hasUserSignedTx = false;

  @observable
  txHash: string | null = null;

  @observable
  isLoading = false;

  @observable
  claimedPixels: number[] = [];

  // For burn confirmation modal
  @observable
  pendingBurnNetwork: BurnNetwork | null = null;

  @observable
  burnError: string | null = null;

  // Polling interval for checking burn confirmation
  private pollIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    super();
    makeObservable(this);
  }

  get stepperItems() {
    return [];
  }

  // ============================================
  // Computed Properties
  // ============================================

  @computed
  get hasMainnetPixels(): boolean {
    return this.eligibility.mainnet.length > 0;
  }

  @computed
  get hasBasePixels(): boolean {
    return this.eligibility.base.length > 0;
  }

  @computed
  get mainnetPixelsToBurn(): number[] {
    // Pixels eligible on mainnet that haven't been burned yet
    return this.eligibility.mainnet.filter(id => !this.burnedMainnet.includes(id));
  }

  @computed
  get basePixelsToBurn(): number[] {
    // Pixels eligible on base that haven't been burned yet
    return this.eligibility.base.filter(id => !this.burnedBase.includes(id));
  }

  @computed
  get allPixelsBurned(): boolean {
    return this.mainnetPixelsToBurn.length === 0 && this.basePixelsToBurn.length === 0;
  }

  @computed
  get totalPixelsEligible(): number {
    return this.eligibility.mainnet.length + this.eligibility.base.length;
  }

  @computed
  get totalDogToReceiveFromBurn(): string {
    // Calculate total DOG user will receive from burning all eligible pixels
    // Note: 1% fee is taken, so they get 99%
    const totalPixels = this.mainnetPixelsToBurn.length + this.basePixelsToBurn.length;
    const dogPerPixel = BigNumber.from(DOG_PER_PIXEL);
    const totalDog = dogPerPixel.mul(totalPixels);
    const afterFee = totalDog.mul(99).div(100); // 99% after 1% fee
    return ethers.utils.formatEther(afterFee);
  }

  @computed
  get totalDogToLockForClaim(): string {
    // Calculate total DOG needed to claim all claimable pixels
    const dogPerPixel = BigNumber.from(DOG_PER_PIXEL);
    const totalDog = dogPerPixel.mul(this.claimablePixels.length);
    return ethers.utils.formatEther(totalDog);
  }

  @computed
  get canClaim(): boolean {
    return this.selectedPixels.length > 0 && !this.isLoading;
  }

  @computed
  get isEligible(): boolean {
    return this.totalPixelsEligible > 0;
  }

  // ============================================
  // Initialization
  // ============================================

  async init() {
    console.log("ClaimPixelsDialog.init() called");
    this.pushNavigation(ClaimPixelsModalView.Overview);

    runInAction(() => {
      this.isLoading = true;
    });

    try {
      // Load eligibility from snapshot
      await this.loadEligibility();
      // Load claimable pixels from V3 contract
      await this.loadClaimablePixels();
    } catch (error) {
      console.error("Init failed:", error);
      showErrorToast("Failed to load migration data");
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  async loadEligibility() {
    try {
      console.log("Loading migration eligibility for:", AppStore.web3.address);
      const data = await AppStore.web3.getMigrationEligibility(AppStore.web3.address!);

      runInAction(() => {
        this.eligibility = data;
      });

      console.log("Eligibility loaded:", data);
    } catch (error) {
      console.error("Failed to load eligibility:", error);
      // Don't throw - let user see empty state
    }
  }

  async loadClaimablePixels() {
    try {
      console.log("Loading claimable pixels for:", AppStore.web3.address);

      const result = await AppStore.web3.getReservedTokensForUser(
        AppStore.web3.address!,
        100
      );

      const claimablePixels: ReservedPixel[] = [];

      for (let i = 0; i < result.tokenIds.length; i++) {
        const tokenId = Number(result.tokenIds[i].toString());
        const burnConfirmed = result.burnConfirmed[i];

        if (burnConfirmed) {
          claimablePixels.push({ tokenId, burnConfirmed });
        }
      }

      console.log("Claimable pixels found:", claimablePixels);

      runInAction(() => {
        this.claimablePixels = claimablePixels;
        // Pre-select all claimable pixels
        this.selectedPixels = claimablePixels.map(p => p.tokenId);
      });
    } catch (error) {
      console.error("Failed to load claimable pixels:", error);
    }
  }

  // ============================================
  // Burn Flow
  // ============================================

  @action
  initiateBurn(network: BurnNetwork) {
    this.pendingBurnNetwork = network;
    this.burnError = null;
    this.pushNavigation(ClaimPixelsModalView.ConfirmBurn);
  }

  @action
  cancelBurn() {
    this.pendingBurnNetwork = null;
    this.burnError = null;
    this.popNavigation();
  }

  async confirmBurn() {
    if (!this.pendingBurnNetwork) return;

    const network = this.pendingBurnNetwork;
    const tokenIds = network === "mainnet" ? this.mainnetPixelsToBurn : this.basePixelsToBurn;

    if (tokenIds.length === 0) {
      showErrorToast("No pixels to burn on this network");
      return;
    }

    runInAction(() => {
      this.hasUserSignedTx = false;
      this.burnError = null;
    });

    // Navigate to burning view
    this.pushNavigation(
      network === "mainnet"
        ? ClaimPixelsModalView.BurningMainnet
        : ClaimPixelsModalView.BurningBase
    );

    try {
      // Check if user is on correct network
      const currentChainId = await AppStore.web3.getCurrentChainId();
      const requiredChainId = network === "mainnet"
        ? AppStore.web3.v1ChainId
        : AppStore.web3.v2ChainId;

      if (currentChainId !== requiredChainId) {
        console.log(`Need to switch to chain ${requiredChainId}`);
        const switched = await AppStore.web3.switchNetwork(requiredChainId);
        if (!switched) {
          throw new Error(`Please switch to ${AppStore.web3.getNetworkDisplayName(requiredChainId)}`);
        }
        // Wait a moment for network switch to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Execute burn
      let tx: ethers.ContractTransaction;
      if (network === "mainnet") {
        tx = await AppStore.web3.burnV1Pixels(tokenIds);
      } else {
        tx = await AppStore.web3.burnV2Pixels(tokenIds);
      }

      runInAction(() => {
        this.hasUserSignedTx = true;
        this.txHash = tx.hash;
      });

      showDebugToast(`Burning ${tokenIds.length} pixels...`);

      // Wait for confirmation
      const receipt = await tx.wait();
      console.log("Burn confirmed:", receipt.transactionHash);

      // Update burned tracking
      runInAction(() => {
        if (network === "mainnet") {
          this.burnedMainnet = [...this.burnedMainnet, ...tokenIds];
        } else {
          this.burnedBase = [...this.burnedBase, ...tokenIds];
        }
        this.pendingBurnNetwork = null;
      });

      showSuccessToast(`Successfully burned ${tokenIds.length} pixels on ${network === "mainnet" ? "Ethereum" : "Base"}`);

      // Go back to overview and start polling for burn confirmation
      this.destroyNavigation();
      this.pushNavigation(ClaimPixelsModalView.WaitingForConfirmation);
      this.startPollingForBurnConfirmation();

    } catch (error: any) {
      console.error("Burn failed:", error);
      Sentry.captureException(error);

      runInAction(() => {
        this.burnError = error.message || "Burn transaction failed";
        this.hasUserSignedTx = false;
      });

      showErrorToast(error.message || "Burn failed");

      // Go back to overview
      this.destroyNavigation();
      this.pushNavigation(ClaimPixelsModalView.Overview);
    }
  }

  // ============================================
  // Polling for Burn Confirmation
  // ============================================

  startPollingForBurnConfirmation() {
    // Poll every 10 seconds to check if backend has confirmed burns
    this.pollIntervalId = setInterval(async () => {
      await this.checkBurnConfirmation();
    }, 10000);

    // Also check immediately
    this.checkBurnConfirmation();
  }

  stopPolling() {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  async checkBurnConfirmation() {
    try {
      await this.loadClaimablePixels();

      // If we have claimable pixels, burns have been confirmed
      if (this.claimablePixels.length > 0) {
        this.stopPolling();
        runInAction(() => {
          // Switch back to Base network for claiming
          AppStore.web3.switchNetwork(AppStore.web3.targetChainId);
        });
        this.destroyNavigation();
        this.pushNavigation(ClaimPixelsModalView.ReadyToClaim);
      }
    } catch (error) {
      console.error("Error checking burn confirmation:", error);
    }
  }

  // ============================================
  // Claim Flow
  // ============================================

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

  async handleClaimSubmit() {
    if (!this.canClaim) {
      showErrorToast("Please select at least one pixel to claim");
      return;
    }

    // Ensure user is on the V3 network (Base)
    const currentChainId = await AppStore.web3.getCurrentChainId();
    if (currentChainId !== AppStore.web3.targetChainId) {
      const switched = await AppStore.web3.switchNetwork(AppStore.web3.targetChainId);
      if (!switched) {
        showErrorToast(`Please switch to ${AppStore.web3.getNetworkDisplayName(AppStore.web3.targetChainId)}`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.pushNavigation(ClaimPixelsModalView.ClaimingPixels);
    await this.claimSelectedPixels();
  }

  async claimSelectedPixels() {
    runInAction(() => {
      this.hasUserSignedTx = false;
    });

    try {
      console.log("Claiming pixels:", this.selectedPixels);

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

          console.log(`Claimed pixel ${tokenId}`, receipt.transactionHash);
          claimedIds.push(tokenId);

          runInAction(() => {
            this.txHash = receipt.transactionHash;
          });
        } catch (error) {
          console.error(`Failed to claim pixel ${tokenId}:`, error);
        }
      }

      if (claimedIds.length > 0) {
        runInAction(() => {
          this.claimedPixels = claimedIds;
        });

        await AppStore.web3.refreshPixelOwnershipMap();
        await AppStore.web3.refreshPupperBalance();

        this.pushNavigation(ClaimPixelsModalView.Complete);
        showSuccessToast(`Successfully claimed ${claimedIds.length} pixel(s)!`);
      } else {
        showErrorToast("Failed to claim any pixels");
        this.destroyNavigation();
        this.pushNavigation(ClaimPixelsModalView.ReadyToClaim);
      }
    } catch (error) {
      Sentry.captureException(error);
      showErrorToast("Error claiming pixels");
      console.error("Claim error:", error);

      runInAction(() => {
        this.hasUserSignedTx = false;
      });

      this.destroyNavigation();
      this.pushNavigation(ClaimPixelsModalView.ReadyToClaim);
    }
  }

  // ============================================
  // Utility
  // ============================================

  get superbridgeUrl(): string {
    return SUPERBRIDGE_URL;
  }

  formatDogAmount(amount: string): string {
    const num = parseFloat(amount);
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  reset() {
    this.eligibility = { mainnet: [], base: [] };
    this.burnedMainnet = [];
    this.burnedBase = [];
    this.claimablePixels = [];
    this.selectedPixels = [];
    this.hasUserSignedTx = false;
    this.txHash = null;
    this.isLoading = false;
    this.claimedPixels = [];
    this.pendingBurnNetwork = null;
    this.burnError = null;
    this.stopPolling();
    this.destroyNavigation();
  }

  destroy() {
    this.reset();
    return this.disposeReactions();
  }
}

export default ClaimPixelsDialogStore;
