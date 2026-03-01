import { assertEquals, assertRejects } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { assertSpyCalls, spy } from "https://deno.land/std@0.220.0/testing/mock.ts";
import {
  isRateLimitError,
  delay,
  withRateLimitRetry,
  getStoredBlock,
  setStoredBlock,
  RATE_LIMIT_ERROR_CODE,
} from "./utils.ts";
import { createInMemoryKVStore, type KVStore } from "./db.ts";

// --- Rate Limit Error Detection Tests ---

Deno.test("isRateLimitError - detects rate limit error code", () => {
  const error = { code: RATE_LIMIT_ERROR_CODE };
  assertEquals(isRateLimitError(error), true);
});

Deno.test("isRateLimitError - detects nested rate limit error in cause", () => {
  const error = { cause: { code: RATE_LIMIT_ERROR_CODE } };
  assertEquals(isRateLimitError(error), true);
});

Deno.test("isRateLimitError - returns false for other error codes", () => {
  const error = { code: -32000 };
  assertEquals(isRateLimitError(error), false);
});

Deno.test("isRateLimitError - returns false for null", () => {
  assertEquals(isRateLimitError(null), false);
});

Deno.test("isRateLimitError - returns false for undefined", () => {
  assertEquals(isRateLimitError(undefined), false);
});

Deno.test("isRateLimitError - returns false for string error", () => {
  assertEquals(isRateLimitError("rate limit exceeded"), false);
});

Deno.test("isRateLimitError - returns false for Error without code", () => {
  assertEquals(isRateLimitError(new Error("rate limit")), false);
});

// --- Delay Tests ---

Deno.test("delay - resolves after specified time", async () => {
  const start = Date.now();
  await delay(50);
  const elapsed = Date.now() - start;
  // Allow some tolerance for timing
  assertEquals(elapsed >= 45, true);
  assertEquals(elapsed < 150, true);
});

// --- Database Tests ---

Deno.test("KVStore - get returns null for non-existent key", () => {
  const store = createInMemoryKVStore();
  assertEquals(store.get("nonexistent"), null);
});

Deno.test("KVStore - set and get roundtrip", () => {
  const store = createInMemoryKVStore();
  store.set("test_key", "test_value");
  assertEquals(store.get("test_key"), "test_value");
});

Deno.test("KVStore - set null value", () => {
  const store = createInMemoryKVStore();
  store.set("test_key", "value");
  store.set("test_key", null);
  assertEquals(store.get("test_key"), null);
});

Deno.test("KVStore - del removes key", () => {
  const store = createInMemoryKVStore();
  store.set("test_key", "test_value");
  store.del("test_key");
  assertEquals(store.get("test_key"), null);
});

Deno.test("KVStore - has returns true for existing key", () => {
  const store = createInMemoryKVStore();
  store.set("test_key", "test_value");
  assertEquals(store.has("test_key"), true);
});

Deno.test("KVStore - has returns false for non-existent key", () => {
  const store = createInMemoryKVStore();
  assertEquals(store.has("nonexistent"), false);
});

Deno.test("KVStore - all returns all entries", () => {
  const store = createInMemoryKVStore();
  store.set("key1", "value1");
  store.set("key2", "value2");
  const entries = store.all();
  assertEquals(entries.length, 2);
  assertEquals(entries.some((e) => e.key === "key1" && e.value === "value1"), true);
  assertEquals(entries.some((e) => e.key === "key2" && e.value === "value2"), true);
});

Deno.test("KVStore - clear removes all entries", () => {
  const store = createInMemoryKVStore();
  store.set("key1", "value1");
  store.set("key2", "value2");
  store.clear();
  assertEquals(store.all().length, 0);
});

// --- Stored Block Helpers Tests ---

Deno.test("getStoredBlock - returns default when key not found", () => {
  const store = createInMemoryKVStore();
  const result = getStoredBlock(store.get.bind(store), "nonexistent", 100n);
  assertEquals(result, 100n);
});

Deno.test("getStoredBlock - returns stored value as bigint", () => {
  const store = createInMemoryKVStore();
  store.set("block_key", "12345");
  const result = getStoredBlock(store.get.bind(store), "block_key", 0n);
  assertEquals(result, 12345n);
});

