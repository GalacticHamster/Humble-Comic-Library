# Earlier purchase-page importer

`content.js` ends with the importer for Humble's purchase pages from before the 2026 redesign (about 1,450 lines, from `addRetiredImporterNotice` to the end of the file).

## Reachability

`addPurchaseImporter` mounts the importer only on a Purchases page without the redesign's Next.js markers (`isRedesignedHumble`). On redesigned pages it shows only the retired-importer notice, which points to the Library sync. Bundle pages, catalogue pages, Options and the Library sync call nothing in this block. The one helper they shared, `confirmedNewItemCount`, now sits just above it.

Whether Humble can still serve an earlier-style Purchases page to some accounts has not been confirmed. Until it is, the importer stays as a fallback.

## Why it is kept

- Records it saved are still read: purchase keys and provenance, purchase summaries, key reminders and their scan baseline, and media-classification versions. Backups and restores carry these records; they never re-run the importer's parsers.
- Its extraction rules are covered by the software, entitlement, file-type, media-classification, partial-import, import-upgrade, reconciliation and storage-scale tests. Those tests also document how existing records were classified.
- The Privacy Policy still describes its user-initiated discovery reports, which are available only on an earlier-style Purchases page.

## Removing it

Remove the block only when earlier-style Purchases pages are confirmed gone. Remove the importer UI and parsers together with the tests that exercise them, keep every reader of the records they saved, and update the Privacy Policy and README's "Earlier purchase-page imports" section in the same change.
