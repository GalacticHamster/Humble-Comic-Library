I am providing MATCHING_PHILOSOPHY.md with this task.

Read it completely before making any changes. Treat it as the authoritative product-level contract for matching behavior across Galactic Library (GL), Humble Bundle (HB), and Fanatical (FAN).

The purpose of this task is to fix the remaining false-New edition/qualifier cases discovered in the recent audit while preserving the matching behavior we have already restored.

IMPORTANT: Do not redesign the ownership model, provenance model, provider importers, storage model, receipts, UI, or architecture as part of this task unless a change is strictly necessary to implement the matching behavior described below.

The most important architectural distinction is:

IDENTITY CONFIDENCE and OWNERSHIP CONFIDENCE ARE SEPARATE AXES.

The matcher must first answer:

    "How strongly does this offered item correspond to this library item?"

Separately, Galactic Library can answer:

    "What kind of ownership/access does the user have to this library item?"

Examples of ownership/access may include purchased/owned, subscription, borrowed, former/no-longer-available, unknown, or whatever normalized states the existing implementation currently uses.

Do NOT require proof of permanent ownership in order to establish identity.

For example, if Amazon reports a record for "The Hobbit" that can be confidently identified as the same "The Hobbit" being offered by a storefront, that identity may be Exact even if Amazon only says "in library" and GL cannot prove whether it was purchased, borrowed, subscription-provided, or otherwise temporarily available.

Do not transform:

    "I cannot prove that the user permanently owns this."

into:

    "I cannot confidently match these two records."

Those are different questions.

Likewise, receipts, transaction records, entitlement records, provider provenance, or similar evidence may improve ownership classification, but they must NOT become prerequisites for identity matching.

The global/per-provider "Treat everything as owned" option affects effective ownership for purchasing decisions. It must not alter identity confidence, erase original ownership/access state, or erase provenance.

Before changing code, inspect the current implementation and verify how these concepts are represented today. Reuse the existing ownership states and data structures where possible. Do not create a parallel ownership taxonomy merely because MATCHING_PHILOSOPHY.md uses conceptual names.

--------------------------------------------------
PRIMARY MATCHING POLICY
--------------------------------------------------

This is a purchasing-warning matcher, not a bibliographic identity engine.

False Owned is bad.

False New is also bad.

Possible exists specifically to resolve the tension between them.

The practical meanings are:

OWNED / OWNED ELSEWHERE
    Strong enough evidence that the offered item corresponds to something the user should treat as owned, after applying the user's effective ownership policy.

POSSIBLE
    The user owns or has a library record for something sufficiently related that they should check before buying, but exact identity and/or edition equivalence is not strong enough to call it Owned.

PARTIAL
    A known collection/package contains multiple components and the user owns some but not all of them.

NEW
    No meaningful relationship was found by the checks that successfully ran.

"New" must not be used merely because the matcher cannot prove exact identity.

When evidence is meaningfully suggestive but insufficient for Owned, prefer Possible over New.

Missing metadata is neutral.

Contradictory metadata is evidence.

Examples:

- same title, one side lacks ISBN -> missing ISBN is neutral
- same title, one side lacks author -> missing author is neutral
- same title + compatible author -> strong Owned evidence
- same title + two populated incompatible valid ISBNs -> Possible
- different known edition -> Possible
- shortened title/full subtitle -> Possible
- clearly different numbered volume -> normally New
- uncertain but plausible author-name variation -> should not silently destroy an otherwise meaningful Possible candidate

--------------------------------------------------
HISTORICAL REGRESSIONS -- MUST REMAIN FIXED
--------------------------------------------------

These were real false-New failures found after the initial Humble Comic Library release.

They are permanent regression requirements.

REGRESSION: MAGGIE_PARENTHESES

owned:
    Maggie the Mechanic (Love & Rockets)

offered:
    Maggie the Mechanic

expected:
    POSSIBLE


REGRESSION: THINK_LIKE_PROGRAMMER_SUBTITLE

owned:
    Think Like a Programmer: An Introduction to Creative Problem Solving

offered:
    Think Like a Programmer

expected:
    POSSIBLE


REGRESSION: ALGORITHMIC_THINKING_EDITION

owned:
    Algorithmic Thinking

