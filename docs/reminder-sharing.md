# Private entitlement reminders (HB-13)

Sharing is manual and stays between locally installed extensions. In HB Extension options:

1. Configure the Galactic Library link and allow HB's extension ID in GL.
2. Import the Humble account into both extensions using their account-confirmation controls. Labels may differ; check that they represent the same signed-in account.
3. Under **Share entitlement reminders**, inspect the displayed HB profile and enter GL's current Humble profile label.
4. Confirm the same-account checkbox, then choose **Send reminders to Galactic Library**.

Run **Rescan every purchase** first to establish or refresh a complete reminder baseline. Partial baselines are clearly identified. Only dated observed entitlement evidence is shared. Sharing does not sync the library, mark a game owned, or establish destination-platform activation.

GL's **Entitlement reminders** dashboard shows HB as the source, the check date and baseline coverage, separately from native GL records. Review opens HB's options through Chrome's trusted extensions route. Dismiss/snooze/restore affects only reminders. Either HB's **Remove shared reminders** or GL's **Remove Humble companion feed** removes that source feed without deleting native purchases.

Each entry contains only title, media type (or unknown), key status, reported expiry, check date, confirmed source-purchase status, unknown activation status and an opaque reference. Raw redemption keys, purchase/entitlement identifiers, bundle names, purchase URLs, prices and account details are excluded. The destination GL profile label is sent separately to scope the upload; it is not included in entries or public reminder responses. References are derived with a private per-profile random salt; the salt is excluded from backups and resets on restore, clear and account switch.

Uploads use sequential batches of up to 200 entries, with a 100,000-entry bound. GL stages them for up to ten minutes and publishes only a complete, valid upload. A failed batch, stale source revision, profile change, revoked GL permission or incompatible capability leaves the previously published feed intact. If an acknowledgement is lost after GL publishes the feed, check GL before retrying; a missing response does not prove the previous feed remains. Repeat sharing to refresh the feed; no background auto-sharing occurs. Refreshes retain reminder references while the local identity/salt is unchanged. A new dated observation can reactivate a previously dismissed reminder.

Clearing HB, unlinking or uninstalling does not retract an already saved GL feed. Remove it first from HB, or use the removal control in GL afterward. GL backups include saved feeds and local dismissal/snooze reviews; private in-progress uploads are excluded. Feed reminders are hidden when their GL Humble profile is not current.

The complete installed HB-to-GL exchange is verified in Chrome. HB's Firefox runtime is tested independently; GL currently ships a Chrome package, so cross-extension sharing in Firefox is not claimed.
