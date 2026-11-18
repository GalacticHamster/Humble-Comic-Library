import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fixture, row, child, copy, frames} from './library-entitlements-fixture.mjs';
import {load, uuid, nativeObservation, entitlements, ACCOUNT} from './library-browser-fixture.mjs';

// Synthetic Order History only: invented orders, names, IDs and times shaped like Humble's redesigned pages.
const SCOPE = {principalId: 'principal-A', userId: 'hub-A'};
const order = (id, lines, {created = '2026-11-17T03:45:00.000Z', legacy = null, completed = null, source = null, state = 'Complete', payment = 'Paid', ory = 'principal-A', hub = 'hub-A'} = {}) => ({
  id, orderNumber: 'N-' + id, createdAt: created, completedAt: completed, orderState: state, paymentState: payment, customerEmail: 'synthetic@example.invalid',
  custom: {fields: {oryIdentityId: ory, userHubUserId: hub, ...(legacy ? {legacyCreatedAt: legacy, legacyOrderId: 'legacy-' + id} : {}), ...(source ? {sourceSystem: source} : {}), purchaseIp: '192.0.2.1'}},
  lineItems: lines.map((name, i) => ({id: id + '-line-' + i, name: {'en-US': name}, productSlug: {'en-US': 'slug'}, productType: {obj: {key: 'bundle'}}, quantity: 1})), customLineItems: []});
const page = (orders, n, pages, signedIn = 'principal-A') => frames([{name: 'AuthProvider', props: {user: {id: signedIn}}}, {name: 'OrderHistory', props: {data: {results: orders, pagination: {page: n, totalPages: pages, totalDocs: orders.length}}}}]);
// One order on the new store holding two bundles, and a migrated order whose createdAt is its migration.
const NEW = order('o-new', ['Synthetic Comic Bundle: The Archive Collection by Example & Co', 'Synthetic Comic Bundle: The Horror Bundle by Example']);
const MIGRATED = order('o-old', ['Synthetic Book Bundle: Earlier Favourites'], {created: '2026-11-01T08:00:00.000Z', legacy: '2025-09-03T11:00:00.123456Z', completed: '2025-09-03T11:00:00.123Z', source: 'hb-refundable-original'});
const history = (...pages) => n => page(pages[n - 1] ?? [], n, pages.length);

test('reads dated bundle lines: a two-bundle order dates both lines; a migrated order uses legacyCreatedAt, not its migration time', async () => {
  const f = fixture({orders: history([NEW, MIGRATED])}), E = f.E;
  const read = await E.readOrderHistory({fetcher: f.fetcher, scope: SCOPE});
  assert.deepEqual(JSON.parse(JSON.stringify(read.lines)).map(({order, ...line}) => line), [
    {ref: 'o-new:o-new-line-0', name: 'Synthetic Comic Bundle: The Archive Collection by Example & Co', at: '2026-11-17T03:45:00.000Z'},
    {ref: 'o-new:o-new-line-1', name: 'Synthetic Comic Bundle: The Horror Bundle by Example', at: '2026-11-17T03:45:00.000Z'},
    {ref: 'o-old:o-old-line-0', name: 'Synthetic Book Bundle: Earlier Favourites', at: '2025-09-03T11:00:00.123Z'}]);
  assert.deepEqual(JSON.parse(JSON.stringify(read.state)), {newest: '2026-11-17T03:45:00.000Z', resume: null});
  assert(!JSON.stringify(read).match(/example\.invalid|192\.0\.2\.1|N-o-/u), 'no email, IP address or order number is kept');
});

test('a migrated order without its original time stays undated; cancelled or refunded orders are withdrawn, not dated', async () => {
  const E = fixture().E;
  const undated = order('o-mig', ['Undated Bundle'], {created: '2026-11-01T00:00:00.000Z', source: 'hb-refundable-original'});
  const completedOnly = order('o-comp', ['Completed Bundle'], {created: '2026-11-01T00:00:00.000Z', completed: '2026-05-05T05:05:05.000Z', source: 'hb-refundable-original'});
  const refunded = order('o-ref', ['Refunded Bundle'], {payment: 'Refunded'});
  const read = await E.readOrderHistory({fetcher: fixture({orders: history([undated, completedOnly, refunded])}).fetcher, scope: SCOPE});
  assert.deepEqual(JSON.parse(JSON.stringify(read.lines)).map(({order, ...line}) => line), [{ref: 'o-mig:o-mig-line-0', name: 'Undated Bundle', at: null}, {ref: 'o-comp:o-comp-line-0', name: 'Completed Bundle', at: '2026-05-05T05:05:05.000Z'}, {ref: 'o-ref:o-ref-line-0', drop: true}]);
});

