# Authenticated Library entitlement pilot

Status: implemented, **disabled**. This is independent of the disabled redesigned purchase-history importer. It does not replace purchase history or establish complete migration coverage.

`library-entitlements.js` has a source-level `ENABLED = false` guard. Acquisition, matching and the worker check it. No preference, webpage message or normal UI enables it. Installed tests enable only a temporary package copy; they never rewrite source or existing release ZIPs.

## Identity, preservation and backup

The optional `libraryEntitlements` state/backup field has its own version-1 validator. Identity is `(authenticated principal ID, Library user ID, entitlement namespace/type, native individual ID)`. Title, parent native ID, source, non-secret eligibility and observation time are metadata. No purchase key, order ID, acquisition date, historical alias, secret key value or destination activation is invented.

The pilot requires an established saved local account and explicit confirmation. Local IDs bind storage but do not substitute for provider identity. A bound profile cannot silently switch provider scope. First-account setup automation is outside this pilot.

Begin/commit/abort use the existing serialized worker. A 15-minute token binds the sender tab, local account/profile and provider scope. New scans, account changes, restore and clear invalidate old work. Commits reconstruct fields, recompute admission and atomically write only observations plus token cleanup. Failed writes preserve prior observations and all legacy arrays, corrections, checkpoints and reminders. There are no delete-first writes or absence reconciliation.

Same-title/different-ID observations remain separate. Identical observation candidates may be grouped for presentation only, retaining all native references and explaining that purchase/copy equivalence is unknown. Titles never transfer corrections or establish legacy identity. Negative refreshed evidence can remove that observation's authority, never historical evidence.

Validated observations are backed up even while disabled. Older backups lacking the optional field restore an empty collection. Replacement restore and Clear library replace/clear it; saved profile archives retain it. The existing backup format/version is unchanged; older extensions cannot preserve this new optional field, so restore pilot observations with the current code.

## Admission rules

Raw observations are distinct from ownership admission. For supported `download_drm_free` and `steam` namespaces, qualifying evidence requires:

- Authenticated Purchased row and exact individual ID/title/type in its authenticated parent detail.
- Same principal before/after traversal, pinned Library user ID on every row and matching parent route/account.
- Explicit parent type `bundle`, parent preorder false and an explicit empty redemptionGroups array.
- giftStatus `unassigned`; expired, preOrdered and outOfStock explicitly false; redeemable explicitly true.
- unavailableBefore and unavailableAfter explicitly null. Missing or finite dates do not qualify in this first rule.

Steam additionally requires directRedeem explicitly false and keyIntegrationId explicitly null. Missing integration/group/preorder fields do not default to false/none. Subscription/Choice/Vault, gifted, expired/unavailable, preorder, choice-group and unknown states remain observation-only.

Qualified Steam entries enter local matching as **Purchased**, with “Humble Library key entitlement — activation not confirmed.” Existing matching safeguards remain. Humble redeemedAt is non-secret provider evidence, not purchase date or Steam activation. Activation is always unknown.

Qualified DRM-free records receive personal-entitlement admission, but media type remains **unknown**: the verified source does not establish whether every DRM-free file is a book, game or software. They are stored but not supplied to media-specific matching. There is no default-to-book or title classification. This is a production activation limitation.

keyFormatted, externalAccountName, gameKey, signed URLs, download payloads and instructions are never projected/persisted. No reveal, redeem, download or grant-refresh action is invoked. The actual live samples have unknown fields under these strict rules and are not promised matching admission.

## Bounded acquisition and recovery

Read the authenticated Library envelope, resolve the current public UserLibrary `filterUserLibrary` action without executing code, then use the observed native FormData encoding. No fixed deployment action hash is shipped. Unknown Flight/action encodings fail closed.

Default five Purchased pages; maximum ten, five rows each. Additional ceilings: twenty distinct parent reads, eight public assets, two account-envelope reads. Failed parents are cached as unresolved. No automatic retries, periodic scans, full-history traversal, resumable checkpoints or known-ID early stops. Network deadlines and response/framing/reference bounds apply.

Identical overlaps deduplicate by scoped native identity. Conflicting duplicates are withheld, retaining any previously saved record. Whole-page loops, changing totals, inconsistent ranges, malformed/truncated responses and later failures are reported incomplete. Independently verified earlier records may commit; auth/account uncertainty aborts the batch. Unknown parent sources remain unresolved.

Coverage is `bounded`, `incomplete` or `accessible-pages-traversed`. The latter refers only to the response's explicit accessible range within the bound, always with `historicalComplete:false` and `reconciliationAuthority:'none'`. It does not prove omission-free migrated history.

## Companion boundary

Observations never enter legacy libraryItems, summaries, reminders, corrections or companion transaction snapshots. Old GL/FAN cannot receive them as fabricated purchases or Steam ownership.

`projectForGL` is a different versioned, salted-reference **projection only**. There is no transport hook or automatic sharing. A compatible GL capability and explicit account/consent review are required before sending it. Existing purchase/reminder sync remains unchanged.

## Validation and activation gates

Unit fixtures exercise actual acquisition, projection and serialized persistence: IDs/copies, repeated upserts, duplicate conflicts, loops, partial failures, account changes, storage rejection, stale tokens, backup/restore, profile isolation, admission and storefront matching.

Installed tests exercise collector → message → worker → storage → reload in disposable Chrome/Firefox profiles with synthetic provider transport. They also click the pilot panel and explicitly observe started/completed states. Separate default builds test that acquisition and worker writes are blocked. These are not live authenticated imports or real disk-failure tests.

Before activation, validate live bounded acquisition and missing/negative eligibility; separate-copy semantics; account-switch/recovery; DRM-free media classification; and any compatible GL observation transport. Preserve legacy purchases/corrections throughout. Do not relax missing fields to obtain Owned badges.

Commands: `node --test tests/library-entitlements.test.mjs`; `node tests/runtime.mjs --library-entitlements [--firefox]`; `node tests/runtime.mjs --library-entitlements-disabled [--firefox]`. Packages are staged only in disposable temporary directories.
