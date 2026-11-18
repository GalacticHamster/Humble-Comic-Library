import { wireStore } from './store-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { load, nativeObservation, entitlements, ACCOUNT } from './library-browser-fixture.mjs';
// Fixture dates are UTC midnights; Options shows dates in the browser's time zone.
process.env.TZ = 'UTC';

// Options page with the native module enabled and the presentation model loaded.
async function harness(initial = {}, { enabled = true } = {}) {
  const stored = { humbleProfileLabel: 'Main', humbleAccountId: ACCOUNT, profileArchives: [], ...structuredClone(initial) };
  const elements = new Map(), writes = [], sessionData = new Map(), opened = [], exports = [], changeListeners = [];
  const element = () => ({ listeners: {}, files: [], value: '', children: [], dataset: {}, disabled: false,
    addEventListener(type, handler) { this.listeners[type] = handler; }, append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }, setAttribute(name, value) { this[name] = value; }, click() {} });
  const context = { Blob, console, Date, encodeURIComponent, setTimeout, clearTimeout, Intl, confirm: () => true,
    URL: { createObjectURL(blob) { exports.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    sessionStorage: { getItem: (k) => sessionData.get(k) ?? null, setItem: (k, v) => sessionData.set(k, String(v)), removeItem: (k) => sessionData.delete(k), clear: () => sessionData.clear() },
    document: { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); }, createElement: element },
    chrome: { runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' }, tabs: { create: async (o) => { opened.push(o.url); } },
      storage: { local: { async get(defaults) { return { ...structuredClone(defaults), ...structuredClone(stored) }; }, async set(value) { writes.push(JSON.parse(JSON.stringify(value))); Object.assign(stored, value); }, async remove(keys) { for (const k of [].concat(keys)) delete stored[k]; } }, onChanged: { addListener: (fn) => changeListeners.push(fn) } } } };
  wireStore(context);
  context.globalThis = context;
  vm.createContext(context);
  const entitlementSource = fs.readFileSync(new URL('../library-entitlements.js', import.meta.url), 'utf8');
  vm.runInContext(enabled ? entitlementSource : entitlementSource.replace('const ENABLED = true;', 'const ENABLED = false;'), context);
  for (const file of ['shared.js', 'collection-mappings.js', 'library-browser.js', 'options.js']) vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const get = (sel) => context.document.querySelector(sel);
  return { stored, writes, sessionData, opened, context, get, changeListeners,
    async exportCatalog() { await get("#export-catalog").listeners.click(); return JSON.parse(await exports.at(-1).text()); },
    async exportCsv() { await get('#export-catalog-csv').listeners.click(); return exports.at(-1).text(); },
    // Another context writes storage: the stored values change, then local listeners are notified.
    external(values) { const changes = {}; for (const [k, v] of Object.entries(values)) { changes[k] = { oldValue: stored[k], newValue: structuredClone(v) }; stored[k] = structuredClone(v); } for (const fn of changeListeners) fn(changes, 'local'); },
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
  assert.deepEqual(ui.rows().map((r) => r.textContent), ['Amazing Spider-Man #1 — 1 purchase']);
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

test('grouped by default: a likely historical/native match is one purchase; Separate sources shows both, keeping search', async () => {
  const { E } = load();
  const obs = [nativeObservation(E, { id: 1, parent: 100, title: 'Celeste', namespace: 'steam', parentTitle: 'Indie Bundle' }), nativeObservation(E, { id: 2, parent: 100, title: 'Gifted Game', namespace: 'steam', gifted: true, parentTitle: 'Indie Bundle' }),
    ...Array.from({ length: 250 }, (_, i) => nativeObservation(E, { id: 10 + i, parent: 200, title: `Store item ${i}`, parentType: 'storefront' }))];
  const ui = await harness({ libraryItems: [historical('Celeste', 'K1', 'Indie Bundle', { kind: 'game' })], libraryEntitlements: entitlements(obs, ACCOUNT, null) });
  await ui.view('groups');
  assert.equal(ui.get('#library-group-mode').value, 'grouped');
  assert.match(ui.note(), /Showing 2 of 2 purchase groups\. 1 purchase combined from historical and Humble Library records\./);
  await ui.change('#library-group-filter', 'both');
  assert.deepEqual(summaries(ui), ['Indie Bundle — Bundle · 2 titles · Purchased 2024-03-01 · Historical + Native · Likely match']);
  const unified = ui.expand(ui.rows()[0]);
  assert.match(text(unified), /the same name, and all 1 title of the smaller record appear in the other/);
  assert.match(text(unified), /1 title only in the Humble Library/);
  assert.match(text(unified), /Steam activation is unknown/);
  assert.match(text(unified), /Celeste Game · Steam key · Activation unknown · Purchased/, 'a title in both records is shown once with both classifications');
  assert.match(text(unified), /Gifted Game Game · Steam key · Activation unknown · Excluded: gifted · Humble Library only/);
  assert.doesNotMatch(text(unified), /not confirmed/);
  await unified.children.find((c) => c.className?.includes('library-open-humble')).listeners.click({});
  await ui.change('#library-group-filter', '');
  await ui.input('#library-search', 'celeste');
  await ui.change('#library-group-mode', 'separate');
  assert.deepEqual(summaries(ui).sort(), ['Indie Bundle — Bundle · 2 titles · Purchase date not recorded · Native Library · 1 matching title', 'Indie Bundle — Order · 1 title · Purchased 2024-03-01 · Historical import · 1 matching title']);
  assert.match(text(ui.expand(ui.rows()[0])), /Shown combined with its likely match in the Grouped view/);
  assert.equal(ui.get('#library-search').value, 'celeste', 'switching modes keeps the search');
  await ui.change('#library-group-mode', 'grouped');
  assert.equal(ui.rows().length, 1);
  await ui.input('#library-search', '');
  await ui.change('#library-group-type', 'store');
  assert.deepEqual(summaries(ui), ['Humble purchase (name appears after the next full sync) — Store purchase · 250 titles · Purchase date not recorded · Native Library']);
  const store = ui.expand(ui.rows()[0]);
  const list = store.children.find((c) => c.className?.includes('library-group-contents')), more = store.children.find((c) => c.className?.includes('library-group-more'));
  assert.equal(list.children.length, 100, 'contents render in batches');
  more.listeners.click();assert.equal(list.children.length, 200);more.listeners.click();assert.equal(list.children.length, 250);assert.equal(more.hidden, true);
  await list.children[0].children[2].listeners.click({});
  assert.deepEqual(ui.opened, ['https://www.humblebundle.com/home/library/00000000-0000-4000-8000-000000000100', 'https://www.humblebundle.com/home/library/content/00000000-0000-4000-8000-000000000010']);
  assert.equal(ui.writes.length, 0);
});

test('without native records the Sources control is unavailable and history shows as before', async () => {
  const ui = await harness({ libraryItems: [historical('Saga #1', 'K1', 'Image Bundle')] });
  await ui.view('groups');
  assert.equal(ui.get('#library-group-mode').disabled, true);
  assert.deepEqual(summaries(ui), ['Image Bundle — Order · 1 title · Purchased 2024-03-01 · Historical import']);
  assert.doesNotMatch(ui.note(), /combined/);
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

test('key reminders open a likely Library item or the Library itself and never write storage', async () => {
  const { E } = load();
  const obs = [nativeObservation(E, { id: 1, parent: 10, title: 'Celeste', parentTitle: 'Indie Bundle', namespace: 'steam' }),
    nativeObservation(E, { id: 2, parent: 20, title: 'Repeat', parentTitle: 'Monthly', namespace: 'steam' }), nativeObservation(E, { id: 3, parent: 21, title: 'Repeat', parentTitle: 'Monthly', namespace: 'steam' })];
  const reminder = (purchaseKey, title) => ({ id: purchaseKey, purchaseKey, title, sourceBundle: 'x', keyType: 'Steam', status: 'unrevealed', directRedeem: false, isExpired: false, checkedAt: '2026-01-01T00:00:00.000Z' });
  const ui = await harness({ libraryItems: [historical('Celeste', 'K1', 'Indie Bundle', { kind: 'game' }), historical('Repeat', 'R1', 'Monthly', { kind: 'game' }), historical('Repeat', 'R2', 'Monthly', { kind: 'game' })],
    libraryEntitlements: entitlements(obs), keyReminders: [reminder('K1', 'Celeste'), reminder('R1', 'Repeat')], keyReminderScan: { complete: true, checkedAt: '2026-01-01T00:00:00.000Z' }, openDirectPurchaseLinks: true });
  const cards = ui.get('#key-reminder-list').children.filter(c => c.className === 'key-reminder-card');
  const button = card => card.children.find(c => c.type === 'button'), info = card => card.children.find(c => c.className === 'key-reminder-destination').textContent;
  const [celeste, repeat] = ['Celeste', 'Repeat'].map(t => cards.find(c => c.children[0].children[0].textContent === t));
  assert.equal(button(celeste).textContent, 'Open in Humble Library');assert.match(info(celeste), /Likely the same order as “Indie Bundle”.*opens this item/u);
  assert.equal(button(repeat).textContent, 'Open Humble Library');assert.match(info(repeat), /more than once/u);
  const before = ui.writes.length;
  await button(celeste).listeners.click();await button(repeat).listeners.click();
  assert.deepEqual(ui.opened, ['https://www.humblebundle.com/home/library/content/' + obs[0].nativeId, 'https://www.humblebundle.com/home/library'], 'the old order-key link setting no longer applies');
  assert.equal(ui.writes.length, before, 'opening a reminder writes nothing');assert.equal(ui.stored.hclPurchaseFocus, undefined);
});

test('Sync from Humble reports progress, unfinished syncs and unverified items in plain language', async () => {
  const { E } = load();
  const obs = [nativeObservation(E, { id: 1, parent: 10, title: 'Celeste', parentTitle: 'Indie Bundle' })];
  const cp = { version: 1, id: '44444444-4444-4444-8444-444444444444', mode: 'full', status: 'paused', reason: 'user', coverage: 'in-progress', startedAt: '2026-11-13T00:00:00.000Z', updatedAt: '2026-11-13T00:05:00.000Z', lastProgressAt: '2026-11-13T00:05:00.000Z',
    revision: 3, nextPage: 4, targetPages: 9, reportedPages: 9, reportedTotal: 8500, initialTotal: 8500, baselineTotal: null, pagesRead: 3, batches: 1, added: 1, refreshed: 0, unresolved: 2, conflicts: 0, duplicates: 0, pageSize: 1000, uncertainty: ['items-unresolved'], lastSignature: null, lastFull: null };
  const paused = await harness({ libraryEntitlements: entitlements(obs, ACCOUNT, cp) });
  assert.match(paused.get('#library-sync-status').textContent, /^1 Humble Library item saved for this account\. A full sync is unfinished \(3 of 9 pages read\)\. Open Humble Library and select Resume\. 1 item was saved before download details were read, so its media may be unknown\. Run the full sync again on the Humble Library page to identify it for bundle-page checks and Galactic Library\. 2 items could not be verified and were not saved\.$/u);
  const fresh = await harness({ humbleAccountId: null, humbleProfileLabel: '' });
  assert.equal(fresh.get('#library-sync-status').textContent, 'Not synced from your Humble Library yet.');
  assert.equal(fresh.get('#last-import').textContent, '', 'no stale importer message on a fresh install');
  await fresh.get('#open-purchases').listeners.click();assert.deepEqual(fresh.opened, ['https://www.humblebundle.com/home/library']);
});

test('Titles lists synced Humble Library titles, even with no historical library, without duplicating historical titles', async () => {
  const { E } = load();
  const obs = [nativeObservation(E, { id: 1, parent: 10, title: 'Saga #1', parentTitle: 'Image Bundle' }), nativeObservation(E, { id: 2, parent: 10, title: 'Monstress #1', parentTitle: 'Image Bundle' }),
    nativeObservation(E, { id: 3, parent: 11, title: 'Monstress #1', parentTitle: 'Image Bundle' }), nativeObservation(E, { id: 4, parent: 12, title: 'Celeste', parentTitle: 'Indie', namespace: 'steam' }),
    nativeObservation(E, { id: 5, parent: 12, title: 'Gift Copy', parentTitle: 'Indie', gifted: true })];
  const fresh = await harness({ humbleProfileLabel: '', libraryEntitlements: entitlements(obs) });
  const names = ui => ui.rows().map(row => row.children[0].children[0].textContent);
  assert.deepEqual(names(fresh), ['Celeste — 1 purchase', 'Monstress #1 — 2 purchases', 'Saga #1 — 1 purchase'], 'gifts stay out; purchases stay counted');
  assert.match(fresh.note(), /Showing 3 of 3 items.* 3 are only in your synced Humble Library\./u);
  const celeste = fresh.rows()[0].children[0].children[1].children[0];
  assert.match(text(celeste), /Purchased on Humble · Media: Game · Steam activation: Unknown/u);
  await celeste.children.find(c => c.type === 'button').listeners.click();
  assert.deepEqual(fresh.opened, ['https://www.humblebundle.com/home/library/content/' + obs[3].nativeId]);
  await fresh.change('#library-search-scope', 'bundle');await fresh.input('#library-search', 'image');
  assert.deepEqual(names(fresh), ['Monstress #1 — 2 purchases', 'Saga #1 — 1 purchase'], 'bundle-name search covers Library purchases');
  const mixed = await harness({ libraryItems: [historical('Saga #1', 'K1', 'Image Bundle')], libraryEntitlements: entitlements(obs) });
  assert.deepEqual(names(mixed).filter(n => n.startsWith('Saga')), ['Saga #1 — 1 purchase'], 'a historical title is not listed again');
  assert.equal(mixed.writes.length, 0);
});

test('Titles: headings count real purchases, verified copies show Purchased, and each purchase has one row and its own link', async () => {
  const { E } = load();
  const content = id => 'https://www.humblebundle.com/home/library/content/' + id;
  // Saga Vol. 1: four imported orders, five distinct Humble Library entitlements (four in the same purchases, one more).
  const sagaBundles = ['Comics Alpha', 'Comics Beta', 'Comics Gamma', 'Comics Delta', 'Comics Epsilon'];
  const obs = [...sagaBundles.map((name, i) => nativeObservation(E, { id: 30 + i, parent: 30 + i, title: 'Saga Vol. 1', parentTitle: name })),
    nativeObservation(E, { id: 1, parent: 10, title: 'Saga #1', parentTitle: 'Image Bundle' }), nativeObservation(E, { id: 2, parent: 10, title: 'Monstress #1', parentTitle: 'Image Bundle' }),
    nativeObservation(E, { id: 3, parent: 11, title: 'Monstress #1', parentTitle: 'Image Bundle Two' }), nativeObservation(E, { id: 4, parent: 12, title: 'Gift Copy', parentTitle: 'Indie', gifted: true }),
    nativeObservation(E, { id: 5, parent: 12, title: 'Revoked Copy', parentTitle: 'Indie', revoked: true }), nativeObservation(E, { id: 6, parent: 13, title: 'Paper Girls Vol 1', parentTitle: 'Image Collected' }),
    { ...nativeObservation(E, { id: 7, parent: 14, title: 'Broken Id', parentTitle: 'Odd' }), nativeId: 'not-a-uuid' },
    nativeObservation(E, { id: 8, parent: 15, title: 'Twin Comic', parentTitle: 'Twin Bundle' }), nativeObservation(E, { id: 9, parent: 16, title: 'Twin Comic', parentTitle: 'Twin Bundle' }),
    nativeObservation(E, { id: 10, parent: 17, title: 'Duo', parentTitle: 'Duo Bundle' }), nativeObservation(E, { id: 11, parent: 18, title: 'Duo', parentTitle: 'Duo Bundle' }),
    nativeObservation(E, { id: 20, parent: 19, title: 'Bonus', parentTitle: 'Bonus Bundle', namespace: 'steam' }), nativeObservation(E, { id: 21, parent: 19, title: 'Bonus', parentTitle: 'Bonus Bundle' })];
  const libraryItems = [
    historical('Saga Vol. 1', 'S1', 'Comics Alpha', { provenance: sagaBundles.slice(0, 4).map((name, i) => ({ purchaseKey: 'S' + (i + 1), sourceBundle: name, purchasedAt: `202${i}-01-01T00:00:00.000Z` })) }),
    historical('Saga #1', 'K1', 'Image Bundle', { provenance: [{ purchaseKey: 'K1', sourceBundle: 'Image Bundle' }, { purchaseKey: 'K9', sourceBundle: 'Other bundle' }] }), historical('Monstress #1', 'K1', 'Image Bundle'),
    historical('Gift Copy', 'K4', 'Indie'), historical('Revoked Copy', 'K4', 'Indie'), historical('Paper Girls, Vol. 1', 'K3', 'Image Collected'), historical('Old Comic', 'K5', 'Old bundle'), historical('Broken Id', 'K6', 'Odd'),
    historical('Twin Comic', 'K7', 'Twin Bundle', { provenance: [{ purchaseKey: 'K7', sourceBundle: 'Twin Bundle' }, { purchaseKey: 'K8', sourceBundle: 'Twin Bundle' }] }), historical('Duo', 'K10', 'Duo Bundle')];
  const ui = await harness({ libraryEntitlements: entitlements(obs), libraryItems });
  await ui.change('#library-page-size', '100');
  const row = title => ui.rows().find(r => r.children[0].children[0].textContent.startsWith(title + ' —'));
  const heading = title => row(title).children[0].children[0].textContent;
  const list = r => r.children[0].children.find(c => c.className?.startsWith('library-provenance-list'));
  const purchases = r => list(r).children.map(li => ({ primary: li.children[0].textContent, secondary: li.children[1]?.textContent ?? '', button: li.children.find(c => c.type === 'button') }));
  const note = r => r.children[0].children.find(c => c.className?.includes('library-title-note'));
  // Compact layout: collapsed rows are one line, with no controls outside the details.
  assert(ui.rows().every(r => r.children.length === 1), 'no Open on Humble controls under collapsed titles');
  // Four imported orders and five distinct Library entitlements: five purchases, five rows, five different pages.
  assert.equal(heading('Saga Vol. 1'), 'Saga Vol. 1 — 5 purchases');
  const saga = purchases(row('Saga Vol. 1'));
  assert.equal(saga.length, 5);assert(saga.every(p => p.button));
  for (const p of saga) await p.button.listeners.click();
  assert.deepEqual([...ui.opened].sort(), obs.slice(0, 5).map(o => content(o.nativeId)).sort(), 'each purchase opens its own Library item');
  // Verified copies show Purchased; how an imported order was paired with them is not an ownership qualifier.
  assert(saga.every(p => /Purchased/u.test(p.secondary) && !/Likely|match/u.test(p.secondary)), 'Purchased, without reconciliation wording');
  assert.equal(note(row('Saga Vol. 1')), undefined);
  // An imported order with no Library copy and a combined order: two purchases, not three.
  assert.equal(heading('Saga #1'), 'Saga #1 — 2 purchases');
  assert.deepEqual(purchases(row('Saga #1')).map(p => [p.primary, Boolean(p.button)]), [['Bundle: Image Bundle', true], ['Bundle: Other bundle', false]]);
  // A second genuine copy: two purchases, each with its own link.
  assert.equal(heading('Monstress #1'), 'Monstress #1 — 2 purchases');
  assert.deepEqual(purchases(row('Monstress #1')).map(p => [p.primary, Boolean(p.button)]), [['Bundle: Image Bundle', true], ['Bundle: Image Bundle Two', true]]);
  // Two identical repeat purchases: the count is certain (two), even though which imported order matches which copy is not.
  assert.equal(heading('Twin Comic'), 'Twin Comic — 2 purchases');
  assert.deepEqual(purchases(row('Twin Comic')).map(p => Boolean(p.button)), [false, false, true, true]);
  assert.equal(note(row('Twin Comic')).textContent, 'Some imported orders listed here are the same purchases as Humble Library items.', 'four rows for two purchases are explained');
  for (const title of ['Saga #1', 'Monstress #1', 'Old Comic']) assert.equal(note(row(title)), undefined, title);
  // An ambiguous match: no unsupported exact number, and one plain note explains why.
  assert.equal(heading('Duo'), 'Duo — at least 2 purchases');
  assert.equal(note(row('Duo')).textContent, 'Some imported orders may be the same purchases as Humble Library items listed here.');
  // Two entitlements from one Humble purchase: one purchase, two items to open.
  assert.equal(heading('Bonus'), 'Bonus — 1 purchase');
  const bonus = purchases(row('Bonus'));assert.equal(bonus.length, 2);assert(bonus.every(p => p.button && /^Purchased on Humble/u.test(p.secondary)));
  assert.match(bonus.find(p => /Steam/u.test(p.secondary)).secondary, /Steam activation: Unknown/u, 'Purchased never implies Steam activation');
  // A likely match spelled differently shares the imported row and is not listed again.
  assert.equal(heading('Paper Girls, Vol. 1'), 'Paper Girls, Vol. 1 — 1 purchase');assert(!row('Paper Girls Vol 1'));
  // No link without a verified, non-excluded entitlement; imported-only purchases keep their rows and count.
  for (const title of ['Gift Copy', 'Revoked Copy', 'Old Comic', 'Broken Id']) { assert.equal(heading(title), title + ' — 1 purchase'); const p = purchases(row(title)); assert.equal(p.length, 1, title); assert.equal(p[0].button, undefined, title); assert.equal(list(row(title)).className, 'library-provenance-list', title); }
  assert.equal(ui.writes.length, 0, 'counts and links are computed for display and never stored');
  // With diagnostics on, the reconciliation detail is available in the same rows.
  const diagnostic = await harness({ libraryEntitlements: entitlements(obs), libraryItems, showDiagnostics: true });
  await diagnostic.change('#library-page-size', '100');
  const drow = title => diagnostic.rows().find(r => r.children[0].children[0].textContent.startsWith(title + ' —'));
  const dpurchases = r => r.children[0].children.find(c => c.className?.startsWith('library-provenance-list')).children.map(li => li.children[1]?.textContent ?? '');
  assert(dpurchases(drow('Saga Vol. 1')).filter(text => /Likely the same purchase as “Comics (Alpha|Beta|Gamma|Delta)” in your Humble Library/u.test(text)).length === 4);
  assert(dpurchases(drow('Twin Comic')).slice(2).every(text => /One of 2 identical purchases/u.test(text)));
  assert(dpurchases(drow('Duo')).slice(1).every(text => /Not combined: ambiguous match/u.test(text)));
  assert.equal(drow('Saga Vol. 1').children[0].children[0].textContent, 'Saga Vol. 1 — 5 purchases', 'diagnostics never change the count');
});

test('Options follows storage changes made elsewhere: progress updates the summary only, new records rebuild once', async () => {
  const { E } = load();
  const first = [nativeObservation(E, { id: 1, parent: 10, title: 'Saga #1', parentTitle: 'Image Bundle' })];
  const checkpoint = n => ({ version: 1, id: '44444444-4444-4444-8444-444444444444', mode: 'full', status: 'running', reason: null, coverage: 'in-progress', startedAt: '2026-11-13T00:00:00.000Z', updatedAt: '2026-11-13T00:05:00.000Z', lastProgressAt: '2026-11-13T00:05:00.000Z',
    revision: n, nextPage: n, targetPages: 9, reportedPages: 9, reportedTotal: 8500, initialTotal: 8500, baselineTotal: null, pagesRead: n - 1, batches: 1, added: 1, refreshed: 0, unresolved: 0, conflicts: 0, duplicates: 0, pageSize: 1000, uncertainty: [], lastSignature: null, lastFull: null });
  const ui = await harness({ libraryItems: [historical('Saga #1', 'K1', 'Image Bundle')], libraryEntitlements: entitlements([], ACCOUNT) });
  const stats = () => ui.context.LibraryBrowser.getRefreshStats?.() ?? {};
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  // The verified link in Saga #1's purchase list, if any.
  const sagaButton = () => ui.rows().find(r => r.children[0].children[0].textContent.startsWith('Saga #1 —'))?.children[0].children
    .find(c => c.className?.startsWith('library-provenance-list'))?.children.flatMap(li => li.children.filter(c => c.type === 'button'))[0];
  await ui.input('#library-search', 'saga');
  // Sync progress only (checkpoints): the summary follows and the browser is not rebuilt.
  for (let n = 2; n < 6; n++) ui.external({ libraryEntitlements: entitlements([], ACCOUNT, checkpoint(n)) });
  await wait(400);
  assert.match(ui.get('#library-sync-status').textContent, /A full sync is unfinished \(4 of 9 pages read\)/u);
  assert.equal(sagaButton(), undefined);
  // A batch saves native records: the open page updates without a reload and keeps the search.
  ui.external({ libraryEntitlements: entitlements(first, ACCOUNT, checkpoint(6)) });
  ui.external({ libraryEntitlements: entitlements(first, ACCOUNT, checkpoint(7)) });
  await wait(400);
  assert.equal(sagaButton()?.textContent, 'Open on Humble', 'the open page shows the synced record and its link without a reload');
  assert.equal(ui.get('#library-search').value, 'saga');
  // The second write repeats the same records with a newer checkpoint, so it is progress too.
  assert.deepEqual([stats().progressOnly, stats().liveRenders, stats().modelBuilds], [5, 1, 2], 'progress never rebuilt the model; the new records rendered once');
  // Switching the active account rebuilds for that account; the previous account's records do not appear.
  ui.external({ humbleAccountId: '22222222-2222-4222-8222-222222222222' });
  await wait(1400);
  assert.equal(stats().modelBuilds, 3);assert.equal(ui.context.LibraryBrowser.getGroups().native.present, false);
  assert.equal(sagaButton(), undefined);
  assert.equal(ui.writes.length, 0);
});


test('native-only 600-title library has matching summary, Titles and catalog counts without storage changes',async()=>{
  const {E}=load();const observations=Array.from({length:600},(_,i)=>nativeObservation(E,{id:i+10000,parent:9000+Math.floor(i/10),title:'Saved title '+i}));
  const ui=await harness({libraryItems:[],purchaseSummaries:[],libraryEntitlements:entitlements(observations)});const before=JSON.stringify(ui.stored);
  assert.match(ui.note(),/of 600 items/);assert.match(ui.get('#library-count').textContent,/600 unique items/);assert.match(ui.get('#library-count').textContent,/600 unclassified/);
  const catalog=await ui.exportCatalog();assert.equal(catalog.items.length,600);assert(catalog.items.every(i=>i.mediaType==='unclassified'));assert.equal(new Set(catalog.items.map(i=>i.title)).size,600);
  const csv=await ui.exportCsv();assert.equal(csv.split('\r\n').length,602);assert.match(csv,/"Saved title 0","unclassified","Purchased","","","1","Exact","Humble Library","","unknown"/);assert.match(csv,/Saved title 599/);
  await ui.view('groups');assert.match(ui.note(),/60 purchase groups/);assert.equal(JSON.stringify(ui.stored),before);assert.equal(ui.writes.length,0);
});

test('CSV retains source distinctions and escapes quotes, commas, newlines, Unicode and spreadsheet formulas',async()=>{
  const ui=await harness({libraryItems:[historical('Title, "雪"\nSecond line','order-1','Bundle, one',{kind:'book'}),historical('=formula','order-2','Other bundle',{kind:'game'}),{title:'Manual title',kind:'book',source:'manual'}]});
  const before=JSON.stringify(ui.stored),csv=await ui.exportCsv();
  assert.match(csv,/"Title, ""雪""\nSecond line"/);assert.match(csv,/"'=formula"/);assert.match(csv,/","Purchased","2024-03-01","2024-03-01","1","Exact","Imported purchase","Bundle, one","2024-03-01"/);
  assert.match(csv,/"Manual title","book","Not recorded as a purchase","","","0","","Added manually","",""/);
  assert.equal(JSON.stringify(ui.stored),before);assert.equal(ui.writes.length,0);
  const empty=await harness();assert.equal((await empty.exportCsv()).split('\r\n').length,2);
});

// Humble's "No Content" items, as found in a real library: imported direct downloads with no formats, and one
// DRM-free Library entitlement with no download details in each of many unrelated purchases.
test('"No Content" placeholders are not titles; their purchases, other titles and real products of that name stay', async () => {
  const { E } = load(), drm = (id, parent, title, parentTitle, delivery = null) => E.observation({ ...nativeObservation(E, { id, parent, title, parentTitle }), ...(delivery ? { delivery } : {}) });
  const pdf = { platforms: ['ebook'], formats: ['pdf'] };
  const placeholder = (key, bundle, kind) => ({ title: 'No Content', kind, automaticKind: kind, source: 'humble', purchaseKey: key, sourceBundle: bundle, purchasedAt: '2016-06-22T12:00:00.000Z', entitlement: 'direct-download', delivery: 'direct-download', formats: [], providerItemId: key + ':product:synthetic',
    provenance: [{ title: 'No Content', purchaseKey: key, sourceBundle: bundle, purchasedAt: '2016-06-22T12:00:00.000Z', entitlement: 'direct-download', delivery: 'direct-download', formats: [], providerItemId: key + ':product:synthetic' }] });
  const ui = await harness({ libraryItems: [placeholder('K1', 'Synthetic Anniversary Bundle', 'unclassified'), placeholder('K2', 'Synthetic Comics Bundle', 'comic'), historical('Real Comic', 'K2', 'Synthetic Comics Bundle', { purchasedAt: '2016-06-22T12:00:00.000Z' })],
    libraryEntitlements: entitlements([1, 2, 3].flatMap(n => [drm(n, n, 'No Content', 'Library Bundle ' + n), drm(n + 10, n, 'Product ' + n, 'Library Bundle ' + n, pdf)]).concat([drm(30, 4, 'Promotional Message', 'Library Bundle 4')])) });
  const before = JSON.stringify(ui.stored), titleText = (r) => (r.textContent || r.children[0].children[0].textContent).split(' — ')[0];
  await ui.change('#library-page-size', '200');
  assert.deepEqual(ui.rows().map(titleText).sort(), ['Product 1', 'Product 2', 'Product 3', 'Promotional Message', 'Real Comic'], 'Titles lists real titles only; another title without downloads is kept');
  const csv = await ui.exportCsv(), catalog = await ui.exportCatalog();
  assert.doesNotMatch(csv, /No Content/u);assert(!catalog.items.some(i => i.title === 'No Content'));assert.equal(csv.trim().split('\r\n').length - 1, catalog.items.length);
  assert.match(csv, /"Real Comic","comic","Purchased","2016-06-22","2016-06-22","1","Exact","Imported purchase","Synthetic Comics Bundle","2016-06-22"/);
  await ui.view('groups');await ui.input('#library-search', 'no content');
  assert.equal(ui.rows().length, 5, 'the purchases holding them stay listed and searchable in Bundles & Orders');
  assert.equal(JSON.stringify(ui.stored), before, 'nothing saved is changed');assert.equal(ui.writes.length, 0);
  // A real product named "No Content" (a key, or a download with files) is a title.
  const real = await harness({ libraryItems: [], libraryEntitlements: entitlements([E.observation(nativeObservation(E, { id: 40, parent: 40, title: 'No Content', parentTitle: 'Game Bundle', namespace: 'steam' })), drm(41, 41, 'No Content', 'Book Bundle', pdf)]) });
  assert.match(await real.exportCsv(), /"No Content","[^"]*","Purchased","","","2","Exact","Humble Library","Game Bundle; Book Bundle","unknown; unknown"/);
});

test('CSV: Purchased for every recorded purchase, purchase dates and counts as Titles shows them, and no activation column', async () => {
  const { E } = load(), copy = (id, parent, title, parentTitle, namespace = 'download_drm_free') => nativeObservation(E, { id, parent, title, parentTitle, namespace });
  const ui = await harness({
    libraryItems: [
      historical('Imported Only', 'K1', 'Book Bundle One', { kind: 'book', purchasedAt: '2021-06-01T12:00:00.000Z' }),
      historical('Shared One', 'K2', 'Game Bundle', { kind: 'game', purchasedAt: '2022-02-02T12:00:00.000Z' }), historical('Shared Two', 'K2', 'Game Bundle', { kind: 'game', purchasedAt: '2022-02-02T12:00:00.000Z' }),
      historical('Twice Bought', 'K3', 'First Order', { kind: 'book', purchasedAt: '2019-03-03T12:00:00.000Z' }), historical('Twice Bought', 'K4', 'Second Order', { kind: 'book', purchasedAt: '2023-04-04T12:00:00.000Z' }),
      historical('Loose Title', 'K5', 'Old Order', { kind: 'book', purchasedAt: '2018-05-05T12:00:00.000Z' }),
      historical('=SUM(1)', 'K6', 'Formula Bundle', { kind: 'book', purchasedAt: '2020-01-01T12:00:00.000Z' }),
      historical('Same Day', 'K7', 'Morning Order', { kind: 'book', purchasedAt: '2025-07-07T09:00:00.000Z' }), historical('Same Day', 'K8', 'Evening Order', { kind: 'book', purchasedAt: '2025-07-07T19:00:00.000Z' })],
    purchaseSummaries: [{ purchaseKey: 'K2', sourceBundle: 'Game Bundle', purchasedAt: '2022-02-02T12:00:00.000Z' }],
    // The imported Game Bundle order and its Humble Library purchase (one purchase, Steam keys); a Library-only
    // comic purchase with no date; and an unrelated Library purchase that also lists "Loose Title".
    libraryEntitlements: entitlements([copy(1, 10, 'Shared One', 'Game Bundle', 'steam'), copy(2, 10, 'Shared Two', 'Game Bundle', 'steam'),
      copy(3, 20, 'Library Comic', 'Library Comic Bundle'), copy(4, 30, 'Loose Title', 'Unrelated Purchase'), copy(5, 30, 'Other A', 'Unrelated Purchase'), copy(6, 30, 'Other B', 'Unrelated Purchase')]) });
  const csv = await ui.exportCsv(), lines = csv.replace(/^﻿/u, '').trim().split('\r\n'), row = title => lines.find(line => line.startsWith(`"${title}",`) || line.startsWith(`"'${title}",`));
  assert.equal(lines[0], '"Title","Media type","Purchase status","First purchased","Last purchased","Purchase count","Purchase count confidence","Source","Bundle / purchase name","Purchase dates"');
  assert.doesNotMatch(csv, /activation/iu, 'no activation wording on any row');
  assert.equal(row('Imported Only'), '"Imported Only","book","Purchased","2021-06-01","2021-06-01","1","Exact","Imported purchase","Book Bundle One","2021-06-01"');
  assert.equal(row('Shared One'), '"Shared One","game","Purchased","2022-02-02","2022-02-02","1","Exact","Imported purchase and Humble Library","Game Bundle","2022-02-02"', 'an imported order and its Library purchase count once');
  assert.equal(row('Twice Bought'), '"Twice Bought","book","Purchased","2019-03-03","2023-04-04","2","Exact","Imported purchase","First Order; Second Order","2019-03-03; 2023-04-04"');
  assert.equal(row('Same Day'), '"Same Day","book","Purchased","2025-07-07","2025-07-07","2","Exact","Imported purchase","Morning Order; Evening Order","2025-07-07; 2025-07-07"', 'two purchases on one day stay two');
  assert.equal(row('Library Comic'), '"Library Comic","comic","Purchased","","","1","Exact","Humble Library","Library Comic Bundle","unknown"', 'a Library-only purchase with no known date');
  assert.equal(row('Loose Title'), '"Loose Title","book","Purchased","2018-05-05","2018-05-05","1","At least","Imported purchase and Humble Library","Old Order; Unrelated Purchase","2018-05-05; unknown"', 'possibly the same purchase: a numeric lower bound; the undated purchase is listed as unknown');
  assert.equal(row('=SUM(1)'), `"'=SUM(1)","book","Purchased","2020-01-01","2020-01-01","1","Exact","Imported purchase","Formula Bundle","2020-01-01"`);
  // CSV rows and the JSON catalog list the same titles in the same order; JSON keeps its identity-only shape.
  const catalog = await ui.exportCatalog();
  assert.equal(lines.length - 1, catalog.items.length);
  assert.deepEqual(catalog.items.map(i => i.title), lines.slice(1).map(line => line.match(/^"'?((?:[^"]|"")*)"/u)[1].replaceAll('""', '"')));
  assert(catalog.items.every(i => Object.keys(i).every(k => ['title', 'mediaType', 'authors', 'isbn', 'asin', 'series', 'volume', 'issue', 'language'].includes(k))), 'JSON fields unchanged');
  assert.equal(ui.writes.length, 0);
});

test('historical upgrade and restored backup retain titles without native observations or derived checkpoints',async()=>{
  const records=Array.from({length:600},(_,i)=>historical('Historical '+i,'order-'+Math.floor(i/10),'Bundle '+Math.floor(i/10),{kind:i%2?'unclassified':'comic'}));
  const raw={libraryItems:[...records,{...records[0],purchaseKey:'another-order'}],purchaseSummaries:[{purchaseKey:'order-0',itemCount:10}],mediaImportVersion:1,mediaTypeOverrides:{manual:'book'}};
  const ui=await harness(raw,{enabled:false});const before=JSON.stringify(ui.stored);assert.match(ui.note(),/of 600 items/);assert.match(ui.get('#library-count').textContent,/600 unique items/);assert.equal((await ui.exportCatalog()).items.length,600);assert.equal(JSON.stringify(ui.stored),before);
  const restored=ui.context.HumbleComicLibrary.restoreBackupState(ui.context.HumbleComicLibrary.createLibraryBackup(ui.stored));const other=await harness(JSON.parse(JSON.stringify(restored)));assert.equal((await other.exportCatalog()).items.length,600);assert.match(other.get('#library-count').textContent,/600 unique items/);
});

test('order summaries alone do not fabricate titles and foreign native scopes remain excluded',async()=>{
  const {E}=load();const native=entitlements([nativeObservation(E,{id:88,parent:99,title:'Foreign title'})]);native.scopes[0].localAccountId='22222222-2222-4222-8222-222222222222';
  const ui=await harness({libraryItems:[],purchaseSummaries:Array.from({length:600},(_,i)=>({purchaseKey:'old-'+i,sourceBundle:'Order '+i,itemCount:10})),libraryEntitlements:native});assert.equal((await ui.exportCatalog()).items.length,0);assert.match(ui.get('#library-count').textContent,/0 unique items/);await ui.view('groups');assert.match(ui.note(),/600 purchase groups/);
});

test('Recently added sorts Library purchases first seen by sync, labelled apart from purchase dates', async () => {
  const { E } = load(), at = (spec, firstObservedAt) => E.observation({ ...nativeObservation(E, spec), ...(firstObservedAt ? { firstObservedAt } : {}) });
  const ui = await harness({ libraryItems: [historical('Repeat Comic', 'K1', 'Old Order'), historical('Dated Comic', 'K2', 'Newer Order', { purchasedAt: '2025-05-01T00:00:00.000Z' })],
    libraryEntitlements: entitlements([at({ id: 1, parent: 10, title: 'Repeat Comic', parentTitle: 'Fresh Bundle' }, '2026-11-10T00:00:00.000Z'), at({ id: 2, parent: 10, title: 'Fresh Comic', parentTitle: 'Fresh Bundle' }, '2026-11-10T00:00:00.000Z'),
      at({ id: 3, parent: 20, title: 'Untracked Comic', parentTitle: 'Untracked Bundle' })]) });
  const titleText = (r) => r.textContent || r.children[0].children[0].textContent;
  await ui.change('#library-sort', 'added-desc');
  assert.deepEqual(ui.rows().map(titleText), ['Fresh Comic — 1 purchase', 'Repeat Comic — at least 1 purchase', 'Dated Comic — 1 purchase', 'Untracked Comic — 1 purchase']);
  assert.match(ui.note(), /recently added first/);
  assert.match(text(ui.expand(ui.rows()[0])), /Purchased on Humble · Media: .* · First synced 2026-11-10/);
  await ui.view('groups');
  await ui.change('#library-group-sort', 'added-desc');
  assert.deepEqual(summaries(ui), ['Fresh Bundle — Bundle · 2 titles · Purchase date not recorded · First synced 2026-11-10 · Native Library',
    'Newer Order — Order · 1 title · Purchased 2025-05-01 · Historical import', 'Old Order — Order · 1 title · Purchased 2024-03-01 · Historical import', 'Untracked Bundle — Bundle · 1 title · Purchase date not recorded · Native Library']);
  assert.match(text(ui.expand(ui.rows()[0])), /First found by Library sync on 2026-11-10\. Humble's Library lists no purchase date, so this is when the extension first saw it, not when it was bought\./);
  assert.match(text(ui.expand(ui.rows()[3])), /saved before first-found dates were recorded/);
  assert.equal(ui.writes.length, 0, 'sorting never writes storage');
});

test('Titles: dates reach Library-only titles of combined purchases; date coverage, undated filter and both date sorts', async () => {
  const { E } = load(), book = (id, parent, title, parentTitle) => nativeObservation(E, { id, parent, title, parentTitle });
  const ui = await harness({ libraryItems: [historical('Shared One', 'K1', 'Combined Bundle', { purchasedAt: '2021-06-01T12:00:00.000Z' }), historical('Shared Two', 'K1', 'Combined Bundle', { purchasedAt: '2021-06-01T12:00:00.000Z' }),
      historical('Mixed Title', 'K2', 'Older Order', { purchasedAt: '2019-03-03T12:00:00.000Z' })],
    purchaseSummaries: [{ purchaseKey: 'K1', sourceBundle: 'Combined Bundle', purchasedAt: '2021-06-01T12:00:00.000Z' }, { purchaseKey: 'K2', sourceBundle: 'Older Order', purchasedAt: '2019-03-03T12:00:00.000Z' }],
    libraryEntitlements: entitlements([book(1, 10, 'Shared One', 'Combined Bundle'), book(2, 10, 'Shared Two', 'Combined Bundle'), book(3, 10, 'Library Extra', 'Combined Bundle'),
      book(4, 20, 'Undated Only', 'Loose Purchase'), book(5, 20, 'Mixed Title', 'Loose Purchase'), book(6, 20, 'Another Undated', 'Loose Purchase')]) });
  const titleText = (r) => (r.textContent || r.children[0].children[0].textContent).split(' — ')[0];
  // Library Extra was undated before: its purchase is combined with the dated order K1.
  assert.equal(ui.get('#library-date-coverage').textContent, 'Purchase dates known for 4 of 6 titles (66.6%). 2 titles have no known purchase date yet; some older purchases may get dates as Humble restores its order history. Choose “No known purchase date” under Metadata in Titles to list them.');
  await ui.change('#library-sort', 'date-desc');
  assert.deepEqual(ui.rows().map(titleText), ['Library Extra', 'Shared One', 'Shared Two', 'Mixed Title', 'Another Undated', 'Undated Only']);
  await ui.change('#library-sort', 'date-asc');
  assert.deepEqual(ui.rows().map(titleText), ['Another Undated', 'Undated Only', 'Mixed Title', 'Library Extra', 'Shared One', 'Shared Two']);
  await ui.change('#library-filter-metadata', 'undated');
  assert.deepEqual(ui.rows().map(titleText), ['Another Undated', 'Undated Only'], 'a title with one dated purchase is not undated');
  await ui.input('#library-search', 'another');
  assert.deepEqual(ui.rows().map(titleText), ['Another Undated'], 'the filter works with search');
  assert.equal(ui.writes.length, 0);
});