test('Order History of another Humble account is rejected', async () => {
  const E = fixture().E;
  for (const orders of [n => page([NEW], n, 1, 'principal-B'), history([order('x', ['A'], {ory: 'principal-B'})]), history([order('x', ['A'], {hub: 'hub-B'})])])
    await assert.rejects(E.readOrderHistory({fetcher: fixture({orders}).fetcher, scope: SCOPE}), /different Humble account/);
});

test('reads grow incrementally: a recent read stops at orders seen before, a full read continues, a long history resumes', async () => {
  const E = fixture().E;
  const many = Array.from({length: 7}, (_, p) => Array.from({length: 6}, (_, i) => order(`o${p}-${i}`, [`Bundle ${p}-${i}`], {created: new Date(Date.UTC(2026, 10, 10) - (p * 6 + i) * 3600000).toISOString(), legacy: '2026-01-01T00:00:00.000Z', source: 'hb'})));
  let f = fixture({orders: history(...many)});
  const first = await E.readOrderHistory({fetcher: f.fetcher, scope: SCOPE, full: true, maxPages: 3});
  assert.equal(first.lines.length, 18);assert.deepEqual(JSON.parse(JSON.stringify(first.state)), {newest: null, resume: {page: 4, newest: '2026-11-10T00:00:00.000Z'}}, 'a long history resumes on the next full read');
  const second = await E.readOrderHistory({fetcher: f.fetcher, scope: SCOPE, state: first.state, full: true, maxPages: 10});
  assert.equal(second.lines.length, 24);assert.deepEqual(JSON.parse(JSON.stringify(second.state)), {newest: '2026-11-10T00:00:00.000Z', resume: null});
  // A recent read never starts or moves a resume position, and does not record a newest order it did not finish behind.
  const partial = await E.readOrderHistory({fetcher: fixture({orders: history(...many)}).fetcher, scope: SCOPE, state: first.state, maxPages: 2});
  assert.deepEqual(JSON.parse(JSON.stringify(partial.state)), JSON.parse(JSON.stringify(first.state)));
  // Humble adds two newly migrated orders at the top; a recent read takes the first page only.
  const added = [order('fresh-1', ['Fresh 1'], {created: '2026-11-18T00:00:00.000Z', legacy: '2025-01-01T00:00:00.000Z', source: 'hb'}), order('fresh-2', ['Fresh 2'], {created: '2026-11-17T00:00:00.000Z', legacy: '2025-02-01T00:00:00.000Z', source: 'hb'})];
  const grown = [[...added, ...many[0].slice(0, 4)], ...many];
  f = fixture({orders: history(...grown)});
  const recent = await E.readOrderHistory({fetcher: f.fetcher, scope: SCOPE, state: second.state});
  assert.equal(f.requests.filter(r => r.path.startsWith('/home/purchases')).length, 1);assert(recent.lines.some(l => l.name === 'Fresh 1') && recent.lines.some(l => l.name === 'Fresh 2'));
  assert.equal(recent.state.newest, '2026-11-18T00:00:00.000Z');
  const full = await E.readOrderHistory({fetcher: fixture({orders: history(...grown)}).fetcher, scope: SCOPE, state: second.state, full: true});
  assert.equal(full.state.resume, null);assert.equal(full.lines.length, 6 * 8);
});

test('Order History that cannot be read raises an error for the caller (the sync keeps going)', async () => {
  const E = fixture().E;
  await assert.rejects(E.readOrderHistory({fetcher: fixture({orders: () => 503}).fetcher, scope: SCOPE}));
  await assert.rejects(E.readOrderHistory({fetcher: fixture({orders: () => frames([{name: 'AuthProvider', props: {user: {id: 'principal-A'}}}])}).fetcher, scope: SCOPE}), /Unreadable Order History/);
});

