import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The title-catalog CSV builder on its own: dates on the local calendar day, numeric counts, an empty catalog.
const zoned = (zone, run) => { const previous = process.env.TZ;process.env.TZ = zone;try { return run(); } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; } };
const rows = csv => csv.replace(/^﻿/u, '').trim().split('\r\n');

test('dates are calendar days in the browser\'s time zone, first and last of the known purchases', () => {
  const H = loadShared();
  const csv = zoned('America/New_York', () => H.createTitleCatalogCsv([{title: 'Late Night', kind: 'book'}], () => ({count: 2, exact: true, imported: false, library: true,
    purchases: [{name: 'Second', date: '2026-11-17T03:45:00.000Z'}, {name: 'First', date: Date.parse('2026-01-05T15:00:00.000Z')}]})));
  assert.equal(rows(csv)[1], '"Late Night","book","Purchased","2026-01-05","2026-11-16","2","Exact","Humble Library","First; Second","2026-01-05; 2026-11-16"');
});

test('counts are numbers; a lower bound says so in its own column; an empty catalog keeps its header', () => {
  const H = loadShared();
  const csv = H.createTitleCatalogCsv([{title: 'Maybe Twice', kind: 'book'}], () => ({count: 1, exact: false, imported: true, library: true, purchases: [{name: 'A', date: null}, {name: 'B', date: null}]}));
  assert.equal(rows(csv)[1], '"Maybe Twice","book","Purchased","","","1","At least","Imported purchase and Humble Library","A; B","unknown; unknown"');
  assert.deepEqual(rows(H.createTitleCatalogCsv([])), ['"Title","Media type","Purchase status","First purchased","Last purchased","Purchase count","Purchase count confidence","Source","Bundle / purchase name","Purchase dates"']);
  // Without a description, imported records are counted by order key (else bundle name).
  const plain = H.createTitleCatalogCsv([{title: 'Plain', kind: 'book', provenance: [{purchaseKey: 'K1', sourceBundle: 'One', purchasedAt: '2020-02-02T12:00:00.000Z'}, {purchaseKey: 'K1', sourceBundle: 'One'}, {sourceBundle: 'Legacy'}]}]);
  assert.equal(rows(plain)[1], '"Plain","book","Purchased","2020-02-02","2020-02-02","2","Exact","Imported purchase","One; Legacy","2020-02-02; unknown"');
});

function loadShared() {
  const context = vm.createContext({console, URL, Date, Intl});
  context.globalThis = context;
  for (const file of ['library-entitlements.js', 'shared.js']) vm.runInContext(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context, {filename: file});
  return context.HumbleComicLibrary;
}
