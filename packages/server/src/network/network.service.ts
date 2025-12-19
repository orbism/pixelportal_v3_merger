import { Injectable } from '@nestjs/common';
import { SupportedNetwork } from '../alchemy/alchemy.service';

@Injectable()
export class NetworkService {
  private currentNetwork: SupportedNetwork;

  setCurrentNetwork(network: SupportedNetwork) {
    this.currentNetwork = network;
  }

  getCurrentNetwork(): SupportedNetwork {
    return this.currentNetwork;
  }
}