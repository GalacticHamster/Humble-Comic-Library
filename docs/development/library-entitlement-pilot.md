# Authenticated Library entitlement pilot

Status: implemented, **disabled**. This is independent of the disabled redesigned purchase-history importer. It does not replace purchase history or establish complete migration coverage.

`library-entitlements.js` has a source-level `ENABLED = false` guard. Acquisition, matching and the worker check it. No preference, webpage message or normal UI enables it. Installed tests enable only a temporary package copy; they never rewrite source or existing release ZIPs.

## Identity, preservation and backup

The optional `libraryEntitlements` state/backup field has its own version-1 validator. Identity is `(authenticated principal ID, Library user ID, entitlement namespace/type, native individual ID)`. Title, parent native ID, source, non-secret eligibility and observation time are metadata. No purchase key, order ID, acquisition date, historical alias, secret key value or destination activation is invented.

The pilot requires an established saved local account and explicit confirmation. Local IDs bind storage but do not substitute for provider identity. A bound profile cannot silently switch provider scope. First-account setup automation is outside this pilot.

Begin/commit/abort use the existing serialized worker. A 15-minute token binds the sender tab, local account/profile and provider scope. New scans, account changes, restore and clear invalidate old work. Commits reconstruct fields, recompute admission and atomically write only observations plus token cleanup. Failed writes preserve prior observations and all legacy arrays, corrections, checkpoints and reminders. There are no delete-first writes or absence reconciliation.

Same-title/different-ID observations remain separate. Identical observation candidates may be grouped for presentation only, retaining all native references and explaining that purchase/copy equivalence is unknown. Titles never transfer corrections or establish legacy identity. Negative refreshed evidence can remove that observation's authority, never historical evidence.

Validated observations are backed up even while disabled. Older backups lacking the optional field restore an empty collection. Replacement restore and Clear library replace/clear it; saved profile archives retain it. The existing backup format/version is unchanged; older extensions cannot preserve this new optional field, so restore pilot observations with the current code.

## Purchased admission policy

Validated membership in the authenticated Purchased Library establishes Purchased evidence: account-bound native individual ID, exact row/detail identity and authenticated parent membership. Optional delivery metadata does not need to prove the purchase again. Ordinary storefront, bundle and claimed Choice items qualify. A Choice option offered only in a redemption group, without a matching individual Purchased child, is not imported.

Only affirmative exclusions with defined semantics withhold Purchased matching: individual giftStatus = gifted, or an explicit boolean revoked:true / temporaryAccess:true. These last two named access fields are supported and tested synthetic exclusion inputs, not claims that the live samples exposed them. Evidence is projected from the exact listing row/child and detail child; explicit parent revocation/temporary-access flags also apply. Malformed access flags become unresolved, not assumed false. Unknown metadata stays unknown, but does not veto validated Purchased membership. A parent subscription/Choice label alone does not mean temporary access.

An omitted field on refresh does not clear a previously explicit exclusion for that same native identity. A known false revocation/temporary flag or a known non-gifted status can clear the corresponding exclusion. This merge runs inside the existing atomic observation upsert; legacy purchase history and corrections remain separate.

Expiry, stock availability, preorders, redeemability, directRedeem, integration IDs, missing redemptionGroups, and past/future availability boundaries describe delivery/redemption. They do not erase purchase evidence. Dates remain stored as observed metadata; no original purchase date is invented.

Admission retains separate key/DRM-free provenance and a generic Purchased class for other native namespaces. purchaseStatus is recomputed from validated source evidence on writes and backup restore; caller-supplied admission/status cannot override exclusions. New exclusion flags are optional in the existing version-1 observation validator. Old observations retain their IDs and metadata and are re-evaluated under this admission policy; no legacy purchases/corrections are migrated or changed.

Steam enters matching as **Purchased**, with Humble key-entitlement provenance and activation **Unknown**. Humble redemption timestamps and key availability never establish Steam account ownership or activation.

