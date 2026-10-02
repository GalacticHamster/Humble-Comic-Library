import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Mirrored policy fixture in HB/FAN; exercise shipped classification, never a
// reconstructed matcher. HB keeps the real storefront merge/count path here.
const fanatical = fs.existsSync(new URL('../src/shared.js', import.meta.url));
function fixture(records, media, offered, central = null, historical = []) {
  const context = { URL, Blob, Promise, setTimeout, clearTimeout, console, performance: { now: () => 0 },
    document: { title: '', querySelector: () => null, querySelectorAll: () => [] }, location: { pathname: '/' } };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of fanatical ? ['src/shared.js'] : ['shared.js', 'collection-mappings.js', 'ownership.js', 'content.js'])
    vm.runInContext(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context, { filename: file });
  context.records = records.map(record => ({ ...record, [fanatical ? 'mediaType' : 'kind']: record.media ?? media }));
  context.historical = historical.map(record => ({ ...record, [fanatical ? 'mediaType' : 'kind']: record.media ?? media }));
  context.offered = { ...offered, [fanatical ? 'mediaType' : 'kind']: media, lookupTitle: offered.title, tier: { label: '$5 tier', price: 5 } };
  context.centralResult = central instanceof Error ? { matches: [], lookupIncomplete: true } : central;
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
      const match = fanatical ? vm.runInContext('FanaticalLibrary.resolveProduct(offered, records, FanaticalLibrary.localContents(records), () => centralResult, 0, historical)', context)
        : (await vm.runInContext("renderBundleComparison(createBundleLibraryMatcher(records, offered.kind, historical), offered.kind, [], [], comparison, 1)", context),
          context.comparison.resolvedItems[0].match);
      const candidates = [...(Array.isArray(match.item) ? match.item : match.item ? [match.item] : []), ...(match.candidates ?? []),
        ...(match.externalPossibleMatches ?? [])];
      return { match, candidates };
    }
  };
}

test('missing historical purchases warn with their titles and never prove ownership or coverage', async () => {
  for (const [offered, previous] of [['Offered Book', 'Offered Book'], ['Offered Book', 'Offered Book: A Useful Subtitle'],
    ['Saga Vol. 1', 'Saga Vol. 1']]) {
    const f = fixture([], 'book', { title: offered }, null, [{ title: previous, sourceBundle: 'Previous purchase', source: 'humble' }]);
    const { match, candidates } = await f.classify();
    assert.equal(match.state, 'possible', offered);
    assert.equal(match.ownershipReview, true);
    assert.ok(candidates.some(item => item.title === previous && item.historical && item.ownership === 'unknown'));
    assert.equal(match.coverage?.owned ?? 0, 0);
    const lines = fanatical ? f.context.FanaticalLibrary.explanationLines(match) : f.context.HumbleOwnership.explanationLines(match);
    assert.match(lines.join('\n'), /not observed/i);
    assert.match(lines.join('\n'), /Previous purchase/);
    if (!fanatical) {
      assert.equal(f.context.summary.counts.owned, 0);
      assert.equal(f.context.summary.counts.new, 0);
      assert.equal(f.context.HumbleOwnership.planBundle(f.context.comparison.resolvedItems).goalCount, 0);
    }
  }
});

test('historical warnings survive lookup failures, but verified current ownership takes precedence', async () => {
  const history = [{ title: 'Offered Book' }];
  assert.equal((await fixture([], 'book', { title: 'Offered Book' }, new Error('Unavailable'), history).classify()).match.state, 'possible');
  assert.equal((await fixture([{ title: 'Offered Book' }], 'book', { title: 'Offered Book' }, null, history).classify()).match.state, 'owned');
  assert.equal((await fixture([], 'book', { title: 'Offered Book' }, {
    matches: [{ provider: 'kindle', title: 'Offered Book', ownership: 'owned', relationship: 'same-edition' }]
  }, history).classify()).match.state, 'elsewhere');
  assert.equal((await fixture([], 'book', { title: 'Offered Book', authors: ['A'] }, null,
    [{ title: 'Offered Book', authors: ['B'] }]).classify()).match.state, 'new');
});

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

