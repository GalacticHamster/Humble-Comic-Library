# Bundle-aware candidate explanations

After the complete bundle has been checked, a weak related-title suggestion can move into Match details when the exact same library record already strongly matches another distinct offer. The original evidence is retained. Its card explains: "More closely matches another item in this bundle: [offered title]."

Direct identities rank first, followed by reviewed contents/relationships, explicitly numbered items in the complete offered series, other similarity and generic unnumbered records for numbered offers. English Book One/Two/Three and Roman/decimal labels are interpreted for display only; they do not change canonical identity or contents authority. Known ISBN/language/edition warnings remain visible.

For a complete catalogue, locally owned top-level offers also receive a cached/batched GL identity probe. Only direct same-edition results become record-specific reconciliation anchors. These probes do not populate the local Owned explanation or override ownership. A failed probe disables deferral; different provider/account references are never equated by title.

For example, Beneath the Trees Where Nobody Sees remains Owned elsewhere. Beneath the Trees Where Nobody Sees: Rite of Spring keeps its matching Kindle subscription record and Check ownership status. The weaker suggestion for the original appears under Match details. When only Rite of Spring is offered, that weak suggestion stays in the ordinary explanation.

Candidate ranking and bundle context leave counts, ownership badges, plans and price per new item unchanged. GL can additionally discover numbered issue suggestions; an otherwise New offer may then become Possible, with no ownership or verified coverage inferred. A Possible result does not become New when its suggestion moves into details. Subscription access never becomes owned through bundle context. No library records, manual decisions or settings are rewritten.

Collections, partial contents, software components, editions, known identifier conflicts, explicit formats and independently established identities retain their legitimate overlapping relationships. Duplicate products are not assigned exclusively. Different account/provider records are never inferred to be the same identity just from a title. Reviewed relationships stay authoritative.

Humble applies this only when its embedded tier catalogue matches the entire resolved DOM item list unambiguously. Missing/unhydrated data or a partially rendered catalogue retains the ordinary independent explanations. Any failed or unfinished lookup disables bundle deferral for that render.

The priority overlay is in memory for the current match objects. The deterministic shared engine is embedded in ownership.js and maintained in the sibling GalacticLibrary shared/bundle-match-context.js source. Its synchronization and parity tools are development-only. There is no extra runtime dependency or permission.

## Verification

Run node --test --test-concurrency=1 tests for normal unit checks. tests/bundle-match-context.test.mjs covers the real example, local exact purchases, missing exact companions, duplicates, formats, editions, issues/collections, components, account references, reviewed decisions, incomplete context, determinism, idempotence and session isolation.

Run node tests/bundle-context-acceptance.mjs PRE_CHANGE_COMMIT for exact authoritative-result comparisons and the 1,000-offer timing control. Run node tests/bundle-context-browser.mjs and the same command with --firefox for actual synthetic bundle rendering and badge explanations. --baseline=COMMIT records the pre-change view. Outputs use ignored audit-artifacts/bundle-match-context. All browser tests use disposable profiles and local synthetic data.

## Collection and generic-volume explanations

Rite of Spring #1/#2 appear as Related numbered item with their actual access state and an explicit unconfirmed membership/completeness warning. An unknown manifest never becomes two-issue coverage. When the original is another complete-bundle offer, its direct GL identity probe can move redundant original suggestions into Match details; a lone sequel retains them.

An unnumbered 30 Days of Night purchase remains Possible for Books One/Two/Three. Each card says the record does not identify that particular book or establish contents overlap. It is not assigned to Book One. A same-title subscription ranks ahead of it, and reviewed purchased contents overlap ranks ahead of weak title similarity.

The actual cross-provider GL API fixtures and disposable Chrome/Firefox rendering tool live in the sibling GL repository under tests/fixtures/matching and scripts/cross-provider-browser.mjs. Their generated outputs are ignored. Standalone tests/cross-provider-presentation.test.mjs requires no sibling checkout.
