# Humble Library

An unofficial browser extension that marks books, comics, games, or software you already own while viewing a Humble Bundle listing. It is not affiliated with or endorsed by Humble Bundle.

## What works now

- Load it unpacked in Chrome/Chromium browsers. A separately packaged Firefox desktop build is available for manual testing; its installed runtime and storefront UI are tested in isolated Chrome and Firefox profiles.
- Import DRM-free book, comic, and audiobook titles plus detected game and Humble-declared Software entitlements from your signed-in Humble Purchases page—without copying, reading, or saving a Humble cookie.
- Track third-party entitlements that Humble has not yet revealed, including their source purchase and Humble-reported expiry status. The reminder queue is grouped by expiry state. By default, entries use Humble's normal purchase-card flow and require Humble popups to be allowed; an explicit opt-in can instead open a direct Humble order link, which places the purchase identifier in the URL and browser history. Imports check newly discovered purchases and refresh pending entitlements; **Rescan all purchases** establishes a complete reminder baseline for older purchases. Actual redemption-key values are never stored.
- On the Purchases page, download a safe key-reminder discovery report to identify which non-secret Humble key-status and expiry fields are available. The report contains aggregate field names, types, and counts only—never key values, titles, bundle names, purchase identifiers, purchase dates, or other field values.
- When Diagnostics is enabled, download a safe purchase-navigation discovery report to help adapt **Open purchase** when Humble changes its Purchases page. The report contains aggregate tag names, attribute names, link shapes, and counts only—never titles, URLs, purchase identifiers, redemption keys, dates, or text content.
- On the Purchases page, download a local Software classification report when diagnosing an unrecognized Software product. It includes product titles, bundle names, category/type/platform values, and file extensions, but never redemption keys, purchase identifiers, purchase dates, URLs, cookies, or raw purchase responses.
- Import a local JSON library of title strings or `{ "title", "sourceBundle", "kind" }` records as a fallback. Recognized kinds are `book`, `game`, `software`, and `audiobook`; a missing kind remains compatible as a book.
- See an `Owned`, `New`, `Partially owned`, or `Possible match` status for every detected item on Humble Books, Games, and Software bundle pages. Item kinds are kept separate. Listings such as `Vol. 1-3` are matched against individually owned volumes, and partial coverage is never treated as owned. Numbered presentations, conservative book subtitle or edition relationships, game edition variants, games named within an owned collection, and explicitly versioned Software titles can be labelled Possible, but are never automatically treated as owned. Page-only labels such as `preview` are ignored during matching and omitted from the summary lists.
- Optionally pair with a locally installed Galactic Library extension to mark an exact game, book, or audiobook match from Steam, GOG, Epic, Kindle, Audible, or another non-Humble provider as `Owned elsewhere`. Ebook and audiobook ownership remain separate. It remains distinct from your Humble purchase evidence and is never inferred from a fuzzy match. Software companion lookup is enabled only when Galactic Library explicitly advertises software support in GET_STATUS; older versions keep software comparisons local.
- Match verified single-comic issues through a collected edition you already own. The first built-in rule covers *Valiant Masters Rai: From Honor To Strength* and *Rai* (1992) #1–8. You can also import your own explicit, local issue-to-collection mappings.
- See a bundle summary of owned/new items and a per-new-item price at detected tiers. Conservative near-matches are labelled `Possible match` and are never treated as owned.
- The bundle summary recommends the lowest priced tier that contains every confirmed-new item. Possible and partially owned matches are deliberately excluded from that recommendation.
- On a bundle page, use **Show new items only** to hide confirmed-owned cards. Partially owned and possible matches stay visible for review, and the setting stays local to this browser.
- See a small non-blocking `Checking your library…` indicator while Humble finishes rendering a bundle. Enable **Show bundle and catalogue diagnostics** in Extension Options when troubleshooting: the summary panel then reports local-library read time, detected item count, comparison time, and refresh count, while catalogue pages show sorting details.
- On Humble catalogue pages, sort each category by soonest-ending offer and optionally hide previously purchased bundles, limit the view to bundles ending within seven days, or combine those filters. Filter choices stay local to this browser.
- Click an ownership badge, or **Explain** beside a summary title, to inspect the offered and owned titles, validated identifiers, author/edition/language differences, providers, source/review dates, and covered/missing units. Hover still gives a text explanation. **Review in Galactic Library** opens the configured GL options page. Firefox sends the allow-listed `OPEN_REVIEW` request to GL, which opens its own options without exposing a private URL. Older GL builds fall back to toolbar instructions. The inspector does not create review decisions automatically.
- Download a plain-text tier title list from the summary panel when you want a quick, portable record of the current offer. It reads Humble's embedded tier data; if that data has not been hydrated into the page DOM, it retrieves the current Humble page only. It does not change your selected tier or click any page controls.
- Export, restore, or clear browser-local library items, purchase summaries, provenance, key reminders, import/scan history, and custom collection mappings.