DRM-free and other unclassified purchases retain **Purchased ? Media: Unknown**. They are available through the generic account-scoped purchase view and the disabled pilot's saved-items disclosure (at most 50 rows). Distinct native copies remain separate there. Unknown-media purchases are withheld only from media-specific matching; lack of classification is not an admission failure. There is no default-to-book or title heuristic.

Secret key fields, signed URLs and download payloads are not projected, persisted or displayed. No reveal, redeem, download or grant-refresh action is invoked.

## Bounded acquisition and recovery

Read the authenticated Library HTML envelope, parse only literal embedded Flight bootstrap strings without executing scripts, resolve the current public UserLibrary `filterUserLibrary` action without executing code, then use the observed native FormData encoding. GET requests accept HTML; action POSTs accept Flight. Redirects are refused. No fixed deployment action hash is shipped. Unknown Flight/action encodings fail closed. All account-provider components must contain the same valid principal; conflicting or missing principals abort acquisition.

A single bounded check reads five Purchased pages by default, ten at most. A check uses the site's own five rows per page unless the sync asks for 50 or 1,000; one check never reads more than 1,000 rows. Additional per-check ceilings: twenty distinct parent reads, eight public assets, two account-envelope reads. HTML bootstrap module lists include shared dependencies; discovery examines at most eight trailing module chunks and fails if no unique exact action reference is found. Failed parents are cached as unresolved. There are no known-ID early stops or periodic scans. Network deadlines and response/framing/reference bounds apply. Full traversal uses the resumable sync below, which is made of these same bounded checks.

Requests never follow redirects (`redirect: 'manual'`). A redirect, 401 or 403 means sign-in is required, and the account scope becomes fatal. A 429, or a 503 with Retry-After, means the provider asked for fewer requests; the sync stops without retrying around it. Network failures, timeouts, 408 and other 5xx responses are transient. A transient parent-detail failure rolls back that whole page, so a retry reads it again rather than recording it as unresolved.

## Resumable full-Library sync

The user explicitly starts a sync from the pilot panel on the signed-in Library page and confirms the account. It runs only in that tab while the page is open; nothing runs in the background or on a timer. A runner (`createSync`) executes sequential batches. Each batch is one `collect` call: envelope → begin → pages → envelope → commit. Defaults: one 1,000-row page per full-sync batch, at least one second between provider requests (all request types share one gate), five seconds between batches, three retries for transient no-progress batches (15 s, 60 s, 180 s), and session limits of 12,000 requests or eight hours. After a session limit the sync pauses and the user resumes it. Settings validation enforces floors (≥ 500 ms spacing, ≥ 2 s between batches, ≥ 5 s per retry delay, ≤ 10 pages per batch), so settings cannot make the sync aggressive. Within a session the runner reuses the discovered action and account-checked parent details (at most 300, for at most 20 minutes); each batch still verifies the account before and after reading.

### Checkpoint

Each provider scope may carry one version-1 `sync` checkpoint. It records:

- `id`, `mode` (`full` or `refresh`) and `revision`
- `status` (`running`, `paused`, `completed`, `cancelled` or `stopped`) and `reason`
- page position: `nextPage`, `targetPages`, reported pages/total, and the native IDs of the last page read
- cumulative pages, batches, and added / refreshed / unresolved / conflicting / duplicate counts
- uncertainty codes, `lastFull`, and constant `historicalComplete:false` and `reconciliationAuthority:'none'`

The worker computes the checkpoint (`advance`) inside the same atomic write as that batch's observations. A failed write therefore leaves the earlier checkpoint and observations unchanged. Caller-supplied progress is checked against the validated scan (`nextPage = firstPage + pagesRead`). Caller evidence can add uncertainty but never remove it. Batch scans carry `firstPage`; older scans default to page one.

