import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { AppEnv } from '../config/configuration';

@Injectable()
export class ENSService implements OnModuleInit {
  private readonly logger = new Logger(ENSService.name);

  public provider: ethers.JsonRpcProvider;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const appEnv = this.configService.get('appEnv');
    console.log('appEnv', appEnv);
    const alchemyKey = this.configService.get('alchemyKey');
    console.log('alchemyKey', alchemyKey);
    // if (appEnv === AppEnv.production) {
    // look up ENS names on mainnet
    this.provider = new ethers.JsonRpcProvider(
      `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    );
    // } else {
    //   this.provider = new ethers.JsonRpcProvider(
    //     `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`,
    //   );
    // }
  }

  async getEnsName(address: string) {
    return this.provider.lookupAddress(address);
  }
}
