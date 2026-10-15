import { wireStore } from './store-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const plain = (value) => JSON.parse(JSON.stringify(value));

const item = (title, extra = {}) => ({
  title,
  source: 'humble',
  kind: 'book',
  mediaType: 'book',
  sourceBundle: 'Test bundle',
  purchasedAt: null,
  ...extra
});

async function optionsHarness(initial = {}) {
  const stored = { humbleProfileLabel: 'fixture', profileArchives: [], ...structuredClone(initial) };
  const elements = new Map();
  const writes = [];
  const sessionData = new Map();

  function element() {
    return {
      listeners: {}, files: [], value: '', children: [], dataset: {}, disabled: false,
      addEventListener(type, handler) { this.listeners[type] = handler; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(name, value) { this[name] = value; },
      click() {}
    };
  }

  const context = {
    Blob, console, Date, encodeURIComponent, setTimeout, clearTimeout, Intl,
    confirm: () => true,
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
      createElement: element
    },
    chrome: {
      runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' },
      tabs: { create: async () => {} },
      storage: {
        local: {
          async get(defaults) { return { ...structuredClone(defaults), ...structuredClone(stored) }; },
          async set(value) { writes.push(plain(value)); Object.assign(stored, plain(value)); },
          async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; }
        }
      }
    }
  };

  wireStore(context);
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ['shared.js', 'collection-mappings.js', 'options.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }
  await new Promise((resolve) => setTimeout(resolve, 20));

  return {
    stored, elements, writes, context, sessionData,
    get: (sel) => context.document.querySelector(sel),
    async click(sel) { await context.document.querySelector(sel).listeners.click?.(); },
    async input(sel, val) {
      const el = context.document.querySelector(sel);
      el.value = val;
      await el.listeners.input?.();
    },
    async change(sel, val) {
      const el = context.document.querySelector(sel);
      if (val !== undefined) el.value = val;
      await el.listeners.change?.();
    }
  };
}

test('options library preview is bounded, naturally ordered, and displays bundle provenance', async () => {
  const ui = await optionsHarness({
    libraryItems: [
      item('Comic #10'),
      item('Comic #2'),
      ...Array.from({ length: 50 }, (_, i) => item(`Z ${i}`))
    ]
  });

  const preview = ui.get('#library-preview');
  assert.equal(preview.children.length, 50);
  assert.deepEqual(
    preview.children.slice(0, 2).map((row) => row.textContent),
    ['Comic #2 — in 1 bundle', 'Comic #10 — in 1 bundle']
  );
  assert.match(ui.get('#preview-note').textContent, /50 of 52/);
  assert.match(ui.get('#preview-note').textContent, /alphabetically/);
});

test('options library search filters items by title case-insensitively', async () => {
  const ui = await optionsHarness({
    libraryItems: [
      item('Alpha Comic'),
      item('Beta Guide'),
      item('Gamma Novel')
    ]
  });

  assert.equal(ui.get('#library-preview').children.length, 3);
  await ui.input('#library-search', 'beta');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.equal(ui.get('#library-preview').children[0].textContent, 'Beta Guide — in 1 bundle');
  assert.match(ui.get('#preview-note').textContent, /Showing 1 of 1 items \(filtered from 3\)/);

  await ui.input('#library-search', 'NOMATCH');
  assert.equal(ui.get('#library-preview').children.length, 0);
  assert.match(ui.get('#preview-note').textContent, /No items match your search or filter criteria/);

  await ui.input('#library-search', '');
  assert.equal(ui.get('#library-preview').children.length, 3);
});

test('options library media filter isolates books, games, software, and audiobooks', async () => {
  const ui = await optionsHarness({
    libraryItems: [
      item('Book One', { kind: 'book', mediaType: 'book' }),
      item('Game One', { kind: 'game', mediaType: 'game' }),
      item('Software One', { kind: 'software', mediaType: 'software' }),
      item('Audiobook One', { kind: 'audiobook', mediaType: 'audiobook' })
    ]
  });

  assert.equal(ui.get('#library-preview').children.length, 4);

  await ui.change('#library-filter-media', 'game');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.match(ui.get('#library-preview').children[0].textContent, /Game One/);

  await ui.change('#library-filter-media', 'software');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.match(ui.get('#library-preview').children[0].textContent, /Software One/);

  await ui.change('#library-filter-media', 'audiobook');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.match(ui.get('#library-preview').children[0].textContent, /Audiobook One/);

  await ui.change('#library-filter-media', 'book');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.match(ui.get('#library-preview').children[0].textContent, /Book One/);

  await ui.change('#library-filter-media', '');
  assert.equal(ui.get('#library-preview').children.length, 4);
});

