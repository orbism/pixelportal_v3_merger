import { setBurnFlagOnV3 } from "./v3.ts";
import { delay } from "./utils.ts";
import { recordFailedBurn } from "./db.ts";

const BURN_RETRY_COUNT = 3;
const BURN_RETRY_DELAY_MS = 4000;

interface BurnJob {
  label: string;
  tokenId: bigint;
  resolve: () => void;
  reject: (err: unknown) => void;
}

const burnQueue: BurnJob[] = [];
let queueWorkerRunning = false;
let isShuttingDown = false;
let drainResolve: (() => void) | null = null;

export function setShuttingDown(value: boolean): void {
  isShuttingDown = value;
  // If queue is already idle, resolve immediately
  if (value && !queueWorkerRunning) {
    drainResolve?.();
  }
}

// Returns a promise that resolves when the current job finishes and remaining jobs are drained.
export function waitForDrain(): Promise<void> {
  if (!queueWorkerRunning && burnQueue.length === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    drainResolve = resolve;
  });
}

// Enqueue a burn for sequential processing. Returns a promise that resolves
// when the job has been fully processed (or exhausted all retries).
export function enqueueBurn(label: string, tokenId: bigint): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[${label}] Queuing burn for token ${tokenId} (queue depth: ${burnQueue.length + 1})`);
    burnQueue.push({ label, tokenId, resolve, reject });
    if (!queueWorkerRunning) {
      runQueueWorker();
    }
  });
}

// Drains the queue one job at a time. During shutdown, finishes remaining jobs before stopping.
async function runQueueWorker(): Promise<void> {
  queueWorkerRunning = true;
  while (burnQueue.length > 0) {
    const job = burnQueue.shift()!;
    await processJobWithRetry(job);
  }
  queueWorkerRunning = false;
  if (isShuttingDown) {
    drainResolve?.();
  }
}

// Processes a single burn job with up to BURN_RETRY_COUNT attempts.
async function processJobWithRetry(job: BurnJob): Promise<void> {
  const { label, tokenId } = job;
  for (let attempt = 1; attempt <= BURN_RETRY_COUNT; attempt++) {
    try {
      await setBurnFlagOnV3(label, tokenId);
      job.resolve();
      return;
    } catch (error) {
      if (attempt < BURN_RETRY_COUNT) {
        console.error(`[${label}] Attempt ${attempt}/${BURN_RETRY_COUNT} failed for token ${tokenId}, retrying in ${BURN_RETRY_DELAY_MS}ms:`, error);
        await delay(BURN_RETRY_DELAY_MS);
      } else {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[${label}] All ${BURN_RETRY_COUNT} attempts failed for token ${tokenId}:`, error);
        try {
          recordFailedBurn(tokenId, label, errMsg);
          console.error(`[${label}] Recorded failed burn for token ${tokenId} in database`);
        } catch (dbErr) {
          console.error(`[${label}] Failed to record failed burn for token ${tokenId}:`, dbErr);
        }
        job.resolve(); // unblock callers — error already logged and recorded
      }
    }
  }
}
