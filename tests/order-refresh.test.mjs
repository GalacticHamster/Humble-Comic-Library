import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, copy, frames} from './library-entitlements-fixture.mjs';
import {load, nativeObservation, entitlements, ACCOUNT} from './library-browser-fixture.mjs';

// Refresh purchase dates: synthetic Order History only, newest first, six orders a page as Humble shows it.
const order = (id, name, created, legacy = '2024-01-01T00:00:00.000Z', {ory = 'principal-A'} = {}) => ({id, createdAt: created, completedAt: legacy, orderState: 'Complete', paymentState: 'Paid',
  custom: {fields: {oryIdentityId: ory, userHubUserId: 'hub-A', legacyCreatedAt: legacy, sourceSystem: 'hb-refundable-original'}}, lineItems: [{id: id + '-line', name: {'en-US': name}}]});
const hour = n => new Date(Date.UTC(2026, 10, 17) - n * 3600000).toISOString();
// The 13 orders the account shows today, then older orders Humble restores behind them.
const recent = Array.from({length: 13}, (_, i) => order('recent-' + i, 'Recent Bundle ' + i, hour(i), `2026-0${1 + (i % 9)}-15T12:00:00.000Z`));
const restored = n => Array.from({length: n}, (_, i) => order('restored-' + i, 'Restored Bundle ' + i, hour(100 + i), `2019-0${1 + (i % 9)}-10T12:00:00.000Z`));
const paged = list => n => { const pages = Math.max(1, Math.ceil(list.length / 6)); return frames([{name: 'AuthProvider', props: {user: {id: 'principal-A'}}}, {name: 'OrderHistory', props: {data: {results: list.slice((n - 1) * 6, n * 6), pagination: {page: n, totalPages: pages, totalDocs: list.length}}}}]); };

// Saved Library purchases: two of the recent bundles and five restored ones, each with a first-synced time.
function library(names = ['Recent Bundle 0', 'Recent Bundle 1', ...Array.from({length: 5}, (_, i) => 'Restored Bundle ' + i)]) {
  const {E} = load();
  const obs = names.map((name, i) => E.observation({...nativeObservation(E, {id: i + 1, parent: i + 1, title: name + ' item', parentTitle: name}), firstObservedAt: '2026-11-13T03:16:00.000Z'}));
  return {humbleAccountId: ACCOUNT, humbleProfileLabel: 'A', libraryItems: [{title: 'Recent Bundle 0 item', kind: 'book', source: 'humble', purchaseKey: 'K', sourceBundle: 'Old Order', purchasedAt: '2020-02-02T12:00:00.000Z'}],
    purchaseSummaries: [{purchaseKey: 'K', sourceBundle: 'Old Order', purchasedAt: '2020-02-02T12:00:00.000Z'}], libraryEntitlements: entitlements(obs)};
}
// Humble's Order History can change between refreshes: `history.list` is what it currently shows.
function setup(list, initial = library()) {
  const history = {list, fail: null};
  const f = fixture({initial, orders: n => history.fail?.(n) ?? paged(history.list)(n)});
  const runner = () => f.E.createSync({fetcher: f.fetcher, store: f.store, settings: {batchPages: 3, pageSize: 5}, sleep: async () => {}});
  const refresh = async (s = runner()) => { await s.refreshDates(); return JSON.parse(JSON.stringify(s.view.orderDates)); };
  const requests = () => f.requests.filter(r => r.path.startsWith('/home/purchases')).length;
  return {f, history, runner, refresh, requests, orders: () => f.stored.libraryEntitlements.scopes[0].orders};
}
const scopeOf = f => f.E.collection(f.stored.libraryEntitlements).scopes[0];

test('a first refresh checks all 13 orders on three pages and dates the matching saved purchases', async () => {
  const t = setup(recent);
  const result = await t.refresh();
  assert.deepEqual(result, {orders: 13, newOrders: 13, dated: 2, newlyDated: 2, resumable: false, cancelled: false});
  assert.equal(t.requests(), 3);
  assert.equal(t.f.requests.filter(r => r.path.startsWith('/home/library')).length, 0, 'no Library page is read');
});

