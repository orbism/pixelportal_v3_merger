import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

interface SnapshotEntry {
  address: string;
  id: number;
  network: 'mainnet' | 'base';
}

export interface EligibilityResult {
  mainnet: number[];
  base: number[];
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
   * @returns Object with mainnet and base arrays of token IDs
   */
  getEligiblePixels(address: string): EligibilityResult {
    const normalizedAddress = address.toLowerCase();

    const mainnetPixels: number[] = [];
    const basePixels: number[] = [];

    for (const entry of this.snapshot) {
      if (entry.address.toLowerCase() === normalizedAddress) {
        if (entry.network === 'mainnet') {
          mainnetPixels.push(entry.id);
        } else if (entry.network === 'base') {
          basePixels.push(entry.id);
        }
      }
    }

    this.logger.debug(
      `Eligibility for ${address}: mainnet=${mainnetPixels.length}, base=${basePixels.length}`,
    );

    return {
      mainnet: mainnetPixels,
      base: basePixels,
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
  getSnapshotStats(): { total: number; mainnet: number; base: number } {
    const mainnetCount = this.snapshot.filter((e) => e.network === 'mainnet').length;
    const baseCount = this.snapshot.filter((e) => e.network === 'base').length;

    return {
      total: this.snapshot.length,
      mainnet: mainnetCount,
      base: baseCount,
    };
  }
}
