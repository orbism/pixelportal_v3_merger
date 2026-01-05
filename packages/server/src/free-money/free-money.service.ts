import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { Configuration } from '../config/configuration';
import { CurrencyDripService } from '../currency-drip/currency-drip.service';
import { CurrencyService } from '../currency/currency.service';
import { formatAddress } from '../helpers/strings';
import { OwnTheDogeContractService } from '../ownthedoge-contracts/ownthedoge-contracts.service';

export class AlreadyClaimedError extends Error {}
export class InvalidSignatureError extends Error {}
export class NotEnoughBalanceError extends Error {}
export class NotEnoughEthBalanceError extends Error {}
export class FeatureDisabledError extends Error {}

@Injectable()
export class FreeMoneyService implements OnModuleInit {
  private readonly logger = new Logger(FreeMoneyService.name);
  private readonly AMOUNT_TO_DRIP = 4200;
  private readonly messageToSign = 'gib free 69 DOG plz';

  constructor(
    private readonly currencyDrip: CurrencyDripService,
    private readonly otd: OwnTheDogeContractService,
    private readonly currency: CurrencyService,
    private readonly configService: ConfigService<Configuration>,
  ) {}

  onModuleInit() {
    const isEnabled = this.configService.get('freeMoneyEnabled');
    if (isEnabled) {
      this.logger.log(`💰🐕💰🐕 CREATE FREE $DOG MONEY SERVICE 💰🐕💰🐕`);
    } else {
      this.logger.log(`FreeMoney service initialized but DISABLED (no DRIP_KEY)`);
    }
  }

  private checkFeatureEnabled() {
    if (!this.configService.get('freeMoneyEnabled')) {
      throw new FeatureDisabledError('FreeMoney feature is disabled');
    }
  }

  async validateDrip(address: string, signature: string) {
    this.checkFeatureEnabled();
    const tx = await this.currencyDrip.findFirst({
      where: { to: formatAddress(address) },
    });
    if (tx) {
      throw new AlreadyClaimedError();
    }

    const recoveredAddress = ethers.verifyMessage(
      this.messageToSign,
      signature,
    );
    if (formatAddress(recoveredAddress) !== formatAddress(address)) {
      throw new InvalidSignatureError();
    }

    const balance = await this.otd.getDogDripBalance();
    if (
      BigInt(balance) <
      BigInt(ethers.parseEther(this.AMOUNT_TO_DRIP.toString()))
    ) {
      this.logger.log(
        `NOT ENOUGH DRIP BALANCE -- ${ethers.parseEther(
          this.AMOUNT_TO_DRIP.toString(),
        )}`,
      );
      throw new NotEnoughBalanceError();
    }

    const estimatedTxFee = await this.otd.getEthTxFeesForERC20Transfer(
      this.otd.getDogDripAddress(),
      address,
      ethers.parseEther(this.AMOUNT_TO_DRIP.toString()),
    );
    const ethBalance = await this.otd.getDripEthBalance();
    console.log(
      `ESTIMATED FEE BALANCE: ${estimatedTxFee} -- ETH BALANCE: ${ethBalance}`,
    );
    if (BigInt(estimatedTxFee) > BigInt(ethBalance)) {
      this.logger.log(
        `NOT ENOUGH ETH BALANCE -- ESTIMATED: ${estimatedTxFee} -- BALANCE: ${ethBalance}`,
      );
      throw new NotEnoughEthBalanceError();
    }

    return true;
  }

  async drip(address: string) {
    this.checkFeatureEnabled();
    const { dog: contractAddress } = this.otd.getContractAddresses();
    const from = this.otd.getDogDripAddress();

    const tx = await this.otd.sendDogToAddressFromDripAddress(
      address,
      this.AMOUNT_TO_DRIP,
    );
    const currency = await this.currency.findFirst({
      where: { contractAddress: contractAddress.toString() },
    });
    if (!currency) {
      throw new Error('Dog not found');
    }
    const { hash } = tx;
    const drip = await this.currencyDrip.create({
      data: {
        from,
        to: formatAddress(address),
        txId: hash,
        currencyId: currency.id,
        currencyAmountAtoms: ethers
          .parseEther(this.AMOUNT_TO_DRIP.toString())
          .toString(),
      },
    });
    this.logger.log(`dripped ${this.AMOUNT_TO_DRIP} $DOG to ${address}`);
    this.logger.log(tx);
    this.logger.log(drip);
    return {
      tx,
      drip,
    };
  }

  getTxs() {
    this.checkFeatureEnabled();
    return this.currencyDrip.findMany();
  }

  async getFormattedBalance() {
    this.checkFeatureEnabled();
    const balance = await this.otd.getDogDripBalance();
    return ethers.formatEther(balance.toString());
  }

  getAddressTxs(address: string) {
    this.checkFeatureEnabled();
    return this.currencyDrip.findMany({
      where: { to: formatAddress(address) },
    });
  }
}
