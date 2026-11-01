import { formatNativeUsdc } from '@/lib/money';
import { formatPercentBps } from '@/lib/format';
import { outcomeName, statusName, type OrderSummary } from '@/lib/order';

/** Proportional deposit / reserve bar. The widths are the real split; the labels follow real onchain state. */
export function SettlementBar({ summary }: { summary: OrderSummary }) {
  const status = statusName(summary);
  const outcome = outcomeName(summary);
  const depositPct = summary.depositBps / 100;
  const funded = status !== 'CREATED' && status !== 'ACCEPTED' && !(status === 'SETTLED' && outcome === 'CANCELLED');

  const depositState = funded ? 'Paid to supplier' : 'Paid when funded';
  let reserveState = 'Locked when funded';
  if (funded && summary.reserveRemaining > 0n) reserveState = 'Protected in the order';
  if (status === 'SETTLED' && funded) {
    reserveState = outcome === 'SHIPMENT_DEADLINE_REFUND' ? 'Returned to buyer' : outcome === 'SUPPLIER_PAID' ? 'Released to supplier' : 'Split by outcome';
  }

  return (
    <figure className="settlement" aria-label="Deposit and protected reserve">
      <div className="settlement-bar" role="img" aria-label={`Deposit ${formatPercentBps(summary.depositBps)}, reserve ${formatPercentBps(10_000 - summary.depositBps)}`}>
        <div className={`seg seg-deposit${funded ? ' on' : ''}`} style={{ flexBasis: `${depositPct}%` }} />
        <div
          className={`seg seg-reserve${funded && summary.reserveRemaining > 0n ? ' on' : ''}${status === 'SETTLED' && funded ? ' released' : ''}`}
          style={{ flexBasis: `${100 - depositPct}%` }}
        />
      </div>
      <figcaption className="settlement-legend">
        <div>
          <span className="eyebrow">Production deposit · {formatPercentBps(summary.depositBps)}</span>
          <strong className="serif">{formatNativeUsdc(summary.depositAmount)} <small>USDC</small></strong>
          <span className="legend-state">{depositState}</span>
        </div>
        <div>
          <span className="eyebrow">Protected reserve · {formatPercentBps(10_000 - summary.depositBps)}</span>
          <strong className="serif">{formatNativeUsdc(summary.reserveAmount)} <small>USDC</small></strong>
          <span className="legend-state">{reserveState}</span>
        </div>
      </figcaption>
    </figure>
  );
}
