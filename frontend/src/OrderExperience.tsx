import { useCallback, useEffect, useRef, useState } from 'react';
import { isAddress, isHex, keccak256, toBytes, type Address, type Hash, type WalletClient } from 'viem';
import { ARC_DEPLOYMENT_BLOCK, arcMainnet, explorerAddress, explorerTx, fetchOrderActivity, publicClient, readOrderSnapshot, syncArcWallet, verifyFactoryOrder, proofMatchesSnapshot, type FactoryOrderProof, type OrderActivityItem, type Eip1193Provider } from './chain';
import { orderAbi, type OrderCreatedLog } from './contracts';
import { FeedbackNotice } from './FeedbackNotice';
import { pendingReceiptMessage, productErrorText } from './feedback';
import { actionRequiredForRole, formatUsdc, nextActionForRole, orderAddressFromHash, orderBlockHintFromHash, outcomeLabel, roleFor, shortenAddress, statusLabel, type Role } from './model';

type Snapshot = Awaited<ReturnType<typeof readOrderSnapshot>>;
export type EnrichedOrder = OrderCreatedLog & { snapshot?: Snapshot; previewStatus?: number };
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

function errorMessage(error: unknown): string { return productErrorText(error); }

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
function SettlementBar({ depositAmount, reserveAmount, depositPercent, reserveLabel = 'PROTECTED', depositLabel = 'RELEASE AT FUNDING' }: { depositAmount: bigint; reserveAmount: bigint; depositPercent?: number; reserveLabel?: string; depositLabel?: string }) { const safeDepositPercent = depositPercent ?? (depositAmount + reserveAmount > 0n ? Number((depositAmount * 100n) / (depositAmount + reserveAmount)) : 0); const reservePercent = 100 - safeDepositPercent; return <div className="settlement-bar" aria-label={`${safeDepositPercent} percent released and ${reservePercent} percent ${reserveLabel.toLowerCase()}`}><div className="released-segment"><span>{safeDepositPercent}%</span><b>{depositLabel}</b><small>{money(depositAmount)}</small></div><div className="protected-segment"><span>{reservePercent}%</span><b>{reserveLabel}</b><small>{money(reserveAmount)}</small></div></div>; }

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

