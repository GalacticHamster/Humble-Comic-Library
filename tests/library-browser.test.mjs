import test from 'node:test';
import assert from 'node:assert/strict';
import {load, uuid, nativeObservation, entitlements, ACCOUNT} from './library-browser-fixture.mjs';

const historical = (title, purchaseKey, sourceBundle, extra = {}) => ({title, kind: 'book', source: 'humble', purchaseKey, sourceBundle, purchasedAt: '2024-03-01T00:00:00.000Z', ...extra});
const byName = (groups, name) => groups.filter(g => g.name === name);
const plain = v => JSON.parse(JSON.stringify(v));

test('historical orders become one group per order key; repeat purchases of a bundle stay separate', () => {
  const {B} = load();
  const items = [historical('Spider-Man #1', 'ORDERA', 'Marvel Bundle'), historical('Spider-Man #2', 'ORDERA', 'Marvel Bundle'),
    historical('Spider-Man #1', 'ORDERB', 'Marvel Bundle', {purchasedAt: '2025-01-01T00:00:00.000Z'}), historical('Hades', 'ORDERC', 'Store', {kind: 'game'})];
  const {groups} = B.buildGroups({items, purchaseSummaries: [{purchaseKey: 'ORDERA', sourceBundle: 'Marvel Bundle', purchasedAt: '2024-03-01T00:00:00.000Z', itemCount: 3}], entitlements: undefined});
  const marvel = byName(groups, 'Marvel Bundle');
  assert.equal(marvel.length, 2, 'two orders of the same bundle are two purchase groups');
  assert(marvel.every(g => g.sameNamePurchases === 2 && g.source === 'historical' && g.orderRecorded && g.route === null));
  const a = marvel.find(g => g.key === 'h:ORDERA');assert.deepEqual(plain(a.items.map(i => i.title)), ['Spider-Man #1', 'Spider-Man #2']);assert.equal(a.listedCount, 3);
  assert.equal(byName(groups, 'Store')[0].media, 'game');
});

test('provenance places one title in each order it came from, keeps distinct copies, and groups key-less records by name only when nothing else exists', () => {
  const {B} = load();
  const shared = {title: 'Saga Vol. 1', kind: 'comic', provenance: [{purchaseKey: 'K1', sourceBundle: 'Image Bundle'}, {purchaseKey: 'K2', sourceBundle: 'Saga Bundle'}]};
  const copies = [historical('Twin', 'K3', 'Copies'), historical('Twin', 'K3', 'Copies')];
  const legacy = {title: 'Old Book', kind: 'book', sourceBundle: 'Legacy Bundle'};
  const {groups} = B.buildGroups({items: [shared, ...copies, legacy, 'Manual title']});
  assert.deepEqual(plain(groups.filter(g => g.items.some(i => i.title === 'Saga Vol. 1')).map(g => g.key).sort()), ['h:K1', 'h:K2']);
  assert.equal(groups.find(g => g.key === 'h:K3').items.length, 2, 'two stored copies stay two entries');
  const keyless = groups.find(g => g.name === 'Legacy Bundle');assert.equal(keyless.orderRecorded, false);assert.equal(keyless.key, 'hn:legacy bundle');
  assert(!groups.some(g => g.items.some(i => i.title === 'Manual title')), 'manual titles have no purchase group');
});

