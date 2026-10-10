# Security policy

Seldra (formerly CargoCommit) is an experimental Arc-mainnet prototype, **not independently audited or production-safe**. Do not use real commercial funds. All Arc native USDC transactions are irreversible once finalized.

## Onchain safeguards

- Per-order buyer, supplier, arbiter, amount, split, terms hash and deadlines are immutable.
- Lifecycle and payout actions are role restricted. Settlement is state gated and uses a reentrancy guard around native-value transfers.
- The production deposit is paid immediately when the buyer funds. The reserve is settled by buyer approval, deadline claims or a bounded dispute process.
- There is no admin withdrawal, upgrade or emergency pausing mechanism. This reduces privileged control but leaves no patch path for deployed orders.
- The contract exposes an accounting invariant and remaining reserve for independent readback.

## Known trust boundaries and limitations

1. **No independent audit.** Tests and successful low-value mainnet demonstrations are not security certification.
2. **Buyer-origin spoofing at the factory.** `CargoCommitFactory.createOrder` does not require `msg.sender == buyer`, so any address can create an unsolicited order naming another wallet. The Seldra interface now checks the factory event, the creation transaction sender, immutable terms and accounting before enabling wallet actions. This is a frontend mitigation only; external contract callers are not protected by this UI gate.
3. **Shipment verification is offchain.** A cryptographic evidence hash commits to bytes, not to successful manufacture, shipment or delivery. Seldra does not validate commercial evidence or authenticate a document author.
4. **Buyer-decision timeout.** After an evidence hash is submitted, the supplier can claim the reserved payment if the buyer neither approves nor disputes before the buyer-decision deadline. This is intentional contract behavior and requires active buyer monitoring.
5. **Payout compatibility.** Native transfers use a direct value call. A supplier or buyer contract wallet that rejects a native transfer can cause funding or settlement to revert. There is no alternative recipient or pull-payment escape hatch in this deployment.
6. **Arbiter trust.** The named arbiter can choose how to divide the remaining reserve while a dispute is active. The fallback is a pre-agreed fixed split after expiry, not objective dispute adjudication.
7. **Offchain references and privacy.** PO and document references are stored locally in the user's browser (not encrypted); they are not transmitted to an application backend. Onchain hashes and transaction roles are public; predictable plaintext can be guessed from a hash.
8. **No admin rescue.** Immutable addresses and state transitions cannot be corrected or paused by the project team. Verify every counterparty address and deadline before signing.

## Review and reporting

Report potential vulnerabilities privately to repository maintainers before disclosure. Include affected source revision, reproducible steps and whether the issue can redirect, block or lock funds. Do not post private keys, API tokens or sensitive commercial evidence.

See [MAINNET_PROOF.md](MAINNET_PROOF.md) for transaction receipts and [README.md](README.md) for usage and deployed addresses.
