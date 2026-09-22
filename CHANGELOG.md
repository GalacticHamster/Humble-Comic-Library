# Changelog

## Unreleased

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