A tab-bound lease (`hclLibraryEntitlementLease`) identifies the runner that owns the sync. Begin and commit check that lease and the expected revision. Restore, clear, profile switch/rename and legacy scans clear the lease along with the pending token. Another tab claiming the sync also clears it. A superseded runner stops without writing. Pause, cancel and stop between batches use the `entitlementSync` operation. It updates only the active local account's checkpoint, at the expected revision. A new run cannot silently replace a running, paused or stopped checkpoint.

The checkpoint is part of `libraryEntitlements`, so it is included in backups and profile archives and is replaced or cleared together with the observations. Older backups without it restore no checkpoint. After a restore, the restored checkpoint matches the restored observations and can be resumed explicitly. After a browser or extension restart, a checkpoint still marked `running` is shown as interrupted, and only an explicit Resume continues it.

### Pagination instability

Page position is progress, not proof of observation. Each later batch first re-reads the previous batch's last page and compares its native IDs with the checkpoint (`ordering-changed`). The other uncertainty codes are:

- `totals-changed`: totals changed between or within batches
- `pagination-loop`: a repeated page
- `items-unresolved`: unresolved items
- `duplicate-conflict`: conflicting duplicates

A full sync's target follows the latest reported page count. A full sync completes as `accessible-pages-traversed` only when it has no uncertainty; otherwise it completes as `incomplete`. Empty or short pages that contradict reported totals never advance the checkpoint. Observations absent from later pages are never removed.

### Live full-Library pilot (November 12)

A read-only memory-only diagnostic first sampled pages 1, 400, 800, 1200 and 1647. All 25 rows had parents in the initial 206-parent list and were verified as Purchased.

The pilot build then ran against a real Firefox library as a temporary add-on with the same extension ID and storage UUID. It completed a real full sync of 1,647 of 1,647 reported pages (8,235 rows) in 165 batches over about 70 minutes, with no retries, rate limits or sign-in problems. Every row is accounted for:

| Rows | Outcome |
|---:|---|
| 8,111 | Unique native entitlements saved: 8,109 Purchased, 2 excluded as gifted |
| 10 | Already saved earlier in the same sync |
| 68 | Duplicate rows within a batch |
| 46 | Not verified |

The stored data checked out:

- Every saved entitlement is bound to the active saved account.
- Activation is Unknown for all of them.
- No key, redemption or download fields were stored.
- A backup round-trip keeps observations and the checkpoint.

The sync completed `incomplete` because of `items-unresolved`. Legacy items, summaries, history, reminders, corrections and import history were byte-identical (by hash) before and after. A diagnostic of the 10-page range containing one unverified row found its cause: the provider title contained control characters (a line break or tab). Provider titles are now normalized by collapsing control-character runs into a space. Row/detail title agreement and every native-ID, parent and account check are unchanged. Stored observations still reject control characters, and a title that is blank after normalization stays unresolved.

A second full sync, with the fix, used the same storage and changed nothing in the legacy data. It read all 1,647 pages in 166 batches over about 77 minutes. There were no retries, rate limits or sign-in problems.

| Rows | Outcome |
|---:|---|
| 4 | Newly saved (titles with line breaks or tabs) |
| 8,121 | Already saved, refreshed |
| 68 | Duplicate rows within a batch |
| 42 | Not verified |

The library now holds 8,115 unique entitlements: 8,113 Purchased and 2 excluded. Nothing was duplicated. A memory-only reason diagnostic read all 8,235 rows and explained every remaining row:

| Rows | Reason |
|---:|---|
| 41 | The row's parent is not in the Library page's initial parent list |
| 1 | The parent's detail page does not list the row |

All 42 rows are on pages 1,295–1,591. Each is withheld as unresolved and not admitted, and the sync stays `incomplete`.

### Parents outside the bundle list

A targeted memory-only diagnostic re-read only those 18 pages and the affected parents. It found that the Library envelope's `bundleItems` contains only `bundle` parents (206 of 206). The 41 missing-parent rows belong to 21 parents whose own detail pages report `storefront` (20) or `widget` (1). These are store and widget purchases, not catalog changes. For every one of the 21:

