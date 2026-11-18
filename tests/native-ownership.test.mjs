import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,row,child,accountId} from './library-entitlements-fixture.mjs';
import {fixture as matchingFixture} from './matching-fixture.mjs';

const plain = v => JSON.parse(JSON.stringify(v));
// A DRM-free child as Humble's Library detail lists it. The URL and hash must never be kept.
const drm = (id, title, platform, formats) => ({...child(id, title, 'download_drm_free'),
  downloads: [{id: 'dl-' + id, platform, downloadStruct: formats.map(name => ({id: 'f-' + name, name, md5: 'SYNTHETIC_HASH', url: {web: 'https://dl.example/SYNTHETIC_SIGNED'}}))}]});
async function synced(entries, options = {}) {
  const f = fixture({rows: entries.map(([id, title, type = 'download_drm_free']) => row(id, title, type)), children: entries.map(([id, title, type = 'download_drm_free', platform, formats = [], extra = {}]) => ({...(type === 'download_drm_free' && platform ? drm(id, title, platform, formats) : child(id, title, type)), ...extra})), ...options});
  await f.collect();
  return f;
}
const classify = async (records, media, title, historical = []) => {
  const m = matchingFixture(records, media, {title}, null, historical);
  const result = await m.classify();
  return {state: result.match.state, status: m.context.HumbleOwnership.presentation.status(m.context.offered, result.match)};
};

test('the collector keeps download platforms and formats, never links or hashes, and classifies media from them', async () => {
  const f = await synced([['c1', 'Saga Volume 1', 'download_drm_free', 'ebook', ['CBZ', 'PDF']], ['b1', 'The Synthetic Novel', 'download_drm_free', 'ebook', ['EPUB', 'MOBI']],
    ['a1', 'Synthetic Audiobook', 'download_drm_free', 'audio', ['MP3']], ['g1', 'Synthetic Platformer', 'download_drm_free', 'windows', ['Download']], ['u1', 'Mystery Item'], ['s1', 'Steam Game', 'steam']]);
  const saved = f.stored.libraryEntitlements.scopes[0].observations, media = Object.fromEntries(saved.map(o => [o.title, o.mediaType]));
  assert.deepEqual(media, {'Saga Volume 1': 'comic', 'The Synthetic Novel': 'book', 'Synthetic Audiobook': 'audiobook', 'Synthetic Platformer': 'game', 'Mystery Item': 'unknown', 'Steam Game': 'game'});
  assert.deepEqual(plain(saved.find(o => o.title === 'Saga Volume 1').delivery), {platforms: ['ebook'], formats: ['cbz', 'pdf']});
  assert(!JSON.stringify(f.stored).includes('SYNTHETIC_SIGNED') && !JSON.stringify(f.stored).includes('SYNTHETIC_HASH') && !JSON.stringify(f.stored).includes('SYNTHETIC_SECRET'));
  const restored = f.H.restoreBackupState(f.H.createLibraryBackup(f.stored));
  assert.deepEqual(plain(restored.libraryEntitlements.scopes[0].observations.map(o => o.mediaType)), plain(saved.map(o => o.mediaType)), 'backup and restore keep the evidence');
});

test('executables from a Software Bundle are software, and software assets are software anywhere', async () => {
  const f = await synced([['t1', 'Synthetic Tool', 'download_drm_free', 'windows', ['Download']]], {parent: {title: 'Humble Software Bundle: Synthetic Tools'}});
  assert.equal(f.stored.libraryEntitlements.scopes[0].observations[0].mediaType, 'software');
  assert.equal(f.E.providerMedia('download_drm_free', {platforms: ['other'], formats: ['yymps']}, ''), 'software');
  assert.equal(f.E.providerMedia('download_drm_free', {platforms: ['video'], formats: ['mp4']}, ''), 'video');
  assert.equal(f.E.providerMedia('download_drm_free', {platforms: ['other'], formats: ['zip']}, ''), 'unknown', 'an archive alone is not evidence');
});

