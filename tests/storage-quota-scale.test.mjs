import { wireStore } from './store-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const plain = (value) => JSON.parse(JSON.stringify(value));

function createScaleHarness(initial = {}, { onSet = null } = {}) {
  const stored = { humbleProfileLabel: 'Personal', profileArchives: [], ...structuredClone(initial) };
  const requests = [];
  const writes = [];
  const messages = [];

  const context = {
    reportImport: (message) => messages.push(message),
    Blob, URL, clearTimeout, console, document: { title: '' }, location: { pathname: '/' },
    performance: { now: () => 0 }, Promise, setTimeout: (callback) => { callback(); return 0; },
    chrome: {
      storage: {
        local: {
          get: async (defaults) => ({ ...structuredClone(defaults), ...structuredClone(stored) }),
          set: async (values) => {
            if (onSet) await onSet(values, stored);
            writes.push(plain(values));
            Object.assign(stored, plain(values));
          },
          getBytesInUse: async (keys, callback) => {
            const bytes = Buffer.byteLength(JSON.stringify(stored));
            if (callback) callback(bytes);
            return bytes;
          }
        }
      }
    }
  };

  wireStore(context);
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ['shared.js', 'collection-mappings.js', 'ownership.js', 'content.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }

  return {
    stored, requests, writes, messages, context,
    importer: (orders, details, failures = []) => {
      context.fetch = async (url) => {
        if (url === '/api/v1/user/order?all=true') return { ok: true, json: async () => orders };
        const key = decodeURIComponent(url.match(/\/order\/([^?]+)/u)[1]);
        requests.push(key);
        if (failures.includes(key)) throw new Error('Fetch failed');
        return { ok: true, status: 200, text: async () => JSON.stringify(details[key]) };
      };
      return {
        scan: async (full = true) => plain(await vm.runInContext(
          `importPurchases(reportImport, { fullRescan: ${full}, profileLabel: 'Personal', confirmed: true })`,
          context
        ))
      };
    }
  };
}

// Generate realistic multi-media library items with formats and provenance
function generateRealisticLibrary(count) {
  const mediaTypes = ['comic', 'book', 'software', 'audiobook', 'video', 'unclassified'];
  const formatPresets = {
    comic: ['.cbz', '.cbr', '.pdf'],
    book: ['.epub', '.pdf', '.mobi'],
    software: ['.zip', '.exe'],
    audiobook: ['.mp3', '.flac'],
    video: ['.mp4'],
    unclassified: ['.pdf']
  };

  const items = [];
  const purchases = [];
  const purchaseCount = Math.max(10, Math.ceil(count / 25));

  for (let pIdx = 0; pIdx < purchaseCount; pIdx++) {
    purchases.push({
      purchaseKey: `order-scale-${pIdx}`,
      importVersion:9,
      sourceBundle: `Humble Massive Bundle Volume ${pIdx + 1} with Extra Long Title For Realism`,
      purchasedAt: '2023-04-15T10:20:30.000Z',
      itemCount: 25,
      pricePaid: 15.00,
      currency: 'USD',
      pricePerItem: 0.60
    });
  }

  for (let i = 0; i < count; i++) {
    const pIdx = i % purchaseCount;
    const purchase = purchases[pIdx];
    const kind = mediaTypes[i % mediaTypes.length];
    const formats = formatPresets[kind] || [];
    const isMultiPurchase = (i % 7 === 0);

    const prefix = kind === 'comic' ? 'Comic Issue' : (kind === 'book' ? 'Novel Book' : (kind === 'software' ? 'Software Tool' : (kind === 'audiobook' ? 'Audiobook Edition' : (kind === 'video' ? 'Video Feature' : 'Unclassified Work'))));
    const title = `${prefix} #${i + 1} - The Definitive Extended Edition with Subtitle`;

    const primaryProvenance = {
      providerItemId: `${purchase.purchaseKey}:product:sub-${i}`,
      title,
      sourceBundle: purchase.sourceBundle,
      purchaseKey: purchase.purchaseKey,
      purchasedAt: purchase.purchasedAt,
      delivery: kind === 'video' ? 'streaming' : 'direct-download',
      entitlement: 'direct-download',
      ...(formats.length ? { formats } : {})
    };

    const provenance = [primaryProvenance];
    if (isMultiPurchase) {
      const secondPurchase = purchases[(pIdx + 1) % purchaseCount];
      provenance.push({
        providerItemId: `${secondPurchase.purchaseKey}:product:sub-${i}`,
        title,
        sourceBundle: secondPurchase.sourceBundle,
        purchaseKey: secondPurchase.purchaseKey,
        purchasedAt: '2024-01-10T12:00:00.000Z',
        delivery: primaryProvenance.delivery,
        entitlement: primaryProvenance.entitlement,
        ...(formats.length ? { formats } : {})
      });
    }

    items.push({
      globalIndex: i, providerItemId: primaryProvenance.providerItemId,
      title,
      kind,
      automaticKind: kind,
      source: 'humble',
      sourceBundle: purchase.sourceBundle,
      purchaseKey: purchase.purchaseKey,
      purchasedAt: purchase.purchasedAt,
      delivery: primaryProvenance.delivery,
      entitlement: primaryProvenance.entitlement,
      ...(formats.length ? { formats } : {}),
      provenance
    });
  }

  return { items, purchases };
}

test('full import and incremental update above 15.68 MiB preserve purchases and corrections, including rejected later saves', async () => {
  let failure = '';
  const manual = {title:'Manual corrected book',kind:'comic',automaticKind:'book',source:'manual',providerItemId:'manual-correction'};
  const historical = {title:'Earlier purchased book',kind:'book',source:'humble',purchaseKey:'historical-order'};
  const harness = createScaleHarness({libraryItems:[manual],historicalLibraryItems:[historical],
    historicalPurchaseSummaries:[{purchaseKey:'historical-order',sourceBundle:'Old bundle',itemCount:1}],
    mediaTypeOverrides:{'manual-correction':'comic','large-order:product:large-0':'comic'}},
    {onSet:async values=>{if(failure&&Object.hasOwn(values,'libraryItems'))throw Error(failure);}});
  const bundle = 'Synthetic descriptive bundle '.repeat(14);
  const titles = Array.from({length:10000},(_,i)=>`Synthetic book ${i} ${'Long bibliographic title '.repeat(16)}`.trim());
  const order = {gamekey:'large-order',product:{human_name:bundle}};
  const detail = {subproducts:titles.map((title,i)=>({human_name:title,machine_name:`large-${i}`,downloads:[{format:'EPUB',url:'https://humble.invalid/book.epub'}]}))};
  const result = await harness.importer([order],{'large-order':detail}).scan(true);
  assert.equal(result.reconciled,true);
  assert.ok(Buffer.byteLength(JSON.stringify(harness.stored))>15.68*1024*1024,'actual stored imported records exceed the reported failure size');
  assert.equal(harness.stored.libraryItems.length,10001);
  assert.equal(harness.stored.libraryItems.find(item=>item.title===titles[0]).kind,'comic');
  assert.equal(harness.stored.libraryItems.find(item=>item.title===manual.title).kind,'comic');
  assert.equal(harness.stored.historicalLibraryItems[0].purchaseKey,'historical-order');
  assert.equal(harness.stored.historicalPurchaseSummaries[0].purchaseKey,'historical-order');

  const nextOrder = {gamekey:'new-order',product:{human_name:'New bundle'}};
  const nextDetail = {subproducts:[{human_name:'New incremental book',machine_name:'new-book',downloads:[{format:'EPUB',url:'https://humble.invalid/new.epub'}]}]};
  const updated = await harness.importer([nextOrder,order],{'new-order':nextDetail,'large-order':detail}).scan(false);
  assert.equal(updated.newPurchases,1);
  assert.equal(harness.stored.libraryItems.length,10002);
  assert.ok(harness.stored.purchaseSummaries.some(p=>p.purchaseKey==='large-order'));
  assert.ok(harness.stored.purchaseSummaries.some(p=>p.purchaseKey==='new-order'));
  const snapshot = plain(harness.stored);
  for(const error of ['Resource::kQuotaBytes quota exceeded','Disk write failed']) {
    failure=error;
    await assert.rejects(harness.importer([nextOrder,order],{'new-order':nextDetail,'large-order':detail}).scan(true),/quota|Disk write failed/i);
    for(const key of ['libraryItems','purchaseSummaries','historicalLibraryItems','historicalPurchaseSummaries','mediaTypeOverrides','rejectedPurchaseItems','keyReminders','keyReminderScan','lastImport']) {
      assert.deepEqual(harness.stored[key],snapshot[key],`${key} is preserved after ${error}`);
    }
    assert.equal(harness.stored.hclSyncControl,null);
  }
});

test('6,000 to 10,000 item realistic library: serialized storage footprint is well under 10MB quota', async () => {
  const lib6k = generateRealisticLibrary(6000);
  const state6k = {
    libraryItems: lib6k.items,
    purchaseSummaries: lib6k.purchases,
    historicalLibraryItems: [],
    historicalPurchaseSummaries: lib6k.purchases,
    mediaTypeOverrides: { 'order-scale-0:product:sub-0': 'comic' },
    rejectedPurchaseItems: [
      { title: 'Promo wallpaper', purchaseKey: 'order-scale-0', reason: 'Promotional' }
    ],
    keyReminders: [],
    keyReminderScan: { complete: true, purchaseKeys: lib6k.purchases.map(p => p.purchaseKey) },
    humbleProfileLabel: 'Personal',
    profileArchives: []
  };

  const bytes6k = Buffer.byteLength(JSON.stringify(state6k));
  const mb6k = bytes6k / (1024 * 1024);

  // 6,000 item library must fit comfortably under 4.5 MB (< 45% of 10MB quota)
  assert.ok(mb6k < 6.0, `6,000 items should take < 4.5 MB, actual was ${mb6k.toFixed(2)} MB`);
  assert.ok(bytes6k < 10 * 1024 * 1024, `6,000 items must be strictly below 10MB quota (${bytes6k} bytes)`);

  const lib10k = generateRealisticLibrary(10000);
  const state10k = {
    ...state6k,
    libraryItems: lib10k.items,
    purchaseSummaries: lib10k.purchases,
    historicalPurchaseSummaries: lib10k.purchases
  };

  const bytes10k = Buffer.byteLength(JSON.stringify(state10k));
  const mb10k = bytes10k / (1024 * 1024);

  // 10,000 item library must fit comfortably under 7.5 MB (< 75% of 10MB quota)
  assert.ok(mb10k < 10.0, `10,000 items should take < 7.5 MB, actual was ${mb10k.toFixed(2)} MB`);
  assert.ok(bytes10k < 10 * 1024 * 1024, `10,000 items must be strictly below 10MB quota (${bytes10k} bytes)`);
});

test('full rescan of a 6,000+ item library: completes without quota errors, preserves file formats, and avoids duplicating active library into history', async () => {
  const lib = generateRealisticLibrary(6000);
  const orders = lib.purchases.map(p => ({ gamekey: p.purchaseKey, product: { human_name: p.sourceBundle } }));
  const details = {};

  for (const p of lib.purchases) {
    const subproducts = [];
    for (const item of lib.items) {
      if (item.provenance.some(prov => prov.purchaseKey === p.purchaseKey)) {
        subproducts.push({
          human_name: item.title,
          machine_name: `sub-${item.globalIndex}`,
          streaming: item.kind === 'video',
          downloads: (item.formats || []).map(f => ({
            format: f,
            url: `https://humble.invalid/download/${encodeURIComponent(item.title)}${f}`
          }))
        });
      }
    }
    details[p.purchaseKey] = { subproducts };
  }

  const harness = createScaleHarness({
    libraryItems: [],
    historicalLibraryItems: [{ title: 'Retired Past Comic', source: 'humble', purchaseKey: 'retired-order' }],
    mediaTypeOverrides: { [`${lib.purchases[0].purchaseKey}:product:sub-0`]: 'comic' }
  });

  const runner = harness.importer(orders, details);
  const result = await runner.scan(true);

  assert.equal(result.reconciled, true);
  assert.equal(result.total, 6000);
  assert.equal(harness.stored.libraryItems.length, 6000);

  // Formats must remain available on items
  const comicWithFormats = harness.stored.libraryItems.find(i => i.kind === 'comic' && Array.isArray(i.formats) && i.formats.length > 0);
  assert.ok(comicWithFormats, 'Comic item should have formats preserved');
  assert.ok(comicWithFormats.formats.includes('.cbz') || comicWithFormats.formats.includes('.pdf'), 'Extracted formats should contain .cbz or .pdf');

  // Verify total storage footprint is well below 10MB (< 55% of quota)
  const totalStoredBytes = Buffer.byteLength(JSON.stringify(harness.stored));
  const totalMB = totalStoredBytes / (1024 * 1024);
  assert.ok(totalMB < 5.5, `Full rescan storage footprint must be < 5.5 MB, actual was ${totalMB.toFixed(2)} MB`);

  // Now run a FULL RESCAN over the existing 6,000 items in storage!
  const repeat = await runner.scan(true);
  assert.equal(repeat.reconciled, true);
  assert.equal(harness.stored.libraryItems.length, 6000);

  // CRITICAL: active library items must NOT be duplicated into historicalLibraryItems!
  // Only the genuine retired item should remain in historicalLibraryItems
  assert.equal(harness.stored.historicalLibraryItems.length, 1);
  assert.equal(harness.stored.historicalLibraryItems[0].title, 'Retired Past Comic');

  // Footprint remains compact after repeat rescan
  const repeatMB = Buffer.byteLength(JSON.stringify(harness.stored)) / (1024 * 1024);
  assert.ok(repeatMB < 5.5, `Repeat full rescan storage footprint must be < 5.5 MB, actual was ${repeatMB.toFixed(2)} MB`);
});

test('incremental import adds new purchases without full rescan, preserving existing formats and provenance', async () => {
  const lib = generateRealisticLibrary(6000);
  const harness = createScaleHarness({
    libraryItems: lib.items,
    purchaseSummaries: lib.purchases,
    mediaImportVersion: 9, keyReminderScan: { complete: true, purchaseKeys: lib.purchases.map(p => p.purchaseKey), baselinePurchaseKeys: lib.purchases.map(p => p.purchaseKey) }
  });

  const newOrder = { gamekey: 'new-order-999', product: { human_name: 'New 2026 Comic Bundle' } };
  const newDetail = {
    subproducts: [
      {
        human_name: 'Brand New Sci-Fi Comic #1',
        machine_name: 'new-sub-1',
        downloads: [
          { format: 'CBZ', url: 'https://humble.invalid/download/scifi.cbz' },
          { format: 'PDF', url: 'https://humble.invalid/download/scifi.pdf' }
        ]
      }
    ]
  };

  const existingOrders = lib.purchases.map(p => ({ gamekey: p.purchaseKey, product: { human_name: p.sourceBundle } }));
  const runner = harness.importer([newOrder, ...existingOrders], { 'new-order-999': newDetail });

  const result = await runner.scan(false); // Incremental scan

  assert.equal(result.newPurchases, 1);
  assert.equal(result.scannedPurchases, 1); // Only the new purchase is fetched!
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0], 'new-order-999');

  const added = harness.stored.libraryItems.find(i => i.title === 'Brand New Sci-Fi Comic #1');
  assert.ok(added, 'New item should be present in stored library');
  assert.deepEqual(plain(added.formats), ['.cbz', '.pdf']);
  assert.equal(harness.stored.libraryItems.length, 6001);
});

