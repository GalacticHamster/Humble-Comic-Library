import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = { URL }; context.globalThis = context; vm.createContext(context);
for (const file of ['shared.js', 'collection-mappings.js', 'ownership.js']) vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context);
const O = context.HumbleOwnership;
const unit = (number, overrides = {}) => ({ series: '漫画', run: '2020', unitType: 'volume', number: String(number), language: 'ja', completeness: 'full', ...overrides });
const offered = (...entries) => ({ item: { title: 'Offered', kind: 'book' }, target: { entries, complete: false } });
const evidence = (number, overrides = {}) => ({ ...unit(number), evidence: [{ title: 'Owned omnibus', provider: 'kindle', ownership: 'owned' }], ...overrides });

test('series targets check intervening units; they are never declared a complete purchasable edition', () => {
  const queries = O.readingTargets([offered(unit(1), unit(3))]);
  assert.deepEqual(Array.from(queries[0].target.entries, entry => entry.number).sort(), ['1', '2', '3']);
  const request = O.request(queries[0].item, [], queries[0].target);
  assert.equal(request.contentsComplete, false);
  assert.equal(request.contents.length, 3);
  assert.equal(request.excludeProviders[0], 'humble');
});

test('central ownership of an intervening volume prevents a false storefront gap', () => {
  const queries = O.readingTargets([offered(unit(1), unit(3))]); queries[0].item.galacticKey = 'series';
  const groups = O.seriesCoverage(queries, [], new Map([['series', { coverage: { covered: [evidence(1), evidence(2)], possibleCovered: [] } }]]));
  assert.equal(groups[0].covered, 2);
  assert.deepEqual(Array.from(groups[0].gaps, entry => entry.number), ['3']);
  assert.deepEqual(Array.from(groups[0].entries, entry => entry.number), ['1', '2', '3']);
});

test('runs, language, annuals, specials, excerpts and audio are separated in reading coverage', () => {
  const rows = [offered(unit(1), unit(1, { run: '2021' }), unit(1, { language: 'en' }), unit(1, { unitType: 'annual' }), unit('Holiday', { unitType: 'special' }), unit(2, { completeness: 'excerpt' })),
    { item: { title: 'Audio', kind: 'audiobook' }, target: { entries: [unit(3)] } }];
  const queries = O.readingTargets(rows);
  assert.equal(queries.length, 5);
  assert.ok(queries.every(query => query.target.entries.length === 1));
  const groups = O.seriesCoverage(queries, []);
  assert.equal(groups.flatMap(group => group.entries).length, 5);
});

test('fractional issue order is numeric; unknown scope is reviewable rather than a definite gap', () => {
  const queries = O.readingTargets([offered(unit('10'), unit('1/2'), unit('2'))]);
  const group = O.seriesCoverage(queries, [])[0];
  assert.equal(group.entries[0].number, '1/2');
  assert.equal(group.entries.at(-1).number, '10');
  const unknown = O.seriesCoverage(O.readingTargets([offered(unit(1, { run: '' }))]), [])[0];
  assert.equal(unknown.gaps.length, 0);
  assert.equal(unknown.uncertain.length, 1);
});

test('large numeric spans stay bounded and reviewed local sources contribute to central series views', () => {
  const queries = O.readingTargets([offered(unit(1), unit(100000))]);
  assert.equal(queries[0].target.entries.length, 2);
  assert.equal(queries[0].enumerationLimited, true);
  const local = O.localEvidence([{ title: 'Owned collection' }], [{ collectionTitle: 'Owned collection', language: 'ja', sourceLabel: 'Publisher', contains: [{ series: '漫画', run: '2020', unitType: 'volume', number: '1' }] }]);
  const group = O.seriesCoverage(queries, local)[0];
  assert.equal(group.covered, 1);
  assert.equal(group.entries[0].evidence[0].provider, 'humble');
});