Network requests go only to Humble; the optional Galactic Library link communicates between locally installed extensions. The extension has no remote network destination beyond Humble and never reads, stores, or asks you to paste a session cookie. It does store titles, bundle names, purchase dates, purchase identifiers, prices when supplied by Humble, and provenance in browser-local extension storage until you clear or export them. See [the privacy policy](PRIVACY.md) for the complete disclosure. Before a store release, publish that policy at a public HTTPS URL and enter the URL in the store's Privacy field.

When the compatible Galactic Library extension is also installed (or you configure an Advanced override), requests contain current bundle titles/media types, available authors and catalog identifiers, edition/run/language evidence, and explicit requested contents. Purchase keys and download URLs are never sent, and matching does not transfer a whole library. Humble records in GL are excluded; HB combines its current local evidence with GL's reviewed contents from other providers. Neither extension sends this data to a remote server.

Matching preserves Unicode, articles, and meaningful edition wording. Locally recorded literal titles can establish ownership when unambiguous; lossy title keys alone cannot. Known author/run/unit conflicts prevent automatic matches, while different validated ISBNs or book/game editions remain Possible with the actual owned titles available for review. Homonyms are retained separately. Deluxe, gold, platinum, base, and other explicit game packages are compared in both directions; a meaningful short book title with an explicit edition can also be Possible.

Contents coverage is deduplicated across local collections and GL providers. Missing run/language scope remains uncertain, and excerpts or temporary access never prove full-unit coverage. Full contents alone prove an offered collection owned only when a reviewed mapping explicitly declares `contentsComplete: true`; a title-derived range only supplies comparison targets. Older GL responses still support exact/Possible identity matching, but supply no central contents coverage. Requests are batched within GL's item/contents limits; incomplete responses report an error and are not cached as empty results.

The extension runs only on Humble bundle catalogue, Books, Games, Software, and Purchases pages. Its only named Chrome API permission is local storage, and it does not request access to every website or every Humble page.

## Load it

### Chrome / Chromium

1. In Chrome, open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this folder.

### Firefox desktop

1. Build the Firefox package with `./scripts/package-release.ps1 -Target Firefox`.
2. Extract `dist/Humble-Comic-Library-<version>-firefox.zip` to a temporary folder.
3. Open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose the extracted `manifest.json`.
4. Follow the same import and bundle-page checks as Chrome. The Firefox package passes installed-runtime and storefront tests. Signed-in provider checks and AMO signing remain separate release steps.

