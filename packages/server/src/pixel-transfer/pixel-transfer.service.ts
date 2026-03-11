import { EventLog } from 'ethers';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers } from 'ethers';
import { EthersService } from '../ethers/ethers.service';
import { Events, PixelTransferEventPayload } from '../events';
import { OwnTheDogeContractService } from '../ownthedoge-contracts/ownthedoge-contracts.service';
import { UnstoppableDomainsService } from '../unstoppable-domains/unstoppable-domains.service';
import { stringify } from '../utils';
import { PixelTransferRepository } from './pixel-transfer.repository';

@Injectable()
export class PixelTransferService {
  private readonly logger = new Logger(PixelTransferService.name);
  private readonly hasInfuraKey: boolean;

  constructor(
    @Inject(forwardRef(() => OwnTheDogeContractService))
    private readonly pixels: OwnTheDogeContractService,
    private readonly ethersService: EthersService,
    private readonly pixelTransfers: PixelTransferRepository,
    private readonly ethers: EthersService,
    private readonly ud: UnstoppableDomainsService,
    private readonly configService: ConfigService,
  ) {
    this.hasInfuraKey = !!this.configService.get('infuraKey');
    if (!this.hasInfuraKey) {
      this.logger.warn('INFURA_KEY not configured - ENS lookups will be skipped');
    }
  }

  async syncAll() {
    this.logger.log('Syncing all pixel transfer events');
    // getPixelTransferLogs now handles saving internally
    await this.pixels.getAllPixelTransferLogs();
    this.logger.log('Done syncing pixel transfer events');
  }

  async syncFromBlockNumber(block: number) {
    this.logger.log(`Syncing pixel transfers from block: ${block}`);
    // getPixelTransferLogs now handles saving internally
    await this.pixels.getPixelTransferLogs(block);
    this.logger.log(`Done syncing pixel transfers from block: ${block}`);
  }

  async upsertTransfersFromLogs(events: EventLog[]) {
    for (const event of events) {
      const { args, blockNumber } = event;
      const blockCreatedAt =
        await this.ethersService.getDateTimeFromBlockNumber(blockNumber);
      const { from, to, tokenId } = args;

      await this.pixelTransfers.upsert({
        tokenId: Number(tokenId.toString()),
        from,
        to: to,
        blockNumber: blockNumber,
        uniqueTransferId: this.getUniqueTransferId(event),
        blockCreatedAt,
      });
    }
  }

  // private async upsertTransfersFromLogs(events: Event[]) {
  //   for (const event of events) {
  //     const { args, blockNumber } = event;
  //     this.logger.log('EVENT');
  //     this.logger.log(stringify(event, undefined, 2));
  //     this.logger.log(`args: ${args}`);
  //     const blockCreatedAt =
  //       await this.ethersService.getDateTimeFromBlockNumber(blockNumber);
  //     this.logger.log(`blockCreatedAt: ${blockCreatedAt}`);
  //     const { from, to, tokenId } = args;
  //     const uniqueTransferId = `${blockHash}:${transactionHash}:${logIndex}`; // constructing ID directly

  //     await this.pixelTransfers.upsert({
  //       tokenId: Number(tokenId.toString()),
  //       from,
  //       to: to,
  //       blockNumber: blockNumber,
  //       uniqueTransferId, // trying directly constructed ID
  //       blockCreatedAt,
  //     });
  //   }
  // }

