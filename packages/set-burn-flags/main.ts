import { load } from "@std/dotenv";
import {
  createPublicClient,
  webSocket,
  parseAbiItem,
  type Address,
  type PublicClient,
} from "viem";
import { mainnet, sepolia, base, baseSepolia, type Chain } from "viem/chains";
import { init as initDb, get, set, close as closeDb } from "./db.ts";
import {
  withRateLimitRetry,
  getStoredBlock as getStoredBlockUtil,
  setStoredBlock as setStoredBlockUtil,
  delay,
  RATE_LIMIT_INITIAL_DELAY_MS,
} from "./utils.ts";
import { init as initV3 } from "./v3.ts";
import { enqueueBurn, setShuttingDown, waitForDrain } from "./queue.ts";

// Parse env name from CLI args
const VALID_ENVS = ["local", "dev", "test", "prod"] as const;
const envName = Deno.args[0];
if (!envName || !VALID_ENVS.includes(envName as typeof VALID_ENVS[number])) {
  console.error(`Usage: deno task run <env>\n  env must be one of: ${VALID_ENVS.join(", ")}`);
  Deno.exit(1);
}

// Load environment variables from .env.{envName}
const envPath = new URL(`./.env.${envName}`, import.meta.url).pathname;
await load({ envPath, export: true });

// Initialize database with env-prefixed name
const dbPath = new URL(`./priv/${envName}-store.db`, import.meta.url).pathname;
initDb(dbPath);
console.log(`Environment: ${envName}, DB: ${envName}-store.db`);

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

// Initialize V3 contract module
const V3_PRIVATE_KEY = Deno.env.get("PRIVATE_KEY");
if (!V3_PRIVATE_KEY) {
  throw new Error("Missing env var: PRIVATE_KEY");
}
initV3({
  chain: getChain("V3_CHAIN"),
  contractAddress: Deno.env.get("V3_CONTRACT_ADDRESS") as Address,
  rpcEndpoint: Deno.env.get("V3_HTTP_RPC_ENDPOINT")!,
  privateKey: V3_PRIVATE_KEY,
});

// Track unsubscribe functions for graceful shutdown
const unsubscribers: Array<() => void> = [];
let isShuttingDown = false;

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

// Zero address for burn detection
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// --- Source chain config ---

const WS_RECONNECT_MAX_ATTEMPTS = 5;
const WS_RECONNECT_BASE_DELAY_MS = 3000;

interface SourceChainConfig {
  label: string;
  chain: Chain;
  wsEndpoint: string;
  client: PublicClient;
  contractAddress: Address;
  snapshotBlock: bigint;
  lastProcessedKey: string;
  backfillTargetKey: string;
}

function createWsClient(chain: Chain, wsEndpoint: string): PublicClient {
  return createPublicClient({
    chain,
    transport: webSocket(wsEndpoint),
  }) as PublicClient;
}

const sourceChains: SourceChainConfig[] = [
  {
    label: "V1",
    chain: getChain("V1_CHAIN"),
    wsEndpoint: Deno.env.get("V1_WS_RPC_ENDPOINT")!,
    client: null as unknown as PublicClient, // initialized below
    contractAddress: Deno.env.get("V1_CONTRACT_ADDRESS") as Address,
    snapshotBlock: BigInt(Deno.env.get("V1_SNAPSHOT_BLOCK") || "0"),
    lastProcessedKey: "v1_last_processed_block",
    backfillTargetKey: "v1_backfill_target",
  },
  {
    label: "V2",
    chain: getChain("V2_CHAIN"),
    wsEndpoint: Deno.env.get("V2_WS_RPC_ENDPOINT")!,
    client: null as unknown as PublicClient, // initialized below
    contractAddress: Deno.env.get("V2_CONTRACT_ADDRESS") as Address,
    snapshotBlock: BigInt(Deno.env.get("V2_SNAPSHOT_BLOCK") || "0"),
    lastProcessedKey: "v2_last_processed_block",
    backfillTargetKey: "v2_backfill_target",
  },
];