test('older orders restored behind known ones are found by the next refresh; the recent check alone would miss them', async () => {
  const t = setup(recent);await t.refresh();
  t.history.list = [...recent, ...restored(50)];
  // Negative control: the recent read stops at the first order it has seen before, on page one.
  const quick = await t.f.E.readOrderHistory({fetcher: t.f.fetcher, scope: {principalId: 'principal-A', userId: 'hub-A'}, state: t.orders(), full: false});
  assert.equal(quick.lines.filter(l => l.name.startsWith('Restored')).length, 0);
  const before = t.requests(), result = await t.refresh();
  assert.deepEqual(result, {orders: 63, newOrders: 50, dated: 7, newlyDated: 5, resumable: false, cancelled: false});
  assert.equal(t.requests() - before, 11, 'each of the 11 pages is read once');
  assert.equal(Object.keys(t.orders().lines).length, 63);
});

test('a history longer than one refresh run continues on the next run; more than 20 pages are read in batches', async () => {
  const t = setup([...recent, ...restored(1250 - 13)]);
  const first = await t.refresh();
  assert.equal(t.requests(), 200, 'one run reads at most 200 pages');assert.equal(first.resumable, true);assert.equal(first.orders, 1200);
  assert.deepEqual(copy(t.orders().resume), {page: 201, newest: hour(0)});
  const writes = t.f.writes.filter(w => w.libraryEntitlements).length;
  const second = await t.refresh();
  assert.equal(t.requests(), 209);assert.equal(second.resumable, false);assert.equal(second.orders, 50);
  assert.equal(Object.keys(t.orders().lines).length, 1250);assert.equal(t.orders().resume, null);
  assert.equal(writes, 20, 'progress is saved every 10 pages');
});

test('an interrupted refresh resumes where it stopped, also in a new runner (after a reload or restart)', async () => {
  const t = setup([...recent, ...restored(120 - 13)]);
  const s = t.runner();
  s.subscribe(v => { if (v.orderDates?.running && v.orderDates.orders >= 60) s.cancel(); });
  const stopped = await t.refresh(s);
  assert.equal(stopped.cancelled, true);assert.equal(stopped.resumable, true);
  const saved = Object.keys(t.orders().lines).length, page = t.orders().resume.page;
  assert(saved >= 60 && saved < 120 && page > 1);
  const before = t.requests(), resumed = await t.refresh();
  assert.equal(t.requests() - before, 20 - page + 1, 'the remaining pages only');assert.equal(resumed.resumable, false);
  assert.equal(Object.keys(t.orders().lines).length, 120);
});

test('orders inserted while a refresh is unfinished shift pages without losing any order below; the next refresh finds the inserted ones', async () => {
  const base = [...recent, ...restored(60 - 13)], t = setup(base);
  const s = t.runner();s.subscribe(v => { if (v.orderDates?.running && v.orderDates.orders >= 30) s.cancel(); });
  await t.refresh(s);
  // Humble restores 7 more orders near the top while the refresh is unfinished: later pages shift down.
  t.history.list = [...recent.slice(0, 3), ...restored(7).map((o, i) => ({...o, id: 'inserted-' + i, lineItems: [{id: 'l', name: {'en-US': 'Inserted Bundle ' + i}}]})), ...base.slice(3)];
  await t.refresh();
  const names = Object.values(t.orders().lines).map(l => l.name);
  assert(base.every(o => names.includes(o.lineItems[0].name['en-US'])), 'every order below the resume point was read');
  await t.refresh();
  assert.equal(Object.values(t.orders().lines).filter(l => l.name.startsWith('Inserted')).length, 7, 'the next refresh, from page one, reads the inserted orders');
});

test('a repeated refresh with nothing new writes nothing and reports nothing new', async () => {
  const t = setup(recent);await t.refresh();
  const writes = t.f.writes.length, result = await t.refresh();
  assert.equal(t.f.writes.length, writes, 'no storage write');
  assert.deepEqual(result, {orders: 13, newOrders: 0, dated: 2, newlyDated: 0, resumable: false, cancelled: false});
});