export function OrdersPage({ account, orders, selected, onSelect, onOpenOrder, onLoadOlder, olderAvailable, onRefresh, onConnect, onCreate, loading, readState, readError, readProgress }: { account?: Address; orders: EnrichedOrder[]; selected?: Address; onSelect: (order: Address) => void; onOpenOrder: (order: Address) => void; onLoadOlder: () => void; olderAvailable: boolean; onRefresh: () => void; onConnect: () => void; onCreate: () => void; loading: boolean; readState: 'idle' | 'loading' | 'partial' | 'success' | 'error'; readError: string; readProgress: string }) {
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [orderLookup, setOrderLookup] = useState('');
  const filtered = orders.filter((order) => {
    const snapshot = order.snapshot;
    if (filter === 'all') return true;
    const knownStatus = snapshot?.status ?? order.previewStatus;
    if (knownStatus === undefined) return filter === 'active';
    if (filter === 'settled') return knownStatus === 5;
    if (filter === 'active') return knownStatus !== 5;
    return snapshot ? actionRequiredForRole(roleFor(account, snapshot.buyer, snapshot.supplier, snapshot.arbiter), snapshot) : false;
  });
  const ledger = filtered.length === 0
    ? <div className="empty-state-v2"><Stamp tone="ink">NO ORDERS</Stamp><h2>NO ORDERS YET</h2><p>{filter === 'all' ? 'No matching orders in the recent blocks checked. Older history can be searched below.' : 'No orders match this filter.'}</p><button className="secondary-button empty-state-action" onClick={onCreate}>CREATE ORDER</button></div>
    : <div className="ledger-list"><div className="ledger-heading"><span>REF / ORDER</span><span>ROLE</span><span>AMOUNT / SPLIT</span><span>STATE / NEXT ACTION</span><span>DEADLINE</span></div>{filtered.map((order, index) => { const snapshot = order.snapshot; const role = roleFor(account, snapshot?.buyer ?? order.buyer, snapshot?.supplier ?? order.supplier, snapshot?.arbiter ?? order.arbiter); const action = nextActionForRole(role, snapshot); const actionable = snapshot ? actionRequiredForRole(role, snapshot) : false; return <button className={`ledger-row ${selected?.toLowerCase() === order.order.toLowerCase() ? 'selected' : ''} ${actionable ? 'action-required' : ''}`} onClick={() => onSelect(order.order)} key={order.order}><span className="ledger-index">{String(index + 1).padStart(2, '0')}</span><span className="ledger-order"><strong>PO / {shortenAddress(order.order, 8, 6)}</strong><small>{shortenAddress(order.buyer)} BUYER · {shortenAddress(order.supplier)} SUPPLIER</small></span><span className="ledger-role"><b>{role.toUpperCase()}</b><small>{snapshot ? money(snapshot.orderAmount) : money(order.orderAmount)} · {snapshot ? snapshot.depositBps : order.depositBps}/{100 - (snapshot?.depositBps ?? order.depositBps)}</small></span><span className="ledger-state"><b>{snapshot ? statusLabel(snapshot.status).toUpperCase() : order.previewStatus !== undefined ? statusLabel(order.previewStatus).toUpperCase() : 'CHECKING STATE…'}</b><small>{actionable ? `ACTION REQUIRED · ${action}` : action}</small></span><span className="ledger-deadline"><b>{snapshot ? dateLabel(snapshot.shipmentDeadline) : dateLabel(order.shipmentDeadline)}</b><small>{snapshot ? `${money(snapshot.reserveRemaining)} RESERVE` : 'READING STATE'}</small></span><em>↗</em></button>; })}</div>;
  const registerError = <div className="form-alert-v2 error order-read-alert" role="alert"><span>ARC READ PAUSED · {readError || 'Try the order register again.'} Already found orders remain available.</span><button type="button" className="quiet-button" onClick={onRefresh}>RETRY</button></div>;
  const progressNotice = (readState === 'loading' || readState === 'partial') && <div className="form-alert-v2 order-read-alert" role="status"><span>{readProgress || 'Discovering orders from Arc. Older orders may take longer to appear.'}</span>{!loading && <button type="button" className="quiet-button" onClick={onRefresh}>CONTINUE SEARCH</button>}</div>;
  const registerContent = readState === 'error'
    ? orders.length ? <>{registerError}{ledger}</> : <div className="empty-state-v2" role="status"><Stamp tone="ink">NO ORDERS</Stamp><h2>NO ORDERS YET</h2><p>No orders have loaded for this wallet. Arc couldn't finish checking the history, so older orders may still exist.</p><button className="secondary-button empty-state-action" onClick={onRefresh}>CHECK AGAIN</button></div>
    : readState === 'loading' && !orders.length
      ? <div className="empty-state-v2" role="status"><Stamp tone="ink">CHECKING</Stamp><h2>NO ORDERS YET</h2><p>Checking Arc for orders involving this wallet.</p></div>
      : <>{readError && registerError}{progressNotice}{orders.length ? ledger : readState === 'success' ? ledger : <div className="empty-state-v2" role="status"><Stamp tone="ink">NO ORDERS</Stamp><h2>NO ORDERS YET</h2><p>No matching orders found in the blocks checked so far.</p></div>}</>;
  return <main className="page-shell page-content-v2 orders-page-v2"><div className="orders-header-v2"><div><SectionMark index="TRADE LEDGER" label="DISCOVERED FROM ARC" /><h1>Order<br /><span>register.</span></h1></div><div><p>Live <code>OrderCreated</code> events involving the connected wallet. The chain is the index; no private order database is assumed.</p><button className="quiet-button" onClick={onRefresh} disabled={loading}>{loading ? 'READING ARC…' : 'REFRESH LEDGER ↻'}</button></div></div>{!account ? <div className="public-order-note"><Stamp tone="ink">PUBLIC READBACK</Stamp><h2>ORDER LINKS STAY OPEN.</h2><p>Connect a wallet only when a role-specific action is required. The selected order below remains publicly readable.</p><button className="secondary-button" onClick={onConnect}>CONNECT WALLET</button></div> : <><div className="filter-row-v2">{(['all', 'action', 'active', 'settled'] as const).map((item) => <button className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} key={item}>{item === 'all' ? 'ALL' : item === 'action' ? 'ACTION REQUIRED' : item === 'active' ? 'ACTIVE' : 'SETTLED'}</button>)}</div>{registerContent}<div className="order-lookup-v2"><div className="order-lookup-intro"><strong>HAVE AN ORDER ADDRESS?</strong><span>Open any Seldra order directly without a historical scan.</span></div><div className="order-lookup-form"><input aria-label="Order contract address" placeholder="0x… order contract address" value={orderLookup} spellCheck={false} autoComplete="off" onChange={(event) => setOrderLookup(event.target.value)} /><button type="button" disabled={!isAddress(orderLookup.trim())} onClick={() => onOpenOrder(orderLookup.trim() as Address)}>OPEN ORDER ↗</button></div>{olderAvailable && <button type="button" className="older-history-v2" disabled={loading} onClick={onLoadOlder}>{loading ? 'CHECKING ARC…' : 'SEARCH 4,000 OLDER BLOCKS ↗'}</button>}</div></>}</main>;
}

