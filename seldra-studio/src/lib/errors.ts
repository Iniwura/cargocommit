import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem';

const CUSTOM_ERROR_COPY: Record<string, string> = {
  InvalidAddress: 'Buyer, supplier and arbiter must be three different, non-zero wallets.',
  InvalidAmount: 'The order amount is not valid.',
  InvalidBps: 'The deposit or fallback percentage is out of range.',
  InvalidDeadlines: 'The deadlines are not in a valid order.',
  InvalidStatus: 'The order is not in the right state for this action.',
  NotBuyer: 'Only the buyer can do this.',
  NotSupplier: 'Only the supplier can do this.',
  NotArbiter: 'Only the arbiter can do this.',
  FundingAmountMismatch: 'The funded amount must equal the order amount exactly.',
  DeadlinePassed: 'That deadline has already passed.',
  DeadlineNotPassed: 'That deadline has not passed yet.',
  MissingCommitment: 'A non-empty commitment hash is required.',
  InvalidPayout: 'The payout is larger than the protected reserve.',
  AccountingMismatch: 'Contract accounting check failed. Do not retry; review the order.',
  NothingToWithdraw: 'There is nothing to withdraw for this wallet.',
  WithdrawFailed: 'The withdrawal transfer failed.',
  Reentrancy: 'Reentrant call blocked.',
  DirectTransferRejected: 'Orders cannot receive plain transfers.',
  IndexOutOfBounds: 'That registry entry does not exist.',
};

export type FriendlyError = { message: string; rejected: boolean };

export function parseTxError(error: unknown): FriendlyError {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return { message: 'Transaction cancelled in your wallet.', rejected: true };
    }
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && CUSTOM_ERROR_COPY[name]) return { message: CUSTOM_ERROR_COPY[name], rejected: false };
      if (reverted.reason) return { message: `Reverted: ${reverted.reason}`, rejected: false };
    }
    const text = error.shortMessage.toLowerCase();
    if (text.includes('insufficient funds') || text.includes('exceeds the balance')) {
      return { message: 'Not enough USDC in this wallet to cover the amount plus network fees.', rejected: false };
    }
    if (text.includes('chain') && text.includes('mismatch')) {
      return { message: 'Your wallet is on a different network. Switch to Arc Testnet and retry.', rejected: false };
    }
    return { message: error.shortMessage, rejected: false };
  }
  if (error instanceof Error && error.message.toLowerCase().includes('user rejected')) {
    return { message: 'Transaction cancelled in your wallet.', rejected: true };
  }
  return { message: 'Something went wrong. Check your connection and try again.', rejected: false };
}
