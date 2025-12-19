// import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { EventEmitter2 } from '@nestjs/event-emitter';
// import { createPublicClient, webSocket } from 'viem';
// import WebSocket from 'ws';
// import { AppEnv } from '../config/configuration';
// import { Events } from '../events';
// import { formatAddress } from '../helpers/strings';
// import { CacheService } from './../cache/cache.service';

// @Injectable()
// export class ViemService implements OnModuleInit {
//   private readonly logger = new Logger(ViemService.name);
//   private secondsToCache = 60 * 60 * 10;

//   public network: string;
//   public chainId: number;
//   public provider: any; // Viem's client type
//   public zeroAddress = '0x0000000000000000000000000000000000000000';

//   private getEnsCacheKey(address: string) {
//     return `ens:${address}`;
//   }

//   constructor(
//     private configService: ConfigService<{
//       appEnv: string;
//       cb: { wsEndpoint: string };
//     }>,
//     private eventEmitter: EventEmitter2,
//     private readonly cache: CacheService,
//   ) {
//     const appEnv = this.configService.get('appEnv');
//     if (appEnv === AppEnv.production) {
//       this.network = 'mainnet';
//       this.chainId = 1;
//     } else if (appEnv === AppEnv.development || appEnv === AppEnv.staging) {
//       this.network = 'base-sepolia';
//       this.chainId = 84532;
//     } else if (appEnv === AppEnv.test) {
//       this.network = 'localhost';
//       this.chainId = 11155111;
//     } else {
//       throw new Error('App environment unknown');
//     }
//   }

//   async onModuleInit() {
//     this.initWS();
//   }

//   async initWS() {
//     const wsUrl = process.env.CB_WS_ENDPOINT || this.configService.get('cb').wsEndpoint;

//     try {
//       this.provider = createPublicClient({
//         transport: webSocket(wsUrl),
//       });
//       this.provider.on('error', (error) => {
//         this.logger.error('WebSocket error', error);
//       });
//     } catch (error) {
//       this.logger.error('Error initializing WebSocket', error);
//     }
//   }

// //   async getEnsName(address: string) {
// //     return customEnsLookupFunction(address);
// //   }

// //   async refreshEnsCache(address: string) {
// //     const ens = await this.getEnsName(address);
// //     await this.cache.set(
// //       this.getEnsCacheKey(address),
// //       ens,
// //       this.secondsToCache,
// //     );
// //   }

// //   getCachedEnsName(address: string) {
// //     return this.cache.get<string>(this.getEnsCacheKey(address));
// //   }

//   getIsValidEthereumAddress(address: string) {
//     try {
//       formatAddress(address);
//       return true;
//     } catch {
//       return false;
//     }
//   }

//   async getDateTimeFromBlockNumber(blockNumber: number) {
//     const block = await this.provider.getBlock({ blockNumber });
//     return new Date(block.timestamp * 1000);
//   }

//   getIsAddressEqual(addr1: string, addr2: string) {
//     return formatAddress(addr1) === formatAddress(addr2);
//   }
// }
