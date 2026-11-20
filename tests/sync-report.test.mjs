import assert from 'node:assert/strict';
import test from 'node:test';
import {load} from './library-browser-fixture.mjs';

// The exportable Library sync report carries counts, statuses and times only (WP-14).
test('the sync report is an allowlist of counts and statuses without titles, IDs or account details', () => {
  const {E} = load();
  const checkpoint = E.checkpoint({version: 1, id: '44444444-4444-4444-8444-444444444444', mode: 'full', status: 'paused', reason: 'user', coverage: 'in-progress',
    startedAt: '2026-11-13T00:00:00.000Z', updatedAt: '2026-11-13T00:05:00.000Z', lastProgressAt: '2026-11-13T00:05:00.000Z', revision: 3, nextPage: 4, targetPages: 9,
    reportedPages: 9, reportedTotal: 8500, initialTotal: 8500, baselineTotal: null, pagesRead: 3, batches: 1, added: 1, refreshed: 0, unresolved: 2, conflicts: 0,
    duplicates: 0, pageSize: 1000, uncertainty: ['items-unresolved'], lastSignature: [['SECRET-NATIVE-ID', 'steam']], lastFull: null});
  const report = JSON.parse(JSON.stringify(E.syncReport({checkpoint, extensionVersion: '1.1.3', browserFamily: 'firefox', now: new Date('2026-11-19T00:00:00.000Z'),
    stored: {saved: 120, found: 30, excluded: 2, undetailed: 0, media: {game: 20, book: 10, 'Secret Title': 4}, orders: {dated: 7, resumable: true}, profileLabel: 'Private nickname', bound: true},
    view: {requests: 12, retry: {attempt: 1, of: 3}, retryAfter: 90000, orderDates: {detail: 'Order 123 for private@example.test failed'}}})));
  assert.equal(report.format, 'humble-library-sync-report');
  assert.equal(report.browserFamily, 'firefox');
  assert.deepEqual(report.sync.uncertainty, ['items-unresolved']);
  assert.equal(report.sync.unresolved, 2);
  assert.deepEqual(report.library, {savedItems: 120, observedThisSync: 30, excludedItems: 2, mediaNotIdentified: 0, media: {game: 20, book: 10}});
  assert.deepEqual(report.purchaseDates, {libraryPurchasesDated: 7, refreshUnfinished: true});
  assert.deepEqual(report.session, {requests: 12, retrying: true, waitRequestedMinutes: 2, purchaseDateCheckStopped: true});
  const text = JSON.stringify(report);
  for (const secret of ['44444444', 'SECRET', 'Private nickname', 'private@example', 'Order 123', 'Secret Title']) assert(!text.includes(secret), secret);
  assert.equal(JSON.parse(JSON.stringify(E.syncReport({}))).sync, null, 'no sync yet gives an empty report');
});
