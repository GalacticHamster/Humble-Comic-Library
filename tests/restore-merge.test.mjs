import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Restore adds an older backup to newer saved data: nothing already saved is lost.
const copy = value => JSON.parse(JSON.stringify(value));
const ACCOUNT = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const scope = {principalId: 'principal-A', userId: 'hub-A'};

function load() {
  let stored = {};
  const area = {
    get: async defaults => ({...copy(defaults), ...copy(stored)}),
    set: async patch => { stored = {...stored, ...copy(patch)}; },
    remove: async keys => { for (const key of [keys].flat()) delete stored[key]; }
  };
  const context = vm.createContext({console, URL, TextEncoder, TextDecoder, Date, crypto: webcrypto, setTimeout, clearTimeout, structuredClone});
  context.globalThis = context;
  for (const file of ['purchase-sync.js', 'library-entitlements.js', 'shared.js', 'collection-mappings.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, {filename: file});
  }
  const H = context.HumbleComicLibrary, E = context.HumbleLibraryEntitlements, store = H.createSyncStore(area);
  return {H, E, area, store, get stored() { return stored; }, set stored(value) { stored = copy(value); }};
}

function observation(E, n, title, observedAt = '2026-01-01T00:00:00.000Z') {
  return E.observation({scope, nativeId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, namespace: 'steam', title,
    parentId: '00000000-0000-4000-8000-000000001001', parentTitle: 'Synthetic Bundle', source: 'authenticated-humble-library', observedAt,
    eligibility: {expired: false, preOrdered: false, outOfStock: false, redeemable: true, directRedeem: false, parentPreOrder: false, revoked: null,
      temporaryAccess: null, giftStatus: 'unassigned', parentType: 'bundle', integration: 'none', redemptionGroups: 'none',
      unavailableBefore: {state: 'none', value: null}, unavailableAfter: {state: 'none', value: null}, redeemedAt: {state: 'none', value: null}}});
}
const entitlements = (E, observations, lines = {}) => ({version: 1, scopes: [{...scope, localAccountId: ACCOUNT, profileLabel: 'Main', observations, lastScan: null, sync: null,
  orders: {lines, newest: null, checkedAt: null, resume: null}}]});
const review = (action, updatedAt, until = null) => ({action, basis: 'unrevealed', until, updatedAt});
const item = (title, purchaseKey) => ({title, kind: 'game', source: 'humble', sourceBundle: 'Synthetic Bundle', purchaseKey, provenance: [{title, sourceBundle: 'Synthetic Bundle', purchaseKey}]});

function older(E) {
  return {
    humbleAccountId: ACCOUNT, humbleProfileLabel: 'Main', profileArchives: [],
    libraryItems: [item('Shared Title', 'order-1'), item('Backup Only Title', 'order-0')],
    purchaseSummaries: [{purchaseKey: 'order-1', sourceBundle: 'Synthetic Bundle', itemCount: 1}, {purchaseKey: 'order-0', sourceBundle: 'Synthetic Bundle', itemCount: 1}],
    mediaTypeOverrides: {'game:shared title': 'book', 'game:backup only title': 'software'},
    libraryEntitlements: entitlements(E, [observation(E, 1, 'Native Old'), observation(E, 2, 'Native Shared')], {a: {name: 'Synthetic Bundle', at: '2025-01-01T12:00:00.000Z'}}),
    humbleKeyReviews: {'ref-dismissed-later': review('snoozed', '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z'), 'ref-backup-only': review('dismissed', '2026-01-02T00:00:00.000Z'), 'ref-backup-newer': review('dismissed', '2026-03-01T00:00:00.000Z')},
    wishlistItems: [{title: 'Old Wish', kind: 'game', weight: 1}, {title: 'Kept Wish', kind: 'game', weight: 1}]
  };
}
function newer(E) {
  return {
    humbleAccountId: ACCOUNT, humbleProfileLabel: 'Main', profileArchives: [],
    libraryItems: [item('Shared Title', 'order-1'), item('Newer Title', 'order-2')],
    purchaseSummaries: [{purchaseKey: 'order-1', sourceBundle: 'Synthetic Bundle', itemCount: 1}, {purchaseKey: 'order-2', sourceBundle: 'Synthetic Bundle', itemCount: 1}],
    mediaTypeOverrides: {'game:shared title': 'audiobook'},
    libraryEntitlements: entitlements(E, [observation(E, 2, 'Native Shared', '2026-02-01T00:00:00.000Z'), observation(E, 3, 'Native New', '2026-02-01T00:00:00.000Z')], {b: {name: 'Synthetic Bundle', at: '2026-02-01T12:00:00.000Z'}}),
    humbleKeyReviews: {'ref-dismissed-later': review('dismissed', '2026-02-01T00:00:00.000Z'), 'ref-backup-newer': review('active', '2026-02-01T00:00:00.000Z')},
    wishlistItems: [{title: 'Kept Wish', kind: 'game', weight: 9}, {title: 'New Wish', kind: 'book', weight: 2}]
  };
}

test('restoring an older backup keeps newer purchases, observations, wishes, corrections and review decisions', async () => {
  const t = load(), backup = t.H.createLibraryBackup(older(t.E));
  assert.equal(backup.version, 9, 'the backup version does not change');
  assert.deepEqual(copy(backup.wishlistItems).map(w => w.title), ['Old Wish', 'Kept Wish']);
  t.stored = newer(t.E);
  await t.store.execute('restore', [backup]);
  const s = t.stored;
  assert.equal(s.humbleAccountId, ACCOUNT);
  assert.deepEqual(s.libraryItems.map(i => i.title).sort(), ['Backup Only Title', 'Newer Title', 'Shared Title']);
  assert.deepEqual(s.purchaseSummaries.map(p => p.purchaseKey).sort(), ['order-0', 'order-1', 'order-2']);
  assert.deepEqual(s.mediaTypeOverrides, {'game:shared title': 'audiobook', 'game:backup only title': 'software'}, 'current corrections win; the backup adds missing ones');
  const observations = s.libraryEntitlements.scopes[0].observations;
  assert.deepEqual(observations.map(o => o.title).sort(), ['Native New', 'Native Old', 'Native Shared']);
  assert.equal(observations.find(o => o.title === 'Native Shared').observedAt, '2026-02-01T00:00:00.000Z');
  assert.deepEqual(Object.keys(s.libraryEntitlements.scopes[0].orders.lines).sort(), ['a', 'b']);
  assert.equal(s.humbleKeyReviews['ref-dismissed-later'].action, 'dismissed', 'a newer dismissal survives an older snooze');
  assert.equal(s.humbleKeyReviews['ref-backup-only'].action, 'dismissed', 'a review only in the backup is recovered');
  assert.equal(s.humbleKeyReviews['ref-backup-newer'].action, 'dismissed', 'a newer decision in the backup wins');
  assert.deepEqual(s.wishlistItems.map(w => [w.title, w.weight]).sort(), [['Kept Wish', 9], ['New Wish', 2], ['Old Wish', 1]]);
  assert.deepEqual(s.profileArchives, [], 'the same account is merged, not duplicated');

  const once = copy(s);
  await t.store.execute('restore', [backup]);
  for (const key of ['libraryItems', 'purchaseSummaries', 'mediaTypeOverrides', 'libraryEntitlements', 'humbleKeyReviews', 'wishlistItems', 'profileArchives']) assert.deepEqual(t.stored[key], once[key], `repeat restore is idempotent: ${key}`);
});

test('a current account that is not in the backup is kept as a saved account', async () => {
  const t = load(), backup = t.H.createLibraryBackup({...older(t.E), humbleAccountId: OTHER, humbleProfileLabel: 'Main', libraryEntitlements: {version: 1, scopes: []}});
  t.stored = newer(t.E);
  await t.store.execute('restore', [backup]);
  const s = t.stored;
  assert.equal(s.humbleAccountId, OTHER);
  assert.deepEqual(s.libraryItems.map(i => i.title).sort(), ['Backup Only Title', 'Shared Title'], 'accounts are not mixed');
  assert.equal(s.profileArchives.length, 1);
  assert.equal(s.profileArchives[0].profileLabel, 'Main (before restore)');
  assert.equal(s.profileArchives[0].backup.accountId, ACCOUNT);
  assert.deepEqual(s.profileArchives[0].backup.items.map(i => i.title).sort(), ['Newer Title', 'Shared Title']);
  assert.equal(s.profileArchives[0].backup.wishlistItems, undefined, 'the wishlist is not copied into account snapshots');
  assert.deepEqual(s.libraryEntitlements.scopes.map(x => x.localAccountId), [ACCOUNT], 'Library observations stay bound to their own account');
  await t.store.execute('selectProfile', [{profileLabel: 'Main (before restore)', expectedActiveLabel: 'Main', confirmed: true}]);
  assert.equal(t.stored.humbleAccountId, ACCOUNT);
  assert.deepEqual(t.stored.libraryItems.map(i => i.title).sort(), ['Newer Title', 'Shared Title']);
});

test('a backup without a wishlist leaves the wishlist unchanged, and merged archives keep both sides', async () => {
  const t = load(), source = older(t.E);
  delete source.wishlistItems;
  const archived = t.H.createLibraryBackup({...newer(t.E), humbleAccountId: OTHER, humbleProfileLabel: 'Second', libraryItems: [item('Archive Current', 'order-9')], libraryEntitlements: {version: 1, scopes: []}});
  const backup = t.H.createLibraryBackup({...source, profileArchives: [{profileLabel: 'Second', backup: t.H.createLibraryBackup({...source, humbleAccountId: OTHER, humbleProfileLabel: 'Second', libraryItems: [item('Archive Old', 'order-8')], libraryEntitlements: {version: 1, scopes: []}})}]});
  assert.equal(backup.wishlistItems, undefined);
  t.stored = {...newer(t.E), profileArchives: [{profileLabel: 'Second', backup: archived}]};
  await t.store.execute('restore', [backup]);
  assert.deepEqual(t.stored.wishlistItems.map(w => w.title), ['Kept Wish', 'New Wish']);
  assert.equal(t.stored.profileArchives.length, 1);
  assert.deepEqual(t.stored.profileArchives[0].backup.items.map(i => i.title).sort(), ['Archive Current', 'Archive Old']);
});

test('repeating a restore with saved accounts leaves them byte-identical', async () => {
  const t = load(), archived = t.H.createLibraryBackup({...older(t.E), humbleAccountId: OTHER, humbleProfileLabel: 'Second', libraryEntitlements: {version: 1, scopes: []}}, '2025-05-05T05:05:05.000Z');
  const backup = t.H.createLibraryBackup({...older(t.E), profileArchives: [{profileLabel: 'Second', backup: archived}]});
  t.stored = newer(t.E);
  await t.store.execute('restore', [backup]);
  const once = copy(t.stored.profileArchives);
  assert.equal(once[0].backup.exportedAt, '2025-05-05T05:05:05.000Z', 'the archived account keeps its original time');
  await new Promise(resolve => setTimeout(resolve, 5));
  await t.store.execute('restore', [backup]);
  assert.deepEqual(t.stored.profileArchives, once);
});

// Separate rows of one title are separate purchases unless they share a purchase identity: merging keeps each one.
// These checks also read what Galactic Library would be sent, so they load the shared purchase modules.
function loadWithSharing() {
  let stored = {};
  const area = {get: async defaults => ({...copy(defaults), ...copy(stored)}), set: async patch => { stored = {...stored, ...copy(patch)}; }, remove: async keys => { for (const key of [keys].flat()) delete stored[key]; }};
  const context = vm.createContext({console, URL, TextEncoder, TextDecoder, Date, crypto: webcrypto, setTimeout, clearTimeout, structuredClone});
  context.globalThis = context;
  for (const file of ['purchase-snapshot.js', 'purchase-adapters.js', 'purchase-sync.js', 'library-entitlements.js', 'shared.js', 'collection-mappings.js']) vm.runInContext(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context, {filename: file});
  const H = context.HumbleComicLibrary;
  return {H, store: H.createSyncStore(area), get stored() { return stored; }, set stored(value) { stored = copy(value); }};
}
const purchaseRow = (n, extra = {}) => ({title: 'Synthetic Twin', kind: 'book', source: 'humble', sourceBundle: 'Synthetic bundle ' + n, purchaseKey: 'twin-order-' + n,
  providerItemId: `twin-order-${n}:product:twin-${n}`, purchasedAt: '2025-0' + n + '-01', entitlement: 'direct-download', ...extra});
const purchases = items => items.flatMap(item => item.provenance?.length ? item.provenance : [item]).map(origin => origin.purchaseKey).sort();
for (const [label, rows] of [
  ['two rows without provenance', [purchaseRow(1), purchaseRow(2)]],
  ['a row with provenance and a row without', [{...purchaseRow(1), provenance: [{title: 'Synthetic Twin', sourceBundle: 'Synthetic bundle 1', purchaseKey: 'twin-order-1', providerItemId: 'twin-order-1:product:twin-1', purchasedAt: '2025-01-01'}]}, purchaseRow(2)]]
]) test(`restoring a backup of the same library keeps every same-title purchase: ${label}`, async () => {
  const t = loadWithSharing();
  t.stored = {humbleAccountId: ACCOUNT, humbleProfileLabel: 'Main', profileArchives: [], libraryItems: copy(rows)};
  const backup = t.H.createLibraryBackup(t.stored);
  for (let n = 0; n < 2; n++) {
    await t.store.execute('restore', [backup]);
    assert.deepEqual(purchases(t.stored.libraryItems), ['twin-order-1', 'twin-order-2'], 'no purchase is lost or duplicated, also when restored again');
  }
  const [account] = await t.store.execute('handoffAccounts');
  const shared = await t.store.execute('handoffSnapshot', [account.accountRef]);
  assert.deepEqual(copy(shared.records.map(r => r.metadata.purchaseId)).sort(), ['twin-order-1', 'twin-order-2'], 'both purchases are still shared');
});

test('rows of one purchase, or without any purchase identity, still merge into one row', async () => {
  const t = loadWithSharing();
  const manual = {title: 'Manual legacy book', sourceBundle: ''};
  t.stored = {humbleAccountId: ACCOUNT, humbleProfileLabel: 'Main', profileArchives: [], libraryItems: [purchaseRow(1), manual]};
  const backup = t.H.createLibraryBackup({...t.stored, libraryItems: [purchaseRow(1, {sourceBundle: 'Renamed bundle'}), manual]});
  await t.store.execute('restore', [backup]);
  assert.equal(t.stored.libraryItems.length, 2);
  assert.deepEqual(purchases(t.stored.libraryItems).filter(Boolean), ['twin-order-1'], 'the same purchase is not counted twice');
  assert.equal(t.stored.libraryItems.find(i => i.purchaseKey === 'twin-order-1').provenance, undefined, 'a single purchase keeps its row shape');
});
