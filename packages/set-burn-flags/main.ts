import {
  createPublicClient,
  createWalletClient,
  webSocket,
  http,
  parseAbiItem,
  type Address,
  type PublicClient,
} from "viem";
import { mainnet, sepolia, base, baseSepolia, type Chain } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { get, set, close as closeDb } from "./db.ts";
import {
  withRateLimitRetry,
  getStoredBlock as getStoredBlockUtil,
  setStoredBlock as setStoredBlockUtil,
  delay,
  RATE_LIMIT_INITIAL_DELAY_MS,
} from "./utils.ts";

// Track unsubscribe functions for graceful shutdown
const unsubscribers: Array<() => void> = [];
let isShuttingDown = false;

// Map chain names from env to viem chain objects
const chainMap: Record<string, Chain> = {
  "mainnet": mainnet,
  "sepolia": sepolia,
  "base": base,
  "base-sepolia": baseSepolia,
};

function getChain(envVar: string): Chain {
  const chainName = Deno.env.get(envVar);
  if (!chainName) {
    throw new Error(`Missing env var: ${envVar}`);
  }
  const chain = chainMap[chainName];
  if (!chain) {
    throw new Error(`Unknown chain: ${chainName}. Available: ${Object.keys(chainMap).join(", ")}`);
  }
  return chain;
}

// Wrapped storage helpers that use the db module
function getStoredBlock(key: string, defaultBlock: bigint): bigint {
  return getStoredBlockUtil(get, key, defaultBlock);
}

function setStoredBlock(key: string, blockNumber: bigint): void {
  setStoredBlockUtil(set, key, blockNumber);
}

// Batch size for historical block processing
const BLOCK_BATCH_SIZE = BigInt(Deno.env.get("BLOCK_BATCH_SIZE") || "1000");

// ERC-721 Transfer event
const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
);

