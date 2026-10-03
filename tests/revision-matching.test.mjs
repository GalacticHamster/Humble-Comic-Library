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