offered:
    Algorithmic Thinking, 2nd Edition

expected:
    POSSIBLE


The recent audit confirmed that all three currently pass through:

- HB local matching
- FAN local matching
- GL matching
- HB consuming GL
- FAN consuming GL

They also passed in reverse and under the tested author/ISBN variations.

Do not regress them.

--------------------------------------------------
REMAINING FALSE-NEW CASES
--------------------------------------------------

The audit found that bare:

    Algorithmic Thinking

still becomes New against some obvious edition/revision variants.

These cases need to become Possible:

    Algorithmic Thinking, Revised
    Algorithmic Thinking, Updated
    Algorithmic Thinking, Revised and Updated Edition
    Algorithmic Thinking, Revised & Updated Edition
    Algorithmic Thinking, Eleventh Edition
    Algorithmic Thinking, Edition 2
    Algorithmic Thinking, 2e

These are examples of the problem, NOT the complete allowed-string list.

Do NOT fix this by simply hard-coding these exact suffixes.

The intended generalized invariant is:

When two substantial titles have the same identifiable base work and their difference plausibly represents edition, revision, version, format, subtitle, or qualifier information, the relationship should remain discoverable as Possible even when the exact qualifier syntax is unfamiliar.

Unknown edition syntax should normally reduce certainty:

    Owned -> Possible

rather than eliminate the relationship:

    Possible -> New

Generalize edition/revision/version recognition.

Support reasonable forms including, but not limited to:

- numeric ordinals
- spelled-out ordinals beyond tenth
- "Edition 2"
- "2e"
- Revised
- Updated
- Revised Edition
- Updated Edition
- Revised and Updated Edition
- Revised & Updated Edition
- other structurally equivalent edition/revision/version forms

Do not broaden Owned merely to solve these cases.

--------------------------------------------------
ARTICLE / TITLE VARIATION POLICY
--------------------------------------------------

The recent audit also established:

    Room
    The Room

should be Possible.

Likewise, small spelling differences, shortened titles, subtitle differences, and plausible presentation/qualifier differences should remain discoverable as Possible when they are sufficiently meaningful to warn the user.

Do not make fuzzy similarity automatically Owned.

--------------------------------------------------
AUTHOR POLICY
--------------------------------------------------

The audit previously found that:

    Alan Moore
    A. Moore

could suppress an otherwise convincing title candidate entirely.

That class of behavior should remain fixed.

Author metadata is supporting evidence.

- missing author is neutral
- compatible author strengthens a match
- genuinely incompatible known authors can prevent Owned
- initials/full-name/reordered-name/other plausible representation differences should not automatically eliminate a strong Possible candidate

Do not require exact author-string identity merely to discover a Possible relationship.

--------------------------------------------------
IDENTIFIERS
--------------------------------------------------

Identifiers are strong evidence but must be handled correctly.

ISBN:

- validate before using as identity evidence
- normalize equivalent ISBN-10 / ISBN-13
- inspect all relevant ISBNs, not merely the first
- missing ISBN is neutral
- matching validated ISBN is strong identity evidence
- incompatible populated valid ISBNs normally prevent Owned but can preserve Possible
- a shared ISBN must not allow a preview/sample/excerpt to establish ownership of the complete work

Games/platform identifiers:

- a compatible Steam App ID can strongly identify a base game
- it does not automatically prove ownership of Deluxe extras, DLC, soundtrack, season pass, etc.

Provider-native IDs:

- an authoritative exact provider leaf/product ID can establish strong identity
- parent bundle IDs are provenance/package information and must not imply ownership of unrelated leaf products

--------------------------------------------------
PARTIAL
--------------------------------------------------

Partial concerns known content coverage, not fuzzy identity.

Use Partial when the offered collection/package has sufficiently known contents and some, but not all, are owned.

Do not infer package contents solely from vague title similarity.

--------------------------------------------------
GALACTIC LIBRARY OWNERSHIP
--------------------------------------------------

Be particularly careful here.

GL aggregates providers whose "library" records do not all mean the same thing.

Depending on provider and available metadata, an item may be:

- permanently purchased
- subscription access
- borrowed
- formerly available
- currently inaccessible
- ambiguous/unknown

Preserve those distinctions.

