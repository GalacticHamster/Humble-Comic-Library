import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = { URL, Blob, setTimeout, clearTimeout, console, Promise,
  document: { title: '', querySelector: () => null }, location: { pathname: '/' }, performance: { now: () => 0 } };
context.globalThis = context;
vm.createContext(context);
for (const file of ['shared.js', 'collection-mappings.js', 'ownership.js', 'content.js']) vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
vm.runInContext('showComparisonProgress = () => {};', context);
const H = context.HumbleComicLibrary; const O = context.HumbleOwnership; const C = context.HumbleCollectionMappings;
const plain = value => JSON.parse(JSON.stringify(value));
const unit = (number, overrides = {}) => ({ series: '漫画', run: '2020', unitType: 'volume', number: String(number), language: 'ja', completeness: 'full', ...overrides });
const external = (number, overrides = {}) => ({ ...unit(number), evidence: [{ provider: 'kindle', ownership: 'owned', title: 'Other omnibus', relationship: 'contains', ...overrides }] });
const mapping = { id: 'one', collectionTitle: 'Owned omnibus', verified: true, contentsComplete: true, language: 'ja', contains: [{ series: '漫画', run: '2020', unitType: 'volume', from: 1, to: 2 }] };

test('Unicode normalization preserves distinct Japanese, Cyrillic, accented and composed titles', () => {
  assert.notEqual(H.titleKey('進撃の巨人'), H.titleKey('鋼の錬金術師'));
  assert.notEqual(H.titleKey('Книга'), '');
  assert.equal(H.titleKey('Cafe\u0301'), H.titleKey('Café'));
  assert.notEqual(H.titleKey('Café'), H.titleKey('Cafe'));
  assert.notEqual(H.titleKey('ば'), H.titleKey('は'));
});

test('bibliographic imports retain homonyms and conflicting identifiers instead of merging them', () => {
  const state = H.manualTitleImportState([{ title: 'Shared Title', authors: ['A'] }, { title: 'Shared Title', authors: ['B'] }]);
  assert.equal(state.libraryItems.length, 2);
  assert.equal(O.exactCandidate({ title: 'Shared Title' }, state.libraryItems).exact, undefined);
  assert.equal(O.exactCandidate({ title: 'Shared Title', authors: ['B'] }, state.libraryItems).exact.authors[0], 'B');
  const result = O.exactCandidate({ title: 'Shared Title', isbn: ['9780306406157'] }, [{ title: 'Shared Title', isbn: ['9780140328721'] }]);
  assert.equal(result.exact, undefined);
  assert.equal(result.possible.length, 1);
  assert.match(result.reason, /ISBN/u);
  assert.equal(O.exactCandidate({ title: 'Shared Title', authors: ['A'] }, [{ title: 'Shared Title', authors: ['B'] }]).possible.length, 0);
});

test('lossy title keys and fraction/range collisions cannot establish exact edition ownership', () => {
  assert.equal(O.exactCandidate({ title: 'The Room' }, [{ title: 'Room' }]).exact, undefined);
  assert.equal(O.exactCandidate({ title: 'Comic #1/2', authors: ['A'] }, [{ title: 'Comic #1-2', authors: ['A'] }]).exact, undefined);
});

test('game base, deluxe, gold and platinum are Possible in both directions; title words stay intact', () => {
  for (const [offered, owned] of [['Control', 'Control Deluxe'], ['Control Gold', 'Control'], ['Control Platinum Edition', 'Control Deluxe Edition'], ['Control Base Game', 'Control Gold']]) {
    context.inputs = { offered, owned };
    const result = vm.runInContext("findPossibleMatch(inputs.offered, createLibraryMatcher(new Map([['x',{title:inputs.owned}]]),'game'), 'game')", context);
    assert.equal(result.items.title, owned);
    assert.match(result.reason, /edition/iu);
    assert.equal(O.exactCandidate({ title: offered, kind: 'game' }, [{ title: owned }]).exact, undefined);
  }
  assert.equal(O.editionParts('Gold Rush', 'game').base, 'gold rush');
  assert.equal(O.editionParts('The Deluxe Adventure', 'game').edition, '');
});

test('local reviewed collections union with GL coverage, with duplicates counted once', () => {
  const local = O.localEvidence([{ title: 'Owned omnibus' }], [mapping]);
  const target = { entries: [unit(1), unit(2), unit(3), unit(3)], complete: true };
  const coverage = O.coverageFor(target, local, { coverage: { covered: [external(2), external(3)] } });
  assert.equal(coverage.total, 3);
  assert.equal(coverage.owned, 3);
  assert.equal(coverage.complete, true);
  assert.equal(coverage.covered[1].evidence.length, 2);
  assert.equal(O.coverageFor({ ...target, complete: false }, local, { coverage: { covered: [external(3)] } }).contentsComplete, false);
});

