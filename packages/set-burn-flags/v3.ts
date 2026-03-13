import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { type Chain } from "viem/chains";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { withRateLimitRetry } from "./utils.ts";

export const v3Abi = [
  {
    type: "function",
    name: "setBurnFlags",
    inputs: [
      { name: "tokenIds", type: "uint256[]", internalType: "uint256[]" },
      { name: "burnStatuses", type: "bool[]", internalType: "bool[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getReservation",
    inputs: [
      { name: "tokenId", type: "uint256", internalType: "uint256" },
    ],
    outputs: [
      { name: "reservedFor", type: "address", internalType: "address" },
      { name: "burnConfirmed", type: "bool", internalType: "bool" },
    ],
    stateMutability: "view",
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TX_RECEIPT_TIMEOUT_MS = 120_000; // 2 minutes

interface V3Config {
  chain: Chain;
  contractAddress: Address;
  rpcEndpoint: string;
  privateKey: string;
}

let publicClient: PublicClient | null = null;
let walletClient: WalletClient | null = null;
let contractAddress: Address | null = null;
let v3Chain: Chain | null = null;
let v3Account: PrivateKeyAccount | null = null;

export function init(config: V3Config): void {
  v3Account = privateKeyToAccount(config.privateKey as `0x${string}`);
  contractAddress = config.contractAddress;
  v3Chain = config.chain;

  publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcEndpoint),
  });

  walletClient = createWalletClient({
    account: v3Account,
    chain: config.chain,
    transport: http(config.rpcEndpoint),
  });

  console.log(`V3 wallet address: ${v3Account.address}`);
}

function getClients(): { pub: PublicClient; wallet: WalletClient; address: Address; chain: Chain; account: PrivateKeyAccount } {
  if (!publicClient || !walletClient || !contractAddress || !v3Chain || !v3Account) {
    throw new Error("V3 module not initialized. Call init() first.");
  }
  return { pub: publicClient, wallet: walletClient, address: contractAddress, chain: v3Chain, account: v3Account };
}

// Sets burn flag on V3 contract for a given token ID. Throws on failure.
export async function setBurnFlagOnV3(label: string, tokenId: bigint): Promise<void> {
  const { pub, wallet, address, chain, account } = getClients();

  console.log(`[${label}] Checking V3 reservation for token ${tokenId}...`);

  const [reservedFor, burnConfirmed] = await withRateLimitRetry(
    () => pub.readContract({
      address,
      abi: v3Abi,
      functionName: "getReservation",
      args: [tokenId],
    }),
    `${label}->V3`
  );

  if (reservedFor === ZERO_ADDRESS) {
    console.log(`[${label}] Skipping token ${tokenId}: no reservation on V3 (never reserved or already claimed)`);
    return;
  }

  if (burnConfirmed) {
    console.log(`[${label}] Ignoring burn for token ${tokenId}: burn flag already set on V3`);
    return;
  }

  console.log(`[${label}] Setting burn flag on V3 for token ${tokenId} (reserved for ${reservedFor})`);

  const hash = await withRateLimitRetry(
    () => wallet.writeContract({
      account,
      chain,
      address,
      abi: v3Abi,
      functionName: "setBurnFlags",
      args: [[tokenId], [true]],
    }),
    `${label}->V3`
  );

  console.log(`[${label}] Transaction sent for token ${tokenId}: ${hash}`);

  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted for token ${tokenId}: ${hash}`);
  }

  console.log(`[${label}] Burn flag confirmed for token ${tokenId} in block ${receipt.blockNumber}`);
}
