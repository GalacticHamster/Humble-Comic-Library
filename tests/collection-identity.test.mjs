import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = { URL, Blob, console, clearTimeout, setTimeout, document: { title: '' }, location: { pathname: '/' }, performance: { now: () => 0 } };
context.globalThis = context;
vm.createContext(context);
for (const file of ['shared.js', 'collection-mappings.js', 'ownership.js', 'content.js']) vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
const rules = context.HumbleCollectionMappings;
const plain = value => JSON.parse(JSON.stringify(value));
const rich = {
  id: 'batman-collection', collectionTitle: 'Collection', editionId: 'edition-1',
  identifiers: { isbn: '0-306-40615-2' }, sourceLabel: 'Publisher', sourceId: 'catalog-1',
  sourceUrl: 'https://publisher.example/collection?tracking=removed#contents', verifiedAt: '2026-10-01T12:00:00Z', contentsComplete: true,
  contains: [
    { series: 'Batman', seriesId: 'series-1', run: '2011', runId: 'run-1', unitType: 'issue', number: '1/2', language: 'en' },
    { series: 'Batman', year: 2011, unitType: 'annual', number: '1', language: 'en' },
    { series: 'Batman', year: 2011, unitType: 'special', number: 'Holiday', completeness: 'excerpt', language: 'en' },
    { series: 'Naruto', run: '1999', unitType: 'volume', from: 1, to: 3, language: 'ja' }
  ]
};

test('legacy integer-range mappings retain their shape and curated issue matching', () => {
  const legacy = { id: 'one', collectionTitle: 'Collection', sourceLabel: 'Custom mapping', contains: [{ series: 'Example', year: 2000, from: 1, to: 4 }] };
  assert.deepEqual(plain(rules.validateCustomMappings([legacy])), [legacy]);
  context.library = new Map([[context.HumbleComicLibrary.titleKey('Valiant Masters Rai: From Honor To Strength'), { title: 'Valiant Masters Rai: From Honor To Strength' }]]);
  assert.equal(vm.runInContext("findOwnedCollectionIssue('Rai (1992) #3', library, HumbleCollectionMappings.builtIn)", context), null);
  assert.ok(vm.runInContext("findOwnedCollectionIssue('Rai (1992) #3', library, HumbleCollectionMappings.builtIn, {}, false)", context));
  assert.equal(vm.runInContext("findOwnedCollectionIssue('Rai (2012) #3', library, HumbleCollectionMappings.builtIn)", context), null);
});

test('rich mappings preserve edition, series/run IDs, source evidence and special/fractional units', () => {
  const [mapping] = rules.validateCustomMappings([rich]);
  assert.equal(mapping.sourceUrl, 'https://publisher.example/collection');
  assert.equal(mapping.editionId, 'edition-1');
  assert.equal(mapping.identifiers.isbn[0], '9780306406157');
  const expanded = rules.expandContents(mapping);
  assert.equal(expanded.length, 6);
  assert.equal(expanded[0].runId, 'run-1');
  assert.equal(expanded[1].unitType, 'annual');
  assert.equal(expanded[2].completeness, 'excerpt');
  assert.equal(expanded[5].number, '3');
  assert.equal(rules.numberKey('1/2'), rules.numberKey('0.5'));
});

test('edition-bound mappings cannot apply to a different or unidentified edition', () => {
  const [mapping] = rules.validateCustomMappings([rich]);
  assert.equal(rules.mappingMatches(mapping, { title: 'Collection' }), false);
  assert.equal(rules.mappingMatches(mapping, { title: 'Collection', editionId: 'edition-2', isbn: ['9780306406157'] }), false);
  assert.equal(rules.mappingMatches(mapping, { title: 'Collection', editionId: 'edition-1', isbn: ['9780306406157'] }), true);
  assert.equal(rules.mappingMatches({ ...mapping, verified: false }, { title: 'Collection', editionId: 'edition-1', isbn: ['9780306406157'] }), false);
});

test('annual, fractional and manga target titles preserve unit, run and language scope', () => {
  assert.equal(rules.titleContents('Batman Annual (2011) #1')[0].unitType, 'annual');
  assert.equal(rules.titleContents('Batman (2011) Annual #1')[0].run, '2011');
  assert.equal(rules.titleContents('Batman (2011) #1/2')[0].number, '1/2');
  const volumes = rules.titleContents('Naruto Vols. 1-3', { run: '1999', language: 'ja' });
  assert.equal(volumes.length, 3);assert.equal(volumes[0].unitType, 'volume');assert.equal(volumes[0].language, 'ja');
});

test('excerpt and unverified mappings never establish full issue ownership', () => {
  context.library = new Map([['collection', { title: 'Collection' }]]);
  context.mappings = rules.validateCustomMappings([{ collectionTitle: 'Collection', contains: [{ series: 'Batman', year: 2011, number: '1/2', completeness: 'excerpt' }] }]);
  assert.equal(vm.runInContext("findOwnedCollectionIssue('Batman (2011) #1/2', library, mappings)", context), null);
  context.mappings[0].contains[0].completeness = 'full';
  assert.equal(vm.runInContext("findOwnedCollectionIssue('Batman (2011) #0.5', library, mappings)", context), null);
  context.mappings[0].language = 'en';
  assert.ok(vm.runInContext("findOwnedCollectionIssue('Batman (2011) #0.5', library, mappings, {title:'Batman (2011) #0.5', language:'en'})", context));
});

test('rich mappings and bibliographic fields survive full backup round trips without secrets', () => {
  const helper = context.HumbleComicLibrary;
  const mapping = rules.validateCustomMappings([rich])[0];
  const item = { title: 'Collection', kind: 'book', editionId: 'edition-1', isbn: ['9780306406157'], authors: ['Writer'], language: 'en', runId: 'run-1' };
  const restored = helper.restoreBackupState(helper.createLibraryBackup({ libraryItems: [item], customCollectionMappings: [mapping] }));
  assert.deepEqual(plain(restored.libraryItems), [item]);
  assert.deepEqual(plain(restored.customCollectionMappings), plain([mapping]));
  assert.deepEqual(plain(helper.bibliographicFields({ authors: ['Writer'], isbn: '9780306406157', redeemed_key_val: 'secret', downloadUrl: 'secret' })), { authors: ['Writer'], isbn: ['9780306406157'] });
});

test('invalid mapping IDs, dates, source URLs and excessive ranges fail before restore or import', () => {
  for (const patch of [{ sourceUrl: 'javascript:alert(1)' }, { verifiedAt: 'not-a-date' }, { verified: 'yes' }, { identifiers: { isbn: '9780306406158' } }, { contains: [{ series: 'X', year: 2000, from: 1, to: 10000 }] }, { contains: [{ series: 'X', year: 2000, number: '1/0' }] }]) assert.throws(() => rules.validateCustomMappings([{ ...rich, ...patch }]));
  assert.throws(() => rules.validateCustomMappings([rich, rich]), /Duplicate/);
});
