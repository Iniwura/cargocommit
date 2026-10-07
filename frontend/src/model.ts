export type Role = 'buyer' | 'supplier' | 'arbiter' | 'observer';

export type SettlementSplit = {
  depositBps: number;
  reserveBps: number;
  depositAmount: bigint;
  reserveAmount: bigint;
};

export type CreateDraftValidation = {
  account?: string;
  supplier: string;
  arbiter: string;
  total: bigint;
  depositBps: string;
  fallbackBps: string;
  deadlines: readonly bigint[];
  now: bigint;
  poReference: string;
  documentReference: string;
  walletAvailable: boolean;
};

export type TransactionFailure<T> = {
  draft: T;
  error: string;
};

export function settlementSplit(total: bigint, depositBps: number): SettlementSplit {
  const normalizedDepositBps = Math.min(99, Math.max(0, Math.trunc(depositBps)));
  const depositAmount = total * BigInt(normalizedDepositBps) / 100n;
  return {
    depositBps: normalizedDepositBps,
    reserveBps: 100 - normalizedDepositBps,
    depositAmount,
    reserveAmount: total - depositAmount,
  };
}

export function distinctPartyAddresses(account: string | undefined, supplier: string, arbiter: string): boolean {
  const parties = [account, supplier, arbiter];
  return parties.every((value) => Boolean(value && /^0x[0-9a-fA-F]{40}$/.test(value)))
    && new Set(parties.map((value) => value!.toLowerCase())).size === 3;
}

export function orderedDeadlines(deadlines: readonly bigint[], now: bigint): boolean {
  return deadlines.length === 4
    && deadlines[0] > now
    && deadlines[1] > deadlines[0]
    && deadlines[2] > deadlines[1]
    && deadlines[3] > deadlines[2];
}

export function validateCreateDraft(draft: CreateDraftValidation): string {
  if (!draft.account || !draft.walletAvailable) return 'Connect an Arc wallet before creating an order.';
  if (!distinctPartyAddresses(draft.account, draft.supplier, draft.arbiter)) return 'Supplier and arbiter must be valid, distinct wallet addresses.';
  const deposit = Number(draft.depositBps);
  const fallback = Number(draft.fallbackBps);
  if (draft.total <= 0n || !Number.isInteger(deposit) || deposit < 1 || deposit > 99 || !Number.isInteger(fallback) || fallback < 0 || fallback > 100) {
    return 'Enter an amount, a production deposit from 1% to 99%, and a fallback share from 0% to 100%.';
  }
  if (!orderedDeadlines(draft.deadlines, draft.now)) return 'Deadlines must be future dates in strict chronological order.';
  if (!draft.poReference.trim() || !draft.documentReference.trim()) return 'Add a PO reference and a local document reference before review.';
  return '';
}

export function preserveDraftOnTransactionFailure<T>(draft: T, error: string): TransactionFailure<T> {
  return { draft, error };
}

export const STATUS_LABELS = [
  'Created',
  'Supplier accepted',
  'Funded',
  'Shipment submitted',
  'Disputed',
  'Settled',
] as const;

export const OUTCOME_LABELS = [
  'No outcome',
  'Cancelled',
  'Shipment deadline refund',
  'Supplier paid',
  'Dispute resolved',
  'Dispute fallback',
] as const;

export function formatUsdc(value: bigint | string | number, maximumFractionDigits = 6): string {
  const amount = typeof value === 'bigint' ? value : BigInt(value);
  const whole = amount / 1_000_000_000_000_000_000n;
  const fraction = (amount % 1_000_000_000_000_000_000n).toString().padStart(18, '0');
  const trimmed = fraction.slice(0, maximumFractionDigits).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

export function shortenAddress(address: string, left = 6, right = 4): string {
  return `${address.slice(0, left)}…${address.slice(-right)}`;
}

export function roleFor(account: string | undefined, buyer: string, supplier: string, arbiter: string): Role {
  if (!account) return 'observer';
  const normalized = account.toLowerCase();
  if (normalized === buyer.toLowerCase()) return 'buyer';
  if (normalized === supplier.toLowerCase()) return 'supplier';
  if (normalized === arbiter.toLowerCase()) return 'arbiter';
  return 'observer';
}

export function statusLabel(status: number): string {
  return STATUS_LABELS[status] ?? 'Unknown';
}

export function outcomeLabel(outcome: number): string {
  return OUTCOME_LABELS[outcome] ?? 'Unknown';
}

export function percentOf(value: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((value * 10_000n) / total) / 100;
}
