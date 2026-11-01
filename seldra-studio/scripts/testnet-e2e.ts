// Live Arc Testnet end-to-end run against the deployed SeldraFactory.
//
//   bun scripts/testnet-e2e.ts keys     create three throwaway test keys (never printed) and show their addresses
//   bun scripts/testnet-e2e.ts run      run the full scenario (needs the buyer address to hold test USDC)
//
// The keys are generated here, kept in a file outside the repository (SELDRA_E2E_KEYS, default
// /tmp/seldra-e2e-keys.json) and are only ever used for this test. Results, with transaction hashes,
// are written to ../microgrant/evidence/testnet-e2e.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, http, parseEventLogs, parseUnits, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import { seldraFactoryAbi, seldraOrderAbi } from '../src/abi.generated';

const KEYS = process.env.SELDRA_E2E_KEYS ?? '/tmp/seldra-e2e-keys.json';
const FACTORY = (process.env.VITE_FACTORY_ADDRESS_ARC_TESTNET ?? '') as Address;
const OUT = resolve(import.meta.dir, '..', '..', 'microgrant', 'evidence', 'testnet-e2e.json');
const ORDER_AMOUNT = parseUnits('0.1', 18); // 0.10 USDC in native units

type Keys = { buyer: `0x${string}`; supplier: `0x${string}`; arbiter: `0x${string}` };
const roles = ['buyer', 'supplier', 'arbiter'] as const;

if (process.argv[2] === 'keys') {
  if (!existsSync(KEYS)) {
    const fresh: Keys = { buyer: generatePrivateKey(), supplier: generatePrivateKey(), arbiter: generatePrivateKey() };
    writeFileSync(KEYS, JSON.stringify(fresh), { mode: 0o600 });
  }
  const k = JSON.parse(readFileSync(KEYS, 'utf8')) as Keys;
  for (const r of roles) console.log(r, privateKeyToAccount(k[r]).address);
  process.exit(0);
}

if (!FACTORY) throw new Error('Set VITE_FACTORY_ADDRESS_ARC_TESTNET (bun --env-file=.env scripts/testnet-e2e.ts run)');
const keys = JSON.parse(readFileSync(KEYS, 'utf8')) as Keys;
const accounts = { buyer: privateKeyToAccount(keys.buyer), supplier: privateKeyToAccount(keys.supplier), arbiter: privateKeyToAccount(keys.arbiter) };
const transport = http(arcTestnet.rpcUrls.default.http[0]);
const pub = createPublicClient({ chain: arcTestnet, transport });
const walletFor = (account: (typeof accounts)[(typeof roles)[number]]) => createWalletClient({ account, chain: arcTestnet, transport });
const wallets = { buyer: walletFor(accounts.buyer), supplier: walletFor(accounts.supplier), arbiter: walletFor(accounts.arbiter) };

