# CargoCommit Phase 1 specification

## Problem

An importer and overseas supplier need a small, transparent purchase-order escrow. The buyer should fund the full order once the supplier accepts the exact terms. The supplier receives an agreed deposit immediately; the contract reserves the balance until shipment evidence is committed and the buyer approves, a dispute is resolved, or a deadline path executes.

The prototype is intentionally only settlement logic. It excludes FX, NGN conversion, KYC, AI verification, lending, financing, marketplace features, tokens, and post-quantum security.

## Arc payment primitive verified before implementation

Arc mainnet was verified at the time of implementation with the official Arc documentation and read-only RPC calls.

- Mainnet RPC: `https://rpc.mainnet.arc.io`
- Chain ID: `5042` (`eth_chainId = 0x13b2`, `net_version = 5042`)
- Native asset: USDC, used for gas and native value transfers.
- Native units: 18 decimals. `msg.value`, `address(this).balance`, and `eth_getBalance` use native USDC units; `1 USDC = 1e18` native units.
- Optional ERC-20 interface: `0x3600000000000000000000000000000000000000`, with 6 decimals. It shares the underlying balance but must not be mixed directly with native 18-decimal values.
- The read-only RPC returned bytecode at the USDC interface address and `decimals() = 6`.
- The read-only RPC returned `eth_gasPrice = 0x4a817cc7e` (`20,000,001,150` wei-like native units per gas at inspection time).
- A read-only `eth_getBalance` for `0x0000000000000000000000000000000000000001` returned `0x1bc16d674ec80002` (`2.000000000000000002` native USDC), confirming the 18-decimal native balance representation.

Primary sources:

