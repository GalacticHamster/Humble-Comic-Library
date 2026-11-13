import { wireStore } from './store-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { load, nativeObservation, entitlements, ACCOUNT } from './library-browser-fixture.mjs';

// Options page with the native module enabled and the presentation model loaded.
async function harness(initial = {}, { enabled = true } = {}) {
  const stored = { humbleProfileLabel: 'Main', humbleAccountId: ACCOUNT, profileArchives: [], ...structuredClone(initial) };
  const elements = new Map(), writes = [], sessionData = new Map(), opened = [];
  const element = () => ({ listeners: {}, files: [], value: '', children: [], dataset: {}, disabled: false,
    addEventListener(type, handler) { this.listeners[type] = handler; }, append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }, setAttribute(name, value) { this[name] = value; }, click() {} });
  const context = { Blob, console, Date, encodeURIComponent, setTimeout, clearTimeout, Intl, confirm: () => true,
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
    sessionStorage: { getItem: (k) => sessionData.get(k) ?? null, setItem: (k, v) => sessionData.set(k, String(v)), removeItem: (k) => sessionData.delete(k), clear: () => sessionData.clear() },
    document: { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); }, createElement: element },
    chrome: { runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' }, tabs: { create: async (o) => { opened.push(o.url); } },
      storage: { local: { async get(defaults) { return { ...structuredClone(defaults), ...structuredClone(stored) }; }, async set(value) { writes.push(JSON.parse(JSON.stringify(value))); Object.assign(stored, value); }, async remove(keys) { for (const k of [].concat(keys)) delete stored[k]; } } } } };
  wireStore(context);
  context.globalThis = context;
  vm.createContext(context);
  const entitlementSource = fs.readFileSync(new URL('../library-entitlements.js', import.meta.url), 'utf8');
  vm.runInContext(enabled ? entitlementSource.replace('const ENABLED = false;', 'const ENABLED = true;') : entitlementSource, context);
  for (const file of ['shared.js', 'collection-mappings.js', 'library-browser.js', 'options.js']) vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const get = (sel) => context.document.querySelector(sel);
  return { stored, writes, sessionData, opened, context, get,
    rows: () => get('#library-preview').children,
    note: () => get('#preview-note').textContent,
    async input(sel, value) { get(sel).value = value; await get(sel).listeners.input?.(); },
    async change(sel, value) { const el = get(sel); if (value !== undefined) el.value = value; await el.listeners.change?.(); },
    async view(name) { const radio = get(name === 'groups' ? '#library-view-groups' : '#library-view-titles'); radio.checked = true; radio.value = name; await radio.listeners.change?.(); },
    expand(row) { const details = row.children[0]; details.open = true; details.listeners.toggle?.(); return details; } };
}
const historical = (title, purchaseKey, sourceBundle, extra = {}) => ({ title, kind: 'comic', source: 'humble', purchaseKey, sourceBundle, purchasedAt: '2024-03-01T00:00:00.000Z', ...extra });
const text = (node) => [node.textContent ?? '', ...(node.children ?? []).map(text)].join(' ');
const summaries = (ui) => ui.rows().map((row) => row.children[0].children[0].textContent);

test('Titles stays the default view and its search still matches titles only unless a bundle scope is chosen', async () => {
  const ui = await harness({ libraryItems: [historical('Amazing Spider-Man #1', 'K1', 'Marvel Masterworks'), historical('Saga #1', 'K2', 'Image Bundle')] });
  assert.equal(ui.get('#library-view-titles').checked, true);
  assert.equal(ui.rows().length, 2);
  await ui.input('#library-search', 'marvel');
  assert.equal(ui.rows().length, 0, 'title search does not silently match bundle names');
  await ui.change('#library-search-scope', 'bundle');
  assert.deepEqual(ui.rows().map((r) => r.textContent), ['Amazing Spider-Man #1 — in 1 bundle']);
  await ui.input('#library-search', 'saga');
  assert.equal(ui.rows().length, 0, 'bundle scope matches bundle names, not titles');
  await ui.change('#library-search-scope', 'both');
  assert.equal(ui.rows().length, 1);
  assert.equal(ui.writes.length, 0, 'browsing never writes storage');
});

test('Bundles & Orders lists purchases as groups, keeps Titles state, and paginates at 20, 50, 100 and 200', async () => {
  const libraryItems = Array.from({ length: 900 }, (_, i) => historical(`Issue ${i}`, `K${i % 450}`, `Bundle ${String(i % 450).padStart(3, '0')}`));
  const ui = await harness({ libraryItems });
  await ui.input('#library-search', 'issue 1');
  await ui.change('#library-page-size', '20');
  await ui.view('groups');
  assert.equal(ui.get('#library-search-label').textContent, 'Find bundles and orders');
  assert.equal(ui.get('#library-search-scope').value, 'both');
  await ui.input('#library-search', '');
  for (const size of [20, 50, 100, 200]) {
    await ui.change('#library-page-size', String(size));
    assert.equal(ui.rows().length, size);
    assert.match(ui.note(), new RegExp(`Showing ${size} of 450 purchase groups \\(page 1 of ${Math.ceil(450 / size)}\\)`));
  }
  await ui.get('#library-next').listeners.click();
  assert.match(ui.note(), /page 2 of 3/);
  assert.equal(ui.rows()[0].children[0].children[0].textContent.startsWith('Bundle 200 — Order · 2 titles'), true);
  await ui.get('#library-next').listeners.click();
  assert.equal(ui.rows().length, 50);assert.equal(ui.get('#library-next').disabled, true);
  await ui.view('titles');
  assert.equal(ui.get('#library-view-titles').checked, true);
  assert.match(ui.note(), /of 900 items/, 'the Titles view and its counts are unchanged');
  assert.equal(JSON.parse(ui.sessionData.get('hb_library_browser_state')).view, 'titles');
  await ui.view('groups');
  assert.match(ui.note(), /page 3 of 3/, 'each view keeps its own page');
});

