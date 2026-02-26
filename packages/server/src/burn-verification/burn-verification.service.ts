import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Contract, JsonRpcProvider } from 'ethers';
import { Configuration } from '../config/configuration';
import { LEGACY_PX_ABI } from '../contracts/legacyAbi';
import * as contractData from '../contracts/abi.json';
import { MigrationService, SnapshotEntry } from '../migration/migration.service';
import { OwnTheDogeContractService } from '../ownthedoge-contracts/ownthedoge-contracts.service';

export interface TokenResult {
  tokenId: number;
  status: 'not_in_snapshot' | 'not_burned' | 'already_verified' | 'flag_set' | 'error';
  error?: string;
}

export interface VerifyBurnsResult {
  results: TokenResult[];
  txHash?: string;
}

@Injectable()
export class BurnVerificationService implements OnModuleInit {
  private readonly logger = new Logger(BurnVerificationService.name);

  private ethereumProvider: JsonRpcProvider | null = null;
  private sepoliaProvider: JsonRpcProvider | null = null;
  private baseProvider: JsonRpcProvider | null = null;
  private baseSepoliaProvider: JsonRpcProvider | null = null;
  private v1Contract: Contract | null = null;
  private v1TestnetContract: Contract | null = null;
  private v2Contract: Contract | null = null;
  private v2TestnetContract: Contract | null = null;

  constructor(
    private readonly configService: ConfigService<Configuration>,
    private readonly migrationService: MigrationService,
    private readonly pixelsService: OwnTheDogeContractService,
  ) {}

  onModuleInit() {
    this.initializeProviders();
  }

  private initializeProviders() {
    const alchemyKey = this.configService.get('alchemyKey');
    const legacyContracts = this.configService.get('legacyContracts');

    if (!alchemyKey) {
      this.logger.warn('ALCHEMY_KEY not configured - burn verification disabled');
      return;
    }

    // Initialize Ethereum mainnet provider for V1 burn checks
    try {
      const ethereumRpc = `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`;
      this.ethereumProvider = new JsonRpcProvider(ethereumRpc);
      this.v1Contract = new Contract(
        legacyContracts.v1.address,
        LEGACY_PX_ABI,
        this.ethereumProvider,
      );
      this.logger.log('Ethereum mainnet provider initialized for V1 burn verification');
    } catch (error) {
      this.logger.error('Failed to initialize Ethereum provider:', error);
    }

    // Initialize Ethereum Sepolia provider for V1 testnet burn checks
    try {
      const sepoliaRpc = `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`;
      this.sepoliaProvider = new JsonRpcProvider(sepoliaRpc);
      this.v1TestnetContract = new Contract(
        legacyContracts.v1Testnet.address,
        LEGACY_PX_ABI,
        this.sepoliaProvider,
      );
      this.logger.log('Ethereum Sepolia provider initialized for V1 testnet burn verification');
    } catch (error) {
      this.logger.error('Failed to initialize Ethereum Sepolia provider:', error);
    }

    // Initialize Base mainnet provider for V2 burn checks
    try {
      const baseRpc = `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`;
      this.baseProvider = new JsonRpcProvider(baseRpc);
      this.v2Contract = new Contract(
        legacyContracts.v2.address,
        LEGACY_PX_ABI,
        this.baseProvider,
      );
      this.logger.log('Base mainnet provider initialized for V2 burn verification');
    } catch (error) {
      this.logger.error('Failed to initialize Base provider:', error);
    }

    // Initialize Base Sepolia provider for V2 testnet burn checks
    // Read contract address from abi.json deployment data
    const baseSepoliaContract = contractData?.['84532']?.['base-sepolia']?.contracts?.PX;
    if (baseSepoliaContract?.address) {
      try {
        const baseSepoliaRpc = `https://base-sepolia.g.alchemy.com/v2/${alchemyKey}`;
        this.baseSepoliaProvider = new JsonRpcProvider(baseSepoliaRpc);
        this.v2TestnetContract = new Contract(
          baseSepoliaContract.address,
          LEGACY_PX_ABI,
          this.baseSepoliaProvider,
        );
        this.logger.log(`Base Sepolia provider initialized for testnet burn verification (${baseSepoliaContract.address})`);
      } catch (error) {
        this.logger.error('Failed to initialize Base Sepolia provider:', error);
      }
    }
  }

  /**
   * Get the contract for a given network
   */
  private getContractForNetwork(network: 'mainnet' | 'sepolia' | 'base' | 'base-sepolia'): Contract | null {
    switch (network) {
      case 'mainnet':
        return this.v1Contract;
      case 'sepolia':
        return this.v1TestnetContract;
      case 'base':
        return this.v2Contract;
      case 'base-sepolia':
        return this.v2TestnetContract;
      default:
        return null;
    }
  }

  /**
   * Check if a token is burned on the legacy contract
   * A token is considered burned if ownerOf() reverts
   */
  async isTokenBurned(tokenId: number, network: 'mainnet' | 'sepolia' | 'base' | 'base-sepolia'): Promise<boolean> {
    const contract = this.getContractForNetwork(network);

    if (!contract) {
      throw new Error(`${network} provider not configured`);
    }

    try {
      await contract.ownerOf(tokenId);
      return false; // Token exists, not burned
    } catch {
      return true; // ownerOf reverted, token is burned
    }
  }

