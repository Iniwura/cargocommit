import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Address, Hash, WalletClient } from 'viem';
import { FACTORY_ADDRESS, arcMainnet, explorerAddress, explorerTx, fetchOrderCreatedLogs, isAddress, publicClient, syncArcWallet, type Eip1193Provider } from './chain';
import { factoryAbi } from './contracts';
import { CREATE_DRAFT_STORAGE_KEY, deadlineGapLabel, buildCreateOrderCall, buildCreateOrderReview, buildPreSignatureInstrument, checkReviewedBuyer, deriveCreateReviewState, distinctPartyAddresses, formatUsdc, parseDeadlineSeconds, parseNativeUsdc, restoreLocalOrderDraft, serializeLocalOrderDraft, settlementSplit, shortenAddress, validateCreateDraft, walletProviderMatches, type CreateWizardStep, type LocalOrderDraft } from './model';

type TransactionStage = 'idle' | 'preparing' | 'signing' | 'submitted' | 'confirming' | 'success';

type CreateOrderFlowProps = {
  account?: Address;
  walletClient?: WalletClient;
  walletProvider?: Eip1193Provider;
  onCreated: (order: Address, hash: Hash) => void;
};

const WIZARD_STEPS = [
  { number: 1 as const, label: 'PARTIES' },
  { number: 2 as const, label: 'SETTLEMENT' },
  { number: 3 as const, label: 'DELIVERY' },
  { number: 4 as const, label: 'REFERENCE' },
];

function money(value: bigint | string | number): string {
  const [whole, fraction = ''] = formatUsdc(value, 6).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0')}`;
}

function dateInput(offsetHours: number): string {
  const date = new Date(Date.now() + offsetHours * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultDraft(): LocalOrderDraft {
  return {
    supplier: '',
    arbiter: '',
    amount: '10000',
    depositPercent: '30',
    fallbackPercent: '50',
    fundingDeadline: dateInput(24),
    shipmentDeadline: dateInput(72),
    buyerDecisionDeadline: dateInput(120),
    disputeDeadline: dateInput(168),
    poReference: '',
    documentReference: '',
    step: 1,
  };
}

function formatInputAmount(value: string): string {
  const normalized = value.replaceAll(',', '').trim();
  if (!normalized) return '';
  const [whole, fraction] = normalized.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? `${grouped}.00` : `${grouped}.${fraction}`;
}

function dateLabel(value: string | bigint): string {
  const date = typeof value === 'bigint' ? new Date(Number(value) * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date).toUpperCase();
}


function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.replace(/^User rejected the request\.?$/i, 'Wallet request was cancelled.');
  return 'The network request failed. Check your wallet and try again.';
}

function walletReviewMessage(reviewedBuyer?: string, activeBuyer?: string): string {
  return `WALLET CHANGED\nBuyer changed from ${reviewedBuyer ?? 'NOT SET'} to ${activeBuyer ?? 'NOT CONNECTED'}.\nReview this order again before signing.`;
}

function PartyGlyph({ address }: { address?: string }) {
  const seed = address ? address.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0) : 0;
  return <span className="party-glyph" aria-hidden="true"><i style={{ height: `${20 + seed % 22}%` }} /><i style={{ height: `${38 + (seed * 3) % 42}%` }} /><i style={{ height: `${25 + (seed * 7) % 35}%` }} /></span>;
}

function StatusMark({ state, label }: { state: 'empty' | 'valid' | 'invalid' | 'duplicate'; label: string }) {
  const copy = state === 'valid' ? 'VALID ADDRESS' : state === 'duplicate' ? 'DUPLICATE PARTY' : state === 'invalid' ? 'CHECK ADDRESS' : 'REQUIRED';
  return <span className={`party-status ${state}`}><i className={`status-dot ${state === 'valid' ? 'is-active' : ''} ${state === 'invalid' || state === 'duplicate' ? 'is-blocked' : ''}`} />{label} / {copy}</span>;
}

