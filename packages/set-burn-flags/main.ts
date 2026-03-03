import {
  createPublicClient,
  createWalletClient,
  webSocket,
  http,
  parseAbiItem,
  type Address,
  type Log,
} from "viem";
import { mainnet, sepolia, base, baseSepolia, type Chain } from "viem/chains";
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

const v1Chain = getChain("V1_CHAIN");
const v2Chain = getChain("V2_CHAIN");
const v3Chain = getChain("V3_CHAIN");
import { privateKeyToAccount } from "viem/accounts";

// Contract addresses from env
const V1_CONTRACT_ADDRESS = Deno.env.get("V1_CONTRACT_ADDRESS") as Address;
const V2_CONTRACT_ADDRESS = Deno.env.get("V2_CONTRACT_ADDRESS") as Address;
const V3_CONTRACT_ADDRESS = Deno.env.get("V3_CONTRACT_ADDRESS") as Address;

// RPC endpoints from env
const V1_WS_RPC_ENDPOINT = Deno.env.get("V1_WS_RPC_ENDPOINT")!;
const V2_WS_RPC_ENDPOINT = Deno.env.get("V2_WS_RPC_ENDPOINT")!;
const V3_HTTP_RPC_ENDPOINT = Deno.env.get("V3_HTTP_RPC_ENDPOINT")!;

// Snapshot block numbers from env (start scanning from these blocks)
const V1_SNAPSHOT_BLOCK = BigInt(Deno.env.get("V1_SNAPSHOT_BLOCK") || "0");
const V2_SNAPSHOT_BLOCK = BigInt(Deno.env.get("V2_SNAPSHOT_BLOCK") || "0");

// Batch size for historical block processing
const BLOCK_BATCH_SIZE = BigInt(Deno.env.get("BLOCK_BATCH_SIZE") || "1000");

// Wrapped storage helpers that use the db module
function getStoredBlock(key: string, defaultBlock: bigint): bigint {
  return getStoredBlockUtil(get, key, defaultBlock);
}

function setStoredBlock(key: string, blockNumber: bigint): void {
  setStoredBlockUtil(set, key, blockNumber);
}

// KV keys for V1 chain
const V1_LAST_PROCESSED_KEY = "v1_last_processed_block";
const V1_BACKFILL_TARGET_KEY = "v1_backfill_target";

// KV keys for V2 chain
const V2_LAST_PROCESSED_KEY = "v2_last_processed_block";
const V2_BACKFILL_TARGET_KEY = "v2_backfill_target";

// Get stored block number or fall back to default
function getStoredBlock(key: string, defaultBlock: bigint): bigint {
  const stored = get(key);
  return stored ? BigInt(stored) : defaultBlock;
}

// Update block number in kv store
function setStoredBlock(key: string, blockNumber: bigint): void {
  set(key, blockNumber.toString());
}

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

// WebSocket clients for watching V1 and V2
const v1Client = createPublicClient({
  chain: v1Chain,
  transport: webSocket(V1_WS_RPC_ENDPOINT),
});

const v2Client = createPublicClient({
  chain: v2Chain,
  transport: webSocket(V2_WS_RPC_ENDPOINT),
});

// HTTP client for V3 read/write operations
const v3Client = createPublicClient({
  chain: v3Chain,
  transport: http(V3_HTTP_RPC_ENDPOINT),
});

