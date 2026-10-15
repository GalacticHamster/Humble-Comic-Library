# HB / FAN presentation contract

Simple answers “Should I buy this?”: disjoint Owned, Owned elsewhere, New, Partial, Possible and conditional Check incomplete counts; legend; concise GL state; relevant Wishlist matches/related notice; Hide owned items; informational tier value; closed status lists; closed Advanced; complete item export. No goal selector or purchase recommendation in Simple.

Ordinary rows show offered titles, useful Elsewhere provider, known Partial fraction and actual related title for Possible. Wishlist is a direct action. Why is selective: Possible, Partial, incomplete checks or meaningful conflict. Explanations lead with plain English; Technical details starts collapsed.

Wishlist relationship is independent of ownership. Missing metadata is neutral; contradicting metadata blocks a definite match. Related editions/packages do not fulfill wishes. Wishes and priorities count once across alternative products; intentional edition-specific wishes remain distinct.

Advanced order: Bundle contents and overlap; Wishlist and purchase planning; Series coverage and gaps; Galactic Library details; Diagnostics (only if enabled). Applicable subsections start closed. Possible planning requires opt-in; known additional Partial units may contribute; Check incomplete stays excluded. Planning never changes ownership status.

Retry missing/failed GL checks while preserving successful results. Refresh invalidates successful cached evidence. Preserve local evidence on failure. Unknown scope needs review; only compatible known issue/volume ranges imply gaps, never numbered annuals/specials alone. Bound requests and page long lists.

Series comparisons have at most 100 groups, 2,000 units per group and 20,000 units total. Long unit/evidence lists mount on disclosure and page 50 rows at a time. Unknown scope is labelled Needs review; it never establishes a missing intervening unit. Supported default media is numbered books/comics/manga. Annual/special entries can be explicitly listed without inferred gaps.

Both Advanced planners expose the same goals, Include Possible items, and a paged Manage wishes for this bundle priority editor. Verified unit planning uses the aggregate overlap buckets so an unresolved overlapping unit cannot acquire verified value. Settings changes update Wishlist and Diagnostics on the open page; ordinary-row Wishlist controls remain in Simple.

Use semantic keyboard-accessible controls, protected native disclosure markers, text as well as color and scoped announcements. Preserve same-bundle disclosure/focus/scroll on updates. Wishlist remains separate from ownership colors.

FAN Pick & Mix selection, exact quantities, availability and bounded search remain store-specific. Acquisition, importers and native DOM adapters remain separate. Every user-facing change must assess applicability to the other store; new analytics default to Advanced. Common synthetic fixtures protect parity; ownership matching follows MATCHING_PHILOSOPHY.md. Shared-renderer extraction is a separate, gated Phase 4.


The first-load correction subscribes to dependencies before asynchronous hydration, discards stale snapshots, and refreshes applicability when local/central/metadata evidence changes. Keeping a stable panel visible must not freeze its analysis. UI-only changes retain valid ownership lookup results. New cold-lifecycle browser fixtures start without final library/analysis state; games retain conditional applicability.

Canonical companion typography is Arial 14px/21px regular body, 16px/24px bold heading, bold body-size disclosure headings/counts, and 12px/18px legend/panel controls. Body #f2f2f2, muted #c5cbd3 and explicit warnings #f4cc73 on #171717 meet readable contrast. Shared scoped components use 8px paragraph/disclosure spacing, 20px list indentation, consistent dark controls and native arrows. No divider separates ordinary Advanced subsections. Browser presentation checks protect these values against host CSS. See UI_LIFECYCLE_CORRECTION.md for reproduced defects, testing and the authenticated manual sequence.

## Library Classification Parity, File-Type Visibility & Rejected Review

