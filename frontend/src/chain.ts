import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  http,
  parseAbiItem,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { FACTORY_ADDRESS, factoryAbi, orderAbi, type OrderCreatedLog } from './contracts';
import { orderCreatedBlockRanges } from './logRanges';
import { bpsToPercent, factoryOriginMatches } from './model';

export { ORDER_LOG_CHUNK_SIZE, orderCreatedBlockRanges } from './logRanges';

export const ARC_RPC = 'https://rpc.mainnet.arc.io';
export const ARC_EXPLORER = 'https://explorer.arc.io';
export const ARC_CHAIN_ID = 5042;
export const ARC_DEPLOYMENT_BLOCK = 24_570_195n;

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

export type ConnectedArcWallet = {
  account: Address;
  walletClient: WalletClient;
  chainId: number;
  provider: Eip1193Provider;
};

export const arcMainnet = {
  id: ARC_CHAIN_ID,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: ARC_EXPLORER } },
} as const satisfies Chain;

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

function arcReadProvider(provider: Eip1193Provider): Eip1193Provider {
  return {
    request: async (args) => {
      if (args.method !== 'eth_chainId') {
        const chainId = Number.parseInt(String(await provider.request({ method: 'eth_chainId' })), 16);
        if (chainId !== ARC_CHAIN_ID) throw new Error('Injected wallet is not connected to Arc mainnet.');
      }
      return provider.request(args);
    },
  };
}

const injectedProvider = typeof window !== 'undefined' ? window.ethereum : undefined;
const directReadTransport = http(ARC_RPC, { timeout: 15_000, retryCount: 2 });
const readTransport = injectedProvider
  ? fallback([directReadTransport, custom(arcReadProvider(injectedProvider))], { retryCount: 2 })
  : directReadTransport;

export const publicClient = createPublicClient({ chain: arcMainnet, transport: readTransport });
// Background factory discovery must not hang on wallet-provider fallback.
export const orderScanClient = createPublicClient({
  chain: arcMainnet,
  transport: http(ARC_RPC, { timeout: 7_000, retryCount: 0 }),
});

export function explorerTx(hash: string): string {
  return `${ARC_EXPLORER}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${ARC_EXPLORER}/address/${address}`;
}

function connectedWallet(provider: Eip1193Provider, account: Address, chainId: number): ConnectedArcWallet {
  return { account, walletClient: createWalletClient({ account, chain: arcMainnet, transport: custom(provider) }), chainId, provider };
}

export async function connectArcWallet(provider: Eip1193Provider = window.ethereum as Eip1193Provider): Promise<ConnectedArcWallet> {
  if (!provider) throw new Error('Install an EVM wallet to continue.');
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts[0]) throw new Error('No wallet account was returned.');
  const targetHex = `0x${ARC_CHAIN_ID.toString(16)}`;
  let chainId = Number.parseInt(String(await provider.request({ method: 'eth_chainId' })), 16);
  if (chainId !== ARC_CHAIN_ID) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetHex }] });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 4902) throw new Error('Switch your wallet to Arc mainnet to continue.');
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: targetHex,
          chainName: 'Arc',
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
          rpcUrls: [ARC_RPC],
          blockExplorerUrls: [ARC_EXPLORER],
        }],
      });
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetHex }] });
    }
    chainId = Number.parseInt(String(await provider.request({ method: 'eth_chainId' })), 16);
  }
  if (chainId !== ARC_CHAIN_ID) throw new Error('Wallet is not connected to Arc mainnet.');
  const account = accounts[0] as Address;
  return connectedWallet(provider, account, chainId);
}

export async function syncArcWallet(provider: Eip1193Provider): Promise<ConnectedArcWallet | undefined> {
  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
  if (!accounts[0]) return undefined;
  const chainId = Number.parseInt(String(await provider.request({ method: 'eth_chainId' })), 16);
  if (chainId !== ARC_CHAIN_ID) throw new Error('Switch your wallet to Arc mainnet to continue.');
  return connectedWallet(provider, accounts[0] as Address, chainId);
}

export type OrderCreatedLogQuery = {
  fromBlock?: bigint;
  toBlock?: bigint;
};

