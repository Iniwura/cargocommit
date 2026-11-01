import type { ReactNode } from 'react';
import { explorerAddress, explorerTx } from '@/config';
import { shortAddress, shortHash } from '@/lib/format';
import type { TxState } from '@/hooks/useTx';

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  const { children, onClick, variant = 'primary', disabled, busy, type = 'button', title } = props;
  return (
    <button type={type} className={`btn btn-${variant}`} onClick={onClick} disabled={disabled || busy} aria-busy={busy} title={title}>
      {busy ? <span className="spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Field(props: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className={`field${props.error ? ' has-error' : ''}`}>
      <label htmlFor={props.htmlFor}>{props.label}</label>
      {props.children}
      {props.error ? <p className="field-error" role="alert">{props.error}</p> : props.hint ? <p className="field-hint">{props.hint}</p> : null}
    </div>
  );
}

export function AddressLink({ address, you }: { address: string; you?: boolean }) {
  return (
    <a className="mono address-link" href={explorerAddress(address)} target="_blank" rel="noopener noreferrer" title={address}>
      {shortAddress(address)}
      {you ? <em className="you-tag">you</em> : null}
    </a>
  );
}

export function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a className="mono tx-link" href={explorerTx(hash)} target="_blank" rel="noopener noreferrer">
      {label ?? shortHash(hash)} <span aria-hidden>↗</span>
    </a>
  );
}

/** Honest transaction state: only phases reported by the wallet and the chain. */
export function TxStatus({ state, successText }: { state: TxState; successText?: string }) {
  if (state.phase === 'idle') return null;
  if (state.phase === 'wallet') {
    return <p className="tx-status" role="status">Confirm the transaction in your wallet…</p>;
  }
  if (state.phase === 'confirming') {
    return (
      <p className="tx-status" role="status">
        Submitted. Waiting for the network to confirm… {state.hash ? <TxLink hash={state.hash} /> : null}
      </p>
    );
  }
  if (state.phase === 'success') {
    return (
      <p className="tx-status tx-ok" role="status">
        {successText ?? 'Confirmed onchain.'} {state.hash ? <TxLink hash={state.hash} label="View transaction" /> : null}
      </p>
    );
  }
  return (
    <p className="tx-status tx-fail" role="alert">
      {state.message ?? 'The transaction failed.'} {state.hash ? <TxLink hash={state.hash} /> : null}
    </p>
  );
}

export function Stamp({ children, tone = 'ink' }: { children: ReactNode; tone?: 'ink' | 'signal' | 'quiet' }) {
  return <span className={`stamp stamp-${tone}`}>{children}</span>;
}

export function Notice({ title, children, tone = 'info' }: { title: string; children?: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'warn' ? 'alert' : 'note'}>
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