// Matching: a synthetic Library scope and stored Order History lines.
function scopeWith(titles, lines) {
  const {E, B} = load();
  let n = 1;const obs = titles.flatMap(([title, parent, count = 2]) => Array.from({length: count}, () => nativeObservation(E, {id: n++, parent, title: 'Item ' + n, parentTitle: title})));
  const lib = entitlements(obs);lib.scopes[0].orders = {lines: Object.fromEntries(lines.map(([name, at], i) => ['o' + i + ':l', {name, at}])), newest: null, resume: null};
  return {E, B, lib: E.collection(lib), scope: E.collection(lib).scopes[0]};
}
const dates = ({E, scope}) => Object.fromEntries([...E.orderDates(scope)].map(([parent, v]) => [parent, v.purchasedAt]));

test('matching: exact and normalized names date one purchase each; no matching order leaves a purchase undated', () => {
  const s = scopeWith([['Humble Comic Bundle: Tales & Stories', 1], ['Synthetic Letter Bundle', 2], ['Never Ordered', 3]],
    [['humble comic bundle — tales and stories', '2026-11-17T03:45:00.000Z'], ['Synthetic Letter Bundle', '2025-09-19T03:00:00.000Z'], ['Some Other Bundle', '2026-01-01T00:00:00.000Z']]);
  assert.deepEqual(dates(s), {[uuid(1)]: '2026-11-17T03:45:00.000Z', [uuid(2)]: '2025-09-19T03:00:00.000Z'});
});

test('matching: repeat purchases with different dates, more orders than purchases, and similar names stay undated', () => {
  assert.deepEqual(dates(scopeWith([['Repeat Bundle', 1], ['Repeat Bundle', 2]], [['Repeat Bundle', '2025-01-01T00:00:00.000Z'], ['Repeat Bundle', '2026-01-01T00:00:00.000Z']])), {});
  assert.deepEqual(dates(scopeWith([['Gifted Twice', 1]], [['Gifted Twice', '2025-01-01T00:00:00.000Z'], ['Gifted Twice', '2025-01-01T00:00:00.000Z']])), {});
  assert.deepEqual(dates(scopeWith([['Megabundle, Part 2', 1]], [['Megabundle, Part 3', '2025-01-01T00:00:00.000Z']])), {});
  assert.deepEqual(dates(scopeWith([['Undated Order', 1]], [['Undated Order', null]])), {});
  // Two purchases of one bundle in the same order share its date.
  assert.deepEqual(dates(scopeWith([['Twice In One Order', 1], ['Twice In One Order', 2]], [['Twice In One Order', '2025-03-03T00:00:00.000Z'], ['Twice In One Order', '2025-03-03T00:00:00.000Z']])),
    {[uuid(1)]: '2025-03-03T00:00:00.000Z', [uuid(2)]: '2025-03-03T00:00:00.000Z'});
});

test('storage: lines survive later sync batches, backup and restore; unusable stored lines are dropped without rejecting the library', async () => {
  const f = fixture({rows: [row('a', 'Synthetic game a')], children: [child('a', 'Synthetic game a')], parent: {title: 'Synthetic Bundle'}});await f.collect();
  await f.store('entitlementOrders', {scope: SCOPE, lines: [{ref: 'o1:l1', name: 'Synthetic Bundle', at: '2026-11-17T03:45:00.000Z'}], state: {newest: '2026-11-17T03:45:00.000Z', resume: null}});
  const g = fixture({initial: f.stored, rows: [row('a', 'Synthetic game a'), row('b', 'Synthetic game b')], parent: {title: 'Synthetic Bundle'}});await g.collect();
  const scope = g.stored.libraryEntitlements.scopes[0];
  assert.deepEqual(scope.orders.lines, {'o1:l1': {name: 'Synthetic Bundle', at: '2026-11-17T03:45:00.000Z'}}, 'a later sync batch keeps the lines');
  assert.equal(g.E.orderDates(g.E.collection(g.stored.libraryEntitlements).scopes[0]).get('parent-A').purchasedAt, '2026-11-17T03:45:00.000Z');
  const restored = g.H.restoreBackupState(copy(g.H.createLibraryBackup(g.stored)));
  assert.deepEqual(copy(restored.libraryEntitlements.scopes[0].orders.lines), scope.orders.lines);
  const odd = copy(g.stored.libraryEntitlements);odd.scopes[0].orders.lines.bad = {name: '', at: 'never'};odd.scopes[0].orders.lines['o2:l'] = {name: 'Fine', at: 'not a date'};
  assert.deepEqual(copy(g.E.collection(odd).scopes[0].orders.lines), {'o1:l1': {name: 'Synthetic Bundle', at: '2026-11-17T03:45:00.000Z'}, 'o2:l': {name: 'Fine', at: null}});
  delete odd.scopes[0].orders;assert.equal(g.E.collection(odd).scopes[0].orders, undefined, 'libraries saved without Order History remain valid');
});

