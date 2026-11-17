import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {uuid, ACCOUNT, nativeObservation, entitlements} from './library-browser-fixture.mjs';

// Synthetic purchases only. Humble Library purchases (native observations) reach bundle pages,
// purchase counts and catalogue markers through the Options presentation model, without storage writes.
const plain = v => JSON.parse(JSON.stringify(v));
const readSource = file => process.env.HCL_TEST_SOURCE_DIR ? fs.readFileSync(process.env.HCL_TEST_SOURCE_DIR + '/' + file, 'utf8') : fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
function page(documentTitle = 'Synthetic page | Humble Bundle') {
  const context = vm.createContext({URL, Blob, Promise, Intl, Date, TextEncoder, TextDecoder, crypto: webcrypto, setTimeout, clearTimeout, console, performance: {now: () => 0},
    document: {title: documentTitle, querySelector: () => null, querySelectorAll: () => []}, location: {pathname: '/'}});
  context.globalThis = context;
  for (const file of ['library-entitlements.js', 'library-browser.js', 'shared.js', 'collection-mappings.js', 'ownership.js', 'content.js'].filter(file => fs.existsSync(new URL('../' + file, import.meta.url))))
    vm.runInContext(readSource(file), context, {filename: file});
  // Galactic Library answers with no other-store ownership, so only Humble purchases are under test.
  context.chrome = {runtime: {sendMessage: async (_id, message) => message.type === 'PING' ? {ok: true, apiVersion: 1}
    : message.type === 'GET_STATUS' ? {ok: true, apiVersion: 1, capabilities: {mediaTypes: ['game', 'book', 'audiobook', 'software']}}
      : {ok: true, apiVersion: 1, results: message.items.map(({requestId}) => ({requestId, matches: []}))}}};
  vm.runInContext("sortBundleItems = () => ({}); annotateAllCoverCopies = () => {}; applyBundleNewItemsOnlyFilter = () => {}; showComparisonProgress = () => {};" +
    "renderComparisonSummary = () => {}; comparison = { job: 1, galactic: createGalacticLookup('') };", context);
  return {
    context,
    model: state => vm.runInContext('typeof libraryPurchaseModel === "function" ? libraryPurchaseModel(state) : { purchases: state.purchaseSummaries }', Object.assign(context, {state})),
    async check(state, kind, titles) {
      context.state = state; context.kind = kind;
      context.offers = titles.map(title => ({title, lookupTitle: title, kind, tier: {label: '$5 tier', price: 5}}));
      vm.runInContext('collectBundleItems = () => offers', context);
      await vm.runInContext(`renderBundleComparison(createBundleLibraryMatcher(entitlementMatchingRecords(state).filter(item => kind === 'book' ? !item.kind || ['book', 'comic', 'audiobook'].includes(item.kind) : item.kind === kind), kind, []), kind, [], [], comparison, 1)`, context);
      return Object.fromEntries(context.comparison.resolvedItems.map(({item, match}) => {
        const total = typeof context.matchPurchaseTotal === 'function' ? context.matchPurchaseTotal(match) : {count: context.matchPurchaseCount(match), exact: true};
        return [item.title, {state: match.state, status: context.HumbleOwnership.presentation.status(item, match), count: total.count, exact: total.exact}];
      }));
    }
  };
}
const E = page().context.HumbleLibraryEntitlements;
// An imported order: its summary and one record per title, as the original importer saved them.
function order(key, name, titles, kind = 'comic', purchasedAt = '2024-03-01T00:00:00.000Z') {
  return {summary: {purchaseKey: key, sourceBundle: name, purchasedAt, itemCount: titles.length, pricePaid: 10, currency: 'USD', pricePerItem: 10 / titles.length},
    items: titles.map(title => ({title, kind, source: 'humble', purchaseKey: key, sourceBundle: name, purchasedAt}))};
}
// Imported items keep one record per title with every order in its provenance.
function imported(...orders) {
  const byTitle = new Map();
  for (const o of orders) for (const item of o.items) {
    const existing = byTitle.get(item.title);
    if (existing) existing.provenance.push({purchaseKey: item.purchaseKey, sourceBundle: item.sourceBundle, purchasedAt: item.purchasedAt});
    else byTitle.set(item.title, {...item, provenance: [{purchaseKey: item.purchaseKey, sourceBundle: item.sourceBundle, purchasedAt: item.purchasedAt}]});
  }
  return {libraryItems: [...byTitle.values()], purchaseSummaries: orders.map(o => o.summary)};
}
let nextId = 1;
// One Humble Library purchase (parent) with its DRM-free entitlements, or keys for games.
const purchase = (parent, parentTitle, titles, namespace = 'download_drm_free') => titles.map(title => nativeObservation(E, {id: nextId++, parent, title, parentTitle, namespace}));
const state = (base, observations, account = ACCOUNT) => ({humbleAccountId: ACCOUNT, humbleProfileLabel: 'Main', historicalLibraryItems: [], ...base, libraryEntitlements: entitlements(observations, account)});

