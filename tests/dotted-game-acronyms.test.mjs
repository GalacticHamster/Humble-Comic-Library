import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './matching-fixture.mjs';

test('dotted game acronym identifies the same full purchased title in both directions',async()=>{
  for(const [offered,stored]of [['F.E.A.R. 2','FEAR 2'],['FEAR 2','F.E.A.R. 2']]){
    const f=fixture([{title:stored,purchaseKey:'original-copy'}],'game',{title:offered});
    const before=JSON.stringify(f.context.records),{match,candidates}=await f.classify();
    assert.equal(match.state,'owned');assert(candidates.some(c=>c.title===stored));
    assert.equal(JSON.stringify(f.context.records),before);
  }
});

test('acronym equality never erases a sequel, edition, collection or identity conflict',async()=>{
  for(const title of ['FEAR 3','FEAR','FEAR 2 Remastered','FEAR 2 Gold Edition','FEAR Collection','FEAR 2: Different subtitle']){
    assert.notEqual((await fixture([{title}],'game',{title:'F.E.A.R. 2'}).classify()).match.state,'owned',title);
  }
  assert.notEqual((await fixture([{title:'FEAR 2',editionId:'other'}],'game',{title:'F.E.A.R. 2',editionId:'original'}).classify()).match.state,'owned');
  for(const kind of ['book','audiobook','software'])assert.notEqual((await fixture([{title:'FEAR 2'}],kind,{title:'F.E.A.R. 2'}).classify()).match.state,'owned',kind);
  assert.notEqual((await fixture([{title:'ABCD 2'}],'game',{title:'AB.CD 2'}).classify()).match.state,'owned');
});

test('independent GL ownership remains separate from Humble purchase evidence',async()=>{
  const {match}=await fixture([],'game',{title:'F.E.A.R. 2'},{matches:[{title:'FEAR 2',provider:'steam',ownership:'owned',relationship:'same-edition'}]}).classify();
  assert.equal(match.state,'elsewhere');assert.equal(match.externalResult.matches[0].provider,'steam');
});

test('acronym identity cannot promote expired keys or historical-only records into current ownership',async()=>{
  const expired=await fixture([{title:'F.E.A.R. 2',entitlement:'third-party-key',keyStatus:'expired'}],'game',{title:'FEAR 2'}).classify();
  assert.notEqual(expired.match.state,'owned');
  const historical=await fixture([],'game',{title:'FEAR 2'},null,[{title:'F.E.A.R. 2',sourceBundle:'Earlier purchase'}]).classify();
  assert.notEqual(historical.match.state,'owned');
});
