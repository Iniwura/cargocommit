# Seldra (Arc Studio implementation)

Supplier-order settlement in native USDC on Arc. A buyer funds a purchase order once, the supplier receives a production deposit immediately, and the remaining balance stays protected until shipment evidence is committed and the buyer approves release.

Built with [Arc Studio](https://studio.arc.io)

This is a new implementation based on the CargoCommit / Seldra concept. It does not use or change the existing deployed contracts. It is experimental, has had automated review and tests only, and has not had an independent audit.

## Layout

- `../contracts`: Solidity contracts and the Foundry test suite (own `foundry.toml`).
- `.` (this folder): the web app.
- `../microgrant`: development record, list of unverified items, mainnet runbook and test evidence.

## Tech stack

Solidity 0.8.35, Foundry. Vite, React, TypeScript, wagmi, viem, TanStack Query. Bun for scripts and tests.

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://book.getfoundry.sh).

```bash
# contracts
cd contracts
forge build
forge test

# app
cd ../seldra-studio
bun install
cp .env.example .env     # then review the values
bun run dev              # http://localhost:5173
bun run build            # production build into dist/
bun run typecheck
bun run lint
bun test tests
```

After changing a contract, rebuild it and refresh the app's ABI: `forge build` in `contracts/`, then `bun run sync-abi` here.

### Environment variables

All values are public. Never put a private key in `.env`.

| Name | Purpose |
| --- | --- |
| `VITE_NETWORK` | `arc-testnet` (default) or `arc-mainnet` |
| `VITE_FACTORY_ADDRESS_ARC_TESTNET` | Address of the deployed SeldraFactory on Arc Testnet |
| `VITE_FACTORY_DEPLOY_BLOCK_ARC_TESTNET` | Block the testnet factory was deployed in |
| `VITE_FACTORY_ADDRESS_ARC_MAINNET` | Your own mainnet factory address. Leave empty until you have deployed and verified one |
| `VITE_FACTORY_DEPLOY_BLOCK_ARC_MAINNET` | Block your mainnet factory was deployed in |

### Scripts

| Command | What it does |
| --- | --- |
| `bun scripts/verify-deployment.ts <rpc> <factory>` | Read-only check that the code at an address matches the compiled factory |
| `bun --env-file=.env scripts/verify-reads.ts <address>` | Lists a wallet's orders and their event history using the app's own read code |
| `bun scripts/testnet-e2e.ts keys` then `run` | Live Arc Testnet scenario with three throwaway wallets (testnet only) |

## Using it

Connect a browser wallet on Arc Testnet. Get test USDC from the Circle faucet. As buyer, create an order naming a supplier and an arbiter (three different wallets). The supplier accepts, the buyer funds, the supplier commits evidence, the buyer approves or disputes. Every order has a shareable link and a settlement history read from onchain events.

## Mainnet

Not deployed. See `../microgrant/MAINNET_RUNBOOK.md`. You deploy and operate it yourself, after an independent audit.
