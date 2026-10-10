import test from 'node:test';
import assert from 'node:assert/strict';
const build = process.env.FRONTEND_TEST_BUILD || '/tmp/cargocommit-frontend-test';
const discovery = await import(`${build}/orderDiscovery.js`);

test('newest-first block windows are bounded and cover the lower endpoint', () => {
  assert.deepEqual(discovery.previousOrderWindow(8500n, 1000n), [6501n, 8500n]);
  assert.deepEqual(discovery.previousOrderWindow(2500n, 1000n), [1000n, 2500n]);
  assert.equal(discovery.previousOrderWindow(999n, 1000n), undefined);
  assert.throws(() => discovery.previousOrderWindow(9n, 1n, 0n), /positive/);
});

test('a page reads newest blocks first and never skips a block', async () => {
  const ranges = [];
  const shown = [];
  const page = await discovery.scanOrderPage({
    cursor: 8000n, firstBlock: 1000n, chunkSize: 2000n, pageChunks: 4,
    read: async (start, end) => { ranges.push([start, end]); return [end]; },
    onWindow: (logs, from) => shown.push([from, logs]),
  });
  assert.deepEqual(ranges, [[6001n,8000n],[4001n,6000n],[2001n,4000n],[1000n,2000n]]);
  assert.equal(page.completed, true);
  assert.equal(page.cursor, 999n);
  assert.equal(shown.length, 4);
});

test('successful pages resume from exactly the next older block', async () => {
  const read = async () => [];
  const first = await discovery.scanOrderPage({cursor: 10000n, firstBlock: 1n, pageChunks: 2, read, onWindow: () => {}});
  const second = await discovery.scanOrderPage({cursor: first.cursor, firstBlock: 1n, pageChunks: 2, read, onWindow: () => {}});
  assert.equal(first.cursor, 6000n);
  assert.equal(first.completed, false);
  assert.equal(second.cursor, 2000n);
  assert.equal(second.completed, false);
});

test('temporary read errors retry without duplicating window commits', async () => {
  let calls = 0;
  const pauses = [];
  const seen = [];
  const result = await discovery.scanOrderPage({
    cursor: 10n, firstBlock: 1n, chunkSize: 10n,
    read: async () => { calls += 1; if (calls < 3) throw Object.assign(new Error('request rate limit'), { code: 429 }); return ['ok']; },
    onWindow: logs => seen.push(...logs),
    pause: async ms => { pauses.push(ms); },
  });
  assert.equal(result.completed, true);
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [350,700]);
  assert.deepEqual(seen, ['ok']);
});

test('fatal RPC errors stop a page without committing the failed window', async () => {
  let successful = 0;
  await assert.rejects(() => discovery.scanOrderPage({
    cursor: 9n, firstBlock: 1n, chunkSize: 3n,
    read: async (from) => { if (from === 4n) throw new Error('invalid filter'); return [from]; },
    onWindow: () => { successful++; },
  }), /invalid filter/);
  assert.equal(successful, 1);
});

test('only temporary failures retry; signing errors never use this read helper', async () => {
  assert.equal(discovery.isTemporaryRpcError({ cause: { message: 'Gateway timeout', status: 504 } }), true);
  assert.equal(discovery.isTemporaryRpcError(Object.assign(new Error('invalid parameters'), { code: -32602 })), false);
  let calls=0;
  await assert.rejects(() => discovery.retryOrderRead(async () => { calls++; throw new Error('Invalid arguments'); },async()=>{}), /Invalid arguments/);
  assert.equal(calls,1);
});

test('recent history search is bounded and older scans are opt-in', () => {
  assert.equal(discovery.recentOrderFloor(20000n, 1000n), 16001n);
  assert.equal(discovery.recentOrderFloor(3000n, 1000n), 1000n);
  assert.deepEqual(discovery.olderOrderWindow(16001n, 1000n), { cursor: 16000n, firstBlock: 12001n });
  assert.deepEqual(discovery.olderOrderWindow(1000n, 1000n), undefined);
  assert.throws(() => discovery.recentOrderFloor(10n, 1n, 0n), /positive/);
});

test('multiple older pages have no gaps or duplicate ranges', () => {
  const first = discovery.olderOrderWindow(16001n, 1000n);
  const second = discovery.olderOrderWindow(first.firstBlock, 1000n);
  assert.deepEqual(first, { cursor: 16000n, firstBlock: 12001n });
  assert.deepEqual(second, { cursor: 12000n, firstBlock: 8001n });
});
