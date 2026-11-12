# Humble Next.js purchase-import evidence

Status: authenticated discovery is verified; production replacement remains blocked on purchase-to-entitlement identity mapping. This note concerns Humble's November 2026 redesign. It does not enable imports or authorize historical reconciliation.

Implementation follow-up: a separate [Library entitlement pilot](../development/library-entitlement-pilot.md) now implements bounded additive observations, plus a user-started resumable Library sync built from the same bounded checks, behind a disabled source-level flag. It does not resolve the order/legacy bridge or enable the purchase importer. See the pilot document for strict admission, media-classification and activation limits; the evidence below remains the historical investigation.

## Verified read paths

The authenticated browser can read `GET /home/purchases?page=N` with `RSC: 1` and `Accept: text/x-component`, using its ordinary same-origin session. The inspected frontend exports `OrderHistory`; its `data` contains `results` and `pagination` with `page`, `totalPages` and `totalDocs`. Distinct reported pages were independently read and checked. These describe accessible migrated orders, not independently verified complete historical coverage.

The frontend navigates to `/home/purchases/<order.id>`. Its `LineItems` component receives order lines, not an independently resolved list of individual bundle contents.

The authenticated `/home/library` response supplies `UserLibrary.bundleItems`. The frontend's bundle links use `productEntitlementId`, falling back to the Library row ID. `/home/library/<id>` supplies `ProductKeysDownloads.userLibraryItem`, including actual titled entitlements. A sampled DRM-free bundle detail provided individual download entitlements. No key-reveal, redeem, signed-URL preparation, bulk-download or download-recording action was invoked.

The legacy `/api/v1/user/order?all=true` returned HTTP 404 even in an authenticated session. Merely removing the redesign guard cannot restore the legacy acquisition path.

## Structured API versus Flight

The inspected public Library client uses the Next server action `filterUserLibrary`. Its input includes page, cursor, limit, sorting and filters; its output includes results and pagination. Its current UI limit is not an order-history page-size guarantee. The action's build-specific identifier is not a stable public API.

No separate browser-callable structured order/product-resolution API was established from the observed requests and client code. This does not prove that no such backend API exists. Server-only implementation is not visible in client assets. Do not invoke unrelated cart, redemption or download actions as substitutes.

Flight parsing must account for byte-length-delimited `T` records containing newlines and UTF-8 characters. Splitting the entire response into newline-delimited JSON misses subsequent records. Client-module names and ordinary string fields may use model references. A future reader must remain bounded and non-executing, resolve only the necessary supported fields, reject unsupported/truncated/cyclic references, and recognize the exact expected component rather than scrape arbitrary arrays. The investigation's format probes are not a shipped Flight decoder.

## Account and date evidence

Observed order custom fields include `oryIdentityId`, `userHubUserId`, `legacyOrderId`, `legacyCreatedAt` and `sourceSystem`. The signed-in `AuthProvider.user.id` and Library row `userId` provide candidate independent scope observations; equality was checked in browser memory without exporting their values. These provider identities must not be replaced by a local profile nickname or inferred from email/display-name similarity.

The OrderHistory frontend prioritizes `legacyCreatedAt` for migrated orders, then completion/creation metadata. A replacement must not overwrite a known acquisition date with a migration completion timestamp.

The UI prioritizes recognized `state.obj.key` statuses, including completed, processing, refund and dispute states, before its broader order/payment fallback. A visible Complete badge alone is not an adequate universal ownership rule. Preserve existing gift, key, subscription and refund distinctions; do not infer destination activation from a Humble purchase.

## Unresolved identity bridge

The observed order's `bundleItemKeys` did not equal the individual download entitlement IDs. Sampled order IDs, order numbers, legacy order IDs, line-item IDs, product IDs/keys and SKUs also did not directly equal the Library bundle IDs, product entitlement IDs or placeholder entitlement IDs.

Matching counts or readable/similar titles do not establish the missing relationship. Do not join by array position, bundle title, current public offer contents or invented transformations of opaque identifiers. A useful next fact is an explicit order/line-item to Library entitlement mapping, or an authoritative legacy purchase/product alias. The Library may prove an entitlement exists while still lacking the purchase provenance and old identity needed by the current importer.

Shipping a Library-only access collector with unrelated identifiers would be a separate design decision: it cannot silently stand in for preserved purchase history, acquisition dates and manual-correction identity.

## Existing integration boundaries

- [`content.js`](../../content.js), `importPurchases`: redesign guard runs before account/scan admission; legacy purchase keys use `gamekey`, `key` or `order_key`.
- `fetchOrderDetail`: same-origin legacy detail request and secret-value redaction.
- `extractLibraryItems`, `extractThirdPartyKeyItems`: purchase-specific product and key identities; direct-download and third-party-key evidence are separate.
- `mergeLibraryItem`, `refreshImportedClassifications`, `createPurchaseSummary`: preserve provenance, identity-bound corrections and purchase dates.
- [`background.js`](../../background.js): validates request origin and binds scan operations to the sender tab.
- [`shared.js`](../../shared.js), `createSyncStore`: scan-token/account guards, backup validation and atomic commits.

A clean acquisition with migration-limited coverage is not currently represented by the incomplete-Full writer contract: that path requires actual failed purchase keys. Any replacement needs an explicit, validated coverage-unverified outcome without fabricating failed IDs, disguising Full as Quick, or weakening preservation checks.

During migration, all acquisition must be additive. Missing orders cannot delete, archive or downgrade prior purchase evidence, even after every accessible page has been traversed. Account uncertainty must abort admission rather than become partial success. Retry authority must attach only to individually validated records in the correct scope.

## Validation and next implementation gate

Existing preservation tests cover the redesign safety stop, account separation, transactional partial imports, retry recovery, corrections/history and large payloads. Chrome/Firefox importer and redesigned-page browser fixtures remain green. Local synthetic format probes additionally exercise byte-length text framing, multiple pages, mixed line types, malformed/truncated data, account changes and the insufficiency of equal counts as identity evidence. These probes do not validate a new production importer or real account-switch behavior.

Before replacing the guard, establish and independently test the identity bridge, eligible product/status rules and legacy aliases; then exercise acquisition through the actual guarded worker, reload/retry, partial failures and storage rejection in disposable Chrome and Firefox profiles. Complete traversal and destructive reconciliation authority must remain distinct. No production source, matching rules, permissions, versions or release artifacts were changed by this investigation.
