# Humble Comic Library

An unofficial browser extension that marks books, comics, games, or software you already own while viewing a Humble Bundle listing. It is not affiliated with or endorsed by Humble Bundle.

## What works now

- Load it unpacked in Chrome/Chromium browsers. A separately packaged Firefox desktop build is available for manual testing; it is not yet runtime-verified in Firefox.
- Import DRM-free book, comic, and audiobook titles plus detected game and Humble-declared Software entitlements from your signed-in Humble Purchases page—without copying, reading, or saving a Humble cookie.
- Track third-party entitlements that Humble has not yet revealed, including their source purchase and Humble-reported expiry status. The reminder queue is grouped by expiry state. By default, entries use Humble's normal purchase-card flow and require Humble popups to be allowed; an explicit opt-in can instead open a direct Humble order link, which places the purchase identifier in the URL and browser history. Imports check newly discovered purchases and refresh pending entitlements; **Rescan every purchase** establishes a complete reminder baseline for older purchases. Actual redemption-key values are never stored.
- On the Purchases page, download a safe key-reminder discovery report to identify which non-secret Humble key-status and expiry fields are available. The report contains aggregate field names, types, and counts only—never key values, titles, bundle names, purchase identifiers, purchase dates, or other field values.
- When Diagnostics is enabled, download a safe purchase-navigation discovery report to help adapt **Open purchase** when Humble changes its Purchases page. The report contains aggregate tag names, attribute names, link shapes, and counts only—never titles, URLs, purchase identifiers, redemption keys, dates, or text content.
- On the Purchases page, download a local Software classification report when diagnosing an unrecognized Software product. It includes product titles, bundle names, category/type/platform values, and file extensions, but never redemption keys, purchase identifiers, purchase dates, URLs, cookies, or raw purchase responses.
- Import a local JSON library of title strings or `{ "title", "sourceBundle", "kind" }` records as a fallback. Recognized kinds are `book`, `game`, `software`, and `audiobook`; a missing kind remains compatible as a book.
- See an `Owned`, `New`, `Partially owned`, or `Possible match` status for every detected item on Humble Books, Games, and Software bundle pages. Item kinds are kept separate. Listings such as `Vol. 1-3` are matched against individually owned volumes, and partial coverage is never treated as owned. Numbered presentations, conservative book subtitle or edition relationships, game edition variants, games named within an owned collection, and explicitly versioned Software titles can be labelled Possible, but are never automatically treated as owned. Page-only labels such as `preview` are ignored during matching and omitted from the summary lists.
- Optionally pair with a locally installed Galactic Library extension to mark an exact game, book, or audiobook match from Steam, GOG, Epic, Kindle, Audible, or another non-Humble provider as `Owned elsewhere`. Ebook and audiobook ownership remain separate. It remains distinct from your Humble purchase evidence and is never inferred from a fuzzy match. Software companion lookup stays disabled because Galactic Library's version-1 API does not support it.
- Match verified single-comic issues through a collected edition you already own. The first built-in rule covers *Valiant Masters Rai: From Honor To Strength* and *Rai* (1992) #1–8. You can also import your own explicit, local issue-to-collection mappings.
- See a bundle summary of owned/new items and a per-new-item price at detected tiers. Conservative near-matches are labelled `Possible match` and are never treated as owned.
- The bundle summary recommends the lowest priced tier that contains every confirmed-new item. Possible and partially owned matches are deliberately excluded from that recommendation.
- On a bundle page, use **Show new items only** to hide confirmed-owned cards. Partially owned and possible matches stay visible for review, and the setting stays local to this browser.
- See a small non-blocking `Checking your library…` indicator while Humble finishes rendering a bundle. Enable **Show bundle and catalogue diagnostics** in Extension Options when troubleshooting: the summary panel then reports local-library read time, detected item count, comparison time, and refresh count, while catalogue pages show sorting details.
- On Humble catalogue pages, sort each category by soonest-ending offer and optionally hide previously purchased bundles, limit the view to bundles ending within seven days, or combine those filters. Filter choices stay local to this browser.
- Hover an `Owned`, `Partially owned`, or `Possible` item badge to see the matching library title(s), Humble bundle, purchase date when available, and—for possible matches—why it was suggested.
- Download a plain-text tier title list from the summary panel when you want a quick, portable record of the current offer. It reads Humble's embedded tier data; if that data has not been hydrated into the page DOM, it retrieves the current Humble page only. It does not change your selected tier or click any page controls.
- Export, restore, or clear browser-local library items, purchase summaries, provenance, key reminders, import/scan history, and custom collection mappings.

Nothing is sent anywhere except Humble. The extension has no network destination beyond Humble and never reads, stores, or asks you to paste a session cookie. It does store titles, bundle names, purchase dates, purchase identifiers, prices when supplied by Humble, and provenance in browser-local extension storage until you clear or export them. See [the privacy policy](PRIVACY.md) for the complete disclosure. Before a store release, publish that policy at a public HTTPS URL and enter the URL in the store's Privacy field.

