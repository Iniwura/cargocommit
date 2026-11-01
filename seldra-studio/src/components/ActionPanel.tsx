import { useState } from 'react';
import type { Abi, Address } from 'viem';
import { seldraOrderAbi } from '@/abi.generated';
import { useUsdcBalance, useWallet } from '@/hooks/useChain';
import { useTx } from '@/hooks/useTx';
import { formatNativeUsdc, nativeToUsdcUnits, parseUsdcUnits, usdcUnitsToNative } from '@/lib/money';
import { formatDateTime, formatRemaining } from '@/lib/format';
import type { ActionKey, NextStep, OrderSummary, Role } from '@/lib/order';
import { Button, Field, Notice, TxStatus } from './ui';
import { HashInput } from './HashInput';
import { NETWORK } from '@/config';

const ABI = seldraOrderAbi as Abi;

type Props = {
  order: Address;
  summary: OrderSummary;
  role: Role;
  step: NextStep;
  now: bigint;
  credit: bigint;
};

export function ActionPanel({ order, summary, role, step, now, credit }: Props) {
  const wallet = useWallet();
  const balance = useUsdcBalance(wallet.address);
  const tx = useTx();
  const [evidence, setEvidence] = useState<`0x${string}` | ''>('');
  const [reason, setReason] = useState<`0x${string}` | ''>('');
  const [checked, setChecked] = useState(false);
  const [payout, setPayout] = useState('');

  const call = (functionName: ActionKey, args?: readonly unknown[], value?: bigint) =>
    void tx.send({ abi: ABI, address: order, functionName, args, value });

  const has = (a: ActionKey) => step.actions.includes(a);
  const payoutUnits = parseUsdcUnits(payout);
  const payoutNative = payoutUnits === null ? null : usdcUnitsToNative(payoutUnits);
  const payoutInvalid = payoutNative === null || payoutNative > summary.reserveRemaining;
  const lacksFunds = balance.data !== undefined && balance.data < nativeToUsdcUnits(summary.orderAmount);

  return (
    <section className="panel next-step" aria-labelledby="next-title">
      <header className="panel-head">
        <h2 id="next-title">Next step</h2>
        {step.deadline && summary.status !== 5 ? (
          <span className="eyebrow">
            Window {formatRemaining(step.deadline, now)} · until {formatDateTime(step.deadline)}
          </span>
        ) : null}
      </header>
      <h3 className="serif step-headline">{step.headline}</h3>
      <p className="muted">{step.detail}</p>

      {!wallet.isConnected ? (
        <Notice title="Connect a wallet to act on this order">Anyone can read the order. Only the buyer, supplier or arbiter wallet can move it forward.</Notice>
      ) : null}
      {wallet.isConnected && role === 'observer' ? (
        <Notice title="You are viewing this order as an observer">Your connected wallet is not the buyer, supplier or arbiter of this order.</Notice>
      ) : null}
      {wallet.isConnected && role !== 'observer' ? <p className="role-line">You are the <strong>{role}</strong> on this order.</p> : null}

      {has('acceptTerms') ? (
        <div className="action">
          <p className="muted">Accepting confirms you have read the fixed amount, deposit split and deadlines above.</p>
          <Button onClick={() => call('acceptTerms')} busy={tx.busy}>Accept terms</Button>
        </div>
      ) : null}

      {has('fund') ? (
        <div className="action">
          <p>
            You will send <strong>{formatNativeUsdc(summary.orderAmount)} USDC</strong>. The supplier receives{' '}
            <strong>{formatNativeUsdc(summary.depositAmount)} USDC</strong> immediately; <strong>{formatNativeUsdc(summary.reserveAmount)} USDC</strong> stays protected.
          </p>
          {lacksFunds ? <Notice tone="warn" title="Your USDC balance is below the order amount">Add USDC to this wallet, then retry. On Arc, gas is paid in the same USDC.</Notice> : null}
          <Button onClick={() => call('fund', undefined, summary.orderAmount)} busy={tx.busy} disabled={lacksFunds}>
            Fund {formatNativeUsdc(summary.orderAmount)} USDC
          </Button>
        </div>
      ) : null}

      {has('submitEvidence') ? (
        <div className="action">
          <HashInput label="Shipment evidence" hint="Only the hash goes onchain. Keep the documents themselves to share with the buyer offchain." onChange={setEvidence} />
          <Button onClick={() => evidence && call('submitEvidence', [evidence])} busy={tx.busy} disabled={!evidence}>Commit evidence</Button>
        </div>
      ) : null}

      {has('approveRelease') ? (
        <div className="action">
          <label className="check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            I have reviewed the shipment evidence offchain and want to release the protected reserve.
          </label>
          <Button onClick={() => call('approveRelease')} busy={tx.busy} disabled={!checked}>
            Approve and release {formatNativeUsdc(summary.reserveRemaining)} USDC
          </Button>
        </div>
      ) : null}

      {has('openDispute') ? (
        <details className="action dispute">
          <summary>Something is wrong? Open a dispute</summary>
          <HashInput label="Reason" hint="Describe the problem. Only its hash goes onchain." onChange={setReason} />
          <Button variant="danger" onClick={() => reason && call('openDispute', [reason])} busy={tx.busy} disabled={!reason}>Open dispute</Button>
        </details>
      ) : null}

      {has('resolveDispute') ? (
        <div className="action">
          <Field
            label="Amount to the supplier (USDC)"
            hint={`The buyer receives the rest of the ${formatNativeUsdc(summary.reserveRemaining)} USDC reserve.`}
            error={payout && payoutInvalid ? 'Enter an amount between 0 and the remaining reserve.' : undefined}
          >
            <input inputMode="decimal" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="0.00" />
          </Field>
          <Button onClick={() => payoutNative !== null && call('resolveDispute', [payoutNative])} busy={tx.busy} disabled={payoutInvalid}>
            Resolve dispute
          </Button>
        </div>
      ) : null}

      <div className="action-row">
        {has('claimShipmentRefund') ? <Button onClick={() => call('claimShipmentRefund')} busy={tx.busy}>Take back the reserve</Button> : null}
        {has('claimDecisionTimeout') ? <Button onClick={() => call('claimDecisionTimeout')} busy={tx.busy}>Collect the reserve</Button> : null}
        {has('claimDisputeFallback') ? <Button onClick={() => call('claimDisputeFallback')} busy={tx.busy}>Apply the fallback split</Button> : null}
        {has('withdraw') ? <Button onClick={() => call('withdraw')} busy={tx.busy}>Withdraw {formatNativeUsdc(credit)} USDC credit</Button> : null}
        {has('cancelBeforeFunding') ? (
          <Button variant="ghost" onClick={() => call('cancelBeforeFunding')} busy={tx.busy}>
            {role === 'buyer' ? 'Cancel order' : 'Close expired order'}
          </Button>
        ) : null}
      </div>

      {wallet.isConnected && !wallet.onTargetChain ? (
        <Notice tone="warn" title={`Switch your wallet to ${NETWORK.label}`}>Actions are sent on {NETWORK.label}. The button above will ask your wallet to switch.</Notice>
      ) : null}
      <TxStatus state={tx.state} />
    </section>
  );
}
