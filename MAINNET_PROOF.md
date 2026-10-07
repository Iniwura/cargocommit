# CargoCommit Demo A — Arc Mainnet Proof

This is a local evidence record for the controlled Demo A and Demo B runs.

## Network and contracts

- Network: Arc mainnet
- Chain ID: `5042`
- Factory: `0x934159C33C25D0b2e27B237b4cA603D85F019Cf3`
- Factory deployment transaction: `0x8b8a80db049f82f621dfebce68145a8d60480aec50d7d9d452c9d0e0d5040b37`
- Factory deployment block: `24570195`
- Factory deployment gas: `3050403`
- Factory runtime bytes: `14028`
- Factory runtime SHA-256: `a98b414864764da399efbf8b4d564dbba930038f4aca625f8b2ab97f5035a6ec`
- CargoCommitOrder source SHA-256: `b7297b2157ea6e7bcc5617f6e1abf09688f90ca619400a8a8687f80d6f41b241`
- CargoCommitFactory source SHA-256: `fcc4053ae9e162ed76aa866681bcf1c900376bf301f74f45ad81cc52452d0d16`

The deployed factory has no owner function and storage slot zero is zero.

## Demo A order

- Order: `0x60958fd86d2d52670181afb4097d1b280a37848c`
- Buyer: `0x5c526D2c665147Fab7849353DC65970879379Bb2`
- Supplier: `0x62050Fc83a8d0039c089cECf9340CfE92F87B76C`
- Arbiter: `0x2000000000000000000000000000000000000002`
- Order amount: `1000000000000000000` (1.00 native USDC)
- Deposit: `300000000000000000` (30%)
- Reserve: `700000000000000000` (70%)
- Funding deadline: `1900000000`
- Shipment deadline: `1900001000`
- Buyer decision deadline: `1900002000`
- Dispute deadline: `1900003000`
- Terms hash: `0xeb8c535f936d6acee8d00c29110523d90c3fd1483d9f3f91beeb83b513cc01f8`
- Synthetic evidence hash: `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`

## Transaction evidence

| Step | Transaction | Block | Gas | State before → after | Contract balance after |
|---|---|---:|---:|---|---:|
| Supplier gas reserve (setup) | `0x9fc0487e46e4e48cf72c5459810b0a550483c11b7e83171b03238612e18d942a` | 24575578 | 21000 | external setup | n/a |
| Create order | `0xd3cced0fbb37663b8aef4ede48b885e25c559ee09ca6ca5452790d01a5bd9e96` | 24575647 | 2129462 | CREATED | 0 |
| Supplier accepts | `0x2813868f515a996237b919f9edd5f8df8af3e91fbc4af751df80c939dde1d4c5` | 24575797 | 67096 | CREATED → SUPPLIER_ACCEPTED | 0 |
| Buyer funds | `0x9bed50e6aa00e8858be68a827f6d0ee8ccbde29a818a65f2181fc53bab77efba` | 24575892 | 86313 | SUPPLIER_ACCEPTED → FUNDED | 700000000000000000 |
| Supplier submits evidence | `0x2fa9d410021330005f214d17d190751476aeea895bbae4f6418ef32bdc71fccf` | 24575951 | 75635 | FUNDED → SHIPMENT_SUBMITTED | 700000000000000000 |
| Buyer approves shipment | `0x052ea8399ba915b96be547a113f8cb1d5f4f730507d82867e0f536cf2a628705` | 24576026 | 64837 | SHIPMENT_SUBMITTED → SETTLED | 0 |

All listed transactions succeeded. The attempted second `approveShipment()` was a read-only call after settlement and reverted as expected.

## Accounting proof

- After funding: tracked reserve `700000000000000000`; actual order balance `700000000000000000`.
- Funding supplier principal delta: `+300000000000000000`.
- Final supplier principal delta on approval: `+700000000000000000`.
- Total supplier principal received: `1000000000000000000`.
- Buyer principal delta on funding: `-1000000000000000000`.
- Buyer principal delta on approval: `0`.
- Final tracked reserve: `0`.
- Final actual order balance: `0`.
- Final status: `SETTLED` (`5`).
- Final outcome: `SUPPLIER_PAID` (`3`).

Gas is excluded from the principal deltas. Demo A lifecycle gas was `2423343`; including the separate supplier gas-reserve transfer, the run used `2444343` gas. Including factory deployment, the recorded deployment-plus-Demo-A total was `5494746` gas.

Final balances after Demo A:

- Buyer/deployer: `382959693193691560` wei native USDC.
- Supplier: `1007145379857126269` wei native USDC.

## Demo B pre-execution budget

Before execution, at gas price `20000001001` wei, the measured Demo B path including expected reverts was `2543415` gas. Using a 2.5x gas margin, a `0.01` native-USDC arbiter gas reserve, and retaining `0.10` native USDC in the buyer wallet, the calculated maximum Demo B order value was `144738936776243023` wei (`0.144738936776243023` native USDC). The executed value was the recommended `10000000000000000` wei (`0.01` native USDC).

