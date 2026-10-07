import test from 'node:test';
import assert from 'node:assert/strict';

const build = process.env.FRONTEND_TEST_BUILD ?? '/tmp/cargocommit-frontend-test';
const model = await import(`${build}/model.js`);
const logRanges = await import(`${build}/logRanges.js`);

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

test('converts whole UI percentages to contract BPS in both directions', () => {
  for (const [percent, bps] of [[20, 2000n], [30, 3000n], [50, 5000n], [80, 8000n]]) {
    assert.equal(model.percentToBps(percent), bps);
    assert.equal(model.bpsToPercent(bps), percent);
  }
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
    assert.equal(split.contractDepositBps, BigInt(depositBps) * 100n);
    assert.equal(split.contractReserveBps, BigInt(reserveBps) * 100n);
    assert.equal(split.depositAmount, depositWhole * 1_000_000_000_000_000_000n);
    assert.equal(split.reserveAmount, reserveWhole * 1_000_000_000_000_000_000n);
  }

  const changedAmount = model.settlementSplit(12_500n * 1_000_000_000_000_000_000n, 30);
  assert.equal(changedAmount.depositAmount, 3_750n * 1_000_000_000_000_000_000n);
  assert.equal(changedAmount.reserveAmount, 8_750n * 1_000_000_000_000_000_000n);
});

test('builds the exact contract-domain smoke-test createOrder call', () => {
  const connectedBuyer = '0x0000000000000000000000000000000000000001';
  const supplier = '0x62050Fc83a8d0039c089cECf9340CfE92F87B76C';
  const arbiter = '0x4b953a840F79d9b487a748b0Fd168010c89fc2Ae';
  const deadlineInputs = [
    '2026-10-08T12:00',
    '2026-10-09T12:00',
    '2026-10-10T12:00',
    '2026-10-11T12:00',
  ];
  const deadlines = deadlineInputs.map(model.parseDeadlineSeconds);
  const call = model.buildCreateOrderCall({
    buyer: connectedBuyer,
    supplier,
    arbiter,
    amount: 10_000_000_000_000_000n,
    depositPercent: 30,
    fallbackPercent: 50,
    deadlines,
  });

  assert.equal(call.args[0], connectedBuyer);
  assert.notEqual(call.args[0], '0x5c526D2c665147Fab7849353DC65970879379Bb2');
  assert.equal(call.args[1], supplier);
  assert.equal(call.args[2], arbiter);
  assert.equal(call.args[3], 10_000_000_000_000_000n);
  assert.equal(call.args[4], 3000n);
  assert.equal(call.args[5], 5000n);
  assert.equal(call.args[6], deadlines[0]);
  assert.equal(call.args[7], deadlines[1]);
  assert.equal(call.args[8], deadlines[2]);
  assert.equal(call.args[9], deadlines[3]);
  assert.equal(call.value, 0n);
});

test('keeps OrderCreated discovery inside bounded block ranges', () => {
  assert.deepEqual(logRanges.orderCreatedBlockRanges(24_570_195n, 24_574_194n, 2_000n), [
    [24_570_195n, 24_572_194n],
    [24_572_195n, 24_574_194n],
  ]);
  assert.deepEqual(logRanges.orderCreatedBlockRanges(24_570_195n, 24_570_195n, 2_000n), [[24_570_195n, 24_570_195n]]);
  assert.deepEqual(logRanges.orderCreatedBlockRanges(24_574_195n, 24_570_195n, 2_000n), []);
  assert.throws(() => logRanges.orderCreatedBlockRanges(1n, 2n, 0n), /positive/);
});

test('builds a complete pre-signature create-order review model', () => {
  const review = model.buildCreateOrderReview({
    buyer: '0x0000000000000000000000000000000000000001',
    supplier: '0x62050Fc83a8d0039c089cECf9340CfE92F87B76C',
    arbiter: '0x4b953a840F79d9b487a748b0Fd168010c89fc2Ae',
    amount: 10_000_000_000_000_000n,
    depositPercent: 30,
    fallbackPercent: 50,
    deadlines: [1791457200n, 1791543600n, 1791630000n, 1791716400n],
  });

  assert.equal(review.buyer, '0x0000000000000000000000000000000000000001');
  assert.equal(review.supplier, '0x62050Fc83a8d0039c089cECf9340CfE92F87B76C');
  assert.equal(review.arbiter, '0x4b953a840F79d9b487a748b0Fd168010c89fc2Ae');
  assert.equal(review.amount, 10_000_000_000_000_000n);
  assert.equal(review.depositPercent, 30);
  assert.equal(review.fallbackPercent, 50);
  assert.deepEqual(review.deadlines, [1791457200n, 1791543600n, 1791630000n, 1791716400n]);
});

test('blocks a changed signer and preserves the reviewed draft', () => {
  const buyerA = '0x0000000000000000000000000000000000000001';
  const buyerB = '0x0000000000000000000000000000000000000002';
  const draft = { amount: '0.01', supplier: '0x62050Fc83a8d0039c089cECf9340CfE92F87B76C', depositPercent: '30' };
  const before = { ...draft };
  const sameSigner = model.checkReviewedBuyer(buyerA, buyerA);
  const changedSigner = model.checkReviewedBuyer(buyerA, buyerB);

  assert.equal(sameSigner.ok, true);
  assert.equal(changedSigner.ok, false);
  assert.equal(changedSigner.reason, 'changed');
  assert.equal(changedSigner.activeBuyer, buyerB);
  assert.deepEqual(draft, before);
});

test('binds the selected provider identity to the signer and calldata buyer', () => {
  const selectedProvider = {};
  const otherProvider = {};
  const buyer = '0x0000000000000000000000000000000000000001';
  const reviewedSigner = model.checkReviewedBuyer(buyer, buyer);
  assert.equal(model.walletProviderMatches(selectedProvider, selectedProvider), true);
  assert.equal(model.walletProviderMatches(selectedProvider, otherProvider), false);
  assert.equal(reviewedSigner.ok, true);
  const call = model.buildCreateOrderCall({
    buyer: reviewedSigner.activeBuyer,
    supplier: '0x0000000000000000000000000000000000000002',
    arbiter: '0x0000000000000000000000000000000000000003',
    amount: 10_000_000_000_000_000n,
    depositPercent: 30,
    fallbackPercent: 50,
    deadlines: [1100n, 1200n, 1300n, 1400n],
  });
  assert.equal(call.args[0], buyer);
});

test('encodes native USDC in 18 decimals and preserves one-day local deadline spacing', () => {
  assert.equal(model.parseNativeUsdc('0.01'), 10_000_000_000_000_000n);
  const inputs = ['2026-10-08T12:00', '2026-10-09T12:00', '2026-10-10T12:00', '2026-10-11T12:00'];
  const deadlines = inputs.map(model.parseDeadlineSeconds);
  assert.deepEqual(deadlines, inputs.map((value) => BigInt(new Date(value).getTime() / 1000)));
  assert.equal(deadlines[1] - deadlines[0], 86_400n);
  assert.equal(deadlines[2] - deadlines[1], 86_400n);
  assert.equal(deadlines[3] - deadlines[2], 86_400n);
  assert.ok(deadlines[0] < deadlines[1] && deadlines[1] < deadlines[2] && deadlines[2] < deadlines[3]);
});

const validDraft = {
  account: '0x0000000000000000000000000000000000000001',
  supplier: '0x0000000000000000000000000000000000000002',
  arbiter: '0x0000000000000000000000000000000000000003',
  total: 10_000n * 1_000_000_000_000_000_000n,
  depositPercent: '30',
  fallbackPercent: '50',
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
