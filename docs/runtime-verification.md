# Runtime verification (HB-10)

Run from the HB repository root:

~~~powershell
node --test
node tests/browser.mjs
node tests/browser.mjs --firefox
node tests/browser.mjs --catalogue
node tests/browser.mjs --firefox --catalogue
node tests/browser.mjs --refresh-loop
node tests/browser.mjs --firefox --refresh-loop
node tests/browser.mjs --slow-central
node tests/browser.mjs --firefox --slow-central
node tests/runtime.mjs
node tests/runtime.mjs --firefox
node tests/runtime.mjs --central
~~~

The core suite tests parsing, matching, purchase/key evidence, scan races, restore validation, outbound privacy and deterministic Chrome/Firefox packaging. Storefront fixtures run the actual content scripts in Chrome and Firefox with synthetic providers: explanations, Possible editions, contents coverage, summary controls, tier planning, wishlist and series gaps, Purchased versus activation, and expiry review.

The refresh-loop fixture delays and fails Galactic Library lookups, reproducing the feedback loop between HB's own DOM annotations and its bundle observer. It checks stable Not checked and local Partial results, no repeated idle requests, preserved minimized/expanded preferences, and retaining the current summary during a deliberate refresh. Real lazy-loaded covers, hydrated titles and removed covers must still trigger a single settled update. These checks run in both Chrome and Firefox.

The slow-central fixture uses valid 4.5-second replies, exceeding the former 3.5-second deadline. Initial checks and an explicit retry must complete with the normal Possible/Partial results, preserve panel preferences and stop requesting once settled. The deadline is now 30 seconds per request, allowing large private databases and a busy worker to finish while retaining a finite failure path. A core test advances that deadline without a real wait and verifies that timed-out requests cannot overwrite later results and that retry clears their failure state. Failed checks offer "Retry Galactic Library checks" in the summary; retry keeps completed central results and requests the missing results again.

The catalogue fixture reproduces Humble's `.mosaic-section > .mosaic-layout > .tile-holder` structure, including a final one-card row. It checks expiry order across full and singleton rows, category boundaries, purchased badges, combined filters, empty-row gaps, preserved row capacities, inline flex order, repeat sorting and later-added singleton offers. It also tests hidden duplicate countdowns, unrelated marketing durations, clock-only hydration, temporarily empty timers, and day-boundary changes without refreshing on every second tick. On 2026-10-03, an anonymous live Books-page comparison reproduced the Image in the '20s two-day offer stranded behind seven-day offers with the old sorter; the fix includes that last row in the normal cross-row sort. The previous two-card minimum silently excluded it. Diagnostics now report the sortable-card count and one-card rows so excluded cards cannot hide behind a successful sort of the other rows.

Installed-runtime checks build the allow-listed release ZIP, load it into a fresh browser profile and exercise actual background messaging and extension storage. They verify successful backup restore, malformed JSON, invalid later records, backup-versus-manual import separation, stale scan leases, incomplete full-scan preservation, account confirmation and manual replacement/reset. Firefox uses its packaged background-script overlay, including collection mappings required by restore.

The optional --central test requires the adjacent GalacticLibrary repo. It installs both validated runtime packages in the same fresh Chrome profile, pairs their actual workers, sends reminders through HB's options controls, checks privacy and unchanged native GL ownership, then retracts the feed.

Set CHROME_BIN or FIREFOX_BIN for custom browser locations. Windows also discovers Firefox's current Microsoft Store installation. The installed checks use Chrome's local DevTools pipe and Firefox's local Marionette driver with a temporary unsigned add-on. All control flags apply only to the generated test profile. There are no extra runtime permissions, shipped debug helpers or third-party test dependencies. Test processes and their generated profiles are cleaned up afterward.

These automated checks use synthetic libraries and purchase responses, without a personal profile or signed-in provider. Live-account changes to Humble markup/endpoints and signed store-release installation still need release smoke testing. Passing tests do not certify a real account's complete purchase history.

Driver references: [Chrome extension tooling updates](https://developer.chrome.com/docs/extensions/whats-new), [Firefox Marionette add-on installation](https://firefox-source-docs.mozilla.org/python/marionette_driver.html), and [Firefox remote security](https://firefox-source-docs.mozilla.org/remote/Security.html).

## Firefox central integration

From the adjacent GalacticLibrary repo, run `node tests/firefox.mjs --companions`. All three validated Firefox packages are installed in one disposable profile. Tests pair through GL options, verify software lookup, Possible editions and Partial comic contents, share HB reminders through its actual options controls, exercise HB restore/writer checks, and verify FAN/HB central review, GL-to-HB source review and permission revocation. Stable Gecko IDs identify recipients; no native messaging helper or guessed `moz-extension` URL is used.

Verified on 2026-10-02: 123 core tests and 26 Firefox storefront checks passed, alongside the installed three-extension integration. Signed-in provider sessions and AMO signing still require separate release checks.
