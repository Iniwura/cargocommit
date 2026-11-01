# Project notes

This repository is the original CargoCommit / Seldra project (untouched). Next to it, an Arc Studio implementation lives in three new folders:

- `contracts/`: SeldraOrder and SeldraFactory plus Foundry tests. Own `foundry.toml`; run forge from inside `contracts/`, not from the repository root.
- `seldra-studio/`: the web app (Bun, Vite, React, wagmi, viem).
- `microgrant/`: development record, unverified items, mainnet runbook, evidence.

Deployed (Arc Testnet, chain 5042002):

- SeldraFactory `0x1ddac1a17d437a43ba09591d338954516721f0a7`, block 70177207.

Nothing is deployed to Arc mainnet. Do not claim otherwise.

Rules: never request or write private keys; never edit tracked files of the original project; keep `server.allowedHosts: true` in `seldra-studio/vite.config.ts`.
