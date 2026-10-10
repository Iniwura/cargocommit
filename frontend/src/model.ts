import type { Address, Hash } from 'viem';

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

export type CreateWizardStep = 1 | 2 | 3 | 4;

export type LocalOrderDraft = {
  supplier: string;
  arbiter: string;
  amount: string;
  depositPercent: string;
  fallbackPercent: string;
  fundingDeadline: string;
  shipmentDeadline: string;
  buyerDecisionDeadline: string;
  disputeDeadline: string;
  poReference: string;
  documentReference: string;
  step: CreateWizardStep;
};

export const CREATE_DRAFT_STORAGE_KEY = 'cargocommit:create-draft';

export function normalizeCreateWizardStep(value: unknown): CreateWizardStep {
  const step = typeof value === 'number' ? value : Number(value);
  if (step === 2 || step === 3 || step === 4) return step;
  return 1;
}

export function serializeLocalOrderDraft(draft: LocalOrderDraft): string {
  return JSON.stringify({ ...draft, step: normalizeCreateWizardStep(draft.step) });
}

export function restoreLocalOrderDraft(raw: string | null, fallback: LocalOrderDraft): LocalOrderDraft {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalOrderDraft>;
    return {
      ...fallback,
      ...Object.fromEntries(Object.keys(fallback).filter((key) => key !== 'step').map((key) => [key, typeof parsed[key as keyof LocalOrderDraft] === 'string' ? parsed[key as keyof LocalOrderDraft] : fallback[key as keyof LocalOrderDraft]])),
      step: normalizeCreateWizardStep(parsed.step),
    } as LocalOrderDraft;
  } catch {
    return fallback;
  }
}

export type PreSignatureInstrument = CreateOrderReview & {
  poReference: string;
  documentReference: string;
  createTransactionValue: 0n;
  state: 'READY TO CREATE';
};

export function buildPreSignatureInstrument(input: CreateOrderReview & { poReference: string; documentReference: string }): PreSignatureInstrument {
  return {
    ...buildCreateOrderReview(input),
    poReference: input.poReference,
    documentReference: input.documentReference,
    createTransactionValue: 0n,
    state: 'READY TO CREATE',
  };
}

export type CreatedOrderReceipt = {
  order: Address;
  transactionHash: Hash;
  state: 'PURCHASE ORDER CREATED';
  status: 'AWAITING SUPPLIER ACCEPTANCE';
  nextAction: 'SUPPLIER ACCEPTS';
};

export function buildCreatedOrderReceipt(order: Address, transactionHash: Hash): CreatedOrderReceipt {
  return { order, transactionHash, state: 'PURCHASE ORDER CREATED', status: 'AWAITING SUPPLIER ACCEPTANCE', nextAction: 'SUPPLIER ACCEPTS' };
}

