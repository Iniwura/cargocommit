// Exercises the exact read paths the UI uses (registry, orderSummary, event history) against live Arc Testnet.
//   bun --env-file=.env scripts/verify-reads.ts <buyerAddress>
import { createPublicClient, http, type Address } from 'viem';
import { arcTestnet } from 'viem/chains';
import { seldraFactoryAbi, seldraOrderAbi } from '../src/abi.generated';
import { fetchOrderHistory } from '../src/lib/history';
import { OUTCOME, STATUS, roleOf, type OrderSummary } from '../src/lib/order';
import { formatNativeUsdc } from '../src/lib/money';

const factory = process.env.VITE_FACTORY_ADDRESS_ARC_TESTNET as Address;
const participant = process.argv[2] as Address;
const client = createPublicClient({ chain: arcTestnet, transport: http(arcTestnet.rpcUrls.default.http[0]) });

const count = await client.readContract({ address: factory, abi: seldraFactoryAbi, functionName: 'ordersOfCount', args: [participant] });
console.log('orders for participant:', count);
for (let i = 0n; i < count; i++) {
  const order = await client.readContract({ address: factory, abi: seldraFactoryAbi, functionName: 'orderOfAt', args: [participant, i] });
  const summary = (await client.readContract({ address: order, abi: seldraOrderAbi, functionName: 'orderSummary' })) as OrderSummary;
  const history = await fetchOrderHistory(client, order, summary.createdAtBlock);
  console.log(`\n${order}  ${formatNativeUsdc(summary.orderAmount)} USDC  ${STATUS[summary.status]} / ${OUTCOME[summary.outcome]}  role=${roleOf(summary, participant)}`);
  for (const h of history) console.log(`  - ${h.label}: ${h.detail}`);
}
