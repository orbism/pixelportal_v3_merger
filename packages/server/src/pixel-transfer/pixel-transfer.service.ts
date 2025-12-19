import { EventLog } from 'ethers';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
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

  constructor(
    @Inject(forwardRef(() => OwnTheDogeContractService))
    private readonly pixels: OwnTheDogeContractService,
    private readonly ethersService: EthersService,
    private readonly pixelTransfers: PixelTransferRepository,
    private readonly ethers: EthersService,
    private readonly ud: UnstoppableDomainsService,
  ) {}

  async syncAll() {
    this.logger.log('Syncing all pixel transfer events');
    return this.upsertTransfersFromLogs(
      await this.pixels.getAllPixelTransferLogs(),
    ).then((res) => {
      this.logger.log('Done syncing pixel transfer events');
    });
  }

  async syncFromBlockNumber(block: number) {
    this.logger.log(`Syncing pixel transfers from block: ${block}`);
    return this.upsertTransfersFromLogs(
      await this.pixels.getPixelTransferLogs(block),
    ).then((_) => {
      this.logger.log(`Done syncing pixel transfers from block: ${block}`);
    });
  }

  private async upsertTransfersFromLogs(events: EventLog[]) {
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

  async syncRecentTransfers() {
    const mostRecentBlock =
      await this.pixelTransfers.getMostRecentTransferBlockNumber();
    if (!mostRecentBlock) {
      return this.syncAll();
    } else {
      return this.syncFromBlockNumber(mostRecentBlock);
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
    const transfers = await this.pixelTransfers.findMany({
      distinct: ['tokenId'],
      orderBy: {
        insertedAt: 'desc',
      },
    });

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

    // Compile balances excluding burnt tokens
    for (const [tokenId, { address }] of Object.entries(tokenStates)) {
      if (address !== '0x0000000000000000000000000000000000000000') {
        if (!balances[address]) {
          balances[address] = { tokenIds: [] };
        }
        balances[address].tokenIds.push(Number(tokenId));
      }
    }

    // Get ENS names with timeout protection
    for (const address in balances) {
      try {
        const ens = await Promise.race([
          this.ethers.getCachedEnsName(address),
          new Promise((_, reject) => setTimeout(() => reject(new Error('ENS timeout')), 2000))
        ]);
        balances[address].ens = ens;
      } catch (error) {
        this.logger.warn(`Failed to get ENS for ${address}:`, error.message);
        balances[address].ens = null;
      }
    }

    this.logger.log('Final balances:', JSON.stringify(balances, null, 2));
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
