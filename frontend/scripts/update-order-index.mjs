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
const DEPLOYED = 24570195;
const CHUNK = 5000;
const MIN_INDEX_PROGRESS = 40000;
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
  if (valid && !additions && indexedThrough - previous.indexedThrough < MIN_INDEX_PROGRESS) {
    console.log('No new orders; preserving current deployed index, tip', tip);
    return;
  }
  const orders = [...seen.values()].sort((a,b)=>b.blockNumber-a.blockNumber || a.order.localeCompare(b.order));
  const index = { version: 1, chainId: CHAIN_ID, factory: FACTORY, indexedThrough, complete: true, generatedAt: new Date().toISOString(), orders };
  await mkdir(dirname(INDEX), { recursive: true });
  await writeFile(INDEX, JSON.stringify(index, null, 2) + '\n');
  console.log('Wrote indexed catalog through', indexedThrough, 'orders', orders.length, 'new', additions);
  const knownBuyer = '0xd0dd02322af812fc0dbddc69f9a055fbbe2c6673';
  if (indexedThrough >= 24754291 && !orders.some(o=>o.order==='0x7be2440da225495735957b4b206a4ab4998372fa' && o.buyer===knownBuyer))
    throw new Error('Regression: known browser-created wallet order was not indexed');
}
main().catch(error=>{ console.error(error); process.exitCode = 1; });