For a Humble import in either browser, open **Extension options**, select **Open Humble purchase importer**, and click **Import new purchases** on that page. It fetches Humble's order list and retrieves details for new purchases, previously failed checks, unresolved key reminders, and keys whose reported expiry is due. Each required purchase detail is fetched once, sharing the request between title import and safe key-status updates. Progress and completion messages distinguish new purchases, failed-purchase retries, existing-purchase key rechecks, and the one-time upgrade backfill. With no new purchases, it says **No new purchases; rechecking key status** when existing keys still need attention. If nothing needs checking, it returns without fetching purchase details. Use **Rescan all purchases** when you need to rebuild the full Humble library or establish a complete key-reminder baseline for older purchases. Keep the page open until it completes.

   The importer requests Humble's purchase list and only the necessary purchase-detail records through the tab where you are already signed in. It retains DRM-free book/comic downloads (PDF, EPUB, CBZ, CBR, or MOBI), audiobook downloads (MP3, M4A/M4B, AAC, FLAC, OGG/Opus, or WAV), third-party game entitlements, and Software products identified by explicit Humble Software metadata, a narrow GameMaker project/asset format, or a third-party entitlement from an order explicitly labelled a Software Bundle. An archive extension alone does not establish its media type. Redemption-key values are redacted before the response is parsed and are never stored, exported, or logged. Books, audiobooks, games, and software are stored separately, together with their title, purchase date when Humble supplies it, bundle name, and purchase key. Metadata backfills are separate from the key-reminder baseline, which only **Rescan all purchases** establishes. It also records each purchase separately with its paid price and a `pricePerItem` value. Incremental imports add new or previously failed purchases and refresh pending reminders. It does not store the response or any account session token.

   **Full-rescan reconciliation:** when every listed order is successfully fetched and processed, **Rescan all purchases** replaces all current Humble-sourced items (including books), their provenance, purchase summaries, and reminders with that scan's snapshot. A successfully empty purchase list clears the Humble snapshot. Manual titles and custom mappings are preserved; a manual title that was also purchased from Humble keeps its manual ownership while its Humble provenance is refreshed. Legacy items without an explicit Humble source are conservatively protected as manual/unknown-source entries.

   **Metadata upgrades:** **Import new purchases** also revisits orders processed with an older extractor when new extraction requires a backfill. The current upgrade includes file formats, media labels, native product IDs and bibliographic metadata, plus safe recovery of historical purchase identities. Unversioned public-release libraries and import versions 1–8 upgrade directly through this same operation. A separate product-ID refresh is no longer needed. Each successfully processed purchase records its version; failed purchases remain retryable, while an interrupted or failed save does not mark unsaved work complete. Successful per-purchase stamps are committed atomically with the migrated records; unresolved or conflicting identities are retained rather than guessed. Retired purchases remain historical even if their metadata is recovered. Once upgraded, subsequent imports skip those orders unless normal new-purchase, failure, or key-reminder checks require them. This does not require a full rescan and does not run on every extension update. Manual classifications remain unchanged.

   ZIP, RAR, and 7Z are delivery containers, not media types. Explicit product/download labels can identify comics, books, or video inside an archive; an ambiguous archive remains **Unclassified**. For example, a product explicitly titled **Comic Book** can be classified as a comic, but **Episodes** alone does not establish video and a bundle title alone does not establish a game.

   Before replacing data, the importer archives retired Humble observations and their purchase provenance, plus changed purchase-summary observations, separately in local storage. It avoids duplicating observations still in the active snapshot and preserves available file formats in retired records. The history archive is included in backups and shown as a count in Extension options, and missing titles from the active profile can appear as **Check ownership** candidates on bundle pages, with the original title and purchase provenance. History never proves Owned or reviewed contents coverage, and is excluded from duplicate badges, catalogue purchase markers, and reminder queues. Other saved accounts are never matched until explicitly selected as the active account. A failed full scan retains previous entries and adds successful updates without pruning; failed title imports are retried on the next incremental import. Repeat a successful full rescan to complete reconciliation. An invalid purchase list aborts before storage is changed. The importer status explicitly says whether reconciliation completed.

   To help develop key-expiry reminders without exposing entitlement keys, **Inspect key reminder data** makes the same read-only purchase-detail requests for every purchase and downloads `humble-key-reminder-discovery.json`. It does not write to extension storage. The report has aggregate field names, value types, and counts, but no key values, titles, bundle names, purchase identifiers, purchase dates, or other values.

   To diagnose why **Open purchase** cannot reach an individual order, **Inspect purchase navigation** examines only the already-rendered Purchases page and downloads `humble-purchase-navigation-discovery.json`. It does not make network requests or write to extension storage. The report has only aggregate tag names, attribute names, link shapes, and counts—never titles, URLs, purchase identifiers, redemption keys, dates, or text content.

   To diagnose a Humble product that was not recognized as Software, **Inspect Software product data** makes the same read-only requests and downloads `humble-software-product-discovery.json`. It includes direct-product and third-party-entitlement titles with their source bundle, category/type/platform values, file extensions, and non-secret top-level field names. It excludes redemption keys, purchase identifiers, purchase dates, URLs, cookies, and raw API responses; it does not write to extension storage.

   The key-reminder queue in **Extension options** groups pending entitlements by expiry state and shows their Humble bundle, purchase date, entitlement type, and reported expiry. With **Open direct Humble order links** off (the default), **Open purchase** uses Humble's normal purchase-card flow; allow popups and redirects for Humble if you want it to open the individual order. When you explicitly enable that option, **Open purchase** goes directly to Humble's individual order/download page in one tab. This places the purchase identifier in the Humble URL and browser history, but avoids the popup requirement. The extension never handles a redemption value. New imports check only newly discovered purchases plus purchases with an unresolved entitlement, so a newly revealed key disappears from the reveal-reminder queue after the next refresh unless it is expired or unavailable. This does not prove destination activation. If the extension has not completed a full reminder baseline, the list makes that clear; choose **Rescan all purchases** to check older purchases. The extension stores no redemption-key values.