test('options library metadata filter isolates dated, bundle, humble, manual, key, and download items', async () => {
  const ui = await optionsHarness({
    libraryItems: [
      item('Dated Item', { purchasedAt: '2026-05-01' }),
      item('Undated Standalone', { sourceBundle: '', purchasedAt: null }),
      item('Manual Title', { source: 'manual', sourceBundle: '' }),
      item('Key Item', { keys: [{ keyType: 'steam' }] }),
      item('Download Item', { downloads: [{ platform: 'all' }] })
    ]
  });

  await ui.change('#library-filter-metadata', 'dated');
  assert.equal(ui.get('#library-preview').children[0].textContent, 'Dated Item — in 1 bundle');
  assert.match(ui.get('#library-preview').children[0].children[0].children[1].children[0].textContent, /2026-05-01/);

  await ui.change('#library-filter-metadata', 'bundle');
  assert.equal(ui.get('#library-preview').children.length, 3); // Dated Item, Key Item, Download Item

  await ui.change('#library-filter-metadata', 'manual');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.match(ui.get('#library-preview').children[0].textContent, /Manual Title/);

  await ui.change('#library-filter-metadata', 'humble');
  assert.equal(ui.get('#library-preview').children.length, 4);

  await ui.change('#library-filter-metadata', 'key');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.match(ui.get('#library-preview').children[0].textContent, /Key Item/);

  await ui.change('#library-filter-metadata', 'download');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.match(ui.get('#library-preview').children[0].textContent, /Download Item/);
});

test('options library sorting supports title A-Z, title Z-A, date newest, and date oldest', async () => {
  const ui = await optionsHarness({
    libraryItems: [
      item('Beta Book', { purchasedAt: '2026-01-15' }),
      item('Alpha Book', { purchasedAt: '2026-08-20' }),
      item('Gamma Book', { purchasedAt: null })
    ]
  });

  // Default: title-asc
  assert.deepEqual(
    ui.get('#library-preview').children.map((r) => r.textContent.split(' — ')[0]),
    ['Alpha Book', 'Beta Book', 'Gamma Book']
  );

  // title-desc
  await ui.change('#library-sort', 'title-desc');
  assert.deepEqual(
    ui.get('#library-preview').children.map((r) => r.textContent.split(' — ')[0]),
    ['Gamma Book', 'Beta Book', 'Alpha Book']
  );
  assert.match(ui.get('#preview-note').textContent, /reverse alphabetically/);

  // date-desc (newest first, undated at end)
  await ui.change('#library-sort', 'date-desc');
  assert.deepEqual(
    ui.get('#library-preview').children.map((r) => r.textContent.split(' — ')[0]),
    ['Alpha Book', 'Beta Book', 'Gamma Book']
  );
  assert.match(ui.get('#preview-note').textContent, /by purchase date \(newest\)/);

  // date-asc (oldest first, undated at end)
  await ui.change('#library-sort', 'date-asc');
  assert.deepEqual(
    ui.get('#library-preview').children.map((r) => r.textContent.split(' — ')[0]),
    ['Beta Book', 'Alpha Book', 'Gamma Book']
  );
  assert.match(ui.get('#preview-note').textContent, /by purchase date \(oldest\)/);
});

test('options library pagination handles selectable page sizes, previous/next, and out-of-bounds clamping', async () => {
  const items = Array.from({ length: 55 }, (_, i) => item(`Item ${String(i).padStart(2, '0')}`));
  const ui = await optionsHarness({ libraryItems: items });

  // Default: 50 items per page
  assert.equal(ui.get('#library-preview').children.length, 50);
  assert.equal(ui.get('#library-previous').disabled, true);
  assert.equal(ui.get('#library-next').disabled, false);
  assert.match(ui.get('#preview-note').textContent, /Showing 50 of 55 items \(page 1 of 2\)/);

  await ui.click('#library-next');
  assert.equal(ui.get('#library-preview').children.length, 5);
  assert.equal(ui.get('#library-previous').disabled, false);
  assert.equal(ui.get('#library-next').disabled, true);
  assert.match(ui.get('#preview-note').textContent, /Showing 5 of 55 items \(page 2 of 2\)/);

  await ui.click('#library-previous');
  assert.equal(ui.get('#library-preview').children.length, 50);

  // Change page size to 20
  await ui.change('#library-page-size', '20');
  assert.equal(ui.get('#library-preview').children.length, 20);
  assert.match(ui.get('#preview-note').textContent, /Showing 20 of 55 items \(page 1 of 3\)/);

  // Change page size to 100
  await ui.change('#library-page-size', '100');
  assert.equal(ui.get('#library-preview').children.length, 55);
  assert.equal(ui.get('#library-previous').disabled, true);
  assert.equal(ui.get('#library-next').disabled, true);
});

