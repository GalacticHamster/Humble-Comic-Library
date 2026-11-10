# Changelog

## Unreleased ? automatic local sharing

- Discover official Galactic Hamster companions automatically and share supported saved purchases locally by default. Upgrade legacy setup states without treating them as explicit opt-outs; remember the new sharing setting across restart and library restore.
- Preserve verified account mappings, additive purchase/history merges and save-time authorization. Ambiguous populated accounts still need a one-time account decision in Advanced.
- Keep standalone imports and reminders available without GL; share supported additional HB reminders through the mapped account without duplicate native reminders. No key values or provider credentials are shared.

## 1.0.2 — Release candidate

- Save independently verified Humble purchases when another purchase cannot be read, preserving earlier purchases, history and manual corrections. Unresolved purchases remain retryable; account/session conflicts still prevent unsafe saves.
- Improve first-account recovery and retain normal incremental imports after valid saved purchases. Partial purchase additions can reach Galactic Library through the existing consented synchronization protocol.
- Clarify the privacy policy's explicitly enabled Software diagnostic export, which can contain product titles and bundle names.

Prepared locally for review; not submitted or published. No new permissions, ownership/matching rules or synchronization protocol changes since published 1.0.1.

## 1.0.1

- Request `unlimitedStorage` in Chrome and Firefox so large local libraries and purchase histories are not blocked by the normal extension-storage quota. Import validation and single-write commits remain unchanged; failed writes preserve previous purchases and manual corrections. Disk exhaustion and browser-wide storage failures remain possible.

## 1.0.0 ? Local release candidate

- Import Humble books, comics, games, audiobooks and supported software into a browser-local library and refresh newly saved purchases.
- Check supported Humble bundles with conservative Owned, New, Possible and Partial badges, source explanations and tier summaries.
- Use standalone checks without Galactic Library, or connect optional external-library matching and explicitly authorized saved-purchase synchronization.
- Keep routine imports simple with an optional account nickname; preserve separate saved accounts, purchase history and local backups.
- Save supplied Humble purchase prices, currency and history locally for provenance and value summaries. Financial-data disclosure remains applicable even though no developer server receives this information.

Prepared locally; not yet published. Uncertain editions and temporary or historical-only access do not become confirmed ownership.

## Earlier development notes

- Adds manual, account-scoped entitlement reminder sharing with Galactic Library using opaque references and narrow status/date DTOs; complete staged uploads preserve previous reminders on failure and never claim destination activation.
- Adds installed-extension checks in Chrome and Firefox plus storefront fixtures in both browsers and a real Chrome HB-to-GL exchange. Includes the Firefox restore dependency and rejects destructive incomplete full-scan commits in the background writer.

- Detects audiobook listings and individual audiobook items on Humble Books pages for media-separated local and Galactic Library comparisons. Exact confirmed external ownership is labelled Owned elsewhere; temporary access remains a review candidate. Software companion lookup now requires the API to explicitly advertise support.

- Defines full-rescan reconciliation: only complete successful scans replace current Humble items, purchase summaries, and reminders; manual titles remain protected, failed scans retain previous entries and schedule retries, and historical purchase evidence is archived separately in version-7 backups.

- Fixes the key-reminder discovery failure handler so failed purchase fetches increment aggregate failure counts and allow the remaining report to complete.

- Separates manual title-list import from backup restore. Version-6 backups preserve purchase provenance, purchases, reminders, import/scan state, and mappings; restores replace previous library state without retaining unrelated reminders.

- Adds a Diagnostics-only, privacy-preserving purchase-navigation report for adapting individual-order links to Humble's current Purchases markup.
- Presents key reminders as an expiry-organized action queue with an **Open purchase** control, plus an explicit opt-in direct-order route for users who accept a purchase identifier in the Humble URL and browser history to avoid popup requirements.
- Integrates key-reminder checks into purchase imports: new imports inspect new and pending purchases, while **Rescan every purchase** establishes the complete reminder baseline.
- Adds a separately packaged Firefox desktop Manifest V3 build while retaining the existing Chrome manifest and package unchanged. Automated installed-runtime and storefront checks now cover Firefox; signed-release and live-account smoke testing remain part of AMO preparation.
- Adds first-class Humble Software support for purchases, bundle pages, and the Software catalogue.
- Preserves `software` item kinds through local backup import/export and reports them in the options-page library summary.
- Treats exact Software titles as owned and explicit version variants as Possible rather than Owned.
- Performs one full local entitlement backfill after upgrade to distinguish earlier Humble Software records from games, including GameMaker project deliveries and generic entitlements from explicitly named Software Bundles.
- Adds a local, redacted Software product-classification discovery report for diagnosing real Humble purchase metadata without exposing keys, URLs, or raw purchase responses.

## 0.1.0

Initial Chrome Web Store release candidate.

- Imports eligible Humble books, comics, and detected game entitlements into local browser storage.
- Compares library titles with Humble Books and Games listings, including exact, partial-range, and conservative possible matches.
- Shows owned-title provenance and supports local export and complete data clearing.
- Identifies purchased and partially purchased offers in Humble's Books, Games, and Bundles catalogues.
- Sorts catalogue offers by time remaining and provides catalogue filters for purchased offers and offers ending within seven days.
- Sorts items within individual bundles naturally, offers a confirmed-new-items-only view, and recommends the lowest tier containing all confirmed-new items.
- Includes an optional diagnostics view for troubleshooting library comparisons and catalogue sorting.
- Limits extension activity to Humble Books, Games, and Purchases pages.
- Includes a deterministic, allowlisted release ZIP process.

Future Store uploads must increase the numeric version in `manifest.json` and add a matching changelog entry.