- The row came from the authenticated Purchased Library action under the active account's user ID.
- The detail read used the same signed-in principal.
- Exactly one `ProductKeysDownloads` component named that parent.

The route takes a per-account `productEntitlementId`, not a public product ID. A random ID returns a page with no `ProductKeysDownloads`, which is rejected.

A parent missing from the envelope is now read from its own detail route and accepted only when its type is `storefront` or `widget`. The row still needs:

- the account check;
- a single detail component naming its parent;
- an exact native child with the same ID, type and title;
- the gift, revocation and temporary-access rules.

An unlisted `bundle` parent, an untyped parent, or one without the detail component stays unresolved. A detail page from another account aborts the batch. A memory-only production run on the 18 pages verified 88 of 90 rows, including 40 of the 41 missing-parent rows, all Purchased.

The two remaining rows are parent-level rows, not individual entitlements:

- **Widget row:** its ID is its widget parent's. The parent's only child has that ID but no type.
- **Bundle row:** its ID is its listed bundle parent's. The detail lists two DRM-free files with other IDs.

Neither has an exact typed native child, so both stay unresolved. Titles are not used to link them.

### Full-sync performance

The second live full sync took 77.5 minutes: 166 batches at about 28 s each.

Each batch made at least 13 paced requests: two account envelopes, one overlap re-read and ten 5-row pages. Parent-detail misses came on top. It then waited 10 s. About 2,400 requests ran at one per second, so spacing and pauses, not parsing or storage, set the duration.

Humble's frontend sends `limit` as an explicit form field of the read-only `filterUserLibrary` action, hard-coded to `"5"` (`cursor` is `5 × page` and is ignored). Bounded memory-only live tests found that the action honours larger limits:

- Limits of 50, 100, 250, 500 and 1,000 all returned the requested number of rows, with `totalPages = ceil(totalDocs / limit)` and every row bound to the account.
- The final partial page was correct.
- Latency was 0.3–1 s per request at every size; a 1,000-row page is about 0.9 MB.

The same tests showed that the 5-row pager was also incomplete. Humble's `mostRecent` order is not stable across page requests, so a row can repeat at a page boundary while another is skipped:

| Rows per page | Requests | Rows read | Unique rows | Rows skipped |
|---:|---:|---:|---:|---:|
| 5 (first 100 rows only) | 20 | 100 | 84 | 16 |
| 250 | 33 | 8,235 | 8,234 | 1 |
| 1,000 | 9 | 8,235 | 8,235 | 0 |

The two 5-row full syncs therefore saw about 8,157 distinct rows of 8,235. Their 68 "duplicates" hid roughly 77 rows that were never served.

The full sync now reads 1,000-row pages, one page per atomic batch, with five seconds between batches. Refresh reads 50-row pages. Everything else is unchanged:

- request spacing (one per second), retries, 429/Retry-After and sign-in handling;
- account checks before and after each batch, and the parent-detail checks;
- overlap re-reads, which now compare the boundary tail;
- checkpoint atomicity, pause/resume, cancellation and backup.

The checkpoint and scan record `pageSize`, and older records are 5. An unfinished 5-row sync resumes at 5 rows. A `pageSize: 5` setting reproduces the site's pager. A full pass that ends with fewer distinct rows than Humble reports is marked `items-missed` and stays `incomplete`. If Humble stops honouring the limit, short pages fail validation and the sync stops; it never skips rows.

`node tests/library-sync-benchmark.mjs` runs both configurations on 8,235 synthetic rows across 206 bundle, 20 store and 1 widget parent. It models network time from the measured latencies and measures CPU time directly:

| Configuration | Batches | Requests | Per 1,000 rows | Network | Spacing | Batch pauses | CPU | Projected |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 5-row pages, 10 s pauses | 165 | 2,369 | 288 | 19.0 min | 21.1 min | 27.3 min | 0.9 min | 68.5 min (measured live: 77.5) |
| 1,000-row pages, 5 s pauses | 9 | 263 | 32 | 2.4 min | 2.0 min | 0.7 min | 0.05 min | 5.1 min |

