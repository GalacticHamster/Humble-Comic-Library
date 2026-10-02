import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Mirrored policy fixture in HB/FAN; exercise shipped classification, never a
// reconstructed matcher. HB keeps the real storefront merge/count path here.
const fanatical = fs.existsSync(new URL('../src/shared.js', import.meta.url));
function fixture(records, media, offered, central = null) {
  const context = { URL, Blob, Promise, setTimeout, clearTimeout, console, performance: { now: () => 0 },
    document: { title: '', querySelector: () => null, querySelectorAll: () => [] }, location: { pathname: '/' } };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of fanatical ? ['src/shared.js'] : ['shared.js', 'collection-mappings.js', 'ownership.js', 'content.js'])
    vm.runInContext(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context, { filename: file });
  context.records = records.map(record => ({ ...record, [fanatical ? 'mediaType' : 'kind']: record.media ?? media }));
  context.offered = { ...offered, [fanatical ? 'mediaType' : 'kind']: media, lookupTitle: offered.title, tier: { label: '$5 tier', price: 5 } };
  if (!fanatical) {
    context.central = central;
    context.chrome = { runtime: { sendMessage: async (_id, message) => {
      if (central instanceof Error) throw central;
      return { ok: true, apiVersion: 1, results: message.items.map(({ requestId }) => ({ requestId, matches: [], ...central })) };
    } } };
    vm.runInContext(
      "collectBundleItems = () => [offered]; sortBundleItems = () => ({}); annotateAllCoverCopies = () => {}; " +
      "applyBundleNewItemsOnlyFilter = () => {}; showComparisonProgress = () => {}; " +
      "renderComparisonSummary = (counts, tiers) => { summary = { counts, tiers: [...tiers.values()] }; }; " +
      "comparison = { job: 1, galactic: createGalacticLookup(central ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : '') };", context);
  }
  return {
    context,
    async classify() {
      const match = fanatical ? vm.runInContext('FanaticalLibrary.resolveProduct(offered, records, FanaticalLibrary.localContents(records), () => null)', context)
        : (await vm.runInContext("renderBundleComparison(createBundleLibraryMatcher(records, offered.kind), offered.kind, [], [], comparison, 1)", context),
          context.comparison.resolvedItems[0].match);
      const candidates = [...(Array.isArray(match.item) ? match.item : match.item ? [match.item] : []), ...(match.candidates ?? []),
        ...(match.externalPossibleMatches ?? [])];
      return { match, candidates };
    }
  };
}

const cases = JSON.parse(fs.readFileSync(new URL('./matching-policy-cases.json', import.meta.url), 'utf8'));
for (const row of cases) test(row.label + ' follows policy in both comparison directions', async () => {
  for (const [offered, owned] of [[row.offered, row.owned], [row.owned, row.offered]]) {
    const { match, candidates } = await fixture([{ title: owned }], row.media, { title: offered }).classify();
    assert.equal(match.state, row.expected, offered + ' versus ' + owned);
    if (row.expected !== 'new') assert.ok(candidates.some(candidate => candidate.title === owned), 'Actual library title must be available to explain the result');
  }
});

test('known identity conflicts stay separate and weak collisions never become Owned', async () => {
  for (const fields of [
    [{ authors: ['Writer A'] }, { authors: ['Writer B'] }, 'new'],
    [{ isbn: '9780306406157' }, { isbn: '9780140328721' }, 'possible'],
    [{ language: 'en' }, { language: 'ja' }, 'possible'],
    [{ run: '2000' }, { run: '2020' }, 'new']
  ]) {
    const { match } = await fixture([{ title: 'Shared Book Title', ...fields[1] }], 'book', { title: 'Shared Book Title', ...fields[0] }).classify();
    assert.equal(match.state, fields[2]);
  }
  for (const media of ['game', 'audiobook']) {
    const { match } = await fixture([{ title: 'Shared Book Title', media }], 'book', { title: 'Shared Book Title' }).classify();
    assert.equal(match.state, 'new');
  }
});

test('ambiguous homonyms require identity evidence; valid identifiers still prove renamed purchases', async () => {
  const records = [{ title: 'Shared Book Title', authors: ['A'] }, { title: 'Shared Book Title', authors: ['B'] }];
  assert.equal((await fixture(records, 'book', { title: 'Shared Book Title' }).classify()).match.state, 'possible');
  assert.equal((await fixture(records, 'book', { title: 'Shared Book Title', authors: ['B'] }).classify()).match.state, 'owned');
  assert.equal((await fixture([{ title: 'Old Name', isbn: '9780306406157' }], 'book', { title: 'New Name', isbn: '9780306406157' }).classify()).match.state, 'owned');
});

test('multiple plausible subtitle candidates remain inspectable in either library order', async () => {
  const records = [{ title: 'Think Like a Programmer: Advanced Techniques' }, { title: 'Think Like a Programmer: An Introduction to Creative Problem Solving' }];
  for (const library of [records, [...records].reverse()]) {
    const { match, candidates } = await fixture(library, 'book', { title: 'Think Like a Programmer' }).classify();
    assert.equal(match.state, 'possible');
    for (const record of records) assert.ok(candidates.some(candidate => candidate.title === record.title));
    const lines = fanatical ? globalLines(match) : null;
    if (lines) for (const record of records) assert.ok(lines.includes(record.title));
  }
});
function globalLines(match) {
  const context = fixture([], 'book', { title: 'Unused' }).context;
  return context.FanaticalLibrary.explanationLines(match).join('\n');
}