function partyState(value: string, account?: Address): 'empty' | 'valid' | 'invalid' | 'duplicate' {
  if (!value) return 'empty';
  if (!isAddress(value)) return 'invalid';
  if (account && value.toLowerCase() === account.toLowerCase()) return 'duplicate';
  return 'valid';
}

function DraftField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field-v2"><span>{label}</span>{children}</label>;
}

function StepFooter({ step, canContinue, onBack, onContinue, continueLabel }: { step: CreateWizardStep; canContinue: boolean; onBack: () => void; onContinue: () => void; continueLabel: string }) {
  return <div className="wizard-footer"><button type="button" className="quiet-button" onClick={onBack} disabled={step === 1}>← Back</button><button type="button" className="primary-button" onClick={onContinue} disabled={!canContinue}>{continueLabel} <span>→</span></button></div>;
}

function WizardTimeline({ deadlines }: { deadlines: readonly [bigint, bigint, bigint, bigint] }) {
  const labels = ['ORDER CREATED', 'FUND BY', 'SHIP BY', 'BUYER DECISION', 'DISPUTE DEADLINE'];
  const values = [undefined, deadlines[0], deadlines[1], deadlines[2], deadlines[3]];
  return <div className="wizard-timeline">{labels.map((label, index) => <div className="wizard-timeline-row" key={label}><span className="wizard-timeline-node">{String(index).padStart(2, '0')}</span><div><strong>{label}</strong>{values[index] !== undefined && <small>{dateLabel(values[index] as bigint)}</small>}{deadlineGapLabel(deadlines, index) && <em>{deadlineGapLabel(deadlines, index)} later</em>}</div></div>)}</div>;
}

function SettlementInstrument({ total, deposit, reserve, depositPercent, reservePercent, reserveLabel = 'PROTECTED UNTIL SHIPMENT' }: { total: bigint; deposit: bigint; reserve: bigint; depositPercent: number; reservePercent: number; reserveLabel?: string }) {
  return <div className="wizard-settlement-instrument"><div className="wizard-settlement-head"><span>SETTLEMENT INSTRUMENT / NATIVE USDC</span><strong>{depositPercent} / {reservePercent}</strong></div><div className="wizard-settlement-total">{money(total)}</div><div className={`wizard-settlement-split ${depositPercent < 20 || depositPercent > 80 ? 'extreme-split' : ''}`} style={{ '--deposit-width': `${depositPercent}%` } as React.CSSProperties}><div><span>{depositPercent}%</span><strong>{money(deposit)}</strong><b>RELEASE AT FUNDING</b></div><div><span>{reservePercent}%</span><strong>{money(reserve)}</strong><b>{reserveLabel}</b></div></div></div>;
}

function InstrumentStamp({ children, tone = 'signal' }: { children: React.ReactNode; tone?: 'signal' | 'ink' | 'alert' }) {
  return <span className={`document-stamp ${tone}`}>{children}</span>;
}