Parent-detail reads (227, one per distinct parent) are now 86% of requests. The peak rate is unchanged at one request per second, and total requests to Humble fall by 89%.

A live memory-only run of the production collector with 1,000-row pages read page 1 (1,000 rows, including action discovery) in 33 s and the final page (235 rows) in 19 s: 46 requests in total. Every row was verified as Purchased, with no unresolved, duplicate or conflicting rows.

A live full sync of the same Firefox library at 1,000 rows per page took 5 minutes 49 seconds: 9 batches and about 270 requests. It read all 9 reported pages, with no retries, rate limits, sign-in problems or pagination inconsistencies.

| Rows | Outcome |
|---:|---|
| 118 | Newly saved: the 40 store purchases and 78 rows the 5-row pager never served |
| 8,115 | Already saved, all seen again |
| 0 | Duplicates |
| 2 | Not verified (the parent-level bundle and widget rows) |

The library now holds 8,233 unique entitlements: 8,231 Purchased and 2 gifts excluded. Every one was observed in this sync, and `items-missed` was not raised. Coverage stays `incomplete` only because of `items-unresolved`. Legacy items, summaries, history, reminders, corrections, import history and account scope kept their fingerprints. Observations and the checkpoint survived an extension reload unchanged.

### Refresh

**Check recent purchases** reads the most recent 50-row page (sort `mostRecent`). It widens to `ceil(growth / 50) + 2` pages, at most 40, when the reported total has grown since the previous run. It continues through that whole range even when it sees known IDs, and completes as `recent-pages`, which never claims full coverage. The last full-sync result (`lastFull`) is kept. Users can run the full sync again at any time.

Identical overlaps deduplicate by scoped native identity. Conflicting duplicates are withheld, retaining any previously saved record. Whole-page loops, changing totals, inconsistent ranges, malformed/truncated responses and later failures are reported incomplete. Independently verified earlier records may commit; auth/account uncertainty aborts the batch. Unknown parent sources remain unresolved.

Coverage is `bounded`, `incomplete` or `accessible-pages-traversed`. The latter refers only to the response's explicit accessible range within the bound, always with `historicalComplete:false` and `reconciliationAuthority:'none'`. It does not prove omission-free migrated history. A batch that starts after page one is never `accessible-pages-traversed` by itself; only a completed sync checkpoint can carry that coverage, under the same limits.

## Options library browser

The Options page browses by **Titles**, the default and unchanged historical title catalog, or by **Bundles & Orders**. `library-browser.js` is a read-only presentation model; it never writes storage or legacy records.

Groups:

- **Historical groups** are keyed by order key, with names, dates and listed item counts from `purchaseSummaries`. A record without an order key is grouped by bundle name and says so.
- **Native groups** are keyed by parent ID, from the active account's scope only, and only when the collector is enabled.
- Distinct order keys and parent IDs stay distinct purchases. Repeats with the same name are labelled "one of N separate purchases".
- Historical and native records share no identifier, so they are never joined. A shared name is shown as unconfirmed.

Each observation stores the account-checked parent's name as optional `parentTitle`. Records saved before this field show a placeholder name until the next full sync.

Search scope is explicit:

- **Titles** keeps the original title-only match.
- **Bundle & order names** matches group names.
- **Both** matches either.

In Bundles & Orders, title matches are counted in the summary and listed first, marked "Match:". Group filters cover contained media (never inferred), source, repeat purchases, excluded items and native purchase type. Sorting is by name, date (unknown dates last) or title count. Pagination is shared at 20/50/100/200, each view keeps its own page, and contents render only when a group is expanded, 100 titles at a time.

**Open on Humble** uses only routes from Humble's own frontend route manifest, verified read-only against the signed-in account:

