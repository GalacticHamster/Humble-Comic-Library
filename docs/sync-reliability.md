# Account profiles and serialized library changes

The purchase importer requires a local profile label and confirmation that it matches the signed-in Humble account. Labels are user declarations; the extension cannot detect a website account change if the same label is reused. No cookies, redemption keys or authentication tokens are retained.

A first profile assignment requires a complete rescan. Changing an established label requires **Rescan every purchase** and the explicit switch checkbox. Until every purchase succeeds, the existing active library remains intact. A successful switch retains manual titles and archives the previous profile's complete library state. Archived profiles are excluded from matching; export a version-9 backup to retain them. Restore accepts earlier backup versions and clears account information absent from those backups.

The background worker serializes short mutations. A persisted, tab-bound token identifies each network scan, so worker restarts do not lose its identity. A newer scan, restore, manual title replacement, or clear prevents an older scan from committing. Scanning runs outside the mutation queue. Settings changed during a scan remain current. Wishlist additions, removals, and priorities merge against current state within the writer.

The former standalone reminder refresh now uses the same purchase scan and commit path. Existing profiles still retain previous evidence when a partial scan fails; assigning or switching profiles requires a fully successful scan. Reload the extension and existing Humble tabs after upgrading.

The background writer validates every scan record before publishing. Incomplete same-profile full scans may append successful purchases/history when failed purchase IDs are retained for retry, but cannot drop active provenance, purchase summaries or historical evidence. A malformed later record rejects the entire write. Unrelated settings/mappings are neither rewritten nor revalidated by a scan.
