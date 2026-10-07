# CargoCommit visual audit

## Reference observations

The Tenora reference builds a premium editorial surface through composition rather than decoration:

- a very restrained header and small uppercase metadata before the main story;
- oversized display headlines with tight leading and deliberate line breaks;
- section numbers (`-- 001.` / `-- 002.`) used as a navigation spine;
- large asymmetric fields of whitespace, thin rules, and alternating dark/light sections;
- content that shifts between left and right anchors instead of repeating centered cards;
- typographic hierarchy that makes the metric or idea the visual object;
- subtle reveals and repeated event/agenda rhythms, with mobile layouts recomposed instead of merely stacked.

## What made the old CargoCommit UI generic

The previous interface was functional, but its visual grammar still read as a polished Web3 dashboard:

1. The hero split into a conventional copy column plus a bordered product card. The card became the focal point instead of the settlement story.
2. Live proof used two parallel cards with repeated borders and stat rows. That made verified evidence feel like dashboard widgets rather than a record.
3. The landing page moved directly from hero to a compact principles list, so there was no editorial progression through problem, commitment, movement, and proof.
4. One accent color, status dots, and repeated button treatments were applied as UI decoration instead of being reserved for state and action.
5. Create and order pages used dense form/card patterns. They exposed useful fields, but not the feeling of a financial document or settlement certificate.
6. The mobile rules mostly collapsed desktop grids. They did not create a new reading rhythm for small screens.

## Redesign thesis

CargoCommit now uses an **editorial ledger** system: warm paper, near-black ink, one restrained signal color, display serif for money and declarations, compact sans/mono metadata, and thin rules as the primary component boundary.

The landing story is structured as:

- opening claim;
- `001 / THE PROBLEM` — the buyer/supplier tension;
- `002 / THE COMMITMENT` — the `$10,000` 30/70 composition;
- `003 / HOW IT MOVES` — a numbered settlement sequence;
- `004 / LIVE ON ARC` — the real Demo A and Demo B evidence;
- `005 / WHY ARC` — four precise primitives, without marketing filler.

Application screens inherit the same system. The create screen is a ruled financial document, the order screen is a live settlement sheet, and the proof view is composed as a certificate rather than a dashboard.

## Constraints preserved

- No Solidity changes.
- No changes to wallet connection, live reads, event discovery, role gating, contract writes, receipt waiting, or proof transaction data.
- No fabricated activity or browser signing state.
- No new imagery or gradients; typography and geometry carry the visual identity.
- Motion is CSS-only and disabled under `prefers-reduced-motion`.
