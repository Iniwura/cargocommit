import test from 'node:test';
import assert from 'node:assert/strict';

const build = process.env.FRONTEND_TEST_BUILD ?? '/tmp/cargocommit-frontend-test';
const { productError, pendingReceiptMessage } = await import(`${build}/feedback.js`);
const model = await import(`${build}/model.js`);

test('user rejection distinguishes unsigned requests from submitted transactions', () => {
  const result = productError({ code: 4001, message: 'User rejected the request' });
  assert.equal(result.kind, 'wallet');
  assert.match(result.message, /No new transaction was sent/);
});
test('pending wallet request gives user actionable next step', () => {
  assert.match(productError({ code: -32002 }).guidance, /Open your wallet/);
});
test('wallet on wrong chain identifies Arc mainnet', () => {
  assert.match(productError({ message: 'Switch your wallet to Arc mainnet' }).message, /5042/);
});
test('insufficient native USDC gives gas advice', () => {
  assert.match(productError({ shortMessage: 'insufficient funds' }).guidance, /gas/);
});
test('RPC limit and timeout are not incorrectly described as contract reverts', () => {
  assert.equal(productError({ code: 429 }).kind, 'network');
  assert.equal(productError({ shortMessage: 'Request timed out' }).kind, 'network');
});
test('contract reverts provide status and deadline advice', () => {
  const result = productError({ shortMessage: 'The contract function reverted with InvalidStatus()' });
  assert.equal(result.kind, 'contract');
  assert.match(result.guidance, /deadlines/);
});
test('unexpected errors do not expose raw provider trace strings', () => {
  const result = productError({ message: 'private or unsafe RPC output: token SECRET-123' });
  assert.doesNotMatch(`${result.title} ${result.message} ${result.guidance}`, /SECRET-123/);
});
test('pending receipt message never invites an accidental duplicate broadcast', () => {
  assert.match(pendingReceiptMessage(), /already have succeeded|may already have succeeded/);
  assert.match(pendingReceiptMessage(), /before trying again/);
});
test('shared order route accepts verified block hint and legacy addresses', () => {
  const address = '0x1234567890123456789012345678901234567890';
  assert.equal(model.orderAddressFromHash(`#order/${address}/24570200`), address);
  assert.equal(model.orderBlockHintFromHash(`#order/${address}/24570200`), 24570200n);
  assert.equal(model.orderAddressFromHash(`#orders/${address}`), address);
  assert.equal(model.orderBlockHintFromHash(`#orders/${address}`), undefined);
  assert.equal(model.orderAddressFromHash('#order/not-an-address/42'), undefined);
});

test('factory provenance accepts only exact matching terms from the declared buyer', () => {
  const created = {
    buyer: '0xAa', supplier: '0xBb', arbiter: '0xCc', orderAmount: 1000n,
    depositBps: 30, fallbackSupplierBps: 50,
    fundingDeadline: 1n, shipmentDeadline: 2n, buyerDecisionDeadline: 3n, disputeDeadline: 4n,
    termsHash: '0xAB',
  };
  const snapshot = { ...created, termsHash: '0xab', accountingInvariant: true };
  assert.equal(model.factoryOriginMatches(created, '0xaa', snapshot), true);
  assert.equal(model.factoryOriginMatches(created, '0xff', snapshot), false, 'unsolicited buyer-origin order');
  assert.equal(model.factoryOriginMatches(created, '0xaa', { ...snapshot, supplier: '0xff' }), false);
  assert.equal(model.factoryOriginMatches(created, '0xaa', { ...snapshot, orderAmount: 999n }), false);
  assert.equal(model.factoryOriginMatches(created, '0xaa', { ...snapshot, termsHash: '0x00' }), false);
  assert.equal(model.factoryOriginMatches(created, '0xaa', { ...snapshot, accountingInvariant: false }), false);
});
