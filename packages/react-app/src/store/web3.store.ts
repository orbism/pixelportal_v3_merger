import { Chain } from "@rainbow-me/rainbowkit";
import * as Sentry from "@sentry/react";
import { BigNumber, Contract, ethers } from "ethers";
import { computed, makeObservable, observable, action, reaction, runInAction, override } from "mobx";
import { DOG20, PX } from "../../../hardhat/types";
import { showErrorToast } from "../DSL/Toast/Toast";
import deployedContracts from "../contracts/abi.json";
import {
  LEGACY_PX_ABI,
  CHAIN_IDS,
  NETWORK_NAMES,
  getV1ContractAddress,
  getV2ContractAddress,
  getV1ChainId,
  getV2ChainId,
} from "../contracts/legacyContracts";
import env from "../environment";
import { ObjectKeys } from "../helpers/objects";
import { abbreviate } from "../helpers/strings";
import KobosuJson from "../images/kobosu.json";
import { PixelOwnerInfo } from "../pages/Leaderbork/Leaderbork.store";
import { Http } from "../services";
import LocalStorage from "../services/local-storage";
import { Reactionable } from "../services/mixins/reactionable";
import CowStore from "./cow.store";
import Web3providerStore, { EthersContractError } from "./web3provider.store";

const VIEWED_PIXELS_LS_KEY = "viewed_pixels_by_id";

interface AddressToPuppers {
  [k: string]: {
    tokenIds: number[];
    ens: string | null;
    ud: string | null;
  };
}

class Web3Store extends Reactionable(Web3providerStore) {
  provider: ethers.providers.Web3Provider;
  address: string | null = null;
  ens: string | null = null;

  D20_PRECISION = BigNumber.from("1000000000000000000");
  DOG_TO_PIXEL_SATOSHIS = BigNumber.from("55239898990000000000000");
  PIXEL_TO_ID_OFFSET = 1000000;
  WIDTH = 640;
  HEIGHT = 480;
  DOG_BURN_FEES_PERCENT = 1;
  targetChainId = env.app.targetChainId;
  targetNetworkName = env.app.targetNetworkName;

  @observable
  dogBalance: BigNumber | null = null;
  @action
  setDogBalance(balance: BigNumber) {
    this.dogBalance = balance;
  }

  @observable
  pupperBalance?: number;
  @action
  setPupperBalance(balance: number) {
    this.pupperBalance = balance;
  }

  @observable
  dogContract?: DOG20;

  @observable
  pxContract?: PX;

  @observable
  addressToPuppers?: AddressToPuppers;

  @observable
  pxContractAddress: string;

  @observable
  dogContractAddress: string;

  @observable
  cowStore: CowStore;

  @observable
  usdPerPixel?: number;

  @computed get dogBalanceHumanReadable() {
    return this.dogBalance ? ethers.utils.formatEther(this.dogBalance) : null;
  }

  constructor() {
    super();
    // console.log("Deployed Contracts:", JSON.stringify(deployedContracts, null, 2));
    // console.log("Target Chain ID:", this.targetChainId.toString());
    // console.log("Target Network Name:", this.targetNetworkName);
    console.log("Specific Network Contract Data:", deployedContracts[this.targetChainId.toString()]?.[this.targetNetworkName]);

    makeObservable(this);
    reaction(
      () => this.address,
      address => {
        console.log("Address:", address);
        if (address) {
          // console.log("Address changed:", address);
          this.refreshDogBalance();
          this.refreshPupperBalance();
        }
      },
    );

    // reaction(
    //   () => this.signer,
    //   (signer) => {
    //     if (signer) {
    //       console.log("Signer changed:", signer);
    //       this.connectToContracts(signer);
    //     }
    //   }
    // );

    // makeObservable(this);
    this.addressToPuppers = {};
    this.cowStore = new CowStore();

    // safer contract access
    const chainIdStr = this.targetChainId.toString();
    const chainData = deployedContracts[chainIdStr];
    console.log(`Looking for contracts: chainId=${chainIdStr}, networkName=${this.targetNetworkName}`);
    console.log(`Available chains in abi.json:`, Object.keys(deployedContracts));

    if (chainData && chainData[this.targetNetworkName] && chainData[this.targetNetworkName].contracts) {
      this.pxContractAddress = chainData[this.targetNetworkName].contracts["PX"]?.address || "";
      this.dogContractAddress = chainData[this.targetNetworkName].contracts["DOG20"]?.address || "";
      console.log(`Found contracts: PX=${this.pxContractAddress}, DOG20=${this.dogContractAddress}`);
    } else {
      console.error(`Contract addresses not found for chain ${chainIdStr} / ${this.targetNetworkName}`);
      if (chainData) {
        console.error(`Available networks for chain ${chainIdStr}:`, Object.keys(chainData));
      }
    }

    this.initializeProvider();
    this.init();
    this.connectToContracts(this.provider);
  }