export function OrderDetail({ account, order, walletClient, walletProvider, onRefresh }: { account?: Address; order?: EnrichedOrder; walletClient?: WalletClient; walletProvider?: Eip1193Provider; onRefresh: () => void }) {
  const routeAddress = typeof window === 'undefined' ? undefined : orderAddressFromHash(window.location.hash);
  const selectedAddress = order?.order ?? routeAddress;
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>(order?.snapshot);
  const [activity, setActivity] = useState<OrderActivityItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<Hash>();
  const [submittedHash, setSubmittedHash] = useState<Hash>();
  const [txStage, setTxStage] = useState<'idle' | 'signing' | 'confirming'>('idle');
  const [provenance, setProvenance] = useState<'checking' | 'verified' | 'blocked'>('checking');
  const [provenanceError, setProvenanceError] = useState('');
  const [factoryProof, setFactoryProof] = useState<FactoryOrderProof>();
  const [notice, setNotice] = useState('');
  const previousVerifiedAddressRef = useRef<string | undefined>(undefined);
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
  // Factory provenance is established independently of arbitrary public-order readback.
  // A block included in the share URL only narrows the first RPC query; factory logs
  // and the originating transaction are always checked onchain.
  useEffect(() => {
    let cancelled = false;
    setProvenance('checking'); setProvenanceError(''); setFactoryProof(undefined);
    if (previousVerifiedAddressRef.current !== selectedAddress?.toLowerCase()) {
      setSubmittedHash(undefined); setTxHash(undefined); setNotice('');
      previousVerifiedAddressRef.current = selectedAddress?.toLowerCase();
    }
    if (!selectedAddress) return;
    const blockHint = order?.blockNumber ?? orderBlockHintFromHash(window.location.hash);
    void (async () => {
      try {
        const proof = await verifyFactoryOrder(publicClient, selectedAddress, blockHint);
        const current = await readOrderSnapshot(publicClient, selectedAddress);
        if (cancelled) return;
        if (!proofMatchesSnapshot(proof, current)) {
          setProvenance('blocked');
          setProvenanceError(proof.originator.toLowerCase() !== proof.created.buyer.toLowerCase()
            ? 'This order was created by a wallet other than its declared buyer. Do not fund an unsolicited order.'
            : 'Order terms or accounting do not match the official Seldra factory record.');
          return;
        }
        setFactoryProof(proof); setProvenance('verified'); setSnapshot(current);
      } catch {
        if (cancelled) return;
        setProvenance('blocked');
        setProvenanceError('Seldra could not verify this address against its official factory. Wallet actions are locked until verification succeeds.');
      }
    })();
    return () => { cancelled = true; };
  }, [selectedAddress, order?.blockNumber]);
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
    if (busy || submittedHash) return;
    if (provenance !== 'verified' || !factoryProof) { setError('Order verification is required before any wallet action.'); return; }
    // Re-read before signing: a stale register must not silently authorize an action.
    try {
      const current = await readOrderSnapshot(publicClient, selectedAddress);
      if (!proofMatchesSnapshot(factoryProof, current)) {
        setProvenance('blocked'); setError('Onchain order integrity could not be confirmed. Actions are locked.'); return;
      }
    } catch { setError('Could not verify the latest order state. Check Arc and retry before signing.'); return; }

    if (!account || !walletClient) { setError('Connect the wallet for this order role before continuing.'); return; }
    if (!walletProvider) { setError('Connect the order-party wallet again before signing.'); return; }
    const activeWallet = await syncArcWallet(walletProvider).catch(() => undefined);
    if (!activeWallet || activeWallet.account.toLowerCase() !== account.toLowerCase()) { setError('The active wallet changed. Reconnect the correct order-party wallet before signing.'); return; }
    setBusy(true); setError(''); setNotice(''); setTxHash(undefined); setTxStage('signing');
    let broadcastHash: Hash | undefined;
    try {
      const hash = await activeWallet.walletClient.writeContract({ address: selectedAddress, abi: orderAbi, functionName, args, value, chain: arcMainnet, account: activeWallet.account } as never);
      broadcastHash = hash; setSubmittedHash(hash); setTxStage('confirming');
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      setSubmittedHash(undefined);
      if (receipt.status !== 'success') { setError('Arc confirmed this transaction reverted. No state was changed. Refresh the order before trying another action.'); return; }
      setTxHash(hash); setTxStage('idle');
      await refresh(); onRefresh();
    } catch (transactionError) {
      if (broadcastHash) {
        setNotice(pendingReceiptMessage());
      } else {
        setError(errorMessage(transactionError));
      }
    } finally { setBusy(false); setTxStage('idle'); }
  };
  const retryConfirmation = async () => {
    if (!submittedHash || busy) return;
    setBusy(true);
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: submittedHash });
      setSubmittedHash(undefined);
      if (receipt.status === 'success') { setTxHash(submittedHash); setNotice(''); await refresh(); onRefresh(); }
      else { setError('Arc confirmed this transaction reverted. No state was changed.'); setNotice(''); }
    } catch { setNotice(pendingReceiptMessage()); } finally { setBusy(false); }
  };
  const verifiedPath = `#order/${selectedAddress}${factoryProof ? `/${factoryProof.blockNumber}` : ''}`;
  const supplierLink = typeof window === 'undefined' ? verifiedPath : `${window.location.origin}/${verifiedPath}`;
  const copyLink = async (value: string) => { try { await navigator.clipboard.writeText(value); setNotice('Order link copied to clipboard.'); } catch { setError('Copy unavailable. Select and copy the order URL from your browser.'); } };
  const createdActivity: OrderActivityItem[] = order?.transactionHash ? [{ key: `created-${order.transactionHash}`, label: 'ORDER CREATED', blockNumber: order.blockNumber, transactionHash: order.transactionHash }] : [];
  const activityRows = [...createdActivity, ...activity];
  const timeline = [['TERMS CREATED', snapshot.status >= 0], ['SUPPLIER ACCEPTED', snapshot.status >= 1], ['ORDER FUNDED', snapshot.status >= 2], ['EVIDENCE SUBMITTED', snapshot.status >= 3], [snapshot.status === 4 ? 'DISPUTE ACTIVE' : 'SETTLED / RESOLVED', snapshot.status >= 5 || snapshot.status === 4]] as const;
  const reserveTerms = snapshot.orderAmount - snapshot.depositAmount;
  return <aside className="order-detail-v2"><div className="order-detail-top"><div><SectionMark index="PUBLIC ORDER" label={metadata.poReference || `SD / ${shortenAddress(selectedAddress, 8, 6)}`} /><h2>{money(snapshot.orderAmount)} <small>USDC</small></h2></div><div className="order-detail-links"><a href={explorerAddress(selectedAddress)} target="_blank" rel="noreferrer">OPEN ORDER ↗</a><button type="button" onClick={() => void copyLink(supplierLink)}>COPY SHARE LINK</button></div></div><div className="order-current-state"><div><span>CURRENT STATE</span><strong>{statusLabel(snapshot.status).toUpperCase()}</strong></div><div><span>NEXT ACTION</span><strong className={actionRequired ? 'needs-action' : ''}>{nextAction}</strong></div><div><span>WHO MUST ACT</span><strong>{whoMustAct(snapshot, role)}</strong></div></div><SettlementBar depositAmount={snapshot.depositAmount} reserveAmount={reserveTerms} depositLabel={snapshot.status >= 2 ? 'DEPOSIT PAID' : 'NOT FUNDED'} reserveLabel={snapshot.status === 5 ? 'SETTLED' : snapshot.status >= 2 ? 'HELD' : 'NOT FUNDED'} /><div className="detail-state-line"><Stamp tone={snapshot.status === 4 ? 'alert' : snapshot.status === 5 ? 'signal' : 'ink'}>{statusLabel(snapshot.status)}</Stamp><span>{snapshot.status === 4 ? 'Normal release frozen' : snapshot.status === 5 ? outcomeLabel(snapshot.outcome) : 'Lifecycle in progress'}</span></div><div className="detail-accounting-v2"><div><span>{snapshot.status >= 2 ? 'ORDER AMOUNT' : 'ORDER AMOUNT / NOT FUNDED'}</span><strong>{money(snapshot.orderAmount)}</strong></div><div><span>DEPOSIT / {snapshot.depositBps}%</span><strong>{money(snapshot.depositAmount)}</strong></div><div><span>RESERVE REMAINING</span><strong>{money(snapshot.reserveRemaining)}</strong></div><div><span>CONTRACT BALANCE</span><strong>{money(snapshot.contractBalance)}</strong></div></div><div className="detail-timeline-v2">{timeline.map(([label, done]) => <div key={label}><StatusDot active={done} /><span>{label}</span>{done && <b>✓</b>}</div>)}</div><div className="detail-terms-grid"><div><span>FUND BY</span><strong>{dateLabel(snapshot.fundingDeadline)}</strong></div><div><span>SHIP BY</span><strong>{dateLabel(snapshot.shipmentDeadline)}</strong></div><div><span>BUYER DECISION</span><strong>{dateLabel(snapshot.buyerDecisionDeadline)}</strong></div><div><span>DISPUTE WINDOW</span><strong>{dateLabel(snapshot.disputeDeadline)}</strong></div><div><span>FALLBACK SUPPLIER</span><strong>{snapshot.fallbackSupplierBps}%</strong></div><div><span>TERMS HASH</span><strong>{shortenAddress(snapshot.termsHash, 12, 8)}</strong></div></div><div className="order-activity"><div className="activity-heading"><span>ACTIVITY TRAIL</span><small>BOUNDED ARC READBACK</small></div>{activityError && <p className="activity-empty" role="status">Activity history could not be refreshed: {activityError}. Existing order details remain available.</p>}{!activityError && activityRows.length === 0 ? <p className="activity-empty">{activityLoading ? 'Reading Arc lifecycle events…' : 'No emitted lifecycle events were returned for this order yet.'}</p> : activityRows.map((item) => <div className="activity-row" key={item.key}><StatusDot active={item.label === 'SETTLED' || item.label === 'PRODUCTION DEPOSIT RELEASED'} /><div><strong>{item.label}</strong><small>{activityTime(item)}{item.blockNumber !== undefined ? ` · BLOCK ${item.blockNumber}` : ''}</small></div>{item.transactionHash && <TxLink hash={item.transactionHash}>RECEIPT</TxLink>}</div>)}</div><div className="role-lines-v2"><div className={role === 'buyer' ? 'role-line-v2 current' : 'role-line-v2'}><span>BUYER</span><a href={explorerAddress(snapshot.buyer)} target="_blank" rel="noreferrer">{shortenAddress(snapshot.buyer)} ↗</a>{role === 'buyer' && <b>YOU</b>}</div><div className={role === 'supplier' ? 'role-line-v2 current' : 'role-line-v2'}><span>SUPPLIER</span><a href={explorerAddress(snapshot.supplier)} target="_blank" rel="noreferrer">{shortenAddress(snapshot.supplier)} ↗</a>{role === 'supplier' && <b>YOU</b>}</div><div className={role === 'arbiter' ? 'role-line-v2 current' : 'role-line-v2'}><span>ARBITER</span><a href={explorerAddress(snapshot.arbiter)} target="_blank" rel="noreferrer">{shortenAddress(snapshot.arbiter)} ↗</a>{role === 'arbiter' && <b>YOU</b>}</div></div><div className="action-footer-v2"><div className="order-provenance" aria-live="polite">{provenance === 'verified' ? '✓ VERIFIED / OFFICIAL FACTORY · BUYER-ORIGINATED' : provenance === 'checking' ? 'VERIFYING / OFFICIAL FACTORY ORIGIN…' : 'VERIFICATION FAILED / SIGNING LOCKED'}</div>{provenance === 'blocked' && <FeedbackNotice tone="warning" title="Unverified order"><p>{provenanceError}</p></FeedbackNotice>}{provenance === 'checking' && <p className="action-copy-v2">Checking factory event, creator wallet and immutable terms before enabling transactions.</p>}<div className="release-safety-note"><strong>READ BEFORE MOVING FUNDS</strong>After shipment evidence is submitted, the supplier can claim the protected reserve after the buyer-decision deadline if the buyer neither approves nor disputes. Evidence is a hash commitment, not independent proof of physical shipment. Contracts are unaudited; use only for experimental amounts.</div><div className="action-footer-head"><span>ROLE-SPECIFIC ACTION</span><strong>{actionRequired ? 'AVAILABLE TO THIS WALLET' : role === 'observer' ? 'CONNECT THE CORRECT ROLE WALLET' : 'WAITING FOR THE NEXT PARTY'}</strong></div><fieldset className="order-action-gate" disabled={provenance !== 'verified' || Boolean(submittedHash)}>{role === 'buyer' && (snapshot.status === 0 || snapshot.status === 1) && <ActionButton busy={busy} onClick={() => void send('cancelBeforeFunding')}>CANCEL BEFORE FUNDING</ActionButton>}{role === 'supplier' && snapshot.status === 0 && !fundingExpired && <ActionButton busy={busy} onClick={() => void send('acceptOrder')}>ACCEPT IMMUTABLE TERMS</ActionButton>}{role === 'buyer' && snapshot.status === 1 && !fundingExpired && <ActionButton busy={busy} onClick={() => void send('fund', [], snapshot.orderAmount)}>FUND {money(snapshot.orderAmount)} USDC</ActionButton>}{role === 'supplier' && snapshot.status === 2 && !shipmentExpired && <><Field label="SHIPMENT EVIDENCE REFERENCE / HASH"><input value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Hash or reference text" /></Field><ActionButton busy={busy} disabled={!evidence.trim()} onClick={() => void send('submitShipment', [hashReference(evidence)])}>SUBMIT SHIPMENT EVIDENCE</ActionButton></>}{role === 'buyer' && snapshot.status === 2 && shipmentExpired && <ActionButton busy={busy} onClick={() => void send('claimShipmentDeadlineRefund')}>CLAIM SHIPMENT REFUND</ActionButton>}{role === 'buyer' && snapshot.status === 3 && !decisionExpired && <><ActionButton busy={busy} onClick={() => void send('approveShipment')}>APPROVE / RELEASE {money(snapshot.reserveRemaining)}</ActionButton><Field label="DISPUTE REASON COMMITMENT"><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Hash or reference text" /></Field><ActionButton secondary busy={busy} disabled={!reason.trim()} onClick={() => void send('openDispute', [hashReference(reason)])}>OPEN DISPUTE</ActionButton></>}{role === 'supplier' && snapshot.status === 3 && decisionExpired && <ActionButton busy={busy} onClick={() => void send('claimBuyerDecisionTimeout')}>CLAIM BUYER TIMEOUT</ActionButton>}{role === 'arbiter' && snapshot.status === 4 && !disputeExpired && <><Field label="SUPPLIER PAYOUT FROM RESERVE"><div className="input-unit-v2"><input inputMode="decimal" value={supplierPayout} onChange={(event) => setSupplierPayout(event.target.value)} placeholder="0.0035" /><span>USDC</span></div></Field><ActionButton busy={busy} disabled={!supplierPayout} onClick={() => { try { const payout = parseNativeAmount(supplierPayout); if (payout > snapshot.reserveRemaining) { setError('The supplier payout cannot exceed the remaining reserve.'); return; } void send('resolveDispute', [payout]); } catch { setError('Enter a valid native USDC amount with no more than 18 decimals.'); } }}>RESOLVE DISPUTE</ActionButton></>}{snapshot.status === 4 && disputeExpired && role !== 'observer' && <ActionButton busy={busy} onClick={() => void send('claimDisputeFallback')}>CLAIM DETERMINISTIC FALLBACK</ActionButton>}</fieldset>{role === 'buyer' && snapshot.status === 1 && fundingExpired && <p className="action-copy-v2">Funding has expired; the contract no longer accepts payment. Cancel the unfunded order instead.</p>}{role === 'observer' && <p className="action-copy-v2">This wallet is not one of the immutable parties.</p>}{snapshot.status === 5 && <p className="action-copy-v2">Settlement is complete. The contract rejects a second settlement.</p>}{txHash && <FeedbackNotice tone="success" title="Transaction confirmed" link={{ href: explorerTx(txHash), label: 'VIEW RECEIPT' }}>Arc confirmed the transaction. Refresh to see the latest order state.</FeedbackNotice>}{busy && !submittedHash && <FeedbackNotice tone="pending" title={txStage === 'signing' ? 'Check your wallet' : 'Checking order'}>Awaiting the wallet signature or the latest Arc state. Do not switch wallets during this action.</FeedbackNotice>}{submittedHash && <FeedbackNotice tone="pending" title="Transaction submitted" onRetry={() => void retryConfirmation()} link={{ href: explorerTx(submittedHash), label: 'CHECK TRANSACTION' }}> {notice || 'Waiting for Arc confirmation. Do not send this transaction twice.'}</FeedbackNotice>}{error && <FeedbackNotice tone="error" title="Order action needs attention" toast onClose={() => setError('')}>{error}</FeedbackNotice>}{notice && !submittedHash && <FeedbackNotice tone="success" title="Link copied" toast onClose={() => setNotice('')}>{notice}</FeedbackNotice>}</div><div className="detail-integrity"><span>ACCOUNTING INVARIANT</span><strong>{snapshot.accountingInvariant ? 'TRUE' : 'CHECK REQUIRED'}</strong></div></aside>;
}

function parseNativeAmount(value: string): bigint {
  const normalized = value.replaceAll(',', '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error('Invalid USDC amount.');
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > 18) throw new Error('USDC amount has more than 18 decimals.');
  return BigInt(whole) * 1_000_000_000_000_000_000n + BigInt(fraction.padEnd(18, '0') || '0');
}
