import { useEffect, useMemo, useState } from 'react';
import { isAddress, type Address } from 'viem';
import { NETWORK, explorerAddress } from '@/config';
import { useNow, useWallet } from '@/hooks/useChain';
import { useInvariant, useIsFactoryOrder, useOrderSummary, usePendingCredit } from '@/hooks/useOrders';
import { formatDateTime, formatPercentBps, formatRemaining, shortHash } from '@/lib/format';
import { formatNativeUsdc } from '@/lib/money';
import { OUTCOME_LABEL, STATUS_LABEL, nextStep, outcomeName, roleOf, statusName, withWithdraw } from '@/lib/order';
import { isZeroHash } from '@/lib/hash';
import { buildShareLink } from '@/lib/share';
import { ActionPanel } from './ActionPanel';
import { HistoryLedger } from './HistoryLedger';
import { SettlementBar } from './SettlementBar';
import { AddressLink, Button, Notice, Stamp } from './ui';
import { navigate } from '@/router';

function CopyLink({ order }: { order: Address }) {
  const [link, setLink] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    void buildShareLink(`/order/${order}`).then((l) => live && setLink(l));
    return () => {
      live = false;
    };
  }, [order]);
  return (
    <Button
      variant="ghost"
      disabled={!link}
      onClick={() => {
        if (!link) return;
        void navigator.clipboard.writeText(link).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        });
      }}
    >
      {copied ? 'Link copied' : 'Copy order link'}
    </Button>
  );
}

export function OrderPage({ order }: { order: string }) {
  const now = useNow();
  const wallet = useWallet();

  if (!isAddress(order)) {
    return (
      <main className="page narrow">
        <Notice tone="warn" title="That is not a valid order address">Check the link and try again.</Notice>
        <Button variant="ghost" onClick={() => navigate('/')}>Back to orders</Button>
      </main>
    );
  }
  return <OrderView order={order} now={now} account={wallet.address} />;
}