test('native groups are per parent ID for the active account only, and need the enabled collector', () => {
  const {E, B} = load();
  const obs = [nativeObservation(E, {id: 1, parent: 100, title: 'Celeste', namespace: 'steam', parentTitle: 'Indie Bundle'}), nativeObservation(E, {id: 2, parent: 100, title: 'Gift', gifted: true, parentTitle: 'Indie Bundle'}),
    nativeObservation(E, {id: 3, parent: 200, title: 'Store item', parentType: 'storefront'}), nativeObservation(E, {id: 4, parent: 300, title: 'Widget item', parentType: 'widget', parentTitle: 'Indie Bundle'})];
  const model = B.buildGroups({items: [], libraryEntitlements: entitlements(obs, ACCOUNT, null), humbleAccountId: ACCOUNT});
  assert.equal(model.native.present, true);assert.equal(model.groups.length, 3);
  const indie = model.groups.find(g => g.parentId === uuid(100));
  assert.equal(indie.type, 'bundle');assert.equal(indie.excluded, 1);assert.equal(indie.route, 'https://www.humblebundle.com/home/library/' + uuid(100));
  const celeste = indie.items.find(i => i.title === 'Celeste');assert.equal(celeste.activation, 'unknown');assert.equal(celeste.route, 'https://www.humblebundle.com/home/library/content/' + uuid(1));
  assert.equal(indie.items.find(i => i.title === 'Gift').status, 'excluded');
  const store = model.groups.find(g => g.parentId === uuid(200));assert.equal(store.type, 'store');assert.equal(store.name, null, 'an unsynced parent name is not invented');assert.equal(store.media, 'unknown');
  assert.equal(model.groups.find(g => g.parentId === uuid(300)).sameNamePurchases, 2, 'two parents with one name are two native purchases');
  for (const other of [{humbleAccountId: '22222222-2222-4222-8222-222222222222'}, {humbleAccountId: null}]) assert.equal(B.buildGroups({libraryEntitlements: entitlements(obs), ...other}).groups.length, 0, 'other accounts and profiles see nothing');
  const disabled = load({enabled: false});
  assert.equal(disabled.B.buildGroups({libraryEntitlements: entitlements(obs), humbleAccountId: ACCOUNT}).groups.length, 0, 'the disabled collector shows no native groups');
  assert.equal(B.buildGroups({libraryEntitlements: {version: 1, scopes: 'broken'}, humbleAccountId: ACCOUNT}).native.error, true);
});

test('historical and native purchases with identical names are never merged and are marked unconfirmed', () => {
  const {E, B} = load();
  const model = B.buildGroups({items: [historical('Celeste', 'K9', 'Indie Bundle', {kind: 'game'})], libraryEntitlements: entitlements([nativeObservation(E, {id: 1, parent: 100, title: 'Celeste', namespace: 'steam', parentTitle: 'Indie Bundle'})]), humbleAccountId: ACCOUNT});
  assert.equal(model.groups.length, 2);assert(model.groups.every(g => g.sharedNameUnconfirmed && g.sameNamePurchases === 1));
  assert.deepEqual(plain(model.groups.map(g => g.source).sort()), ['historical', 'native']);
});

test('search, filters and sorts answer bundle questions without inventing data', () => {
  const {E, B} = load();
  const items = [historical('Amazing Spider-Man #1', 'K1', 'Marvel Bundle', {kind: 'comic'}), historical('Hades', 'K2', 'Spider Games', {kind: 'game', purchasedAt: '2023-01-01T00:00:00.000Z'}),
    historical('Hades', 'K3', 'Store', {kind: 'game', purchasedAt: null}), historical('Manual', 'K4', 'Mixed', {kind: 'software'}), historical('Comic', 'K4', 'Mixed', {kind: 'comic'})];
  const model = B.buildGroups({items, libraryEntitlements: entitlements([nativeObservation(E, {id: 1, parent: 100, title: 'Spider-Man Remastered', namespace: 'steam'})]), humbleAccountId: ACCOUNT});
  const names = r => plain(r.map(x => x.group.name ?? '(unnamed)'));
  const byTitle = B.filterGroups(model.groups, {search: 'spider-man', scope: 'title'});
  assert.deepEqual(names(byTitle), ['Marvel Bundle', '(unnamed)']);assert.deepEqual(plain(byTitle[0].matches), [0]);assert.equal(byTitle[0].nameMatch, false);
  assert.deepEqual(names(B.filterGroups(model.groups, {search: 'spider', scope: 'bundle'})), ['Spider Games']);
  assert.deepEqual(names(B.filterGroups(model.groups, {search: 'spider', scope: 'both'})), ['Marvel Bundle', 'Spider Games', '(unnamed)']);
  assert.deepEqual(names(B.filterGroups(model.groups, {search: 'hades', scope: 'title'})), ['Spider Games', 'Store'], 'every purchase containing a title is listed');
  assert.deepEqual(names(B.filterGroups(model.groups, {media: 'mixed'})), ['Mixed']);
  assert.deepEqual(names(B.filterGroups(model.groups, {media: 'game'})), ['Spider Games', 'Store', '(unnamed)']);
  assert.deepEqual(names(B.filterGroups(model.groups, {media: 'unknown'})), []);
  assert.deepEqual(names(B.filterGroups(model.groups, {filter: 'native'})), ['(unnamed)']);
  assert.deepEqual(names(B.filterGroups(model.groups, {type: 'bundle'})), ['(unnamed)'], 'historical purchases have no recorded type');
  const dated = names(B.filterGroups(model.groups, {sort: 'date-desc'}));assert.deepEqual(dated.slice(0, 3), ['Marvel Bundle', 'Mixed', 'Spider Games'], 'newest first, ties by name');
  assert.deepEqual(dated.slice(3), ['Store', '(unnamed)'], 'undated groups follow, named before unnamed');
  assert.equal(names(B.filterGroups(model.groups, {sort: 'count-desc'}))[0], 'Mixed');
  assert.deepEqual(names(B.filterGroups(model.groups, {sort: 'name-desc'})).slice(0, 2), ['Store', 'Spider Games']);
});

