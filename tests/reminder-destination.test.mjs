import test from 'node:test';
import assert from 'node:assert/strict';
import {load, uuid, nativeObservation, entitlements, ACCOUNT} from './library-browser-fixture.mjs';

const plain = v => JSON.parse(JSON.stringify(v));
const order = (key, name, titles, extra = {}) => titles.map(title => ({title, kind: 'game', source: 'humble', purchaseKey: key, sourceBundle: name, purchasedAt: extra.purchasedAt ?? '2024-03-01T00:00:00.000Z'}));
let nextId = 1;
const purchase = (E, parent, name, titles, extra = {}) => titles.map(title => nativeObservation(E, {id: nextId++, parent, title, parentTitle: name, namespace: 'steam', ...extra}));
const reminder = (purchaseKey, title, keyType = 'Steam') => ({id: purchaseKey + ':' + title, purchaseKey, title, sourceBundle: 'x', keyType, status: 'unrevealed', directRedeem: false, isExpired: false, checkedAt: '2026-01-01T00:00:00.000Z'});
const LIBRARY = 'https://www.humblebundle.com/home/library';
function setup(items, obs) {
  const {B} = load();
  const model = B.buildGroups({items, libraryEntitlements: entitlements(obs), humbleAccountId: ACCOUNT});
  return {B, groups: B.reconcile(model.groups).groups};
}

test('a single likely purchase with exactly one matching key opens that Library item', () => {
  const {E} = load();
  const obs = [...purchase(E, 100, 'Indie Bundle', ['Celeste', 'Hades']), ...purchase(E, 100, 'Indie Bundle', ['Celeste'], {namespace: 'download_drm_free'})];
  const {B, groups} = setup(order('K1', 'Indie Bundle', ['Celeste', 'Hades']), obs);
  const r = reminder('K1', 'Celeste'), before = JSON.stringify(r), snapshot = JSON.stringify(groups.map(g => g.key));
  const d = B.reminderDestination(r, groups);
  assert.deepEqual(plain(d), {name: 'Indie Bundle', likely: true, kind: 'entitlement', url: 'https://www.humblebundle.com/home/library/content/' + obs[0].nativeId});
  assert.equal(JSON.stringify(r), before, 'the reminder is not changed');assert.equal(JSON.stringify(groups.map(g => g.key)), snapshot);
});

test('a likely purchase without one unambiguous key opens the purchase, never a guessed item', () => {
  const {E} = load();
  const obs = [...purchase(E, 100, 'Indie Bundle', ['Celeste', 'Celeste', 'Hades']), ...purchase(E, 101, 'Puzzle Pack', ['Baba'], {namespace: 'download_drm_free'}), ...purchase(E, 101, 'Puzzle Pack', ['Gift'], {gifted: true})];
  const items = [...order('K1', 'Indie Bundle', ['Celeste', 'Hades']), ...order('K2', 'Puzzle Pack', ['Baba', 'Gift'])];
  const {B, groups} = setup(items, obs);
  const parent = n => LIBRARY + '/' + uuid(n);
  assert.deepEqual(plain(B.reminderDestination(reminder('K1', 'Celeste'), groups)), {name: 'Indie Bundle', likely: true, kind: 'purchase', url: parent(100)}, 'two copies of the key');
  assert.equal(B.reminderDestination(reminder('K1', 'Missing title'), groups).url, parent(100));
  assert.equal(B.reminderDestination(reminder('K2', 'Baba'), groups).kind, 'purchase', 'a DRM-free download is not the key');
  assert.equal(B.reminderDestination(reminder('K2', 'Gift'), groups).kind, 'purchase', 'a gifted copy is never the destination');
  assert.equal(B.reminderDestination(reminder('K1', 'Hades', 'Origin'), groups).kind, 'entitlement', 'non-Steam key types still require one matching item');
});

test('a renamed store purchase links through its likely match and says which purchase it is', () => {
  const {E} = load();
  const obs = purchase(E, 200, 'Hollow Knight: Voidheart Edition', ['Hollow Knight', 'Soundtrack'], {parentType: 'storefront'});
  const {B, groups} = setup(order('K9', 'Hollow Knight', ['Hollow Knight']), obs);
  const d = B.reminderDestination(reminder('K9', 'Hollow Knight'), groups);
  assert.equal(d.kind, 'entitlement');assert.equal(d.likely, true);assert.equal(d.name, 'Hollow Knight: Voidheart Edition');
});

test('repeat purchases, ambiguous orders and orders without a Library counterpart open the Library itself', () => {
  const {E} = load();
  const items = [...order('R1', 'Monthly', ['A']), ...order('R2', 'Monthly', ['A']), ...order('P1', 'Pair', ['P']), ...order('U1', 'Old Order', ['Gone']), ...order('C1', 'Clash', ['K', 'L', 'M'])];
  const obs = [...purchase(E, 1, 'Monthly', ['A']), ...purchase(E, 2, 'Monthly', ['A']), ...purchase(E, 3, 'Pair', ['P']), ...purchase(E, 4, 'Pair', ['P']), ...purchase(E, 5, 'Clash', ['T', 'U', 'V'])];
  const {B, groups} = setup(items, obs);
  const reason = key => { const d = B.reminderDestination(reminder(key, 'A'), groups); assert.equal(d.url, LIBRARY);assert.equal(d.kind, 'library');assert.equal(d.name, undefined); return d.reason; };
  assert.deepEqual([reason('R1'), reason('R2'), reason('P1'), reason('U1'), reason('C1'), reason('never-imported')], ['repeat', 'repeat', 'ambiguous', 'unmatched', 'conflicting', 'no-record']);
  assert.equal(B.reminderDestination(reminder('R1', 'A'), null).reason, 'not-synced', 'without Library records nothing is inferred');
});

test('another account’s Library records never provide a reminder destination', () => {
  const {E, B} = load();
  const model = B.buildGroups({items: order('K1', 'Indie Bundle', ['Celeste']), libraryEntitlements: entitlements(purchase(E, 100, 'Indie Bundle', ['Celeste']), '22222222-2222-4222-8222-222222222222'), humbleAccountId: ACCOUNT});
  assert.equal(model.native.present, false);
  assert.equal(B.reminderDestination(reminder('K1', 'Celeste'), B.reconcile(model.groups).groups).kind, 'library');
});
