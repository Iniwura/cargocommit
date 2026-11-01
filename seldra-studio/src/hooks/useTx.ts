import { useCallback, useState } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import type { Abi, Address, TransactionReceipt } from 'viem';
import { NETWORK } from '@/config';
import { parseTxError } from '@/lib/errors';
import { useWallet } from './useChain';

export type TxPhase = 'idle' | 'wallet' | 'confirming' | 'success' | 'error';

export type TxState = {
  phase: TxPhase;
  hash?: `0x${string}`;
  message?: string;
  receipt?: TransactionReceipt;
};

export type TxRequest = {
  abi: Abi;
  address: Address;
  functionName: string;
  args?: readonly unknown[];
  /** native value in 18-decimal units */
  value?: bigint;
};

/**
 * Sends one contract write and reports the real lifecycle: wallet prompt, submitted, mined, failed.
 * The wallet is moved to the target network first. Nothing here is simulated.
 */
export function useTx() {
  const [state, setState] = useState<TxState>({ phase: 'idle' });
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: NETWORK.chainId });
  const { chainId } = useAccount();
  const wallet = useWallet();
  const queryClient = useQueryClient();

  const send = useCallback(
    async (request: TxRequest): Promise<TransactionReceipt | undefined> => {
      setState({ phase: 'wallet' });
      try {
        if (chainId !== NETWORK.chainId) await wallet.switchToTarget();
        const hash = await writeContractAsync({
          abi: request.abi,
          address: request.address,
          functionName: request.functionName,
          args: request.args,
          value: request.value,
          chainId: NETWORK.chainId,
        });
        setState({ phase: 'confirming', hash });
        if (!publicClient) throw new Error('No public client for the target network.');
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
          setState({ phase: 'error', hash, message: 'The transaction was mined but reverted.', receipt });
          return receipt;
        }
        setState({ phase: 'success', hash, receipt });
        await queryClient.invalidateQueries();
        return receipt;
      } catch (error) {
        const friendly = parseTxError(error);
        setState(friendly.rejected ? { phase: 'idle' } : { phase: 'error', message: friendly.message });
        return undefined;
      }
    },
    [chainId, publicClient, queryClient, wallet, writeContractAsync],
  );

  const reset = useCallback(() => setState({ phase: 'idle' }), []);
  return { state, send, reset, busy: state.phase === 'wallet' || state.phase === 'confirming' };
}
