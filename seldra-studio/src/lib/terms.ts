import { isAddress, type Address } from 'viem';
import { parseUsdcUnits, usdcUnitsToNative } from './money';

export const MAX_TERM_SECONDS = 365 * 24 * 60 * 60;
export const MIN_ORDER_USDC_UNITS = 10_000n; // 0.01 USDC

export type WindowSet = {
  /** seconds from now until funding must be complete */
  funding: number;
  /** seconds after the funding deadline until shipment evidence is due */
  shipment: number;
  /** seconds after the shipment deadline for the buyer to approve or dispute */
  decision: number;
  /** seconds after the decision deadline for the arbiter to resolve a dispute */
  dispute: number;
};

const MIN = 60;
const DAY = 24 * 60 * 60;

export const WINDOW_PRESETS: Record<'testnet' | 'standard', { label: string; hint: string; windows: WindowSet }> = {
  testnet: {
    label: 'Fast test',
    hint: 'Minutes-long windows for walking the whole flow on testnet.',
    windows: { funding: 30 * MIN, shipment: 30 * MIN, decision: 30 * MIN, dispute: 30 * MIN },
  },
  standard: {
    label: 'Standard',
    hint: 'Funding 3 days, shipment 30 days, buyer decision 7 days, dispute 14 days.',
    windows: { funding: 3 * DAY, shipment: 30 * DAY, decision: 7 * DAY, dispute: 14 * DAY },
  },
};

export type Deadlines = {
  fundingDeadline: bigint;
  shipmentDeadline: bigint;
  buyerDecisionDeadline: bigint;
  disputeDeadline: bigint;
};

/** Builds strictly increasing absolute deadlines from relative windows. */
export function buildDeadlines(nowSeconds: number, w: WindowSet): Deadlines {
  const funding = nowSeconds + w.funding;
  const shipment = funding + w.shipment;
  const decision = shipment + w.decision;
  const dispute = decision + w.dispute;
  return {
    fundingDeadline: BigInt(funding),
    shipmentDeadline: BigInt(shipment),
    buyerDecisionDeadline: BigInt(decision),
    disputeDeadline: BigInt(dispute),
  };
}

export type OrderForm = {
  supplier: string;
  arbiter: string;
  amount: string;
  depositPercent: string;
  fallbackPercent: string;
  referenceHash: `0x${string}` | '';
  windows: WindowSet;
};

export type FormErrors = Partial<Record<'supplier' | 'arbiter' | 'amount' | 'depositPercent' | 'fallbackPercent' | 'windows', string>>;

export type ValidatedOrder = {
  supplier: Address;
  arbiter: Address;
  orderAmount: bigint;
  depositBps: number;
  fallbackSupplierBps: number;
  referenceHash: `0x${string}`;
};

const ZERO_HASH = `0x${'0'.repeat(64)}` as const;

export function percentToBps(input: string): number | null {
  const value = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}

export function validateOrderForm(form: OrderForm, buyer: Address | undefined): { errors: FormErrors; value: ValidatedOrder | null } {
  const errors: FormErrors = {};
  const lower = (a: string) => a.trim().toLowerCase();

  if (!isAddress(form.supplier.trim())) errors.supplier = 'Enter a valid wallet address.';
  else if (buyer && lower(form.supplier) === lower(buyer)) errors.supplier = 'The supplier must be a different wallet from yours.';

  if (!isAddress(form.arbiter.trim())) errors.arbiter = 'Enter a valid wallet address.';
  else if (buyer && lower(form.arbiter) === lower(buyer)) errors.arbiter = 'The arbiter must be a different wallet from yours.';
  else if (isAddress(form.supplier.trim()) && lower(form.arbiter) === lower(form.supplier)) {
    errors.arbiter = 'The arbiter must be different from the supplier.';
  }

  const units = parseUsdcUnits(form.amount);
  if (units === null) errors.amount = 'Enter an amount with up to 6 decimals.';
  else if (units < MIN_ORDER_USDC_UNITS) errors.amount = 'The minimum order is 0.01 USDC.';

  const depositBps = percentToBps(form.depositPercent);
  if (depositBps === null || depositBps < 1 || depositBps > 9999) errors.depositPercent = 'Use a deposit between 0.01% and 99.99%.';

  const fallbackBps = percentToBps(form.fallbackPercent);
  if (fallbackBps === null || fallbackBps > 10_000) errors.fallbackPercent = 'Use a share between 0% and 100%.';

  const w = form.windows;
  const total = w.funding + w.shipment + w.decision + w.dispute;
  if (Object.values(w).some((s) => !Number.isFinite(s) || s < 10 * MIN)) {
    errors.windows = 'Every window must be at least 10 minutes.';
  } else if (total > MAX_TERM_SECONDS) {
    errors.windows = 'All windows together must fit inside 365 days.';
  }

  if (Object.keys(errors).length > 0 || units === null || depositBps === null || fallbackBps === null) {
    return { errors, value: null };
  }
  return {
    errors,
    value: {
      supplier: form.supplier.trim() as Address,
      arbiter: form.arbiter.trim() as Address,
      orderAmount: usdcUnitsToNative(units),
      depositBps,
      fallbackSupplierBps: fallbackBps,
      referenceHash: form.referenceHash === '' ? ZERO_HASH : form.referenceHash,
    },
  };
}