If you explicitly configure the optional Galactic Library link, the extension sends only the item titles and media types in the current bundle to that locally installed extension. Galactic replies with matching records from its non-Humble providers; only exact confirmed ownership is labelled owned elsewhere, while uncertain access and related titles require review. Neither extension sends a full library or any data to a remote server.

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
4. Follow the same import and bundle-page checks as Chrome. The Firefox package has automated manifest/package validation, but browser behavior still needs manual verification before AMO submission.

For a Humble import in either browser, open **Extension options**, select **Open Humble purchases importer**, and click **Import new purchases** on that page. It fetches Humble's order list, skips orders already imported successfully in that browser profile, and only retrieves details for new or previously failed orders. The same purchase-detail request also checks key reminders for those new purchases and refreshes any known pending reminder. Use **Rescan every purchase** when you need to rebuild the full Humble library or establish a complete key-reminder baseline for older purchases. Keep the page open until it completes.

   The importer requests Humble's purchase list and only the necessary purchase-detail records through the tab where you are already signed in. It retains DRM-free book/comic downloads (PDF, EPUB, CBZ, CBR, or MOBI), audiobook downloads (MP3, M4A/M4B, AAC, FLAC, OGG/Opus, or WAV), third-party game entitlements, and Software products identified by explicit Humble Software metadata, a narrow GameMaker project/asset format, or a third-party entitlement from an order explicitly labelled a Software Bundle. An unknown archive alone is not imported. Redemption-key values are redacted before the response is parsed and are never stored, exported, or logged. Books, audiobooks, games, and software are stored separately, together with their title, purchase date when Humble supplies it, bundle name, and purchase key. On its first import after this update, the extension automatically checks all prior purchases once to backfill newly supported deliveries and correct earlier Software-as-game classification; later imports again process only new purchases. That delivery backfill is separate from the key-reminder baseline, which only **Rescan every purchase** establishes. It also records each purchase separately with its paid price and a `pricePerItem` value. Incremental imports add new or previously failed purchases and refresh pending reminders. It does not store the response or any account session token.

   **Full-rescan reconciliation:** when every listed order is successfully fetched and processed, **Rescan every purchase** replaces all current Humble-sourced items (including books), their provenance, purchase summaries, and reminders with that scan's snapshot. A successfully empty purchase list clears the Humble snapshot. Manual titles and custom mappings are preserved; a manual title that was also purchased from Humble keeps its manual ownership while its Humble provenance is refreshed. Legacy items without an explicit Humble source are conservatively protected as manual/unknown-source entries.

   Before replacing data, the importer archives the previously observed Humble titles and their purchase provenance, plus purchase-summary observations, separately in local storage. Repeated identical evidence is deduplicated; changed purchase metadata remains in the archive. The history archive is included in backups and shown as a count in Extension options, but it is excluded from current ownership matching, duplicate badges, catalogue purchase markers, and reminder queues. A failed full scan retains previous entries and adds successful updates without pruning; failed title imports are retried on the next incremental import. Repeat a successful full rescan to complete reconciliation. An invalid purchase list aborts before storage is changed. The importer status explicitly says whether reconciliation completed.

   To help develop key-expiry reminders without exposing entitlement keys, **Inspect key reminder data** makes the same read-only purchase-detail requests for every purchase and downloads `humble-key-reminder-discovery.json`. It does not write to extension storage. The report has aggregate field names, value types, and counts, but no key values, titles, bundle names, purchase identifiers, purchase dates, or other values.

   To diagnose why **Open purchase** cannot reach an individual order, **Inspect purchase navigation** examines only the already-rendered Purchases page and downloads `humble-purchase-navigation-discovery.json`. It does not make network requests or write to extension storage. The report has only aggregate tag names, attribute names, link shapes, and counts—never titles, URLs, purchase identifiers, redemption keys, dates, or text content.

   To diagnose a Humble product that was not recognized as Software, **Inspect Software product data** makes the same read-only requests and downloads `humble-software-product-discovery.json`. It includes direct-product and third-party-entitlement titles with their source bundle, category/type/platform values, file extensions, and non-secret top-level field names. It excludes redemption keys, purchase identifiers, purchase dates, URLs, cookies, and raw API responses; it does not write to extension storage.

   The key-reminder queue in **Extension options** groups pending entitlements by expiry state and shows their Humble bundle, purchase date, entitlement type, and reported expiry. With **Open direct Humble order links** off (the default), **Open purchase** uses Humble's normal purchase-card flow; allow popups and redirects for Humble if you want it to open the individual order. When you explicitly enable that option, **Open purchase** goes directly to Humble's individual order/download page in one tab. This places the purchase identifier in the Humble URL and browser history, but avoids the popup requirement. The extension never handles a redemption value. New imports check only newly discovered purchases plus purchases with an unresolved entitlement, so a newly revealed key disappears after the next refresh. If the extension has not completed a full reminder baseline, the list makes that clear; choose **Rescan every purchase** to check older purchases. The extension stores no redemption-key values.

