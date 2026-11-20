import test from 'node:test';
import assert from 'node:assert/strict';
import {load, uuid, nativeObservation, entitlements, ACCOUNT} from './library-browser-fixture.mjs';

// Titles take purchase dates from the purchases they belong to, as Bundles & Orders shows them. Synthetic data only.
const historical = (title, purchaseKey, sourceBundle, purchasedAt = '2021-06-01T12:00:00.000Z') => ({title, kind: 'book', source: 'humble', purchaseKey, sourceBundle, purchasedAt});
const plain = v => JSON.parse(JSON.stringify(v));
const iso = t => t === null || t === undefined ? null : new Date(t).toISOString();
function titles({items, obs, orders = null, account = ACCOUNT}) {
  const {B} = load(), lib = entitlements(obs, account);
  if (orders) lib.scopes[0].orders = {lines: orders, newest: null, resume: null};
  const model = B.buildGroups({items, libraryEntitlements: lib, humbleAccountId: ACCOUNT}), r = B.reconcile(model.groups), links = B.titleLinks(model.groups, r);
  const list = B.nativeOnlyTitles(model, items, links);
  return {B, model, r, links, byTitle: t => list.find(x => x.title === t), list};
}
const book = (E, id, parent, title, parentTitle) => nativeObservation(E, {id, parent, title, parentTitle: parentTitle + ' Book Bundle'});

test('a title only in the synced Library takes the date of the imported order its purchase is combined with', () => {
  const {E} = load();
  // The import recorded three of the four titles; the Library lists all four.
  const items = ['One', 'Two', 'Three'].map(t => historical(t, 'K1', 'Synthetic Book Bundle'));
  const obs = ['One', 'Two', 'Three', 'Library Extra'].map((t, i) => book(E, i + 1, 1, t, 'Synthetic'));
  const {byTitle, links, r} = titles({items, obs});
  assert.equal(r.groups.find(g => g.source === 'unified').purchasedAt, Date.parse('2021-06-01T12:00:00.000Z'), 'Bundles & Orders already dates the purchase');
  assert.deepEqual(plain(byTitle('Library Extra').provenance.map(p => p.purchasedAt)), ['2021-06-01T12:00:00.000Z']);
  assert.equal(iso(byTitle('Library Extra').nativeCopies[0].purchasedAt), '2021-06-01T12:00:00.000Z');
  assert.equal(iso(links.links.get(links.key('One'))[0].purchasedAt), '2021-06-01T12:00:00.000Z', 'Library copies of imported titles carry it too');
});

test('identical repeat purchases give a title every repeat\'s date, so newest and oldest sorting are both right', () => {
  const {E} = load();
  const items = [...['A', 'B'].map(t => historical(t, 'K1', 'Repeat', '2019-01-01T12:00:00.000Z')), ...['A', 'B'].map(t => historical(t, 'K2', 'Repeat', '2023-01-01T12:00:00.000Z'))];
  const obs = [1, 2].flatMap(p => ['A', 'B', 'Library Extra'].map((t, i) => book(E, p * 10 + i, p, t, 'Repeat')));
  const {byTitle} = titles({items: items.map(i => ({...i, sourceBundle: 'Repeat Book Bundle'})), obs});
  assert.deepEqual(plain(byTitle('Library Extra').provenance.map(p => p.purchasedAt)).sort(), ['2019-01-01T12:00:00.000Z', '2023-01-01T12:00:00.000Z']);
});

test('Library-only purchases: dated by Order History, or left undated; another account\'s purchases never date them', () => {
  const {E} = load();
  const obs = [book(E, 1, 1, 'Dated Title', 'Ordered'), book(E, 2, 2, 'Undated Title', 'Unordered')];
  const {byTitle} = titles({items: [], obs, orders: {'o:1': {name: 'Ordered Book Bundle', at: '2026-11-17T03:45:00.000Z'}}});
  assert.deepEqual(plain(byTitle('Dated Title').provenance), [{sourceBundle: 'Ordered Book Bundle', purchasedAt: '2026-11-17T03:45:00.000Z'}]);
  assert.deepEqual(plain(byTitle('Undated Title').provenance), [{sourceBundle: 'Unordered Book Bundle'}]);
  const other = titles({items: [historical('Dated Title', 'K9', 'Ordered Book Bundle')], obs, account: '22222222-2222-4222-8222-222222222222'});
  assert.equal(other.list.length, 0, 'another account\'s Library adds no titles or dates');
});

test('a title in a purchase the reconciliation does not combine stays undated; nothing is inferred from a similar order', () => {
  const {E} = load();
  const items = ['Alpha', 'Beta', 'Gamma'].map(t => historical(t, 'K1', 'Different Book Bundle'));
  const obs = ['Delta', 'Epsilon', 'Zeta'].map((t, i) => book(E, i + 1, 1, t, 'Unrelated'));
  const {byTitle} = titles({items, obs});
  assert(['Delta', 'Epsilon', 'Zeta'].every(t => byTitle(t).provenance.every(p => !p.purchasedAt)));
});

test('dates never change purchase counts', () => {
  const {E, B} = load();
  const items = ['One', 'Two'].map(t => historical(t, 'K1', 'Synthetic Book Bundle'));
  const obs = ['One', 'Two', 'Extra'].map((t, i) => book(E, i + 1, 1, t, 'Synthetic'));
  const {links} = titles({items, obs});
  for (const t of ['One', 'Extra']) {
    const copies = links.links.get(links.key(t)), undated = copies.map(c => ({...c, purchasedAt: null}));
    assert.deepEqual({...B.titlePurchaseCount(items.filter(i => i.title === t), copies)}, {...B.titlePurchaseCount(items.filter(i => i.title === t), undated)});
  }
});

test('Bundles & Orders: undated purchases are listed last when sorting by date in either direction', () => {
  const {E, B} = load();
  const items = [historical('Old', 'K1', 'Old Order', '2018-01-01T12:00:00.000Z'), historical('New', 'K2', 'New Order', '2025-01-01T12:00:00.000Z')];
  const model = B.buildGroups({items, libraryEntitlements: entitlements([book(E, 1, 1, 'Loose', 'Unordered')]), humbleAccountId: ACCOUNT}), r = B.reconcile(model.groups);
  const names = sort => Array.from(B.filterGroups(r.groups, {sort}), x => x.group.name);
  assert.deepEqual(names('date-desc'), ['New Order', 'Old Order', 'Unordered Book Bundle']);
  assert.deepEqual(names('date-asc'), ['Old Order', 'New Order', 'Unordered Book Bundle']);
});

test('Bundles & Orders can list only purchases with no known date', () => {
  const {E, B} = load();
  const items = [historical('Old', 'K1', 'Old Order', '2018-01-01T12:00:00.000Z')];
  const model = B.buildGroups({items, libraryEntitlements: entitlements([book(E, 1, 1, 'Loose', 'Unordered')]), humbleAccountId: ACCOUNT}), r = B.reconcile(model.groups);
  assert.deepEqual(Array.from(B.filterGroups(r.groups, {filter: 'undated'}), x => x.group.name), ['Unordered Book Bundle']);
});
