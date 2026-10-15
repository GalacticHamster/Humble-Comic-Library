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

test('HB file-type extraction: extracts distinct extensions from downloads metadata, not guessed from titles', async () => {
  const detail = {
    subproducts: [
      {
        machine_name: 'multi_format_book',
        human_name: 'Comics & Digital Art Guide',
        downloads: [
          { format: 'pdf', url: 'https://example.invalid/art.pdf' },
          { format: 'epub', url: 'https://example.invalid/art.epub' },
          { format: 'cbz', url: 'https://example.invalid/art.cbz' }
        ]
      },
      {
        machine_name: '3d_assets',
        human_name: '3D Character Model Kit',
        content_type: 'software',
        downloads: [
          { name: 'Blender Project (.blend)', url: 'https://example.invalid/model.blend' },
          { name: 'Unity Asset Package', url: 'https://example.invalid/kit.unitypackage' },
          { name: 'Source Files (ZIP)', url: 'https://example.invalid/archive.zip' }
        ]
      },
      {
        machine_name: 'feature_documentary',
        human_name: 'Indie Game Movie',
        video_streams: [{ format: '1080p' }],
        streaming: true,
        download_struct: [
          { name: '1080p (MP4)', url: { web: 'https://example.invalid/film.mp4' } }
        ]
      },
      {
        machine_name: 'unclassified_item',
        human_name: 'Mystery Direct Download Package',
        downloads: [
          { url: 'https://example.invalid/download/item-without-ext' }
        ]
      }
    ]
  };

  const harness = await createHarness();
  const items = vm.runInContext(`extractLibraryItems(${JSON.stringify(detail)}, { product: { human_name: 'Creative Bundle' } }, 'order-fmt-1')`, harness.context);
  assert.equal(items.length, 4);

  const book = items.find(i => i.title === 'Comics & Digital Art Guide');
  assert.deepEqual(plain(book.formats), ['.cbz', '.epub', '.pdf']);
  assert.equal(book.entitlement, 'direct-download');
  assert.equal(book.delivery, 'direct-download');

  const assets = items.find(i => i.title === '3D Character Model Kit');
  assert.deepEqual(plain(assets.formats), ['.blend', '.unitypackage', '.zip']);
  assert.equal(assets.kind, 'software');
  assert.equal(assets.delivery, 'direct-download');

  const film = items.find(i => i.title === 'Indie Game Movie');
  assert.deepEqual(plain(film.formats), ['.mp4']);
  assert.equal(film.kind, 'video');
  assert.equal(film.delivery, 'streaming');
  assert.equal(film.streaming, true);

  const unclassified = items.find(i => i.title === 'Mystery Direct Download Package');
  assert.equal(unclassified.kind, 'unclassified');
  assert.deepEqual(plain(unclassified.formats), []);
  assert.equal(unclassified.delivery, 'direct-download');
});