test('a fresh install recognises synced DRM-free comics, books and software on bundle pages', async () => {
  const f = await synced([['c1', 'Saga Volume 1', 'download_drm_free', 'ebook', ['CBZ']], ['b1', 'The Synthetic Novel', 'download_drm_free', 'ebook', ['EPUB']]]);
  assert.deepEqual(f.stored.libraryItems, [], 'nothing was imported the old way');
  const records = f.E.matchingItems(f.stored);
  assert.deepEqual(plain(records.map(r => [r.title, r.kind, r.entitlement])), [['Saga Volume 1', 'comic', 'direct-download'], ['The Synthetic Novel', 'book', 'direct-download']]);
  assert.deepEqual(await classify(records, 'book', 'Saga Volume 1'), {state: 'owned', status: 'Owned'});
  assert.deepEqual(await classify(records, 'book', 'The Synthetic Novel'), {state: 'owned', status: 'Owned'});
  const software = await synced([['t1', 'Synthetic Tool', 'download_drm_free', 'windows', ['Download']]], {parent: {title: 'Humble Software Bundle: Synthetic Tools'}});
  assert.deepEqual(await classify(software.E.matchingItems(software.stored), 'software', 'Synthetic Tool'), {state: 'owned', status: 'Owned'});
});

test('the existing matching protections still apply to synced purchases', async () => {
  const f = await synced([['c1', 'Saga Volume 1', 'download_drm_free', 'ebook', ['CBZ']], ['r1', 'Synthetic Quest III', 'download_drm_free', 'ebook', ['PDF']], ['o1', 'Synthetic Hero #1', 'download_drm_free', 'ebook', ['CBZ']]]);
  const records = f.E.matchingItems(f.stored), results = {};
  for (const title of ['Saga Volume 2', 'Saga Volume 1 Deluxe Edition', 'Synthetic Quest II', 'Synthetic Quest 3', 'Synthetic Hero Omnibus', 'Saga']) results[title] = (await classify(records, 'book', title)).state;
  console.log('# protections: ' + JSON.stringify(results));
  assert.notEqual(results['Saga Volume 2'], 'owned', 'a numbered sequel is not the owned volume');
  assert.notEqual(results['Synthetic Quest II'], 'owned', 'II is not III');
  assert.notEqual(results['Saga Volume 1 Deluxe Edition'], 'owned', 'another edition is at most possible');
  assert.notEqual(results['Synthetic Hero Omnibus'], 'owned', 'an omnibus is not one issue');
  assert.notEqual(results.Saga, 'owned', 'a generic name is not a specific volume');
});

test('Steam keys stay Purchased with activation unknown; unknown media, gifts and imported titles are not added again', async () => {
  const f = await synced([['s1', 'Synthetic Shooter', 'steam'], ['u1', 'Mystery Item'], ['c1', 'Saga Volume 1', 'download_drm_free', 'ebook', ['CBZ']], ['c2', 'Saga Volume 1', 'download_drm_free', 'ebook', ['CBZ']], ['gift', 'Gifted Comic', 'download_drm_free', 'ebook', ['CBZ'], {giftStatus: 'gifted'}]]);
  const steam = await classify(f.E.matchingItems(f.stored), 'game', 'Synthetic Shooter');
  assert.deepEqual(steam, {state: 'owned', status: 'Purchased'}, 'a Humble key is a purchase; Steam activation is not claimed');
  const records = f.E.matchingItems(f.stored);
  assert(!records.some(r => r.title === 'Mystery Item'), 'unknown media is not offered to a media-specific matcher');
  assert(!records.some(r => r.title === 'Gifted Comic'), 'a gifted copy is not a purchase');
  assert.equal(records.find(r => r.title === 'Saga Volume 1').libraryObservationRefs.length, 2, 'two copies stay two observations');
  const withHistory = f.E.matchingItems({...f.stored, libraryItems: [{title: 'Saga Volume 1', kind: 'comic', source: 'humble', purchaseKey: 'old'}]});
  assert(!withHistory.some(r => r.title === 'Saga Volume 1'), 'an imported title is matched through its imported record only');
});

test('older records without delivery evidence use agreeing imported media, then explicit bundle names, otherwise stay unknown', async () => {
  const {E} = fixture();
  const o = (title, parentTitle) => ({title, parentTitle, namespace: 'download_drm_free', mediaType: 'unknown'});
  const kinds = E.historicalKinds([{title: 'Saga Volume 1', kind: 'comic'}, {title: 'Twin Name', kind: 'book'}, {title: 'Twin Name', kind: 'game'}, {title: 'Unsorted', kind: 'unclassified'}]);
  assert.equal(E.resolvedMedia(o('Saga Volume 1', 'Anything'), kinds), 'comic');
  assert.equal(E.resolvedMedia(o('Twin Name', 'Humble Book Bundle: X'), kinds), 'unknown', 'conflicting imported media is not resolved by a bundle name');
  assert.equal(E.resolvedMedia(o('Mixed Shelf', 'Anything'), E.historicalKinds([{title: 'Mixed Shelf', kind: 'book'}, {title: 'Mixed Shelf', kind: 'comic'}])), 'comic', 'book and comic records of one title agree');
  assert.equal(E.resolvedMedia(o('New Title', 'Humble Comics Bundle: Y'), kinds), 'comic');
  assert.equal(E.resolvedMedia(o('New Title', 'Humble Book Bundle: Z'), kinds), 'book');
  assert.equal(E.resolvedMedia(o('New Title', 'Humble Software Bundle: Q'), kinds), 'software');
  assert.equal(E.resolvedMedia(o('New Title', 'Synthetic Store Purchase'), kinds), 'unknown');
  assert.equal(E.resolvedMedia(o('Unsorted', 'Synthetic Store Purchase'), kinds), 'unknown');
});