// Sets burn flag on V3 contract for a given token ID
async function setBurnFlagOnV3(tokenId: bigint, source: "V1" | "V2"): Promise<void> {
  try {
    console.log(`[${source}] Checking V3 reservation for token ${tokenId}...`);

    // Check if token has a reservation and if burn flag is already set
    const [reservedFor, burnConfirmed] = await withRateLimitRetry(
      () => v3Client.readContract({
        address: V3_CONTRACT_ADDRESS,
        abi: v3Abi,
        functionName: "getReservation",
        args: [tokenId],
      }),
      `${source}->V3`
    );

    // Check if there's no reservation for this token
    if (reservedFor === ZERO_ADDRESS) {
      console.log(`[${source}] Ignoring burn for token ${tokenId}: no reservation exists on V3`);
      return;
    }

    // Check if burn flag is already set
    if (burnConfirmed) {
      console.log(`[${source}] Ignoring burn for token ${tokenId}: burn flag already set on V3`);
      return;
    }

    console.log(`[${source}] Setting burn flag on V3 for token ${tokenId} (reserved for ${reservedFor})`);

    // TODO: Add wallet client with private key for signing transactions
    // const account = privateKeyToAccount(Deno.env.get("PRIVATE_KEY") as `0x${string}`);
    // const walletClient = createWalletClient({
    //   account,
    //   chain: v3Chain,
    //   transport: http(V3_HTTP_RPC_ENDPOINT),
    // });
    //
    // const hash = await walletClient.writeContract({
    //   address: V3_CONTRACT_ADDRESS,
    //   abi: v3Abi,
    //   functionName: "setBurnFlags",
    //   args: [[tokenId], [true]],
    // });
    // console.log(`[${source}] Transaction hash: ${hash}`);
  } catch (error) {
    console.error(`[${source}] Error setting burn flag for token ${tokenId}:`, error);
  }
}

// Stub function for V1 burn events
async function handleV1Burn(tokenId: bigint): Promise<void> {
  try {
    console.log(`[V1] Burn detected for token ${tokenId}`);
    await setBurnFlagOnV3(tokenId, "V1");
  } catch (error) {
    console.error(`[V1] Error handling burn for token ${tokenId}:`, error);
  }
}

// Stub function for V2 burn events
async function handleV2Burn(tokenId: bigint): Promise<void> {
  try {
    console.log(`[V2] Burn detected for token ${tokenId}`);
    await setBurnFlagOnV3(tokenId, "V2");
  } catch (error) {
    console.error(`[V2] Error handling burn for token ${tokenId}:`, error);
  }
}

// Watch V1 contract for burn events
function watchV1Burns(): void {
  console.log(`Watching V1 contract ${V1_CONTRACT_ADDRESS} for burns...`);

  const unsubscribe = v1Client.watchEvent({
    address: V1_CONTRACT_ADDRESS,
    event: transferEvent,
    args: { to: ZERO_ADDRESS },
    onLogs: async (logs) => {
      try {
        for (const log of logs) {
          if (isShuttingDown) return;
          const tokenId = log.args.tokenId!;
          await handleV1Burn(tokenId);
        }
      } catch (error) {
        console.error("[V1] Error processing burn event logs:", error);
      }
    },
    onError: (error) => {
      console.error("[V1] Watch event error:", error);
    },
  });
  unsubscribers.push(unsubscribe);
}

// Watch V2 contract for burn events
function watchV2Burns(): void {
  console.log(`Watching V2 contract ${V2_CONTRACT_ADDRESS} for burns...`);

  const unsubscribe = v2Client.watchEvent({
    address: V2_CONTRACT_ADDRESS,
    event: transferEvent,
    args: { to: ZERO_ADDRESS },
    onLogs: async (logs) => {
      try {
        for (const log of logs) {
          if (isShuttingDown) return;
          const tokenId = log.args.tokenId!;
          await handleV2Burn(tokenId);
        }
      } catch (error) {
        console.error("[V2] Error processing burn event logs:", error);
      }
    },
    onError: (error) => {
      console.error("[V2] Watch event error:", error);
    },
  });
  unsubscribers.push(unsubscribe);
}

