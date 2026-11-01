import { parseEventLogs, type Address, type PublicClient } from 'viem';
import { seldraOrderAbi } from '@/abi.generated';
import { OUTCOME } from './order';
import { formatNativeUsdc } from './money';
import { shortHash } from './format';

export type HistoryItem = {
  id: string;
  label: string;
  detail: string;
  actor?: Address;
  blockNumber: bigint;
  logIndex: number;
  txHash: `0x${string}`;
  timestamp?: bigint;
};

/** Splits [from, to] into inclusive ranges of at most `size` blocks. */
export function blockRanges(from: bigint, to: bigint, size: bigint): Array<[bigint, bigint]> {
  if (size <= 0n) throw new Error('size must be positive');
  const ranges: Array<[bigint, bigint]> = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    ranges.push([start, end > to ? to : end]);
  }
  return ranges;
}

const CHUNK = 10_000n;
const usdc = (v: bigint) => `${formatNativeUsdc(v)} USDC`;

/**
 * Reads the complete event history of one order straight from the chain, starting at the block the
 * order was created in. Nothing here comes from a database or an indexer.
 */
export async function fetchOrderHistory(client: PublicClient, order: Address, fromBlock: bigint): Promise<HistoryItem[]> {
  const head = await client.getBlockNumber();
  const items: HistoryItem[] = [];

  for (const [start, end] of blockRanges(fromBlock, head, CHUNK)) {
    const raw = await client.getLogs({ address: order, fromBlock: start, toBlock: end });
    const parsed = parseEventLogs({ abi: seldraOrderAbi, logs: raw });
    for (const log of parsed) {
      const base = { id: `${log.transactionHash}-${log.logIndex}`, blockNumber: log.blockNumber, logIndex: log.logIndex, txHash: log.transactionHash };
      switch (log.eventName) {
        case 'TermsAccepted':
          items.push({ ...base, label: 'Terms accepted', detail: 'Supplier accepted the immutable terms.', actor: log.args.supplier });
          break;
        case 'Funded':
          items.push({ ...base, label: 'Order funded', detail: `${usdc(log.args.amount)} locked. Deposit ${usdc(log.args.deposit)}, protected reserve ${usdc(log.args.reserve)}.`, actor: log.args.buyer });
          break;
        case 'DepositPaid':
          items.push({ ...base, label: 'Deposit released', detail: `${usdc(log.args.amount)} sent to the supplier.`, actor: log.args.supplier });
          break;
        case 'EvidenceSubmitted':
          items.push({ ...base, label: 'Evidence committed', detail: `Commitment ${shortHash(log.args.evidenceHash)}`, actor: log.args.supplier });
          break;
        case 'ReleaseApproved':
          items.push({ ...base, label: 'Release approved', detail: 'Buyer approved the shipment evidence.', actor: log.args.buyer });
          break;
        case 'DisputeOpened':
          items.push({ ...base, label: 'Dispute opened', detail: `Reason commitment ${shortHash(log.args.reasonHash)}`, actor: log.args.buyer });
          break;
        case 'DisputeResolved':
          items.push({ ...base, label: 'Dispute resolved', detail: `Supplier ${usdc(log.args.supplierAmount)}, buyer ${usdc(log.args.buyerAmount)}.`, actor: log.args.arbiter });
          break;
        case 'OrderCancelled':
          items.push({ ...base, label: 'Order cancelled', detail: 'Closed before funding. No funds were held.', actor: log.args.by });
          break;
        case 'Settled':
          items.push({ ...base, label: 'Settled', detail: `${OUTCOME[log.args.outcome] ?? 'NONE'}: supplier ${usdc(log.args.supplierAmount)}, buyer ${usdc(log.args.buyerAmount)}.` });
          break;
        case 'PayoutDeferred':
          items.push({ ...base, label: 'Payout credited', detail: `${usdc(log.args.amount)} could not be pushed and is waiting for withdrawal.`, actor: log.args.recipient });
          break;
        case 'Withdrawn':
          items.push({ ...base, label: 'Credit withdrawn', detail: `${usdc(log.args.amount)} withdrawn.`, actor: log.args.recipient });
          break;
        case 'ExcessReturned':
          items.push({ ...base, label: 'Excess returned', detail: `${usdc(log.args.amount)} of unexpected value returned to the buyer.`, actor: log.args.buyer });
          break;
      }
    }
  }

  const blocks = [...new Set(items.map((i) => i.blockNumber))];
  const stamps = new Map<bigint, bigint>();
  await Promise.all(
    blocks.map(async (blockNumber) => {
      const block = await client.getBlock({ blockNumber });
      stamps.set(blockNumber, block.timestamp);
    }),
  );
  return items
    .map((i) => ({ ...i, timestamp: stamps.get(i.blockNumber) }))
    .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
}
