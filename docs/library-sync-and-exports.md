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
Title, Media type, Purchase status, First purchased, Last purchased, Purchase
count, Purchase count confidence, Source, Bundle / purchase name and Purchase
dates, one row per Titles row:

- **Purchase status** is `Purchased` for a title with a recorded Humble purchase
  (an imported order or a Humble Library purchase) and `Not recorded as a
  purchase` for a manually added title. Gifted, revoked and temporary-access
  items are not Titles rows. Whether a key was redeemed on its store cannot be
  told from Humble records, so the CSV has no activation column.
- **First purchased** and **Last purchased** hold one date each (YYYY-MM-DD,
  the browser's time zone, as Options shows dates): the earliest and latest known
  purchase dates, equal for a single purchase, empty when no date is known. Dates
  are never inferred.
- **Purchase count** is a number, the Titles count (`titlePurchaseCount`):
  imported orders and Humble Library purchases, one purchase each, a combined
  order counted once; copies on other stores found through Galactic Library never
  count. It is 0 for a manually added title.
- **Purchase count confidence** is `Exact` when the recorded purchases settle the
  count, or `At least` when some imported orders and Library purchases might be
  the same purchases, so the count is the smallest possible total. It is empty
  for a manually added title.
- **Source** is `Imported purchase`, `Humble Library`, `Imported purchase and
  Humble Library` or `Added manually`.
- **Bundle / purchase name** and **Purchase dates** list each purchase in the
  same order, earliest first, separated by `; `. A purchase without a known date
  is listed last, with `unknown` as its date. Two purchases on the same day are
  listed twice.

Humble lists a DRM-free item titled "No Content", with nothing to download, in
some purchases (one in each of 47 purchases in one real library, and as two
imported records from the original importer). It is a placeholder, not a
product: Titles, the date-coverage line and both catalog exports leave out a
Library entitlement or imported title with exactly that title, delivered as a
direct download and with no download formats or platforms
(`HumbleLibraryBrowser.contentPlaceholder`). Its purchase, the purchase's other
titles and the saved records are unchanged and remain in Bundles & Orders. A key
or a download with files titled "No Content" is listed normally. Other items
Humble lists without downloads (such as redemption messages) are not filtered.

Neither format is a backup; use Export backup for restoration. CSV uses quoted
UTF-8 with a BOM and CRLF rows for spreadsheets; cells beginning with
formula-control characters are prefixed with an apostrophe.

Order History shows only a link to Library. Account selection and validation
remain available where imports and saved-account management need them.
