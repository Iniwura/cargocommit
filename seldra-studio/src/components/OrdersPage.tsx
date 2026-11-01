import { useState } from 'react';
import { isAddress } from 'viem';
import { NETWORK } from '@/config';
import { useWallet } from '@/hooks/useChain';
import { useMyOrders } from '@/hooks/useOrders';
import { shortAddress } from '@/lib/format';
import { formatNativeUsdc } from '@/lib/money';
import { OUTCOME_LABEL, STATUS_LABEL, outcomeName, roleOf, statusName } from '@/lib/order';
import { navigate } from '@/router';
import { Button, Notice, Stamp } from './ui';

const STEPS = [
  ['01', 'Create', 'The buyer fixes amount, deposit split, parties and four deadlines. They cannot be edited afterwards.'],
  ['02', 'Accept and fund', 'The supplier accepts the exact terms. The buyer funds once; the production deposit is paid out at that moment.'],
  ['03', 'Commit evidence', 'The supplier commits a hash of the shipment documents. The documents stay offchain.'],
  ['04', 'Release', 'The buyer approves and the protected reserve is released. Silence, disputes and missing shipments all have a fixed exit.'],
] as const;

function Register() {
  const wallet = useWallet();
  const orders = useMyOrders(wallet.address);

  if (!NETWORK.factory) {
    return <Notice tone="warn" title="No factory is configured for this network">Set the factory address for this network in .env (see .env.example).</Notice>;
  }
  if (!wallet.isConnected) {
    return (
      <div className="empty">
        <p className="serif">Connect a wallet to see the orders you take part in.</p>
        <p className="muted">Orders are listed straight from the factory registry for the buyer, supplier and arbiter wallets.</p>
      </div>
    );
  }
  if (orders.isLoading) return <p className="muted">Reading your orders from {NETWORK.label}…</p>;
  if (orders.error) return <Notice tone="warn" title="Could not read your orders">{orders.error.message.split('\n')[0]}</Notice>;
  if (orders.rows.length === 0) {
    return (
      <div className="empty">
        <p className="serif">No orders for this wallet yet.</p>
        <Button onClick={() => navigate('/new')}>Create the first order</Button>
      </div>
    );
  }

  return (
    <>
      <ul className="register">
        {orders.rows.map(({ address, summary }) => {
          const role = roleOf(summary, wallet.address);
          const status = statusName(summary);
          const counterparty = role === 'buyer' ? summary.supplier : summary.buyer;
          return (
            <li key={address}>
              <a
                href={`/order/${address}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/order/${address}`);
                }}
              >
                <span className="mono serial">{shortAddress(address)}</span>
                <span className="role-tag">{role}</span>
                <span className="serif row-amount">{formatNativeUsdc(summary.orderAmount)} <small>USDC</small></span>
                <span className="muted row-party">with {shortAddress(counterparty)}</span>
                <Stamp tone={status === 'SETTLED' ? 'quiet' : 'signal'}>
                  {status === 'SETTLED' ? OUTCOME_LABEL[outcomeName(summary)] : STATUS_LABEL[status]}
                </Stamp>
              </a>
            </li>
          );
        })}
      </ul>
      {orders.truncated ? <p className="field-hint">Showing the {orders.rows.length} most recent of {orders.total} orders.</p> : null}
    </>
  );
}

export function OrdersPage() {
  const [address, setAddress] = useState('');
  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow"><i className="rule" />Seldra · supplier-order settlement · {NETWORK.label}</p>
        <h1>
          Fund the order once.<br />
          Release payment as the shipment <em>becomes real.</em>
        </h1>
        <p className="lede">
          The buyer funds the full purchase order in native USDC. The supplier is paid a production deposit at once. The rest stays protected in the order until shipment evidence is committed and the buyer approves release.
        </p>
        <div className="hero-actions">
          <Button onClick={() => navigate('/new')}>New purchase order</Button>
        </div>
      </section>

      <section className="panel" aria-labelledby="register-title">
        <header className="panel-head"><h2 id="register-title">Order register</h2><span className="eyebrow">Your wallet</span></header>
        <Register />
        <form
          className="open-order"
          onSubmit={(e) => {
            e.preventDefault();
            if (isAddress(address.trim())) navigate(`/order/${address.trim()}`);
          }}
        >
          <label htmlFor="open-order" className="eyebrow">Open an order by address</label>
          <div>
            <input id="open-order" className="mono" value={address} placeholder="0x…" spellCheck={false} onChange={(e) => setAddress(e.target.value)} />
            <Button type="submit" variant="ghost" disabled={!isAddress(address.trim())}>Open</Button>
          </div>
        </form>
      </section>

      <section className="steps" aria-label="How settlement works">
        {STEPS.map(([n, title, body]) => (
          <article key={n}>
            <span className="mono step-no">{n}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <Notice title="Experimental software">
        It has had an automated review and a test suite, but no independent audit. Do not use it with funds you cannot lose.
      </Notice>
    </main>
  );
}