- `/home/library/{parentId}` for a bundle, store or widget purchase;
- `/home/library/content/{entitlementId}`, which shows exactly that entitlement (checked for DRM-free and Steam items; an unknown ID shows nothing).

Both require UUID native IDs and open in a new tab without displaying the URL. Historical order keys have no verified page. `/home/purchases/{id}` takes the new order system's UUID, and the old `/downloads?key=` link now redirects to the generic Library. Historical groups therefore explain that there is no direct link.

On the same Firefox library, a read-only check showed 460 groups: 234 historical, plus 226 native (206 bundles and 20 store purchases), with 2 unresolved rows noted. A later full sync (5 minutes 49 seconds; all 8,235 rows accounted for, 0 new, 2 unresolved) named all 226 native purchases consistently. The names had no control characters and none were generic. The live view then:

- found a comic bundle and a store purchase both by name and by contained title;
- kept same-named historical and native purchases as separate groups;
- opened a store purchase's verified link to the matching Humble page.

Names and observations survived an extension reload. With 200 groups per page, the view rendered in 4 ms with 600 DOM nodes, and searches took about 1 ms. Storage was unchanged. Synthetic tests use 7,000 titles in 240 orders and 8,233 native entitlements across 226 parents.

## Companion boundary

Observations never enter legacy libraryItems, summaries, reminders, corrections or companion transaction snapshots. Old GL/FAN cannot receive them as fabricated purchases or Steam ownership.

`projectForGL` is a different versioned, salted-reference **projection only**. There is no transport hook or automatic sharing. A compatible GL capability and explicit account/consent review are required before sending it. Existing purchase/reminder sync remains unchanged.

## Validation and activation gates

Unit fixtures exercise actual acquisition, projection and serialized persistence: IDs/copies, repeated upserts, duplicate conflicts, loops, partial failures, account changes, storage rejection, stale tokens, backup/restore, profile isolation, admission and storefront matching.

Installed tests exercise collector → message → worker → storage → reload in disposable Chrome/Firefox profiles with synthetic provider transport. They also click the pilot panel and explicitly observe started/completed states. Separate default builds test that acquisition and worker writes are blocked. These are not live authenticated imports or real disk-failure tests.

Before normal-user activation, review the bounded scan UX and supported source coverage, retaining the tested account/persistence/preservation guarantees. Isolated real DRM-free and Steam acquisition and Purchased admission now pass. Media-specific classification and a compatible GL transport are separate capabilities, not prerequisites for generic Purchased records. Missing optional delivery fields do not block Purchased; explicit exclusions still do.

### November 12 live-pilot follow-up (historical strict-policy findings)

The eligibility rejections below describe the initial strict policy and are superseded by the Purchased policy above. The acquisition/identity evidence remains relevant.

The memory-only pilot uses the production collector/parser in the existing Humble page, with the guard enabled only in an isolated diagnostic copy. It has no extension messaging or persistent storage adapter. Only aggregate diagnostics are exported.

