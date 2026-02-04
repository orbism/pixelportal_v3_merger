/**
 * Minimal ABI for legacy PX contracts (V1 on Ethereum, V2 on Base)
 * Only includes ownerOf for burn verification
 */
export const LEGACY_PX_ABI = [
  {
    inputs: [{ name: 'tokenId', type: 'uint256', internalType: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
