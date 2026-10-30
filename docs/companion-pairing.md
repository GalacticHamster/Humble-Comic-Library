# GalacticHamster companion pairing (2026-10-08)

Compatible official installations connect automatically. In Settings, check the named companion connection, then reload the bundle page. A failed check means the connection is not verified; it cannot establish that an extension is uninstalled. An affirmative unsupported API version means update both products. Older unversioned PING/GET_STATUS requests remain compatible with API 1; newer features require their advertised capabilities.

## Managed identities

| Product | Chrome Web Store listing ID | Existing Firefox Gecko ID |
| --- | --- | --- |
| Humble Library | bjjpfofmcmiipeghcbhdfjedpldmkcii | humble-comic-library@galactichamster.com |
| Galactic Library | pdknncacndkicpogbebdfanniibnnpic | galactic-library@galactichamster.com |
| Fanatical Library | ieoobffekgbfjfoiheejkfihneooiadb | fanatical-library@galactichamster.com |

Chrome values are the exact user-supplied store identities. Gecko values were already configured in the repository overlays and are preserved, not newly assigned AMO identities. Confirm ownership, signing and listing continuity for all three before Firefox publication. No new Firefox ID needs assignment unless an existing configured ID cannot be retained; resolve that separately before release. Firefox targets the declared add-on ID, never its moz-extension URL UUID. [Mozilla API reference](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage).

Unsigned Chrome packages loaded unpacked get development IDs unless their correct public manifest key is supplied. These builds do not invent a key or replace store IDs with the resulting unpacked IDs. Official-installed-ID Chrome auto-pairing still requires store-installed acceptance testing; synthetic sender tests verify exact official identities. Published HB is older and its exact binary was not supplied: retaining API 1 preserves compatible request/response formats but cannot change its old discovery or trust implementation remotely. It may still require manual pairing until upgraded. Do not infer compatibility solely from an appVersion label.

## Trust and protocol boundaries

Identity configuration is separate from operation authorization. HB and FAN automatically trust GL, plus an explicitly saved GL override; they expose only PING, GET_STATUS and versioned OPEN_REVIEW to that sender, with no incoming library export/import/storage endpoint. GL automatically trusts HB/FAN for PING, GET_STATUS, validated MATCH_ITEMS, bounded GET_REMINDERS, OPEN_REVIEW and diagnostic acknowledgements. Only HB's built-in identity can publish Humble entitlement feeds; FAN's built-in identity cannot. Explicit additional development IDs retain the prior API contract and its account-scoped feed validation. No automatic HB-to-FAN relationship is granted.

GL matches on the same authoritative committed snapshots and returns the existing safe DTOs: exact/possible/partial results, titles, opaque references, bounded identity/contents evidence and safe reminder pages. API keys, credentials, redemption keys, purchase identifiers/URLs, account labels, raw database and full library remain private. Explicit HB reminder publication retains its own-page sender guard, user confirmation, active-account snapshot verification, GL active Humble profile label, upload token/offset/count/schema checks, atomic commit and revocation rechecks. Discovery never publishes reminders or establishes ownership.

All three manifests previously omitted externally_connectable and still do. This retains extension-only transport without introducing wildcard declarations or webpage matches. Runtime authorization rejects unknown IDs before GL snapshot access; unsupported/unauthorized operations are rejected separately. Chrome's [documented manifest default](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable) admits extension transport and excludes web pages. A fixed official-only manifest list would break already paired arbitrary unpacked IDs, and settings cannot modify that list. Runtime allowlisting is the smallest compatible solution, with the existing limitation that unknown extensions can deliver a request to the authorization boundary. Firefox external messaging is tested separately; Chrome manifest policy is not treated as proof of Firefox support. No permission or host-permission expansion is needed.

## Additional IDs and upgrades

Advanced / Developer pairing shows built-in IDs read-only and keeps user additions separately. HB/FAN preserve galacticLibraryExtensionId; it is an outgoing override, and the official GL sender stays trusted alongside it. Removing the override restores automatic discovery. GL preserves galacticLibraryAllowedExternalClientIds as user-only configuration and computes a browser-specific union at request time. No migration writes defaults, deletes duplicate-official entries, or recasts stored values into another browser. Removing user entries never removes built-in trust. A saved ID for another browser is retained; use an applicable ID to connect there.

For development: load validated packages into a disposable profile, copy GL's actual ID from Advanced into the companion's override, and allow that companion's actual ID in GL Advanced. Authorizing a custom extension permits the supported data exchanges; authorize only a build you control. Check the connection. If a separately customized receiver manifest blocks the sender, update that development manifest explicitly or use the maintained builds; a stored allowlist cannot bypass a manifest restriction.

## Validation and rollout

All three repository suites and Chrome/Firefox package validation are required. HB's tests verify packaged shared identity constants; GL/FAN validate their generated runtime identity configuration and existing Gecko overlays. Tests verify official/manual coexistence, removal preserving built-ins, unknown sender/operation rejection, API compatibility, unavailable targets, and unchanged permissions. No personal profile, inventory or store account is used.

The installed Chrome FAN test loads all three packages and verifies actual custom pairing, GL-to-HB/FAN status, identical query results, HB-to-FAN rejection and revocation. HB's installed central test verifies actual reminder publication/removal. GL's installed Firefox companions test verifies automatic FAN/GL discovery and HB connection checks with stable IDs, automatic HB feed publication, software/Possible/Partial results, preserved ownership semantics, review navigation and built-in trust after removing duplicate manual entries. Main-world importer controls are fulfilled locally with synthetic purchases; they are not live-account certification.

Recommended release order: GL first, then upgraded HB, then FAN (or HB/FAN together after GL). The local release candidates now use 1.0.0. Distribution still requires separate authorization. Confirm configured Gecko identities/signing and test signed Firefox packages. Once draft Chrome listings are available, install all three through their actual listings in a disposable profile and verify zero-configuration connections, disable/re-enable, upgrade with preexisting custom settings, and old-HB fallback. These store-installed checks and the exact older published HB binary remain outstanding. No publication or developer-account changes are part of this task.

## Repository implementation

Identity and target helpers are centralized in shared.js. content.js, background.js, entitlement snapshot validation and settings resolve the same saved override or browser default.

## Completed verification

321 repository tests passed. Chrome and Firefox ZIPs passed deterministic/runtime/permission/official-ID assertions. The disposable HB Chrome central test passed 19 installed settings/account/writer checks plus reminder publication and removal. GL all-three Firefox messaging and Chrome custom-ID integration passed; exact Chrome store installations and the older published HB binary were not available for this run.
