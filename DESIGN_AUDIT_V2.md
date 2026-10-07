# CargoCommit art-direction audit v2

## Tenora: six compositional observations

The reference is effective because it choreographs different kinds of visual material rather than repeating one section template.

1. **The opening is a system, not a hero card.** The spaced wordmark, year marker, oversized title and registration action share one field. The headline is treated as an identity object, not a paragraph enlarged until it fills the viewport.
2. **Highlights use a measurement band.** The statistics strip introduces a change of rhythm: repeated labels, large numerals, and a single horizontal baseline create a pause after the opening story.
3. **The “inside” section alternates scale and alignment.** A large statement, a numbered cue, a statistic, and an image occupy different anchors. The section does not repeat a left-copy/right-card split.
4. **Focus areas behave like visual chapters.** Each chapter has a number, a category label, a large title, a concise description, a list of topics, and a dedicated visual field. The object and the text carry different jobs.
5. **Speaker and agenda sections turn content into a collection.** Repeated profiles, dates, and session rows use a shared spine, but the page moves from portrait-like objects to a calendar-like sequence instead of using identical cards everywhere.
6. **Transitions are deliberate.** Dark interstitial statements, repeated event marks, and large whitespace reset the eye between dense sections. Motion and repetition create pacing; they are not decoration layered on top of a dashboard.

## What the current CargoCommit page still lacks

The first redesign improved typography but still reused a small set of primitives: a left statement, a right explanation, a ruled list, and a bordered record. The result reads as an editorial dashboard. It has no memorable physical object, the hero headline is over-scaled, the live proof is still technical documentation, and the 30/70 idea is present as text rather than as a visual mechanism.

The product also needs stronger transitions between states. A purchase order, a protected balance, a shipment commitment, and a settlement receipt should each have their own material language. A visitor should remember the money moving from **protected** to **released**, not just remember a palette.

## CargoCommit motifs replacing Tenora's event imagery

This pass uses original, product-native objects instead of stock or AI imagery:

- a layered purchase-order sheet with serial number, route, party blocks, and a 30/70 settlement seal;
- a proportional settlement bar where the 30% and 70% widths are the actual story, not decorative progress chrome;
- opposing buyer/supplier panels connected by a funded-order spine;
- a staged manifest strip that changes from terms accepted to funded, evidence submitted, and released;
- Demo A as a settlement certificate with receipt marks around a principal accounting block;
- Demo B as a dispute freeze record with a blocked-release stamp and arbiter closure mark;
- a compact Arc primitive diagram using signal marks for native USDC, programmable state, deterministic settlement, and public readback.

The visual language is intentionally independent: trade documents, serials, route lines, stamps, ledger cuts, and settlement states. The signal color means verified or protected only; it is not a general decorative accent.

## Pass criteria

- Each major landing section uses a different composition.
- The 30/70 split is visible as proportion and state transition.
- Proof reads like a financial record, not a blockchain dashboard.
- Create and order views inherit the same document grammar.
- The live wallet, event, read, write, and receipt paths remain unchanged.
- Desktop, tablet, and mobile layouts are recomposed without horizontal overflow.