But they belong to the OWNERSHIP/ACCESS axis.

They must not unnecessarily weaken the IDENTITY axis.

An Exact identity match with Unknown ownership is still an Exact identity match.

How that Exact match is presented to HB/FAN depends on effective ownership and UI policy.

Do not collapse identity uncertainty and ownership uncertainty into one confidence value.

"Treat everything as owned" is explicitly the user's instruction that, for the selected scope, ownership ambiguity should not prevent the item from being treated as owned for purchasing-warning purposes.

Preserve the original underlying ownership/access status and provenance so disabling the override restores normal behavior.

--------------------------------------------------
CONNECTION FAILURE
--------------------------------------------------

A failed GL lookup is not evidence that an item is New.

Preserve valid local Owned/Possible/Partial results.

Use the existing "Check incomplete" behavior where appropriate.

Connectivity state is separate from identity classification.

--------------------------------------------------
IMPLEMENTATION APPROACH
--------------------------------------------------

First audit the existing code before modifying it.

Identify:

1. where HB discovers candidates;
2. where FAN discovers candidates;
3. where GL discovers/groups candidates;
4. where exact identity is decided;
5. where Possible is decided;
6. where ownership/access state is applied;
7. where GL results are translated by HB/FAN;
8. where "Treat everything as owned" modifies effective ownership;
9. whether any receipt/provenance requirement currently affects identity matching;
10. where edition/revision/version suffixes are recognized.

Then implement the smallest coherent change that makes the behavior conform to MATCHING_PHILOSOPHY.md.

Prefer shared/generalized semantic logic over provider-specific patches.

Do not perform a broad refactor merely because the current architecture could be cleaner.

Do not introduce a new receipt system.

Do not require additional provenance.

Do not change provider import behavior unless a concrete matching bug requires it.

Do not modify unrelated UI.

--------------------------------------------------
REGRESSION TESTING
--------------------------------------------------

Add permanent tests for the generalized behavior.

At minimum test:

Historical regressions:
- Maggie parenthetical
- Think Like a Programmer subtitle
- Algorithmic Thinking 2nd Edition

Edition/revision forms:
- 1st <-> 2nd
- 2nd <-> 3rd
- 1st <-> 10th
- bare <-> numbered edition
- bare <-> Revised
- bare <-> Updated
- bare <-> Revised Edition
- bare <-> Updated Edition
- bare <-> Revised and Updated Edition
- bare <-> Revised & Updated Edition
- bare <-> Eleventh Edition
- bare <-> Edition 2
- bare <-> 2e

Also test:
- both comparison directions
- missing author
- matching author
- plausible author-name variation
- missing ISBN
- matching ISBN
- conflicting valid ISBN
- duplicate library records
- punctuation-only differences
- article difference such as Room/The Room
- clearly different numbered volumes
- unrelated titles that share generic words
- base versus expanded/deluxe package
- preview/sample versus full work
- multiple ISBNs where the matching ISBN is not first
- ownership Unknown with Exact identity
- subscription/borrowed record with Exact identity
- Treat-everything-as-owned override
- GL unavailable while a local Possible exists

Run these through every applicable path:

- HB local
- FAN local
- GL
- HB -> GL
- FAN -> GL

The goal is not merely that the new examples pass.

The tests should demonstrate that:

1. Possible discovery became more robust.
2. Owned did NOT become recklessly broad.
3. Identity matching does not depend on permanent-ownership proof.
4. Ownership ambiguity remains preserved independently.
5. Existing correct behavior did not regress.

--------------------------------------------------
BEFORE FINISHING
--------------------------------------------------

Run the full existing test suites for all affected projects.

Then provide a concise report containing:

1. root cause(s);
2. files changed;
3. generalized matching rule implemented;
4. how identity and ownership remain separated;
5. any existing code that was incorrectly coupling them;
6. regression tests added;
7. total test results for HB, FAN, and GL;
8. any remaining inconsistencies between the three matching paths;
9. any cases where you deliberately left behavior unchanged because changing it could increase false-Owned risk.

Do not claim parity merely because tests pass. Explicitly compare the behavior of HB, FAN, and GL for the regression matrix.

If you discover a larger architectural issue that would require substantial unrelated changes, STOP and report it rather than expanding the task without approval.