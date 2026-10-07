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
