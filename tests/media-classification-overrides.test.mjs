import { wireStore } from './store-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const plain = (value) => JSON.parse(JSON.stringify(value));

async function createHarness(initial = {}) {
  const stored = { humbleProfileLabel: 'fixture', profileArchives: [], ...structuredClone(initial) };
  const elements = new Map();
  const sessionData = new Map();

  function element() {
    const classes = new Set();
    return {
      listeners: {}, files: [], value: '', children: [], dataset: {}, disabled: false, hidden: false,
      classList: {
        add(...cls) { cls.forEach(c => classes.add(c)); },
        remove(...cls) { cls.forEach(c => classes.delete(c)); },
        toggle(c, force) {
          if (force === true) classes.add(c);
          else if (force === false) classes.delete(c);
          else if (classes.has(c)) classes.delete(c);
          else classes.add(c);
        },
        contains(c) { return classes.has(c); }
      },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(name, value) { this[name] = value; },
      getAttribute(name) { return this[name] ?? null; },
      click() {}
    };
  }

  const context = {
    Blob, console, Date, encodeURIComponent, setTimeout, clearTimeout, Intl, crypto, TextEncoder, structuredClone,
    confirm: () => true, alert: () => {},
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
    sessionStorage: {
      getItem(key) { return sessionData.get(key) ?? null; },
      setItem(key, value) { sessionData.set(key, String(value)); },
      removeItem(key) { sessionData.delete(key); },
      clear() { sessionData.clear(); }
    },
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, element());
        return elements.get(selector);
      },
      querySelectorAll() {
        return [];
      },
      createElement: element
    },
    chrome: {
      runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' },
      tabs: { create: async () => {} },
      storage: {
        local: {
          async get(defaults) { return { ...structuredClone(defaults), ...structuredClone(stored) }; },
          async set(value) { Object.assign(stored, plain(value)); },
          async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; }
        }
      }
    }
  };

  wireStore(context);
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    'shared.js', 'collection-mappings.js', 'ownership.js', 'purchase-snapshot.js',
    'purchase-adapters.js', 'entitlement-share.js', 'content.js', 'options.js'
  ]) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }

  context.render = () => context.LibraryBrowser.renderOptions();
  await new Promise((resolve) => setTimeout(resolve, 20));

  return {
    stored, elements, context, sessionData,
    get: (sel) => context.document.querySelector(sel),
    async click(sel) { await context.document.querySelector(sel).listeners.click?.(); },
    async change(sel, val) {
      const el = context.document.querySelector(sel);
      el.value = val;
      await el.listeners.change?.();
    }
  };
}

test('unclassified purchase items are extracted, retained, and included in All view and Unclassified filter', async () => {
  const detail = {
    subproducts: [
      {
        machine_name: 'prod_unknown_archive',
        human_name: 'Mysterious Suite Package',
        downloads: [{ url: 'https://example.invalid/package.tar.gz' }]
      },
      {
        machine_name: 'prod_standard_book',
        human_name: 'Standard Digital Book',
        downloads: [{ url: 'https://example.invalid/book.epub' }]
      }
    ]
  };

  const baseHarness = await createHarness();
  const items = vm.runInContext(`extractLibraryItems(${JSON.stringify(detail)}, { product: { human_name: 'Mystery Bundle' } }, 'order-123')`, baseHarness.context);
  assert.equal(items.length, 2);
  const unclassifiedItem = items.find(i => i.title === 'Mysterious Suite Package');
  assert.ok(unclassifiedItem);
  assert.equal(unclassifiedItem.kind, 'unclassified');
  assert.equal(unclassifiedItem.automaticKind, 'unclassified');

  // Launch harness with items in libraryItems so options.js renders them on init
  const harness = await createHarness({ libraryItems: items });

  await harness.change('#library-filter-media', ''); // All media types
  const allChildren = harness.get('#library-preview').children;
  assert.equal(allChildren.length, 2);

  // Filter by unclassified
  await harness.change('#library-filter-media', 'unclassified');
  const unclassifiedChildren = harness.get('#library-preview').children;
  assert.equal(unclassifiedChildren.length, 1);
  assert.match(unclassifiedChildren[0].textContent, /Mysterious Suite Package/);

  // Filter by book
  await harness.change('#library-filter-media', 'book');
  const bookChildren = harness.get('#library-preview').children;
  assert.equal(bookChildren.length, 1);
  assert.match(bookChildren[0].textContent, /Standard Digital Book/);
});

