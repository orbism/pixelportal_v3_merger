import { Controller, Get, Header } from '@nestjs/common';
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
    return `${this.app.wow}\n\nPX Contract:\n${addresses.pixel}\n\nDOG Contract:\n${addresses.dog}`;
  }

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain')
  getRobots() {
    return 'User-agent: Twitterbot\nDisallow:\n\nUser-agent: *\nDisallow: /';
  }
}