5. Or use **Import titles** for a manual JSON title list. This replaces the library and clears purchase records, provenance, reminders, scan history, and custom mappings:

```json
[
  { "title": "Hellboy Omnibus Volume 1", "sourceBundle": "Hellboy Universe Bundle", "kind": "book" },
  { "title": "Forest Builder Pro", "sourceBundle": "Asset Bundle", "kind": "software" },
  "B.P.R.D. Plague of Frogs Vol. 1"
]
```

To recover an exported library, use the separate **Restore backup** control in Extension options. It replaces items (including all purchase provenance), purchase summaries, historical purchase evidence, key reminders, reminder scan state (including baseline and retry purchase identifiers), import/reconciliation history, media-import version, and custom mappings together. Restoring never merges reminders from the previous installation into the backup. Validation completes before storage changes; confirm the replacement when prompted.

New version-7 backups preserve all of this data across export/restore, including the separate history archive. Earlier versioned backups remain supported: any data absent from an older backup is reset to empty/default state, so older backups may require a full rescan to re-establish reminders or a media backfill. **Import titles** rejects exported backups to prevent accidentally discarding their purchase data. Manual title import and **Clear library** also clear the history archive. Browser preferences, the Galactic Library connection, and temporary purchase-navigation requests are not exported; preferences and the connection are preserved on restore, while any pending navigation request is cleared. Backups contain private purchase identifiers and should be kept private.

6. Visit a Humble URL beginning `https://www.humblebundle.com/books/`, `https://www.humblebundle.com/games/`, or `https://www.humblebundle.com/software/` and refresh.

### Pair with Galactic Library (optional)

1. Open Humble Comic Library settings and copy the displayed Humble Comic Library extension ID.
2. In Galactic Library, open **Humble Comic Library link**, paste that ID, and select **Allow extension**.
3. Copy Galactic Library's displayed extension ID from that same setting, paste it into Humble Comic Library's **Galactic Library link** setting, and select **Save link** then **Test link**.
4. Reload a Humble Books or Games bundle page, including audiobook listings under Books. Exact non-Humble matches appear as **Owned elsewhere** and are excluded from the confirmed-new price calculation. Temporary or unconfirmed access appears as **Check ownership**, not owned.

Audiobook detection uses explicit item metadata or format attributes, a trailing audiobook delivery label, or an unambiguously audiobook-labelled listing. Item metadata can distinguish ebooks within an audiobook listing. Mixed bundles are checked per item; ambiguous same-title formats without a local format signal do not establish ownership. Missing or malformed metadata falls back to the ordinary Books view unless another explicit audiobook signal is available. No extra permissions are needed; the same code is packaged for Chrome and Firefox.

## Browse bundles

- On an individual Books, Games, or Software bundle page, the lower-right summary reports ownership by tier and shows the lowest tier containing every confirmed-new item. **Show new items only** hides confirmed-owned cards while retaining partial and possible matches. Uncheck it at any time to restore the full view.
- On `https://www.humblebundle.com/bundles`, `/books`, `/games`, or `/software`, offers are sorted by their displayed time remaining. Use the lower-left **Catalogue filters** to hide purchased offers, limit the view to offers labelled seven days or fewer, or combine both filters. These choices persist only in the current browser profile.
- In **Extension options**, enable **Show bundle and catalogue diagnostics** only when troubleshooting. It adds timing and sorting information without changing ownership results, and reveals the two local purchase-metadata discovery reports for diagnostics.

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

## Create a release ZIP

Run one of the following from PowerShell at the repository root:

```powershell
# Chrome (default; unchanged package name and manifest)
.\scripts\package-release.ps1

# Firefox desktop package; adds Firefox-only metadata inside its ZIP manifest
.\scripts\package-release.ps1 -Target Firefox
```

The Chrome target creates `dist/Humble-Comic-Library-<version>.zip`; the Firefox target creates `dist/Humble-Comic-Library-<version>-firefox.zip`. Both use a fixed file order and timestamps, so identical source produces an identical ZIP and SHA-256 hash. The Firefox archive adds only its Gecko ID and AMO data-collection declaration to the generated `manifest.json`; shared runtime files are identical. Archives contain only extension runtime files and icons; they exclude Git history, backups, exports, reports, notes, and documentation. Upload the Chrome ZIP—not the project folder—to the Chrome Web Store. Submit the Firefox ZIP to AMO for signing only after manual Firefox testing.

Store screenshots are checked into [store-assets/](store-assets/) for review and versioning, but are intentionally excluded from the extension ZIP. Upload those images separately in the Chrome Web Store dashboard.

Record each published version in [CHANGELOG.md](CHANGELOG.md), and increase the numeric `version` in `manifest.json` before every subsequent Chrome Web Store or AMO upload.

## Roadmap

Add a review queue for conservative possible matches. Humble does not provide a stable public API, so the importer and tier-data reader are deliberately defensive and report unexpected responses instead of guessing.