test('storage: merges are additive and idempotent, absent lines stay, refunds withdraw, and another account cannot write', async () => {
  const f = fixture({parent: {title: 'Synthetic Bundle'}});await f.collect();
  const save = (lines, state = {newest: null, resume: null}) => f.store('entitlementOrders', {scope: SCOPE, lines, state});
  const line = {ref: 'o1:l1', name: 'Synthetic Bundle', at: '2026-11-17T03:45:00.000Z'};
  assert.equal((await save([line])).dated, 1);
  const once = f.stored.libraryEntitlements.scopes[0].orders.lines;
  await save([line]);await save([]);
  assert.deepEqual(f.stored.libraryEntitlements.scopes[0].orders.lines, once, 'repeating or reading nothing changes nothing');
  await save([{ref: 'o1:l1', name: 'Synthetic Bundle', at: null}]);
  assert.equal(f.stored.libraryEntitlements.scopes[0].orders.lines['o1:l1'].at, '2026-11-17T03:45:00.000Z', 'a recovered date is not erased');
  await save([{ref: 'o1:l1', drop: true}]);
  assert.deepEqual(f.stored.libraryEntitlements.scopes[0].orders.lines, {});
  await assert.rejects(save.call(null, [line]).then(() => f.store('entitlementOrders', {scope: {principalId: 'principal-B', userId: 'hub-B'}, lines: [line], state: {}})), /saved account changed/);
  const before = copy(f.stored.libraryEntitlements.scopes[0].observations);
  await save([{ref: 'o9:l', name: 'Other', at: '2026-01-01T00:00:00.000Z'}]);
  assert.deepEqual(f.stored.libraryEntitlements.scopes[0].observations, before, 'observations are untouched');
});

test('a completed sync looks up purchase dates; an unavailable Order History does not fail the sync', async () => {
  const run = async orders => {
    const f = fixture({parent: {title: 'Synthetic Comic Bundle: The Horror Bundle by Example'}, ...(orders ? {orders} : {})});
    const s = f.E.createSync({fetcher: f.fetcher, store: f.store, settings: {batchPages: 3, pageSize: 5}, sleep: async () => {}});
    await s.start({mode: 'refresh', context: await f.store('entitlementContext'), confirmed: true});
    return {f, s};
  };
  const ok = await run(history([NEW]));
  assert.equal(ok.f.stored.libraryEntitlements.scopes[0].sync.status, 'completed');
  assert.deepEqual(JSON.parse(JSON.stringify(ok.s.view.orderDates)), {lines: 2, newOrders: 1, dated: 1, changed: true});
  assert.equal(ok.f.E.syncView(ok.f.stored).orders.dated, 1);
  // A second sync reads the first Order History page only and changes nothing.
  const lines = copy(ok.f.stored.libraryEntitlements.scopes[0].orders.lines), n = ok.f.requests.filter(r => r.path.startsWith('/home/purchases')).length;
  await ok.s.start({mode: 'refresh', context: await ok.f.store('entitlementContext'), confirmed: true});
  assert.equal(ok.f.requests.filter(r => r.path.startsWith('/home/purchases')).length - n, 1);
  assert.deepEqual(ok.f.stored.libraryEntitlements.scopes[0].orders.lines, lines);
  const down = await run(() => 503);
  assert.equal(down.f.stored.libraryEntitlements.scopes[0].sync.status, 'completed');
  assert.equal(down.s.view.orderDates.error, 'unavailable');assert.equal(down.f.stored.libraryEntitlements.scopes[0].orders, undefined);
});