test('options library browser preserves state in sessionStorage and restores upon re-render', async () => {
  const ui = await optionsHarness({
    libraryItems: [
      item('Alpha One'),
      item('Beta Two'),
      item('Gamma Three')
    ]
  });

  await ui.input('#library-search', 'Two');
  await ui.change('#library-sort', 'title-desc');
  await ui.change('#library-page-size', '20');

  // Verify sessionStorage has saved the state
  const rawSession = ui.sessionData.get('hb_library_browser_state');
  assert(rawSession);
  const parsed = JSON.parse(rawSession);
  assert.equal(parsed.search, 'Two');
  assert.equal(parsed.sort, 'title-desc');
  assert.equal(parsed.pageSize, 20);

  // Re-render via LibraryBrowser.render
  ui.context.LibraryBrowser.render();
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.equal(ui.get('#library-search').value, 'Two');
  assert.equal(ui.get('#library-sort').value, 'title-desc');
  assert.equal(ui.get('#library-page-size').value, '20');
});

test('exact duplicate library items consolidate into one row with expandable provenance details', async () => {
  const ui = await optionsHarness({
    libraryItems: [
      item('Exact Game', {
        kind: 'game',
        mediaType: 'game',
        sourceBundle: 'First Bundle',
        purchaseKey: 'order-1',
        purchasedAt: '2026-01-15T00:00:00Z',
        entitlement: 'third-party-key',
        keyType: 'Steam',
        keyStatus: 'revealed'
      }),
      item('Exact Game', {
        kind: 'game',
        mediaType: 'game',
        sourceBundle: 'Second Bundle',
        purchaseKey: 'order-2',
        purchasedAt: '2026-06-20T00:00:00Z',
        entitlement: 'third-party-key',
        keyType: 'Steam',
        keyStatus: 'unrevealed'
      })
    ]
  });

  const preview = ui.get('#library-preview');
  // Both purchases consolidate into 1 exact library row
  assert.equal(preview.children.length, 1);
  const row = preview.children[0];
  assert.equal(row.textContent, 'Exact Game — in 2 bundles');

  // Expandable details element
  assert.equal(row.children.length, 1);
  const details = row.children[0];
  assert.equal(details.className, 'library-item-details');
  const summary = details.children[0];
  assert.equal(summary.className, 'library-item-summary');
  assert.equal(summary.textContent, 'Exact Game — in 2 bundles');

  // Provenance list shows both individual purchases ordered newest first
  const list = details.children[1];
  assert.equal(list.className, 'library-provenance-list');
  assert.equal(list.children.length, 2);
  assert.match(list.children[0].textContent, /Bundle: Second Bundle · Purchased: 2026-06-20 · Order: order-2 · Key: Steam \(unrevealed\)/);
  assert.match(list.children[1].textContent, /Bundle: First Bundle · Purchased: 2026-01-15 · Order: order-1 · Key: Steam \(revealed\)/);
});

test('distinct bundle counting preserves repeated purchases from the same bundle', async () => {
  const ui = await optionsHarness({
    libraryItems: [
      item('Saga Vol. 1', {
        sourceBundle: 'Image Comics Bundle',
        purchasedAt: '2022-03-01',
        purchaseKey: 'order-1'
      }),
      item('Saga Vol. 1', {
        sourceBundle: 'Image Comics Bundle',
        purchasedAt: '2024-08-15',
        purchaseKey: 'order-2'
      })
    ]
  });

  const preview = ui.get('#library-preview');
  assert.equal(preview.children.length, 1);
  const row = preview.children[0];
  // Since both purchases are from the same bundle, count is 1 bundle
  assert.equal(row.textContent, 'Saga Vol. 1 — in 1 bundle');

  // Both individual purchases remain accessible in expanded details
  const details = row.children[0];
  const list = details.children[1];
  assert.equal(list.children.length, 2);
  assert.match(list.children[0].textContent, /Purchased: 2024-08-15 · Order: order-2/);
  assert.match(list.children[1].textContent, /Purchased: 2022-03-01 · Order: order-1/);
});

