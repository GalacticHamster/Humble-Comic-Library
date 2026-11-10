# Privacy Policy for Humble Library

Last updated: November 7, 2026

Humble Library is an unofficial browser extension for comparing a person's Humble Bundle purchase library with Humble Bundle book, comic, and game listings. It is not affiliated with or endorsed by Humble Bundle.

## Data the extension handles

When the user chooses to import from Humble, the extension accesses the user's signed-in Humble Purchases page and retrieves the purchase list and required purchase-detail records from Humble. It stores the following data locally in the browser:

- item titles and whether an item is a book, audiobook, game, or software;
- Humble bundle names, purchase dates, and purchase identifiers;
- purchase prices, currency, item counts, and calculated per-item prices when Humble supplies them; and
- title-match provenance used to explain Owned, Partial, and Possible matches; and
- for Humble third-party entitlements that are not yet revealed, the title, source purchase, entitlement type, and Humble-reported expiry status used for local reminders; and
- optional custom issue-to-collection mapping rules that the user imports; and
- profile labels/archives, media-type corrections, wishlist/planning information, preferences, and companion connection state.

After imports, previously observed Humble item provenance and purchase summaries are retained in a separate local history archive. A fully successful rescan reconciles the current Humble snapshot; historical evidence remains available for history-only match warnings and backups, but does not establish current ownership or active reminders. Failed rescans retain previous entries. Manual titles are protected during reconciliation. The archive contains the same types of purchase data listed above, with no redemption-key values or raw API responses, and is included in backup export/restore. Manual title import and **Clear library** clear the archive too.

The extension can also read a JSON file that the user explicitly selects for manual title import or backup restore. **Export backup** creates a JSON download containing the locally stored library items, purchase summaries, provenance, key reminders, saved import and reminder-scan summaries, profile labels and archived profiles, media-type corrections, excluded import records, and custom collection mappings. **Restore backup** replaces this saved library state; it does not retain unrelated reminders from the previous library. Manual title import replaces the library and clears purchase records, provenance, reminders, scan history, and custom mappings. Backup files include purchase identifiers and should be kept private. The wishlist has a separate export. General browser preferences, companion pairing, automatic-sharing preferences, account relationships, and private reminder-reference salts are not included in library backups. Restore resets live purchase-sync relationships and pending scan/navigation controls. A previously verified relationship can be rechecked as described below; a backup alone does not authorize a new account relationship.

When the user selects **Open purchase** from a key reminder with the default setting, the extension temporarily stores the already-local purchase identifier to focus the matching Humble order. It removes that focus request after it succeeds or after 15 minutes. This path does not construct a purchase-identifier URL or handle a redemption-key value, but Humble's own purchase-card flow may require the user to allow Humble popups.

If the user explicitly enables **Open direct Humble order links**, the extension opens Humble's direct individual-order/download page using the already-local purchase identifier as a URL parameter. This avoids the popup requirement but exposes the purchase identifier in the Humble URL and browser history. The extension does not send it to any destination other than Humble and never handles a redemption-key value.

If the user selects **Inspect key reminder data** on the Humble Purchases page, the extension can create a separate, user-initiated discovery download. That report contains aggregate third-party-key field names, value types, and counts only; it contains no redemption-key values, titles, bundle names, purchase identifiers, purchase dates, or other field values. The report is not stored by the extension or sent anywhere.

If the user enables Diagnostics and selects **Inspect purchase navigation** on the Humble Purchases page, the extension can create a separate, user-initiated structural discovery download. That report contains only aggregate tag names, attribute names, link shapes, and counts; it contains no text content, titles, URLs, purchase identifiers, redemption keys, dates, cookies, or raw API responses. The report is not stored by the extension or sent anywhere.

If the user enables Diagnostics and selects **Inspect Software product data**, the extension asks for confirmation before inspecting non-book product classification information and downloading a local report. This optional report includes product titles and bundle names, classification and declared product-type values, platform values, file extensions, and field names; it is not aggregate-only or anonymous. It excludes redemption-key values, purchase identifiers and dates, URLs, cookies, and raw purchase responses. The extension does not store the report or automatically upload it to the developer or another service. Review the downloaded file before sharing it.

The extension does not read, copy, save, or ask the user to provide a Humble session cookie or a redemption-key value. Redemption-key values returned in Humble purchase responses are redacted before the response is parsed.

## How data is used and shared

This data supports library import, matching, purchase history, reminders, planning, and export. Saved data is held in this browser profile. Provider requests, local companion exchanges, and user-created downloads are described below; this is not a promise that no data leaves the browser.

