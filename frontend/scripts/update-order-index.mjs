#!/usr/bin/env node
/**
 * Rebuild Seldra's factory-event catalog incrementally from Arc mainnet.
 * The source of truth is the immutable factory OrderCreated event, not a user form.
 * Never move the persisted cursor past a failed RPC window.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RPC = process.env.ARC_RPC_URL || 'https://rpc.mainnet.arc.io';
const FACTORY = '0x934159c33c25d0b2e27b237b4ca603d85f019cf3';
const TOPIC0 = '0x4f40311efcfd04f35a93ef50b53a37dacb90b953f90097b3cd3ce145c615af47';
const CHAIN_ID = 5042;
const ACTIVITY_EVENTS = new Map([
  ['0xb66bb22bb04f8b826bc5859deea08bfd46449fac0d223aeb8315162d6724ca85', { key: 'supplier-accepted', label: 'SUPPLIER ACCEPTED' }],
  ['0x61b9399f2f0f32ca39ce8d7be32caed5ec22fe07a6daba3a467ed479ec606582', { key: 'order-cancelled', label: 'ORDER CANCELLED' }],
  ['0x77360216dafe21aa8d455333608207082f74e837ba9b3ef15d0a73cd22693738', { key: 'funded', label: 'FUNDED' }],
  ['0x5b035be76c6224ae570d8d05097177ed728aab6364d39f1ec803b4126fd25fce', { key: 'deposit-released', label: 'PRODUCTION DEPOSIT RELEASED' }],
  ['0xd18251b9b6197210938833082964f0ebac7c8c9d8eb934c4675f59079476a2b2', { key: 'excess-returned', label: 'EXCESS RETURNED' }],
  ['0xf112abfac090f614d21080671472c50799bf286c3efcf0901fb290939b3487f9', { key: 'shipment-submitted', label: 'SHIPMENT EVIDENCE SUBMITTED' }],
  ['0xbad66769c2139f3f8a64794a4308e97ef948a8e6cd0553d93d4b530672c88b71', { key: 'dispute-opened', label: 'DISPUTE OPENED' }],
  ['0x393d493903553a76a3231bdf6f2e1a509c7625938c4662f2b589b64736c1fe97', { key: 'settled', label: 'SETTLED' }],
]);
const DEPLOYED = 24570195;
const CHUNK = 5000;
// Publish a new read-only catalog cursor before the browser's 4,000-block
// delta-read safety limit is likely to be exceeded.
const MIN_INDEX_PROGRESS = 3000;
const INDEX = fileURLToPath(new URL('../public/seldra-order-index.json', import.meta.url));
const MAX_RETRIES = 8;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function hexNumber(value) {
  if (typeof value !== 'string' || !/^0x[\da-f]+$/i.test(value)) throw new Error('Expected hexadecimal RPC number');
  const number = Number(BigInt(value));
  if (!Number.isSafeInteger(number)) throw new Error('Block number is not a safe integer');
  return number;
}
function lowerAddress(value) {
  if (typeof value !== 'string' || !/^0x[\da-f]{40}$/i.test(value)) throw new Error('Invalid event address');
  return value.toLowerCase();
}
function decodeActivityLog(log, knownAddresses) {
  const order = lowerAddress(log.address);
  if (!knownAddresses.has(order)) throw new Error('Unexpected lifecycle event address');
  const definition = ACTIVITY_EVENTS.get(log?.topics?.[0]?.toLowerCase());
  if (!definition) return undefined;
  const blockNumber = hexNumber(log.blockNumber);
  const logIndex = hexNumber(log.logIndex);
  const transactionHash = String(log.transactionHash).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(transactionHash)) throw new Error('Malformed lifecycle transaction hash');
  return {
    order,
    key: definition.key + '-' + transactionHash + '-' + logIndex,
    label: definition.label,
    blockNumber,
    logIndex,
    blockTimestamp: log.blockTimestamp === undefined ? undefined : hexNumber(log.blockTimestamp),
    transactionHash,
  };
}

function decodeFactoryLog(log) {
  if (!log || lowerAddress(log.address) !== FACTORY) throw new Error('Unexpected factory address in RPC logs');
  if (!Array.isArray(log.topics) || log.topics.length !== 4 || log.topics[0]?.toLowerCase() !== TOPIC0) throw new Error('Unexpected factory event');
  if (!/^0x[\da-f]{576}$/i.test(log.data)) throw new Error('Invalid OrderCreated event data length');
  const words = log.data.slice(2).match(/.{64}/g);
  if (!words || words.length !== 9) throw new Error('OrderCreated event data is malformed');
  const topicAddress = (word) => lowerAddress('0x' + word.slice(-40));
  const wordAddress = (word) => lowerAddress('0x' + word.slice(-40));
  const number = (word) => BigInt('0x' + word);
  const blockNumber = hexNumber(log.blockNumber);
  const transactionHash = String(log.transactionHash).toLowerCase();
  if (!/^0x[\da-f]{64}$/.test(transactionHash)) throw new Error('Invalid event transaction hash');
  const order = {
    order: topicAddress(log.topics[1]),
    buyer: topicAddress(log.topics[2]),
    supplier: topicAddress(log.topics[3]),
    arbiter: wordAddress(words[0]),
    orderAmount: number(words[1]).toString(),
    depositBps: Number(number(words[2])) / 100,
    fallbackSupplierBps: Number(number(words[3])) / 100,
    fundingDeadline: number(words[4]).toString(),
    shipmentDeadline: number(words[5]).toString(),
    buyerDecisionDeadline: number(words[6]).toString(),
    disputeDeadline: number(words[7]).toString(),
    termsHash: '0x' + words[8].toLowerCase(),
    transactionHash,
    blockNumber,
  };
  if (order.depositBps <= 0 || order.depositBps >= 100 || order.fallbackSupplierBps < 0 || order.fallbackSupplierBps > 100) throw new Error('Invalid split in factory event');
  return order;
}

async function rpc(method, params) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(RPC, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(16000),
      });
      let body;
      try { body = await response.json(); } catch { throw new Error('Invalid RPC JSON response'); }
      if (response.ok && body?.error === undefined && body?.result !== undefined) return body.result;
      const message = String(body?.error?.message ?? 'RPC HTTP ' + response.status);
      const transient = response.status === 429 || [429, -32005, -32000, 502, 503, 504].includes(Number(body?.error?.code)) || /rate.limit|too many|timeout|temporarily|gateway/i.test(message);
      if (!transient || attempt === MAX_RETRIES) throw new Error(method + ': ' + message);
    } catch (error) {
      if (attempt === MAX_RETRIES || (!/fetch failed|timeout|aborted|rate.limit|too many|temporarily|gateway/i.test(String(error)) && !(error instanceof TypeError))) throw error;
    }
    await wait(Math.min(16000, 900 * 2 ** attempt));
  }
  throw new Error('RPC retry budget exhausted');
}

async function main() {
  const chain = hexNumber(await rpc('eth_chainId', []));
  if (chain !== CHAIN_ID) throw new Error('Refusing to index incorrect Arc chain ' + chain);
  const tip = hexNumber(await rpc('eth_blockNumber', []));
  let previous;
  try { previous = JSON.parse(await readFile(INDEX, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const valid = previous?.version === 1 && previous?.chainId === CHAIN_ID && previous?.factory?.toLowerCase() === FACTORY &&
    Number.isSafeInteger(previous.indexedThrough) && previous.indexedThrough >= DEPLOYED - 1 && Array.isArray(previous.orders);
  if (previous && !valid) throw new Error('Existing order catalog is invalid; refusing to discard history');
  let indexedThrough = valid ? previous.indexedThrough : DEPLOYED - 1;
  if (indexedThrough > tip) throw new Error('Current Arc tip is below the catalog cursor');
  const seen = new Map();
  for (const item of valid ? previous.orders : []) {
    if (typeof item?.order !== 'string') throw new Error('Catalog has malformed order');
    seen.set(lowerAddress(item.order), item);
  }
  let additions = 0;
  for (let from = indexedThrough + 1; from <= tip; from += CHUNK) {
    const to = Math.min(tip, from + CHUNK - 1);
    const logs = await rpc('eth_getLogs', [{
      address: FACTORY, topics: [TOPIC0],
      fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16),
    }]);
    if (!Array.isArray(logs)) throw new Error('RPC logs response was not an array');
    for (const log of logs) {
      const item = decodeFactoryLog(log);
      if (item.blockNumber < from || item.blockNumber > to) throw new Error('RPC log outside requested window');
      const prev = seen.get(item.order);
      if (prev && prev.transactionHash !== item.transactionHash) throw new Error('Conflicting factory order events');
      if (!prev) additions++;
      seen.set(item.order, item);
    }
    indexedThrough = to;
    if ((to - DEPLOYED + 1) % 50000 < CHUNK || to === tip) console.log('Indexed', to, '/', tip, 'orders', seen.size);
    await wait(300);
  }
  const orders = [...seen.values()].sort((a,b)=>b.blockNumber-a.blockNumber || a.order.localeCompare(b.order));
  const activity = {};
  const previousActivity = valid && previous.activity && typeof previous.activity === 'object' ? previous.activity : {};
  const addresses = orders.map(item => item.order);
  const knownAddresses = new Set(addresses);
  for (const address of addresses) {
    const prior = previousActivity[address] ?? [];
    if (!Array.isArray(prior)) throw new Error('Invalid stored order activity');
    activity[address] = prior.slice();
  }
  let activityIndexedThrough = valid && Number.isSafeInteger(previous.activityIndexedThrough)
    ? previous.activityIndexedThrough : DEPLOYED - 1;
  if (activityIndexedThrough < DEPLOYED - 1 || activityIndexedThrough > indexedThrough)
    throw new Error('Invalid stored activity cursor');
  let newActivity = 0;
  if (addresses.length) {
    for (let from = activityIndexedThrough + 1; from <= tip; from += CHUNK) {
      const to = Math.min(tip, from + CHUNK - 1);
      const logs = await rpc('eth_getLogs', [{
        address: addresses,
        fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16),
      }]);
      if (!Array.isArray(logs)) throw new Error('Invalid lifecycle logs response');
      for (const log of logs) {
        const item = decodeActivityLog(log, knownAddresses);
        if (!item) continue;
        if (item.blockNumber < from || item.blockNumber > to) throw new Error('Lifecycle log outside scan range');
        const list = activity[item.order];
        if (!list.some(existing => existing.key === item.key)) { list.push(item); newActivity++; }
      }
      activityIndexedThrough = to;
      if ((to - DEPLOYED + 1) % 50000 < CHUNK || to === tip)
        console.log('Indexed activity through', to, '/', tip, 'events', Object.values(activity).reduce((n,a)=>n+a.length,0));
      await wait(300);
    }
  } else {
    activityIndexedThrough = tip;
  }
  for (const list of Object.values(activity)) list.sort((a,b)=>a.blockNumber-b.blockNumber || a.logIndex-b.logIndex);
  if (valid && !additions && !newActivity && indexedThrough - previous.indexedThrough < MIN_INDEX_PROGRESS &&
    activityIndexedThrough - (previous.activityIndexedThrough ?? DEPLOYED - 1) < MIN_INDEX_PROGRESS) {
    console.log('No new factory or lifecycle events; preserving deployed index, tip', tip);
    return;
  }
  const index = { version: 1, chainId: CHAIN_ID, factory: FACTORY, indexedThrough, activityIndexedThrough, activity, complete: true, generatedAt: new Date().toISOString(), orders };
  await mkdir(dirname(INDEX), { recursive: true });
  await writeFile(INDEX, JSON.stringify(index, null, 2) + '\n');
  console.log('Wrote indexed catalog through', indexedThrough, 'orders', orders.length, 'new', additions, 'activity events', Object.values(activity).reduce((n,a)=>n+a.length,0), 'new events', newActivity);
  const knownBuyer = '0xd0dd02322af812fc0dbddc69f9a055fbbe2c6673';
  if (indexedThrough >= 24754291 && !orders.some(o=>o.order==='0x7be2440da225495735957b4b206a4ab4998372fa' && o.buyer===knownBuyer))
    throw new Error('Regression: known browser-created wallet order was not indexed');
}
main().catch(error=>{ console.error(error); process.exitCode = 1; });