Deno.test("setStoredBlock - stores bigint as string", () => {
  const store = createInMemoryKVStore();
  setStoredBlock(store.set.bind(store), "block_key", 67890n);
  assertEquals(store.get("block_key"), "67890");
});

// --- Rate Limit Retry Tests ---

Deno.test("withRateLimitRetry - succeeds on first try", async () => {
  const fn = spy(() => Promise.resolve("success"));
  const result = await withRateLimitRetry(fn, "test", { logger: () => {} });
  assertEquals(result, "success");
  assertSpyCalls(fn, 1);
});

Deno.test("withRateLimitRetry - retries on rate limit error", async () => {
  let attempts = 0;
  const fn = spy(() => {
    attempts++;
    if (attempts < 3) {
      const error = new Error("Rate limit") as Error & { code: number };
      error.code = RATE_LIMIT_ERROR_CODE;
      return Promise.reject(error);
    }
    return Promise.resolve("success");
  });

  const result = await withRateLimitRetry(fn, "test", {
    initialDelayMs: 10,
    maxDelayMs: 50,
    maxRetries: 5,
    logger: () => {},
  });

  assertEquals(result, "success");
  assertSpyCalls(fn, 3);
});

Deno.test("withRateLimitRetry - throws after max retries", async () => {
  const fn = spy(() => {
    const error = new Error("Rate limit") as Error & { code: number };
    error.code = RATE_LIMIT_ERROR_CODE;
    return Promise.reject(error);
  });

  await assertRejects(
    () =>
      withRateLimitRetry(fn, "test", {
        initialDelayMs: 10,
        maxDelayMs: 50,
        maxRetries: 3,
        logger: () => {},
      }),
    Error,
    "Rate limit"
  );

  // Initial attempt + 3 retries = 4 calls
  assertSpyCalls(fn, 4);
});

Deno.test("withRateLimitRetry - throws immediately for non-rate-limit errors", async () => {
  const fn = spy(() => Promise.reject(new Error("other error")));

  await assertRejects(
    () =>
      withRateLimitRetry(fn, "test", {
        initialDelayMs: 10,
        maxRetries: 5,
        logger: () => {},
      }),
    Error,
    "other error"
  );

  assertSpyCalls(fn, 1);
});

Deno.test("withRateLimitRetry - applies exponential backoff", async () => {
  const delays: number[] = [];
  let attempts = 0;

  const fn = spy(() => {
    attempts++;
    if (attempts < 4) {
      const error = new Error("Rate limit") as Error & { code: number };
      error.code = RATE_LIMIT_ERROR_CODE;
      return Promise.reject(error);
    }
    return Promise.resolve("success");
  });

  const logMessages: string[] = [];
  const result = await withRateLimitRetry(fn, "test", {
    initialDelayMs: 10,
    maxDelayMs: 100,
    maxRetries: 5,
    logger: (msg) => logMessages.push(msg),
  });

  assertEquals(result, "success");
  assertSpyCalls(fn, 4);
  // Check that log messages mention increasing delays
  assertEquals(logMessages.length, 3);
  assertEquals(logMessages[0].includes("10ms"), true);
  assertEquals(logMessages[1].includes("20ms"), true);
  assertEquals(logMessages[2].includes("40ms"), true);
});

// --- Block Processing Logic Tests ---

Deno.test("block persistence - tracks progress correctly", () => {
  const store = createInMemoryKVStore();
  const LAST_PROCESSED_KEY = "test_last_processed";
  const BACKFILL_TARGET_KEY = "test_backfill_target";

  // Simulate initial state
  setStoredBlock(store.set.bind(store), BACKFILL_TARGET_KEY, 1000n);
  setStoredBlock(store.set.bind(store), LAST_PROCESSED_KEY, 500n);

  // Verify values
  assertEquals(getStoredBlock(store.get.bind(store), LAST_PROCESSED_KEY, 0n), 500n);
  assertEquals(getStoredBlock(store.get.bind(store), BACKFILL_TARGET_KEY, 0n), 1000n);

  // Simulate backfill progress
  setStoredBlock(store.set.bind(store), LAST_PROCESSED_KEY, 600n);
  assertEquals(getStoredBlock(store.get.bind(store), LAST_PROCESSED_KEY, 0n), 600n);
});

