import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { arc, arcTestnet } from 'viem/chains';
import { isAddress, type Address } from 'viem';

/** Networks the app can target. The active one is chosen at build time with VITE_NETWORK and defaults to
 *  Arc Testnet. Arc mainnet moves real USDC: it is only usable once VITE_FACTORY_ADDRESS_ARC_MAINNET points at
 *  a factory you deployed yourself after an independent review (see microgrant/MAINNET_RUNBOOK.md). */
export type NetworkConfig = {
  key: 'arc-testnet' | 'arc-mainnet';
  label: string;
  chainId: typeof arcTestnet.id | typeof arc.id;
  rpcUrl: string;
  explorerUrl: string;
  isTestnet: boolean;
  factory: Address | undefined;
  factoryDeployBlock: bigint;
};

function envAddress(value: string | undefined): Address | undefined {
  return value && isAddress(value) ? value : undefined;
}

function envBlock(value: string | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

export const ARC_TESTNET: NetworkConfig = {
  key: 'arc-testnet',
  label: 'Arc Testnet',
  chainId: arcTestnet.id,
  rpcUrl: arcTestnet.rpcUrls.default.http[0],
  explorerUrl: arcTestnet.blockExplorers.default.url,
  isTestnet: true,
  factory: envAddress(import.meta.env.VITE_FACTORY_ADDRESS_ARC_TESTNET),
  factoryDeployBlock: envBlock(import.meta.env.VITE_FACTORY_DEPLOY_BLOCK_ARC_TESTNET),
};

export const ARC_MAINNET: NetworkConfig = {
  key: 'arc-mainnet',
  label: 'Arc Mainnet',
  chainId: arc.id,
  rpcUrl: arc.rpcUrls.default.http[0],
  explorerUrl: arc.blockExplorers.default.url,
  isTestnet: false,
  factory: envAddress(import.meta.env.VITE_FACTORY_ADDRESS_ARC_MAINNET),
  factoryDeployBlock: envBlock(import.meta.env.VITE_FACTORY_DEPLOY_BLOCK_ARC_MAINNET),
};

export const NETWORK = import.meta.env.VITE_NETWORK === 'arc-mainnet' ? ARC_MAINNET : ARC_TESTNET;

export const wagmiConfig = createConfig({
  chains: [arcTestnet, arc],
  connectors: [injected()],
  transports: { [arcTestnet.id]: http(ARC_TESTNET.rpcUrl), [arc.id]: http(ARC_MAINNET.rpcUrl) },
});

export const explorerTx = (hash: string) => `${NETWORK.explorerUrl}/tx/${hash}`;
export const explorerAddress = (address: string) => `${NETWORK.explorerUrl}/address/${address}`;

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