export async function fetchOrderCreatedLogs(client: PublicClient = publicClient, query: OrderCreatedLogQuery = {}): Promise<OrderCreatedLog[]> {
  const event = parseAbiItem('event OrderCreated(address indexed order,address indexed buyer,address indexed supplier,address arbiter,uint256 orderAmount,uint16 depositBps,uint16 fallbackSupplierBps,uint256 fundingDeadline,uint256 shipmentDeadline,uint256 buyerDecisionDeadline,uint256 disputeDeadline,bytes32 termsHash)');
  const latest = query.toBlock ?? await client.getBlockNumber();
  const fromBlock = query.fromBlock ?? ARC_DEPLOYMENT_BLOCK;
  type OrderCreatedEventLog = {
    args: {
      order: Address;
      buyer: Address;
      supplier: Address;
      arbiter: Address;
      orderAmount: bigint;
      depositBps: bigint;
      fallbackSupplierBps: bigint;
      fundingDeadline: bigint;
      shipmentDeadline: bigint;
      buyerDecisionDeadline: bigint;
      disputeDeadline: bigint;
      termsHash: `0x${string}`;
    };
    blockNumber: bigint | null;
    transactionHash: `0x${string}` | null;
  };
  const logs: OrderCreatedEventLog[] = [];
  for (const [rangeStart, rangeEnd] of orderCreatedBlockRanges(fromBlock, latest)) {
    const chunkLogs = await client.getLogs({ address: FACTORY_ADDRESS, event, fromBlock: rangeStart, toBlock: rangeEnd } as never) as unknown as OrderCreatedEventLog[];
    logs.push(...chunkLogs);
  }
  return logs.map((log) => ({
    ...log.args,
    depositBps: bpsToPercent(log.args.depositBps),
    fallbackSupplierBps: bpsToPercent(log.args.fallbackSupplierBps),
    blockNumber: log.blockNumber ?? undefined,
    transactionHash: log.transactionHash ?? undefined,
  }));
}

export type OrderActivityItem = {
  key: string;
  label: string;
  blockNumber?: bigint;
  blockTimestamp?: bigint;
  transactionHash?: Hash;
  detail?: string;
};

const activityDefinitions = [
  { key: 'supplier-accepted', label: 'SUPPLIER ACCEPTED', event: parseAbiItem('event SupplierAccepted(uint256 indexed acceptedAt)') },
  { key: 'order-cancelled', label: 'ORDER CANCELLED', event: parseAbiItem('event OrderCancelled(uint256 indexed cancelledAt)') },
  { key: 'funded', label: 'FUNDED', event: parseAbiItem('event Funded(uint256 amount,uint256 deposit,uint256 reserve)') },
  { key: 'deposit-released', label: 'PRODUCTION DEPOSIT RELEASED', event: parseAbiItem('event DepositReleased(address indexed supplier,uint256 amount)') },
  { key: 'excess-returned', label: 'EXCESS RETURNED', event: parseAbiItem('event ExcessReturned(address indexed recipient,uint256 amount)') },
  { key: 'shipment-submitted', label: 'SHIPMENT EVIDENCE SUBMITTED', event: parseAbiItem('event ShipmentSubmitted(bytes32 indexed evidenceHash,uint256 indexed submittedAt)') },
  { key: 'dispute-opened', label: 'DISPUTE OPENED', event: parseAbiItem('event DisputeOpened(bytes32 indexed reasonHash,uint256 indexed openedAt)') },
  { key: 'settled', label: 'SETTLED', event: parseAbiItem('event Settled(uint8 indexed outcome,uint256 supplierAmount,uint256 buyerAmount,uint256 indexed settledAt)') },
] as const;

type ActivityLog = {
  args?: Record<string, unknown>;
  eventName?: string;
  blockNumber?: bigint | null;
  transactionHash?: Hash | null;
  logIndex?: number | null;
};

export async function fetchOrderActivity(client: PublicClient, address: Address, query: OrderCreatedLogQuery = {}): Promise<OrderActivityItem[]> {
  const latest = query.toBlock ?? await client.getBlockNumber();
  const fromBlock = query.fromBlock ?? ARC_DEPLOYMENT_BLOCK;
  if (fromBlock > latest) return [];
  const rows: Array<OrderActivityItem & { logIndex: number }> = [];
  // A single multi-event filter uses one bounded RPC request per chunk rather
  // than eight separate requests. viem decodes eventName for each matching log.
  const definitionsByName = new Map<string, (typeof activityDefinitions)[number]>(
    activityDefinitions.map((definition) => [definition.event.name, definition]),
  );
  for (const [rangeStart, rangeEnd] of orderCreatedBlockRanges(fromBlock, latest)) {
    const logs = await client.getLogs({
      address,
      events: activityDefinitions.map((definition) => definition.event),
      fromBlock: rangeStart,
      toBlock: rangeEnd,
    } as never) as unknown as ActivityLog[];
    for (const log of logs) {
      const definition = definitionsByName.get(log.eventName ?? '');
      if (!definition) continue;
      rows.push({
        key: `${definition.key}-${log.transactionHash ?? 'unknown'}-${log.logIndex ?? 0}`,
        label: definition.label,
        blockNumber: log.blockNumber ?? undefined,
        transactionHash: log.transactionHash ?? undefined,
        detail: definition.key === 'settled' ? `OUTCOME ${String(log.args?.outcome ?? '—')}` : undefined,
        logIndex: log.logIndex ?? 0,
      });
    }
  }
  const blockNumbers = [...new Set(rows.flatMap((row) => row.blockNumber === undefined ? [] : [row.blockNumber]))];
  const timestamps = new Map<bigint, bigint>();
  await Promise.all(blockNumbers.map(async (blockNumber) => {
    try { timestamps.set(blockNumber, (await client.getBlock({ blockNumber })).timestamp); } catch { /* block timestamps are supplemental */ }
  }));
  return rows
    .sort((left, right) => Number((left.blockNumber ?? 0n) - (right.blockNumber ?? 0n)) || left.logIndex - right.logIndex)
    .map(({ logIndex: _logIndex, ...row }) => ({ ...row, blockTimestamp: row.blockNumber === undefined ? undefined : timestamps.get(row.blockNumber) }));
}

