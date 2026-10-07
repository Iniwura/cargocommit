export const ORDER_LOG_CHUNK_SIZE = 2_000n;

export function orderCreatedBlockRanges(fromBlock: bigint, toBlock: bigint, chunkSize: bigint = ORDER_LOG_CHUNK_SIZE): Array<readonly [bigint, bigint]> {
  if (chunkSize < 1n) throw new Error('Log chunk size must be positive.');
  const ranges: Array<readonly [bigint, bigint]> = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
    ranges.push([start, end]);
  }
  return ranges;
}