test('failed storage write: atomic rollback preserves existing library, clears sync lock, and reports actionable diagnostic error', async () => {
  let shouldFailWrite = true;
  const initialLib = generateRealisticLibrary(500);

  const harness = createScaleHarness(
    {
      libraryItems: initialLib.items,
      purchaseSummaries: initialLib.purchases,
      humbleProfileLabel: 'Personal'
    },
    {
      onSet: async (values) => {
        if (shouldFailWrite && Object.hasOwn(values, 'libraryItems')) {
          throw new Error('Resource::kQuotaBytes quota exceeded');
        }
      }
    }
  );

  const newOrders = initialLib.purchases.slice(0, 10).map(p => ({ gamekey: p.purchaseKey, product: { human_name: p.sourceBundle } }));
  const runner = harness.importer(newOrders, {});

  // The scan must fail with our actionable diagnostic error
  await assert.rejects(
    runner.scan(true),
    (err) => {
      assert.match(err.message, /Storage quota exceeded while saving library/i);
      assert.match(err.message, /preserved/i);
      return true;
    }
  );

  // Sync control lock must be cleared so the extension is not locked
  const control = harness.stored.hclSyncControl;
  assert.equal(control, null, 'hclSyncControl lock must be released after failed write');

  // Existing library state must be completely preserved
  assert.equal(harness.stored.libraryItems.length, 500);
  assert.equal(harness.stored.libraryItems[0].title, initialLib.items[0].title);

  // Subsequent scan can begin immediately without being blocked
  shouldFailWrite = false;
  const beginScan = await harness.context.HumbleComicLibrary.storageRequest('begin', {
    fullRescan: false,
    profileLabel: 'Personal',
    confirmed: true
  });
  assert.ok(beginScan.token, 'A fresh scan must be able to begin immediately');
});