// Presentation: dated purchases sort by purchase date; Recently added and counts are unchanged.
test('Bundles & Orders and Titles use recovered dates; imported dates win; Recently added and purchase counts are unchanged', () => {
  const {E, B} = load();
  const at = (spec, first) => E.observation({...nativeObservation(E, spec), ...(first ? {firstObservedAt: first} : {})});
  const obs = [at({id: 1, parent: 1, title: 'Horror One', parentTitle: 'Horror Bundle'}, '2026-11-17T04:30:00.000Z'), at({id: 2, parent: 2, title: 'Archive One', parentTitle: 'Archive Bundle'}, '2026-11-17T04:30:00.000Z'),
    at({id: 3, parent: 3, title: 'Imported One', parentTitle: 'Imported Bundle'}), at({id: 4, parent: 4, title: 'Unknown One', parentTitle: 'Undated Bundle'})];
  const lib = entitlements(obs);
  lib.scopes[0].orders = {lines: {'a:1': {name: 'Horror Bundle', at: '2026-11-17T03:45:00.000Z'}, 'a:2': {name: 'Archive Bundle', at: '2026-11-17T03:45:00.000Z'}, 'b:1': {name: 'Imported Bundle', at: '2024-03-01T04:00:00.000Z'}}, newest: null, resume: null};
  const items = [{title: 'Imported One', kind: 'book', source: 'humble', purchaseKey: 'K1', sourceBundle: 'Imported Bundle', purchasedAt: '2024-03-01T08:00:00.000Z'}, {title: 'Old Book', kind: 'book', source: 'humble', purchaseKey: 'K2', sourceBundle: 'Older Bundle', purchasedAt: '2025-01-01T00:00:00.000Z'}];
  const model = B.buildGroups({items, libraryEntitlements: lib, humbleAccountId: ACCOUNT}), r = B.reconcile(model.groups);
  const names = sort => Array.from(B.filterGroups(r.groups, {sort}), x => x.group.name);
  assert.deepEqual(names('date-desc'), ['Archive Bundle', 'Horror Bundle', 'Older Bundle', 'Imported Bundle', 'Undated Bundle']);
  const imported = r.groups.find(g => g.source === 'unified');
  assert.equal(new Date(imported.purchasedAt).toISOString(), '2024-03-01T08:00:00.000Z', 'an imported order keeps its own date');
  assert.equal(r.groups.find(g => g.name === 'Horror Bundle').dateSource, 'order-history');
  assert.deepEqual(names('added-desc').slice(0, 2), ['Archive Bundle', 'Horror Bundle'], 'Recently added still follows first-synced times');
  const links = B.titleLinks(model.groups, r), withoutDates = B.titleLinks(B.buildGroups({items, libraryEntitlements: entitlements(obs), humbleAccountId: ACCOUNT}).groups, B.reconcile(B.buildGroups({items, libraryEntitlements: entitlements(obs), humbleAccountId: ACCOUNT}).groups));
  for (const title of ['Horror One', 'Imported One']) assert.deepEqual({...B.titlePurchaseCount(items.filter(i => i.title === title), links.links.get(links.key(title)))}, {...B.titlePurchaseCount(items.filter(i => i.title === title), withoutDates.links.get(withoutDates.key(title)))});
  assert.equal(new Date(links.links.get(links.key('Horror One'))[0].purchasedAt).toISOString(), '2026-11-17T03:45:00.000Z');
  const native = B.nativeOnlyTitles(model, items, links).find(t => t.title === 'Horror One');
  assert.equal(native.provenance[0].purchasedAt, '2026-11-17T03:45:00.000Z');
  // Another account's Order History never dates this account's purchases.
  const other = entitlements(obs, '22222222-2222-4222-8222-222222222222');other.scopes[0].orders = lib.scopes[0].orders;
  assert(B.buildGroups({items: [], libraryEntitlements: other, humbleAccountId: ACCOUNT}).groups.every(g => g.purchasedAt === null));
});