const OLD = 'Escape Ordinary with Synthetic Comics', NEW = 'Humble Comic Bundle: The Synthetic Horror Bundle by Synthetic Comics';
const oldTitles = ['Synthetic Remains: The Complete Series', 'Synthetic Barbarian Vol. 1', 'Synthetic Plot Vol. 1', 'Synthetic Shadows Vol. 1'];

test('a second purchase of an already imported title counts as a second Humble purchase', async () => {
  const before = imported(order('order-old', OLD, oldTitles));
  // The earlier order is also in the Humble Library (its native purchase), plus the new bundle.
  const observations = [...purchase(1, OLD, oldTitles), ...purchase(2, NEW, ['Synthetic Barbarian Vol. 1', 'Synthetic Plot Vol. 1', 'Synthetic Remains: The Complete Series', 'Synthetic Newcomer'])];
  const results = await page(NEW + ' | Humble Bundle').check(state(before, observations), 'book', ['Synthetic Barbarian Vol. 1', 'Synthetic Shadows Vol. 1', 'Synthetic Newcomer']);
  assert.deepEqual(results['Synthetic Barbarian Vol. 1'], {state: 'owned', status: 'Owned', count: 2, exact: true}, 'imported order + new Library purchase');
  assert.deepEqual(results['Synthetic Shadows Vol. 1'], {state: 'owned', status: 'Owned', count: 1, exact: true}, 'the old order and its own Library record are one purchase');
  assert.deepEqual(results['Synthetic Newcomer'], {state: 'owned', status: 'Owned', count: 1, exact: true}, 'a first-time Library purchase');
});

test('genuinely separate purchases of one title count separately, and one purchase is never doubled', async () => {
  const a = order('order-a', 'Synthetic Saga Bundle', ['Synthetic Saga', 'Synthetic Saga 2', 'Synthetic Saga 3']);
  const b = order('order-b', 'Synthetic Story Bundle', ['Synthetic Saga', 'Synthetic Tale', 'Synthetic Fable']);
  const observations = [...purchase(10, 'Synthetic Saga Bundle', ['Synthetic Saga', 'Synthetic Saga 2', 'Synthetic Saga 3']), ...purchase(11, 'Synthetic Story Bundle', ['Synthetic Saga', 'Synthetic Tale', 'Synthetic Fable'])];
  const results = await page().check(state(imported(a, b), observations), 'book', ['Synthetic Saga', 'Synthetic Tale']);
  assert.deepEqual(results['Synthetic Saga'], {state: 'owned', status: 'Owned', count: 2, exact: true});
  assert.deepEqual(results['Synthetic Tale'], {state: 'owned', status: 'Owned', count: 1, exact: true});
  // The same two purchases without any Library sync: unchanged.
  const importedOnly = await page().check(state(imported(a, b), []), 'book', ['Synthetic Saga', 'Synthetic Tale']);
  assert.deepEqual(plain(importedOnly), plain(results));
});

test('a Library-only install counts each Library purchase of a title', async () => {
  // Without imported records, media comes from the purchase name (no download formats in this fixture).
  const observations = [...purchase(20, 'Humble Book Bundle: Synthetic First', ['Synthetic Solo', 'Synthetic Other']), ...purchase(21, 'Humble Book Bundle: Synthetic Second', ['Synthetic Solo', 'Synthetic Third'])];
  const results = await page().check(state({libraryItems: [], purchaseSummaries: []}, observations), 'book', ['Synthetic Solo', 'Synthetic Other']);
  assert.deepEqual(results['Synthetic Solo'], {state: 'owned', status: 'Owned', count: 2, exact: true});
  assert.deepEqual(results['Synthetic Other'], {state: 'owned', status: 'Owned', count: 1, exact: true});
});

test('Humble key purchases count as Humble purchases; other stores never add to the count', async () => {
  const games = order('order-g1', 'Synthetic Cyber Bundle', ['Synthetic Runner', 'Synthetic Blade', 'Synthetic Neon'], 'game');
  const relief = order('order-g2', 'Synthetic Relief Bundle', ['Synthetic Runner', 'Synthetic Aid', 'Synthetic Help'], 'game');
  const observations = [...purchase(30, 'Synthetic Cyber Bundle', ['Synthetic Runner', 'Synthetic Blade', 'Synthetic Neon'], 'steam'), ...purchase(31, 'Synthetic Relief Bundle', ['Synthetic Runner', 'Synthetic Aid', 'Synthetic Help'], 'steam'),
    ...purchase(32, 'Synthetic Award Bundle', ['Synthetic Runner 2', 'Synthetic Prize'], 'steam')];
  const results = await page().check(state(imported(games, relief), observations), 'game', ['Synthetic Runner', 'Synthetic Runner 2']);
  assert.deepEqual(results['Synthetic Runner'], {state: 'owned', status: 'Purchased', count: 2, exact: true}, 'two Humble purchases; Steam activation stays unknown');
  assert.deepEqual(results['Synthetic Runner 2'], {state: 'owned', status: 'Purchased', count: 1, exact: true}, 'a sequel is not the first game');
});