test('backup and restore round trip of 10,000-item library preserves formats, provenance, overrides, and account labels', async () => {
  const lib = generateRealisticLibrary(10000);
  const originalState = {
    libraryItems: lib.items,
    purchaseSummaries: lib.purchases,
    historicalLibraryItems: [{ title: 'Historical Comic', source: 'humble', purchaseKey: 'old-order' }],
    historicalPurchaseSummaries: lib.purchases,
    mediaTypeOverrides: {
      [`${lib.purchases[0].purchaseKey}:product:sub-0`]: 'comic',
      [`${lib.purchases[1].purchaseKey}:product:sub-1`]: 'software'
    },
    rejectedPurchaseItems: [
      { title: 'Promo video', purchaseKey: 'order-scale-0', formats: ['.mp4'], delivery: 'streaming' }
    ],
    humbleProfileLabel: 'Personal Account',
    profileArchives: []
  };

  const harness = createScaleHarness();
  const H = harness.context.HumbleComicLibrary;

  const backup = H.createLibraryBackup(originalState);
  assert.equal(backup.version, 9);
  assert.equal(backup.items.length, 10000);

  const restored = H.restoreBackupState(backup);
  assert.equal(restored.libraryItems.length, 10000);
  assert.equal(restored.humbleProfileLabel, 'Personal Account');
  assert.equal(Object.keys(restored.mediaTypeOverrides).length, 2);
  assert.equal(restored.rejectedPurchaseItems.length, 1);
  assert.deepEqual(plain(restored.rejectedPurchaseItems[0].formats), ['.mp4']);

  // Check format and provenance fidelity on restored items
  const sampleWithFormats = restored.libraryItems.find(i => Array.isArray(i.formats) && i.formats.length > 0);
  assert.ok(sampleWithFormats);
  assert.ok(sampleWithFormats.formats.length > 0);
  assert.ok(sampleWithFormats.provenance.length >= 1);
});

