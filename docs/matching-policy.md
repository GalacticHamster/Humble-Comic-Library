# Storefront ownership matching policy

The companions and Galactic Library use the same presentation and author rules and mirrored decision fixtures. Identity and access are separate: a matching borrowed, temporary, historical or unknown-access record cannot prove permanent ownership.

[MATCHING_PHILOSOPHY.md](../MATCHING_PHILOSOPHY.md) is the authoritative product contract. Revision discovery uses shared structural and semantic rules: numeric/compositional English ordinals, revision labels, version/edition markers and complete-base-title qualifiers remain Possible across unfamiliar syntax. Discovery never supplies exact identity. Conflicting revision wording also prevents a shared ISBN from bypassing an edition warning. Format-only presentation normalization remains supported. See [the implementation and regression report](qualifier-matching-2026-10-03.md).

| Evidence | Result |
| --- | --- |
| Equal full titles after ordinary punctuation, whitespace, ampersand, explicit volume numeral and book-format normalization; no known conflict | Owned locally, or Owned elsewhere for a permanent external record |
| Same title; author, ISBN, language or edition metadata missing on either side | Missing information is neutral |
| Duplicate compatible purchase observations | Owned; duplicate rows alone are not ambiguity |
| Same title and compatible author; stored ISBN editions differ but the offer supplies no ISBN | Owned; do not invent a contradiction with an absent offered identifier |
| Both sides supply disjoint validated ISBNs, different editions or different languages | Possible, with the actual library title and evidence |
| Article change (`Room` / `The Room`), accent change, general Roman wording, typo or missing subtitle | Possible, not title-only ownership proof |
| Author initials, omitted middle names or ambiguous name order | Possible without independent edition proof; a shared validated edition identifier can resolve compatible name variants. An arbitrary shared surname proves nothing |
| Explicit surname-comma-given order or recognized trailing creator-role decoration | Normalize the same person's name; other identity checks still apply |
| Known writer roles and a mixed author/artist list | Compare writers when explicitly supplied; a shared artist cannot conceal different writers |
| Different known authors, runs or numbered works | Separate works; do not infer ownership or title-based candidates |
| Conflicting series text but otherwise matching title | Possible; series wording may need review |
| Preview/sample/excerpt versus full product | Possible even with a shared ISBN |
| Owned copy explicitly includes `(plus extra content)` and the base is offered | Owned; the reverse remains Possible |
| Local match absent and configured Galactic Library check fails | Check incomplete; this item may already be owned |

ISBN comparisons validate checksums, normalize equivalent ISBN-10/13 values and accept any shared ISBN in the returned list. Strong identifiers may establish renamed titles but cannot override known identity/access conflicts. Known contradictory Fanatical product-ID metadata is surfaced as Possible rather than silently accepted.

A successful exact title or identifier takes precedence over additional related candidates. Both `4001 A.D.` and `4001 A.D.: Beyond New Japan` can be independently owned; comparing only one against the other remains Possible.

Automatic Galactic Library canonical grouping uses narrow title identity. Older inferred groups cannot transfer ownership to another title merely through group membership. Explicit reviewed Same edition aliases remain supported, subject to known conflicts and manual work/edition barriers. Enrichment and record grouping can require stronger evidence than a storefront comparison; full-title ownership does not automatically approve enrichment.

Confirmed collected contents still require compatible known run and language. Missing scope retains Possible coverage, including HB's legacy issue-to-collection bridge. HB's same-bundle volume/subtitle bridge requires equal full bundle names after removing only the storefront site suffix; a shared bundle-name prefix is insufficient.

New means no match found in the libraries successfully checked. Check incomplete means local checking found no match and central checking could not finish. Existing local Owned, Possible or Partial evidence survives a central failure, and retrying fills only unresolved checks. Incomplete checks are excluded from confirmed-new values and default purchase suggestions.

Regression coverage lives in `tests/common-matching-cases.json` and the shipped matcher tests. GL additionally checks that the shared policy code and fixtures remain identical across adjacent checkouts (ignoring source line endings).

Bundle context can prioritize competing candidate explanations while preserving authoritative results. See [Bundle-aware candidate explanations](bundle-match-context.md).
