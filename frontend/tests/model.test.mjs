import test from 'node:test';
import assert from 'node:assert/strict';

const build = process.env.FRONTEND_TEST_BUILD ?? '/tmp/cargocommit-frontend-test';
const model = await import(`${build}/model.js`);

test('formats Arc native USDC with 18 decimal precision', () => {
  assert.equal(model.formatUsdc(1_000_000_000_000_000_000n), '1');
  assert.equal(model.formatUsdc(300_000_000_000_000_000n), '0.3');
  assert.equal(model.formatUsdc(1_234_567_000_000_000n), '0.001234');
});

test('maps immutable order roles without trusting display labels', () => {
  assert.equal(model.roleFor('0xAa', '0xaa', '0xbb', '0xcc'), 'buyer');
  assert.equal(model.roleFor('0xBb', '0xaa', '0xbb', '0xcc'), 'supplier');
  assert.equal(model.roleFor('0xCc', '0xaa', '0xbb', '0xcc'), 'arbiter');
  assert.equal(model.roleFor('0xdd', '0xaa', '0xbb', '0xcc'), 'observer');
});

test('renders every contract lifecycle status and outcome', () => {
  assert.equal(model.statusLabel(0), 'Created');
  assert.equal(model.statusLabel(3), 'Shipment submitted');
  assert.equal(model.statusLabel(5), 'Settled');
  assert.equal(model.outcomeLabel(4), 'Dispute resolved');
  assert.equal(model.statusLabel(99), 'Unknown');
});

test('calculates reserve percentages without floating point division', () => {
  assert.equal(model.percentOf(700_000_000_000_000_000n, 1_000_000_000_000_000_000n), 70);
  assert.equal(model.percentOf(0n, 1n), 0);
});

test('keeps every settlement representation on one split source of truth', () => {
  const total = 10_000n * 1_000_000_000_000_000_000n;
  const cases = [
    [20, 80, 2_000n, 8_000n],
    [30, 70, 3_000n, 7_000n],
    [50, 50, 5_000n, 5_000n],
  ];

  for (const [depositBps, reserveBps, depositWhole, reserveWhole] of cases) {
    const split = model.settlementSplit(total, depositBps);
    assert.equal(split.depositBps, depositBps);
    assert.equal(split.reserveBps, reserveBps);
    assert.equal(split.depositAmount, depositWhole * 1_000_000_000_000_000_000n);
    assert.equal(split.reserveAmount, reserveWhole * 1_000_000_000_000_000_000n);
  }

  const changedAmount = model.settlementSplit(12_500n * 1_000_000_000_000_000_000n, 30);
  assert.equal(changedAmount.depositAmount, 3_750n * 1_000_000_000_000_000_000n);
  assert.equal(changedAmount.reserveAmount, 8_750n * 1_000_000_000_000_000_000n);
});

const validDraft = {
  account: '0x0000000000000000000000000000000000000001',
  supplier: '0x0000000000000000000000000000000000000002',
  arbiter: '0x0000000000000000000000000000000000000003',
  total: 10_000n * 1_000_000_000_000_000_000n,
  depositBps: '30',
  fallbackBps: '50',
  deadlines: [1100n, 1200n, 1300n, 1400n],
  now: 1000n,
  poReference: 'PO-2042',
  documentReference: 'invoice-2042',
  walletAvailable: true,
};

test('rejects malformed and duplicate parties', () => {
  assert.notEqual(model.validateCreateDraft({ ...validDraft, supplier: 'not-an-address' }), '');
  assert.notEqual(model.validateCreateDraft({ ...validDraft, arbiter: '0x1234' }), '');
  assert.notEqual(model.validateCreateDraft({ ...validDraft, supplier: validDraft.account }), '');
  assert.notEqual(model.validateCreateDraft({ ...validDraft, arbiter: validDraft.account }), '');
  assert.notEqual(model.validateCreateDraft({ ...validDraft, arbiter: validDraft.supplier }), '');
});

test('rejects incomplete drafts and invalid deadline ordering', () => {
  assert.match(model.validateCreateDraft({ ...validDraft, total: 0n }), /amount/i);
  assert.match(model.validateCreateDraft({ ...validDraft, poReference: '' }), /local document reference|PO reference/i);
  assert.match(model.validateCreateDraft({ ...validDraft, deadlines: [1100n, 1050n, 1300n, 1400n] }), /deadlines/i);
  assert.match(model.validateCreateDraft({ ...validDraft, deadlines: [1000n, 1200n, 1300n, 1400n] }), /deadlines/i);
});

test('valid inputs reach READY TO CREATE', () => {
  assert.equal(model.validateCreateDraft(validDraft), '');
});

test('rejected wallet transaction keeps the draft intact', () => {
  const failure = model.preserveDraftOnTransactionFailure(validDraft, 'Wallet request was cancelled.');
  assert.deepEqual(failure.draft, validDraft);
  assert.equal(failure.error, 'Wallet request was cancelled.');
});
