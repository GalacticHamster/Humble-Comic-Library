# Humble Comic Library

An unofficial browser extension that marks books, comics, or games you already own while viewing a Humble Bundle listing. It is not affiliated with or endorsed by Humble Bundle.

## What works now

- Load it unpacked in Chrome/Chromium browsers.
- Import DRM-free book and comic titles plus detected game entitlements from your signed-in Humble Purchases page—without copying, reading, or saving a Humble cookie.
- Import a local JSON library of title strings or `{ "title", "sourceBundle" }` records as a fallback.
- See an `Owned`, `New`, `Partially owned`, or `Possible match` status for every detected item on Humble Books and Games bundle pages. Books and games are kept separate. Listings such as `Vol. 1-3` are matched against individually owned volumes, and partial coverage is never treated as owned. Numbered presentations, game edition variants, and games named within an owned collection can be labelled Possible, but are never automatically treated as owned. Page-only labels such as `preview` are ignored during matching and omitted from the summary lists.
- See a bundle summary of owned/new items and a per-new-item price at detected tiers. Conservative near-matches are labelled `Possible match` and are never treated as owned.
- Hover an `Owned`, `Partially owned`, or `Possible` item badge to see the matching library title(s), Humble bundle, purchase date when available, and—for possible matches—why it was suggested.
- Download a plain-text tier title list from the summary panel when you want a quick, portable record of the current offer. It reads Humble's embedded tier data; if that data has not been hydrated into the page DOM, it retrieves the current Humble page only. It does not change your selected tier or click any page controls.
- Export or clear all browser-local library titles, purchase summaries, and import history.

Nothing is sent anywhere except Humble. The extension has no network destination beyond Humble and never reads, stores, or asks you to paste a session cookie. It does store titles, bundle names, purchase dates, purchase identifiers, prices when supplied by Humble, and provenance locally in Chrome until you clear or export them. See [the privacy policy](PRIVACY.md) for the complete disclosure. Before a Chrome Web Store release, publish that policy at a public HTTPS URL and enter the URL in the Store's Privacy field.

The extension runs only on Humble Books, Games, and Purchases pages. Its only named Chrome API permission is local storage, and it does not request access to every website or every Humble page.

## Load it

1. In Chrome, open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this folder.
4. For a Humble import, open **Extension options**, select **Open Humble purchases importer**, and click **Import new purchases** on that page. It fetches Humble's order list, skips orders already imported successfully in this browser, and only retrieves details for new or previously failed orders. Use **Rescan every purchase** only when you need to rebuild the full Humble library. Keep the page open until it completes.

   The importer requests Humble's purchase list and only the necessary purchase-detail records through the tab where you are already signed in. It retains DRM-free book/comic downloads (PDF, EPUB, CBZ, CBR, or MOBI) and the names of Humble's third-party game entitlements. Redemption-key values are redacted before the response is parsed and are never stored, exported, or logged. Books and games are stored separately, together with their title, purchase date when Humble supplies it, bundle name, and purchase key. It also records each purchase separately with its paid price and a `pricePerItem` value. A full rescan rebuilds Humble-sourced game entitlements and records every purchase origin for duplicate titles; incremental imports add only newly discovered purchases. It does not store the response or any account session token.

5. Or use the manual JSON importer:

```json
[
  { "title": "Hellboy Omnibus Volume 1", "sourceBundle": "Hellboy Universe Bundle" },
  "B.P.R.D. Plague of Frogs Vol. 1"
]
```

6. Visit a Humble URL beginning `https://www.humblebundle.com/books/` or `https://www.humblebundle.com/games/` and refresh.

## Create a release ZIP

Run the following from PowerShell at the repository root:

```powershell
.\scripts\package-release.ps1
```

It creates `dist/Humble-Comic-Library-<version>.zip` with a fixed file order and timestamps, so identical source produces an identical ZIP and SHA-256 hash. The ZIP contains only the extension runtime files and icons; it excludes Git history, backups, exports, reports, notes, and documentation. Upload that ZIP—not the project folder—to the Chrome Web Store.

## Roadmap

Add a review queue for conservative possible matches. Humble does not provide a stable public API, so the importer and tier-data reader are deliberately defensive and report unexpected responses instead of guessing.
