# Library sync and title exports

Sync full Library reads the pages Humble currently makes accessible. Finishing
that traversal is not proof that Humble exposes every historical purchase. Check
recent purchases revisits only recent pages; it does not repeat older pages.
Scan details retains page totals, saved observations, unresolved items and actual
coverage issues. A count that does not reconcile with Humble's row total is a
coverage discrepancy, not proof that a particular purchase is missing.

The completion result is shown for the current page session. Reopening Library,
reloading or returning through browser Back/Forward restores the idle actions.
Paused, interrupted and failed operations retain their recovery controls. This
changes presentation only: observations, timestamps, checkpoints, diagnostics,
accounts, corrections and history remain stored. Scan details keeps the last
operation available after returning to idle.

Options offers **Export title catalog (JSON)** and **Export title catalog (CSV)**.
Both use the Titles browser's deduplication and classification, including
native-only purchases. The existing JSON format is unchanged. CSV columns are
Title, Media type, Purchase status, Purchase date, Purchase count, Source and
Bundle / purchase name, one row per Titles row:

- **Purchase status** is `Purchased` for a title with a recorded Humble purchase
  (an imported order or a Humble Library purchase) and `Not recorded as a
  purchase` for a manually added title. Gifted, revoked and temporary-access
  items are not Titles rows. Whether a key was redeemed on its store cannot be
  told from Humble records, so the CSV has no activation column.
- **Purchase date** lists each known purchase date (YYYY-MM-DD, the browser's
  time zone, as Options shows dates), earliest first, separated by `; `; empty
  when no date is known. Dates are never inferred.
- **Purchase count** is the Titles count (`titlePurchaseCount`): imported orders
  and Humble Library purchases, one purchase each, a combined order counted once;
  copies on other stores found through Galactic Library never count. When some
  imported orders and Library purchases might be the same purchases, it reads
  `at least N`.
- **Source** is `Imported purchase`, `Humble Library`, `Imported purchase and
  Humble Library` or `Added manually`.
- **Bundle / purchase name** lists the purchases, earliest first.

Neither format is a backup; use Export backup for restoration. CSV uses quoted
UTF-8 with a BOM and CRLF rows for spreadsheets; cells beginning with
formula-control characters are prefixed with an apostrophe.

Order History shows only a link to Library. Account selection and validation
remain available where imports and saved-account management need them.
