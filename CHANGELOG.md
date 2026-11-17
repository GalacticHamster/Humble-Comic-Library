# Changelog

## 1.1.2 — Unreleased

- Minimizing, expanding or repositioning the bundle ownership panel keeps existing badges and results visible without repeating ownership checks or Galactic Library requests. Preference changes also leave in-progress checks running normally.
- Humble's cart drawer and other Humble pop-ups now appear above the ownership panel and badges. They step aside while it is open and return unchanged, minimized or expanded, when it closes, without checking ownership again.
- The ownership panel no longer covers Add to Cart. In narrow windows and at high zoom, where Humble pins its tier choice and Add to Cart to the bottom of the window, a panel docked at the bottom sits above that bar. On short screens the expanded panel takes at most half the window height and scrolls inside. Your chosen position and minimized state are kept, the panel does not move while you scroll, and nothing is checked again.
- Purchases synced from your Humble Library now count on bundle pages and in the catalogue. Buying a title again shows Owned ×2, counted as Titles counts it: a Library purchase that is one of your earlier imported orders counts once, and copies in other stores found through Galactic Library never add to the count. Newly bought bundles are marked Purchased in the catalogue and on their own page. When Humble's Library names an item with a subtitle its bundle card leaves out (such as "Human Remains: The Complete Series" for "Human Remains"), buying that exact bundle shows the card as Owned; other similar titles still show Possible. Humble's Library lists no purchase dates, so these purchases are shown without one rather than with an invented date.
- New **Recently added** sorting in Titles and Bundles & Orders finds purchases a Library sync has just found. From this version, the extension records when a sync first sees each Humble Library purchase and shows it as "First synced", kept apart from the purchase date. Repeat syncs keep the original time, backups keep it, and purchases that match your earlier imports are not treated as new. Purchases synced before this version have no first-synced time, because it was never recorded; they keep their place under Purchase date and appear after recently added ones.

## 1.1.1 — Sync from your Humble Library

Replaces the unpublished 1.1.0 candidate.


- Sync purchases from Humble's redesigned Library page. **Sync full Library** reads the whole Library, **Check recent purchases** picks up new orders, and syncs can be paused, cancelled and resumed later, even after a browser restart. Each batch is saved with its progress; sign-in, account, rate-limit and incomplete-coverage problems are explained with the next step. The old purchase-page importer, which Humble's redesign broke, now points here.
- Synced purchases are stored separately from purchases imported before the redesign, and are checked against the signed-in Humble account. Nothing is removed or replaced. Gifted, revoked and temporary-access items are not counted as purchases, and Steam or other key activation stays Unknown.
- Synced purchases take part in bundle-page ownership checks, including comics, books, audiobooks, software and DRM-free games. Media comes from the download type and file formats Humble lists, as the old importer used; purchases saved before this version use the same title's media from earlier imports or an explicit Book, Comics or Software Bundle name. Anything else stays Unknown and is not guessed. The existing matching rules still keep sequels, other editions, omnibuses and unrelated titles apart, and a Humble Steam key is shown as Purchased, not activated.
- Synced purchases are shared with Galactic Library through the existing automatic purchase sync, once a Library sync finishes. A title already shared from earlier imports is not sent again; only further copies are, so repeat purchases stay distinct without doubling. Records Galactic Library sends back are recognised and never become imported purchases. Items with unknown media and videos are not shared.
- A first install can sync without an earlier import. Extension options, the toolbar popup and the Titles and Bundles & Orders views now show synced purchases, including titles that exist only in the Humble Library. Likely matches between earlier imports and synced purchases are combined in Bundles & Orders for display only.
- Game bundle pages show ownership again on Humble's redesigned pages: every game is read from its card, with its tier. Page controls such as Select your bundle and Adjust Donation are never counted as items, and if a card can't be read the page says so instead of showing a partial list.
- Extension options stay current while a sync runs in another tab: new purchases, titles and links appear without reloading, keeping your view, search, filters, page and expanded rows. Progress alone updates only the sync summary.
- Titles shows how many times you bought each title, counting earlier imports and Humble Library purchases together without counting one purchase twice ("at least" when that cannot be told). An expanded title lists each purchase with **Open on Humble** for copies in your Humble Library, opening the item's own page and shown as Purchased. Repeat purchases and uncertain matches stay separate. Titles known only from earlier imports, and gifted, revoked or temporary items, have no link.
- Key reminders no longer use Humble's retired order links. **Open in Humble Library** goes to the purchase that is likely the same order, or to the item itself when exactly one matching key is listed. Repeat purchases, ambiguous orders and orders without a Library match open the Library instead. The order-link setting was removed.

No new permissions, network destinations or extra Humble requests: the sync reads humblebundle.com in the signed-in tab, and the purchase-sync protocol is unchanged. Purchases synced with 1.1.0 should be synced again in full once so their media can be identified.

## 1.0.3 — automatic local sharing

- Automatically pair the sole saved provider account on each side, including populated libraries; retain relationships over sharing OFF/ON. Preserve valid historical Humble key dates and isolate malformed optional observations. Correct sharing checkbox alignment and actionable connection diagnostics.

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