5. Or use **Import titles** for a manual JSON title list. This replaces the library and clears purchase records, provenance, reminders, scan history, and custom mappings:

```json
[
  { "title": "Hellboy Omnibus Volume 1", "sourceBundle": "Hellboy Universe Bundle", "kind": "book" },
  { "title": "Forest Builder Pro", "sourceBundle": "Asset Bundle", "kind": "software" },
  "B.P.R.D. Plague of Frogs Vol. 1"
]
```

To recover an exported library, use the separate **Restore backup** control in Extension options. It replaces items (including all purchase provenance), purchase summaries, historical purchase evidence, key reminders, reminder scan state (including baseline and retry purchase identifiers), import/reconciliation history, media-import version, and custom mappings together. Restoring never merges reminders from the previous installation into the backup. Validation completes before storage changes; confirm the replacement when prompted.

New version-9 backups preserve all of this data across export/restore, including the separate history archive and per-entitlement key evidence. Earlier versioned backups remain supported: any data absent from an older backup is reset to empty/default state, so older backups may require a full rescan to re-establish reminders or a media backfill. **Import titles** rejects exported backups to prevent accidentally discarding their purchase data. Manual title import and **Clear library** also clear the history archive. Browser preferences, the Galactic Library override, automatic purchase-sync authorization, and temporary purchase-navigation requests are not exported. Restore preserves preferences and the matching override, but resets automatic purchase-sync relationships and clears pending navigation requests. Backups contain private purchase identifiers and should be kept private.

6. Visit a Humble URL beginning `https://www.humblebundle.com/books/`, `https://www.humblebundle.com/games/`, or `https://www.humblebundle.com/software/` and refresh.

### Pair with Galactic Library (optional)

Install compatible official GL and HB extensions, choose **Check connection** in HB settings, then reload a bundle page. Pairing is automatic. **Advanced / Developer pairing** retains the previous custom IDs for unpacked builds; removing an override returns to official discovery. [Pairing, identities, authorization and release testing](docs/companion-pairing.md) explains both browsers and older published HB limitations. Exact non-Humble matches appear as **Owned elsewhere**; uncertain evidence remains visible for review.

Audiobook detection uses explicit item metadata or format attributes, a trailing audiobook delivery label, or an unambiguously audiobook-labelled listing. Item metadata can distinguish ebooks within an audiobook listing. Mixed bundles are checked per item; ambiguous same-title formats without a local format signal do not establish ownership. Missing or malformed metadata falls back to the ordinary Books view unless another explicit audiobook signal is available. No extra permissions are needed; the same code is packaged for Chrome and Firefox.

## Browse bundles

Owned accepts an unambiguous local purchase despite punctuation, spacing, volume-abbreviation or trailing book-format differences. Articles, Roman numerals, preview labels and meaningful symbols are retained for that comparison; conflicting identifiers/authors, numbered units and edition wording still prevent a weak title from proving ownership. Compatible validated identifiers can identify renamed purchases.

Possible is deliberately broader: related editions, shortened/subtitled titles, parenthetical qualifiers, software versions, named game collections and small spelling differences can warn about another library item. These candidates show their actual library titles and require review; they never establish complete edition or collection ownership. Very short generic prefixes and independent subtitle-bearing works are not inferred solely from a shared main title.

- On an individual Books, Games, or Software bundle page, the lower-right summary reports ownership by tier and shows the lowest tier containing every confirmed-new item. **Show new items only** hides confirmed-owned cards while retaining partial and possible matches. Uncheck it at any time to restore the full view.
- On `https://www.humblebundle.com/bundles`, `/books`, `/games`, or `/software`, offers are sorted by their displayed time remaining. Use the lower-left **Catalogue filters** to hide purchased offers, limit the view to offers labelled seven days or fewer, or combine both filters. These choices persist only in the current browser profile.
- In **Extension options**, enable **Show bundle and catalogue diagnostics** only when troubleshooting. It adds timing and sorting information without changing ownership results, and reveals the two local purchase-metadata discovery reports for diagnostics.

