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
    const infuraKey = this.configService.get('infuraKey');
    // if (appEnv === AppEnv.production) {
    // look up ENS names on mainnet
    this.provider = new ethers.JsonRpcProvider(
      `https://mainnet.infura.io/v3/${infuraKey}`,
    );
    // } else {
    //   this.provider = new ethers.JsonRpcProvider(
    //     `https://sepolia.infura.io/v3/${infuraKey}`,
    //   );
    // }
  }

  async getEnsName(address: string) {
    return this.provider.lookupAddress(address);
  }
}