type Record_ = { step: string; kind: 'tx' | 'expected-revert' | 'check'; ok: boolean; detail?: string; hash?: string; gasUsed?: string; block?: string };
const log: Record_[] = [];
const note = (r: Record_) => {
  log.push(r);
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}${r.detail ? `  (${r.detail})` : ''}`);
};

async function tx(step: string, who: (typeof roles)[number], address: Address, abi: typeof seldraOrderAbi | typeof seldraFactoryAbi, functionName: string, args: unknown[] = [], value?: bigint) {
  const hash = await wallets[who].writeContract({ address, abi, functionName, args, value, account: accounts[who], chain: arcTestnet } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  note({ step, kind: 'tx', ok: receipt.status === 'success', hash, gasUsed: receipt.gasUsed.toString(), block: receipt.blockNumber.toString() });
  if (receipt.status !== 'success') throw new Error(`${step} reverted`);
  return receipt;
}

async function expectRevert(step: string, who: (typeof roles)[number], address: Address, functionName: string, errorName: string, args: unknown[] = [], value?: bigint) {
  try {
    await pub.simulateContract({ address, abi: seldraOrderAbi, functionName, args, value, account: accounts[who].address } as never);
    note({ step, kind: 'expected-revert', ok: false, detail: `did not revert, expected ${errorName}` });
  } catch (e) {
    const reverted = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    const got = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
    note({ step, kind: 'expected-revert', ok: got === errorName, detail: `expected ${errorName}, got ${got ?? 'other'}` });
  }
}

const check = (step: string, ok: boolean, detail?: string) => note({ step, kind: 'check', ok, detail });
const now = async () => (await pub.getBlock()).timestamp;
async function waitPast(deadline: bigint) {
  while ((await now()) <= deadline) await new Promise((r) => setTimeout(r, 4000));
}

async function createOrder(label: string, w: { funding: number; shipment: number; decision: number; dispute: number }) {
  const t = Number(await now());
  const funding = t + w.funding, shipment = funding + w.shipment, decision = shipment + w.decision, dispute = decision + w.dispute;
  const params = {
    supplier: accounts.supplier.address, arbiter: accounts.arbiter.address, orderAmount: ORDER_AMOUNT, depositBps: 3000, fallbackSupplierBps: 5000,
    referenceHash: `0x${'ab'.repeat(32)}`, fundingDeadline: BigInt(funding), shipmentDeadline: BigInt(shipment), buyerDecisionDeadline: BigInt(decision), disputeDeadline: BigInt(dispute),
  };
  const receipt = await tx(`${label}: buyer creates order`, 'buyer', FACTORY, seldraFactoryAbi, 'createOrder', [params]);
  const created = parseEventLogs({ abi: seldraFactoryAbi, logs: receipt.logs, eventName: 'OrderCreated' })[0];
  check(`${label}: factory registers the buyer as msg.sender`, created.args.buyer.toLowerCase() === accounts.buyer.address.toLowerCase());
  return { order: created.args.order, params };
}

const read = <T>(order: Address, functionName: string, args: unknown[] = []) => pub.readContract({ address: order, abi: seldraOrderAbi, functionName, args } as never) as Promise<T>;
const summaryOf = (order: Address) => read<{ status: number; outcome: number; balance: bigint; reserveRemaining: bigint; totalPending: bigint }>(order, 'orderSummary');

async function settledChecks(label: string, order: Address, status = 5) {
  const s = await summaryOf(order);
  check(`${label}: status is SETTLED`, s.status === status, `status ${s.status}, outcome ${s.outcome}`);
  check(`${label}: order contract holds nothing after settlement`, s.balance === 0n && s.reserveRemaining === 0n && s.totalPending === 0n);
  check(`${label}: accounting invariant holds`, await read<boolean>(order, 'accountingInvariantHolds'));
}

async function main() {
  const chainId = await pub.getChainId();
  if (chainId !== arcTestnet.id) throw new Error(`Refusing to run: this script is testnet only (expected chain ${arcTestnet.id}, got ${chainId}).`);
  console.log('factory', FACTORY, 'chain', chainId);
  const bal = async (a: Address) => (await pub.getBalance({ address: a }));
  if ((await bal(accounts.buyer.address)) < parseUnits('0.5', 18)) throw new Error('Buyer needs at least 0.5 test USDC. Fund the buyer address first.');
  for (const r of ['supplier', 'arbiter'] as const) {
    if ((await bal(accounts[r].address)) < parseUnits('0.02', 18)) {
      const hash = await wallets.buyer.sendTransaction({ to: accounts[r].address, value: parseUnits('0.05', 18), account: accounts.buyer, chain: arcTestnet });
      await pub.waitForTransactionReceipt({ hash });
      note({ step: `buyer sends 0.05 gas USDC to ${r}`, kind: 'tx', ok: true, hash });
    }
  }

  // A. happy path with role and state checks
  const A = await createOrder('A happy path', { funding: 900, shipment: 900, decision: 900, dispute: 900 });
  const a = A.order;
  await expectRevert('A: arbiter cannot accept terms', 'arbiter', a, 'acceptTerms', 'NotSupplier');
  await expectRevert('A: buyer cannot fund before acceptance', 'buyer', a, 'fund', 'InvalidStatus', [], ORDER_AMOUNT);
  await tx('A: supplier accepts terms', 'supplier', a, seldraOrderAbi, 'acceptTerms');
  await expectRevert('A: supplier cannot fund', 'supplier', a, 'fund', 'NotBuyer', [], parseUnits('0.01', 18)); // value below the supplier's balance so the role check, not a balance check, is what fails
  await expectRevert('A: wrong funding amount rejected', 'buyer', a, 'fund', 'FundingAmountMismatch', [], ORDER_AMOUNT - 1n);
  const before = await bal(accounts.supplier.address);
  await tx('A: buyer funds 0.10 USDC', 'buyer', a, seldraOrderAbi, 'fund', [], ORDER_AMOUNT);
  const after = await bal(accounts.supplier.address);
  check('A: supplier received the 30% deposit (0.03 USDC) at funding', after - before === parseUnits('0.03', 18), `delta ${after - before}`);
  const funded = await summaryOf(a);
  check('A: reserve 0.07 USDC protected in the order', funded.balance === parseUnits('0.07', 18) && funded.reserveRemaining === parseUnits('0.07', 18));
  await expectRevert('A: buyer cannot approve before evidence', 'buyer', a, 'approveRelease', 'InvalidStatus');
  await tx('A: supplier commits evidence hash', 'supplier', a, seldraOrderAbi, 'submitEvidence', [`0x${'cd'.repeat(32)}`]);
  await expectRevert('A: supplier cannot approve own release', 'supplier', a, 'approveRelease', 'NotBuyer');
  const supplierBefore = await bal(accounts.supplier.address);
  await tx('A: buyer approves release', 'buyer', a, seldraOrderAbi, 'approveRelease');
  check('A: supplier received the 0.07 USDC reserve', (await bal(accounts.supplier.address)) - supplierBefore === parseUnits('0.07', 18));
  await settledChecks('A', a);
  await expectRevert('A: settled order cannot be approved twice', 'buyer', a, 'approveRelease', 'InvalidStatus');

  // B. dispute resolved by arbiter
  const B = await createOrder('B dispute', { funding: 900, shipment: 900, decision: 900, dispute: 900 });
  await tx('B: supplier accepts', 'supplier', B.order, seldraOrderAbi, 'acceptTerms');
  await tx('B: buyer funds', 'buyer', B.order, seldraOrderAbi, 'fund', [], ORDER_AMOUNT);
  await tx('B: supplier commits evidence', 'supplier', B.order, seldraOrderAbi, 'submitEvidence', [`0x${'ef'.repeat(32)}`]);
  await tx('B: buyer opens dispute', 'buyer', B.order, seldraOrderAbi, 'openDispute', [`0x${'12'.repeat(32)}`]);
  await expectRevert('B: release is frozen during dispute', 'buyer', B.order, 'approveRelease', 'InvalidStatus');
  await expectRevert('B: arbiter cannot pay more than the reserve', 'arbiter', B.order, 'resolveDispute', 'InvalidPayout', [parseUnits('0.08', 18)]);
  await expectRevert('B: supplier cannot resolve', 'supplier', B.order, 'resolveDispute', 'NotArbiter', [0n]);
  await tx('B: arbiter awards supplier 0.04 of the 0.07 reserve', 'arbiter', B.order, seldraOrderAbi, 'resolveDispute', [parseUnits('0.04', 18)]);
  await settledChecks('B', B.order);

  // C. shipment deadline passes without evidence
  const C = await createOrder('C no shipment', { funding: 240, shipment: 60, decision: 600, dispute: 600 });
  await tx('C: supplier accepts', 'supplier', C.order, seldraOrderAbi, 'acceptTerms');
  await tx('C: buyer funds', 'buyer', C.order, seldraOrderAbi, 'fund', [], ORDER_AMOUNT);
  await expectRevert('C: refund is not available before the shipment deadline', 'buyer', C.order, 'claimShipmentRefund', 'DeadlineNotPassed');
  console.log('waiting for the shipment deadline of order C…');
  await waitPast(C.params.shipmentDeadline);
  await expectRevert('C: supplier cannot submit evidence after the deadline', 'supplier', C.order, 'submitEvidence', 'DeadlinePassed', [`0x${'aa'.repeat(32)}`]);
  await tx('C: buyer reclaims the 0.07 reserve', 'buyer', C.order, seldraOrderAbi, 'claimShipmentRefund');
  await settledChecks('C', C.order);

  // D. cancel before funding
  const D = await createOrder('D cancel', { funding: 900, shipment: 900, decision: 900, dispute: 900 });
  await expectRevert('D: outsider cannot cancel before the funding deadline', 'arbiter', D.order, 'cancelBeforeFunding', 'NotBuyer');
  await tx('D: buyer cancels the unfunded order', 'buyer', D.order, seldraOrderAbi, 'cancelBeforeFunding');
  await settledChecks('D', D.order);

  // registry
  const count = await pub.readContract({ address: FACTORY, abi: seldraFactoryAbi, functionName: 'ordersOfCount', args: [accounts.buyer.address] });
  check('registry lists all four orders for the buyer', count >= 4n, `count ${count}`);

  const failed = log.filter((r) => !r.ok);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ chainId: arcTestnet.id, factory: FACTORY, participants: Object.fromEntries(roles.map((r) => [r, accounts[r].address])), orders: { A: A.order, B: B.order, C: C.order, D: D.order }, summary: { total: log.length, failed: failed.length }, results: log }, null, 2));
  console.log(`\n${log.length - failed.length}/${log.length} checks passed. Evidence written to microgrant/evidence/testnet-e2e.json`);
  if (failed.length) process.exit(1);
}

if (process.argv[2] === 'run') await main();
