# Seldra · Arc Microgrants submission packet

**Program:** [Arc Microgrants](https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq)  
**Application:** https://dorahacks.io/hackathon/arc-microgrants/detail  
**Deadline:** October 14, 2026, 23:59 Eastern Time (verify the displayed countdown before submitting)  
**Status:** Draft only. This file does not mean an application has been submitted.

## Project

**Name:** Seldra  
**One-liner:** Purchase-order settlement with an upfront production deposit and a protected shipment balance on Arc.

**Short description (paste-ready):**

Seldra is an experimental supplier-order settlement application deployed on Arc mainnet. A buyer creates immutable purchase-order terms naming a supplier and arbiter, then funds the order in Arc's native USDC. The contract immediately pays the agreed production deposit to the supplier and keeps the remaining balance reserved. Shipment evidence is committed by hash. The buyer can release the reserve after reviewing the shipment or open a dispute for the designated arbiter to resolve. Deadline-based exits and transparent contract accounting make the settlement process publicly inspectable.

The demo includes working buyer, supplier and arbiter views, real Arc mainnet creation and settlement transactions, a dispute-resolution path, and a public order archive. It is an unaudited prototype using synthetic evidence, not a verification service for actual delivery or a production trade-finance provider.

**Why Arc:** Arc's native USDC is used directly as the payment principal, deposit, held balance and gas asset. The product demonstrates deterministic stablecoin settlement with contract-based roles, explicit deadlines and public receipts on Arc mainnet.

## Submit these links

- **Live app:** https://seldra.vercel.app
- **Code:** https://github.com/Iniwura/cargocommit
- **Factory (Arc mainnet, chain ID 5042):** https://explorer.arc.io/address/0x934159C33C25D0b2e27B237b4cA603D85F019Cf3
- **Mainnet proof:** https://github.com/Iniwura/cargocommit/blob/master/MAINNET_PROOF.md
- **Security and limitations:** https://github.com/Iniwura/cargocommit/blob/master/SECURITY.md
- **Builder profile:** https://github.com/Iniwura

## Transactions judges can independently inspect

**A. Funded order and supplier settlement.**

- Contract: https://explorer.arc.io/address/0x60958fd86d2d52670181afb4097d1b280a37848c
- Order value: 1 native USDC. Deposit paid to supplier: 0.30; protected reserve later released: 0.70.
- Final state: SETTLED, outcome SUPPLIER_PAID.

**B. Dispute and reserve protection.**

- Contract: https://explorer.arc.io/address/0x6ff65de6016d9e1083b2f7d7e3abaff1ab2c9201
- Order value: 0.01 native USDC. Deposit: 0.003; held reserve: 0.007.
- Premature approval and approval during dispute reverted; the designated arbiter resolved the reserve.
- Final state: SETTLED, outcome DISPUTE_RESOLVED.

**C. Independent browser-wallet creation.**

- Successful create transaction: https://explorer.arc.io/tx/0x6b2ce2c5d43f5a68aca384bae810aefd2aa0fd6962a2d4f211c4bf7ce267137b
- Created order: https://explorer.arc.io/address/0x7BE2440da225495735957B4b206A4ab4998372Fa
- This is an unfunded CREATED example, **not** another settled order.

Read [MAINNET_PROOF.md](MAINNET_PROOF.md) for receipt hashes, block numbers, state transitions and balance accounting.

## Suggested evaluation walkthrough (no new funding required)

1. Open the live homepage and see the native-USDC 30/70 settlement explanation.
2. Open **Proof** to inspect the real settlement and dispute records.
3. Open **Orders** and connect a wallet associated with the demonstrated orders. The historical index discovers the buyer, supplier and arbiter roles from factory events.
4. Open either settled order. Inspect current status, immutable parties, deadlines, balance accounting and lifecycle receipts.
5. Open **Create Order** to demonstrate the 4-step form and pre-signature preview **without broadcasting a transaction**.
6. Show a browser-wallet-created order and its public Arc Explorer creation transaction.

## Release qualification

- Contract tests, frontend tests, lint, typecheck and CI should pass on the exact submitted Git commit.
- Confirm that the URL is publicly accessible, independent of developer sign-in.
- Check index freshness, cross-wallet history, direct links and browser wallet disconnect on the exact production deployment.
- Check that pending submissions are recoverable after reload without accidentally sending another transaction.
- Confirm the app matches the factory address and chain ID above.
- Do not submit until unresolved critical failures are either fixed or clearly disclosed.

## Scope and risks

- Experimental, **unaudited** prototype; no claim of commercial production safety.
- Shipment-evidence hash proves a commitment, **not** physical delivery or independent document authenticity.
- Production deposit is irreversible once disbursed. Contract payments may revert for recipient contracts rejecting native value.
- Third parties can create unsolicited factory orders naming another buyer; the Seldra UI verifies that the declared buyer actually originated the creation transaction before enabling writes.
- Wallet order discovery depends on a generated historical catalog and recent RPC catch-up. Schedules are best effort; show stale/unavailable data honestly.
- Neither the design nor this packet guarantees a grant or reviewer selection.

## Required submission actions

- Log into DoraHacks and paste the short description and project links.
- Provide the public builder profile and any organizer-requested verification information.
- Confirm no previous Circle/Arc program has funded this same work, and that the submitter has the right to submit it.
- Review the final project page and submit **once**, before the deadline.
- Save the actual DoraHacks submission confirmation URL or receipt. **Not yet submitted.**