The extension does not send library data to a Galactic Hamster-operated server and has no analytics or advertising service. Imports request data from Humble Bundle using the signed-in browser session. Opening a provider, help, or optional support link visits that destination under its own privacy policy; this is separate from sending a library backup.

When a compatible official Galactic Library extension is also installed, or the user configures an Advanced companion override, Humble Library sends current bundle titles/media types and available bibliographic identifiers, authors, edition/run/language and requested contents evidence to that other locally installed extension. Ebooks and audiobooks are checked separately; Software lookup is sent only when GL advertises support. Galactic Library returns matching records from its non-Humble providers: only exact confirmed ownership is labelled owned elsewhere, while uncertain or temporary access and related titles require review. These matching queries use a bounded comparison response, not a library backup. They exclude session credentials and redemption keys. Purchase synchronization is a separate data flow described below. Removing a custom override restores official automatic pairing; disable or uninstall Galactic Library or HB to stop this exchange. Built-in IDs are separate from stored overrides.

**Automatic local sharing is on by default**, including after an upgrade from legacy unconfigured, disabled or disconnected settings. When compatible official Galactic Library and companion extensions are installed in the same browser profile, they discover each other and exchange supported saved purchases in both directions without a new provider scan. A versioned sharing preference records an explicit opt-out made under this model. Turn sharing off in the connection section to stop subsequent purchase transfers; startup, reconnect and library restore do not turn it back on. Previously saved copies are kept. Re-enabling sharing reconciles additively.

Transfers can include saved account references and labels, item/bundle identifiers, titles, available dates, formats, supported ownership evidence and purchase provenance. Compatible transfers also include supported dated non-secret Humble/Fanatical key observations and purchase-specific reminder dismissal, snooze and restoration decisions. Secret key values, provider credentials and session tokens are not shared. Exact sender, provider, stable account relationship and save-time permission checks remain required. Exactly one provider account in each extension is paired automatically, including populated accounts, and purchases reconcile additively. Multiple accounts use an established mapping or need a one-time choice in Advanced; conflicting relationships are not silently replaced. This single-account policy is not independent verification of a provider login, and display names are not identity evidence. Unavailable or older peers may delay synchronization. These are local browser-extension messages, not uploads to a Galactic Hamster-operated server.

Under the same default-on sharing setting, HB also sends an additional reminder feed after its verified saved account synchronizes with GL. It includes entitlement titles/media types, observed key status, reported expiry/check dates, confirmed purchase/unknown activation status and opaque references. Reminders already represented by native purchase records are excluded from this automatic feed to avoid duplicates. The feed excludes raw keys, raw purchase/entitlement identifiers, bundle names, purchase URLs, prices and the private reference salt. GL saves it locally and includes it in its backups; the feed does not change native ownership. Uploads are staged, bound to the saved account relationship and published atomically. Advanced controls remain for manual feed recovery and removal. Private reference salts stay in HB outside library backups; account-specific salts can survive account switching and library restore in the same installation.

An already saved GL feed remains after unlinking, clearing or uninstalling HB. Remove it with **Remove shared reminders** in HB while still paired, or **Remove Humble companion feed** in GL.

## Browser permissions used

- **storage** saves library data, preferences, account relationships, and local working state.
- **unlimitedStorage** allows large browser-local libraries and purchase histories to exceed the normal extension-storage quota. It adds no website access or remote storage. Available disk space and browser-wide storage limits can still cause saves to fail; the existing saved library is retained when a save fails.
- **alarms** schedules background purchase-synchronization work and retries.
- Content-script access to Humble pages reads listings and runs the user-initiated purchase importer and overlays.

## Retention and deletion

Data remains in the browser until the user replaces it, selects **Clear library** in the extension options, or uninstalls the extension. **Clear library** removes locally stored titles, purchase summaries, provenance, key reminders, import/scan history, custom collection mappings, and pending purchase-navigation requests. Clear library also resets purchase-sync relationships, but does not clear the wishlist, general preferences, or saved companion override. Uninstalling removes extension storage according to the browser's normal behavior. Neither action deletes downloaded backups, browser history, provider records, or data already saved by a companion. These controls are not a secure-erasure guarantee.

The automatic-sharing preference stays unchanged by library restore or clear. Restoring a previously mapped dataset revokes old in-flight transfer tickets. A retained relationship can be revalidated automatically only when the same saved dataset IDs still exist and no live account relationship conflicts; multiple ambiguous or conflicting restored relationships need a new account decision. This does not use account nicknames as identity evidence.

Private reminder-reference salts can remain in extension settings after clearing a library, so restoring the same account can retain its reminder references. They are not redemption keys and are not sent to GL.

## Changes to this policy

If the extension's data practices change, this policy and the applicable store privacy disclosures will be updated before that version is released.