test('routes are built only from native UUIDs; historical order keys get none', () => {
  const {B} = load();
  assert.equal(B.purchaseRoute(uuid(5)), 'https://www.humblebundle.com/home/library/' + uuid(5));
  assert.equal(B.entitlementRoute(uuid(6)), 'https://www.humblebundle.com/home/library/content/' + uuid(6));
  for (const bad of ['ORDERKEY123', '../keys', uuid(5) + '/x', '', null, 5]) { assert.equal(B.purchaseRoute(bad), null); assert.equal(B.entitlementRoute(bad), null); }
  assert.equal(B.buildGroups({items: [historical('A', 'ORDERKEY123', 'B')]}).groups[0].route, null);
});

test('long and unusual names stay plain text and inputs are never mutated', () => {
  const {B} = load();
  const odd = '<img src=x onerror=alert(1)> 🦊 עִברִית ' + 'x'.repeat(400);
  const items = [historical(odd, 'K1', odd, {purchasedAt: null})], summaries = [{purchaseKey: 'K1', sourceBundle: odd, purchasedAt: 'not a date', itemCount: 1}];
  const before = JSON.stringify({items, summaries});
  const [g] = B.buildGroups({items, purchaseSummaries: summaries}).groups;
  assert.equal(g.name, odd);assert.equal(g.purchasedAt, null, 'an unparseable date stays unknown');assert.equal(B.filterGroups([g], {search: '🦊', scope: 'bundle'}).length, 1);
  assert.equal(JSON.stringify({items, summaries}), before);
});

test('thousands of titles and hundreds of groups build and search quickly', () => {
  const {E, B} = load();
  const items = Array.from({length: 7000}, (_, i) => historical(`Title ${i}`, `K${i % 240}`, `Bundle ${i % 240}`, {kind: i % 3 ? 'comic' : 'game'}));
  const summaries = Array.from({length: 240}, (_, i) => ({purchaseKey: `K${i}`, sourceBundle: `Bundle ${i}`, purchasedAt: '2024-01-01T00:00:00.000Z', itemCount: 30}));
  const obs = Array.from({length: 8233}, (_, i) => nativeObservation(E, {id: i + 1, parent: 1000 + i % 226, title: `Native ${i}`, namespace: i % 19 ? 'download_drm_free' : 'steam', parentTitle: `Bundle ${i % 226}`}));
  const libraryEntitlements = entitlements(obs);
  let t = performance.now();
  const model = B.buildGroups({items, purchaseSummaries: summaries, libraryEntitlements, humbleAccountId: ACCOUNT});
  const build = performance.now() - t;
  assert.equal(model.groups.length, 240 + 226);
  t = performance.now();
  for (const [search, scope] of [['title 12', 'title'], ['bundle 1', 'bundle'], ['native 9', 'both'], ['', 'both']]) B.filterGroups(model.groups, {search, scope, sort: 'count-desc'});
  const search = (performance.now() - t) / 4;
  console.log(`# browser model: build ${build.toFixed(0)} ms for 7,000 titles + 8,233 native entitlements; search ${search.toFixed(1)} ms per query`);
  assert(build < 3000, 'build ' + build);assert(search < 200, 'search ' + search);
});
