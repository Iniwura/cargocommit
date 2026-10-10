/** Human-readable wallet, RPC and contract failures. Raw provider traces are never shown. */
export type ProductError = { title: string; message: string; guidance: string; kind: 'wallet' | 'network' | 'contract' | 'input' | 'unknown' };

function errorCodes(error: unknown): Array<number | string> {
  const codes: Array<number | string> = [];
  let item: unknown = error;
  for (let i = 0; i < 5 && item && typeof item === 'object'; i += 1) {
    const record = item as Record<string, unknown>;
    if (typeof record.code === 'number' || typeof record.code === 'string') codes.push(record.code);
    item = record.cause;
  }
  return codes;
}

export function productError(error: unknown): ProductError {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : undefined;
  const raw = [record?.shortMessage, record?.message, record?.name, typeof error === 'string' ? error : undefined]
    .filter((part): part is string => typeof part === 'string').join(' ').slice(0, 5000);
  const codes = errorCodes(error);
  if (codes.some((code) => Number(code) === 4001) || /user rejected|user denied|rejected the request|userrejected/i.test(raw)) {
    return { kind: 'wallet', title: 'Signature cancelled', message: 'You declined the wallet request. No new transaction was sent by this action.', guidance: 'Review the details and choose the action again when ready.' };
  }
  if (codes.some((code) => Number(code) === -32002) || /already pending|request.*pending/i.test(raw)) {
    return { kind: 'wallet', title: 'Wallet request already open', message: 'Your wallet is still waiting for a response to an earlier request.', guidance: 'Open your wallet and approve or dismiss that request before retrying.' };
  }
  if (codes.some((code) => Number(code) === 4902) || /wrong network|not connected to Arc|chain mismatch|switch your wallet to Arc|chain.*does not match/i.test(raw)) {
    return { kind: 'wallet', title: 'Connect to Arc mainnet', message: 'The wallet is not connected to Arc mainnet (chain 5042).', guidance: 'Change network in your wallet, then retry.' };
  }
  if (/insufficient funds|exceeds.*balance|not enough funds/i.test(raw)) {
    return { kind: 'wallet', title: 'Not enough USDC', message: 'This wallet does not have enough Arc native USDC for the payment and network fee.', guidance: 'Check the full order amount and leave some native USDC for gas.' };
  }
  if (/InvalidStatus|InvalidDeadlineOrder|FundingDeadlinePassed|ShipmentDeadlinePassed|BuyerDecisionDeadlinePassed|DisputeDeadlineNotPassed|execution reverted|ContractFunctionRevertedError/i.test(raw)) {
    return { kind: 'contract', title: 'Action not accepted onchain', message: 'The contract did not accept this action in its current state or deadline window.', guidance: 'Refresh the order and check the active role, current state and deadlines.' };
  }
  if (/NotBuyer|NotSupplier|NotArbiter|unauthorized account/i.test(raw)) {
    return { kind: 'contract', title: 'Wrong signer for this action', message: 'The connected wallet is not the permitted order party for this action.', guidance: 'Switch to the designated buyer, supplier or arbiter address.' };
  }
  if (codes.some((code) => Number(code) === 429) || /rate limit|too many requests|http request failed with status 429/i.test(raw)) {
    return { kind: 'network', title: 'Arc is receiving too many requests', message: 'The public RPC temporarily limited read requests.', guidance: 'Wait a moment and retry. Do not repeat a transaction that already has a hash.' };
  }
  if (/timeout|timed out|ETIMEDOUT|fetch failed|failed to fetch|network error|gateway|connection refused|HTTP request failed/i.test(raw)) {
    return { kind: 'network', title: 'Connection interrupted', message: 'The Arc network response could not be retrieved.', guidance: 'Retry the read. If your wallet already submitted a transaction, check its explorer link before sending another.' };
  }
  return { kind: 'unknown', title: 'Action could not be completed', message: 'The wallet or network returned an unexpected response.', guidance: 'Check the selected wallet, order status and Arc explorer before trying again.' };
}

export function productErrorText(error: unknown): string {
  const result = productError(error);
  return `${result.title}. ${result.message} ${result.guidance}`;
}

export function pendingReceiptMessage(): string {
  return 'Transaction submitted, but confirmation is not available yet. Check the Arc explorer before trying again. The transaction may already have succeeded.';
}