test('promotional boilerplate is rejected before library import, but provides a reviewable recovery path', async () => {
  const harness = await createHarness();
  const { context } = harness;

  const detail = {
    subproducts: [
      {
        machine_name: 'promo_redeem',
        human_name: 'How to Redeem Your Software Keys',
        downloads: []
      },
      {
        machine_name: 'promo_terms',
        human_name: 'Terms and Conditions Guide',
        downloads: []
      },
      {
        machine_name: 'actual_app',
        human_name: 'Productivity Application',
        content_type: 'software',
        downloads: [{ url: 'https://example.invalid/app.exe' }]
      }
    ]
  };

  const items = vm.runInContext(`
    const rejectedList = [];
    const items = extractLibraryItems(${JSON.stringify(detail)}, { product: { human_name: 'Tech Bundle' } }, 'order-456', {}, rejectedList);
    __rejected = rejectedList;
    items;
  `, context);

  const capturedRejected = vm.runInContext('__rejected', context);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Productivity Application');
  assert.equal(capturedRejected.length, 2);
  assert.ok(capturedRejected.some(r => r.title.includes('How to Redeem')));
  assert.ok(capturedRejected.some(r => r.title.includes('Terms and Conditions')));

  // Test recovery of a rejected item into the library
  harness.stored.rejectedPurchaseItems = capturedRejected;
  harness.stored.libraryItems = items;

  const toRecover = capturedRejected[0];
  await vm.runInContext(`
    HumbleComicLibrary.storageRequest('recoverRejectedItem', ${JSON.stringify(toRecover)}, 'software');
  `, context);

  // Check state: item moved to libraryItems with kind 'software', removed from rejected
  assert.equal(harness.stored.rejectedPurchaseItems.length, 1);
  const recoveredInLib = harness.stored.libraryItems.find(i => i.title === toRecover.title);
  assert.ok(recoveredInLib);
  assert.equal(recoveredInLib.kind, 'software');
  assert.equal(recoveredInLib.manualKind, 'software');
  assert.equal(recoveredInLib.automaticKind, 'unclassified');
});

test('manual media-type override allows changing category across supported types and persists separately from automaticKind', async () => {
  const originalItem = {
    title: 'Visual Asset Pack Studio',
    kind: 'game', // Misclassified automatically as game
    automaticKind: 'game',
    source: 'humble',
    purchaseKey: 'order-789',
    providerItemId: 'order-789:product:asset_pack',
    sourceBundle: 'Creator Bundle'
  };

  const harness = await createHarness({ libraryItems: [originalItem] });
  const { context } = harness;

  // Apply manual override to 'software'
  await vm.runInContext(`
    HumbleComicLibrary.storageRequest('setMediaOverride', ${JSON.stringify(originalItem)}, 'software');
  `, context);

  const updatedItem = harness.stored.libraryItems[0];
  assert.equal(updatedItem.kind, 'software');
  assert.equal(updatedItem.manualKind, 'software');
  assert.equal(updatedItem.automaticKind, 'game'); // Original automatic evidence preserved
  assert.ok(harness.stored.mediaTypeOverrides);

  // Verify Reset to automatic
  await vm.runInContext(`
    HumbleComicLibrary.storageRequest('resetMediaOverride', ${JSON.stringify(updatedItem)});
  `, context);

  const resetItem = harness.stored.libraryItems[0];
  assert.equal(resetItem.kind, 'game');
  assert.equal(resetItem.automaticKind, 'game');
  assert.equal(resetItem.manualKind, undefined);
});