test('contained-title search marks matches, lists every purchase containing the title, and duplicate purchases stay separate', async () => {
  const ui = await harness({ libraryItems: [historical('Amazing Spider-Man #1', 'K1', 'Marvel Bundle'), historical('Hulk #1', 'K1', 'Marvel Bundle'),
    historical('Amazing Spider-Man #1', 'K2', 'Marvel Bundle', { purchasedAt: '2025-02-02T00:00:00.000Z' }), historical('Saga #1', 'K3', 'Image Bundle')] });
  await ui.view('groups');
  await ui.change('#library-search-scope', 'title');
  await ui.input('#library-search', 'spider-man');
  assert.deepEqual(summaries(ui).sort(), ['Marvel Bundle — Order · 1 title · Purchased 2025-02-02 · Historical import · 1 matching title', 'Marvel Bundle — Order · 2 titles · Purchased 2024-03-01 · Historical import · 1 matching title']);
  const details = ui.expand(ui.rows().find((r) => /2 titles/.test(r.children[0].children[0].textContent)));
  const contents = details.children.find((c) => c.className?.includes('library-group-contents'));
  assert.equal(contents.children[0].children[0].textContent, 'Match: Amazing Spider-Man #1');
  assert.equal(contents.children[1].children[0].textContent, 'Hulk #1');
  assert.match(text(details), /One of 2 separate purchases with this name/);
  assert.match(text(details), /no direct link/, 'historical orders explain the missing Humble link');
  assert(!details.children.some((c) => c.className?.includes('library-open-humble')));
  await ui.change('#library-group-filter', 'repeat');
  assert.equal(ui.rows().length, 2);
});

test('native purchases appear separately from same-named history, with verified links, gifts, unknown activation and batching', async () => {
  const { E } = load();
  const obs = [nativeObservation(E, { id: 1, parent: 100, title: 'Celeste', namespace: 'steam', parentTitle: 'Indie Bundle' }), nativeObservation(E, { id: 2, parent: 100, title: 'Gifted Game', namespace: 'steam', gifted: true, parentTitle: 'Indie Bundle' }),
    ...Array.from({ length: 250 }, (_, i) => nativeObservation(E, { id: 10 + i, parent: 200, title: `Store item ${i}`, parentType: 'storefront' }))];
  const ui = await harness({ libraryItems: [historical('Celeste', 'K1', 'Indie Bundle', { kind: 'game' })], libraryEntitlements: entitlements(obs, ACCOUNT, null) });
  await ui.view('groups');
  assert.match(ui.note(), /Showing 3 of 3 purchase groups/);
  await ui.change('#library-group-filter', 'shared-name');
  assert.deepEqual(summaries(ui).sort(), ['Indie Bundle — Bundle · 2 titles · Date not recorded · Native Library', 'Indie Bundle — Order · 1 title · Purchased 2024-03-01 · Historical import']);
  const native = ui.expand(ui.rows().find((r) => /Native Library/.test(text(r))));
  assert.match(text(native), /not confirmed to be the same purchase/);
  assert.match(text(native), /Steam activation is unknown/);
  assert.match(text(native), /Celeste Game · Steam key · Activation unknown · Purchased/);
  assert.match(text(native), /Gifted Game Game · Steam key · Activation unknown · Excluded: gifted/);
  await native.children.find((c) => c.className?.includes('library-open-humble')).listeners.click({});
  await ui.change('#library-group-filter', '');
  await ui.change('#library-group-type', 'store');
  assert.deepEqual(summaries(ui), ['Humble purchase (name appears after the next full sync) — Store purchase · 250 titles · Date not recorded · Native Library']);
  const store = ui.expand(ui.rows()[0]);
  const list = store.children.find((c) => c.className?.includes('library-group-contents')), more = store.children.find((c) => c.className?.includes('library-group-more'));
  assert.equal(list.children.length, 100, 'contents render in batches');
  more.listeners.click();assert.equal(list.children.length, 200);more.listeners.click();assert.equal(list.children.length, 250);assert.equal(more.hidden, true);
  await list.children[0].children[2].listeners.click({});
  assert.deepEqual(ui.opened, ['https://www.humblebundle.com/home/library/00000000-0000-4000-8000-000000000100', 'https://www.humblebundle.com/home/library/content/00000000-0000-4000-8000-000000000010']);
  assert.equal(ui.writes.length, 0);
});

test('native records from another account, a disabled collector or an empty library show no native groups', async () => {
  const { E } = load();
  const obs = [nativeObservation(E, { id: 1, parent: 100, title: 'Celeste', namespace: 'steam' })];
  for (const [initial, options] of [[{ libraryEntitlements: entitlements(obs, '22222222-2222-4222-8222-222222222222') }, {}], [{ libraryEntitlements: entitlements(obs) }, { enabled: false }]]) {
    const ui = await harness(initial, options);await ui.view('groups');
    assert.equal(ui.rows().length, 0);assert.match(ui.note(), /No bundles or orders are stored yet/);
  }
  const ui = await harness({ libraryEntitlements: entitlements(obs, ACCOUNT, null), libraryItems: [] });await ui.view('groups');
  await ui.input('#library-search', 'zzz');
  assert.match(ui.note(), /No bundles or orders match your search or filter criteria \(0 of 1 purchase groups\)/);
});
