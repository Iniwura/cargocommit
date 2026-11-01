# Seldra (Arc Studio implementation): development record

Prepared for an Arc Microgrants 2 application. Date of work: 1 November 2026.

This record states what was generated, tested and deployed inside Arc Studio, what was not, and where the evidence is. It claims no mainnet deployment, no payment and no security verification, because none exists. Every claim below points at a file or an onchain record you can check yourself.

## 1. What this is

A new implementation of Seldra, the supplier-order settlement product originally built as CargoCommit (<https://github.com/Iniwura/cargocommit>). A buyer funds a purchase order in native USDC on Arc. The supplier is paid a production deposit at funding. The remaining reserve stays in the order contract until shipment evidence is committed and the buyer approves release. Deadlines bound every exit.

It is separate from the existing Seldra production deployment. Nothing in the original repository was edited, moved or deleted (section 8).

## 2. Provenance, stated plainly

- The product concept, the roles (buyer, supplier, arbiter), the deposit and reserve split, the deadline structure and the visual identity (paper and ink palette, one signal colour, lowercase "seldra." wordmark, serif numerals, the proportional deposit and reserve bar) come from the original CargoCommit repository, which is MIT licensed.
- The Solidity in `contracts/` was written fresh during this session. It follows the original's design but is not a copy, and its interfaces differ (section 3).
- The existing deployed CargoCommit and Seldra contracts were not created with Arc Studio and this record makes no such claim.
- Authorship of the contracts: the specialist contract-writing step declined the job, because its rules require extending Solidity that already exists in the project and the imported CargoCommit sources were present. The Arc Studio agent then wrote `SeldraOrder.sol` and `SeldraFactory.sol` directly, in the same session. Reviews and tests below were run by separate steps on the finished files.

## 3. What was built

### Contracts (`contracts/`, own Foundry project, Solidity 0.8.35, Cancun EVM, optimizer 200)

| File | Purpose |
| --- | --- |
| `SeldraOrder.sol` | One order. Immutable terms, role-gated workflow, deadline-bounded exits, reentrancy lock, balance accounting |
| `SeldraFactory.sol` | Creates orders with the caller as buyer. Holds no funds. Keeps an onchain registry so no indexer is needed |

Differences from the original design, each made deliberately:

- The buyer is always the factory caller. Nobody can create an order that names someone else as buyer.
- A payout to a party whose address rejects the transfer is credited and pulled later with `withdraw()`. A rejecting party cannot block settlement or the other party's money. Payouts use a fixed gas cap and a raw call that never copies return data.
- `orderAmount` must be a whole multiple of 1e12 native units, so it is exactly representable in Arc's 6-decimal USDC view, and at most 2^128 - 1.
- A committed hash of the offchain purchase-order document is part of the terms hash. The order records its creation block so history can be read with bounded log queries.
- After the funding deadline anyone can close an order that was never funded.
- One call, `orderSummary()`, returns the whole order for the UI.

### Frontend (`seldra-studio/`, Vite, React, TypeScript, wagmi, viem)

Pages for the order register, order creation, and an order detail view with a role-aware next step, deadlines, commitments, a balance check and a settlement history rebuilt from the order's own event logs. Browser wallets only (EIP-6963 and injected). Only hashes of evidence and dispute reasons go onchain; files are hashed in the browser.

## 4. Reviews performed in Arc Studio

| Review | Result |
| --- | --- |
| Rule-based security review, most thorough tier, target Arc Testnet | One Low finding: custom errors lacked context parameters. Fixed |
| Functional and adversary review, most thorough tier | No material findings |
| Static analysis (Slither) | 0 High, 1 Medium (a benign `amount == 0` early return), 11 Low (deadline comparisons, inherent to the product), 1 Informational (the raw-call assembly). Detail in `evidence/slither-summary.txt` |

Honest limits of these reviews:

- They are automated, run inside Arc Studio, and are not an independent audit.
- The first pair of reviews ran on the first complete version. Three small edits followed: error parameters (that review's own Low finding), renaming an event field that is becoming a Solidity keyword, and an explicit `uint128` cap on the order amount.
- A second pair of reviews was run for the final release on the exact final source (hashes in `evidence/final/source-hashes.txt`), with those three edits called out. The functional review found no regression and no material finding. The rule-based review reported one Low finding: the validation errors `InvalidAddress`, `InvalidAmount`, `InvalidBps` and `InvalidDeadlines` carry no parameters, so a failed creation does not say which condition failed. It does not affect authorization or funds. It was deliberately not fixed: changing the Solidity would change the bytecode and break the match with the deployed, live-tested testnet factory. It is listed for the independent auditor and can be fixed in a later version.

## 5. Tests

### Contract tests (`contracts/test/`, run with `cd contracts && forge test`)

154 tests pass, 0 fail: 149 unit and fuzz tests (512 fuzz runs each) and 5 invariants (256 runs, about 30,700 calls each, 0 reverts). Full log: `evidence/forge-test.log`.

Coverage written for this project:

- Positive paths: full happy path, shipment-deadline refund, buyer-decision timeout, dispute resolved by the arbiter, dispute fallback, cancellation, registry contents and event fields.
- Role authorization: every function against every wrong role and every wrong status.
- Immutable terms: no setters; constructor validation for addresses, amounts, percentages and deadline order.
- Deadlines: behaviour exactly at and one second after each deadline.
- Adversarial: reentrancy from hostile supplier, buyer and arbiter contracts on every payout path; recipients that revert, burn all gas, or return very large data; forced native value before and after settlement; direct transfers and unknown calls; wrong funding amount; double settlement; races between approving and disputing; spam orders naming a victim.
- Conservation: fuzzed over amounts, splits, paths and recipient behaviours, supplier plus buyer plus credits always equal the order amount plus any forced value.
- Invariants: balance always covers reserve plus credits; terms never change; no value leaves except to the buyer, the supplier or credited recipients.

Known, accepted behaviour found while testing, not defects: value force-sent to an order after it has settled stays there; `DepositPaid` is emitted before the send, so a deferred deposit also emits `PayoutDeferred`, which is the source of truth for what was actually paid.

### Frontend checks (`seldra-studio/`)

`bun run typecheck`, `bun run lint` and `bun test tests` pass (18 tests covering money conversion, term validation, deadline building, role detection, next-step gating and log range splitting). `bun run build` succeeds.

### Live Arc Testnet tests

Factory: `0x1ddac1a17d437a43ba09591d338954516721f0a7` (chain 5042002, deployed in block 70177207, transaction `0x5fd2bdebb9cba73591c74faf311c6a5d137ffe68585fda02eabfe3b209dee7f4`). Explorer: <https://explorer.testnet.arc.io/address/0x1ddac1a17d437a43ba09591d338954516721f0a7>

- `scripts/verify-deployment.ts` confirms the code at that address is byte-for-byte the code compiled from the current sources (`evidence/verify-deployment-testnet.log`).
- `scripts/testnet-e2e.ts` ran the whole scenario against the live factory with three throwaway test wallets (buyer, supplier, arbiter) generated in the sandbox and funded from the testnet faucet. No key was shown, requested or stored in the repository.
  - Run 1 (`evidence/testnet-e2e-run1.json`, `.log`): 51 of 52 checks passed. The one failure was a mistake in the test, not the contract: the check asked the supplier to attempt a funding call with more USDC than the supplier held, so the wallet simulation failed on balance before reaching the role check. The test was corrected.
  - Run 2 (`evidence/testnet-e2e-run2.json`, `.log`): 50 of 50 checks passed, with transaction hashes for every step. It covers four orders: A happy path (deposit and reserve amounts verified by balance change), B dispute resolved by the arbiter, C shipment deadline passes and the buyer reclaims the reserve, D cancelled before funding. It also includes 13 expected reverts (wrong role, wrong state, wrong amount, early and late deadline calls, over-large payout, double settlement) and checks that each settled order holds nothing and passes its accounting check.
  - Run 2 orders: A `0x2599BFE63D8e03E7361648838c7543f5695029E2`, B `0x1f111D33C0B18CC7aC5eb5A8c9F4E770A7334327`, C `0x214F5fA11C9f53E337F6E6CC071F88736FEb1A86`, D `0x922e8cdBe827C6D6a86ff998B14930855555ff91`.
- `scripts/verify-reads.ts` runs the UI's own registry, summary and event-history code against the live testnet and lists the history of every order (`evidence/verify-reads.log`).

Testnet funds only. No real value was involved.

## 6. Mainnet status

- Not deployed. Nothing from this project exists on Arc mainnet.
- Not independently audited.
- The frontend can be pointed at mainnet by configuration, and `MAINNET_RUNBOOK.md` describes how you would deploy and verify it yourself. Arc Studio does not deploy to or transact on mainnet, and none of the evidence above comes from mainnet.

## 6a. Final release checks

`microgrant/final-verify.sh` re-runs everything against the current source and writes logs to `microgrant/evidence/final/`. The report is `FINAL_VERIFICATION_REPORT.md`. Mainnet configuration exists in the app (`VITE_NETWORK=arc-mainnet`, own factory address required) but nothing was deployed or broadcast.

## 7. Links

- Source: new directories `contracts/`, `seldra-studio/` and `microgrant/` in this project workspace. They are uncommitted and not pushed anywhere yet. Push to your own repository before applying, and link that repository.
- Public app: none yet. The preview inside Arc Studio is private to the session. Deploy the frontend to a host you control before applying (see `seldra-studio/README.md`), and set the factory address in `.env` first.
- Testnet factory and orders: the explorer links in section 5.
- Original project: <https://github.com/Iniwura/cargocommit>

## 8. Original deployment left untouched

`git status` shows only three new untracked directories (`contracts/`, `microgrant/`, `seldra-studio/`) and one new untracked file, `AGENTS.md`. No tracked file changed. Side effects outside tracked files: at the start of the session the original frontend's dependencies were installed and the original Foundry tests were run once, which refreshed the ignored `out/` and `cache/` build folders. No transaction was sent to any existing Seldra or CargoCommit contract, and no key was requested or exposed.

## 9. What remains

See `INCOMPLETE_AND_UNVERIFIED.md` for the full, requirement-by-requirement list.
