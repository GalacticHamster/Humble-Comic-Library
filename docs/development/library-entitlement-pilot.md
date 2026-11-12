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

Default five Purchased pages; maximum ten, five rows each. Additional ceilings: twenty distinct parent reads, eight public assets, two account-envelope reads. HTML bootstrap module lists include shared dependencies; discovery examines at most eight trailing module chunks and fails if no unique exact action reference is found. Failed parents are cached as unresolved. No automatic retries, periodic scans, full-history traversal, resumable checkpoints or known-ID early stops. Network deadlines and response/framing/reference bounds apply.

Identical overlaps deduplicate by scoped native identity. Conflicting duplicates are withheld, retaining any previously saved record. Whole-page loops, changing totals, inconsistent ranges, malformed/truncated responses and later failures are reported incomplete. Independently verified earlier records may commit; auth/account uncertainty aborts the batch. Unknown parent sources remain unresolved.

Coverage is `bounded`, `incomplete` or `accessible-pages-traversed`. The latter refers only to the response's explicit accessible range within the bound, always with `historicalComplete:false` and `reconciliationAuthority:'none'`. It does not prove omission-free migrated history.

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

Commands: `node --test tests/library-entitlements.test.mjs`; `node tests/runtime.mjs --library-entitlements [--firefox]`; `node tests/runtime.mjs --library-entitlements-disabled [--firefox]`. Packages are staged only in disposable temporary directories.

### Practical-policy live validation

With the revised source in an isolated in-memory adapter, the two-page unfiltered pilot admitted all nine distinct DRM-free observations as Purchased (one duplicate overlap, no conflicts/unresolved items). Repeated targeted runs admitted the exact Steam native entitlement as Purchased, with stable identities and activation Unknown. Both retain historicalComplete false and reconciliationAuthority none. No installed-extension storage was written. Full-history/migration completeness is deliberately unclaimed.