function CreatedReceipt({ order, hash, total, deposit, reserve, onCreated, onCreateAnother }: { order: Address; hash: Hash; total: bigint; deposit: bigint; reserve: bigint; onCreated: (order: Address, hash: Hash) => void; onCreateAnother: () => void }) {
  const [copyMessage, setCopyMessage] = useState('');
  const supplierLink = typeof window === 'undefined' ? `#order/${order}` : `${window.location.origin}/#order/${order}`;
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setCopyMessage(`${label} COPIED`); } catch { setCopyMessage('COPY UNAVAILABLE'); }
  };
  return <main className="page-shell page-content-v2 created-receipt-page"><div className="created-receipt-sheet"><div className="created-receipt-top"><div><span>SELDRA</span><h1>PURCHASE ORDER CREATED ✓</h1></div><InstrumentStamp>CREATED</InstrumentStamp></div><div className="created-receipt-addresses"><div><span>ORDER ADDRESS</span><strong>{order}</strong></div><div><span>TRANSACTION HASH</span><strong>{hash}</strong></div></div><div className="created-receipt-state"><InstrumentStamp tone="ink">AWAITING SUPPLIER ACCEPTANCE</InstrumentStamp><p>The order is created and immutable. Send the shareable order link to the supplier; no funds have been moved.</p></div><div className="created-receipt-grid"><div><span>TOTAL</span><strong>{money(total)}</strong></div><div><span>DEPOSIT</span><strong>{money(deposit)} / NOT RELEASED YET</strong></div><div><span>PROTECTED RESERVE</span><strong>{money(reserve)} / NOT FUNDED YET</strong></div><div><span>NEXT ACTION</span><strong>SUPPLIER ACCEPTS</strong></div></div><div className="created-receipt-next"><span>WHO MUST ACT</span><strong>SUPPLIER / EXPORTER</strong><p>Connect the wallet entered in this order and accept the immutable terms.</p></div><div className="created-receipt-actions"><button className="primary-button" type="button" onClick={() => onCreated(order, hash)}>VIEW ORDER <span>→</span></button><button className="secondary-button" type="button" onClick={() => void copy(supplierLink, 'SUPPLIER LINK')}>COPY SUPPLIER LINK</button><button className="secondary-button" type="button" onClick={() => void copy(order, 'ORDER ADDRESS')}>COPY ORDER ADDRESS</button><a className="secondary-button" href={explorerAddress(order)} target="_blank" rel="noreferrer">VIEW ON ARC EXPLORER ↗</a><button className="quiet-button" type="button" onClick={onCreateAnother}>CREATE ANOTHER ORDER</button></div>{copyMessage && <p className="created-receipt-copy-message">{copyMessage}</p>}<p className="created-receipt-foot">Transaction <a href={explorerTx(hash)} target="_blank" rel="noreferrer">{shortenAddress(hash, 12, 10)} ↗</a> · principal is funded later through the order.</p></div></main>;
}

