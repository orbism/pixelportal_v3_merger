import { HttpModule } from '@nestjs/axios';
import { CacheModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import * as redisStore from 'cache-manager-redis-store';
import { join } from 'path';
import { AlchemyService } from './alchemy/alchemy.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CacheService } from './cache/cache.service';
import { ChainanalysisService } from './chainanalysis/chainanalysis.service';
import { CoinGeckoService } from './coin-gecko/coin-gecko.service';
import configuration, { Configuration } from './config/configuration';
import { CurrencyDripService } from './currency-drip/currency-drip.service';
import { CurrencyService } from './currency/currency.service';
import { DiscordService } from './discord/discord.service';
import { EthersService } from './ethers/ethers.service';
import { ENSService } from './ens/ens.service';
import { BasenamesService } from './basenames/basenames.service';
import { FreeMoneyService } from './free-money/free-money.service';
import { ImageGeneratorService } from './image-generator/image-generator.service';
import { MigrationService } from './migration/migration.service';
import { BurnVerificationService } from './burn-verification/burn-verification.service';
import { IndexController } from './index/index.controller';
import { NetworkService } from './network/network.service';
import { OwnTheDogeContractService } from './ownthedoge-contracts/ownthedoge-contracts.service';
import { PixelTransferRepository } from './pixel-transfer/pixel-transfer.repository';
import { PixelTransferService } from './pixel-transfer/pixel-transfer.service';
import { PrismaService } from './prisma.service';
import { UnstoppableDomainsService } from './unstoppable-domains/unstoppable-domains.service';
import { EmailService } from './email/email.service';
import { SupportController } from './support/support.controller';
import { SupportService } from './support/support.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, 'public'),
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    HttpModule.register({
      timeout: 5000,
    }),
    CacheModule.registerAsync({
      useFactory: (config: ConfigService<Configuration>) => {
        const redisUrl = config.get('redis').url;
        const isLocalhost = redisUrl?.includes('localhost') || redisUrl?.includes('127.0.0.1');
        return {
          store: redisStore,
          url: redisUrl,
          ttl: 10,
          max: 10000,
          // Only use TLS for non-localhost (production) Redis
          ...(isLocalhost ? {} : { tls: { rejectUnauthorized: false } }),
        };
      },
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController, IndexController, SupportController],
  providers: [
    PrismaService,
    EthersService,
    ENSService,
    BasenamesService,
    OwnTheDogeContractService,
    PixelTransferRepository,
    // TwitterService,
    DiscordService,
    ImageGeneratorService,
    ImageGeneratorService,
    // AwsService,
    CoinGeckoService,
    PixelTransferService,
    UnstoppableDomainsService,
    AlchemyService,
    CacheService,
    ChainanalysisService,
    AppService,
    FreeMoneyService,
    CurrencyDripService,
    CurrencyService,
    NetworkService,
    EmailService,
    SupportService,
    MigrationService,
    BurnVerificationService,
  ],
})
export class AppModule {}
