import type { Address } from 'viem';

export const STATUS = ['CREATED', 'ACCEPTED', 'FUNDED', 'SHIPMENT_SUBMITTED', 'DISPUTED', 'SETTLED'] as const;
export const OUTCOME = [
  'NONE',
  'CANCELLED',
  'SHIPMENT_DEADLINE_REFUND',
  'SUPPLIER_PAID',
  'DISPUTE_RESOLVED',
  'DISPUTE_FALLBACK',
] as const;

export type StatusName = (typeof STATUS)[number];
export type OutcomeName = (typeof OUTCOME)[number];
export type Role = 'buyer' | 'supplier' | 'arbiter' | 'observer';

export const STATUS_LABEL: Record<StatusName, string> = {
  CREATED: 'Awaiting supplier',
  ACCEPTED: 'Awaiting funding',
  FUNDED: 'Funded, awaiting shipment',
  SHIPMENT_SUBMITTED: 'Evidence committed',
  DISPUTED: 'In dispute',
  SETTLED: 'Settled',
};

export const OUTCOME_LABEL: Record<OutcomeName, string> = {
  NONE: 'Open',
  CANCELLED: 'Cancelled before funding',
  SHIPMENT_DEADLINE_REFUND: 'Reserve refunded to buyer',
  SUPPLIER_PAID: 'Supplier paid in full',
  DISPUTE_RESOLVED: 'Dispute resolved by arbiter',
  DISPUTE_FALLBACK: 'Dispute settled by fallback split',
};

/** Shape of SeldraOrder.orderSummary() as decoded by viem. */
export type OrderSummary = {
  buyer: Address;
  supplier: Address;
  arbiter: Address;
  orderAmount: bigint;
  depositAmount: bigint;
  reserveAmount: bigint;
  depositBps: number;
  fallbackSupplierBps: number;
  referenceHash: `0x${string}`;
  fundingDeadline: bigint;
  shipmentDeadline: bigint;
  buyerDecisionDeadline: bigint;
  disputeDeadline: bigint;
  termsHash: `0x${string}`;
  createdAtBlock: bigint;
  status: number;
  outcome: number;
  reserveRemaining: bigint;
  totalPending: bigint;
  acceptedAt: bigint;
  fundedAt: bigint;
  evidenceSubmittedAt: bigint;
  settledAt: bigint;
  evidenceHash: `0x${string}`;
  disputeReasonHash: `0x${string}`;
  balance: bigint;
};

export function statusName(summary: OrderSummary): StatusName {
  return STATUS[summary.status] ?? 'CREATED';
}

export function outcomeName(summary: OrderSummary): OutcomeName {
  return OUTCOME[summary.outcome] ?? 'NONE';
}

export function roleOf(summary: OrderSummary, account: Address | undefined): Role {
  if (!account) return 'observer';
  const a = account.toLowerCase();
  if (summary.buyer.toLowerCase() === a) return 'buyer';
  if (summary.supplier.toLowerCase() === a) return 'supplier';
  if (summary.arbiter.toLowerCase() === a) return 'arbiter';
  return 'observer';
}

export type ActionKey =
  | 'acceptTerms'
  | 'cancelBeforeFunding'
  | 'fund'
  | 'submitEvidence'
  | 'claimShipmentRefund'
  | 'approveRelease'
  | 'claimDecisionTimeout'
  | 'openDispute'
  | 'resolveDispute'
  | 'claimDisputeFallback'
  | 'withdraw';

export type NextStep = {
  /** who must act */
  actor: Role | 'anyone' | 'none';
  headline: string;
  detail: string;
  /** actions currently available to the connected role (before wallet and chain checks) */
  actions: ActionKey[];
  /** deadline the current step is racing, in unix seconds */
  deadline?: bigint;
};

/**
 * Describes the current step and the actions the connected role can attempt right now.
 * The contract remains the authority: this only decides which buttons to show.
 */