function OrderView({ order, now, account }: { order: Address; now: bigint; account: Address | undefined }) {
  const { summary, isLoading, error } = useOrderSummary(order);
  const genuine = useIsFactoryOrder(order);
  const credit = usePendingCredit(order, account);
  const invariant = useInvariant(order);

  const role = summary ? roleOf(summary, account) : 'observer';
  const step = useMemo(
    () => (summary ? withWithdraw(nextStep(summary, role, now), credit.data ?? 0n) : undefined),
    [summary, role, now, credit.data],
  );

  if (isLoading) return <main className="page narrow"><p className="muted">Reading the order from {NETWORK.label}…</p></main>;
  if (error || !summary || !step) {
    return (
      <main className="page narrow">
        <Notice tone="warn" title="This address is not a Seldra order on this network">
          {error ? error.message.split('\n')[0] : 'No order data was returned.'}
        </Notice>
        <Button variant="ghost" onClick={() => navigate('/')}>Back to orders</Button>
      </main>
    );
  }

  const status = statusName(summary);
  const outcome = outcomeName(summary);
  const settled = status === 'SETTLED';

  const deadlines: Array<[string, bigint, boolean]> = [
    ['Funding closes', summary.fundingDeadline, status === 'CREATED' || status === 'ACCEPTED'],
    ['Shipment evidence due', summary.shipmentDeadline, status === 'FUNDED'],
    ['Buyer decision due', summary.buyerDecisionDeadline, status === 'SHIPMENT_SUBMITTED'],
    ['Arbiter window closes', summary.disputeDeadline, status === 'DISPUTED'],
  ];

  return (
    <main className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Orders</a>
        <span aria-hidden>/</span>
        <span className="mono">{order.slice(0, 10)}…</span>
      </nav>

      {genuine.data === false ? (
        <Notice tone="warn" title="This order was not created by the Seldra factory configured for this app">
          Its terms may be unreviewed. Do not fund it unless you trust whoever sent you here.
        </Notice>
      ) : null}

      <section className="order-sheet" aria-labelledby="order-title">
        <header className="order-head">
          <div>
            <p className="eyebrow">Purchase order · {NETWORK.label}</p>
            <h1 id="order-title" className="serif big-amount">
              {formatNativeUsdc(summary.orderAmount)} <small>USDC</small>
            </h1>
          </div>
          <div className="order-stamps">
            <Stamp tone={settled ? 'quiet' : 'signal'}>{settled ? OUTCOME_LABEL[outcome] : STATUS_LABEL[status]}</Stamp>
            <CopyLink order={order} />
            <a className="btn btn-ghost" href={explorerAddress(order)} target="_blank" rel="noopener noreferrer">Explorer ↗</a>
          </div>
        </header>

        <SettlementBar summary={summary} />

        <dl className="parties">
          {(
            [
              ['Buyer', summary.buyer, 'Funds the order'],
              ['Supplier', summary.supplier, 'Receives deposit, then reserve'],
              ['Arbiter', summary.arbiter, 'Splits the reserve in a dispute'],
            ] as const
          ).map(([label, address, note]) => (
            <div key={label}>
              <dt className="eyebrow">{label}</dt>
              <dd>
                <AddressLink address={address} you={account?.toLowerCase() === address.toLowerCase()} />
                <span className="muted">{note}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="order-grid">
        <div className="stack">
          <ActionPanel order={order} summary={summary} role={role} step={step} now={now} credit={credit.data ?? 0n} />
          <HistoryLedger order={order} fromBlock={summary.createdAtBlock} account={account} />
        </div>

        <aside className="stack">
          <section className="panel" aria-labelledby="deadlines-title">
            <header className="panel-head"><h2 id="deadlines-title">Deadlines</h2><span className="eyebrow">Fixed at creation</span></header>
            <ol className="deadlines">
              {deadlines.map(([label, at, active]) => (
                <li key={label} className={active ? 'active' : ''}>
                  <span>{label}</span>
                  <span className="mono">{formatDateTime(at)}</span>
                  <em>{now > at ? 'closed' : formatRemaining(at, now)}</em>
                </li>
              ))}
            </ol>
            <p className="field-hint">Fallback if a dispute is never resolved: supplier receives {formatPercentBps(summary.fallbackSupplierBps)} of the reserve.</p>
          </section>

          <section className="panel" aria-labelledby="proof-title">
            <header className="panel-head"><h2 id="proof-title">Commitments and accounting</h2></header>
            <dl className="facts">
              <div><dt>Terms hash</dt><dd className="mono">{shortHash(summary.termsHash)}</dd></div>
              <div><dt>Purchase-order reference</dt><dd className="mono">{isZeroHash(summary.referenceHash) ? 'none' : shortHash(summary.referenceHash)}</dd></div>
              <div><dt>Shipment evidence</dt><dd className="mono">{isZeroHash(summary.evidenceHash) ? 'not yet committed' : shortHash(summary.evidenceHash)}</dd></div>
              <div><dt>Dispute reason</dt><dd className="mono">{isZeroHash(summary.disputeReasonHash) ? 'none' : shortHash(summary.disputeReasonHash)}</dd></div>
              <div><dt>Held by the order</dt><dd className="mono">{formatNativeUsdc(summary.balance)} USDC</dd></div>
              <div><dt>Protected reserve</dt><dd className="mono">{formatNativeUsdc(summary.reserveRemaining)} USDC</dd></div>
              <div><dt>Credits awaiting withdrawal</dt><dd className="mono">{formatNativeUsdc(summary.totalPending)} USDC</dd></div>
              <div>
                <dt>Balance check</dt>
                <dd>{invariant.data === undefined ? '…' : invariant.data ? 'Backed: balance covers reserve and credits' : 'Mismatch: do not interact'}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </main>
  );
}
