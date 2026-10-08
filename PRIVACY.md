# Privacy Policy for Humble Comic Library

Last updated: October 1, 2026

Humble Comic Library is an unofficial browser extension for comparing a person's Humble Bundle purchase library with Humble Bundle book, comic, and game listings. It is not affiliated with or endorsed by Humble Bundle.

## Data the extension handles

When the user chooses to import from Humble, the extension accesses the user's signed-in Humble Purchases page and retrieves the purchase list and required purchase-detail records from Humble. It stores the following data locally in the browser:

- item titles and whether an item is a book, audiobook, game, or software;
- Humble bundle names, purchase dates, and purchase identifiers;
- purchase prices, currency, item counts, and calculated per-item prices when Humble supplies them; and
- title-match provenance used to explain Owned, Partial, and Possible matches; and
- for Humble third-party entitlements that are not yet revealed, the title, source purchase, entitlement type, and Humble-reported expiry status used for local reminders; and
- optional custom issue-to-collection mapping rules that the user imports.

After imports, previously observed Humble item provenance and purchase summaries are retained in a separate local history archive. A fully successful rescan reconciles the current Humble snapshot; historical evidence remains available in backups but is excluded from current matching and reminders. Failed rescans retain previous entries. Manual titles are protected during reconciliation. The archive contains the same types of purchase data listed above, with no redemption-key values or raw API responses, and is included in backup export/restore. Manual title import and **Clear library** clear the archive too.

The extension can also read a JSON file that the user explicitly selects for manual title import or backup restore. **Export backup** creates a JSON download containing the locally stored library items, purchase summaries, provenance, key reminders, import/scan history, and custom collection mappings. **Restore backup** replaces this saved library state; it does not retain unrelated reminders from the previous library. Manual title import replaces the library and clears purchase records, provenance, reminders, scan history, and custom mappings. Backup files include purchase identifiers and should be kept private. Browser preferences and the Galactic Library connection are not included in backups.

When the user selects **Open purchase** from a key reminder with the default setting, the extension temporarily stores the already-local purchase identifier to focus the matching Humble order. It removes that focus request after it succeeds or after 15 minutes. This path does not construct a purchase-identifier URL or handle a redemption-key value, but Humble's own purchase-card flow may require the user to allow Humble popups.

If the user explicitly enables **Open direct Humble order links**, the extension opens Humble's direct individual-order/download page using the already-local purchase identifier as a URL parameter. This avoids the popup requirement but exposes the purchase identifier in the Humble URL and browser history. The extension does not send it to any destination other than Humble and never handles a redemption-key value.

If the user selects **Inspect key reminder data** on the Humble Purchases page, the extension can create a separate, user-initiated discovery download. That report contains aggregate third-party-key field names, value types, and counts only; it contains no redemption-key values, titles, bundle names, purchase identifiers, purchase dates, or other field values. The report is not stored by the extension or sent anywhere.

If the user enables Diagnostics and selects **Inspect purchase navigation** on the Humble Purchases page, the extension can create a separate, user-initiated structural discovery download. That report contains only aggregate tag names, attribute names, link shapes, and counts; it contains no text content, titles, URLs, purchase identifiers, redemption keys, dates, cookies, or raw API responses. The report is not stored by the extension or sent anywhere.

The extension does not read, copy, save, or ask the user to provide a Humble session cookie or a redemption-key value. Redemption-key values returned in Humble purchase responses are redacted before the response is parsed.

## How data is used and shared

This data is used only to provide the extension's library import, matching, provenance, and export features. It remains in browser-local extension storage unless the user explicitly exports it or a compatible locally installed Galactic Library companion supplies the comparison features described below. Reminder publication remains explicit.

The extension has no developer-operated server, analytics, advertising, affiliate links, or remote third-party data recipient. It makes requests only to Humble Bundle, using the user's existing signed-in browser session, to provide the import and current-listing comparison features.

When a compatible official Galactic Library extension is also installed, or the user configures an Advanced companion override, Humble Comic Library sends current bundle titles/media types and available bibliographic identifiers, authors, edition/run/language and requested contents evidence to that other locally installed extension. Ebooks and audiobooks are checked separately; Software lookup is sent only when GL advertises support. Galactic Library returns matching records from its non-Humble providers: only exact confirmed ownership is labelled owned elsewhere, while uncertain or temporary access and related titles require review. Neither extension transfers a full library, session credential, redemption key, or data to a remote server. Removing a custom override restores official automatic pairing; disable or uninstall Galactic Library or HB to stop this exchange. Built-in IDs are separate from stored overrides.

When the user explicitly selects **Send reminders to Galactic Library** and confirms the same account, HB also sends entitlement titles/media types, observed key status, reported expiry and check dates, confirmed purchase/unknown activation status and opaque references. It sends the user-entered GL Humble profile label separately to scope the feed. Raw keys, purchase/entitlement identifiers, bundle names, purchase URLs, prices and the private reference salt are excluded. GL saves this feed locally and includes it in its backups; it does not change native ownership. Uploads are staged and published atomically. Sharing is manual and does not run in the background. The per-profile reference salt is stored privately in HB, excluded from backups and reset on clear, restore and account switch.

An already saved GL feed remains after unlinking, clearing or uninstalling HB. Remove it with **Remove shared reminders** in HB while still paired, or **Remove Humble companion feed** in GL.

## Retention and deletion

Data remains in the browser until the user replaces it, selects **Clear library** in the extension options, or uninstalls the extension. **Clear library** removes locally stored titles, purchase summaries, provenance, key reminders, import/scan history, custom collection mappings, and pending purchase-navigation requests. Uninstalling the extension removes its browser-local extension storage according to the browser's normal uninstall behavior.

## Changes to this policy

If the extension's data practices change, this policy and the applicable store privacy disclosures will be updated before that version is released.