export async function readOrderSnapshot(client: PublicClient, address: Address) {
  const functionNames = [
    'buyer', 'supplier', 'arbiter', 'orderAmount', 'depositAmount', 'reserveAmount', 'depositBps',
    'fallbackSupplierBps', 'fundingDeadline', 'shipmentDeadline', 'buyerDecisionDeadline', 'disputeDeadline',
    'termsHash', 'status', 'outcome', 'reserveRemaining', 'shipmentEvidenceHash', 'disputeReasonHash', 'accountingInvariant',
  ] as const;
  const values = await Promise.all(functionNames.map((functionName) => client.readContract({ address, abi: orderAbi, functionName } as never)));
  return {
    buyer: values[0] as Address,
    supplier: values[1] as Address,
    arbiter: values[2] as Address,
    orderAmount: values[3] as bigint,
    depositAmount: values[4] as bigint,
    reserveAmount: values[5] as bigint,
    depositBps: bpsToPercent(values[6] as bigint),
    fallbackSupplierBps: bpsToPercent(values[7] as bigint),
    fundingDeadline: values[8] as bigint,
    shipmentDeadline: values[9] as bigint,
    buyerDecisionDeadline: values[10] as bigint,
    disputeDeadline: values[11] as bigint,
    termsHash: values[12] as `0x${string}`,
    status: Number(values[13]),
    outcome: Number(values[14]),
    reserveRemaining: values[15] as bigint,
    shipmentEvidenceHash: values[16] as `0x${string}`,
    disputeReasonHash: values[17] as `0x${string}`,
    accountingInvariant: Boolean(values[18]),
    contractBalance: await client.getBalance({ address }),
  };
}

export type ArcClients = {
  publicClient: PublicClient;
  walletClient: WalletClient;
};

export function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export { FACTORY_ADDRESS, factoryAbi, orderAbi };

/** Only factory-emitted order addresses may trigger a Seldra wallet action.
 * Buyer-origin also matters: createOrder itself permits third parties to name any buyer.
 */
export type FactoryOrderProof = { created: OrderCreatedLog; originator: Address; blockNumber: bigint; transactionHash: Hash };

export async function verifyFactoryOrder(client: PublicClient, address: Address, blockHint?: bigint): Promise<FactoryOrderProof> {
  const event = parseAbiItem('event OrderCreated(address indexed order,address indexed buyer,address indexed supplier,address arbiter,uint256 orderAmount,uint16 depositBps,uint16 fallbackSupplierBps,uint256 fundingDeadline,uint256 shipmentDeadline,uint256 buyerDecisionDeadline,uint256 disputeDeadline,bytes32 termsHash)');
  const latest = await client.getBlockNumber();
  // The optional link block is merely a lookup hint, NEVER proof on its own.
  const first = blockHint !== undefined && blockHint >= ARC_DEPLOYMENT_BLOCK && blockHint <= latest
    ? [[blockHint, blockHint] as const]
    : [];
  const remaining = orderCreatedBlockRanges(ARC_DEPLOYMENT_BLOCK, latest).reverse();
  const ranges: Array<readonly [bigint, bigint]> = [...first, ...remaining.filter(([start, end]) => !first.length || start !== blockHint || end !== blockHint)];
  for (const [fromBlock, toBlock] of ranges) {
    const logs = await client.getLogs({ address: FACTORY_ADDRESS, event, args: { order: address }, fromBlock, toBlock } as never);
    for (const item of logs) {
      const log = item as unknown as { args: Record<string, unknown>; transactionHash: Hash | null; blockNumber: bigint | null };
      if (!log.transactionHash || log.blockNumber === null || !log.args) continue;
      if (String(log.args.order).toLowerCase() !== address.toLowerCase()) continue;
      const tx = await client.getTransaction({ hash: log.transactionHash });
      const args = log.args;
      return {
        created: {
          order: address, buyer: args.buyer as Address, supplier: args.supplier as Address, arbiter: args.arbiter as Address,
          orderAmount: args.orderAmount as bigint,
          depositBps: bpsToPercent(args.depositBps as bigint), fallbackSupplierBps: bpsToPercent(args.fallbackSupplierBps as bigint),
          fundingDeadline: args.fundingDeadline as bigint, shipmentDeadline: args.shipmentDeadline as bigint,
          buyerDecisionDeadline: args.buyerDecisionDeadline as bigint, disputeDeadline: args.disputeDeadline as bigint,
          termsHash: args.termsHash as `0x${string}`,
          blockNumber: log.blockNumber, transactionHash: log.transactionHash,
        },
        originator: tx.from, blockNumber: log.blockNumber, transactionHash: log.transactionHash,
      };
    }
  }
  throw new Error('No matching OrderCreated event from the official Seldra factory.');
}

export function proofMatchesSnapshot(proof: FactoryOrderProof, snapshot: Awaited<ReturnType<typeof readOrderSnapshot>>): boolean {
  return factoryOriginMatches(proof.created, proof.originator, snapshot);
}
