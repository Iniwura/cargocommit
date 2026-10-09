import type { Address } from 'viem';

export type Role = 'buyer' | 'supplier' | 'arbiter' | 'observer';

export type SettlementSplit = {
  depositPercent: number;
  reservePercent: number;
  /** UI-compatible aliases; ABI values live in the explicitly named contract fields below. */
  depositBps: number;
  reserveBps: number;
  contractDepositBps: bigint;
  contractReserveBps: bigint;
  depositAmount: bigint;
  reserveAmount: bigint;
};

export type CreateDraftValidation = {
  account?: string;
  supplier: string;
  arbiter: string;
  total: bigint;
  depositPercent: string;
  fallbackPercent: string;
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

export function percentToBps(percent: number): bigint {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError('Percentage must be a whole number from 0 to 100.');
  }
  return BigInt(percent) * 100n;
}

export function bpsToPercent(bps: bigint | number): number {
  const normalized = typeof bps === 'bigint' ? bps : BigInt(bps);
  if (normalized < 0n || normalized > 10_000n) {
    throw new RangeError('Basis points must be from 0 to 10000.');
  }
  return Number(normalized) / 100;
}

export function reserveBpsFrom(bps: bigint | number): bigint {
  const normalized = typeof bps === 'bigint' ? bps : BigInt(bps);
  if (normalized < 0n || normalized > 10_000n) {
    throw new RangeError('Basis points must be from 0 to 10000.');
  }
  return 10_000n - normalized;
}

export function settlementSplit(total: bigint, depositPercent: number): SettlementSplit {
  const normalizedDepositPercent = Math.min(99, Math.max(0, Math.trunc(depositPercent)));
  const depositBps = percentToBps(normalizedDepositPercent);
  const reserveBps = reserveBpsFrom(depositBps);
  const depositAmount = total * depositBps / 10_000n;
  return {
    depositPercent: normalizedDepositPercent,
    reservePercent: bpsToPercent(reserveBps),
    depositBps: normalizedDepositPercent,
    reserveBps: bpsToPercent(reserveBps),
    contractDepositBps: depositBps,
    contractReserveBps: reserveBps,
    depositAmount,
    reserveAmount: total - depositAmount,
  };
}

export function parseNativeUsdc(value: string): bigint {
  const normalized = value.replaceAll(',', '').trim() || '0';
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error('Invalid native USDC amount.');
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > 18) throw new Error('Native USDC amount has more than 18 decimals.');
  return BigInt(whole) * 1_000_000_000_000_000_000n + BigInt(fraction.padEnd(18, '0') || '0');
}

export function parseDeadlineSeconds(value: string): bigint {
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? BigInt(Math.floor(milliseconds / 1000)) : 0n;
}

export type CreateOrderDraftArgs = {
  buyer: Address;
  supplier: Address;
  arbiter: Address;
  amount: bigint;
  depositPercent: number;
  fallbackPercent: number;
  deadlines: readonly [bigint, bigint, bigint, bigint];
};

export type CreateOrderCall = {
  args: readonly [
    Address,
    Address,
    Address,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  value: 0n;
};

export type CreateOrderReview = {
  buyer?: string;
  supplier: string;
  arbiter: string;
  amount: bigint;
  depositPercent: number;
  fallbackPercent: number;
  deadlines: readonly [bigint, bigint, bigint, bigint];
};

export function buildCreateOrderReview(input: CreateOrderReview): CreateOrderReview {
  return {
    ...input,
    deadlines: [...input.deadlines] as [bigint, bigint, bigint, bigint],
  };
}

export type WalletReviewCheck = {
  ok: boolean;
  reason?: 'missing' | 'changed';
  reviewedBuyer?: string;
  activeBuyer?: string;
};

export function checkReviewedBuyer(reviewedBuyer: string | undefined, activeBuyer: string | undefined): WalletReviewCheck {
  if (!reviewedBuyer || !activeBuyer) return { ok: false, reason: 'missing', reviewedBuyer, activeBuyer };
  if (reviewedBuyer.toLowerCase() !== activeBuyer.toLowerCase()) return { ok: false, reason: 'changed', reviewedBuyer, activeBuyer };
  return { ok: true, reviewedBuyer, activeBuyer };
}

export type CreateReviewStateInput = {
  draftReady: boolean;
  reviewedBuyer?: string;
  activeBuyer?: string;
  reviewInvalidated?: boolean;
};

export type CreateReviewState = WalletReviewCheck & {
  reviewed: boolean;
  changed: boolean;
  reviewReady: boolean;
  createBlocked: boolean;
};

export function deriveCreateReviewState(input: CreateReviewStateInput): CreateReviewState {
  const walletCheck = checkReviewedBuyer(input.reviewedBuyer, input.activeBuyer);
  const reviewed = Boolean(input.reviewedBuyer);
  const changed = Boolean(reviewed && (input.reviewInvalidated || !input.activeBuyer || walletCheck.reason === 'changed'));
  const reviewReady = Boolean(input.draftReady && reviewed && !changed && walletCheck.ok);
  return { ...walletCheck, reviewed, changed, reviewReady, createBlocked: !reviewReady };
}

export function walletProviderMatches(selectedProvider: object | undefined, signerProvider: object | undefined): boolean {
  return Boolean(selectedProvider && signerProvider && selectedProvider === signerProvider);
}

export function buildCreateOrderCall(input: CreateOrderDraftArgs): CreateOrderCall {
  const [fundingDeadline, shipmentDeadline, buyerDecisionDeadline, disputeDeadline] = input.deadlines;
  return {
    args: [
      input.buyer,
      input.supplier,
      input.arbiter,
      input.amount,
      percentToBps(input.depositPercent),
      percentToBps(input.fallbackPercent),
      fundingDeadline,
      shipmentDeadline,
      buyerDecisionDeadline,
      disputeDeadline,
    ],
    value: 0n,
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
  const deposit = Number(draft.depositPercent);
  const fallback = Number(draft.fallbackPercent);
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
