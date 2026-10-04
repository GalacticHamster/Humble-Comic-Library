import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),hb=fs.existsSync(new URL('ownership.js',root)),ctx={URL};ctx.globalThis=ctx;vm.createContext(ctx);
for(const name of hb?['shared.js','collection-mappings.js','ownership.js']:['src/shared.js','src/planning.js'])vm.runInContext(fs.readFileSync(new URL(name,root),'utf8'),ctx);
const O=hb?ctx.HumbleOwnership:ctx.FanaticalLibrary;
const unit=(number,extra={})=>({series:'Saga',run:'2020',language:'en',unitType:'issue',number:String(number),completeness:'full',...extra});
const source={provider:'kindle',ownership:'owned',title:'Owned omnibus',itemRef:'opaque'};
function row(id,entries,state='new',owned=[],extra={}){
 const item={title:id,sourceItemId:id,kind:'book',mediaType:'book',contents:entries,contentsComplete:true,tier:{price:1}};
 const covered=entries.filter(entry=>owned.includes(entry.number)).map(entry=>({...entry,evidence:[source]}));
 const match={state,offered:item,coverage:{total:entries.length,owned:covered.length,covered,possibleCovered:[],missing:entries.filter(entry=>!owned.includes(entry.number))},...extra};
 return {item,match,target:{entries,complete:true,mappings:[{}],uncertain:false}};
}
function contents(rows){return hb?O.bundleContents(rows):O.bundleContents({kind:'standard',products:rows.map(row=>row.item),groups:[{price:{USD:100},products:rows.map(row=>row.item)}]},rows.map(row=>row.match));}
const numbers=entries=>Array.from(entries,entry=>entry.number).sort();
function targets(rows){return hb?O.readingTargets(rows):O.readingTargets(rows.map(row=>row.item)).queries;}
const entries=query=>hb?query.target.entries:query.entries;
test('advanced parity: overlap counts each additional full unit once and subtracts union ownership',()=>{
 const result=contents([row('first',[1,2,3].map(n=>unit(n)),'partial',['1','2']),row('second',[2,3,4].map(n=>unit(n)),'partial',['2'])]);
 assert.deepEqual(numbers(result.additional),['3','4']);assert.deepEqual(numbers(result.covered),['1','2']);assert.equal(result.uncertain.length,0);assert.equal(result.tiers[0].additional,2);
});
test('advanced parity: incomplete overlap prevents an optimistic additional count; local covered evidence survives',()=>{
 const result=contents([row('complete',[unit(1),unit(2)],'partial',['1']),row('incomplete',[unit(2)],'unchecked',[],{lookupIncomplete:true})]);
 assert.equal(result.additional.length,0);assert.deepEqual(numbers(result.covered),['1']);assert.deepEqual(numbers(result.uncertain),['2']);
});
test('advanced parity: explicit whole ownership covers catalog units; a title range alone cannot',()=>{
 assert.equal(contents([row('owned',[unit(1),unit(2)],hb?'elsewhere':'owned-elsewhere')]).covered.length,2);
 const owned=row('Saga (2020) #1-2',[unit(1),unit(2)],'owned');owned.target.mappings=[];delete owned.item.contents;
 assert.equal(contents([owned]).covered.length,0);
});
test('advanced parity: Partial contributes verified additional units to a unit goal, never a whole new product',()=>{
 const partial=row('partial',[unit(1),unit(2)],'partial',['1']),incomplete=row('incomplete',[unit(3)],'unchecked',[],{lookupIncomplete:true});
 const resolved=[partial,incomplete];
 const p=hb?O.planBundle(resolved,[],'contents',true):O.planPurchase({kind:'standard',products:resolved.map(row=>row.item),groups:[{price:{USD:100},products:resolved.map(row=>row.item)}]},resolved.map(row=>row.match),[],{goal:'units',includeUncertain:true});
 assert.equal(hb?p.goalCount:p.targetUnits,1);assert.equal(hb?p.lowest.newUnits:p.recommended.additionalUnits,1);assert.equal(partial.match.state,'partial');assert.equal(incomplete.match.state,'unchecked');
});
test('advanced parity: an unresolved overlapping unit stays out of verified unit planning',()=>{
 const resolved=[row('complete',[unit(1),unit(2)],'partial',['1']),row('incomplete',[unit(2)],'unchecked',[],{lookupIncomplete:true})];
 const p=hb?O.planBundle(resolved,[],'contents',true):O.planPurchase({kind:'standard',products:resolved.map(row=>row.item),groups:[{price:{USD:100},products:resolved.map(row=>row.item)}]},resolved.map(row=>row.match),[],{goal:'units',includeUncertain:true});
 assert.equal(hb?p.goalCount:p.targetUnits,0);
});
test('advanced parity: annuals and specials have no invented numbered intervening unit',()=>{
 for(const unitType of ['annual','special']){const q=targets([row('specials',[unit(1,{unitType}),unit(3,{unitType})])]);assert.deepEqual(numbers(entries(q[0])),['1','3']);}
 assert.deepEqual(numbers(entries(targets([row('issues',[unit(1),unit(3)])])[0])),['1','2','3']);
});
test('advanced parity: labelled title-derived annuals are never filled as ordinary issues',()=>{
 const rows=[1,3].map(number=>{const item={title:'Saga Annual #'+number,kind:'book',mediaType:'book',run:'2020',language:'en'};return {item,target:O.offerContents(item,[])};});
 const q=targets(rows);assert.equal(q.length,1);assert.deepEqual(numbers(entries(q[0])),['1','3']);assert.equal(entries(q[0])[0].unitType,'annual');
 const local=hb?O.localEvidence([rows[0].item],[]):O.localContents([rows[0].item]);
 const coverage=hb?O.seriesCoverage(q,local)[0]:O.readingCoverage({queries:q},local,()=>null,false)[0];
 assert.equal(hb?coverage.covered:coverage.coverage.owned,1);
});
test('advanced parity: unknown scope needs review without invented gaps',()=>{
 const q=targets([row('unknown',[unit(1,{run:''}),unit(3,{run:''})])]);
 assert(!q.length||q.every(query=>entries(query).length===2&&query.unknownScope));
 if(hb)assert.equal(O.seriesCoverage(q,[])[0].gaps.length,0);
});
test('advanced parity: different runs and languages never form a shared inferred range',()=>{
 const q=targets([row('mixed',[unit(1),unit(3,{run:'2021'}),unit(5,{language:'ja'})])]);assert.equal(q.length,3);assert(q.every(query=>entries(query).length===1));
});
test('advanced parity: arbitrary product numbers do not establish a sequence',()=>{
 const item={title:'Design Suite 2024',kind:'software',mediaType:'software'};
 assert.equal(targets([{item,target:{entries:[]}}]).length,0);
 assert.equal(targets([]).length,0);assert.equal(contents([]).additional.length,0);
});
test('advanced parity: long series obey 100 group, 2000 per-series and 20000 total limits',()=>{
 const q=targets(Array.from({length:110},(_,n)=>row('series-'+n,[unit(1,{series:'Series '+n}),unit(1999,{series:'Series '+n})])));
 assert(q.length<=100);assert(q.every(query=>entries(query).length<=2000));assert(q.reduce((sum,query)=>sum+entries(query).length,0)<=20000);
 const huge=targets([row('huge',[unit(1),unit(100000)])]);assert.equal(entries(huge[0]).length,2);
});
test('advanced parity: technical freshness reminders never revoke ownership or expose opaque identifiers',()=>{
 const match={state:hb?'elsewhere':'owned-elsewhere',externalResult:{matches:[{...source,evidence:{checkedAt:'2025-01-01'},verifiedAt:'2025-01-02'}]}};
 const result=O.centralReminders([match,match],Date.parse('2026-10-03'));
 assert.deepEqual(Array.from(result,entry=>entry.type),['freshness','contents']);assert(!JSON.stringify(result).includes('opaque'));assert.equal(match.state,hb?'elsewhere':'owned-elsewhere');
});
