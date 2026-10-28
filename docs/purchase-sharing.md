# Automatic saved-purchase sync

Connect GL with HB or FAN to keep a selected store account's saved purchases synchronized in both directions. Existing libraries can be used immediately; installing the other extension later does not require another store scan.

Open **Purchase sync** and choose **Connect and sync**. One confirmation authorizes both verified extensions to keep the selected store account synchronized until you disconnect. You do not need to visit the other extension. If both libraries have purchases, confirm that they belong to the same store account. Nicknames alone are not identity evidence.

A single account is used automatically; an unnamed default is created when needed. Account naming is optional. Multiple saved accounts require an explicit choice under Advanced, which also contains account creation and naming tools. This initial version supports one automatic relationship per store in each extension; other accounts remain available through manual sharing. Account UUIDs survive scans, switching and renaming. Restore/clear or a missing mapped account requires a new relationship; nicknames are never used to guess a replacement.

Completed imports and meaningful purchase updates synchronize automatically. Progress, settings, identical values and timestamp-only notifications do not start a transfer. GL coordinates an additive round trip through the existing validated chunked importer. Purchases missing on one side are not deleted elsewhere; an item removed locally may return from the connected account. Existing identity, ownership and conservative merge rules remain unchanged. Unsupported or uncertain items stay at their source; skipped items are reported under Advanced.

**Sync now** checks saved state without scanning a website. **Change account mapping** under Advanced stops the old relationship before setup. **Disconnect** disables automatic sync on both sides without deleting purchases or disabling ordinary bundle matching. Opening Options only loads status/account choices; it does not enable sharing. Already-open bundle pages use their existing library-change refresh behavior.

Pending intent survives worker/browser restarts. One-shot alarms retry after roughly 1, 5, 15 and 60 minutes, with at most five scheduled retries before attention is required. Startup, reconnect and Sync now can try again. The required alarms permission supports this recovery; there is no continuous polling, cloud service or keepalive. An interrupted commit is checked against actual saved destination data before replay. Confirmed successful unchanged checks do not rewrite library/history or append duplicate evidence. Fingerprints and small device-local consent/retry metadata are excluded from library backups.

Existing extension authorization and old manual offers do not enable automatic sync. Pending offers retain their manual approval requirement. Official extension IDs and authorized development overrides use the same transport security. Tokens, authentication data, redemption values and signed download URLs remain excluded.

## Advanced manual sharing and recovery

The earlier guided transfer controls remain under **Advanced: manual purchase sharing and recovery**. They still require their own account confirmation and final import approval. Read-only comparison, previews, technical details and exports remain available there. Disconnect automatic sync before using manual recovery to maintain an intentionally different local account.

Open **Options -> Galactic Library connection -> Purchase sync -> Advanced: manual purchase sharing and recovery**. Choose a direction and accounts. Account choices load automatically; one eligible source and one receiving account are suggested, while multiple choices require selection. Names do not establish identity. Confirm that both represent the same store account. Choose **Create a separate saved account** to enter a nickname for a new destination.

Choose **Continue** to run the read-only preview. No purchases have been imported yet. Review new saved names, additional purchases, possible updates and skips. Updates may include bookkeeping; this preview does not promise improved information. **Back** changes your choices, and unchanged Back/Continue reuses the review. New names are compared with saved titles, not editions or ownership.

**Send purchases** creates an offer and opens Galactic Library. Its receiver must confirm accounts, Continue to its own review, check the final approval box and choose **Import purchases**. For importing here, that same final approval is required. Completion uses committed results, and **Share more purchases** returns to account selection. An offer never means the receiving library changed.

**Advanced / Diagnostics** starts collapsed and retains Refresh account choices, optional Preview transfer and Export comparison report. Humble also has Compare saved purchases. Exact diagnostic data remains in Technical details and exported private reports. Ordinary sharing needs no diagnostic buttons. Retry is available for loading or preview failures; selections are kept. Reload choices and review again if source/destination saved data changed. If an approved import has an uncertain outcome, check the receiving account before retrying.

Check connection verifies communication only. Bundle matching uses GL's additional ownership evidence; refresh an already-open bundle page after connecting. These actions do not enable automatic synchronization; an already enabled relationship operates independently.

Local, empty, archived and older accounts remain visible even if GL is unavailable. Eligibility limitations are separate from account discovery. Older Humble purchases without native product IDs can only enrich an unambiguous existing GL purchase/title. Unmatched rows are skipped. Missing Fanatical product identity is excluded and reported; primary bundle data is retained when historical order references are unavailable. No identity is guessed.

Official builds connect by published ID. For unpacked builds, allow this extension's ID in GL Advanced pairing and enter GL's ID here. Update both extensions for the purchase-sharing protocol. GL verifies responding authorized IDs; it does not trust an ID claimed in a message. Missing, disabled and incorrectly addressed extensions can produce the same browser error.

Transfers preserve richer data, merge supported purchases without deletion and are idempotent. They do not establish a complete scan/reminder baseline. Retry after refreshing choices if staging expires or a source worker restarts. Validation failures do not apply a partial import. If completion is uncertain, check the receiving account before retrying. Normal standalone imports still work without GL.

Developer UI policy: prefer ASCII control, navigation, status and button text; write UTF-8. Do not substitute question marks for decorative separators or use unverified symbols. Unicode titles, authors and user metadata remain supported. Shared control-text integrity checks and native package checks guard known corruption.

## Saved account identity

Saved Humble and Fanatical accounts carry a stable local account ID with their purchase data. Existing valid IDs migrate automatically without changing purchases or a working purchase-sync relationship. Names and purchase updates do not change this ID. Older accounts without recoverable identity receive a new ID and may need connection repair; names and common purchases never establish identity.

Backups may retain account lineage, but restoring them resets automatic purchase-sync permission. Restored IDs do not grant permission to resume sharing. Private incremental scan authority remains separate. Conflicting or duplicate account identities are rejected rather than merging accounts.

Temporary connection failures retry within bounded limits. New committed purchases can restart a transport-exhausted check. Missing accounts, revoked purchase-sync permission and conflicting relationships stop automatic retries until repaired; restarting the extension does not repeatedly propose an obsolete account. Saved setup history is distinct from currently verified peer permission.

If a saved account or permission was replaced, choose **Repair connection** in Purchase sync. Review the current saved accounts and confirm once; there is no need to disconnect first or repeat the store scan. A single available account is preselected as a convenience, not treated as proof of identity. Multiple accounts require an explicit choice. Repair preserves purchases and replaces the obsolete synchronization relationship.

## Routine imports

Account naming is optional. A first import uses a default saved account, and routine updates reuse the selected account without repeatedly asking for a nickname or checkbox confirmation. HB and FAN do not verify which website user is signed in: if you change website accounts, use Saved accounts or Advanced accounts first. Add another account explicitly with a full scan; rename an existing account through its Rename action. These actions preserve separate account identities and import histories. GL keeps verified console-account checks in place.
