import { wireStore } from './store-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { load, nativeObservation, entitlements, ACCOUNT } from './library-browser-fixture.mjs';

// Options page with the native module enabled and the presentation model loaded.
async function harness(initial = {}, { enabled = true } = {}) {
  const stored = { humbleProfileLabel: 'Main', humbleAccountId: ACCOUNT, profileArchives: [], ...structuredClone(initial) };
  const elements = new Map(), writes = [], sessionData = new Map(), opened = [], changeListeners = [];
  const element = () => ({ listeners: {}, files: [], value: '', children: [], dataset: {}, disabled: false,
    addEventListener(type, handler) { this.listeners[type] = handler; }, append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }, setAttribute(name, value) { this[name] = value; }, click() {} });
  const context = { Blob, console, Date, encodeURIComponent, setTimeout, clearTimeout, Intl, confirm: () => true,
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
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
  assert.deepEqual(summaries(ui).sort(), ['Indie Bundle — Bundle · 2 titles · Date not recorded · Native Library · 1 matching title', 'Indie Bundle — Order · 1 title · Purchased 2024-03-01 · Historical import · 1 matching title']);
  assert.match(text(ui.expand(ui.rows()[0])), /Shown combined with its likely match in the Grouped view/);
  assert.equal(ui.get('#library-search').value, 'celeste', 'switching modes keeps the search');
  await ui.change('#library-group-mode', 'grouped');
  assert.equal(ui.rows().length, 1);
  await ui.input('#library-search', '');
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
