import { describe, expect, test } from 'bun:test';
import { MAX_TERM_SECONDS, WINDOW_PRESETS, buildDeadlines, percentToBps, validateOrderForm, type OrderForm } from '../src/lib/terms';

const BUYER = '0x1111111111111111111111111111111111111111' as const;
const SUPPLIER = '0x2222222222222222222222222222222222222222';
const ARBITER = '0x3333333333333333333333333333333333333333';

const base: OrderForm = {
  supplier: SUPPLIER,
  arbiter: ARBITER,
  amount: '10',
  depositPercent: '30',
  fallbackPercent: '50',
  referenceHash: '',
  windows: WINDOW_PRESETS.testnet.windows,
};

describe('terms', () => {
  test('accepts a valid form and converts to native units and bps', () => {
    const { errors, value } = validateOrderForm(base, BUYER);
    expect(errors).toEqual({});
    expect(value?.orderAmount).toBe(10n * 10n ** 18n);
    expect(value?.depositBps).toBe(3000);
    expect(value?.fallbackSupplierBps).toBe(5000);
    expect(value?.referenceHash).toBe(`0x${'0'.repeat(64)}`);
  });

  test('rejects duplicate or self roles', () => {
    expect(validateOrderForm({ ...base, supplier: BUYER }, BUYER).errors.supplier).toBeDefined();
    expect(validateOrderForm({ ...base, arbiter: SUPPLIER }, BUYER).errors.arbiter).toBeDefined();
    expect(validateOrderForm({ ...base, arbiter: BUYER }, BUYER).errors.arbiter).toBeDefined();
  });

  test('rejects bad amounts and percentages', () => {
    expect(validateOrderForm({ ...base, amount: '0.001' }, BUYER).errors.amount).toBeDefined();
    expect(validateOrderForm({ ...base, amount: 'x' }, BUYER).errors.amount).toBeDefined();
    expect(validateOrderForm({ ...base, depositPercent: '0' }, BUYER).errors.depositPercent).toBeDefined();
    expect(validateOrderForm({ ...base, depositPercent: '100' }, BUYER).errors.depositPercent).toBeDefined();
    expect(validateOrderForm({ ...base, fallbackPercent: '101' }, BUYER).errors.fallbackPercent).toBeDefined();
    expect(percentToBps('12.5')).toBe(1250);
  });

  test('windows must be at least 10 minutes and fit in 365 days', () => {
    const tiny = { ...WINDOW_PRESETS.testnet.windows, funding: 60 };
    expect(validateOrderForm({ ...base, windows: tiny }, BUYER).errors.windows).toBeDefined();
    const huge = { funding: MAX_TERM_SECONDS, shipment: 600, decision: 600, dispute: 600 };
    expect(validateOrderForm({ ...base, windows: huge }, BUYER).errors.windows).toBeDefined();
    expect(validateOrderForm({ ...base, windows: WINDOW_PRESETS.standard.windows }, BUYER).errors.windows).toBeUndefined();
  });

  test('deadlines are strictly increasing and stay inside the contract horizon', () => {
    for (const preset of Object.values(WINDOW_PRESETS)) {
      const now = 1_800_000_000;
      const d = buildDeadlines(now, preset.windows);
      expect(d.fundingDeadline > BigInt(now)).toBe(true);
      expect(d.shipmentDeadline > d.fundingDeadline).toBe(true);
      expect(d.buyerDecisionDeadline > d.shipmentDeadline).toBe(true);
      expect(d.disputeDeadline > d.buyerDecisionDeadline).toBe(true);
      expect(d.disputeDeadline <= BigInt(now + MAX_TERM_SECONDS)).toBe(true);
    }
  });
});
