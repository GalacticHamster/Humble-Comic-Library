import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {fixture} from './matching-fixture.mjs';

const fanatical=fs.existsSync(new URL('../src/shared.js',import.meta.url));
const glRoot=new URL('../../GalacticLibrary/',import.meta.url);
const gl=fs.existsSync(new URL('src/lib/models.js',glRoot))?{
  ...await import(new URL('src/lib/models.js',glRoot)),
  ...await import(new URL('src/lib/external-api.js',glRoot))
}:null;
const rows=JSON.parse(fs.readFileSync(new URL('./revision-matching-cases.json',import.meta.url),'utf8'));
const variants=row=>row.editions?[
  [{},{}], [{authors:['Alan Moore']},{authors:['Alan Moore']}],
  [{authors:['Alan Moore']},{authors:['A. Moore']}],
  [{isbn:'9780306406157'},{isbn:'9780306406157'}],
  [{isbn:'9780306406157'},{isbn:'9780140328721'}]
]:[[{},{}]];
for(const row of rows)test('revision contract: '+row.label,async()=>{
  for(const [left,right] of [[row.owned,row.offered],[row.offered,row.owned]])for(const [a,b] of variants(row)){
    const owned={...left,...a},offered={...right,...b};
    for(const duplicates of [1,2]){
      const records=Array.from({length:duplicates},()=>({...owned}));
      const localFixture=fixture(records,row.media,offered),local=await localFixture.classify();
      assert.equal(local.match.state,row.expected,JSON.stringify({owned,offered,duplicates}));
      if(row.expected==='possible')assert.ok(local.candidates.some(item=>item.title===owned.title),'Actual library title must be retained');
      if(!gl)continue;
      const items=records.map((record,index)=>gl.normalizeProviderItem({provider:'kindle',providerItemId:'revision-'+index,
        title:record.title,mediaType:row.media,ownership:'owned',metadata:record}));
      const db={...gl.createEmptyDatabase(),providerItems:Object.fromEntries(items.map(item=>[item.id,item]))};
      const request=fanatical
        ? localFixture.context.FanaticalLibrary.galacticRequestItems([{...offered,sourceItemId:'regression',mediaType:row.media}],true)[0]
        : {title:offered.title,mediaType:row.media,...localFixture.context.HumbleOwnership.request({...offered,kind:row.media})};
      const {requestId,...central}=gl.handleExternalApiRequest(db,{type:'MATCH_ITEMS',apiVersion:1,items:[request]}).results[0];
      assert.equal(central.owned?'owned':central.matches.length||central.possibleMatches.length?'possible':'new',row.expected,'GL classification');
      const linked=await fixture([],row.media,offered,central).classify();
      assert.equal(linked.match.state,row.expected==='owned'?(fanatical?'owned-elsewhere':'elsewhere'):row.expected,'Companion consuming real GL results');
      if(row.expected==='possible')assert.ok(linked.candidates.some(item=>item.title===owned.title),'GL candidate title must survive translation');
    }
  }
});

test('revision contract: failed GL checks retain a local Possible',async()=>{
  for(const row of rows.filter(row=>row.expected==='possible')){
    const result=await fixture([row.owned],row.media,row.offered,new Error('Unavailable')).classify();
    assert.equal(result.match.state,'possible',row.label);
    assert.ok(result.candidates.some(item=>item.title===row.owned.title),row.label);
  }
});

test('revision contract: exact GL identity and original access stay separate from effective ownership',{skip:!gl},async()=>{
  for(const ownership of ['owned','claimed','unknown','subscription','borrowed','rental'])for(const allOwned of [false,true]){
    const item=gl.normalizeProviderItem({provider:'kindle',providerItemId:'identity-access',title:'The Hobbit',mediaType:'book',ownership,metadata:{authors:['J. R. R. Tolkien']}});
    const db={...gl.createEmptyDatabase(),providerItems:{[item.id]:item},ownershipPolicy:{allOwned,providers:{}}};
    const before=JSON.stringify(db);
    const {requestId,...central}=gl.handleExternalApiRequest(db,{type:'MATCH_ITEMS',apiVersion:1,items:[{title:item.title,mediaType:'book'}]}).results[0];
    assert.equal(central.matches.length,1);assert.equal(central.matches[0].relationship,'same-edition');assert.equal(central.confidence,1);
    const treatedOwned=allOwned||['owned','claimed'].includes(ownership);
    assert.equal(central.owned,treatedOwned);assert.equal(central.matches[0].ownership,allOwned?'owned':ownership);
    if(allOwned)assert.equal(central.matches[0].evidence.observedOwnership,ownership);
    assert.equal(JSON.stringify(db),before,'Lookup must preserve original ownership and provenance');
    const linked=await fixture([],'book',{title:item.title},central).classify();
    assert.equal(linked.match.state,treatedOwned?(fanatical?'owned-elsewhere':'elsewhere'):'possible');
    if(!treatedOwned)assert.equal(linked.match.ownershipReview,true);
    const related=gl.handleExternalApiRequest(db,{type:'MATCH_ITEMS',apiVersion:1,items:[{title:item.title+', Revised',mediaType:'book'}]}).results[0];
    assert.equal(related.owned,false,'Override must not promote related identity');assert.equal(related.matches.length,0);assert.equal(related.possibleMatches.length,1);
  }
});