## Demo B — live dispute protection proof

- Order: `0x6ff65de6016d9e1083b2f7d7e3abaff1ab2c9201`
- Buyer: `0x5c526D2c665147Fab7849353DC65970879379Bb2`
- Supplier: `0x62050Fc83a8d0039c089cECf9340CfE92F87B76C`
- Dedicated arbiter: `0x4b953a840F79d9b487a748b0Fd168010c89fc2Ae`
- Order amount: `10000000000000000` (0.01 native USDC)
- Deposit: `3000000000000000` (0.003 native USDC)
- Reserve: `7000000000000000` (0.007 native USDC)
- Terms hash: `0x598fc3b6d3f0488987522510f4cde3d2f20505e624b1c45720d39186b992a19c`
- Funding deadline: `1791302340`
- Shipment deadline: `1791305940`
- Buyer decision deadline: `1791309540`
- Dispute deadline: `1791313140`
- Evidence fixture: `fixtures/demo-b/shipment-evidence.json`
- Evidence fixture SHA-256 / onchain commitment: `e1c737b476c7b6431fbb3a5b8376c7f67757bcc7e517531f6fc1ae49800d7413`
- Synthetic dispute-reason commitment: `0x83ab791b7d1ea81008d90e355dab366513ae3ce1423d765950b9d047a68af98e`

| Step | Transaction | Block | Gas | State/result | Reserve or contract balance |
|---|---|---:|---:|---|---:|
| Arbiter gas reserve (setup) | `0x82cbc695338a3bc6c54bb791a6148fdbdd27193408438e1d8afc0a29a84aaf35` | 24578074 | 21000 | arbiter funded with 0.005 | n/a |
| Create order | `0xd04bcb536bd3668483ac0c4a6c042fed6bfd1c3e93d948ce34a10d218e368af8` | 24578118 | 2129678 | CREATED | 0 |
| Supplier accepts | `0xfa4d9b4375ffdf0171e4fea9a951dabe1312e66ccd40b43e6a79644e51e9dc76` | 24578204 | 67096 | CREATED → SUPPLIER_ACCEPTED | 0 |
| Buyer funds | `0x4a9e8f1412cde52d6736cc7f012e3407b2be7cd78c6f51349d32d8fc4a114b03` | 24578263 | 86313 | SUPPLIER_ACCEPTED → FUNDED | 0.007 |
| Supplier premature approval | `0xf4ab27fd86bf9490330652d654785d6d37f9d8a4dd8e8a02393f5dd3239e491e` | 24578326 | 21388 | reverted; state unchanged | 0.007 |
| Supplier submits evidence | `0x32d3b18030eff9c73dc8f784993780404ba2682e32216d9e27a61a0f6c945005` | 24578403 | 75635 | FUNDED → SHIPMENT_SUBMITTED | 0.007 |
| Buyer opens dispute | `0xc62f699444de8f83704c2c0c33b0005c676deddddb3a43962e227e93ed838b06` | 24578487 | 51091 | SHIPMENT_SUBMITTED → DISPUTED | 0.007 |
| Buyer approval while disputed | `0x2d9a35edc7f776e0b6e87f74cdb90b9d223677d14482c1a5627871c0898526d4` | 24578539 | 28634 | reverted; state unchanged | 0.007 |
| Arbiter resolves 50/50 | `0x628a229bce0f7a0517417f225b9b7a9161b4049df690d690a99b4b74f6e3b817` | 24578642 | 75188 | DISPUTED → SETTLED | 0 |

All successful transactions had receipt status `0x1`; both protection transactions had receipt status `0x0`.

Demo B accounting:

- After funding: supplier principal `+3000000000000000`; tracked reserve `7000000000000000`; actual order balance `7000000000000000`.
- After the premature-release revert: state and both reserve values were unchanged.
- After dispute: state was `DISPUTED`; tracked reserve and actual balance remained `7000000000000000`.
- Arbiter resolution: supplier principal `+3500000000000000`; buyer principal `+3500000000000000`.
- Final reserve and actual order balance: `0`.
- Final status: `SETTLED` (`5`).
- Final outcome: `DISPUTE_RESOLVED` (`4`).
- Read-only repeat resolution and repeat settlement calls both reverted.

Demo B gas was `2535023` for the order path, or `2556023` including arbiter funding. Gas is excluded from principal deltas.

Final balances after Demo B:

- Buyer: `325125063371467951` wei native USDC.
- Supplier: `1010362994228261289` wei native USDC.
- Arbiter: `3496234664809896` wei native USDC.

## Validation context

- Foundry tests: `26/26` passed.
- Arc Foundry tests: `26/26` passed.
- Invariant campaign: `256` runs, `128000` calls, zero failures.
- Demo B: completed successfully.
- Phase 4 frontend: built locally; GitHub publication: not started.
