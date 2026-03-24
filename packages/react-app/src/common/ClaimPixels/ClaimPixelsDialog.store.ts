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
  AlreadyClaimed = "already_claimed",
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
const BURN_BATCH_SIZE = 20;
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

  // Burn batch progress tracking
  @observable
  burnProgress = { burned: 0, total: 0, batch: 0, totalBatches: 0 };

  // Claim batch info for UI
  @observable
  claimBatchInfo = { batch: 0, totalBatches: 0 };

  // Claim retry mode — only retry failed pixels
  @observable
  isRetryMode = false;

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
    const count = this.isRetryMode ? this.claimBatchErrors.length : this.claimablePixels.length;
    return BigNumber.from(DOG_PER_PIXEL).mul(count);
  }

  @computed
  get hasSufficientDog(): boolean {
    if (this.dogBalanceOnBase === null) return false;
    const count = this.isRetryMode ? this.claimBatchErrors.length : this.claimablePixels.length;
    if (count === 0) return true;
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

  @computed
  get mainnetPixelsClaimedOnV3(): number[] {
    const owned = new Set(AppStore.web3.puppersOwned);
    return this.eligibility.mainnet.filter(id => owned.has(id));
  }

  @computed
  get basePixelsClaimedOnV3(): number[] {
    const owned = new Set(AppStore.web3.puppersOwned);
    return this.eligibility.base.filter(id => owned.has(id));
  }

  @computed
  get allMainnetClaimedOnV3(): boolean {
    return this.eligibility.mainnet.length > 0 &&
      this.mainnetPixelsClaimedOnV3.length === this.eligibility.mainnet.length;
  }

  @computed
  get allBaseClaimedOnV3(): boolean {
    return this.eligibility.base.length > 0 &&
      this.basePixelsClaimedOnV3.length === this.eligibility.base.length;
  }

  // ============================================
  // localStorage Persistence
  // ============================================

  private getStorageKey(): string | null {
    const address = AppStore.web3.address;
    if (!address) return null;
    return `${STORAGE_KEY_PREFIX}${address.toLowerCase()}`;
  }

  private saveToStorage(extra?: { claimed: true; claimedIds: number[] }) {
    const key = this.getStorageKey();
    if (!key) return;
    try {
      const value = {
        burnedMainnet: this.burnedMainnet,
        burnedBase: this.burnedBase,
        ...(extra ?? {}),
      };
      localStorage.setItem(key, JSON.stringify(value));
      log("Saved to storage:", value);
    } catch (e) {
      warn("Failed to save state to localStorage:", e);
    }
  }

  private loadFromStorage(): {
    burnedMainnet: number[];
    burnedBase: number[];
    claimed?: boolean;
    claimedIds?: number[];
  } | null {
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
      log(`Eligibility loaded — mainnet: [${this.eligibility.mainnet.join(',')}] (${this.eligibility.mainnet.length} tokens) | base: [${this.eligibility.base.join(',')}] (${this.eligibility.base.length} tokens)`);

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

      // Reconcile burn state with V3 on-chain ownership.
      // Pending reservations with burnConfirmed=false may be stale post-mint records (the contract
      // resets burnConfirmed after minting). If the pending token is already owned on V3, it was
      // burned+claimed — update burnedBase/burnedMainnet so Overview displays it correctly,
      // and so routing can trust the burn-state arrays.
      const ownedOnV3 = new Set(AppStore.web3.puppersOwned);

      // Fallback: if server index hasn't populated puppersOwned yet, check the contract directly
      // for the subset of tokens in pendingReservations (cheap — only the pending IDs)
      if (ownedOnV3.size === 0 && this.pendingReservations.length > 0 && AppStore.web3.address) {
        try {
          const pendingIds = this.pendingReservations.map(p => p.tokenId);
          const directOwned = await AppStore.web3.getOwnedEligibleV3Tokens(pendingIds, AppStore.web3.address);
          for (const id of directOwned) ownedOnV3.add(id);
        } catch (e) {
          warn("Could not check V3 contract ownership for pending tokens:", e);
        }
      }

      const newBurnedBase = [...this.burnedBase];
      const newBurnedMainnet = [...this.burnedMainnet];
      for (const p of this.pendingReservations) {
        if (ownedOnV3.has(p.tokenId)) {
          if (this.eligibility.base.includes(p.tokenId) && !newBurnedBase.includes(p.tokenId)) {
            newBurnedBase.push(p.tokenId);
          }
          if (this.eligibility.mainnet.includes(p.tokenId) && !newBurnedMainnet.includes(p.tokenId)) {
            newBurnedMainnet.push(p.tokenId);
          }
        }
      }
      if (newBurnedBase.length !== this.burnedBase.length || newBurnedMainnet.length !== this.burnedMainnet.length) {
        runInAction(() => {
          this.burnedBase = newBurnedBase;
          this.burnedMainnet = newBurnedMainnet;
        });
        log("Inferred burned tokens from V3 ownership:", { newBurnedBase, newBurnedMainnet });
        this.saveToStorage();
      }

      // Smart routing decision
      // Key insight: pendingReservations contains ALL pre-reserved tokens with burnConfirmed=false,
      // including tokens the user NEVER burned. Only tokens that also appear in burnedMainnet/burnedBase
      // are genuinely pending burn verification.
      const genuinelyPendingBurn = this.pendingReservations.filter(p =>
        this.burnedMainnet.includes(p.tokenId) || this.burnedBase.includes(p.tokenId)
      );
      log("Routing decision claimable:", this.claimablePixels.length,
        "| genuinelyPendingBurn:", genuinelyPendingBurn.map(p => p.tokenId),
        "| pre-reserved (not burned):", this.pendingReservations.filter(p =>
          !this.burnedMainnet.includes(p.tokenId) && !this.burnedBase.includes(p.tokenId)
        ).map(p => p.tokenId),
        "| mainnetPixelsToBurn:", this.mainnetPixelsToBurn.length,
        "| basePixelsToBurn:", this.basePixelsToBurn.length);

      if (this.claimablePixels.length > 0) {
        if (this.mainnetPixelsToBurn.length > 0 || this.basePixelsToBurn.length > 0) {
          log("route: Overview (claimable exists + tokens still to burn)");
        } else {
          log("route: ReadyToClaim (all burned, claimable ready)");
          this.destroyNavigation();
          this.pushNavigation(ClaimPixelsModalView.ReadyToClaim);
        }
      } else if (genuinelyPendingBurn.length > 0) {
        // User burned tokens that haven't been swept yet — OR stale post-mint records
        const allEligible = [...this.eligibility.mainnet, ...this.eligibility.base];
        const serverClaimed = allEligible.length > 0 && allEligible.every(id => ownedOnV3.has(id));

        if (serverClaimed) {
          log("route: AlreadyClaimed (all eligible owned on V3)");
          this.destroyNavigation();
          this.pushNavigation(ClaimPixelsModalView.AlreadyClaimed);
        } else {
          const genuinelyPendingIds = genuinelyPendingBurn.map(p => p.tokenId);
          const allGenuinePendingAreStale = genuinelyPendingIds.every(id => ownedOnV3.has(id));

          if (allGenuinePendingAreStale && (this.mainnetPixelsToBurn.length > 0 || this.basePixelsToBurn.length > 0)) {
            log("route: Overview (genuine pending all stale, tokens remain to burn)");
            this.destroyNavigation();
            this.pushNavigation(ClaimPixelsModalView.Overview);
          } else if (allGenuinePendingAreStale) {
            log("route: AlreadyClaimed (genuine pending all stale, all burned)");
            this.destroyNavigation();
            this.pushNavigation(ClaimPixelsModalView.AlreadyClaimed);
          } else {
            log("route: WaitingForConfirmation (genuinely burned tokens pending verification)");
            this.destroyNavigation();
            this.pushNavigation(ClaimPixelsModalView.WaitingForConfirmation);
            this.startPollingForBurnConfirmation();
          }
        }
      } else {
        // No claimable, no genuinely pending burns
        const allEligible = [...this.eligibility.mainnet, ...this.eligibility.base];
        const ownedOnV3Check = new Set(AppStore.web3.puppersOwned);
        const serverClaimed = allEligible.length > 0 && allEligible.every(id => ownedOnV3Check.has(id));

        let contractClaimed = false;
        if (!serverClaimed && allEligible.length > 0 && AppStore.web3.address) {
          const owned = await AppStore.web3.getOwnedEligibleV3Tokens(allEligible, AppStore.web3.address);
          contractClaimed = owned.length === allEligible.length;
        }

        if (serverClaimed || contractClaimed) {
          log("route: AlreadyClaimed", serverClaimed ? "(server)" : "(contract)");
          this.destroyNavigation();
          this.pushNavigation(ClaimPixelsModalView.AlreadyClaimed);
        } else {
          log("route: Overview (default — show burn/claim sections)");
        }
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

    const BATCH_SIZE = 20;
    const network = this.pendingBurnNetwork;
    const tokenIds = network === "mainnet" ? [...this.mainnetPixelsToBurn] : [...this.basePixelsToBurn];

    if (tokenIds.length === 0) {
      showErrorToast("No pixels to burn on this network");
      return;
    }

    // Chunk into batches
    const chunks: number[][] = [];
    for (let i = 0; i < tokenIds.length; i += BATCH_SIZE) {
      chunks.push(tokenIds.slice(i, i + BATCH_SIZE));
    }

    runInAction(() => {
      this.hasUserSignedTx = false;
      this.burnError = null;
      this.burnProgress = { burned: 0, total: tokenIds.length, batch: 0, totalBatches: chunks.length };
    });

    this.pushNavigation(
      network === "mainnet"
        ? ClaimPixelsModalView.BurningMainnet
        : ClaimPixelsModalView.BurningBase
    );

    try {
      // Network switch happens ONCE before the batch loop
      const currentChainId = await AppStore.web3.getCurrentChainId();
      const requiredChainId = network === "mainnet"
        ? AppStore.web3.v1ChainId
        : AppStore.web3.v2ChainId;

      log(`confirmBurn() network: ${network}, tokenIds: [${tokenIds}] (${chunks.length} batches), currentChain: ${currentChainId}, requiredChain: ${requiredChainId}`);

      if (currentChainId !== requiredChainId) {
        log(`Switching to chain ${requiredChainId}...`);
        AppStore.web3.isIntentionalNetworkSwitch = true;
        const switched = await AppStore.web3.switchNetwork(requiredChainId);
        if (!switched) {
          AppStore.web3.isIntentionalNetworkSwitch = false;
          throw new Error(`Please switch to ${AppStore.web3.getNetworkDisplayName(requiredChainId)}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Set intentional switch flag for the entire batch loop
      AppStore.web3.isIntentionalNetworkSwitch = true;

      try {
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          log(`burn batch ${i + 1}/${chunks.length} tokens: [${chunk}]`);

          runInAction(() => {
            this.hasUserSignedTx = false;
            this.burnProgress.batch = i + 1;
          });

          let tx: ethers.ContractTransaction;
          if (network === "mainnet") {
            tx = await AppStore.web3.burnV1Pixels(chunk);
          } else {
            tx = await AppStore.web3.burnV2Pixels(chunk);
          }

          log(`burn batch ${i + 1} tx submitted:`, tx.hash);
          runInAction(() => {
            this.hasUserSignedTx = true;
            this.txHash = tx.hash;
          });

          showDebugToast(`Burning batch ${i + 1}/${chunks.length}...`);

          const receipt = await tx.wait();
          log(`burn batch ${i + 1} confirmed in block:`, receipt.blockNumber);

          runInAction(() => {
            this.burnProgress.burned += chunk.length;
            if (network === "mainnet") {
              this.burnedMainnet = [...this.burnedMainnet, ...chunk];
            } else {
              this.burnedBase = [...this.burnedBase, ...chunk];
            }
          });

          // Save after each batch for crash resilience
          this.saveToStorage();
        }
      } finally {
        AppStore.web3.isIntentionalNetworkSwitch = false;
      }

      runInAction(() => {
        this.pendingBurnNetwork = null;
      });

      showSuccessToast(`Successfully burned ${tokenIds.length} pixels on ${network === "mainnet" ? "Ethereum" : "Base"}`);

      // Fire-and-forget fast-path verification with ALL tokenIds
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

      // Partial progress already saved — remaining pixels still in pixelsToBurn computed
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
    log("poll: starting (30s interval)");
    this.pollIntervalId = setInterval(async () => {
      await this.checkBurnConfirmation();
    }, 30000);
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
        if (this.mainnetPixelsToBurn.length > 0 || this.basePixelsToBurn.length > 0) {
          log("poll: burn confirmed but pixels still unburned on other network — routing to Overview");
          this.destroyNavigation();
          this.pushNavigation(ClaimPixelsModalView.Overview);
        } else {
          log("poll: all burns confirmed routing to ReadyToClaim");
          AppStore.web3.switchNetwork(AppStore.web3.targetChainId);
          this.destroyNavigation();
          this.pushNavigation(ClaimPixelsModalView.ReadyToClaim);
        }
      } else {
        // Filter to genuinely burned tokens (appear in localStorage burn records)
        const genuinelyPending = this.pendingReservations.filter(p =>
          this.burnedMainnet.includes(p.tokenId) || this.burnedBase.includes(p.tokenId)
        );
        const genuinelyPendingIds = genuinelyPending.map(p => p.tokenId);
        const ownedOnV3 = new Set(AppStore.web3.puppersOwned);
        const allGenuinePendingAreStale = genuinelyPendingIds.length > 0 &&
          genuinelyPendingIds.every(id => ownedOnV3.has(id));

        if (allGenuinePendingAreStale && (this.mainnetPixelsToBurn.length > 0 || this.basePixelsToBurn.length > 0)) {
          this.stopPolling();
          log("poll: genuinely pending all stale, tokens remain — Overview");
          this.destroyNavigation();
          this.pushNavigation(ClaimPixelsModalView.Overview);
        } else if (genuinelyPendingIds.length === 0) {
          // All pending are pre-reserved (not burned) — shouldn't be polling, escape
          this.stopPolling();
          log("poll: no genuinely pending burns, escaping to Overview");
          this.destroyNavigation();
          this.pushNavigation(ClaimPixelsModalView.Overview);
        } else {
          log(`poll: genuinely pending burns not confirmed yet, still waiting`);
        }
      }
    } catch (error) {
      err("checkBurnConfirmation() failed:", error);
    }
  }

  // ============================================
  // Claim Flow
  // ============================================

  @action
  clearRetryMode() {
    this.isRetryMode = false;
    this.claimBatchErrors = [];
    this.selectedPixels = this.claimablePixels.map(p => p.tokenId);
  }

  async handleClaimSubmit() {
    // In retry mode, only claim the previously failed pixels
    const pixelsToProcess = this.isRetryMode ? [...this.claimBatchErrors] : [...this.selectedPixels];
    log("claim: handleClaimSubmit() pixels:", pixelsToProcess, "retryMode:", this.isRetryMode);

    if (pixelsToProcess.length === 0) {
      showErrorToast("No pixels to claim");
      return;
    }

    // Update selectedPixels to match what we're actually processing
    runInAction(() => {
      this.selectedPixels = pixelsToProcess;
      if (this.isRetryMode) {
        this.claimBatchErrors = [];
        this.isRetryMode = false;
      }
    });

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
      const lockAmountPerPixel = await AppStore.web3.getPxLockAmountPerPixel();
      const totalNeeded = lockAmountPerPixel.mul(this.selectedPixels.length);
      log(`claim: DOG allowance=${ethers.utils.formatEther(allowance)}, needed=${ethers.utils.formatEther(totalNeeded)}, sufficient=${allowance.gte(totalNeeded)}`);

      if (allowance.lt(totalNeeded)) {
        log("claim: approval needed navigating to ApprovingDOG");
        this.pushNavigation(ClaimPixelsModalView.ApprovingDOG);
        const approveTx = await AppStore.web3.approvePxSpendDog(totalNeeded);
        log("claim: approve tx submitted:", approveTx.hash);
        await approveTx.wait();
        log("claim: approve tx confirmed");

        // Re-verify allowance before proceeding — guards against stale nonce on Base
        // (fast blocks mean the node may not have indexed the approval block yet)
        let verifiedAllowance = BigNumber.from(0);
        for (let attempt = 1; attempt <= 5; attempt++) {
          await new Promise(r => setTimeout(r, 1000));
          verifiedAllowance = await AppStore.web3.getPxDogSpendAllowance();
          log(`claim: allowance check attempt ${attempt}/5: ${ethers.utils.formatEther(verifiedAllowance)}`);
          if (verifiedAllowance.gte(totalNeeded)) break;
        }
        if (verifiedAllowance.lt(totalNeeded)) {
          throw new Error("DOG approval not reflected on-chain after retries — please try again");
        }
        log("claim: allowance verified, proceeding to claim");
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
      this.claimBatchInfo = { batch: 0, totalBatches: chunks.length };
      this.claimBatchErrors = [];
      this.hasUserSignedTx = false;
    });

    const claimedIds: number[] = [];
    log(`claim: ${chunks.length} batch(es) of up to ${BATCH_SIZE}`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      log(`claim: batch ${i + 1}/${chunks.length} tokens: [${chunk}]`);

      runInAction(() => {
        this.hasUserSignedTx = false;
        this.claimBatchInfo.batch = i + 1;
      });

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
      try {
        await AppStore.web3.refreshPixelOwnershipMap();
        await AppStore.web3.refreshPupperBalance();
      } catch (refreshErr: any) {
        err("claim: post-claim refresh failed (non-fatal):", refreshErr.message);
      }
      this.destroyNavigation();
      this.pushNavigation(ClaimPixelsModalView.Complete);
      showSuccessToast(`Successfully claimed ${claimedIds.length} pixel(s)!`);
      this.saveToStorage({ claimed: true, claimedIds: claimedIds });
    } else if (claimedIds.length > 0) {
      runInAction(() => {
        this.claimedPixels = claimedIds;
        this.isRetryMode = true;
      });
      showErrorToast(`Failed to claim ${this.claimBatchErrors.length} pixel(s). Please retry.`);
      this.destroyNavigation();
      this.pushNavigation(ClaimPixelsModalView.ReadyToClaim);
    } else {
      runInAction(() => {
        this.isRetryMode = true;
      });
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
    this.burnProgress = { burned: 0, total: 0, batch: 0, totalBatches: 0 };
    this.claimBatchInfo = { batch: 0, totalBatches: 0 };
    this.isRetryMode = false;
    this.stopPolling();
    this.destroyNavigation();
  }

  destroy() {
    this.reset();
    return this.disposeReactions();
  }
}

export default ClaimPixelsDialogStore;
