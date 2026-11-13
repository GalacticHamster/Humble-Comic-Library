import test from 'node:test';
import assert from 'node:assert/strict';
import {load, uuid, nativeObservation, entitlements, ACCOUNT} from './library-browser-fixture.mjs';

const plain = v => JSON.parse(JSON.stringify(v));
const order = (key, name, titles, extra = {}) => titles.map(title => ({title, kind: 'comic', source: 'humble', purchaseKey: key, sourceBundle: name, purchasedAt: extra.purchasedAt ?? '2024-03-01T00:00:00.000Z', ...extra.item}));
let nextId = 1;
const purchase = (E, parent, name, titles, extra = {}) => titles.map(title => nativeObservation(E, {id: nextId++, parent, title, parentTitle: name, ...extra}));
function run({items = [], obs = [], account = ACCOUNT, shuffle = false} = {}) {
  const {B} = load();
  const model = B.buildGroups({items, libraryEntitlements: entitlements(obs, account), humbleAccountId: ACCOUNT});
  const groups = shuffle ? [...model.groups].reverse() : model.groups;
  return {B, model, r: B.reconcile(groups)};
}
const unified = r => r.groups.filter(g => g.source === 'unified');
const state = (r, source, name) => r.groups.filter(g => g.source === source && g.name === name).map(g => g.matchState);

test('a unique same-name purchase with shared contents becomes one presentation group that keeps both identities', () => {
  const {E} = load();
  const items = [...order('K1', 'Marvel Bundle', ['Spider-Man #1', 'Hulk #1', 'Thor #1']), ...order('K1', 'Marvel Bundle', ['Spider-Man #1'])];
  const obs = purchase(E, 100, 'Marvel Bundle', ['Spider-Man #1', 'Hulk #1', 'Thor #1', 'Bonus Wallpaper']);
  const {r} = run({items, obs});
  assert.equal(r.stats.matched, 1);assert.equal(r.groups.length, 1);
  const [g] = unified(r);
  assert.equal(g.historical.key, 'h:K1');assert.equal(g.native.parentId, uuid(100));assert.equal(g.route, 'https://www.humblebundle.com/home/library/' + uuid(100));
  assert.equal(g.purchasedAt, Date.parse('2024-03-01T00:00:00.000Z'), 'the historical date is kept');
  assert.deepEqual(plain(g.items.map(i => [i.title, i.source])), [['Bonus Wallpaper', 'native'], ['Hulk #1', 'both'], ['Spider-Man #1', 'both'], ['Thor #1', 'both']]);
  assert.equal(g.items.find(i => i.title === 'Spider-Man #1').historicalRecords, 2, 'a repeated historical record is counted, not listed twice');
  assert.equal(g.onlyNative, 1);assert.equal(g.items.find(i => i.title === 'Hulk #1').kind, 'comic', 'the historical classification is shown, not transferred');
  assert.equal(g.items.find(i => i.title === 'Hulk #1').route, 'https://www.humblebundle.com/home/library/content/' + obs[1].nativeId);
});

test('two native copies of one title stay two entries even when history lists it once', () => {
  const {E} = load();
  const {r} = run({items: order('K1', 'Copies', ['Twin', 'Solo']), obs: purchase(E, 100, 'Copies', ['Twin', 'Twin', 'Solo'])});
  const [g] = unified(r);
  assert.deepEqual(plain(g.items.map(i => [i.title, i.source])), [['Solo', 'both'], ['Twin', 'both'], ['Twin', 'native']]);
});

test('names alone never combine purchases; content evidence decides', () => {
  const {E} = load();
  const items = [...order('K1', 'Partial', ['A', 'B', 'C', 'D', 'E']), ...order('K2', 'Weak', ['F', 'G', 'H', 'I', 'J']), ...order('K3', 'Clash', ['K', 'L', 'M', 'N'])];
  const obs = [...purchase(E, 101, 'Partial', ['A', 'B', 'C', 'X', 'Y']), ...purchase(E, 102, 'Weak', ['F', 'G', 'Q', 'R', 'S']), ...purchase(E, 103, 'Clash', ['T', 'U', 'V', 'W'])];
  const {r} = run({items, obs});
  assert.equal(unified(r).map(g => g.name).join(), 'Partial', '3 of 5 shared titles under the same name is a strong partial match');
  assert.deepEqual(plain([...state(r, 'historical', 'Weak'), ...state(r, 'native', 'Weak')]), ['unmatched', 'unmatched'], '2 of 5 is not enough');
  assert.deepEqual(plain([...state(r, 'historical', 'Clash'), ...state(r, 'native', 'Clash')]), ['conflicting', 'conflicting'], 'same name, different contents');
});

test('a smaller bundle nested in a larger, differently named bundle is not combined; a renamed store purchase is', () => {
  const {E} = load();
  const items = [...order('K1', 'Starter Pack', ['A', 'B', 'C']), ...order('K2', 'Hollow Knight', ['Hollow Knight'], {item: {kind: 'game'}})];
  const obs = [...purchase(E, 101, 'Mega Collection', ['A', 'B', 'C', 'D', 'E']), ...purchase(E, 102, 'Hollow Knight: Voidheart Edition', ['Hollow Knight', 'Soundtrack'], {parentType: 'storefront'})];
  const {r} = run({items, obs});
  const [g] = unified(r);
  assert.equal(r.stats.matched, 1);assert.equal(g.type, 'store');assert.equal(g.evidence.sameName, false);assert.equal(g.historicalName, 'Hollow Knight');
  assert.deepEqual(plain(state(r, 'historical', 'Starter Pack')), ['unmatched']);
});

