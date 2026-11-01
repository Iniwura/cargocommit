import { useMemo, useState } from 'react';
import { parseEventLogs, type Abi } from 'viem';
import { seldraFactoryAbi } from '@/abi.generated';
import { NETWORK } from '@/config';
import { useWallet } from '@/hooks/useChain';
import { useTx } from '@/hooks/useTx';
import { formatNativeUsdc, splitOrder } from '@/lib/money';
import { formatPercentBps } from '@/lib/format';
import { WINDOW_PRESETS, buildDeadlines, validateOrderForm, type OrderForm } from '@/lib/terms';
import { navigate } from '@/router';
import { HashInput } from './HashInput';
import { Button, Field, Notice, TxStatus } from './ui';

const DEFAULT_FORM: OrderForm = {
  supplier: '',
  arbiter: '',
  amount: '',
  depositPercent: '30',
  fallbackPercent: '50',
  referenceHash: '',
  windows: WINDOW_PRESETS.testnet.windows,
};

export function CreateOrderPage() {
  const wallet = useWallet();
  const tx = useTx();
  const [form, setForm] = useState<OrderForm>(DEFAULT_FORM);
  const [preset, setPreset] = useState<'testnet' | 'standard'>('testnet');
  const [touched, setTouched] = useState(false);

  const { errors, value } = useMemo(() => validateOrderForm(form, wallet.address), [form, wallet.address]);
  const split = value ? splitOrder(value.orderAmount, value.depositBps) : null;
  const set = <K extends keyof OrderForm>(key: K, v: OrderForm[K]) => setForm((f) => ({ ...f, [key]: v }));
  const show = (key: keyof typeof errors) => (touched ? errors[key] : undefined);

  const submit = async () => {
    setTouched(true);
    if (!value || !NETWORK.factory) return;
    const deadlines = buildDeadlines(Math.floor(Date.now() / 1000), form.windows);
    const receipt = await tx.send({
      abi: seldraFactoryAbi as Abi,
      address: NETWORK.factory,
      functionName: 'createOrder',
      args: [{ ...value, ...deadlines }],
    });
    if (receipt?.status !== 'success') return;
    const created = parseEventLogs({ abi: seldraFactoryAbi, logs: receipt.logs, eventName: 'OrderCreated' })[0];
    if (created) navigate(`/order/${created.args.order}`);
  };

  if (!NETWORK.factory) {
    return <main className="page narrow"><Notice tone="warn" title="No factory is configured for this network">Set the factory address for this network in .env (see .env.example).</Notice></main>;
  }

  return (
    <main className="page narrow">
      <p className="eyebrow"><i className="rule" />New purchase order</p>
      <h1 className="page-title">Fix the terms once.</h1>
      <p className="lede">Everything below becomes immutable the moment the order is created. You will be the buyer.</p>

      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        <Field label="Supplier wallet" htmlFor="supplier" error={show('supplier')} hint="Receives the deposit on funding and the reserve on release.">
          <input id="supplier" className="mono" value={form.supplier} spellCheck={false} placeholder="0x…" onChange={(e) => set('supplier', e.target.value)} />
        </Field>
        <Field label="Arbiter wallet" htmlFor="arbiter" error={show('arbiter')} hint="Can only split the protected reserve if you open a dispute. Must be neither of you.">
          <input id="arbiter" className="mono" value={form.arbiter} spellCheck={false} placeholder="0x…" onChange={(e) => set('arbiter', e.target.value)} />
        </Field>

        <div className="form-row">
          <Field label="Order amount (USDC)" htmlFor="amount" error={show('amount')} hint="Minimum 0.01 USDC, up to 6 decimals.">
            <input id="amount" inputMode="decimal" value={form.amount} placeholder="0.00" onChange={(e) => set('amount', e.target.value)} />
          </Field>
          <Field label="Production deposit (%)" htmlFor="deposit" error={show('depositPercent')} hint="Paid to the supplier when you fund.">
            <input id="deposit" inputMode="decimal" value={form.depositPercent} onChange={(e) => set('depositPercent', e.target.value)} />
          </Field>
        </div>

        {split && value ? (
          <div className="preview" aria-live="polite">
            <div><span className="eyebrow">Supplier receives at funding</span><strong className="serif">{formatNativeUsdc(split.deposit)} USDC</strong></div>
            <div><span className="eyebrow">Protected until release</span><strong className="serif">{formatNativeUsdc(split.reserve)} USDC</strong></div>
          </div>
        ) : null}

        <Field label="If a dispute is never resolved, supplier share of the reserve (%)" htmlFor="fallback" error={show('fallbackPercent')} hint="Applied automatically if the arbiter stays silent past the dispute window.">
          <input id="fallback" inputMode="decimal" value={form.fallbackPercent} onChange={(e) => set('fallbackPercent', e.target.value)} />
        </Field>

        <fieldset className="field">
          <legend>Deadlines</legend>
          <div className="segmented">
            {(Object.keys(WINDOW_PRESETS) as Array<'testnet' | 'standard'>).map((key) => (
              <button
                key={key}
                type="button"
                className={preset === key ? 'on' : ''}
                aria-pressed={preset === key}
                onClick={() => {
                  setPreset(key);
                  set('windows', WINDOW_PRESETS[key].windows);
                }}
              >
                {WINDOW_PRESETS[key].label}
              </button>
            ))}
          </div>
          <p className="field-hint">{WINDOW_PRESETS[preset].hint}</p>
          {show('windows') ? <p className="field-error" role="alert">{errors.windows}</p> : null}
        </fieldset>

        <HashInput label="Purchase-order reference (optional)" hint="A hash of your offchain purchase-order document, stored in the terms." onChange={(h) => set('referenceHash', h)} />

        {value ? (
          <p className="field-hint">
            Terms: {formatNativeUsdc(value.orderAmount)} USDC, deposit {formatPercentBps(value.depositBps)}, fallback {formatPercentBps(value.fallbackSupplierBps)} to the supplier.
          </p>
        ) : null}

        {!wallet.isConnected ? <Notice title="Connect your wallet to create the order">The connect button is in the header.</Notice> : null}
        <Button type="submit" busy={tx.busy} disabled={!wallet.isConnected}>Create order</Button>
        <TxStatus state={tx.state} successText="Order created. Opening it…" />
      </form>
    </main>
  );
}
