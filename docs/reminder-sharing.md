# Private entitlement reminders (HB-13)

Sharing is local and on by default when compatible HB and GL are installed. Import normally in HB: after the saved accounts synchronize, dated key evidence already represented by supported native purchase records is available in GL. Additional reminder-only evidence uses the narrow feed described below. No GL installation or connection is required for HB's local reminder list.

Use **Automatically share purchases with Galactic Library** to stop future purchase and automatic reminder transfers. Re-enable it to reconcile. Accounts that cannot be safely mapped need one decision under Advanced. Advanced manual feed controls remain for repair and removal; they are not the normal setup flow.

Run **Rescan every purchase** first to establish or refresh a complete reminder baseline. Partial baselines are clearly identified. Only dated observed entitlement evidence is shared. Sharing does not sync the library, mark a game owned, or establish destination-platform activation.

GL's **Entitlement reminders** dashboard shows HB as the source, the check date and baseline coverage, separately from native GL records. Review opens HB's options through Chrome's trusted extensions route. Dismiss/snooze/restore affects only reminders. Either HB's **Remove shared reminders** or GL's **Remove Humble companion feed** removes that source feed without deleting native purchases.

Each entry contains only title, media type (or unknown), key status, reported expiry, check date, confirmed source-purchase status, unknown activation status and an opaque reference. Raw redemption keys, purchase/entitlement identifiers, bundle names, purchase URLs, prices and account details are excluded. The destination GL profile label is sent separately to scope the upload; it is not included in entries or public reminder responses. References are derived with a private per-profile random salt; the salts are excluded from library backups and kept separately by stable saved account ID, so normal account switching does not change references. A new installation or unrelated account receives a different salt.

Uploads use sequential batches of up to 200 entries, with a 100,000-entry bound. GL stages them for up to ten minutes and publishes only a complete, valid upload. A failed batch, stale source revision, profile change, revoked GL permission or incompatible capability leaves the previously published feed intact. If an acknowledgement is lost after GL publishes the feed, check GL before retrying; a missing response does not prove the previous feed remains. Committed changes and completed synchronization refresh the automatic feed. Refreshes retain reminder references while the local identity/salt is unchanged. A new dated observation can reactivate a previously dismissed reminder.

Clearing HB, unlinking or uninstalling does not retract an already saved GL feed. Remove it first from HB, or use the removal control in GL afterward. GL backups include saved feeds and local dismissal/snooze reviews; private in-progress uploads are excluded. Feed reminders are hidden when their GL Humble profile is not current.

Installed Chrome and Firefox builds use the same scoped feed contract. A new HB with an older GL may need that GL updated before additional feeds can target an unnamed account; native purchase evidence remains independently transferable.
