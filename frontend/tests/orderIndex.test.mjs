import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const build = process.env.FRONTEND_TEST_BUILD || '/tmp/cargocommit-frontend-test';
const { parseWalletOrderIndex, fetchIndexedOrderActivity } = await import(build + '/orderIndex.js');
const catalog = JSON.parse(readFileSync(new URL('../public/seldra-order-index.json', import.meta.url), 'utf8'));
const factory = '0x934159C33C25D0b2e27B237b4cA603D85F019Cf3';
const deployment = 24570195n;

test('known browser-wallet order is discovered from complete factory history', () => {
  const result = parseWalletOrderIndex(catalog, '0xd0dd02322AF812fC0dbDdC69f9a055FBBe2C6673', factory, deployment);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].order.toLowerCase(), '0x7be2440da225495735957b4b206a4ab4998372fa');
  assert.equal(result.orders[0].blockNumber, 24754291n);
  assert.equal(result.orders[0].depositBps, 30);
});

test('buyer, supplier and arbiters each see their corresponding orders', () => {
  const buyer = parseWalletOrderIndex(catalog, '0x5c526d2c665147fab7849353dc65970879379bb2', factory, deployment);
  const supplier = parseWalletOrderIndex(catalog, '0x62050fc83a8d0039c089cecf9340cfe92f87b76c', factory, deployment);
  const arbiter = parseWalletOrderIndex(catalog, '0x4b953a840f79d9b487a748b0fd168010c89fc2ae', factory, deployment);
  assert.equal(buyer.orders.length, 2);
  assert.equal(supplier.orders.length, 3);
  assert.equal(arbiter.orders.length, 2);
  assert.ok(buyer.orders[0].blockNumber > buyer.orders[1].blockNumber);
  assert.equal(parseWalletOrderIndex(catalog, '0x0000000000000000000000000000000000000001', factory, deployment).orders.length, 0);
});

test('unavailable, incomplete or incorrect catalogs never become false no-order results', () => {
  const wallet = '0xd0dd02322af812fc0dbddc69f9a055fbbe2c6673';
  assert.throws(() => parseWalletOrderIndex(null, wallet, factory, deployment), /unavailable/);
  assert.throws(() => parseWalletOrderIndex({ ...catalog, complete: false }, wallet, factory, deployment), /incomplete/);
  assert.throws(() => parseWalletOrderIndex({ ...catalog, chainId: 1 }, wallet, factory, deployment), /different network/);
  assert.throws(() => parseWalletOrderIndex({ ...catalog, orders: [...catalog.orders, catalog.orders[0]] }, wallet, factory, deployment), /Duplicate/);
  assert.throws(() => parseWalletOrderIndex({ ...catalog, orders: [{ ...catalog.orders[0], blockNumber: catalog.indexedThrough + 1 }] }, wallet, factory, deployment), /Invalid/);
});

test('complete activity archive includes real settlement and dispute receipts', async () => {
  assert.equal(typeof fetchIndexedOrderActivity, 'function');
  assert.ok(Number.isSafeInteger(catalog.activityIndexedThrough));
  assert.ok(catalog.activityIndexedThrough >= catalog.indexedThrough);
  const regular = catalog.activity['0x60958fd86d2d52670181afb4097d1b280a37848c'];
  const dispute = catalog.activity['0x6ff65de6016d9e1083b2f7d7e3abaff1ab2c9201'];
  const unfunded = catalog.activity['0x7be2440da225495735957b4b206a4ab4998372fa'];
  assert.ok(regular?.some(item => item.label === 'SETTLED'));
  assert.ok(dispute?.some(item => item.label === 'DISPUTE OPENED'));
  assert.ok(dispute?.some(item => item.label === 'SETTLED'));
  assert.deepEqual(unfunded, []);
});
