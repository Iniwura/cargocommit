import { useEffect, useState } from 'react';
import { useAccount, useReadContract, useSwitchChain } from 'wagmi';
import { erc20Abi } from 'viem';
import { ARC_USDC_ERC20 } from '@/lib/money';
import { NETWORK } from '@/config';

/** Current unix time in seconds, refreshed on an interval so countdowns stay live. */
export function useNow(intervalMs = 1000): bigint {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const id = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Wallet connection plus whether the wallet is on the network this app targets. */
export function useWallet() {
  const { address, chainId, isConnected, isConnecting, isReconnecting, connector } = useAccount();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const onTargetChain = chainId === NETWORK.chainId;
  return {
    address,
    isConnected,
    isConnecting: isConnecting || isReconnecting,
    connector,
    onTargetChain,
    isSwitching,
    switchToTarget: () => switchChainAsync({ chainId: NETWORK.chainId }),
  };
}

/** The single USDC balance of an account, read from the 6-decimal ERC-20 view. Never summed with the native view. */
export function useUsdcBalance(address: `0x${string}` | undefined) {
  return useReadContract({
    address: ARC_USDC_ERC20,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: NETWORK.chainId,
    query: { enabled: Boolean(address), refetchInterval: 8000 },
  });
}