// V3 contract ABI (subset)
const v3Abi = [
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

// Zero address for burn detection
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// --- Source chain config ---

interface SourceChainConfig {
  label: string;
  client: PublicClient;
  contractAddress: Address;
  snapshotBlock: bigint;
  lastProcessedKey: string;
  backfillTargetKey: string;
}

const v3Chain = getChain("V3_CHAIN");
const V3_CONTRACT_ADDRESS = Deno.env.get("V3_CONTRACT_ADDRESS") as Address;
const V3_HTTP_RPC_ENDPOINT = Deno.env.get("V3_HTTP_RPC_ENDPOINT")!;

const v3Client = createPublicClient({
  chain: v3Chain,
  transport: http(V3_HTTP_RPC_ENDPOINT),
});

const PRIVATE_KEY = Deno.env.get("PRIVATE_KEY");
if (!PRIVATE_KEY) {
  throw new Error("Missing env var: PRIVATE_KEY");
}
const v3Account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const v3WalletClient = createWalletClient({
  account: v3Account,
  chain: v3Chain,
  transport: http(V3_HTTP_RPC_ENDPOINT),
});
console.log(`V3 wallet address: ${v3Account.address}`);

const sourceChains: SourceChainConfig[] = [
  {
    label: "V1",
    client: createPublicClient({
      chain: getChain("V1_CHAIN"),
      transport: webSocket(Deno.env.get("V1_WS_RPC_ENDPOINT")!),
    }) as PublicClient,
    contractAddress: Deno.env.get("V1_CONTRACT_ADDRESS") as Address,
    snapshotBlock: BigInt(Deno.env.get("V1_SNAPSHOT_BLOCK") || "0"),
    lastProcessedKey: "v1_last_processed_block",
    backfillTargetKey: "v1_backfill_target",
  },
  {
    label: "V2",
    client: createPublicClient({
      chain: getChain("V2_CHAIN"),
      transport: webSocket(Deno.env.get("V2_WS_RPC_ENDPOINT")!),
    }) as PublicClient,
    contractAddress: Deno.env.get("V2_CONTRACT_ADDRESS") as Address,
    snapshotBlock: BigInt(Deno.env.get("V2_SNAPSHOT_BLOCK") || "0"),
    lastProcessedKey: "v2_last_processed_block",
    backfillTargetKey: "v2_backfill_target",
  },
];

// Sets burn flag on V3 contract for a given token ID
async function setBurnFlagOnV3(chain: SourceChainConfig, tokenId: bigint): Promise<void> {
  const { label } = chain;
  try {
    console.log(`[${label}] Checking V3 reservation for token ${tokenId}...`);

    const [reservedFor, burnConfirmed] = await withRateLimitRetry(
      () => v3Client.readContract({
        address: V3_CONTRACT_ADDRESS,
        abi: v3Abi,
        functionName: "getReservation",
        args: [tokenId],
      }),
      `${label}->V3`
    );

    if (reservedFor === ZERO_ADDRESS) {
      console.log(`[${label}] Ignoring burn for token ${tokenId}: no reservation exists on V3`);
      return;
    }

    if (burnConfirmed) {
      console.log(`[${label}] Ignoring burn for token ${tokenId}: burn flag already set on V3`);
      return;
    }

    console.log(`[${label}] Setting burn flag on V3 for token ${tokenId} (reserved for ${reservedFor})`);

    const hash = await withRateLimitRetry(
      () => v3WalletClient.writeContract({
        address: V3_CONTRACT_ADDRESS,
        abi: v3Abi,
        functionName: "setBurnFlags",
        args: [[tokenId], [true]],
      }),
      `${label}->V3`
    );
    console.log(`[${label}] Burn flag set for token ${tokenId}, tx: ${hash}`);
  } catch (error) {
    console.error(`[${label}] Error setting burn flag for token ${tokenId}:`, error);
  }
}

// Handle a burn event from a source chain
async function handleBurn(chain: SourceChainConfig, tokenId: bigint): Promise<void> {
  try {
    console.log(`[${chain.label}] Burn detected for token ${tokenId}`);
    await setBurnFlagOnV3(chain, tokenId);
  } catch (error) {
    console.error(`[${chain.label}] Error handling burn for token ${tokenId}:`, error);
  }
}

// Watch a source chain for burn events (Transfer to zero address)
function watchBurns(chain: SourceChainConfig): void {
  const { label, client, contractAddress } = chain;
  console.log(`Watching ${label} contract ${contractAddress} for burns...`);

  const unsubscribe = client.watchEvent({
    address: contractAddress,
    event: transferEvent,
    args: { to: ZERO_ADDRESS },
    onLogs: async (logs) => {
      try {
        for (const log of logs) {
          if (isShuttingDown) return;
          const tokenId = log.args.tokenId!;
          await handleBurn(chain, tokenId);
        }
      } catch (error) {
        console.error(`[${label}] Error processing burn event logs:`, error);
      }
    },
    onError: (error) => {
      console.error(`[${label}] Watch event error:`, error);
      shutdown();
    },
  });
  unsubscribers.push(unsubscribe);
}

// Watch a source chain for new blocks (only persist after backfill complete)
function watchBlocks(chain: SourceChainConfig): void {
  const { label, client, lastProcessedKey, backfillTargetKey } = chain;

  const unsubscribe = client.watchBlocks({
    onBlock: (block) => {
      try {
        if (isShuttingDown) return;
        const blockNumber = block.number;
        if (blockNumber !== null) {
          const target = getStoredBlock(backfillTargetKey, 0n);
          const lastProcessed = getStoredBlock(lastProcessedKey, 0n);
          if (lastProcessed >= target && blockNumber > lastProcessed) {
            setStoredBlock(lastProcessedKey, blockNumber);
          }
          console.log(`[${label}] New block: ${blockNumber}`);
        }
      } catch (error) {
        console.error(`[${label}] Error processing block:`, error);
      }
    },
    onError: (error) => {
      console.error(`[${label}] Watch blocks error:`, error);
      shutdown();
    },
  });
  unsubscribers.push(unsubscribe);
}

// Process historical burns in a batch range for a source chain
async function processHistoricalBatch(chain: SourceChainConfig, fromBlock: bigint, toBlock: bigint): Promise<boolean> {
  const { label, client, contractAddress } = chain;
  try {
    console.log(`[${label}] Processing historical blocks ${fromBlock} to ${toBlock}`);

    const logs = await withRateLimitRetry(
      () => client.getLogs({
        address: contractAddress,
        event: transferEvent,
        args: { to: ZERO_ADDRESS },
        fromBlock,
        toBlock,
      }),
      label
    );

    for (const log of logs) {
      if (isShuttingDown) return false;
      const tokenId = log.args.tokenId!;
      await handleBurn(chain, tokenId);
    }
    return true;
  } catch (error) {
    console.error(`[${label}] Error processing batch ${fromBlock}-${toBlock}:`, error);
    return false;
  }
}

// Sync historical blocks for a source chain
async function syncHistorical(chain: SourceChainConfig, targetBlock: bigint): Promise<void> {
  const { label, snapshotBlock, lastProcessedKey, backfillTargetKey } = chain;
  try {
    setStoredBlock(backfillTargetKey, targetBlock);

    let fromBlock = getStoredBlock(lastProcessedKey, snapshotBlock);

    if (fromBlock >= snapshotBlock && fromBlock < targetBlock) {
      fromBlock = fromBlock + 1n;
    }

    console.log(`[${label}] Starting historical sync from ${fromBlock} to ${targetBlock}`);

    while (fromBlock <= targetBlock && !isShuttingDown) {
      const toBlock = fromBlock + BLOCK_BATCH_SIZE - 1n > targetBlock
        ? targetBlock
        : fromBlock + BLOCK_BATCH_SIZE - 1n;

      const success = await processHistoricalBatch(chain, fromBlock, toBlock);
      if (success) {
        setStoredBlock(lastProcessedKey, toBlock);
      } else {
        console.log(`[${label}] Batch failed, retrying after delay...`);
        await delay(RATE_LIMIT_INITIAL_DELAY_MS);
        continue;
      }
      fromBlock = toBlock + 1n;
    }

    if (!isShuttingDown) {
      console.log(`[${label}] Historical sync complete`);
    }
  } catch (error) {
    console.error(`[${label}] Historical sync error:`, error);
  }
}

// Main startup function
async function main(): Promise<void> {
  console.log("Starting burn flag watcher...");

  // Get latest block numbers from all source chains
  const latestBlocks = await Promise.all(
    sourceChains.map((chain) =>
      withRateLimitRetry(() => chain.client.getBlockNumber(), chain.label)
        .catch((err) => {
          console.error(`[${chain.label}] Failed to get latest block:`, err);
          return null;
        })
    )
  );

  if (latestBlocks.some((b) => b === null)) {
    console.error("Failed to get latest blocks, exiting...");
    return;
  }

  // Start watching for new blocks and burn events on all source chains
  for (const chain of sourceChains) {
    watchBlocks(chain);
    watchBurns(chain);
  }
  console.log(`Watching for new blocks and burn events on ${sourceChains.map((c) => c.label).join(", ")} contracts`);

  // Run historical sync in parallel (each source chain is independent)
  await Promise.all(
    sourceChains.map((chain, i) => {
      const latestBlock = latestBlocks[i]!;
      console.log(`[${chain.label}] Latest block: ${latestBlock}`);
      return syncHistorical(chain, latestBlock);
    })
  );

  console.log("Historical sync complete for all source chains");
}

// Graceful shutdown handler
function shutdown(): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("\nShutting down gracefully...");

  // Unsubscribe all watchers
  for (const unsubscribe of unsubscribers) {
    try {
      unsubscribe();
    } catch (err) {
      console.error("Error unsubscribing:", err);
    }
  }

  // Close database
  try {
    closeDb();
    console.log("Database closed");
  } catch (err) {
    console.error("Error closing database:", err);
  }

  console.log("Shutdown complete");
  Deno.exit(0);
}

// Register signal handlers
Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

main().catch((err) => {
  console.error("Fatal error:", err);
  shutdown();
});
