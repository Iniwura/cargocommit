/** Incremental, newest-first factory log discovery. A failed window never advances the cursor. */
export const ORDER_DISCOVERY_CHUNK = 2_000n;
export const ORDER_DISCOVERY_PAGE_CHUNKS = 4;

export function previousOrderWindow(cursor: bigint, firstBlock: bigint, chunkSize = ORDER_DISCOVERY_CHUNK): readonly [bigint, bigint] | undefined {
  if (chunkSize <= 0n) throw new RangeError('Scan chunk must be positive.');
  if (cursor < firstBlock) return undefined;
  const start = cursor - firstBlock + 1n > chunkSize ? cursor - chunkSize + 1n : firstBlock;
  return [start, cursor];
}

export function isTemporaryRpcError(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();
  for (let i = 0; i < 6 && current && !seen.has(current); i += 1) {
    seen.add(current);
    if (typeof current === 'object') {
      const object = current as { code?: number | string; status?: number; message?: string; shortMessage?: string; cause?: unknown };
      if ([429, 502, 503, 504, -32005].some(code => Number(object.code) === code || object.status === code)) return true;
      if (/rate.limit|too many requests|timeout|timed out|fetch failed|network error|gateway|temporarily unavailable|HTTP request failed|connection reset|connection refused|exceeded.*limit/i.test(`${object.message ?? ''} ${object.shortMessage ?? ''}`)) return true;
      current = object.cause;
    } else if (typeof current === 'string') {
      return /rate.limit|timeout|timed out|network error|fetch failed|gateway/i.test(current);
    } else return false;
  }
  return false;
}

/** Only used for read-only RPC calls. Never retries wallet/signing operations. */
export async function retryOrderRead<T>(read: () => Promise<T>, pause: (ms: number) => Promise<void> = (ms) => new Promise(resolve => setTimeout(resolve, ms)), retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await read(); }
    catch (error) {
      if (attempt >= retries || !isTemporaryRpcError(error)) throw error;
      await pause(350 * (2 ** attempt));
    }
  }
}

/** Commit the next cursor only after its window returns successfully. */
export async function scanOrderPage<T>(options: {
  cursor: bigint;
  firstBlock: bigint;
  read: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>;
  onWindow: (logs: T[], fromBlock: bigint, toBlock: bigint) => Promise<void> | void;
  pageChunks?: number;
  chunkSize?: bigint;
  pause?: (ms: number) => Promise<void>;
}): Promise<{ cursor: bigint; completed: boolean; windows: number }> {
  const { firstBlock, read, onWindow, chunkSize = ORDER_DISCOVERY_CHUNK } = options;
  const pageChunks = options.pageChunks ?? ORDER_DISCOVERY_PAGE_CHUNKS;
  if (!Number.isSafeInteger(pageChunks) || pageChunks <= 0) throw new RangeError('Page chunks must be positive.');
  let cursor = options.cursor;
  let windows = 0;
  while (windows < pageChunks) {
    const range = previousOrderWindow(cursor, firstBlock, chunkSize);
    if (!range) break;
    const [start, end] = range;
    const logs = await retryOrderRead(() => read(start, end), options.pause);
    await onWindow(logs, start, end);
    cursor = start - 1n;
    windows += 1;
  }
  return { cursor, completed: cursor < firstBlock, windows };
}
