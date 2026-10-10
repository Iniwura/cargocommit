import { useCallback, useEffect, useRef, useState } from 'react';
import { isHex, keccak256, toBytes, type Address, type Hash, type WalletClient } from 'viem';
import { ARC_DEPLOYMENT_BLOCK, arcMainnet, explorerAddress, explorerTx, fetchOrderActivity, publicClient, readOrderSnapshot, type OrderActivityItem } from './chain';
import { orderAbi, type OrderCreatedLog } from './contracts';
import { actionRequiredForRole, formatUsdc, nextActionForRole, orderAddressFromHash, outcomeLabel, roleFor, shortenAddress, statusLabel, type Role } from './model';

type Snapshot = Awaited<ReturnType<typeof readOrderSnapshot>>;
export type EnrichedOrder = OrderCreatedLog & { snapshot?: Snapshot };
type OrderFilter = 'all' | 'action' | 'active' | 'settled';

function money(value: bigint | string | number): string {
  const [whole, fraction = ''] = formatUsdc(value, 6).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0')}`;
}

function dateLabel(value: bigint): string {
  const date = new Date(Number(value) * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date).toUpperCase();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.replace(/^User rejected the request\.?$/i, 'Wallet request was cancelled.');
  return 'The network request failed. Check your wallet and try again.';
}

function hashReference(value: string): `0x${string}` {
  const text = value.trim();
  if (isHex(text) && text.length === 66) return text as `0x${string}`;
  return keccak256(toBytes(text || 'CargoCommit commitment'));
}