test('purchase history sorting orders purchases newest first with undated records last', async () => {
  const ui = await optionsHarness({
    libraryItems: [
      {
        title: 'Saga Vol. 1',
        kind: 'book',
        provenance: [
          { sourceBundle: 'Bundle 2022 A', purchasedAt: '2022-01-10', purchaseKey: 'k1' },
          { sourceBundle: 'Bundle 2025', purchasedAt: '2025-06-01', purchaseKey: 'k2' },
          { sourceBundle: 'Bundle 2022 B', purchasedAt: '2022-09-15', purchaseKey: 'k3' },
          { sourceBundle: 'Bundle 2023', purchasedAt: '2023-11-20', purchaseKey: 'k4' },
          { sourceBundle: 'Undated Bundle', purchasedAt: null, purchaseKey: 'k5' }
        ]
      }
    ]
  });

  const preview = ui.get('#library-preview');
  assert.equal(preview.children.length, 1);
  const row = preview.children[0];
  assert.equal(row.textContent, 'Saga Vol. 1 — in 5 bundles');

  const list = row.children[0].children[1];
  assert.equal(list.children.length, 5);
  // Newest first: 2025, 2023, 2022-09, 2022-01, undated last
  assert.match(list.children[0].textContent, /Bundle: Bundle 2025 · Purchased: 2025-06-01/);
  assert.match(list.children[1].textContent, /Bundle: Bundle 2023 · Purchased: 2023-11-20/);
  assert.match(list.children[2].textContent, /Bundle: Bundle 2022 B · Purchased: 2022-09-15/);
  assert.match(list.children[3].textContent, /Bundle: Bundle 2022 A · Purchased: 2022-01-10/);
  assert.match(list.children[4].textContent, /Bundle: Undated Bundle/);
  assert.doesNotMatch(list.children[4].textContent, /Purchased:/);
});

test('different editions, versions, and volumes remain separate and are not consolidated', async () => {
  const ui = await optionsHarness({
    libraryItems: [
      item('Hero Comic', { edition: 'Standard Edition', sourceBundle: 'Bundle A' }),
      item('Hero Comic', { edition: 'Deluxe Edition', sourceBundle: 'Bundle B' }),
      item('Saga Series', { volume: '1', sourceBundle: 'Bundle C' }),
      item('Saga Series', { volume: '2', sourceBundle: 'Bundle D' }),
      item('Adventure Game', { kind: 'game', mediaType: 'game', sourceBundle: 'Bundle E' }),
      item('Adventure Game', { kind: 'book', mediaType: 'book', sourceBundle: 'Bundle F' })
    ]
  });

  const preview = ui.get('#library-preview');
  // Different editions, volumes, and kinds must remain distinct items
  assert.equal(preview.children.length, 6);
  const note = ui.get('#preview-note').textContent;
  assert.match(note, /Showing 6 of 6 items/);
});

test('incomplete or missing provenance is handled gracefully', async () => {
  const ui = await optionsHarness({
    libraryItems: [
      'Manual Book Without Provenance',
      item('Item With Partial Provenance', { sourceBundle: '', purchasedAt: null, purchaseKey: '' })
    ]
  });

  const preview = ui.get('#library-preview');
  assert.equal(preview.children.length, 2);

  const manualRow = preview.children.find((r) => r.textContent.includes('Manual Book Without Provenance'));
  assert(manualRow);
  assert.equal(manualRow.textContent, 'Manual Book Without Provenance — manual entry');
  const manualDetails = manualRow.children[0];
  assert.equal(manualDetails.className, 'library-item-details');
  assert.equal(manualDetails.children[0].textContent, 'Manual Book Without Provenance — manual entry');
  assert.equal(manualDetails.children[1].textContent, 'No bundle or purchase record stored.');
});

test('ui.css configures library-preview with 4.25rem padding-left to prevent clipping 3-5 digit item numbers', () => {
  const css = fs.readFileSync(new URL('../ui.css', import.meta.url), 'utf8');
  assert.match(css, /#library-preview\s*\{[^}]*padding-left:\s*4\.25rem/);
});