Deno.test("block persistence - live watcher logic", () => {
  const store = createInMemoryKVStore();
  const LAST_PROCESSED_KEY = "test_last_processed";
  const BACKFILL_TARGET_KEY = "test_backfill_target";

  // Set up: backfill target is 1000, last processed is 500 (backfill incomplete)
  setStoredBlock(store.set.bind(store), BACKFILL_TARGET_KEY, 1000n);
  setStoredBlock(store.set.bind(store), LAST_PROCESSED_KEY, 500n);

  // Simulate live watcher receiving block 1001
  const newBlock = 1001n;
  const target = getStoredBlock(store.get.bind(store), BACKFILL_TARGET_KEY, 0n);
  const lastProcessed = getStoredBlock(store.get.bind(store), LAST_PROCESSED_KEY, 0n);

  // Live watcher should NOT persist because backfill is incomplete
  const shouldPersist = lastProcessed >= target && newBlock > lastProcessed;
  assertEquals(shouldPersist, false);

  // Now complete the backfill
  setStoredBlock(store.set.bind(store), LAST_PROCESSED_KEY, 1000n);
  const lastProcessed2 = getStoredBlock(store.get.bind(store), LAST_PROCESSED_KEY, 0n);

  // Live watcher should now persist
  const shouldPersist2 = lastProcessed2 >= target && newBlock > lastProcessed2;
  assertEquals(shouldPersist2, true);
});

Deno.test("block persistence - handles crash recovery", () => {
  const store = createInMemoryKVStore();
  const LAST_PROCESSED_KEY = "test_last_processed";
  const BACKFILL_TARGET_KEY = "test_backfill_target";

  // Simulate state after crash during backfill
  setStoredBlock(store.set.bind(store), BACKFILL_TARGET_KEY, 1000n);
  setStoredBlock(store.set.bind(store), LAST_PROCESSED_KEY, 750n);

  // On restart, backfill should resume from 751
  const lastProcessed = getStoredBlock(store.get.bind(store), LAST_PROCESSED_KEY, 0n);
  const resumeFrom = lastProcessed + 1n;
  assertEquals(resumeFrom, 751n);

  // Verify target is still intact
  const target = getStoredBlock(store.get.bind(store), BACKFILL_TARGET_KEY, 0n);
  assertEquals(target, 1000n);
});

// --- Batch Processing Tests ---

Deno.test("batch calculation - handles exact batch boundaries", () => {
  const BATCH_SIZE = 100n;
  const fromBlock = 0n;
  const targetBlock = 99n;

  const toBlock = fromBlock + BATCH_SIZE - 1n > targetBlock
    ? targetBlock
    : fromBlock + BATCH_SIZE - 1n;

  assertEquals(toBlock, 99n);
});

Deno.test("batch calculation - handles partial final batch", () => {
  const BATCH_SIZE = 100n;
  const fromBlock = 900n;
  const targetBlock = 950n;

  const toBlock = fromBlock + BATCH_SIZE - 1n > targetBlock
    ? targetBlock
    : fromBlock + BATCH_SIZE - 1n;

  assertEquals(toBlock, 950n);
});

Deno.test("batch calculation - handles multiple full batches", () => {
  const BATCH_SIZE = 100n;
  let fromBlock = 0n;
  const targetBlock = 299n;
  const batches: Array<{ from: bigint; to: bigint }> = [];

  while (fromBlock <= targetBlock) {
    const toBlock = fromBlock + BATCH_SIZE - 1n > targetBlock
      ? targetBlock
      : fromBlock + BATCH_SIZE - 1n;

    batches.push({ from: fromBlock, to: toBlock });
    fromBlock = toBlock + 1n;
  }

  assertEquals(batches.length, 3);
  assertEquals(batches[0], { from: 0n, to: 99n });
  assertEquals(batches[1], { from: 100n, to: 199n });
  assertEquals(batches[2], { from: 200n, to: 299n });
});