function SectionMark({ index, label }: { index: string; label: string }) { return <div className="section-mark"><span>{index}</span><strong>{label}</strong></div>; }
function Stamp({ children, tone = 'signal' }: { children: React.ReactNode; tone?: 'signal' | 'ink' | 'alert' }) { return <span className={`document-stamp ${tone}`}>{children}</span>; }
function StatusDot({ active = false, blocked = false }: { active?: boolean; blocked?: boolean }) { return <span className={`status-dot ${active ? 'is-active' : ''} ${blocked ? 'is-blocked' : ''}`} aria-hidden="true" />; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field-v2"><span>{label}</span>{children}</label>; }
function TxLink({ hash, children }: { hash: string; children: React.ReactNode }) { return <a className="tx-link" href={explorerTx(hash)} target="_blank" rel="noreferrer">{children} ↗</a>; }
function ActionButton({ children, onClick, busy, disabled = false, secondary = false }: { children: React.ReactNode; onClick: () => void; busy: boolean; disabled?: boolean; secondary?: boolean }) { return <button type="button" className={secondary ? 'secondary-button action-button-v2' : 'primary-button action-button-v2'} onClick={onClick} disabled={busy || disabled}>{busy ? 'WAITING FOR RECEIPT…' : children}</button>; }
function SettlementBar({ depositAmount, reserveAmount, depositPercent, reserveLabel = 'PROTECTED' }: { depositAmount: bigint; reserveAmount: bigint; depositPercent?: number; reserveLabel?: string }) { const safeDepositPercent = depositPercent ?? (depositAmount + reserveAmount > 0n ? Number((depositAmount * 100n) / (depositAmount + reserveAmount)) : 0); const reservePercent = 100 - safeDepositPercent; return <div className="settlement-bar" aria-label={`${safeDepositPercent} percent released and ${reservePercent} percent ${reserveLabel.toLowerCase()}`}><div className="released-segment"><span>{safeDepositPercent}%</span><b>RELEASED</b><small>{money(depositAmount)}</small></div><div className="protected-segment"><span>{reservePercent}%</span><b>{reserveLabel}</b><small>{money(reserveAmount)}</small></div></div>; }

function whoMustAct(snapshot: Snapshot, role: Role): string {
  if (snapshot.status === 5) return 'NO ACTION / COMPLETE';
  if (snapshot.status === 0) return 'SUPPLIER / EXPORTER';
  if (snapshot.status === 1) return 'BUYER / IMPORTER';
  if (snapshot.status === 2) return 'SUPPLIER / EXPORTER';
  if (snapshot.status === 3) return 'BUYER / IMPORTER';
  if (snapshot.status === 4) return 'ARBITER / RESOLUTION';
  return role === 'observer' ? 'IMMUTABLE PARTIES' : role.toUpperCase();
}

function activityTime(item: OrderActivityItem): string {
  if (item.blockTimestamp !== undefined) return dateLabel(item.blockTimestamp);
  return item.blockNumber === undefined ? 'BLOCK UNAVAILABLE' : `BLOCK ${item.blockNumber}`;
}

export function OrdersPage({ account, orders, selected, onSelect, onRefresh, onConnect, onCreate, loading, readState, readError }: { account?: Address; orders: EnrichedOrder[]; selected?: Address; onSelect: (order: Address) => void; onRefresh: () => void; onConnect: () => void; onCreate: () => void; loading: boolean; readState: 'idle' | 'loading' | 'success' | 'error'; readError: string }) {
  const [filter, setFilter] = useState<OrderFilter>('all');
  const filtered = orders.filter((order) => {
    const snapshot = order.snapshot;
    if (filter === 'all') return true;
    if (!snapshot) return filter === 'active';
    if (filter === 'settled') return snapshot.status === 5;
    if (filter === 'active') return snapshot.status !== 5;
    return actionRequiredForRole(roleFor(account, snapshot.buyer, snapshot.supplier, snapshot.arbiter), snapshot);
  });
  const ledger = filtered.length === 0
    ? <div className="empty-state-v2"><Stamp tone="ink">NO RECORD</Stamp><h2>NO ORDERS FOUND</h2><p>The Arc order register returned successfully, but no orders involve this wallet.</p><button className="secondary-button empty-state-action" onClick={onCreate}>CREATE ORDER</button></div>
    : <div className="ledger-list"><div className="ledger-heading"><span>REF / ORDER</span><span>ROLE</span><span>AMOUNT / SPLIT</span><span>STATE / NEXT ACTION</span><span>DEADLINE</span></div>{filtered.map((order, index) => { const snapshot = order.snapshot; const role = roleFor(account, snapshot?.buyer ?? order.buyer, snapshot?.supplier ?? order.supplier, snapshot?.arbiter ?? order.arbiter); const action = nextActionForRole(role, snapshot); const actionable = snapshot ? actionRequiredForRole(role, snapshot) : false; return <button className={`ledger-row ${selected?.toLowerCase() === order.order.toLowerCase() ? 'selected' : ''} ${actionable ? 'action-required' : ''}`} onClick={() => onSelect(order.order)} key={order.order}><span className="ledger-index">{String(index + 1).padStart(2, '0')}</span><span className="ledger-order"><strong>PO / {shortenAddress(order.order, 8, 6)}</strong><small>{shortenAddress(order.buyer)} BUYER · {shortenAddress(order.supplier)} SUPPLIER</small></span><span className="ledger-role"><b>{role.toUpperCase()}</b><small>{snapshot ? money(snapshot.orderAmount) : money(order.orderAmount)} · {snapshot ? snapshot.depositBps : order.depositBps}/{100 - (snapshot?.depositBps ?? order.depositBps)}</small></span><span className="ledger-state"><b>{snapshot ? statusLabel(snapshot.status).toUpperCase() : 'READING…'}</b><small>{actionable ? `ACTION REQUIRED · ${action}` : action}</small></span><span className="ledger-deadline"><b>{snapshot ? dateLabel(snapshot.shipmentDeadline) : dateLabel(order.shipmentDeadline)}</b><small>{snapshot ? `${money(snapshot.reserveRemaining)} RESERVE` : 'READING STATE'}</small></span><em>↗</em></button>; })}</div>;
  const registerError = <div className="form-alert-v2 error order-read-alert"><span>ORDER REGISTER UNAVAILABLE · Arc could not be reached. {readError || 'Retry the order register.'}</span><button type="button" className="quiet-button" onClick={onRefresh}>RETRY</button></div>;
  const registerContent = readState === 'error' ? orders.length > 0 ? <>{registerError}{ledger}</> : <div className="empty-state-v2"><Stamp tone="alert">READ ERROR</Stamp><h2>ORDER REGISTER UNAVAILABLE</h2><p>Arc could not be reached. {readError || 'Retry the order register.'}</p><button className="secondary-button empty-state-action" onClick={onRefresh}>RETRY</button></div> : readState !== 'success' ? <div className="empty-state-v2"><Stamp tone="ink">READING</Stamp><h2>READING ORDER REGISTER</h2><p>Reading public OrderCreated events from Arc mainnet.</p></div> : ledger;
  return <main className="page-shell page-content-v2 orders-page-v2"><div className="orders-header-v2"><div><SectionMark index="TRADE LEDGER" label="DISCOVERED FROM ARC" /><h1>Order<br /><span>register.</span></h1></div><div><p>Live <code>OrderCreated</code> events involving the connected wallet. The chain is the index; no private order database is assumed.</p><button className="quiet-button" onClick={onRefresh} disabled={loading}>{loading ? 'READING ARC…' : 'REFRESH LEDGER ↻'}</button></div></div>{!account ? <div className="public-order-note"><Stamp tone="ink">PUBLIC READBACK</Stamp><h2>ORDER LINKS STAY OPEN.</h2><p>Connect a wallet only when a role-specific action is required. The selected order below remains publicly readable.</p><button className="secondary-button" onClick={onConnect}>CONNECT WALLET</button></div> : <><div className="filter-row-v2">{(['all', 'action', 'active', 'settled'] as const).map((item) => <button className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} key={item}>{item === 'all' ? 'ALL' : item === 'action' ? 'ACTION REQUIRED' : item === 'active' ? 'ACTIVE' : 'SETTLED'}</button>)}</div>{registerContent}</>}</main>;
}

