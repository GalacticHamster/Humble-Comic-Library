# Share saved purchases without another scan

After a normal Humble or Fanatical scan, open **Providers -> Purchase sharing** in GL, or **Galactic Library connection -> Purchase sharing** in HB/FAN. Compatible versions of both extensions must be installed and connected.

1. Choose **Refresh account choices**. This reads saved libraries; it does not visit the store or start a scan.
2. Select the source account in the linked extension and the destination saved account here. You can instead create a separate saved account by entering a new nickname.
3. Confirm these are the same store account. Identical nicknames do not verify identity.
4. Choose **Import saved purchases**. Progress shows preparation, transfer counts, validation and import. **Import committed** reports received, added, updated, unchanged and skipped counts.

To initiate from the source, select **This extension's saved account** and choose **Send saved purchases**. The receiving Options page opens with an offer. Refresh its choices, choose the destination and confirm there. "Offered" means nothing has been imported yet.

Transfers merge compatible supported purchases. They preserve existing richer information and do not delete purchases absent from the snapshot. Repeating a transfer does not duplicate purchases. Transferring to an inactive saved account does not switch the active account; select that account separately to use its local overlays. Refresh account choices before another import if either saved account changed.

Saved data is labelled historical/partial, not a new complete website scan. Older HB direct-download purchases may lack native product IDs: GL can merge them with an unambiguous existing purchase, but skips unmatched products. A separate fresh HB scan can retain those IDs. GL lacks Humble prices and unsupported Fanatical media; older FAN origins may lack order references. The result shows limitations. Existing destination metadata is retained; this action never fabricates missing order/product identities or complete key-reminder coverage.

Staging expires after ten minutes and is lost if the source worker/browser restarts. If a transfer fails, refresh choices and retry. Your saved library is kept. Closing Options does not cancel an already confirmed background import; if it committed before interruption, retrying remains safe. Neither extension depends on its companion for normal standalone imports.

Sharing is manual. Opening a page does not trigger a bulk transfer, and there is no polling or cloud service. It excludes authentication/session/redemption values and signed download links. GL transfers provider purchase records, not its entire canonical catalog, enrichment or settings.

The interchange uses version 1, bounded chunks, source/destination account confirmation and existing companion authorization. Protocol runtime mirrors are maintained by Galactic Library's `scripts/sync-companion-purchases.mjs`. Developer details are in Galactic Library's `docs/architecture/purchase-sharing.md`.