export function nextStep(s: OrderSummary, role: Role, nowSeconds: bigint): NextStep {
  const status = statusName(s);
  const past = (deadline: bigint) => nowSeconds > deadline;

  switch (status) {
    case 'CREATED':
      return {
        actor: 'supplier',
        headline: 'Waiting for the supplier to accept the terms',
        detail: 'The terms are fixed forever. The supplier signs off by accepting them onchain.',
        deadline: s.fundingDeadline,
        actions: [
          ...(role === 'supplier' && !past(s.fundingDeadline) ? (['acceptTerms'] as ActionKey[]) : []),
          ...(role === 'buyer' || past(s.fundingDeadline) ? (['cancelBeforeFunding'] as ActionKey[]) : []),
        ],
      };
    case 'ACCEPTED':
      return {
        actor: 'buyer',
        headline: 'Waiting for the buyer to fund the order',
        detail: 'Funding pays the production deposit to the supplier and locks the rest in this order.',
        deadline: s.fundingDeadline,
        actions: [
          ...(role === 'buyer' && !past(s.fundingDeadline) ? (['fund'] as ActionKey[]) : []),
          ...(role === 'buyer' || past(s.fundingDeadline) ? (['cancelBeforeFunding'] as ActionKey[]) : []),
        ],
      };
    case 'FUNDED':
      return {
        actor: past(s.shipmentDeadline) ? 'buyer' : 'supplier',
        headline: past(s.shipmentDeadline) ? 'Shipment evidence was not committed in time' : 'Waiting for shipment evidence',
        detail: past(s.shipmentDeadline)
          ? 'The buyer can now take back the protected reserve. The deposit stays with the supplier.'
          : 'The supplier commits a hash of the shipment documents. The documents themselves stay offchain.',
        deadline: s.shipmentDeadline,
        actions: [
          ...(role === 'supplier' && !past(s.shipmentDeadline) ? (['submitEvidence'] as ActionKey[]) : []),
          ...(role === 'buyer' && past(s.shipmentDeadline) ? (['claimShipmentRefund'] as ActionKey[]) : []),
        ],
      };
    case 'SHIPMENT_SUBMITTED':
      return {
        actor: past(s.buyerDecisionDeadline) ? 'supplier' : 'buyer',
        headline: past(s.buyerDecisionDeadline) ? 'The buyer did not decide in time' : 'Waiting for the buyer to approve or dispute',
        detail: past(s.buyerDecisionDeadline)
          ? 'The supplier can now collect the protected reserve.'
          : 'Approving releases the whole reserve to the supplier. Disputing freezes it for the arbiter.',
        deadline: s.buyerDecisionDeadline,
        actions: [
          ...(role === 'buyer' && !past(s.buyerDecisionDeadline) ? (['approveRelease', 'openDispute'] as ActionKey[]) : []),
          ...(role === 'supplier' && past(s.buyerDecisionDeadline) ? (['claimDecisionTimeout'] as ActionKey[]) : []),
        ],
      };
    case 'DISPUTED':
      return {
        actor: past(s.disputeDeadline) ? 'anyone' : 'arbiter',
        headline: past(s.disputeDeadline) ? 'The arbiter window has closed' : 'Waiting for the arbiter to split the reserve',
        detail: past(s.disputeDeadline)
          ? 'Anyone can now trigger the fixed fallback split agreed in the terms.'
          : 'The arbiter can divide only the protected reserve between buyer and supplier.',
        deadline: s.disputeDeadline,
        actions: [
          ...(role === 'arbiter' && !past(s.disputeDeadline) ? (['resolveDispute'] as ActionKey[]) : []),
          ...(past(s.disputeDeadline) && role !== 'observer' ? (['claimDisputeFallback'] as ActionKey[]) : []),
        ],
      };
    case 'SETTLED':
      return { actor: 'none', headline: 'Settled', detail: 'Every exit has been used. Nothing further can change.', actions: [] };
  }
}

/** Adds a withdraw action when the connected account has a deferred payout credit. */
export function withWithdraw(step: NextStep, credit: bigint): NextStep {
  if (credit === 0n || step.actions.includes('withdraw')) return step;
  return { ...step, actions: [...step.actions, 'withdraw'] };
}