test('HB options UI: formats visibility in expanded row details and distinct explanations for missing formats', async () => {
  const harness = await createHarness({
    libraryItems: [
      {
        title: 'Digital Comic #1',
        kind: 'comic',
        formats: ['.cbz', '.pdf'],
        provenance: [{
          title: 'Digital Comic #1',
          sourceBundle: 'Comic Bundle',
          purchaseKey: 'hb-order-1',
          purchasedAt: '2026-03-01T00:00:00Z',
          entitlement: 'direct-download',
          formats: ['.cbz', '.pdf']
        }]
      },
      {
        title: 'Scanned Download Without Storefront Formats',
        kind: 'unclassified',
        formats: [],
        provenance: [{
          title: 'Scanned Download Without Storefront Formats',
          sourceBundle: 'Mystery Bundle',
          purchaseKey: 'hb-order-2',
          purchasedAt: '2026-03-02T00:00:00Z',
          entitlement: 'direct-download',
          formats: []
        }]
      },
      {
        title: 'Legacy Unscanned Book',
        kind: 'book',
        provenance: [{
          title: 'Legacy Unscanned Book',
          sourceBundle: 'Old Book Bundle',
          purchaseKey: 'hb-order-legacy',
          purchasedAt: '2025-01-01T00:00:00Z',
          entitlement: 'direct-download'
        }]
      },
      {
        title: 'Steam Game Entry',
        kind: 'game',
        provenance: [{
          title: 'Steam Game Entry',
          sourceBundle: 'Game Bundle',
          purchaseKey: 'hb-order-3',
          purchasedAt: '2026-03-03T00:00:00Z',
          entitlement: 'third-party-key',
          keyType: 'Steam',
          keyStatus: 'unrevealed'
        }]
      }
    ]
  });

  await harness.context.render();

  const preview = harness.elements.get('#library-preview');
  assert.equal(preview.children.length, 4);

  // 1. Item with formats displays "Formats: .cbz, .pdf"
  const comicRow = preview.children.find(r => r.textContent.includes('Digital Comic #1'));
  assert(comicRow, 'comic row found');
  const comicDetails = comicRow.children[0];
  const comicProvList = comicDetails.children.find(c => c.className === 'library-provenance-list');
  const comicProvItem = comicProvList.children[0];
  const comicSecondary = comicProvItem.children.find(c => c.className === 'library-provenance-secondary');
  assert.match(comicSecondary.textContent, /Formats:\s*\.cbz,\s*\.pdf/);
  assert.match(comicSecondary.textContent, /Direct download/);

  // 2. Scanned direct download item genuinely lacking formats in storefront metadata
  const scannedEmptyRow = preview.children.find(r => r.textContent.includes('Scanned Download Without Storefront Formats'));
  assert(scannedEmptyRow, 'scanned empty row found');
  const scannedDetails = scannedEmptyRow.children[0];
  const scannedProvList = scannedDetails.children.find(c => c.className === 'library-provenance-list');
  const scannedSecondary = scannedProvList.children[0].children.find(c => c.className === 'library-provenance-secondary');
  assert.match(scannedSecondary.textContent, /No file formats in purchase metadata/);

  // 3. Legacy unscanned item predating format extraction displays rescan requirement
  const legacyRow = preview.children.find(r => r.textContent.includes('Legacy Unscanned Book'));
  assert(legacyRow, 'legacy row found');
  const legacyDetails = legacyRow.children[0];
  const legacyProvList = legacyDetails.children.find(c => c.className === 'library-provenance-list');
  const legacySecondary = legacyProvList.children[0].children.find(c => c.className === 'library-provenance-secondary');
  assert.match(legacySecondary.textContent, /Format details require library rescan/);

  // 4. Key item displays Key information and not downloadable format notice
  const gameRow = preview.children.find(r => r.textContent.includes('Steam Game Entry'));
  assert(gameRow, 'game row found');
  const gameDetails = gameRow.children[0];
  const gameProvList = gameDetails.children.find(c => c.className === 'library-provenance-list');
  const gameProvItem = gameProvList.children[0];
  const gameSecondary = gameProvItem.children.find(c => c.className === 'library-provenance-secondary');
  assert.match(gameSecondary.textContent, /Key:\s*Steam/);
  assert(!gameSecondary.textContent.includes('File formats unavailable'));
  assert(!gameSecondary.textContent.includes('No file formats in purchase metadata'));
  assert(!gameSecondary.textContent.includes('Format details require library rescan'));
});

test('HB options UI: rejected purchase reviews display delivery and formats or unavailable indication', async () => {
  const harness = await createHarness({
    rejectedPurchaseItems: [
      {
        title: 'Archived Bonus Assets',
        purchaseKey: 'hb-order-rej-1',
        sourceBundle: 'Art Bundle',
        reason: 'Unverified content',
        delivery: 'direct-download',
        formats: ['.blend', '.zip']
      },
      {
        title: 'Getting Started Guide',
        purchaseKey: 'hb-order-rej-2',
        sourceBundle: 'Software Bundle',
        reason: 'Unclassified promotional or non-product content',
        delivery: 'direct-download'
      }
    ]
  });

  await harness.context.render();

  const rejectedList = harness.elements.get('#library-rejected-list');
  assert.equal(rejectedList.children.length, 2);

  const item1Meta = rejectedList.children[0].children.find(c => c.className === 'library-rejected-meta');
  assert.match(item1Meta.textContent, /Formats:\s*\.blend,\s*\.zip/);
  assert.match(item1Meta.textContent, /Direct download/);

  const item2Meta = rejectedList.children[1].children.find(c => c.className === 'library-rejected-meta');
  assert.match(item2Meta.textContent, /Format details require library rescan/);
});

