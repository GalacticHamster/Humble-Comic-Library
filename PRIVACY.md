# Privacy Policy for Humble Comic Library

Last updated: September 4, 2026

Humble Comic Library is an unofficial browser extension for comparing a person's Humble Bundle purchase library with Humble Bundle book, comic, and game listings. It is not affiliated with or endorsed by Humble Bundle.

## Data the extension handles

When the user chooses to import from Humble, the extension accesses the user's signed-in Humble Purchases page and retrieves the purchase list and required purchase-detail records from Humble. It stores the following data locally in the browser:

- item titles and whether an item is a book or game;
- Humble bundle names, purchase dates, and purchase identifiers;
- purchase prices, currency, item counts, and calculated per-item prices when Humble supplies them; and
- title-match provenance used to explain Owned, Partial, and Possible matches.

The extension can also read a JSON file that the user explicitly selects for manual import. When the user selects Export, it creates a JSON download containing the locally stored library and purchase summaries.

The extension does not read, copy, save, or ask the user to provide a Humble session cookie or a redemption-key value. Redemption-key values returned in Humble purchase responses are redacted before the response is parsed.

## How data is used and shared

This data is used only to provide the extension's library import, matching, provenance, and export features. It remains in Chrome's local extension storage unless the user explicitly exports it.

The extension has no developer-operated server, analytics, advertising, affiliate links, or third-party data recipient. It makes requests only to Humble Bundle, using the user's existing signed-in browser session, to provide the import and current-listing comparison features.

## Retention and deletion

Data remains in the browser until the user selects **Clear library** in the extension options or uninstalls the extension. **Clear library** removes locally stored titles, purchase summaries, and import history. Uninstalling the extension removes its Chrome extension storage according to Chrome's normal uninstall behavior.

## Changes to this policy

If the extension's data practices change, this policy and the Chrome Web Store privacy disclosures will be updated before that version is released.
