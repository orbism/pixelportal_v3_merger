import { Listener } from '@ethersproject/providers';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Alchemy,
  AlchemySubscription,
  AssetTransfersWithMetadataParams,
  Network,
} from 'alchemy-sdk';
import { Configuration } from '../config/configuration';
import { CacheService } from './../cache/cache.service';
import { NetworkService } from '../network/network.service';

export type SupportedNetwork =
  | Network.BASE_MAINNET
  | Network.BASE_SEPOLIA;

@Injectable()
export class AlchemyService implements OnModuleInit {
  private logger = new Logger(AlchemyService.name);
  private alchemyBase: Alchemy;
  private alchemyBaseSepolia: Alchemy;
  private currentNetwork: SupportedNetwork;

  constructor(
    private readonly cache: CacheService,
    private readonly configService: ConfigService<Configuration>,
    private readonly networkService: NetworkService,
  ) {

    this.currentNetwork = this.configService.get('DEFAULT_NETWORK') as SupportedNetwork;

    this.alchemyBase = new Alchemy({
      apiKey: this.configService.get('alchemyKey'),
      network: Network.BASE_MAINNET,
    });
    this.alchemyBaseSepolia = new Alchemy({
      apiKey: this.configService.get('alchemyKey'),
      network: Network.BASE_SEPOLIA,
    });
  }

  onModuleInit() {
    this.logger.log(`🧙‍♂️ Alchemy init on network: ${this.networkService.getCurrentNetwork()}`);
  }

  getAssetTransfers(
    params: AssetTransfersWithMetadataParams,
    network: SupportedNetwork = Network.BASE_MAINNET,
  ) {
    if (network === Network.BASE_MAINNET) {
      return this.alchemyBase.core.getAssetTransfers(params);
    } else if (network === Network.BASE_SEPOLIA) {
      return this.alchemyBaseSepolia.core.getAssetTransfers(params);
    } 
  }

  getBalance(address: string, network: SupportedNetwork = Network.BASE_MAINNET) {
    if (network === Network.BASE_MAINNET) {
      return this.alchemyBase.core.getBalance(address);
    } else if (network === Network.BASE_SEPOLIA) {
      return this.alchemyBaseSepolia.core.getBalance(address);
    } 
  }

  async getTokenBalances(address: string) {
    const balances = await this.alchemyBase.core.getTokenBalances(address);
    return balances?.tokenBalances;
  }

  getTokenMetadata(address: string) {
    const cacheKey = `ALCHEMY:METADATA:${address}`;
    return this.cache.getOrQueryAndCache(
      cacheKey,
      () => this.alchemyBase.core.getTokenMetadata(address),
      60 * 60 * 60,
    );
  }

  listenForTransfersToAddress(address: string, callback: Listener) {
    this.logger.log(`init listening to transfers to address: ${address}`);
    this.alchemyBase.ws.on(
      {
        method: AlchemySubscription.MINED_TRANSACTIONS,
        addresses: [{ to: address }],
      },
      callback,
    );
  }
}