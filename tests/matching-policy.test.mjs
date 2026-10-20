import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import {fixture} from './matching-fixture.mjs';
const fanatical = fs.existsSync(new URL('../src/shared.js', import.meta.url));

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
  }, history).classify()).match.state, fanatical ? 'owned-elsewhere' : 'elsewhere');
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

test('failed central lookup remains Check incomplete; local ownership and Possible evidence survive', async () => {
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

  test('a successful retry clears Check incomplete and caches a completed no-match', async () => {
    const f = fixture([], 'book', { title: 'Retry Book' }, new Error('Unavailable'));
    assert.equal((await f.classify()).match.state, 'unchecked');
    let calls = 0;
    f.context.chrome.runtime.sendMessage = async (_id, request) => {
      if(request.type==='PING')return {ok:true,apiVersion:1};
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

const commonCases = JSON.parse(fs.readFileSync(new URL('./common-matching-cases.json', import.meta.url), 'utf8'));
for (const row of commonCases.filter(row => !row.fanOnly || fanatical)) test('common matching policy: ' + row.label, async () => {
  const { match } = await fixture(row.records, row.media || 'book', row.offer).classify();
  assert.equal(match.state, row.expected);
});


test('central validation accepts any shared ISBN and rejects a preview even from an older GL build', async () => {
  const offer = {title:'Full Book',isbn:'9780140328721',authors:['Alan Moore']};
  const evidence = {isbn:['9780306406157','9780140328721'],authors:['Moore, Alan']};
  const record = {provider:'kindle',title:'Full Book',ownership:'owned',relationship:'same-edition',evidence};
  assert.equal((await fixture([], 'book', offer, {matches:[record]}).classify()).match.state,fanatical?'owned-elsewhere':'elsewhere');
  assert.equal((await fixture([], 'book', {...offer,series:'Second alias'}, {matches:[{...record,evidence:{...evidence,series:['First alias','Second alias']}}]}).classify()).match.state,fanatical?'owned-elsewhere':'elsewhere');
  const preview = {...record,title:'Full Book Preview'};
  const {match,candidates} = await fixture([], 'book', offer, {matches:[preview]}).classify();
  assert.equal(match.state,'possible');
  assert.ok(candidates.some(row=>row.title===preview.title));
  const conflicting = {...record,evidence:{...evidence,isbn:['9780306406157']}};
  assert.equal((await fixture([], 'book', offer, {matches:[conflicting]}).classify()).match.state,'possible');
});

test('incomplete lookup explanations distinguish checked local evidence from an unresolved central check', async () => {
  const f=fixture([], 'book', {title:'Offered Book'}, new Error('Unavailable'));
  const {match}=await f.classify();
  const lines=fanatical?f.context.FanaticalLibrary.explanationLines(match):f.context.HumbleOwnership.explanationLines(match);
  assert.match(lines.join('\n'),/Status: Check incomplete/);
  assert.match(lines.join('\n'),/may already be owned/);
  assert.equal(match.state,'unchecked');
  if(fanatical)assert.equal(f.context.FanaticalLibrary.overlayLabel(match),'Check incomplete');
});


test('game installment conflicts cannot return through central exact, uncertain or fallback responses', async () => {
  const offer = {title:'Cat Quest III'};
  const wrong = {provider:'steam',title:'Cat Quest II',ownership:'owned',relationship:'same-edition',confidence:1};
  for (const field of ['matches','possibleMatches','partialMatches']) for (const ownership of ['owned','unknown']) {
    const central = {[field]:[{...wrong,ownership}]};
    const before = JSON.stringify(central);
    const {match} = await fixture([], 'game', offer, central).classify();
    assert.equal(match.state,'new',field+' '+ownership);
    assert.equal(JSON.stringify(central),before,'Incoming evidence must remain untouched');
  }
  const valid = {...wrong,title:'Cat Quest III',itemRef:'right-game'};
  const {match} = await fixture([], 'game', offer, {matches:[wrong,valid],possibleMatches:[wrong]}).classify();
  assert.equal(match.state,fanatical?'owned-elsewhere':'elsewhere');
  const candidates = match.externalMatches ?? [match.item];
  assert(candidates.some(record=>record.title===offer.title));
  assert(!candidates.some(record=>record.title===wrong.title));
  const related = await fixture([], 'game', offer, {possibleMatches:[wrong,{...valid,title:'Cat Quest III Deluxe Edition'}]}).classify();
  assert.equal(related.match.state,'possible','Keep other legitimate review candidates');
  assert.equal((related.match.externalPossibleMatches??[related.match.item])[0].title,'Cat Quest III Deluxe Edition');
});

test('installment barrier leaves labeled units, model numbers, years, revisions and other media alone', async () => {
  const f = fixture([], 'game', {title:'Cat Quest III'}), policy=f.context.LibraryMatchingPolicy;
  for (const [a,b,kind] of [
    ['Series Vol. 2','Series Vol. 3','book'],['Series #2','Series #3','book'],
    ['Forest Builder Pro v2','Forest Builder Pro v3','software'],
    ['Forest Builder Pro 2025','Forest Builder Pro 2026','software'],
    ['Synthetic Model 2','Synthetic Model 3','game'],['Synthetic X200','Synthetic X300','game'],
    ['Synthetic Series 2025','Synthetic Series 2026','game'],
    ['Synthetic Series Version 2','Synthetic Series Version 3','game'],
    ['Synthetic Series II: Chapter 2','Synthetic Series II: Chapter 3','game'],
    ['Synthetic Series 1.2','Synthetic Series 1.3','game']
  ]) assert.equal(policy.gameInstallmentConflict(a,b,kind),false,a+' / '+b);
  const remake=await fixture([{title:'Final Fantasy VII Remake'}],'game',{title:'Final Fantasy VII'}).classify();
  assert.equal(remake.match.state,fanatical?'new':'possible','Preserve the existing storefront remake policy');
  for (const [a,b] of [['Cat Quest III','Cat Quest II'],['Portal 2','Portal'],['Final Fantasy XV','Final Fantasy XVI']]) {
    for (const [title,owned] of [[a,b],[b,a]]) assert.equal((await fixture([{title:owned}],'game',{title}).classify()).match.state,'new');
  }
});


test('actual GL API and companion reconciliation keep different sequels New and retain the right game', {skip:!fs.existsSync(new URL('../../GalacticLibrary/src/lib/external-api.js',import.meta.url))}, async()=>{
  const {createEmptyDatabase,normalizeProviderItem}=await import('../../GalacticLibrary/src/lib/models.js');
  const {handleExternalApiRequest}=await import('../../GalacticLibrary/src/lib/external-api.js');
  const database=createEmptyDatabase();
  const add=(title,id)=>{const item=normalizeProviderItem({provider:'steam',providerItemId:id,title,mediaType:'game',ownership:'owned'});database.providerItems[item.id]=item;};
  add('Cat Quest II','older-cat');
  const response=()=>{const result=handleExternalApiRequest(database,{type:'MATCH_ITEMS',apiVersion:1,items:[{title:'Cat Quest III',mediaType:'game'}]}).results[0];const {requestId,...payload}=result;return payload;};
  const before=JSON.stringify(database),result=response();
  assert.equal(result.matches.length,0);assert.equal(result.possibleMatches.length,0);
  const f=fixture([], 'game', {title:'Cat Quest III'},result),{match}=await f.classify();
  assert.equal(match.state,'new');
  const presentation=fanatical?f.context.FanaticalLibrary.presentation:f.context.HumbleOwnership.presentation;
  assert.equal(presentation.status(f.context.offered,match),'New');
  assert.equal(JSON.stringify(database),before);
  add('Cat Quest III','right-cat');
  assert.equal((await fixture([], 'game', {title:'Cat Quest III'},response()).classify()).match.state,fanatical?'owned-elsewhere':'elsewhere');
});
