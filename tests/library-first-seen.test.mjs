import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, row, copy} from './library-entitlements-fixture.mjs';
import {load, uuid, nativeObservation, entitlements, ACCOUNT} from './library-browser-fixture.mjs';

const observations = f => f.stored.libraryEntitlements.scopes[0].observations;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const legacy = {libraryItems: [{title: 'Old', kind: 'book', source: 'humble', purchaseKey: 'old', manualKind: 'book'}], purchaseSummaries: [{purchaseKey: 'old', itemCount: 1}], mediaTypeOverrides: {old: 'book'}, keyReminders: [], lastImport: {reconciled: true}};

test('a newly synced entitlement records when it was first seen; later syncs keep that time', async () => {
  const f = fixture({initial: legacy});await f.collect();
  const first = observations(f);
  assert(first.length && first.every(r => r.firstObservedAt === r.observedAt), 'first seen is the sync that saved it');
  await pause(5);
  const g = fixture({initial: f.stored});await g.collect();
  const again = new Map(observations(g).map(r => [r.nativeId, r]));
  for (const r of first) {
    assert(again.get(r.nativeId).observedAt > r.observedAt, 'the repeat sync observed it again');
    assert.equal(again.get(r.nativeId).firstObservedAt, r.firstObservedAt, 'a repeat sync never moves the first-seen time');
  }
  for (const [k, v] of Object.entries(legacy)) assert.deepEqual(g.stored[k], v, 'imports, corrections and reminders are untouched');
});

test('records saved before first-seen tracking stay without one; only genuinely new entitlements get one', async () => {
  const f = fixture({initial: legacy});await f.collect({pageLimit: 1});
  const old = copy(f.stored);for (const r of old.libraryEntitlements.scopes[0].observations) delete r.firstObservedAt;
  await pause(5);
  const g = fixture({initial: old});await g.collect();
  const saved = new Set(old.libraryEntitlements.scopes[0].observations.map(r => r.nativeId));
  const after = observations(g);
  assert(after.length > saved.size, 'the second sync found further entitlements');
  for (const r of after) {
    if (saved.has(r.nativeId)) assert(!('firstObservedAt' in r), 'an earlier record is not given the current time');
    else assert.equal(r.firstObservedAt, r.observedAt, 'a new entitlement is first seen now');
  }
});

test('the storage worker sets first seen itself and ignores a value supplied with the batch', async () => {
  const f = fixture();const begin = await f.store('entitlementBegin', {confirmed: true, scope: {principalId: 'principal-A', userId: 'hub-A'}});
  const at = new Date().toISOString(), E = f.E;
  const raw = {scope: {principalId: 'principal-A', userId: 'hub-A'}, nativeId: 'x', namespace: 'steam', title: 'Synthetic', parentId: 'parent-A', source: 'authenticated-humble-library', observedAt: at, firstObservedAt: '2001-01-01T00:00:00.000Z',
    eligibility: {expired: false, preOrdered: false, outOfStock: false, redeemable: true, directRedeem: false, revoked: null, temporaryAccess: null, parentPreOrder: false, parentType: 'bundle', giftStatus: 'unassigned', integration: 'none', redemptionGroups: 'none', unavailableBefore: {state: 'none', value: null}, unavailableAfter: {state: 'none', value: null}, redeemedAt: {state: 'none', value: null}}};
  assert.equal(E.observation(raw).firstObservedAt, '2001-01-01T00:00:00.000Z');
  await f.store('entitlementCommit', begin.token, {scope: raw.scope, observations: [raw], scan: {checkedAt: at, acquisition: 'finished', coverage: 'bounded', pagesRead: 1, reportedPages: 2, reportedTotal: 8, verifiedItems: 1, unresolvedItems: 0, duplicateItems: 0, conflictingItems: 0, failures: []}});
  assert.equal(observations(f)[0].firstObservedAt, at);
});

