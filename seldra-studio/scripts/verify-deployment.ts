// Read-only check that the code at a factory address is exactly the code compiled from this repository.
//   bun scripts/verify-deployment.ts <rpcUrl> <factoryAddress>
// Run it after any deployment (testnet or mainnet) and again whenever you change the Solidity sources.
// It sends no transactions and needs no key.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, http, type Address } from 'viem';
import { seldraFactoryAbi } from '../src/abi.generated';

const [rpcUrl, address] = process.argv.slice(2) as [string, Address];
if (!rpcUrl || !address) throw new Error('usage: bun scripts/verify-deployment.ts <rpcUrl> <factoryAddress>');

const artifact = JSON.parse(readFileSync(resolve(import.meta.dir, '..', '..', 'contracts', 'out', 'SeldraFactory.sol', 'SeldraFactory.json'), 'utf8')) as {
  deployedBytecode: { object: string };
};
const client = createPublicClient({ transport: http(rpcUrl) });

const onchain = (await client.getCode({ address }))?.toLowerCase();
const expected = artifact.deployedBytecode.object.toLowerCase();
const chainId = await client.getChainId();
console.log(`chainId ${chainId}, address ${address}`);
if (!onchain) throw new Error('No code at this address.');
console.log(`code at address matches compiled SeldraFactory: ${onchain === expected}`);
console.log(`schema version: ${await client.readContract({ address, abi: seldraFactoryAbi, functionName: 'ORDER_SCHEMA_VERSION' })}`);
console.log(`orders created so far: ${await client.readContract({ address, abi: seldraFactoryAbi, functionName: 'orderCount' })}`);
if (onchain !== expected) process.exit(1);