// Create initial WS clients
for (const sc of sourceChains) {
  sc.client = createWsClient(sc.chain, sc.wsEndpoint);
}

// Track which chains are currently reconnecting to prevent duplicate attempts
const reconnecting = new Set<string>();

// Reconnect a source chain's WS client and re-register watchers
async function reconnectChain(chain: SourceChainConfig): Promise<void> {
  const { label } = chain;

  if (reconnecting.has(label)) return;
  reconnecting.add(label);

  for (let attempt = 1; attempt <= WS_RECONNECT_MAX_ATTEMPTS; attempt++) {
    if (isShuttingDown) return;

    const delayMs = WS_RECONNECT_BASE_DELAY_MS * attempt;
    console.log(`[${label}] Reconnect attempt ${attempt}/${WS_RECONNECT_MAX_ATTEMPTS} in ${delayMs}ms...`);
    await delay(delayMs);

    if (isShuttingDown) return;

    try {
      chain.client = createWsClient(chain.chain, chain.wsEndpoint);
      // Test the connection and get current block
      const currentBlock = await chain.client.getBlockNumber();
      console.log(`[${label}] Reconnected successfully at block ${currentBlock}`);
      reconnecting.delete(label);

      // Check for gap since last processed block and backfill if needed
      const lastProcessed = getStoredBlock(chain.lastProcessedKey, chain.snapshotBlock);
      if (currentBlock > lastProcessed + 1n) {
        const gapStart = lastProcessed + 1n;
        console.log(`[${label}] Gap detected: blocks ${gapStart} to ${currentBlock}, backfilling...`);
        await syncHistorical(chain, currentBlock);
      }

      // Re-register watchers
      watchBurns(chain);
      watchBlocks(chain);
      return;
    } catch (err) {
      console.error(`[${label}] Reconnect attempt ${attempt} failed:`, err);
    }
  }

  reconnecting.delete(label);
  console.error(`[${label}] All reconnect attempts exhausted, shutting down`);
  shutdown();
}

// Watch a source chain for burn events (Transfer to zero address)
function watchBurns(chain: SourceChainConfig): void {
  const { label, contractAddress } = chain;
  console.log(`Watching ${label} contract ${contractAddress} for burns...`);

  const unsubscribe = chain.client.watchEvent({
    address: contractAddress,
    event: transferEvent,
    args: { to: ZERO_ADDRESS },
    onLogs: (logs) => {
      for (const log of logs) {
        if (isShuttingDown) return;
        const tokenId = log.args.tokenId!;
        console.log(`[${label}] Burn detected for token ${tokenId}`);
        enqueueBurn(chain.label, tokenId);
      }
    },
    onError: (error) => {
      console.error(`[${label}] Watch event error:`, error);
      if (!isShuttingDown) reconnectChain(chain);
    },
  });
  unsubscribers.push(unsubscribe);
}

// Watch a source chain for new blocks (only persist after backfill complete)
function watchBlocks(chain: SourceChainConfig): void {
  const { label, lastProcessedKey, backfillTargetKey } = chain;

  const unsubscribe = chain.client.watchBlocks({
    onBlock: (block) => {
      try {
        if (isShuttingDown) return;
        if (!block) return;
        const blockNumber = block.number;
        if (blockNumber !== null && blockNumber !== undefined) {
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
      if (!isShuttingDown) reconnectChain(chain);
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
      console.log(`[${label}] Burn detected for token ${tokenId}`);
      await enqueueBurn(chain.label, tokenId);
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
async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  setShuttingDown(true);

  console.log("\nShutting down gracefully...");

  // Unsubscribe all watchers (stops new events from enqueuing)
  for (const unsubscribe of unsubscribers) {
    try {
      unsubscribe();
    } catch (err) {
      console.error("Error unsubscribing:", err);
    }
  }

  // Wait for the queue to finish processing remaining jobs
  console.log("Waiting for burn queue to drain...");
  await waitForDrain();
  console.log("Burn queue drained");

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

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await shutdown();
});
