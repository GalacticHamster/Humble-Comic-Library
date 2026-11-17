import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {ACCOUNT, nativeObservation, entitlements} from './library-browser-fixture.mjs';

// Which storage changes let a bundle page keep its results. Synthetic records only.
const context = vm.createContext({URL, Blob, Promise, Intl, Date, TextEncoder, TextDecoder, crypto: webcrypto, setTimeout, clearTimeout, console, performance: {now: () => 0},
  document: {title: '', querySelector: () => null, querySelectorAll: () => []}, location: {pathname: '/'}});
context.globalThis = context;
for (const file of ['library-entitlements.js', 'library-browser.js', 'shared.js', 'collection-mappings.js', 'ownership.js', 'content.js'])
  vm.runInContext(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context, {filename: file});
const E = context.HumbleLibraryEntitlements, unchanged = (changes, account = ACCOUNT) => context.onlySyncProgressChanged(changes, account);
const copy = v => JSON.parse(JSON.stringify(v));
const library = () => entitlements([1, 2, 3].map(n => nativeObservation(E, {id: n, parent: 9, title: 'Synthetic ' + n, parentTitle: 'Synthetic Bundle'})));
const edit = (fn, base = library()) => { const next = copy(base); fn(next.scopes[0]); return {libraryEntitlements: {oldValue: base, newValue: next}}; };

test('sync progress alone keeps bundle-page results: refreshed observation times, scan details, unchanged first-seen times', () => {
  assert.equal(unchanged(edit(s => { for (const r of s.observations) r.observedAt = '2026-11-17T00:00:00.000Z'; })), true);
  assert.equal(unchanged(edit(s => { s.lastScan = {checkedAt: '2026-11-17T00:00:00.000Z'}; })), true);
  // Another account's records do not affect this account's results.
  const two = library();two.scopes.push({...copy(two.scopes[0]), principalId: 'principal-B', userId: 'hub-B', localAccountId: '22222222-2222-4222-8222-222222222222'});
  assert.equal(unchanged({libraryEntitlements: {oldValue: two, newValue: (() => { const n = copy(two);n.scopes[1].observations.pop();return n; })()}}), true);
});

test('any change to what matching reads rebuilds: new, removed, renamed, regrouped, reclassified or excluded entitlements', () => {
  const added = nativeObservation(E, {id: 4, parent: 10, title: 'Synthetic 4', parentTitle: 'Another Bundle'});
  for (const [label, fn] of [
    ['a new entitlement', s => s.observations.push(copy(added))],
    ['a removed entitlement', s => s.observations.pop()],
    ['a renamed title', s => { s.observations[0].title = 'Renamed'; }],
    ['a renamed purchase', s => { s.observations[0].parentTitle = 'Renamed Bundle'; }],
    ['a different purchase', s => { s.observations[0].parentId = added.parentId; }],
    ['different media', s => { s.observations[0].mediaType = 'comic'; }],
    ['a gifted entitlement', s => { s.observations[0].eligibility.giftStatus = 'gifted';s.observations[0].purchaseStatus = 'excluded'; }],
    ['a new first-seen time', s => { s.observations[0].firstObservedAt = s.observations[0].observedAt; }]
  ]) assert.equal(unchanged(edit(fn)), false, label);
});

test('anything uncertain rebuilds: other library keys, a missing previous value, no active account', () => {
  const progress = edit(s => { for (const r of s.observations) r.observedAt = '2026-11-17T00:00:00.000Z'; });
  for (const key of ['humbleAccountId', 'libraryItems', 'historicalLibraryItems', 'humbleProfileLabel', 'purchaseSummaries', 'customCollectionMappings', 'galacticLibraryExtensionId'])
    assert.equal(unchanged({...progress, [key]: {oldValue: null, newValue: 'x'}}), false, key);
  assert.equal(unchanged({libraryEntitlements: {newValue: library()}}), false, 'no previous value to compare');
  assert.equal(unchanged(progress, null), false, 'no active account');
  assert.equal(unchanged({wishlistItems: {newValue: []}}), false, 'not a library change');
});