test('repeat purchases: interchangeable copies pair in a fixed order, elimination resolves siblings, and an uneven set stays ambiguous', () => {
  const {E} = load();
  const items = [...order('K1', 'Monthly', ['A', 'B'], {purchasedAt: '2024-02-01T00:00:00.000Z'}), ...order('K2', 'Monthly', ['A', 'B'], {purchasedAt: '2024-01-01T00:00:00.000Z'}),
    ...order('K3', 'Saga', ['S1']), ...order('K4', 'Saga', ['S1', 'S2', 'S3', 'S4']), ...order('K5', 'Pair', ['P'])];
  const obs = [...purchase(E, 201, 'Monthly', ['A', 'B']), ...purchase(E, 202, 'Monthly', ['A', 'B']),
    ...purchase(E, 301, 'Saga', ['S1', 'S9']), ...purchase(E, 302, 'Saga', ['S1', 'S2', 'S3', 'S4']), ...purchase(E, 401, 'Pair', ['P']), ...purchase(E, 402, 'Pair', ['P'])];
  const {r} = run({items, obs});
  const monthly = unified(r).filter(g => g.name === 'Monthly').sort((a, b) => a.purchasedAt - b.purchasedAt);
  assert.deepEqual(plain(monthly.map(g => [g.historical.key, g.native.parentId, g.evidence.interchangeable])), [['h:K2', uuid(201), 2], ['h:K1', uuid(202), 2]]);
  assert.deepEqual(plain(unified(r).filter(g => g.name === 'Saga').map(g => g.historical.key + '>' + g.native.parentId).sort()), ['h:K3>' + uuid(301), 'h:K4>' + uuid(302)]);
  assert.deepEqual(plain([...state(r, 'historical', 'Pair'), ...state(r, 'native', 'Pair')]), ['ambiguous', 'ambiguous', 'ambiguous']);
  assert(unified(r).every(g => g.sameNamePurchases === 2), 'combined repeats still count as separate purchases');
});

test('reconciliation is deterministic for any input order and never crosses accounts', () => {
  const {E} = load();
  const items = [...order('K1', 'One', ['A', 'B']), ...order('K2', 'Two', ['C']), ...order('K3', 'Two', ['C'])];
  const obs = [...purchase(E, 1, 'One', ['A', 'B']), ...purchase(E, 2, 'Two', ['C']), ...purchase(E, 3, 'Two', ['C'])];
  const key = res => plain(unified(res.r).map(g => g.key).sort());
  assert.deepEqual(key(run({items, obs})), key(run({items, obs, shuffle: true})));
  assert.deepEqual(key(run({items: [...items].reverse(), obs: [...obs].reverse()})), key(run({items, obs})));
  assert.equal(run({items, obs, account: '22222222-2222-4222-8222-222222222222'}).r.stats.matched, 0);
});

test('gifts stay excluded, Steam activation stays unknown and source filters keep their meaning', () => {
  const {E} = load();
  const items = [...order('K1', 'Indie', ['Celeste'], {item: {kind: 'game'}}), ...order('K2', 'Old Order', ['Gone'])];
  const obs = [...purchase(E, 1, 'Indie', ['Celeste'], {namespace: 'steam'}), ...purchase(E, 1, 'Indie', ['Gift'], {namespace: 'steam', gifted: true}), ...purchase(E, 3, 'New Only', ['Fresh'])];
  const {B, r} = run({items, obs});
  const [g] = unified(r);
  assert.equal(g.items.find(i => i.title === 'Gift').status, 'excluded');assert(g.items.filter(i => i.namespace === 'steam').every(i => i.activation === 'unknown'));
  const names = f => plain(B.filterGroups(r.groups, {filter: f}).map(x => x.group.name));
  assert.deepEqual(names('both'), ['Indie']);assert.deepEqual(names('historical'), ['Old Order']);assert.deepEqual(names('native'), ['New Only']);
  assert.deepEqual(plain(B.filterGroups(r.groups, {search: 'gift', scope: 'title'}).map(x => x.group.name)), ['Indie'], 'native-only items stay searchable');
});

test('reconciling a library at real scale stays fast and avoids all-pairs title comparison', () => {
  const {E, B} = load();
  const items = [], obs = [];
  for (let b = 0; b < 240; b++) {
    const titles = Array.from({length: 30}, (_, i) => `Bundle ${b} title ${i}`);
    items.push(...order('K' + b, `Bundle ${b}`, titles));
    if (b < 226) obs.push(...purchase(E, 5000 + b, `Bundle ${b}`, [...titles, `Bundle ${b} extra`]));
  }
  const model = B.buildGroups({items, libraryEntitlements: entitlements(obs), humbleAccountId: ACCOUNT});
  const t = performance.now(), r = B.reconcile(model.groups), ms = performance.now() - t;
  console.log(`# reconcile: ${ms.toFixed(0)} ms for 240 historical and 226 native groups (${items.length} + ${obs.length} titles)`);
  assert.equal(r.stats.matched, 226);assert.equal(r.groups.length, 240);assert(ms < 1500, String(ms));
});
