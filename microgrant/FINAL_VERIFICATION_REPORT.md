# Seldra (Arc Studio implementation): final verification report

Date: 1 November 2026. Scope: `contracts/`, `seldra-studio/`, `microgrant/`, `AGENTS.md`.

This is a release-readiness record, not a safety certificate. The software is experimental, has had automated review and tests only, has no independent audit, and is not production-safe. Nothing was deployed or broadcast to Arc mainnet and no real USDC was spent.

The commit SHA of this report is not written inside the report (a commit cannot contain its own hash). It is reported next to the branch name where this was delivered; `git log` on the branch shows it.

## 1. Mainnet-capable configuration (not deployed)

- `seldra-studio/src/config.ts` defines Arc Testnet (chain 5042002) and Arc mainnet (chain 5042), both taken from viem's built-in chain definitions, which use the official RPC and explorer hosts.
- The active network is chosen at build time by `VITE_NETWORK`. The default is `arc-testnet`.
- Mainnet needs `VITE_NETWORK=arc-mainnet` and your own `VITE_FACTORY_ADDRESS_ARC_MAINNET`. No mainnet factory address is stored anywhere. Without one the app shows "No factory is configured" and cannot create orders.
- On mainnet the app shows a permanent real-funds banner.
- A build with `VITE_NETWORK=arc-mainnet` succeeds and contains the mainnet network (`evidence/final/frontend-build-mainnet-config.log`). It was not served or used against mainnet.
- `microgrant/MAINNET_RUNBOOK.md` describes the audit gate, deployment from your own keystore, verification and first-use steps. It has never been run.
- `scripts/testnet-e2e.ts` now refuses to run on any chain other than Arc Testnet.

## 2. Tests on the exact final source

Command: `bash microgrant/final-verify.sh`. Logs: `microgrant/evidence/final/`. Toolchain: Foundry 1.7.1, Solidity 0.8.35, Bun 1.3.14.

| Check | Result |
| --- | --- |
| Contract source hashes recorded before and unchanged after the run | Yes (`source-hashes.txt`, `source-unchanged.txt`) |
| `forge clean && forge build` | Exit 0, lint notes only (`forge-build.log`) |
| `forge test` | 154 passed, 0 failed, 0 skipped: 149 unit and fuzz tests plus 5 invariants (`forge-test.log`) |
| Generated ABI in the app equals the final artifacts | Yes (`abi-sync.log`) |
| `bun run typecheck` | Exit 0 |
| `bun run lint` | 0 warnings, 0 errors |
| `bun test tests` | 18 passed, 0 failed |
| `bun run build` (testnet) | Exit 0. The bundle is about 630 kB |
| Build with `VITE_NETWORK=arc-mainnet` | Exit 0 |
| Deployed testnet factory equals the final compiled factory | Yes. Code at `0x1ddac1a17d437a43ba09591d338954516721f0a7` matches byte for byte (`verify-deployment-testnet.log`) |

Because the deployed testnet factory matches the final source, the live testnet runs (run 2: 50 of 50 checks, `evidence/testnet-e2e-run2.json`) exercised the same code as the final source. The live runs were not repeated in this release pass.

## 3. Review of the three post-review edits

All three were assessed twice: by the automated functional review of the final source, and by reading the diff logic here.

1. Error parameters on `FundingAmountMismatch`, `InvalidPayout`, `AccountingMismatch`. The revert conditions are unchanged; only the revert data gained values. The app's error decoding uses error names, which are unchanged. The ABI changed, so integrations need the regenerated ABI, which the app has. No regression.
2. Event field `at` renamed to `timestamp`. Event signatures and topic hashes do not include field names, so logs are identical. The app reads fields by name and does not use the old name. No regression.
3. `orderAmount <= type(uint128).max`, checked before any multiplication. This turns an arithmetic panic on absurd amounts into the clean `InvalidAmount` error. The test was updated to expect that error. No narrowing of stored values. No regression.

Result of the final automated reviews:

- Functional and adversary review: no material findings.
- Rule-based review: one Low. The validation errors `InvalidAddress`, `InvalidAmount`, `InvalidBps`, `InvalidDeadlines` carry no parameters. No effect on funds or authorization. Not fixed on purpose, because changing the Solidity would invalidate the byte match with the live-tested testnet factory. Listed for the independent auditor.

These reviews are automated and are not an independent audit.

## 4. Secrets, keys, env files and deployment defaults

| Check | Result |
| --- | --- |
| Search for private keys, seed phrases, API keys, entity secrets, token strings, PEM blocks in the new files | None found. The only matches are the words in documentation and the throwaway-key generator in the testnet script |
| 64-hex strings outside evidence | Only the factory deployment transaction hash, which is public |
| `.env` files | `seldra-studio/.env` exists locally and is ignored by git (checked). It holds only public values. `.env.example` is committed and holds the public testnet factory address and block, plus empty mainnet entries |
| Test keys | Generated in the sandbox, stored outside the repository (`/tmp`), never printed, never committed. They controlled only testnet faucet funds |
| Deployer metadata | `contracts/contract-metadata/` holds an internal deployer wallet id. It is excluded by `contracts/.gitignore` and not committed |
| Build output | `out/`, `cache/`, `dist/`, `node_modules/` are ignored |
| Network default | Testnet. Mainnet is opt-in and needs your own factory address |
| Contracts | No owner, admin, upgrade path, pause or fee recipient, so no privileged address exists to misconfigure. There is also no per-order value cap and no emergency stop |
| Vite `server.allowedHosts: true` | Needed for the Arc Studio preview. It is a development setting. Do not run `vite` or `vite preview` as a production host. Serve the built `dist/` as static files |
| Wallets | Browser-injected wallets only. The app never asks for a key or seed phrase |
| Dependency audit (`bun audit`) | 6 advisories, 3 high and 3 moderate, all transitive (`ws`, `zod`, `uuid`, `decode-uri-component`), of the memory-exhaustion or denial-of-service kind. Most arrive through wagmi's wallet-connector packages that this app does not enable. Not remediated in this release. Update dependencies and re-run the audit before hosting publicly (`evidence/final/dependency-audit.log`) |

## 5. Original Seldra implementation and deployment preserved

- The release branch is created from the original `master` branch. The diff against `master` contains only added files in `contracts/`, `seldra-studio/`, `microgrant/` and `AGENTS.md`. No tracked original file is modified, moved or deleted.
- No transaction was sent to any existing Seldra or CargoCommit contract. The testnet factory in this project is a new, separate contract.
- The original repository's `README.md`, `frontend/`, `src/`, `test/`, `script/` and documents are untouched.

## 6. Not claimed

No mainnet deployment, no payment, no independent audit, no production safety, no verification in a real browser with a real wallet, no mobile layout check. See `INCOMPLETE_AND_UNVERIFIED.md` for the full list.