- Arc [Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc)
- Arc [Stablecoin native model](https://docs.arc.io/arc/concepts/stablecoin-native-model)
- Arc [Contract addresses](https://docs.arc.io/arc/references/contract-addresses)
- Arc [Gas and fees](https://docs.arc.io/arc/references/gas-and-fees)

CargoCommit therefore uses a payable native-value funding and payout path. It does not call `transferFrom`, `approve`, or treat the optional ERC-20 decimals as native units.

## Roles

- Buyer: creates the order, funds the exact order amount, approves shipment, opens a dispute, and receives deadline/fallback buyer payouts.
- Supplier: accepts the immutable terms, receives the deposit, submits a shipment-evidence commitment, and can claim a buyer decision timeout.
- Arbiter: an immutable address selected before deployment, limited to resolving an already-open dispute for exactly the remaining reserve. It cannot fund, alter terms, withdraw outside an open dispute, or upgrade the contract.

## Lifecycle

`CREATED → SUPPLIER_ACCEPTED → FUNDED → SHIPMENT_SUBMITTED → SETTLED`

There is one additional safety branch, `DISPUTED`, from `SHIPMENT_SUBMITTED`; it must end in `SETTLED` through arbiter resolution or deterministic fallback.

### Created

The constructor fixes buyer, supplier, arbiter, order amount, deposit percentage, fallback split, and all deadlines. The contract computes an immutable `termsHash` containing chain ID, contract address, parties, amounts, percentages, and deadlines.

### Supplier accepted

Only the designated supplier may call `acceptOrder`, and only before the funding deadline. The constructor terms cannot be changed after deployment.

### Funded

Only the buyer may call `fund`, and `msg.value` must equal the full immutable order amount. The contract computes the deposit and reserve exactly. The deposit is paid immediately to the supplier; only the reserve remains in the contract.

### Shipment submitted

Only the supplier may submit a nonzero `bytes32` evidence commitment before the shipment deadline. Document contents remain offchain.

### Settled

The buyer may approve the shipment before the buyer-decision deadline, releasing the entire reserve to the supplier. If the buyer does not decide by that deadline, the supplier may claim the reserve. Either path executes once.

## Cancellation, failure, and dispute branches

- Before funding, the buyer may cancel from `CREATED` or `SUPPLIER_ACCEPTED`. No funds are held.
- If the supplier does not submit evidence by the shipment deadline, the buyer may recover the still-reserved balance. The already-paid deposit is not clawed back by the contract; this is the commercial meaning of the deposit in this prototype.
- After shipment submission and before the buyer-decision deadline, the buyer may open a dispute with a nonzero reason commitment. Dispute opening freezes ordinary shipment approval and timeout settlement.
- The immutable arbiter may resolve an open dispute before the dispute deadline by selecting a supplier payout from the remaining reserve; the buyer receives the exact remainder.
- After the dispute deadline, anyone may execute the immutable fallback split. This prevents funds remaining inaccessible if the arbiter disappears. The fallback supplier percentage is fixed at construction.

## Financial invariants

All values below use native 18-decimal USDC units.

1. `orderAmount = depositAmount + reserveAmount`.
2. Funding requires `msg.value == orderAmount`.
3. After successful funding, `reserveRemaining == reserveAmount` and the deposit has been paid once.
4. While `FUNDED`, `SHIPMENT_SUBMITTED`, or `DISPUTED`, the contract balance is at least `reserveRemaining`; under normal execution it equals it.
5. Arc permits forced native value through `SELFDESTRUCT`. Any unexpected excess is observable through `unexpectedBalance()` and is returned to the buyer on cancellation or terminal settlement.
6. Every terminal payout satisfies `supplierPayout + buyerPayout == reserveRemaining` before setting `reserveRemaining = 0`; any forced excess is added only to the buyer payout.
7. Terminal settlement is single-use because every settlement function requires a nonterminal lifecycle state.
8. No function changes the immutable parties, terms, or deadlines.

## Evidence model

CargoCommit stores only cryptographic commitments: `shipmentEvidenceHash` and `disputeReasonHash`. Files, invoices, bills of lading, tracking records, and signatures remain offchain. A future application can define a canonical serialization and content-addressed storage workflow without changing the settlement accounting.

## Threat model

The contract protects against wrong-role calls, partial funding, early reserve withdrawal, repeated settlement, reentrancy, missing shipment deadlines, nonzero commitment omission, and dispute-window lockup.

It does not prove that evidence is truthful, make an arbiter honest, or prevent a buyer/supplier/arbiter from losing their keys. Native USDC can have Arc-specific blocklist, zero-address, and contract-recipient transfer behavior; payout failures revert the complete transaction, preserving accounting rather than silently losing funds. Arc permits forced native value through `SELFDESTRUCT`, so the contract explicitly returns unexpected excess to the buyer on every exit. There is no upgrade or admin withdrawal backdoor.

## Phase 2 creation layer

`CargoCommitFactory` is a stateless deployment layer. `createOrder` deploys one `CargoCommitOrder` with the supplied constructor terms and emits `OrderCreated` containing the new address, parties, commercial terms, deadlines, and `termsHash`. The factory has no owner, payable path, upgrade mechanism, registry mutation, or fund withdrawal function. Order discovery is event-based; no additional registry was added.

The current Arc-specific local rehearsal uses the official Arc Foundry binaries (`arc-forge`, `arc-cast`, and `arc-anvil`) with `arc-anvil --network arc`. It exercises the order and factory suite under Arc execution semantics, including native-value transfer behavior.

## Local demo plan

Use native-value units with `orderAmount = 1e18` (1.00 USDC), `depositBps = 3000`, and `fallbackSupplierBps = 5000`.

Success:

1. Deploy with distinct buyer, supplier, and arbiter addresses plus ordered deadlines.
2. Supplier accepts.
3. Buyer funds exactly `1e18`.
4. Supplier receives `0.30 USDC`; contract reserves `0.70 USDC`.
5. Supplier submits an evidence hash.
6. Buyer approves; supplier receives `0.70 USDC`; status is `SETTLED`.

Protection:

1. Fund a second order.
2. Show a supplier or arbitrary caller cannot withdraw the reserve early.
3. Show the shipment deadline refund returns only the remaining reserve to the buyer.
4. Show a dispute freezes normal settlement and the reserve remains exactly accounted for until resolution/fallback.

Phase 1 stops after local tests and audit. No frontend, mainnet deployment, or publication is included.
