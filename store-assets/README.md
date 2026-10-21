# Chrome Web Store assets

The five screenshots in `screenshots/` are 1280x800 images ready for the
Chrome Web Store listing:

- `00-humble-library-promo.jpg` — the bundle summary picture with humble 
  library banner.
- `01-bundle-summary.jpg` — ownership labels, tier value, new-items filter,
  and buy recommendation.
- `02-catalogue-filters.jpg` — catalogue sorting, purchase labels, and
  catalogue filters.
- `03-purchases-importer.png` — on-demand purchase importer; purchase rows
  are privacy-blurred.
- `04-options.jpg` — local-library settings, collection mappings, and
  diagnostics.

`promo/small-promo-tile-440x280.jpg` is the required 440x280 small promo tile.
It is a faithful crop-and-scale of `promo/humble-library-promo.jpg`.

These are listing assets, not extension runtime files. Upload them separately
in the Chrome Web Store dashboard; `scripts/package-release.ps1` deliberately
excludes this directory from the extension ZIP.