test('different runs/languages, excerpts, temporary access and excluded stale Humble evidence never prove coverage', () => {
  for (const candidate of [external(1, { ownership: 'subscription' }), external(1, { provider: 'humble' }), { ...external(1), run: '2021' }, { ...external(1), language: 'en' }, { ...external(1), completeness: 'excerpt' }]) {
    assert.equal(O.coverageFor({ entries: [unit(1)], complete: true }, [], { coverage: { covered: [candidate] } }).owned, 0);
  }
  const unknown = O.coverageFor({ entries: [unit(1, { run: '' })], complete: true }, [], { coverage: { possibleCovered: [external(1)] } });
  assert.equal(unknown.owned, 0);
  assert.equal(unknown.possibleCovered.length, 1);
  assert.equal(unknown.complete, false);
});

test('contents requests carry bounded catalog evidence and exclude Humble; source secrets remain local', () => {
  const request = O.request({ title: 'Owned omnibus', kind: 'book', authors: ['Writer'], isbn: ['9780306406157'], run: '2020', language: 'ja', purchaseKey: 'private', downloadUrl: 'private' }, [mapping]);
  assert.deepEqual(plain(request.excludeProviders), ['humble']);
  assert.equal(request.contentsComplete, true);
  assert.equal(request.contents.length, 2);
  assert.equal(request.identifiers.isbn[0], '9780306406157');
  assert.equal(JSON.stringify(request).includes('private'), false);
  assert.equal(O.request({ title: '漫画 Vols. 1-3', kind: 'book', run: '2020', language: 'ja' }).contentsComplete, false);
});

test('large libraries respect both GL request limits; incomplete results are not cached as no-match', async () => {
  context.calls = [];
  context.chrome = { runtime: { sendMessage: async (_id, request) => {
    context.calls.push(plain(request));
    return { ok: true, apiVersion: 1, results: request.items.map(({ requestId }) => ({ requestId, matches: [] })) };
  } } };
  context.records = Array.from({ length: 501 }, (_, n) => ({ item: { title: `Book ${n}`, kind: 'book' }, match: { state: 'new' } }));
  vm.runInContext("comparison = {job:1,galactic:createGalacticLookup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')}", context);
  await vm.runInContext("queryGalacticLibrary(records,'book',comparison,1)", context);
  assert.deepEqual(context.calls.map(call => call.items.length), [500, 1]);
  context.calls = [];
  context.records = Array.from({ length: 11 }, (_, n) => ({ item: { title: `Collection ${n}`, kind: 'book' }, match: { state: 'new' } }));
  context.maps = context.records.map(({ item }, n) => ({ ...mapping, id: `m${n}`, collectionTitle: item.title, contains: [{ series: '漫画', run: '2020', unitType: 'volume', from: 1, to: 2000 }] }));
  vm.runInContext("comparison = {job:1,collectionMappings:maps,galactic:createGalacticLookup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')}", context);
  await vm.runInContext("queryGalacticLibrary(records,'book',comparison,1)", context);
  assert.deepEqual(context.calls.map(call => call.items.length), [10, 1]);
  assert.ok(context.calls.every(call => call.items.reduce((sum, item) => sum + item.contents.length, 0) <= 20000));
  context.chrome.runtime.sendMessage = async () => ({ ok: true, apiVersion: 1, results: [] });
  vm.runInContext("comparison = {job:1,galactic:createGalacticLookup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')}", context);
  await vm.runInContext("queryGalacticLibrary(records,'book',comparison,1)", context);
  assert.equal(context.comparison.galactic.resultsByKey.size, 0);
  assert.match(context.comparison.galactic.error, /incomplete/u);
});

const glApi = new URL('../../GalacticLibrary/src/lib/external-api.js', import.meta.url);
test('HB requests and coverage agree with the actual adjacent GL API', { skip: !fs.existsSync(glApi) }, async () => {
  const { handleExternalApiRequest } = await import(glApi);
  const { titleKey } = await import(new URL('../../GalacticLibrary/src/lib/normalization.js', import.meta.url));
  const db = { providerItems: {
    k: { id: 'k', recordRef: 'opaque-k', provider: 'kindle', mediaType: 'book', title: 'Other omnibus', normalizedTitle: titleKey('Other omnibus'), ownership: 'owned', metadata: {} },
    h: { id: 'h', recordRef: 'opaque-h', provider: 'humble', mediaType: 'book', title: 'Stale omnibus', normalizedTitle: titleKey('Stale omnibus'), ownership: 'owned', metadata: {} }
  }, contentReviews: { k: { entries: [unit(3)], verifiedAt: '2026-10-01T12:00:00Z' }, h: { entries: [unit(4)] } } };
  const offered = { title: 'New omnibus', kind: 'book' };
  const offeredMap = { ...mapping, collectionTitle: offered.title, contains: [{ series: '漫画', run: '2020', unitType: 'volume', from: 1, to: 4 }] };
  const response = handleExternalApiRequest(db, { type: 'MATCH_ITEMS', apiVersion: 1, items: [{ requestId: 'test', ...plain(O.request(offered, [offeredMap])) }] });
  assert.equal(response.ok, true);
  const coverage = O.coverageFor(O.offerContents(offered, [offeredMap]), O.localEvidence([{ title: mapping.collectionTitle }], [mapping]), response.results[0]);
  assert.equal(coverage.owned, 3);
  assert.deepEqual(plain(coverage.missing).map(entry => entry.number), ['4']);
  assert.equal(coverage.complete, false);
});
