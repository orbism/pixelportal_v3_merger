// Rate limiting config
export const RATE_LIMIT_ERROR_CODE = -32005; // EIP-1474: "Request limit exceeded"
export const RATE_LIMIT_INITIAL_DELAY_MS = 1000;
export const RATE_LIMIT_MAX_DELAY_MS = 30000;
export const RATE_LIMIT_MAX_RETRIES = 5;

// Helper to check if error is rate limiting
export function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const err = error as { code?: number; cause?: { code?: number } };
    return err.code === RATE_LIMIT_ERROR_CODE || err.cause?.code === RATE_LIMIT_ERROR_CODE;
  }
  return false;
}

// Helper to delay
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry with exponential backoff for rate limiting
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  context: string,
  options?: {
    initialDelayMs?: number;
    maxDelayMs?: number;
    maxRetries?: number;
    logger?: (msg: string) => void;
  }
): Promise<T> {
  const initialDelayMs = options?.initialDelayMs ?? RATE_LIMIT_INITIAL_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? RATE_LIMIT_MAX_DELAY_MS;
  const maxRetries = options?.maxRetries ?? RATE_LIMIT_MAX_RETRIES;
  const logger = options?.logger ?? console.log;

  let retries = 0;
  let delayMs = initialDelayMs;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (isRateLimitError(error) && retries < maxRetries) {
        retries++;
        logger(`[${context}] Rate limited, retry ${retries}/${maxRetries} after ${delayMs}ms`);
        await delay(delayMs);
        delayMs = Math.min(delayMs * 2, maxDelayMs);
      } else {
        throw error;
      }
    }
  }
}

// Get stored block number or fall back to default
export function getStoredBlock(
  get: (key: string) => string | null,
  key: string,
  defaultBlock: bigint
): bigint {
  const stored = get(key);
  return stored ? BigInt(stored) : defaultBlock;
}

// Update block number in kv store
export function setStoredBlock(
  set: (key: string, value: string | null) => void,
  key: string,
  blockNumber: bigint
): void {
  set(key, blockNumber.toString());
}
