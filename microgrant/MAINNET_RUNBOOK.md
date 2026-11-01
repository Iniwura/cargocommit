# Arc mainnet deployment runbook (for you to run, outside Arc Studio)

Status: written, not executed. Nothing in this project has been deployed to Arc mainnet and nothing here has been independently audited.

Warning: Transactions on mainnet involve real funds and, once submitted, are irreversible. Arc Studio may generate or edit code or configuration that references mainnet, but Arc Studio does not deploy to, transact on, sign for, fund, or otherwise interact with mainnet on your behalf. Any code used for mainnet must be independently reviewed, tested, validated, deployed, and operated by you outside of Arc Studio. You are solely responsible for any losses, errors, or other consequences resulting from your use of any code, configuration, or output generated or edited through Arc Studio in connection with mainnet. Before proceeding, you should first use testnet, obtain an independent professional audit, and carefully review all wallet addresses, contract addresses, chain settings, permissions, and other configuration details. Only continue to mainnet after you have completed your independent review and have determined that you want to proceed.

## 0. Gate: do not start until all of these are true

- An independent professional audit of `contracts/SeldraOrder.sol` and `contracts/SeldraFactory.sol` is complete, every finding is fixed or explicitly accepted in writing, and the audited commit hash is recorded.
- You deploy from exactly that commit, with the compiler settings in `contracts/foundry.toml`.
- You have confirmed from Arc's own documentation that the Cancun EVM target used here and native-value transfers behave on Arc mainnet as they do on Arc Testnet. This has only been exercised on Arc Testnet.
- A deployer wallet you control exists, with its key in an encrypted Foundry keystore or a hardware wallet. Never paste a key into a command, a file or a chat.
- The deployer holds enough USDC for gas. On Arc, gas is the same USDC. Per Arc's documentation, mainnet gas USDC is obtained through your Circle point of contact.
- The reviewers' open points (section 6) have been answered.

## 1. Network facts (from the Arc documentation; re-check them before use)

| Field | Arc mainnet |
| --- | --- |
| Chain ID | 5042 |
| RPC | `https://rpc.mainnet.arc.io` |
| Explorer | `https://explorer.arc.io` |
| USDC (ERC-20 view, 6 decimals) | `0x3600000000000000000000000000000000000000` |
| Native value | USDC, 18 decimals in `msg.value` |

## 2. Reproduce the build and the tests

```bash
cd contracts
forge build
forge test        # expect 154 passed, 0 failed
```

Record the commit hash and the compiler output. The factory takes no constructor arguments.

## 3. Rehearse without sending anything

```bash
cd contracts
cast wallet import seldra-deployer --interactive   # enter the key when prompted; it is stored encrypted
forge create SeldraFactory.sol:SeldraFactory \
  --rpc-url https://rpc.mainnet.arc.io \
  --account seldra-deployer
```

Without `--broadcast`, `forge create` only simulates. Check the simulated deployer address, chain ID and gas estimate before the next step.

## 4. Deploy

```bash
cd contracts
forge create SeldraFactory.sol:SeldraFactory \
  --rpc-url https://rpc.mainnet.arc.io \
  --account seldra-deployer \
  --broadcast
```

Write down the deployed address, the transaction hash and the block number. The factory has no owner, no admin and no upgrade path, so there is nothing to hand over and nothing to rotate.

## 5. Verify what you deployed

1. Confirm the code at the address equals the compiled code. Read-only, no key:
   ```bash
   cd seldra-studio
   bun scripts/verify-deployment.ts https://rpc.mainnet.arc.io <factory-address>
   ```
   It must print `code at address matches compiled SeldraFactory: true`.
2. Publish the source on the Arc explorer using the explorer's own verification instructions. This was not done or tested from Arc Studio.
3. Have a second person independently repeat step 1 from a clean checkout.

## 6. Open points for the independent reviewer

These are the places the automated reviews and tests could not settle:

1. The raw `call` in `_send`: the 100,000 gas cap on payouts, the no-return-data design, and the deferred-credit path for recipients that fail. Check this against how Arc handles native USDC transfers to contracts, blocked addresses or special accounts.
2. Accounting under forced native value, including value sent after an order has settled (it stays in the order).
3. Whether the 365-day cap, the 1e12 granularity and the 2^128 amount bound fit your commercial limits. There is no per-order value cap.
4. Arbiter trust: the arbiter can split only the reserve, but a colluding buyer and arbiter, or supplier and arbiter, can deprive the other party of it. Choose arbiters accordingly.
5. The buyer-decision timeout pays the supplier if the buyer is silent. This is by design and must be explained to buyers.
6. Registry spam: anyone can create an order that lists another wallet as supplier or arbiter. It cannot move that wallet's funds, but interfaces must not treat registry membership as consent.
7. Event semantics: `DepositPaid` can be followed by `PayoutDeferred` for the same amount.

## 7. Point the app at your mainnet factory

In `seldra-studio/.env` (never committed):

```
VITE_NETWORK=arc-mainnet
VITE_FACTORY_ADDRESS_ARC_MAINNET=<your factory address>
VITE_FACTORY_DEPLOY_BLOCK_ARC_MAINNET=<deployment block>
```

Then `bun run build` and host the `dist/` folder. With `VITE_NETWORK=arc-mainnet` the app shows a permanent real-funds banner. Without a factory address it shows "No factory is configured" and cannot create orders.

## 8. First live use: small and supervised

1. Use three separate wallets you control for buyer, supplier and arbiter. Fund only what the test needs.
2. Create a 0.01 USDC order with the Fast test windows or your own, and walk the whole flow: accept, fund, commit evidence, approve release. Confirm every amount on the explorer.
3. Repeat once for the dispute path and once for a shipment deadline that passes.
4. Only then consider real orders, starting with low values, since there is no onchain cap.

## 9. Operations

- There is no pause switch by design. If a problem is found, the mitigation is to stop sharing the app and the factory address. Orders already created keep working under their fixed terms.
- Keep the audited commit, build settings and this runbook together so a later deployment can be reproduced exactly.
- Monitor factory `OrderCreated` events and order events from the deployment block onward. Never start a log scan from block 0.
- Publish clear user-facing terms covering the buyer-decision timeout, the arbiter's role and the fallback split.