### 1. Parity Architecture & Interface Alignment
Both Humble Comic Library (HB) and Fanatical Library (FAN) provide equivalent library-management capabilities:
- **Media Categories & Filter Semantics:**
  - `All`: All purchases regardless of media type.
  - `Books`: Matches both standard books and comics (`book` or `comic`).
  - `Comics`: Matches comics specifically (`comic` or detected via `isComicItem`).
  - `Audiobooks`: Spoken-word audio content.
  - `Videos`: Video / film / episodic content.
  - `Games`: Games and interactive entertainment.
  - `Software`: Creative tools, assets, utilities.
  - `Unclassified`: Items pending categorization or unrecognized media types.
- **Classification Diagnostics:**
  - Summary pills placed directly above the library items list showing live counts for Comics, Books, Games, Software, Audiobooks, Videos, Unclassified, Unimported / Rejected items, and Manual overrides.
- **File-Type & Delivery Visibility:**
  - Each item's expandable provenance details display delivery method (`Direct download`, `Streaming`, `External key`, `Steam`, etc.).
  - Distinct downloadable file extensions (e.g. `.pdf`, `.epub`, `.cbz`, `.zip`, `.blend`, `.unitypackage`) are extracted directly from download metadata (never guessed from titles).
  - When downloadable format metadata is absent on unclassified or direct-download items, an explicit "File formats unavailable" notice is shown.
- **Manual Classification Overrides & Reset:**
  - Each item detail row includes a classification row with current media badge, automatic/override note, category selector dropdown, and a "Reset to automatic" button when overridden.
  - Overrides are keyed by stable product identity (`sourceItemId`) so products sharing a title never collide.
  - Overrides persist across rescans, merges, browser restarts, and backup/restore roundtrips.
- **Unimported / Rejected Purchase Review:**
  - Discoverable collapsible review interface (`<details id="library-rejected-section">`) displaying rejected count, informative empty state, full item provenance, delivery/formats info, rejection reason, category recovery selector, per-item Dismiss button, and a Dismiss All button.
  - Deduplicated across rescans to prevent record accumulation.
- **Galactic Library (GL) Integration Safety:**
  - GL snapshot schemas are strictly preserved: `comic` maps to `book`, and `video` / `unclassified` maps to `other`. Manual overrides and classifications remain fully compatible with GL sync.

### 2. Storefront-Specific Implementation Distinctions
- **Data Provenance:** HB tracks `purchaseKey` (Humble transaction keys) and subproduct machine names. FAN tracks order IDs, order dates, and leaf item IDs within bundle groupings.
- **Extraction Source:** HB extracts download formats and key types via DOM/API product payload metadata in `content.js`. FAN extracts formats and leaf types from JSON order history and product downloads in `order-importer.mjs`.
- **Automatic Comic Detection:** HB detects comics directly during order scanning and tags `kind: 'comic'`. FAN categorizes bibliographic leaves as `book` in stored records and dynamically identifies comics for UI display and filtering using `FanaticalLibrary.isComicItem(item)` (checking bundle titles, manga/comic keywords, and `.cbz`/`.cbr` formats).

### 3. Parity Regression Checklist
When modifying library classification, matching, or UI in either extension, verify:
- [ ] **Filter Semantics**: Does "Books" include both books and comics? Does "Comics" match comics specifically?
- [ ] **Diagnostics Consistency**: Are count pills present, reactive, and matching current library + rejected item counts?
- [ ] **Source Metadata Truth**: Are file types extracted from actual source downloads rather than guessed from titles?
- [ ] **Missing Formats**: Is "File formats unavailable" shown when download format metadata is absent?
- [ ] **Override Persistence**: Does setting a manual media override survive rescans, merges, and backup export/import?
- [ ] **Reset Capability**: Does "Reset to automatic" restore the original classification and clear manual flags?
- [ ] **Rejected Lifecycle**: Does rejected purchase review support empty states, recovery, dismissal, and deduplication across rescans?
- [ ] **GL Contract**: Are GL snapshots and entitlement sharing mapped to valid GL media types without breaking schemas?
- [ ] **Edition Safety**: Are software versions (e.g. 2024 vs 2025) and distinct editions kept separate without false consolidation?