  initializeProvider() {
    return super.initializeProvider();
  }

  @action
  setAddress(newAddress: string) {
    // console.log("Setting new address:", newAddress);
    if (newAddress !== this.address) {
      this.address = newAddress;
      this.refreshSigner();
    }
  }

  refreshSigner() {
    if (this.provider) {
      this.signer = this.provider.getSigner();
      // console.log("Signer refreshed:", this.signer);
    }
  }

  // @action
  // setSigner(newSigner: ethers.Signer | null) {
  //   console.log("Setting new signer:", newSigner);
  //   if (newSigner !== this.signer) {
  //     this.signer = newSigner;
  //   }
  // }

  @override
  get addressForDisplay() {
    return this.abbreviateAddress(this.address);
  }

  abbreviateAddress(address: string | null) {
    if (!address) return "-";
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  private _initialized = false;

  async init() {
    // Guard against double init (constructor calls init, and App.store.init also calls it)
    if (this._initialized) {
      console.log('🚀 Web3Store.init() skipped - already initialized');
      return;
    }
    this._initialized = true;

    console.log('🚀 Web3Store.init() called');
    try {
      await this.getPixelOwnershipMap();
      console.log('✅ Pixel ownership map loaded');
    } catch (error) {
      console.error('❌ Failed to load pixel ownership map:', error);
    }
    this.getShibaDimensions();
    // this.getUSDPerPixel();
  }

  async connect(signer: ethers.Signer, network: Chain, provider: ethers.providers.BaseProvider) {
    try {
      await super.connect(signer, network, provider);
      this.connectToContracts(this.signer!);
      await this.debugContractAddresses();
      await this.errorGuardContracts();
      this.cowStore.connect(this.signer!);
      this.refreshDogBalance();
      this.refreshPupperBalance();
    } catch (e) {
      console.error(e);
      Sentry.captureException(e);
      showErrorToast("Error connecting");
    }
  }

  connectToContracts(signer: any) {
    const px = new Contract(
      this.pxContractAddress,
      deployedContracts[this.targetChainId.toString()][this.targetNetworkName]["contracts"]["PX"].abi,
      signer,
    ) as unknown;
    this.pxContract = px as PX;

    const dog = new Contract(
      this.dogContractAddress,
      deployedContracts[this.targetChainId.toString()][this.targetNetworkName]["contracts"]["DOG20"].abi,
      signer,
    ) as unknown;
    this.dogContract = dog as DOG20;

    // console.log("Contracts initialized:", { PX: this.pxContract, DOG20: this.dogContract });

    //@ts-ignore
    window.__PX__ = px;
    //@ts-ignore
    window.__DOG20__ = dog;
  }

  async debugContractAddresses() {
    const res = await Http.get("/v1/contract/addresses");
    const { dog: dogAddress, pixel: pixelAddress } = res.data;

    if (dogAddress !== this.dogContractAddress) {
      throw Error(`Frontend (${this.dogContractAddress}) and API (${dogAddress}) DOG addresses do not match`);
    }

    if (pixelAddress !== this.pxContractAddress) {
      throw Error(`Frontend (${this.pxContractAddress}) and API (${pixelAddress}) PIXEL addresses do not match`);
    }

    console.log(`api connected to pixel contract: ${pixelAddress}`);
    console.log(`frontend connected to pixel contract: ${this.pxContractAddress}`);

    console.log(`api connected to DOG contract: ${dogAddress}`);
    console.log(`frontend connected to DOG contract: ${this.dogContractAddress}`);
  }

  async errorGuardContracts() {
    const nonContractCode = "0x";
    const pxCode = await this.provider.getCode(this.pxContractAddress);
    if (pxCode === nonContractCode) {
      await this.disconnect();
      throw Error(
        `PX address is not a contract, please make sure it is deployed & you are on the correct network. Got ${pxCode} ${this.network?.name} ${this.pxContractAddress}`,
      );
    }
    const dogCode = await this.provider.getCode(this.dogContractAddress);
    if (dogCode === nonContractCode) {
      await this.disconnect();
      throw Error("DOG20 address is not a contract, please make sure it is deployed & you are on the correct network.");
    }
  }

  async getPixelOwnershipMap() {
    console.log('📡 Fetching pixel ownership map from server...');
    console.log('📡 Current address:', this.address);
    console.log('📡 API endpoint:', Http.defaults?.baseURL || 'unknown');
    
    try {
      const response = await Http.get("/v1/config");
      const data = response.data;
      
      console.log('✅ Pixel ownership data received');
      console.log('✅ Response type:', typeof data);
      console.log('✅ Response keys:', Object.keys(data));
      console.log('✅ Number of addresses with pixels:', Object.keys(data).length);
      console.log('✅ All addresses with pixels:', Object.keys(data));
      console.log('🔍 Your address:', this.address);
      console.log('🔍 Your address pixels:', data[this.address]);
      console.log('🔍 Your address pixels (lowercase):', data[this.address?.toLowerCase()]);
      console.log('📊 Full data:', JSON.stringify(data, null, 2));
      
      this.addressToPuppers = data;
      return data;
    } catch (error) {
      console.error('❌ Failed to fetch pixel ownership:', error);
      console.error('❌ Error details:', error.message);
      if (error.response) {
        console.error('❌ Response status:', error.response.status);
        console.error('❌ Response data:', error.response.data);
      }
      throw error;
    }
  }

  refreshPixelOwnershipMap() {
    console.log('🔄 Refreshing pixel ownership map...');
    return Http.get("/v1/config/refresh").then(({ data }) => {
      console.log('✅ Pixel ownership refreshed:', data);
      this.addressToPuppers = data;
      return data;
    });
  }

  getShibaDimensions() {
    return Http.get("/v1/px/dimensions").then(({ data }) => {
      this.WIDTH = data.width;
      this.HEIGHT = data.height;
    });
  }

  @computed
  get puppersOwned() {
    let myPuppers: number[] = [];
    if (this.address && this.address in this.addressToPuppers!) {
      myPuppers = this.addressToPuppers![this.address].tokenIds;
    }
    // Debug logging
    console.log('🔍 puppersOwned check:', {
      address: this.address,
      addressToPuppers: this.addressToPuppers,
      myPuppers: myPuppers,
      length: myPuppers.length
    });
    return myPuppers;
  }

  async refreshDogBalance() {
    try {
      const balance = await this.getDogBalance();
      this.setDogBalance(balance);
    } catch (e) {
      console.error("Failed to refresh DOG balance:", e);
      showErrorToast("Failed to fetch DOG balance");
      this.setDogBalance(BigNumber.from(0)); // set zero if error
    }
  }

  async refreshPupperBalance() {
    try {
      const balance = await this.getPupperBalance();
      this.setPupperBalance(balance);
    } catch (e) {
      const { message } = e as EthersContractError;
      this.setPupperBalance(0);
      showErrorToast(message);
    }
  }

  async getDogBalance() {
    // console.log("Checking DOG20 contract initialization:", this.dogContract);
    // console.log("Current address:", this.address);
    if (!this.dogContract) {
      console.error("DOG20 contract not initialized.");
      return BigNumber.from(0);
    }

    try {
      if (!this.address) return BigNumber.from(0);

      const balance = await this.dogContract.balanceOf(this.address!);
      return balance;
    } catch (error) {
      console.error("Failed to fetch DOG balance:", error);
      return BigNumber.from(0);
    }
  }

  async getPupperBalance() {
    if (!this.address) return 0;

    try {
      const res = await Http.get(`/v1/px/balance/${this.address}`);
      console.log('✅ Pupper balance from API:', res.data.balance);
      return res.data.balance;
    } catch (error) {
      console.error('❌ Failed to fetch pupper balance:', error);
      return 0;
    }
  }

  async getPxOwnerByTokenId(tokenId: number) {
    const res = await Http.get(`/v1/px/owner/${tokenId}`);
    return res.data.address;
  }

  async approvePxSpendDog(amount: BigNumber) {
    return this.dogContract!.approve(this.pxContractAddress, amount);
  }

  async getPxDogSpendAllowance() {
    return this.dogContract!.allowance(this.address!, this.pxContractAddress);
  }

  async getDogToAccount() {
    const freePixelsInDOG = 50;
    //@ts-ignore
    return this.dogContract!.initMock([this.address!], this.DOG_TO_PIXEL_SATOSHIS.mul(freePixelsInDOG));
  }

  async getDogLocked() {
    console.log(`Fetching locked DOG balance from contract address: ${this.dogContractAddress}`);
    const res = await Http.get("/v1/dog/locked");
    return res.data.balance;
  }

  // getPercentDogInPixels() {
  //   console.log(`Fetching percentage of DOG in pixels from contract address: ${this.dogContractAddress}`);
  //   return Http.get<number>("/v1/dog/percentLocked");
  // }

  mintPuppers(pixel_amount: number, forcedGasLimit?: BigNumber) {
    let overrides: any = {};
    if (forcedGasLimit) {
      overrides = { gasLimit: forcedGasLimit };
    }
    // New Foundry contract requires tokenAddress as second parameter
    return this.pxContract!.mintPuppers(pixel_amount, this.dogContractAddress, overrides);
  }

  pupperToPixelCoords(pupper: number) {
    return this.pxContract!.pupperToPixelCoords(pupper);
  }

  burnPupper(pupper: number) {
    return this.pxContract!.burnPuppers([pupper]);
  }

  burnPuppers(puppers: number[]) {
    return this.pxContract!.burnPuppers(puppers);
  }

  // Claim reserved pixels (V1/V2 migration)
  async getReservedTokensForUser(address: string, tokenIdsToCheck: number[]) {
    if (!this.pxContract) {
      throw new Error("PX contract not initialized");
    }
    return this.pxContract.getReservedTokensForUser(address, tokenIdsToCheck);
  }

  async claimReservedToken(tokenId: number) {
    if (!this.pxContract) {
      throw new Error("PX contract not initialized");
    }
    // Use simple claim version (uses default DOG20 token)
    return this.pxContract.claimReservedToken(tokenId);
  }

  async canClaimReservedToken(tokenId: number, user: string) {
    if (!this.pxContract) {
      throw new Error("PX contract not initialized");
    }
    return this.pxContract.canClaimReservedToken(tokenId, user);
  }

  pupperToIndexLocal(pupper: number) {
    return pupper - this.PIXEL_TO_ID_OFFSET;
  }

  pupperToPixelCoordsLocal(pupper: number) {
    const index = this.pupperToIndexLocal(pupper);
    return [index % this.WIDTH, Math.floor(index / this.WIDTH)];
  }

  pupperToHexLocal(pupper: number) {
    const [x, y] = this.pupperToPixelCoordsLocal(pupper);
    return KobosuJson[y][x];
  }

  coordinateToPupperLocal(x: number, y: number) {
    return this.WIDTH * y + x + this.PIXEL_TO_ID_OFFSET;
  }

  isPixelIDValid(id: number) {
    const max = this.WIDTH * this.HEIGHT + this.PIXEL_TO_ID_OFFSET - 1;
    const min = this.PIXEL_TO_ID_OFFSET;
    if (id < min || id > max) {
      return false;
    }
    return true;
  }

  getUSDPerPixel() {
    return Http.get("/v1/px/price").then(({ data }) => {
      this.usdPerPixel = data.price;
    });
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

  getIsPupperNew(pupper: number) {
    const data = LocalStorage.getItem(VIEWED_PIXELS_LS_KEY, LocalStorage.PARSE_JSON, []);
    let isNew = true;
    if (data.includes(pupper)) {
      isNew = false;
    }
    return isNew;
  }

  setPupperSeen(pupper: number) {
    const data = LocalStorage.getItem(VIEWED_PIXELS_LS_KEY, LocalStorage.PARSE_JSON, []);
    if (!data.includes(pupper)) {
      data.push(pupper);
    }
    LocalStorage.setItem(VIEWED_PIXELS_LS_KEY, data);
  }

  getAddressDisplayName(address: string, shouldAbbreviate = true) {
    if (Object.keys(this.addressToPuppers).includes(address)) {
      const user = this.addressToPuppers[address];
      if (user.ens) {
        return user.ens;
      }
      return shouldAbbreviate ? abbreviate(address, 4) : address;
    } else {
      // @next -- we need to query for ENS or UD here
      return shouldAbbreviate ? abbreviate(address, 4) : address;
    }
  }

  signMessage(message: string) {
    return this.signer.signMessage(message);
  }

  getGlobalTransfers() {
    return Http.post("/v1/transfers", {
      sort: {
        blockNumber: "desc",
      },
    }).then(({ data }) => {
      return data;
    });
  }

  getUserTransfers(address: string) {
    return Http.post(`/v1/transfers/${address}`, {
      sort: {
        blockNumber: "desc",
      },
    }).then(({ data }) => {
      return data;
    });
  }

  // ============================================
  // V1/V2 Legacy Contract Methods for Migration
  // ============================================

  /**
   * Check if current environment is testnet
   */
  get isTestnet(): boolean {
    return this.targetChainId === CHAIN_IDS.BASE_SEPOLIA || this.targetChainId === 1337 || this.targetChainId === 31337;
  }

  /**
   * Get V1 contract address based on environment
   */
  get v1ContractAddress(): string {
    return getV1ContractAddress(this.isTestnet);
  }

  /**
   * Get V2 contract address based on environment
   */
  get v2ContractAddress(): string {
    return getV2ContractAddress(this.isTestnet);
  }

  /**
   * Get V1 chain ID based on environment
   */
  get v1ChainId(): number {
    return getV1ChainId(this.isTestnet);
  }

  /**
   * Get V2 chain ID based on environment
   */
  get v2ChainId(): number {
    return getV2ChainId(this.isTestnet);
  }

  /**
   * Get network display name for a chain ID
   */
  getNetworkDisplayName(chainId: number): string {
    return NETWORK_NAMES[chainId as keyof typeof NETWORK_NAMES] || `Chain ${chainId}`;
  }

  /**
   * Request wallet to switch to a specific network
   */
  async switchNetwork(chainId: number): Promise<boolean> {
    try {
      // @ts-ignore - ethereum is injected by wallet
      await window.ethereum?.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      });
      return true;
    } catch (error: any) {
      // 4902 = chain not added to wallet
      if (error.code === 4902) {
        console.log("Chain not added to wallet, need to add it first");
        // Could add chain here if needed
      }
      console.error("Failed to switch network:", error);
      return false;
    }
  }

