import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function load({ pathname = '/books/example-books', heading = '', bundleData = {}, malformed = false, cards = [] } = {}) {
  const images = cards.map(({ title, format }) => {
    const container = { getAttribute: (name) => name === 'data-format' ? format : null };
    return { alt: title, container, getAttribute: () => null };
  });
  const document = {
    title: '',
    querySelector: (selector) => selector === 'h1' ? { textContent: heading }
      : selector === '#webpack-bundle-page-data' ? { textContent: malformed ? '{' : JSON.stringify({ bundleData }) } : null,
    querySelectorAll: (selector) => selector.startsWith('img.') ? images : []
  };
  const context = { Blob, URL, clearTimeout, console, document, location: { pathname: '/' }, performance: { now: () => 0 }, Promise, setTimeout };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ['shared.js', 'collection-mappings.js', 'ownership.js', 'content.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }
  context.location.pathname = pathname;
  context.calls = [];
  context.chrome = { runtime: { sendMessage: async (id, request) => {
    context.calls.push(request);
    return { ok: true, apiVersion: 1, results: request.items.map(({ requestId, title }) => ({ requestId, matches: [{ title, provider: 'audible', ownership: 'owned' }] })) };
  } } };
  vm.runInContext(`
    showComparisonProgress = () => {};
    productContainer = (image) => image.container;
    findTier = () => ({ label: '$5.00 tier', price: 5 });
    sortBundleItems = () => ({});
    annotateBundleItem = (item, match) => annotations.push({ title: item.title, kind: item.kind, state: match.state });
    applyBundleNewItemsOnlyFilter = () => {};
    renderComparisonSummary = (counts, tiers, titles, kind) => { summary = { counts, kind }; };
  `, context);
  context.annotations = [];
  return context;
}

function run(context, expression) { return vm.runInContext(expression, context); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('clearly labelled audiobook listings use audio on the existing Books route', () => {
  for (const options of [
    { pathname: '/books/fantasy-audiobooks-books' },
    { heading: 'Humble Audiobook Bundle: Fantasy' },
    { heading: 'Audio Books Bundle' },
    { bundleData: { content_type: 'audiobook' } }
  ]) assert.equal(run(load(options), "bundleMediaContext('book').defaultKind"), 'audiobook');
});

test('ordinary books, mixed listings and unrelated game/software audio are not audio-only bundles', () => {
  for (const options of [
    { heading: 'The Audiobook Production Guide' },
    { heading: 'Books & Audiobooks Bundle', pathname: '/books/books-and-audiobooks-books' },
    { heading: 'Audiobooks and eBooks Bundle' },
    { malformed: true }
  ]) assert.equal(run(load(options), "bundleMediaContext('book').defaultKind"), 'book');
  for (const kind of ['game', 'software']) assert.equal(run(load({ heading: 'Audiobook Bundle' }), `bundleMediaContext('${kind}').defaultKind`), kind);
});

test('per-item metadata separates mixed formats and identifies audio even with a PDF booklet', () => {
  const context = load({ bundleData: { tier_item_data: {
    audio: { human_name: 'Audio Work', downloads: [{ format: 'mp3' }, { format: 'pdf' }] },
    ebook: { human_name: 'Written Work', downloads: [{ format: 'epub' }] }
  } } });
  assert.equal(run(context, "describeBundleItem({title:'Audio Work'}, bundleMediaContext()).kind"), 'audiobook');
  assert.equal(run(context, "describeBundleItem({title:'Written Work'}, bundleMediaContext()).kind"), 'book');
  const audioPage = load({ heading: 'Audiobook Bundle', bundleData: { tier_item_data: { ebook: { human_name: 'Written Work', downloads: [{ format: 'epub' }] } } } });
  assert.equal(run(audioPage, "describeBundleItem({title:'Written Work'}, bundleMediaContext()).kind"), 'book');
});

test('only explicit trailing audiobook delivery labels are removed for audio lookup', () => {
  const context = load();
  for (const title of ['Work (Audiobook)', 'Work [Audio Book]', 'Work - Audiobook', 'Work: Audiobook']) {
    context.title = title;
    assert.equal(run(context, 'audiobookLookupTitle(title)'), 'Work');
    assert.equal(run(context, 'describeBundleItem({title}, bundleMediaContext()).kind'), 'audiobook');
  }
  for (const title of ['The Audiobook Production Guide', 'Work (Unabridged)', 'Work: A Novel', 'Work (Narrated by Someone)']) {
    context.title = title;
    assert.equal(run(context, 'audiobookLookupTitle(title)'), title);
  }
});

test('ambiguous same-title metadata does not infer ownership without a local format signal', () => {
  const context = load({ bundleData: { tier_item_data: {
    audio: { human_name: 'Shared Work', format: 'mp3' },
    ebook: { human_name: 'Shared Work', format: 'epub' }
  } } });
  assert.equal(run(context, "describeBundleItem({title:'Shared Work'}, bundleMediaContext()).kind"), 'unknown');
  context.item = { title: 'Shared Work', container: { getAttribute: (name) => name === 'data-format' ? 'm4b' : null } };
  assert.equal(run(context, 'describeBundleItem(item, bundleMediaContext()).kind'), 'audiobook');
});

async function render(context, records = [], baseKind = 'book', mappings = []) {
  context.records = records;
  context.baseKind = baseKind;
  context.mappings = mappings;
  run(context, `comparison = { job: 1, galactic: createGalacticLookup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') };`);
  await run(context, 'renderBundleComparison(createBundleLibraryMatcher(records, baseKind), baseKind, [], mappings, comparison, 1)');
  return plain(context.summary);
}

test('audio exact companion ownership renders elsewhere with audible provenance and audio request type', async () => {
  const context = load({ heading: 'Audiobook Bundle', cards: [{ title: 'Shared Work (Audiobook)' }] });
  const result = await render(context, [{ title: 'Shared Work' }]);
  assert.equal(result.kind, 'audiobook');
  assert.equal(result.counts.elsewhere, 1);
  assert.equal(result.counts.owned, 0, 'an ebook is not an owned audiobook');
  assert.deepEqual(plain(context.calls[0].items), [{ requestId: 'audiobook:shared work', mediaType: 'audiobook', title: 'Shared Work', excludeProviders: ['humble'] }]);
  assert.equal(run(context, "matchProvenance({state:'elsewhere',externalMatches:galacticOwnedMatches('audiobook','Shared Work',comparison)}).includes('Audible: Shared Work')"), true);
});

test('Humble audiobook exact ownership wins and legacy book ownership stays separate', async () => {
  const context = load({ cards: [{ title: 'Shared Work (Audiobook)' }, { title: 'Written Work' }] });
  const result = await render(context, [{ title: 'Shared Work', kind: 'audiobook' }, { title: 'Written Work' }]);
  assert.equal(result.counts.owned, 2);
  assert.equal(context.calls.length, 0, 'locally owned items need no external request');
  const written = load({ cards: [{ title: 'Shared Work' }] });
  await render(written, [{ title: 'Shared Work', kind: 'audiobook' }]);
  assert.equal(written.calls[0].items[0].mediaType, 'book');
  assert.equal(written.summary.counts.owned, 0);
});

test('mixed same-title book/audio cards are counted, cached and annotated separately', async () => {
  const context = load({ cards: [{ title: 'Shared Work', format: 'epub' }, { title: 'Shared Work', format: 'mp3' }] });
  const result = await render(context, [{ title: 'Shared Work' }]);
  assert.equal(result.kind, 'mixed-books');
  assert.equal(result.counts.owned, 1);
  assert.equal(result.counts.elsewhere, 1);
  assert.deepEqual(plain(context.annotations).map(({ kind, state }) => [kind, state]), [['book', 'owned'], ['audiobook', 'elsewhere']]);
  assert.equal(context.calls[0].items[0].mediaType, 'audiobook');
});

test('temporary audio access is review only and incompatible/unavailable responses keep local results', async () => {
  for (const response of [
    { ok: true, apiVersion: 1, ownership: 'subscription' },
    { ok: true, apiVersion: 99 },
    { ok: false, error: 'Unavailable' },
    null
  ]) {
    const context = load({ heading: 'Audiobook Bundle', cards: [{ title: 'Audio Work' }] });
    context.chrome.runtime.sendMessage = async (id, request) => response?.ownership
      ? { ...response, results: [{ requestId: request.items[0].requestId, matches: [{ provider: 'audible', ownership: response.ownership }] }] } : response;
    const result = await render(context);
    assert.equal(result.counts.elsewhere, 0);
    assert.equal(result.counts.possible, response?.ownership ? 1 : 0);
    assert.equal(result.counts.new, response?.ownership ? 0 : 1);
  }
});

test('game/book requests remain supported while software/unknown never reach the API', async () => {
  const context = load();
  context.requestItems = ['game', 'book', 'audiobook', 'software', 'unknown'].map((kind) => ({ item: { kind, title: 'Shared Work' }, match: { state: 'new' } }));
  run(context, "comparison = {job:1,galactic:createGalacticLookup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')}");
  await run(context, "queryGalacticLibrary(requestItems,'software',comparison,1)");
  assert.deepEqual(plain(context.calls[0].items).map(({ mediaType }) => mediaType), ['game', 'book', 'audiobook']);
  await run(context, "queryGalacticLibrary([{item:{title:'Tool'},match:{state:'new'}}],'software',comparison,1)");
  assert.equal(context.calls.length, 1);
  await run(context, "queryGalacticLibrary(requestItems,'book',comparison,1)");
  assert.equal(context.calls.length, 1, 'cache is keyed by media type and avoids repeated requests');
});

test('software render stays entirely local even when companion link is configured', async () => {
  const context = load({ pathname: '/software/tools', cards: [{ title: 'Tool' }] });
  const result = await render(context, [], 'software');
  assert.equal(context.calls.length, 0);
  assert.equal(result.counts.new, 1);
});

test('media-separated library indexes preserve existing exact games and partial book ranges', async () => {
  const game = load({ pathname: '/games/example-games', cards: [{ title: 'Known Game' }] });
  const gameResult = await render(game, [{ title: 'Known Game', kind: 'game' }], 'game');
  assert.equal(gameResult.counts.owned, 1);
  assert.equal(game.calls.length, 0);
  const books = load({ cards: [{ title: 'Example Series Vol. 1-3' }] });
  books.chrome.runtime.sendMessage = async () => ({ ok: true, apiVersion: 1, results: [] });
  const bookResult = await render(books, [{ title: 'Example Series Vol. 1' }, { title: 'Example Series Vol. 2', kind: 'audiobook' }]);
  assert.equal(bookResult.counts.partial, 1);
  assert.equal(bookResult.counts.owned, 0);
  assert.equal(plain(run(books, 'collectBundleItems()'))[0].kind, 'book');
});

test('ambiguous formats never borrow ownership from an ebook or audiobook with the same title', async () => {
  const context = load({ cards: [{ title: 'Shared Work' }], bundleData: { tier_item_data: {
    audio: { human_name: 'Shared Work', format: 'mp3' },
    ebook: { human_name: 'Shared Work', format: 'epub' }
  } } });
  const result = await render(context, [{ title: 'Shared Work' }, { title: 'Shared Work', kind: 'audiobook' }]);
  assert.equal(result.counts.new, 1);
  assert.equal(context.calls.length, 0);
});

test('Gecko companion IDs send audiobook requests through the same chrome API and cache no-match results', async () => {
  const context = load();
  context.ids = [];
  context.chrome.runtime.sendMessage = async (id, request) => {
    context.ids.push(id);
    context.calls.push(request);
    return { ok: true, apiVersion: 1, results: request.items.map(({ requestId }) => ({ requestId, matches: [] })) };
  };
  run(context, "comparison = {job:1,galactic:createGalacticLookup('galactic-library@example.org')}; requestItems = [{item:{kind:'audiobook',title:'Audio Work'},match:{state:'new'}}]");
  for (let repeat = 0; repeat < 2; repeat += 1) await run(context, "queryGalacticLibrary(requestItems,'book',comparison,1)");
  assert.deepEqual(context.ids, ['galactic-library@example.org']);
  assert.equal(context.calls[0].items[0].mediaType, 'audiobook');
  assert.equal(run(context, "galacticOwnedMatches('audiobook','Audio Work',comparison).length"), 0);
});

test('a DOM refresh during an audio lookup waits for shared results rather than replacing them', async () => {
  const context = load();
  let resolve;
  context.chrome.runtime.sendMessage = (id, request) => {
    context.calls.push(request);
    return new Promise((complete) => { resolve = complete; });
  };
  run(context, "comparison = {job:1,galactic:createGalacticLookup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')}; requestItems = [{item:{kind:'audiobook',title:'Audio Work'},match:{state:'new'}}]");
  const first = run(context, "queryGalacticLibrary(requestItems,'book',comparison,1)");
  context.comparison.job = 2;
  const second = run(context, "queryGalacticLibrary(requestItems,'book',comparison,2)");
  resolve({ ok: true, apiVersion: 1, results: [{ requestId: 'audiobook:audio work', matches: [{ provider: 'audible', ownership: 'owned', title: 'Audio Work' }] }] });
  await Promise.all([first, second]);
  assert.equal(context.calls.length, 1);
  assert.equal(run(context, "galacticOwnedMatches('audiobook','Audio Work',comparison).length"), 1);
});

test('storefront combines local and GL contents; incomplete lists stay Partial even at full unit coverage', async () => {
  const entries = [1, 2, 3].map(number => ({ series: 'Manga', run: '2000', unitType: 'volume', number: String(number), language: 'en', completeness: 'full' }));
  const localMap = { id: 'local', collectionTitle: 'Owned collection', language: 'en', contains: [{ series: 'Manga', run: '2000', unitType: 'volume', from: 1, to: 2 }] };
  for (const contentsComplete of [false, true]) {
    const offeredMap = { id: 'offered', collectionTitle: 'Offered collection', language: 'en', contentsComplete, contains: [{ series: 'Manga', run: '2000', unitType: 'volume', from: 1, to: 3 }] };
    const context = load({ cards: [{ title: offeredMap.collectionTitle }] });
    context.chrome.runtime.sendMessage = async (_id, request) => ({ ok: true, apiVersion: 1, results: request.items.map(({ requestId }) => ({ requestId, matches: [], partialMatches: [{ provider: 'kindle', title: 'Other collection', ownership: 'owned', relationship: 'contains' }], coverage: { covered: [{ ...entries[2], evidence: [{ provider: 'kindle', title: 'Other collection', ownership: 'owned', relationship: 'contains' }] }], possibleCovered: [] } })) });
    const result = await render(context, [{ title: localMap.collectionTitle }], 'book', [localMap, offeredMap]);
    assert.equal(result.counts.owned, contentsComplete ? 1 : 0);
    assert.equal(result.counts.partial, contentsComplete ? 0 : 1);
    assert.equal(context.comparison.resolvedItems[0].match.coverage.owned, 3);
  }
});

test('known ISBN differences and ambiguous homonyms stay Possible; different authors do not become Owned', async () => {
  const context = load({ cards: [{ title: 'Shared Title' }], bundleData: { tier_item_data: {
    offered: { human_name: 'Shared Title', format: 'epub', isbn: '9780306406157', author: 'Writer' }
  } } });
  context.chrome.runtime.sendMessage = async (_id, request) => ({ ok: true, apiVersion: 1, results: request.items.map(({ requestId }) => ({ requestId, matches: [] })) });
  let result = await render(context, [{ title: 'Shared Title', isbn: ['9780140328721'], authors: ['Writer'] }]);
  assert.equal(result.counts.possible, 1);
  assert.equal(result.counts.owned, 0);
  result = await render(context, [{ title: 'Shared Title', authors: ['Other writer'] }]);
  assert.equal(result.counts.owned, 0);
  assert.equal(result.counts.possible, 0);
  const ambiguous = load({ cards: [{ title: 'Shared Title' }] });
  ambiguous.chrome.runtime.sendMessage = context.chrome.runtime.sendMessage;
  result = await render(ambiguous, [{ title: 'Shared Title', authors: ['A'] }, { title: 'Shared Title', authors: ['B'] }]);
  assert.equal(result.counts.possible, 1);
  assert.equal(result.counts.owned, 0);
});
