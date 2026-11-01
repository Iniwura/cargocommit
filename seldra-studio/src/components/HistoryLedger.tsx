import { useOrderHistory } from '@/hooks/useOrders';
import { formatDateTime } from '@/lib/format';
import type { Address } from 'viem';
import { AddressLink, TxLink } from './ui';

/** Complete settlement history, rebuilt from the order contract's own event logs. */
export function HistoryLedger({ order, fromBlock, account }: { order: Address; fromBlock: bigint; account?: Address }) {
  const history = useOrderHistory(order, fromBlock);

  return (
    <section className="panel" aria-labelledby="history-title">
      <header className="panel-head">
        <h2 id="history-title">Settlement history</h2>
        <span className="eyebrow">Read from onchain events</span>
      </header>
      {history.isLoading ? <p className="muted">Reading the order's event log…</p> : null}
      {history.error ? (
        <p className="field-error" role="alert">Could not read the event log right now. The order state above is still live. {history.error.message.split('\n')[0]}</p>
      ) : null}
      {history.data && history.data.length === 0 && !history.isLoading ? <p className="muted">No events yet.</p> : null}
      {history.data && history.data.length > 0 ? (
        <ol className="ledger">
          {history.data.map((item) => (
            <li key={item.id}>
              <div className="ledger-when mono">{item.timestamp ? formatDateTime(item.timestamp) : `block ${item.blockNumber}`}</div>
              <div className="ledger-body">
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
                <div className="ledger-meta">
                  {item.actor ? <AddressLink address={item.actor} you={account?.toLowerCase() === item.actor.toLowerCase()} /> : null}
                  <TxLink hash={item.txHash} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