test('bundle pages and catalogue markers carry the recovered date; Owned counts are unchanged', () => {
  const context = vm.createContext({URL, Blob, Promise, Intl, Date, TextEncoder, TextDecoder, crypto: webcrypto, setTimeout, clearTimeout, console, performance: {now: () => 0},
    document: {title: '', querySelector: () => null, querySelectorAll: () => []}, location: {pathname: '/'}});
  context.globalThis = context;
  for (const file of ['library-entitlements.js', 'library-browser.js', 'shared.js', 'collection-mappings.js', 'ownership.js', 'content.js']) vm.runInContext(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context, {filename: file});
  const E = context.HumbleLibraryEntitlements, lib = entitlements([nativeObservation(E, {id: 1, parent: 1, title: 'Horror One', parentTitle: 'Horror Book Bundle'}), nativeObservation(E, {id: 2, parent: 1, title: 'Shared Title', parentTitle: 'Horror Book Bundle'})]);
  const items = [{title: 'Shared Title', kind: 'book', source: 'humble', purchaseKey: 'K1', sourceBundle: 'Earlier Bundle', purchasedAt: '2024-03-01T00:00:00.000Z'}];
  const state = orders => ({libraryItems: items, purchaseSummaries: [{purchaseKey: 'K1', sourceBundle: 'Earlier Bundle', purchasedAt: '2024-03-01T00:00:00.000Z'}], humbleAccountId: ACCOUNT, humbleProfileLabel: 'Main',
    libraryEntitlements: {...lib, scopes: [{...lib.scopes[0], ...(orders ? {orders: {lines: {'a:1': {name: 'Horror Book Bundle', at: '2026-11-17T03:45:00.000Z'}}, newest: null, resume: null}} : {})}]}});
  const view = s => { context.s = s; return JSON.parse(vm.runInContext(`JSON.stringify((() => { const m = libraryPurchaseModel(s), records = entitlementMatchingRecords(s, m);
    return { purchases: m.purchases.map(p => [p.sourceBundle, p.purchasedAt]), counts: records.map(r => [r.title, matchPurchaseTotal({ state: 'owned', item: r }).count]), dates: records.map(r => itemProvenance(r).filter(p => p.libraryPurchase).map(p => p.purchasedAt)) }; })())`, context)); };
  const before = view(state(false)), after = view(state(true));
  assert.deepEqual(after.counts, before.counts, 'Owned ×N is unchanged');
  assert.deepEqual(before.purchases.at(-1), ['Horror Book Bundle', null]);assert.deepEqual(after.purchases.at(-1), ['Horror Book Bundle', '2026-11-17T03:45:00.000Z']);
  assert(after.dates.flat().every(d => d === '2026-11-17T03:45:00.000Z') && after.dates.flat().length === 2);
  assert.equal(vm.runInContext(`formatBundlePurchase({ libraryPurchase: 'x', purchasedAt: '2026-11-17T03:45:00.000Z' })`, context).includes('Humble lists no purchase date'), false);
});

test('Options shows a late-evening purchase on its local calendar day', () => {
  const zone = process.env.TZ;process.env.TZ = 'America/New_York';
  try {
    const context = vm.createContext({console, Date, Intl, URL, setTimeout, clearTimeout, sessionStorage: {getItem: () => null, setItem() {}}, document: {querySelector: () => ({addEventListener() {}, append() {}, replaceChildren() {}, dataset: {}, style: {}, classList: {add() {}, remove() {}, toggle() {}}}), querySelectorAll: () => [], createElement: () => ({})},
      chrome: {runtime: {id: 'x'}, storage: {local: {get: async () => ({}), set: async () => {}}, onChanged: {addListener() {}}}}});
    context.globalThis = context;
    const source = fs.readFileSync(new URL('../options.js', import.meta.url), 'utf8'), start = source.indexOf('  function formatPurchaseDate('), end = source.indexOf('\n  }', start) + 4;
    vm.runInContext(source.slice(start, end) + '\nglobalThis.format = formatPurchaseDate;', context);
    assert.equal(context.format('2026-11-17T03:45:00.000Z'), '2026-11-16');
    assert.equal(context.format(null), '');assert.equal(context.format('not a date'), '');
  } finally { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone; }
});