test('first-seen times survive backup and restore; unusable values are dropped without rejecting the record', async () => {
  const f = fixture({initial: legacy});await f.collect();
  const backup = f.H.createLibraryBackup(f.stored), restored = f.H.restoreBackupState(copy(backup));
  const times = restored.libraryEntitlements.scopes[0].observations.map(r => r.firstObservedAt);
  assert(times.length && times.every(t => typeof t === 'string'), 'the backup carries each first-seen time');
  assert.deepEqual(times, observations(f).map(r => r.firstObservedAt));
  const odd = copy(backup), list = odd.libraryEntitlements.scopes[0].observations;
  list[0].firstObservedAt = 'not a date';list[1].firstObservedAt = '2999-01-01T00:00:00.000Z';delete list[2].firstObservedAt;
  const kept = f.H.restoreBackupState(odd).libraryEntitlements.scopes[0].observations;
  assert.equal(kept.length, list.length, 'every record is kept');
  assert(!('firstObservedAt' in kept[0]) && !('firstObservedAt' in kept[1]) && !('firstObservedAt' in kept[2]), 'an invalid, future or missing value stays unknown');
});

test('first seen never reaches Galactic Library records or bundle matching', async () => {
  const f = fixture({initial: legacy});await f.collect();
  const without = copy(f.stored);for (const r of without.libraryEntitlements.scopes[0].observations) delete r.firstObservedAt;
  assert.deepEqual(f.E.matchingItems(f.stored), f.E.matchingItems(without));
  const shared = state => f.E.companionRecords({libraryEntitlements: state.libraryEntitlements, accountId: state.humbleAccountId, items: state.libraryItems});
  assert.deepEqual(shared(f.stored), shared(without));
  assert(!JSON.stringify(shared(f.stored)).includes('firstObservedAt'));
});

// Presentation. Times: older purchase first seen Nov 1, newer Nov 10.
const seen = (E, spec, at) => E.observation({...nativeObservation(E, spec), observedAt: '2026-11-15T00:00:00.000Z', ...(at ? {firstObservedAt: at} : {})});
const historical = (title, purchaseKey, sourceBundle, purchasedAt = '2024-03-01T00:00:00.000Z') => ({title, kind: 'book', source: 'humble', purchaseKey, sourceBundle, purchasedAt});

function library() {
  const {E, B} = load();
  const items = [historical('Shared A', 'K1', 'Imported Bundle'), historical('Shared B', 'K1', 'Imported Bundle'), historical('Dated only', 'K2', 'Dated Bundle', '2025-06-01T00:00:00.000Z')];
  const obs = [
    // The imported order, now also seen by sync: combined, so not newly added.
    seen(E, {id: 1, parent: 10, title: 'Shared A', parentTitle: 'Imported Bundle'}, '2026-11-12T00:00:00.000Z'),
    seen(E, {id: 2, parent: 10, title: 'Shared B', parentTitle: 'Imported Bundle'}, '2026-11-12T00:00:00.000Z'),
    seen(E, {id: 3, parent: 20, title: 'Older new A', parentTitle: 'Older Library Bundle'}, '2026-11-01T00:00:00.000Z'),
    seen(E, {id: 4, parent: 30, title: 'Newer new A', parentTitle: 'Newer Library Bundle'}, '2026-11-10T00:00:00.000Z'),
    seen(E, {id: 5, parent: 30, title: 'Newer new B', parentTitle: 'Newer Library Bundle'}, '2026-11-10T00:05:00.000Z'),
    // Saved before tracking: no time.
    seen(E, {id: 6, parent: 40, title: 'Untracked', parentTitle: 'Untracked Bundle'}),
    // One entitlement predates tracking, one is new: the purchase was seen before, so unknown.
    seen(E, {id: 7, parent: 50, title: 'Mixed old', parentTitle: 'Mixed Bundle'}),
    seen(E, {id: 8, parent: 50, title: 'Mixed added', parentTitle: 'Mixed Bundle'}, '2026-11-14T00:00:00.000Z')
  ];
  const model = B.buildGroups({items, purchaseSummaries: [], libraryEntitlements: entitlements(obs), humbleAccountId: ACCOUNT});
  return {E, B, items, obs, model, reconciled: B.reconcile(model.groups)};
}