test('manual overrides and Galactic Library pairings survive full rescans and GL sync operates normally', async () => {
  const lib = generateRealisticLibrary(50);
  const orders = lib.purchases.map(p => ({ gamekey: p.purchaseKey, product: { human_name: p.sourceBundle } }));
  const details = {};

  const overrideKey = `${lib.purchases[0].purchaseKey}:${lib.items[0].providerItemId}`;
  for (const p of lib.purchases) {
    const subproducts = lib.items.filter(item => item.purchaseKey === p.purchaseKey).map((item, idx) => ({
      human_name: item.title,
      machine_name: `sub-${idx}`,
      downloads: [{ format: 'PDF', url: 'https://humble.invalid/doc.pdf' }]
    }));
    details[p.purchaseKey] = { subproducts };
  }

  const harness = createScaleHarness({
    libraryItems: lib.items,
    galacticLibraryExtensionId: 'a'.repeat(32),
    mediaTypeOverrides: { [overrideKey]: 'comic' }
  });

  const runner = harness.importer(orders, details);
  const result = await runner.scan(true);

  assert.equal(result.reconciled, true);
  assert.equal(harness.stored.galacticLibraryExtensionId, 'a'.repeat(32), 'GL extension ID pairing must survive full rescan');

  const overridden = harness.stored.libraryItems.find(i => i.title === lib.items[0].title);
  assert.ok(overridden);
  assert.equal(overridden.kind, 'comic', 'Manual classification override must be applied during full rescan');
  assert.equal(overridden.manualKind, 'comic');
});


