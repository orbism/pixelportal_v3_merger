import * as Sentry from "@sentry/react";
import { BigNumber, ethers } from "ethers";
import { computed, makeObservable, observable, runInAction, action } from "mobx";
import { showDebugToast, showErrorToast, showSuccessToast } from "../../DSL/Toast/Toast";
import { Constructor, EmptyClass } from "../../helpers/mixins";
import { Navigable } from "../../services/mixins/navigable";
import { Reactionable } from "../../services/mixins/reactionable";
import { Http } from "../../services";
import AppStore from "../../store/App.store";
import { DOG_PER_PIXEL, SUPERBRIDGE_URL } from "../../contracts/legacyContracts";

export enum ClaimPixelsModalView {
  Overview = "overview",
  ConfirmBurn = "confirm_burn",
  BurningMainnet = "burning_mainnet",
  BurningBase = "burning_base",
  WaitingForConfirmation = "waiting_confirmation",
  ApprovingDOG = "approving_dog",
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

const STORAGE_KEY_PREFIX = "px_claim_state_";
const TAG = "[ClaimPixels]";
const log  = (...args: any[]) => console.log(TAG, ...args);
const warn = (...args: any[]) => console.warn(TAG, ...args);
const err  = (...args: any[]) => console.error(TAG, ...args);

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

  // Pixels ready to claim (burnConfirmed=true in V3 contract)
  @observable
  claimablePixels: ReservedPixel[] = [];

  // Pixels reserved but burn not yet confirmed
  @observable
  pendingReservations: ReservedPixel[] = [];

  @observable
  selectedPixels: number[] = [];

  // DOG balance on Base (for claim eligibility check)
  @observable
  dogBalanceOnBase: BigNumber | null = null;

  // Claim progress tracking
  @observable
  claimProgress: { claimed: number; total: number } = { claimed: 0, total: 0 };