test('collection and format identity survive the shipped GL request and companion response paths', async t => {
  if (!gl) return t.skip('Adjacent Galactic Library checkout is not available');
  const cases = JSON.parse(fs.readFileSync(new URL('./common-matching-cases.json', import.meta.url), 'utf8'))
    .filter(row => row.label.startsWith('numbered collection ') || row.label.startsWith('format identity ') || row.label.startsWith('article identity '));
  for (const row of cases) {
    const f = fixture([], 'book', row.offer);
    const items = row.records.map((record, index) => gl.normalizeProviderItem({provider:'kindle',
      providerItemId:'collection-'+index, title:record.title, mediaType:'book', ownership:'owned', metadata:record}));
    const db = {...gl.createEmptyDatabase(), providerItems:Object.fromEntries(items.map(item => [item.id, item]))};
    const before = JSON.stringify(db);
    const request = fanatical
      ? f.context.FanaticalLibrary.galacticRequestItems([{...row.offer, sourceItemId:'collection', mediaType:'book'}], true)[0]
      : {title:row.offer.title, mediaType:'book', ...f.context.HumbleOwnership.request({...row.offer, kind:'book'})};
    const {requestId, ...central} = gl.handleExternalApiRequest(db, {type:'MATCH_ITEMS', apiVersion:1, items:[request]}).results[0];
    const linked = await fixture([], 'book', row.offer, central).classify();
    assert.equal(linked.match.state, row.expected === 'owned' ? (fanatical ? 'owned-elsewhere' : 'elsewhere') : row.expected, row.label);
    if (row.expected === 'possible') assert.ok(linked.candidates.some(item => item.title === row.records[0].title), row.label);
    assert.equal(JSON.stringify(db), before, 'Read-only matching must not mutate library evidence');
  }
  const titles = [1,2,3].map(number => '30 Days of Night Deluxe Edition Book '+number);
  const records = titles.map(title => ({title}));
  const local = await fixture(records, 'book', {title:'30 Days of Night'}).classify();
  assert.equal(local.match.state, 'possible');
  for (const title of titles) assert.ok(local.candidates.some(item => item.title === title), title);
});


function checkFormatPresentation(policy) {
  const p = (title, kind = 'book') => policy.presentationTitle(title, kind);
  assert.equal(p('FREE AGENTS TP VOL 01 (Digital)'), p('FREE AGENTS, VOL. 1'));
  assert.equal(p('FREE AGENTS TPB VOLUME 001 (Digital)'), p('FREE AGENTS, VOL. 1'));
  for (const [left,right,kind] of [
    ['The Room','Room','book'], ['The Room Vol. 1','Room Vol. 1','book'],
    ['The Complete Guide Vol. 1','Complete Guide Vol. 1','book'],
    ['The Autumnlands Vol. 1','Autumnlands Vol. 1','game'],
    ['Autumnlands and The Visitors Vol. 1','Autumnlands and Visitors Vol. 1','book'],
    ['Project 01','Project 1','book'], ['Series #01','Series #1','book'],
    ['Series Book 01','Series Book 1','book'], ['Series Vol. 01.5','Series Vol. 1.5','book'],
    ['Series Vol. 01/2','Series Vol. 1/2','book'], ['Digital Agents','Agents','book'],
    ['Agents Digital','Agents','book'], ['Agents TP Stories Vol. 1','Agents Stories Vol. 1','book'],
    ['Agents TP VOL 01 (Digital)','Agents Vol. 1','game'],
    ['Agents Vol. 01','Agents Vol. 1','software'],
    ['Agents Vol. 1: Revised Edition','Agents Vol. 1','book'],
    ['Agents Vol. 1: Another Story','Agents Vol. 1','book']
  ]) assert.notEqual(p(left,kind),p(right,kind),left+' must keep meaningful information');
}

test('format presentation preserves meaningful numbers, words and edition labels', () => {
  checkFormatPresentation(fixture([], 'book', {title:'Unused'}).context.LibraryMatchingPolicy);
});

test('format-equivalent GL records still require permanent ownership', async t => {
  if (!gl) return t.skip('Adjacent Galactic Library checkout is not available');
  for (const [libraryTitle, offeredTitle] of [['FREE AGENTS, VOL. 1','FREE AGENTS TP VOL 01 (Digital)'],['The Autumnlands Vol. 1','AUTUMNLANDS, VOL. 1 TP (Digital)']]) for (const ownership of ['unknown','borrowed','subscription']) {
    const item = gl.normalizeProviderItem({provider:'kindle',providerItemId:'format-access',
      title:libraryTitle,mediaType:'book',ownership});
    const db = {...gl.createEmptyDatabase(),providerItems:{[item.id]:item}};
    const {requestId,...central} = gl.handleExternalApiRequest(db,{type:'MATCH_ITEMS',apiVersion:1,
      items:[{title:offeredTitle,mediaType:'book'}]}).results[0];
    assert.equal(central.owned,false);
    assert.equal(central.matches[0].relationship,'same-edition');
    const result = await fixture([], 'book', {title:offeredTitle}, central).classify();
    assert.equal(result.match.state,'possible');
  }
});
