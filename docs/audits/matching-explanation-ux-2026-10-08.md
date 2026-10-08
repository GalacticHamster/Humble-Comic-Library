# Matching explanation UX audit ? 2026-10-08

Phase A recorded before runtime edits. Inspected HB content/ownership, FAN content/shared, the GL companion-response contract, and production dialogs rendered with synthetic responses in disposable browsers. Before screenshots are under ignored audit-artifacts/matching-explanations (Chrome three widths; Firefox desktop/medium; narrow capture uses an iframe because Firefox limits native window width).

## Findings and intended fixes

- Default dialogs show one generic paragraph. For 30 Days of Night it focuses on the base purchase's uncertain access while hiding the same-title Kindle subscription. Add separate candidate cards and the existing status; never merge candidate ownership.
- Technical details already default closed, but review/retry actions are hidden inside them. Retain existing redacted evidence under Match details, expose existing actions separately.
- HB tooltips contain the entire evidence log; FAN exposes raw matcher reasons. Replace with concise status, provider/access and review guidance.
- Possible/Partial captions show only a first title with no provider/access. Add compact context and remaining-candidate count, keeping all candidates available in the dialog.
- Distinguish permanent/temporary access, related editions, historical records, key purchases, manual titles, user-assumed ownership and stale observations. Contents verifiedAt is not ownership verification.
- Preserve summaries' offered-item counts, pricing, Advanced organization and series-gap scope caveats. Clarify New/Partial/Possible, and software component overlap without claiming whole-suite ownership.
- Shared presentation is duplicated; dialogs/tooltips differ. Keep equivalent adapters, scoped CSS, native disclosure and focus restoration. Preserve host-specific card borders and badges.

## Available evidence and limits

GL exposes provider, title, effective access/ownership, relationship, bibliographic/source evidence and contents dates. It does not expose account nicknames, raw provider IDs, bundle provenance or acquisition dates. Show local context only if supplied; do not invent central accounts or add APIs. Absent metadata is not an ownership failure. Keep raw dates/bases in the existing disclosure and preserve redaction. Matching, ownership, API, storage, prices and account boundaries remain unchanged.

## Baseline UI checks

Chrome dialogs pass wrapping, collapsed disclosure and focus restoration at 1400/800/390. Both show zero candidate cards. Existing storefront checks expose pre-existing fixture races: HB/FAN no-applicable-analysis Advanced assertion, FAN removing-GL-link ownership assertion. Capture these baselines; improve test waits if demonstrated, without changing production lifecycle in this task.

## Implemented presentation

The existing primary classification precedes one short conclusion and compact candidate cards. Provider/access, available local nickname, edition/contents uncertainty and readable local purchase context are visible. The same-title subscription and related purchased base edition remain separate. Possible/Partial card captions show provider/access and additional-candidate count; concise tooltips replace diagnostic logs. Existing Review and Refresh actions are outside the collapsed Match details disclosure. Existing technical evidence/redaction remains intact.

Default uncertainty describes actual known ISBN, language, author, numbered-scope or revision differences. Missing fields alone add no universal warning. Subscription/borrowed/rental/unknown, historical records, manual ownership, key activation and user-assumed ownership retain separate descriptions. Contents verification dates never become ownership confirmation. Software components are labeled as listed components; Partial does not claim complete edition/suite ownership.

Summary counts, colors, partial fractions, new-item pricing, wishlist/planning and Advanced structure are preserved. Summary help defines Possible/Partial/New, and series-gap prose explains compared scope in ordinary language. No production matching, ownership, API, schema, storage, import, permissions, trust or GL changes. No new automatic requests.

## Validation