  @observable
  claimBatchErrors: number[] = [];

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
    return this.eligibility.mainnet.filter(id => !this.burnedMainnet.includes(id));
  }

  @computed
  get basePixelsToBurn(): number[] {
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
  get totalDogNeeded(): BigNumber {
    return BigNumber.from(DOG_PER_PIXEL).mul(this.claimablePixels.length);
  }

  @computed
  get hasSufficientDog(): boolean {
    if (this.dogBalanceOnBase === null) return false;
    if (this.claimablePixels.length === 0) return true;
    return this.dogBalanceOnBase.gte(this.totalDogNeeded);
  }

  @computed
  get dogToReceiveFromMainnetBurn(): string {
    const total = BigNumber.from(DOG_PER_PIXEL).mul(this.mainnetPixelsToBurn.length);
    const afterFee = total.mul(99).div(100);
    return ethers.utils.formatEther(afterFee);
  }

  @computed
  get dogToReceiveFromBaseBurn(): string {
    const total = BigNumber.from(DOG_PER_PIXEL).mul(this.basePixelsToBurn.length);
    const afterFee = total.mul(99).div(100);
    return ethers.utils.formatEther(afterFee);
  }

  @computed
  get totalDogToReceiveFromBurn(): string {
    const totalPixels = this.mainnetPixelsToBurn.length + this.basePixelsToBurn.length;
    const totalDog = BigNumber.from(DOG_PER_PIXEL).mul(totalPixels);
    const afterFee = totalDog.mul(99).div(100);
    return ethers.utils.formatEther(afterFee);
  }

  @computed
  get totalDogToLockForClaim(): string {
    return ethers.utils.formatEther(this.totalDogNeeded);
  }

  @computed
  get canClaim(): boolean {
    return this.selectedPixels.length > 0 && !this.isLoading && this.hasSufficientDog;
  }

  @computed
  get isEligible(): boolean {
    return this.totalPixelsEligible > 0;
  }

  // ============================================
  // localStorage Persistence
  // ============================================

  private getStorageKey(): string | null {
    const address = AppStore.web3.address;
    if (!address) return null;
    return `${STORAGE_KEY_PREFIX}${address.toLowerCase()}`;
  }

  private saveToStorage() {
    const key = this.getStorageKey();
    if (!key) return;
    try {
      const value = { burnedMainnet: this.burnedMainnet, burnedBase: this.burnedBase };
      localStorage.setItem(key, JSON.stringify(value));
      log("Saved to storage:", value);
    } catch (e) {
      warn("Failed to save state to localStorage:", e);
    }
  }

  private loadFromStorage(): { burnedMainnet: number[]; burnedBase: number[] } | null {
    const key = this.getStorageKey();
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        log("No stored state found");
        return null;
      }
      const parsed = JSON.parse(raw);
      log("Loaded from storage:", parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  private clearStorage() {
    const key = this.getStorageKey();
    if (!key) return;
    localStorage.removeItem(key);
    log("Storage cleared");
  }

  // ============================================
  // Initialization
  // ============================================

  async init() {
    log("init() address:", AppStore.web3.address);
    this.pushNavigation(ClaimPixelsModalView.Overview);

    runInAction(() => {
      this.isLoading = true;
    });

    try {
      await this.loadEligibility();

      // Restore persisted burn state
      const stored = this.loadFromStorage();
      if (stored) {
        runInAction(() => {
          this.burnedMainnet = stored.burnedMainnet;
          this.burnedBase = stored.burnedBase;
        });
        log("Restored burned state mainnet:", stored.burnedMainnet, "base:", stored.burnedBase);
      }

      // Load DOG balance on Base
      try {
        const dogBal = await AppStore.web3.getDogBalance();
        runInAction(() => {
          this.dogBalanceOnBase = dogBal;
        });
        log("DOG balance on Base:", ethers.utils.formatEther(dogBal), "DOG");
      } catch (e) {
        warn("Failed to load DOG balance:", e);
      }

      // Load claimable pixels from V3 contract
      try {
        await this.loadClaimablePixels();
      } catch (error) {
        warn("Could not load claimable pixels (OK if none reserved yet):", error);
      }

      // Smart routing decision
      log("Routing decision claimable:", this.claimablePixels.length,
        "| pending:", this.pendingReservations.length,
        "| basePixelsToBurn:", this.basePixelsToBurn.length);

      if (this.claimablePixels.length > 0) {
        if (this.basePixelsToBurn.length > 0) {
          log("route: Overview (V2 burn still needed)");
        } else {
          log("route: ReadyToClaim");
          this.destroyNavigation();
          this.pushNavigation(ClaimPixelsModalView.ReadyToClaim);
        }
      } else if (this.pendingReservations.length > 0 && (this.burnedMainnet.length > 0 || this.burnedBase.length > 0)) {
        log("route: WaitingForConfirmation (burn pending on server)");
        this.destroyNavigation();
        this.pushNavigation(ClaimPixelsModalView.WaitingForConfirmation);
        this.startPollingForBurnConfirmation();
      } else {
        log("route: Overview (no actionable state)");
      }

    } catch (error) {
      err("init() failed:", error);
      showErrorToast("Failed to load claim data");
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  async loadEligibility() {
    try {
      const address = AppStore.web3.address;
      log("loadEligibility() address:", address);

      if (!address) {
        warn("No wallet address connected");
        return;
      }

      const data = await AppStore.web3.getMigrationEligibility(address);
      log("Eligibility result mainnet:", data.mainnet, "base:", data.base);

      runInAction(() => {
        this.eligibility = data;
      });
    } catch (error: any) {
      err("loadEligibility() failed:", error.message);
      throw error;
    }
  }

  async loadClaimablePixels() {
    try {
      const allEligibleTokenIds = [
        ...this.eligibility.mainnet,
        ...this.eligibility.base,
      ];

      log("loadClaimablePixels() checking", allEligibleTokenIds.length, "token IDs:", allEligibleTokenIds);

      if (allEligibleTokenIds.length === 0) {
        log("No eligible tokens to check");
        return;
      }

      const result = await AppStore.web3.getReservedTokensForUser(
        AppStore.web3.address!,
        allEligibleTokenIds
      );

      log("getReservedTokensForUser raw result tokenIds:", result.tokenIds.map(t => t.toString()), "burnConfirmed:", result.burnConfirmed);

      const claimablePixels: ReservedPixel[] = [];
      const pendingReservations: ReservedPixel[] = [];

      for (let i = 0; i < result.tokenIds.length; i++) {
        const tokenId = Number(result.tokenIds[i].toString());
        const burnConfirmed = result.burnConfirmed[i];

        if (burnConfirmed) {
          claimablePixels.push({ tokenId, burnConfirmed: true });
        } else {
          pendingReservations.push({ tokenId, burnConfirmed: false });
        }
      }

      log("Claimable (burnConfirmed=true):", claimablePixels.map(p => p.tokenId));
      log("Pending (burnConfirmed=false):", pendingReservations.map(p => p.tokenId));

      runInAction(() => {
        this.claimablePixels = claimablePixels;
        this.pendingReservations = pendingReservations;
        this.selectedPixels = claimablePixels.map(p => p.tokenId);
      });
    } catch (error) {
      err("loadClaimablePixels() failed:", error);
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

    this.pushNavigation(
      network === "mainnet"
        ? ClaimPixelsModalView.BurningMainnet
        : ClaimPixelsModalView.BurningBase
    );

    try {
      const currentChainId = await AppStore.web3.getCurrentChainId();
      const requiredChainId = network === "mainnet"
        ? AppStore.web3.v1ChainId
        : AppStore.web3.v2ChainId;

      log(`confirmBurn() network: ${network}, tokenIds: [${tokenIds}], currentChain: ${currentChainId}, requiredChain: ${requiredChainId}`);

      if (currentChainId !== requiredChainId) {
        log(`Switching to chain ${requiredChainId}...`);
        const switched = await AppStore.web3.switchNetwork(requiredChainId);
        if (!switched) {
          throw new Error(`Please switch to ${AppStore.web3.getNetworkDisplayName(requiredChainId)}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      let tx: ethers.ContractTransaction;
      if (network === "mainnet") {
        tx = await AppStore.web3.burnV1Pixels(tokenIds);
      } else {
        tx = await AppStore.web3.burnV2Pixels(tokenIds);
      }

      log("Burn tx submitted:", tx.hash);
      runInAction(() => {
        this.hasUserSignedTx = true;
        this.txHash = tx.hash;
      });

      showDebugToast(`Burning ${tokenIds.length} pixels...`);

      const receipt = await tx.wait();
      log("Burn confirmed in block:", receipt.blockNumber, "tx:", receipt.transactionHash);

      runInAction(() => {
        if (network === "mainnet") {
          this.burnedMainnet = [...this.burnedMainnet, ...tokenIds];
        } else {
          this.burnedBase = [...this.burnedBase, ...tokenIds];
        }
        this.pendingBurnNetwork = null;
      });

      this.saveToStorage();

      showSuccessToast(`Successfully burned ${tokenIds.length} pixels on ${network === "mainnet" ? "Ethereum" : "Base"}`);

      // Fire-and-forget fast-path verification so polling finds it sooner
      const serverNetwork = AppStore.web3.isTestnet
        ? (network === "mainnet" ? "sepolia" : "base-sepolia")
        : network;
      log("Firing fast-path verify-burns for network:", serverNetwork);
      Http.post("/v1/migration/verify-burns", {
        tokenIds,
        network: serverNetwork,
      })
        .then(res => log("Fast-path verify-burns response:", res.data))
        .catch(e => warn("Fast-path verify-burns failed (polling will catch it):", e.message));

      this.destroyNavigation();
      this.pushNavigation(ClaimPixelsModalView.WaitingForConfirmation);
      this.startPollingForBurnConfirmation();

    } catch (error: any) {
      err("confirmBurn() failed:", error.message);
      Sentry.captureException(error);

      runInAction(() => {
        this.burnError = error.message || "Burn transaction failed";
        this.hasUserSignedTx = false;
      });

      showErrorToast(error.message || "Burn failed");

      this.destroyNavigation();
      this.pushNavigation(ClaimPixelsModalView.Overview);
    }
  }

  // ============================================
  // Polling for Burn Confirmation
  // ============================================

  private pollCount = 0;

  startPollingForBurnConfirmation() {
    this.pollCount = 0;
    log("poll: starting (10s interval)");
    this.pollIntervalId = setInterval(async () => {
      await this.checkBurnConfirmation();
    }, 10000);
    this.checkBurnConfirmation();
  }

  stopPolling() {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
      log("poll: stopped");
    }
  }

  async checkBurnConfirmation() {
    this.pollCount++;
    log(`poll #${this.pollCount}: checking...`);

    try {
      await this.loadClaimablePixels();

      log(`poll #${this.pollCount}: claimable=${this.claimablePixels.length}, pending=${this.pendingReservations.length}, baseStillToBurn=${this.basePixelsToBurn.length}`);

      if (this.claimablePixels.length > 0) {
        this.stopPolling();
        if (this.basePixelsToBurn.length > 0) {
          log("poll: burn confirmed but V2 still needed routing to Overview");
          this.destroyNavigation();
          this.pushNavigation(ClaimPixelsModalView.Overview);
        } else {
          log("poll: all burns confirmed routing to ReadyToClaim");
          AppStore.web3.switchNetwork(AppStore.web3.targetChainId);
          this.destroyNavigation();
          this.pushNavigation(ClaimPixelsModalView.ReadyToClaim);
        }
      } else {
        log(`poll #${this.pollCount}: not confirmed yet, still waiting`);
      }
    } catch (error) {
      err("checkBurnConfirmation() failed:", error);
    }
  }

  // ============================================
  // Claim Flow
  // ============================================

  async handleClaimSubmit() {
    log("claim: handleClaimSubmit() pixels:", this.selectedPixels);

    if (this.selectedPixels.length === 0) {
      showErrorToast("No pixels to claim");
      return;
    }

    // Ensure user is on the V3 network (Base)
    const currentChainId = await AppStore.web3.getCurrentChainId();
    log(`claim: currentChain=${currentChainId}, targetChain=${AppStore.web3.targetChainId}`);

    if (currentChainId !== AppStore.web3.targetChainId) {
      log("claim: switching to target chain...");
      const switched = await AppStore.web3.switchNetwork(AppStore.web3.targetChainId);
      if (!switched) {
        showErrorToast(`Please switch to ${AppStore.web3.getNetworkDisplayName(AppStore.web3.targetChainId)}`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // DOG approval check
    try {
      const allowance = await AppStore.web3.getPxDogSpendAllowance();
      const totalNeeded = this.totalDogNeeded;
      log(`claim: DOG allowance=${ethers.utils.formatEther(allowance)}, needed=${ethers.utils.formatEther(totalNeeded)}, sufficient=${allowance.gte(totalNeeded)}`);

      if (allowance.lt(totalNeeded)) {
        log("claim: approval needed navigating to ApprovingDOG");
        this.pushNavigation(ClaimPixelsModalView.ApprovingDOG);
        const approveTx = await AppStore.web3.approvePxSpendDog(totalNeeded);
        log("claim: approve tx submitted:", approveTx.hash);
        await approveTx.wait();
        log("claim: approve tx confirmed");
      } else {
        log("claim: DOG already approved, skipping approval step");
      }
    } catch (error: any) {
      err("claim: DOG approval failed:", error.message);
      showErrorToast("DOG approval failed: " + (error.message || "Unknown error"));
      return;
    }

    this.pushNavigation(ClaimPixelsModalView.ClaimingPixels);
    await this.claimSelectedPixels();
  }

  async claimSelectedPixels() {
    const BATCH_SIZE = 20;
    const chunks: number[][] = [];
    for (let i = 0; i < this.selectedPixels.length; i += BATCH_SIZE) {
      chunks.push(this.selectedPixels.slice(i, i + BATCH_SIZE));
    }

    runInAction(() => {
      this.claimProgress = { claimed: 0, total: this.selectedPixels.length };
      this.claimBatchErrors = [];
      this.hasUserSignedTx = false;
    });

    const claimedIds: number[] = [];
    log(`claim: ${chunks.length} batch(es) of up to ${BATCH_SIZE}`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      log(`claim: batch ${i + 1}/${chunks.length} tokens: [${chunk}]`);
      try {
        const tx = await AppStore.web3.claimReservedTokensBatch(chunk);
        log(`claim: batch ${i + 1} tx submitted:`, tx.hash);

        runInAction(() => {
          this.hasUserSignedTx = true;
          this.txHash = tx.hash;
        });

        showDebugToast(`Claiming ${chunk.length} pixel(s)...`);
        const receipt = await tx.wait();
        log(`claim: batch ${i + 1} confirmed in block:`, receipt.blockNumber);

        runInAction(() => {
          this.claimProgress.claimed += chunk.length;
        });

        claimedIds.push(...chunk);
      } catch (e: any) {
        err(`claim: batch ${i + 1} failed:`, e.message, "tokens:", chunk);
        runInAction(() => {
          this.claimBatchErrors = [...this.claimBatchErrors, ...chunk];
        });
      }
    }

    log(`claim: done claimed: [${claimedIds}], errors: [${this.claimBatchErrors}]`);

    if (this.claimBatchErrors.length === 0 && claimedIds.length > 0) {
      runInAction(() => {
        this.claimedPixels = claimedIds;
      });
      await AppStore.web3.refreshPixelOwnershipMap();
      await AppStore.web3.refreshPupperBalance();
      this.destroyNavigation();
      this.pushNavigation(ClaimPixelsModalView.Complete);
      showSuccessToast(`Successfully claimed ${claimedIds.length} pixel(s)!`);
      this.clearStorage();
    } else if (claimedIds.length > 0) {
      runInAction(() => {
        this.claimedPixels = claimedIds;
      });
      showErrorToast(`Failed to claim ${this.claimBatchErrors.length} pixel(s). Please retry.`);
      this.destroyNavigation();
      this.pushNavigation(ClaimPixelsModalView.ReadyToClaim);
    } else {
      showErrorToast("Failed to claim any pixels");
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
    this.pendingReservations = [];
    this.selectedPixels = [];
    this.dogBalanceOnBase = null;
    this.claimProgress = { claimed: 0, total: 0 };
    this.claimBatchErrors = [];
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
