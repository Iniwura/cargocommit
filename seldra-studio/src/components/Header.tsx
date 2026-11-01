import { useEffect, useRef, useState } from 'react';
import { useConnect, useDisconnect } from 'wagmi';
import { NETWORK } from '@/config';
import { useUsdcBalance, useWallet } from '@/hooks/useChain';
import { formatUsdcUnits } from '@/lib/money';
import { shortAddress } from '@/lib/format';
import { Button } from './ui';
import { navigate } from '@/router';

function ConnectPanel({ onDone }: { onDone: () => void }) {
  const { connectors, connectAsync, isPending, error } = useConnect();
  // Prefer individually discovered wallets (EIP-6963); keep the generic injected entry only when nothing else was found.
  const discovered = connectors.filter((c) => c.id !== 'injected');
  const installed = discovered.length > 0 ? discovered : connectors;
  return (
    <div className="popover" role="dialog" aria-label="Connect a wallet">
      <p className="eyebrow">Connect a wallet</p>
      {installed.length === 0 ? (
        <p className="field-hint">No browser wallet detected. Install a wallet extension, or open this app inside a wallet browser.</p>
      ) : (
        <ul className="wallet-list">
          {installed.map((connector) => (
            <li key={connector.uid}>
              <button
                type="button"
                className="wallet-option"
                disabled={isPending}
                onClick={() => connectAsync({ connector, chainId: NETWORK.chainId }).then(onDone, () => undefined)}
              >
                {connector.icon ? <img src={connector.icon} alt="" width={22} height={22} /> : <span className="wallet-dot" aria-hidden />}
                <span>{connector.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="field-error" role="alert">Could not connect: {error.message.split('\n')[0]}</p> : null}
      <p className="field-hint">Seldra never asks for a private key or seed phrase.</p>
    </div>
  );
}

function WalletMenu() {
  const wallet = useWallet();
  const { disconnect } = useDisconnect();
  const balance = useUsdcBalance(wallet.address);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!wallet.isConnected || !wallet.address) {
    return (
      <div className="wallet-wrap" ref={ref}>
        <Button onClick={() => setOpen((v) => !v)} busy={wallet.isConnecting}>Connect wallet</Button>
        {open ? <ConnectPanel onDone={() => setOpen(false)} /> : null}
      </div>
    );
  }

  return (
    <div className="wallet-wrap" ref={ref}>
      {!wallet.onTargetChain ? (
        <Button variant="danger" busy={wallet.isSwitching} onClick={() => void wallet.switchToTarget().catch(() => undefined)}>
          Switch to {NETWORK.label}
        </Button>
      ) : (
        <button type="button" className="wallet-chip" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="status-dot" aria-hidden />
          <span className="mono">{shortAddress(wallet.address)}</span>
          {balance.data !== undefined ? <span className="mono wallet-balance">{formatUsdcUnits(balance.data)} USDC</span> : null}
        </button>
      )}
      {open ? (
        <div className="popover" role="menu">
          <p className="eyebrow">Connected</p>
          <p className="mono break">{wallet.address}</p>
          <p className="field-hint">Balance shown is your single USDC balance on {NETWORK.label}. On Arc, gas is paid in the same USDC.</p>
          <Button variant="ghost" onClick={() => { disconnect(); setOpen(false); }}>Disconnect</Button>
        </div>
      ) : null}
    </div>
  );
}

export function Header({ path }: { path: string }) {
  const link = (to: string, label: string, active: boolean) => (
    <a
      href={to}
      className={active ? 'nav-link active' : 'nav-link'}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {label}
    </a>
  );
  return (
    <header className="site-header">
      <a href="/" className="wordmark" onClick={(e) => { e.preventDefault(); navigate('/'); }} aria-label="Seldra home">
        seldra<span>.</span>
      </a>
      <nav aria-label="Primary">
        {link('/', 'Orders', path === '/' || path.startsWith('/order/'))}
        {link('/new', 'New order', path === '/new')}
      </nav>
      <div className="header-right">
        <span className="network-pill"><i className="status-dot" aria-hidden />{NETWORK.label}</span>
        <WalletMenu />
      </div>
    </header>
  );
}
