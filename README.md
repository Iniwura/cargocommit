# CargoCommit

## Fund the order once. Release payment as the shipment becomes real.

CargoCommit is a programmable supplier-order settlement layer for importers. A buyer funds the full purchase order, the supplier receives the agreed production deposit, and the remaining balance stays visible and protected in an immutable Arc order contract until shipment approval or a bounded dispute path.

This is not a generic escrow, crypto wallet, FX product, invoice system, lending product, bank, or marketplace. It is experimental settlement infrastructure, not audited production software.

## Why Arc

Arc settles native USDC value directly. CargoCommit therefore uses the exact same 18-decimal native units for funding, deposit release, reserve accounting, gas, and readback. There is no ERC-20 approval flow in this prototype. The Arc-specific assumptions and deployment controls are documented in [DEPLOYMENT.md](DEPLOYMENT.md).

## Product flow

1. Buyer creates an order with a supplier, arbiter, total amount, deposit split and deadlines.
2. Supplier accepts the exact immutable terms.
3. Buyer funds the full amount. The production deposit is paid immediately; the remainder is held by the order contract.
4. Supplier submits a cryptographic shipment-evidence commitment. The underlying document remains offchain.
5. Buyer approves shipment and releases the protected balance, or opens a dispute.
6. The designated arbiter resolves the reserved balance, with a deterministic fallback after the dispute deadline.

The contract has no owner, admin, upgrade path, registry custody, or arbitrary fund-take function. State transitions are role-gated and every exit path is bounded by a deadline.

## Live Arc proof

Factory: [`0x934159C33C25D0b2e27B237b4cA603D85F019Cf3`](https://explorer.arc.io/address/0x934159C33C25D0b2e27B237b4cA603D85F019Cf3) · chain ID `5042`

- Demo A: [1.00 USDC order](https://explorer.arc.io/address/0x60958fd86d2d52670181afb4097d1b280a37848c), 0.30 production deposit, 0.70 held then released, final `SETTLED / SUPPLIER_PAID`.
- Demo B: [0.01 USDC dispute order](https://explorer.arc.io/address/0x6ff65de6016d9e1083b2f7d7e3abaff1ab2c9201), 0.003 deposit, 0.007 protected reserve, premature release and release-while-disputed both reverted, final `DISPUTE_RESOLVED`.

The full receipt-by-receipt evidence is in [MAINNET_PROOF.md](MAINNET_PROOF.md), including the synthetic evidence fixture at [fixtures/demo-b/shipment-evidence.json](fixtures/demo-b/shipment-evidence.json).

## Frontend

The Phase 4 frontend lives in [`frontend/`](frontend/). It is a read/write Arc mainnet client, not a mock dashboard:

- reads the live factory and order contracts with `viem`;
- discovers orders from `OrderCreated` events;
- gates actions by the immutable buyer, supplier and arbiter roles;
- waits for receipts and surfaces transaction links to the Arc explorer;
- keeps document contents offchain and only hashes typed evidence references locally before sending the commitment.

Run it locally:

```sh
cd frontend
npm install
npm run dev
```

The browser wallet must be switched to Arc mainnet (chain ID `5042`). The UI never requests or stores a private key.

## Validation

```sh
forge fmt --check
forge build
forge test -vv
forge lint
FOUNDRY_PROFILE=arc arc-forge test --network arc -vv

cd frontend
npm run typecheck
npm test
npm run lint
npm run build
```

## Limitations

- A lost buyer, supplier or arbiter credential can prevent the intended action; the contract only exposes the documented deadline exits.
- A compromised role wallet can authorize the actions available to that role.
- The live proof uses synthetic references and tiny values; it is not a commercial shipment workflow.
- The contract and frontend have not received an independent production audit.

See [SPEC.md](SPEC.md) for the lifecycle, accounting invariants and threat model, [SECURITY.md](SECURITY.md) for responsible disclosure, and [MAINNET_PROOF.md](MAINNET_PROOF.md) for reproducibility.
