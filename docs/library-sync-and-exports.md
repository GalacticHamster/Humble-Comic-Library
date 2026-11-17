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
native-only purchases. The existing JSON format is unchanged. CSV adds local
purchase/ownership status, evidence source, available bundle names and original
purchase dates when recorded. It distinguishes verified native purchases,
historical purchase records and manual/local titles. Neither format is a backup;
use Export backup for restoration. No purchase date or destination activation is
inferred. CSV uses quoted UTF-8 with a BOM and CRLF rows for spreadsheets; cells
beginning with formula-control characters are prefixed with an apostrophe.

Order History shows only a link to Library. Account selection and validation
remain available where imports and saved-account management need them.
