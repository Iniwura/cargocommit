export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function formatDateTime(seconds: bigint | number): string {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return '–';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}

/** "2d 3h", "45m", "12s", or "closed" when the deadline has passed. */
export function formatRemaining(deadline: bigint, nowSeconds: bigint): string {
  const left = Number(deadline - nowSeconds);
  if (left <= 0) return 'closed';
  const d = Math.floor(left / 86_400);
  const h = Math.floor((left % 86_400) / 3_600);
  const m = Math.floor((left % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${left}s`;
}

export function formatPercentBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}%`;
}