export function OrderDetail({ account, order, walletClient, onRefresh }: { account?: Address; order?: EnrichedOrder; walletClient?: WalletClient; onRefresh: () => void }) {
  const routeAddress = typeof window === 'undefined' ? undefined : orderAddressFromHash(window.location.hash);
  const selectedAddress = order?.order ?? routeAddress;
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>(order?.snapshot);
  const [activity, setActivity] = useState<OrderActivityItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<Hash>();
  const [error, setError] = useState('');
  const [evidence, setEvidence] = useState('');
  const [reason, setReason] = useState('');
  const [supplierPayout, setSupplierPayout] = useState('');
  const [activityError, setActivityError] = useState('');
  const [activityLoading, setActivityLoading] = useState(false);
  const activityReadRef = useRef<{
    address?: string;
    scannedThrough?: bigint;
    rows: OrderActivityItem[];
    scanning: boolean;
  }>({ rows: [], scanning: false });
  const refresh = useCallback(async () => {
    if (!selectedAddress) return;
    const normalizedAddress = selectedAddress.toLowerCase();
    if (activityReadRef.current.address !== normalizedAddress) {
      activityReadRef.current = { address: normalizedAddress, rows: [], scanning: false };
      setSnapshot(order?.snapshot);
      setActivity([]);
      setActivityError('');
    }
    // Keep the live order state responsive while historical event discovery
    // continues in the background (a shared order link has no creation block).
    try {
      const nextSnapshot = await readOrderSnapshot(publicClient, selectedAddress);
      if (activityReadRef.current.address === normalizedAddress) setSnapshot(nextSnapshot);
      setError('');
    } catch (readError) { setError(errorMessage(readError)); }
    const scan = activityReadRef.current;
    if (scan.scanning) return;
    scan.scanning = true;
    setActivityLoading(true);
    void (async () => {
      try {
        const latest = await publicClient.getBlockNumber();
        const fromBlock = scan.scannedThrough === undefined
          ? order?.blockNumber ?? ARC_DEPLOYMENT_BLOCK
          : scan.scannedThrough + 1n;
        if (fromBlock <= latest) {
          const incoming = await fetchOrderActivity(publicClient, selectedAddress, { fromBlock, toBlock: latest });
          const unique = new Map(scan.rows.map((row) => [row.key, row]));
          for (const row of incoming) unique.set(row.key, row);
          scan.rows = Array.from(unique.values()).sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)));
          scan.scannedThrough = latest;
          if (activityReadRef.current === scan) setActivity([...scan.rows]);
        }
        if (activityReadRef.current === scan) setActivityError('');
      } catch (readError) {
        if (activityReadRef.current === scan) setActivityError(errorMessage(readError));
      } finally {
        scan.scanning = false;
        if (activityReadRef.current === scan) setActivityLoading(false);
      }
    })();
  }, [order?.blockNumber, selectedAddress]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const timer = window.setInterval(() => void refresh(), 12_000); return () => window.clearInterval(timer); }, [refresh]);
  if (!selectedAddress || !snapshot) return <aside className="order-detail-v2 empty-detail-v2"><SectionMark index="ORDER" label={error ? 'READ ERROR' : 'SELECT A RECORD'} /><h2>{error ? <>Order detail<br /><span>unavailable.</span></> : <>The order view<br /><span>is waiting.</span></>}</h2><p>{error ? `Arc could not be reached. ${error}` : 'Select an order from the ledger to inspect immutable terms, state, roles, and the next permitted action.'}</p>{error && <button type="button" className="secondary-button empty-state-action" onClick={() => void refresh()}>RETRY</button>}</aside>;
  const role = roleFor(account, snapshot.buyer, snapshot.supplier, snapshot.arbiter);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const fundingExpired = now > snapshot.fundingDeadline;
  const shipmentExpired = now > snapshot.shipmentDeadline;
  const decisionExpired = now > snapshot.buyerDecisionDeadline;
  const disputeExpired = now > snapshot.disputeDeadline;
  const nextAction = nextActionForRole(role, snapshot, now);
  const actionRequired = actionRequiredForRole(role, snapshot, now);
  const metadata = (() => { try { return JSON.parse(localStorage.getItem(`cargocommit:order:${selectedAddress}`) ?? '{}') as { poReference?: string }; } catch { return {}; } })();
  const send = async (functionName: string, args: readonly unknown[] = [], value?: bigint) => {
    if (!account || !walletClient) { setError('Connect the wallet for this order role before continuing.'); return; }
    setBusy(true); setError(''); setTxHash(undefined);
    try {
      const hash = await walletClient.writeContract({ address: selectedAddress, abi: orderAbi, functionName, args, value, chain: arcMainnet, account } as never);
      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('The transaction reverted. No state was changed.');
      await refresh(); onRefresh();
    } catch (transactionError) { setError(errorMessage(transactionError)); } finally { setBusy(false); }
  };
  const supplierLink = typeof window === 'undefined' ? `#order/${selectedAddress}` : `${window.location.origin}/#order/${selectedAddress}`;
  const copyLink = async (value: string) => { try { await navigator.clipboard.writeText(value); setError('LINK COPIED'); } catch { setError('COPY UNAVAILABLE'); } };
  const createdActivity: OrderActivityItem[] = order?.transactionHash ? [{ key: `created-${order.transactionHash}`, label: 'ORDER CREATED', blockNumber: order.blockNumber, transactionHash: order.transactionHash }] : [];
  const activityRows = [...createdActivity, ...activity];
  const timeline = [['TERMS CREATED', snapshot.status >= 0], ['SUPPLIER ACCEPTED', snapshot.status >= 1], ['ORDER FUNDED', snapshot.status >= 2], ['EVIDENCE SUBMITTED', snapshot.status >= 3], [snapshot.status === 4 ? 'DISPUTE ACTIVE' : 'SETTLED / RESOLVED', snapshot.status >= 5 || snapshot.status === 4]] as const;
  const reserveTerms = snapshot.orderAmount - snapshot.depositAmount;
  return <aside className="order-detail-v2"><div className="order-detail-top"><div><SectionMark index="PUBLIC ORDER" label={metadata.poReference || `SD / ${shortenAddress(selectedAddress, 8, 6)}`} /><h2>{money(snapshot.orderAmount)} <small>USDC</small></h2></div><div className="order-detail-links"><a href={explorerAddress(selectedAddress)} target="_blank" rel="noreferrer">OPEN ORDER ↗</a><button type="button" onClick={() => void copyLink(supplierLink)}>COPY SHARE LINK</button></div></div><div className="order-current-state"><div><span>CURRENT STATE</span><strong>{statusLabel(snapshot.status).toUpperCase()}</strong></div><div><span>NEXT ACTION</span><strong className={actionRequired ? 'needs-action' : ''}>{nextAction}</strong></div><div><span>WHO MUST ACT</span><strong>{whoMustAct(snapshot, role)}</strong></div></div><SettlementBar depositAmount={snapshot.depositAmount} reserveAmount={reserveTerms} reserveLabel={snapshot.status === 5 ? 'RELEASED' : 'PROTECTED'} /><div className="detail-state-line"><Stamp tone={snapshot.status === 4 ? 'alert' : snapshot.status === 5 ? 'signal' : 'ink'}>{statusLabel(snapshot.status)}</Stamp><span>{snapshot.status === 4 ? 'Normal release frozen' : snapshot.status === 5 ? outcomeLabel(snapshot.outcome) : 'Lifecycle in progress'}</span></div><div className="detail-accounting-v2"><div><span>TOTAL FUNDED</span><strong>{money(snapshot.orderAmount)}</strong></div><div><span>DEPOSIT / {snapshot.depositBps}%</span><strong>{money(snapshot.depositAmount)}</strong></div><div><span>RESERVE REMAINING</span><strong>{money(snapshot.reserveRemaining)}</strong></div><div><span>CONTRACT BALANCE</span><strong>{money(snapshot.contractBalance)}</strong></div></div><div className="detail-timeline-v2">{timeline.map(([label, done]) => <div key={label}><StatusDot active={done} /><span>{label}</span>{done && <b>✓</b>}</div>)}</div><div className="detail-terms-grid"><div><span>FUND BY</span><strong>{dateLabel(snapshot.fundingDeadline)}</strong></div><div><span>SHIP BY</span><strong>{dateLabel(snapshot.shipmentDeadline)}</strong></div><div><span>BUYER DECISION</span><strong>{dateLabel(snapshot.buyerDecisionDeadline)}</strong></div><div><span>DISPUTE WINDOW</span><strong>{dateLabel(snapshot.disputeDeadline)}</strong></div><div><span>FALLBACK SUPPLIER</span><strong>{snapshot.fallbackSupplierBps}%</strong></div><div><span>TERMS HASH</span><strong>{shortenAddress(snapshot.termsHash, 12, 8)}</strong></div></div><div className="order-activity"><div className="activity-heading"><span>ACTIVITY TRAIL</span><small>BOUNDED ARC READBACK</small></div>{activityError && <p className="activity-empty" role="status">Activity history could not be refreshed: {activityError}. Existing order details remain available.</p>}{!activityError && activityRows.length === 0 ? <p className="activity-empty">{activityLoading ? 'Reading Arc lifecycle events…' : 'No emitted lifecycle events were returned for this order yet.'}</p> : activityRows.map((item) => <div className="activity-row" key={item.key}><StatusDot active={item.label === 'SETTLED' || item.label === 'PRODUCTION DEPOSIT RELEASED'} /><div><strong>{item.label}</strong><small>{activityTime(item)}{item.blockNumber !== undefined ? ` · BLOCK ${item.blockNumber}` : ''}</small></div>{item.transactionHash && <TxLink hash={item.transactionHash}>RECEIPT</TxLink>}</div>)}</div><div className="role-lines-v2"><div className={role === 'buyer' ? 'role-line-v2 current' : 'role-line-v2'}><span>BUYER</span><a href={explorerAddress(snapshot.buyer)} target="_blank" rel="noreferrer">{shortenAddress(snapshot.buyer)} ↗</a>{role === 'buyer' && <b>YOU</b>}</div><div className={role === 'supplier' ? 'role-line-v2 current' : 'role-line-v2'}><span>SUPPLIER</span><a href={explorerAddress(snapshot.supplier)} target="_blank" rel="noreferrer">{shortenAddress(snapshot.supplier)} ↗</a>{role === 'supplier' && <b>YOU</b>}</div><div className={role === 'arbiter' ? 'role-line-v2 current' : 'role-line-v2'}><span>ARBITER</span><a href={explorerAddress(snapshot.arbiter)} target="_blank" rel="noreferrer">{shortenAddress(snapshot.arbiter)} ↗</a>{role === 'arbiter' && <b>YOU</b>}</div></div><div className="action-footer-v2"><div className="action-footer-head"><span>ROLE-SPECIFIC ACTION</span><strong>{actionRequired ? 'AVAILABLE TO THIS WALLET' : role === 'observer' ? 'CONNECT THE CORRECT ROLE WALLET' : 'WAITING FOR THE NEXT PARTY'}</strong></div>{role === 'buyer' && (snapshot.status === 0 || snapshot.status === 1) && <ActionButton busy={busy} onClick={() => void send('cancelBeforeFunding')}>CANCEL BEFORE FUNDING</ActionButton>}{role === 'supplier' && snapshot.status === 0 && !fundingExpired && <ActionButton busy={busy} onClick={() => void send('acceptOrder')}>ACCEPT IMMUTABLE TERMS</ActionButton>}{role === 'buyer' && snapshot.status === 1 && <ActionButton busy={busy} onClick={() => void send('fund', [], snapshot.orderAmount)}>FUND {money(snapshot.orderAmount)} USDC</ActionButton>}{role === 'supplier' && snapshot.status === 2 && !shipmentExpired && <><Field label="SHIPMENT EVIDENCE REFERENCE / HASH"><input value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Hash or reference text" /></Field><ActionButton busy={busy} disabled={!evidence.trim()} onClick={() => void send('submitShipment', [hashReference(evidence)])}>SUBMIT SHIPMENT EVIDENCE</ActionButton></>}{role === 'buyer' && snapshot.status === 2 && shipmentExpired && <ActionButton busy={busy} onClick={() => void send('claimShipmentDeadlineRefund')}>CLAIM SHIPMENT REFUND</ActionButton>}{role === 'buyer' && snapshot.status === 3 && !decisionExpired && <><ActionButton busy={busy} onClick={() => void send('approveShipment')}>APPROVE / RELEASE {money(snapshot.reserveRemaining)}</ActionButton><Field label="DISPUTE REASON COMMITMENT"><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Hash or reference text" /></Field><ActionButton secondary busy={busy} disabled={!reason.trim()} onClick={() => void send('openDispute', [hashReference(reason)])}>OPEN DISPUTE</ActionButton></>}{role === 'supplier' && snapshot.status === 3 && decisionExpired && <ActionButton busy={busy} onClick={() => void send('claimBuyerDecisionTimeout')}>CLAIM BUYER TIMEOUT</ActionButton>}{role === 'arbiter' && snapshot.status === 4 && !disputeExpired && <><Field label="SUPPLIER PAYOUT FROM RESERVE"><div className="input-unit-v2"><input inputMode="decimal" value={supplierPayout} onChange={(event) => setSupplierPayout(event.target.value)} placeholder="0.0035" /><span>USDC</span></div></Field><ActionButton busy={busy} disabled={!supplierPayout} onClick={() => { try { void send('resolveDispute', [parseNativeAmount(supplierPayout)]); } catch { setError('ENTER A VALID USDC AMOUNT.'); } }}>RESOLVE DISPUTE</ActionButton></>}{snapshot.status === 4 && disputeExpired && role !== 'observer' && <ActionButton busy={busy} onClick={() => void send('claimDisputeFallback')}>CLAIM DETERMINISTIC FALLBACK</ActionButton>}{role === 'observer' && <p className="action-copy-v2">This wallet is not one of the immutable parties.</p>}{snapshot.status === 5 && <p className="action-copy-v2">Settlement is complete. The contract rejects a second settlement.</p>}{txHash && <div className="form-alert-v2 success"><TxLink hash={txHash}>TRANSACTION CONFIRMED</TxLink></div>}{error && <div className="form-alert-v2 error">{error}</div>}</div><div className="detail-integrity"><span>ACCOUNTING INVARIANT</span><strong>{snapshot.accountingInvariant ? 'TRUE' : 'CHECK REQUIRED'}</strong></div></aside>;
}

function parseNativeAmount(value: string): bigint {
  const normalized = value.replaceAll(',', '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error('Invalid USDC amount.');
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > 18) throw new Error('USDC amount has more than 18 decimals.');
  return BigInt(whole) * 1_000_000_000_000_000_000n + BigInt(fraction.padEnd(18, '0') || '0');
}
