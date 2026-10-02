# Runtime verification (HB-10)

Run from the HB repository root:

~~~powershell
node --test
node tests/browser.mjs
node tests/browser.mjs --firefox
node tests/runtime.mjs
node tests/runtime.mjs --firefox
node tests/runtime.mjs --central
~~~

The core suite tests parsing, matching, purchase/key evidence, scan races, restore validation, outbound privacy and deterministic Chrome/Firefox packaging. Storefront fixtures run the actual content scripts in Chrome and Firefox with synthetic providers: explanations, Possible editions, contents coverage, summary controls, tier planning, wishlist and series gaps, Purchased versus activation, and expiry review.

Installed-runtime checks build the allow-listed release ZIP, load it into a fresh browser profile and exercise actual background messaging and extension storage. They verify successful backup restore, malformed JSON, invalid later records, backup-versus-manual import separation, stale scan leases, incomplete full-scan preservation, account confirmation and manual replacement/reset. Firefox uses its packaged background-script overlay, including collection mappings required by restore.

The optional --central test requires the adjacent GalacticLibrary repo. It installs both validated runtime packages in the same fresh Chrome profile, pairs their actual workers, sends reminders through HB's options controls, checks privacy and unchanged native GL ownership, then retracts the feed.

Set CHROME_BIN or FIREFOX_BIN for custom browser locations. Windows also discovers Firefox's current Microsoft Store installation. The installed checks use Chrome's local DevTools pipe and Firefox's local Marionette driver with a temporary unsigned add-on. All control flags apply only to the generated test profile. There are no extra runtime permissions, shipped debug helpers or third-party test dependencies. Test processes and their generated profiles are cleaned up afterward.

These automated checks use synthetic libraries and purchase responses, without a personal profile or signed-in provider. Live-account changes to Humble markup/endpoints and signed store-release installation still need release smoke testing. Passing tests do not certify a real account's complete purchase history.

Driver references: [Chrome extension tooling updates](https://developer.chrome.com/docs/extensions/whats-new), [Firefox Marionette add-on installation](https://firefox-source-docs.mozilla.org/python/marionette_driver.html), and [Firefox remote security](https://firefox-source-docs.mozilla.org/remote/Security.html).