The first real Library response exposed unsupported Flight `X`/`C` stream and `E` error frames. The reader now skips unrelated closed streams and error chunks, keeping their IDs unavailable as evidence. Required account/item references to those IDs still fail; malformed, duplicate and unclosed frames remain rejected. This follows the framing distinctions in [React's Flight client](https://github.com/facebook/react/blob/main/packages/react-client/src/ReactFlightClient.js), without executing provider code or implementing stream-based entitlement evidence.

After this repair, bare RSC reads returned an AuthProvider without a signed-in user and no UserLibrary component. Later testing after sign-in isolated a request-format discrepancy: RSC GETs redirected, while normal HTML GETs supplied the authenticated Library, 206 parent groups and two agreeing account-provider components. The earlier RSC result alone therefore did not establish that the browser was logged out. The cause of the separately observed sign-out remains unproven. The collector now uses the successful HTML GET representation and refuses redirects rather than following an authentication route.

The revised production collector completed a memory-only two-page live pilot: ten returned rows, nine distinct DRM-free observations, one identical overlap, zero conflicts/unresolved items, and stable account scope before/after. Counts were 8,235 accessible entries / 1,647 reported pages; coverage remained bounded and historicalComplete false. All nine were observation-only: parent preorder was missing. Missing directRedeem/integration fields are not DRM-free admission requirements. There was no explicit negative eligibility evidence in those nine. No records were written to installed-extension storage.

Group metadata supplied structural itemType/type and empty deliveryMethods arrays, not authoritative DRM-free book/game/software categories. One key-placeholder parent resolved to two DRM-free children, demonstrating that placeholder type cannot classify individual entitlements. A diagnostic Steam-filter action returned the same DRM-free rows; it is not evidence of successful filtered enumeration.

A real individual Steam detail was then opened. Two detail reads agreed on its native ID/title/type and account. Two one-page collector runs, using an exact-title search only as a locator, each resolved the exact selected native ID through its parent and saved one in-memory observation. Native identities were identical across both runs, with no conflicts or unresolved items. This verifies the existing acquisition path for that sample, not omission-free Steam enumeration or separate-copy behavior. Search titles did not establish or merge identities.

That Steam observation remains observation-only: directRedeem and parentPreOrder are unknown, keyIntegrationId is present rather than explicitly null, and unavailableAfter is a future date. expired/preOrdered/outOfStock are false, redeemable is true and giftStatus is unassigned. A recorded Humble redemption timestamp supplies no Steam activation evidence. A future boundary is not an already-expired flag, but the current rule still requires an unrestricted null boundary. Frontend defaults for absent directRedeem/preOrder control rendering and credential actions; they do not independently validate permanent ownership. No admission predicate was relaxed. Sanitized equivalents now exercise acquisition, persistence, matching exclusion, GL projection and backup/restore in unit and installed-browser tests.

No admission predicates or media classifications changed. Public frontend handling of absent redemption groups is a rendering default, not independent proof of eligibility. `download_drm_free` describes delivery, not media; no default-to-book rule is authorized. The source guard and redesigned purchase-history importer remain disabled.

Commands: `node --test tests/library-entitlements.test.mjs tests/library-sync.test.mjs`; `node tests/runtime.mjs --library-entitlements [--firefox]`; `node tests/runtime.mjs --library-entitlements-disabled [--firefox]`. Packages are staged only in disposable temporary directories.

Sync unit tests cover:

- multi-batch traversal and atomic batch writes
- pause and resume; resume after a simulated reload or worker restart
- network and parent-detail retries; retry exhaustion
- redirects and 401 sign-in expiry; 429 rate limits
- account changes, profile switching, restore and clear during a sync
- storage-write failure and rollback
- overlap, duplicates and conflicts
- changed totals and ordering; pagination loops; empty or short pages
- request pacing and backoff, settings floors and session limits
- cancellation; previously collected observations; explicit exclusions
- refresh widening; forged checkpoints and progress; concurrent tabs; the disabled gate

Installed Chrome and Firefox checks drive the real panel through Start, Pause, Resume and completion. They run sync scenarios against the real worker and storage, and leave an interrupted sync behind. The harness then reloads the page and restarts the extension (stops the Chrome service worker; reloads the Firefox temporary add-on), and the resumed sync must complete without duplicates or legacy changes. These remain synthetic-provider tests. No live full-Library traversal has been performed.

### Practical-policy live validation

With the revised source in an isolated in-memory adapter, the two-page unfiltered pilot admitted all nine distinct DRM-free observations as Purchased (one duplicate overlap, no conflicts/unresolved items). Repeated targeted runs admitted the exact Steam native entitlement as Purchased, with stable identities and activation Unknown. Both retain historicalComplete false and reconciliationAuthority none. No installed-extension storage was written. Full-history/migration completeness is deliberately unclaimed.