- Full unit suite: 338 passed, zero failures; final wording also passes focused presentation tests (25 including existing parity tests).
- Before/after shipped matcher comparison against 9cb6d3f: 14 identical complete result objects, unchanged supplied evidence/history; HB counts/tier values also identical. Cases: exact local/external ownership, New, incomplete lookup, 30 Days multi-candidate, game edition, software version, Partial, all temporary/unknown access types, ISBN conflict and historical purchase.
- Chrome and Firefox production-dialog checks at 1400/800/390 CSS pixels: collapsed/expanded disclosure, nine additional outcome variants at each width, long text wrapping/no horizontal overflow, Space disclosure, Escape close and trigger focus restoration. Render-only actions leave result JSON and mock storage unchanged. Firefox uses a same-origin fixed-width iframe to get a genuine 390-pixel viewport despite its minimum native window width.
- Existing storefront checks: HB 86 checks per browser; FAN ten routes per browser, covering standard/pick-and-mix, Advanced, edition/software component evidence, contents, wishlist, diagnostics and host badge borders.
- Chrome/Firefox packaging: HB 17 allowlisted runtime assets; FAN 14. No new runtime files or manifest changes.

The baseline storefront failures were outdated fixture assumptions after automatic official GL pairing, not new production regressions: an empty custom ID no longer disables GL. The HB isolated local-only/empty-analysis fixture now supplies an explicitly disabled lookup; FAN uses a successful empty central response for its local-only assertion and expects collapsed automatic GL details on an empty bundle. An audiobook tooltip assertion follows the new readable wording. Production lifecycle and pairing were not edited.

## Rendered examples

Screenshots and rendered JSON are disposable local audit outputs, not shipped assets.

| Example | Before | After |
| --- | --- | --- |
| Chrome medium | [Collapsed](../../audit-artifacts/matching-explanations/before-chrome-800-collapsed.png) | [Collapsed](../../audit-artifacts/matching-explanations/after-chrome-800-collapsed.png) |
| Chrome narrow | [Collapsed](../../audit-artifacts/matching-explanations/before-chrome-390-collapsed.png) | [Collapsed](../../audit-artifacts/matching-explanations/after-chrome-390-collapsed.png) |
| Firefox narrow | [Collapsed](../../audit-artifacts/matching-explanations/before-firefox-390-collapsed.png) | [Collapsed](../../audit-artifacts/matching-explanations/after-firefox-390-collapsed.png) |
| Chrome full evidence | [Expanded](../../audit-artifacts/matching-explanations/before-chrome-800-expanded.png) | [Expanded](../../audit-artifacts/matching-explanations/after-chrome-800-expanded.png) |

Both browser sets also include desktop (1400) and all expanded widths. The dialog harness runs production functions; FAN exposes its private function only in the test-served script, without changing shipped source. Storefront suites independently exercise real badge clicks, summaries and host CSS using synthetic local pages. These are not signed-in live storefront acceptance tests.

## Reproduction

Run node --test --test-concurrency=1 tests, node tests/match-explanation-browser.mjs (also --firefox), and node tests/before-after-match-check.mjs 9cb6d3f. Existing storefront commands are node tests/browser.mjs in HB and node tests/browser-check.mjs in FAN (also --firefox). Screenshot filenames use before/after; --before is for capturing unmodified source, not for reconstructing it after changes.

## Limits

Central account nicknames and bundle/acquisition context cannot be displayed because the current GL contract does not supply them. Distinct central records/access types still remain distinct cards. Local profile labels appear when present on records/wrappers; current active nicknames are not fabricated on historical or central evidence. Source IDs/URLs/keys remain subject to existing redaction; no additional private fields are exposed. Unknown relationships receive review guidance rather than a newly inferred equivalence. More purchase provenance remains available in Match details. Native language/date formatting follows the user's browser locale/timezone.

## Files

Runtime: ownership.js, content.js, content.css. Tests: match-presentation.test.mjs, match-explanation-browser.mjs, before-after-match-check.mjs, the shared matching fixture source-loader hook, and storefront fixture assertions; FAN adds a local browser-protocol helper. This audit and .gitignore keep disposable captures separate from runtime/package files.