test('a purchase is first seen with its earliest entitlement, unknown if any entitlement predates tracking', () => {
  const {model} = library(), byName = name => model.groups.find(g => g.name === name && g.source === 'native');
  assert.equal(byName('Newer Library Bundle').firstSeenAt, Date.parse('2026-11-10T00:00:00.000Z'));
  assert.equal(byName('Untracked Bundle').firstSeenAt, null);
  assert.equal(byName('Mixed Bundle').firstSeenAt, null);
  assert(model.groups.filter(g => g.source === 'historical').every(g => g.firstSeenAt === null));
});

test('Recently added lists only Library purchases new to the library, newest first, then by purchase date', () => {
  const {B, reconciled} = library(), names = list => Array.from(list, r => r.group.name);
  const combined = reconciled.groups.find(g => g.source === 'unified');
  assert(combined && B.recentlyAdded(combined) === null, 'an imported order seen again by sync is not recently added');
  assert.deepEqual(names(B.filterGroups(reconciled.groups, {sort: 'added-desc'})), ['Newer Library Bundle', 'Older Library Bundle', 'Dated Bundle', 'Imported Bundle', 'Mixed Bundle', 'Untracked Bundle']);
  assert.deepEqual(names(B.filterGroups(reconciled.groups, {sort: 'date-desc'})).slice(0, 2), ['Dated Bundle', 'Imported Bundle'], 'purchase-date order is unchanged by first-seen times');
});

test('ambiguous or conflicting Library purchases are not shown as recently added', () => {
  const {E, B} = load();
  const items = [historical('Same 1', 'K1', 'Repeat Bundle'), historical('Same 2', 'K1', 'Repeat Bundle')];
  const obs = [1, 2].flatMap(n => [seen(E, {id: n * 10, parent: n, title: 'Same 1', parentTitle: 'Repeat Bundle'}, '2026-11-10T00:00:00.000Z'), seen(E, {id: n * 10 + 1, parent: n, title: 'Same 2', parentTitle: 'Repeat Bundle'}, '2026-11-10T00:00:00.000Z')]);
  const model = B.buildGroups({items, libraryEntitlements: entitlements(obs), humbleAccountId: ACCOUNT}), r = B.reconcile(model.groups);
  const natives = model.groups.filter(g => g.source === 'native');
  assert(natives.some(g => g.matchState !== 'unmatched'));
  for (const g of r.groups) if (g.source !== 'native' || g.matchState !== 'unmatched') assert.equal(B.recentlyAdded(g), null);
});

test('a title is recently added through its newest new Library copy; copies of imported orders do not count', () => {
  const {B, model, reconciled} = library(), links = B.titleLinks(model.groups, reconciled);
  assert.equal(B.titleAddedAt(links.links.get(links.key('Newer new B'))), Date.parse('2026-11-10T00:00:00.000Z'), 'the time its purchase was first seen');
  assert.equal(B.titleAddedAt(links.links.get(links.key('Shared A'))), null);
  assert.equal(B.titleAddedAt(links.links.get(links.key('Untracked'))), null);
  assert.equal(B.titleAddedAt(undefined), null);
});

test('first-seen times do not change purchase counts or another account\'s view', () => {
  const {E, B, items, obs} = library();
  const stripped = obs.map(r => { const c = copy(r);delete c.firstObservedAt;return E.observation(c); });
  const count = list => { const m = B.buildGroups({items, libraryEntitlements: entitlements(list), humbleAccountId: ACCOUNT}), l = B.titleLinks(m.groups, B.reconcile(m.groups));
    return ['Shared A', 'Newer new A', 'Untracked'].map(t => B.titlePurchaseCount(items.filter(i => i.title === t), l.links.get(l.key(t)) ?? [])); };
  assert.deepEqual(count(obs), count(stripped));
  const other = B.buildGroups({items: [], libraryEntitlements: entitlements(obs, ACCOUNT), humbleAccountId: '22222222-2222-4222-8222-222222222222'});
  assert(!other.groups.length, 'another account sees none of these purchases or their times');
  assert.notEqual(B.nativeSignature(entitlements(obs), ACCOUNT), B.nativeSignature(entitlements(stripped), ACCOUNT), 'a restored first-seen time refreshes the Options view');
});
