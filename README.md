# Humble Comic Library

A local-only browser extension that marks books or comics you already own while viewing a Humble Books bundle.

## What works now

- Load it unpacked in Chrome/Chromium browsers.
- Import DRM-free book and comic titles from your signed-in Humble Purchases page—without copying, reading, or saving a Humble cookie.
- Import a local JSON library of title strings or `{ "title", "sourceBundle" }` records as a fallback.
- See an `Owned`, `New`, `Partially owned`, or `Possible match` status for every detected item on Humble Books bundle pages. Listings such as `Vol. 1-3` are matched against individually owned volumes, and partial coverage is never treated as owned. Page-only labels such as `preview` are ignored during matching and omitted from the summary lists.
- See a bundle summary of owned/new items and a per-new-item price at detected tiers. Conservative near-matches are labelled `Possible match` and are never treated as owned.
- Download a plain-text tier title list from the summary panel when you want a quick, portable record of the current offer. It reads Humble's embedded tier data; if that data has not been hydrated into the page DOM, it retrieves the current Humble page only. It does not change your selected tier or click any page controls.
- Export or clear the browser-local library.

Nothing is sent anywhere except Humble. The extension has no network destination beyond Humble and never reads, stores, or asks you to paste a session cookie.

## Load it

1. In Chrome, open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this folder.
4. For a Humble import, open **Extension options**, select **Open Humble purchases importer**, and click **Import book & comic titles** on that page. Keep the page open until it completes.

   The importer requests Humble's purchase list and each purchase's detail record through the tab where you are already signed in. It extracts only item names that have a DRM-free book/comic download (PDF, EPUB, CBZ, CBR, or MOBI), then retains the title, purchase date when Humble supplies it, bundle name, and purchase key in browser-local extension storage. It also records each purchase separately with its paid price and a `pricePerItem` value (paid price divided by detected book/comic items). It does not store the response or any account session token. Re-importing is safe and can fill in additional metadata without duplicating titles.

5. Or use the manual JSON importer:

```json
[
  { "title": "Hellboy Omnibus Volume 1", "sourceBundle": "Hellboy Universe Bundle" },
  "B.P.R.D. Plague of Frogs Vol. 1"
]
```

6. Visit a Humble URL beginning `https://www.humblebundle.com/books/` and refresh.

## Next milestone

Add a review queue for conservative possible matches. Humble does not provide a stable public API, so the importer and tier-data reader are deliberately defensive and report unexpected responses instead of guessing.
