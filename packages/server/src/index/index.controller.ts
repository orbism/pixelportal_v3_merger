import { Controller, Get } from '@nestjs/common';
import { AppService } from '../app.service';
import { OwnTheDogeContractService } from '../ownthedoge-contracts/ownthedoge-contracts.service';

@Controller('')
export class IndexController {
  constructor(
    private readonly app: AppService,
    private readonly contracts: OwnTheDogeContractService,
  ) {}
  
  @Get('')
  getIndex() {
    const addresses = this.contracts.getContractAddresses();
    return `${this.app.wow}\n\nPX Contract: ${addresses.pixel}\nDOG Contract: ${addresses.dog}`;
  }
}
