import { Chain } from "@rainbow-me/rainbowkit";
import * as Sentry from "@sentry/react";
import { BigNumber, Contract, ethers } from "ethers";
import { computed, makeObservable, observable, action, reaction, runInAction, override } from "mobx";
import { DOG20, PX } from "../../../hardhat/types";
import { showErrorToast } from "../DSL/Toast/Toast";
import deployedContracts from "../contracts/hardhat_contracts.json";
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
    console.log("Specific Network Contract Data:", deployedContracts[this.targetChainId]?.[this.targetNetworkName]);

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
    const chainData = deployedContracts[this.targetChainId.toString()];
    if (chainData && chainData[this.targetNetworkName] && chainData[this.targetNetworkName].contracts) {
      this.pxContractAddress = chainData[this.targetNetworkName].contracts["PX"].address || "";
      this.dogContractAddress = chainData[this.targetNetworkName].contracts["DOG20"].address || "";
    } else {
      console.error("Contract addresses not found for the specified chain ID and network name.");
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

  init() {
    this.getPixelOwnershipMap();
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

  getPixelOwnershipMap() {
    return Http.get("/v1/config").then(({ data }) => (this.addressToPuppers = data));
  }

  refreshPixelOwnershipMap() {
    return Http.get("/v1/config/refresh").then(({ data }) => (this.addressToPuppers = data));
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
    if (!this.address) return BigNumber.from(0);

    const res = await Http.get(`/v1/px/balance/${this.address}`);
    return res.data.balance;
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
}

export default Web3Store;