test('manual overrides are scoped to stable product identifiers and do not leak to unrelated products with same title', async () => {
  const itemA = {
    title: 'Developer Toolkit',
    kind: 'unclassified',
    automaticKind: 'unclassified',
    source: 'humble',
    purchaseKey: 'order-AAA',
    providerItemId: 'order-AAA:product:toolkit-1',
    sourceBundle: 'Bundle A'
  };

  const itemB = {
    title: 'Developer Toolkit',
    kind: 'unclassified',
    automaticKind: 'unclassified',
    source: 'humble',
    purchaseKey: 'order-BBB',
    providerItemId: 'order-BBB:product:toolkit-2',
    sourceBundle: 'Bundle B'
  };

  const harness = await createHarness({ libraryItems: [itemA, itemB] });
  const { context } = harness;

  // Override itemA only
  await vm.runInContext(`
    HumbleComicLibrary.storageRequest('setMediaOverride', ${JSON.stringify(itemA)}, 'software');
  `, context);

  const storedA = harness.stored.libraryItems.find(i => i.purchaseKey === 'order-AAA');
  const storedB = harness.stored.libraryItems.find(i => i.purchaseKey === 'order-BBB');

  assert.equal(storedA.kind, 'software');
  assert.equal(storedA.manualKind, 'software');
  assert.equal(storedB.kind, 'unclassified');
  assert.equal(storedB.manualKind, undefined);
});

test('manual overrides persist across rescans, merges, and backups', async () => {
  const item = {
    title: 'Comic Book Volume 1',
    kind: 'comic',
    automaticKind: 'book',
    manualKind: 'comic',
    source: 'humble',
    purchaseKey: 'order-999',
    providerItemId: 'order-999:product:cbv1',
    sourceBundle: 'Comics Bundle'
  };

  const harness = await createHarness();
  const { context } = harness;

  const overrideKey = vm.runInContext(`HumbleComicLibrary.mediaOverrideKey(${JSON.stringify(item)})`, context);
  harness.stored.libraryItems = [item];
  harness.stored.mediaTypeOverrides = { [overrideKey]: 'comic' };
  harness.stored.rejectedPurchaseItems = [{ title: 'Rejected Promo', purchaseKey: 'order-999' }];

  // 1. Verify mergeLibraryItem preserves override
  const incoming = {
    title: 'Comic Book Volume 1',
    kind: 'book', // Scanner detects book
    automaticKind: 'book',
    source: 'humble',
    purchaseKey: 'order-999',
    providerItemId: 'order-999:product:cbv1',
    purchasedAt: '2026-05-01T00:00:00Z'
  };

  const merged = vm.runInContext(`mergeLibraryItem(${JSON.stringify(item)}, ${JSON.stringify(incoming)})`, context);
  assert.equal(merged.kind, 'comic');
  assert.equal(merged.manualKind, 'comic');
  assert.equal(merged.automaticKind, 'book');
  assert.equal(merged.purchasedAt, '2026-05-01T00:00:00Z');

  // 2. Verify createLibraryBackup and restoreBackupState round-trip
  context.backupSource = harness.stored;
  const backup = vm.runInContext(`HumbleComicLibrary.createLibraryBackup(backupSource)`, context);
  assert.ok(backup.mediaTypeOverrides);
  assert.equal(backup.mediaTypeOverrides[overrideKey], 'comic');
  assert.equal(backup.rejectedPurchaseItems.length, 1);

  // Restore into a clean state
  const restored = vm.runInContext(`HumbleComicLibrary.restoreBackupState(${JSON.stringify(backup)})`, context);
  assert.equal(restored.mediaTypeOverrides[overrideKey], 'comic');
  assert.equal(restored.rejectedPurchaseItems.length, 1);
  const restoredItem = restored.libraryItems.find(i => i.title === 'Comic Book Volume 1');
  assert.equal(restoredItem.kind, 'comic');
  assert.equal(restoredItem.manualKind, 'comic');
  assert.equal(restoredItem.automaticKind, 'book');
});