test('purchase sync shares synced purchases through the existing snapshot and keeps them out of imported storage', async () => {
  const f = await synced([['c1', 'Saga Volume 1', 'download_drm_free', 'ebook', ['CBZ']], ['c2', 'Saga Volume 1', 'download_drm_free', 'ebook', ['CBZ']], ['m1', 'Monstress Volume 1', 'download_drm_free', 'ebook', ['CBZ']],
    ['s1', 'Synthetic Shooter', 'steam'], ['u1', 'Mystery Item']], {companion: true, initial: {libraryItems: [{title: 'Saga Volume 1', kind: 'comic', source: 'humble', purchaseKey: 'old-order', providerItemId: 'old-order:product:saga'}], purchaseSummaries: [{purchaseKey: 'old-order', sourceBundle: 'Old', itemCount: 1}]}});
  const accounts = await f.writer.execute('handoffAccounts', []);
  assert.equal(accounts.length, 1);assert.equal(accounts[0].eligibleCount, 1 + 3, 'one imported record and three synced records are shared');
  const data = await f.writer.execute('handoffSnapshot', [accounts[0].accountRef]);
  const rows = Object.fromEntries(data.records.map(r => [r.providerItemId, r]));
  const shared = data.records.filter(r => r.providerItemId.startsWith('humble-library:'));
  assert.deepEqual(plain(shared.map(r => [r.title, r.mediaType, r.metadata.entitlement, r.metadata.keyStatus ?? null]).sort()),
    [['Monstress Volume 1', 'book', 'direct-download', null], ['Saga Volume 1', 'book', 'direct-download', null], ['Synthetic Shooter', 'game', 'third-party-key', 'unknown']]);
  assert(rows['old-order:product:saga'], 'the imported record is still shared');
  assert(data.limitations.some(v => /1 synced Humble Library items are already shared/.test(v)) && data.limitations.some(v => /1 synced Humble Library items have unknown media/.test(v)));
  assert(shared.every(r => r.metadata.purchaseId.startsWith('humble-library:') && r.purchasedAt === null));
  assert(!JSON.stringify(data).includes('principal-A') && !JSON.stringify(data).includes('hub-A'), 'provider account identifiers are not shared');
  // GL sends the same records back during two-way sync, plus one purchase only GL holds.
  const before = f.stored, echo = {...data, records: [...data.records, {providerItemId: 'gl-order:product:x', title: 'GL Only Book', mediaType: 'book', metadata: {purchaseId: 'gl-order', sourceBundle: 'Elsewhere', entitlement: 'direct-download'}, purchasedAt: null, origins: []}]};
  const stats = await f.writer.execute('handoffImport', [echo, {accountRef: accounts[0].accountRef}]);
  const after = f.stored;
  assert.equal(stats.added, 1, 'only the GL-held purchase is imported');
  assert(!after.libraryItems.some(i => (i.provenance?.length ? i.provenance : [i]).some(p => String(p.purchaseKey).startsWith('humble-library:'))), 'synced records never become imported purchases');
  assert(!after.purchaseSummaries.some(p => p.purchaseKey.startsWith('humble-library:')));
  assert.deepEqual(after.libraryEntitlements, before.libraryEntitlements, 'Library records are unchanged');
});

test('purchase sync shares only the records of the account the snapshot is for', async () => {
  const f = await synced([['c1', 'Saga Volume 1', 'download_drm_free', 'ebook', ['CBZ']]], {companion: true});
  const state = f.stored;
  await f.area.set({humbleAccountId: '22222222-2222-4222-8222-222222222222', humbleProfileLabel: 'Other', libraryItems: []});
  const [account] = await f.writer.execute('handoffAccounts', []);
  const data = await f.writer.execute('handoffSnapshot', [account.accountRef]);
  assert.equal(data.records.length, 0);assert.equal(state.libraryEntitlements.scopes[0].localAccountId, accountId);
});