test('central Possible preserves the actual candidate even when ownership is uncertain or temporary', async () => {
  for (const ownership of ['owned', 'claimed', 'unknown', 'subscription', 'borrowed', 'rental']) {
    const record = { provider: 'kindle', title: 'The Related Library Edition', ownership, relationship: 'same-work' };
    const { match, candidates } = await fixture([], 'book', { title: 'Offered Book' }, { possibleMatches: [record] }).classify();
    assert.equal(match.state, 'possible', ownership);
    assert.ok(candidates.some(candidate => candidate.title === record.title));
    assert.equal(Boolean(match.ownershipReview), !['owned', 'claimed'].includes(ownership));
  }
});

test('failed central lookup remains Not checked; local ownership and Possible evidence survive', async () => {
  for (const [records, expected] of [[[], 'unchecked'], [[{ title: 'Offered Book' }], 'owned'],
    [[{ title: 'Offered Book: A Useful Subtitle' }], 'possible']]) {
    const f = fixture(records, 'book', { title: 'Offered Book' }, new Error('Unavailable'));
    const { match } = await f.classify();
    assert.equal(match.state, expected);
    if (!fanatical) {
      assert.equal(f.context.summary.counts.new, 0);
      assert.equal(f.context.summary.counts.unchecked, expected === 'unchecked' ? 1 : 0);
      assert.equal(f.context.HumbleOwnership.planBundle(f.context.comparison.resolvedItems).goalCount, 0);
    }
  }
});

if (!fanatical) {
  test('omitted, duplicate and malformed central results cannot become confirmed absence', async () => {
    for (const response of [
      () => ({ ok: true, apiVersion: 1, results: [] }),
      request => ({ ok: true, apiVersion: 1, results: [0, 1].map(() => ({ requestId: request.items[0].requestId, matches: [] })) }),
      request => ({ ok: true, apiVersion: 1, results: request.items.map(item => ({ requestId: item.requestId, matches: [], possibleMatches: 'unreadable' })) })
    ]) {
      const f = fixture([], 'book', { title: 'Unchecked Book' }, {});
      f.context.chrome.runtime.sendMessage = async (_id, request) => response(request);
      const { match } = await f.classify();
      assert.equal(match.state, 'unchecked');
      assert.equal(f.context.summary.counts.new, 0);
      assert.equal(vm.runInContext('confirmedNewItemCount(summary.tiers[0])', f.context), 0);
      assert.equal(f.context.comparison.galactic.resultsByKey.size, 0);
    }
  });

  test('a successful retry clears Not checked and caches a completed no-match', async () => {
    const f = fixture([], 'book', { title: 'Retry Book' }, new Error('Unavailable'));
    assert.equal((await f.classify()).match.state, 'unchecked');
    let calls = 0;
    f.context.chrome.runtime.sendMessage = async (_id, request) => {
      calls++;
      return { ok: true, apiVersion: 1, results: request.items.map(({ requestId }) => ({ requestId, matches: [] })) };
    };
    assert.equal((await f.classify()).match.state, 'new');
    assert.equal(f.context.summary.counts.unchecked, 0);
    assert.equal(f.context.comparison.galactic.failuresByKey.size, 0);
    assert.equal((await f.classify()).match.state, 'new');
    assert.equal(calls, 1);
  });

  test('missing central contents coverage cannot inflate confirmed-new unit or wishlist value', async () => {
    const f = fixture([], 'book', { title: 'Manga Vol. 1', run: '2020', language: 'en' }, {});
    const { match } = await f.classify();
    assert.equal(match.contentsLookupIncomplete, true);
    assert.ok(f.context.comparison.seriesCoverage.every(group => group.lookupIncomplete && group.gaps.length === 0));
    const O = f.context.HumbleOwnership;
    const rows = f.context.comparison.resolvedItems;
    assert.equal(O.planBundle(rows, [], 'contents').goalCount, 0);
    const missing = { ...rows[0], match: { ...match, state: 'unchecked', lookupIncomplete: true } };
    for (const includeUncertain of [false, true]) {
      const plan = O.planBundle([missing], [{ title: missing.item.title, kind: 'book', weight: 100 }], 'wishlist', includeUncertain);
      assert.equal(plan.goalCount, 0);
      assert.equal(plan.tiers[0].wishlistValue, 0);
      assert.equal(plan.tiers[0].newUnits, 0);
    }
  });
}
