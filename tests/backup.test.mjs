import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const plain = (value) => JSON.parse(JSON.stringify(value));

function options(initial = {}) {
  const stored = structuredClone(initial);
  const elements = new Map();
  const writes = [];
  let exportedBlob;
  function element() {
    return {
      listeners: {}, files: [], value: '', children: [], dataset: {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      click() {}
    };
  }
  const context = {
    Blob, console, Date, encodeURIComponent,
    confirm: () => true,
    URL: { createObjectURL(blob) { exportedBlob = blob; return 'blob:test'; }, revokeObjectURL() {} },
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, element());
        return elements.get(selector);
      },
      createElement: element
    },
    chrome: {
      runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' },
      tabs: { create: async () => {} },
      storage: { local: {
        async get(defaults) { return { ...structuredClone(defaults), ...structuredClone(stored) }; },
        async set(value) { writes.push(plain(value)); Object.assign(stored, plain(value)); },
        async remove(keys) { for (const key of keys) delete stored[key]; }
      } }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ['shared.js', 'collection-mappings.js', 'options.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }
  return {
    stored, elements, writes, context,
    async load(selector, value) {
      const input = elements.get(selector);
      input.files = [{ text: async () => JSON.stringify(value) }];
      await input.listeners.change();
    },
    async export() {
      await elements.get('#export-library').listeners.click();
      return JSON.parse(await exportedBlob.text());
    },
    async exportWishlist() {
      await elements.get('#export-wishlist').listeners.click();
      return JSON.parse(await exportedBlob.text());
    }
  };
}

function libraryState() {
  return {
    libraryItems: [{
      title: 'Example Software', kind: 'software', source: 'humble', sourceBundle: 'Example Bundle',
      purchaseKey: 'order-one', purchasedAt: '2026-09-01',
      provenance: [
        { title: 'Example Software', sourceBundle: 'Example Bundle', purchaseKey: 'order-one', purchasedAt: '2026-09-01' },
        { title: 'Example Software', sourceBundle: 'Earlier Bundle', purchaseKey: 'order-two', purchasedAt: '2025-09-01' }
      ]
    }, { title: 'Manual legacy book', sourceBundle: '' }],
    purchaseSummaries: [{ purchaseKey: 'order-one', sourceBundle: 'Example Bundle', purchasedAt: '2026-09-01', itemCount: 1, pricePaid: 5, currency: 'USD', pricePerItem: 5 }],
    keyReminders: [{ id: 'reminder-one', purchaseKey: 'order-one', title: 'Example Software', sourceBundle: 'Example Bundle', purchasedAt: '2026-09-01', keyType: 'Publisher', status: 'unrevealed', directRedeem: false, isExpired: false, expiresAt: null, daysUntilExpiry: -1, checkedAt: '2026-09-02' }],
    keyReminderScan: { complete: false, checkedAt: '2026-09-02', purchaseKeys: ['order-one'], baselinePurchaseKeys: ['order-one', 'order-two'], failedPurchaseKeys: ['order-two'] },
    lastImport: { importedAt: '2026-09-02', scannedPurchases: 2, skippedKnown: 0, addedTitles: 1, addedGames: 0, addedSoftware: 1, addedAudiobooks: 0, datesBackfilled: 0, pricedPurchases: 1, skippedPurchases: 1, fullRescan: true, reconciled: false, failedPurchaseKeys: ['order-two'] },
    mediaImportVersion: 6,
    historicalLibraryItems: [{ title: 'Retired book', kind: 'book', source: 'humble', purchaseKey: 'retired-order', provenance: [{ title: 'Retired book', purchaseKey: 'retired-order' }] }],
    historicalPurchaseSummaries: [{ purchaseKey: 'retired-order', sourceBundle: 'Retired Bundle', itemCount: 1, pricePaid: null }],
    customCollectionMappings: [{ id: 'custom-one', collectionTitle: 'Example Collection', sourceLabel: 'Custom mapping', contains: [{ series: 'Example Series', year: 2000, from: 1, to: 4 }] }]
  };
}

test('wishlist options validate before writing, preserve bibliographic identity and export/restore separately', async () => {
  const target = options();
  await target.load('#wishlist-file', { wishlist: [{ title: 'Wishlist title', kind: 'book', weight: 3, authors: ['Writer'], purchaseKey: 'secret' }] });
  assert.equal(target.stored.wishlistItems.length, 1);
  assert.equal(target.stored.wishlistItems[0].purchaseKey, undefined);
  const exported = await target.exportWishlist();
  assert.deepEqual(exported.wishlist, target.stored.wishlistItems);
  // The import is intentionally independent of the full-library backup path.
  const before = structuredClone(target.stored);
  await target.load('#wishlist-file', [{ title: 'Bad priority', weight: 0 }]);
  assert.deepEqual(target.stored, before);
  assert.match(target.elements.get('#wishlist-status').textContent, /restore failed/u);
  target.context.document.querySelector('#wishlist-title').value = 'Added title';
  target.context.document.querySelector('#wishlist-kind').value = 'game';
  target.context.document.querySelector('#wishlist-weight').value = '5';
  await target.elements.get('#add-wishlist').listeners.click();
  assert.equal(target.stored.wishlistItems.at(-1).weight, 5);
  const list = target.elements.get('#wishlist-list');
  const priority = list.children.at(-1).children[0];
  priority.value = '8'; await priority.listeners.change();
  assert.equal(target.stored.wishlistItems.at(-1).weight, 8);
  await target.elements.get('#wishlist-list').children.at(-1).children[2].listeners.click();
  assert.equal(target.stored.wishlistItems.length, 1);
});

test('options export and restore round trip preserves complete library state and replaces unrelated reminders', async () => {
  const expected = libraryState();
  Object.assign(expected.libraryItems[0],{entitlement:'third-party-key',entitlementId:'software:0',keyType:'Publisher',keyStatus:'expired',expiresAt:'2026-09-30T00:00:00.000Z',keyCheckedAt:'2026-10-01T12:00:00.000Z'});
  Object.assign(expected.libraryItems[0].provenance[0],{entitlement:'third-party-key',entitlementId:'software:0',keyStatus:'expired',expiresAt:'2026-09-30T00:00:00.000Z'});
  Object.assign(expected.libraryItems[0].provenance[1],{entitlement:'third-party-key',entitlementId:'software:0',keyStatus:'unrevealed'});
  const source = options(expected);
  const backup = await source.export();
  assert.equal(backup.version, 8);
  const target = options({
    ...libraryState(), keyReminders: [{ id: 'unrelated', purchaseKey: 'other', title: 'Other item' }],
    showDiagnostics: true, galacticLibraryExtensionId: 'local-connection', hclPurchaseFocus: { purchaseKey: 'other' }
  });
  await target.load('#restore-file', backup);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(target.stored[key], value, key);
  assert.equal(target.stored.showDiagnostics, true);
  assert.equal(target.stored.galacticLibraryExtensionId, 'local-connection');
  assert.equal(target.stored.hclPurchaseFocus, null);
  assert.equal(target.writes.length, 1, 'library state is replaced in one storage write');
  assert.equal(target.elements.get('#restore-file').value, '');
  const reexport = await target.export();
  delete backup.exportedAt;
  delete reexport.exportedAt;
  assert.deepEqual(reexport, backup);
});

test('legacy backups clear absent data, preserve available provenance, and reset missing media scan version', async () => {
  const target = options(libraryState());
  const legacy = { version: 5, items: libraryState().libraryItems, purchases: [] };
  await target.load('#restore-file', legacy);
  assert.deepEqual(target.stored.libraryItems, legacy.items);
  assert.deepEqual(target.stored.purchaseSummaries, []);
  assert.deepEqual(target.stored.keyReminders, []);
  assert.deepEqual(target.stored.customCollectionMappings, []);
  assert.equal(target.stored.keyReminderScan, null);
  assert.equal(target.stored.lastImport, null);
  assert.equal(target.stored.mediaImportVersion, 1);
  assert.deepEqual(target.stored.historicalLibraryItems, []);
  assert.deepEqual(target.stored.historicalPurchaseSummaries, []);
});

test('manual title import is separate, deduplicates kinds, and clears old purchase and reminder state', async () => {
  const target = options(libraryState());
  await target.load('#import-file', [
    'Example Title', 'Example Title', { title: 'Example Title', kind: 'game', purchaseKey: 'discarded', provenance: [] }
  ]);
  assert.deepEqual(target.stored.libraryItems, [
    { title: 'Example Title', sourceBundle: '' }, { title: 'Example Title', sourceBundle: '', kind: 'game' }
  ]);
  for (const key of ['purchaseSummaries', 'keyReminders', 'customCollectionMappings', 'historicalLibraryItems', 'historicalPurchaseSummaries']) assert.deepEqual(target.stored[key], []);
  assert.equal(target.stored.keyReminderScan, null);
  assert.equal(target.stored.lastImport, null);
  assert.equal(target.stored.mediaImportVersion, 1);
  const backup = await target.export();
  const before = structuredClone(target.stored);
  await target.load('#import-file', backup);
  assert.deepEqual(target.stored, before);
  assert.match(target.elements.get('#import-status').textContent, /Use Restore backup/);
  await target.load('#restore-file', ['Manual title']);
  assert.deepEqual(target.stored, before);
});

test('version-6 backups remain restorable and clear any unrelated history archive', async () => {
  const source = options(libraryState());
  const legacy = await source.export();
  legacy.version = 6;
  delete legacy.historicalItems;
  delete legacy.historicalPurchases;
  const target = options(libraryState());
  await target.load('#restore-file', legacy);
  assert.deepEqual(target.stored.libraryItems, libraryState().libraryItems);
  assert.deepEqual(target.stored.keyReminderScan, libraryState().keyReminderScan);
  assert.deepEqual(target.stored.historicalLibraryItems, []);
  assert.deepEqual(target.stored.historicalPurchaseSummaries, []);
});

test('invalid and cancelled restores leave existing data intact', async () => {
  const target = options(libraryState());
  const valid = await target.export();
  const before = structuredClone(target.stored);
  const missing = structuredClone(valid);
  delete missing.keyReminders;
  for (const invalid of [
    missing, { ...valid, version: 999 }, { ...valid, purchases: null },
    { ...valid, mediaImportVersion: '6' }, { ...valid, items: [{ title: 'Bad', provenance: {} }] },
    { ...valid, keyReminders: [{ id: 'one', purchaseKey: 'one', title: 'Bad', status: 'revealed' }] },
    { ...valid, keyReminderScan: { complete: true, purchaseKeys: [42] } },
    { ...valid, collectionMappings: [{ collectionTitle: 'Invalid' }] }
  ]) {
    await target.load('#restore-file', invalid);
    assert.match(target.elements.get('#restore-status').textContent, /^Restore failed:/);
    assert.deepEqual(target.stored, before);
  }
  assert.equal(target.writes.length, 0);
  target.context.confirm = () => false;
  await target.load('#restore-file', valid);
  await target.load('#import-file', ['Cancelled']);
  assert.deepEqual(target.stored, before);
  assert.equal(target.writes.length, 0);
});

test('restores retain only supported data fields and never restore key values or unrelated settings', async () => {
  const source = options(libraryState());
  const backup = await source.export();
  backup.keyReminders[0].key_value = 'secret';
  backup.items[0].redemption_key = 'secret';
  backup.settings = { openDirectPurchaseLinks: true };
  const target = options({ openDirectPurchaseLinks: false });
  await target.load('#restore-file', backup);
  assert.equal(target.stored.keyReminders[0].key_value, undefined);
  assert.equal(target.stored.libraryItems[0].redemption_key, undefined);
  assert.equal(target.stored.openDirectPurchaseLinks, false);
  assert.equal(target.stored.settings, undefined);
});
