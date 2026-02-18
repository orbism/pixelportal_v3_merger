import { HttpService } from '@nestjs/axios';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { TokenType } from '@prisma/client';
import { Provider, Signer, WebSocketProvider, ethers } from 'ethers';
import { Configuration } from '../config/configuration';
import * as KobosuJson from '../constants/kobosu.json';
import * as ABI from '../contracts/abi.json';
import * as contractData from '../contracts/abi.json';
import { CurrencyService } from '../currency/currency.service';
import { EthersService } from '../ethers/ethers.service';
import { Events, PixelTransferEventPayload } from '../events';
import { PixelTransferService } from '../pixel-transfer/pixel-transfer.service';
import { PrismaService } from '../prisma.service';
import { stringify } from '../utils';

@Injectable()
export class OwnTheDogeContractService implements OnModuleInit {
  private readonly logger = new Logger(OwnTheDogeContractService.name);
  private pxContract: ethers.Contract;
  private dogContract: ethers.Contract;
  private pxContractAddress: string;
  private dogContractAddress: string;
  private dripDogSigner: ethers.Wallet;
  private burnVerificationSigner: ethers.Wallet;

  public imageWidth = 640;
  public imageHeight = 480;
  private pixelToIDOffset = 1000000;
  private cachedDimensions: { width: string; height: string } | null = null;
  private dimensionsFetchPromise: Promise<{ width: string; height: string }> | null = null;

  constructor(
    @Inject(forwardRef(() => PixelTransferService))
    private pixelTransferService: PixelTransferService,
    private ethersService: EthersService,
    private configService: ConfigService<Configuration>,
    private eventEmitter: EventEmitter2,
    private http: HttpService,
    private currency: CurrencyService,
    private prisma: PrismaService,
  ) {}

  async onModuleInit() {
    if (!this.isConnectedToContracts && this.ethersService.provider) {
      this.onProviderConnected(this.ethersService.provider).catch((error) => {
        this.logger.error(`onProviderConnected failed: ${error.message}`);
      });
    }
  }

  @OnEvent(Events.ETHERS_WS_PROVIDER_CONNECTED)
  async handleProviderConnected(provider: WebSocketProvider) {
    if (this.isConnectedToContracts) {
      this.logger.log('Contracts already initialized, skipping duplicate event');
      return;
    }
    this.onProviderConnected(provider).catch((error) => {
      this.logger.error(`onProviderConnected failed: ${error.message}`);
    });
  }

  get isConnectedToContracts() {
    return !!this.pxContract && !!this.dogContract;
  }