test('software edition and version differences prevent false exact ownership', async () => {
  const harness = await createHarness();
  const { context } = harness;

  const conflictsFn = (offered, owned, exact = true) => vm.runInContext(`
    HumbleOwnership.conflicts(${JSON.stringify(offered)}, ${JSON.stringify(owned)}, ${exact})
  `, context);

  // 1. Version differences (2026 vs 2025)
  const offeredVer = { title: 'Sound Forge Pro 2026', kind: 'software' };
  const ownedVer = { title: 'Sound Forge Pro 2025', kind: 'software' };
  const verConflicts = conflictsFn(offeredVer, ownedVer);
  assert.ok(verConflicts.includes('Different edition/package wording'), 'Version differences must conflict');

  // 2. Edition differences (Deluxe vs Standard)
  const offeredEd = { title: 'Video Studio Deluxe', kind: 'software' };
  const ownedEd = { title: 'Video Studio Standard', kind: 'software' };
  const edConflicts = conflictsFn(offeredEd, ownedEd);
  assert.ok(edConflicts.includes('Different edition/package wording'), 'Edition differences must conflict');

  // 3. Exact matching editions
  const offeredSame = { title: 'Code Editor Pro', kind: 'software' };
  const ownedSame = { title: 'Code Editor Pro', kind: 'software' };
  const sameConflicts = conflictsFn(offeredSame, ownedSame);
  assert.equal(sameConflicts.length, 0, 'Exact same editions should have no conflicts');
});

test('GL integration respects GL snapshot and entitlement sharing contracts', async () => {
  const harness = await createHarness();
  const { context } = harness;

  // 1. GL Snapshot media type mapping
  const snapshotKind = (kind) => vm.runInContext(`GalacticPurchaseAdapters.glSnapshotMediaType('${kind}')`, context);
  assert.equal(snapshotKind('comic'), 'book', 'Comics must map to book in GL snapshot');
  assert.equal(snapshotKind('book'), 'book');
  assert.equal(snapshotKind('game'), 'game');
  assert.equal(snapshotKind('software'), 'software');
  assert.equal(snapshotKind('audiobook'), 'audiobook');
  assert.equal(snapshotKind('unclassified'), 'other', 'Unclassified must map to other in GL snapshot');
  assert.equal(snapshotKind('video'), 'other', 'Video must map to other in GL snapshot');

  // 2. GL Entitlement Share projection mapping
  const salt = '12345678-1234-1234-1234-123456789012';
  const state = {
    humbleProfileLabel: 'test-account',
    keyReminderScan: { complete: true },
    libraryItems: [
      {
        title: 'Spider-Man Comic',
        kind: 'comic',
        source: 'humble',
        purchaseKey: 'p1',
        provenance: [{
          title: 'Spider-Man Comic',
          purchaseKey: 'p1',
          entitlement: 'third-party-key',
          keyCheckedAt: '2026-10-01T00:00:00Z',
          keyStatus: 'unrevealed'
        }]
      },
      {
        title: 'Unknown Utility Tool',
        kind: 'unclassified',
        source: 'humble',
        purchaseKey: 'p2',
        provenance: [{
          title: 'Unknown Utility Tool',
          purchaseKey: 'p2',
          entitlement: 'third-party-key',
          keyCheckedAt: '2026-10-01T00:00:00Z',
          keyStatus: 'unrevealed'
        }]
      },
      {
        title: 'Indie Video Feature',
        kind: 'video',
        source: 'humble',
        purchaseKey: 'p3',
        provenance: [{
          title: 'Indie Video Feature',
          purchaseKey: 'p3',
          entitlement: 'third-party-key',
          keyCheckedAt: '2026-10-01T00:00:00Z',
          keyStatus: 'unrevealed'
        }]
      }
    ]
  };

  context.shareState = state;
  context.shareSalt = salt;
  const feed = await vm.runInContext(`HumbleEntitlements.project(shareState, shareSalt)`, context);
  assert.equal(feed.entries.length, 3);

  const comicEntry = feed.entries.find(e => e.title === 'Spider-Man Comic');
  assert.equal(comicEntry.mediaType, 'book', 'Comic must project to book in GL entitlement feed');

  const unclassifiedEntry = feed.entries.find(e => e.title === 'Unknown Utility Tool');
  assert.equal(unclassifiedEntry.mediaType, 'unknown', 'Unclassified must project to unknown in GL entitlement feed');

  const videoEntry = feed.entries.find(e => e.title === 'Indie Video Feature');
  assert.equal(videoEntry.mediaType, 'unknown', 'Video must project to unknown in GL entitlement feed');

  // 3. Inbound merge from GL snapshot preserves manual overrides and maps other to unclassified
  const glIncomingItem = {
    title: 'External GL Other Item',
    mediaType: 'other',
    metadata: { purchaseId: 'order-gl-1', sourceBundle: 'GL Bundle' },
    purchasedAt: '2026-05-01T00:00:00Z'
  };

  const hbMerged = vm.runInContext(`
    GalacticPurchaseAdapters.hbMerge([], [${JSON.stringify(glIncomingItem)}])
  `, context);
  assert.equal(hbMerged.items.length, 1);
  assert.equal(hbMerged.items[0].kind, 'unclassified', 'GL other maps to unclassified in HB');

  // Verify manual override is preserved if existing item has one
  const existingItem = {
    title: 'External GL Other Item',
    kind: 'software',
    manualKind: 'software',
    source: 'humble',
    purchaseKey: 'order-gl-1',
    provenance: [{ title: 'External GL Other Item', purchaseKey: 'order-gl-1' }]
  };
  const hbMergedWithOverride = vm.runInContext(`
    GalacticPurchaseAdapters.hbMerge([${JSON.stringify(existingItem)}], [${JSON.stringify(glIncomingItem)}])
  `, context);
  assert.equal(hbMergedWithOverride.items.length, 1);
  assert.equal(hbMergedWithOverride.items[0].kind, 'software', 'Manual override preserved during inbound GL merge');
  assert.equal(hbMergedWithOverride.items[0].manualKind, 'software');
});