  /**
   * Verify burns for multiple tokens and set burn flags on V3 contract
   * @param tokenIds Array of token IDs to verify
   * @param network Network where tokens should be burned ('mainnet' for V1, 'base' for V2, 'base-sepolia' for testnet)
   */
  async verifyAndSetBurnFlags(
    tokenIds: number[],
    network: 'mainnet' | 'sepolia' | 'base' | 'base-sepolia',
  ): Promise<VerifyBurnsResult> {
    const results: TokenResult[] = [];
    const burnedTokenIds: number[] = [];

    // Check if provider is configured for this network
    const contract = this.getContractForNetwork(network);
    if (!contract) {
      return {
        results: tokenIds.map((tokenId) => ({
          tokenId,
          status: 'error' as const,
          error: `${network} provider not configured`,
        })),
      };
    }

    for (const tokenId of tokenIds) {
      try {
        // 1. Check if token is in the snapshot for this network
        const inSnapshot = this.migrationService.isTokenInSnapshot(tokenId, network);
        if (!inSnapshot) {
          results.push({ tokenId, status: 'not_in_snapshot' });
          continue;
        }

        // 2. Check if already has burn flag set (avoid duplicate txs)
        try {
          const reservation = await this.pixelsService.getReservation(tokenId);
          if (reservation.burnConfirmed) {
            results.push({ tokenId, status: 'already_verified' });
            continue;
          }
        } catch {
          // Token might not be reserved yet - this is an error case
          results.push({
            tokenId,
            status: 'error',
            error: 'Token not reserved on V3 contract',
          });
          continue;
        }

        // 3. Check if actually burned on V1/V2
        const burned = await this.isTokenBurned(tokenId, network);
        if (!burned) {
          results.push({ tokenId, status: 'not_burned' });
          continue;
        }

        burnedTokenIds.push(tokenId);
        results.push({ tokenId, status: 'flag_set' });
      } catch (error) {
        this.logger.error(`Error verifying token ${tokenId}:`, error);
        results.push({
          tokenId,
          status: 'error',
          error: error.message || 'Unknown error',
        });
      }
    }

    // 4. Batch set burn flags for all verified tokens
    let txHash: string | undefined;
    if (burnedTokenIds.length > 0) {
      try {
        this.logger.log(`Setting burn flags for tokens: ${burnedTokenIds.join(', ')}`);
        const receipt = await this.pixelsService.setBurnFlags(
          burnedTokenIds,
          burnedTokenIds.map(() => true),
        );
        txHash = receipt.hash;
        this.logger.log(`Burn flags set successfully, tx: ${txHash}`);
      } catch (error) {
        this.logger.error('Failed to set burn flags:', error);
        // Mark all burned tokens as error since the tx failed
        for (const result of results) {
          if (result.status === 'flag_set') {
            result.status = 'error';
            result.error = `Failed to set burn flag: ${error.message}`;
          }
        }
      }
    }

    return { results, txHash };
  }

  /**
   * Sweep all snapshot entries and verify burns for any that are reserved but unconfirmed.
   * Called by the cron sweep endpoint.
   */
  async sweepUnconfirmedBurns(): Promise<{
    results: { mainnet: VerifyBurnsResult | null; sepolia: VerifyBurnsResult | null; base: VerifyBurnsResult | null; 'base-sepolia': VerifyBurnsResult | null };
    summary: { mainnet: number; sepolia: number; base: number; 'base-sepolia': number; total: number };
  }> {
    const allEntries = this.migrationService.getAllSnapshotEntries();

    const mainnetIds: number[] = [];
    const sepoliaIds: number[] = [];
    const baseIds: number[] = [];
    const baseSepoliaIds: number[] = [];

    for (const entry of allEntries) {
      try {
        const reservation = await this.pixelsService.getReservation(entry.id);
        if (!reservation.burnConfirmed) {
          if (entry.network === 'mainnet') mainnetIds.push(entry.id);
          else if (entry.network === 'sepolia') sepoliaIds.push(entry.id);
          else if (entry.network === 'base') baseIds.push(entry.id);
          else if (entry.network === 'base-sepolia') baseSepoliaIds.push(entry.id);
        }
      } catch {
        // Token not reserved on V3 — skip
      }
    }

    this.logger.log(
      `Sweep: ${mainnetIds.length} mainnet, ${sepoliaIds.length} sepolia, ${baseIds.length} base, ${baseSepoliaIds.length} base-sepolia unconfirmed`,
    );

    const results: {
      mainnet: VerifyBurnsResult | null;
      sepolia: VerifyBurnsResult | null;
      base: VerifyBurnsResult | null;
      'base-sepolia': VerifyBurnsResult | null;
    } = { mainnet: null, sepolia: null, base: null, 'base-sepolia': null };
    const summary = { mainnet: 0, sepolia: 0, base: 0, 'base-sepolia': 0, total: 0 };

    if (mainnetIds.length > 0) {
      results.mainnet = await this.verifyAndSetBurnFlags(mainnetIds, 'mainnet');
      summary.mainnet = results.mainnet.results.filter((r) => r.status === 'flag_set').length;
    }

    if (sepoliaIds.length > 0) {
      results.sepolia = await this.verifyAndSetBurnFlags(sepoliaIds, 'sepolia');
      summary.sepolia = results.sepolia.results.filter((r) => r.status === 'flag_set').length;
    }

    if (baseIds.length > 0) {
      results.base = await this.verifyAndSetBurnFlags(baseIds, 'base');
      summary.base = results.base.results.filter((r) => r.status === 'flag_set').length;
    }

    if (baseSepoliaIds.length > 0) {
      results['base-sepolia'] = await this.verifyAndSetBurnFlags(baseSepoliaIds, 'base-sepolia');
      summary['base-sepolia'] = results['base-sepolia'].results.filter(
        (r) => r.status === 'flag_set',
      ).length;
    }

    summary.total = summary.mainnet + summary.sepolia + summary.base + summary['base-sepolia'];
    this.logger.log(`Sweep complete: ${summary.total} new burn flags set`);

    return { results, summary };
  }
}
