# Automatic saved-purchase sharing

With compatible official extensions installed in the same browser profile, GL and Humble Library or Fanatical Library discover each other and share supported saved purchases automatically. Installing a companion later does not require a new store scan. All three also work independently.

**Automatically share purchases with Galactic Library** is on by default in HB and FAN. GL has a separate sharing setting for each companion in Providers. Turning either side off stops subsequent purchase transfers without deleting saved copies. Turning it back on reconciles the saved accounts additively. Bundle matching remains a separate comparison feature.

Upgrades enable this model for legacy enabled, disabled, disconnected and unconfigured states: those old states did not reliably record an explicit opt-out. The new versioned preference remembers an explicit off choice across restarts, updates and library restore while browser settings survive. Library backups do not export that device-local preference.

When each extension has exactly one account for the store, those accounts connect automatically even if both contain current or historical purchases. If GL has no account yet, it creates the receiver. Purchases reconcile additively; absence never deletes the other dataset. Verified saved mappings are reused by their stable dataset IDs, never by display name. With multiple accounts, an unambiguous verified mapping is reused; genuine ambiguity or conflicting relationships need a decision under **Advanced: accounts and diagnostics**. Only one automatic relationship per store is supported; other accounts remain available through advanced manual sharing.

Completed imports and relevant committed purchase changes synchronize automatically, including partial imports that safely saved independently verified purchases. Missing purchases never authorize deletion at the other extension. User corrections, purchase history, ownership distinctions and provenance retain their existing merge rules. Unsupported records stay at their source and appear in Advanced diagnostics.

Unavailable peers retain pending work. Bounded one-shot alarms retry transport failures; peer startup and later installation can also wake discovery. There is no continuous polling, remote service or store rescan. Account conflicts require a decision rather than repeated automatic attempts. An interrupted transfer is checked against committed destination data before replay.

Advanced **Sync now** retries saved data without a website scan. **Change account mapping** reviews the account relationship; it is not the persistent opt-out. Use the sharing checkbox to stop transfers. Manual pending offers keep their separate approval requirement. Provider credentials, redemption values and signed download links are never shared.

## Advanced manual sharing and recovery

The earlier guided transfer controls remain under **Advanced: manual purchase sharing and recovery**. They still require their own account confirmation and final import approval. Read-only comparison, previews, technical details and exports remain available there. For intentionally separate accounts, use Advanced to select a separate receiving account. Turn automatic sharing off when no further transfers are wanted.

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

Backups may retain account lineage. Restoring resets the live relationship but preserves the local sharing preference. An existing reverse-verified mapping can reconnect only if its exact saved dataset IDs still exist; a UUID alone does not establish provider-account equivalence. Private incremental scan authority remains separate. Conflicting or duplicate account identities are rejected rather than merging accounts.

Temporary connection failures retry within bounded limits. New committed purchases can restart a transport-exhausted check. Missing accounts, revoked purchase-sync permission and conflicting relationships stop automatic retries until repaired; restarting the extension does not repeatedly propose an obsolete account. Saved setup history is distinct from currently verified peer permission.

If a saved account or permission was replaced, choose **Repair connection** in Purchase sync. Review the current saved accounts and confirm once; there is no need to disconnect first or repeat the store scan. A single available account is preselected as a convenience, not treated as proof of identity. Multiple accounts require an explicit choice. Repair preserves purchases and replaces the obsolete synchronization relationship.

## Routine imports

Account naming is optional. A first import uses a default saved account, and routine updates reuse the selected account without repeatedly asking for a nickname or checkbox confirmation. HB and FAN do not verify which website user is signed in: if you change website accounts, use Saved accounts or Advanced accounts first. Add another account explicitly with a full scan; rename an existing account through its Rename action. These actions preserve separate account identities and import histories. GL keeps verified console-account checks in place.

## Lifecycle and connection reports

Restoring or clearing a library retires live transfer permissions before another transfer can save. The separate automatic-sharing preference stays unchanged. A restore can reconnect previously verified accounts only after rechecking their exact saved identities. A clear leaves an unused receiving account that companions may refill while sharing is on; turn sharing off first if that is unwanted. Removing a mapped GL account retires that connection along with its records; other accounts and integrations stay separate. The other extension is notified when reachable, but a failed notification does not undo a completed local operation. Reset import history only resets the scan baseline; it is not clearing purchases or granting sync permission.

In Purchase sync, open **Advanced: accounts and diagnostics**, choose **Check sync connection**, then **Export connection report**. This read-only check reports pairing, purchase permission, mapped-account availability, verified peer confirmation, last success, pending work, failure category and the next recovery action. The export omits raw account IDs, purchase lists and website credentials. It describes the connection when checked, not a guarantee about later changes. If the connection changes, check it again before exporting a current report.

Older unnamed HB/FAN libraries appear as **Default account** in Saved accounts. You can give that account a nickname using Rename account without importing again. Naming preserves its purchases, account identity and sharing permission. When repairing a connection with multiple accounts, review the account choices under Advanced and confirm Connect and sync; changes made elsewhere may require opening Repair connection again.