test('unimported / rejected purchases UI: discoverable section, empty state, review, recovery, dismissal, and deduplication', async () => {
  const harness = await createHarness({
    libraryItems: [{ title: 'Existing Book', kind: 'book', purchaseKey: 'order-1', providerItemId: 'order-1:product:book' }],
    rejectedPurchaseItems: []
  });
  const { context } = harness;

  // 1. Trace rendering: empty state when 0 rejected items
  await vm.runInContext('render()', context);
  const rejectedSection = context.document.querySelector('#library-rejected-section');
  const rejectedCount = context.document.querySelector('#library-rejected-count');
  const rejectedEmpty = context.document.querySelector('#library-rejected-empty');
  const rejectedActions = context.document.querySelector('#library-rejected-actions');
  const rejectedList = context.document.querySelector('#library-rejected-list');

  assert.equal(rejectedSection.hidden, false, 'Rejected section is never hidden in the DOM');
  assert.equal(rejectedCount.textContent, '0');
  assert.equal(rejectedEmpty.hidden, false, 'Informative empty state is visible');
  assert.equal(rejectedActions.hidden, true, 'Actions hidden when list is empty');
  assert.equal(rejectedList.children.length, 0);

  // 2. Populated state when rejected items exist
  const promo1 = {
    title: 'How to Redeem Your Keys',
    purchaseKey: 'order-101',
    providerItemId: 'order-101:product:promo1',
    sourceBundle: 'Bundle 101',
    reason: 'Unclassified promotional or non-product content'
  };
  const promo2 = {
    title: 'Terms and Conditions Guide',
    purchaseKey: 'order-101',
    providerItemId: 'order-101:product:promo2',
    sourceBundle: 'Bundle 101',
    reason: 'Unclassified promotional or non-product content'
  };

  harness.stored.rejectedPurchaseItems = [promo1, promo2];
  await vm.runInContext('render()', context);

  assert.equal(rejectedCount.textContent, '2');
  assert.equal(rejectedEmpty.hidden, true, 'Empty state is hidden when items exist');
  assert.equal(rejectedActions.hidden, false, 'Actions are visible');
  assert.equal(rejectedList.children.length, 2);

  // 3. Test individual item dismissal
  await vm.runInContext(`
    HumbleComicLibrary.storageRequest('dismissRejectedItem', ${JSON.stringify(promo1)});
  `, context);
  assert.equal(harness.stored.rejectedPurchaseItems.length, 1);
  assert.equal(harness.stored.rejectedPurchaseItems[0].title, promo2.title);

  // 4. Test dismiss all
  await vm.runInContext(`
    HumbleComicLibrary.storageRequest('dismissRejectedItem', null);
  `, context);
  assert.equal(harness.stored.rejectedPurchaseItems.length, 0);

  // 5. Duplicate rejection prevention across multiple scans
  const detail = {
    subproducts: [
      { machine_name: 'how_to_redeem', human_name: 'How to Redeem Guide', downloads: [] },
      { machine_name: 'real_app', human_name: 'Useful Utility', content_type: 'software', downloads: [{ url: 'https://example.invalid/app.exe' }] }
    ]
  };
  const rejectedCollector = [];
  vm.runInContext(`
    extractLibraryItems(${JSON.stringify(detail)}, {}, 'order-202', {}, __rejCol);
    extractLibraryItems(${JSON.stringify(detail)}, {}, 'order-202', {}, __rejCol);
  `, Object.assign(context, { __rejCol: rejectedCollector }));

  assert.equal(rejectedCollector.length, 1, 'Duplicate rejected item was prevented from accumulating');
});

