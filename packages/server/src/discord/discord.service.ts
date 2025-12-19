import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { Configuration } from '../config/configuration';
import { EthersService } from '../ethers/ethers.service';
import { Events, PixelTransferEventPayload } from '../events';
import { ImageGeneratorService } from '../image-generator/image-generator.service';

@Injectable()
export class DiscordService implements OnModuleInit {
  private readonly logger = new Logger(DiscordService.name);
  private client: Client;

  constructor(
    private readonly config: ConfigService<Configuration>,
    private readonly imageGenerator: ImageGeneratorService,
    private readonly ethers: EthersService,
  ) {}

  onModuleInit() {
    const discordEnabled = process.env.DISCORD_ENABLED === 'true';
    
    if (!discordEnabled) {
      this.logger.log('Discord integration disabled');
      return;
    }
    
    const discordSecret = this.config.get('discord')?.secret;
    if (!discordSecret) {
      this.logger.warn('Discord secret not configured, skipping Discord integration');
      return;
    }
    
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });
    this.client.login(discordSecret);
    this.client.once('ready', () => {
      this.logger.log('Auth success');
    });
  }

  @OnEvent(Events.PIXEL_TRANSFER)
  async post({
    from,
    to,
    tokenId,
  }: Omit<
    PixelTransferEventPayload,
    'event' | 'blockCreatedAt' | 'blockNumber'
  >) {
    if (!this.client) {
      this.logger.debug('Discord client not initialized, skipping post');
      return;
    }
    
    this.logger.log(`Posting to discord:: (${tokenId}) ${from} -> ${to}`);
    const textContent = await this.imageGenerator.getTextContent(
      from,
      to,
      tokenId,
    );
    const image = await this.imageGenerator.generatePostImage(
      from === this.ethers.zeroAddress ? 'mint' : 'burn',
      tokenId,
    );
    const base64Buffer = await image.getBufferAsync('image/png');

    try {
      const channel = this.client.channels.cache.get(
        this.config.get('discord').channelId,
      ) as TextChannel;
      await channel.send({
        content: textContent,
        files: [
          {
            attachment: base64Buffer,
          },
        ],
      });
    } catch (e) {
      this.logger.error(`error sending image to discord channel: ${e.message}`);
    }
  }

  async DEBUG_TEST(id: number) {
    if (this.config.get('isDev')) {
      return this.post({
        from: '0x0000000000000000000000000000000000000000',
        to: '0xd801d86C10e2185a8FCBccFB7D7baF0A6C5B6BD5',
        tokenId: id,
      });
    } else {
      this.logger.log(`DEBUG TEST only available in development mode`);
    }
  }
}
