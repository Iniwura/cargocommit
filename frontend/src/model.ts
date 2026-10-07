export type Role = 'buyer' | 'supplier' | 'arbiter' | 'observer';

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
