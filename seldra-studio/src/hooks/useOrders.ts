import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient, useReadContract, useReadContracts } from 'wagmi';
import type { Address } from 'viem';
import { seldraFactoryAbi, seldraOrderAbi } from '@/abi.generated';
import { NETWORK } from '@/config';
import { fetchOrderHistory } from '@/lib/history';
import type { OrderSummary } from '@/lib/order';

const LIST_LIMIT = 40;

/** Live read of one order in a single call. */
export function useOrderSummary(order: Address | undefined) {
  const result = useReadContract({
    abi: seldraOrderAbi,
    address: order,
    functionName: 'orderSummary',
    chainId: NETWORK.chainId,
    query: { enabled: Boolean(order), refetchInterval: 6000 },
  });
  return { ...result, summary: result.data as OrderSummary | undefined };
}

/** Whether an address is a genuine order created by the configured factory. */
export function useIsFactoryOrder(order: Address | undefined) {
  return useReadContract({
    abi: seldraFactoryAbi,
    address: NETWORK.factory,
    functionName: 'isOrder',
    args: order ? [order] : undefined,
    chainId: NETWORK.chainId,
    query: { enabled: Boolean(order && NETWORK.factory) },
  });
}

export function usePendingCredit(order: Address | undefined, account: Address | undefined) {
  return useReadContract({
    abi: seldraOrderAbi,
    address: order,
    functionName: 'pendingWithdrawals',
    args: account ? [account] : undefined,
    chainId: NETWORK.chainId,
    query: { enabled: Boolean(order && account), refetchInterval: 8000 },
  });
}

export function useInvariant(order: Address | undefined) {
  return useReadContract({
    abi: seldraOrderAbi,
    address: order,
    functionName: 'accountingInvariantHolds',
    chainId: NETWORK.chainId,
    query: { enabled: Boolean(order), refetchInterval: 8000 },
  });
}

/** Full settlement history of an order from its onchain events. */
export function useOrderHistory(order: Address | undefined, fromBlock: bigint | undefined) {
  const client = usePublicClient({ chainId: NETWORK.chainId });
  return useQuery({
    queryKey: ['order-history', order, fromBlock?.toString()],
    enabled: Boolean(client && order && fromBlock !== undefined),
    refetchInterval: 8000,
    queryFn: () => {
      if (!client || !order || fromBlock === undefined) return [];
      return fetchOrderHistory(client, order, fromBlock);
    },
  });
}

/** Orders the account takes part in, read from the factory registry (no indexer involved). */
export function useMyOrders(account: Address | undefined) {
  const factory = NETWORK.factory;
  const count = useReadContract({
    abi: seldraFactoryAbi,
    address: factory,
    functionName: 'ordersOfCount',
    args: account ? [account] : undefined,
    chainId: NETWORK.chainId,
    query: { enabled: Boolean(account && factory), refetchInterval: 10_000 },
  });

  const total = Number(count.data ?? 0n);
  const indexes = useMemo(() => {
    const first = Math.max(0, total - LIST_LIMIT);
    return Array.from({ length: total - first }, (_, i) => total - 1 - i);
  }, [total]);

  const addresses = useReadContracts({
    contracts: indexes.map((i) => ({
      abi: seldraFactoryAbi,
      address: factory,
      functionName: 'orderOfAt' as const,
      args: [account as Address, BigInt(i)] as const,
      chainId: NETWORK.chainId,
    })),
    query: { enabled: Boolean(account && factory && indexes.length > 0) },
  });

  const orderAddresses = useMemo(
    () => (addresses.data ?? []).flatMap((r) => (r.status === 'success' ? [r.result as Address] : [])),
    [addresses.data],
  );

  const summaries = useReadContracts({
    contracts: orderAddresses.map((address) => ({
      abi: seldraOrderAbi,
      address,
      functionName: 'orderSummary' as const,
      chainId: NETWORK.chainId,
    })),
    query: { enabled: orderAddresses.length > 0, refetchInterval: 10_000 },
  });

  const rows = useMemo(
    () =>
      orderAddresses.flatMap((address, i) => {
        const r = summaries.data?.[i];
        return r && r.status === 'success' ? [{ address, summary: r.result as OrderSummary }] : [];
      }),
    [orderAddresses, summaries.data],
  );

  return {
    rows,
    total,
    isLoading: count.isLoading || addresses.isLoading || summaries.isLoading,
    error: count.error ?? addresses.error ?? summaries.error,
    truncated: total > LIST_LIMIT,
  };
}