// Watch V1 chain for new blocks (only persist after backfill complete)
function watchV1Blocks(): void {
  const unsubscribe = v1Client.watchBlocks({
    onBlock: (block) => {
      try {
        if (isShuttingDown) return;
        const blockNumber = block.number;
        if (blockNumber !== null) {
          const target = getStoredBlock(V1_BACKFILL_TARGET_KEY, 0n);
          const lastProcessed = getStoredBlock(V1_LAST_PROCESSED_KEY, 0n);
          // Only persist if backfill is complete and this is a new block
          if (lastProcessed >= target && blockNumber > lastProcessed) {
            setStoredBlock(V1_LAST_PROCESSED_KEY, blockNumber);
          }
          console.log(`[V1] New block: ${blockNumber}`);
        }
      } catch (error) {
        console.error("[V1] Error processing block:", error);
      }
    },
    onError: (error) => {
      console.error("[V1] Watch blocks error:", error);
    },
  });
  unsubscribers.push(unsubscribe);
}

// Watch V2 chain for new blocks (only persist after backfill complete)
function watchV2Blocks(): void {
  const unsubscribe = v2Client.watchBlocks({
    onBlock: (block) => {
      try {
        if (isShuttingDown) return;
        const blockNumber = block.number;
        if (blockNumber !== null) {
          const target = getStoredBlock(V2_BACKFILL_TARGET_KEY, 0n);
          const lastProcessed = getStoredBlock(V2_LAST_PROCESSED_KEY, 0n);
          // Only persist if backfill is complete and this is a new block
          if (lastProcessed >= target && blockNumber > lastProcessed) {
            setStoredBlock(V2_LAST_PROCESSED_KEY, blockNumber);
          }
          console.log(`[V2] New block: ${blockNumber}`);
        }
      } catch (error) {
        console.error("[V2] Error processing block:", error);
      }
    },
    onError: (error) => {
      console.error("[V2] Watch blocks error:", error);
    },
  });
  unsubscribers.push(unsubscribe);
}

// Process historical V1 burns in batch range
async function processV1HistoricalBatch(fromBlock: bigint, toBlock: bigint): Promise<boolean> {
  try {
    console.log(`[V1] Processing historical blocks ${fromBlock} to ${toBlock}`);

    const logs = await withRateLimitRetry(
      () => v1Client.getLogs({
        address: V1_CONTRACT_ADDRESS,
        event: transferEvent,
        args: { to: ZERO_ADDRESS },
        fromBlock,
        toBlock,
      }),
      "V1"
    );

    for (const log of logs) {
      if (isShuttingDown) return false;
      const tokenId = log.args.tokenId!;
      await handleV1Burn(tokenId);
    }
    return true;
  } catch (error) {
    console.error(`[V1] Error processing batch ${fromBlock}-${toBlock}:`, error);
    return false;
  }
}

// Process historical V2 burns in batch range
async function processV2HistoricalBatch(fromBlock: bigint, toBlock: bigint): Promise<boolean> {
  try {
    console.log(`[V2] Processing historical blocks ${fromBlock} to ${toBlock}`);

    const logs = await withRateLimitRetry(
      () => v2Client.getLogs({
        address: V2_CONTRACT_ADDRESS,
        event: transferEvent,
        args: { to: ZERO_ADDRESS },
        fromBlock,
        toBlock,
      }),
      "V2"
    );

    for (const log of logs) {
      if (isShuttingDown) return false;
      const tokenId = log.args.tokenId!;
      await handleV2Burn(tokenId);
    }
    return true;
  } catch (error) {
    console.error(`[V2] Error processing batch ${fromBlock}-${toBlock}:`, error);
    return false;
  }
}

