import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Network } from 'alchemy-sdk';
import { ethers } from 'ethers';
import { AppEnv } from '../config/configuration';
import { formatAddress } from '../helpers/strings';
import { NetworkService } from '../network/network.service';
import { CacheService } from './../cache/cache.service';
import { ENSService } from '../ens/ens.service';
import { BasenamesService } from '../basenames/basenames.service';
import { Events } from './../events';

@Injectable()
export class EthersService implements OnModuleInit {
  private readonly logger = new Logger(EthersService.name);
  private secondsToCache = 60 * 60 * 10;

  public network: string;
  public chainId: number;
  public provider: ethers.WebSocketProvider;
  public zeroAddress = ethers.ZeroAddress;

  private getEnsCacheKey(address: string) {
    return `ens:${address}`;
  }

  constructor(
    private configService: ConfigService<{
      appEnv: string;
      cb: { wsEndpoint: string };
    }>,
    private eventEmitter: EventEmitter2,
    private readonly cache: CacheService,
    private readonly networkService: NetworkService,
    private readonly ens: ENSService,
    private readonly basenames: BasenamesService,
  ) {
    const appEnv = this.configService.get('appEnv');
    const wsEndpoint = process.env.CB_WS_ENDPOINT || this.configService.get('cb')?.wsEndpoint;
    
    // Detect local Anvil by checking WebSocket URL
    const isLocalAnvil = wsEndpoint && (wsEndpoint.includes('localhost:8545') || wsEndpoint.includes('127.0.0.1:8545'));
    
    if (isLocalAnvil) {
      this.network = 'anvil-local';
      this.chainId = 1337;
      this.logger.log('Using local Anvil network (chainId: 1337)');
    } else if (appEnv === AppEnv.production) {
      this.network = 'base-mainnet';
      this.chainId = 8453;
      this.networkService.setCurrentNetwork(Network.BASE_MAINNET);
    } else if (appEnv === AppEnv.development || appEnv === AppEnv.staging) {
      this.network = 'base-sepolia';
      this.chainId = 84532;
      this.networkService.setCurrentNetwork(Network.BASE_SEPOLIA);
    } else if (appEnv === AppEnv.test) {
      this.network = 'localhost';
      this.chainId = 11155111;
    } else {
      throw new Error('App environment unknown');
    }
  }

  async onModuleInit() {
    this.initWS();
  }

  initWS() {
    const wsUrl =
      process.env.CB_WS_ENDPOINT || this.configService.get('cb').wsEndpoint;
    this.provider = new ethers.WebSocketProvider(wsUrl);

    this.eventEmitter.emit(Events.ETHERS_WS_PROVIDER_CONNECTED, this.provider);

    this.keepAlive({
      provider: this.provider,
      onDisconnect: () => {
        this.initWS();
      },
    });
  }

  async waitForWebSocket() {
    if (!this.provider || !this.provider.websocket) {
      this.logger.error('WebSocket is not initialized.');
      return;
    }

    while (this.provider.websocket.readyState !== 1) {
      this.logger.log('Waiting for WebSocket to open...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  keepAlive({
    provider,
    onDisconnect,
    expectedPongBack = 15000,
    checkInterval = 7500,
  }: any) {
    let pingTimeout: any;
    let keepAliveInterval: any;

    provider.websocket.on('open', () => {
      keepAliveInterval = setInterval(() => {
        provider.websocket.ping();

        pingTimeout = setTimeout(() => {
          provider.websocket.terminate();
        }, expectedPongBack);
      }, checkInterval);
    });

    provider.websocket.on('close', (err) => {
      const logMessage = 'Websocket connection closed';
      this.logger.error(logMessage);

      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
      }

      if (pingTimeout) {
        clearTimeout(pingTimeout);
      }

      onDisconnect(err);
    });

    provider.websocket.on('pong', () => {
      if (pingTimeout) {
        clearTimeout(pingTimeout);
      }
    });
  }

  async getEnsName(address: string) {
    const ens = await this.ens.getEnsName(address);
    if (ens) return ens;

    const basename = await this.basenames.getBasename(address);
    return basename;
  }

  async refreshEnsCache(address: string) {
    const ens = await this.getEnsName(address);
    await this.cache.set(
      this.getEnsCacheKey(address),
      ens,
      this.secondsToCache,
    );
  }

  getCachedEnsName(address: string) {
    return this.cache.get<string>(this.getEnsCacheKey(address));
  }

  getIsValidEthereumAddress(address: string) {
    try {
      formatAddress(address);
      return true;
    } catch {
      return false;
    }
  }

  async getDateTimeFromBlockNumber(blockNumber: number) {
    await this.waitForWebSocket();
    const block = await this.provider.getBlock(blockNumber);
    return new Date(block.timestamp * 1000);
  }

  getIsAddressEqual(addr1: string, addr2: string) {
    return formatAddress(addr1) === formatAddress(addr2);
  }
}
