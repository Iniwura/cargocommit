import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  http,
  parseAbiItem,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { FACTORY_ADDRESS, factoryAbi, orderAbi, type OrderCreatedLog } from './contracts';
import { bpsToPercent } from './model';

export const ARC_RPC = 'https://rpc.mainnet.arc.io';
export const ARC_EXPLORER = 'https://explorer.arc.io';
export const ARC_CHAIN_ID = 5042;
export const ARC_DEPLOYMENT_BLOCK = 24_570_195n;

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
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

export function explorerTx(hash: string): string {
  return `${ARC_EXPLORER}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${ARC_EXPLORER}/address/${address}`;
}

export async function connectArcWallet(): Promise<{ account: Address; walletClient: WalletClient; chainId: number }> {
  if (!window.ethereum) throw new Error('Install an EVM wallet to continue.');
  const provider = window.ethereum;
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
  const walletClient = createWalletClient({ account, chain: arcMainnet, transport: custom(provider) });
  return { account, walletClient, chainId };
}

export async function fetchOrderCreatedLogs(client: PublicClient = publicClient): Promise<OrderCreatedLog[]> {
  const event = parseAbiItem('event OrderCreated(address indexed order,address indexed buyer,address indexed supplier,address arbiter,uint256 orderAmount,uint16 depositBps,uint16 fallbackSupplierBps,uint256 fundingDeadline,uint256 shipmentDeadline,uint256 buyerDecisionDeadline,uint256 disputeDeadline,bytes32 termsHash)');
  const latest = await client.getBlockNumber();
  const chunkSize = 100_000n;
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
  for (let fromBlock = ARC_DEPLOYMENT_BLOCK; fromBlock <= latest; fromBlock += chunkSize) {
    const toBlock = fromBlock + chunkSize - 1n > latest ? latest : fromBlock + chunkSize - 1n;
    const chunkLogs = await client.getLogs({ address: FACTORY_ADDRESS, event, fromBlock, toBlock } as never) as unknown as OrderCreatedEventLog[];
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
