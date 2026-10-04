# First-load lifecycle and presentation correction — 2026-10-03

The Advanced features already existed. This correction addresses initialization and refresh dependencies, and aligns the companion panels. Matching and the approved product decisions are unchanged. Phase 4 has not started.

## Reproduced causes

HB registered its storage listener after awaiting its initial storage read. A library restore/import completing during that read could be missed, leaving the page using the earlier snapshot. HB also watched cover additions and title changes but ignored provider JSON hydration and bibliographic attributes on already annotated cards. The resulting analysis could remain obsolete until another comparison or page reload.

FAN subscribed before startup, but UI dependency changes during an asynchronous read/GL check could be consumed by a timer while rendering was busy. Its stable-summary shortcut could also keep an old applicability result after fresh analysis. Ownership revision checks did not protect wishlist/diagnostic snapshots.

The new browser tests fail against the preceding content-script revisions at the corresponding startup/in-flight update checkpoints. Authenticated storefront automation is unavailable: these are reproduced implementation defects, not a recording of the exact signed-in page. In particular, a populated HB comparison already unconditionally adds planning; a stale library snapshot alone does not explain every section reportedly missing. The user's exact four-section symptom still needs the manual first-load check below.

## Fix

- HB subscribes before the first await and rereads snapshots invalidated by storage events, both at startup and during later hydration.
- HB observes relevant provider JSON, JSON text hydration, heading changes, and metadata attributes on bundle cards. Fingerprints and scoped mutation checks exclude extension UI and unrelated page activity.
- HB cancels obsolete ownership work, prevents an old summary callback from reviving previous ownership during hydration, and preserves open disclosures for same-account updates.
- FAN records pending work and validates UI snapshots separately from account/ownership revisions. A wishlist or diagnostic update retains valid in-flight GL results and triggers a fresh UI snapshot.
- FAN compares completed analysis against a summary fingerprint. A stable panel can remain visible during the await, but cannot freeze obsolete applicability. Unchanged analysis does not repeatedly rebuild the panel.
- Sections remain conditional; game bundles do not gain meaningless series coverage.

## Canonical presentation

Both companion panels and evidence inspectors use the same scoped component rules. Normal body text is Arial 14px/21px, weight 400, `#f2f2f2` on `#171717`. Headings are 16px/24px bold; disclosure headings and counts use bold body typography. Secondary text is `#c5cbd3`; explicit warnings use `#f4cc73`. Legend labels and panel controls use 12px/18px. Native select line-height reporting and checkbox appearance can vary by browser/OS.

Common paragraphs/disclosures use 8px spacing, lists use 20px indentation, planning goal selectors fill their available width, and buttons/inputs share dark backgrounds, readable borders, padding and focus outlines. Native disclosure arrows are protected. Ordinary Advanced sections have no horizontal separator, including FAN's former planning divider. General explanations no longer inherit HB's blanket amber paragraph rule. Purchase notices and covered/uncertain unit rows retain status treatment. The Possible legend background is darkened to meet small-text contrast requirements.

Identical browser presentation checks cover headings, counts, legends, disclosures, body/muted/warning text, controls, checkboxes, lists, selector width and contrast under hostile host CSS and a 27px root font. Body, muted, warning and every legend label exceed 4.5:1 contrast. Store-specific content and FAN's Pick & Mix controls remain intentional differences.

## Reproduce the automated checks

HB: `node tests/browser.mjs --lifecycle`, then repeat with `--game`, `--firefox`, and both. Also run `--lifecycle --warm` in each browser to start from a saved local snapshot. These start with empty library/mappings/link state and a gated stale storage snapshot; later card metadata, provider JSON, mappings and GL evidence arrive on the same page. They cover GL failure retaining local evidence and a warm cached comparison.

FAN: `node tests/browser-check.mjs --lifecycle --release`, then repeat with `--firefox`. Both book/comic and game routes run. They cover a gated stale initial read, local/central hydration, UI changes during GL and storage awaits, retained successful GL requests, failure, warm caches and conditional applicability.

Previous-source negative controls are available with `HCL_TEST_CONTENT_REF` or `FAN_TEST_CONTENT_REF` set to the preceding content-script commit. These replace only the content script in the fixture, without changing the working tree.

Existing full suites: run `node --test --test-concurrency=1 --test-reporter=spec tests` in each repo. Existing browser, release, refresh-loop and installed-runtime checks remain separate from that test count.

## Manual authenticated first-load verification

1. Keep the current local library and GL pairing. Do not clear storage or rescan purchases for this test.
2. Open `chrome://extensions` or `about:debugging#/runtime/this-firefox`. Reload the updated HB, FAN and the paired GL extension if it needs reloading.
3. Open a fresh signed-in tab for the same HB comic/book bundle that showed the issue. Navigate once; do not reload it again.
4. Let local/central checking settle, then expand Advanced. Confirm contents/overlap, planning, series and GL details appear where evidence makes them applicable. Check one known owned title and one known issue/volume count.
5. Keep Advanced open. Change a wish priority or toggle Diagnostics in extension settings. Confirm the existing page updates and applicable disclosures remain available without navigation.
6. Use Refresh central evidence; verify updated results settle and open disclosures survive. Then open the same bundle in a fresh tab for a warm comparison.
7. Repeat steps 3–6 for FAN. Compare common headings, body copy, controls, lists and spacing. Confirm there is no divider before planning.
8. Open a game bundle once in each store. Confirm useful applicable analysis remains available and comic series coverage is absent.
9. Temporarily disable the linked GL extension, open another fresh bundle tab, and let its check finish or time out. Confirm local owned/partial evidence remains, incomplete central checks are explicit, and missing central evidence does not invent gaps. Re-enable GL and use Retry/Refresh to recover.

Do this once in Chrome and once in Firefox. If the original four-section symptom persists, record the bundle URL, browser, Simple counts, displayed GL line and the visible Advanced headings before any second reload.


## Validation completed

| Check | HB | FAN |
|---|---|---|
| Full Node suite | 314/314 | 363/363 |
| Existing Chrome browser checks | 86 checks | All 10 release routes |
| Existing Firefox browser checks | 86 checks | All 10 release routes |
| New cold comic/book lifecycle + presentation | 31 checks per browser | 28 checks per browser |
| New game lifecycle + presentation | 25 checks per browser | 28 checks per browser |
| Warm bootstrap | 31 checks per browser | Warm cache covered in both new lifecycle routes |
| Refresh stability | 10 checks per browser | Two release routes with delayed GL, recovery and stability checks |
| Installed Chrome extension | 19 checks + 2 real GL integration checks | 14 checks, including native pagination/import/account tests |
| Installed Firefox extension | 19 checks | Release DOM checks above; native cross-extension transport was not changed |

No failures, skipped tests or cancellations in the full suites. HB cold and warm negative controls fail against `0a71dc6` at the missed storage and metadata checkpoints. FAN's new lifecycle controls fail against `4a79197` at the in-flight wishlist/diagnostic checkpoint. Those expected failures establish regression sensitivity and are not failures of the corrected code.
