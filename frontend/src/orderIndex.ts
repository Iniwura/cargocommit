import type { Address, Hash } from 'viem';
import type { OrderCreatedLog } from './contracts.js';

/** Fast wallet discovery from an index of official Arc factory events.
 * This is discovery only; wallet actions still verify provenance onchain.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
type CatalogOrder = {
  order: string; buyer: string; supplier: string; arbiter: string;
  orderAmount: string; depositBps: number; fallbackSupplierBps: number;
  fundingDeadline: string; shipmentDeadline: string; buyerDecisionDeadline: string;
  disputeDeadline: string; termsHash: string; blockNumber: number; transactionHash: string;
};
type Catalog = {
  version: number; chainId: number; factory: string; indexedThrough: number;
  complete: boolean; generatedAt: string; orders: CatalogOrder[];
};
function toBigint(value: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Malformed indexed order number');
  return BigInt(value);
}
function toAddress(value: string): Address {
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw new Error('Malformed indexed order address');
  return value as Address;
}
function toHash(value: string): Hash {
  if (typeof value !== 'string' || !HASH.test(value)) throw new Error('Malformed indexed order hash');
  return value as Hash;
}

/** Reject incomplete/corrupt catalogs rather than claiming there are no orders. */
export function parseWalletOrderIndex(raw: unknown, wallet: string, factory: string, deploymentBlock: bigint): {
  orders: OrderCreatedLog[]; indexedThrough: bigint;
} {
  if (!ADDRESS.test(wallet)) throw new Error('Invalid connected wallet');
  if (!raw || typeof raw !== 'object') throw new Error('Order index is unavailable');
  const catalog = raw as Catalog;
  if (catalog.version !== 1 || catalog.chainId !== 5042 ||
    typeof catalog.factory !== 'string' || catalog.factory.toLowerCase() !== factory.toLowerCase() ||
    catalog.complete !== true || !Number.isSafeInteger(catalog.indexedThrough) ||
    BigInt(catalog.indexedThrough) < deploymentBlock - 1n || !Array.isArray(catalog.orders)) {
    throw new Error('Order index is incomplete or for a different network');
  }
  const seen = new Set<string>();
  const matched: OrderCreatedLog[] = [];
  for (const item of catalog.orders) {
    if (!item || typeof item !== 'object') throw new Error('Malformed indexed order');
    const order = toAddress(item.order);
    const buyer = toAddress(item.buyer);
    const supplier = toAddress(item.supplier);
    const arbiter = toAddress(item.arbiter);
    if (!Number.isSafeInteger(item.blockNumber) ||
      BigInt(item.blockNumber) < deploymentBlock || item.blockNumber > catalog.indexedThrough ||
      !Number.isInteger(item.depositBps) || item.depositBps <= 0 || item.depositBps >= 100 ||
      !Number.isInteger(item.fallbackSupplierBps) || item.fallbackSupplierBps < 0 || item.fallbackSupplierBps > 100) {
      throw new Error('Invalid indexed order values');
    }
    const id = order.toLowerCase();
    if (seen.has(id)) throw new Error('Duplicate indexed order');
    seen.add(id);
    const parsed: OrderCreatedLog = {
      order, buyer, supplier, arbiter,
      orderAmount: toBigint(item.orderAmount),
      depositBps: item.depositBps,
      fallbackSupplierBps: item.fallbackSupplierBps,
      fundingDeadline: toBigint(item.fundingDeadline),
      shipmentDeadline: toBigint(item.shipmentDeadline),
      buyerDecisionDeadline: toBigint(item.buyerDecisionDeadline),
      disputeDeadline: toBigint(item.disputeDeadline),
      termsHash: toHash(item.termsHash),
      transactionHash: toHash(item.transactionHash),
      blockNumber: BigInt(item.blockNumber),
    };
    if ([buyer, supplier, arbiter].some(a => a.toLowerCase() === wallet.toLowerCase())) matched.push(parsed);
  }
  matched.sort((a, b) => Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n)));
  return { orders: matched, indexedThrough: BigInt(catalog.indexedThrough) };
}

export async function fetchWalletOrderIndex(wallet: string, factory: string, deploymentBlock: bigint): Promise<{
  orders: OrderCreatedLog[]; indexedThrough: bigint;
}> {
  const response = await fetch('/seldra-order-index.json', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Published order index unavailable (HTTP ' + response.status + ')');
  const raw: unknown = await response.json();
  return parseWalletOrderIndex(raw, wallet, factory, deploymentBlock);
}