test('companion snapshot excludes empty Humble delivery slots before media inference and overlap counting', async () => {
  const slot={title:'No Content',kind:'comic',source:'humble',purchaseKey:'synthetic-comics',sourceBundle:'Synthetic Comics Bundle',
    providerItemId:'synthetic-comics:product:slot',entitlement:'direct-download',formats:[]};
  const book={...slot,title:'Real comic in the same order',providerItemId:'synthetic-comics:product:comic'};
  const other={...slot,kind:'unclassified',purchaseKey:'synthetic-mixed',providerItemId:'synthetic-mixed:product:slot'};
  const f=await synced([['slot','No Content'],['file','No Content','download_drm_free','ebook',['CBZ']],['key','No Content','steam']],{
    companion:true,initial:{libraryItems:[slot,book,other],mediaTypeOverrides:{'synthetic-comics':'comic'}},
    parent:{title:'Humble Comics Bundle: Synthetic'}});
  const before=structuredClone(f.stored);
  const read=async fixture=>{
    const [account]=await fixture.writer.execute('handoffAccounts',[]);
    const data=await fixture.writer.execute('handoffSnapshot',[account.accountRef]);
    assert.equal(data.accountRef,account.accountRef);
    assert.equal(account.eligibleCount,3);
    return plain(data.records);
  };
  const records=await read(f);
  assert.deepEqual(records.map(r=>[r.providerItemId,r.title,r.mediaType]),[
    [book.providerItemId,book.title,'book'],['humble-library:download_drm_free:file','No Content','book'],['humble-library:steam:key','No Content','game']]);
  assert.deepEqual(await read(f),records);
  assert.deepEqual(f.stored,before);
  const restored=f.H.restoreBackupState(f.H.createLibraryBackup(f.stored));
  assert.deepEqual(plain(restored.libraryEntitlements),plain(before.libraryEntitlements));
  assert.equal(restored.libraryItems.filter(item=>item.title==='No Content').length,2);
  assert.deepEqual(await read(fixture({companion:true,initial:restored})),records);
});

test('sharing and matching scale to a large library without repeated work', async () => {
  const {E} = fixture();
  const scope = {principalId: 'principal-A', userId: 'hub-A'}, observations = [], items = [];
  for (let n = 0; n < 9000; n++) observations.push(E.observation({scope, namespace: n % 20 ? 'download_drm_free' : 'steam', nativeId: 'native-' + n, title: 'Synthetic title ' + (n % 7500), parentId: 'parent-' + Math.floor(n / 40), parentTitle: 'Humble Comics Bundle ' + Math.floor(n / 40),
    source: 'authenticated-humble-library', observedAt: '2026-11-13T00:00:00.000Z', delivery: n % 20 ? {platforms: ['ebook'], formats: ['cbz']} : undefined,
    eligibility: {expired: false, preOrdered: false, outOfStock: false, redeemable: true, directRedeem: false, parentPreOrder: false, revoked: null, temporaryAccess: null, giftStatus: 'unassigned', parentType: 'bundle', integration: 'none', redemptionGroups: 'none',
      unavailableBefore: {state: 'none', value: null}, unavailableAfter: {state: 'none', value: null}, redeemedAt: {state: 'none', value: null}}}));
  for (let n = 0; n < 7000; n++) items.push({title: 'Synthetic title ' + n, kind: 'comic', source: 'humble', purchaseKey: 'order-' + Math.floor(n / 30)});
  const libraryEntitlements = {version: 1, scopes: [{...scope, localAccountId: accountId, profileLabel: 'A', observations, lastScan: null, sync: null}]};
  let t = performance.now();const shared = E.companionRecords({libraryEntitlements, accountId, items});const shareMs = performance.now() - t;
  t = performance.now();const matching = E.matchingItems({libraryEntitlements, humbleAccountId: accountId, libraryItems: items});const matchMs = performance.now() - t;
  console.log(`# 9,000 synced + 7,000 imported: sharing ${shareMs.toFixed(0)} ms (${shared.records.length} records), matching ${matchMs.toFixed(0)} ms (${matching.length} records)`);
  assert(shared.records.length > 0 && shared.represented > 0);assert(shareMs < 3000 && matchMs < 3000);
});
