# Humble Comic Library

A local-only browser extension that marks books or comics you already own while viewing a Humble Books bundle.

## What works now

- Load it unpacked in Chrome/Chromium browsers.
- Import DRM-free book and comic titles from your signed-in Humble Purchases page—without copying, reading, or saving a Humble cookie.
- Import a local JSON library of title strings or `{ "title", "sourceBundle" }` records as a fallback.
- See exact normalized-title matches as `Owned` badges on Humble Books bundle pages. Page-only labels such as `preview` are ignored during matching.
- See a bundle summary of owned/new items and a per-new-item price at detected tiers. Conservative near-matches are labelled `Possible match` and are never treated as owned.
- Download a small page-detection report from the summary panel when an unfamiliar Humble layout needs adjustment. The report contains only the current page URL, detected titles, tiers, and CSS tag/class information.
- Export or clear the browser-local library.

Nothing is sent anywhere except the Humble page already open in your browser. The extension has no network destination beyond Humble and never reads, stores, or asks you to paste a session cookie.

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

Improve title matching beyond exact normalized matches, then add a review queue for potential matches. Humble does not provide a stable public API, so the importer is deliberately defensive and reports unexpected responses instead of guessing.