  private async waitForContracts(timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    while (!this.isConnectedToContracts) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error('Timeout waiting for contract initialization');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async onProviderConnected(provider: ethers.WebSocketProvider) {
    const logMessage = 'Provider connected';
    this.logger.log(logMessage);

    const dripKey = this.configService.get('dripKey');
    if (dripKey && dripKey.trim()) {
      this.dripDogSigner = new ethers.Wallet(dripKey, provider);
      this.logger.log('FreeMoney feature enabled - drip wallet initialized');
    } else {
      this.logger.log('FreeMoney feature disabled - no DRIP_KEY provided');
    }

    const burnVerificationKey = this.configService.get('burnVerificationKey');
    if (burnVerificationKey && burnVerificationKey.trim()) {
      this.burnVerificationSigner = new ethers.Wallet(burnVerificationKey, provider);
      this.logger.log('Burn verification enabled - admin wallet initialized');
    } else {
      this.logger.log('Burn verification disabled - no BURN_VERIFICATION_KEY provided');
    }
    // Prevent uncaught 'error' EventEmitter events from crashing the process.
    // In Node.js, an EventEmitter 'error' event with no listener is fatal.
    provider.on('error', (error) => {
      this.logger.error(`WebSocket provider error: ${error.message}`);
    });

    await this.connectToContracts(provider);
    this.initPixelListener();
    try {
      await this.pixelTransferService.syncRecentTransfers();
    } catch (error) {
      this.logger.error(`syncRecentTransfers failed, server will continue: ${error.message}`);
    }
    try {
      await this.upsertDogCurrency();
    } catch (error) {
      this.logger.error(`upsertDogCurrency failed, server will continue: ${error.message}`);
    }
  }

  private async fetchSymbol(contract: ethers.Contract) {
    try {
      return await contract.symbol();
    } catch (error) {
      this.logger.error('Failed to fetch symbol:', error);
      throw error;
    }
  }

  private async upsertDogCurrency() {
    // Ensure the dogContract is connected
    if (!this.dogContract) {
      this.logger.error('dogContract is not initialized.');
      throw new Error('dogContract is not initialized.');
    }

    const symbol = await this.fetchSymbol(this.dogContract);
    const name = await this.dogContract.name();
    let decimals = await this.dogContract.decimals();
    // const { dog: contractAddress } = this.getContractAddresses();
    // const contractAddress = '0xF8b0C52f505B2177cB1A535329F6fA8a927e7a06';
    const networkId = this.ethersService.chainId.toString();
    const networkName = this.ethersService.network;
    const contractAddress =
      contractData[networkId][networkName].contracts.DOG20.address;
    this.logger.debug(`Contract Address: ${contractAddress}`);

    if (typeof decimals === 'bigint') {
      decimals = Number(decimals);
    }

    if (!contractAddress) {
      this.logger.error('Contract address is undefined');
      throw new Error('Contract address is undefined');
    }

    await this.currency.upsert({
      where: {
        contractAddress: contractAddress.toString(),
      },
      create: {
        contractAddress: contractAddress.toString(),
        type: TokenType.ERC20,
        symbol,
        name,
        decimals,
      },
      update: {},
    });
  }

  async connectToContracts(provider: ethers.WebSocketProvider) {
    this.logger.log('Connecting to contracts...');
    this.logger.log(
      `Network: ${this.ethersService.network}, Chain ID: ${this.ethersService.chainId}`,
    );

    const networkId = this.ethersService.chainId.toString();
    const networkName = this.ethersService.network;
    const pxDetails = contractData[networkId][networkName].contracts.PX;
    const dogDetails = contractData[networkId][networkName].contracts.DOG20;
    const pxABI = pxDetails.abi;
    const dogABI = dogDetails.abi;
    this.pxContractAddress = pxDetails.address;
    this.dogContractAddress = dogDetails.address;

    try {
      this.pxContract = new ethers.Contract(
        this.pxContractAddress,
        pxABI,
        provider,
      );
      this.dogContract = new ethers.Contract(
        this.dogContractAddress,
        dogABI,
        provider,
      );
      this.logger.log(`Contracts initialized successfully.`);
    } catch (error) {
      this.logger.error('Error initializing contracts:', error);
      throw error;
    }

    this.logger.log(
      `Contracts connected: PX at ${this.pxContractAddress}, DOG at ${this.dogContractAddress}`,
    );
  }

  async getPxContract(signerOrProvider: Signer | Provider) {
    const pxContractInfo =
      ABI[this.ethersService.chainId][this.ethersService.network].contracts[
        'PX'
      ];
    return new ethers.Contract(
      pxContractInfo.address,
      pxContractInfo.abi,
      signerOrProvider,
    );
  }

  async getDogContract(signerOrProvider: any) {
    const dogContractInfo =
      ABI[this.ethersService.chainId][this.ethersService.network].contracts[
        'DOG20'
      ];
    return new ethers.Contract(
      dogContractInfo.address,
      dogContractInfo.abi,
      signerOrProvider,
    );
  }

  private initPixelListener() {
    this.logger.log(`initPixelListener`);
    this.logger.log(`Listening to pixel transfer events via block polling`);

    const filter = this.pxContract.filters.Transfer(null, null);

    // Use provider.on('block') instead of contract.on('Transfer') to avoid
    // ethers v6 WebSocketProvider issuing an unchunked historical eth_getLogs
    // backfill on subscription setup, which exceeds Alchemy free tier limits.
    this.ethersService.provider.on('block', async (blockNumber: number) => {
      try {
        const logs = await this.pxContract.queryFilter(filter, blockNumber, blockNumber);
        for (const event of logs) {
          const typedEvent = event as ethers.EventLog;
          const [from, to, tokenId] = typedEvent.args;
          this.logger.log(`new transfer event hit: (${tokenId}) ${from} -> ${to}`);
          const blockCreatedAt =
            await this.ethersService.getDateTimeFromBlockNumber(blockNumber);
          const payload: PixelTransferEventPayload = {
            from,
            to,
            tokenId: Number(tokenId),
            blockNumber,
            blockCreatedAt,
            event: { ...typedEvent, blockNumber },
          };
          this.eventEmitter.emit(Events.PIXEL_TRANSFER, payload);
        }
      } catch (error) {
        this.logger.error(`Error processing block ${blockNumber}: ${error.message}`);
      }
    });
  }

  async getAllPixelTransferLogs() {
    // Check if we have a sync cursor from a previous incomplete sync
    const syncCursor = await this.getSyncCursor();
    const deploymentBlock = this.configService.get('pixelContractDeploymentBlockNumber');
    const from = syncCursor ? syncCursor + 1 : deploymentBlock;
    
    if (syncCursor) {
      this.logger.log(`Resuming sync from saved cursor: ${syncCursor}`);
    }
    
    return this.getPixelTransferLogs(from);
  }

  async getPixelTransferLogs(fromBlock: number, _toBlock?: number) {
    // Get logs from chain in chunks with immediate DB saves and error handling
    const toBlock = _toBlock
      ? _toBlock
      : await this.ethersService.provider.getBlockNumber();
    this.logger.log(
      `Getting pixel transfers from block: ${fromBlock} to block: ${toBlock}`,
    );
    // Configurable block range, capped at 10 (Alchemy free tier hard limit)
    const step = Math.min(this.configService.get('rpcBlockRangeLimit') || 10, 10);
    // Configurable rate limit delay (default 500ms for Alchemy free tier)
    const delayMs = this.configService.get('rpcRateLimitDelayMs') || 500;
    const filter = this.pxContract.filters.Transfer(null, null);

    this.logger.log(`pxContract Address: ${this.pxContract.target}`);
    this.logger.log(
      `pxContract Chain ID: ${await this.ethersService.provider
        .getNetwork()
        .then((net) => net.chainId)}`,
    );

    let totalLogs = 0;
    let currentBlock = fromBlock;
    const maxRetries = 3;

    for (let i = fromBlock; i <= toBlock; i += step) {
      const chunkStart = i;
      // step is the number of blocks, so end = start + step - 1 for inclusive range
      const chunkEnd = Math.min(i + step - 1, toBlock);
      let retryCount = 0;
      let success = false;

      while (!success && retryCount < maxRetries) {
        try {
          this.logger.log(`Fetching logs for blocks ${chunkStart} to ${chunkEnd}...`);
          const _logs = await this.pxContract.queryFilter(filter, chunkStart, chunkEnd);
          this.logger.log(`Got ${_logs.length} logs for this chunk`);

          // Save chunk immediately
          if (_logs.length > 0) {
            await this.pixelTransferService.upsertTransfersFromLogs(_logs as ethers.EventLog[]);
            this.logger.log(`Saved ${_logs.length} transfers to DB`);
          }

          totalLogs += _logs.length;
          currentBlock = chunkEnd;

          // Update sync cursor
          await this.updateSyncCursor(chunkEnd);
          success = true;

          // Throttle to avoid rate limits
          if (i + step <= toBlock) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        } catch (error) {
          retryCount++;
          const isRateLimit = error.message?.includes('429') || error.message?.includes('exceeded');
          const backoffMs = isRateLimit ? delayMs * Math.pow(2, retryCount) : delayMs;

          this.logger.error(`Failed to fetch/save chunk ${chunkStart}-${chunkEnd}: ${error.message}`);

          if (retryCount < maxRetries) {
            this.logger.warn(`Retry ${retryCount}/${maxRetries} after ${backoffMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          } else {
            this.logger.warn(`Max retries reached, skipping chunk ${chunkStart}-${chunkEnd}`);
          }
        }
      }
    }
    
    this.logger.log(`Sync complete. Total logs processed: ${totalLogs}`);
    return []; // Return empty since we're saving as we go
  }

  private async updateSyncCursor(blockNumber: number) {
    try {
      await this.prisma.syncState.upsert({
        where: { key: 'pixel_transfers_sync' },
        create: { key: 'pixel_transfers_sync', lastSyncedBlock: blockNumber },
        update: { lastSyncedBlock: blockNumber },
      });
    } catch (error) {
      this.logger.warn(`Failed to update sync cursor: ${error.message}`);
    }
  }

  async getSyncCursor(): Promise<number | null> {
    try {
      const state = await this.prisma.syncState.findUnique({
        where: { key: 'pixel_transfers_sync' },
      });
      return state?.lastSyncedBlock || null;
    } catch (error) {
      this.logger.warn(`Failed to get sync cursor: ${error.message}`);
      return null;
    }
  }

  getDogLocked() {
    try {
      if (!this.pxContract) {
        this.logger.error('PX Contract is not initialized.');
        throw new Error('PX Contract is not initialized.');
      }
      this.logger.log(
        `Checking locked DOG balance at contract address: ${this.pxContractAddress}`,
      );
      return this.dogContract.balanceOf(this.pxContractAddress);
    } catch (error) {
      this.logger.error(`Failed to get locked DOG balance: ${error.message}`);
      throw new Error('Failed to get locked DOG balance');
    }
  }

  private getTreasuryBalance() {
    return this.dogContract.balanceOf(
      '0x563B1AE9717e9133b0C70D073C931368E1bd86E5',
    );
  }

  private getPleasrBalance() {
    return this.dogContract.balanceOf(
      '0xf894FeA045ECCB2927e2E0CB15C12debEE9f2BE8',
    );
  }

  private async getCirculatingSupply() {
    return this.dogContract.totalSupply();
  }

  // async getPercentDogInPixels() {
  //   const dogLocked = await this.getDogLocked();
  //   const totalSupply = await this.getCirculatingSupply();
  //   const treasuryBalance = await this.getTreasuryBalance();
  //   const pleasrBalance = await this.getPleasrBalance();
  //   const supply = totalSupply.sub(treasuryBalance).sub(pleasrBalance);
  //   return Number(dogLocked.toString() / supply.toString()) * 100;
  // }

  getContractAddresses() {
    // Log the actual addresses to debug
    this.logger.debug(
      `DOG Contract Address: ${
        this.dogContract ? this.dogContractAddress : 'undefined'
      }`,
    );
    this.logger.debug(
      `PX Contract Address: ${
        this.pxContract ? this.pxContractAddress : 'undefined'
      }`,
    );

    return {
      dog: this.dogContract ? this.dogContractAddress : undefined,
      pixel: this.pxContract ? this.pxContractAddress : undefined,
    };
  }

  getPixelURI(tokenId: string) {
    return this.pxContract.tokenURI(tokenId);
  }

  async getDimensions() {
    // Return cached dimensions if available (these never change)
    if (this.cachedDimensions) {
      return this.cachedDimensions;
    }

    // If a fetch is already in progress, wait for it instead of starting another
    if (this.dimensionsFetchPromise) {
      return this.dimensionsFetchPromise;
    }

    // Start the fetch and store the promise so concurrent requests share it
    this.dimensionsFetchPromise = this.fetchDimensionsFromContract();

    try {
      const result = await this.dimensionsFetchPromise;
      return result;
    } finally {
      this.dimensionsFetchPromise = null;
    }
  }

  private async fetchDimensionsFromContract(): Promise<{ width: string; height: string }> {
    try {
      // Wait for contract initialization (max 10s)
      await this.waitForContracts(10000);

      if (!this.pxContract) {
        throw new Error('PX contract not initialized');
      }

      const width = await this.pxContract.SHIBA_WIDTH();
      const height = await this.pxContract.SHIBA_HEIGHT();

      if (!width || !height) {
        throw new Error('Failed to fetch dimensions from the contract.');
      }

      const widthNumber = typeof width === 'bigint' ? width.toString() : width;
      const heightNumber =
        typeof height === 'bigint' ? height.toString() : height;

      // Cache the result since dimensions never change
      this.cachedDimensions = {
        width: widthNumber,
        height: heightNumber,
      };

      return this.cachedDimensions;
    } catch (error) {
      this.logger.error('Failed to get dimensions:', error);
      throw error;
    }
  }

  async getPixelOwner(tokenId: number) {
    return this.pxContract.ownerOf(tokenId);
  }

  async getPixelBalanceByAddress(address: string) {
    // Wait for contract initialization (max 10s)
    await this.waitForContracts(10000);
    
    if (!this.pxContract) {
      throw new Error('PX contract not initialized');
    }
    
    return this.pxContract.balanceOf(address);
  }

  pixelToIndexLocal(pixel: number) {
    return pixel - this.pixelToIDOffset;
  }

  pixelToCoordsLocal(pixel: number) {
    const index = this.pixelToIndexLocal(pixel);
    return [index % this.imageWidth, Math.floor(index / this.imageWidth)];
  }

  pixelToHexLocal(pixel: number) {
    const [x, y] = this.pixelToCoordsLocal(pixel);
    return KobosuJson[y][x];
  }

  async getTokenMetadata(tokenId: string) {
    // todo instead of querying the contract -- query the DB first to ensure the token has been minted actually
    const uri = await this.getPixelURI(tokenId);
    return this.http.get(uri).toPromise();
  }

  async sendDogToAddressFromDripAddress(to: string, amount: number) {
    if (!this.dripDogSigner) {
      throw new Error('FreeMoney feature is disabled - DRIP_KEY not configured');
    }
    const amountAtoms = ethers.parseEther(amount.toString());
    console.log(`sending: ${amountAtoms} -- to: ${to}`);
    const contract = await this.getDogContract(this.dripDogSigner);
    return contract['transfer'](to, amountAtoms);
  }

  async getDogDripBalance() {
    if (!this.dripDogSigner) {
      throw new Error('FreeMoney feature is disabled - DRIP_KEY not configured');
    }
    return this.dogContract.balanceOf(this.dripDogSigner.address);
  }

  getDogDripAddress() {
    if (!this.dripDogSigner) {
      throw new Error('FreeMoney feature is disabled - DRIP_KEY not configured');
    }
    return this.dripDogSigner.address;
  }

  // async getEthTxFeesForERC20Transfer(from, to, amount) {
  //   const gasLimit = await this.dogContract.estimateGas.transfer(to, amount, {
  //     from,
  //   });
  //   const gasPrice = await this.ethersService.provider.getGasPrice();
  //   const gasCost = gasLimit.mul(gasPrice);
  //   return gasCost.toString();
  // }

  async getEthTxFeesForERC20Transfer(from, to, amount) {
    const gasLimit = await this.dogContract.transfer(to, amount, {
      from,
    });
    const feeData = await this.ethersService.provider.getFeeData();
    const gasPrice = feeData.gasPrice;
    const gasCost = gasLimit.mul(gasPrice);
    return gasCost.toString();
  }

  async getDripEthBalance() {
    return this.ethersService.provider.getBalance(this.dripDogSigner.address);
  }

  // ============================================
  // Migration Admin Functions
  // ============================================

  /**
   * Set burn flags for reserved pixels (admin only)
   * This marks pixels as eligible for claiming after V1/V2 burn is confirmed
   * @param tokenIds Array of token IDs to set burn flags for
   * @param burnStatuses Array of boolean statuses (true = burn confirmed)
   */
  async setBurnFlags(tokenIds: number[], burnStatuses: boolean[]): Promise<ethers.TransactionReceipt> {
    if (!this.burnVerificationSigner) {
      throw new Error('Burn verification wallet not configured - BURN_VERIFICATION_KEY not set');
    }

    if (tokenIds.length !== burnStatuses.length) {
      throw new Error('tokenIds and burnStatuses arrays must have the same length');
    }

    if (tokenIds.length === 0) {
      throw new Error('No token IDs provided');
    }

    this.logger.log(`Setting burn flags for ${tokenIds.length} tokens: ${tokenIds.join(', ')}`);

    // Get PX contract with signer for write operations
    const pxContractWithSigner = await this.getPxContract(this.burnVerificationSigner);

    try {
      const tx = await pxContractWithSigner.setBurnFlags(tokenIds, burnStatuses);
      this.logger.log(`setBurnFlags tx submitted: ${tx.hash}`);

      const receipt = await tx.wait();
      this.logger.log(`setBurnFlags tx confirmed in block ${receipt.blockNumber}`);

      return receipt;
    } catch (error) {
      this.logger.error(`Failed to set burn flags: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reserve tokens for migration (admin only)
   * This sets up the reservation before the user burns V1/V2 pixels
   * @param tokenIds Array of token IDs to reserve
   * @param recipients Array of addresses to reserve for
   */
  async reserveTokensForMigration(tokenIds: number[], recipients: string[]): Promise<ethers.TransactionReceipt> {
    if (!this.burnVerificationSigner) {
      throw new Error('Burn verification wallet not configured - BURN_VERIFICATION_KEY not set');
    }

    if (tokenIds.length !== recipients.length) {
      throw new Error('tokenIds and recipients arrays must have the same length');
    }

    this.logger.log(`Reserving ${tokenIds.length} tokens for migration`);

    const pxContractWithSigner = await this.getPxContract(this.burnVerificationSigner);

    try {
      const tx = await pxContractWithSigner.reserveTokensForMigration(tokenIds, recipients);
      this.logger.log(`reserveTokensForMigration tx submitted: ${tx.hash}`);

      const receipt = await tx.wait();
      this.logger.log(`reserveTokensForMigration tx confirmed in block ${receipt.blockNumber}`);

      return receipt;
    } catch (error) {
      this.logger.error(`Failed to reserve tokens: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get reservation status for a token
   */
  async getReservation(tokenId: number): Promise<{ reservedFor: string; burnConfirmed: boolean }> {
    if (!this.pxContract) {
      throw new Error('PX contract not initialized');
    }

    const [reservedFor, burnConfirmed] = await this.pxContract.getReservation(tokenId);
    return { reservedFor, burnConfirmed };
  }
}
