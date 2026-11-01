# Seldra Studio — Testnet demo & evidence pack

> **Release scope:** Arc Testnet, chain ID `5042002`. This is a new Arc Studio implementation derived from the Seldra/CargoCommit concept. It is **not** the original mainnet deployment. No new mainnet contract or real-USDC transaction is claimed.
> **Release source:** `arc-studio/seldra-release` in [Iniwura/cargocommit](https://github.com/Iniwura/cargocommit/tree/arc-studio/seldra-release). Core contracts remain the tested versions from commit `e334a58ccbeb99d4ae95a60b98e50a3a46f2ecef`; subsequent documentation and hosting configuration changes do not alter them.

## Short project description — ready to paste

**Name:** Seldra Studio

**One line:** Fund supplier orders once; release the balance as shipment evidence arrives.

**Description (testnet-only, factual):**

Seldra Studio is an experimental supplier-order settlement app built in Arc Studio and deployed on Arc Testnet. Buyers create immutable orders, suppliers accept the terms, and the buyer funds native test USDC. The supplier receives a production deposit while the remaining reserve stays protected in the order contract. Shipment-document hashes, buyer approval, disputes, arbiter resolution and deadline exits determine how the reserve is settled. The app reads an onchain order registry and event history without an indexer. This release is unaudited and has not been tested through a real browser-wallet interaction.

**Why Arc:** Native USDC is the settlement unit for the buyer's deposit, the protected reserve and contract payouts. Seldra's onchain roles, deadlines and event records make each financial transition traceable.

**Builder:** [Iniwura](https://github.com/Iniwura).

**App:** https://seldra-studio-testnet.vercel.app

**Code:** https://github.com/Iniwura/cargocommit/tree/arc-studio/seldra-release

**Recorded testnet factory:** https://explorer.testnet.arc.io/address/0x1ddac1a17d437a43ba09591d338954516721f0a7

## 90-second walkthrough — production script

This is a **recording plan and narration**, not an assertion that a video was recorded or that the browser UI has passed manual testing. Use live captures of the deployed app and the explorer; do not mock transactions or fabricate UI screenshots.

| Time | Visual to record | Voiceover |
|---|---|---|
| 00:00–00:12 | Open Seldra Studio homepage; show the Arc Testnet label and 4-step product flow. | “A supplier needs working capital before shipping. A buyer needs control over the remaining payment. Seldra lets them agree on both, in one onchain order.” |
| 00:12–00:24 | Open **New order**. Show buyer/supplier/arbiter fields, 30% deposit and 70% reserve preview. Do **not** broadcast. | “The buyer fixes the parties, amount, deposit split and deadlines. The terms cannot be changed after creation.” |
| 00:24–00:45 | Paste Order A's address into **Open an order by address**; show the settled order sheet, reserve bar and history if it renders successfully. | “Our Arc Testnet run funded 0.10 test USDC. The supplier received 0.03 as a production deposit; the remaining 0.07 stayed reserved until the buyer approved shipment evidence.” |
| 00:45–00:58 | Open the factory, funding and release transactions in Arc Testnet Explorer. | “These are actual testnet transaction records, not simulated payment animations. The order settled and its balance returned to zero.” |
| 00:58–01:12 | Open Order B and the arbiter-resolution transaction. | “Disputes freeze unilateral release. The designated arbiter can allocate the protected balance, with deadline fallbacks if a party is silent.” |
| 01:12–01:24 | Show automated test report and 50/50 live testnet run summary. | “The implementation has 154 passing Foundry tests, including fuzzing and invariants, plus 50 passing live testnet checks across four orders.” |
| 01:24–01:30 | Return to the homepage, show project link and visible testnet label. | “Seldra Studio is an experimental, unaudited testnet prototype. The contracts and evidence are public.” |

**Recording quality bar:** Landscape 16:9, 1080p, actual browser capture, natural steady narration, readable transaction details. Hide personal browser tabs, auth credentials and unrelated wallet balances. If a screen or interaction fails, stop and fix it; do not replace failures with mock footage.

## Proof index — Arc Testnet only

| Evidence | Address / transaction | What it supports |
|---|---|---|
| Factory deployment | [Factory](https://explorer.testnet.arc.io/address/0x1ddac1a17d437a43ba09591d338954516721f0a7) | New SeldraFactory on Arc Testnet. Final factory bytecode was compared with the compiled source in the release verification record. |
| A — complete buyer/supplier settlement | [Order A](https://explorer.testnet.arc.io/address/0x2599BFE63D8e03E7361648838c7543f5695029E2) | Recorded 0.10 test-USDC order, 0.03 deposit, 0.07 reserve and settled status. |
| A — funding | [Transaction](https://explorer.testnet.arc.io/tx/0xd20015d098ea49e4d66d247bc9e615a38a735a40baf932db28b5d6b182023c4c) | Buyer funded the test order; the recorded checks observed supplier's 0.03 test-USDC deposit. |
| A — approval / release | [Transaction](https://explorer.testnet.arc.io/tx/0x080221084beeb0846ff957f2a366c793c4a592a4275eb0517bcfabe58203393a) | Release of the protected 0.07 test-USDC reserve and final settlement. |
| B — dispute and arbiter | [Order B](https://explorer.testnet.arc.io/address/0x1f111D33C0B18CC7aC5eb5A8c9F4E770A7334327) | Dispute and final resolution path. |
| B — arbiter resolution | [Transaction](https://explorer.testnet.arc.io/tx/0x5fded2e7f09f7679e98cb35d07f0107d0c860b01dd75a7a50098e8d46f809d6b) | Arbiter allocated 0.04 of the 0.07 test-USDC reserve to the supplier. |
| C — missed shipment | [Order C](https://explorer.testnet.arc.io/address/0x214F5fA11C9f53E337F6E6CC071F88736FEb1A86) | Shipment-deadline refund test case. |
| D — cancellation | [Order D](https://explorer.testnet.arc.io/address/0x922e8cdBe827C6D6a86ff998B14930855555ff91) | Pre-funding cancellation test case. |

**Evidence files:** [testnet run 2 (50/50)](https://github.com/Iniwura/cargocommit/blob/arc-studio/seldra-release/microgrant/evidence/testnet-e2e-run2.json), [release verification](https://github.com/Iniwura/cargocommit/blob/arc-studio/seldra-release/microgrant/FINAL_VERIFICATION_REPORT.md), [development record](https://github.com/Iniwura/cargocommit/blob/arc-studio/seldra-release/microgrant/DEVELOPMENT_RECORD.md).

## Release/claim ledger

| Claim | Status |
|---|---|
| Contracts built in Arc Studio | Reported and documented; dedicated writing step declined, Arc Studio agent wrote Solidity directly |
| Contract tests | 154 passed on final source in recorded verification logs |
| Automated security review | Completed; **not an independent professional audit** |
| Live Arc Testnet contract operations | 50/50 passed in recorded scripted run |
| Public frontend | Vercel returned `READY` for the configured testnet build; actual public browser accessibility and UI interaction have not been independently observed |
| Wallet click-through and mobile | **Unverified**, not assumed as evidence |
| Dependency advisories | **Open: 3 high, 3 moderate** in the recorded Bun audit; require remediation/re-audit |
| New Seldra Studio contracts on Arc mainnet | **Not deployed** |
| Real USDC through the new contracts | **No**; all newly recorded transactions are testnet faucet funds |
| Shareable Arc Studio project URL | **Missing**; private preview host is not a substitute |
| Actual walkthrough video | **Not recorded**; script above only |

## Submission eligibility

**Arc Microgrants 2 (November 1, 2026): NOT ELIGIBLE AS-IS.** It requires an Arc Studio-built app deployed on **Arc mainnet** and at least one transaction moving **real USDC** through the submitted contracts and app. Testnet-only evidence is not a replacement. The missing Arc Studio project URL and walkthrough also prevent a complete submission.

Do **not** submit this testnet packet to Arc Microgrants 2 as if it met the mainnet requirements. Do not reuse transactions from the original CargoCommit deployment as proof that the new Studio contracts moved real USDC. A future opportunity that explicitly accepts testnet prototypes can use this pack once its own rules are checked.

## Before claiming a public product

1. Revoke the broad GitHub OAuth authorization retained in the old Arc Studio sandbox, or at least confirm it is fully revoked rather than only logged out.
2. Reassess/remediate the six transitive dependency advisories and run `bun audit`, typecheck, lint, tests and a fresh build.
3. Check direct `/order/<address>` URLs, normal navigation, explorer links, wallet connect/disconnect and wrong-chain behavior on actual desktop/mobile browsers.
4. Record the demo from real screens and preserve the explorer evidence in the finished video.
5. Obtain an independent professional contract audit before any new mainnet deployment involving real funds.
