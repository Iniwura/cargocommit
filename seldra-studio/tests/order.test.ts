import { describe, expect, test } from 'bun:test';
import { nextStep, roleOf, withWithdraw, type OrderSummary } from '../src/lib/order';
import { blockRanges } from '../src/lib/history';

const A = '0x1111111111111111111111111111111111111111' as const;
const B = '0x2222222222222222222222222222222222222222' as const;
const C = '0x3333333333333333333333333333333333333333' as const;
const Z = `0x${'0'.repeat(64)}` as const;

const summary = (status: number, over: Partial<OrderSummary> = {}): OrderSummary => ({
  buyer: A, supplier: B, arbiter: C,
  orderAmount: 10n ** 18n, depositAmount: 3n * 10n ** 17n, reserveAmount: 7n * 10n ** 17n,
  depositBps: 3000, fallbackSupplierBps: 5000, referenceHash: Z,
  fundingDeadline: 1000n, shipmentDeadline: 2000n, buyerDecisionDeadline: 3000n, disputeDeadline: 4000n,
  termsHash: Z, createdAtBlock: 1n, status, outcome: 0, reserveRemaining: 7n * 10n ** 17n, totalPending: 0n,
  acceptedAt: 0n, fundedAt: 0n, evidenceSubmittedAt: 0n, settledAt: 0n, evidenceHash: Z, disputeReasonHash: Z, balance: 0n,
  ...over,
});

describe('roles', () => {
  test('matches case-insensitively and defaults to observer', () => {
    const s = summary(0);
    expect(roleOf(s, A.toUpperCase().replace('0X', '0x') as `0x${string}`)).toBe('buyer');
    expect(roleOf(s, B)).toBe('supplier');
    expect(roleOf(s, C)).toBe('arbiter');
    expect(roleOf(s, '0x4444444444444444444444444444444444444444')).toBe('observer');
    expect(roleOf(s, undefined)).toBe('observer');
  });
});

describe('next step gating', () => {
  test('only the supplier can accept, only before the funding deadline', () => {
    expect(nextStep(summary(0), 'supplier', 500n).actions).toContain('acceptTerms');
    expect(nextStep(summary(0), 'buyer', 500n).actions).not.toContain('acceptTerms');
    expect(nextStep(summary(0), 'supplier', 1001n).actions).not.toContain('acceptTerms');
  });
  test('only the buyer can fund an accepted order before the deadline', () => {
    expect(nextStep(summary(1), 'buyer', 500n).actions).toContain('fund');
    expect(nextStep(summary(1), 'supplier', 500n).actions).not.toContain('fund');
    expect(nextStep(summary(1), 'buyer', 1001n).actions).not.toContain('fund');
  });
  test('anyone can close an expired unfunded order, observers cannot before', () => {
    expect(nextStep(summary(1), 'observer', 500n).actions).not.toContain('cancelBeforeFunding');
    expect(nextStep(summary(1), 'observer', 1001n).actions).toContain('cancelBeforeFunding');
  });
  test('evidence, refund, approve, dispute and timeout follow the deadlines', () => {
    expect(nextStep(summary(2), 'supplier', 1500n).actions).toEqual(['submitEvidence']);
    expect(nextStep(summary(2), 'supplier', 2001n).actions).toEqual([]);
    expect(nextStep(summary(2), 'buyer', 2001n).actions).toEqual(['claimShipmentRefund']);
    expect(nextStep(summary(3), 'buyer', 2500n).actions).toEqual(['approveRelease', 'openDispute']);
    expect(nextStep(summary(3), 'buyer', 3001n).actions).toEqual([]);
    expect(nextStep(summary(3), 'supplier', 3001n).actions).toEqual(['claimDecisionTimeout']);
  });
  test('dispute: arbiter resolves in time, anyone participant applies the fallback after', () => {
    expect(nextStep(summary(4), 'arbiter', 3500n).actions).toEqual(['resolveDispute']);
    expect(nextStep(summary(4), 'arbiter', 4001n).actions).toEqual(['claimDisputeFallback']);
    expect(nextStep(summary(4), 'observer', 4001n).actions).toEqual([]);
  });
  test('settled orders offer nothing except a pending withdrawal', () => {
    const step = nextStep(summary(5), 'buyer', 9999n);
    expect(step.actions).toEqual([]);
    expect(withWithdraw(step, 5n).actions).toEqual(['withdraw']);
    expect(withWithdraw(step, 0n).actions).toEqual([]);
  });
});

describe('block ranges', () => {
  test('covers [from, to] exactly once in bounded chunks', () => {
    const ranges = blockRanges(100n, 125n, 10n);
    expect(ranges).toEqual([[100n, 109n], [110n, 119n], [120n, 125n]]);
    expect(blockRanges(5n, 5n, 10n)).toEqual([[5n, 5n]]);
    expect(blockRanges(6n, 5n, 10n)).toEqual([]);
    expect(() => blockRanges(1n, 2n, 0n)).toThrow();
  });
});