test('HB backup export and restore preserves file formats and delivery metadata', async () => {
  const harness = await createHarness();
  const originalState = {
    libraryItems: [
      {
        title: 'Illustrated Book',
        kind: 'book',
        formats: ['.epub', '.pdf'],
        delivery: 'direct-download',
        provenance: [{
          title: 'Illustrated Book',
          sourceBundle: 'Reading Bundle',
          purchaseKey: 'order-bk',
          purchasedAt: '2026-01-01T00:00:00Z',
          entitlement: 'direct-download',
          delivery: 'direct-download',
          formats: ['.epub', '.pdf']
        }]
      }
    ],
    rejectedPurchaseItems: [
      {
        title: 'Sample Clip',
        purchaseKey: 'order-vid',
        sourceBundle: 'Film Bundle',
        reason: 'Short promotional clip',
        delivery: 'streaming',
        streaming: true,
        formats: ['.mp4']
      }
    ]
  };

  const backup = harness.context.HumbleComicLibrary.createLibraryBackup(originalState);
  const restored = harness.context.HumbleComicLibrary.restoreBackupState(backup);

  assert.deepEqual(plain(restored.libraryItems[0].formats), ['.epub', '.pdf']);
  assert.equal(restored.libraryItems[0].provenance[0].delivery, 'direct-download');
  assert.deepEqual(plain(restored.libraryItems[0].provenance[0].formats), ['.epub', '.pdf']);

  assert.equal(restored.rejectedPurchaseItems.length, 1);
  assert.deepEqual(plain(restored.rejectedPurchaseItems[0].formats), ['.mp4']);
  assert.equal(restored.rejectedPurchaseItems[0].delivery, 'streaming');
  assert.equal(restored.rejectedPurchaseItems[0].streaming, true);
});

test('HB realistic multi-format extraction and preservation across provenance merges and consolidation', async () => {
  const detail = {
    subproducts: [
      {
        machine_name: 'real_humble_comic',
        human_name: 'Saga Deluxe Edition Vol 1',
        downloads: [
          {
            machine_name: 'saga_ebook',
            platform: 'ebook',
            download_struct: [
              { name: 'PDF (HQ)', format: 'pdf', url: { web: 'https://dl.humble.com/get/uuid?sig=abc' } },
              { name: 'CBZ (HQ)', format: 'cbz', url: { web: 'https://dl.humble.com/get/uuid2?sig=def' } },
              { name: 'EPUB', format: 'epub', url: { web: 'https://dl.humble.com/get/uuid3?sig=ghi' } }
            ]
          }
        ]
      },
      {
        machine_name: 'real_humble_audio',
        human_name: 'Chiptune Soundtrack Anthology',
        downloads: [
          {
            platform: 'audio',
            download_struct: [
              { name: 'Lossless FLAC', format: 'audio' },
              { name: 'MP3 (320kbps)', format: 'audio' }
            ]
          }
        ]
      },
      {
        machine_name: 'custom_format_tool',
        human_name: 'Game Engine Toolkit',
        content_type: 'software',
        downloads: [
          {
            download_struct: [
              { format: 'Unity Package' },
              { name: 'Windows (.exe)', url: { web: 'https://example.invalid/setup.exe' } }
            ]
          }
        ]
      }
    ]
  };

  const harness = await createHarness();
  const items = vm.runInContext(`extractLibraryItems(${JSON.stringify(detail)}, { product: { human_name: 'Mega Bundle' } }, 'order-real-1')`, harness.context);
  assert.equal(items.length, 3);

  // Verify comic formats: .cbz, .epub, .pdf
  const comic = items.find(i => i.title.includes('Saga Deluxe'));
  assert.deepEqual(plain(comic.formats), ['.cbz', '.epub', '.pdf']);

  // Verify audio formats extracted from names despite generic 'audio' format: .flac, .mp3
  const audio = items.find(i => i.title.includes('Chiptune Soundtrack'));
  assert.deepEqual(plain(audio.formats), ['.flac', '.mp3']);

  // Verify custom format label 'Unity Package' preserved and .exe extracted
  const tool = items.find(i => i.title.includes('Game Engine Toolkit'));
  assert.deepEqual(plain(tool.formats), ['.exe', 'Unity Package']);

  // Verify mergeLibraryItem unions formats properly
  const duplicateComic = {
    ...comic,
    formats: ['.cbr'],
    provenance: [{
      title: comic.title,
      sourceBundle: 'Another Bundle',
      purchaseKey: 'order-real-2',
      purchasedAt: '2026-04-01T00:00:00Z',
      entitlement: 'direct-download',
      formats: ['.cbr']
    }]
  };
  const merged = vm.runInContext(`mergeLibraryItem(${JSON.stringify(comic)}, ${JSON.stringify(duplicateComic)})`, harness.context);
  assert.deepEqual(plain(merged.formats), ['.cbr', '.cbz', '.epub', '.pdf']);

  // Verify consolidateItemInto preserves formats
  const consolidated = vm.runInContext(`LibraryBrowser.consolidateItemInto(${JSON.stringify(comic)}, ${JSON.stringify(duplicateComic)})`, harness.context);
  assert.deepEqual(plain(consolidated.formats), ['.cbr', '.cbz', '.epub', '.pdf']);
});