export default function CreateOrder({ account, walletClient, walletProvider, onCreated }: CreateOrderFlowProps) {
  const [draft, setDraft] = useState<LocalOrderDraft>(() => {
    const fallback = defaultDraft();
    return typeof window === 'undefined' ? fallback : restoreLocalOrderDraft(window.localStorage.getItem(CREATE_DRAFT_STORAGE_KEY), fallback);
  });
  const [preview, setPreview] = useState(false);
  const [reviewedBuyer, setReviewedBuyer] = useState<Address>();
  const [reviewInvalidated, setReviewInvalidated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [stage, setStage] = useState<TransactionStage>('idle');
  const [created, setCreated] = useState<{ order: Address; hash: Hash }>();
  const lastStepRef = useRef(draft.step);
  const lastPreviewRef = useRef(false);

  // Advancing a single-screen wizard must move focus and scroll to the new content.
  useEffect(() => {
    if (created) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    const changedStep = lastStepRef.current !== draft.step;
    const openedPreview = preview && !lastPreviewRef.current;
    lastStepRef.current = draft.step;
    lastPreviewRef.current = preview;
    if (!changedStep && !openedPreview) return;
    const heading = document.querySelector<HTMLElement>(preview ? '.instrument-preview-head h1' : '.wizard-step-heading');
    heading?.focus({ preventScroll: true });
    if (heading) {
      const top = Math.max(0, window.scrollY + heading.getBoundingClientRect().top - 125);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
    }
  }, [draft.step, preview, created]);

  useEffect(() => {
    window.localStorage.setItem(CREATE_DRAFT_STORAGE_KEY, serializeLocalOrderDraft(draft));
  }, [draft]);

  const updateDraft = <K extends keyof LocalOrderDraft>(key: K, value: LocalOrderDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const total = useMemo(() => { try { return parseNativeUsdc(draft.amount); } catch { return 0n; } }, [draft.amount]);
  const split = useMemo(() => settlementSplit(total, Number(draft.depositPercent) || 0), [total, draft.depositPercent]);
  const deadlines = useMemo(() => [draft.fundingDeadline, draft.shipmentDeadline, draft.buyerDecisionDeadline, draft.disputeDeadline].map(parseDeadlineSeconds) as [bigint, bigint, bigint, bigint], [draft.fundingDeadline, draft.shipmentDeadline, draft.buyerDecisionDeadline, draft.disputeDeadline]);
  const partiesReady = distinctPartyAddresses(account, draft.supplier, draft.arbiter);
  const settlementReady = total > 0n && Number.isInteger(Number(draft.depositPercent)) && Number(draft.depositPercent) >= 1 && Number(draft.depositPercent) <= 99 && Number.isInteger(Number(draft.fallbackPercent)) && Number(draft.fallbackPercent) >= 0 && Number(draft.fallbackPercent) <= 100;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const deadlinesReady = deadlines[0] > now && deadlines[1] > deadlines[0] && deadlines[2] > deadlines[1] && deadlines[3] > deadlines[2];
  const referenceReady = Boolean(draft.poReference.trim() && draft.documentReference.trim());
  const missing = [!account ? 'Connected buyer' : '', !partiesReady ? 'Supplier and arbiter' : '', !settlementReady ? 'Amount and split' : '', !deadlinesReady ? 'Chronological deadlines' : '', !referenceReady ? 'PO and local reference' : ''].filter(Boolean);
  const draftReady = missing.length === 0;
  const review = buildCreateOrderReview({ buyer: account, supplier: draft.supplier, arbiter: draft.arbiter, amount: total, depositPercent: Number(draft.depositPercent) || 0, fallbackPercent: Number(draft.fallbackPercent) || 0, deadlines });
  const instrument = buildPreSignatureInstrument({ ...review, poReference: draft.poReference, documentReference: draft.documentReference });
  const reviewState = deriveCreateReviewState({ draftReady, reviewedBuyer, activeBuyer: account, reviewInvalidated });
  const ready = preview && reviewState.reviewReady;
  const walletChanged = Boolean(preview && reviewState.changed && reviewedBuyer);
  const activeStep = draft.step;

  useEffect(() => {
    if (walletChanged) setError(walletReviewMessage(reviewedBuyer, account));
  }, [account, reviewedBuyer, walletChanged]);

  const clearDraft = () => {
    const fresh = defaultDraft();
    window.localStorage.removeItem(CREATE_DRAFT_STORAGE_KEY);
    setDraft(fresh);
    setPreview(false);
    setReviewedBuyer(undefined);
    setReviewInvalidated(false);
    setCreated(undefined);
    setError('');
    setMessage('DRAFT CLEARED');
  };

  const editOrder = () => {
    setPreview(false);
    setReviewedBuyer(undefined);
    setReviewInvalidated(false);
    setDraft((current) => ({ ...current, step: 4 }));
    setError('');
  };

  const continueStep = () => {
    setError('');
    if (activeStep === 1 && (!account || !partiesReady)) { setError('Connect your wallet and enter valid, distinct supplier and arbiter addresses.'); return; }
    if (activeStep === 2 && !settlementReady) { setError('Enter an amount and valid settlement percentages.'); return; }
    if (activeStep === 3 && !deadlinesReady) { setError('Deadlines must be future dates in strict chronological order.'); return; }
    if (activeStep === 4) {
      if (!referenceReady) { setError('Add a PO reference and local document reference before generating the preview.'); return; }
      setReviewedBuyer(account);
      setReviewInvalidated(false);
      setPreview(true);
      return;
    }
    setDraft((current) => ({ ...current, step: (current.step + 1) as CreateWizardStep }));
  };

  const back = () => { if (activeStep > 1) setDraft((current) => ({ ...current, step: (current.step - 1) as CreateWizardStep })); };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const validation = validateCreateDraft({ account, supplier: draft.supplier, arbiter: draft.arbiter, total, depositPercent: draft.depositPercent, fallbackPercent: draft.fallbackPercent, deadlines, now, poReference: draft.poReference, documentReference: draft.documentReference, walletAvailable: Boolean(walletClient) });
    if (validation) { setError(validation); return; }
    if (!account || !walletClient || !walletProvider) { setError('Connect an Arc wallet before creating an order.'); return; }
    const initialReview = checkReviewedBuyer(reviewedBuyer, account);
    if (!ready || !initialReview.ok) { setReviewInvalidated(true); setError(walletReviewMessage(initialReview.reviewedBuyer, initialReview.activeBuyer)); return; }
    let activeWallet: Awaited<ReturnType<typeof syncArcWallet>>;
    try { activeWallet = await syncArcWallet(walletProvider); } catch (walletError) { setError(errorMessage(walletError)); return; }
    const signerCheck = checkReviewedBuyer(reviewedBuyer, activeWallet?.account);
    if (!activeWallet || !walletProviderMatches(walletProvider, activeWallet.provider) || !signerCheck.ok) { setReviewInvalidated(true); setError(walletReviewMessage(signerCheck.reviewedBuyer, signerCheck.activeBuyer)); return; }
    setBusy(true);
    setStage('preparing');
    try {
      setStage('signing');
      const createCall = buildCreateOrderCall({ buyer: activeWallet.account, supplier: draft.supplier as Address, arbiter: draft.arbiter as Address, amount: total, depositPercent: Number(draft.depositPercent), fallbackPercent: Number(draft.fallbackPercent), deadlines });
      const hash = await activeWallet.walletClient.writeContract({ address: FACTORY_ADDRESS, abi: factoryAbi, functionName: 'createOrder', args: createCall.args, value: createCall.value, chain: arcMainnet, account: activeWallet.account } as never);
      setStage('submitted');
      setMessage(`Submitted to Arc · ${shortenAddress(hash)}`);
      setStage('confirming');
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('The order creation transaction reverted.');
      const logs = await fetchOrderCreatedLogs(publicClient, { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
      const createdLog = logs.find((log) => log.transactionHash?.toLowerCase() === hash.toLowerCase());
      if (!createdLog) throw new Error('Receipt succeeded, but the OrderCreated event could not be read back.');
      window.localStorage.setItem(`cargocommit:order:${createdLog.order}`, JSON.stringify({ poReference: draft.poReference.trim(), documentCommitment: draft.documentReference.trim(), savedAt: new Date().toISOString() }));
      setCreated({ order: createdLog.order, hash });
      setStage('success');
      setPreview(false);
      setMessage('Purchase order created. Its terms are now immutable.');
    } catch (transactionError) {
      setStage('idle');
      setError(errorMessage(transactionError));
    } finally {
      setBusy(false);
    }
  };

  if (created && stage === 'success') return <CreatedReceipt order={created.order} hash={created.hash} total={total} deposit={split.depositAmount} reserve={split.reserveAmount} onCreated={onCreated} onCreateAnother={() => { setCreated(undefined); setStage('idle'); setPreview(false); setDraft(defaultDraft()); setReviewedBuyer(undefined); setReviewInvalidated(false); setMessage(''); setError(''); }} />;

  if (preview) return <main className="page-shell page-content-v2 instrument-preview-page"><div className="instrument-preview-head"><div><div className="section-mark"><span>PRE-SIGNATURE</span><strong>COMMERCIAL INSTRUMENT</strong></div><h1 tabIndex={-1}>Purchase order<br /><span>settlement instrument.</span></h1><p>Review the immutable createOrder arguments before the connected wallet is asked to sign.</p></div><button type="button" className="quiet-button" onClick={editOrder}>← EDIT ORDER</button></div><form onSubmit={create}><div className="instrument-preview-sheet"><div className="instrument-preview-top"><div><span>SELDRA</span><strong>PURCHASE ORDER / SETTLEMENT INSTRUMENT</strong></div><InstrumentStamp tone={ready ? 'signal' : 'ink'}>{ready ? instrument.state : 'NOT REVIEWED'}</InstrumentStamp></div><div className="instrument-preview-reference"><span>REFERENCE</span><strong>SD / PO / {draft.poReference || 'LOCAL'}</strong></div><div className="instrument-preview-total"><span>TOTAL</span><strong>{money(instrument.amount)}</strong></div><div className={`instrument-preview-split ${split.depositPercent < 20 || split.depositPercent > 80 ? 'extreme-split' : ''}`} style={{ '--deposit-width': `${split.depositPercent}%` } as React.CSSProperties}><div><span>RELEASE AT FUNDING</span><strong>{instrument.depositPercent}%</strong><b>{money(split.depositAmount)}</b></div><div><span>PROTECTED UNTIL SHIPMENT</span><strong>{split.reservePercent}%</strong><b>{money(split.reserveAmount)}</b></div></div><div className="instrument-preview-roles"><div><span>BUYER</span><strong>{account ?? 'NOT CONNECTED'}</strong></div><div><span>SUPPLIER</span><strong>{draft.supplier}</strong></div><div><span>ARBITER</span><strong>{draft.arbiter}</strong></div><div><span>FALLBACK</span><strong>SUPPLIER {instrument.fallbackPercent}% / BUYER {100 - instrument.fallbackPercent}%</strong></div></div><div className="instrument-preview-timeline"><span>TIMELINE</span><WizardTimeline deadlines={deadlines} /></div><div className="instrument-preview-meta"><div><span>LOCAL PO REFERENCE</span><strong>{draft.poReference || 'NOT SET'} <small>LOCAL-ONLY METADATA</small></strong></div><div><span>LOCAL DOCUMENT REFERENCE</span><strong>{draft.documentReference || 'NOT SET'} <small>LOCAL-ONLY METADATA</small></strong></div><div><span>ONCHAIN TERMS</span><strong>DERIVED AFTER CREATION FROM IMMUTABLE CONTRACT TERMS</strong></div><div><span>NETWORK</span><strong>ARC MAINNET / 5042</strong></div><div><span>FACTORY</span><strong>{FACTORY_ADDRESS}</strong></div><div><span>CREATE TRANSACTION VALUE</span><strong>0 USDC <small>PRINCIPAL FUNDED LATER</small></strong></div></div></div>{walletChanged && <div className="form-alert-v2 error wallet-changed-alert"><strong>WALLET CHANGED</strong><p>Buyer changed from {reviewedBuyer} to {account}.</p><p>Review this order again before signing.</p><button type="button" className="quiet-button" onClick={() => { setReviewedBuyer(account); setReviewInvalidated(false); setError(''); }}>REVIEW UPDATED ORDER</button></div>}{error && <div className="form-alert-v2 error instrument-error">{error}</div>}{message && <div className="form-alert-v2 success instrument-error">{message}</div>}<div className="instrument-preview-actions"><button type="submit" className="primary-button" disabled={busy || !ready}>{busy ? stage === 'signing' ? 'AWAITING WALLET SIGNATURE' : 'PREPARING ORDER…' : 'CREATE ORDER ON ARC'} <span>→</span></button><button type="button" className="secondary-button" onClick={editOrder}>EDIT ORDER</button></div><p className="instrument-risk-note">EXPERIMENTAL ARC MAINNET PROTOTYPE · CONTRACTS UNAUDITED · DO NOT USE FOR REAL COMMERCIAL FUNDS.</p></form></main>;

  const sameOtherParty = isAddress(draft.supplier) && isAddress(draft.arbiter) && draft.supplier.toLowerCase() === draft.arbiter.toLowerCase();
  const activePartyState = sameOtherParty ? 'duplicate' : partyState(draft.supplier, account);
  const activeArbiterState = sameOtherParty ? 'duplicate' : partyState(draft.arbiter, account);
  const canContinue = activeStep === 1 ? Boolean(account && partiesReady) : activeStep === 2 ? settlementReady : activeStep === 3 ? deadlinesReady : referenceReady;
  return <main className="page-shell page-content-v2 create-wizard-page"><div className="wizard-header"><div><div className="section-mark"><span>NEW TRADE ORDER</span><strong>FOUR-STEP INSTRUMENT BUILDER</strong></div><h1>Prepare a purchase order<br /><span>that can move.</span></h1><p>Enter the commercial terms once. Seldra preserves the draft locally and asks the wallet to sign only after the final instrument is reviewed.</p></div><button type="button" className="quiet-button" onClick={clearDraft}>CLEAR DRAFT</button></div><div className="wizard-progress" aria-label="Create order progress">{WIZARD_STEPS.filter(({ number }) => number >= activeStep).map(({ number, label }) => <div className={number === activeStep ? 'active' : ''} key={number}><span>{String(number).padStart(2, '0')}</span><strong>{label}</strong></div>)}</div><form className="wizard-form" onSubmit={(event) => { event.preventDefault(); continueStep(); }}>{activeStep === 1 && <section className="wizard-step"><div className="wizard-step-heading" tabIndex={-1}><span>01 / PARTIES</span><strong>WHO IS IN THE ORDER?</strong></div>{!account && <div className="wizard-wallet-gate"><InstrumentStamp tone="ink">WALLET REQUIRED</InstrumentStamp><strong>Connect the buyer wallet first.</strong><p>The connected wallet becomes the immutable buyer and must be revalidated before signing.</p><button type="button" className="primary-button" onClick={() => window.dispatchEvent(new CustomEvent('cargocommit:connect-wallet'))}>CONNECT ARC WALLET <span>→</span></button></div>}<div className={`wizard-party-grid ${account ? '' : 'is-locked'}`}><div className="wizard-party-card buyer"><PartyGlyph address={account} /><span>BUYER / IMPORTER</span><strong>{account ? shortenAddress(account) : 'CONNECT WALLET'}</strong><small>Connected wallet / order originator</small><StatusMark state={account ? 'valid' : 'empty'} label="BUYER" /></div><div className="wizard-party-bridge"><span>BUYER</span><i>→</i><strong>FUNDED ORDER</strong><i>→</i><span>SUPPLIER</span><em>↘ ARBITER</em></div><div className="wizard-party-card"><PartyGlyph address={draft.supplier} /><span>SUPPLIER / EXPORTER</span><input disabled={!account} aria-label="Supplier wallet address" value={draft.supplier} onChange={(event) => updateDraft('supplier', event.target.value.trim())} placeholder="0x supplier address" /><small>Receives the production release.</small><StatusMark state={activePartyState} label="SUPPLIER" /></div><div className="wizard-party-card"><PartyGlyph address={draft.arbiter} /><span>ARBITER</span><input disabled={!account} aria-label="Arbiter wallet address" value={draft.arbiter} onChange={(event) => updateDraft('arbiter', event.target.value.trim())} placeholder="0x arbiter address" /><small>Resolves only a disputed reserve.</small><StatusMark state={activeArbiterState} label="ARBITER" /></div></div><StepFooter step={activeStep} canContinue={canContinue} onBack={back} onContinue={continueStep} continueLabel="CONTINUE TO SETTLEMENT" /></section>}{activeStep === 2 && <section className="wizard-step"><div className="wizard-step-heading" tabIndex={-1}><span>02 / SETTLEMENT</span><strong>HOW DOES THE MONEY MOVE?</strong></div><DraftField label="TOTAL ORDER AMOUNT"><div className="input-unit-v2"><input inputMode="decimal" value={draft.amount === '' ? '' : formatInputAmount(draft.amount)} onFocus={(event) => { event.currentTarget.value = draft.amount; }} onBlur={(event) => updateDraft('amount', event.currentTarget.value.replaceAll(',', ''))} onChange={(event) => updateDraft('amount', event.target.value.replaceAll(',', ''))} /><span>USDC</span></div></DraftField><SettlementInstrument total={total} deposit={split.depositAmount} reserve={split.reserveAmount} depositPercent={split.depositPercent} reservePercent={split.reservePercent} /><div className="wizard-split-controls"><div><span>RELEASE AT FUNDING</span><strong>{split.depositPercent}%</strong></div><input aria-label="Production deposit percentage" type="range" min="1" max="99" value={Number(draft.depositPercent) || 1} onChange={(event) => updateDraft('depositPercent', event.target.value)} /><div><span>PROTECTED UNTIL SHIPMENT</span><strong>{split.reservePercent}%</strong></div></div><div className="split-quick-choices">{['20', '30', '40', '50'].map((value) => <button type="button" className={draft.depositPercent === value ? 'active' : ''} onClick={() => updateDraft('depositPercent', value)} key={value}>{value} / {100 - Number(value)}</button>)}</div><div className="wizard-fallback"><span>IF DISPUTE REACHES FALLBACK</span><strong>SUPPLIER {draft.fallbackPercent}% <i>/</i> BUYER {100 - (Number(draft.fallbackPercent) || 0)}%</strong><DraftField label="SUPPLIER SHARE"><div className="input-unit-v2"><input inputMode="numeric" min="0" max="100" value={draft.fallbackPercent} onChange={(event) => updateDraft('fallbackPercent', event.target.value.replace(/\D/g, '').slice(0, 3))} /><span>%</span></div></DraftField></div><details className="fallback-explainer"><summary>HOW FALLBACK SETTLEMENT WORKS</summary><p>If the dispute window expires without an arbiter resolution, the contract pays the supplier the configured share of the protected reserve and returns the balance to the buyer.</p></details><StepFooter step={activeStep} canContinue={canContinue} onBack={back} onContinue={continueStep} continueLabel="CONTINUE TO DELIVERY" /></section>}{activeStep === 3 && <section className="wizard-step"><div className="wizard-step-heading" tabIndex={-1}><span>03 / DELIVERY</span><strong>WHEN DOES EACH STATE CHANGE?</strong></div><WizardTimeline deadlines={deadlines} /><div className="wizard-date-grid"><DraftField label="FUNDING DEADLINE"><input type="datetime-local" value={draft.fundingDeadline} onChange={(event) => updateDraft('fundingDeadline', event.target.value)} /></DraftField><DraftField label="SHIPMENT DEADLINE"><input type="datetime-local" value={draft.shipmentDeadline} onChange={(event) => updateDraft('shipmentDeadline', event.target.value)} /></DraftField><DraftField label="BUYER DECISION DEADLINE"><input type="datetime-local" value={draft.buyerDecisionDeadline} onChange={(event) => updateDraft('buyerDecisionDeadline', event.target.value)} /></DraftField><DraftField label="DISPUTE DEADLINE"><input type="datetime-local" value={draft.disputeDeadline} onChange={(event) => updateDraft('disputeDeadline', event.target.value)} /></DraftField></div>{!deadlinesReady && <p className="inline-validation">Funding, shipment, buyer decision and dispute deadlines must move forward in that order.</p>}<StepFooter step={activeStep} canContinue={canContinue} onBack={back} onContinue={continueStep} continueLabel="CONTINUE TO REFERENCE" /></section>}{activeStep === 4 && <section className="wizard-step"><div className="wizard-step-heading" tabIndex={-1}><span>04 / REFERENCE</span><strong>KEEP THE COMMERCIAL DOCUMENT LOCAL</strong></div><div className="wizard-reference-note"><InstrumentStamp tone="ink">LOCAL METADATA</InstrumentStamp><p>Seldra does not upload or store the actual commercial document. These references stay on this device. The onchain <code>termsHash</code> is derived after creation from immutable contract terms.</p></div><DraftField label="PO REFERENCE"><input value={draft.poReference} onChange={(event) => updateDraft('poReference', event.target.value)} placeholder="PO-2048 / internal reference" /></DraftField><DraftField label="LOCAL DOCUMENT REFERENCE"><input value={draft.documentReference} onChange={(event) => updateDraft('documentReference', event.target.value)} placeholder="Internal fingerprint or reference text" /></DraftField><StepFooter step={activeStep} canContinue={canContinue} onBack={back} onContinue={continueStep} continueLabel="GENERATE ORDER PREVIEW" /></section>}</form>{error && <div className="form-alert-v2 error wizard-error">{error}</div>}{message && <div className="form-alert-v2 success wizard-error">{message}</div>}<div className="wizard-local-note">UNFINISHED COMMERCIAL INPUTS AUTOSAVE LOCALLY · REVIEW, SIGNATURE, BUYER, AND TRANSACTION STATE ARE NEVER RESTORED</div></main>;
}