  /**
   * Get current wallet chain ID
   */
  async getCurrentChainId(): Promise<number | null> {
    try {
      // @ts-ignore - ethereum is injected by wallet
      const chainIdHex = await window.ethereum?.request({ method: "eth_chainId" });
      return chainIdHex ? parseInt(chainIdHex, 16) : null;
    } catch (error) {
      console.error("Failed to get current chain ID:", error);
      return null;
    }
  }

  /**
   * Create a contract instance for V1 (Ethereum Mainnet/Sepolia)
   * Uses the connected wallet's signer
   */
  getV1Contract(): Contract {
    if (!this.signer) {
      throw new Error("Wallet not connected");
    }
    return new Contract(this.v1ContractAddress, LEGACY_PX_ABI, this.signer);
  }

  /**
   * Create a contract instance for V2 (Base/Base Sepolia)
   * Uses the connected wallet's signer
   */
  getV2Contract(): Contract {
    if (!this.signer) {
      throw new Error("Wallet not connected");
    }
    return new Contract(this.v2ContractAddress, LEGACY_PX_ABI, this.signer);
  }

  /**
   * Burn pixels on V1 contract (Ethereum)
   * User must be on Ethereum network
   * @param tokenIds Array of pixel token IDs to burn
   */
  async burnV1Pixels(tokenIds: number[]): Promise<ethers.ContractTransaction> {
    const currentChainId = await this.getCurrentChainId();
    if (currentChainId !== this.v1ChainId) {
      throw new Error(`Please switch to ${this.getNetworkDisplayName(this.v1ChainId)} to burn V1 pixels`);
    }

    const contract = this.getV1Contract();
    console.log(`Burning ${tokenIds.length} pixels on V1:`, tokenIds);
    return contract.burnPuppers(tokenIds);
  }

  /**
   * Burn pixels on V2 contract (Base)
   * User must be on Base network
   * @param tokenIds Array of pixel token IDs to burn
   */
  async burnV2Pixels(tokenIds: number[]): Promise<ethers.ContractTransaction> {
    const currentChainId = await this.getCurrentChainId();
    if (currentChainId !== this.v2ChainId) {
      throw new Error(`Please switch to ${this.getNetworkDisplayName(this.v2ChainId)} to burn V2 pixels`);
    }

    const contract = this.getV2Contract();
    console.log(`Burning ${tokenIds.length} pixels on V2:`, tokenIds);
    return contract.burnPuppers(tokenIds);
  }

  /**
   * Fetch migration eligibility from server
   * Returns pixel IDs grouped by network that user is eligible to claim
   */
  async getMigrationEligibility(address: string): Promise<{ mainnet: number[]; base: number[] }> {
    try {
      const response = await Http.get(`/v1/migration/eligible/${address}`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch migration eligibility:", error);
      // Return empty if endpoint not available yet
      return { mainnet: [], base: [] };
    }
  }
}

export default Web3Store;
