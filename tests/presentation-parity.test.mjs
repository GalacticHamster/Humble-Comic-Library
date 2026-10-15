import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url), hb=fs.existsSync(new URL('ownership.js',root));
const ctx={URL};ctx.globalThis=ctx;vm.createContext(ctx);
for(const name of hb?['shared.js','collection-mappings.js','ownership.js']:['src/shared.js','src/planning.js'])vm.runInContext(fs.readFileSync(new URL(name,root),'utf8'),ctx);
const P=(hb?ctx.HumbleOwnership:ctx.FanaticalLibrary).presentation;
const L = hb ? ctx.HumbleComicLibrary : ctx.FanaticalLibrary;
const fixtures=JSON.parse(fs.readFileSync(new URL('presentation-fixtures.json',import.meta.url),'utf8'));
for(const fixture of fixtures)test('presentation parity: '+fixture.name,()=>{
 const model=P.summary(fixture.rows),states=['owned','owned-elsewhere','new','partial','possible','unchecked'];
 assert.equal(Object.values(model.counts).reduce((a,b)=>a+b,0),fixture.rows.length);
 assert.deepEqual(Array.from(model.sections),states.filter(state=>fixture.rows.some(row=>row.match.state===state)));
 for(let i=0;i<fixture.rows.length;i++){
  const row=model.items[i],state=fixture.rows[i].match.state;
  assert.equal(row.why,['possible','partial','unchecked'].includes(state));
  if(state==='owned-elsewhere')assert.deepEqual(Array.from(row.providers),['Steam']);
  if(state==='partial')assert.equal(row.fraction,'7/10 owned');
  if(state==='possible')assert.equal(row.relatedTitle,'Related title');
  assert(!/normalized|same-edition|identifiers|checked unknown/u.test(P.explanation(fixture.rows[i].item,fixture.rows[i].match)));
 }
});

test('classification parity: comic detection distinguishes comics, books, and other media consistently', () => {
  const comicByKind = { title: 'Superhero Series #1', kind: 'comic', mediaType: 'comic' };
  const comicByBundle = { title: 'Issue 1', kind: 'book', mediaType: 'book', bundle: { title: 'Summer Manga & Comics Bundle' } };
  const comicByFormat = { title: 'Graphic Novel Vol 1', kind: 'book', mediaType: 'book', formats: ['cbz'] };
  const generalBook = { title: 'Cooking 101', kind: 'book', mediaType: 'book', bundle: { title: 'Culinary Masterclass' } };
  const overriddenAway = { title: 'Comic Art Reference', kind: 'book', mediaType: 'book', manualMediaType: 'book', manualKind: 'book', bundle: { title: 'Comics Bundle' } };
  const game = { title: 'Comic Hero Game', kind: 'game', mediaType: 'game', bundle: { title: 'Comics Bundle' } };

  assert.equal(L.isComicItem(comicByKind), true, 'comic by kind should be comic');
  assert.equal(L.isComicItem(comicByBundle), true, 'comic by bundle should be comic');
  assert.equal(L.isComicItem(comicByFormat), true, 'comic by cbz/cbr format should be comic');
  assert.equal(L.isComicItem(generalBook), false, 'general book should not be comic');
  assert.equal(L.isComicItem(overriddenAway), false, 'manually overridden item should respect override');
  assert.equal(L.isComicItem(game), false, 'game should not be comic');
});

test('classification parity: media override keys are scoped to stable product identity without collision across shared titles', () => {
  const itemA = { sourceItemId: 'hb_item_123', title: 'Complete Collection' };
  const itemB = { sourceItemId: 'fan_item_456', title: 'Complete Collection' };
  const keyA = L.mediaOverrideKey(itemA);
  const keyB = L.mediaOverrideKey(itemB);
  assert.equal(keyA, 'hb_item_123');
  assert.equal(keyB, 'fan_item_456');
  assert.notEqual(keyA, keyB, 'different products sharing a title must not collide');
});

test('filter semantics parity: Books matches books and comics, Comics matches comics specifically', () => {
  const comic = { title: 'Comic One', kind: 'comic', mediaType: 'comic' };
  const book = { title: 'Novel One', kind: 'book', mediaType: 'book' };
  const unclassified = { title: 'Unknown One', kind: 'unclassified', mediaType: 'unclassified' };

  const matchesFilter = (item, filter) => {
    const kind = item.kind || item.mediaType || 'other';
    if (filter === 'all') return true;
    if (filter === 'book') return kind === 'book' || kind === 'comic';
    if (filter === 'comic') return kind === 'comic' || L.isComicItem(item);
    if (filter === 'unclassified') return kind === 'unclassified' || kind === 'other';
    return kind === filter;
  };

  assert.equal(matchesFilter(comic, 'book'), true, 'Books filter must include comics');
  assert.equal(matchesFilter(book, 'book'), true, 'Books filter must include books');
  assert.equal(matchesFilter(unclassified, 'book'), false, 'Books filter must not include unclassified');

  assert.equal(matchesFilter(comic, 'comic'), true, 'Comics filter must include comics');
  assert.equal(matchesFilter(book, 'comic'), false, 'Comics filter must not include general books');

  assert.equal(matchesFilter(unclassified, 'unclassified'), true, 'Unclassified filter must include unclassified');
  assert.equal(matchesFilter(comic, 'unclassified'), false, 'Unclassified filter must not include comics');
});
