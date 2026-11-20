import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Media corrections for titles that exist only in the Humble Library sync (WP-01).
const copy = value => JSON.parse(JSON.stringify(value));
const ACCOUNT = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const scope = {principalId: 'principal-A', userId: 'hub-A'};

function load(initial = {}) {
  let stored = copy(initial);
  const area = {
    get: async defaults => ({...copy(defaults), ...copy(stored)}),
    set: async patch => { stored = {...stored, ...copy(patch)}; },
    remove: async keys => { for (const key of [keys].flat()) delete stored[key]; }
  };
  const context = vm.createContext({console, URL, TextEncoder, TextDecoder, Date, crypto: webcrypto, setTimeout, clearTimeout, structuredClone});
  context.globalThis = context;
  for (const file of ['purchase-sync.js', 'library-entitlements.js', 'shared.js', 'collection-mappings.js', 'library-browser.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, {filename: file});
  }
  const H = context.HumbleComicLibrary, E = context.HumbleLibraryEntitlements, B = context.HumbleLibraryBrowser;
  return {H, E, B, store: H.createSyncStore(area), get stored() { return stored; }, set stored(value) { stored = copy(value); }};
}
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function observation(E, n, title, {namespace = 'download_drm_free', parent = 1001, observedAt = '2026-01-01T00:00:00.000Z'} = {}) {
  return E.observation({scope, nativeId: uuid(n), namespace, title, parentId: uuid(parent), parentTitle: 'Synthetic Mixed Bundle', source: 'authenticated-humble-library', observedAt,
    eligibility: {expired: false, preOrdered: false, outOfStock: false, redeemable: true, directRedeem: false, parentPreOrder: false, revoked: null,
      temporaryAccess: null, giftStatus: 'unassigned', parentType: 'bundle', integration: 'none', redemptionGroups: 'none',
      unavailableBefore: {state: 'none', value: null}, unavailableAfter: {state: 'none', value: null}, redeemedAt: {state: 'none', value: null}}});
}
function state(E, extra = {}) {
  // Two copies of one unknown-media title (a repeat purchase) and an unrelated title with the same name in another account.
  const observations = [observation(E, 1, 'Synthetic Unknown Media'), observation(E, 2, 'Synthetic Unknown Media', {parent: 1002}), observation(E, 3, 'Synthetic Other Title')];
  return {humbleAccountId: ACCOUNT, humbleProfileLabel: 'Main', libraryItems: [], profileArchives: [], mediaTypeOverrides: {},
    libraryEntitlements: {version: 1, scopes: [
      {...scope, localAccountId: ACCOUNT, profileLabel: 'Main', observations, lastScan: null, sync: null},
      {principalId: 'principal-B', userId: 'hub-B', localAccountId: OTHER, profileLabel: 'Other', lastScan: null, sync: null,
        observations: [E.observation({...copy(observations[0]), scope: {principalId: 'principal-B', userId: 'hub-B'}, nativeId: uuid(9)})]}
    ]}, ...extra};
}
const refs = [{namespace: 'download_drm_free', nativeId: uuid(1)}, {namespace: 'download_drm_free', nativeId: uuid(2)}];

test('a Library-only title with unknown media can be corrected for its own entitlements', async () => {
  const t = load(), s = state(t.E);
  t.stored = s;
  assert.equal(copy(t.E.matchingItems(s)).length, 0, 'unknown media is not used for bundle-page checks');
  await t.store.execute('setNativeMediaOverride', [refs, 'book']);
  const saved = t.stored;
  assert.deepEqual(saved.mediaTypeOverrides, {[`native:download_drm_free:${uuid(1)}`]: 'book', [`native:download_drm_free:${uuid(2)}`]: 'book'});
  const matching = copy(t.E.matchingItems(saved));
  assert.deepEqual(matching.map(item => [item.title, item.kind]), [['Synthetic Unknown Media', 'book']], 'the corrected title joins bundle-page checks; the other title is unchanged');
  assert.equal(matching[0].libraryObservationRefs.length, 2, 'both purchases of the title keep counting');
  assert.equal(copy(saved.libraryEntitlements.scopes[0].observations[0]).mediaType, 'unknown', 'the provider observation is not rewritten');
  const shared = copy(t.E.companionRecords({libraryEntitlements: saved.libraryEntitlements, accountId: ACCOUNT, mediaTypeOverrides: saved.mediaTypeOverrides}));
  assert.deepEqual(shared.records.map(r => [r.title, r.mediaType]), [['Synthetic Unknown Media', 'book'], ['Synthetic Unknown Media', 'book']]);
  assert.equal(shared.unknown, 1);
  const other = copy(t.E.matchingItems({...saved, humbleAccountId: OTHER, humbleProfileLabel: 'Other'}));
  assert.deepEqual(other, [], "another account's entitlement with the same title is not corrected");
});

test('corrections survive syncs, backups and restore, and Reset returns to automatic', async () => {
  const t = load(), s = state(t.E);
  t.stored = s;
  await t.store.execute('setNativeMediaOverride', [refs, 'game']);
  // A later sync replaces the observations with newer copies of the same entitlements.
  const resynced = copy(t.stored);
  resynced.libraryEntitlements.scopes[0].observations = resynced.libraryEntitlements.scopes[0].observations.map(o => ({...o, observedAt: '2026-06-01T00:00:00.000Z'}));
  assert.deepEqual(copy(t.E.matchingItems(resynced)).map(item => item.kind), ['game']);
  const backup = t.H.createLibraryBackup(t.stored), restored = copy(t.H.restoreBackupState(backup));
  assert.equal(restored.mediaTypeOverrides[`native:download_drm_free:${uuid(1)}`], 'game');
  const fresh = load();
  fresh.stored = {};
  await fresh.store.execute('restore', [backup]);
  assert.deepEqual(copy(fresh.E.matchingItems(fresh.stored)).map(item => item.kind), ['game']);
  await t.store.execute('setNativeMediaOverride', [refs, null]);
  assert.deepEqual(t.stored.mediaTypeOverrides, {});
  assert.deepEqual(copy(t.E.matchingItems(t.stored)), []);
});

test('Options lists the correction and the automatic media for Library-only titles', async () => {
  const t = load(), s = state(t.E, {mediaTypeOverrides: {[`native:download_drm_free:${uuid(1)}`]: 'book', [`native:download_drm_free:${uuid(2)}`]: 'book'}});
  const model = t.B.buildGroups({items: [], purchaseSummaries: [], libraryEntitlements: s.libraryEntitlements, humbleAccountId: ACCOUNT, mediaTypeOverrides: s.mediaTypeOverrides});
  const titles = copy(t.B.nativeOnlyTitles(model, [], null));
  const corrected = titles.find(title => title.title === 'Synthetic Unknown Media');
  assert.equal(corrected.kind, 'book');
  assert.deepEqual(corrected.nativeCopies.map(c => [c.nativeId, c.manualKind, c.automaticKind]), [[uuid(1), 'book', 'unknown'], [uuid(2), 'book', 'unknown']]);
  assert.equal(titles.find(title => title.title === 'Synthetic Other Title').nativeCopies[0].manualKind, undefined);
});

test('corrections are rejected for entitlements outside the active account', async () => {
  const t = load(), s = state(t.E);
  t.stored = s;
  await assert.rejects(t.store.execute('setNativeMediaOverride', [[{namespace: 'download_drm_free', nativeId: uuid(9)}], 'book']), /changed/);
  await assert.rejects(t.store.execute('setNativeMediaOverride', [refs, 'not-a-kind']), /Unsupported/);
  assert.deepEqual(t.stored.mediaTypeOverrides, {});
});
