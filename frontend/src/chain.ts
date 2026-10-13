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
import { bpsToPercent, factoryOriginMatches, requireFactoryVerificationBlock } from './model';

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

// Independent read-only mainnet providers. Never fall back to the wallet's
// signing provider for contract/index reads: that provider may block or rate-limit
// historical logs independently of the user's actual wallet connection.
const ARC_ARCHIVE_RPC = 'https://arc.drpc.org';
function readOnlyTransport(timeout: number) {
  // Mainnet probe 2026-10-13: dRPC served archived OrderCreated and all
  // 22 getters; Circle public RPC returned 429 under burst load; PublicNode
  // returned 403 for historical eth_getLogs without a personal token.
  // Both listed providers support historical event verification.
  return fallback([
    http(ARC_ARCHIVE_RPC, { timeout, retryCount: 0 }),
    http(ARC_RPC, { timeout, retryCount: 0 }),
  ], { retryCount: 0 });
}
export const publicClient = createPublicClient({ chain: arcMainnet, transport: readOnlyTransport(8_000) });
export const orderScanClient = createPublicClient({ chain: arcMainnet, transport: readOnlyTransport(6_000) });

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
    'acceptedAt', 'fundedAt', 'shipmentSubmittedAt',
  ] as const;
  // Arc's verified Multicall3 deployment reduces 22 RPC calls to one
  // aggregate3 eth_call. Fail closed if any getter fails; wallet writes still
  // independently check live contract terms, provenance and the signer.
  const values = await client.multicall({
    contracts: functionNames.map((functionName) => ({ address, abi: orderAbi, functionName })),
    multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11',
    allowFailure: false,
  });
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
    acceptedAt: values[19] as bigint,
    fundedAt: values[20] as bigint,
    shipmentSubmittedAt: values[21] as bigint,
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

/** Recover an order absent from the scheduled catalog using only the latest 4,000 blocks.
 * The returned height is an untrusted lookup hint. verifyFactoryOrder still checks
 * official factory provenance, transaction sender and immutable terms.
 */
export async function findRecentFactoryOrderBlock(
  client: PublicClient,
  address: Address,
  recentBlocks = 4_000n,
): Promise<bigint | undefined> {
  const latest = await client.getBlockNumber();
  if (recentBlocks <= 0n) throw new RangeError('Recent order lookup range must be positive');
  const first = latest - ARC_DEPLOYMENT_BLOCK + 1n > recentBlocks
    ? latest - recentBlocks + 1n
    : ARC_DEPLOYMENT_BLOCK;
  const event = parseAbiItem('event OrderCreated(address indexed order,address indexed buyer,address indexed supplier,address arbiter,uint256 orderAmount,uint16 depositBps,uint16 fallbackSupplierBps,uint256 fundingDeadline,uint256 shipmentDeadline,uint256 buyerDecisionDeadline,uint256 disputeDeadline,bytes32 termsHash)');
  for (const [fromBlock, toBlock] of orderCreatedBlockRanges(first, latest).reverse()) {
    const logs = await client.getLogs({
      address: FACTORY_ADDRESS, event, args: { order: address }, fromBlock, toBlock,
    } as never) as unknown as Array<{ blockNumber: bigint | null; args: { order: Address } }>;
    const found = logs.find(log => log.blockNumber !== null && log.args.order.toLowerCase() === address.toLowerCase());
    if (found?.blockNumber !== null && found?.blockNumber !== undefined) return found.blockNumber;
  }
  return undefined;
}

export async function verifyFactoryOrder(client: PublicClient, address: Address, blockHint?: bigint): Promise<FactoryOrderProof> {
  const event = parseAbiItem('event OrderCreated(address indexed order,address indexed buyer,address indexed supplier,address arbiter,uint256 orderAmount,uint16 depositBps,uint16 fallbackSupplierBps,uint256 fundingDeadline,uint256 shipmentDeadline,uint256 buyerDecisionDeadline,uint256 disputeDeadline,bytes32 termsHash)');
  // The address lookup already resolved this factory block from the published
  // index, a share URL, or bounded recent logs. A missing/wrong block hint must
  // fail closed, NEVER start an unbounded scan from deployment in the browser.
  const exactBlock = requireFactoryVerificationBlock(blockHint, ARC_DEPLOYMENT_BLOCK);
  const ranges: Array<readonly [bigint, bigint]> = [[exactBlock, exactBlock]];
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