When a configured central lookup fails, unmatched offers show **Check incomplete**, remain visible, and receive no confirmed-new item or unit value. Existing local Owned/Possible/Partial evidence remains available. A successful retry restores the completed result. Related central items with unknown ownership or temporary access remain Possible / **Check ownership**, naming the library item instead of treating it as absent.

## Bundle value and wishlist

The bundle summary's **Bundle value and purchase goal** panel compares cumulative tiers for three goals: all confirmed-new items, new known issues/volumes, or wishlist items available in this bundle. It shows the lowest known priced tier satisfying the selected goal, unique new units, units added at each tier, cost per known new unit, and wishlist priority totals. Overlapping collections never inflate the unit count. Unknown prices cannot satisfy a priced recommendation; unknown run/language or possibly covered units receive no confirmed new-unit value.

Use **Wishlist** beside a summary title to add/remove it. In Extension options, add titles by media type and edit their priority from 1 to 100. Priority measures your interest, not retail value. Wishlist records can preserve author/ISBN/edition evidence; ebooks and audio are separate. **Include uncertain matches in this plan** is an explicit planning choice and never changes an ownership badge. Partial items with known uncovered units can contribute contents value; the default product goal excludes partial and Possible matches.

Wishlist preferences survive library restores and clearing the library. Save or restore them separately with **Export wishlist**/**Restore wishlist**. These controls validate before writing and transfer no purchase records. Plans apply only to the detected bundle tiers and checked library evidence; they do not purchase anything.

## Series gaps and numbered coverage

The summary's **Series coverage** view combines the same reviewed local/GL contents model with a numbered sequence for the series represented in the offer. It checks intervening issues/volumes with GL, including units absent from the bundle, before presenting gaps. Fractions sort numerically; runs, languages, issues, volumes, annuals, and specials remain separate. Unknown scope is shown as needing review, and excerpts/audio do not prove ebook/comic coverage. Expand a series to see its ordered units and actual ownership sources.

This is coverage within the offered span, not a full series bibliography or a publisher's chronological reading order. Very large spans show only explicitly requested units. When GL is unavailable, the panel states that only local evidence was checked. **Open central series review** opens GL's options page for its full central Series coverage view (with the same trusted Firefox request and older-build fallback as the ownership inspector). Context queries use the existing bounded `MATCH_ITEMS` API and never claim an offered edition fully owned.

Single-unit titles imported as previews/samples do not establish full-unit contents ownership. A shared author alone never matches unrelated books. Literal range titles remain Partial until the offered contents/edition is sufficiently established, even when every numbered title is found locally. Title/identifier candidate indexes and an index of owned contents keep comparison work focused on relevant records in large libraries.

## Custom collection mappings

In **Extension options**, use **Collection mappings** to import a JSON file like this:

```json
{
  "mappings": [
    {
      "id": "example-series-2020",
      "collectionTitle": "Example Series: Complete Collection",
      "contains": [
        { "series": "Example Series", "year": 2020, "from": 1, "to": 12 }
      ]
    }
  ]
}
```

The mapping is applied only when the named collection is in your imported library. Legacy title/year/range mappings remain supported. For edition-specific mappings, add `editionId` or `identifiers` (`isbn` or `asin`); the library record must carry the same identifier. An unknown edition does not satisfy an edition-specific rule.

Rich mappings can include `sourceLabel`, `sourceId`, `sourceUrl` (HTTP/HTTPS without credentials; query parameters are discarded), `verifiedAt`, `verified`, `contentsComplete`, and `language`. Set `verified: false` for unreviewed mappings; they never prove ownership. Each contents entry requires `series` and a `year`, `run`, or `runId`, and can carry `seriesId`/`runId`. Use `unitType` (`issue`, `volume`, `annual`, `special`, or `component`) with either an integer `from`/`to` range or a `number` such as `"1/2"`, `"0.5"`, or a named special. `completeness: "excerpt"` records a partial reprint and never proves ownership of the full unit. For example:

```json
{
  "mappings": [{
    "id": "example-reviewed-edition",
    "collectionTitle": "Example Collected Edition",
    "editionId": "publisher-edition-2",
    "sourceLabel": "Publisher contents page",
    "sourceUrl": "https://publisher.example/edition-2",
    "verifiedAt": "2026-10-01T12:00:00Z",
    "verified": true,
    "contentsComplete": true,
    "language": "en",
    "contains": [
      {"series": "Example", "run": "2020", "unitType": "issue", "number": "1/2"},
      {"series": "Example", "run": "2020", "unitType": "annual", "number": "1"},
      {"series": "Example", "run": "2020", "unitType": "special", "number": "Holiday", "completeness": "excerpt"}
    ]
  }]
}
```

Importing replaces previous custom mappings; built-in mappings remain. Mappings and imported bibliographic evidence are included in backups. Run IDs are retained locally; GL contents requests also need a readable run name/year to establish coverage.

A matching edition-bound rule takes precedence over generic title rules. Conflicting reviewed lists, including contradictory full/excerpt assertions, require review and supply no automatic owned-contents evidence.

## Create a release ZIP

Chrome uses a background service worker for the review-opening action and opens GL through [Chromium's trusted extension-options route](https://github.com/chromium/chromium/blob/main/chrome/browser/resources/extensions/navigation_helper.ts), rather than navigating directly to another extension's private HTML. The Firefox package substitutes background scripts, following [Mozilla's background manifest guidance](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background). This adds no permissions. Firefox uses stable Gecko IDs for automatic official-companion messaging; no manual ID configuration is needed for official GL and HB builds. Advanced overrides remain available for development builds.

Run one of the following from PowerShell at the repository root:

```powershell
# Chrome (default; unchanged package name and manifest)
.\scripts\package-release.ps1

# Firefox desktop package; adds Firefox-only metadata inside its ZIP manifest
.\scripts\package-release.ps1 -Target Firefox
```

The Chrome target creates `dist/Humble-Comic-Library-<version>.zip`; the Firefox target creates `dist/Humble-Comic-Library-<version>-firefox.zip`. Both use a fixed file order and timestamps, so identical source produces an identical ZIP and SHA-256 hash. The Firefox archive adds only its Gecko ID and AMO data-collection declaration to the generated `manifest.json`; shared runtime files are identical. Archives contain only extension runtime files and icons; they exclude Git history, backups, exports, reports, notes, and documentation. Upload the Chrome ZIP—not the project folder—to the Chrome Web Store. Complete signed-release and live-account smoke testing before submitting the Firefox ZIP to AMO for signing.

Store screenshots are checked into [store-assets/](store-assets/) for review and versioning, but are intentionally excluded from the extension ZIP. Upload those images separately in the Chrome Web Store dashboard.

Record each published version in [CHANGELOG.md](CHANGELOG.md), and increase the numeric `version` in `manifest.json` before every subsequent Chrome Web Store or AMO upload.

## Verification

Run `node --test --test-concurrency=1 tests` for the core, backup, navigation, and Windows Chrome/Firefox packaging checks. When the adjacent GalacticLibrary repo is present, the suite also exercises its actual companion API; the standalone HB suite uses contract fixtures otherwise. Run `node tests/browser.mjs` and `node tests/browser.mjs --firefox` for storefront UI checks in isolated Chrome/Firefox profiles with synthetic libraries. Run `node tests/runtime.mjs` and `node tests/runtime.mjs --firefox` for the packaged extension with real background/storage APIs; `node tests/runtime.mjs --central` verifies the real installed HB-to-GL reminder exchange when the adjacent GL repo is present. See [runtime verification](docs/runtime-verification.md) for coverage and limits. Set `CHROME_BIN` if Chrome/Chromium is installed elsewhere. These checks do not use a personal browser profile or signed-in provider accounts.

Run `node tests/browser.mjs --tier-switch` and repeat with `--firefox` for the IGN bundle layout regression. The fixture uses Humble's desktop grid, reusable tier cards, native animation completion and full-width expanded details panel. It checks 7 â†’ 4 â†’ 2 â†’ 4 â†’ 7 â†’ 4 transitions, row geometry, sorting, ownership counts, preview exclusion and asynchronous remounts. The details preview must never become a sortable product, and sorting must wait for native tier animation cleanup.

## Private central reminders

Use **Share entitlement reminders** in Extension options to send dated, narrow key-status evidence to Galactic Library, with opaque references and explicit account confirmation. GL stages complete uploads and keeps ownership and activation separate. Sharing is manual; either extension can remove the saved feed. See [setup, privacy and account scope](docs/reminder-sharing.md).

## Roadmap

Add a review queue for conservative possible matches. Humble does not provide a stable public API, so the importer and tier-data reader are deliberately defensive and report unexpected responses instead of guessing.

Third-party keys use a **Purchased** badge when compatible purchase evidence is usable; those items still count toward the existing Owned summary. The evidence dialog separates purchase, key status, reported expiry and observation date from **Destination activation: unknown**. Purchases and revealed keys never establish Steam or other destination activation. If every recorded key for a matching title is explicitly expired or unavailable, the title remains **Check ownership / Possible**, with its purchase evidence intact. Another usable purchase, manual ownership assertion, or independent destination-library record can still establish ownership. Key-status refreshes replace evidence for the same entitlement while preserving separate purchases. Duplicate Humble game/software product rows cannot mask the status of their corresponding keys. Redemption values remain redacted before parsing and never enter saved evidence or backups. Older resolved purchases without a due expiry are refreshed by **Rescan all purchases**.

Firefox central integration: from the adjacent GalacticLibrary repo, run `node tests/firefox.mjs --companions`. This installs all three validated packages in one disposable Firefox profile and verifies actual matching, Partial contents, reminder sharing, permission revocation and trusted central review. GL can also open HB source review through the same paired request. No native messaging helper is needed.

## Companion interface

GL checks include a random timing correlation ID and sender timestamp. Updated GL builds acknowledge it so the companion can report when the response arrives; that report is best effort and never delays ownership results or changes the 30-second deadline. GL keeps at most 50 timing rows in worker memory for its local timing export. The added diagnostic fields contain no titles, library records or account labels. Older GL builds continue matching; missing timing acknowledgements or rejected callback reports are ignored.

Bundle summaries use the same status vocabulary, Explain action, evidence dialog sizing, and compact panel controls. Possible and Partial items show the actual related library title, with other candidates available in the summary. Use the corner selector to move the panel; Minimize/Expand and the corner are saved across visits. Settings contains the same display preferences. These device preferences survive ownership restore and clear and stay outside backups. HB key purchases still say Purchased because a key purchase cannot prove destination activation. FAN edition/package captions retain warnings about unverified extras.

Wishlist priorities range from 1 to 100 and affect planning without establishing ownership. FAN full backups include the wishlist; HB exports/restores its wishlist separately and preserves it during ownership restore. Clearing the ownership library preserves wishes in both extensions. Settings begins with imports, wishlist and Galactic Library linking, followed by provider-specific reminders, display, and backup/recovery.


## Imports and settings

The purchase importer groups its description, three account controls, and status/actions into separate rows. Account nickname is a local name, not a detected login. Confirm the signed-in website account before importing. Expand **Saved accounts** in Settings or the purchase importer to select an existing snapshot. Confirm the website is signed into that account, then choose **Use saved account**. Its library and account-specific scan history become active without a mandatory full rescan. **Rename account** changes only the nickname and keeps purchase/scan evidence. To add a new account, sign in on the website, enter a new nickname, select **Save a new account on full rescan**, and use **Rescan all purchases** once. Ownership matching uses only the active snapshot; the other saved accounts remain separate.

Both companions offer a searchable, paged wishlist with editable priorities and separate wishlist export/restore. Wishes influence planning on bundles you open; there is no background bundle discovery or wishlist notification. Each companion keeps its own wishes. Both offer ownership backups and a title catalog export containing identity metadata only. Ownership backup formats remain provider-specific: FAN full backups include wishes and reset scan authority on restore; HB preserves wishes during ownership restore and exports them separately. Clearing the library preserves wishes, display preferences and pairing.

HB's optional manual title replacement and reviewed collection mappings live under Advanced in Settings, with a shipped JSON example and review instructions. HB collects local Humble key reminders and can manually share them with GL; FAN reads the linked GL reminder list. Privacy explanations reflect each provider's actual storage behavior.


## Saved accounts and scan history

Saved accounts are usable profiles, with a selector and rename control in both Settings and the purchase importer. Selecting restores that account's library, historical review evidence and incremental scan state. Website sign-in is still manual. Every scan requires confirmation of the signed-in account; the extension cannot infer it from a nickname. Pending scans and reminder-sharing snapshots are invalidated when account identity changes, so older requests cannot overwrite the active account. Duplicate nicknames are rejected. Renaming does not fetch purchases, clear scan history, or change the website account. Display preferences, pairing and wishlist remain extension-wide.

FAN keeps each account's order fingerprints and import/failure summary locally when switching. Those fingerprints remain excluded from exported backups and are never trusted on backup restore. Older FAN archives and restored backups retain their items but recheck completed orders on the next incremental import because no trustworthy skip history exists. HB restores its existing purchase/reminder scan history; older records may still need the normal media backfill. Full rescan remains available for reconciliation, but switching to an existing saved account does not require it.

## Appearance

Settings offer Dark, Light and System using the shared GalacticHamster navy/neutral palettes and purple controls. System updates when your browser/OS changes appearance. Fresh installations default to System; existing settings without a theme retain Light. The choice and optional Follow Galactic Library appearance cache live in the private local `galacticHamsterAppearance` settings key, outside ownership/library backups.

When following GL, your independent mode is retained and its selector is disabled. Open a page or select Refresh linked appearance to fetch GL's mode using your existing pairing. There is no polling. If GL is unavailable, its cached mode for that target is retained; a different target falls back to your local choice. These overlays do not restyle native store controls. Browser-owned tooltips and confirmation prompts remain controlled by the browser.

Theme version 1 is authored in GalacticLibrary/shared/theme.js, theme.css, theme-app.css and theme-overlays.css. From GL run `node scripts/sync-companion-themes.mjs`, then `node scripts/sync-companion-themes.mjs --check`; commit and validate the resulting copies in all three repos. Packaged extensions carry their own assets and work independently.

## Automatic purchase synchronization

[Share saved purchases](docs/purchase-sharing.md) with Galactic Library without another website scan. Automatic sharing requires compatible linked extensions and one-time standing permission for the selected account relationship. Historical limitations are reported; repeated imports are additive and idempotent.

Automatic sync is enabled once for an explicitly selected store-account relationship, with one local confirmation and reverse-verified consent at the companion. Meaningful saved-purchase commits then synchronize both ways with GL. Manual sharing remains under Advanced. See [purchase sync](docs/purchase-sharing.md) for retries, account replacement, privacy and recovery. The alarms permission supports bounded durable retries.

Galactic Library availability is checked before an external ownership lookup. When the browser reports no receiver, or GL explicitly denies the connection, local matches are final and unmatched items show **New**. This does not diagnose why the connection is unavailable. Timeouts, incompatible replies, and failures after a successful connection remain **Check incomplete**. Reload the bundle page or refresh central evidence after installing, enabling, or reconnecting GL. No purchase records are changed.

## Support development

Enjoying Galactic Hamster's free, open-source tools? If you'd like to support continued development, you can [buy us a coffee on Ko-fi](https://ko-fi.com/galactichamster). Donations are entirely optional.

Game-key badges distinguish a saved purchase from platform ownership. A local marketplace purchase shows **Purchased** until Galactic Library returns a compatible exact, permanent ownership record from Steam, GOG, Epic Games, Amazon Games, Nintendo, PlayStation or Xbox. Then it shows **Owned**, with both sources in the explanation. Another marketplace purchase, a synchronized copy, a Possible match or temporary access cannot provide that confirmation. Independently owned games without a local purchase retain **Owned elsewhere**. Book badges are unchanged.

Run `node --test tests/purchased-owned.test.mjs` for the evidence matrix, and `node tests/purchased-owned-browser.mjs` (also with `--firefox`) for disposable storefront checks of badges, explanations and two-phase updates. The optional integration case uses the adjacent GL checkout and never imports personal data.

The release ZIP filenames retain `Humble-Comic-Library` for compatibility with existing packaging automation. The displayed product name is **Humble Library** in both browsers. The Firefox add-on ID, internal identifiers, and existing backup format are unchanged.

## License and attribution

Humble Library is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version (GPL-3.0-or-later). See [LICENSE](LICENSE) for the full license text.

Copyright (C) 2026 Galactic Hamster
Published and distributed by Galactic Hamster LLC.

Original runtime icons (`icons/icon*.png`) are licensed under GPL-3.0-or-later. Project names, trademarks, and logos are reserved pursuant to GPLv3 Section 7(e). "Humble Bundle" and "Humble" are trademarks of Humble Bundle, Inc. Humble Library is an independent project not affiliated with or endorsed by Humble Bundle, Inc. Complete notices and disclaimers are documented in [NOTICE](NOTICE).