// Sync historical blocks for V1
async function syncV1Historical(targetBlock: bigint): Promise<void> {
  try {
    // Persist the backfill target so live watcher knows the boundary
    setStoredBlock(V1_BACKFILL_TARGET_KEY, targetBlock);

    let fromBlock = getStoredBlock(V1_LAST_PROCESSED_KEY, V1_SNAPSHOT_BLOCK);

    // Start from next block if we've already processed some
    if (fromBlock >= V1_SNAPSHOT_BLOCK && fromBlock < targetBlock) {
      fromBlock = fromBlock + 1n;
    }

    console.log(`[V1] Starting historical sync from ${fromBlock} to ${targetBlock}`);

    while (fromBlock <= targetBlock && !isShuttingDown) {
      const toBlock = fromBlock + BLOCK_BATCH_SIZE - 1n > targetBlock
        ? targetBlock
        : fromBlock + BLOCK_BATCH_SIZE - 1n;

      const success = await processV1HistoricalBatch(fromBlock, toBlock);
      if (success) {
        setStoredBlock(V1_LAST_PROCESSED_KEY, toBlock);
      } else {
        // Wait before retrying failed batch
        console.log(`[V1] Batch failed, retrying after delay...`);
        await delay(RATE_LIMIT_INITIAL_DELAY_MS);
        continue;
      }
      fromBlock = toBlock + 1n;
    }

    if (!isShuttingDown) {
      console.log(`[V1] Historical sync complete`);
    }
  } catch (error) {
    console.error("[V1] Historical sync error:", error);
  }
}

// Sync historical blocks for V2
async function syncV2Historical(targetBlock: bigint): Promise<void> {
  try {
    // Persist the backfill target so live watcher knows the boundary
    setStoredBlock(V2_BACKFILL_TARGET_KEY, targetBlock);

    let fromBlock = getStoredBlock(V2_LAST_PROCESSED_KEY, V2_SNAPSHOT_BLOCK);

    // Start from next block if we've already processed some
    if (fromBlock >= V2_SNAPSHOT_BLOCK && fromBlock < targetBlock) {
      fromBlock = fromBlock + 1n;
    }

    console.log(`[V2] Starting historical sync from ${fromBlock} to ${targetBlock}`);

    while (fromBlock <= targetBlock && !isShuttingDown) {
      const toBlock = fromBlock + BLOCK_BATCH_SIZE - 1n > targetBlock
        ? targetBlock
        : fromBlock + BLOCK_BATCH_SIZE - 1n;

      const success = await processV2HistoricalBatch(fromBlock, toBlock);
      if (success) {
        setStoredBlock(V2_LAST_PROCESSED_KEY, toBlock);
      } else {
        // Wait before retrying failed batch
        console.log(`[V2] Batch failed, retrying after delay...`);
        await delay(RATE_LIMIT_INITIAL_DELAY_MS);
        continue;
      }
      fromBlock = toBlock + 1n;
    }

    if (!isShuttingDown) {
      console.log(`[V2] Historical sync complete`);
    }
  } catch (error) {
    console.error("[V2] Historical sync error:", error);
  }
}

// Get latest block with retry
async function getLatestBlockWithRetry(
  client: ReturnType<typeof createPublicClient>,
  chainName: string
): Promise<bigint> {
  return await withRateLimitRetry(
    () => client.getBlockNumber(),
    chainName
  );
}

// Main startup function
async function main(): Promise<void> {
  console.log("Starting burn flag watcher...");

  // Get latest block numbers from both chains
  const [v1LatestBlock, v2LatestBlock] = await Promise.all([
    getLatestBlockWithRetry(v1Client, "V1").catch((err) => {
      console.error("[V1] Failed to get latest block:", err);
      return null;
    }),
    getLatestBlockWithRetry(v2Client, "V2").catch((err) => {
      console.error("[V2] Failed to get latest block:", err);
      return null;
    }),
  ]);

  if (v1LatestBlock === null || v2LatestBlock === null) {
    console.error("Failed to get latest blocks, exiting...");
    return;
  }

  console.log(`[V1] Latest block: ${v1LatestBlock}`);
  console.log(`[V2] Latest block: ${v2LatestBlock}`);

  // Start watching for new blocks and burn events
  watchV1Blocks();
  watchV2Blocks();
  watchV1Burns();
  watchV2Burns();
  console.log("Watching for new blocks and burn events on V1 and V2 contracts");

  // Run historical sync in parallel (V1 and V2 are independent)
  // Each sync handles its own errors internally
  await Promise.all([
    syncV1Historical(v1LatestBlock),
    syncV2Historical(v2LatestBlock),
  ]);

  console.log("Historical sync complete for both chains");
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