test('a bundle-card title missing the Library subtitle is owned only through a purchase of this exact bundle', async () => {
  const before = imported(order('order-old', OLD, oldTitles));
  const oldOnly = purchase(40, OLD, oldTitles);
  // Not yet bought: the subtitle difference stays Possible.
  const unbought = await page(NEW + ' | Humble Bundle').check(state(before, oldOnly), 'book', ['Synthetic Remains']);
  assert.equal(unbought['Synthetic Remains'].state, 'possible');
  const bought = [...oldOnly, ...purchase(41, NEW, ['Synthetic Remains: The Complete Series', 'Synthetic Newcomer'])];
  const results = await page(NEW + ' | Humble Bundle').check(state(before, bought), 'book', ['Synthetic Remains', 'Synthetic Newcomer']);
  assert.deepEqual(results['Synthetic Remains'], {state: 'owned', status: 'Owned', count: 2, exact: true});
  // The same purchase seen from another bundle's page proves nothing about that page's card.
  const elsewhere = await page('Humble Comic Bundle: Another Synthetic Bundle | Humble Bundle').check(state(before, bought), 'book', ['Synthetic Remains']);
  assert.equal(elsewhere['Synthetic Remains'].state, 'possible');
});

test('the same-bundle subtitle rule stays Possible when the card is ambiguous', async () => {
  const two = purchase(50, NEW, ['Synthetic Night: The Complete Series', 'Synthetic Night: Year One']);
  const ambiguous = await page(NEW + ' | Humble Bundle').check(state({libraryItems: [], purchaseSummaries: []}, two), 'book', ['Synthetic Night']);
  assert.notEqual(ambiguous['Synthetic Night'].state, 'owned', 'two of this bundle\'s entitlements extend the card title');
  // A lower-tier purchase holding "Synthetic Day: Year One" says nothing about another card "Synthetic Day".
  const tiered = purchase(51, NEW, ['Synthetic Day: Year One']);
  const results = await page(NEW + ' | Humble Bundle').check(state({libraryItems: [], purchaseSummaries: []}, tiered), 'book', ['Synthetic Day', 'Synthetic Day: Year One']);
  assert.notEqual(results['Synthetic Day'].state, 'owned', 'the entitlement belongs to the other card');
  assert.equal(results['Synthetic Day: Year One'].state, 'owned');
});

test('catalogue and bundle markers include new Library purchases once, without dates', async () => {
  const before = imported(order('order-old', OLD, oldTitles));
  const observations = [...purchase(60, OLD, oldTitles), ...purchase(61, NEW, ['Synthetic Newcomer', 'Synthetic Barbarian Vol. 1'])];
  const p = page(NEW + ' | Humble Bundle'), s = state(before, observations);
  const purchases = p.model(s).purchases;
  assert.deepEqual(plain(purchases.map(x => [x.sourceBundle, x.purchasedAt ?? null, Boolean(x.libraryPurchase)])), [[OLD, '2024-03-01T00:00:00.000Z', false], [NEW, null, true]], 'the old order once; the new purchase without a date');
  p.context.purchases = purchases;
  assert.deepEqual(plain(vm.runInContext('findCurrentBundlePurchases(purchases).map(x => x.sourceBundle)', p.context)), [NEW]);
  assert.match(vm.runInContext('formatBundlePurchase(purchases[1])', p.context), /Humble lists no purchase date/u);
  // Another account's Library purchases are never used.
  const foreign = state(before, observations, '22222222-2222-4222-8222-222222222222');
  assert.deepEqual(plain(p.model(foreign).purchases.map(x => x.sourceBundle)), [OLD]);
  const isolated = await p.check(foreign, 'book', ['Synthetic Newcomer', 'Synthetic Barbarian Vol. 1']);
  assert.equal(isolated['Synthetic Newcomer'].state, 'new');
  assert.equal(isolated['Synthetic Barbarian Vol. 1'].count, 1);
});

test('reading purchases for bundle pages and catalogues leaves saved data unchanged', async () => {
  const before = imported(order('order-old', OLD, oldTitles));
  const s = state(before, [...purchase(70, OLD, oldTitles), ...purchase(71, NEW, ['Synthetic Newcomer'])]);
  const snapshot = plain(s), p = page(NEW + ' | Humble Bundle');
  p.model(s);
  await p.check(s, 'book', ['Synthetic Remains', 'Synthetic Newcomer', 'Synthetic Barbarian Vol. 1']);
  assert.deepEqual(plain(s), snapshot);
});
