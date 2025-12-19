import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { base } from 'viem/chains';
import {
  createPublicClient,
  encodePacked,
  http,
  keccak256,
  namehash,
} from 'viem';
import type { Address } from 'viem';

export type Basename = `${string}.base.eth`;

const BASENAME_L2_RESOLVER_ADDRESS =
  '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD';

const l2ResolverABI = [
  {
    inputs: [{ internalType: 'bytes32', name: 'node', type: 'bytes32' }],
    name: 'name',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const convertChainIdToCoinType = (chainId: number): string => {
  // L1 resolvers to addr
  if (chainId === 1) {
    return 'addr';
  }

  const cointype = (0x80000000 | chainId) >>> 0;
  return cointype.toString(16).toLocaleUpperCase();
};

const convertReverseNodeToBytes = (address: Address, chainId: number) => {
  const addressFormatted = address.toLocaleLowerCase() as Address;
  const addressNode = keccak256(addressFormatted.substring(2) as Address);
  const chainCoinType = convertChainIdToCoinType(chainId);
  const baseReverseNode = namehash(
    `${chainCoinType.toLocaleUpperCase()}.reverse`,
  );
  const addressReverseNode = keccak256(
    encodePacked(['bytes32', 'bytes32'], [baseReverseNode, addressNode]),
  );
  return addressReverseNode;
};

@Injectable()
export class BasenamesService implements OnModuleInit {
  private readonly logger = new Logger(BasenamesService.name);

  private rpc: string;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const alchemyKey = this.configService.get('alchemyKey');

    this.rpc = `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  }

  async getBasename(address: string) {
    try {
      const client = createPublicClient({
        chain: base,
        transport: http(this.rpc),
      });

      const addressReverseNode = convertReverseNodeToBytes(
        address as `0x${string}`,
        base.id,
      );
      const basename = await client.readContract({
        abi: l2ResolverABI,
        address: BASENAME_L2_RESOLVER_ADDRESS,
        functionName: 'name',
        args: [addressReverseNode],
      });
      if (basename) {
        return basename as Basename;
      }
    } catch (error) {
      // Handle the error accordingly
      console.error('Error resolving Basename:', error);
    }
  }
}
