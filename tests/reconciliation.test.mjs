import { wireStore } from './store-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const plain = (value) => JSON.parse(JSON.stringify(value));
const order = (key) => ({ gamekey: key, product: { human_name: `Bundle ${key}` } });
const bookDetail = (title) => ({ subproducts: [{ human_name: title, downloads: [{ url: 'https://example.invalid/book.pdf' }] }] });
const item = (title, kind = 'book', purchaseKey = 'old') => ({
  title, kind, source: 'humble', purchaseKey, sourceBundle: `Bundle ${purchaseKey}`,
  provenance: [{ title, purchaseKey, sourceBundle: `Bundle ${purchaseKey}` }]
});

function importer(initial, orders, details, failures = []) {
  const stored = {humbleProfileLabel:'fixture',profileArchives:[],...structuredClone(initial)};
  const requests = [];
  const writes = [];
  const context = {
    Blob, URL, clearTimeout, console, document: { title: '' }, location: { pathname: '/' },
    performance: { now: () => 0 }, Promise, setTimeout: (callback) => { callback(); return 0; },
    chrome: { storage: { local: {
      get: async (defaults) => ({ ...structuredClone(defaults), ...structuredClone(stored) }),
      set: async (values) => { if(Object.hasOwn(values,'libraryItems'))writes.push(plain(values)); Object.assign(stored, plain(values)); }
    } } },
    fetch: async (url) => {
      if (url === '/api/v1/user/order?all=true') return { ok: true, json: async () => orders };
      const key = decodeURIComponent(url.match(/\/order\/([^?]+)/u)[1]);
      requests.push(key);
      if (failures.includes(key)) throw new Error('Fetch failed');
      return { ok: true, status: 200, text: async () => JSON.stringify(details[key]) };
    }
  };
  wireStore(context);
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ['shared.js', 'collection-mappings.js', 'ownership.js', 'content.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }
  return { stored, requests, writes, context, scan: async (full = true) => plain(await vm.runInContext(`importPurchases(() => {}, { fullRescan: ${full}, profileLabel:'fixture', confirmed:true })`, context)) };
}

function initialState() {
  return {
    libraryItems: [item('Old Book'), item('Old Game', 'game'), item('Old Software', 'software'), item('Old Audio', 'audiobook'), { title: 'Manual book' }],
    purchaseSummaries: [{ purchaseKey: 'old', sourceBundle: 'Old Bundle', itemCount: 4, pricePaid: 8 }],
    mediaImportVersion: 7,
    keyReminders: [{ id: 'old-reminder', purchaseKey: 'old', title: 'Old Game', status: 'unrevealed' }],
    keyReminderScan: { complete: true, purchaseKeys: ['old'], baselinePurchaseKeys: ['old'] },
    customCollectionMappings: [{ id: 'keep-this-rule' }]
  };
}

test('key evidence backfills once, then pending refresh updates purchase status without duplicates',async()=>{
  const details={old:{all_tpks:[{human_name:'Old Game',machine_name:'game',keyindex:0,key_type:'steam'}]}};
  const initial={...initialState(),mediaImportVersion:6,keyReminders:[],keyReminderScan:null};
  const scan=importer(initial,[order('old')],details);
  await scan.scan(false);assert.equal(scan.stored.mediaImportVersion,7);
  assert.deepEqual(scan.requests,['old']);assert.equal(scan.stored.libraryItems.find(item=>item.title==='Old Game').keyStatus,'unrevealed');
  details.old.all_tpks[0].is_expired=true;scan.requests.length=0;
  await scan.scan(false);
  const game=scan.stored.libraryItems.find(item=>item.title==='Old Game');
  assert.deepEqual(scan.requests,['old']);assert.equal(game.keyStatus,'expired');assert.equal(game.provenance.length,1);
  assert.equal(scan.context.HumbleOwnership.purchased(game),false);
  assert.equal(scan.stored.keyReminders[0].status,'needs-review');
  delete details.old.all_tpks[0].is_expired;details.old.all_tpks[0].redeemed_key_val='must-not-store';
  await scan.scan(false);assert.equal(scan.stored.keyReminders.length,0);
  assert.equal(scan.stored.libraryItems.find(item=>item.title==='Old Game').keyStatus,'revealed');
  assert.equal(JSON.stringify(scan.stored).includes('must-not-store'),false);
  scan.requests.length=0;await scan.scan(false);assert.equal(scan.requests.length,0,'resolved purchases retain incremental scanning');
});

test('resolved key purchases are revisited when their reported expiry is due',async()=>{
  const evidence={title:'Old Game',kind:'game',source:'humble',sourceBundle:'Bundle old',purchaseKey:'old',entitlement:'third-party-key',entitlementId:'game:0',keyStatus:'revealed',expiresAt:'2000-01-01T00:00:00.000Z'};
  const scan=importer({...initialState(),libraryItems:[evidence],keyReminders:[]},[order('old')],{old:{all_tpks:[{human_name:'Old Game',machine_name:'game',keyindex:0,is_available:false}]}});
  await scan.scan(false);assert.deepEqual(scan.requests,['old']);
  assert.equal(scan.stored.libraryItems[0].keyStatus,'unavailable');assert.equal(scan.stored.keyReminders[0].status,'needs-review');
});

test('complete full rescans replace all Humble kinds, purchases and reminders, while archiving evidence', async () => {
  const initial = initialState();
  initial.libraryItems.push({ title: 'Legacy Humble evidence', source: 'humble' });
  const scan = importer(initial, [order('current')], { current: bookDetail('Current Book') });
  const result = await scan.scan();
  assert.equal(result.reconciled, true);
  assert.deepEqual(scan.stored.libraryItems.map((record) => record.title), ['Manual book', 'Current Book']);
  assert.deepEqual(scan.stored.purchaseSummaries.map((record) => record.purchaseKey), ['current']);
  assert.deepEqual(scan.stored.keyReminders, []);
  assert.deepEqual(scan.stored.keyReminderScan.purchaseKeys, ['current']);
  assert.deepEqual(scan.stored.keyReminderScan.failedPurchaseKeys, []);
  assert.equal(scan.stored.keyReminderScan.complete, true);
  assert.deepEqual(scan.stored.customCollectionMappings, initial.customCollectionMappings);
  const archived = scan.stored.historicalLibraryItems;
  for (const previous of initial.libraryItems.filter((record) => record.source === 'humble')) {
    const evidence = archived.find((record) => record.title === previous.title);
    assert.ok(evidence, 'known Humble evidence is archived even if old metadata lacks a purchase identifier');
    if (previous.provenance) assert.deepEqual(evidence.provenance, previous.provenance);
  }
  assert.ok(scan.stored.historicalPurchaseSummaries.some((record) => record.purchaseKey === 'old'));
  assert.equal(scan.writes.length, 1);
  const historyBefore = structuredClone({ items: archived, purchases: scan.stored.historicalPurchaseSummaries });
  const repeat = await scan.scan();
  assert.equal(repeat.added, 0, 'rebuilding the same snapshot does not report every title as newly added');
  assert.deepEqual({ items: scan.stored.historicalLibraryItems, purchases: scan.stored.historicalPurchaseSummaries }, historyBefore);
  assert.ok(!scan.stored.libraryItems.some((record) => record.title === 'Old Book'), 'history is excluded from the active matcher input');
});

test('failed full rescans preserve previous entries and schedule known failed purchases for incremental retry', async () => {
  const initial = initialState();
  const failures = ['old'];
  const scan = importer(initial, [order('old'), order('current')], { old: bookDetail('Replacement'), current: bookDetail('Current Book') }, failures);
  const result = await scan.scan();
  assert.equal(result.reconciled, false);
  assert.equal(result.failures, 1);
  for (const previous of initial.libraryItems) assert.ok(scan.stored.libraryItems.some((record) => record.title === previous.title));
  assert.ok(scan.stored.libraryItems.some((record) => record.title === 'Current Book'));
  assert.ok(scan.stored.purchaseSummaries.some((record) => record.purchaseKey === 'old'));
  assert.deepEqual(scan.stored.lastImport.failedPurchaseKeys, ['old']);
  assert.equal(scan.stored.keyReminderScan.complete, false, 'an earlier successful scan must not mask this failure');
  assert.deepEqual(scan.stored.keyReminderScan.failedPurchaseKeys, ['old']);
  assert.deepEqual(scan.stored.keyReminders, initial.keyReminders);
  failures.length = 0;
  scan.requests.length = 0;
  await scan.scan(false);
  assert.deepEqual(scan.requests, ['old'], 'retained summary does not prevent title retry');
  assert.ok(scan.stored.libraryItems.some((record) => record.title === 'Replacement'));
  assert.deepEqual(scan.stored.lastImport.failedPurchaseKeys, []);
  assert.ok(scan.stored.libraryItems.some((record) => record.title === 'Old Book'), 'incremental retry does not prune the old snapshot');
  await scan.scan();
  assert.deepEqual(scan.stored.libraryItems.map((record) => record.title).sort(), ['Current Book', 'Manual book', 'Replacement']);
});

test('reconciliation refreshes current duplicate provenance while preserving previous title and price evidence', async () => {
  const initial = initialState();
  initial.libraryItems.push({ ...item('Current Book', 'book', 'old'), provenance: [{ title: 'Current Book', purchaseKey: 'old' }, { title: 'Current Book', purchaseKey: 'current' }] });
  initial.purchaseSummaries.push({ purchaseKey: 'current', sourceBundle: 'Old Bundle Name', itemCount: 20, pricePaid: 10 });
  const scan = importer(initial, [order('current')], { current: bookDetail('Current Book') });
  await scan.scan();
  const current = scan.stored.libraryItems.find((record) => record.title === 'Current Book');
  assert.deepEqual(current.provenance.map((record) => record.purchaseKey), ['current']);
  const historical = scan.stored.historicalLibraryItems.find((record) => record.title === 'Current Book');
  assert.ok(historical.provenance.some((record) => record.purchaseKey === 'old'));
  assert.equal(scan.stored.purchaseSummaries[0].itemCount, 1);
  assert.ok(scan.stored.historicalPurchaseSummaries.some((record) => record.purchaseKey === 'current' && record.pricePaid === 10 && record.itemCount === 20));
  assert.ok(scan.stored.historicalPurchaseSummaries.some((record) => record.purchaseKey === 'current' && record.itemCount === 1));
});

test('manual titles survive both full reconciliation and media backfill, including Humble title collisions', async () => {
  const initial = initialState();
  initial.libraryItems.push({ title: 'Shared book', provenance: [{ title: 'Shared book' }, { title: 'Shared book', purchaseKey: 'old' }] });
  const scan = importer(initial, [order('current')], { current: bookDetail('Shared book') });
  await scan.scan();
  const shared = scan.stored.libraryItems.find((record) => record.title === 'Shared book');
  assert.notEqual(shared.source, 'humble', 'manual ownership remains identifiable after merging');
  assert.ok(!shared.provenance.some((record) => record.purchaseKey === 'old'));
  assert.ok(shared.provenance.some((record) => record.purchaseKey === 'current'));
  const empty = importer(scan.stored, [], {});
  await empty.scan();
  assert.ok(empty.stored.libraryItems.some((record) => record.title === 'Shared book'));
  assert.ok(!empty.stored.libraryItems.find((record) => record.title === 'Shared book').provenance.some((record) => record.purchaseKey));
  const backfill = importer({ libraryItems: [{ title: 'Manual Game', kind: 'game' }], mediaImportVersion: 1 }, [], {});
  await backfill.scan(false);
  assert.equal(backfill.stored.libraryItems[0].title, 'Manual Game');
});

test('an empty successful full scan clears the Humble snapshot and completes the empty reminder baseline', async () => {
  const scan = importer(initialState(), [], {});
  assert.equal((await scan.scan()).reconciled, true);
  assert.deepEqual(scan.stored.libraryItems.map((record) => record.title), ['Manual book']);
  assert.deepEqual(scan.stored.purchaseSummaries, []);
  assert.deepEqual(scan.stored.keyReminders, []);
  assert.equal(scan.stored.keyReminderScan.complete, true);
  assert.equal(scan.stored.historicalLibraryItems.length, 4);
});

test('invalid purchase identifiers abort before writes; unexpected details never prune the snapshot', async () => {
  const initial = initialState();
  const badOrder = importer(initial, [order('current'), {}], { current: bookDetail('Book') });
  await assert.rejects(badOrder.scan(), /valid identifier/);
  assert.equal(badOrder.writes.length, 0);
  assert.deepEqual(badOrder.stored.libraryItems,initial.libraryItems);assert.deepEqual(badOrder.stored.purchaseSummaries,initial.purchaseSummaries);
  for (const detail of [null, [], {}, { subproducts: 'unexpected' }, { tpkd_dict: { all_tpks: 'unexpected' } }]) {
    const scan = importer(initial, [order('old')], { old: detail });
    assert.equal((await scan.scan()).reconciled, false);
    assert.deepEqual(scan.stored.libraryItems, initial.libraryItems);
    assert.deepEqual(scan.stored.purchaseSummaries, initial.purchaseSummaries);
  }
});
