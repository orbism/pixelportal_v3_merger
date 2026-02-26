import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface SnapshotEntry {
  address: string;
  id: number;
  network: 'mainnet' | 'base' | 'base-sepolia';
}

export interface EligibilityResult {
  mainnet: number[];
  base: number[];
  'base-sepolia': number[];
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);
  private snapshot: SnapshotEntry[] = [];
  private snapshotLoaded = false;

  constructor() {
    this.loadSnapshot();
  }

  /**
   * Load the migration snapshot from JSON file
   * The snapshot contains addresses and their eligible pixel IDs from V1/V2
   */
  private loadSnapshot() {
    try {
      // In compiled output: dist/migration/ -> ../migration-snapshot.json = dist/migration-snapshot.json
      const snapshotPath = path.join(__dirname, '../migration-snapshot.json');

      if (fs.existsSync(snapshotPath)) {
        const data = fs.readFileSync(snapshotPath, 'utf-8');
        this.snapshot = JSON.parse(data);
        this.snapshotLoaded = true;
        this.logger.log(`Migration snapshot loaded: ${this.snapshot.length} entries`);
      } else {
        this.logger.warn(`Migration snapshot not found at ${snapshotPath}`);
        this.snapshot = [];
      }
    } catch (error) {
      this.logger.error('Failed to load migration snapshot:', error);
      this.snapshot = [];
    }
  }

  /**
   * Reload the snapshot (useful for hot-reloading without restart)
   */
  reloadSnapshot(): { success: boolean; count: number } {
    this.loadSnapshot();
    return { success: this.snapshotLoaded, count: this.snapshot.length };
  }

  /**
   * Get eligible pixel IDs for a given address, grouped by network
   * @param address The wallet address to check
   * @returns Object with mainnet, base, and base-sepolia arrays of token IDs
   */
  getEligiblePixels(address: string): EligibilityResult {
    const normalizedAddress = address.toLowerCase();

    const mainnetPixels: number[] = [];
    const basePixels: number[] = [];
    const baseSepoliaPixels: number[] = [];

    for (const entry of this.snapshot) {
      if (entry.address.toLowerCase() === normalizedAddress) {
        if (entry.network === 'mainnet') {
          mainnetPixels.push(entry.id);
        } else if (entry.network === 'base') {
          basePixels.push(entry.id);
        } else if (entry.network === 'base-sepolia') {
          baseSepoliaPixels.push(entry.id);
        }
      }
    }

    this.logger.debug(
      `Eligibility for ${address}: mainnet=${mainnetPixels.length}, base=${basePixels.length}, base-sepolia=${baseSepoliaPixels.length}`,
    );

    return {
      mainnet: mainnetPixels,
      base: basePixels,
      'base-sepolia': baseSepoliaPixels,
    };
  }

  /**
   * Check if an address is in the snapshot at all
   */
  isAddressEligible(address: string): boolean {
    const normalizedAddress = address.toLowerCase();
    return this.snapshot.some(
      (entry) => entry.address.toLowerCase() === normalizedAddress,
    );
  }

  /**
   * Get total count of entries in snapshot
   */
  getSnapshotStats(): { total: number; mainnet: number; base: number; 'base-sepolia': number } {
    const mainnetCount = this.snapshot.filter((e) => e.network === 'mainnet').length;
    const baseCount = this.snapshot.filter((e) => e.network === 'base').length;
    const baseSepoliaCount = this.snapshot.filter((e) => e.network === 'base-sepolia').length;

    return {
      total: this.snapshot.length,
      mainnet: mainnetCount,
      base: baseCount,
      'base-sepolia': baseSepoliaCount,
    };
  }

  /**
   * Get all snapshot entries (used by sweep to check all reserved tokens)
   */
  getAllSnapshotEntries(): SnapshotEntry[] {
    return this.snapshot;
  }

  /**
   * Check if a specific token ID is in the snapshot for a given network
   * @param tokenId The token ID to check
   * @param network The network to check ('mainnet' for V1, 'base' for V2, 'base-sepolia' for testnet)
   */
  isTokenInSnapshot(tokenId: number, network: 'mainnet' | 'base' | 'base-sepolia'): boolean {
    return this.snapshot.some(
      (entry) => entry.id === tokenId && entry.network === network,
    );
  }
}