export function orderAddressFromHash(hash: string): Address | undefined {
  const match = hash.match(/^#(?:order|orders)\/(0x[0-9a-fA-F]{40})(?:\/\d+)?\/?(?:$|\?)/);
  return match?.[1] as Address | undefined;
}

export type ActionSnapshot = {
  status: number;
  fundingDeadline?: bigint;
  shipmentDeadline: bigint;
  buyerDecisionDeadline: bigint;
  disputeDeadline: bigint;
};

export function nextActionForRole(role: Role, snapshot?: ActionSnapshot, now = BigInt(Math.floor(Date.now() / 1000))): string {
  if (!snapshot) return 'READING STATE';
  if (snapshot.status === 5) return 'SETTLED';
  if (snapshot.status === 0) {
    if (snapshot.fundingDeadline !== undefined && now > snapshot.fundingDeadline) return role === 'buyer' ? 'CANCEL EXPIRED ORDER' : 'FUNDING EXPIRED';
    return role === 'supplier' ? 'ACCEPT ORDER' : role === 'buyer' ? 'WAITING FOR ACCEPTANCE' : 'SUPPLIER ACCEPTS';
  }
  if (snapshot.status === 1) {
    if (snapshot.fundingDeadline !== undefined && now > snapshot.fundingDeadline) return role === 'buyer' ? 'CANCEL EXPIRED ORDER' : 'FUNDING EXPIRED';
    return role === 'buyer' ? 'FUND ORDER' : role === 'supplier' ? 'WAITING FOR FUNDING' : 'BUYER FUNDS';
  }
  if (snapshot.status === 2) {
    if (now > snapshot.shipmentDeadline) return role === 'buyer' ? 'CLAIM REFUND' : 'SHIPMENT DEADLINE PASSED';
    return role === 'supplier' ? 'SUBMIT EVIDENCE' : 'SHIPMENT EVIDENCE';
  }
  if (snapshot.status === 3) {
    if (role === 'buyer') return now <= snapshot.buyerDecisionDeadline ? 'APPROVE OR DISPUTE' : 'SUPPLIER TIMEOUT';
    if (role === 'supplier') return now > snapshot.buyerDecisionDeadline ? 'CLAIM TIMEOUT' : 'WAITING FOR BUYER';
    return 'BUYER APPROVES OR DISPUTES';
  }
  if (snapshot.status === 4) {
    if (role === 'arbiter' && now <= snapshot.disputeDeadline) return 'RESOLVE DISPUTE';
    if (now > snapshot.disputeDeadline) return 'CLAIM FALLBACK';
    return 'DISPUTE WINDOW OPEN';
  }
  return statusLabel(snapshot.status).toUpperCase();
}

/** Timestamps are authoritative: terminal CANCELLED does not mean money was funded. */
export function orderLifecycleMilestones(snapshot: {
  acceptedAt: bigint; fundedAt: bigint; shipmentSubmittedAt: bigint;
  status: number; outcome: number;
}): readonly (readonly [string, boolean])[] {
  const terminal = snapshot.status === 4 ? 'DISPUTE OPENED'
    : snapshot.outcome === 1 ? 'ORDER CANCELLED'
    : snapshot.outcome === 2 ? 'SHIPMENT REFUNDED'
    : snapshot.outcome === 4 || snapshot.outcome === 5 ? 'DISPUTE RESOLVED'
    : 'SETTLED / RESOLVED';
  return [
    ['TERMS CREATED', true],
    ['SUPPLIER ACCEPTED', snapshot.acceptedAt > 0n],
    ['ORDER FUNDED', snapshot.fundedAt > 0n],
    ['EVIDENCE SUBMITTED', snapshot.shipmentSubmittedAt > 0n],
    [terminal, snapshot.status === 4 || snapshot.status === 5],
  ] as const;
}

export function actionRequiredForRole(role: Role, snapshot: ActionSnapshot | undefined, now = BigInt(Math.floor(Date.now() / 1000))): boolean {
  return ['CANCEL EXPIRED ORDER', 'ACCEPT ORDER', 'FUND ORDER', 'SUBMIT EVIDENCE', 'CLAIM REFUND', 'APPROVE OR DISPUTE', 'CLAIM TIMEOUT', 'RESOLVE DISPUTE', 'CLAIM FALLBACK'].includes(nextActionForRole(role, snapshot, now));
}

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

/** Human-readable spacing for the four order deadlines in the wizard timeline.
 *  Timeline row zero is creation; row one is the first deadline, without an interval.
 */
export function deadlineGapLabel(deadlines: readonly bigint[], timelineIndex: number): string | undefined {
  if (!Number.isInteger(timelineIndex) || timelineIndex < 2 || timelineIndex > deadlines.length) return undefined;
  const earlier = deadlines[timelineIndex - 2];
  const later = deadlines[timelineIndex - 1];
  if (earlier === undefined || later === undefined || later <= earlier) return undefined;
  const seconds = Number(later - earlier);
  if (!Number.isFinite(seconds)) return undefined;
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(hours / 24);
  const remaining = hours % 24;
  if (days && remaining) return `${days}D ${remaining}H`;
  if (days) return `${days}D`;
  return `${hours}H`;
}

/** A link block can accelerate factory lookup, but must be verified against factory logs. */
export function orderBlockHintFromHash(hash: string): bigint | undefined {
  const match = hash.match(/^#(?:order|orders)\/0x[0-9a-fA-F]{40}\/(\d+)(?:\/?(?:$|\?))/);
  return match ? BigInt(match[1]) : undefined;
}

/** Validates onchain readback against an official factory OrderCreated log.
 * A factory event alone is insufficient because the factory permits arbitrary buyer addresses.
 */
export type FactoryCreatedTerms = {
  buyer: string; supplier: string; arbiter: string; orderAmount: bigint;
  depositBps: number; fallbackSupplierBps: number;
  fundingDeadline: bigint; shipmentDeadline: bigint; buyerDecisionDeadline: bigint; disputeDeadline: bigint;
  termsHash: string;
};
export type OrderReadbackTerms = FactoryCreatedTerms & { accountingInvariant: boolean };
export function factoryOriginMatches(created: FactoryCreatedTerms, originator: string, snapshot: OrderReadbackTerms): boolean {
  return originator.toLowerCase() === created.buyer.toLowerCase()
    && created.buyer.toLowerCase() === snapshot.buyer.toLowerCase()
    && created.supplier.toLowerCase() === snapshot.supplier.toLowerCase()
    && created.arbiter.toLowerCase() === snapshot.arbiter.toLowerCase()
    && created.orderAmount === snapshot.orderAmount
    && created.depositBps === snapshot.depositBps
    && created.fallbackSupplierBps === snapshot.fallbackSupplierBps
    && created.fundingDeadline === snapshot.fundingDeadline
    && created.shipmentDeadline === snapshot.shipmentDeadline
    && created.buyerDecisionDeadline === snapshot.buyerDecisionDeadline
    && created.disputeDeadline === snapshot.disputeDeadline
    && created.termsHash.toLowerCase() === snapshot.termsHash.toLowerCase()
    && snapshot.accountingInvariant;
}
