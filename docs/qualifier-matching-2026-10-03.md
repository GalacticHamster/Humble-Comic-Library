# Generalized qualifier matching — 2026-10-03

Implemented the supplied [MATCHING_PHILOSOPHY.md](../MATCHING_PHILOSOPHY.md) as the product contract. The three historical regressions and the seven false-New edition/revision examples now produce Possible across HB local, FAN local, GL, HB consuming GL and FAN consuming GL. No importer, receipt, storage, ownership taxonomy or UI redesign was needed.

## Audit before implementation

| Question | Current implementation and finding |
| --- | --- |
| HB candidate discovery | `content.js`: `createLibraryMatcher`, `identityCandidates`, `findPossibleMatch`; title/primary/token/edition-base indexes feed review-only discovery. |
| FAN candidate discovery | `src/shared.js`: `makeIndexes`, `classify`, `relationshipMatch`; presentation, ISBN, base and Possible indexes. |
| GL candidate discovery/grouping | `src/lib/matcher.js`: title/presentation/identifier/base/candidate indexes; `models.js` and reviewed relationships manage canonical groups. Groups cannot bypass companion identity checks. |
| Exact identity | HB `ownership.js: exactCandidate`; FAN `classify` and `identityConflicts`; GL companion anchors, `identityConflicts` and reviewed Same edition links. |
| Possible | Related titles and identifiers retain actual library titles. Known contradictory writers, runs and numbered units still block automatic title-based candidates. |
| Effective ownership/access | GL `ownership.js: effectiveOwnershipRecord` applies existing reviews, access/key expiry and saved ownership overrides. `owned` is calculated from effective owned/claimed records after identity matching. |
| GL translation | HB `renderBundleComparison` / `ownedOutsideHumble`; FAN `mergeGalactic` / `resolveProduct`. Exact identity with temporary/unknown ownership remains a review warning for purchasing decisions. |
| Treat everything as owned | Global/provider preference derives owned records without rewriting provider observations, media or provenance. It does not alter identity, revive inactive account archives or invent collection contents. |
| Receipt/provenance prerequisites | GL has none for exact title identity. HB's helper incorrectly selected exact identity only from purchases passing its key-availability check. That check is now a separate `ownedExact` selection. Imports and receipt evidence remain unchanged. |
| Edition recognition | Three narrow candidate suffix parsers plus local edition/package fallbacks handled only some numeric/spelled labels. FAN also indexed a single ISBN rather than every relevant validated identifier. |

## Root causes and rule implemented

Discovery depended on a recognized suffix before titles could share a base. Unfamiliar syntax consequently removed a purchasing warning instead of lowering identity confidence. The different local fallback heuristics produced HB/FAN/GL disagreements.

All three ship identical shared `revisionTitleParts` and `revisionWordingConflict` helpers. The rule recognizes semantic revision/version/edition/format markers and delimiter structure, unbounded numeric labels, shorthand such as `2e`, and compositional English ordinals such as `Twenty-first` and `One Hundred and First`. It also compares the complete shorter title against an unfamiliar trailing revision descriptor. These are linguistic/structural rules, not a lookup of the reported title strings.

Discovery keys and qualifier stripping remain review-only. Conflicting revision wording blocks exact identity even when a validated ISBN is shared. Missing author/ISBN remains neutral; plausible creator-name variation remains Possible. Identifiers still validate and normalize ISBN-10/13. FAN now indexes and compares all relevant validated ISBNs and forwards multiple offered identifiers through the existing API format.

Identity and ownership remain separate: GL can return `matches`, `same-edition` and confidence 1 for unknown/subscription/borrowed/rental access while `owned` is false. The override changes effective ownership only; response evidence retains original access. HB's exact-candidate helper now returns exact identity independently, and its separate `ownedExact` result determines the local purchasing classification. Expired/unavailable purchases still show Check ownership and cannot supply owned contents.

## Explicit comparison of the five paths

| Case | HB local | FAN local | GL | HB ← GL | FAN ← GL |
| --- | --- | --- | --- | --- | --- |
| Maggie parenthetical | Possible | Possible | Possible | Possible | Possible |
| Think Like a Programmer subtitle | Possible | Possible | Possible | Possible | Possible |
| Algorithmic Thinking / 2nd Edition | Possible | Possible | Possible | Possible | Possible |
| 1st/2nd, 2nd/3rd, 1st/10th | Possible | Possible | Possible | Possible | Possible |
| Bare / Revised or Updated | Possible | Possible | Possible | Possible | Possible |
| Revised and Updated Edition, with `and` or `&` | Possible | Possible | Possible | Possible | Possible |
| Eleventh Edition, Edition 2, 2e | Possible | Possible | Possible | Possible | Possible |
| Unfamiliar trailing revision/version descriptors | Possible | Possible | Possible | Possible | Possible |
| Room / The Room | Possible | Possible | Possible | Possible | Possible |
| Different known volumes or unrelated generic words | New | New | No relationship | New | New |
| Equal full titles with punctuation differences | Owned | Owned | Exact + owned | Owned elsewhere | Owned elsewhere |
| Preview/full with shared ISBN; base/deluxe game | Possible | Possible | Possible | Possible | Possible |
| Matching ISBN-10/13 or second ISBN for a renamed book | Owned | Owned | Exact + owned | Owned elsewhere | Owned elsewhere |

The permanent 60-case matrix expands to 800 comparisons per local/linked path through both directions, author variants, missing/shared/conflicting ISBNs and duplicate records. GL also repeats the matrix with its override enabled. Dedicated tests cover every existing ownership state, global/provider overrides, preserved raw evidence and a failed GL connection with valid local Possible evidence.

## Files changed

- GL runtime: `src/lib/matching-policy.js`, `src/lib/title-candidates.js`, `src/lib/identity.js`.
- HB runtime: `shared.js`, `ownership.js`, `content.js`.
- FAN runtime: `src/shared.js`.
- All projects: `MATCHING_PHILOSOPHY.md`, `docs/matching-policy.md`, this report, `tests/revision-matching-cases.json`.
- GL tests: `tests/revision-matching.js`, `tests/matching-candidates.js`.
- HB/FAN tests: reusable `tests/matching-fixture.mjs`, existing `tests/matching-policy.test.mjs`, new `tests/revision-matching.test.mjs`.
- HB additionally updates its expired-key regression in `tests/entitlements.test.mjs` to assert exact identity independently of effective ownership.

## Validation and deliberate limits

Full existing suites: **HB 278 passed; FAN 327 passed; GL 270 passed**, zero failures or skips. Additional checks passed: HB Chrome browser (46 checks), FAN packaged Chrome bundle/pick-and-mix/importer scenarios, installed Chrome FAN/GL integration, and installed Firefox GL/HB/FAN integration including ownership overrides and restored comic matching.

There are no classification differences in the tested five-path matrix. This does not assert universal parity for every provider or package syntax. The local companions retain source purchase data rather than GL's multi-provider access taxonomy; GL's canonical grouping/enrichment remains stricter than purchasing-warning discovery. Those differences are intentional and were not redesigned.

Deliberately unchanged: fuzzy/title-related evidence never proves Owned; known incompatible writers, runs and numbered units remain barriers; ordinary supported format/punctuation normalization can still be exact; preview/sample/excerpt cannot prove the full work; a base Steam App ID cannot prove deluxe extras; Partial requires known reviewed/enumerated content coverage. Ownership overrides do not change identity or those barriers. Unmarked arbitrary title extensions are not automatically assumed to describe an edition. Connection failure remains Check incomplete and preserves valid local Owned/Possible/Partial evidence.