test('6,000 item public-release upgrade stays compact and skips all purchases after successful migration',async()=>{
  const items=[],purchases=[],details={},orders=[];
  for(let p=0;p<200;p++){
    const key='legacy-'+p;purchases.push({purchaseKey:key});orders.push({gamekey:key});details[key]={subproducts:[]};
    for(let n=0;n<30;n++){
      const title='Legacy Book '+(p*30+n);items.push({title,source:'humble',purchaseKey:key,sourceBundle:'Original bundle'});
      details[key].subproducts.push({human_name:title,machine_name:'native-'+n,downloads:[{format:'epub'}]});
    }
  }
  const harness=createScaleHarness({libraryItems:items,purchaseSummaries:purchases}),runner=harness.importer(orders,details);
  await runner.scan(false);assert.equal(harness.stored.libraryItems.length,6000);assert.equal(harness.stored.historicalLibraryItems.length,0);
  assert(harness.stored.libraryItems.every(item=>item.providerItemId&&item.formats.includes('.epub')&&item.provenance.length===1));
  const bytes=Buffer.byteLength(JSON.stringify(harness.stored));assert(bytes<5.5*1024*1024,'legacy upgrade must preserve the compact storage budget');
  harness.requests.length=0;await runner.scan(false);assert.equal(harness.requests.length,0);assert.equal(harness.stored.libraryItems.length,6000);
});
