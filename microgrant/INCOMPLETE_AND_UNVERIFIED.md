# Incomplete and unverified items

Requirement by requirement, as of 1 November 2026. "Done" means there is evidence in this folder or in the code.

| # | Requirement | Status | Detail |
| --- | --- | --- | --- |
| 1 | Inspect the repository, keep the concept and design identity | Done, with a gap | Concept, roles, split, deadlines and visual identity are kept. The original landing page (hero exhibition, proof certificates, Demo A and Demo B sections) was not reproduced. The new UI is the focused workflow only |
| 2 | Generate and test contracts in Arc Studio; no claim about the old deployment | Done, with a note | Written and tested in this session. The dedicated writing step declined the job, so the Arc Studio agent wrote the files directly (see DEVELOPMENT_RECORD section 2). The old contracts are not claimed |
| 3 | Workflow: create, accept, fund, evidence, approve, history | Partly verified | Every step is implemented in the UI. The contract side of each step was run live on testnet by script (run 2: 50 of 50). The UI's write buttons were not exercised by me through a real browser wallet. The UI's read and history code was run live against testnet |
| 4 | Authorization, immutable terms, deadlines, reentrancy, conservation, positive and adversarial tests | Done | 154 passing tests plus 5 invariants. Not independently reviewed |
| 5 | Professional responsive frontend, real reads, wallet connection, transaction status, explorer links | Partly verified | Built with real reads, honest transaction states and explorer links. Typecheck, lint, unit tests and the production build pass. There was no browser in the sandbox, so I did not visually check any screen or the mobile layout. Only injected browser wallets are supported (no WalletConnect or mobile deep links). The bundle is large (about 630 kB) |
| 6 | Test on Arc Testnet first; produce code, tests and mainnet instructions | Done, instructions unexecuted | Live testnet runs above. `MAINNET_RUNBOOK.md` exists. It has never been run and cannot be run from Arc Studio |
| 7 | Existing production untouched; no private keys requested or exposed | Done | Only new directories were added. Throwaway test keys were generated in the sandbox, kept outside the repository and never printed |
| 8 | Identify every incomplete or unverified requirement | This file | |

## Not claimed

- Any mainnet deployment or mainnet transaction.
- Any payment or revenue.
- Any independent security audit. The automated reviews are not one.
- That the app works with every wallet or screen size.

## Not done

- Independent audit.
- Fixing the Low review finding that validation errors carry no parameters (deliberately left, so the live-tested bytecode stays unchanged).
- Browser-level testing of the app with a real wallet, including the mobile layout.
- Explorer source verification for the testnet factory.
- Pushing the code to a repository and hosting a public copy of the app.
- Performance and gas profiling beyond the figures in the evidence (order creation about 1.9 million gas; funding about 86,000; approval about 67,000 on testnet).
- Testing the timeout-claim and dispute-fallback paths live (they are covered by contract tests; the live run covered shipment-deadline refund, dispute resolution, cancellation and the happy path).
- A per-order value cap. The contract has none.
- Mainnet behaviour of native USDC transfers to contracts and special addresses. Only testnet was exercised.

## Known design limits

- The buyer must act before the decision deadline or the supplier can claim the reserve.
- A colluding arbiter and buyer, or arbiter and supplier, can misallocate a disputed reserve.
- Shipment evidence is a hash. It does not prove the goods shipped.
- Anyone can list a wallet as supplier or arbiter on a new order, though that cannot move the wallet's funds.
- Value force-sent to a settled order stays there.
