import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture} from './matching-fixture.mjs';

test('comic presentation is book identity policy, with the same edition and volume barriers',()=>{
  const policy=fixture([], 'book', {title:'Unused'}).context.LibraryMatchingPolicy;
  for(const [left,right]of [
    ['FREE AGENTS TP VOL 01 (Digital)','FREE AGENTS, VOL. 1'],
    ['The Autumnlands Vol. 1','AUTUMNLANDS VOL 1 TP (Digital)']
  ])assert(policy.fullTitleMatches(left,right,'comic'));
  assert(policy.revisionWordingConflict('Algorithmic Thinking','Algorithmic Thinking, 2nd Edition','comic'));
  assert.equal(policy.numberedCollectionRelation('Astro City Vol. 1','Astro City Vol. 2','comic'),'');
  for(const kind of ['comic','book','software','game'])assert.equal(policy.fullTitleMatches('Forest Builder 2025','Forest Builder 2026',kind),false);
});

test('software years, versions and tiers remain distinct after display classification, without changing purchase records',async()=>{
  for(const media of ['book','game','software'])for(const [owned,title]of [
    ['Forest Builder Pro 2025','Forest Builder Pro 2026'],
    ['Forest Builder Pro v2','Forest Builder Pro v3'],
    ['Forest Builder Pro Standard Edition','Forest Builder Pro Enterprise Edition']
  ]){
    const records=[{title:owned,automaticKind:'software',manualKind:media,purchaseKey:'original-purchase',provenance:[{title:owned,purchaseKey:'original-purchase'}]}],before=JSON.stringify(records);
    const f=fixture(records,media,{title}),input=JSON.stringify(f.context.records),result=await f.classify();
    assert.notEqual(result.match.state,'owned',owned+' / '+title+' as '+media);
    if(media==='software')assert.equal(result.match.state,'possible');
    assert.equal(JSON.stringify(records),before);assert.equal(JSON.stringify(f.context.records),input);
  }
});