test('a transient failure is retried; a rate limit stops with progress saved and resumes later', async () => {
  const t = setup([...recent, ...restored(80 - 13)]);
  let failures = 1;t.history.fail = n => n === 2 && failures-- > 0 ? 503 : null;
  const retried = await t.refresh();
  assert.equal(retried.error, undefined);assert.equal(retried.orders, 80);
  const u = setup([...recent, ...restored(80 - 13)]);
  u.history.fail = n => n === 12 ? 429 : null;
  const limited = await u.refresh();
  assert.equal(limited.error, 'rate-limited');assert.equal(limited.resumable, true);assert.equal(Object.keys(u.orders().lines).length, 60, 'the first 10 pages stay saved');
  u.history.fail = null;
  const after = await u.refresh();assert.equal(after.resumable, false);assert.equal(Object.keys(u.orders().lines).length, 80);
});

test('Order History of another account is rejected without saving anything', async () => {
  const t = setup([order('foreign', 'Recent Bundle 0', hour(0), '2026-01-01T00:00:00.000Z', {ory: 'principal-B'})]);
  const result = await t.refresh();
  assert.equal(result.error, 'account');assert.equal(t.orders(), undefined);assert.equal(t.f.E.orderDates(scopeOf(t.f)).size, 0);
});

test('a refresh changes no purchase, count, imported date or first-synced time; unmatched new orders date nothing', async () => {
  const t = setup(recent), observations = copy(t.f.stored.libraryEntitlements.scopes[0].observations), legacy = copy({items: t.f.stored.libraryItems, summaries: t.f.stored.purchaseSummaries});
  const {B} = load(), counts = state => { const m = B.buildGroups({items: state.libraryItems, purchaseSummaries: state.purchaseSummaries, libraryEntitlements: state.libraryEntitlements, humbleAccountId: ACCOUNT}), l = B.titleLinks(m.groups, B.reconcile(m.groups));
    return ['Recent Bundle 0 item', 'Restored Bundle 3 item'].map(title => ({...B.titlePurchaseCount(state.libraryItems.filter(i => i.title === title), l.links.get(l.key(title)) ?? [])})); };
  const before = counts(t.f.stored);
  await t.refresh();
  t.history.list = [order('unknown-1', 'A Bundle Not In The Library', hour(-1)), ...recent];
  const result = await t.refresh();
  assert.equal(result.newOrders, 1);assert.equal(result.newlyDated, 0);
  assert.deepEqual(t.f.stored.libraryEntitlements.scopes[0].observations, observations, 'observations and first-synced times are unchanged');
  assert.deepEqual({items: t.f.stored.libraryItems, summaries: t.f.stored.purchaseSummaries}, legacy);
  assert.deepEqual(counts(t.f.stored), before, 'purchase counts are unchanged');
});

test('Check recent purchases keeps its quick read and does not move a refresh\'s resume position', async () => {
  const t = setup([...recent, ...restored(250 - 13)]);
  const s = t.runner();s.subscribe(v => { if (v.orderDates?.running && v.orderDates.orders >= 60) s.cancel(); });
  await t.refresh(s);
  const resume = copy(t.orders().resume), before = t.requests();
  await t.f.E.createSync({fetcher: t.f.fetcher, store: t.f.store, settings: {batchPages: 3, pageSize: 5}, sleep: async () => {}}).start({mode: 'refresh', context: await t.f.store('entitlementContext'), confirmed: true});
  assert(t.requests() - before <= 3, 'the recent check reads at most three Order History pages');
  assert.deepEqual(copy(t.orders().resume), resume);
});

test('a refresh needs a synced Library for the active account', async () => {
  const {E} = load(), t = setup(recent, {humbleAccountId: ACCOUNT, humbleProfileLabel: 'A', libraryItems: []});
  assert.deepEqual(await t.refresh(), {error: 'not-synced'});assert.equal(t.requests(), 0);
});
