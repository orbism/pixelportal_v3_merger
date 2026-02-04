import {
  BadRequestException,
  Body,
  CACHE_MANAGER,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Post,
  Render,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { ethers } from 'ethers';
import { AppService } from './app.service';
import { CoinGeckoService } from './coin-gecko/coin-gecko.service';
import { Configuration } from './config/configuration';
import { DiscordService } from './discord/discord.service';
import { PostTransfersDto } from './dto/PostTransfers.dto';
import { EthersService } from './ethers/ethers.service';
import {
  AlreadyClaimedError,
  FeatureDisabledError,
  FreeMoneyService,
  InvalidSignatureError,
  NotEnoughBalanceError,
  NotEnoughEthBalanceError,
} from './free-money/free-money.service';
import { MigrationService } from './migration/migration.service';
import { BurnVerificationService } from './burn-verification/burn-verification.service';
import { OwnTheDogeContractService } from './ownthedoge-contracts/ownthedoge-contracts.service';
import { PixelTransferRepository } from './pixel-transfer/pixel-transfer.repository';
import { PixelTransferService } from './pixel-transfer/pixel-transfer.service';

@Controller('/v1')
export class AppController {
  private logger = new Logger(AppController.name);

  constructor(
    private readonly pixels: OwnTheDogeContractService,
    private readonly pixelTransferRepo: PixelTransferRepository,
    private readonly pixelTransferService: PixelTransferService,
    private readonly ethers: EthersService,
    private readonly pixelService: OwnTheDogeContractService,
    private readonly discord: DiscordService,
    private readonly gecko: CoinGeckoService,
    private readonly app: AppService,
    private readonly freeMoney: FreeMoneyService,
    private readonly migration: MigrationService,
    private readonly burnVerification: BurnVerificationService,
    private configService: ConfigService<Configuration>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  @Get('status')
  getStatus() {
    return this.app.wow;
  }

  @Get('config')
  async getOwnershipConfig() {
    return this.pixelTransferService.getBalances();
  }

  @Get('config/refresh')
  async getConfigRefreshed() {
    await this.pixelTransferService.syncRecentTransfers();
    return this.pixelTransferService.getBalances();
  }

  @Get('config/refresh/all')
  async getConfigRefreshedAll() {
    await this.pixelTransferService.syncAll();
    return this.pixelTransferService.getBalances();
  }

  @Post('transfers/:address')
  async postTransfersByAddress(
    @Param() { address }: { address: string },
    @Body() { filter, sort }: PostTransfersDto,
  ) {
    return this.pixelTransferRepo.searchPixelTransfersByAddress(
      address,
      filter,
      sort,
    );
  }

  @Post('transfers')
  async postTransfers(@Body() { filter, sort, take }: PostTransfersDto) {
    return this.pixelTransferRepo.searchPixelTransfers(filter, sort, take);
  }

  @Get('px/dimensions')
  async getPictureDimensions() {
    return this.pixels.getDimensions();
  }

  @Get('px/balance/:address')
  async getPixelAddressBalance(@Param() params: { address: string }) {
    const balance = await this.pixels.getPixelBalanceByAddress(params.address);
    return { balance: balance.toString() };
  }

  @Get('px/owner/:tokenId')
  async getOwnerByTokenId(@Param() params: { tokenId: number }) {
    const transfer = await this.pixelTransferRepo.findOwnerByTokenId(
      Number(params.tokenId),
    );

    if (!transfer) {
      throw new BadRequestException('Could not find token');
    }
    return {
      address: transfer.to,
    };
  }

  @Get('dog/locked')
  async getDogLocked() {
    const balance = await this.pixels.getDogLocked();
    return {
      balance: ethers.formatEther(BigInt(balance)),
    };
  }

  // @Get('dog/percentLocked')
  // getDogPercentLocked() {
  //   return this.pixels.getPercentDogInPixels();
  // }

  @Get('contract/addresses')
  getContractAddresses() {
    return this.pixels.getContractAddresses();
  }

  @Get('ens/:address')
  async getEnsAddress(@Param() params) {
    const { address } = params;
    if (!this.ethers.getIsValidEthereumAddress(address)) {
      throw new BadRequestException('Invalid Ethereum address');
    }
    const ens = await this.ethers.getEnsName(address);
    return { ens };
  }

  @Get('px/metadata/:tokenId')
  async getPixelMetadata(@Param() params) {
    const { tokenId } = params;
    const cacheKey = `METADATA:${tokenId}`;
    const tokenNotMintedMessage = 'NOT_MINTED';

    try {
      const cache = await this.cacheManager.get(cacheKey);
      if (cache === tokenNotMintedMessage) {
        this.logger.log(tokenNotMintedMessage);
        throw new Error(tokenNotMintedMessage);
      } else {
        const { data } = await this.pixelService.getTokenMetadata(tokenId);
        // bigint to string for all nested objects
        const serializedData = JSON.parse(
          JSON.stringify(data, (_, v) =>
            typeof v === 'bigint' ? v.toString() : v,
          ),
        );
        this.logger.log(
          `got metadata, setting to cache: ${JSON.stringify(serializedData)}`,
        );
        await this.cacheManager.set(cacheKey, serializedData);
        return serializedData;
      }
    } catch (e) {
      if (e.message === tokenNotMintedMessage) {
        this.logger.log('known non-minted token, continuing');
      } else {
        const tokenNotMintedErrorString =
          'ERC721Metadata: URI query for nonexistent token';
        this.logger.log(`GOT ERROR: ${JSON.stringify(e)}`);
        const errorMessage = e.reason;
        const isTokenNotMinted = errorMessage === tokenNotMintedErrorString;
        if (isTokenNotMinted) {
          this.logger.log('non minted token hit. setting cache to not-minted');
          await this.cacheManager.set(cacheKey, tokenNotMintedMessage);
        }
      }
      throw new BadRequestException('Could not get metadata');
    }
  }

  @Get('px/price')
  async getPixelUSDPrice() {
    try {
      const usdPrice = await this.gecko.getCachedDogPrice();
      const dogPerPixel = 55239.89899;
      const price = Number(usdPrice) * dogPerPixel;
      return { price };
    } catch (e) {
      this.logger.error('Could not get coingecko price');
      return { price: null };
    }
  }

  @Get('twitter/share/:type/:id')
  @Render('twitter-share')
  async getTwitterShare(@Param() params) {
    const { id, type } = params;

    if (!['mint', 'burn', 'art', 'claim'].includes(type)) {
      throw new BadRequestException('Unknown type of twitter share');
    }

    const typeToTwitterDataMap = {
      mint: {
        title: 'Doge Pixel Mint',
        description: 'Doge Pixels minted',
      },
      burn: {
        title: 'Doge Pixel Burn',
        description: 'Doge Pixels burned',
      },
      art: {
        title: 'Doge Pixel Art',
        description: 'Pixel Art created from Doge Pixels',
      },
      claim: {
        title: 'Doge Pixel Claim',
        description: 'Doge Pixels claimed',
      },
    };

    const imageUrl = `https://s3.amazonaws.com/share.ownthedoge.com/${id}.png`;
    return {
      title: typeToTwitterDataMap[type].title,
      description: typeToTwitterDataMap[type].description,
      imageUrl,
      url: imageUrl,
    };
  }

  // @Post('twitter/upload/image')
  // async postToTwitter(@Body() body: { data: string }) {
  //   const { uuid } = await this.twitter.uploadImageToS3(body.data);
  //   return { id: uuid };
  // }

  // @Get('twitter/test')
  // async getTwitterBotTest() {
  //   await this.twitter.DEBUG_TEST();
  //   return { success: true };
  // }

  @Get('discord/test/:tokenId')
  async getDiscordBotTest(@Param() params: { tokenId: number }) {
    await this.discord.DEBUG_TEST(params.tokenId);
    return { success: true };
  }

  @Get('sync/names')
  syncNames() {
    return this.app.cacheNames();
  }

  // @Get('sync/prices')
  // syncPrices() {
  //   return this.app.cachePrices();
  // }

  @Post('freemoney')
  async getFreeMoney(
    @Body() { address, signature }: { address: string; signature: string },
  ) {
    this.logger.log('FREEMONEY REQUEST');
    try {
      await this.freeMoney.validateDrip(address, signature);
      return this.freeMoney.drip(address);
    } catch (e) {
      if (e instanceof FeatureDisabledError) {
        throw new BadRequestException('FreeMoney feature is currently disabled');
      } else if (e instanceof AlreadyClaimedError) {
        throw new BadRequestException("🐕✋  You've already claimed   ✋🐕");
      } else if (e instanceof InvalidSignatureError) {
        throw new BadRequestException('Invalid signature');
      } else if (
        e instanceof NotEnoughEthBalanceError ||
        e instanceof NotEnoughBalanceError
      ) {
        throw new BadRequestException('Not enough balance');
      } else {
        this.logger.error(e);
        throw new BadRequestException('Error');
      }
    }
  }

  @Get('freemoney/balance')
  async getFreeMoneyBalance() {
    try {
      return this.freeMoney.getFormattedBalance();
    } catch (e) {
      if (e instanceof FeatureDisabledError) {
        throw new BadRequestException('FreeMoney feature is currently disabled');
      }
      throw e;
    }
  }

  @Get('freemoney/txs/:address')
  async getFreeMoneyBalanceByAddress(
    @Param() { address }: { address: string },
  ) {
    try {
      return this.freeMoney.getAddressTxs(address);
    } catch (e) {
      if (e instanceof FeatureDisabledError) {
        throw new BadRequestException('FreeMoney feature is currently disabled');
      }
      throw e;
    }
  }

  @Get('freemoney/txs')
  getFreeMoneyTxs() {
    try {
      return this.freeMoney.getTxs();
    } catch (e) {
      if (e instanceof FeatureDisabledError) {
        throw new BadRequestException('FreeMoney feature is currently disabled');
      }
      throw e;
    }
  }

  // ============================================
  // Migration Endpoints (V1/V2 -> V3)
  // ============================================

  @Get('migration/eligible/:address')
  async getMigrationEligibility(@Param() { address }: { address: string }) {
    if (!this.ethers.getIsValidEthereumAddress(address)) {
      throw new BadRequestException('Invalid Ethereum address');
    }
    return this.migration.getEligiblePixels(address);
  }

  @Get('migration/stats')
  getMigrationStats() {
    return this.migration.getSnapshotStats();
  }

  @Get('migration/reload')
  reloadMigrationSnapshot() {
    return this.migration.reloadSnapshot();
  }

  /**
   * Verify that tokens were burned on V1/V2 and set burn flags on V3 contract.
   * This enables users to claim their migrated pixels.
   *
   * @param tokenIds Array of token IDs to verify
   * @param network Network where tokens should be burned ('mainnet' for V1, 'base' for V2, 'base-sepolia' for testnet)
   */
  @Post('migration/verify-burns')
  async verifyBurns(
    @Body() { tokenIds, network }: { tokenIds: number[]; network: 'mainnet' | 'base' | 'base-sepolia' },
  ) {
    if (!tokenIds || !Array.isArray(tokenIds) || tokenIds.length === 0) {
      throw new BadRequestException('tokenIds array is required');
    }
    if (!['mainnet', 'base', 'base-sepolia'].includes(network)) {
      throw new BadRequestException('network must be "mainnet", "base", or "base-sepolia"');
    }
    if (tokenIds.length > 50) {
      throw new BadRequestException('Maximum 50 tokens per request');
    }

    this.logger.log(`Verify burns request: ${tokenIds.length} tokens on ${network}`);

    try {
      return await this.burnVerification.verifyAndSetBurnFlags(tokenIds, network);
    } catch (error) {
      this.logger.error(`Verify burns failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  // ============================================
  // Admin Endpoints for Burn Verification
  // ============================================

  /**
   * Set burn flags for reserved pixels after verifying V1/V2 burn on-chain
   * This marks pixels as eligible for claiming in V3
   */
  @Post('admin/set-burn-flags')
  async setBurnFlags(
    @Body() { tokenIds, burnStatuses }: { tokenIds: number[]; burnStatuses?: boolean[] },
  ) {
    this.logger.log(`setBurnFlags request for tokens: ${tokenIds.join(', ')}`);

    if (!tokenIds || !Array.isArray(tokenIds) || tokenIds.length === 0) {
      throw new BadRequestException('tokenIds array is required');
    }

    // Default all statuses to true if not provided
    const statuses = burnStatuses || tokenIds.map(() => true);

    try {
      const receipt = await this.pixels.setBurnFlags(tokenIds, statuses);
      return {
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        tokensUpdated: tokenIds.length,
      };
    } catch (error) {
      this.logger.error(`setBurnFlags failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Reserve tokens for a user before they burn V1/V2 pixels
   * This is typically done based on snapshot data
   */
  @Post('admin/reserve-tokens')
  async reserveTokens(
    @Body() { tokenIds, recipients }: { tokenIds: number[]; recipients: string[] },
  ) {
    this.logger.log(`reserveTokens request for ${tokenIds.length} tokens`);

    if (!tokenIds || !Array.isArray(tokenIds) || tokenIds.length === 0) {
      throw new BadRequestException('tokenIds array is required');
    }

    if (!recipients || !Array.isArray(recipients) || recipients.length !== tokenIds.length) {
      throw new BadRequestException('recipients array must match tokenIds length');
    }

    try {
      const receipt = await this.pixels.reserveTokensForMigration(tokenIds, recipients);
      return {
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        tokensReserved: tokenIds.length,
      };
    } catch (error) {
      this.logger.error(`reserveTokens failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Get reservation status for a specific token
   */
  @Get('admin/reservation/:tokenId')
  async getReservation(@Param() { tokenId }: { tokenId: string }) {
    try {
      const reservation = await this.pixels.getReservation(Number(tokenId));
      return reservation;
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