test('video purchases: streaming-only and multi-platform videos are recognized, retained, searchable, and filtered', async () => {
  const harness = await createHarness();
  const { context } = harness;

  // 1. Streaming-only video purchase
  const streamingDetail = {
    subproducts: [
      {
        machine_name: 'indie_game_stream',
        human_name: 'Indie Game: The Movie',
        streaming: true,
        video_streams: [{ name: '1080p Stream', stream_url: 'https://example.invalid/stream.m3u8' }]
      }
    ]
  };
  const streamingItems = vm.runInContext(`
    extractLibraryItems(${JSON.stringify(streamingDetail)}, { product: { human_name: 'Indie Film Bundle' } }, 'order-vid-1');
  `, context);

  assert.equal(streamingItems.length, 1);
  assert.equal(streamingItems[0].title, 'Indie Game: The Movie');
  assert.equal(streamingItems[0].kind, 'video', 'Streaming video is recognized as video');

  // 2. Downloadable video tagged with platform: "windows"
  const downloadableVidDetail = {
    subproducts: [
      {
        machine_name: 'documentary_film',
        human_name: 'Documentary Feature Film',
        downloads: [
          {
            platform: 'windows',
            download_struct: [{ name: '1080p (MP4)', url: { web: 'https://example.invalid/film.mp4' } }]
          }
        ]
      }
    ]
  };
  const downloadableItems = vm.runInContext(`
    extractLibraryItems(${JSON.stringify(downloadableVidDetail)}, {}, 'order-vid-2');
  `, context);

  assert.equal(downloadableItems.length, 1);
  assert.equal(downloadableItems[0].title, 'Documentary Feature Film');
  assert.equal(downloadableItems[0].kind, 'video', 'Video with platform windows is not falsely captured as a game');

  // 3. Search and filter by video in options library browser
  harness.stored.libraryItems = [
    { title: 'Indie Game: The Movie', kind: 'video', mediaType: 'video', purchaseKey: 'v1' },
    { title: 'Action Game', kind: 'game', mediaType: 'game', purchaseKey: 'g1' },
    { title: 'Tech eBook', kind: 'book', mediaType: 'book', purchaseKey: 'b1' }
  ];
  await vm.runInContext('render()', context);

  // Filter by video
  const vidFiltered = context.LibraryBrowser.filterAndSortLibrary(harness.stored.libraryItems, '', 'video', '', 'title-asc');
  assert.equal(vidFiltered.length, 1);
  assert.equal(vidFiltered[0].title, 'Indie Game: The Movie');

  // Search by video title
  const titleSearch = context.LibraryBrowser.filterAndSortLibrary(harness.stored.libraryItems, 'Indie Game', '', '', 'title-asc');
  assert.equal(titleSearch.length, 1);
  assert.equal(titleSearch[0].title, 'Indie Game: The Movie');
});