  private getUniqueTransferId(event: EventLog) {
    // https://ethereum.stackexchange.com/questions/55155/contract-event-transactionindex-and-logindex
    const { blockHash, transactionHash, index } = event;
    return `${blockHash}:${transactionHash}:${index}`;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async syncPixelTransfersCron() {
    this.logger.log('cron: syncPixelTransfers starting');
    try {
      await this.syncRecentTransfers();
      this.logger.log('cron: syncPixelTransfers complete');
    } catch (err: any) {
      this.logger.error(`cron: syncPixelTransfers failed: ${err.message}`);
    }
  }

  async syncRecentTransfers() {
    // Check sync cursor first, fallback to last transfer block
    const syncCursor = await this.pixels.getSyncCursor();
    if (syncCursor) {
      this.logger.log(`Resuming sync from cursor: block ${syncCursor}`);
      return this.pixels.getPixelTransferLogs(syncCursor + 1);
    }
    
    const mostRecentBlock =
      await this.pixelTransfers.getMostRecentTransferBlockNumber();
    if (!mostRecentBlock) {
      this.logger.log('No previous transfers found, starting full sync');
      return this.pixels.getAllPixelTransferLogs();
    } else {
      this.logger.log(`Syncing from last transfer block: ${mostRecentBlock}`);
      return this.pixels.getPixelTransferLogs(mostRecentBlock);
    }
  }

  // @OnEvent(Events.PIXEL_TRANSFER)
  // async handleNewTransfer({
  //   from,
  //   to,
  //   tokenId,
  //   blockNumber,
  //   blockCreatedAt,
  //   event,
  // }: PixelTransferEventPayload) {
  //   try {
  //     await Promise.all([
  //       this.ethers.refreshEnsCache(from),
  //       this.ethers.refreshEnsCache(to),
  //     ]);
  //   } catch (e) {}
  //   return this.pixelTransfers.upsert({
  //     from,
  //     to,
  //     tokenId,
  //     blockNumber,
  //     blockCreatedAt,
  //     uniqueTransferId: this.getUniqueTransferId(event),
  //   });
  // }

  @OnEvent(Events.PIXEL_TRANSFER)
  async handleNewTransfer({
    from,
    to,
    tokenId,
    blockNumber,
    blockCreatedAt,
    event,
  }: PixelTransferEventPayload) {
    this.logger.log(`got new event - details: ${stringify(event)}`);
    //this.logger.log(`new event details: blockNumber=${event.blockNumber}, blockHash=${event.blockHash}, transactionHash=${event.transactionHash}, logIndex=${event.logIndex}`);
    this.logger.log(`retrieved blockNumber=${event.blockNumber}`);
    blockNumber = blockNumber || event.blockNumber || event.args.blockNumber;

    try {
      await Promise.all([
        this.ethers.refreshEnsCache(from),
        this.ethers.refreshEnsCache(to),
      ]);
    } catch (e) {}

    return this.pixelTransfers.upsert({
      from,
      to,
      tokenId,
      blockNumber,
      blockCreatedAt,
      uniqueTransferId: this.getUniqueTransferId(event),
    });
  }

  async getBalances() {
    this.logger.log('getBalances: starting database query...');
    const transfers = await this.pixelTransfers.findMany({
      distinct: ['tokenId'],
      orderBy: {
        insertedAt: 'desc',
      },
    });
    this.logger.log(`getBalances: found ${transfers.length} transfers`);

    interface TokenState {
      address: string;
      timestamp: string;
    }

    const tokenStates: Record<number, TokenState> = {};

    // Process each transfer to determine the latest state
    for (const transfer of transfers) {
      const { tokenId, to, insertedAt } = transfer;
      if (
        !tokenStates[tokenId] ||
        new Date(insertedAt) > new Date(tokenStates[tokenId].timestamp)
      ) {
        tokenStates[tokenId] = {
          address: to,
          timestamp: insertedAt.toISOString(),
        };
        // console.log(`Token ID: ${tokenId}, Address: ${to}, Timestamp: ${insertedAt.toISOString()}`);
      }
    }

    const balances = {};

    // Compile balances excluding burnt tokens (lowercase keys for consistent lookups)
    for (const [tokenId, { address }] of Object.entries(tokenStates)) {
      const normalizedAddress = address.toLowerCase();
      if (normalizedAddress !== '0x0000000000000000000000000000000000000000') {
        if (!balances[normalizedAddress]) {
          balances[normalizedAddress] = { tokenIds: [] };
        }
        balances[normalizedAddress].tokenIds.push(Number(tokenId));
      }
    }

    // Get ENS/Basename names with timeout protection (skip if no Infura key)
    const addressCount = Object.keys(balances).length;

    if (!this.hasInfuraKey) {
      this.logger.log(`getBalances: skipping ENS lookups (no INFURA_KEY configured)`);
      for (const address in balances) {
        balances[address].ens = null;
      }
    } else {
      this.logger.log(`getBalances: looking up ENS for ${addressCount} addresses...`);

      for (const address in balances) {
        try {
          // Try cache first, fallback to fresh lookup (includes Basenames)
          let ens = await Promise.race([
            this.ethers.getCachedEnsName(address),
            new Promise<string | null>((_, reject) => setTimeout(() => reject(new Error('Cache timeout')), 2000))
          ]);
          if (!ens) {
            ens = await Promise.race([
              this.ethers.getEnsName(address),
              new Promise<string | null>((_, reject) => setTimeout(() => reject(new Error('ENS timeout')), 3000))
            ]);
            // Cache the result if found
            if (ens) {
              await this.ethers.refreshEnsCache(address);
            }
          }
          balances[address].ens = ens || null;
        } catch (error) {
          this.logger.warn(`Failed to get ENS/Basename for ${address}:`, error.message);
          balances[address].ens = null;
        }
      }
    }

    this.logger.log(`getBalances: complete, returning ${addressCount} addresses`);
    return balances;
  }

  // async getBalances() {
  //   const transfers = await this.pixelTransfers.findMany({
  //     distinct: ['tokenId'],
  //     orderBy: {
  //       insertedAt: 'desc',
  //     },
  //   });
  //   const balances = {};

  //   for (const item of transfers) {
  //     const isPixelBurn = item.to === ethers.ZeroAddress;
  //     if (!isPixelBurn) {
  //       if (balances[item.to]?.tokenIds) {
  //         balances[item.to].tokenIds.push(item.tokenId);
  //       } else {
  //         balances[item.to] = {
  //           tokenIds: [item.tokenId],
  //         };
  //       }
  //     }
  //   }
  //   return balances;
  // }
}
