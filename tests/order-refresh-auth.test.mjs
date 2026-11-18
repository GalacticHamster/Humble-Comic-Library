import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, frames} from './library-entitlements-fixture.mjs';
import {load, nativeObservation, entitlements, ACCOUNT} from './library-browser-fixture.mjs';

// Humble redirects an Order History RSC request that lacks Next.js's `_rsc` cache key to the same URL with
// the key added, for signed-in and signed-out visitors alike (observed on the live site in a signed-out
// profile). Refresh purchase dates must follow that redirect and decide sign-in from the response itself.
const order = (id, name, created) => ({id, createdAt: created, completedAt: null, orderState: 'Complete', paymentState: 'Paid',
  custom: {fields: {oryIdentityId: 'principal-A', userHubUserId: 'hub-A'}}, lineItems: [{id: id + '-line', name: {'en-US': name}}]});
const hour = n => new Date(Date.UTC(2026, 10, 17) - n * 3600000).toISOString();
const thirteen = Array.from({length: 13}, (_, i) => order('order-' + i, 'Synthetic Bundle ' + i, hour(i)));
const paged = list => n => frames([{name: 'AuthProvider', props: {user: {id: 'principal-A'}}}, {name: 'OrderHistory', props: {data: {results: list.slice((n - 1) * 6, n * 6), pagination: {page: n, totalPages: Math.ceil(list.length / 6), totalDocs: list.length}}}}]);
function setup(options = {}) {
  const {E} = load();
  const obs = ['Synthetic Bundle 0', 'Synthetic Bundle 1', 'Undated Bundle'].map((name, i) => E.observation({...nativeObservation(E, {id: i + 1, parent: i + 1, title: name + ' item', parentTitle: name}), firstObservedAt: '2026-11-13T03:16:00.000Z'}));
  const f = fixture({initial: {humbleAccountId: ACCOUNT, humbleProfileLabel: 'A', libraryItems: [], libraryEntitlements: entitlements(obs)}, orders: paged(thirteen), ...options});
  const s = f.E.createSync({fetcher: f.fetcher, store: f.store, settings: {batchPages: 3, pageSize: 5}, sleep: async () => {}});
  return {f, s, refresh: async () => { await s.refreshDates(); return JSON.parse(JSON.stringify(s.view.orderDates)); }, requests: () => f.requests.filter(r => r.path.startsWith('/home/purchases'))};
}

test('a signed-in refresh follows Humble\'s same-page cache-key redirect and checks every order', async () => {
  const t = setup(), result = await t.refresh();
  assert.equal(result.error, undefined, 'not reported as signed out');
  assert.deepEqual(result, {orders: 13, newOrders: 13, dated: 2, newlyDated: 2, resumable: false, cancelled: false});
  assert(t.requests().every(r => r.path.startsWith('/home/purchases?page=')));
  assert.equal(t.f.requests.filter(r => r.path.startsWith('/home/library')).length, 0, 'no Library page is requested');
});

test('a genuine sign-in problem is reported as one and saves nothing: signed-out page shell, or a redirect to sign in', async () => {
  for (const options of [{signedOut: true}, {orders: () => 'login'}]) {
    const t = setup(options), result = await t.refresh();
    assert.equal(result.error, 'signed-out');assert.equal(result.orders, 0);
    assert.equal(t.f.stored.libraryEntitlements.scopes[0].orders, undefined);
    assert.equal(t.requests().length, 1, 'stops at once; sign-in is not retried');
  }
});

test('another account\'s Order History is rejected without saving it', async () => {
  const t = setup({orders: n => frames([{name: 'AuthProvider', props: {user: {id: 'principal-B'}}}, {name: 'OrderHistory', props: {data: {results: [], pagination: {page: 1, totalPages: 1}}}}])});
  const result = await t.refresh();
  assert.equal(result.error, 'account');assert.equal(t.f.stored.libraryEntitlements.scopes[0].orders, undefined);
});

test('an unexpected response is reported as such, not as sign-in, and is not retried', async () => {
  for (const orders of [() => '0:"not an order page"\n', () => frames([{name: 'Nav', props: {}}]), () => frames([{name: 'AuthProvider', props: {user: {id: 'principal-A'}}}])]) {
    const t = setup({orders}), result = await t.refresh();
    assert.equal(result.error, 'unexpected');assert.equal(t.requests().length, 1);assert(result.detail);
  }
});

test('network and server failures are retried; persistent ones stop as unavailable or network with progress kept', async () => {
  let failures = 2;
  const flaky = setup({orders: n => n === 1 && failures-- > 0 ? 'network' : paged(thirteen)(n)});
  assert.equal((await flaky.refresh()).orders, 13);
  const down = setup({orders: () => 503});
  const result = await down.refresh();
  assert.equal(result.error, 'unavailable');assert.equal(down.requests().length, 4, 'one try and three retries');
  const offline = setup({orders: () => 'network'});
  assert.equal((await offline.refresh()).error, 'network');
});

test('Check recent purchases dates new purchases through the same redirect', async () => {
  const t = setup();
  await t.f.E.createSync({fetcher: t.f.fetcher, store: t.f.store, settings: {batchPages: 3, pageSize: 5}, sleep: async () => {}}).start({mode: 'refresh', context: await t.f.store('entitlementContext'), confirmed: true});
  assert.equal(Object.keys(t.f.stored.libraryEntitlements.scopes[0].orders.lines).length, 13);
});

test('without the redirect (an RSC request Humble answers directly) the refresh still works', async () => {
  const t = setup({rscRedirect: false});
  assert.equal((await t.refresh()).orders, 13);
});