test('books/comics vs comics filter consistency: broad vs subset semantics and existing library migration', async () => {
  const harness = await createHarness();
  const { context } = harness;

  const comicA = { title: 'Spawn Vol. 1', kind: 'comic', sourceBundle: 'Humble Comics Bundle: Spawn', purchaseKey: 'c1' };
  const comicB = { title: 'Saga #1', kind: 'book', sourceBundle: 'Humble Comics Bundle: Saga', formats: ['CBZ', 'PDF'], purchaseKey: 'c2' };
  const bookC = { title: 'Python Programming Guide', kind: 'book', sourceBundle: 'Humble Book Bundle: Python', formats: ['PDF', 'EPUB'], purchaseKey: 'b1' };
  const gameD = { title: 'Hollow Knight', kind: 'game', purchaseKey: 'g1' };

  harness.stored.libraryItems = [comicA, comicB, bookC, gameD];
  await vm.runInContext('render()', context);

  // 1. Broad reading category: "book" filter includes Books and Comics
  const bookFilterResults = context.LibraryBrowser.filterAndSortLibrary(harness.stored.libraryItems, '', 'book', '', 'title-asc');
  assert.equal(bookFilterResults.length, 3, 'Books/Comics filter contains all books and comics');
  assert.ok(bookFilterResults.some(i => i.title === 'Spawn Vol. 1'));
  assert.ok(bookFilterResults.some(i => i.title === 'Saga #1'));
  assert.ok(bookFilterResults.some(i => i.title === 'Python Programming Guide'));
  assert.ok(!bookFilterResults.some(i => i.title === 'Hollow Knight'));

  // 2. Specific comics category: "comic" filter isolates comics
  const comicFilterResults = context.LibraryBrowser.filterAndSortLibrary(harness.stored.libraryItems, '', 'comic', '', 'title-asc');
  assert.equal(comicFilterResults.length, 2, 'Comics filter isolates only comics');
  assert.ok(comicFilterResults.some(i => i.title === 'Spawn Vol. 1'));
  assert.ok(comicFilterResults.some(i => i.title === 'Saga #1'));
  assert.ok(!comicFilterResults.some(i => i.title === 'Python Programming Guide'));

  // 3. User manual override
  await vm.runInContext(`
    HumbleComicLibrary.storageRequest('setMediaOverride', ${JSON.stringify(bookC)}, 'comic');
  `, context);
  await vm.runInContext('render()', context);

  const updatedComicResults = context.LibraryBrowser.filterAndSortLibrary(harness.stored.libraryItems, '', 'comic', '', 'title-asc');
  assert.equal(updatedComicResults.length, 3, 'Manually overridden book is now included in comics');

  // Reset override
  await vm.runInContext(`
    HumbleComicLibrary.storageRequest('resetMediaOverride', ${JSON.stringify(bookC)});
  `, context);
  await vm.runInContext('render()', context);

  const resetComicResults = context.LibraryBrowser.filterAndSortLibrary(harness.stored.libraryItems, '', 'comic', '', 'title-asc');
  assert.equal(resetComicResults.length, 2, 'Reset to automatic restores original classification');
});

test('options diagnostics summary displays breakdown by media type and shows backfill advice when older records predate version 8', async () => {
  const harness = await createHarness({
    libraryItems: [
      { title: 'Comic Item', kind: 'comic' },
      { title: 'Book Item', kind: 'book' },
      { title: 'Game Item', kind: 'game' }
    ],
    purchaseSummaries: [{ purchaseKey: 'p1', pricePaid: 15 }],
    mediaImportVersion: 7, // Predates version 8
    rejectedPurchaseItems: [{ title: 'Promo Item', purchaseKey: 'p1' }]
  });
  const { context } = harness;

  await vm.runInContext('render()', context);

  const diagnostics = context.document.querySelector('#library-classification-diagnostics');
  assert.ok(diagnostics, 'Diagnostics container is rendered');
  const pills = diagnostics.children[0];
  assert.ok(pills, 'Diagnostics pills list rendered');
  const pillTexts = pills.children.map(c => c.textContent);

  assert.ok(pillTexts.some(t => t.includes('Comics: 1')));
  assert.ok(pillTexts.some(t => t.includes('Books: 1')));
  assert.ok(pillTexts.some(t => t.includes('Games: 1')));
  assert.ok(pillTexts.some(t => t.includes('Videos: 0')));
  assert.ok(pillTexts.some(t => t.includes('Unimported / Rejected: 1')));

  // Rescan tip for version < 8
  const rescanTip = diagnostics.children[1];
  assert.ok(rescanTip, 'Rescan tip rendered for version < 8');
  assert.match(rescanTip.textContent, /run a scan from the Humble Bundle website/i);
});
